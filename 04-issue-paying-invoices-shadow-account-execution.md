# Issue: Chain C shadow-account payment execution path

Last updated: **March 27, 2026**
Workspace: `/Users/antonio/MatterLabs/cross-border`

## 1) Objective
Provide a focused handoff document for the current blocker in invoice payment after the source-chain funding leg was added.

This note is specifically about the statement:

- "the current `shadowAccount` bundle legs are not compatible with the deployed handler path in this local stack"

and is intended to give another engineer or agent enough context to continue from the current evidence without re-running the full investigation.

## 2) Short answer to "what does that mean?"
It means the payment bundle is currently mixing two different destination-call models:

1. an **asset-router interop call** that is delivered through `receiveMessage(...)`
2. **plain contract calls** (`ERC20.approve(...)` and `InvoicePayment.payInvoice(...)`) that rely on `shadowAccount=true`

The evidence gathered on March 27, 2026 shows:

- the first leg is at least structurally plausible because `L2AssetRouter` implements `receiveMessage(...)`
- the later `shadowAccount` legs are not being executed in a way that the destination contracts can accept on this local stack

In practice:

- the relay can verify the proof
- the bundle passes destination eligibility checks
- but `executeBundle(...)` on chain C reverts before the bundle is marked received
- the revert is `CallExecutionFailed(bytes)`

So the current payment bundle shape is accepted by the source chain and relay, but the chain C execution engine does not successfully execute the destination calls inside that bundle.

## 3) Why this matters for invoice payment
The current web-app payment bundle for a cross-chain payer now tries to do 3 things in one bundle:

1. bridge the payment token from source chain B into the payer's chain C shadow account
2. call `approve(invoicePayment, MAX_UINT256)` on chain C TBILL
3. call `InvoicePayment.payInvoice(invoiceId, paymentToken)` on chain C

The live failing bundle did exactly that.

The problem is not:

- missing proof
- wrong destination chain
- wrong unbundler policy
- insufficient relay ETH

The problem is that the destination execution path itself still fails once the handler tries to execute the bundle's calls.

## 4) Exact failing live example

### 4.1 User-visible symptom
The user tried to pay invoice `2` from chain B and the web-app timed out with:

- `Timed out waiting for invoice 2 to reach paid.`

### 4.2 Source tx
The relevant chain B source tx was:

- `0x25c3d960bb87ce5483ab47eb2a6c55de3b59490f3f5c89af4357f6999471963e`

It succeeded on chain B.

### 4.3 Extracted bundle
Using the relay container CLI:

```bash
docker exec zksync-prividium-3chains-interop-relay-1 sh -lc \
  'cast-interop bundle extract --rpc http://chain2:3051 \
    --tx 0x25c3d960bb87ce5483ab47eb2a6c55de3b59490f3f5c89af4357f6999471963e \
    --json'
```

Produced:

- `bundleHash = 0x78508aff247c61a3c6c9da167f84bfabde5b937cfc809ea62c3cd30ccef3ea33`

Decoded bundle summary:

1. Call 0
   - `shadowAccount = false`
   - `to = 0x0000000000000000000000000000000000010003` (`L2AssetRouter`)
   - `from = 0x0000000000000000000000000000000000010003`
   - `data = finalizeDeposit(...)`
   - semantic intent: bridge TBILL into the payer's chain C shadow account

2. Call 1
   - `shadowAccount = true`
   - `to = 0x70e0bA845a1A0F2DA3359C97E0285013525FFC49` (chain C TBILL)
   - `from = 0x54ca918c285bc6481689769b6cf4dd5e5ce3e83f`
   - `data = approve(0x4A679253410272dd5232B3Ff7cF5dbB88f295319, MAX_UINT256)`

3. Call 2
   - `shadowAccount = true`
   - `to = 0x4A679253410272dd5232B3Ff7cF5dbB88f295319` (`InvoicePayment`)
   - `from = 0x54ca918c285bc6481689769b6cf4dd5e5ce3e83f`
   - `data = payInvoice(2, 0x70e0bA845a1A0F2DA3359C97E0285013525FFC49)`

Bundle attributes:

- `unbundlerAddress = 0x00010000001436615cf349d7f6344891b1e7ca7c72883f5dc049`

which is the expected relay signer policy.

## 5) What the relay/container proved

### 5.1 Relay dashboard symptom
`docker logs zksync-prividium-3chains-interop-relay-1` showed:

- `B→C 0x25c3d9…96 FAIL transaction submission failed: server returned an error response: error code …`

The dashboard truncates the useful error body.

### 5.2 Proof and bundle policy are valid
Using:

```bash
cast-interop debug proof ...
cast-interop bundle explain ...
```

the following checks all returned `ok`:

- `proof.sender`
- `bundle.destinationChainId`
- `bundle.sourceChainId`
- `executionAddress`
- `unbundlerAddress`

So this is **not** the earlier unbundler mismatch issue.

### 5.3 Bundle status on chain C
Using:

```bash
cast-interop bundle status --rpc http://chain3:3052 \
  --bundle-hash 0x78508aff247c61a3c6c9da167f84bfabde5b937cfc809ea62c3cd30ccef3ea33 \
  --bundle /tmp/fail.bundle --json
```

returned:

- `bundleStatus = Unreceived`
- all 3 calls `Unprocessed`

So nothing was partially executed or recorded.

### 5.4 Direct dry-run on chain C
This was the key command:

```bash
cast-interop bundle execute --rpc http://chain3:3052 \
  --bundle /tmp/fail.bundle \
  --proof /tmp/fail.proof \
  --private-key 0x7726827caac94a7f9e1b160f7ea819f172f7b6f9d2a97f992c38edeab82d4110 \
  --dry-run
```

Result:

- `unknown revert selector 0x7c275c9c`
- then resolved as `CallExecutionFailed(bytes)`
- raw revert body:
  - `0x7c275c9c00000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000000`

Interpretation:

- `verifyBundle(...)` succeeds
- `executeBundle(...)` fails while executing one of the nested calls
- the nested revert payload is empty

That means the destination handler only knows that a call failed, not which call failed or why.

## 6) Strongest architectural finding

### 6.1 InteropHandler execution model in checked-in source
The checked-in local-stack source at:

- `/Users/antonio/MatterLabs/cross-border/contracts/lib/era-contracts/l1-contracts/contracts/interop/InteropHandler.sol`

shows `_executeCalls(...)` doing this for each destination call:

```solidity
bytes4 selector = IERC7786Recipient(interopCall.to).receiveMessage{value: interopCall.value}(...)
require(selector == IERC7786Recipient.receiveMessage.selector, InvalidSelector(selector));
```

This is important:

- it calls `receiveMessage(...)` on the destination target contract
- there is no visible branch in this checked-in source that handles `interopCall.shadowAccount == true`
- there is no visible alternate path that says "perform a raw call from the shadow account"

### 6.2 Destination contract compatibility
Two destination targets in the payment bundle are **not** ERC-7786 recipients:

1. `/Users/antonio/MatterLabs/cross-border/contracts/src/InvoicePayment.sol`
   - does **not** implement `receiveMessage(...)`

2. the chain C TBILL ERC20 token
   - also is not an ERC-7786 recipient contract

That means a handler implementation that always routes calls through `IERC7786Recipient.receiveMessage(...)` cannot directly execute:

- `approve(...)` on the token
- `payInvoice(...)` on the invoice contract

### 6.3 Why the asset-router leg is different
`L2AssetRouter` does implement `receiveMessage(...)`:

- `/Users/antonio/MatterLabs/cross-border/contracts/lib/era-contracts/l1-contracts/contracts/bridge/asset-router/L2AssetRouter.sol`

Its `receiveMessage(...)` is designed to accept a cross-chain payload whose selector is `finalizeDeposit(...)`.

So call 0 in the bundle is consistent with the handler's checked-in execution model.

Calls 1 and 2 are not.

## 7) The meaning of "not compatible"
The phrase means:

- the bundle is encoding the later payment steps as if chain C supports a shadow-account execution primitive for arbitrary contract calls
- but the local chain C handler path we inspected still appears to execute destination calls by asking the target contract to implement `receiveMessage(...)`
- the invoice contract and token contract do not expose that interface

So those calls are not "wrong Solidity calldata", but they are likely being delivered through the wrong interop primitive for this stack.

## 8) Important source / deployment mismatch to keep in mind
There is a notable inconsistency that another agent should verify early:

### 8.1 Extracted live bundle clearly contains `shadowAccount = true`
The live extracted bundle had:

- call 1: `shadowAccount = true`
- call 2: `shadowAccount = true`

### 8.2 Checked-in `InteropCenter.sol` does not visibly parse `shadowAccount()`
The checked-in source at:

- `/Users/antonio/MatterLabs/cross-border/contracts/lib/era-contracts/l1-contracts/contracts/interop/InteropCenter.sol`

shows supported call/bundle attributes as:

- `interopCallValue`
- `indirectCall`
- `executionAddress`
- `unbundlerAddress`
- `useFixedFee`

and does **not** visibly include `shadowAccount()`.

### 8.3 Why this matters
Either:

1. the deployed local-stack contracts are newer/different than the source file inspected here
2. there is another source/artifact path actually used by the local chains
3. `shadowAccount` is only reflected in emitted bundle structure but still not properly executed by the destination handler

This mismatch is important context for anyone trying to fix the issue.

## 9) Additional separate issue discovered during this investigation
The UI was also allowing the wrong wallet to attempt payment.

Concrete case:

- invoice `2` was pending for `recipientRefundAddress = 0x646FfD148a66e868cF1f2D94b84C09F61Be57812`
- the source tx was submitted by `0x54ca918c285bc6481689769b6cf4dd5e5ce3e83f`

On chain C:

```bash
cast call <InvoicePayment> "getUserPendingInvoiceCount(address)(uint256)" 0x54ca...
```

returned:

- `0`

while:

```bash
cast call <InvoicePayment> "getUserPendingInvoiceCount(address)(uint256)" 0x646F...
```

returned:

- `1`

That means this particular attempt was coming from the wrong payer identity even before the deeper handler-execution issue.

The web-app was patched in this workspace to block that case earlier.

## 10) Commands and exact results worth reusing

### 10.1 Extract the failing bundle
```bash
docker exec zksync-prividium-3chains-interop-relay-1 sh -lc \
  'cast-interop bundle extract --rpc http://chain2:3051 \
    --tx 0x25c3d960bb87ce5483ab47eb2a6c55de3b59490f3f5c89af4357f6999471963e \
    --json'
```

### 10.2 Get the proof
```bash
docker exec zksync-prividium-3chains-interop-relay-1 sh -lc \
  'cast-interop debug proof --rpc http://chain2:3051 \
    --tx 0x25c3d960bb87ce5483ab47eb2a6c55de3b59490f3f5c89af4357f6999471963e \
    --json'
```

### 10.3 Explain destination eligibility
```bash
docker exec zksync-prividium-3chains-interop-relay-1 sh -lc \
  'cast-interop bundle explain --rpc http://chain3:3052 \
    --bundle /tmp/fail.bundle \
    --proof /tmp/fail.proof \
    --private-key 0x7726827caac94a7f9e1b160f7ea819f172f7b6f9d2a97f992c38edeab82d4110 \
    --json'
```

### 10.4 Dry-run actual execution
```bash
docker exec zksync-prividium-3chains-interop-relay-1 sh -lc \
  'cast-interop bundle execute --rpc http://chain3:3052 \
    --bundle /tmp/fail.bundle \
    --proof /tmp/fail.proof \
    --private-key 0x7726827caac94a7f9e1b160f7ea819f172f7b6f9d2a97f992c38edeab82d4110 \
    --dry-run'
```

Expected result right now:

- `CallExecutionFailed(bytes)`

### 10.5 Confirm selector
```bash
cast 4byte 0x7c275c9c
```

Result:

- `CallExecutionFailed(bytes)`

## 11) What another agent should investigate next

### 11.1 First: identify the real shadow-account execution primitive in this local stack
The next agent should answer:

- how is `shadowAccount=true` actually supposed to execute on chain C?
- which contract is supposed to receive those calls?
- is there a wrapper/executor contract missing from the bundle?
- is the target supposed to be the shadow account itself rather than the token / invoice contract?

Good places to inspect:

- `/Users/antonio/MatterLabs/cross-border/backend/src/utils/abis/L2InteropCenter.json`
- `/Users/antonio/MatterLabs/cross-border/prividium-3chain-local/sdk/src/bundle-builder.ts`
- any deployed artifact or ABI in the local-stack repo that references:
  - `shadowAccountOps`
  - shadow-account execution
  - direct arbitrary calls from shadow accounts

### 11.2 Second: resolve checked-in source vs deployed-stack mismatch
Specifically:

- why do extracted bundles carry `shadowAccount=true`
- but the checked-in `InteropCenter.sol` inspected here does not visibly parse `shadowAccount()`
- and the checked-in `InteropHandler.sol` does not visibly branch on `interopCall.shadowAccount`

That mismatch likely explains why this took longer to pin down.

### 11.3 Third: decide the correct fix shape
Plausible categories:

1. change payment bundles so all destination steps use contracts that implement `receiveMessage(...)`
2. route the approve/pay steps through a destination-side wrapper that is ERC-7786-compatible and then performs the raw calls
3. use the actual shadow-account execution primitive if the local stack already supports one but the web-app is encoding it incorrectly
4. split payment into multiple phases if one-bundle shadow-account execution is not supported in the current deployed stack

## 12) Current code state in this workspace
The following frontend guardrails were added after this investigation:

- `/Users/antonio/MatterLabs/cross-border/web-app/src/composables/useInvoices.ts`
- `/Users/antonio/MatterLabs/cross-border/web-app/src/components/InvoiceTableCard.vue`
- `/Users/antonio/MatterLabs/cross-border/web-app/src/composables/useInteropInvoice.ts`
- `/Users/antonio/MatterLabs/cross-border/web-app/src/views/MainView.vue`
- `/Users/antonio/MatterLabs/cross-border/web-app/src/types/invoices.ts`

Those changes do **not** fix the chain C execution model.

They only:

- prevent unrelated invoices from appearing in the local "all" view
- prevent a wallet from trying to pay an invoice whose `recipientRefundAddress` does not match the active passkey account

## 13) Practical current conclusion
As of March 27, 2026:

- source-chain funding + approval submission is working well enough to emit the payment bundle
- relay proofing and unbundler permissions are not the blocker
- chain C execution still fails at the destination-call layer
- the strongest current theory is that the `approve(...)` and `payInvoice(...)` `shadowAccount` calls are encoded for a destination execution primitive that the deployed local stack is not actually performing the way the web-app expects

## 14) March 27 follow-up after split settlement diagnosis

After the backend relayer was fixed to be source-chain aware, the settlement path was isolated further with a dedicated diagnostic script:

- `/Users/antonio/MatterLabs/cross-border/prividium-3chain-local/sdk/examples/invoice-settlement-diagnostics.ts`

The script sends two separate B→C bundles against live invoice `3`:

1. `approve(...)` only
2. `payInvoice(...)` only

using a fresh diagnostic payer on chain B and that payer's chain C shadow account.

### 14.1 Approve-only succeeds

Approve-only diagnostic:

- source tx: `0x521d569dda223f5ddcf6d35c909fc207ecdf130837d8a1d6c09b8769dead5991`
- bundle hash: `0xdd73e90437ac22de834dc9eba4aa271c32baa64ae2a822b119edf87b86e59ce8`
- relay result: `B→C ... DONE`

After that bundle executed, chain C allowance on the diagnostic shadow account was:

- `115792089237316195423570985008687907853269984665640564039457584007913129639935`

for:

- token: `0x9E545E3C0baAB3E08CdfD552C960A1050f373042`
- owner: `0x1B6EbB7fDB9480C26E1b95Ccf24092e207aac844`
- spender: `0x4A679253410272dd5232B3Ff7cF5dbB88f295319`

That proves a standalone B→C shadow-account `approve(...)` works on this stack.

### 14.2 Pay-only still fails with the same destination execution error

Pay-only diagnostic:

- source tx: `0x3d8a49db5d86679a2cd93ffe7c556fd7edd16e7103ccaf4502b6841c608899f8`
- bundle hash: `0x61810ec1f25aa29a323d6f0fa3235f79f07a9e74fc3902797d6791befbdf6b15`
- relay result: `B→C ... FAIL`

Manual destination execution then reverted during gas estimation with the same custom error shape seen before:

- selector: `0x7c275c9c`
- decoded as: `CallExecutionFailed(bytes)`
- nested revert payload: empty

Invoice `3` remained unchanged on chain C:

- `status = 0`
- `paymentToken = 0x0000000000000000000000000000000000000000`
- `paidAt = 0`

### 14.3 Updated conclusion

This narrows the problem materially:

- generic shadow-account arbitrary calls are **not** broken, because `approve(...)` succeeds
- the remaining failure is specifically on the `InvoicePayment.payInvoice(...)` destination leg
- because `payInvoice(...)` for invoice `3` performs a nested payout back out of chain C, the most likely fault domain is now:
  - `InvoicePayment.payInvoice(...)` itself under shadow-account delivery
  - or its nested `_transferTokens(...)` / asset-router path
  - not the generic shadow-account `approve(...)` primitive

So the best next investigation is no longer "does shadow-account execution work at all?"

It is:

- why does `InvoicePayment.payInvoice(...)` revert when delivered as a standalone B→C shadow-account call
- and whether the nested cross-chain payout path from chain C back to chain A is what triggers `CallExecutionFailed(bytes)`
