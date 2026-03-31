## AURORA

- Extended the setup contracts config schema to support chain-separated outputs under `chains.a`, `chains.b`, and `chains.c`, including SSO, `ssoBytecodeHash`, `InvoicePayment`, token addresses, asset IDs, and deployer/admin metadata.
- Kept `readContractsConfig`, `writeContractsConfig`, and `mergeContractsConfig` backward compatible with partial updates while deep-merging nested chain/token objects instead of replacing sibling values.
- Reworked setup env sync to preserve legacy chain A exports and add explicit chain B/C env vars for SSO, invoice payment, token addresses, asset IDs, and chain metadata when present.
- Updated `setup/.env.example` and `config/contracts.example.json` to document the 3-chain local stack layout for 6565/6566/6567.

## RAVEN

Implemented the setup execution flow for the 3-chain demo inside the setup package runtime:

- Replaced the old single-chain `setup/src/main.ts` orchestration with a 3-chain flow that validates chains A/B/C, authenticates on each chain, deploys and registers SSO contracts on A and B, then runs the chain C invoice/token bootstrap.
- Added `setup/src/tools/contracts-artifacts.ts` to auto-bootstrap the missing deploy artifacts by compiling the real setup contracts in an ephemeral Foundry compatibility workspace before deployment.
- Added `setup/src/tools/three-chain-setup.ts` to deploy or reuse `InvoicePayment.sol` and three `TestnetERC20Token.sol` instances on chain C, whitelist them in `InvoicePayment`, register them in the Native Token Vault, materialize bridged token contracts on chains A and B, premint balances to the deployer, and return the chain-separated config payload.
- Wired `config/contracts.json` output through the existing chain-aware contracts config shape so the final config contains per-chain SSO metadata, invoice address, token addresses, and token `assetId` values.
- Kept the flow idempotent where practical by reusing configured deployments when code already exists, reusing bridged token addresses when already materialized, and only topping up/mutating state when required.

## CITADEL

- Fixed setup runtime blockers discovered during end-to-end execution: temporary Foundry workspace source copy path creation, `forge --via-ir` build for `InvoicePayment`, and wallet signing on chain C by using local account objects instead of node-side signer assumptions.
- Replaced legacy interop bridge calls (`requestInterop` on `0x...001000b`) with the current 3-chain stack flow (`sendBundle` on `0x...0010010`) using ERC-7930 destination/call encoding and token transfer indirect call attributes.
- Updated setup defaults/examples to use the active interop center address (`0x0000000000000000000000000000000000010010`) and validated the generated output.
- Verified full setup execution completes without errors and that `config/contracts.json` contains chain-separated SSO metadata, chain C invoice + canonical token deployments, and bridged token mappings with shared `assetId` values.

## ORBIT

Implemented the backend invoice read endpoint for the web app dashboard:

- Added `backend/src/api/invoicesRouter.ts` with a chain C config loader, SIWE admin authentication, and a robust invoice fetch flow that reads created/pending invoice IDs, batches `getMultipleInvoiceDetails` calls, and falls back to per-invoice reads when needed.
- Normalized invoice payloads into web-app friendly JSON with merged source tags, stringified token values, and explicit chain metadata so the frontend can render a stable list view.
- Registered the new `/invoices` route in `backend/src/server.ts` and documented the endpoint, required chain C config fields, and auth assumptions in `backend/README.md`.

## NEBULA

Extended the backend to consume the chain-aware contracts config while preserving the legacy top-level fallback path:

- Added chain selection helpers in `backend/src/utils/contractsConfig.ts` so backend code can resolve the active chain deployment first, then fall back to the legacy top-level fields when needed.
- Updated backend env parsing to accept the additional 3-chain and token fallback variables used by the setup sync flow, including `PRIVIDIUM_CHAIN_A_ID`, `PRIVIDIUM_CHAIN_B_ID`, `PRIVIDIUM_CHAIN_C_ID`, invoice payment, and token address fallbacks.
- Reworked `deploySmartAccount` to mint USDC, SGD, and TBILL after faucet funding, resolving token addresses from the active chain in `config/contracts.json` first and falling back to legacy env values when config data is missing.
- Kept token minting resilient by recording per-token success, skipped, and failure metadata in the deploy response instead of failing the entire deploy if one mint cannot be completed.
- Updated `backend/.env.example` to document the 3-chain backend setup and the canonical token fallback variables used by the deploy flow.

## FORGE

- Added `backend/scripts/smoke-invoices.ts` to create a chain C smoke invoice, confirm the on-chain invoice state, and verify that the backend `/invoices` endpoint returns the new record.
- Added `backend/scripts/smoke-deploy-account.ts` to validate deploy-account readiness against live chains by checking SSO and token wiring, minting test balances on chain C, exercising the faucet endpoint, and asserting request validation behavior.
- Wired `backend/package.json` with `smoke:invoices`, `smoke:deploy-account`, and `smoke` scripts so the smoke checks can be run directly from the backend package.

## POLARIS

- Implemented chain-aware auth initialization in [`web-app/src/composables/usePrividium.ts`](/Users/antonio/MatterLabs/cross-border/web-app/src/composables/usePrividium.ts), including runtime chain selection (`A`/`B`), safe SDK reinitialization on switch, stale auth/profile cleanup, and fallback support for both `VITE_CHAIN_*` and `VITE_PRIVIDIUM_CHAIN_*` env naming patterns.
- Added persistence for selected login chain in local storage so the chosen auth context survives reloads and is reapplied on startup.
- Updated [`web-app/src/views/LoginView.vue`](/Users/antonio/MatterLabs/cross-border/web-app/src/views/LoginView.vue) with a chain toggle that lets users choose Chain A or Chain B before sign-in.
- Updated [`web-app/.env.example`](/Users/antonio/MatterLabs/cross-border/web-app/.env.example) and [`web-app/.env`](/Users/antonio/MatterLabs/cross-border/web-app/.env) to include explicit A/B chain configuration and per-chain client id entries.

## MERCURY

- Added typed backend invoice integration with loading/error/empty/success states via [`web-app/src/composables/useInvoices.ts`](/Users/antonio/MatterLabs/cross-border/web-app/src/composables/useInvoices.ts), [`web-app/src/types/invoices.ts`](/Users/antonio/MatterLabs/cross-border/web-app/src/types/invoices.ts), and [`web-app/src/utils/backend.ts`](/Users/antonio/MatterLabs/cross-border/web-app/src/utils/backend.ts).
- Implemented a reusable invoice table card in [`web-app/src/components/InvoiceTableCard.vue`](/Users/antonio/MatterLabs/cross-border/web-app/src/components/InvoiceTableCard.vue) with manual refresh and robust response parsing against `/invoices`.
- Integrated the table card into [`web-app/src/views/MainView.vue`](/Users/antonio/MatterLabs/cross-border/web-app/src/views/MainView.vue) while keeping existing counter interactions intact.

## ORCHID

- Built a reusable invoice creation modal in [`web-app/src/components/CreateInvoiceModal.vue`](/Users/antonio/MatterLabs/cross-border/web-app/src/components/CreateInvoiceModal.vue) with field validation and explicit submit/cancel/update events.
- Added invoice form utilities in [`web-app/src/utils/invoiceForm.ts`](/Users/antonio/MatterLabs/cross-border/web-app/src/utils/invoiceForm.ts) to pre-populate token options from deployed env vars, deduplicate tokens, and constrain destination chain selection to A/B only.
- Enforced payload invariants in the modal so `creatorRefundAddress` always equals `creator` and `recipientRefundAddress` always equals `recipient`.
- Wired the modal into [`web-app/src/views/MainView.vue`](/Users/antonio/MatterLabs/cross-border/web-app/src/views/MainView.vue) with an entry action and validated payload summary handling.

## HELIOS

- Added chain-aware branding in [`web-app/src/composables/usePrividium.ts`](/Users/antonio/MatterLabs/cross-border/web-app/src/composables/usePrividium.ts), so chain selection now resolves `companyName`, `accentColor`, and `companyIcon` from chain A/B env values with fallback to legacy single-chain vars.
- Updated [`web-app/src/App.vue`](/Users/antonio/MatterLabs/cross-border/web-app/src/App.vue), [`web-app/src/components/AppNavbar.vue`](/Users/antonio/MatterLabs/cross-border/web-app/src/components/AppNavbar.vue), and [`web-app/src/components/AppFooter.vue`](/Users/antonio/MatterLabs/cross-border/web-app/src/components/AppFooter.vue) to reactively apply the selected chain brand (title, accent color, and displayed name/icon).
- Extended [`web-app/.env.example`](/Users/antonio/MatterLabs/cross-border/web-app/.env.example) with chain-specific brand variables for A/B.
- Hardened logout in [`web-app/src/composables/usePrividium.ts`](/Users/antonio/MatterLabs/cross-border/web-app/src/composables/usePrividium.ts) to clear auth for both chains, wipe relevant local/session storage cache keys, reset chain selection, and force fresh manual login.
- Updated [`web-app/src/composables/useSsoAccount.ts`](/Users/antonio/MatterLabs/cross-border/web-app/src/composables/useSsoAccount.ts) so SSO account state is cleared immediately when unauthenticated, preventing stale wallet display after logout.

## ORION

Task codename: `ANCHOR-ID`

- Implemented application client provisioning for chains A and B in setup flow, including idempotent create/update logic via Admin API.
- Configured web app OAuth values for both chains with origin `http://localhost:5000` and callback `http://localhost:5000/auth-callback.html`.
- Persisted application metadata (`id`, `oauthClientId`, `oauthRedirectUris`, `origin`) into `config/contracts.json` under `chains.a.application` and `chains.b.application`.

## VEGA

Task codename: `OPEN-GATE`

- Implemented reusable public contract registration/permission helper that adds public read/write permissions for every ABI function if missing.
- Applied public permissions to all deployed setup contracts: SSO contracts on chains A/B, and `InvoicePayment` + tokens on chain C.
- Extended coverage to bridged token contracts on chains A and B so setup grants public method access across all deployed token contracts in the 3-chain flow.

## HELIOS

Task codename: `ENTRY-BOOST`

- Added entrypoint funding support to the setup runtime so `setup/src/main.ts` now checks chains A/B entrypoint balances and tops them up to a target threshold when needed.
- Added a standalone incremental script `setup:fund-entrypoints` (`setup/src/fund-entrypoints.ts`) that funds existing entrypoints only, so we can top up live deployments without rerunning the full setup.
- Added configurable funding thresholds in `setup/.env.example`: `ENTRYPOINT_MIN_BALANCE_WEI` and `ENTRYPOINT_TARGET_BALANCE_WEI`.
- Executed the standalone funding flow against current deployments; chain B entrypoint was topped up by `0.05 ETH`, and chain A was already sufficiently funded.

## HARBOR

Task codename: `KEYCLOAK-SEED-CHECK`

- Updated 3-chain local Keycloak realm seed in [`prividium-3chain-local/dev/keycloak/realm-export.json`](/Users/antonio/MatterLabs/cross-border/prividium-3chain-local/dev/keycloak/realm-export.json) so the fixed user UUID `00000000-0000-0000-0000-000000000002` is now `user@local.dev` (keeping `admin@local.dev` unchanged).
- Aligned OIDC seed display names for the same UUID in [`prividium-3chain-local/dev/seed-permissions-l2a.sql`](/Users/antonio/MatterLabs/cross-border/prividium-3chain-local/dev/seed-permissions-l2a.sql), [`prividium-3chain-local/dev/seed-permissions-l2b.sql`](/Users/antonio/MatterLabs/cross-border/prividium-3chain-local/dev/seed-permissions-l2b.sql), and [`prividium-3chain-local/dev/seed-permissions-l2c.sql`](/Users/antonio/MatterLabs/cross-border/prividium-3chain-local/dev/seed-permissions-l2c.sql) to match `user@local.dev`.
- Added deterministic verification script [`prividium-3chain-local/scripts/verify-keycloak-seed.sh`](/Users/antonio/MatterLabs/cross-border/prividium-3chain-local/scripts/verify-keycloak-seed.sh) that validates seeded users by obtaining OIDC tokens for `admin@local.dev` and `user@local.dev`.
- Documented the verification step in [`prividium-3chain-local/README.md`](/Users/antonio/MatterLabs/cross-border/prividium-3chain-local/README.md) and updated the default user table to include `user@local.dev`.
- Verified live against Docker Keycloak (`docker compose -f prividium-3chain-local/docker-compose.yml up -d --force-recreate --no-deps keycloak` + `./prividium-3chain-local/scripts/verify-keycloak-seed.sh`) with both required users passing.

## DOCKYARD

Task codename: `REMOVE-DEMO-APP`

- Removed the unused `demo-app` service block from [`prividium-3chain-local/docker-compose.yml`](/Users/antonio/MatterLabs/cross-border/prividium-3chain-local/docker-compose.yml) (image, ports, env, and dependency wiring).
- Confirmed there are no remaining `demo-app` references in the same compose file.
- Validated compose integrity with a non-disruptive parse check: `docker compose -f prividium-3chain-local/docker-compose.yml config`.
- Completed the corresponding Docker setup checklist item in [`TASKS.md`](/Users/antonio/MatterLabs/cross-border/TASKS.md).

## CONSTELLATION

Task codename: `INVOICE-FIRST-UX`

- Updated navbar session controls in [`web-app/src/components/AppNavbar.vue`](/Users/antonio/MatterLabs/cross-border/web-app/src/components/AppNavbar.vue) so authenticated users now have a dropdown with `Copy address` and `Logout`, and logout routes to `/login` after cleanup.
- Refocused dashboard UI in [`web-app/src/views/MainView.vue`](/Users/antonio/MatterLabs/cross-border/web-app/src/views/MainView.vue) to invoices/interop operations while preserving the activity table.
- Hardened invoice creator prefill in [`web-app/src/components/CreateInvoiceModal.vue`](/Users/antonio/MatterLabs/cross-border/web-app/src/components/CreateInvoiceModal.vue) to default from the current SSO wallet without overriding user edits once typing starts.
- Added real interop invoice submission with progress feedback by wiring [`web-app/src/composables/useInteropInvoice.ts`](/Users/antonio/MatterLabs/cross-border/web-app/src/composables/useInteropInvoice.ts) into [`web-app/src/views/MainView.vue`](/Users/antonio/MatterLabs/cross-border/web-app/src/views/MainView.vue), sending cross-chain create-invoice calls from chain A/B to chain C.

## AURORA-UX

Task codename: `BRAND-AND-BALANCES`

- Extended chain-aware branding env resolution in [`web-app/src/composables/usePrividium.ts`](/Users/antonio/MatterLabs/cross-border/web-app/src/composables/usePrividium.ts) to support `VITE_COMPANY_A_*` / `VITE_COMPANY_B_*` aliases (`NAME`, `ICON`) and `VITE_ACCENT_A_COLOR` / `VITE_ACCENT_B_COLOR`, so login chain switching updates branding with those vars.
- Fixed navbar visibility resilience in [`web-app/src/components/AppNavbar.vue`](/Users/antonio/MatterLabs/cross-border/web-app/src/components/AppNavbar.vue) so session/logout controls remain available on app routes even when runtime errors occur in invoice/network flows.
- Added an active-chain balances table at the top of [`web-app/src/views/MainView.vue`](/Users/antonio/MatterLabs/cross-border/web-app/src/views/MainView.vue), powered by new composable [`web-app/src/composables/useActiveChainBalances.ts`](/Users/antonio/MatterLabs/cross-border/web-app/src/composables/useActiveChainBalances.ts), showing native asset plus configured token balances (USDC/SGD/TBILL) for the current wallet.
- Updated the corresponding web-app checklist items in [`TASKS.md`](/Users/antonio/MatterLabs/cross-border/TASKS.md) to completed.

## CONSTELLATION

Task codename: `INVOICE-FIRST-UX`

- Updated navbar session controls in [`web-app/src/components/AppNavbar.vue`](/Users/antonio/MatterLabs/cross-border/web-app/src/components/AppNavbar.vue) so authenticated users now have a single dropdown with both `Copy address` and `Logout`, and logout routes to `/login` after running the existing clean sign-out flow.
- Hardened invoice creator prefill in [`web-app/src/components/CreateInvoiceModal.vue`](/Users/antonio/MatterLabs/cross-border/web-app/src/components/CreateInvoiceModal.vue) by defaulting to the current SSO wallet on open and on SSO updates, while preserving user edits via a local dirty-state guard.
- Refocused dashboard UI in [`web-app/src/views/MainView.vue`](/Users/antonio/MatterLabs/cross-border/web-app/src/views/MainView.vue) to invoices and interop status only (counter interaction panels removed), while keeping the activity table visible.
- Implemented real cross-chain invoice submission with step-by-step feedback by adding [`web-app/src/composables/useInteropInvoice.ts`](/Users/antonio/MatterLabs/cross-border/web-app/src/composables/useInteropInvoice.ts) and wiring it in [`web-app/src/views/MainView.vue`](/Users/antonio/MatterLabs/cross-border/web-app/src/views/MainView.vue). The flow now builds and submits an interop bundle from chain A/B to chain C `InvoicePayment.createInvoice(...)`, then polls `/invoices` until the created invoice appears.
- Updated the four remaining web-app checklist items in [`TASKS.md`](/Users/antonio/MatterLabs/cross-border/TASKS.md) to completed.

## PULSAR

Task codename: `PERMISSION-BUNDLER-WIREUP`

- Added compose updater helper [`setup/src/tools/permissions-api-compose.ts`](/Users/antonio/MatterLabs/cross-border/setup/src/tools/permissions-api-compose.ts) that patches `prividium-3chain-local/docker-compose.yml` for `permissions-api-l2a` and `permissions-api-l2b`.
- The updater now idempotently ensures these env variables exist with current deployed values per chain: `BUNDLER_ENABLED`, `BUNDLER_RPC_URL` (derived from each service `SEQUENCER_RPC_URL` by default), `DISPATCHER_SSO_IMPLEMENTATIONS`, and `DISPATCHER_SSO_BYTECODE_HASHES`.
- Wired the updater into the main setup flow in [`setup/src/main.ts`](/Users/antonio/MatterLabs/cross-border/setup/src/main.ts) right after writing `config/contracts.json`, using chain A/B SSO implementation address and bytecode hash outputs from deployment.
- Added terminal output in setup summary printing the restart command required for permission APIs A/B so new env vars are applied.
- Marked the remaining setup-script checklist item as complete in [`TASKS.md`](/Users/antonio/MatterLabs/cross-border/TASKS.md).

## PULSAR-OPS

Task codename: `PERMISSION-BUNDLER-STANDALONE`

- Added standalone command [`setup/src/update-permissions-compose.ts`](/Users/antonio/MatterLabs/cross-border/setup/src/update-permissions-compose.ts) that updates only `prividium-3chain-local/docker-compose.yml` using already-deployed chain A/B values from `config/contracts.json` (no contract deployment).
- Added script entries:
  - [`setup/package.json`](/Users/antonio/MatterLabs/cross-border/setup/package.json): `setup:update-permissions-compose`
  - [`package.json`](/Users/antonio/MatterLabs/cross-border/package.json): root passthrough `setup:update-permissions-compose`
- Executed the standalone command successfully; compose now contains `BUNDLER_ENABLED`, `BUNDLER_RPC_URL`, `DISPATCHER_SSO_IMPLEMENTATIONS`, and `DISPATCHER_SSO_BYTECODE_HASHES` for `permissions-api-l2a` and `permissions-api-l2b`.
