# upi-payment-portal

A minimal UPI payment portal intended to serve `pay.example.com`-style domains. Given a token in the URL, it looks up a UPI payment link in the database and redirects the user to the appropriate UPI intent. Majorly written using GitHub Copilot, with some manual adjustments.

## Architecture

**Runtime:** SvelteKit on Cloudflare Workers, using [adapter-cloudflare](https://kit.svelte.dev/docs/adapter-cloudflare).

**Database:** Cloudflare D1 (SQLite). Two tables:

- `beneficiaries` — UPI payees (`id`, `payee_name`, `vpa`, `is_active`)
- `payment_links` — tokens scoped to a domain, pointing to a beneficiary with an optional amount and note (`token`, `domain`, `beneficiary_id`, `amount`, `transaction_note`, `is_active`)

**Request flow:** `pay.example.com/<token>` → `[token]/+page.server.ts` loads the matching payment link from D1 → the page renders a UPI QR code and deep-link button (client-side only — `upi-intents` crashes on SSR) for the user to tap.

**Domain matching:** the `domain` column stores the *base* domain (e.g. `example.com`), not the `pay.` subdomain. The server strips the `pay.` prefix from the hostname before querying, so make sure to store `example.com` when adding payment links, not `pay.example.com`.

The server routes are **read-only**. All writes go through the `db:admin` script.

## db:admin

A CLI for managing beneficiaries and payment links, run through Wrangler.

```sh
bun run db:admin --help
bun run db:admin link add fixed example.com --beneficiary <id> --amount 500 --note "Class fee"
```

It works on the local database that `bun run dev` uses, and on the live one with `--remote`, which requires `wrangler` to be authenticated. In a terminal, anything left out is asked for; elsewhere every value must be given, with `--yes` to confirm deactivating or deleting.

| Command | Description |
|---|---|
| `beneficiary list` | List all beneficiaries |
| `beneficiary add` | Add a UPI payee; its ID is a generated ULID |
| `beneficiary edit` | Change a payee's name, UPI ID, or status |
| `beneficiary deactivate` | Mark a payee inactive |
| `beneficiary delete` | Delete a payee that has no payment links |
| `link list` | List all payment links, or those on one `--domain` |
| `link add` | Create a token → payee mapping on a domain |
| `link edit` | Change a payment link's payee, amount, note, or status |
| `link deactivate` | Make a payment link answer 404 |
| `link delete` | Delete a payment link |

Deactivating a payee does not stop its payment links; deactivate those too.

Override the D1 database name (default: `payments`) with `--database` or the `D1_DB_NAME` environment variable.

## Dev

```sh
bun install
bun run dev
```

Run the tests with `bun run test`.

To bootstrap the D1 schema on a new database:

```sh
wrangler d1 execute payments --file=db_schema.sql --remote
```

Deploy with `bun run deploy` (via Wrangler).
