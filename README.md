# upi-payment-portal

A minimal UPI payment portal intended to serve `pay.example.com`-style domains. Given a token in the URL, it looks up a UPI payment link in the database and shows a page for paying it with any UPI app. Majorly written using GitHub Copilot, with some manual adjustments.

## Architecture

**Runtime:** SvelteKit 3 on Cloudflare Workers, using [adapter-cloudflare](https://svelte.dev/docs/kit/adapter-cloudflare). Worker bindings come from `cloudflare:workers`, and their types from `wrangler types` (`bun run gen` after changing `wrangler.jsonc`).

**Database:** Cloudflare D1 (SQLite). Two tables:

- `beneficiaries` — UPI payees (`id`, `payee_name`, `vpa`, `is_active`)
- `payment_links` — tokens scoped to a domain, pointing to a beneficiary with an optional amount and note (`token`, `domain`, `beneficiary_id`, `amount`, `transaction_note`, `is_active`)

**Request flow:** `pay.example.com/<token>` → `[token]/+page.server.ts` loads the matching payment link from D1 → the page shows a QR code and a "Pay by any UPI app" button, both carrying the same `upi://pay` link built in `src/lib/upi.ts`. The button opens a UPI app only on phones, so a desktop gets the QR code alone.

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

Deactivating a payee stops its payment links too, which then answer 404.

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

To try the built Worker as it runs live, with a throwaway local database:

```sh
bun run build
bun run preview --persist-to <folder>
```

The domain a link is looked up under is the request's hostname without `pay.`, so a row whose `domain` is `localhost` opens at `http://localhost:8787/<token>`. `db:admin` accepts only real domains, so add such a row with `bunx wrangler d1 execute payments --local --persist-to <folder> --command "INSERT …"`.

A push to `main` deploys it through GitHub Actions (`.github/workflows/deploy.yml`), after the tests, the type-check and the build pass, and then checks that both hostnames answer; it needs the repository secret `CLOUDFLARE_API_TOKEN`. `bun run deploy` builds and deploys by hand. The hostnames `pay.adityaruplaha.me` and `pay.arl.dance` are attached to the Worker as custom domains in Cloudflare rather than in `wrangler.jsonc`, since `wrangler dev` sends every request to the first route's hostname when routes are declared.
