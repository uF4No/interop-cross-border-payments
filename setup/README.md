# setup

This package wires the 3-chain Prividium setup flow used by the local demo
stack. It bootstraps contract deployment, permissions, OAuth app registration,
and env sync for the A/B/C chain layout.

## Features

- **Service validation**: checks that the Prividium API and the target chain RPC are reachable.
- **Automated authentication**: handles SIWE-based admin auth for setup jobs.
- **3-chain contract deployment**: deploys and registers the SSO stack and app contracts used by the demo flow.
- **Prividium configuration**:
  - registers OAuth applications,
  - registers smart contracts with their ABIs,
  - configures permissions for the deployed contracts,
  - syncs the generated contract addresses back into env files.

## Installation

From the root of the repository:

```bash
pnpm install
```

## Setup & Usage

### 1. Prerequisites

Ensure the 3-chain local stack is running and `setup/.env` points at the
correct chain and API endpoints for the setup job you want to run.

Contract addresses are written to `config/contracts.json` and should not be
edited manually. All `.env` files are derived from this canonical config.

The setup job expects the following values:

- `ADMIN_PRIVATE_KEY`: admin account private key used to authenticate on the Prividium chain and deploy contracts.
- `ADMIN_ADDRESS`: address that corresponds to `ADMIN_PRIVATE_KEY`.
- `PRIVIDIUM_API_URL`: Prividium API base URL, including `/api` (for example `http://localhost:8000/api`).
- `PRIVIDIUM_AUTH_BASE_URL`: Prividium auth service base URL (for example `http://localhost:3001`).
- `PRIVIDIUM_RPC_URL`: ZKsync OS RPC URL for the target chain (for example one of the A/B/C RPC endpoints in `prividium-3chain-local/README.md`).
- `PRIVIDIUM_CHAIN_ID`: chain ID for the target chain.
- `PRIVIDIUM_ENTRYPOINT_ADDRESS`: address of the entrypoint contract on the target chain.
- `PRIVIDIUM_APP_NAME`: name of the app that will be created in Prividium to obtain a client id for the web app.
- `PRIVIDIUM_APP_ORIGIN`: allowed origin for the client id. Should match the host and port where the web app is running.
- `PRIVIDIUM_APP_REDIRECT_URIS`: redirect URIs for the client id. Should match the redirect page of the web app (for example `http://localhost:3002/auth-callback.html`).
- `PRIVIDIUM_APP_CONTRACT_ARTIFACTS`: path to the JSON artifacts of the contracts to be deployed.
- `CONTRACTS_CONFIG_PATH`: path to `config/contracts.json` where all addresses will be saved (default: `../config/contracts.json`).

For the 3-chain flow, use the chain-specific RPC/chain-id pair for the job you
are running:

- A/B: SSO and permissions deployment.
- C: app-side contract deployment and chain-C-specific setup jobs.

### 2. Run the Setup

```bash
cd setup
pnpm run setup
```

The main command now runs the 3-chain setup flow via `setup:3chain`. That flow:

1. Validates connectivity to the API and the selected chain RPC.
2. Authenticates as admin with the configured SIWE account.
3. Deploys and registers the SSO contracts.
4. Deploys and registers the app contracts used by the demo flow.
5. Writes the resulting addresses to `config/contracts.json`.
6. Refreshes the dependent env files from the canonical config.

## Scripts

1. `pnpm setup` - primary 3-chain setup command:
   - Runs the full 3-chain setup flow.
   - Validates API + RPC connectivity.
   - Authenticates as admin.
   - Deploys the SSO and app contracts used by the flow.
   - Writes `config/contracts.json`.
   - Refreshes `backend/.env` and `web-app/.env`.
2. `pnpm setup:3chain` - explicit entrypoint for the same full 3-chain flow.
3. `pnpm setup:permissions` - compatibility alias for the same full 3-chain flow.
4. `pnpm setup:system` - system-only setup:
   - Deploys/ensures SSO contracts (validators, guardian, entrypoint, beacon, factory).
   - Registers contracts and permissions in Prividium.
   - Updates `config/contracts.json` and refreshes env files.
5. `pnpm setup:app` - app-only setup:
   - Deploys the app contract(s) used by the demo flow.
   - Registers contract permissions in Prividium.
   - Updates `config/contracts.json` and refreshes env files.
6. `pnpm setup-app` - registers an OAuth application only:
   - Uses `PRIVIDIUM_APP_NAME`, `PRIVIDIUM_APP_ORIGIN`, `PRIVIDIUM_APP_REDIRECT_URIS`.
   - Prints `id` and `oauthClientId` for reuse in other packages.
7. `pnpm verify:sso` (alias: `pnpm check:contracts`) - verification:
   - Checks on-chain code for SSO contracts.
   - Confirms the SSO contracts are registered and permissions are configured.
8. `pnpm refresh:env` - re-sync `.env` files from `config/contracts.json`.
9. `pnpm typecheck` - TypeScript typecheck for this package.

## Source of Truth

`config/contracts.json` is the single source of truth for contract addresses.
The setup scripts:

- deploy contracts,
- configure permissions,
- update `config/contracts.json`,
- sync `.env` files for backend and web-app.

Expected `config/contracts.json` shape:

```json
{
  "sso": {
    "factory": "0x...",
    "beacon": "0x...",
    "accountImplementation": "0x...",
    "ssoBytecodeHash": "0x...",
    "webauthnValidator": "0x...",
    "eoaValidator": "0x...",
    "sessionValidator": "0x...",
    "guardianExecutor": "0x...",
    "entryPoint": "0x..."
  },
  "interop": {
    "l1InteropHandler": "0x...",
    "l2InteropCenter": "0x..."
  },
  "app": {
    "counter": "0x..."
  }
}
```

Any missing value should be treated as a failed setup result, not as a value to
hand-edit in env files.

Do not edit contract addresses in `.env` files directly.

### 3. Create a Local App (API Only)

This job creates an application using the Prividium API with details configured
in `setup/.env`:

- `PRIVIDIUM_APP_NAME` (defaults to `local-app`)
- `PRIVIDIUM_APP_ORIGIN` (defaults to `http://localhost:3002`)
- `PRIVIDIUM_APP_REDIRECT_URIS` (defaults to `http://localhost:3002/auth-callback.html`)

From the repo root:

```bash
pnpm setup-app
```

Or from this package:

```bash
pnpm setup-app
```

The command prints the created application details, including `id` and
`oauthClientId`, to the terminal for reuse in other packages.

## Extending the Template

This package is built to be adapted. Here is how you can use it for your own
use cases:

### 1. Adding a New Contract

1. Place your Solidity contract in the `contracts/src/` directory.
2. Create a new setup file in `src/setups/` (for example `my-app-setup.ts`).
3. Follow the pattern in `counter-setup.ts`:
   - identify the workspace directories,
   - use `deployAndExtractAddress` to deploy the contract,
   - use `api-client` helpers to register the application, contract, and permissions.

### 2. Customizing Permissions

You can configure complex access rules in your setup file:

```typescript
// Example: Restricting a function to a specific role
await postContractPermissions(adminApiClient, {
  contractAddress: myContractAddress,
  functionSignature: 'secureFunction(uint256)',
  methodSelector: toFunctionSelector('function secureFunction(uint256)'),
  accessType: 'write',
  ruleType: 'checkRole', // Options: 'public', 'checkRole', 'restrictArgument'
  roles: [{ roleName: 'manager' }],
  argumentRestrictions: []
});
```

### 3. Supporting Multiple Apps

In `src/main.ts`, you can add more tasks or logic to iterate through multiple
application directories and configure them separately based on your project
structure.

## Architecture

- `src/main.ts`: the entry point that orchestrates the full 3-chain setup flow.
- `src/tools/api-client.ts`: a lightweight, fetch-based client for the Prividium Admin API.
- `src/tools/deploy.ts`: wrapper for Foundry deployment scripts.
- `src/tools/config-tools.ts`: utilities for reading and writing `.env` files.
- `src/setups/`: contains logic specific to individual applications or demos.

## Troubleshooting

- **Connectivity**: ensure the URLs in `setup/.env` are reachable from this package.
- **Admin auth**: the setup uses a default admin private key. Ensure this key corresponds to an admin in your Prividium instance.
- **Foundry**: contract deployment requires `forge` to be installed and available in your `PATH`.
- **ABI extraction**: ensure your contracts are compiled (`forge build`) so the ABI is available in the `out/` directory.
