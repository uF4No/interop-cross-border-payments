# Interop Transactions for Any Random Account

This document explains what is required to make cross-chain interop transactions work for arbitrary users (not just pre-seeded/dev keys), and how to diagnose failures.

Scope:
- Source chains: A/B
- Destination chain: C
- Pattern: user action in web-app emits `sendBundle(...)`, relay executes on destination
- Example destination action: `InvoicePayment.createInvoice(...)` on chain C

---

## 1. Core Principle

For random-user interoperability to work, **authorization must be based on the user identity inside the interop payload**, while **execution rights must be compatible with the relayer model**.

In practice:
1. The bundle call `from` must represent the initiating user identity (or its canonical account identity).
2. Destination contract checks must validate this identity correctly (typically via alias/shadow account logic).
3. Bundle execution permission (`unbundlerAddress`) must allow the active relay signer (or be permissionless).

If any one of these is misaligned, source tx can succeed while destination execution fails.

---

## 2. End-to-End Flow (Expected)

1. User signs a UserOperation on chain A or B.
2. Source chain tx is mined and emits an interop bundle event.
3. Relay detects the source bundle.
4. Relay fetches proof and waits for destination root availability.
5. Relay submits execution on destination chain C.
6. Destination contract executes and emits domain event (for invoices: `InvoiceCreated`).
7. UI fetches destination state and closes modal.

Failure in step 5/6 produces the common symptom:
- source tx says success
- modal never closes
- polling loops until timeout / 429

---

## 3. Non-Negotiable Requirements

## 3.1 Bundle Permissions (`unbundlerAddress`)

### Shared relay (recommended for random users)
- Use permissionless execution or set `unbundlerAddress` to the relay signer address.
- Do **not** set `unbundlerAddress` to the initiating end-user address unless that exact signer executes destination txs.

### Why this matters
- If bundle says "only user X can unbundle" but relay signer is Y, destination execution reverts immediately.
- This is the most common cause of:
  - `transaction submission failed`
  - `error code 3: execution reverted`

## 3.2 User Identity Consistency

For contract-level auth checks, these fields must be consistent:
- bundle call `from`
- business arguments carrying user identity (`creatorRefundAddress`, etc.)
- chain id used by alias derivation (`creatorChainId`, source chain id)

If destination contract expects aliased identity:
- source identity in bundle and contract args must map to the same alias.

## 3.3 Destination Contract Authorization Model

Destination contracts must authorize interop callers correctly for cross-chain mode:
- same-chain mode: direct sender checks
- cross-chain mode: alias/shadow account checks (`getAliasedAccount(...)`, equivalent)

For random users, contract checks cannot depend on hardcoded allowlists unless those allowlists are maintained for all users.

## 3.4 Relay Signer Readiness

Relay signer must be:
- funded on destination chain
- using valid nonce
- allowed by bundle permissions
- connected to the correct RPC endpoints

---

## 4. Web-App Implementation Requirements

## 4.1 Bundle Builder Behavior

For random-user compatibility:
- Default to permissionless unbundling.
- Make unbundler restriction optional via env/config.

Recommended env semantics:
- `permissionless` (or unset): no unbundler restriction
- `0x...`: restrict to specific relay signer
- `user`: restrict to initiating user (advanced mode; usually not for shared relay)

## 4.2 UI State Management

Do not couple modal completion to a static reader account that may not include the current user's records.

Use:
- active user's destination-relevant identity for polling, or
- backend status for a specific source tx / bundle hash, or
- destination event watcher keyed by expected bundle hash.

If UI polls the wrong account:
- destination execution may actually succeed, but modal still loops.

## 4.3 Error Surface

When relay-side execution fails:
- stop polling early
- show explicit cross-chain execution error
- include source tx hash and bundle hash

This prevents silent infinite loops and 429 amplification.

---

## 5. Relay and Infra Requirements

## 5.1 Relay Logic Must Handle
- source tx detection
- proof retrieval
- root availability waiting
- destination verify/execute submission
- clear error reporting per tx

## 5.2 Observability

Must log:
- source tx hash
- bundle hash
- source -> destination chain ids
- final stage (`DONE`, `FAIL`)
- full destination RPC error (not only truncated UI table)

## 5.3 Environment Hygiene

Keep a single source of truth for:
- relay private key
- relay signer address
- allowed unbundler policy in web-app config

---

## 6. Validation Checklist (Before Declaring "Works for Random Users")

## 6.1 Functional Matrix

Test at minimum:
1. Account U1 on chain A -> chain C (create action)
2. Account U2 on chain A -> chain C
3. Account U3 on chain B -> chain C
4. Repeat each test with fresh account/session (no cached credentials)

Pass criteria for each row:
- source UserOp confirmed
- relay marks `DONE`
- destination contract emits expected event
- UI exits modal and shows updated state

## 6.2 Permission Checks

For each emitted bundle:
- decode and inspect `bundleAttributes.unbundlerAddress`
- confirm it is permissionless or relay-compatible

## 6.3 Contract Events

Verify on destination:
- expected domain event exists
- state changes are queryable for the initiating user identity

## 6.4 Negative Tests

Intentionally set unbundler to a non-relay signer:
- expect deterministic relay failure
- ensure UI surfaces clear failure, not endless loop

---

## 7. Practical Diagnostics Commands

Use these to debug one failing user action end-to-end.

Assumptions:
- source RPC: `http://chain1:3050/rpc` (example)
- destination RPC: `http://chain3:3052/rpc` (example)

## 7.1 Map userOp -> source tx

Find source tx hash in bundler logs (`transactionHash`) for the userOp hash.

## 7.2 Decode emitted bundle

```bash
cast-interop bundle extract --rpc http://chain1:3050/rpc --tx <SOURCE_TX> --json
```

Check:
- `bundle.sourceChainId`
- `bundle.destinationChainId`
- `bundle.calls[0].from`
- `bundle.bundleAttributes.unbundlerAddress`

## 7.3 Fetch proof

```bash
cast-interop debug proof --rpc http://chain1:3050/rpc --tx <SOURCE_TX> --json
```

## 7.4 Explain execution eligibility

```bash
cast-interop bundle explain \
  --rpc http://chain3:3052/rpc \
  --bundle <bundle.hex> \
  --proof <proof.json> \
  --private-key <RELAY_KEY> \
  --json
```

If this returns `unbundlerAddress does not allow signer`, permission model is misconfigured.

## 7.5 Attempt relay manually

```bash
cast-interop bundle relay \
  --rpc-src http://chain1:3050/rpc \
  --rpc-dest http://chain3:3052/rpc \
  --tx <SOURCE_TX> \
  --private-key <RELAY_KEY>
```

## 7.6 Confirm destination state

For invoice flow, check:
- `InvoiceCreated` logs
- invoice counter / read methods for expected user

---

## 8. Common Failure Modes and Fixes

## FM-1: Source success, relay fail, no destination event
Symptoms:
- UserOp success in UI
- Relay `A->C FAIL`
- no destination domain event

Typical cause:
- unbundler mismatch (bundle restricted to user, relay signer different)

Fix:
- permissionless unbundler or relay-address unbundler

## FM-2: Destination success but modal loops
Symptoms:
- destination event exists
- UI keeps polling and times out

Typical cause:
- UI polling wrong identity (static reader account)

Fix:
- poll active user identity / bundle-specific status

## FM-3: 403 on localhost dev app
Symptoms:
- app "started on :5000"
- browser gets HTTP 403 with AirTunes server headers

Cause:
- macOS AirPlay service occupying IPv4 localhost:5000

Fix:
- disable AirPlay Receiver or use a non-conflicting local setup

---

## 9. Recommended Production Defaults

1. `unbundlerAddress`: permissionless unless strict relay control is required.
2. Relay signer: dedicated key, funded and monitored.
3. Contract auth: deterministic alias-based cross-chain checks.
4. UI:
   - finite retries
   - explicit fail states
   - tx/bundle ids shown to users/operators.
5. Ops:
   - one-click command to decode any failing source tx and explain permission/proof status.

---

## 10. Rollout Plan

1. Ship web-app bundle-permission fix.
2. Confirm runtime config in the actual served app (not only source files).
3. Validate with at least 3 fresh random accounts across A/B.
4. Add UI-side cross-chain failure handling.
5. Add monitoring alerts:
   - relay FAIL rate
   - 429 polling spikes
   - missing destination event after source success.

---

## 11. Definition of Done

"Interop works with any random account" is true only when:
- any newly created user account on A or B can initiate flow,
- relay executes to C without manual signer swapping,
- destination contract state updates for that account,
- UI reliably reflects success/failure without infinite polling.

---

## 12. Token Deployment and Funding Flow

This section documents how invoice/payment tokens are provisioned for the 3-chain setup and how new SSO accounts receive spendable balances.

### 12.1 Setup-time token deployment and registration

During the invoice-focused setup flow:

1. Deploy canonical ERC20 token contracts on chain C (origin chain for invoice tokens).
2. Register each token in the Native Token Vault on chain C.
3. Read the `assetId` generated by the vault for each token.
4. Mint bootstrap liquidity on chain C to the setup signer/admin and approve the vault.
5. Trigger interop token transfers from C->A and C->B so represented token contracts are materialized on chains A/B.
6. Set the transfer recipient for those C->A/B bootstrap sends to the admin account so the admin holds initial balances on A and B.
7. Resolve and persist represented token addresses (`A`, `B`) plus origin address (`C`) in `config/contracts.json`.

Result:
- Chain C holds the canonical token contracts.
- Chains A/B hold represented contracts for the same `assetId`.
- Admin account receives initial balances on A/B and can redistribute to users.

### 12.2 Invoice contract token readiness on chain C

Still in setup:

1. Deploy `InvoicePayment` on chain C.
2. Mint invoice liquidity to the `InvoicePayment` contract for each supported token.
3. Whitelist each token in `InvoicePayment`.
4. Configure exchange rates for supported token pairs.
5. Verify post-setup whitelist state (read-back check) to prevent silent misconfiguration.

This ensures invoice creation/payment paths can resolve supported assets and rates immediately after setup.

### 12.3 Backend `/deploy-account` token top-up behavior

When a client calls `POST /deploy-account`, backend now performs:

1. Deploy smart account on the requested target chain (`A` or `B`).
2. ETH faucet funding (entrypoint + account + shadow account where relevant).
3. Invoice-token top-up for the newly deployed account:
   - Read configured token mappings from `config/contracts.json`.
   - Select token addresses for the target chain (`addresses.A` or `addresses.B`).
   - Transfer a default amount from backend executor/admin wallet to the new account.
   - If direct transfer cannot cover requested amount, attempt mint fallback (when token supports it).
   - If mint is unavailable and only partial balance exists, transfer available balance and report partial funding.
4. Continue with permission setup + wallet association in Prividium.

API responses include token-funding details so operators can confirm:
- which token symbols were attempted,
- method used (`transfer`, `mint`, `transfer_partial`, or `none`),
- tx hashes and any warning/error messages.

### 12.4 Operational implications

1. The backend executor wallet must hold enough represented token balances on A/B to fund newly created users, unless mint fallback is supported on those token contracts.
2. If `recipient` for C->A/B bootstrap transfers is changed away from admin, `/deploy-account` funding logic must use the wallet that actually holds token inventory.
3. `config/contracts.json` remains the source of truth for token address mapping across chains and must stay in sync with setup outputs.
