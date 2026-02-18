# setup

This package provides a template for automating the deployment and configuration of smart contracts and OAuth applications within the Prividium™ ecosystem. 

It is designed to be easily extendable, allowing you to quickly bootstrap setup scripts for your own demos and production applications.

## Features

- **Service Validation**: Checks that Prividium API and ZKsync OS (chain) are up and running.
- **Automated Authentication**: Handles SIWE-based crypto-native authentication for admin tasks.
- **Contract Deployment**: Deploys smart contracts using Foundry (`forge`).
- **Prividium Configuration**: 
  - Registers OAuth applications.
  - Registers smart contracts with their ABIs.
  - Configures granular permissions (public, role-based, argument-restricted).
- **Environment Management**: Automatically updates `.env` files in your web applications with generated values (contract addresses, client IDs).

## Installation

From the root of the repository:

```bash
pnpm install
```

## Setup & Usage

### 1. Prerequisites

Ensure your Prividium environment is running and configured in `setup/.env`.
Contract addresses are written to `config/contracts.json` and should not be edited manually. 
All `.env` files are derived from this canonical config.

- **ADMIN_PRIVATE_KEY**: Admin account private key used to authenticate on the Prividium chain and deploy contracts.
- **ADMIN_ADDRESS**: Address that corresponds to `ADMIN_PRIVATE_KEY`.
- **PRIVIDIUM_API_URL**: Prividium API base URL (include `/api`, e.g. `http://localhost:8000/api`).
- **PRIVIDIUM_AUTH_BASE_URL**: Prividium Auth service base URL (e.g. `http://localhost:3001`).
- **PRIVIDIUM_RPC_URL**: ZKsync OS RPC URL (e.g. `http://localhost:8000/rpc`).
- **PRIVIDIUM_CHAIN_ID**: Chain ID for the target Prividium chain.
- **PRIVIDIUM_ENTRYPOINT_ADDRESS**: Address of the entrypoint contract on the Prividium chain.
- **PRIVIDIUM_APP_NAME**: Name of the app that will be created in the Prividium system to obtain a client id for the web-app.
- **PRIVIDIUM_APP_ORIGIN**: Allowed origin for the client id. Should match the host and port where the web-app is running.
- **PRIVIDIUM_APP_REDIRECT_URIS**: Redirect URIs for the client id. Should match the redirect page of the web-app (e.g. http://localhost:3002/auth-callback.html)
- **PRIVIDIUM_APP_CONTRACT_ARTIFACTS**: Path to the json artifacts of the contracts to be deployed. 
- **CONTRACTS_CONFIG_PATH**: Path to `config/contracts.json` where all addresses will be saved (default: `../config/contracts.json`).

### 2. Run the Setup

```bash
cd setup
pnpm run setup
```

This script will execute the flow defined in `src/main.ts`, which by default:
1. Validates connectivity to the chain and API.
2. Authenticates as an admin.
3. Deploys system contracts (SSO) and app contracts (Counter), then configures permissions.

## Scripts
1. `pnpm setup` — full setup flow (system + app):
   - Validates API + RPC connectivity.
   - Authenticates as admin.
   - Deploys SSO contracts if missing and registers them.
   - Deploys the Counter app contract, registers it, and configures permissions.
   - Writes `config/contracts.json` and refreshes `backend/.env` + `web-app/.env`.
2. `pnpm setup:system` — system-only setup (SSO contracts + permissions):
   - Deploys/ensures SSO contracts (validators, guardian, entrypoint, beacon, factory).
   - Registers contracts + permissions in Prividium.
   - Updates `config/contracts.json` and refreshes env files.
3. `pnpm setup:app` — app-only setup (Counter):
   - Deploys Counter contract.
   - Registers contract + permissions in Prividium.
   - Updates `config/contracts.json` and refreshes env files.
4. `pnpm setup-app` — registers an OAuth application only:
   - Uses `PRIVIDIUM_APP_NAME`, `PRIVIDIUM_APP_ORIGIN`, `PRIVIDIUM_APP_REDIRECT_URIS`.
   - Prints `id` and `oauthClientId` for reuse in other packages.
5. `pnpm verify:sso` (alias: `pnpm check:contracts`) — verification:
   - Checks on-chain code for SSO contracts.
   - Confirms all SSO contracts are registered and permissions are configured.
   - Verifies Counter permissions.
6. `pnpm refresh:env` — re-sync `.env` files from `config/contracts.json`.
7. `pnpm typecheck` — TypeScript typecheck for this package.

## Source of Truth

`config/contracts.json` is the single source of truth for contract addresses.
The setup scripts:
- deploy contracts
- configure permissions
- update `config/contracts.json`
- sync `.env` files for backend and web-app

Do not edit contract addresses in `.env` files directly.

### 3. Create a Local App (API Only)

This job creates an application using the Prividium API with details configured in `setup/.env`:

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

The command prints the created application details (including `id` and `oauthClientId`) to the terminal for reuse in other packages.

## Extending the Template

This package is built to be adapted. Here is how you can use it for your own use cases:

### 1. Adding a New Contract

1. Place your Solidity contract in the `contracts/src/` directory.
2. Create a new setup file in `src/setups/` (e.g., `my-app-setup.ts`).
3. Follow the pattern in `counter-setup.ts`:
   - Identify the workspace directories.
   - Use `deployAndExtractAddress` to deploy the contract.
   - Use `api-client` helpers to register the application, contract, and permissions.

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

In `src/main.ts`, you can add more tasks or logic to iterate through multiple application directories and configure them separately based on your project structure.

## Architecture

- `src/main.ts`: The entry point that orchestrates the setup flow.
- `src/tools/api-client.ts`: A lightweight, fetch-based client for the Prividium Admin API.
- `src/tools/deploy.ts`: Wrapper for Foundry deployment scripts.
- `src/tools/config-tools.ts`: Utilities for reading and writing `.env` files.
- `src/setups/`: Contains logic specific to individual applications or demos.

## Troubleshooting

- **Connectivity**: Ensure the URLs in `setup/.env` are reachable from this package.
- **Admin Auth**: The setup uses a default admin private key. Ensure this key corresponds to an admin in your Prividium instance.
- **Foundry**: Contract deployment requires `forge` to be installed and available in your PATH.
- **ABI Extraction**: Ensure your contracts are compiled (`forge build`) so the ABI is available in the `out/` directory.
