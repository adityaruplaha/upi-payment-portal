# sv

Everything you need to build a Svelte project, powered by [`sv`](https://github.com/sveltejs/cli).

## Creating a project

If you're seeing this, you've probably already done this step. Congrats!

```sh
# create a new project
npx sv create my-app
```

To recreate this project with the same configuration:

```sh
# recreate this project
bun x sv@0.12.5 create --template minimal --types ts --add prettier eslint --install bun laha-payment-portal
```

## Developing

Once you've created a project and installed dependencies with `npm install` (or `pnpm install` or `yarn`), start a development server:

```sh
npm run dev

# or start the server and open the app in a new browser tab
npm run dev -- --open
```

## Building

To create a production version of your app:

```sh
npm run build
```

You can preview the production build with `npm run preview`.

> To deploy your app, you may need to install an [adapter](https://svelte.dev/docs/kit/adapters) for your target environment.

## D1 Admin Writes (Remote Only)

Write operations are done through a helper script and Wrangler, not through Svelte routes.

Run help:

```sh
bun run db:admin-help
```

Insert a beneficiary:

```sh
bun run db:add-beneficiary -- --id=ben_001 --payee-name="Laha Stores" --vpa=laha@upi
```

Insert a payment link:

```sh
bun run db:add-payment-link -- --token=abc123 --domain=pay.example.com --beneficiary-id=ben_001 --amount=499 --transaction-note="Order 42"
```

Notes:

- The script always uses `wrangler d1 execute <db> --remote`.
- Override the default DB name (`payments`) with `D1_DB_NAME=<name>`.
- Keep Svelte server code read-only (SELECT queries only).
