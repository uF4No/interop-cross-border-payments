# setup

This package contains the setup tooling for the cross-border payments project. It is responsible for deploying the required contracts, configuring permissions in Prividium, registering the application, validating the deployed SSO stack, and synchronizing generated contract addresses back into the project environment files.

In normal usage, this package is not run directly. Users typically run the root-level setup command from the repository root, and that command delegates into this package.

## Primary command

Run the full setup flow from the repository root:

```bash
pnpm setup
```

This command runs the main 3-chain setup flow and is the default way to execute the setup process.

## Runtime logs

The setup package writes logs both to the terminal and to persistent files in:

- `setup/.runtime/`

These files are gitignored and rotate automatically.

Current behavior:

- rotation threshold: 5 MiB per file
- retention: 4 archived files plus the current active file
- each command writes a session banner with timestamp and PID at process start

The setup package keeps separate log files per entrypoint so different commands do not overwrite each other. Common examples:

- `setup/.runtime/setup-3chain.log` for `pnpm setup` and `pnpm setup:3chain`
- `setup/.runtime/setup-system.log` for `pnpm -C setup setup:system`
- `setup/.runtime/setup-app.log` for `pnpm -C setup setup:app`
- `setup/.runtime/setup-create-app.log` for `pnpm setup-app`
- `setup/.runtime/setup-fund-entrypoints.log` for `pnpm -C setup setup:fund-entrypoints`
- `setup/.runtime/setup-verify-sso.log` for `pnpm -C setup verify:sso`
- `setup/.runtime/setup-refresh-env.log` for `pnpm -C setup refresh:env`
- `setup/.runtime/setup-update-permissions-compose.log` for `pnpm setup:update-permissions-compose`
- `setup/.runtime/setup-userop-direct.log` for `pnpm -C setup userop:direct ...`

This logging captures the process stdout/stderr stream, so it preserves the same high-level progress, errors, and command output you see in the terminal while making it easier to inspect previous runs afterward.

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
