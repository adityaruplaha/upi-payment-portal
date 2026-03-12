#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { cancel, confirm, intro, isCancel, log, outro, select, text } from '@clack/prompts';
import { ulid } from 'ulid';
import chalk from 'chalk';

const DATABASE_NAME = process.env.D1_DB_NAME ?? 'payments';

function printUsage() {
	console.log(`
D1 admin helper (remote writes only, interactive only)

Usage:
	bun run db:admin <command>

Commands (all interactive):
	list-beneficiaries
	add-beneficiary
	edit-beneficiary
	delete-beneficiary
	list-payment-links
	add-payment-link
	edit-payment-link
	delete-payment-link

Examples:
	bun run db:admin
	bun run db:admin list-beneficiaries
	bun run db:admin add-beneficiary
	bun run db:admin list-payment-links

Notes:
	- Beneficiary IDs are always generated as ULID values.
	- This script always writes to remote D1 using --remote.
	- Override database name with D1_DB_NAME if needed.
`);
}

function sqlString(value) {
	return `'${String(value).replace(/'/g, "''")}'`;
}

function sqlNullableString(value) {
	if (value === undefined || value === null || value === '') {
		return 'NULL';
	}
	return sqlString(value);
}

function sqlNumber(value) {
	if (value === undefined || value === null || value === '') {
		return 'NULL';
	}
	const num = Number(value);
	if (!Number.isFinite(num)) {
		throw new Error(`Invalid number: ${value}`);
	}
	return String(num);
}

function executeWrangler(sql, expectJson = false) {
	const args = ['d1', 'execute', DATABASE_NAME, '--remote', '--command', sql];
	if (expectJson) {
		args.push('--json');
	}

	let result = spawnSync('wrangler', args, {
		encoding: 'utf8',
		stdio: ['inherit', 'pipe', 'pipe']
	});

	if (result.error && result.error.code === 'ENOENT') {
		result = spawnSync('bunx', ['wrangler', ...args], {
			encoding: 'utf8',
			stdio: ['inherit', 'pipe', 'pipe']
		});
	}

	if (result.error) {
		throw result.error;
	}

	if (typeof result.status === 'number' && result.status !== 0) {
		const stderr = (result.stderr ?? '').trim();
		const stdout = (result.stdout ?? '').trim();
		const details = [stderr, stdout].filter(Boolean).join('\n');
		throw new Error(details || `wrangler command failed with exit code ${result.status}`);
	}

	const stderr = (result.stderr ?? '').trim();
	if (stderr) {
		console.error(stderr);
	}

	return (result.stdout ?? '').trim();
}

function runWriteSql(sql) {
	executeWrangler(sql, false);
}

function extractRowsFromWranglerJson(payload) {
	if (Array.isArray(payload)) {
		for (const item of payload) {
			if (Array.isArray(item?.results)) {
				return item.results;
			}
			if (Array.isArray(item?.result?.[0]?.results)) {
				return item.result[0].results;
			}
		}
	}

	if (Array.isArray(payload?.results)) {
		return payload.results;
	}

	if (Array.isArray(payload?.result?.[0]?.results)) {
		return payload.result[0].results;
	}

	return [];
}

function runSelectSql(sql) {
	const outputText = executeWrangler(sql, true);
	if (!outputText) {
		return [];
	}

	let parsed;
	try {
		parsed = JSON.parse(outputText);
	} catch {
		throw new Error(`Could not parse wrangler JSON output: ${outputText}`);
	}

	return extractRowsFromWranglerJson(parsed);
}

function resolvePromptValue(value) {
	if (isCancel(value)) {
		cancel('Operation cancelled.');
		process.exit(0);
	}
	return value;
}

async function promptText(label, defaultValue) {
	const value = resolvePromptValue(
		await text({
			message: label,
			initialValue: defaultValue
		})
	);

	return String(value).trim();
}

async function promptRequiredText(label, defaultValue) {
	const value = resolvePromptValue(
		await text({
			message: label,
			initialValue: defaultValue,
			validate: (inputText) => {
				if (!String(inputText).trim()) {
					return 'This field is required.';
				}
			}
		})
	);

	return String(value).trim();
}

async function promptOptionalNumber(label, defaultValue) {
	const value = resolvePromptValue(
		await text({
			message: label,
			initialValue: defaultValue,
			placeholder: 'Leave blank for NULL',
			validate: (inputText) => {
				const trimmed = String(inputText).trim();
				if (!trimmed) {
					return;
				}
				if (!Number.isFinite(Number(trimmed))) {
					return 'Please enter a valid number or leave blank.';
				}
			}
		})
	);

	const trimmed = String(value).trim();
	if (!trimmed) {
		return undefined;
	}

	return Number(trimmed);
}

async function promptActive(defaultValue = 1) {
	const value = resolvePromptValue(
		await select({
			message: 'Status',
			options: [
				{ label: 'Active', value: 1 },
				{ label: 'Inactive', value: 0 }
			],
			initialValue: defaultValue === 0 ? 0 : 1
		})
	);

	return Number(value);
}

async function promptYesNo(label, defaultYes = false) {
	const value = resolvePromptValue(
		await confirm({
			message: label,
			initialValue: defaultYes
		})
	);

	return Boolean(value);
}

async function chooseFromList(items, labelForItem, title) {
	if (items.length === 0) {
		return undefined;
	}

	const selectedIndex = resolvePromptValue(
		await select({
			message: title || 'Choose an option',
			options: items.map((item, idx) => ({
				label: labelForItem(item, idx),
				value: idx
			}))
		})
	);

	return items[Number(selectedIndex)];
}

function beneficiaryLabel(b) {
	return `${b.id} | ${b.payee_name} | ${b.vpa} | active=${b.is_active}`;
}

function paymentLinkLabel(link) {
	return `${link.token}@${link.domain} | beneficiary=${link.beneficiary_id} | amount=${link.amount ?? 'NULL'} | active=${link.is_active}`;
}

function getVisibleLength(str) {
	return String(str).replace(/\x1b\[[0-9;]*m/g, '').length;
}

function padColoredString(str, width) {
	const visibleLen = getVisibleLength(str);
	const padding = Math.max(0, width - visibleLen);
	return String(str) + ' '.repeat(padding);
}

function formatBeneficiariesTable(beneficiaries) {
	if (beneficiaries.length === 0) {
		return chalk.yellow('No beneficiaries found.');
	}

	const rawRows = beneficiaries.map((b) => [b.id, b.payee_name, b.vpa, b.is_active ? '✓' : '✗']);
	const coloredRows = beneficiaries.map((b) => [
		chalk.cyan(b.id),
		chalk.green(b.payee_name),
		chalk.blue(b.vpa),
		b.is_active ? chalk.green('✓') : chalk.red('✗')
	]);

	const headers = ['ID', 'Payee Name', 'VPA', 'Active'];
	const coloredHeaders = headers.map((h) => chalk.bold.white(h));

	const colWidths = [
		Math.max(headers[0].length, ...rawRows.map((r) => getVisibleLength(r[0]))),
		Math.max(headers[1].length, ...rawRows.map((r) => getVisibleLength(r[1]))),
		Math.max(headers[2].length, ...rawRows.map((r) => getVisibleLength(r[2]))),
		Math.max(headers[3].length, ...rawRows.map((r) => getVisibleLength(r[3])))
	];

	const lines = [
		coloredHeaders.map((h, i) => padColoredString(h, colWidths[i])).join('  '),
		colWidths.map((w) => '─'.repeat(w)).join('  ')
	];

	for (const row of coloredRows) {
		lines.push(row.map((cell, i) => padColoredString(cell, colWidths[i])).join('  '));
	}

	return lines.join('\n');
}

function formatPaymentLinksTable(links) {
	if (links.length === 0) {
		return chalk.yellow('No payment links found.');
	}

	const rawRows = links.map((link) => [
		link.token,
		link.domain,
		link.beneficiary_id,
		link.amount !== null && link.amount !== undefined ? String(link.amount) : 'NULL',
		link.is_active ? '✓' : '✗'
	]);

	const coloredRows = links.map((link) => [
		chalk.cyan(link.token),
		chalk.green(link.domain),
		chalk.blue(link.beneficiary_id),
		link.amount !== null && link.amount !== undefined
			? chalk.magenta(String(link.amount))
			: chalk.gray('NULL'),
		link.is_active ? chalk.green('✓') : chalk.red('✗')
	]);

	const headers = ['Token', 'Domain', 'Beneficiary ID', 'Amount', 'Active'];
	const coloredHeaders = headers.map((h) => chalk.bold.white(h));

	const colWidths = [
		Math.max(headers[0].length, ...rawRows.map((r) => getVisibleLength(r[0]))),
		Math.max(headers[1].length, ...rawRows.map((r) => getVisibleLength(r[1]))),
		Math.max(headers[2].length, ...rawRows.map((r) => getVisibleLength(r[2]))),
		Math.max(headers[3].length, ...rawRows.map((r) => getVisibleLength(r[3]))),
		Math.max(headers[4].length, ...rawRows.map((r) => getVisibleLength(r[4])))
	];

	const lines = [
		coloredHeaders.map((h, i) => padColoredString(h, colWidths[i])).join('  '),
		colWidths.map((w) => '─'.repeat(w)).join('  ')
	];

	for (const row of coloredRows) {
		lines.push(row.map((cell, i) => padColoredString(cell, colWidths[i])).join('  '));
	}

	return lines.join('\n');
}

function getBeneficiaries() {
	return runSelectSql(
		'SELECT id, payee_name, vpa, is_active FROM beneficiaries ORDER BY created_at DESC, id DESC;'
	);
}

function getPaymentLinks() {
	return runSelectSql(
		'SELECT token, domain, beneficiary_id, amount, transaction_note, is_active FROM payment_links ORDER BY token ASC, domain ASC;'
	);
}

function ensureBeneficiariesOrExit() {
	const beneficiaries = getBeneficiaries();
	if (beneficiaries.length === 0) {
		outro('No beneficiaries found. Add a beneficiary first, then create or edit payment links.');
		process.exit(0);
	}
	return beneficiaries;
}

async function interactiveAddBeneficiary() {
	const id = ulid();
	const payeeName = await promptRequiredText('Payee name');
	const vpa = await promptRequiredText('UPI VPA');
	const active = await promptActive(1);

	const sql = `INSERT INTO beneficiaries (id, payee_name, vpa, is_active) VALUES (${sqlString(id)}, ${sqlString(payeeName)}, ${sqlString(vpa)}, ${active});`;
	runWriteSql(sql);
	log.success(`Created beneficiary with ULID ${id}`);
}

async function interactiveEditBeneficiary() {
	const beneficiaries = getBeneficiaries();
	if (beneficiaries.length === 0) {
		log.warn('No beneficiaries found to edit.');
		return;
	}

	const beneficiary = await chooseFromList(beneficiaries, beneficiaryLabel, 'Beneficiaries');
	const payeeName = await promptRequiredText('Payee name', beneficiary.payee_name);
	const vpa = await promptRequiredText('UPI VPA', beneficiary.vpa);
	const active = await promptActive(Number(beneficiary.is_active ?? 1));

	const sql = `UPDATE beneficiaries SET payee_name = ${sqlString(payeeName)}, vpa = ${sqlString(vpa)}, is_active = ${active} WHERE id = ${sqlString(beneficiary.id)};`;
	runWriteSql(sql);
	log.success(`Updated beneficiary ${beneficiary.id}`);
}

async function interactiveDeleteBeneficiary() {
	const beneficiaries = getBeneficiaries();
	if (beneficiaries.length === 0) {
		log.warn('No beneficiaries found to delete.');
		return;
	}

	const beneficiary = await chooseFromList(beneficiaries, beneficiaryLabel, 'Beneficiaries');
	const confirmed = await promptYesNo(`Delete beneficiary ${beneficiary.id}?`, false);
	if (!confirmed) {
		log.info('Delete cancelled.');
		return;
	}

	runWriteSql(`DELETE FROM beneficiaries WHERE id = ${sqlString(beneficiary.id)};`);
	log.success(`Deleted beneficiary ${beneficiary.id}`);
}

async function pickBeneficiaryForPaymentLinks() {
	const beneficiaries = ensureBeneficiariesOrExit();
	return chooseFromList(beneficiaries, beneficiaryLabel, 'Beneficiaries');
}

async function interactiveAddPaymentLink() {
	const beneficiary = await pickBeneficiaryForPaymentLinks();
	const token = await promptRequiredText('Token');
	const domain = await promptRequiredText('Domain');
	const amount = await promptOptionalNumber('Amount (leave blank for NULL)');
	const note = await promptText('Transaction note (leave blank for NULL)');
	const active = await promptActive(1);

	const sql = `INSERT INTO payment_links (token, domain, beneficiary_id, amount, transaction_note, is_active) VALUES (${sqlString(token)}, ${sqlString(domain)}, ${sqlString(beneficiary.id)}, ${amount === undefined ? 'NULL' : String(amount)}, ${sqlNullableString(note)}, ${active});`;
	runWriteSql(sql);
	log.success(`Created payment link ${token}@${domain}`);
}

async function interactiveEditPaymentLink() {
	const links = getPaymentLinks();
	if (links.length === 0) {
		log.warn('No payment links found to edit.');
		return;
	}

	const link = await chooseFromList(links, paymentLinkLabel, 'Payment links');
	const changeBeneficiary = await promptYesNo('Change beneficiary?', false);
	let beneficiaryId = link.beneficiary_id;
	if (changeBeneficiary) {
		const beneficiary = await pickBeneficiaryForPaymentLinks();
		beneficiaryId = beneficiary.id;
	}

	const amountDefault =
		link.amount === null || link.amount === undefined ? '' : String(link.amount);
	const amountInput = await promptText('Amount (leave blank for NULL)', amountDefault);
	const noteDefault = link.transaction_note ?? '';
	const noteInput = await promptText('Transaction note (leave blank for NULL)', noteDefault);
	const active = await promptActive(Number(link.is_active ?? 1));

	const sql = `UPDATE payment_links SET beneficiary_id = ${sqlString(beneficiaryId)}, amount = ${amountInput === '' ? 'NULL' : sqlNumber(amountInput)}, transaction_note = ${sqlNullableString(noteInput)}, is_active = ${active} WHERE token = ${sqlString(link.token)} AND domain = ${sqlString(link.domain)};`;
	runWriteSql(sql);
	log.success(`Updated payment link ${link.token}@${link.domain}`);
}

async function interactiveDeletePaymentLink() {
	const links = getPaymentLinks();
	if (links.length === 0) {
		log.warn('No payment links found to delete.');
		return;
	}

	const link = await chooseFromList(links, paymentLinkLabel, 'Payment links');
	const confirmed = await promptYesNo(`Delete payment link ${link.token}@${link.domain}?`, false);
	if (!confirmed) {
		log.info('Delete cancelled.');
		return;
	}

	runWriteSql(
		`DELETE FROM payment_links WHERE token = ${sqlString(link.token)} AND domain = ${sqlString(link.domain)};`
	);
	log.success(`Deleted payment link ${link.token}@${link.domain}`);
}

async function interactiveListBeneficiaries() {
	console.log();
	const beneficiaries = getBeneficiaries();
	console.log(formatBeneficiariesTable(beneficiaries));
	console.log();
}

async function interactiveListPaymentLinks() {
	console.log();
	const links = getPaymentLinks();
	console.log(formatPaymentLinksTable(links));
	console.log();
}

async function runInteractive() {
	intro('Laha Payment DB Admin');

	while (true) {
		const action = resolvePromptValue(
			await select({
				message: 'What would you like to do?',
				options: [
					{ label: 'List beneficiaries', value: 'list-beneficiaries' },
					{ label: 'Add beneficiary', value: 'add-beneficiary' },
					{ label: 'Edit beneficiary', value: 'edit-beneficiary' },
					{ label: 'Delete beneficiary', value: 'delete-beneficiary' },
					{ label: 'List payment links', value: 'list-payment-links' },
					{ label: 'Add payment link', value: 'add-payment-link' },
					{ label: 'Edit payment link', value: 'edit-payment-link' },
					{ label: 'Delete payment link', value: 'delete-payment-link' },
					{ label: 'Exit', value: 'exit' }
				]
			})
		);

		if (action === 'list-beneficiaries') {
			await interactiveListBeneficiaries();
		}
		if (action === 'add-beneficiary') {
			await interactiveAddBeneficiary();
		}
		if (action === 'edit-beneficiary') {
			await interactiveEditBeneficiary();
		}
		if (action === 'delete-beneficiary') {
			await interactiveDeleteBeneficiary();
		}
		if (action === 'list-payment-links') {
			await interactiveListPaymentLinks();
		}
		if (action === 'add-payment-link') {
			await interactiveAddPaymentLink();
		}
		if (action === 'edit-payment-link') {
			await interactiveEditPaymentLink();
		}
		if (action === 'delete-payment-link') {
			await interactiveDeletePaymentLink();
		}

		if (action === 'exit') {
			outro('Goodbye.');
			return;
		}

		const runAnother = await promptYesNo('Run another admin action?', true);
		if (!runAnother) {
			outro('Goodbye.');
			return;
		}
	}
}

async function runInteractiveCommand(command) {
	if (command === 'list-beneficiaries') {
		await interactiveListBeneficiaries();
		return;
	}
	if (command === 'add-beneficiary') {
		await interactiveAddBeneficiary();
		return;
	}
	if (command === 'edit-beneficiary') {
		await interactiveEditBeneficiary();
		return;
	}
	if (command === 'delete-beneficiary') {
		await interactiveDeleteBeneficiary();
		return;
	}
	if (command === 'list-payment-links') {
		await interactiveListPaymentLinks();
		return;
	}
	if (command === 'add-payment-link') {
		await interactiveAddPaymentLink();
		return;
	}
	if (command === 'edit-payment-link') {
		await interactiveEditPaymentLink();
		return;
	}
	if (command === 'delete-payment-link') {
		await interactiveDeletePaymentLink();
		return;
	}

	throw new Error(`Unsupported command: ${command}`);
}

async function main() {
	const [command, ...rest] = process.argv.slice(2);

	if (!command || command === 'interactive') {
		await runInteractive();
		return;
	}

	if (command === 'help' || command === '--help' || command === '-h') {
		printUsage();
		return;
	}

	if (rest.length > 0) {
		throw new Error('Flags or extra arguments are not supported. Use interactive prompts only.');
	}

	await runInteractiveCommand(command);
}

try {
	await main();
} catch (err) {
	cancel(`Error: ${err instanceof Error ? err.message : String(err)}`);
	printUsage();
	process.exit(1);
}
