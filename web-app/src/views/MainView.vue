<template>
  <div class="max-w-6xl mx-auto space-y-10 animate-in fade-in slide-in-from-bottom-4 duration-700 pt-8">
    <div class="flex flex-col items-center justify-center text-center py-10 space-y-6">
      <div class="space-y-4 max-w-3xl">
        <p class="text-[11px] font-black uppercase tracking-[0.28em] text-slate-400">
          Cross-Chain Invoice Desk
        </p>
        <h2 class="text-4xl font-bold text-slate-900 tracking-tight text-balance">
          Cross-chain invoicing and settlement
        </h2>
        <p class="text-base leading-relaxed text-slate-500">
          Invoice creation now submits a real interop bundle from the active source chain to the
          chain C <span class="font-semibold text-slate-700">InvoicePayment</span> contract.
        </p>
      </div>

      <div class="enterprise-card w-full max-w-4xl overflow-hidden p-0 text-left">
        <div class="flex flex-col gap-4 border-b border-slate-100 px-6 py-5 md:flex-row md:items-center md:justify-between">
          <div class="space-y-1">
            <p class="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Wallet Balances</p>
            <h3 class="text-lg font-bold text-slate-900">{{ sourceChainLabel }} Assets</h3>
            <p class="text-sm text-slate-500">
              Native {{ balanceRows[0]?.asset || 'ETH' }} and configured invoice tokens for the active source chain.
            </p>
          </div>

          <div class="flex flex-col items-start gap-3 md:items-end">
            <span class="text-xs text-slate-500">
              {{ ssoAccount ? truncateHash(ssoAccount, 8, 6) : 'Link a wallet to view balances.' }}
            </span>
            <div class="flex flex-wrap gap-2">
              <button
                class="enterprise-button-secondary h-11 px-4 py-0 text-sm"
                :disabled="isBalancesLoading || !ssoAccount || isTokenFunding"
                @click="refreshBalances"
              >
                <BaseIcon
                  name="ArrowPathIcon"
                  class="h-4 w-4"
                  :class="isBalancesLoading ? 'animate-spin' : ''"
                />
                {{ isBalancesLoading ? 'Refreshing' : 'Refresh balances' }}
              </button>
              <button
                class="enterprise-button-primary h-11 px-4 py-0 text-sm"
                :disabled="!ssoAccount || isTokenFunding"
                @click="fundTestTokens"
              >
                <BaseIcon
                  name="CurrencyDollarIcon"
                  class="h-4 w-4"
                  :class="isTokenFunding ? 'animate-pulse' : ''"
                />
                {{ isTokenFunding ? 'Funding tokens...' : 'Get test tokens' }}
              </button>
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
            v-if="balancesError"
            class="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-800"
          >
            {{ balancesError }}
          </div>

          <div
            v-else-if="!ssoAccount"
            class="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500"
          >
            Current wallet not linked.
          </div>

          <div
            v-else-if="isBalancesLoading"
            class="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500"
          >
            Loading balances for {{ sourceChainLabel }}.
          </div>

          <div v-else class="overflow-x-auto">
            <table class="min-w-full divide-y divide-slate-100">
              <thead>
                <tr class="text-left text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">
                  <th class="pb-3 pr-4">Asset</th>
                  <th class="pb-3 pr-4">Type</th>
                  <th class="pb-3 pr-4">Balance</th>
                  <th class="pb-3">Contract</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-100">
                <tr v-for="row in balanceRows" :key="row.asset">
                  <td class="py-3 pr-4 text-sm font-bold text-slate-900">{{ row.asset }}</td>
                  <td class="py-3 pr-4 text-sm text-slate-500">
                    {{ row.type === 'native' ? 'Native' : 'ERC-20' }}
                  </td>
                  <td class="py-3 pr-4 text-sm font-semibold text-slate-700">{{ row.balance }}</td>
                  <td class="py-3 text-xs font-mono text-slate-500">
                    {{ row.address ? truncateHash(row.address, 10, 8) : 'Native asset' }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div
        class="flex items-center gap-2 justify-center bg-white px-4 py-2 rounded-full border border-slate-100 shadow-sm group cursor-pointer hover:border-accent/30 transition-all"
        @click="copyContractAddress"
      >
        <span class="text-[10px] font-black uppercase tracking-widest text-slate-400 mr-2">
          Chain C InvoicePayment
        </span>
        <span class="text-xs font-mono text-slate-500">
          {{ destinationInvoicePaymentAddress?.slice(0, 10) }}...{{ destinationInvoicePaymentAddress?.slice(-8) }}
        </span>
        <BaseIcon
          :name="copied ? 'CheckIcon' : 'DocumentDuplicateIcon'"
          :class="copied ? 'text-green-500' : 'text-slate-300 group-hover:text-accent'"
          class="w-3.5 h-3.5 transition-colors"
        />
      </div>

      <div class="flex flex-wrap items-center justify-center gap-4 pt-2">
        <button
          class="enterprise-button-primary min-w-[200px] h-14 text-base font-semibold"
          :disabled="isInvoiceProcessing || !canOpenInvoiceModal"
          @click="openCreateInvoiceModal"
        >
          <BaseIcon name="PlusCircleIcon" class="w-5 h-5" />
          {{ isInvoiceProcessing ? 'Interop in Progress' : 'New Invoice' }}
        </button>
        <button
          class="enterprise-button-secondary min-w-[200px] h-14 text-base font-semibold"
          :disabled="isInvoiceProcessing"
          @click="refreshInvoiceTable"
        >
          <BaseIcon name="ArrowPathIcon" class="w-5 h-5" />
          Refresh invoices
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

    <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
      <div class="enterprise-card p-8 space-y-6">
        <div class="flex items-center justify-between gap-4">
          <div>
            <p class="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Interop Progress</p>
            <h3 class="text-lg font-bold text-slate-900">Invoice Execution</h3>
          </div>
          <span
            class="rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em]"
            :class="interopStatusClass"
          >
            {{ interopStatusLabel }}
          </span>
        </div>

        <p class="text-sm text-slate-500">
          {{ interopMessage || 'Submit an invoice to start the cross-chain workflow.' }}
        </p>

        <div class="space-y-3">
          <div
            v-for="step in interopSteps"
            :key="step.key"
            class="flex items-start gap-4 rounded-2xl border px-4 py-4 transition-colors"
            :class="stepCardClass(step.key)"
          >
            <div
              class="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-xs font-black"
              :class="stepIconClass(step.key)"
            >
              <BaseIcon
                v-if="stepState(step.key) === 'complete'"
                name="CheckIcon"
                class="w-4 h-4"
              />
              <BaseIcon
                v-else-if="stepState(step.key) === 'current'"
                name="ArrowPathIcon"
                class="w-4 h-4 animate-spin"
              />
              <BaseIcon
                v-else-if="stepState(step.key) === 'failed'"
                name="XMarkIcon"
                class="w-4 h-4"
              />
              <span v-else>{{ step.order }}</span>
            </div>
            <div class="min-w-0 flex-1">
              <p class="text-sm font-bold text-slate-900">{{ step.label }}</p>
              <p class="mt-1 text-sm text-slate-500">{{ step.description }}</p>
            </div>
          </div>
        </div>

        <div
          v-if="interopSourceTxHash || interopBundleHash || interopInvoiceId"
          class="space-y-3 rounded-3xl border border-slate-100 bg-slate-50 px-5 py-5"
        >
          <div v-if="interopSourceTxHash" class="flex items-center justify-between gap-4 text-xs">
            <span class="font-black uppercase tracking-[0.18em] text-slate-400">Source tx</span>
            <span class="font-mono text-slate-600">{{ truncateHash(interopSourceTxHash) }}</span>
          </div>
          <div v-if="interopBundleHash" class="flex items-center justify-between gap-4 text-xs">
            <span class="font-black uppercase tracking-[0.18em] text-slate-400">Bundle</span>
            <span class="font-mono text-slate-600">{{ truncateHash(interopBundleHash) }}</span>
          </div>
          <div v-if="interopInvoiceId" class="flex items-center justify-between gap-4 text-xs">
            <span class="font-black uppercase tracking-[0.18em] text-slate-400">Invoice ID</span>
            <span class="font-mono text-slate-600">{{ interopInvoiceId }}</span>
          </div>
        </div>

        <div
          v-if="interopError"
          class="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          {{ interopError }}
        </div>
      </div>

      <div class="enterprise-card p-8 space-y-6">
        <div class="flex items-center justify-between">
          <h3 class="text-lg font-bold text-slate-900">System Status</h3>
          <div class="w-10 h-10 rounded-full bg-slate-50 flex items-center justify-center border border-slate-100">
            <BaseIcon name="ShieldCheckIcon" class="w-5 h-5 text-slate-400" />
          </div>
        </div>

        <div class="space-y-4">
          <div class="flex items-center justify-between p-3 bg-slate-50 rounded-2xl border border-slate-100">
            <span class="text-sm font-medium text-slate-600">Interop route</span>
            <div class="flex items-center gap-2">
              <span class="text-sm font-bold" :class="isConfigured ? 'text-green-600' : 'text-red-500'">
                {{ isConfigured ? `${sourceChainLabel} -> Chain C` : 'Config missing' }}
              </span>
              <div
                class="w-2 h-2 rounded-full"
                :class="isConfigured ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]' : 'bg-red-500'"
              ></div>
            </div>
          </div>

          <div class="flex items-center justify-between p-3 bg-slate-50 rounded-2xl border border-slate-100">
            <span class="text-sm font-medium text-slate-600">Source InteropCenter</span>
            <span class="text-xs font-mono text-slate-500">
              {{ currentInteropCenterAddress ? truncateHash(currentInteropCenterAddress, 8, 6) : 'Unavailable' }}
            </span>
          </div>

          <div class="flex items-center justify-between p-3 bg-slate-50 rounded-2xl border border-slate-100">
            <span class="text-sm font-medium text-slate-600">Wallet Link</span>
            <span class="text-xs font-mono text-slate-500" v-if="ssoAccount">0x...{{ ssoAccount.slice(-4) }}</span>
            <span class="text-xs font-bold text-slate-400" v-else>Not linked</span>
          </div>
        </div>
      </div>
    </div>

    <div class="enterprise-card p-8 space-y-5">
      <div class="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div class="space-y-1">
          <p class="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Invoicing</p>
          <h3 class="text-lg font-bold text-slate-900">Create Invoice</h3>
          <p class="text-sm text-slate-500">
            Submit a passkey-authenticated interop bundle from the active source chain to chain C.
          </p>
        </div>
        <button
          class="enterprise-button-primary w-full md:w-auto"
          :disabled="isInvoiceProcessing || !canOpenInvoiceModal"
          @click="openCreateInvoiceModal"
        >
          <BaseIcon name="PlusCircleIcon" class="w-5 h-5" />
          New Invoice
        </button>
      </div>

      <div
        v-if="createInvoiceBanner"
        class="rounded-2xl border px-4 py-3 text-sm"
        :class="createInvoiceBannerClass"
      >
        {{ createInvoiceBanner }}
      </div>

      <div
        v-if="lastInvoiceDraft"
        class="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-xs text-slate-600 space-y-2"
      >
        <p>
          Last request:
          <span class="font-semibold text-slate-800">{{ lastInvoiceDraft.billingTokenSymbol }}</span>
          for
          <span class="font-semibold text-slate-800">{{ lastInvoiceDraft.amount }}</span>
          from chain
          <span class="font-semibold text-slate-800">{{ lastInvoiceDraft.creatorChainId }}</span>
          to recipient chain
          <span class="font-semibold text-slate-800">{{ lastInvoiceDraft.recipientChainId }}</span>.
        </p>
        <p v-if="lastInvoiceDraft.sourceTxHash">
          Source tx: <span class="font-mono text-slate-700">{{ lastInvoiceDraft.sourceTxHash }}</span>
        </p>
        <p v-if="lastInvoiceDraft.invoiceId">
          Created invoice ID: <span class="font-mono text-slate-700">{{ lastInvoiceDraft.invoiceId }}</span>
        </p>
      </div>
    </div>

    <InvoiceTableCard :key="invoiceTableRefreshKey" />

    <CreateInvoiceModal
      v-model="isCreateInvoiceModalOpen"
      :creator-chain-id="activeChainId"
      :initial-values="{ creator: ssoAccount ?? '' }"
      @submit="handleCreateInvoiceSubmit"
      @cancel="handleCreateInvoiceCancel"
    />

    <div class="enterprise-card overflow-hidden">
      <div class="px-8 py-6 border-b border-slate-100 flex items-center justify-between">
        <h4 class="text-lg font-bold text-slate-900">Latest Activity</h4>
        <span class="text-xs font-bold text-slate-400 bg-slate-50 px-3 py-1 rounded-full border border-slate-100">
          {{ transactions.length }} total
        </span>
      </div>

      <div class="divide-y divide-slate-50 max-h-[400px] overflow-y-auto">
        <div v-if="transactions.length === 0" class="px-8 py-16 text-center">
          <BaseIcon name="InboxIcon" class="w-12 h-12 text-slate-200 mx-auto mb-4" />
          <p class="text-slate-400 text-sm font-medium">No recent transactions</p>
        </div>

        <div
          v-for="tx in transactions"
          :key="tx.id"
          class="px-8 py-5 flex items-center justify-between gap-6 hover:bg-slate-50/50 transition-colors"
        >
          <div class="flex items-center gap-4 min-w-0">
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
              <h5 class="text-sm font-bold text-slate-900">{{ tx.function }}</h5>
              <p class="text-xs font-mono text-slate-400 mt-1">{{ tx.hash }}</p>
              <p class="text-xs text-slate-500 mt-2 leading-relaxed" style="overflow-wrap:anywhere;">
                {{ tx.detail }}
              </p>
            </div>
          </div>
          <p class="text-[10px] font-bold text-slate-300 uppercase tracking-widest shrink-0">{{ tx.timestamp }}</p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import BaseIcon from '../components/BaseIcon.vue';
import CreateInvoiceModal from '../components/CreateInvoiceModal.vue';
import InvoiceTableCard from '../components/InvoiceTableCard.vue';
import { useActiveChainBalances } from '../composables/useActiveChainBalances';
import { usePrividium } from '../composables/usePrividium';
import { useSsoAccount } from '../composables/useSsoAccount';
import { useInteropInvoice } from '../composables/useInteropInvoice';
import { getBackendUrl } from '../utils/backend';
import type { CreateInvoiceSubmitPayload } from '../utils/invoiceForm';
import type {
  BackendServiceResponse,
  InvoiceRecord,
  InvoiceResponseObject
} from '../types/invoices';

type BannerTone = 'info' | 'success' | 'error';
type InteropStepKey = 'validating' | 'authorizing' | 'submitting' | 'waiting' | 'success';
type ActivityStatus = 'pending' | 'success' | 'failed';

type ActivityEntry = {
  id: string;
  function: string;
  status: ActivityStatus;
  hash: string;
  detail: string;
  timestamp: string;
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

type TokenFundingJobStatus = 'queued' | 'running' | 'succeeded' | 'failed';

const INTEROP_PROGRESS_ORDER: InteropStepKey[] = [
  'validating',
  'authorizing',
  'submitting',
  'waiting',
  'success'
];
const INVOICE_POLL_INTERVAL_MS = 3000;
const INVOICE_POLL_TIMEOUT_MS = 90000;
const FUND_TOKENS_POLL_INTERVAL_MS = 15000;
const FUND_TOKENS_TIMEOUT_MS = 300000;
const MAX_ERROR_MESSAGE_LENGTH = 220;

const router = useRouter();
const { isAuthenticated, getChain } = usePrividium();
const { account: ssoAccount } = useSsoAccount();
const { sourceConfig, destinationConfig, sendCreateInvoiceBundle } = useInteropInvoice();
const {
  rows: balanceRows,
  isLoading: isBalancesLoading,
  error: balancesError,
  refresh: refreshBalances
} = useActiveChainBalances();

const copied = ref(false);
const isCreateInvoiceModalOpen = ref(false);
const createInvoiceBanner = ref('');
const createInvoiceBannerTone = ref<BannerTone>('info');
const lastInvoiceDraft = ref<InvoiceDraftSummary | null>(null);
const transactions = ref<ActivityEntry[]>([]);
const invoiceTableRefreshKey = ref(0);
const errorMessage = ref('');
const interopStep = ref<'idle' | 'failed' | InteropStepKey>('idle');
const interopMessage = ref('');
const interopError = ref('');
const interopSourceTxHash = ref('');
const interopBundleHash = ref('');
const interopInvoiceId = ref('');
const progressTimers = ref<number[]>([]);
const isTokenFunding = ref(false);
const tokenFundingNotice = ref('');
const tokenFundingNoticeTone = ref<'info' | 'success' | 'error'>('info');

const activeChainId = computed(() => Number(getChain().id));
const sourceChainLabel = computed(() => `Chain ${sourceConfig.value.chainKey}`);
const destinationChainId = computed(() => destinationConfig.value.chainId ?? null);
const currentInteropCenterAddress = computed(() => sourceConfig.value.interopCenter ?? null);
const destinationInvoicePaymentAddress = computed(() => destinationConfig.value.invoicePayment ?? null);
const canOpenInvoiceModal = computed(
  () => Boolean(ssoAccount.value && currentInteropCenterAddress.value && destinationInvoicePaymentAddress.value)
);
const isConfigured = computed(
  () => Boolean(currentInteropCenterAddress.value && destinationInvoicePaymentAddress.value)
);
const isInvoiceProcessing = computed(() =>
  ['validating', 'authorizing', 'submitting', 'waiting'].includes(interopStep.value)
);
const createInvoiceBannerClass = computed(() => {
  if (createInvoiceBannerTone.value === 'success') {
    return 'border-emerald-100 bg-emerald-50 text-emerald-800';
  }
  if (createInvoiceBannerTone.value === 'error') {
    return 'border-red-100 bg-red-50 text-red-800';
  }
  return 'border-sky-100 bg-sky-50 text-sky-800';
});
const tokenFundingNoticeClass = computed(() => {
  if (tokenFundingNoticeTone.value === 'success') {
    return 'border-emerald-100 bg-emerald-50 text-emerald-800';
  }
  if (tokenFundingNoticeTone.value === 'error') {
    return 'border-red-100 bg-red-50 text-red-800';
  }
  return 'border-sky-100 bg-sky-50 text-sky-800';
});
const interopStatusLabel = computed(() => {
  if (interopStep.value === 'idle') return 'Idle';
  if (interopStep.value === 'failed') return 'Failed';
  if (interopStep.value === 'success') return 'Success';
  return 'Running';
});
const interopStatusClass = computed(() => {
  if (interopStep.value === 'failed') {
    return 'border-red-200 bg-red-50 text-red-700';
  }
  if (interopStep.value === 'success') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  }
  if (interopStep.value === 'idle') {
    return 'border-slate-200 bg-slate-50 text-slate-500';
  }
  return 'border-amber-200 bg-amber-50 text-amber-700';
});
const interopSteps = [
  {
    key: 'validating' as const,
    order: 1,
    label: 'Validate request',
    description: 'Check addresses, token routing, and chain C contract configuration.'
  },
  {
    key: 'authorizing' as const,
    order: 2,
    label: 'Authorize passkey',
    description: 'Request authenticated wallet permission for the source-chain interop call.'
  },
  {
    key: 'submitting' as const,
    order: 3,
    label: 'Submit source tx',
    description: 'Send the UserOperation that calls the current chain InteropCenter.'
  },
  {
    key: 'waiting' as const,
    order: 4,
    label: 'Wait for chain C',
    description: 'Poll for the resulting invoice record after the relay executes on chain C.'
  },
  {
    key: 'success' as const,
    order: 5,
    label: 'Completed',
    description: 'Invoice creation confirmed and ready in the dashboard table.'
  }
] as const;

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

const isInvoiceRecord = (value: unknown): value is InvoiceRecord => {
  if (!isRecord(value)) return false;

  const id = toStringValue(value.id);
  const recipient = toStringValue(value.recipient);
  const billingToken = toStringValue(value.billingToken);
  const amount = toStringValue(value.amount);
  const status = toStringValue(value.status);
  const creatorChainId = toNumberValue(value.creatorChainId);
  const recipientChainId = toNumberValue(value.recipientChainId);
  const text = toStringValue(value.text);

  return Boolean(
    id &&
      recipient &&
      billingToken &&
      amount &&
      status &&
      creatorChainId !== null &&
      recipientChainId !== null &&
      text !== null
  );
};

const isServiceResponse = <T,>(value: unknown): value is BackendServiceResponse<T> => {
  if (!isRecord(value)) return false;
  return (
    typeof value.success === 'boolean' &&
    typeof value.message === 'string' &&
    typeof value.statusCode === 'number'
  );
};

const isInvoiceResponseObject = (value: unknown): value is InvoiceResponseObject => {
  if (!isRecord(value) || !Array.isArray(value.invoices)) return false;
  return value.invoices.every(isInvoiceRecord);
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

const clearProgressTimers = () => {
  for (const timer of progressTimers.value) {
    window.clearTimeout(timer);
  }
  progressTimers.value = [];
};

const scheduleSubmissionProgress = () => {
  clearProgressTimers();
  progressTimers.value.push(
    window.setTimeout(() => {
      if (interopStep.value === 'authorizing') {
        interopStep.value = 'submitting';
        interopMessage.value = 'Submitting the source-chain bundle.';
      }
    }, 1000)
  );
  progressTimers.value.push(
    window.setTimeout(() => {
      if (interopStep.value === 'authorizing' || interopStep.value === 'submitting') {
        interopStep.value = 'waiting';
        interopMessage.value = 'Waiting for the source chain to confirm the bundle.';
      }
    }, 3500)
  );
};

const stepState = (key: InteropStepKey) => {
  if (interopStep.value === 'idle') {
    return 'upcoming';
  }
  if (interopStep.value === 'failed') {
    return INTEROP_PROGRESS_ORDER.indexOf(key) <= INTEROP_PROGRESS_ORDER.indexOf('waiting')
      ? 'failed'
      : 'upcoming';
  }

  const currentIndex = INTEROP_PROGRESS_ORDER.indexOf(interopStep.value);
  const stepIndex = INTEROP_PROGRESS_ORDER.indexOf(key);
  if (stepIndex < currentIndex) return 'complete';
  if (stepIndex === currentIndex) return interopStep.value === 'success' ? 'complete' : 'current';
  return 'upcoming';
};

const stepCardClass = (key: InteropStepKey) => {
  const state = stepState(key);
  if (state === 'complete') return 'border-emerald-100 bg-emerald-50/70';
  if (state === 'current') return 'border-amber-200 bg-amber-50/70';
  if (state === 'failed') return 'border-red-100 bg-red-50/70';
  return 'border-slate-100 bg-white';
};

const stepIconClass = (key: InteropStepKey) => {
  const state = stepState(key);
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

const handleCreateInvoiceCancel = () => {
  if (!isInvoiceProcessing.value) {
    createInvoiceBanner.value = '';
  }
};

const refreshInvoiceTable = () => {
  invoiceTableRefreshKey.value += 1;
};

const listFailedTokens = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((entry) => isRecord(entry) && entry.minted === false)
    .map(
      (entry) => toStringValue((entry as Record<string, unknown>).token)?.toUpperCase() || 'TOKEN'
    );
};

const fundTestTokens = async () => {
  if (!ssoAccount.value || isTokenFunding.value) {
    return;
  }

  isTokenFunding.value = true;
  tokenFundingNoticeTone.value = 'info';
  tokenFundingNotice.value = `Requesting token funding on ${sourceChainLabel.value}.`;

  try {
    const response = await fetch(getBackendUrl('/fund-tokens'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify({ accountAddress: ssoAccount.value })
    });

    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const serverMessage =
        isServiceResponse(payload) && typeof payload.message === 'string'
          ? payload.message
          : `Token funding request failed with status ${response.status}`;
      throw new Error(serverMessage);
    }

    if (!isServiceResponse<Record<string, unknown>>(payload)) {
      throw new Error('Unexpected token funding response format.');
    }

    if (!payload.success) {
      throw new Error(payload.message || 'Token funding failed.');
    }

    const initialResponseObject = isRecord(payload.responseObject)
      ? (payload.responseObject as Record<string, unknown>)
      : {};
    const immediateFailedTokens = listFailedTokens(initialResponseObject.tokenMintResults);

    const immediateStatus = toStringValue(initialResponseObject.status);
    const jobId = toStringValue(initialResponseObject.jobId);

    if (immediateFailedTokens.length > 0) {
      tokenFundingNoticeTone.value = 'error';
      tokenFundingNotice.value = `Token funding finished with errors for ${immediateFailedTokens.join(', ')}. Check backend logs for details.`;
      await refreshBalances();
      return;
    }

    if (!jobId || (immediateStatus !== 'queued' && immediateStatus !== 'running')) {
      tokenFundingNoticeTone.value = 'success';
      tokenFundingNotice.value = 'Test token funding completed.';
      await refreshBalances();
      return;
    }

    tokenFundingNoticeTone.value = 'info';
    tokenFundingNotice.value = `Token funding queued (job ${jobId.slice(0, 8)}). Processing...`;

    const deadline = Date.now() + FUND_TOKENS_TIMEOUT_MS;
    let lastSeenStatus: TokenFundingJobStatus = immediateStatus as TokenFundingJobStatus;

    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, FUND_TOKENS_POLL_INTERVAL_MS));

      const statusResponse = await fetch(getBackendUrl(`/fund-tokens/${jobId}`), {
        headers: {
          Accept: 'application/json'
        }
      });
      const statusPayload: unknown = await statusResponse.json().catch(() => null);
      if (!statusResponse.ok) {
        const serverMessage =
          isServiceResponse(statusPayload) && typeof statusPayload.message === 'string'
            ? statusPayload.message
            : `Token funding status failed with status ${statusResponse.status}`;
        throw new Error(serverMessage);
      }

      if (!isServiceResponse<Record<string, unknown>>(statusPayload)) {
        throw new Error('Unexpected token funding status format.');
      }

      const statusObject = isRecord(statusPayload.responseObject)
        ? (statusPayload.responseObject as Record<string, unknown>)
        : {};
      const status = toStringValue(statusObject.status) as TokenFundingJobStatus | null;
      if (!status) {
        continue;
      }

      lastSeenStatus = status;

      if (status === 'queued' || status === 'running') {
        tokenFundingNoticeTone.value = 'info';
        tokenFundingNotice.value = `Token funding ${status} (job ${jobId.slice(0, 8)}).`;
        continue;
      }

      const failedTokens = listFailedTokens(statusObject.tokenMintResults);
      if (status === 'failed') {
        const detail = toStringValue(statusObject.error);
        tokenFundingNoticeTone.value = 'error';
        tokenFundingNotice.value = failedTokens.length
          ? `Token funding finished with errors for ${failedTokens.join(', ')}. Check backend logs for details.`
          : detail || 'Token funding failed. Check backend logs for details.';
      } else if (failedTokens.length > 0) {
        tokenFundingNoticeTone.value = 'error';
        tokenFundingNotice.value = `Token funding finished with errors for ${failedTokens.join(', ')}. Check backend logs for details.`;
      } else {
        tokenFundingNoticeTone.value = 'success';
        tokenFundingNotice.value = 'Test token funding completed.';
      }

      await refreshBalances();
      return;
    }

    tokenFundingNoticeTone.value = 'error';
    tokenFundingNotice.value = `Token funding is still ${lastSeenStatus} after ${Math.floor(FUND_TOKENS_TIMEOUT_MS / 1000)}s. Check backend logs and retry refresh later.`;
  } catch (error) {
    tokenFundingNoticeTone.value = 'error';
    tokenFundingNotice.value = formatTransactionError(error, 'Failed to fund test tokens.');
  } finally {
    isTokenFunding.value = false;
  }
};

const addTransaction = (
  func: string,
  status: ActivityStatus,
  hash: string,
  detail: string
) => {
  const id = Date.now().toString();
  transactions.value.unshift({
    id,
    function: func,
    status,
    hash: hash || 'Processing...',
    detail,
    timestamp: new Date().toLocaleTimeString()
  });
  return id;
};

const updateTransaction = (
  id: string,
  updates: Partial<Pick<ActivityEntry, 'status' | 'hash' | 'detail'>>
) => {
  const tx = transactions.value.find((entry) => entry.id === id);
  if (!tx) return;

  if (updates.status) tx.status = updates.status;
  if (updates.hash) tx.hash = updates.hash;
  if (updates.detail) tx.detail = updates.detail;
};

const fetchInvoicesSnapshot = async (): Promise<InvoiceRecord[]> => {
  const response = await fetch(getBackendUrl('/invoices'), {
    headers: {
      Accept: 'application/json'
    }
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

  return payload.responseObject.invoices;
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
      lastFetchError = formatTransactionError(error, 'Failed to read invoices while waiting for chain C.');
    }

    await new Promise((resolve) => setTimeout(resolve, INVOICE_POLL_INTERVAL_MS));
  }

  if (lastFetchError) {
    throw new Error(lastFetchError);
  }

  throw new Error('Timed out waiting for the invoice to appear on chain C.');
};

const handleCreateInvoiceSubmit = async (payload: CreateInvoiceSubmitPayload) => {
  errorMessage.value = '';
  interopError.value = '';
  createInvoiceBannerTone.value = 'info';
  createInvoiceBanner.value = 'Validating invoice request before cross-chain submission.';
  interopStep.value = 'validating';
  interopMessage.value = 'Validating invoice payload and loading a baseline invoice snapshot.';
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
    `Validating ${payload.billingTokenSymbol} invoice for chain C.`
  );

  let baselineIds = new Set<string>();

  try {
    try {
      const baselineInvoices = await fetchInvoicesSnapshot();
      baselineIds = new Set(baselineInvoices.map((invoice) => invoice.id));
    } catch (baselineError) {
      console.warn('Unable to load baseline invoice snapshot before submission:', baselineError);
    }

    interopStep.value = 'authorizing';
    interopMessage.value = 'Authorizing the source-chain InteropCenter call with your passkey.';
    createInvoiceBanner.value = `Authorizing ${sourceChainLabel.value} wallet access for the interop transaction.`;
    updateTransaction(txId, {
      hash: 'Authorizing passkey...',
      detail: `Authorizing ${sourceChainLabel.value} wallet session.`
    });
    scheduleSubmissionProgress();

    const result = await sendCreateInvoiceBundle(payload);

    clearProgressTimers();
    interopStep.value = 'waiting';
    interopMessage.value = 'Source transaction confirmed. Waiting for the chain C relay result.';
    interopSourceTxHash.value = result.transactionHash;
    interopBundleHash.value = result.bundleHash ?? '';
    createInvoiceBanner.value = 'Source transaction confirmed. Waiting for the invoice to appear on chain C.';

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
      detail: result.bundleHash
        ? `Bundle ${truncateHash(result.bundleHash)} submitted. Waiting for chain C execution.`
        : 'Source transaction confirmed. Waiting for chain C execution.'
    });

    const createdInvoice = await waitForInvoiceAppearance(
      payload,
      result.destinationBillingToken,
      baselineIds
    );

    interopStep.value = 'success';
    interopMessage.value = `Invoice ${createdInvoice.id} was created on chain C.`;
    interopInvoiceId.value = createdInvoice.id;
    createInvoiceBannerTone.value = 'success';
    createInvoiceBanner.value = `Invoice ${createdInvoice.id} created on chain C. Source tx ${truncateHash(result.transactionHash)}.`;

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
      detail: `Invoice ${createdInvoice.id} confirmed on chain C.`
    });
    void refreshBalances();
    refreshInvoiceTable();
  } catch (error) {
    clearProgressTimers();
    interopStep.value = 'failed';
    interopError.value = formatTransactionError(error, 'Failed to create invoice on chain C.');
    errorMessage.value = interopError.value;
    createInvoiceBannerTone.value = 'error';
    createInvoiceBanner.value = interopError.value;

    updateTransaction(txId, {
      status: 'failed',
      hash: interopSourceTxHash.value || 'Submission failed',
      detail: interopError.value
    });
  }
};

onMounted(() => {
  if (!isAuthenticated.value) {
    void router.push('/login');
    return;
  }

  if (!currentInteropCenterAddress.value || !destinationInvoicePaymentAddress.value) {
    errorMessage.value = 'Missing interop contract configuration for the active invoice route.';
  }
});

onBeforeUnmount(() => {
  clearProgressTimers();
});
</script>
