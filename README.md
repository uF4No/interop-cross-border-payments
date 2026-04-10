# ZKsync Prividium: Cross-Border Payments

This repository contains a cross-border payments application built on ZKsync Prividium. It combines smart contracts, a backend API, and a Vue frontend so users can authenticate with passkey-based SSO smart accounts, create payment requests from one Prividium chain, and settle them on chain C through the interop flow.

## Requirements

### System requirements

- Node.js v22.10.0 or higher
- pnpm v9.16.1 or higher
- Foundry v1.0.0 or higher
- Docker

### Quay Authentication (Required for Prividium Images)

Some Prividium component images are hosted in Quay under Matter Labs private access.
Before running compose, authenticate to `quay.io` with credentials provided by the MatterLabs team.

```bash
DOCKER_USERNAME=matterlabs_enterprise+your_username
DOCKER_PASSWORD=super_secret_provided_by_matterlabs

docker login -u=$DOCKER_USERNAME -p=$DOCKER_PASSWORD quay.io
```

## Quick Start

### 1. Install Dependencies

Initialize the checked-in submodule and install the workspace dependencies from the repository root:

```bash
git submodule update --init --recursive
pnpm install
```

If you are validating the project from a plain directory copy instead of a git clone, skip the `git submodule update` command.
That command is only needed for the checked-in `prividium-3chain-local/` submodule.

### 2. Initialize the setup environment file

Create `setup/.env` from the provided template:

```bash
pnpm setup:init-env
```

If `setup/.env` already exists, the command leaves it unchanged.

### 3. Start the local chain stack

Run the following command to start the chains locally with interop enabled:

```bash
cd prividium-3chain-local && docker compose -f docker-compose-deps.yml -f docker-compose.yml up -d

```

> [!NOTE]
> For public + private inerop run `cd prividium-3chain-local && docker compose -f docker-compose-deps.yml -f docker-compose.yml -f docker-compose-private-interop.yml up -d`

### 4. Compile smart contracts

Compile the smart contracts with:

```bash
pnpm --filter contracts build
```

On the first run, this command bootstraps the pinned Foundry libraries into `contracts/lib/` before compiling.
For the current contracts project, that means fetching the pinned OpenZeppelin dependency into `contracts/lib/openzeppelin-contracts/`.
This works even in a plain copied directory that is not a git checkout, so you do not need to run `forge install` manually.

### 5. Deploy contracts and configure permissions

The setup script deploys the SSO contracts, configures the required permissions, creates the application in Prividium, and deploys the smart contracts that support the cross-border payment flow.

Review `setup/.env` and update the environment variables, target Prividium chain and API endpoints, application client name, and related settings as needed. `setup/.env.example` provides the default template.

Run the setup script with:

```sh
pnpm run setup
```

The script outputs deployment progress in the terminal. Contract addresses are written to `config/contracts.json`.

The script also synchronizes contract addresses to the `.env` files in the `web-app/` and `backend/` directories.

Setup logs are also written to rotated files under `setup/.runtime/` so you can inspect previous runs without relying only on terminal scrollback.

At the end of the setup, the script prints the command required to restart the affected containers.

### 6. Restart API Docker containers

Restart the API Docker containers to pick up the configuration changes made during contract deployment.

```bash
docker compose -f prividium-3chain-local/docker-compose.yml up -d --no-deps --force-recreate bundler-l2a bundler-l2b permissions-api-l2a permissions-api-l2b
```

### 7. Start the backend service

The backend service (in `./backend`) provides endpoints for SSO smart account deployment from the web app (in `./web-app`) and payment-request retrieval.

To start the backend service run:

```sh
pnpm dev:backend
```

The backend continues to log to the terminal and also writes rotated runtime logs to `backend/.runtime/`.

> [!IMPORTANT]
> Start the backend and web-app services in separate terminals.

### 8. Start the web application

The web app (in `./web-app`) is a Vue.js application that allows users to create payment requests and settle cross-border payments across different chains.

To start the web app run:

```sh
pnpm dev:web-app
```

### 9. Access the application

Navigate to [http://localhost:5000](http://localhost:5000) and sign in with a Prividium user account (for example, `user@local.dev` / `password`). Register a passkey-based account, then use the application to create payment requests and settle them.

Use two different browser profiles to authenticate in different chains (using different accounts) to simulate usage between two different entities.

## Repository Structure

- [`setup/`](./setup): Setup scripts to deploy contracts and configure permissions in the ZKsync Prividium™ ecosystem.
- [`contracts/`](./contracts): A Foundry-based project with the smart contracts that power payment requests and settlement.
- [`backend/`](./backend): A Node.js backend service necessary for ZKsync SSO Smart Account deployment and interop transactions.
- [`web-app/`](./web-app): A Vue 3 + TypeScript frontend demonstrating Prividium authentication and a cross-border payments workflow.

## Configuration Source of Truth

Contract addresses live in a single canonical file:

- `config/contracts.json`

This file is **generated by the setup scripts**. Do not edit contract addresses manually in `.env` files.  
If you need to refresh env files from the canonical config, run:

```bash
pnpm -C setup refresh:env
```

## Runtime Logs

The setup and backend packages keep persistent runtime logs in package-local `.runtime/` directories:

- `setup/.runtime/`
- `backend/.runtime/`

These directories are gitignored. Log files rotate automatically so a single long-running process does not keep growing one file indefinitely.

See the package READMEs for the exact file names and command-level details:

- [`setup/README.md`](./setup/README.md)
- [`backend/README.md`](./backend/README.md)

## Branding and style customization

The web app can be easily updated to use different branding by updating the following environment variables in the `web-app/.env` file:

```sh
# Company name
VITE_COMPANY_NAME="Matter Labs"
# Accent color (hex)
VITE_ACCENT_COLOR="#3a00adff"
# Company icon (from https://heroicons.com/)
VITE_COMPANY_ICON="ArrowPathRoundedSquareIcon"
```

## License

This project is licensed under the MIT License.
