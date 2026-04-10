# Backend server

This package provides the backend service for the cross-border payments application. It exposes account deployment, interop, funding, and payment-request APIs used by the web application, and it also runs background workers that process pending interop transactions and deferred creator payouts.

In normal usage, the service is started from the repository root.

## Primary command

Run the backend service from the repository root:

```bash
pnpm dev:backend
```

## Runtime logs

The backend writes logs both to the terminal and to persistent files in:

- `backend/.runtime/`

Current behavior:

- active log file: `backend/.runtime/backend.log`
- rotated files: `backend/.runtime/backend.1.log` through `backend/.runtime/backend.4.log`
- rotation threshold: 5 MiB per file
- retention: 4 archived files plus the current active file

These files are gitignored. Each backend start writes a short session banner with the timestamp and PID so it is easier to separate runs when reading the log file later.

This logging captures the normal backend stdout/stderr stream, which includes:

- startup and shutdown messages
- request logs
- worker errors and other runtime exceptions
- any direct `console` output emitted by the process or libraries

## API endpoints

- `GET /health-check`  
  Returns a successful response when the service is healthy.

- `POST /deploy-account`  
  Deploys a new SSO smart account for a passkey-backed user, applies the required permissions, and links the wallet to the Prividium user profile.

- `POST /userops/direct-handle-ops`  
  Submits a direct `handleOps` execution request for a UserOperation on a target chain.

- `POST /faucet`  
  Funds the target account and related operational addresses when balances fall below the configured minimum. This is intended for local or test environments.

- `POST /fund-tokens`  
  Queues token minting and funding for a target account on chain `A` or `B`.

- `GET /fund-tokens/:jobId`  
  Returns the current status of a queued or running token-funding job.

- `POST /status`  
  Returns the finalization status of recent L2 to L1 transactions for a given account.

- `POST /new-l1-interop-tx`  
  Registers a new interop transaction so it can be tracked and finalized by the background worker.

- `GET /invoices`  
  Returns normalized invoice data from the chain C `InvoicePayment` contract for the configured admin user.

- `POST /invoices`  
  Returns the same invoice snapshot payload as `GET /invoices`, using a POST entrypoint for clients that prefer request bodies.

- `GET /invoices/:invoiceId/payment-options`  
  Returns the available payment-token options and payment quote information for a specific invoice.

## Background processing

When the backend starts, it also runs background workers that:

- process queued interop transactions,
- finalize transactions once they are fully executed,
- process deferred creator payouts.

## Configuration

This service reads generated contract addresses from:

- `config/contracts.json`

The path is provided via `CONTRACTS_CONFIG_PATH`. Contract addresses should not be edited manually in `backend/.env`; they are refreshed by the setup tooling.

The backend also depends on the local `backend/.env` file for runtime configuration such as RPC URLs, API URLs, executor credentials, SIWE settings, and rate-limit / polling settings.

## Available scripts

### Root-level commands

- `pnpm dev:backend`  
  Starts the backend service in watch mode from the repository root.

### Package-level commands

These commands can be run from the `backend/` directory when you need to work with the service directly.

- `pnpm dev`  
  Starts the backend in watch mode.

- `pnpm build`  
  Builds the production bundle.

- `pnpm start`  
  Starts the built server from `dist/`.

- `pnpm smoke:invoices`  
  Runs the invoice smoke test.

- `pnpm smoke:deploy-account`  
  Runs the deploy-account smoke test.

- `pnpm smoke`  
  Runs the available smoke tests in sequence.
