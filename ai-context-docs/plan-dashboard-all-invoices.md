# Dashboard All-Invoices Filter Plan

## Goal
Add a dashboard view that can show:

- all invoices on chain C
- only invoices created by the current wallet
- only invoices where the current wallet is the recipient

The desired UX is a table filter with modes like:

- `All`
- `Created by me`
- `Received by me`

## Current State

### Frontend
The current dashboard invoice table is driven by:

- [useInvoices.ts](/Users/antonio/MatterLabs/cross-border/web-app/src/composables/useInvoices.ts)
- [InvoiceTableCard.vue](/Users/antonio/MatterLabs/cross-border/web-app/src/components/InvoiceTableCard.vue)

It always calls:

- `POST /invoices`

with:

- `accountAddress`

and renders only the invoices returned by that account-scoped response.

### Backend
The current backend invoice route is:

- [invoicesRouter.ts](/Users/antonio/MatterLabs/cross-border/backend/src/api/invoicesRouter.ts)

It reads invoices using the chain C contract methods:

- `getUserCreatedInvoiceCount(address)`
- `getUserCreatedInvoices(address,uint256,uint256)`
- `getUserPendingInvoiceCount(address)`
- `getUserPendingInvoices(address,uint256,uint256)`
- `getInvoiceDetails(uint256)`
- `getMultipleInvoiceDetails(uint256[])`

So today the backend can only fetch:

- invoices created by a specific account
- invoices pending for a specific account

It cannot efficiently fetch the full global invoice list.

### Contract
The current chain C contract is:

- [InvoicePayment.sol](/Users/antonio/MatterLabs/cross-border/contracts/src/InvoicePayment.sol)

It keeps a global sequential `_nextInvoiceId`, but does not expose a direct global count getter for the backend to use.

That is the main reason the current API is user-scoped.

## Is This Possible?
Yes.

The simplest reliable path is:

1. expose a global invoice count from the contract
2. let the backend fetch all invoice ids `1..count`
3. return all invoices plus per-viewer relationship tags
4. let the frontend filter the already-fetched list by `All / Created / Received`

## Recommended Implementation

### 1. Contract Changes

#### Recommended MVP
Add a read-only getter to the chain C contract:

```solidity
function getInvoiceCount() external view returns (uint256) {
    return _nextInvoiceId - 1;
}
```

Why this is enough:

- invoice ids are sequential
- invoices are not physically deleted
- existing `getInvoiceDetails` and `getMultipleInvoiceDetails` already support reading arbitrary ids

This avoids adding more storage or a second global index.

#### Optional improvement
If expected invoice volume grows, add a dedicated paginated range helper:

```solidity
function getInvoiceIdsInRange(uint256 startId, uint256 endId) external pure returns (uint256[] memory)
```

This is not strictly necessary for the local/demo stack because the backend can already generate the numeric id range once it knows the total count.

### 2. Backend Changes

#### API changes
Extend `POST /invoices` to accept an optional filter/scope field, for example:

```json
{
  "accountAddress": "0x...",
  "view": "all" | "created" | "received"
}
```

Recommended semantics:

- `view = "all"`: return all chain C invoices
- `view = "created"`: return only invoices where `creatorRefundAddress == accountAddress` or `sourceTags` contains `created`
- `view = "received"`: return only invoices where `recipientRefundAddress == accountAddress` or `sourceTags` contains `pending`

If `view` is omitted, keep current behavior for backward compatibility.

#### Backend fetch strategy

##### Current path
Current `fetchInvoices(accountAddress)` logic:

- reads created ids for the account
- reads pending ids for the account
- unions them
- fetches details
- annotates `sourceTags`

##### New path for `view = "all"`
Recommended new flow:

1. read `getInvoiceCount()` from chain C
2. generate invoice ids from `1` to `count`
3. fetch details in chunks using existing `getMultipleInvoiceDetails`
4. if `accountAddress` is provided, annotate each invoice with relationship tags:
   - `created` when the viewer is the creator
   - `pending` when the viewer is the recipient
5. optionally apply server-side filtering when `view = "created"` or `view = "received"`

#### Response shape changes
The existing response already contains:

- `createdInvoiceIds`
- `pendingInvoiceIds`
- `invoices`

Recommended additions:

```ts
view: 'all' | 'created' | 'received'
availableViews: Array<'all' | 'created' | 'received'>
countsByView: {
  all: number
  created: number
  received: number
}
```

Also keep `sourceTags` on each invoice in the normalized response.

That lets the frontend render filter pills and counts without recomputing everything.

#### Important compatibility note
The current frontend type in:

- [invoices.ts](/Users/antonio/MatterLabs/cross-border/web-app/src/types/invoices.ts)

does not include `sourceTags`, even though the backend currently returns them in the payload.

If the filter UX is implemented, the shared frontend type should be expanded to include:

- `sourceTags: Array<'created' | 'pending'>`

Potentially rename `pending` to `received` on the frontend if the UI wording should be user-facing and clearer.

### 3. Frontend Changes

#### Composable changes
Update:

- [useInvoices.ts](/Users/antonio/MatterLabs/cross-border/web-app/src/composables/useInvoices.ts)

to support:

- current selected filter/view
- fetching invoices with `view`
- exposing counts for each filter

Two workable approaches exist.

##### Approach A: backend-filtered requests
Every filter change triggers:

- `POST /invoices` with the selected `view`

Pros:

- simplest data contract
- scales better if invoice volume grows

Cons:

- extra round-trip on each filter change

##### Approach B: fetch all once, filter locally
Fetch `view=all` once, then filter by `sourceTags` client-side.

Pros:

- instant filter switching
- simpler UX

Cons:

- backend returns more data
- will not scale as well if the invoice set becomes large

#### Recommendation
For the current local/demo stack:

- fetch `view=all`
- filter client-side using `sourceTags`

This keeps the UX responsive and minimizes backend complexity.

If the invoice volume grows later, move to backend-filtered pagination.

#### Table component changes
Update:

- [InvoiceTableCard.vue](/Users/antonio/MatterLabs/cross-border/web-app/src/components/InvoiceTableCard.vue)

to add a small filter control near the table title:

- `All`
- `Created by me`
- `Received by me`

The component should show:

- total count for current filter
- empty state per filter
- active styling for the selected filter

#### Main dashboard integration
If the same invoice fetch logic is also used from:

- [MainView.vue](/Users/antonio/MatterLabs/cross-border/web-app/src/views/MainView.vue)

for polling or post-submit matching, keep that flow on the existing account-scoped behavior unless there is a reason to broaden it.

The dashboard filter feature should stay isolated to the invoice table data path.

## Suggested MVP Change Set

### Contract
- add `getInvoiceCount()`

### Backend
- add `view` request parameter
- add path for `view=all`
- include `sourceTags` in the documented response type
- optionally include `countsByView`

### Frontend
- extend `InvoiceRecord` / `InvoiceResponseObject` types
- add filter state to `useInvoices`
- add filter UI to `InvoiceTableCard`
- default the dashboard to `All`

## Recommended File-Level Work

### Contract
- [InvoicePayment.sol](/Users/antonio/MatterLabs/cross-border/contracts/src/InvoicePayment.sol)

### Backend
- [invoicesRouter.ts](/Users/antonio/MatterLabs/cross-border/backend/src/api/invoicesRouter.ts)

### Frontend
- [invoices.ts](/Users/antonio/MatterLabs/cross-border/web-app/src/types/invoices.ts)
- [useInvoices.ts](/Users/antonio/MatterLabs/cross-border/web-app/src/composables/useInvoices.ts)
- [InvoiceTableCard.vue](/Users/antonio/MatterLabs/cross-border/web-app/src/components/InvoiceTableCard.vue)

## Risks / Tradeoffs

### Visibility / privacy
Showing `All` invoices means any dashboard user can view every chain C invoice returned by the backend.

That may be acceptable for the current local/demo environment, but it is the main product/security question to answer before treating this as a production-ready feature.

### Pagination
Returning every invoice in one response is acceptable now because the dataset is small.

If the dataset grows, the backend should add:

- pagination
- sorting
- server-side filtering

### Terminology
Current backend `sourceTags` uses:

- `created`
- `pending`

For dashboard UX, `pending` should probably be rendered as:

- `Received`

because the user asked for “ones I'm the recipient”.

## Open Questions

These are not blockers for the MVP doc, but they should be decided before implementation:

1. Should `All` really mean every invoice visible to every logged-in user, or only all invoices related to the current account?
2. Should the default dashboard tab be `All` or preserve the current user-scoped behavior?
3. Do we want client-side filtering first for speed, or backend-filtered views first for cleaner API semantics?

## Recommendation
Recommended MVP:

1. add `getInvoiceCount()` to the contract
2. extend backend `/invoices` with `view=all|created|received`
3. return all invoices plus `sourceTags`
4. add `All / Created by me / Received by me` filter pills in the dashboard table
5. keep pagination out of scope for the first pass

That is the smallest coherent change set that matches the requested UX.
