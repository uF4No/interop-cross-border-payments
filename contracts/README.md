# Smart Contracts - ZKsync Prividium™

Foundry-based smart contract development environment for ZKsync Prividium.

**IMPORTANT**: There's no need to use foundry-zksync or the `--zksync` flag, as ZKsync chains are fully EVM equivalent now.


## Overview

This package contains the smart contracts for the Prividium Template. It uses **Foundry ZKsync** for compiling, testing, and deploying contracts to ZKsync-based networks.

## Prerequisites

- [Foundry ZKsync](https://github.com/matter-labs/foundry-zksync) installed.

## Getting Started

### 1. Install Dependencies

```bash
forge install
```

### 2. Build

Compile the smart contracts:

```bash
forge build
# or from the root
pnpm --filter contracts build
```

### 3. Test

Run the test suite:

```bash
forge test
# or from the root
pnpm --filter contracts test
```

### 4. Deploy

To deploy to ZKsync Prividium, you can use `forge create`. In this repo, the
recommended path is to use the `setup` package, which deploys contracts,
registers permissions, and writes addresses to the canonical config:

- `config/contracts.json`

```bash
forge create src/Counter.sol:Counter --rpc-url http://127.0.0.1:24101/rpc --private-key YOUR_PRIVATE_KEY
```


## Structure

- `src/`: Smart contract source files.
- `test/`: Foundry tests.
- `lib/`: Dependencies managed by Forge.
- `script/`: Deployment and interaction scripts.

## Formatting

```bash
forge fmt
```
