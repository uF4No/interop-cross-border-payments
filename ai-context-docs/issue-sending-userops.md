# Issue: Sending `eth_sendUserOperation` for invoice creation from chain A

**Important:** This issue was fixed.

Last updated: **March 26, 2026**
Workspace: `/Users/antonio/MatterLabs/cross-border`

## 1) Objective
Provide a complete handoff document for debugging the invoice creation flow that starts in the root `web-app`, submits an ERC-4337 user-op on chain A, emits an interop bundle, and is expected to create the invoice on chain C.

This file is intended to let another engineer or agent resume from context alone.

## 2) Executive Summary
This issue turned out to be a chain of multiple independent problems. They were discovered in sequence because each earlier blocker masked the next one.

### 2.1 What is already fixed
- `permissions-api` was previously forwarding bundler methods to the wrong RPC. That caused `-32601` / method-not-found behavior. Fixed.
- Bundler simulation contracts for v0.8 were wrong. That caused `AA24 signature error` because the simulation hash context did not match the real EntryPoint hash. Fixed.
- Chain A/B bundler on this local stack requires legacy-style gas pricing. The web app was sending `maxFeePerGas != maxPriorityFeePerGas`. That caused a newer generic bundler failure. Fixed.
- Alto/bundler simulation still blocked some invoice sends even when the exact same user-op would execute through the real EntryPoint. A direct local-only `EntryPoint.handleOps` fallback was added. Fixed locally.
- After direct fallback, the UI was still surfacing a false receipt error by re-querying a tx hash through the wrong path. Fixed.
- After direct fallback, interop txs were not always being queued for relay/finalization. Fixed.
- Invoice reads were incorrectly using a hardcoded admin address rather than the current wallet address. Fixed.

### 2.2 Last proven root cause on the destination path
The most recent concrete blocker found in the `interop-relay` container was:

- the invoice bundle was being emitted with an `unbundlerAddress` restriction tied to the source SSO wallet,
- but the actual destination submission on chain C is performed by the relay signer,
- so destination execution was rejected before `InvoicePayment.createInvoice(...)` ever ran.

Exact relay-side explanation from container tooling:
- `unbundlerAddress does not allow signer 0x36615cf349d7f6344891b1e7ca7c72883f5dc049 (chainId 6565, addr 0xdd78e1f4865aaeff97f9f6b1c22e06347c2833b6)`

### 2.3 Current status after the latest patch
- The invoice sender was patched to explicitly include `unbundlerAddressAttribute(relaySigner)` when calling `InteropCenter.sendBundle(...)`.
- Setup/env sync was patched so the relay address is propagated into `web-app/.env`.
- `web-app/.env` now contains:
  - `VITE_INTEROP_RELAY_ADDRESS="0x36615Cf349d7F6344891B1e7CA7C72883F5dc049"`
  - `VITE_CHAIN_C_INTEROP_RELAY_ADDRESS="0x36615Cf349d7F6344891B1e7CA7C72883F5dc049"`
- Typechecks pass.
- A fresh live invoice submission is still required to confirm that chain C execution now succeeds with the corrected bundle attribute.

## 3) What the Flow Is Supposed to Do
1. User creates or links a passkey-backed SSO smart account on chain A.
2. Root `web-app` builds an ERC-4337 user-op that calls chain A `InteropCenter.sendBundle(...)`.
3. That user-op is submitted via `eth_sendUserOperation`.
4. Once included on chain A, the interop system should relay/submit the bundle to chain C.
5. Chain C should execute `InvoicePayment.createInvoice(...)`.
6. The dashboard should eventually show the invoice under the current SSO wallet address.

## 4) Environment / Services
Primary compose file:
- `/Users/antonio/MatterLabs/cross-border/prividium-3chain-local/docker-compose.yml`

Important services and roles:
- `web-app`: user-facing Vue app in repo root
- `prividium-permissions-api-l2a`: chain A permissions API / RPC facade
- `zksync-prividium-3chains-bundler-l2a-1`: Alto/Pimlico bundler for chain A
- `zkos-chain1`: chain A RPC backend
- `zksync-prividium-3chains-interop-relay-1`: auto-relay process for interop bundles
- local backend in repo root: invoice API, direct fallback endpoint, relay queue tracking

Relevant endpoints:
- chain A permissions RPC: `http://localhost:8000/rpc`
- chain A backend API: `http://localhost:4340`
- chain A RPC: `http://localhost:3050`
- chain C RPC: `http://localhost:3052`

## 5) Key Actors / Addresses
### 5.1 Chain A / SSO
- EntryPoint v0.8: `0x38a024C0b412B9d1db8BC398140D00F5Af3093D4`
- WebAuthn validator: `0xE3011A37A904aB90C8881a99BD1F6E21401f1522`
- Interop center: `0x0000000000000000000000000000000000010010`

### 5.2 Chain C destination
- Chain C id: `6567`
- InvoicePayment: `0x67d269191c92Caf3cD7723F116c85e6E9bf55933`

### 5.3 Relay signer
- Interop relay signer address: `0x36615Cf349d7F6344891B1e7CA7C72883F5dc049`
- Source of truth in local stack: `/Users/antonio/MatterLabs/cross-border/prividium-3chain-local/docker-compose.yml`

### 5.4 Simulation contracts deployed on March 26, 2026
Old problematic addresses:
- EntryPoint simulation: `0xAD523115cd35a8d4E60B3C0953E0E0ac10418309`
- Pimlico simulation: `0x2b5A4e5493d4a54E717057B127cf0C000C876f9B`

New explicit addresses:
- EntryPointSimulations08: `0x162700d1613DFec978032A909DE02643bc55df1a`
- PimlicoSimulations: `0x67ad6Ea566BA6B0fc52e97BC25Ce46120fDAc04C`

Deployment txs:
- `0xa1d96037bd0257601c5e1a679f0e5c177556d93fd954449f9ec5a87986b6d78d`
- `0xf9cbba6ae8fe16b6e2d8eb7b9f611ce887648f9bc29814ea9983f848ba03e89a`

## 6) High-Level Timeline
### 6.1 Earlier infra bug: bundler methods were sent to the wrong place
Earlier in the investigation, `permissions-api` was configured with a bundler URL that actually pointed at sequencer-style RPC. This caused method-not-found behavior for AA/4337 methods.

Fixes already in place:
- `permissions-api-l2a`: `BUNDLER_RPC_URL=http://bundler-l2a:4337`
- `permissions-api-l2b`: `BUNDLER_RPC_URL=http://bundler-l2b:4337`
- setup defaults updated in `setup/src/tools/permissions-api-compose.ts`

Verification:
- `eth_supportedEntryPoints` through `http://localhost:8000/rpc` returned the expected entrypoint.

### 6.2 After routing fix, bundler reached simulation but failed with AA24
Observed errors during this phase:
- `AA24 signature error`
- `AA23 reverted 0xac52ccbe`
- generic wrapper from app / permissions API:
  ```json
  {"jsonrpc":"2.0","id":...,"error":{"code":-32500,"message":"Bundler operation failed"}}
  ```

At this point the app was definitely reaching the bundler. The problem was no longer request routing.

### 6.3 Core AA24 finding: simulation hash context mismatch
Hard evidence was gathered showing:
- the passkey challenge matched the real `EntryPoint.getUserOpHash(...)`,
- but the simulation path used a different effective hash context,
- so validation under the simulation path failed even when the real EntryPoint hash was correct.

Concrete implication:
- `AA24` was not a passkey cryptography failure,
- it was a bundler simulation-contract mismatch.

### 6.4 Attempted simulation auto-deploy was not reliable in this local stack
Tried:
- `--deploy-simulations-contract true`
- removed explicit simulation addresses

Result:
- bundler restart loop
- invalid deterministic deployer path / bad raw tx behavior

Conclusion:
- explicit manual deployment + address pinning was required in this local environment.

### 6.5 Manual v0.8 simulation deployment fixed the AA24 phase
After deploying `EntryPointSimulations08` and `PimlicoSimulations` and pinning them in compose:
- historical replay no longer failed with `AA24`
- the visible failure moved forward to the next layer

This was the correct direction: the old signature blocker had truly been cleared.

### 6.6 New live error on March 26, 2026 around 11:09: gas fee mismatch
A newer live request from sender `0xef53ca7a9c3e0a226bf8c28b4486c1b906e909aa` showed a different failure than AA23.

Underlying error from logs:
- `maxPriorityFeePerGas must equal maxFeePerGas on chains that don't support EIP-1559`

Observed payload values:
- `maxFeePerGas = 0x2540be400` (`10 gwei`)
- `maxPriorityFeePerGas = 0x12a05f200` (`5 gwei`)

Local fix applied:
- set `maxPriorityFeePerGas = maxFeePerGas` for local chain A/B user-op send paths

Important nuance:
- replaying the old signed payload after changing gas fields returned `AA24 signature error`
- that was expected because gas fields change the user-op hash
- a fresh UI submission signs after gas packing, so the real fix was still correct

### 6.7 Even after fee fix, Alto still blocked some invoice sends
At this stage the issue stopped looking like a simple bundler admission problem.

Evidence:
- direct dry-run of real `EntryPoint.handleOps` on chain A succeeded for the captured payload
- but the bundler path still failed or stalled
- the hash returned/polled by the bundler path did not match the real EntryPoint hash for the same op

Concrete data from one exact payload:
- real EntryPoint hash from direct helper: `0xd732119420e0c761d7600c5e69e8a1e60f887b3519fa450f0d3447af71f9bf41`
- bundler-polled hash: `0x45c959b6586d4cfeeed99a0e3df5bb3c9faaf727ca94575ff62c33846ea4e44d`

This became strong evidence that Alto/Pimlico simulation/admission was still not trustworthy enough for this interop invoice path.

### 6.8 Direct `EntryPoint.handleOps` fallback was added locally
Because the exact user-op could execute via the real EntryPoint, a local-only fallback path was added.

Added pieces:
- CLI helper in `setup`: direct `handleOps` submitter
- backend endpoint: `/userops/direct-handle-ops`
- shared web-app helper that:
  - tries normal `eth_sendUserOperation`
  - polls `eth_getUserOperationReceipt`
  - falls back to backend direct `handleOps` only for local backend setups

This was intentionally local-only so the app does not silently bypass bundlers in non-local environments.

### 6.9 Direct execution succeeded on chain A, but the UI still errored
One exact captured invoice op was submitted directly and mined successfully:
- source tx: `0x5043c00e0c6df4e4730f0fe5a3b8cd31d10fcbe4d4fadb818493e1ce50d6b6ca`

Replaying the same old payload afterward returned:
- `AA25 invalid account nonce`

That confirmed the source-chain op had actually consumed nonce `0`.

However, the UI still surfaced errors because it was re-querying a tx hash through another RPC path after direct fallback already had a mined tx.

This false error was later fixed in the web app.

### 6.10 Another source tx proved the backend direct endpoint was being used
For sender `0xdd78e1f4865aaeff97f9f6b1c22e06347c2833b6`:
- backend log showed `POST /userops/direct-handle-ops` at `11:51:14` on March 26, 2026
- source tx: `0xdd23039f71bda6c3dac287a0e3526a5e58a942de09c258ff5caa298dd503b992`

The user initially thought the fallback had not been used because the UI still failed. The backend log proved otherwise.

### 6.11 Relay queue / status / invoice-read bugs were masking the real destination issue
Several bugs were fixed after the source-chain fallback started working:

1. False receipt error after successful direct fallback
- the web app re-fetched the tx through a different path and showed:
  - `Transaction receipt with hash "0xdd2303..." could not be found...`
- this was a UI/path bug, not a source execution failure

2. Direct `handleOps` path was not always auto-queueing interop txs
- fixed by extracting bundle data from logs and queueing relay work automatically

3. Manual interop queue route rejected non deposit/withdrawal txs
- fixed so generic interop txs can be queued

4. `/invoices` used the wrong account context
- invoice reads were hardcoded to an admin address
- dashboard and wait-for-chain-C polling were fixed to use the current SSO wallet address instead

### 6.12 Important semantic trap: backend “finalized” did not mean chain C invoice existed
Some source txs were marked finalized by the backend flow, for example:
- source tx `0xdd23039f71bda6c3dac287a0e3526a5e58a942de09c258ff5caa298dd503b992`
  - finalization tx: `0xa5fb40e2020cd6352edd1cda9494c655d7eb4236a4b60db1c7d6a09f36730573`
- source tx `0x4af7a078e22ecba5e6238859a7af075a37f8cb9f32404f02d965c88974ffcf02`
  - backend status showed finalizedAt `2026-03-26T12:09:22.725Z`
  - L1 finalization tx: `0x51db878131b1be07873661fd0fc0c72a9cb4858337b4e9b85f4b0c6cd581404f`

But:
- `/invoices` for wallet `0xdd78e1f4865aaeff97f9f6b1c22e06347c2833b6` still returned zero
- direct chain C reads also returned zero created / zero pending

Conclusion:
- “finalized” in backend status was not sufficient proof that the invoice call executed on chain C
- the remaining issue was downstream of source inclusion and downstream of relay queueing

## 7) Critical Relay-Container Investigation
This was the most important later-stage diagnostic step.

### 7.1 Relay UI/logs showed repeated A -> C destination submission failures
Container:
- `zksync-prividium-3chains-interop-relay-1`

`docker logs` showed repeated failures for the invoice source txs:
- `A→C 0x4af7a0…cf FAIL transaction submission failed: server returned an error response: error code …`
- `A→C 0xdd2303…b9 FAIL transaction submission failed: server returned an error response: error code …`
- `A→C 0x5043c0…b6 FAIL transaction submission failed: server returned an error response: error code …`

This was decisive because it proved the destination submitter, not the source user-op, was now failing.

### 7.2 Relay signer itself was healthy
Verified on chain C:
- relay address `0x36615Cf349d7F6344891B1e7CA7C72883F5dc049`
- balance about `1.000016537500026779 ETH`
- nonce `6`

So the relay failure was not simply “out of gas” or “empty account”.

### 7.3 Dry-run relay execution reverted
Inside the relay container, running `cast-interop bundle relay ... --dry-run` for tx `0x4af7a078e22ecba5e6238859a7af075a37f8cb9f32404f02d965c88974ffcf02` failed with:
- `dry-run failed: ... error code 3: execution reverted`

That narrowed the problem to bundle validity / execution policy.

### 7.4 `cast-interop bundle explain` revealed the real destination blocker
Using extracted bundle + proof against chain C produced the critical message:
- `executionAddress` check: `ok`
- `unbundlerAddress` check: `fail`
- exact detail:
  - `unbundlerAddress does not allow signer 0x36615cf349d7f6344891b1e7ca7c72883f5dc049 (chainId 6565, addr 0xdd78e1f4865aaeff97f9f6b1c22e06347c2833b6)`

This was the strongest evidence in the whole investigation after the bundler issues were cleared.

### 7.5 Bundle extraction showed the wrong policy encoded into invoice bundles
Extracted bundle JSON for the same tx showed:
- `bundle.destinationChainId = 6567`
- target call was `InvoicePayment.createInvoice(...)` on chain C
- `bundleAttributes.executionAddress = "0x"`
- `bundleAttributes.unbundlerAddress = "0x000100000219a514dd78e1f4865aaeff97f9f6b1c22e06347c2833b6"`

Interpretation:
- invoice flow was effectively restricting unbundling to the source wallet address `0xdd78...`
- actual chain C submission is performed by relay signer `0x36615...`
- destination submission was therefore rejected before contract execution

## 8) Comparison With the Working Template Counter App
The user asked whether the template app might be sending directly to EntryPoint or using a different hook path.

Answer: **no**.

What the template does:
- `prividium-template-vue/web-app/src/composables/useCounterContract.ts` builds a normal same-chain call to the counter contract
- `prividium-template-vue/web-app/src/utils/sso/sendTxWithPasskey.ts` submits it through:
  - `eth_sendUserOperation`
  - then polls `eth_getUserOperationReceipt`

So the template app was also using the bundler path, not direct EntryPoint submission.

Why it avoided this invoice-specific failure class:
- the counter app performs a same-chain call
- it does **not** call `InteropCenter.sendBundle(...)`
- it does **not** produce a cross-chain bundle
- it does **not** involve `interop-relay`
- it therefore never exercises destination-side `unbundlerAddress` policy

This means the template app “working perfectly fine” was not evidence that the invoice path was wrong at the ERC-4337 layer. The invoice path’s additional interop bundle policy was the differentiator.

## 9) Code Changes Applied During This Investigation
### 9.1 Bundler / infra
- `prividium-3chain-local/docker-compose.yml`
  - fixed bundler URL routing
  - pinned correct v0.8 simulation contracts for chain A bundler

### 9.2 Setup tooling
- `setup/src/tools/bundler-simulation-deploy.ts`
  - switched deployment logic from v0.7 artifact assumptions to v0.8 artifact usage
- `setup/src/tools/env-sync.ts`
  - now propagates `INTEROP_RELAY_ADDRESS` from `setup/.env` to:
    - `backend/.env`
    - `web-app/.env` as `VITE_INTEROP_RELAY_ADDRESS`
    - `web-app/.env` as `VITE_CHAIN_C_INTEROP_RELAY_ADDRESS`
- `setup/.env`
  - now contains `INTEROP_RELAY_ADDRESS=0x36615Cf349d7F6344891B1e7CA7C72883F5dc049`
- `setup/.env.example`
  - documented same relay address variable

### 9.3 Web app: gas fix
- `web-app/src/composables/useInteropInvoice.ts`
  - `maxPriorityFeePerGas = maxFeePerGas` on these local chains
- `web-app/src/composables/useCounterContract.ts`
  - same gas fix for counter path

### 9.4 Web app: direct local fallback
- `web-app/src/utils/sso/submitUserOpWithFallback.ts`
  - added shared bundler submit + poll + local direct fallback flow
- `web-app/src/utils/sso/sendTxWithPasskey.ts`
  - wired shared fallback path for generic SSO tx sends
- `web-app/src/composables/useInteropInvoice.ts`
  - wired invoice creation through the shared fallback path

### 9.5 Backend: direct fallback endpoint
- `backend/src/api/directUserOpRouter.ts`
  - new backend route for direct local `handleOps`
- `backend/src/utils/userops/direct-handle-ops.ts`
  - packs v0.8 user-op
  - simulates `handleOps`
  - broadcasts with backend executor key
  - extracts bundle info from logs for queueing

### 9.6 Backend: queue / invoice status fixes
- `backend/src/api/interopTxRouter.ts`
  - manual interop queue route no longer rejects generic interop txs
- `backend/src/utils/relayer/state.ts`
  - normalized address case for status matching
- `backend/src/api/invoicesRouter.ts`
  - invoice reads now use supplied `accountAddress` instead of hardcoded admin

### 9.7 Web app: invoice polling / dashboard fixes
- `web-app/src/composables/useInvoices.ts`
  - invoice polling uses current SSO account address
- `web-app/src/views/MainView.vue`
  - wait-for-chain-C polling uses current account
- `web-app/src/types/invoices.ts`
  - related type updates

### 9.8 Latest invoice-specific destination-policy fix
- `web-app/src/composables/useInteropInvoice.ts`
  - added `UNBUNDLER_ATTRIBUTE_SELECTOR = 0xb9c86698`
  - added `unbundlerAddressAttribute(...)`
  - reads relay signer from:
    - `VITE_CHAIN_C_INTEROP_RELAY_ADDRESS`
    - `VITE_INTEROP_RELAY_ADDRESS`
  - includes `[unbundlerAddressAttribute(relayAddress)]` in `sendBundle(...)`
  - includes a local-stack fallback to relay address `0x36615Cf349d7F6344891B1e7CA7C72883F5dc049` if env vars are absent and endpoints are localhost-based

## 10) Concrete Transactions / Payloads Worth Knowing
### 10.1 Fee-mismatch era
- sender: `0xef53ca7a9c3e0a226bf8c28b4486c1b906e909aa`
- observed bundler failure: legacy-fee mismatch, not AA23

### 10.2 Direct fallback proving source execution
- source tx: `0x5043c00e0c6df4e4730f0fe5a3b8cd31d10fcbe4d4fadb818493e1ce50d6b6ca`
- subsequent replay error: `AA25 invalid account nonce`
- significance: nonce was consumed, so source `handleOps` really happened

### 10.3 First backend direct endpoint proof
- source tx: `0xdd23039f71bda6c3dac287a0e3526a5e58a942de09c258ff5caa298dd503b992`
- backend log proved `POST /userops/direct-handle-ops`
- backend later recorded finalization tx:
  - `0xa5fb40e2020cd6352edd1cda9494c655d7eb4236a4b60db1c7d6a09f36730573`
- invoice still absent on chain C

### 10.4 Relay-diagnosed tx
- source tx: `0x4af7a078e22ecba5e6238859a7af075a37f8cb9f32404f02d965c88974ffcf02`
- wallet: `0xdd78e1f4865aaeff97f9f6b1c22e06347c2833b6`
- backend status later showed finalizedAt `2026-03-26T12:09:22.725Z`
- L1 finalization tx: `0x51db878131b1be07873661fd0fc0c72a9cb4858337b4e9b85f4b0c6cd581404f`
- relay container still reported A -> C FAIL
- `cast-interop bundle explain` against this tx produced the key `unbundlerAddress` mismatch diagnosis

### 10.5 Latest user-observed in-flight poll before this doc update
The user later reported the web app polling:
- `eth_getUserOperationReceipt(0xb85f4351b392542a40a03974ad4a231d0958f92476c518ab97afc0ec7ac790cc)`

At the time of this document update, that new live attempt had not yet been correlated post-patch with relay/container evidence.

### 10.6 Destination contract-level root cause after relay policy fix
After the `unbundlerAddress` patch was confirmed present in the live invoice payload, the next failure moved deeper into destination execution.

For the source tx:
- `0x16e8ac35662398265323137001704ccdec2e3553d1b9933579111ec95d5941e2`

the following chain C checks were performed:

1. `cast-interop bundle explain` on the relay container showed the bundle policy checks all passing, including:
   - `proof.sender`
   - `bundle.destinationChainId`
   - `bundle.sourceChainId`
   - `executionAddress`
   - `unbundlerAddress`
2. `cast-interop bundle relay --dry-run ... --mode execute` still reverted.
3. Extracting the bundle proved the destination call target was still `InvoicePayment.createInvoice(...)`.

That isolated the next blocker to the chain C `InvoicePayment` execution itself.

The decisive contract-level finding:
- the deployed/live interop handler on the local stack responds to `getShadowAccountAddress(uint256,address)`
- the old `InvoicePayment` source was still validating cross-chain senders using `getAliasedAccount(address,uint256)`

Concrete verification:

```bash
cast call 0x000000000000000000000000000000000001000d \
  'getShadowAccountAddress(uint256,address)(address)' \
  6565 0x04640bdd92d0da2914cc98be7ddb8b5310aa04a3 \
  --rpc-url http://localhost:3052
```

returned a valid shadow account.

But:

```bash
cast call 0x000000000000000000000000000000000001000d \
  'getAliasedAccount(address,uint256)(address)' \
  0x04640bdd92d0da2914cc98be7ddb8b5310aa04a3 6565 \
  --rpc-url http://localhost:3052
```

reverted.

That means the old chain C `InvoicePayment` contract was enforcing the wrong caller model for this interop stack.

### 10.7 Source fix applied in `InvoicePayment`
The contract source was patched so cross-chain sender validation now uses the shadow-account API:

- `contracts/src/InvoicePayment.sol`
  - `IInteropHandler.getAliasedAccount(...)` replaced with `getShadowAccountAddress(uint256,address)`
  - added `_expectedCrossChainSender(address,uint256)`
  - `createInvoice(...)` now validates the creator against the shadow account
  - `cancelInvoice(...)` now validates the creator against the shadow account
- `setup/src/tools/contracts-artifacts.ts`
  - compatibility stub for `IInteropHandler` updated the same way

### 10.8 Why redeployment initially failed: contract size limit
After fixing the contract logic, redeploying `InvoicePayment` on chain C failed with a generic execution revert.

This turned out not to be another relay bug.

The setup artifact build was producing an oversized runtime:

```bash
cd contracts
forge build --via-ir --sizes src/InvoicePayment.sol
```

reported:

- `Runtime Size (B): 25,077`
- `Runtime Margin (B): -501`

So the compiled runtime exceeded the EIP-170 limit of `24,576` bytes by `501` bytes.

This explained the otherwise opaque deployment revert during:
- `pnpm -C setup setup:3chain`
- direct deployment attempts

### 10.9 Artifact build fix for deployability
The deployable setup artifacts were then made smaller without changing the contract ABI:

- temp compatibility `foundry.toml` now sets:
  - `bytecode_hash = "none"`
  - `cbor_metadata = false`
  - `revert_strings = "strip"`
- the setup compile command now explicitly uses:
  - `forge build --via-ir --revert-strings strip --no-metadata ...`

Validated size after the change:

```bash
cd contracts
forge build --via-ir --optimizer-runs 200 --revert-strings strip --no-metadata --sizes src/InvoicePayment.sol --force
```

reported:

- `Runtime Size (B): 9,084`
- `Runtime Margin (B): 15,492`

So the deployment blocker moved from "oversized runtime" to a deployable artifact.

### 10.10 Successful chain C redeploy
After the artifact-size fix:

```bash
pnpm -C setup setup:3chain
```

completed successfully and redeployed chain C `InvoicePayment` to:

- `0xA4899D35897033b927acFCf422bc745916139776`

Post-deploy checks:

```bash
cast call 0xA4899D35897033b927acFCf422bc745916139776 'admin()(address)' --rpc-url http://localhost:3052
cast call 0xA4899D35897033b927acFCf422bc745916139776 'crossChainFee()(uint256)' --rpc-url http://localhost:3052
```

returned:

- admin = `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266`
- crossChainFee = `1000000000000000`

The new address was also synced into:
- `config/contracts.json`
- `setup/.env`
- `backend/.env`
- `web-app/.env`

Important operational note:
- if the backend or Vite dev server was already running when these env files changed, they must be restarted before a new invoice attempt will target the new chain C contract address

### 10.11 Next live attempt after redeploy: bundle still used the wrong caller mode
After the chain C contract was redeployed, a fresh invoice attempt from wallet:

- `0x3600048c15ba36272b7e07458e062c17caa50e6f`

showed that the app was correctly targeting the new chain C contract:

- destination `InvoicePayment`: `0xA4899D35897033b927acFCf422bc745916139776`
- relay signer attribute present: `0x36615Cf349d7F6344891B1e7CA7C72883F5dc049`

But the bundler still returned the same pattern:
- accepted `eth_sendUserOperation`
- returned user-op hash `0xac7f96ddf0c46340733b454557137f46638d029310e2aa0df51268e26c483e7a`
- then immediately rejected it in `filterOps` with:
  - `FailedOp(0, AA24 signature error)`

The local direct fallback then sent the source transaction successfully:

- source tx: `0xc03b94678281c923d5a2d58e6c6edb106621c1f4851834ddab2bd0818e027916`
- finalize tx: `0x97452b86494db2dec95c3c2663fb2a9ac83d65e1a41b79e5828fb1897b3d7cd5`

Backend status therefore showed the interop tx as finalized, but `/invoices` on chain C still returned zero invoices for that wallet.

### 10.12 Exact post-redeploy root cause: bundle call missing `shadowAccount()`
The decisive check for the finalized source tx was:

```bash
docker exec zksync-prividium-3chains-interop-relay-1 sh -lc \
  'cast-interop bundle extract --rpc http://chain1:3050 --tx 0xc03b94678281c923d5a2d58e6c6edb106621c1f4851834ddab2bd0818e027916 --json'
```

That showed the destination call was encoded with:

- `to = 0xa4899d35897033b927acfcf422bc745916139776`
- `from = 0x3600048c15ba36272b7e07458e062c17caa50e6f`
- `shadowAccount = false`
- bundle `unbundlerAddress` correctly set to relay signer

So the live stack had moved past:
- the relay policy bug
- the old destination contract bug

but was still generating the invoice interop bundle as a **plain direct call** instead of a **shadow-account call**.

This was then confirmed directly on chain C:

```bash
cast call 0xA4899D35897033b927acFCf422bc745916139776 \
  'createInvoice(address,uint256,address,uint256,uint256,address,address,string)(uint256)' \
  0x3600048c15ba36272b7e07458e062c17caa50e6f \
  6565 \
  0x7a2088a1bfc9d81c55368ae168c2c02570cb814f \
  1800000000000000000 \
  6565 \
  0x3600048c15ba36272b7e07458e062c17caa50e6f \
  0x3600048c15ba36272b7e07458e062c17caa50e6f \
  'adw awd awd awd' \
  --from 0x3600048c15ba36272b7e07458e062c17caa50e6f \
  --rpc-url http://localhost:3052
```

reverted.

But the same call from the shadow account succeeded:

```bash
cast call 0xA4899D35897033b927acFCf422bc745916139776 \
  'createInvoice(address,uint256,address,uint256,uint256,address,address,string)(uint256)' \
  0x3600048c15ba36272b7e07458e062c17caa50e6f \
  6565 \
  0x7a2088a1bfc9d81c55368ae168c2c02570cb814f \
  1800000000000000000 \
  6565 \
  0x3600048c15ba36272b7e07458e062c17caa50e6f \
  0x3600048c15ba36272b7e07458e062c17caa50e6f \
  'adw awd awd awd' \
  --from 0x24465d5a00c7a7A30e60ca1D2bfB25Aa732528CC \
  --rpc-url http://localhost:3052
```

returned `1`.

So the contract logic after redeploy was correct; the remaining problem was the bundle encoding on the source side.

### 10.13 Source-side fix after that discovery
The root `web-app` invoice flow was then updated to add the ERC-7786 call attribute selector for:

- `shadowAccount()`

Selector:
- `0x3569f7f7`

Updated file:
- `web-app/src/composables/useInteropInvoice.ts`

Change:
- the invoice destination call now sets:
  - `callAttributes: [shadowAccountAttribute()]`

instead of:
- `callAttributes: []`

This means future invoice bundles should encode:
- `shadowAccount = true`

for the destination `createInvoice(...)` call, which matches the current chain C `InvoicePayment` authorization model.

### 10.14 First successful end-to-end invoice after `shadowAccount()` patch
After restarting the root `web-app` and sending a new invoice from wallet:

- `0x6acaf0b6017c557e7faf2efc7632658c76d79a96`

the flow still hit the expected Alto behavior first:
- `eth_sendUserOperation` returned user-op hash `0xbce4e06aada72b5a8833d7b377e3e7cba34e4032fd7621c4d7acb434631e660f`
- bundler later rejected it in `filterOps` with `AA24 signature error`

The local direct fallback then sent the source transaction successfully:

- source tx: `0xe5371419d6d18cea87020cfae234c9b03fcf47597eb3a333c46cfb2fb8b86872`
- finalize tx: `0xa9bcfcc808bf4e658598cc354c14e2acdebc0193b7a06fa4f56aec77aee674eb`

Most importantly, the extracted bundle for that successful source tx showed:

- destination `InvoicePayment`: `0xA4899D35897033b927acFCf422bc745916139776`
- `shadowAccount = true`
- `unbundlerAddress` set to relay signer

Verification:

```bash
docker exec zksync-prividium-3chains-interop-relay-1 sh -lc \
  'cast-interop bundle extract --rpc http://chain1:3050 --tx 0xe5371419d6d18cea87020cfae234c9b03fcf47597eb3a333c46cfb2fb8b86872 --json'
```

showed:
- `bundle.calls[0].shadowAccount = true`

And chain C invoice reads for that wallet finally returned:
- `created = 1`
- `pending = 1`
- invoice id `1`
- text `awd awd adw wda`

This is the first confirmed end-to-end success for the root invoice flow on the local 3-chain stack after the combined fixes.

## 11) Validation Performed
Commands or checks already run successfully during this work:
- `pnpm --dir web-app typecheck`
- `pnpm --dir backend exec tsc --noEmit`
- `pnpm -C setup refresh:env`

Additional functional validations previously performed:
- direct dry-run of exact captured user-op via real `EntryPoint.handleOps` succeeded
- replaying the same already-mined payload returned `AA25 invalid account nonce`
- backend direct endpoint returned success for local direct submissions
- backend logs confirmed route usage
- relay container diagnostics isolated the destination-side policy failure
- `cast-interop bundle explain` proved the live bundle policy checks all passed after the unbundler patch
- `cast call ...getShadowAccountAddress(...)` succeeded while `getAliasedAccount(...)` reverted on the live interop handler
- `forge build --via-ir --sizes` proved the patched contract had exceeded runtime size by 501 bytes
- `forge build --via-ir --revert-strings strip --no-metadata --sizes` proved the deployable artifact size dropped to 9,084 bytes
- `pnpm -C setup setup:3chain` completed successfully after the artifact-size fix
- `pnpm -C setup typecheck` passed after updating the setup artifact builder
- `cast-interop bundle extract --json` on post-redeploy source tx proved the invoice call was still encoded with `shadowAccount = false`
- direct chain C simulation proved `createInvoice(...)` succeeds from the derived shadow account but reverts from the raw source wallet
- extracted bundle for source tx `0xe5371419d6d18cea87020cfae234c9b03fcf47597eb3a333c46cfb2fb8b86872` proved the post-patch live invoice flow now encodes `shadowAccount = true`
- backend `/status` and `/invoices` confirmed the invoice appeared on chain C for wallet `0x6acaf0b6017c557e7faf2efc7632658c76d79a96`

## 12) Diagnostic Commands That Were Useful
### 12.1 Bundler / permissions / chain A logs
```bash
docker logs --since 20m prividium-permissions-api-l2a 2>&1
docker logs --since 20m zksync-prividium-3chains-bundler-l2a-1 2>&1
docker logs --since 20m zkos-chain1 2>&1
```

### 12.2 Check bundler runtime args
```bash
docker inspect zksync-prividium-3chains-bundler-l2a-1 --format '{{json .Config.Cmd}}'
```

### 12.3 Replay captured user-op directly to bundler
```bash
jq -c '. + {jsonrpc:"2.0",id:999}' /tmp/userop_9782.json > /tmp/userop_9782_rpc.json

docker run --rm --network zksync-prividium-3chains_default -v /tmp:/tmp \
  curlimages/curl:8.12.1 -sS -H 'Content-Type: application/json' \
  --data @/tmp/userop_9782_rpc.json http://bundler-l2a:4337
```

### 12.4 Decode selector
```bash
cast 4byte 0xac52ccbe
# AccountAccessUnauthorized()
```

### 12.5 Relay dry-run / explain inside container
```bash
docker exec zksync-prividium-3chains-interop-relay-1 sh -lc \
  'cast-interop bundle relay --rpc-src http://chain1:3050 --rpc-dest http://chain3:3052 --tx <SOURCE_TX> --mode execute --dry-run --private-key $RELAY_PRIVATE_KEY --json'
```

```bash
docker exec zksync-prividium-3chains-interop-relay-1 sh -lc '
  tmp=$(mktemp -d) &&
  cast-interop bundle extract --rpc http://chain1:3050 --tx <SOURCE_TX> --out "$tmp/bundle.hex" >/dev/null &&
  cast-interop debug proof --rpc http://chain1:3050 --tx <SOURCE_TX> --out "$tmp/proof.json" >/dev/null &&
  cast-interop bundle explain --rpc http://chain3:3052 --bundle "$tmp/bundle.hex" --proof "$tmp/proof.json" --private-key $RELAY_PRIVATE_KEY --json
'
```

### 12.6 Direct source-chain bypass for a captured user-op
```bash
pnpm -C setup userop:direct /tmp/userop_line.json \
  --rpc-url http://127.0.0.1:3050 \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
  --broadcast
```

## 13) Important Interpretive Notes For The Next Agent
### 13.1 Do not stop at “user-op receipt succeeded”
A successful source-chain user-op does **not** prove the invoice exists on chain C.

Need all of these to be true:
1. source user-op accepted and mined
2. bundle extracted / relay work registered
3. destination relay submission succeeds
4. destination contract call executes
5. invoice reads for the actual SSO wallet show the new invoice

### 13.2 Do not trust backend “finalized” alone as destination success
This investigation already proved that backend finalization state can be present while `interop-relay` still shows A -> C failure and chain C reads show no invoice.

### 13.3 Template counter app is not a valid proof against interop issues
The template app uses the bundler too, but it never creates an interop bundle. That is why it avoided the destination-side `unbundlerAddress` failure.

### 13.4 The issue evolved through multiple masked blockers
If another agent sees historical mentions of:
- `-32601`
- `AA24`
- `AA23`
- generic `Bundler operation failed`
- false receipt lookup failures

those can all be real, but many are now superseded by later fixes. Do not assume the earliest logged blocker is still the active one.

### 13.5 Current most likely next failure mode
At the point this document was last updated, the most important already-fixed blockers were:
- bundler RPC misrouting
- gas-field mismatch on a non-EIP-1559 path
- unreliable bundler receipt path requiring direct fallback
- relay `unbundlerAddress` policy mismatch
- destination contract using `getAliasedAccount(...)` instead of `getShadowAccountAddress(...)`
- destination contract redeploy blocked by EIP-170 runtime size overflow
- source invoice bundle not marking the destination call with `shadowAccount()`

So if a brand-new attempt still fails after restarting local backend/web-app processes, treat that as a genuinely new blocker and correlate from fresh logs again.

## 13.6 Summary Of Fixes Required To Make Interop Invoices Work
The final working path required changes in multiple layers. In order:

1. Bundler RPC routing fix
   - the permissions API had to forward `eth_sendUserOperation` / `eth_getUserOperationReceipt` to the real bundler RPC instead of returning `-32601`

2. Gas-field compatibility fix for local chain A/B
   - local stack expects legacy-style pricing on this path
   - `maxPriorityFeePerGas` had to be set equal to `maxFeePerGas`

3. Direct source-chain fallback for unreliable bundler admission
   - Alto kept returning a user-op hash and then evicting the op during `filterOps` with `AA24`
   - the backend needed a local-only `EntryPoint.handleOps` fallback endpoint
   - the web app needed to call that fallback after receipt polling timeout

4. False post-fallback receipt handling fix
   - after successful direct fallback, the web app was still querying for a bundler receipt and surfacing a false error
   - that extra receipt path had to be removed from the success flow

5. Relay queue / backend status fixes
   - direct `handleOps` needed to auto-register interop txs into the backend relay/finalization flow
   - manual queue handling needed to accept interop txs
   - address normalization/status tracking bugs had to be fixed

6. Chain C invoice read fixes
   - invoice polling and dashboard reads were using the wrong account context
   - backend and frontend invoice readers had to use the actual wallet address, not the admin path

7. Relay authorization fix
   - invoice bundles needed explicit `unbundlerAddress(relaySigner)`
   - without that, `interop-relay` rejected A -> C execution even when the source tx succeeded

8. Destination contract caller-model fix
   - chain C `InvoicePayment` was validating cross-chain callers with `getAliasedAccount(...)`
   - the local stack actually uses `getShadowAccountAddress(...)`
   - `InvoicePayment` had to be patched to validate the creator via the shadow account

9. Deployability fix for the patched chain C contract
   - after the contract fix, the setup artifact exceeded EIP-170 runtime size
   - setup artifact generation had to strip metadata and revert strings so the redeployed `InvoicePayment` would fit and deploy

10. Source bundle caller-mode fix
   - even after the contract redeploy, invoice bundles were still encoded with `shadowAccount = false`
   - the root `web-app` invoice flow had to add the ERC-7786 `shadowAccount()` call attribute (`0x3569f7f7`) to the destination `createInvoice(...)` call

11. UX/runtime fallback-speed fix
   - once the technical path worked, the app was still waiting too long on dead bundler receipts
   - local receipt polling was shortened so the app falls back to direct `handleOps` much faster on this stack

Bottom line:
- source bundler submission is still unreliable on this local setup
- but interop invoice creation now works end-to-end because the app can fall back to direct source submission, and the destination bundle now executes as the sender's shadow account against the corrected chain C contract

## 14) Recommended Next Actions
1. Treat the original timeout issue as resolved on the local stack: invoice creation now succeeds end-to-end after direct fallback plus `shadowAccount()` encoding.
2. If another fresh attempt regresses, verify with `cast-interop bundle extract --json` that the destination invoice call still has `shadowAccount = true`.
3. If it still times out, capture the fresh user-op hash and source tx, then correlate:
   - backend logs
   - `interop-relay` logs
   - chain C invoice reads for the exact wallet address
4. If chain C still fails, rerun `cast-interop bundle explain` for the fresh source tx. The expected result now is that `unbundlerAddress` passes and the call is encoded with `shadowAccount = true`; any remaining failure should be a new execution issue.

## 15) Bottom Line
The investigation started as “`eth_sendUserOperation` fails” but the real story is layered:
- request routing to bundler was broken,
- bundler simulation context was broken,
- local gas pricing was wrong,
- bundler admission was still unreliable enough to need a direct local fallback,
- UI and backend status paths had secondary bugs,
- relay policy initially rejected the bundle because the invoice flow implicitly authorized the source wallet as unbundler instead of the actual relay signer,
- then the destination `InvoicePayment` contract rejected the interop caller model because it was using `getAliasedAccount(...)` instead of the live stack's `getShadowAccountAddress(...)`,
- redeploying that corrected contract initially failed because the setup artifact exceeded the runtime size limit until metadata/revert strings were stripped,
- and after redeploy the bundle itself still executed as the raw source wallet because the invoice call was missing the `shadowAccount()` call attribute.

The current live stack now includes:
- explicit relay signer `unbundlerAddress` for invoice creation
- chain C `InvoicePayment` redeployed at `0xA4899D35897033b927acFCf422bc745916139776`
- setup/backend/web-app env files synced to that new destination contract address
- source invoice bundle builder patched to add `shadowAccount()` for the destination `createInvoice(...)` call

At this point, any new timeout after restarting local processes should be treated as a fresh post-redeploy issue, not as the old relay-policy or old-contract bug.

For the current local stack, the invoice-creation issue was resolved by the combination of:
- bundler/direct-fallback handling on chain A
- explicit relay signer `unbundlerAddress`
- chain C `InvoicePayment` validation migrated to `getShadowAccountAddress(...)`
- deployable stripped artifact for the redeployed chain C contract
- source-side `shadowAccount()` call attribute on the invoice bundle
