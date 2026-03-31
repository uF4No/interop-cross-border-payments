# Web application

This package contains the user-facing frontend for the cross-chain invoicing application.

From the user’s perspective, the application supports the following workflow:

- sign in to a Prividium environment,
- register or select a passkey-based smart account,
- view the linked wallet and available balances on the active chain,
- create invoices that are submitted from chain A or B and created on chain C,
- review invoice status in the dashboard,
- retrieve available payment options for a specific invoice,
- pay eligible invoices from the recipient chain,
- follow transaction progress while interop execution and settlement complete.

In normal usage, the application is started from the repository root.

## Primary command

Run the web application from the repository root:

```bash
pnpm dev:web-app
```

## User experience

The frontend is designed around the end-user journey rather than low-level blockchain operations. It guides the user through authentication, smart-account setup, invoice creation, invoice payment, and transaction tracking without requiring the user to interact with raw RPC calls or contract methods directly.

The application relies on the [backend service](../backend/README.md) for account deployment, invoice reads, and payment-option lookups, and it uses the generated contract configuration produced by the [setup script](../setup/README.md).

## Configuration

The web application reads generated contract and environment configuration from:

- `web-app/.env`

Contract addresses and related runtime values are refreshed by the setup tooling. They should not be edited manually when they originate from the generated project configuration.

Branding can be adjusted through the environment variables in `web-app/.env`, including:

- `VITE_COMPANY_NAME`
- `VITE_ACCENT_COLOR`
- `VITE_COMPANY_ICON`

## Available scripts

### Root-level commands

- `pnpm dev:web-app`  
  Starts the web application development server from the repository root.

### Package-level commands

These commands can be run from the `web-app/` directory when you need to work with the frontend directly.

- `pnpm dev`  
  Starts the development server on port `5000`.

- `pnpm build`  
  Runs type-checking and builds the production bundle.

- `pnpm build-only`  
  Builds the production bundle without running type-checking.

- `pnpm preview`  
  Serves the production build locally for verification.

- `pnpm typecheck`  
  Runs TypeScript and Vue type-checking.

- `pnpm lint`  
  Runs Biome linting for this package.

- `pnpm format`  
  Formats the package with Biome.

- `pnpm check`  
  Runs Biome checks for this package.
