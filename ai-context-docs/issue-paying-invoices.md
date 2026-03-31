# Issue: Paying invoices from the web app

**Important:** This issue was fixed.

Last updated: **March 27, 2026**
Workspace: `/Users/antonio/MatterLabs/cross-border`

## 1) Objective
Provide a complete handoff document for debugging the current invoice payment flow from the root `web-app`.

This document is meant to let another engineer or agent resume the investigation without re-deriving the current findings from logs, chain state, and source code.

The user-visible symptom that prompted this document was:

- the web app tried to pay invoice `1`
- the app eventually failed with:
  - `Timed out waiting for invoice 1 to reach paid.`

## 2) Executive Summary
There are multiple independent problems affecting invoice payment right now.

### 2.1 User-visible current behavior
- Invoice payment from the web app times out waiting for chain C state to move from `Created` to `Paid`.
- The destination invoice does **not** become paid on chain C.
- The `interop-relay` service reports an `A->C FAIL` for the payment attempt.

### 2.2 Current strongest findings
- Invoice `1` on chain C still has:
  - `status = 0` (`Created`)
  - `paymentToken = 0x0000000000000000000000000000000000000000`
  - `paidAt = 0`
- There is no `InvoicePaid` event for invoice `1` on chain C.
- The archived predecessor repo being mimicked here, `interop-escrow-double-zero`, did **not** pay invoices by only calling `approve(...)` and `payInvoice(...)` on chain C.
- In that repo, the frontend first bridged the payer's payment token from the payer's source chain into the payer's aliased / shadow account on chain C, and only then called `approve(...)` and `payInvoice(...)` on chain C.
- The payment path in the web app does **not** bridge funds. It sends an interop bundle that runs `approve(...)` and then `payInvoice(...)` on chain C using the payer's **shadow account**.
- For invoice `1`, the relevant chain C shadow account is:
  - `0xE0c2358898EfDffF907A4d45702FB2F0B3F4616E`
- That shadow account currently has:
  - `0` USDC on chain C
- The chain C `InvoicePayment` contract currently has:
  - `0` ETH balance
- But `InvoicePayment.crossChainFee()` returns:
  - `0.001 ETH`

### 2.3 Practical interpretation
The current payment attempt is blocked even before considering UI timeout behavior.

For the specific invoice the user tried to pay:

1. The web app attempts to pay on chain C from the payer's shadow account.
2. That shadow account has `0` destination-chain USDC.
3. Even if that were fixed, the invoice contract itself has `0` ETH and would need `crossChainFee` ETH to send the billed token back out of chain C to the creator on chain A.

So there are at least **two hard execution blockers** on the destination path:

- no destination-chain payment token on the payer shadow account
- no ETH on the invoice contract for the nested cross-chain payout

There is also now a stronger architectural finding:

- this repo currently skips the payer-funding leg that existed in `interop-escrow-double-zero`
- the current code assumes the payer shadow account on chain C is already funded
- the old repo explicitly moved funds from source chain A/B into the payer alias on chain C before trying to pay

### 2.4 Important product-level caveat
The repo's own invoice smoke test only exercises `payInvoice(...)` for a **chain-C-created invoice**, and the code comments say that was done specifically to avoid:

- `a nested payout back out of chain C`

That is highly relevant here because invoice `1` was created on chain C **from chain A**, so paying it requires chain C `InvoicePayment.payInvoice(...)` to send billed funds back out to chain A.

## 3) Exact user context captured for this investigation

### 3.1 Source request observed by the user
The user reported that the web app sent a backend request to:

- `/userops/direct-handle-ops`

with:

- `chainId = 6565`
- `entryPoint = 0x9E545E3C0baAB3E08CdfD552C960A1050f373042`
- `userOp.sender = 0x646fFd148A66E868CF1F2d94B84C09F61be57817`
- `userOp.nonce = 0x2`

The captured `callData` contains both:

- ERC20 `approve(address,uint256)` selector `0x095ea7b3`
- invoice `payInvoice(uint256,address)` selector `0x91d115ac`

This matches the web-app payment flow.

### 3.2 UI error observed by the user
The user then got:

- `Timed out waiting for invoice 1 to reach paid.`

That error is thrown by the polling logic in:

- `/Users/antonio/MatterLabs/cross-border/web-app/src/views/MainView.vue`

after repeated invoice status reads fail to observe the transition to `paid`.

## 4) Environment / services involved

Primary compose file:

- `/Users/antonio/MatterLabs/cross-border/prividium-3chain-local/docker-compose.yml`

Important services:

- `web-app`
- local repo-root backend
- `prividium-permissions-api-l2a`
- `zksync-prividium-3chains-bundler-l2a-1`
- `zksync-prividium-3chains-bundler-l2b-1`
- `zksync-prividium-3chains-interop-relay-1`
- `zkos-chain1` (chain A / `6565`)
- `zkos-chain2` (chain B / `6566`)
- `zkos-chain3` (chain C / `6567`)

Important endpoints:

- chain A RPC: `http://localhost:3050`
- chain B RPC: `http://localhost:3051`
- chain C RPC: `http://localhost:3052`
- chain A permissions RPC facade: `http://localhost:8000/rpc`

## 5) Key actors / addresses

### 5.1 Chain A
- chain id: `6565`
- entryPoint: `0x9e545e3c0baab3e08cdfd552c960a1050f373042`
- interopCenter: `0x0000000000000000000000000000000000010010`

### 5.2 Chain C
- chain id: `6567`
- invoicePayment: `0x4A679253410272dd5232B3Ff7cF5dbB88f295319`
- interop handler / shadow-account resolver: `0x000000000000000000000000000000000001000d`
- USDC token: `0x7a2088a1bFc9d81c55368AE168C2C02570cB814F`

### 5.3 User / invoice-related addresses
- source SSO sender / recipient refund address:
  - `0x646fFd148A66E868CF1F2d94B84C09F61be57817`
- chain C shadow account for that user from chain `6565`:
  - `0xE0c2358898EfDffF907A4d45702FB2F0B3F4616E`

### 5.4 Relay signer
- relay signer:
  - `0x36615Cf349d7F6344891B1e7CA7C72883F5dc049`

## 6) Current live destination state

### 6.1 Invoice `1` details on chain C
Direct read from chain C:

```bash
cast call 0x4A679253410272dd5232B3Ff7cF5dbB88f295319 \
  "getInvoiceDetails(uint256)((uint256,address,address,address,address,uint256,uint256,address,uint256,address,uint256,uint8,uint256,uint256,string))" \
  1 \
  --rpc-url http://localhost:3052
```

Observed result:

```text
(1,
 0xE0c2358898EfDffF907A4d45702FB2F0B3F4616E,
 0x646fFd148A66E868CF1F2d94B84C09F61be57817,
 0x646fFd148A66E868CF1F2d94B84C09F61be57817,
 0x646fFd148A66E868CF1F2d94B84C09F61be57817,
 6565,
 6565,
 0x7a2088a1bFc9d81c55368AE168C2C02570cB814F,
 23424000000000000000000,
 0x0000000000000000000000000000000000000000,
 0,
 0,
 1774544249,
 0,
 "awd awd awd awd")
```

Interpretation:

- invoice exists
- creator on chain C is the user's shadow account
- creatorChainId = `6565`
- recipientChainId = `6565`
- billingToken = chain C USDC
- paymentToken still zero
- status still `0` (`Created`)

### 6.2 Invoice events on chain C
Direct chain C log inspection showed:

- an `InvoiceCreated` event for invoice `1`
- **no** `InvoicePaid` event for invoice `1`

This confirms the payment never completed on chain C.

### 6.3 Shadow-account resolution for the payer
Direct read from the chain C interop handler:

```bash
cast call 0x000000000000000000000000000000000001000d \
  "getShadowAccountAddress(uint256,address)(address)" \
  6565 \
  0x646fFd148A66E868CF1F2d94B84C09F61be57817 \
  --rpc-url http://localhost:3052
```

Observed:

- `0xE0c2358898EfDffF907A4d45702FB2F0B3F4616E`

This exactly matches the `creator` field stored in invoice `1`.

### 6.4 Destination payment-token balance
Direct read of the payer shadow account's chain C USDC balance:

```bash
cast call 0x7a2088a1bFc9d81c55368AE168C2C02570cB814F \
  "balanceOf(address)(uint256)" \
  0xE0c2358898EfDffF907A4d45702FB2F0B3F4616E \
  --rpc-url http://localhost:3052
```

Observed:

- `0`

This is the strongest immediate execution blocker.

The web app is asking chain C to:

- approve the invoice contract to spend the shadow account's USDC
- then call `payInvoice(...)`

But the shadow account holds zero destination-chain USDC.

### 6.5 Destination invoice contract ETH balance
Direct read:

```bash
cast balance 0x4A679253410272dd5232B3Ff7cF5dbB88f295319 --rpc-url http://localhost:3052
```

Observed:

- `0`

### 6.6 Destination invoice contract cross-chain fee requirement
Direct read:

```bash
cast call 0x4A679253410272dd5232B3Ff7cF5dbB88f295319 \
  "crossChainFee()(uint256)" \
  --rpc-url http://localhost:3052
```

Observed:

- `1000000000000000`
- which is `0.001 ETH`

This is the second hard blocker.

Because invoice `1` has `creatorChainId = 6565` while the invoice contract lives on chain C (`6567`), `payInvoice(...)` must send billed funds back out of chain C. That path requires `crossChainFee` ETH to be present on the invoice contract itself.

### 6.7 Contract whitelist / token configuration
Direct read:

```bash
cast call 0x4A679253410272dd5232B3Ff7cF5dbB88f295319 \
  "getWhitelistedTokens()(address[],string[])" \
  --rpc-url http://localhost:3052
```

Observed:

- tokens are whitelisted correctly:
  - USDC
  - SGD
  - TBILL

So this is **not** a whitelist misconfiguration.

## 7) What the web app actually does for payment today

Relevant files:

- `/Users/antonio/MatterLabs/cross-border/web-app/src/views/MainView.vue`
- `/Users/antonio/MatterLabs/cross-border/web-app/src/composables/useInteropInvoice.ts`

Current payment flow:

1. `handlePayInvoice(...)` validates:
   - invoice status must be `Created`
   - active source chain must match `invoice.recipientChainId`
2. It calls `sendPayInvoiceBundle(...)`
3. That function builds two destination calls:
   - `approve(invoicePayment, MAX_UINT256)` on `paymentToken`
   - `payInvoice(invoiceId, paymentToken)` on `InvoicePayment`
4. Both destination calls use:
   - `shadowAccountAttribute()`
5. The `paymentToken` chosen by the web app is:
   - `invoice.billingToken`
6. The flow does **not** bridge or provision destination funds before attempting payment.

Practical meaning:

- payment assumes the destination shadow account already holds the payment token on chain C
- if it does not, `payInvoice(...)` cannot succeed

## 8) What `interop-escrow-double-zero` did for payment

Cloned reference repo:

- `/Users/antonio/MatterLabs/interop-escrow-double-zero`

Relevant files:

- `/Users/antonio/MatterLabs/interop-escrow-double-zero/web/hooks/use-invoice-contract-interop.ts`
- `/Users/antonio/MatterLabs/interop-escrow-double-zero/web/hooks/use-interop-builder.ts`
- `/Users/antonio/MatterLabs/interop-escrow-double-zero/contracts/src/InvoicePayment.sol`

That older repo implemented invoice payment as a two-leg flow.

### 8.1 Frontend flow in the old repo
Its payment hook did this:

1. create an interop builder from payer source chain -> chain C
2. on the payer source chain, approve the native token vault if needed
3. resolve the payer's aliased account on chain C
4. add a token transfer from source chain into that aliased account on chain C
5. add `approve(invoiceContract, paymentAmount)` on chain C
6. add `payInvoice(invoiceId, mainChainTokenAddress)` on chain C
7. send the whole interop request and wait for broadcaster completion

This is the critical missing behavior in the current repo. The old implementation did **not** assume the payer alias on chain C was already funded.

### 8.2 Contract flow in the old repo
The old contract then:

1. pulled `paymentToken` from `msg.sender` on chain C
2. checked the contract held enough `billingToken`
3. if the payee was on chain C, transferred directly
4. otherwise called `_transferTokens(...)` to send the billed token from chain C to the payee's home chain

### 8.3 Important terminology correction
The `InvoicePayment` contract names are easy to misread:

- `creator` is the invoice issuer / payee
- `recipient` is the party who must pay the invoice
- `creatorRefundAddress` is where the billed token should ultimately end up
- `recipientRefundAddress` is the payer-side address used to locate the pending invoice

So the intended payment flow is:

- payer source chain A/B
- payer alias / shadow account on chain C
- invoice execution on chain C
- billed-token payout from chain C to the **creator / payee** home chain if needed

It is **not**:

- payer source chain
- chain C
- recipient home chain

The outbound leg from chain C goes to the creator / payee side.

## 9) What the contract does during `payInvoice(...)`

Relevant file:

- `/Users/antonio/MatterLabs/cross-border/contracts/src/InvoicePayment.sol`

Important logic:

1. invoice must exist and be in `Created`
2. `paymentToken` must be whitelisted
3. contract computes `paymentAmount`
4. contract marks invoice as paid in memory/state
5. contract does:
   - `IERC20(paymentToken).transferFrom(msg.sender, address(this), paymentAmount);`
6. contract requires it now has enough `billingToken`
7. if `creatorChainId != block.chainid`, contract calls `_transferTokens(...)`
8. `_transferTokens(...)` requires:
   - `address(this).balance >= crossChainFee`
   - then calls `requestInterop{ value: crossChainFee }(...)`

### 9.1 For invoice `1`, blocker order matters
Invoice `1` is billed in chain C USDC, and the web app is also using chain C USDC as `paymentToken`.

That means:

- lack of pre-existing billing-token liquidity on the invoice contract is **not** necessarily the first blocker
- because `transferFrom(...)` would fund the contract first if the payer had tokens

The more immediate failure sequence is:

1. destination shadow account has zero USDC
2. `approve(...)` could succeed
3. `payInvoice(...)` would then hit `transferFrom(...)`
4. `transferFrom(...)` would fail because the shadow account has zero USDC

Then, **even after fixing that**, the next failure would be:

5. invoice contract has zero ETH
6. `_transferTokens(...)` would fail at:
   - `require(address(this).balance >= crossChainFee, "Insufficient ETH for interop call");`

So there are at least two sequential blockers.

## 10) Comparison: current repo vs old repo

### 10.1 Old repo
- explicitly bridged payment funds from payer source chain -> payer alias on chain C before `payInvoice(...)`
- then executed `approve(...)` and `payInvoice(...)` on chain C
- relied on the contract's `_transferTokens(...)` for the outbound payee leg from chain C

### 10.2 Current repo
- only submits `approve(...)` and `payInvoice(...)` as shadow-account calls on chain C
- does not bridge payment funds from source chain into the payer shadow account first
- therefore only works if the payer shadow account is already funded on chain C

### 10.3 Consequence
The current repo is not yet functionally equivalent to `interop-escrow-double-zero` for invoice payment.

It reproduces the destination `approve + payInvoice` part, but it does not reproduce the payer-funding leg that made the old flow viable.

## 11) Smoke-test behavior in this repo is intentionally narrower

Relevant files:

- `/Users/antonio/MatterLabs/cross-border/prividium-3chain-local/README.md`
- `/Users/antonio/MatterLabs/cross-border/prividium-3chain-local/sdk/examples/invoice-interop-smoke.ts`

Important documented behavior:

- the invoice smoke test:
  - deploys a fresh `InvoicePayment` on chain C
  - funds the invoice contract with `crossChainFee * 50`
  - mints billed-token liquidity to the invoice contract
  - mints payment-token balance to the payer's shadow account on chain C
- and for `payInvoice(...)` specifically it uses:
  - a **chain-C-created invoice**

The example includes this explicit comment:

- `Scenario 3 uses a chain C creator so payInvoice can be exercised from chain B without a nested payout back out of chain C.`

This is a strong sign that the currently attempted product path is not aligned with the tested local-stack path.

## 12) Relay-container findings

Container:

- `zksync-prividium-3chains-interop-relay-1`

### 12.1 What the relay reported
`docker logs` showed the current failure in the relay TUI:

- `A→C 0x045386…56 FAIL transaction submission failed: server returned an error response: error code …`

This confirms the payment source path did reach relay handling and failed on the destination submission/execution path.

### 12.2 Relay signer health
Direct checks on chain C:

```bash
cast balance 0x36615Cf349d7F6344891B1e7CA7C72883F5dc049 --rpc-url http://localhost:3052
cast nonce   0x36615Cf349d7F6344891B1e7CA7C72883F5dc049 --rpc-url http://localhost:3052
cast nonce   0x36615Cf349d7F6344891B1e7CA7C72883F5dc049 --rpc-url http://localhost:3052 --block pending
```

Observed:

- balance about `1.0000165375 ETH`
- confirmed nonce `2`
- pending nonce `2`

Interpretation:

- relay signer is funded
- there is no visible stuck pending tx
- there is no nonce gap on chain C

### 12.3 What this means
The relay failure is not explained by:

- empty relay account
- obvious nonce exhaustion
- a visible pending tx jam

The most likely explanation is that this particular payment bundle is invalid or reverts under destination execution conditions.

## 13) Bundler findings discovered during the same investigation

### 13.1 Current bundler health is bad
At the time of this investigation:

- `zksync-prividium-3chains-bundler-l2a-1` was crash-looping
- `zksync-prividium-3chains-bundler-l2b-1` was crash-looping

`docker ps` showed both in:

- `Restarting (1)`

### 13.2 Concrete bundler errors
Recent bundler logs showed:

- chain A bundler:
  - `PimlicoSimulations contract 0x67aD6EA566BA6B0fC52e97Bc25CE46120fdAc04c does not exist`
- chain B bundler:
  - `PimlicoSimulations contract 0xb9bEECD1A582768711dE1EE7B0A1d582D9d72a6C does not exist`

Interpretation:

- normal `eth_sendUserOperation` through Alto/Pimlico is currently broken on this local stack
- this is separate from the payment-path execution blockers above
- but it still matters because it means the standard AA path is unhealthy even before interop

### 13.3 Relationship to the current payment failure
This specific user report referenced `/userops/direct-handle-ops`, so the user was already on the direct backend fallback path rather than a healthy bundler path.

That means:

- bundler failure is a real current issue
- but it is not sufficient to explain the invoice staying `Created`
- the payment-path execution blockers on chain C remain the stronger explanation for the timeout

## 14) Earlier successful relay txs that help frame the current failure

The relay signer on chain C has two earlier successful interop txs from the same address:

- `0xe4363f66b34a0f211551a27e2920e801dafcbbb8ff93e08c6606f65a4e693f82`
- `0x430eebe02f5a95dbf18df836b441ce6fc7c5ef5d307ed2393d36a49b27e6a209`

These are useful because they show:

- relay submission to chain C can work in this environment
- chain C relay signer + system entrypoint path are not categorically broken
- the current failure is specific to the attempted payment flow, not all A->C relay activity

Those successful txs were invoice-creation style flows, not the current problematic payment flow.

## 15) Commands run during this investigation

### 15.1 Container status

```bash
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}'
```

### 15.2 Bundler logs

```bash
docker logs --since 60m --tail 300 zksync-prividium-3chains-bundler-l2a-1
docker logs --since 60m --tail 300 zksync-prividium-3chains-bundler-l2b-1
```

### 15.3 Relay logs

```bash
docker logs --since 60m --tail 300 zksync-prividium-3chains-interop-relay-1
```

### 15.4 Invoice state

```bash
cast call 0x4A679253410272dd5232B3Ff7cF5dbB88f295319 \
  "getInvoiceDetails(uint256)((uint256,address,address,address,address,uint256,uint256,address,uint256,address,uint256,uint8,uint256,uint256,string))" \
  1 \
  --rpc-url http://localhost:3052
```

### 15.5 Shadow account lookup

```bash
cast call 0x000000000000000000000000000000000001000d \
  "getShadowAccountAddress(uint256,address)(address)" \
  6565 \
  0x646fFd148A66E868CF1F2d94B84C09F61be57817 \
  --rpc-url http://localhost:3052
```

### 15.6 Payer-shadow token balance

```bash
cast call 0x7a2088a1bFc9d81c55368AE168C2C02570cB814F \
  "balanceOf(address)(uint256)" \
  0xE0c2358898EfDffF907A4d45702FB2F0B3F4616E \
  --rpc-url http://localhost:3052
```

### 15.7 Invoice contract ETH balance / fee

```bash
cast balance 0x4A679253410272dd5232B3Ff7cF5dbB88f295319 --rpc-url http://localhost:3052
cast call 0x4A679253410272dd5232B3Ff7cF5dbB88f295319 "crossChainFee()(uint256)" --rpc-url http://localhost:3052
```

### 15.8 Relay signer health

```bash
cast balance 0x36615Cf349d7F6344891B1e7CA7C72883F5dc049 --rpc-url http://localhost:3052
cast nonce   0x36615Cf349d7F6344891B1e7CA7C72883F5dc049 --rpc-url http://localhost:3052
cast nonce   0x36615Cf349d7F6344891B1e7CA7C72883F5dc049 --rpc-url http://localhost:3052 --block pending
```

## 16) Current best explanation of the timeout

The web-app timeout is most likely the downstream symptom of this sequence:

1. user initiates payment from chain A
2. source-side user-op / direct fallback reaches interop handling
3. current web-app bundle reaches chain C without first funding the payer shadow account there
4. relay attempts to submit or simulate destination execution on chain C
5. destination payment flow is invalid under current local-stack state
6. invoice never emits `InvoicePaid`
7. UI polling keeps waiting
8. polling times out with:
   - `Timed out waiting for invoice 1 to reach paid.`

### 16.1 Most likely first hard execution blocker
- payer shadow account on chain C has `0` USDC

### 16.2 Most likely second hard execution blocker
- chain C invoice contract has `0` ETH but needs `crossChainFee = 0.001 ETH` to send billed funds back to chain A

### 16.3 Wider product / stack mismatch
- `interop-escrow-double-zero` funded the payer alias on chain C before paying
- current repo does not
- current repo smoke tests only validate `payInvoice(...)` in a narrower scenario:
  - chain-C-created invoice
  - pre-funded invoice contract
  - pre-funded destination shadow account
- the current product path attempts a harder scenario:
  - invoice created from chain A
  - payment on chain C from a shadow account with no visible local funding
  - nested payout back out of chain C

## 17) Open questions that remain

### 17.1 Missing exact relay-side revert reason
The relay container log is truncated and only shows:

- `transaction submission failed: server returned an error response: error code …`

This investigation did **not** recover the exact low-level revert/error body for the current failed payment attempt.

### 17.2 Source tx hash for the specific user-reported payment attempt
The user provided the `/direct-handle-ops` request body and the resulting timeout, but not the direct source tx hash returned by the backend for this exact attempt.

That hash would make it easier to correlate:

- source logs
- relay job identity
- bundle extraction
- any destination dry-run tools

### 17.3 Whether deeper nested-interop issues still remain after funding fixes
Even if:

- the payer shadow account were funded with USDC on chain C
- the invoice contract were funded with ETH for `crossChainFee`

there may still be deeper issues in the nested payout path because that scenario is not the one covered by the current smoke test.

### 17.4 Which interop primitive should be used for the payer-funding leg in this repo
The old repo used `requestInterop(...)` with an asset-router transfer into the aliased account on chain C.

This repo currently uses a different bundle-building layer centered around `sendBundle(...)` with shadow-account calls.

The next implementation needs to decide whether to:

- add an explicit source-chain asset transfer leg before the existing shadow-account calls
- or extend the current bundle builder so one logical payment action can include both asset movement and destination calls

That is an implementation detail, not a product decision, but it should be settled early because it affects testing and observability.

## 18) Recommended next steps

### 18.1 Product decision
Decide explicitly whether invoice payment must support:

- payer on chain A or B
- invoice contract on chain C
- payee / creator on chain A, B, or C

If the answer is **yes**, then the implementation must support both:

- inbound payer funding: source chain -> payer shadow on C
- outbound payee payout: C -> creator home chain when creator is not on C

### 18.2 Implementation plan for parity with `interop-escrow-double-zero`

#### Stage 1: make the current gap explicit in code and UX
1. document in code that `sendPayInvoiceBundle(...)` currently assumes the payer shadow account on chain C is pre-funded
2. surface a clearer preflight error when the active flow lacks destination funds
3. stop describing the current flow as if it were full source-to-destination payment routing

#### Stage 2: restore the missing payer-funding leg
1. before `approve(...)` and `payInvoice(...)`, move the payer's selected payment token from the active source chain into the payer's shadow account on chain C
2. resolve the shadow / alias address deterministically from:
   - payer wallet address
   - source chain id
   - destination chain C
3. ensure the token used for the funding leg maps correctly:
   - source-chain token address / asset id
   - corresponding chain C token address used by `InvoicePayment`
4. keep the existing destination calls:
   - `approve(invoicePayment, ...)`
   - `payInvoice(invoiceId, paymentTokenOnC)`

#### Stage 3: keep chain C payout funded
1. ensure `InvoicePayment` on chain C is funded with enough ETH to cover `crossChainFee`
2. define whether that ETH is:
   - pre-seeded by admin in local/demo environments
   - topped up operationally by setup scripts
   - or explicitly managed by a service / runbook
3. add a visible health check or setup assertion so agents can detect underfunding quickly

#### Stage 4: validate the full supported matrix
1. A -> C pay, creator on C
2. B -> C pay, creator on C
3. A -> C pay, creator on A
4. B -> C pay, creator on B
5. A -> C pay, creator on B
6. B -> C pay, creator on A

For every row, verify:

- source transaction succeeds
- relay marks destination execution as complete
- `InvoicePaid` is emitted on chain C
- creator receives billed token on the correct home chain
- payer's source-side balance decreases by the expected payment amount plus any required gas

### 18.3 Short-term proof step before implementing the full fix
To prove the diagnosis before changing the app:

1. manually fund the payer shadow account on chain C with the expected payment token
2. manually fund the chain C `InvoicePayment` contract with several multiples of `crossChainFee`
3. retry the exact same payment shape
4. confirm whether the remaining failure, if any, is in the nested outbound payout rather than the missing inbound funding leg

If this succeeds, it strongly confirms that the current missing app behavior is the source-chain -> chain-C funding step.

### 18.4 Bundler repair still needed
Independently of payment-path fixes, the current local stack still needs bundler repair because both chain A/B bundlers are crash-looping on missing simulation contracts.

That should be tracked separately but not ignored.

## 19) Files most relevant for the next agent

- `/Users/antonio/MatterLabs/cross-border/web-app/src/views/MainView.vue`
- `/Users/antonio/MatterLabs/cross-border/web-app/src/composables/useInteropInvoice.ts`
- `/Users/antonio/MatterLabs/cross-border/backend/src/utils/userops/direct-handle-ops.ts`
- `/Users/antonio/MatterLabs/cross-border/contracts/src/InvoicePayment.sol`
- `/Users/antonio/MatterLabs/cross-border/prividium-3chain-local/sdk/examples/invoice-interop-smoke.ts`
- `/Users/antonio/MatterLabs/cross-border/prividium-3chain-local/README.md`
- `/Users/antonio/MatterLabs/interop-escrow-double-zero/web/hooks/use-invoice-contract-interop.ts`
- `/Users/antonio/MatterLabs/interop-escrow-double-zero/web/hooks/use-interop-builder.ts`
- `/Users/antonio/MatterLabs/interop-escrow-double-zero/contracts/src/InvoicePayment.sol`
- `/Users/antonio/MatterLabs/cross-border/01-issue-sending-userops.md`
- `/Users/antonio/MatterLabs/cross-border/INTEROP_RANDOM_ACCOUNT_RUNBOOK.md`

## 20) Bottom line
At the time of writing this document, the current payment issue is best understood as:

- **not** just a UI polling problem
- **not** just a relay-account funding problem
- **not** just a bundler problem

It is primarily a destination execution-path mismatch:

- the app currently skips the source-chain -> chain-C payer-funding leg that existed in `interop-escrow-double-zero`
- the app therefore tries to pay on chain C from a shadow account with no destination funds
- the invoice contract also lacks ETH for the nested cross-chain payout back to the creator's chain
- and the tested local-stack scenario for `payInvoice(...)` is narrower than the one the web app is currently attempting

That combination is sufficient to explain why invoice `1` never reached `Paid`.
