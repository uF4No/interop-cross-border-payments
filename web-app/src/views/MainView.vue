<template>
  <div class="max-w-6xl mx-auto space-y-10 animate-in fade-in slide-in-from-bottom-4 duration-700 pt-8">
    <div class="flex flex-col items-center justify-center text-center py-10 space-y-6">
      <div class="space-y-4 max-w-3xl">
        <p class="text-[11px] font-black uppercase tracking-[0.28em] text-slate-400">
          Cross-Border Payments Desk
        </p>
        <h2 class="text-4xl font-bold text-slate-900 tracking-tight text-balance">
          Cross-border payments and settlement
        </h2>
        <p class="text-base leading-relaxed text-slate-500">
          Payment requests submit real interop bundles to chain C. Settlement bridges funds from
          the active source chain into your chain C shadow account before completing on
          <span class="font-semibold text-slate-700">InvoicePayment</span>.
        </p>
      </div>

      <div class="enterprise-card w-full max-w-4xl overflow-hidden p-0 text-left">
        <div class="flex flex-col gap-4 border-b border-slate-100 px-6 py-5 md:flex-row md:items-center md:justify-between">
          <div class="space-y-1">
            <p class="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Account Overview</p>
            <h3 class="text-lg font-bold text-slate-900">Welcome back, {{ userName }}.</h3>
            <p class="text-sm text-slate-500">
              Here is a snapshot of the balances currently available in your account.
            </p>
            <div class="flex flex-wrap items-center gap-2 pt-1">
              <span
                class="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500"
              >
                <span
                  class="h-2 w-2 rounded-full"
                  :class="isBalancesPolling ? 'bg-sky-500 animate-pulse' : 'bg-emerald-500'"
                ></span>
                Auto-refresh every {{ balancesAutoRefreshSeconds }}s
              </span>
              <span v-if="balancesLastUpdatedLabel" class="text-xs text-slate-400">
                Last updated {{ balancesLastUpdatedLabel }}
              </span>
            </div>
          </div>

        </div>

        <div class="px-6 py-5">
          <div
            v-if="tokenFundingNotice"
            class="mb-4 rounded-2xl border px-4 py-3 text-sm"
            :class="tokenFundingNoticeClass"
          >
            {{ tokenFundingNotice }}
          </div>

          <div
            v-if="!ssoAccount"
            class="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500"
          >
            Current wallet not linked.
          </div>

          <div
            v-else-if="!hasBalanceRows && isBalancesLoading"
            class="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500"
          >
            Loading balances for {{ sourceChainLabel }}.
          </div>

          <div
            v-else-if="balancesError && !hasBalanceRows"
            class="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-800"
          >
            {{ balancesError }}
          </div>

          <div v-else class="space-y-4">
            <div
              v-if="balancesError && hasBalanceRows"
              class="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-800"
            >
              Unable to refresh balances. Showing the last loaded snapshot.
              <span class="mt-1 block" style="overflow-wrap:anywhere;">{{ balancesError }}</span>
            </div>

            <div v-if="visibleBalanceRows.length > 0" class="grid gap-4 md:grid-cols-3">
              <div
                v-for="row in visibleBalanceRows"
                :key="row.asset"
                class="rounded-3xl border border-slate-100 bg-white px-5 py-5 shadow-sm"
              >
                <div class="flex items-start justify-between gap-3">
                  <div class="space-y-1">
                    <p class="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Available balance</p>
                    <h4 class="text-base font-bold text-slate-900">{{ row.asset }}</h4>
                  </div>

                  <div
                    v-if="row.address"
                    data-balance-menu
                    class="relative"
                  >
                    <button
                      type="button"
                      class="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-slate-500 transition-colors hover:border-slate-300 hover:bg-slate-100 hover:text-slate-700"
                      @click.stop="toggleBalanceMenu(row.asset)"
                    >
                      <BaseIcon name="EllipsisHorizontalIcon" class="h-4 w-4" />
                    </button>

                    <div
                      v-if="openBalanceMenuKey === row.asset"
                      class="absolute right-0 top-11 z-10 w-64 rounded-2xl border border-slate-100 bg-white p-3 shadow-2xl"
                      @click.stop
                    >
                      <p class="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Asset details</p>
                      <p class="mt-2 text-xs font-semibold text-slate-600">Contract address</p>
                      <p class="mt-1 font-mono text-[11px] leading-relaxed text-slate-500" style="overflow-wrap:anywhere;">
                        {{ row.address }}
                      </p>
                      <a
                        v-if="sourceAddressExplorerHref(row.address)"
                        :href="sourceAddressExplorerHref(row.address)"
                        target="_blank"
                        rel="noreferrer"
                        class="mt-3 inline-flex items-center gap-2 text-xs font-bold text-slate-600 transition-colors hover:text-slate-900"
                      >
                        <BaseIcon name="ArrowTopRightOnSquareIcon" class="h-3.5 w-3.5" />
                        <span>View in explorer</span>
                      </a>
                    </div>
                  </div>
                </div>

                <div class="mt-6 flex items-end justify-between gap-4">
                  <div>
                    <p class="text-3xl font-bold tracking-tight text-slate-900">{{ row.balance }}</p>
                  </div>
                  <div class="rounded-2xl bg-slate-50 px-3 py-2 text-right">
                    <p class="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Asset</p>
                    <p class="mt-1 text-sm font-bold text-slate-700">{{ row.asset }}</p>
                  </div>
                </div>
              </div>
            </div>

            <div
              v-else
              class="rounded-3xl border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500"
            >
              No settlement balances are available on this account yet.
            </div>

            <details
              v-if="nativeBalanceRow"
              class="rounded-3xl border border-slate-200 bg-slate-50/80"
            >
              <summary class="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4">
                <div>
                  <p class="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Additional balance</p>
                  <p class="mt-1 text-sm font-semibold text-slate-700">
                    Show network balance ({{ nativeBalanceRow.asset }})
                  </p>
                </div>
                <BaseIcon name="ChevronDownIcon" class="h-4 w-4 text-slate-400" />
              </summary>

              <div class="border-t border-slate-200 px-5 py-4">
                <div class="flex items-end justify-between gap-4">
                  <div>
                    <p class="text-2xl font-bold text-slate-900">{{ nativeBalanceRow.balance }}</p>
                    <p class="mt-1 text-xs text-slate-500">
                      Native network balance kept out of the default account summary.
                    </p>
                  </div>
                  <div class="rounded-2xl bg-white px-3 py-2 text-right">
                    <p class="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Asset</p>
                    <p class="mt-1 text-sm font-bold text-slate-700">{{ nativeBalanceRow.asset }}</p>
                  </div>
                </div>
              </div>
            </details>
          </div>
        </div>
      </div>

      <a
        class="flex items-center gap-2 justify-center bg-white px-4 py-2 rounded-full border border-slate-100 shadow-sm group cursor-pointer hover:border-accent/30 transition-all"
        :href="destinationInvoicePaymentExplorerHref ?? undefined"
        target="_blank"
        rel="noreferrer"
        @click="copyContractAddress"
      >
        <span class="text-[10px] font-black uppercase tracking-widest text-slate-400 mr-2">
          Chain C Settlement Contract
        </span>
        <span class="text-xs font-mono text-slate-500">
          {{ destinationInvoicePaymentAddress?.slice(0, 10) }}...{{ destinationInvoicePaymentAddress?.slice(-8) }}
        </span>
        <BaseIcon
          :name="copied ? 'CheckIcon' : 'DocumentDuplicateIcon'"
          :class="copied ? 'text-green-500' : 'text-slate-300 group-hover:text-accent'"
          class="w-3.5 h-3.5 transition-colors"
        />
      </a>

      <div class="flex flex-wrap items-center justify-center gap-4 pt-2">
        <button
          class="enterprise-button-primary min-w-[200px] h-14 text-base font-semibold"
          :disabled="isInvoiceProcessing || !canOpenInvoiceModal"
          @click="openCreateInvoiceModal"
        >
          <BaseIcon name="PlusCircleIcon" class="w-5 h-5" />
          {{ isInvoiceProcessing ? 'Interop in Progress' : 'New Payment Request' }}
        </button>
      </div>
    </div>

    <div
      v-if="errorMessage"
      class="mx-auto w-full max-w-3xl px-5 py-4 bg-red-50 border border-red-100 rounded-2xl flex items-start gap-3 animate-in slide-in-from-top-2 duration-300"
    >
      <BaseIcon name="ExclamationTriangleIcon" class="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
      <p class="min-w-0 flex-1 text-red-800 font-semibold text-xs leading-relaxed" style="overflow-wrap:anywhere;">
        {{ errorMessage }}
      </p>
      <button @click="errorMessage = ''" class="text-red-400 hover:text-red-600 transition-colors shrink-0">
        &times;
      </button>
    </div>

    <InvoiceTableCard
      ref="invoiceTableCardRef"
      :active-chain-id="activeChainId"
      :is-interop-processing="isInvoiceProcessing"
      :processing-invoice-id="processingInvoiceId"
      @pay="handlePayInvoice"
    />

    <CreateInvoiceModal
      v-model="isCreateInvoiceModalOpen"
      :creator-chain-id="activeChainId"
      :initial-values="{ creator: ssoAccount ?? '' }"
      @submit="handleCreateInvoiceSubmit"
      @cancel="handleCreateInvoiceCancel"
    />

    <PayInvoiceModal
      v-model="isPayInvoiceModalOpen"
      :invoice="payInvoiceTarget"
      :payment-options="payInvoiceOptions"
      :quote-type="payInvoiceQuoteType"
      :loading="payInvoiceOptionsLoading"
      :load-error="payInvoiceOptionsError"
      :is-submitting="processingInvoiceId === payInvoiceTarget?.id"
      :disable-confirm-reason="payInvoiceDisableReason"
      :has-sufficient-billing-liquidity="payInvoiceHasSufficientBillingLiquidity"
      :billing-liquidity-amount="payInvoiceBillingLiquidityAmount"
      :billing-token-symbol="payInvoiceBillingTokenSymbol"
      @confirm="handlePayInvoiceConfirm"
      @cancel="handlePayInvoiceModalCancel"
    />

    <div class="enterprise-card overflow-hidden">
      <div class="px-8 py-6 border-b border-slate-100 flex items-center justify-between">
        <h4 class="text-lg font-bold text-slate-900">Activity & Progress</h4>
        <span class="text-xs font-bold text-slate-400 bg-slate-50 px-3 py-1 rounded-full border border-slate-100">
          {{ transactions.length }} total
        </span>
      </div>

      <div class="divide-y divide-slate-50 max-h-[720px] overflow-y-auto">
        <div v-if="transactions.length === 0" class="px-8 py-16 text-center">
          <BaseIcon name="InboxIcon" class="w-12 h-12 text-slate-200 mx-auto mb-4" />
          <p class="text-slate-400 text-sm font-medium">No recent transactions</p>
        </div>

        <div
          v-for="tx in transactions"
          :key="tx.id"
          class="px-8 py-5 hover:bg-slate-50/50 transition-colors"
        >
          <div class="flex items-start justify-between gap-6">
            <div class="flex items-start gap-4 min-w-0">
              <div
                class="w-10 h-10 rounded-full flex items-center justify-center border shrink-0"
                :class="{
                  'bg-green-50 border-green-100 text-green-600': tx.status === 'success',
                  'bg-amber-50 border-amber-100 text-amber-600': tx.status === 'pending',
                  'bg-red-50 border-red-100 text-red-600': tx.status === 'failed'
                }"
              >
                <BaseIcon v-if="tx.status === 'success'" name="CheckIcon" class="w-5 h-5" />
                <BaseIcon v-else-if="tx.status === 'pending'" name="ArrowPathIcon" class="w-5 h-5 animate-spin" />
                <BaseIcon v-else name="XMarkIcon" class="w-5 h-5" />
              </div>
              <div class="min-w-0">
                <div class="flex flex-wrap items-center gap-2">
                  <h5 class="text-sm font-bold text-slate-900">{{ tx.function }}</h5>
                  <span
                    v-if="tx.interop"
                    class="rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em]"
                    :class="interopStatusBadgeClass(tx.interop.status)"
                  >
                    {{ interopStatusBadgeLabel(tx.interop.status) }}
                  </span>
                </div>
                <a
                  v-if="activityHashExplorerHref(tx)"
                  :href="activityHashExplorerHref(tx) ?? undefined"
                  target="_blank"
                  rel="noreferrer"
                  class="mt-1 block text-xs font-mono text-slate-400 transition-colors hover:text-slate-600 hover:underline"
                  :title="tx.hash"
                >
                  {{ tx.hash }}
                </a>
                <p v-else class="text-xs font-mono text-slate-400 mt-1">{{ tx.hash }}</p>
                <p class="text-xs text-slate-500 mt-2 leading-relaxed" style="overflow-wrap:anywhere;">
                  {{ tx.detail }}
                </p>
              </div>
            </div>
            <p class="text-[10px] font-bold text-slate-300 uppercase tracking-widest shrink-0">{{ tx.timestamp }}</p>
          </div>

          <div
            v-if="tx.interop"
            class="ml-14 mt-4 space-y-4 rounded-3xl border border-slate-100 bg-slate-50 px-5 py-5"
          >
            <div class="space-y-1">
              <p class="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">
                {{ tx.interop.flow === 'pay' ? 'Cross-Border Payment Flow' : 'Payment Request Flow' }}
              </p>
              <p class="text-sm text-slate-600">{{ tx.interop.message }}</p>
              <p class="text-xs text-slate-400">{{ tx.interop.summary }}</p>
            </div>

            <div class="space-y-3">
              <div
                v-for="(step, index) in interopStepsForFlow(tx.interop.flow, tx.interop.mode)"
                :key="`${tx.id}-${step.id}`"
                class="flex items-start gap-3"
              >
                <div
                  class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs font-black"
                  :class="activityStepIconClass(tx.interop, step.id)"
                >
                  <BaseIcon
                    v-if="activityStepState(tx.interop, step.id) === 'complete'"
                    name="CheckIcon"
                    class="h-4 w-4"
                  />
                  <BaseIcon
                    v-else-if="activityStepState(tx.interop, step.id) === 'current'"
                    name="ArrowPathIcon"
                    class="h-4 w-4 animate-spin"
                  />
                  <BaseIcon
                    v-else-if="activityStepState(tx.interop, step.id) === 'failed'"
                    name="XMarkIcon"
                    class="h-4 w-4"
                  />
                  <span v-else>{{ index + 1 }}</span>
                </div>

                <div
                  class="min-w-0 flex-1 rounded-2xl border px-4 py-3"
                  :class="activityStepCardClass(tx.interop, step.id)"
                >
                  <p class="text-sm font-bold text-slate-900">{{ step.label }}</p>
                  <p class="mt-1 text-xs leading-relaxed text-slate-500" style="overflow-wrap:anywhere;">
                    {{ tx.interop.stepDetails[step.id] || step.description }}
                  </p>
                </div>
              </div>
            </div>

            <div
              v-if="tx.interop.sourceTxHash || tx.interop.bundleHash || tx.interop.invoiceId"
              class="grid gap-2 md:grid-cols-3"
            >
              <div
                v-if="tx.interop.sourceTxHash"
                class="rounded-2xl border border-slate-100 bg-white px-4 py-3 text-xs"
              >
                <span class="font-black uppercase tracking-[0.18em] text-slate-400">Source tx</span>
                <a
                  v-if="activitySourceTxExplorerHref(tx.interop)"
                  :href="activitySourceTxExplorerHref(tx.interop) ?? undefined"
                  target="_blank"
                  rel="noreferrer"
                  class="mt-1 block font-mono text-slate-600 transition-colors hover:text-slate-800 hover:underline"
                  :title="tx.interop.sourceTxHash"
                >
                  {{ truncateHash(tx.interop.sourceTxHash) }}
                </a>
                <p v-else class="mt-1 font-mono text-slate-600">{{ truncateHash(tx.interop.sourceTxHash) }}</p>
              </div>
              <div
                v-if="tx.interop.bundleHash"
                class="rounded-2xl border border-slate-100 bg-white px-4 py-3 text-xs"
              >
                <span class="font-black uppercase tracking-[0.18em] text-slate-400">Bundle</span>
                <p class="mt-1 font-mono text-slate-600">{{ truncateHash(tx.interop.bundleHash) }}</p>
              </div>
              <div
                v-if="tx.interop.invoiceId"
                class="rounded-2xl border border-slate-100 bg-white px-4 py-3 text-xs"
              >
                <span class="font-black uppercase tracking-[0.18em] text-slate-400">Invoice ID</span>
                <p class="mt-1 font-mono text-slate-600">{{ tx.interop.invoiceId }}</p>
              </div>
            </div>

            <div
              v-if="tx.interop.error"
              class="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-xs text-red-800"
            >
              {{ tx.interop.error }}
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { formatEther, formatUnits } from 'viem';
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import BaseIcon from '../components/BaseIcon.vue';
import CreateInvoiceModal from '../components/CreateInvoiceModal.vue';
import InvoiceTableCard from '../components/InvoiceTableCard.vue';
import PayInvoiceModal from '../components/PayInvoiceModal.vue';
import { useActiveChainBalances } from '../composables/useActiveChainBalances';
import { type InteropMode, useInteropMode } from '../composables/useInteropMode';
import { useInteropInvoice } from '../composables/useInteropInvoice';
import { usePrividium } from '../composables/usePrividium';
import { useSsoAccount } from '../composables/useSsoAccount';
import {
  ACTIVE_CHAIN_BALANCES_REFRESH_EVENT,
  INVOICES_REFRESH_EVENT
} from '../composables/useDashboardRefresh';
import { useTestTokenFunding } from '../composables/useTestTokenFunding';
import type {
  BackendServiceResponse,
  InvoicePaymentOption,
  InvoicePaymentOptionsResponseObject,
  InvoiceRecord,
  InvoiceResponseObject,
  InvoiceSourceTag
} from '../types/invoices';
import { getBackendUrl } from '../utils/backend';
import {
  buildExplorerAddressUrl,
  buildExplorerTxUrl,
  type ExplorerChainKey,
  isExplorerTxHash
} from '../utils/explorer';
import type { CreateInvoiceSubmitPayload } from '../utils/invoiceForm';

type BannerTone = 'info' | 'success' | 'error';
type ActivityStatus = 'pending' | 'success' | 'failed';
type InteropFlow = 'create' | 'pay';
type InteropStatus = 'idle' | 'running' | 'failed' | 'success';
type InteropStepId =
  | 'create-validate'
  | 'create-submit'
  | 'create-relay'
  | 'create-confirm'
  | 'pay-validate'
  | 'pay-prepare'
  | 'pay-fund'
  | 'pay-settle'
  | 'pay-confirm';
type InteropStepDefinition = {
  id: InteropStepId;
  label: string;
  description: string;
};
type InteropStepState = 'upcoming' | 'current' | 'complete' | 'failed';
type ActivityInteropEntry = {
  mode: InteropMode;
  flow: InteropFlow;
  sourceChainKey: ExplorerChainKey;
  status: InteropStatus;
  currentStepId: InteropStepId | null;
  stepDetails: Partial<Record<InteropStepId, string>>;
  message: string;
  summary: string;
  sourceTxHash: string;
  bundleHash: string;
  invoiceId: string;
  error: string;
};

type ActivityEntry = {
  id: string;
  function: string;
  status: ActivityStatus;
  hash: string;
  hashChainKey?: ExplorerChainKey;
  detail: string;
  timestamp: string;
  interop?: ActivityInteropEntry;
};

type InvoiceDraftSummary = {
  creator: string;
  recipient: string;
  creatorChainId: number;
  recipientChainId: number;
  billingTokenSymbol: string;
  amount: string;
  text: string;
  sourceTxHash?: string;
  invoiceId?: string;
};

type InvoiceTableCardExposed = {
  refreshInvoices: () => Promise<void>;
};

const PUBLIC_CREATE_INTEROP_STEPS: readonly InteropStepDefinition[] = [
  {
    id: 'create-validate',
    label: 'Validate payment request',
    description: 'Check payment details, source-chain context, and the configured chain C route.'
  },
  {
    id: 'create-submit',
    label: 'Send source bundle',
    description:
      'The creator smart account signs one user operation that calls source-chain InteropCenter.sendBundle(...).'
  },
  {
    id: 'create-relay',
    label: 'Finalize and relay',
    description:
      'Wait for L2 to L1 finalization and for the interop relay to execute createInvoice on chain C.'
  },
  {
    id: 'create-confirm',
    label: 'Confirm payment request on chain C',
    description: 'Detect the new payment request on chain C. Creation moves no ERC20 tokens.'
  }
] as const;
const PRIVATE_CREATE_INTEROP_STEPS: readonly InteropStepDefinition[] = [
  PUBLIC_CREATE_INTEROP_STEPS[0],
  PUBLIC_CREATE_INTEROP_STEPS[1],
  {
    id: 'create-relay',
    label: 'Wait for private execution',
    description:
      'Wait for the private executor to execute the createInvoice bundle on chain C before checking for the new payment request.'
  },
  PUBLIC_CREATE_INTEROP_STEPS[3]
] as const;
const PUBLIC_PAY_INTEROP_STEPS: readonly InteropStepDefinition[] = [
  {
    id: 'pay-validate',
    label: 'Validate payment route',
    description:
      'Check payment-request state, payer wallet ownership, and whether chain C settlement can proceed.'
  },
  {
    id: 'pay-prepare',
    label: 'Approve source vault',
    description:
      'Approve the source native token vault only if the payer wallet needs extra allowance before funding.'
  },
  {
    id: 'pay-fund',
    label: 'Fund payer shadow account',
    description:
      'Bridge the missing payment token amount into the deterministic chain C shadow account, or skip if already funded.'
  },
  {
    id: 'pay-settle',
    label: 'Approve and pay on chain C',
    description:
      'Send the settlement bundle that executes ERC20.approve(...) and InvoicePayment.payInvoice(...) from the payer shadow account.'
  },
  {
    id: 'pay-confirm',
    label: 'Confirm payment settled',
    description:
      'Wait for chain C to mark the payment request paid. Any cross-chain creator payout happens later in the backend.'
  }
] as const;
const PRIVATE_PAY_INTEROP_STEPS: readonly InteropStepDefinition[] = [
  PUBLIC_PAY_INTEROP_STEPS[0],
  PUBLIC_PAY_INTEROP_STEPS[1],
  {
    id: 'pay-fund',
    label: 'Fund payer shadow account',
    description:
      'Privately bridge the missing payment token amount into the deterministic chain C shadow account, then wait for private execution and destination balance confirmation.'
  },
  {
    id: 'pay-settle',
    label: 'Approve and pay on chain C',
    description:
      'Send the private settlement bundle so the payer shadow account approves the token and calls InvoicePayment.payInvoice(...) on chain C.'
  },
  PUBLIC_PAY_INTEROP_STEPS[4]
] as const;
const INVOICE_POLL_INTERVAL_MS = 10000;
const INVOICE_POLL_TIMEOUT_MS = 90000;
const SHADOW_ACCOUNT_POLL_INTERVAL_MS = 3000;
const SHADOW_ACCOUNT_POLL_TIMEOUT_MS = 90000;
const MAX_ERROR_MESSAGE_LENGTH = 220;
const router = useRouter();
const { isAuthenticated, getChain, userName } = usePrividium();
const { mode: interopMode } = useInteropMode();
const { account: ssoAccount } = useSsoAccount();
const {
  sourceConfig,
  destinationConfig,
  filterPaymentOptions,
  readDestinationTokenBalance,
  readPayInvoicePreflight,
  sendCreateInvoiceBundle,
  sendFundPayInvoiceBundle,
  sendSettlePayInvoiceBundle,
  waitForBundleExecution
} = useInteropInvoice();
const {
  rows: balanceRows,
  isLoading: isBalancesLoading,
  isPolling: isBalancesPolling,
  lastUpdatedAt: balancesLastUpdatedAt,
  refreshIntervalMs: balancesRefreshIntervalMs,
  error: balancesError,
  refresh: refreshBalances
} = useActiveChainBalances();
const { tokenFundingNotice, tokenFundingNoticeClass } = useTestTokenFunding();
const timestampFormatter = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit'
});

const copied = ref(false);
const openBalanceMenuKey = ref<string | null>(null);
const isCreateInvoiceModalOpen = ref(false);
const isPayInvoiceModalOpen = ref(false);
const createInvoiceBanner = ref('');
const createInvoiceBannerTone = ref<BannerTone>('info');
const lastInvoiceDraft = ref<InvoiceDraftSummary | null>(null);
const transactions = ref<ActivityEntry[]>([]);
const invoiceTableCardRef = ref<InvoiceTableCardExposed | null>(null);
const errorMessage = ref('');
const interopFlow = ref<InteropFlow | null>(null);
const interopActivityMode = ref<InteropMode>('public');
const interopStatus = ref<InteropStatus>('idle');
const interopCurrentStepId = ref<InteropStepId | null>(null);
const interopStepDetails = ref<Partial<Record<InteropStepId, string>>>({});
const interopMessage = ref('');
const interopError = ref('');
const interopSourceTxHash = ref('');
const interopBundleHash = ref('');
const interopInvoiceId = ref('');
const interopSourceChainKey = ref<ExplorerChainKey>('A');
const processingInvoiceId = ref('');
const payInvoiceTarget = ref<InvoiceRecord | null>(null);
const payInvoiceMode = ref<InteropMode>('public');
const payInvoiceOptions = ref<InvoicePaymentOption[]>([]);
const payInvoiceOptionsLoading = ref(false);
const payInvoiceOptionsError = ref('');
const payInvoiceQuoteType = ref<'exact'>('exact');
const payInvoiceBillingTokenSymbol = ref('');
const payInvoiceBillingLiquidityAmount = ref('0');
const payInvoiceHasSufficientBillingLiquidity = ref(true);

const activeChainId = computed(() => Number(getChain().id));
const sourceChainLabel = computed(() => `Chain ${sourceConfig.value.chainKey}`);
const destinationChainId = computed(() => destinationConfig.value.chainId ?? null);
const currentInteropCenterAddress = computed(() => sourceConfig.value.interopCenter ?? null);
const destinationInvoicePaymentAddress = computed(
  () => destinationConfig.value.invoicePayment ?? null
);
const destinationInvoicePaymentExplorerHref = computed(() =>
  destinationInvoicePaymentAddress.value
    ? buildExplorerAddressUrl('C', destinationInvoicePaymentAddress.value)
    : undefined
);
const hasBalanceRows = computed(() => balanceRows.value.length > 0);
const visibleBalanceRows = computed(() => balanceRows.value.filter((row) => row.type !== 'native'));
const nativeBalanceRow = computed(
  () => balanceRows.value.find((row) => row.type === 'native') ?? null
);
const balancesAutoRefreshSeconds = Math.floor(balancesRefreshIntervalMs / 1000);
const balancesLastUpdatedLabel = computed(() =>
  balancesLastUpdatedAt.value
    ? timestampFormatter.format(new Date(balancesLastUpdatedAt.value))
    : ''
);
const canOpenInvoiceModal = computed(() =>
  Boolean(
    ssoAccount.value && currentInteropCenterAddress.value && destinationInvoicePaymentAddress.value
  )
);
const isInvoiceProcessing = computed(() =>
  transactions.value.some((entry) => entry.status === 'pending' && Boolean(entry.interop))
);
const payInvoiceDisableReason = computed(() => {
  if (!payInvoiceTarget.value) {
    return 'Select an invoice to continue.';
  }
  if (payInvoiceOptionsLoading.value || payInvoiceOptionsError.value) {
    return '';
  }
  if (payInvoiceTarget.value.status.trim().toLowerCase() !== 'created') {
    return `Invoice ${payInvoiceTarget.value.id} is ${payInvoiceTarget.value.status} and cannot be paid.`;
  }
  if (!payInvoiceHasSufficientBillingLiquidity.value) {
    return 'InvoicePayment lacks enough billed-token liquidity on chain C for this invoice.';
  }
  if (payInvoiceOptions.value.length === 0) {
    return `No supported payment tokens are configured on ${sourceChainLabel.value}.`;
  }
  return '';
});
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const toStringValue = (value: unknown): string | null => {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'bigint') return value.toString();
  return null;
};

const toNumberValue = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  if (typeof value === 'bigint') return Number(value);
  return null;
};

const isInvoiceSourceTag = (value: unknown): value is InvoiceSourceTag =>
  value === 'created' || value === 'pending';

const isInvoiceRecord = (value: unknown): value is InvoiceRecord => {
  if (!isRecord(value)) return false;

  const id = toStringValue(value.id);
  const creator = toStringValue(value.creator);
  const recipient = toStringValue(value.recipient);
  const creatorRefundAddress = toStringValue(value.creatorRefundAddress);
  const recipientRefundAddress = toStringValue(value.recipientRefundAddress);
  const billingToken = toStringValue(value.billingToken);
  const amount = toStringValue(value.amount);
  const paymentToken = value.paymentToken;
  const paymentAmount = toStringValue(value.paymentAmount);
  const status = toStringValue(value.status);
  const creatorChainId = toNumberValue(value.creatorChainId);
  const recipientChainId = toNumberValue(value.recipientChainId);
  const paidAt = value.paidAt;
  const text = toStringValue(value.text);
  const sourceTags = value.sourceTags;

  return Boolean(
    id &&
      creator &&
      recipient &&
      creatorRefundAddress &&
      recipientRefundAddress &&
      billingToken &&
      amount &&
      (paymentToken === null || paymentToken === undefined || typeof paymentToken === 'string') &&
      paymentAmount &&
      status &&
      creatorChainId !== null &&
      recipientChainId !== null &&
      (paidAt === null || paidAt === undefined || typeof paidAt === 'string') &&
      text !== null &&
      Array.isArray(sourceTags) &&
      sourceTags.every(isInvoiceSourceTag)
  );
};

const isServiceResponse = <T>(value: unknown): value is BackendServiceResponse<T> => {
  if (!isRecord(value)) return false;
  return (
    typeof value.success === 'boolean' &&
    typeof value.message === 'string' &&
    typeof value.statusCode === 'number'
  );
};

const isInvoicePaymentOption = (value: unknown): value is InvoicePaymentOption => {
  if (!isRecord(value)) return false;

  return Boolean(
    toStringValue(value.token) &&
      toStringValue(value.symbol) &&
      toStringValue(value.paymentAmount) &&
      typeof value.isBillingToken === 'boolean'
  );
};

const isInvoiceResponseObject = (value: unknown): value is InvoiceResponseObject => {
  if (!isRecord(value) || !Array.isArray(value.invoices)) return false;
  return value.invoices.every(isInvoiceRecord);
};

const isInvoicePaymentOptionsResponseObject = (
  value: unknown
): value is InvoicePaymentOptionsResponseObject => {
  if (!isRecord(value) || !Array.isArray(value.options)) return false;

  return Boolean(
    toStringValue(value.invoiceId) &&
      toStringValue(value.status) &&
      toStringValue(value.billingToken) &&
      toStringValue(value.billingTokenSymbol) &&
      toStringValue(value.billingAmount) &&
      value.quoteType === 'exact' &&
      toStringValue(value.invoicePaymentBillingTokenBalance) &&
      typeof value.hasSufficientBillingLiquidity === 'boolean' &&
      value.options.every(isInvoicePaymentOption)
  );
};

const truncateError = (message: string, maxLength = MAX_ERROR_MESSAGE_LENGTH) => {
  if (message.length <= maxLength) return message;
  return `${message.slice(0, maxLength - 1).trimEnd()}…`;
};

const formatTransactionError = (
  error: unknown,
  fallback = 'Failed to send interop transaction'
): string => {
  const rawMessage = error instanceof Error ? error.message : '';
  if (!rawMessage) return fallback;

  const detailsMatch = rawMessage.match(/details:\s*(.+)$/i);
  if (detailsMatch?.[1]) {
    return truncateError(detailsMatch[1]);
  }

  const firstLine = rawMessage.split('\n')[0]?.trim();
  if (firstLine) {
    return truncateError(firstLine);
  }

  return fallback;
};

const truncateHash = (value: string, head = 10, tail = 8) =>
  value.length > head + tail + 3 ? `${value.slice(0, head)}...${value.slice(-tail)}` : value;

const formatEthAmount = (value: bigint) => {
  const [whole, fraction = ''] = formatEther(value).split('.');
  const trimmedFraction = fraction.slice(0, 6).replace(/0+$/g, '');
  return trimmedFraction ? `${whole}.${trimmedFraction}` : whole;
};

const formatTokenAmount = (value: bigint) => formatUnits(value, 18);

const copyContractAddress = () => {
  if (!destinationInvoicePaymentAddress.value) {
    return;
  }

  void navigator.clipboard.writeText(destinationInvoicePaymentAddress.value);
  copied.value = true;
  setTimeout(() => {
    copied.value = false;
  }, 2000);
};

const sourceAddressExplorerHref = (address: string) =>
  buildExplorerAddressUrl(sourceConfig.value.chainKey, address);

const toggleBalanceMenu = (asset: string) => {
  openBalanceMenuKey.value = openBalanceMenuKey.value === asset ? null : asset;
};

const activityHashExplorerHref = (tx: ActivityEntry) =>
  tx.hashChainKey && isExplorerTxHash(tx.hash) ? buildExplorerTxUrl(tx.hashChainKey, tx.hash) : undefined;

const activitySourceTxExplorerHref = (interop: ActivityInteropEntry) =>
  buildExplorerTxUrl(interop.sourceChainKey, interop.sourceTxHash);

const interopStepsForFlow = (flow: InteropFlow, mode: InteropMode) => {
  if (flow === 'pay') {
    return mode === 'private' ? PRIVATE_PAY_INTEROP_STEPS : PUBLIC_PAY_INTEROP_STEPS;
  }

  return mode === 'private' ? PRIVATE_CREATE_INTEROP_STEPS : PUBLIC_CREATE_INTEROP_STEPS;
};

const interopSummaryForFlow = (flow: InteropFlow, mode: InteropMode) => {
  if (flow === 'pay') {
    if (mode === 'private') {
      return 'Payment can require up to 3 user-signed transactions: source approval, private funding bundle, and private settlement bundle. Destination execution happens later through the private executor on chain C.';
    }

    return 'Payment can require up to 3 user-signed transactions: source approval, funding bundle, and settlement bundle. Cross-chain creator payout is backend-driven and not tracked here.';
  }

  if (mode === 'private') {
    return 'Invoice creation uses 1 private interop bundle from chain A or B to chain C. The source transaction yields the bundle hash and the private executor later runs destination execution.';
  }

  return 'Invoice creation uses 1 interop bundle from chain A or B to chain C and does not move ERC20 tokens.';
};

const interopStatusBadgeLabel = (status: InteropStatus) => {
  if (status === 'idle') return 'Idle';
  if (status === 'failed') return 'Failed';
  if (status === 'success') return 'Success';
  return 'Running';
};

const interopStatusBadgeClass = (status: InteropStatus) => {
  if (status === 'failed') {
    return 'border-red-200 bg-red-50 text-red-700';
  }
  if (status === 'success') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  }
  if (status === 'idle') {
    return 'border-slate-200 bg-slate-50 text-slate-500';
  }
  return 'border-amber-200 bg-amber-50 text-amber-700';
};

const setInteropStepDetail = (stepId: InteropStepId, detail: string) => {
  interopStepDetails.value = {
    ...interopStepDetails.value,
    [stepId]: detail
  };
};

const syncTransactionInterop = (
  id: string,
  flow = interopFlow.value,
  mode = interopActivityMode.value
) => {
  if (!flow) return;

  const tx = transactions.value.find((entry) => entry.id === id);
  if (!tx) return;

  tx.interop = {
    mode,
    flow,
    sourceChainKey: interopSourceChainKey.value,
    status: interopStatus.value,
    currentStepId: interopCurrentStepId.value,
    stepDetails: { ...interopStepDetails.value },
    message: interopMessage.value,
    summary: interopSummaryForFlow(flow, mode),
    sourceTxHash: interopSourceTxHash.value,
    bundleHash: interopBundleHash.value,
    invoiceId: interopInvoiceId.value,
    error: interopError.value
  };
};

const setInteropProgress = (
  flow: InteropFlow,
  stepId: InteropStepId,
  message: string,
  detail?: string
) => {
  interopFlow.value = flow;
  interopStatus.value = 'running';
  interopCurrentStepId.value = stepId;
  interopMessage.value = message;
  if (detail) {
    setInteropStepDetail(stepId, detail);
  }
};

const completeInteropProgress = (
  flow: InteropFlow,
  finalStepId: InteropStepId,
  message: string,
  detail?: string
) => {
  interopFlow.value = flow;
  interopStatus.value = 'success';
  interopCurrentStepId.value = finalStepId;
  interopMessage.value = message;
  if (detail) {
    setInteropStepDetail(finalStepId, detail);
  }
};

const failInteropProgress = (message: string) => {
  interopStatus.value = 'failed';
  interopMessage.value = message;
};

const activityStepState = (interop: ActivityInteropEntry, key: InteropStepId): InteropStepState => {
  if (interop.status === 'idle') {
    return 'upcoming';
  }
  const steps = interopStepsForFlow(interop.flow, interop.mode);
  const currentIndex = steps.findIndex((step) => step.id === interop.currentStepId);
  const stepIndex = steps.findIndex((step) => step.id === key);

  if (stepIndex === -1) {
    return 'upcoming';
  }
  if (interop.status === 'failed') {
    if (currentIndex === -1) {
      return 'failed';
    }
    if (stepIndex < currentIndex) return 'complete';
    if (stepIndex === currentIndex) return 'failed';
    return 'upcoming';
  }

  if (currentIndex === -1) {
    return 'upcoming';
  }
  if (stepIndex < currentIndex) return 'complete';
  if (stepIndex === currentIndex) {
    return interop.status === 'success' ? 'complete' : 'current';
  }
  return 'upcoming';
};

const activityStepCardClass = (interop: ActivityInteropEntry, key: InteropStepId) => {
  const state = activityStepState(interop, key);
  if (state === 'complete') return 'border-emerald-100 bg-emerald-50/70';
  if (state === 'current') return 'border-amber-200 bg-amber-50/70';
  if (state === 'failed') return 'border-red-100 bg-red-50/70';
  return 'border-slate-100 bg-white';
};

const activityStepIconClass = (interop: ActivityInteropEntry, key: InteropStepId) => {
  const state = activityStepState(interop, key);
  if (state === 'complete') return 'border-emerald-200 bg-emerald-100 text-emerald-700';
  if (state === 'current') return 'border-amber-200 bg-amber-100 text-amber-700';
  if (state === 'failed') return 'border-red-200 bg-red-100 text-red-700';
  return 'border-slate-200 bg-slate-50 text-slate-400';
};

const openCreateInvoiceModal = () => {
  errorMessage.value = '';
  if (!isInvoiceProcessing.value) {
    createInvoiceBanner.value = '';
  }
  isCreateInvoiceModalOpen.value = true;
};

const resetPayInvoiceModalState = () => {
  payInvoiceOptions.value = [];
  payInvoiceOptionsLoading.value = false;
  payInvoiceOptionsError.value = '';
  payInvoiceQuoteType.value = 'exact';
  payInvoiceBillingTokenSymbol.value = '';
  payInvoiceBillingLiquidityAmount.value = '0';
  payInvoiceHasSufficientBillingLiquidity.value = true;
};

const handlePayInvoiceModalCancel = () => {
  if (processingInvoiceId.value) {
    return;
  }

  isPayInvoiceModalOpen.value = false;
  payInvoiceTarget.value = null;
  resetPayInvoiceModalState();
};

const closePayInvoiceModal = () => {
  isPayInvoiceModalOpen.value = false;
  payInvoiceTarget.value = null;
  resetPayInvoiceModalState();
};

const handleCreateInvoiceCancel = () => {
  if (!isInvoiceProcessing.value) {
    createInvoiceBanner.value = '';
  }
};

const refreshInvoiceTable = () => {
  void invoiceTableCardRef.value?.refreshInvoices();
};

const addTransaction = (
  func: string,
  status: ActivityStatus,
  hash: string,
  detail: string,
  hashChainKey: ExplorerChainKey = sourceConfig.value.chainKey
) => {
  const id = Date.now().toString();
  transactions.value.unshift({
    id,
    function: func,
    status,
    hash: hash || 'Processing...',
    hashChainKey,
    detail,
    timestamp: new Date().toLocaleTimeString()
  });
  return id;
};

const updateTransaction = (
  id: string,
  updates: Partial<Pick<ActivityEntry, 'status' | 'hash' | 'hashChainKey' | 'detail'>>
) => {
  const tx = transactions.value.find((entry) => entry.id === id);
  if (!tx) return;

  if (updates.status) tx.status = updates.status;
  if (updates.hash) tx.hash = updates.hash;
  if (updates.hashChainKey) tx.hashChainKey = updates.hashChainKey;
  if (updates.detail) tx.detail = updates.detail;
};

const fetchInvoicePaymentOptions = async (
  invoice: InvoiceRecord
): Promise<InvoicePaymentOptionsResponseObject> => {
  const response = await fetch(
    getBackendUrl(`/invoices/${encodeURIComponent(invoice.id)}/payment-options`),
    {
      headers: {
        Accept: 'application/json'
      }
    }
  );

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const serverMessage =
      isServiceResponse(payload) && isRecord(payload.responseObject)
        ? toStringValue(payload.responseObject.error) || payload.message
        : isServiceResponse(payload)
          ? payload.message
          : `Request failed with status ${response.status}`;
    throw new Error(serverMessage);
  }

  if (!isServiceResponse<InvoicePaymentOptionsResponseObject>(payload)) {
    throw new Error('Unexpected payment-options response format.');
  }
  if (!payload.success) {
    throw new Error(payload.message || 'Backend reported an error while loading payment options.');
  }
  if (!isInvoicePaymentOptionsResponseObject(payload.responseObject)) {
    throw new Error('Unexpected payment-options payload.');
  }

  return payload.responseObject;
};

const fetchInvoicesSnapshot = async (): Promise<InvoiceRecord[]> => {
  const response = await fetch(getBackendUrl('/invoices'), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(ssoAccount.value ? { accountAddress: ssoAccount.value } : {})
  });

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const serverMessage =
      isServiceResponse(payload) && typeof payload.message === 'string'
        ? payload.message
        : `Request failed with status ${response.status}`;
    throw new Error(serverMessage);
  }

  if (!isServiceResponse<InvoiceResponseObject>(payload)) {
    throw new Error('Unexpected invoices response format.');
  }

  if (!payload.success) {
    throw new Error(payload.message || 'Backend reported an error while loading invoices.');
  }

  if (!isInvoiceResponseObject(payload.responseObject)) {
    throw new Error('Unexpected invoice payload.');
  }

  return payload.responseObject.invoices.filter((invoice) => invoice.sourceTags.length > 0);
};

const matchesSubmittedInvoice = (
  invoice: InvoiceRecord,
  payload: CreateInvoiceSubmitPayload,
  destinationBillingToken: string
) => {
  return (
    invoice.recipient.toLowerCase() === payload.recipient.toLowerCase() &&
    invoice.billingToken.toLowerCase() === destinationBillingToken.toLowerCase() &&
    invoice.amount === payload.amount.toString() &&
    invoice.creatorChainId === payload.creatorChainId &&
    invoice.recipientChainId === payload.recipientChainId &&
    invoice.text === payload.text &&
    invoice.status.toLowerCase() === 'created'
  );
};

const waitForInvoiceAppearance = async (
  payload: CreateInvoiceSubmitPayload,
  destinationBillingToken: string,
  baselineIds: Set<string>
) => {
  const deadline = Date.now() + INVOICE_POLL_TIMEOUT_MS;
  let lastFetchError = '';

  while (Date.now() < deadline) {
    try {
      const invoices = await fetchInvoicesSnapshot();
      const match = invoices.find(
        (invoice) =>
          matchesSubmittedInvoice(invoice, payload, destinationBillingToken) &&
          (!baselineIds.size || !baselineIds.has(invoice.id))
      );

      if (match) {
        return match;
      }
    } catch (error) {
      lastFetchError = formatTransactionError(
        error,
        'Failed to read invoices while waiting for chain C.'
      );
    }

    await new Promise((resolve) => setTimeout(resolve, INVOICE_POLL_INTERVAL_MS));
  }

  if (lastFetchError) {
    throw new Error(lastFetchError);
  }

  throw new Error('Timed out waiting for the invoice to appear on chain C.');
};

const waitForInvoiceStatus = async (invoiceId: string, targetStatus: string) => {
  const deadline = Date.now() + INVOICE_POLL_TIMEOUT_MS;
  let lastFetchError = '';

  while (Date.now() < deadline) {
    try {
      const invoices = await fetchInvoicesSnapshot();
      const match = invoices.find((invoice) => invoice.id === invoiceId);

      if (match && match.status.trim().toLowerCase() === targetStatus.trim().toLowerCase()) {
        return match;
      }
    } catch (error) {
      lastFetchError = formatTransactionError(
        error,
        'Failed to read invoices while waiting for chain C.'
      );
    }

    await new Promise((resolve) => setTimeout(resolve, INVOICE_POLL_INTERVAL_MS));
  }

  if (lastFetchError) {
    throw new Error(lastFetchError);
  }

  throw new Error(`Timed out waiting for invoice ${invoiceId} to reach ${targetStatus}.`);
};

const waitForShadowAccountBalance = async (
  token: `0x${string}`,
  shadowAccount: `0x${string}`,
  targetBalance: bigint,
  mode: InteropMode
) => {
  const deadline = Date.now() + SHADOW_ACCOUNT_POLL_TIMEOUT_MS;
  let lastReadError = '';

  while (Date.now() < deadline) {
    try {
      const balance = await readDestinationTokenBalance({
        token,
        account: shadowAccount
      }, mode);

      if (balance >= targetBalance) {
        return balance;
      }
    } catch (error) {
      lastReadError = formatTransactionError(
        error,
        'Failed to read chain C shadow-account balance.'
      );
    }

    await new Promise((resolve) => setTimeout(resolve, SHADOW_ACCOUNT_POLL_INTERVAL_MS));
  }

  if (lastReadError) {
    throw new Error(lastReadError);
  }

  throw new Error(
    `Timed out waiting for shadow account ${shadowAccount} to receive funds on chain C.`
  );
};

const handleCreateInvoiceSubmit = async (payload: CreateInvoiceSubmitPayload) => {
  const transactionMode = interopMode.value;
  errorMessage.value = '';
  interopError.value = '';
  processingInvoiceId.value = '';
  createInvoiceBannerTone.value = 'info';
  createInvoiceBanner.value = 'Validating payment request before cross-border submission.';
  interopFlow.value = 'create';
  interopSourceChainKey.value = sourceConfig.value.chainKey;
  interopActivityMode.value = transactionMode;
  interopStepDetails.value = {};
  setInteropProgress(
    'create',
    'create-validate',
    'Validating payment-request payload and loading a baseline snapshot.',
    'Checking payment details, wallet context, and the configured chain C billing token before sending a single createInvoice bundle.'
  );
  interopSourceTxHash.value = '';
  interopBundleHash.value = '';
  interopInvoiceId.value = '';

  lastInvoiceDraft.value = {
    creator: payload.creator,
    recipient: payload.recipient,
    creatorChainId: payload.creatorChainId,
    recipientChainId: payload.recipientChainId,
    billingTokenSymbol: payload.billingTokenSymbol,
    amount: payload.amountInput,
    text: payload.text
  };

  const txId = addTransaction(
    'createInvoice()',
    'pending',
    'Preparing bundle...',
    `Validating ${payload.billingTokenSymbol} payment request for chain C.`
  );
  syncTransactionInterop(txId, 'create', transactionMode);

  let baselineIds = new Set<string>();

  try {
    try {
      const baselineInvoices = await fetchInvoicesSnapshot();
      baselineIds = new Set(baselineInvoices.map((invoice) => invoice.id));
    } catch (baselineError) {
      console.warn('Unable to load baseline invoice snapshot before submission:', baselineError);
    }

    setInteropProgress(
      'create',
      'create-submit',
      'Signing and submitting the source bundle that targets createInvoice on chain C.',
      `Using your passkey to make the ${sourceChainLabel.value} smart account call InteropCenter.sendBundle(...).`
    );
    createInvoiceBanner.value = `Authorizing ${sourceChainLabel.value} wallet access for the interop transaction.`;
    updateTransaction(txId, {
      hash: 'Authorizing passkey...',
      detail: `Authorizing ${sourceChainLabel.value} wallet session.`
    });
    syncTransactionInterop(txId, 'create', transactionMode);

    const result = await sendCreateInvoiceBundle(payload, transactionMode);

    interopSourceTxHash.value = result.transactionHash;
    interopBundleHash.value = result.bundleHash ?? '';
    createInvoiceBanner.value =
      transactionMode === 'private'
        ? 'Source transaction confirmed. Waiting for private execution on chain C.'
        : 'Source transaction confirmed. Waiting for the payment request to appear on chain C.';
    setInteropStepDetail(
      'create-submit',
      result.bundleHash
        ? `Bundle ${truncateHash(result.bundleHash)} left ${sourceChainLabel.value} in source tx ${truncateHash(result.transactionHash)}.`
        : `Source transaction ${truncateHash(result.transactionHash)} confirmed.`
    );
    setInteropProgress(
      'create',
      'create-relay',
      transactionMode === 'private'
        ? 'Source transaction confirmed. Waiting for the private executor to execute the bundle on chain C.'
        : 'Source transaction confirmed. Waiting for L1 finalization and relay execution on chain C.',
      transactionMode === 'private'
        ? result.bundleHash
          ? `Bundle ${truncateHash(result.bundleHash)} was submitted. Waiting for the private executor to execute it on chain C before checking for the invoice.`
          : 'Waiting for the private executor to execute the destination bundle on chain C.'
        : result.bundleHash
          ? `Bundle ${truncateHash(result.bundleHash)} was submitted. The backend relayer still needs to finalize the message and the interop relay still needs to execute it on chain C.`
          : 'Waiting for relayer finalization and chain C execution.'
    );
    syncTransactionInterop(txId, 'create', transactionMode);

    lastInvoiceDraft.value = {
      ...(lastInvoiceDraft.value ?? {
        creator: payload.creator,
        recipient: payload.recipient,
        creatorChainId: payload.creatorChainId,
        recipientChainId: payload.recipientChainId,
        billingTokenSymbol: payload.billingTokenSymbol,
        amount: payload.amountInput,
        text: payload.text
      }),
      sourceTxHash: result.transactionHash
    };

    updateTransaction(txId, {
      hash: result.transactionHash,
      detail:
        transactionMode === 'private'
          ? result.bundleHash
            ? `Private bundle ${truncateHash(result.bundleHash)} submitted. Waiting for destination execution on chain C.`
            : 'Source transaction confirmed. Waiting for private destination execution on chain C.'
          : result.bundleHash
            ? `Bundle ${truncateHash(result.bundleHash)} submitted. Waiting for chain C execution.`
            : 'Source transaction confirmed. Waiting for chain C execution.'
    });

    if (transactionMode === 'private') {
      await waitForBundleExecution(result.bundleHash, transactionMode);
      setInteropStepDetail(
        'create-relay',
        result.bundleHash
          ? `Private bundle ${truncateHash(result.bundleHash)} finished destination execution on chain C. Waiting for the payment request to appear.`
          : 'Private destination execution completed on chain C. Waiting for the payment request to appear.'
      );
      createInvoiceBanner.value =
        'Private destination execution completed. Waiting for the payment request to appear on chain C.';
      syncTransactionInterop(txId, 'create', transactionMode);
    }

    const createdInvoice = await waitForInvoiceAppearance(
      payload,
      result.destinationBillingToken,
      baselineIds
    );

    interopInvoiceId.value = createdInvoice.id;
    createInvoiceBannerTone.value = 'success';
    createInvoiceBanner.value = `Payment request ${createdInvoice.id} created on chain C. Source tx ${truncateHash(result.transactionHash)}.`;
    completeInteropProgress(
      'create',
      'create-confirm',
      `Payment request ${createdInvoice.id} was created on chain C.`,
      `Payment request ${createdInvoice.id} is now visible on chain C. No ERC20 transfer was needed for this flow.`
    );
    syncTransactionInterop(txId, 'create', transactionMode);

    lastInvoiceDraft.value = {
      ...(lastInvoiceDraft.value ?? {
        creator: payload.creator,
        recipient: payload.recipient,
        creatorChainId: payload.creatorChainId,
        recipientChainId: payload.recipientChainId,
        billingTokenSymbol: payload.billingTokenSymbol,
        amount: payload.amountInput,
        text: payload.text,
        sourceTxHash: result.transactionHash
      }),
      invoiceId: createdInvoice.id
    };

    updateTransaction(txId, {
      status: 'success',
      hash: result.transactionHash,
      detail: `Payment request ${createdInvoice.id} confirmed on chain C.`
    });
    void refreshBalances();
    refreshInvoiceTable();
  } catch (error) {
    interopError.value = formatTransactionError(error, 'Failed to create payment request on chain C.');
    errorMessage.value = interopError.value;
    createInvoiceBannerTone.value = 'error';
    createInvoiceBanner.value = interopError.value;
    failInteropProgress(interopError.value);
    syncTransactionInterop(txId, 'create', transactionMode);

    updateTransaction(txId, {
      status: 'failed',
      hash: interopSourceTxHash.value || 'Submission failed',
      detail: interopError.value
    });
  }
};

const handlePayInvoice = async (invoice: InvoiceRecord) => {
  errorMessage.value = '';
  payInvoiceTarget.value = invoice;
  payInvoiceMode.value = interopMode.value;
  resetPayInvoiceModalState();
  isPayInvoiceModalOpen.value = true;
  payInvoiceOptionsLoading.value = true;

  try {
    const responseObject = await fetchInvoicePaymentOptions(invoice);
    const filteredOptions = filterPaymentOptions(responseObject.options, payInvoiceMode.value);

    payInvoiceOptions.value = filteredOptions;
    payInvoiceQuoteType.value = responseObject.quoteType;
    payInvoiceBillingTokenSymbol.value = responseObject.billingTokenSymbol;
    payInvoiceBillingLiquidityAmount.value = responseObject.invoicePaymentBillingTokenBalance;
    payInvoiceHasSufficientBillingLiquidity.value = responseObject.hasSufficientBillingLiquidity;

    if (filteredOptions.length === 0) {
      payInvoiceOptionsError.value =
        payInvoiceMode.value === 'private'
          ? `No private payment tokens are configured on ${sourceChainLabel.value} for payment request ${invoice.id}.`
          : `No quoteable payment tokens are configured on ${sourceChainLabel.value} for payment request ${invoice.id}.`;
    }
  } catch (error) {
    payInvoiceOptionsError.value = formatTransactionError(
      error,
      `Failed to load payment options for payment request ${invoice.id}.`
    );
  } finally {
    payInvoiceOptionsLoading.value = false;
  }
};

const handlePayInvoiceConfirm = async (selectedOption: InvoicePaymentOption) => {
  const invoice = payInvoiceTarget.value;
  if (!invoice) {
    return;
  }
  const transactionMode = payInvoiceMode.value;

  errorMessage.value = '';
  interopError.value = '';
  processingInvoiceId.value = invoice.id;
  interopFlow.value = 'pay';
  interopSourceChainKey.value = sourceConfig.value.chainKey;
  interopActivityMode.value = transactionMode;
  interopStepDetails.value = {};
  setInteropProgress(
    'pay',
    'pay-validate',
    'Validating payment settlement, source-chain funding path, and chain C readiness.',
    `Checking payment-request state, selected ${selectedOption.symbol} quote, payer wallet ownership, and whether chain C can settle the request before any funds move.`
  );
  interopSourceTxHash.value = '';
  interopBundleHash.value = '';
  interopInvoiceId.value = invoice.id;

  const txId = addTransaction(
    `payInvoice(${invoice.id})`,
    'pending',
    'Preparing bundle...',
    `Validating payment settlement for chain C using ${selectedOption.symbol}.`
  );
  syncTransactionInterop(txId, 'pay', transactionMode);

  try {
    if (invoice.status.trim().toLowerCase() !== 'created') {
      throw new Error(`Payment request ${invoice.id} is ${invoice.status} and cannot be paid.`);
    }
    if (activeChainId.value !== invoice.recipientChainId) {
      throw new Error(
        `Payment request ${invoice.id} can only be paid from chain ${invoice.recipientChainId}. Switch to the recipient chain and retry.`
      );
    }
    if (!invoice.sourceTags.includes('pending')) {
      throw new Error(
        `Payment request ${invoice.id} is not assigned to the connected wallet. Re-fetch payment requests with the intended recipient account and retry.`
      );
    }
    if (!ssoAccount.value) {
      throw new Error(
        'No SSO account is selected. Re-login and re-select the intended recipient account.'
      );
    }
    if (ssoAccount.value.toLowerCase() !== invoice.recipientRefundAddress.toLowerCase()) {
      throw new Error(
        `Active account ${ssoAccount.value} does not match payment recipient ${invoice.recipientRefundAddress}. Re-select the matching passkey account and retry.`
      );
    }
    if (payInvoiceDisableReason.value) {
      throw new Error(payInvoiceDisableReason.value);
    }

    const paymentPreflight = await readPayInvoicePreflight(
      {
        creatorChainId: invoice.creatorChainId
      },
      transactionMode
    );
    if (
      paymentPreflight.requiresCrossChainPayout &&
      !paymentPreflight.hasSufficientInvoicePaymentBalance
    ) {
      throw new Error(
        `InvoicePayment on chain C has ${formatEthAmount(paymentPreflight.invoicePaymentBalance)} ETH but needs at least ${formatEthAmount(paymentPreflight.crossChainFee)} ETH to forward billed funds to chain ${invoice.creatorChainId}. Top up the chain C settlement contract and retry.`
      );
    }

    closePayInvoiceModal();

    setInteropProgress(
      'pay',
      'pay-prepare',
      'Preparing the source-side funding leg for the chain C payer shadow account.',
      `Checking source-token allowance and signing an approval transaction only if the native token vault needs it for ${selectedOption.symbol}.`
    );
    updateTransaction(txId, {
      hash: 'Authorizing passkey...',
      detail: `Authorizing ${sourceChainLabel.value} wallet session to fund the chain C shadow account for payment request ${invoice.id} with ${selectedOption.symbol}.`
    });
    syncTransactionInterop(txId, 'pay', transactionMode);

    const fundingResult = await sendFundPayInvoiceBundle(
      {
        invoiceId: invoice.id,
        paymentAmount: selectedOption.paymentAmount,
        paymentToken: selectedOption.token as `0x${string}`,
        payerRefundAddress: invoice.recipientRefundAddress as `0x${string}`
      },
      transactionMode
    );

    interopSourceTxHash.value = fundingResult.transactionHash ?? '';
    interopBundleHash.value = fundingResult.bundleHash ?? '';
    setInteropStepDetail(
      'pay-prepare',
      fundingResult.approvalTransactionHash
        ? `Allowance tx ${truncateHash(fundingResult.approvalTransactionHash)} confirmed on ${sourceChainLabel.value}.`
        : 'Existing allowance was sufficient, so no source-token approval transaction was needed.'
    );
    syncTransactionInterop(txId, 'pay', transactionMode);

    if (fundingResult.requiredFundingAmount > 0n) {
      setInteropProgress(
        'pay',
        'pay-fund',
        transactionMode === 'private'
          ? `Funding bundle confirmed on ${sourceChainLabel.value}. Waiting for private execution before ${fundingResult.paymentTokenSymbol} reaches payer shadow account ${truncateHash(fundingResult.shadowAccount)} on chain C.`
          : `Funding bundle confirmed on ${sourceChainLabel.value}. Waiting for ${fundingResult.paymentTokenSymbol} to appear on payer shadow account ${truncateHash(fundingResult.shadowAccount)} on chain C.`,
        transactionMode === 'private'
          ? fundingResult.bundleHash
            ? `Funding bundle ${truncateHash(fundingResult.bundleHash)} submitted for ${formatTokenAmount(fundingResult.requiredFundingAmount)} ${fundingResult.paymentTokenSymbol}. Waiting for the private executor to execute it and for payer shadow account ${truncateHash(fundingResult.shadowAccount)} to receive funds on chain C.`
            : `Waiting for private execution and for payer shadow account ${truncateHash(fundingResult.shadowAccount)} to receive ${fundingResult.paymentTokenSymbol} on chain C.`
          : fundingResult.bundleHash
            ? `Funding bundle ${truncateHash(fundingResult.bundleHash)} submitted for ${formatTokenAmount(fundingResult.requiredFundingAmount)} ${fundingResult.paymentTokenSymbol}. Waiting for relayer finalization and for the payer shadow account ${truncateHash(fundingResult.shadowAccount)} to receive funds on chain C.`
            : `Waiting for the payer shadow account ${truncateHash(fundingResult.shadowAccount)} to receive ${fundingResult.paymentTokenSymbol} on chain C.`
      );
      updateTransaction(txId, {
        hash: fundingResult.transactionHash || 'Funding submitted',
        detail:
          transactionMode === 'private'
            ? fundingResult.bundleHash
              ? `${fundingResult.approvalTransactionHash ? `Allowance tx ${truncateHash(fundingResult.approvalTransactionHash)} confirmed. ` : ''}Private funding bundle ${truncateHash(fundingResult.bundleHash)} submitted for ${formatTokenAmount(fundingResult.requiredFundingAmount)} ${fundingResult.paymentTokenSymbol}. Waiting for private execution and shadow-account balance confirmation.`
              : `${fundingResult.approvalTransactionHash ? `Allowance tx ${truncateHash(fundingResult.approvalTransactionHash)} confirmed. ` : ''}Waiting for private execution and chain C shadow-account balance to increase.`
            : fundingResult.bundleHash
              ? `${fundingResult.approvalTransactionHash ? `Allowance tx ${truncateHash(fundingResult.approvalTransactionHash)} confirmed. ` : ''}Funding bundle ${truncateHash(fundingResult.bundleHash)} submitted for ${formatTokenAmount(fundingResult.requiredFundingAmount)} ${fundingResult.paymentTokenSymbol}. Waiting for chain C shadow-account balance to increase.`
              : `${fundingResult.approvalTransactionHash ? `Allowance tx ${truncateHash(fundingResult.approvalTransactionHash)} confirmed. ` : ''}Waiting for chain C shadow-account balance to increase.`
      });
      syncTransactionInterop(txId, 'pay', transactionMode);

      if (transactionMode === 'private') {
        await waitForBundleExecution(fundingResult.bundleHash, transactionMode);
        setInteropStepDetail(
          'pay-fund',
          fundingResult.bundleHash
            ? `Private funding bundle ${truncateHash(fundingResult.bundleHash)} finished destination execution on chain C. Waiting for payer shadow account ${truncateHash(fundingResult.shadowAccount)} to reflect the bridged balance.`
            : `Private destination execution completed. Waiting for payer shadow account ${truncateHash(fundingResult.shadowAccount)} to reflect the bridged balance.`
        );
        syncTransactionInterop(txId, 'pay', transactionMode);
      }

      await waitForShadowAccountBalance(
        fundingResult.paymentToken,
        fundingResult.shadowAccount,
        fundingResult.destinationBalanceBeforeFunding + fundingResult.requiredFundingAmount,
        transactionMode
      );
      setInteropStepDetail(
        'pay-fund',
        `Shadow account ${truncateHash(fundingResult.shadowAccount)} now holds the required ${fundingResult.paymentTokenSymbol} on chain C.`
      );
      syncTransactionInterop(txId, 'pay', transactionMode);
    } else {
      setInteropProgress(
        'pay',
        'pay-fund',
        `Payer shadow account ${truncateHash(fundingResult.shadowAccount)} already has enough ${fundingResult.paymentTokenSymbol} on chain C. Skipping the funding bundle.`,
        `The payer shadow account already holds ${formatTokenAmount(fundingResult.destinationBalanceBeforeFunding)} ${fundingResult.paymentTokenSymbol} on chain C, so the funding leg was skipped.`
      );
      updateTransaction(txId, {
        hash: fundingResult.approvalTransactionHash || 'Funding skipped',
        detail: `Shadow account already holds ${formatTokenAmount(fundingResult.destinationBalanceBeforeFunding)} ${fundingResult.paymentTokenSymbol} on chain C, so no funding bridge was sent. Proceeding to settlement.`
      });
      syncTransactionInterop(txId, 'pay', transactionMode);
    }

    setInteropProgress(
      'pay',
      'pay-settle',
      'Authorizing the settlement bundle that approves the destination token and calls payInvoice on chain C.',
      `Signing the second interop stage so the payer shadow account can approve InvoicePayment and settle the payment request on chain C in ${selectedOption.symbol}.`
    );
    interopSourceTxHash.value = '';
    interopBundleHash.value = '';
    updateTransaction(txId, {
      hash: 'Authorizing settlement...',
      detail: `Authorizing ${sourceChainLabel.value} wallet session to approve ${selectedOption.symbol} on chain C and settle payment request ${invoice.id}.`
    });
    syncTransactionInterop(txId, 'pay', transactionMode);

    const settlementResult = await sendSettlePayInvoiceBundle(
      {
        invoiceId: invoice.id,
        paymentAmount: selectedOption.paymentAmount,
        paymentToken: selectedOption.token as `0x${string}`,
        payerRefundAddress: invoice.recipientRefundAddress as `0x${string}`
      },
      transactionMode
    );

    interopSourceTxHash.value = settlementResult.transactionHash;
    interopBundleHash.value = settlementResult.bundleHash ?? '';
    setInteropStepDetail(
      'pay-settle',
      settlementResult.bundleHash
        ? `Settlement bundle ${truncateHash(settlementResult.bundleHash)} left ${sourceChainLabel.value} in source tx ${truncateHash(settlementResult.transactionHash)}.`
        : `Settlement transaction ${truncateHash(settlementResult.transactionHash)} confirmed.`
    );
    setInteropProgress(
      'pay',
      'pay-confirm',
      transactionMode === 'private'
        ? 'Settlement bundle confirmed. Waiting for the private executor to execute the settlement bundle on chain C.'
        : 'Settlement bundle confirmed. Waiting for payment status to change to paid on chain C.',
      transactionMode === 'private'
        ? `Waiting for private execution of settlement bundle ${settlementResult.bundleHash ? truncateHash(settlementResult.bundleHash) : ''} before polling payment request ${invoice.id} on chain C.`
        : `Waiting for payment request ${invoice.id} to be marked paid on chain C. If the creator lives on another chain, the later payout bridge is handled by the backend worker.`
    );
    syncTransactionInterop(txId, 'pay', transactionMode);

    updateTransaction(txId, {
      hash: settlementResult.transactionHash,
      detail:
        transactionMode === 'private'
          ? settlementResult.bundleHash
            ? `Private settlement bundle ${truncateHash(settlementResult.bundleHash)} submitted after chain C shadow-account funding. Waiting for private execution before checking paid status.`
            : `Settlement transaction confirmed. Waiting for private destination execution before checking paid status.`
          : settlementResult.bundleHash
            ? `Settlement bundle ${truncateHash(settlementResult.bundleHash)} submitted after chain C shadow-account funding. Waiting for payment request ${invoice.id} to be marked paid.`
            : `Settlement transaction confirmed. Waiting for payment request ${invoice.id} to be marked paid.`
    });

    if (transactionMode === 'private') {
      await waitForBundleExecution(settlementResult.bundleHash, transactionMode);
      setInteropStepDetail(
        'pay-confirm',
        settlementResult.bundleHash
          ? `Private settlement bundle ${truncateHash(settlementResult.bundleHash)} finished destination execution on chain C. Waiting for payment request ${invoice.id} to be marked paid.`
          : `Private destination execution completed. Waiting for payment request ${invoice.id} to be marked paid.`
      );
      syncTransactionInterop(txId, 'pay', transactionMode);
    }

    const paidInvoice = await waitForInvoiceStatus(invoice.id, 'paid');

    interopInvoiceId.value = paidInvoice.id;
    completeInteropProgress(
      'pay',
      'pay-confirm',
      `Payment request ${paidInvoice.id} was paid on chain C.`,
      `Payment request ${paidInvoice.id} is now marked paid on chain C. Any creator payout to another chain will happen in the backend payout stage.`
    );
    syncTransactionInterop(txId, 'pay', transactionMode);

    updateTransaction(txId, {
      status: 'success',
      hash: settlementResult.transactionHash,
      detail: `Payment request ${paidInvoice.id} marked paid on chain C.`
    });

    void refreshBalances();
    refreshInvoiceTable();
  } catch (error) {
    interopError.value = formatTransactionError(
      error,
      `Failed to settle payment request ${invoice.id} on chain C.`
    );
    errorMessage.value = interopError.value;
    failInteropProgress(interopError.value);
    syncTransactionInterop(txId, 'pay', transactionMode);

    updateTransaction(txId, {
      status: 'failed',
      hash: interopSourceTxHash.value || 'Submission failed',
      detail: interopError.value
    });
  } finally {
    processingInvoiceId.value = '';
  }
};

const handleBalanceRefreshRequest = () => {
  void refreshBalances();
};

const handleInvoicesRefreshRequest = () => {
  refreshInvoiceTable();
};

const closeBalanceMenu = (event: MouseEvent) => {
  const target = event.target;
  if (!(target instanceof Element) || !target.closest('[data-balance-menu]')) {
    openBalanceMenuKey.value = null;
  }
};

onMounted(() => {
  window.addEventListener('click', closeBalanceMenu);
  window.addEventListener(ACTIVE_CHAIN_BALANCES_REFRESH_EVENT, handleBalanceRefreshRequest);
  window.addEventListener(INVOICES_REFRESH_EVENT, handleInvoicesRefreshRequest);

  if (!isAuthenticated.value) {
    void router.push('/login');
    return;
  }

  if (!currentInteropCenterAddress.value || !destinationInvoicePaymentAddress.value) {
    errorMessage.value = 'Missing interop contract configuration for the active payment route.';
  }
});

onUnmounted(() => {
  window.removeEventListener('click', closeBalanceMenu);
  window.removeEventListener(ACTIVE_CHAIN_BALANCES_REFRESH_EVENT, handleBalanceRefreshRequest);
  window.removeEventListener(INVOICES_REFRESH_EVENT, handleInvoicesRefreshRequest);
});
</script>
