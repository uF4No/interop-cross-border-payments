# Backend server

There are six endpoints for the backend server:

1. `/health-check` (GET): returns a successful response if the server is
   healthy.
2. `/status` (POST): returns the finalization status of recent L2 to L1
   transactions for a given account.
3. `/new-l1-interop-tx` (POST): adds the given interop transaction to the
   pending transactions list.
4. `/deploy-account` (POST): deploys a new SSO account for a given passkey,
   funds it through the faucet (testnet/local only), configures Prividium
   contract permissions, and links the deployed wallet to the target user
   profile in Prividium (`PUT /api/users/{userId}`).
5. `/faucet`: (POST): checks the balance of the given account, its entrypoint,
   and its shadow account on the L1. If any of the balances are below the
   `MIN_BALANCE`, it sends some funds to them. This endpoint should be removed
   for mainnet deployments.
6. `/invoices` (GET, POST): reads the chain C `InvoicePayment` contract from
   `config/contracts.json`, authenticates as the hardcoded admin account, and
   returns the admin's created and pending invoices in normalized JSON for the
   web app.

The server also runs a continuous process that tracks pending L2 <-> L1
transactions and finalizes them once they are fully executed.

## `/deploy-account` request/response

Request body:

```json
{
  "userId": "Pwdt2gLpHyMaiwjUYxIQ4",
  "originDomain": "http://localhost:3002",
  "credentialId": "base64url-or-0x-credential-id",
  "credentialPublicKey": [165, 1, 2, 3]
}
```

Behavior:

1. Deploys account from passkey payload.
2. Funds account/entrypoint via faucet logic (local/testnet flow).
3. Enables contract permissions in Prividium for the deployed smart account.
4. Fetches the user profile and appends the wallet address (`GET/PUT /api/users/{userId}`).

Success response includes:

- `responseObject.accountAddress`
- `responseObject.permissionsConfigured`
- `responseObject.walletAssociated`
- `responseObject.walletAddresses` (updated list)

If deploy succeeds but permissions/linking fails, the endpoint returns `500` with
`responseObject` populated so the client can display a precise setup error.

## `/invoices` request/response

This endpoint is designed for the web app dashboard and reads invoices from
chain C using the `InvoicePayment` contract address stored in
`config/contracts.json` under `chains.c.invoicePayment`.

Behavior:

1. Loads chain C RPC, API, auth base URL, and `InvoicePayment` address from the
   generated contracts config.
2. Authenticates against chain C as the hardcoded admin account.
3. Reads created and pending invoice counts for the admin address, fetches the
   invoice IDs, then loads the full invoice details in chunks.
4. Returns normalized invoice JSON with merged `created` and `pending` source
   tags.

Response payload includes:

- `responseObject.chain`
- `responseObject.adminAddress`
- `responseObject.counts`
- `responseObject.createdInvoiceIds`
- `responseObject.pendingInvoiceIds`
- `responseObject.invoices`

## Environment Variables

Required:
- `EXECUTOR_PRIVATE_KEY`: Private key used to deploy accounts, finalize interop txs, fund testnet accounts, and authenticate against Prividium API for profile wallet linking.
- `L1_RPC_URL`: L1 RPC endpoint (typically a local Anvil node).
- `PRIVIDIUM_RPC_URL`: Prividium L2 RPC endpoint (e.g. `http://localhost:8000/rpc`).
- `PRIVIDIUM_CHAIN_ID`: Prividium L2 chain id.
- `PRIVIDIUM_API_URL`: Prividium API base URL (include `/api`, e.g. `http://localhost:8000/api`).

Common optional:
- `PRIVIDIUM_AUTH_BASE_URL`: Auth service base URL (e.g. `http://localhost:3001`). Used to derive SIWE domain/uri when overrides are not set.
- `CORS_ORIGIN`: Allowed CORS origin for the backend server.
- `CONTRACTS_CONFIG_PATH`: Path to `config/contracts.json` (written by setup scripts).

Interop (required if not using `CONTRACTS_CONFIG_PATH`):
- `L1_INTEROP_HANDLER`: L1 interop handler contract address.
- `L2_INTEROP_CENTER`: L2 interop center contract address.

SSO contracts (required if not using `CONTRACTS_CONFIG_PATH`):
- `SSO_FACTORY_CONTRACT`
- `SSO_BEACON_CONTRACT`
- `SSO_ACCOUNT_IMPLEMENTATION_CONTRACT`
- `SSO_EOA_VALIDATOR_CONTRACT`
- `SSO_WEBAUTHN_VALIDATOR_CONTRACT`
- `SSO_SESSION_VALIDATOR_CONTRACT`
- `SSO_GUARDIAN_EXECUTOR_CONTRACT`
- `SSO_ENTRYPOINT_CONTRACT`

SIWE overrides (optional):
- `SIWE_DOMAIN`: Domain used in SIWE messages.
- `SIWE_URI`: URI used in SIWE messages.
- `SIWE_CHALLENGE_PATH`: Path on `PRIVIDIUM_API_URL` for SIWE challenge (default `/siwe-messages`).
- `SIWE_LOGIN_PATH`: Path on `PRIVIDIUM_API_URL` for SIWE login (default `/auth/login/crypto-native`).

Timing and rate limits (optional):
- `COMMON_RATE_LIMIT_WINDOW_MS`, `COMMON_RATE_LIMIT_MAX_REQUESTS`
- `POLL_INTERVAL`, `FINALIZATION_WAIT`

## Contract Addresses

This service reads contract addresses from the canonical config:

- `config/contracts.json`

The path is provided via `CONTRACTS_CONFIG_PATH` (written by the setup job).
Do not edit contract addresses directly in `backend/.env`; use `pnpm -C setup refresh:env`
after running setup scripts.

For `/invoices`, ensure `chains.c` in `config/contracts.json` includes:

- `rpcUrl`
- `apiUrl`
- `authBaseUrl`
- `invoicePayment`

The endpoint uses the hardcoded admin credentials from the request task and does
not require a dedicated env var for those values.

## Scripts

- `pnpm dev`: Run the backend in watch mode.
- `pnpm build`: Typecheck and build the production bundle.
- `pnpm start`: Run the built server from `dist/`.
