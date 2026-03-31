# Invoice Walkthrough Script

This file contains a draft walkthrough script for the invoice flows.

## Creating An Invoice

Here is what is happening when I create an invoice.

I am connected on chain A or chain B, but the invoice itself is created on chain C. When I press create, my SSO smart account signs a single interop transaction.

That transaction is simple. It sends one interop bundle from my current chain to chain C, and inside that bundle there is one destination call: `InvoicePayment.createInvoice(...)`.

No tokens move at this stage. Nothing is being paid yet. The system is only writing invoice metadata on chain C.

When the message reaches chain C, it executes as my deterministic chain C shadow account. That is important because the contract records the creator as the chain C execution identity, while also storing my real wallet address and home chain for refunds and eventual payout.

So the short version is: one signature, one cross-chain message, one contract call, and metadata is stored on chain C. No ERC20 transfer happens during invoice creation.

## Paying An Invoice

Paying an invoice is more involved because this is where tokens actually move.

The key point is that `payInvoice(...)` runs on chain C. That means the payer cannot settle the invoice directly from their balance on chain A or chain B. The funds have to be made available on chain C first.

So the payment flow is split into stages.

First, the payer may need to sign a source-chain token approval. This gives the source-chain native token vault permission to move the payment token out of the payer wallet for bridging. If allowance is already in place, this step is skipped.

Second, the app sends the funding interop transaction. This bridges the payment amount from the payer wallet on chain A or chain B into the payer's deterministic shadow account on chain C. The funds do not go directly into `InvoicePayment`. They stop first in the payer shadow account.

Third, the app sends the settlement interop transaction. On chain C, that transaction executes as the payer's shadow account and performs two actions: it approves the `InvoicePayment` contract to spend the token, and then it calls `payInvoice(...)`.

At that point, `InvoicePayment` pulls the payment token from the payer shadow account, marks the invoice as paid, and holds custody of the funds on chain C.

If the creator is local to chain C, payout can complete there directly. If the creator is on another chain, the invoice is still marked paid at this point, but the final payout back to the creator is handled later by the backend worker.

So the short version is: payment is not a single cross-chain action. The app funds the payer shadow account first, then settles the invoice on chain C, and for cross-chain creators a later backend payout sends the funds back to the creator's home chain.

## Transition Line

Creation is simple because it is metadata only. Payment is more complex because the system has to move tokens across chains, stage them on chain C, and then settle from the correct execution account.
