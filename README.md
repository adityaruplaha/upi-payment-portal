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

An interactive CLI for managing D1 data remotely via Wrangler. Always writes to the remote database (`--remote`). Requires `wrangler` to be authenticated.

```sh
bun run db:admin
```

Available commands (all interactive, with prompts):

| Command | Description |
|---|---|
| `list-beneficiaries` | List all beneficiaries |
| `add-beneficiary` | Add a new UPI payee |
| `edit-beneficiary` | Edit an existing payee |
| `delete-beneficiary` | Deactivate a payee |
| `list-payment-links` | List all payment links |
| `add-payment-link` | Create a new token → payee mapping |
| `edit-payment-link` | Edit an existing payment link |
| `delete-payment-link` | Deactivate a payment link |

Override the D1 database name (default: `payments`) with the `D1_DB_NAME` environment variable.

## Dev

```sh
bun install
bun run dev
```

To bootstrap the D1 schema on a new database:

```sh
wrangler d1 execute payments --file=db_schema.sql --remote
```

Deploy with `bun run deploy` (via Wrangler).
