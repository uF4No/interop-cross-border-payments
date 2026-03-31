# Issue: Paying invoices via deferred payout release

**Important:** This issue was fixed.

Last updated: **March 27, 2026**
Workspace: `/Users/antonio/MatterLabs/cross-border`

## 1) Objective

Document the final diagnosis and the implemented fix for the invoice payment flow after:

- the backend relayer was made multi-chain aware
- the web app payment flow was split into funding and settlement
- funding was confirmed to work
- settlement was isolated to the shadow-account `payInvoice(...)` leg

This note is meant to let another engineer resume from the current working state without re-running the full investigation.

## 2) Final diagnosis

The original one-bundle / one-call mental model was wrong for this local stack.

### 2.1 What actually works

- cross-chain invoice creation into chain C works
- chain B funding of the payer shadow account on chain C works
- shadow-account `approve(...)` on chain C works
- shadow-account `payInvoice(...)` can work once the nested creator payout is removed from the same execution path
- backend relayer finalization now works correctly for both chain A and chain B source transactions

### 2.2 What did not work

The failing path was not "payment in general". It was this more specific shape:

1. pay invoice on chain C
2. inside that same `payInvoice(...)` call, immediately send the billed token back out of chain C to the creator's home chain

That nested cross-chain payout was the brittle part.

### 2.3 Strongest evidence

The debugging path established all of the following:

- a funding-only payment attempt succeeded
- an `approve`-only shadow-account bundle from B to C succeeded
- a `payInvoice`-only shadow-account bundle from B to C failed
- after splitting the contract flow further, the invoice could be marked `Paid` on chain C
- a direct contract-originated deferred payout attempt still reverted, but this time inside the chain C `InteropCenter` call itself

The last point was the decisive one:

- contract-originated `requestInterop(...)` from `InvoicePayment` was not a reliable source-chain primitive for this stack
- wallet-originated bridging through the normal asset-router / bundle path was reliable

So the correct architecture for this stack is:

- chain C invoice contract handles payment and escrow
- a wallet-level operator handles the follow-up cross-chain payout

## 3) Implemented design

The fix that is now implemented is a deferred payout release model.

### 3.1 On-chain behavior

In `contracts/src/InvoicePayment.sol`:

- `payInvoice(...)` still:
  - verifies invoice state
  - pulls payment tokens from the payer
  - records the invoice as `Paid`
- if the creator is local to chain C:
  - billing tokens are transferred directly to the creator refund address as before
- if the creator is on another chain:
  - the invoice is marked paid
  - billing tokens remain on chain C inside `InvoicePayment`
  - no nested interop is attempted from `payInvoice(...)`

Then a new follow-up step exists:

- `triggerCreatorPayout(invoiceId)`
  - verifies the invoice is paid
  - verifies creator payout is not already initiated
  - transfers the billed amount in the billing token to a configured `payoutOperator`
  - marks `creatorPayoutInitiated[invoiceId] = true`

The contract now also stores:

- `address public payoutOperator`

and exposes:

- `setPayoutOperator(address)`

### 3.2 Off-chain behavior

The backend now contains a payout worker that preserves one-click UX for the payer.

The worker:

1. scans chain C invoices
2. finds invoices that are:
   - `Paid`
   - creator chain is not chain C
3. calls `triggerCreatorPayout(invoiceId)` on chain C
4. once the payout operator has received the released billing tokens on chain C:
   - submits a normal wallet-originated interop bundle from chain C to the creator chain
5. adds that bridge tx to the existing relayer queue for source finalization tracking

This means:

- the payer still pays once from the web app
- creator payout continues asynchronously in the backend
- the cross-chain step is now performed by a wallet/operator path that this stack already supports

## 4) Files changed

### 4.1 Contract

- `contracts/src/InvoicePayment.sol`

Main changes:

- added `payoutOperator`
- added `setPayoutOperator(address)`
- added `creatorPayoutInitiated`
- refactored payment bookkeeping into smaller internal helpers
- changed cross-chain creator settlement from "nested interop in `payInvoice`" to "release to payout operator via `triggerCreatorPayout`"

### 4.2 Backend

- `backend/src/server.ts`
- `backend/src/utils/constants.ts`
- `backend/src/utils/payouts/state.ts`
- `backend/src/utils/payouts/processor.ts`

Main changes:

- added invoice payout persistence file:
  - `backend/src/utils/txn-state/invoice-payouts.json`
- added payout worker to background loop
- added chain C invoice scanning
- added payout release call
- added operator bridge submission from chain C to creator chain
- re-used existing relayer queue for finalization tracking of payout bridge txs

### 4.3 Smoke test

- `prividium-3chain-local/sdk/examples/invoice-interop-smoke.ts`

Scenario 4 now tests:

1. create invoice from chain A into chain C
2. pay invoice from chain B into chain C
3. assert invoice is marked `Paid`
4. trigger deferred payout release on chain C
5. bridge released payout from chain C into chain A
6. assert creator balance on chain A increases by the invoice amount

## 5) Smoke test result

The updated smoke test passed end to end.

### 5.1 Command used

From:

- `/Users/antonio/MatterLabs/cross-border/prividium-3chain-local`

Command:

```bash
./scripts/run-invoice-interop-smoke.sh
```

### 5.2 Key successful outcome

Scenario 4 completed successfully:

- invoice created from A into C
- invoice paid from B into C
- chain C invoice became `Paid`
- released payout was bridged from chain C into chain A
- creator received:
  - `75.0 SGD`

Final smoke output ended with:

- `Invoice interop smoke passed.`

## 6) Why this design is the right one for this stack

This design avoids the exact class of failure that blocked the feature:

- no contract-originated nested interop inside `payInvoice(...)`
- no requirement for `InvoicePayment` itself to act as a reliable interop source
- no attempt to force a complex destination call tree through the shadow-account path

Instead, it uses the primitives that the local stack demonstrably supports:

- shadow-account destination execution for the invoice payment itself
- wallet-originated bridge bundles for cross-chain token transfer
- backend relayer finalization for those bridge bundles

## 7) Deployment status

The code is implemented and verified in smoke, but the live local stack is not automatically using it yet unless chain C `InvoicePayment` is redeployed from the updated artifact and configuration is refreshed.

### 7.1 Important current limitation

The currently running chain C `InvoicePayment` deployment in the local stack may still be the old contract.

So until redeployment/update happens:

- the web app can still hit the previously deployed contract
- the new deferred payout behavior will not be live

## 8) Deployment options discovered

### 8.1 There is no dedicated first-class command today for "redeploy only InvoicePayment"

There is reusable code for that inside:

- `setup/src/tools/three-chain-setup.ts`

but there is no standalone script such as:

- `pnpm setup:invoice`

at the time of writing.

### 8.2 Supported canonical path

The canonical setup flow is:

```bash
cd setup
pnpm run setup:3chain
```

This path:

- deploys / ensures contracts
- updates `config/contracts.json`
- syncs backend and web-app env files

Important implementation detail:

- the setup code is incremental
- for existing contract addresses, it checks whether code already exists
- if code exists, it reuses the existing deployment instead of blindly redeploying everything

That logic is in:

- `setup/src/tools/three-chain-setup.ts`

### 8.3 Practical implication

If the goal is to redeploy only `InvoicePayment` via the canonical setup path, a practical approach is:

1. remove or invalidate `chains.c.invoicePayment` in `config/contracts.json`
2. rerun:

```bash
cd setup
pnpm run setup:3chain
```

That should cause:

- chain A / B SSO and token deployments to be reused if still present
- chain C token deployments to be reused if still present
- `InvoicePayment` to be redeployed on chain C because its configured address is no longer valid / present
- config and env files to be updated automatically

### 8.4 Legacy path

There are legacy shell scripts:

- `contracts/scripts/deploy.sh`
- `contracts/scripts/part.sh`

These do contain manual `InvoicePayment` deployment / funding / whitelist / exchange-rate steps.

However:

- they are not the canonical source-of-truth path anymore
- they do not appear to be the preferred config/env sync mechanism

So they should be treated as fallback/manual tooling, not the recommended deployment route.

## 9) Recommended next step

The recommended operational path is:

1. redeploy chain C `InvoicePayment` using the canonical setup flow
2. restart backend so the payout worker is active against the new deployment
3. test one invoice payment from the web app
4. confirm:
   - invoice becomes `Paid`
   - payout worker releases and bridges the creator payout
   - creator receives funds on the origin chain

## 10) Recommended future improvement

Add a dedicated setup command:

- `pnpm setup:invoice`

It should:

1. build / ensure artifacts
2. deploy only `InvoicePayment` on chain C
3. fund it with ETH
4. ensure billing-token liquidity is present
5. whitelist tokens
6. set exchange rates
7. optionally set `payoutOperator`
8. update `config/contracts.json`
9. sync backend/web-app env files

That would remove the need to rely on a partial rerun of `setup:3chain`.

## 11) Verification commands used during this work

### 11.1 Contract artifact regeneration

From:

- `/Users/antonio/MatterLabs/cross-border/setup`

Command:

```bash
pnpm exec tsx -e "(async () => { const mod = await import('./src/tools/contracts-artifacts.ts'); await mod.ensureContractsArtifacts('../contracts'); })().catch((error) => { console.error(error); process.exit(1); });"
```

### 11.2 Backend build

From:

- `/Users/antonio/MatterLabs/cross-border/backend`

Command:

```bash
pnpm build
```

### 11.3 SDK typecheck

From:

- `/Users/antonio/MatterLabs/cross-border/prividium-3chain-local/sdk`

Command:

```bash
npx tsc --noEmit
```

### 11.4 Smoke test

From:

- `/Users/antonio/MatterLabs/cross-border/prividium-3chain-local`

Command:

```bash
./scripts/run-invoice-interop-smoke.sh
```

## 12) Bottom line

The feature is now implemented in a form that matches the capabilities of this local stack.

The key architectural shift is:

- invoice payment and creator payout are no longer the same on-chain step

Instead:

- `payInvoice(...)` finalizes payment on chain C
- backend automation handles the creator payout bridge afterwards

That keeps payer UX effectively one click while avoiding the nested interop path that was failing.
