# setup

This package contains the setup tooling for the cross-border payments project. It is responsible for deploying the required contracts, configuring permissions in Prividium, registering the application, validating the deployed SSO stack, and synchronizing generated contract addresses back into the project environment files.

In normal usage, this package is not run directly. Users typically run the root-level setup command from the repository root, and that command delegates into this package.

## Primary command

Run the full setup flow from the repository root:

```bash
pnpm setup
```

This command runs the main 3-chain setup flow and is the default way to execute the setup process.

## Available scripts

### Root-level commands

- `pnpm setup`  
  Runs the full 3-chain setup flow.

- `pnpm setup:init-env`  
  Creates `setup/.env` from `setup/.env.example` if it does not already exist.

- `pnpm setup:permissions`  
  Runs the same full setup flow through the compatibility alias.

- `pnpm setup:update-permissions-compose`  
  Updates the local compose configuration for the permissions API and bundler services.

- `pnpm setup-app`  
  Registers the OAuth application only.

### Package-level commands

These commands can be run from the `setup/` directory when you need to execute individual tasks directly.

- `pnpm init:env`  
  Creates `.env` from `.env.example` if it does not already exist.

- `pnpm setup`  
  Runs the full setup flow for the package.

- `pnpm setup:3chain`  
  Runs the main 3-chain setup flow directly.

- `pnpm setup:permissions`  
  Compatibility alias for the full 3-chain setup flow.

- `pnpm setup:system`  
  Runs the system-level setup tasks, including SSO contract deployment and permission configuration.

- `pnpm setup:app`  
  Runs the application-level setup tasks, including payment-flow contract deployment and registration.

- `pnpm setup-app`  
  Registers the OAuth application only.

- `pnpm setup:update-permissions-compose`  
  Updates the compose configuration for the local permissions API and bundler services.

- `pnpm setup:fund-entrypoints`  
  Funds the configured entrypoint contracts for the local setup.

- `pnpm verify:sso`  
  Verifies the deployed SSO contracts and related Prividium configuration.

- `pnpm check:contracts`  
  Alias for `pnpm verify:sso`.

- `pnpm refresh:env`  
  Refreshes dependent `.env` files from `config/contracts.json`.

- `pnpm typecheck`  
  Runs TypeScript type-checking for this package.

## Source of truth

Contract addresses are written to `config/contracts.json`. This file is the canonical source of truth for generated contract configuration, and the setup tooling uses it to refresh dependent environment files in other parts of the repository.
