---
title: AI Agent Guide for Prividium™
description:
  Download or copy this document and use it as your AGENTS.md / CLAUDE.md to optimize AI agents working with Prividium.
downloadable: true
---

# AI Agent Guide: Building on Prividium

This document outlines the specific constraints, patterns, and APIs required when building applications on Prividium™ chains.
These chains differ significantly from standard EVM chains due to strict privacy and permissioning layers.

## 🚨 CRITICAL DIFFERENCES (Read First, DO NOT IGNORE)

1.  **Everything is Permissioned**: There are NO public read nodes. Every interaction (read or write) requires
    authentication.
    - **Always** checks if the user is authenticated before attempting network operations.
    - **Always** use the [`prividium` SDK](https://www.npmjs.com/package/prividium) for frontend chain initialization.
2.  **RPC Architecture Depends on Signer Type**:
    - **Server/Scripts + Smart Contract Accounts (passkeys/4337)**: Use the standard `.../rpc` endpoint with
      `Authorization: Bearer <token>` headers.
    - **Browser EOA Wallets (MetaMask, etc.)**: Use a unique, per-user URL `.../rpc/wallet/<token>` because browser
      extensions cannot inject access headers.
3.  **Transaction Flow**: You CANNOT directly send transactions/user-operations. You must **pre-authorize** each operation
    via the API (`prividium.authorizeTransaction`) before submitting it (wallet prompt for EOAs, passkey flow for smart accounts).
4.  **Contracts are Private by Default**: After deployment, all contract methods are **Forbidden**. They must be explicitly allowed in the Admin Panel.

---

## 🔑 Programmatic Token Management (Scripts/Backends)

For standalone scripts (deployments, tests, cron jobs), you cannot use the browser flow. You must use the **Crypto-Native (SIWE)** flow.

### The Authentication Flow
1.  **Request Challenge**: `POST /api/siwe-messages` with `{ address, domain }`.
2.  **Sign Message**: Sign the returned `msg` using the wallet's private key.
3.  **Exchange for Token**: `POST /api/auth/login/crypto-native` with `{ message, signature }`.
4.  **Result**: You receive a JWT `token`.

### Token Rules
- **Header**: `Authorization: Bearer <token>`
- **Refresh**: There is no refresh token. You must re-run the SIWE flow when the token expires.
- **Check Validity**: `GET /api/auth/current-session`

---

## 🛠 Contract Deployment & Scripting

Only whitelisted accounts can deploy contracts.

### Deployment Method 1: Local Proxy (Recommended for Humans)
Instruct the user to run the local proxy, which handles auth automatically:
```bash
npx prividium proxy -r <rpc-url> -u <user-panel-url>
# Then deploy to http://127.0.0.1:24101/rpc
```

### Deployment Method 2: Foundry (`cast`/`forge`)
You must manually inject modifiers.
1.  Run a script to fetch the SIWE token (using the flow above).
2.  Pass the token to forge/cast:
```bash
cast send --rpc-url $RPC_URL --headers "Authorization: Bearer $TOKEN" ...
```

### Deployment Method 3: Hardhat / Scripts
Instantiate a Provider that injects headers.
```typescript
// Ethers v6
const fetchRequest = new ethers.FetchRequest(rpcUrl);
fetchRequest.setHeader('Authorization', `Bearer ${token}`);
const provider = new ethers.JsonRpcProvider(fetchRequest);
```

### ⚠️ Post-Deployment Step
**CRITICAL**: Immediately after deployment, the contract is unusable.
**Instruction to User**: "Go to the Admin Panel -> Contracts -> Register your contract. You MUST configure permissions for your functions (e.g., set to 'All Users') or execution will fail."

---

## 💻 Web Application Logic (React/Next.js)

When generating frontend code, strictly follow this signer-aware RPC pattern.

### 1. Configuration
Use the `prividium` SDK.
```typescript
import { createPrividiumChain } from 'prividium';
const prividium = createPrividiumChain({ /* config */ });
```

### 2. Reading Data (The "Read" Client)
**NEVER** use `window.ethereum` for reading. It will 401.
```typescript
// ✅ Created using prividium.transport which injects Auth headers
const readClient = createPublicClient({
  chain: prividium.chain,
  transport: prividium.transport
});
```

### 3. Writing Data (The 3-Step Flow)
You must strictly follow this process for **EVERY** transaction.

1.  **Pre-fetch**: Get nonce/gas using the **Authenticated Read Client**.
2.  **Authorize**: Call `prividium.authorizeTransaction`.
3.  **Send**: Send via `window.ethereum` (Wallet Client).

**Code Template:**
```typescript
// 1. Pre-fetch values (Authenticated)
const nonce = await readClient.getTransactionCount({ address });
const gas = await readClient.estimateGas({ ...params, account: address });

// 2. Authorize operation (API Call)
await prividium.authorizeTransaction({
  walletAddress: address,
  contractAddress,
  nonce,
  calldata: encodedData,
  value
});

// 3. Send via Wallet (Unauthenticated path, relies on pre-auth)
const hash = await walletClient.sendTransaction({
  ...params,
  nonce, // MUST match the authorized nonce
  gas
});
```

### 4. Writing Data (Smart Contract Accounts / Passkeys)
For passkey-based smart accounts, do **not** use wallet RPC URLs (`/rpc/wallet/<token>`). Use the authenticated transport
(`prividium.transport`) and send requests to standard `/rpc` with auth headers.

1.  **Get linked SSO account** (example: from `useSsoAccount` / stored passkey account).
2.  **Use authenticated client** created from `getTransport()` / `prividium.transport`.
3.  **Fetch nonce and authorize** the primary call via `authorizeTransaction` (`enableWalletToken` wrapper).
4.  **Submit UserOperation** through authenticated RPC (`eth_sendUserOperation`) and poll receipt.

**Code Template:**
```typescript
// Authenticated client (hits /rpc with Authorization header)
const rpcClient = createPublicClient({
  chain: getChain(),
  transport: getTransport()
});

// Optional but recommended: pre-authorize call for Prividium policy checks
await enableWalletToken({
  walletAddress: ssoAccountAddress,
  contractAddress: call.to,
  nonce,
  calldata: call.data
});

// Submit 4337 operation through authenticated RPC client
const userOpHash = await rpcClient.request({
  method: 'eth_sendUserOperation',
  params: [userOp, entryPointAddress]
});

const receipt = await rpcClient.request({
  method: 'eth_getUserOperationReceipt',
  params: [userOpHash]
});
```

**Important**:
- Do not call `getWalletRpcUrl()` / `addNetworkToWallet()` for smart contract accounts.
- Smart account flows still require authenticated RPC access; no unauthenticated reads/writes.

---

## 🔗 Tenants & Integrations

"Tenants" are third-party applications or MPC wallets managing multiple users.

### Tenant Authentication
- **Endpoint**: `POST /api/siwe-messages/tenants` (Note the `/tenants` suffix).
- **Exchange**: Exchange signature at `POST /api/jwt/from-siwe`.

### Tenant Capabilities
- **Manage Users**: `POST /api/tenant-actions/users` to create shadow users.
- **Visibility**: A Tenant Token passed to the RPC (`eth_getBlockReceipts`) allows visibility into **all** users managed by that tenant. Standard users can only see their own txs.

---

## 🔍 Block Explorer API

The Block Explorer API requires the same SIWE Bearer token as the RPC.

- **Docs**: `https://<explorer-api>/docs`
- **Usage**:
  ```bash
  curl -X GET "https://block-explorer-api.../stats" \
    -H "Authorization: Bearer <token>"
  ```

---

## 🐛 Common Debugging Guide

| Symptom | Cause | Fix |
| :--- | :--- | :--- |
| **401 Unauthorized (Read)** | Using `window.ethereum` or raw RPC URL without headers. | Use `prividium.transport` or inject `Authorization: Bearer` header. |
| **401 Unauthorized (Write)** | Transaction not authorized. | Call `prividium.authorizeTransaction()` before sending. |
| **Smart-account tx fails with 401** | Sent UserOperation through wallet RPC path or unauthenticated client. | Send `eth_sendUserOperation` via authenticated `/rpc` transport (`prividium.transport`). |
| **"Method not allowed"** | Contract permissions not set. | Go to Admin Panel -> Contracts and enable the function. |
| **"Wallet on wrong network"** | Wallet not using per-user RPC. | Call `prividium.addNetworkToWallet()`. |

---

## 🧠 Advanced Patterns & FAQ (Context for Reasoning)

Use these rules to answer questions or generate robust code for edge cases.

### 1. WebSockets & Real-Time Events
- **Constraint**: Standard WSS connections fail because they cannot send `Authorization` headers.
- **Pattern**: You MUST generate code that appends the token to the query string.
  - `wss://<endpoint>?token=<token>`

### 2. Backend Concurrency
- **Problem**: The `authorize` -> `send` flow + Nonce management makes parallel transactions unstable.
- **Pattern**: If generating a backend service, **ALWAYS** recommend a serialized queue (Mutex/Redis) for write operations from a single wallet. Do not use `Promise.all` for transactions from the same sender.

### 3. Factory Contracts
- **Constraint**: "Deployer" whitelist applies to contracts too.
- **Instruction**: If the user is writing a Factory contract, warn them: *"The Factory Contract address itself must be whitelisted by an Admin to deploy child contracts."*

### 4. "Public" Access
- **Correction**: "All Users" permission != Public Internet.
- **Pattern**: Never generate code that attempts to fetch data without an Auth token, even for "Open" contracts. All network access requires a JWT.
