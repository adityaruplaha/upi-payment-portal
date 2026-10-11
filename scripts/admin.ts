// Manages beneficiaries and payment links in the D1 database. Run it as
// `bun run db:admin <group> <command>`; `--help` at any level lists what there is.
//
// Every command works on the local database that `bun run dev` uses, or on the live one with
// --remote. In a terminal, anything left out is asked for, and deactivating or deleting asks for
// confirmation; elsewhere everything must be given, with --yes for confirmations.

import { cancel, confirm, isCancel, log, select, text } from '@clack/prompts';
import chalk from 'chalk';
import { Command, Option } from 'commander';
import { ulid } from 'ulid';

const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);

/** A mistake in how the command was called, as opposed to a failure while running it. */
class UsageError extends Error {}

// ---- the database ----------------------------------------------------------

const target = {
	remote: false,
	database: process.env.D1_DB_NAME ?? 'payments',
	persistTo: undefined as string | undefined
};

/** Runs SQL through wrangler, which takes no parameters, so values are quoted with `sql`. */
function query<T = Record<string, unknown>>(statement: string): T[] {
	const args = [
		'bunx',
		'wrangler',
		'd1',
		'execute',
		target.database,
		'--json',
		'--command',
		statement
	];
	if (target.remote) args.push('--remote');
	else args.push('--local', ...(target.persistTo ? ['--persist-to', target.persistTo] : []));
	const run = Bun.spawnSync(args, { cwd: `${import.meta.dir}/..`, stderr: 'pipe' });
	// With --json, wrangler reports a failed statement as JSON on stdout.
	if (run.exitCode !== 0)
		throw new Error(
			`wrangler d1 execute failed:\n${(run.stderr.toString() + run.stdout.toString()).trim()}`
		);
	return (JSON.parse(run.stdout.toString()) as { results: T[] }[])[0].results;
}

const sql = (v: string | number | null | undefined) =>
	v == null ? 'NULL' : typeof v === 'number' ? String(v) : `'${v.replaceAll("'", "''")}'`;

// ---- checks ----------------------------------------------------------------

const required = (what: string) => (v: string) => (v.trim() ? undefined : `${what} is required.`);

function checkVpa(v: string): string | undefined {
	return /^[^\s@]+@[^\s@]+$/.test(v) ? undefined : `"${v}" is not a UPI ID (name@bank).`;
}

function checkDomain(v: string): string | undefined {
	if (/^pay\./i.test(v))
		return `Store the domain without "pay." (${v.slice(4)}): the site strips it before looking a link up.`;
	return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(v) ? undefined : `"${v}" is not a domain.`;
}

function checkToken(v: string): string | undefined {
	return /^[^\s/?#]+$/.test(v) ? undefined : `"${v}" cannot be used in a URL path as it is.`;
}

function parseAmount(v: string): number {
	const n = Number(v);
	if (!v.trim() || !Number.isFinite(n) || n <= 0)
		throw new UsageError(`The amount must be a positive number, not "${v}".`);
	return n;
}
const checkAmount = (v: string) => {
	try {
		parseAmount(v);
	} catch (e) {
		return (e as Error).message;
	}
};

// ---- prompting -------------------------------------------------------------

function cancelled(): never {
	cancel('Cancelled.');
	process.exit(130);
}

/** The given value, or one asked for in a terminal. */
async function ask(
	label: string,
	value: string | undefined,
	check: (v: string) => string | undefined = required(label),
	initialValue?: string
): Promise<string> {
	if (value !== undefined) {
		const problem = check(value);
		if (problem) throw new UsageError(problem);
		return value;
	}
	if (!interactive) throw new UsageError(`${label} is required.`);
	const answer = await text({ message: label, initialValue, validate: (v) => check(v ?? '') });
	if (isCancel(answer)) cancelled();
	return answer.trim();
}

/** An optional value asked for in a terminal, where an empty answer means none. */
async function askOptional(
	label: string,
	initialValue: string | undefined,
	check: (v: string) => string | undefined = () => undefined
): Promise<string | null> {
	const answer = await text({
		message: `${label} (leave empty for none)`,
		initialValue,
		validate: (v) => (v?.trim() ? check(v.trim()) : undefined)
	});
	if (isCancel(answer)) cancelled();
	return answer.trim() || null;
}

async function confirmed(message: string, yes: boolean | undefined): Promise<void> {
	if (yes) return;
	if (!interactive) throw new UsageError(`${message} Pass --yes to confirm.`);
	const answer = await confirm({ message });
	if (isCancel(answer) || !answer) cancelled();
}

async function askActive(current: boolean): Promise<boolean> {
	const answer = await select({
		message: 'Status',
		options: [
			{ value: true, label: 'Active' },
			{ value: false, label: 'Inactive' }
		],
		initialValue: current
	});
	if (isCancel(answer)) cancelled();
	return answer;
}

/** --active or --inactive as a boolean, or undefined when neither was given. */
function activeFlag(opts: { active?: boolean; inactive?: boolean }): boolean | undefined {
	if (opts.active && opts.inactive) throw new UsageError('Give --active or --inactive, not both.');
	return opts.active ? true : opts.inactive ? false : undefined;
}

// ---- beneficiaries ---------------------------------------------------------

interface Beneficiary {
	id: string;
	payee_name: string;
	vpa: string;
	is_active: number;
}

const status = (active: number) => (active ? chalk.green('active') : chalk.red('inactive'));

function describeBeneficiary(b: Beneficiary): string {
	return `${chalk.cyan(b.id)}  ${b.payee_name}  ${chalk.blue(b.vpa)}  ${status(b.is_active)}`;
}

function beneficiaries(): Beneficiary[] {
	return query<Beneficiary>(
		'SELECT id, payee_name, vpa, is_active FROM beneficiaries ORDER BY created_at DESC, id DESC'
	);
}

/** The beneficiary an id names, or one picked from a list. */
async function pickBeneficiary(id: string | undefined): Promise<Beneficiary> {
	if (id === undefined) {
		if (!interactive) throw new UsageError('Give the beneficiary id, from `beneficiary list`.');
		const all = beneficiaries();
		if (!all.length)
			throw new UsageError('There are no beneficiaries. Add one with `beneficiary add`.');
		const picked = await select({
			message: 'Which beneficiary?',
			options: all.map((b) => ({
				value: b.id,
				label: `${b.payee_name} (${b.vpa})`,
				hint: b.is_active ? b.id : `${b.id}, inactive`
			}))
		});
		if (isCancel(picked)) cancelled();
		return all.find((b) => b.id === picked)!;
	}
	const [b] = query<Beneficiary>(
		`SELECT id, payee_name, vpa, is_active FROM beneficiaries WHERE id = ${sql(id)}`
	);
	if (!b) throw new UsageError(`No beneficiary ${id}. See \`beneficiary list\`.`);
	return b;
}

function beneficiaryList() {
	const all = beneficiaries();
	if (!all.length) log.info('No beneficiaries.');
	for (const b of all) console.log(describeBeneficiary(b));
}

async function beneficiaryAdd(opts: { name?: string; vpa?: string; inactive?: boolean }) {
	const name = await ask('Payee name', opts.name);
	const vpa = await ask('UPI ID', opts.vpa, checkVpa);
	const id = ulid();
	query(
		`INSERT INTO beneficiaries (id, payee_name, vpa, is_active) VALUES (${sql(id)}, ${sql(name)}, ${sql(vpa)}, ${opts.inactive ? 0 : 1})`
	);
	log.success(`Added beneficiary ${id}.`);
}

async function beneficiaryEdit(
	id: string | undefined,
	opts: { name?: string; vpa?: string; active?: boolean; inactive?: boolean }
) {
	let active = activeFlag(opts);
	const given = opts.name !== undefined || opts.vpa !== undefined || active !== undefined;
	if (!given && !interactive)
		throw new UsageError('Nothing to change: give --name, --vpa, --active or --inactive.');
	const b = await pickBeneficiary(id);
	let { name, vpa } = opts;
	if (!given) {
		// In a terminal with nothing given, every field is offered with its current value.
		name = await ask('Payee name', undefined, required('Payee name'), b.payee_name);
		vpa = await ask('UPI ID', undefined, checkVpa, b.vpa);
		active = await askActive(Boolean(b.is_active));
	}
	if (name !== undefined && required('Payee name')(name))
		throw new UsageError('The payee name cannot be empty.');
	if (vpa !== undefined && checkVpa(vpa)) throw new UsageError(checkVpa(vpa));
	const set = [
		name !== undefined && `payee_name = ${sql(name)}`,
		vpa !== undefined && `vpa = ${sql(vpa)}`,
		active !== undefined && `is_active = ${active ? 1 : 0}`
	].filter(Boolean);
	const [changed] = query<Beneficiary>(
		`UPDATE beneficiaries SET ${set.join(', ')} WHERE id = ${sql(b.id)} RETURNING id, payee_name, vpa, is_active`
	);
	log.success('Changed:');
	console.log(describeBeneficiary(changed));
}

async function beneficiaryDeactivate(id: string | undefined, opts: { yes?: boolean }) {
	const b = await pickBeneficiary(id);
	if (!b.is_active) throw new UsageError(`${b.payee_name} (${b.id}) is already inactive.`);
	await confirmed(`Deactivate ${b.payee_name} (${b.vpa})?`, opts.yes);
	query(`UPDATE beneficiaries SET is_active = 0 WHERE id = ${sql(b.id)}`);
	log.success(`Deactivated ${b.id}.`);
	log.warn(
		'Its payment links still work: the site does not check whether a beneficiary is active. Deactivate them with `link deactivate`.'
	);
}

async function beneficiaryDelete(id: string | undefined, opts: { yes?: boolean }) {
	const b = await pickBeneficiary(id);
	const [{ n }] = query<{ n: number }>(
		`SELECT count(*) AS n FROM payment_links WHERE beneficiary_id = ${sql(b.id)}`
	);
	if (n)
		throw new UsageError(
			`${b.payee_name} still has ${n} payment link(s); delete those first, or deactivate the beneficiary instead.`
		);
	await confirmed(`Delete ${b.payee_name} (${b.vpa}) for good?`, opts.yes);
	query(`DELETE FROM beneficiaries WHERE id = ${sql(b.id)}`);
	log.success(`Deleted ${b.id}.`);
}

// ---- payment links ---------------------------------------------------------

interface Link {
	token: string;
	domain: string;
	beneficiary_id: string;
	payee_name: string;
	amount: number | null;
	transaction_note: string | null;
	is_active: number;
}

const LINK_COLUMNS = `p.token, p.domain, p.beneficiary_id, b.payee_name, p.amount, p.transaction_note, p.is_active
	FROM payment_links p JOIN beneficiaries b ON b.id = p.beneficiary_id`;

function describeLink(l: Link): string {
	return [
		`${chalk.cyan(`pay.${l.domain}/${l.token}`)}  ${l.payee_name}`,
		l.amount != null ? chalk.magenta(`₹${l.amount}`) : chalk.dim('any amount'),
		l.transaction_note ? chalk.dim(`"${l.transaction_note}"`) : '',
		status(l.is_active)
	]
		.filter(Boolean)
		.join('  ');
}

function links(domain?: string): Link[] {
	return query<Link>(
		`SELECT ${LINK_COLUMNS}${domain ? ` WHERE p.domain = ${sql(domain)}` : ''} ORDER BY p.domain, p.token`
	);
}

/** The link a token and domain name, or one picked from a list. */
async function pickLink(token: string | undefined, domain: string | undefined): Promise<Link> {
	if (token === undefined || domain === undefined) {
		if (!interactive) throw new UsageError('Give the token and the domain, from `link list`.');
		const all = links(domain).filter((l) => token === undefined || l.token === token);
		if (!all.length) throw new UsageError('No payment links match.');
		const picked = await select({
			message: 'Which payment link?',
			options: all.map((l, i) => ({
				value: i,
				label: `pay.${l.domain}/${l.token}`,
				hint: `${l.payee_name}${l.is_active ? '' : ', inactive'}`
			}))
		});
		if (isCancel(picked)) cancelled();
		return all[picked];
	}
	const [l] = query<Link>(
		`SELECT ${LINK_COLUMNS} WHERE p.token = ${sql(token)} AND p.domain = ${sql(domain)}`
	);
	if (!l) throw new UsageError(`No payment link ${token} on ${domain}. See \`link list\`.`);
	return l;
}

function linkList(opts: { domain?: string }) {
	const all = links(opts.domain);
	if (!all.length) log.info('No payment links.');
	for (const l of all) console.log(describeLink(l));
}

async function linkAdd(
	token: string | undefined,
	domain: string | undefined,
	opts: { beneficiary?: string; amount?: string; note?: string; inactive?: boolean }
) {
	const b = await pickBeneficiary(opts.beneficiary);
	token = await ask('Token', token, checkToken);
	domain = await ask('Domain, without "pay."', domain, checkDomain);
	let amount: number | null = opts.amount !== undefined ? parseAmount(opts.amount) : null;
	let note = opts.note ?? null;
	// In a terminal, the optional fields not given are offered too.
	if (interactive && opts.amount === undefined) {
		const answer = await askOptional('Amount in rupees', undefined, checkAmount);
		amount = answer === null ? null : parseAmount(answer);
	}
	if (interactive && opts.note === undefined)
		note = await askOptional('Transaction note', undefined);
	const [taken] = query(
		`SELECT 1 FROM payment_links WHERE token = ${sql(token)} AND domain = ${sql(domain)}`
	);
	if (taken) throw new UsageError(`${token} is already a payment link on ${domain}.`);
	query(
		`INSERT INTO payment_links (token, domain, beneficiary_id, amount, transaction_note, is_active)
		 VALUES (${sql(token)}, ${sql(domain)}, ${sql(b.id)}, ${sql(amount)}, ${sql(note)}, ${opts.inactive ? 0 : 1})`
	);
	log.success(`Added https://pay.${domain}/${token}`);
}

async function linkEdit(
	token: string | undefined,
	domain: string | undefined,
	opts: {
		beneficiary?: string;
		amount?: string;
		anyAmount?: boolean;
		note?: string | false;
		active?: boolean;
		inactive?: boolean;
	}
) {
	if (opts.amount !== undefined && opts.anyAmount)
		throw new UsageError('Give --amount or --any-amount, not both.');
	let active = activeFlag(opts);
	const given =
		opts.beneficiary !== undefined ||
		opts.amount !== undefined ||
		opts.anyAmount ||
		opts.note !== undefined ||
		active !== undefined;
	if (!given && !interactive)
		throw new UsageError(
			'Nothing to change: give --beneficiary, --amount, --any-amount, --note, --no-note, --active or --inactive.'
		);
	const l = await pickLink(token, domain);
	const set: string[] = [];
	if (given) {
		if (opts.beneficiary !== undefined)
			set.push(`beneficiary_id = ${sql((await pickBeneficiary(opts.beneficiary)).id)}`);
		if (opts.amount !== undefined) set.push(`amount = ${sql(parseAmount(opts.amount))}`);
		if (opts.anyAmount) set.push('amount = NULL');
		if (opts.note !== undefined) set.push(`transaction_note = ${sql(opts.note || null)}`);
	} else {
		// In a terminal with nothing given, every field is offered with its current value.
		const change = await confirm({
			message: `Change the beneficiary (now ${l.payee_name})?`,
			initialValue: false
		});
		if (isCancel(change)) cancelled();
		if (change) set.push(`beneficiary_id = ${sql((await pickBeneficiary(undefined)).id)}`);
		const amount = await askOptional(
			'Amount in rupees',
			l.amount != null ? String(l.amount) : undefined,
			checkAmount
		);
		set.push(`amount = ${sql(amount === null ? null : parseAmount(amount))}`);
		set.push(
			`transaction_note = ${sql(await askOptional('Transaction note', l.transaction_note ?? undefined))}`
		);
		active = await askActive(Boolean(l.is_active));
	}
	if (active !== undefined) set.push(`is_active = ${active ? 1 : 0}`);
	query(
		`UPDATE payment_links SET ${set.join(', ')} WHERE token = ${sql(l.token)} AND domain = ${sql(l.domain)}`
	);
	log.success('Changed:');
	console.log(describeLink(await pickLink(l.token, l.domain)));
}

async function linkDeactivate(
	token: string | undefined,
	domain: string | undefined,
	opts: { yes?: boolean }
) {
	const l = await pickLink(token, domain);
	if (!l.is_active) throw new UsageError(`pay.${l.domain}/${l.token} is already inactive.`);
	await confirmed(`Deactivate pay.${l.domain}/${l.token}? It will answer 404.`, opts.yes);
	query(
		`UPDATE payment_links SET is_active = 0 WHERE token = ${sql(l.token)} AND domain = ${sql(l.domain)}`
	);
	log.success(`Deactivated pay.${l.domain}/${l.token}.`);
}

async function linkDelete(
	token: string | undefined,
	domain: string | undefined,
	opts: { yes?: boolean }
) {
	const l = await pickLink(token, domain);
	await confirmed(`Delete pay.${l.domain}/${l.token} for good?`, opts.yes);
	query(`DELETE FROM payment_links WHERE token = ${sql(l.token)} AND domain = ${sql(l.domain)}`);
	log.success(`Deleted pay.${l.domain}/${l.token}.`);
}

// ---- commands --------------------------------------------------------------

const yes = () => new Option('-y, --yes', 'do not ask for confirmation');

const program = new Command('db:admin').description(
	'Beneficiaries and payment links in the payments database'
);

const beneficiary = program
	.command('beneficiary')
	.alias('beneficiaries')
	.description('the people or businesses that links pay');
beneficiary.command('list').description('every beneficiary').action(beneficiaryList);
beneficiary
	.command('add')
	.description('add a beneficiary; its id is generated')
	.option('--name <name>', 'the payee name shown on the page and in UPI apps')
	.option('--vpa <upi-id>', 'the UPI ID payments go to')
	.option('--inactive', 'add it inactive')
	.action(beneficiaryAdd);
beneficiary
	.command('edit')
	.description('change a beneficiary')
	.argument('[id]', 'its id, from `beneficiary list`')
	.option('--name <name>', 'a new payee name')
	.option('--vpa <upi-id>', 'a new UPI ID')
	.option('--active', 'make it active')
	.option('--inactive', 'make it inactive')
	.action(beneficiaryEdit);
beneficiary
	.command('deactivate')
	.description('mark a beneficiary inactive')
	.argument('[id]', 'its id, from `beneficiary list`')
	.addOption(yes())
	.action(beneficiaryDeactivate);
beneficiary
	.command('delete')
	.description('delete a beneficiary that has no payment links')
	.argument('[id]', 'its id, from `beneficiary list`')
	.addOption(yes())
	.action(beneficiaryDelete);

const link = program
	.command('link')
	.alias('links')
	.description('payment links: a token on a domain, paying one beneficiary');
link
	.command('list')
	.description('every payment link')
	.option('--domain <domain>', 'only those on this domain')
	.action(linkList);
link
	.command('add')
	.description('add a payment link at pay.<domain>/<token>')
	.argument('[token]', 'the path after the domain')
	.argument('[domain]', 'the domain without "pay.", such as example.com')
	.option('--beneficiary <id>', 'who it pays, by id')
	.option('--amount <rupees>', 'a fixed amount; without it the payer enters one')
	.option('--note <text>', 'the transaction note')
	.option('--inactive', 'add it inactive')
	.action(linkAdd);
link
	.command('edit')
	.description('change a payment link')
	.argument('[token]')
	.argument('[domain]', 'the domain without "pay."')
	.option('--beneficiary <id>', 'pay another beneficiary')
	.option('--amount <rupees>', 'a fixed amount')
	.option('--any-amount', 'let the payer enter the amount')
	.option('--note <text>', 'a new transaction note')
	.option('--no-note', 'remove the transaction note')
	.option('--active', 'make it active')
	.option('--inactive', 'make it inactive, so it answers 404')
	.action(linkEdit);
link
	.command('deactivate')
	.description('make a payment link answer 404')
	.argument('[token]')
	.argument('[domain]', 'the domain without "pay."')
	.addOption(yes())
	.action(linkDeactivate);
link
	.command('delete')
	.description('delete a payment link')
	.argument('[token]')
	.argument('[domain]', 'the domain without "pay."')
	.addOption(yes())
	.action(linkDelete);

// The database options are accepted on every command, before or after it.
const groups = [beneficiary, link];
for (const cmd of [program, ...groups, ...groups.flatMap((g) => g.commands)])
	cmd
		.option('--remote', 'the live database, instead of the local one')
		.option('--database <name>', 'the D1 database (default: $D1_DB_NAME, or payments)')
		.addOption(
			new Option(
				'--persist-to <dir>',
				"where the local database is kept, as wrangler's --persist-to"
			)
		);

program.hook('preAction', (_, action) => {
	const opts = action.optsWithGlobals();
	target.remote = Boolean(opts.remote);
	if (opts.database) target.database = opts.database;
	target.persistTo = opts.persistTo;
	if (target.remote && target.persistTo)
		throw new UsageError('--persist-to is for the local database; it cannot go with --remote.');
});

try {
	await program.parseAsync();
} catch (e) {
	log.error((e as Error).message);
	process.exit(e instanceof UsageError ? 2 : 1);
}
