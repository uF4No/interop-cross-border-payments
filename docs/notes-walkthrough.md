# Invoice Walkthrough Speaker Notes

Condensed prompts for recording.

## Creating An Invoice

- I am on chain A or B, but the invoice is created on chain C.
- I sign one interop transaction.
- That interop bundle contains one destination call: `InvoicePayment.createInvoice(...)`.
- No tokens move here.
- Chain C executes the call as my deterministic shadow account.
- The contract stores the invoice metadata on chain C.
- It also keeps my real wallet address and home chain for future payout.
- Summary line: one signature, one cross-chain message, metadata only.

## Paying An Invoice

- Payment is more complex because tokens have to move.
- `payInvoice(...)` runs on chain C, so funds must exist on chain C first.
- Step 1: source-chain token approval, if needed.
- This lets the native token vault bridge funds out of the payer wallet.
- Step 2: funding interop transaction.
- Funds move from the payer wallet on chain A or B to the payer shadow account on chain C.
- They do not go straight into `InvoicePayment`.
- Step 3: settlement interop transaction.
- On chain C, the payer shadow account approves `InvoicePayment`.
- Then the payer shadow account calls `payInvoice(...)`.
- `InvoicePayment` pulls the funds, marks the invoice as paid, and holds custody on chain C.
- If the creator is cross-chain, backend payout happens afterward.
- Summary line: fund first, settle second, payout later.

## Transition Line

- Creation is metadata only.
- Payment requires cross-chain funding plus settlement on chain C.
