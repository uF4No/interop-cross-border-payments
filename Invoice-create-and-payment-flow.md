# Invoice Creation And Payment Flow

Last updated: **March 27, 2026**
Workspace: `/Users/antonio/MatterLabs/cross-border`

## Purpose

This document explains how invoice creation and payment work in the current implementation from:

- the wallet / smart-account point of view
- the token-flow point of view
- the interop-message point of view
- the backend / worker / relay point of view

It describes the flow that is currently implemented in this repository, including the deferred creator payout model that replaced the earlier failing nested payout design.

## Short Version

There are now 3 distinct cross-chain behaviors in the invoice system:

1. **Create invoice**
   - a user wallet on chain A or B sends an interop bundle to chain C
   - chain C creates the invoice in `InvoicePayment`
   - no ERC20 tokens move during creation

2. **Pay invoice**
   - the payer wallet on chain A or B first funds its deterministic chain C shadow account with the payment token
   - then the payer wallet sends a second interop bundle to make that shadow account `approve(...)` and call `payInvoice(...)` on chain C
   - `InvoicePayment` marks the invoice as paid and keeps the billed token on chain C if the creator lives on another chain

3. **Creator payout**
   - a backend worker on chain C releases the billed token from `InvoicePayment` to a backend-controlled payout operator wallet
   - that wallet submits a normal chain C -> creator-chain interop token bridge
   - after L1 finalization and destination execution, the creator receives the billed token on their home chain

The practical consequence is:

- **invoice creation** is wallet-driven
- **invoice payment** is wallet-driven
- **cross-chain creator payout after payment** is backend-driven

## Main Components

### Contracts

- **`InvoicePayment` on chain C**
  - file: [contracts/src/InvoicePayment.sol](/Users/antonio/MatterLabs/cross-border/contracts/src/InvoicePayment.sol)
  - stores invoices
  - accepts invoice creation and payment
  - releases creator payouts to a payout operator when the creator is on another chain

- **`InteropCenter` on each source chain**
  - address in this stack: `0x0000000000000000000000000000000000010010`
  - receives `sendBundle(...)` from the source chain
  - emits the interop bundle that is later finalized and executed

- **`InteropHandler` on destination chains**
  - local stack address on chain C: `0x000000000000000000000000000000000001000d`
  - resolves deterministic shadow accounts with `getShadowAccountAddress(...)`

- **`L2AssetRouter` / native token vault**
  - used for cross-chain token movement
  - local stack addresses:
    - asset router: `0x0000000000000000000000000000000000010003`
    - native token vault: `0x0000000000000000000000000000000000010004`

### Frontend

- **`useInteropInvoice.ts`**
  - file: [web-app/src/composables/useInteropInvoice.ts](/Users/antonio/MatterLabs/cross-border/web-app/src/composables/useInteropInvoice.ts)
  - builds the interop bundles used by create and pay
  - submits user operations from the current SSO smart account

### Backend

- **UserOp fallback**
  - file: [backend/src/utils/userops/direct-handle-ops.ts](/Users/antonio/MatterLabs/cross-border/backend/src/utils/userops/direct-handle-ops.ts)
  - used only if the bundler path fails in local development

- **Interop finalization worker**
  - files:
    - [backend/src/utils/relayer/relayer.ts](/Users/antonio/MatterLabs/cross-border/backend/src/utils/relayer/relayer.ts)
    - [backend/src/utils/relayer/finalize.ts](/Users/antonio/MatterLabs/cross-border/backend/src/utils/relayer/finalize.ts)
  - polls pending source-chain interop txs
  - gets L2->L1 proofs
  - sends L1 finalization transactions

- **Invoice payout worker**
  - file: [backend/src/utils/payouts/processor.ts](/Users/antonio/MatterLabs/cross-border/backend/src/utils/payouts/processor.ts)
  - scans paid invoices on chain C
  - releases creator payouts
  - submits the creator payout bridge from chain C to the creator chain

### Local Stack Services

- **3 L2 chains**
  - A = `6565`
  - B = `6566`
  - C = `6567`

- **Interop relay container**
  - service described in [prividium-3chain-local/README.md](/Users/antonio/MatterLabs/cross-border/prividium-3chain-local/README.md)
  - this is the runtime service that picks up finalized messages and executes them on the destination chain

Important clarification:

- there is **no "interop-center container"**
- `InteropCenter` is a **contract**
- the relevant runtime service is the **interop relay container**

## Important Accounts And Addresses

### 1. Source user wallet

This is the user's SSO smart account on chain A or B.

It is the account that:

- signs the create-invoice interop bundle
- signs the funding interop bundle during payment
- signs the settlement interop bundle during payment

### 2. Destination shadow account on chain C

For cross-chain calls, the stack derives a deterministic chain C address for the source account:

- file: [web-app/src/composables/useInteropInvoice.ts](/Users/antonio/MatterLabs/cross-border/web-app/src/composables/useInteropInvoice.ts)
- call: `getShadowAccountAddress(sourceChainId, payerRefundAddress)`

This shadow account is important because:

- invoices created cross-chain record the creator as the creator's chain C shadow account
- payment settlement runs `approve(...)` and `payInvoice(...)` from the payer's chain C shadow account
- funding moves tokens into this shadow account first

### 3. `InvoicePayment` contract on chain C

This contract is the accounting center for the invoice system:

- invoice metadata is stored here
- payer payment tokens are collected here
- billed tokens are transferred from here
- for cross-chain creators, payout remains escrowed here until released

### 4. Backend payout operator wallet

This is the backend executor wallet:

- loaded from `EXECUTOR_PRIVATE_KEY`
- exported in code as `executorAccount`
- file: [backend/src/utils/client.ts](/Users/antonio/MatterLabs/cross-border/backend/src/utils/client.ts)

For cross-chain creator payouts, this wallet:

- calls `triggerCreatorPayout(invoiceId)` on chain C
- receives the released billed tokens on chain C
- bridges them to the creator's home chain

## Flow 1: Creating An Invoice

### What the user does

The creator uses the web app while connected to chain A or B and submits an invoice form.

### Which wallet signs

The creator's source-chain SSO smart account signs one user operation.

That user operation calls source-chain `InteropCenter.sendBundle(...)`.

### What the frontend sends

The create flow is implemented in:

- [web-app/src/composables/useInteropInvoice.ts](/Users/antonio/MatterLabs/cross-border/web-app/src/composables/useInteropInvoice.ts)
  - `sendCreateInvoiceBundle(...)`

The destination bundle contains one destination call:

1. `InvoicePayment.createInvoice(...)` on chain C

The call is tagged with the `shadowAccount` attribute so chain C executes it as the creator's shadow account.

### Token movement during creation

There is **no token movement** during invoice creation.

No ERC20 is transferred:

- not from the creator wallet
- not into chain C
- not out of chain C

Creation only writes invoice metadata on chain C.

### What gets stored on chain C

`InvoicePayment.createInvoice(...)` stores:

- `creator`
  - the msg.sender on chain C
  - for cross-chain creation, this is the creator's chain C shadow account
- `creatorRefundAddress`
  - the creator's real wallet/account on their home chain
- `creatorChainId`
- `recipient`
- `recipientRefundAddress`
- `recipientChainId`
- `billingToken`
- `amount`
- `text`

The key distinction is:

- `creator` is the chain C execution identity
- `creatorRefundAddress` is the wallet that should actually receive funds back on the creator's home chain

### Backend involvement during creation

There is **no business-logic backend step required** to create the invoice.

Backend involvement is limited to:

- optional local fallback if the bundler path fails
  - [web-app/src/utils/sso/submitUserOpWithFallback.ts](/Users/antonio/MatterLabs/cross-border/web-app/src/utils/sso/submitUserOpWithFallback.ts)
  - [backend/src/utils/userops/direct-handle-ops.ts](/Users/antonio/MatterLabs/cross-border/backend/src/utils/userops/direct-handle-ops.ts)
- invoice reads for the dashboard
  - [backend/src/api/invoicesRouter.ts](/Users/antonio/MatterLabs/cross-border/backend/src/api/invoicesRouter.ts)

### Interop / relay involvement during creation

Yes, creation depends on the interop stack:

1. source wallet submits `sendBundle(...)` to source-chain `InteropCenter`
2. source chain emits the interop message
3. backend relayer finalizes the L2->L1 message
4. the interop relay container picks it up
5. destination execution happens on chain C
6. `InvoiceCreated` is emitted on chain C

So invoice creation **does rely on the interop relay container**, even though the app itself does not need a backend payout worker for this step.

## Flow 2: Paying An Invoice

The payment flow is now intentionally split into stages.

This split exists because the earlier single-bundle payment flow was too hard to debug and failed when funding, approval, and payment were all attempted together.

## 2A. Payment Stage 1: Fund The Payer Shadow Account On Chain C

### Why this stage exists

`payInvoice(...)` executes on chain C.

That means the payer needs the payment token on chain C first.

The source wallet's token balance on chain A or B is not enough by itself.

### Which wallet signs

The payer's source-chain SSO smart account on chain A or B signs the funding user operation.

### What the frontend sends

The funding stage is implemented in:

- [web-app/src/composables/useInteropInvoice.ts](/Users/antonio/MatterLabs/cross-border/web-app/src/composables/useInteropInvoice.ts)
  - `sendFundPayInvoiceBundle(...)`

The frontend:

1. resolves the payer's deterministic chain C shadow account
2. reads its current token balance on chain C
3. computes the missing amount
4. if needed, approves the source-chain native token vault
5. sends an interop bundle that transfers the missing amount to the chain C shadow account

### Token movement during funding

This is the first point where tokens move.

The flow is:

1. source-chain payer wallet holds the payment token on chain A or B
2. source-chain payer wallet approves the source native token vault if needed
3. `InteropCenter.sendBundle(...)` sends a token-transfer call to the destination chain
4. the destination asset-router flow credits the payer's chain C shadow account

After this stage:

- source-chain payer balance decreases
- chain C shadow-account balance increases

### Intermediate account used during funding

Yes. The intermediate holding account is:

- the payer's deterministic **chain C shadow account**

The payment is **not** sent directly from the source chain into `InvoicePayment`.

It is first parked in the payer's chain C shadow account.

### Backend involvement during funding

Again, there is no backend business logic required to decide funding.

Backend involvement is only:

- optional direct-handle-ops fallback if bundler submission fails locally
- relayer finalization of the source interop tx

### Interop / relay involvement during funding

Yes. Funding depends on:

- source-chain `InteropCenter`
- L2->L1 finalization
- interop relay container
- destination asset-router execution on chain C

## 2B. Payment Stage 2: Approve And Pay On Chain C

### Which wallet signs

The payer's source-chain SSO smart account signs a second user operation.

### What the frontend sends

The settlement stage is implemented in:

- [web-app/src/composables/useInteropInvoice.ts](/Users/antonio/MatterLabs/cross-border/web-app/src/composables/useInteropInvoice.ts)
  - `sendSettlePayInvoiceBundle(...)`

The destination bundle contains two calls on chain C:

1. `ERC20.approve(InvoicePayment, MAX_UINT256)`
   - executed from the payer's chain C shadow account
2. `InvoicePayment.payInvoice(invoiceId, paymentToken)`
   - executed from the payer's chain C shadow account

### Token movement during settlement

When `payInvoice(...)` succeeds:

1. `InvoicePayment` calls `transferFrom(payerShadowAccount, InvoicePayment, paymentAmount)`
2. the **payment token** leaves the payer's chain C shadow account
3. the **payment token** is now held by `InvoicePayment`
4. the invoice status becomes `Paid`

This is not yet the final creator payout.

At this point:

- the payer has paid
- the invoice is settled on chain C
- `InvoicePayment` has custody of the payment tokens

### Local same-chain creator case

If `creatorChainId == chain C`, `InvoicePayment` transfers the billed token directly to `creatorRefundAddress` inside `payInvoice(...)`.

That is the simple case.

### Cross-chain creator case

If the creator is on chain A or B, the contract does **not** bridge the payout inside `payInvoice(...)` anymore.

Instead:

- invoice is marked `Paid`
- the billed token remains in `InvoicePayment` on chain C
- payout waits for the backend worker

This is the core deferred payout design.

## 2C. Payment Stage 3: Backend Releases Creator Payout

### Why this stage exists

The old design tried to do creator payout from inside `payInvoice(...)` by sending a nested cross-chain transfer out of chain C.

That path proved unreliable in this stack.

So the implementation was changed to:

- finish invoice payment on chain C first
- then do creator payout from an off-chain worker using a normal wallet-originated bridge

### Which process performs this stage

The backend background worker performs it:

- [backend/src/server.ts](/Users/antonio/MatterLabs/cross-border/backend/src/server.ts)
  - `processInvoicePayouts()`
- [backend/src/utils/payouts/processor.ts](/Users/antonio/MatterLabs/cross-border/backend/src/utils/payouts/processor.ts)

### What the backend does

The worker loops over chain C invoices and finds invoices that are:

- `Paid`
- cross-chain creator invoices
- not already completed

For each one it does:

1. `triggerCreatorPayout(invoiceId)` on chain C
2. if needed, `approve(nativeTokenVault, amount)` for the billing token on chain C
3. `sendBundle(...)` on chain C `InteropCenter` to bridge the billed token to the creator's home chain
4. add that source tx to the relayer queue for L1 finalization

### Token movement during backend payout release

There are two sub-steps:

#### Step 1: release from `InvoicePayment`

`triggerCreatorPayout(invoiceId)` moves the billed token:

- from `InvoicePayment`
- to the backend `payoutOperator`

This happens entirely on chain C.

#### Step 2: bridge from chain C to creator chain

Then the backend payout operator wallet bridges those tokens:

- from chain C
- to the creator's `creatorRefundAddress`
- on chain A or B

So the final creator payout is wallet-originated from the backend operator, not contract-originated from `InvoicePayment`.

### Intermediate account used during creator payout

Yes. There is a second intermediate account in the full lifecycle:

- the backend **payout operator** wallet on chain C

So the cross-chain payment path now has two important intermediate holders:

1. **payer shadow account on chain C**
   - temporary holder before settlement
2. **backend payout operator on chain C**
   - temporary holder before creator payout bridge

## End-To-End Token Flow Summary

### Invoice creation

No token movement.

### Cross-chain payment with cross-chain creator payout

The billed-token/payment-token movement is:

1. payer wallet on chain A or B
2. payer shadow account on chain C
3. `InvoicePayment` on chain C
4. backend payout operator on chain C
5. creator refund address on chain A or B

If payment token and billing token are the same token, the symbol does not change, but custody still changes across these holders.

If payment token differs from billing token, `InvoicePayment` uses its configured exchange rates to determine the amount owed and requires enough billed-token liquidity to settle the creator side.

## Interop Transaction Summary

### Invoice creation

One interop bundle:

- source chain A/B -> destination chain C
- destination call:
  - `InvoicePayment.createInvoice(...)`

### Payment

Usually two interop bundles from the payer:

1. funding bundle
   - source chain A/B -> destination chain C
   - destination call:
     - asset-router token transfer into payer shadow account

2. settlement bundle
   - source chain A/B -> destination chain C
   - destination calls:
     - `approve(...)`
     - `payInvoice(...)`

Then one backend-originated payout bundle:

3. creator payout bundle
   - source chain C -> destination chain A/B
   - destination call:
     - asset-router token transfer to `creatorRefundAddress`

### L1 finalization

Every source-chain interop tx must be finalized through the backend relayer before the destination execution path can complete.

That logic is handled by:

- [backend/src/utils/relayer/relayer.ts](/Users/antonio/MatterLabs/cross-border/backend/src/utils/relayer/relayer.ts)
- [backend/src/utils/relayer/finalize.ts](/Users/antonio/MatterLabs/cross-border/backend/src/utils/relayer/finalize.ts)

## Where The Backend Is Required

### Not required as business logic for create

Invoice creation does not need a backend workflow to decide the operation.

It is frontend-driven.

### Not required as business logic for payer funding/settlement

The payer-side flow is also frontend-driven.

### Required for:

- local direct `handleOps` fallback when bundler submission fails
- reading invoices for the current dashboard
- finalizing interop source txs
- scanning paid invoices on chain C
- releasing creator payouts
- bridging creator payouts from chain C to the creator chain

Without the backend worker, a cross-chain invoice can still become `Paid`, but the creator payout will remain stuck on chain C.

## Do We Rely On The Interop Relay Container?

Yes.

For both creation and payment, destination execution depends on the interop relay stack.

The relevant pieces are:

1. source-chain `InteropCenter` contract emits the interop message
2. backend relayer finalizes the source tx on L1
3. the **interop relay container** observes and submits the destination execution
4. destination chain state changes

That applies to:

- create invoice
- fund payer shadow account
- settle invoice payment on chain C
- bridge creator payout back to chain A or B

So this feature depends on both:

- on-chain `InteropCenter` contracts
- the runtime **interop relay container**

## Why Payment Is More Complex Than Creation

Creation is simple because:

- no token movement
- one destination contract call
- only metadata changes on chain C

Payment is more complex because it spans:

- source-chain wallet approval
- source-chain token bridge
- destination shadow-account execution
- invoice settlement
- backend payout release
- another source-chain token bridge from chain C
- creator-side destination delivery

Creation is effectively:

- "one interop message, one state write"

Payment is effectively:

- "fund, settle, release, bridge back"

## Current Source Of Truth In Code

If another engineer needs to confirm this flow in code, start with:

- create / pay bundle construction:
  - [web-app/src/composables/useInteropInvoice.ts](/Users/antonio/MatterLabs/cross-border/web-app/src/composables/useInteropInvoice.ts)
- invoice contract behavior:
  - [contracts/src/InvoicePayment.sol](/Users/antonio/MatterLabs/cross-border/contracts/src/InvoicePayment.sol)
- payout worker:
  - [backend/src/utils/payouts/processor.ts](/Users/antonio/MatterLabs/cross-border/backend/src/utils/payouts/processor.ts)
- interop finalization worker:
  - [backend/src/utils/relayer/relayer.ts](/Users/antonio/MatterLabs/cross-border/backend/src/utils/relayer/relayer.ts)
- local stack overview:
  - [prividium-3chain-local/README.md](/Users/antonio/MatterLabs/cross-border/prividium-3chain-local/README.md)

## Suggested README Reference

If this document is linked from the root README, a short label like this would be appropriate:

- `Invoice interop architecture and token flow`
