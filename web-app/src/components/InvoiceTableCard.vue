<script setup lang="ts">
import { formatUnits, getAddress, isAddress } from 'viem';
import { computed } from 'vue';

import { useInvoices } from '../composables/useInvoices';
import type { InvoiceTableRelationshipFilter, InvoiceTableStatusFilter } from '../types/invoices';
import type { InvoiceRecord } from '../types/invoices';
import BaseIcon from './BaseIcon.vue';

const props = defineProps<{
  activeChainId: number;
  isInteropProcessing?: boolean;
  processingInvoiceId?: string;
}>();

const emit = defineEmits<{
  pay: [invoice: InvoiceRecord];
}>();

const {
  countsByFilter,
  errorMessage,
  hasInvoices,
  isEmpty,
  isLoading,
  isManualRefreshing,
  isPolling,
  invoices,
  lastUpdatedAt,
  loadInvoices,
  relationshipFilters,
  refreshIntervalMs,
  selectedRelationshipFilter,
  selectedStatusFilter,
  setSelectedRelationshipFilter,
  setSelectedStatusFilter,
  statusFilters,
  totalInvoices
} = useInvoices();

const env = import.meta.env as Record<string, string | undefined>;
const timestampFormatter = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit'
});

const relationshipFilterLabels: Record<InvoiceTableRelationshipFilter, string> = {
  created: 'Created',
  received: 'Received'
};
const statusFilterLabels: Record<InvoiceTableStatusFilter, string> = {
  pending: 'Pending',
  paid: 'Paid'
};
const autoRefreshSeconds = Math.floor(refreshIntervalMs / 1000);
const lastUpdatedLabel = computed(() =>
  lastUpdatedAt.value ? timestampFormatter.format(new Date(lastUpdatedAt.value)) : ''
);
const showInitialLoadingState = computed(() => isLoading.value && !lastUpdatedAt.value);
const showBlockingErrorState = computed(() => Boolean(errorMessage.value) && !lastUpdatedAt.value);
const showInlineErrorNotice = computed(
  () => Boolean(errorMessage.value) && Boolean(lastUpdatedAt.value)
);

const selectedRelationshipLabel = computed(
  () => relationshipFilterLabels[selectedRelationshipFilter.value]
);
const selectedStatusLabel = computed(() => statusFilterLabels[selectedStatusFilter.value]);

const emptyStateTitle = computed(() => {
  return `No ${selectedRelationshipLabel.value.toLowerCase()} ${selectedStatusLabel.value.toLowerCase()} payment requests`;
});

const emptyStateDescription = computed(() => {
  return `The connected wallet does not have any ${selectedRelationshipLabel.value.toLowerCase()} payment requests with ${selectedStatusLabel.value.toLowerCase()} status.`;
});

const statusClassMap: Record<string, string> = {
  created: 'bg-sky-50 text-sky-700 border-sky-100',
  paid: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  cancelled: 'bg-rose-50 text-rose-700 border-rose-100',
  unknown: 'bg-slate-50 text-slate-600 border-slate-200'
};

const getStatusClass = (status: string) =>
  statusClassMap[status.toLowerCase()] ?? statusClassMap.unknown;

const truncateMiddle = (value: string, head = 8, tail = 6) =>
  value.length > head + tail + 3 ? `${value.slice(0, head)}...${value.slice(-tail)}` : value;

const formatCompactAddress = (value: string) => truncateMiddle(value, 6, 4);
const addThousandsSeparators = (value: string) => value.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

const billingTokenSymbols = ['USDC', 'SGD', 'TBILL'] as const;

type BillingTokenSymbol = (typeof billingTokenSymbols)[number];
type FormattedInvoiceAmount = {
  whole: string;
  fractionDisplay: string;
  full: string;
};

const readConfiguredTokenAddress = (symbol: BillingTokenSymbol) => {
  const candidates = [
    `VITE_TOKEN_${symbol}_ADDRESS_CHAIN_C`,
    `VITE_${symbol}_TOKEN_ADDRESS_CHAIN_C`,
    `VITE_TOKEN_${symbol}_ADDRESS`,
    `VITE_${symbol}_TOKEN_ADDRESS`,
    `VITE_TOKEN_${symbol}_ADDRESS_CHAIN_A`,
    `VITE_${symbol}_TOKEN_ADDRESS_CHAIN_A`,
    `VITE_TOKEN_${symbol}_ADDRESS_CHAIN_B`,
    `VITE_${symbol}_TOKEN_ADDRESS_CHAIN_B`
  ] as const;

  for (const key of candidates) {
    const value = env[key]?.trim();
    if (value && isAddress(value)) {
      return getAddress(value);
    }
  }

  return null;
};

const billingTokenSymbolByAddress = new Map<string, BillingTokenSymbol>(
  billingTokenSymbols.flatMap((symbol) => {
    const address = readConfiguredTokenAddress(symbol);
    return address ? [[address.toLowerCase(), symbol]] : [];
  })
);

const getBillingTokenSymbol = (address: string) =>
  billingTokenSymbolByAddress.get(address.toLowerCase()) ?? 'TOKEN';

const getPaymentTokenSymbol = (address: string | null) =>
  address ? getBillingTokenSymbol(address) : 'TOKEN';

const formatInvoiceAmount = (rawAmount: string): FormattedInvoiceAmount => {
  try {
    const full = formatUnits(BigInt(rawAmount), 18);
    const [whole, fraction = ''] = full.split('.');
    const trimmedFraction = fraction.replace(/0+$/g, '');

    return {
      whole: addThousandsSeparators(whole || '0'),
      fractionDisplay: trimmedFraction ? trimmedFraction.slice(0, 6) : '00',
      full
    };
  } catch {
    const [whole, fraction = ''] = rawAmount.split('.');
    return {
      whole: addThousandsSeparators(whole || '0'),
      fractionDisplay: fraction ? fraction.slice(0, 6) : '00',
      full: rawAmount
    };
  }
};

const formatCondensedAmount = (rawAmount: string) => {
  try {
    const full = formatUnits(BigInt(rawAmount), 18);
    const [whole, fraction = ''] = full.split('.');
    const trimmedFraction = fraction.replace(/0+$/g, '').slice(0, 6);
    return trimmedFraction
      ? `${addThousandsSeparators(whole || '0')}.${trimmedFraction}`
      : addThousandsSeparators(whole || '0');
  } catch {
    return rawAmount;
  }
};

const hasSettlementDetails = (invoice: InvoiceRecord) =>
  normalizeInvoiceStatus(invoice) === 'paid' && Boolean(invoice.paymentToken);

const settlementSummary = (invoice: InvoiceRecord) => {
  if (!hasSettlementDetails(invoice) || !invoice.paymentToken) {
    return '';
  }

  return `${formatCondensedAmount(invoice.paymentAmount)} ${getPaymentTokenSymbol(invoice.paymentToken)}`;
};

const settlementFxRate = (invoice: InvoiceRecord) => {
  if (!hasSettlementDetails(invoice) || !invoice.paymentToken) {
    return '';
  }

  try {
    const billingAmount = Number(formatUnits(BigInt(invoice.amount), 18));
    const paymentAmount = Number(formatUnits(BigInt(invoice.paymentAmount), 18));
    if (!Number.isFinite(billingAmount) || billingAmount <= 0 || !Number.isFinite(paymentAmount)) {
      return '';
    }

    const rate = paymentAmount / billingAmount;
    const formattedRate =
      rate >= 100 ? rate.toFixed(2) : rate >= 1 ? rate.toFixed(4) : rate.toFixed(6);
    return `1 ${getBillingTokenSymbol(invoice.billingToken)} = ${formattedRate.replace(/\.?0+$/g, '')} ${getPaymentTokenSymbol(invoice.paymentToken)}`;
  } catch {
    return '';
  }
};

const readChainId = (...keys: string[]) => {
  for (const key of keys) {
    const value = env[key]?.trim();
    if (!value) continue;

    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return null;
};

const configuredChainLabels = new Map<number, string>(
  [
    [readChainId('VITE_CHAIN_A_CHAIN_ID', 'VITE_PRIVIDIUM_CHAIN_A_ID'), 'Chain A'],
    [readChainId('VITE_CHAIN_B_CHAIN_ID', 'VITE_PRIVIDIUM_CHAIN_B_ID'), 'Chain B']
  ].filter((entry): entry is [number, string] => entry[0] !== null)
);

const formatChainLabel = (chainId: number) =>
  configuredChainLabels.get(chainId) ?? `Chain ${chainId}`;

const normalizeInvoiceStatus = (invoice: InvoiceRecord) => invoice.status.trim().toLowerCase();

const canPayInvoice = (invoice: InvoiceRecord) =>
  invoice.sourceTags.includes('pending') &&
  normalizeInvoiceStatus(invoice) === 'created' &&
  props.activeChainId === invoice.recipientChainId &&
  !props.isInteropProcessing;

const payButtonLabel = (invoice: InvoiceRecord) => {
  if (props.processingInvoiceId === invoice.id) return 'Paying...';

  const status = normalizeInvoiceStatus(invoice);
  if (status === 'paid') return 'Paid';
  if (status === 'cancelled') return 'Cancelled';
  if (props.isInteropProcessing) return 'Busy';
  if (props.activeChainId !== invoice.recipientChainId) {
    return `${formatChainLabel(invoice.recipientChainId)} only`;
  }
  return 'Pay';
};

const payButtonTitle = (invoice: InvoiceRecord) => {
  const status = normalizeInvoiceStatus(invoice);
  if (status !== 'created') {
    return `Payment request is already ${status}.`;
  }
  if (!invoice.sourceTags.includes('pending')) {
    return 'Only payment requests assigned to the connected wallet can be paid.';
  }
  if (props.isInteropProcessing) {
    return 'Another interop transaction is already in progress.';
  }
  if (props.activeChainId !== invoice.recipientChainId) {
    return `This payment request can only be paid from ${formatChainLabel(invoice.recipientChainId)}.`;
  }
  return 'Pay this request from the active recipient chain.';
};

const handlePayClick = (invoice: InvoiceRecord) => {
  if (!canPayInvoice(invoice)) {
    return;
  }
  emit('pay', invoice);
};

defineExpose({
  refreshInvoices: () => loadInvoices()
});
</script>

<template>
  <div class="enterprise-card overflow-hidden">
    <div class="px-8 py-6 border-b border-slate-100 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
      <div class="space-y-3">
        <div class="flex items-center gap-3">
          <h4 class="text-lg font-bold text-slate-900">Payment Requests</h4>
          <span class="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 bg-slate-50 px-3 py-1 rounded-full border border-slate-100">
            {{ totalInvoices }} shown
          </span>
        </div>
        <p class="text-sm text-slate-500">
          Fetches every chain C payment request once, then filters locally for the connected wallet.
        </p>
        <div class="flex flex-wrap items-center gap-2">
          <span
            class="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500"
          >
            <span
              class="h-2 w-2 rounded-full"
              :class="isPolling ? 'bg-sky-500 animate-pulse' : 'bg-emerald-500'"
            ></span>
            Auto-refresh every {{ autoRefreshSeconds }}s
          </span>
          <span v-if="lastUpdatedLabel" class="text-xs text-slate-400">
            Last updated {{ lastUpdatedLabel }}
          </span>
        </div>
        <div class="flex flex-wrap gap-2">
          <button
            v-for="filter in relationshipFilters"
            :key="filter"
            type="button"
            @click="setSelectedRelationshipFilter(filter)"
            class="inline-flex items-center gap-2 rounded-full border px-4 py-2 text-xs font-bold uppercase tracking-[0.14em] transition-colors"
            :class="
              selectedRelationshipFilter === filter
                ? 'border-slate-900 bg-slate-900 text-white'
                : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900'
            "
          >
            <span>{{ relationshipFilterLabels[filter] }}</span>
            <span
              class="rounded-full px-2 py-0.5 text-[10px]"
              :class="
                selectedRelationshipFilter === filter
                  ? 'bg-white/15 text-white'
                  : 'bg-slate-100 text-slate-500'
              "
            >
              {{ countsByFilter[filter][selectedStatusFilter] ?? 0 }}
            </span>
          </button>
        </div>
        <div class="flex flex-wrap gap-2">
          <button
            v-for="filter in statusFilters"
            :key="filter"
            type="button"
            @click="setSelectedStatusFilter(filter)"
            class="inline-flex items-center gap-2 rounded-full border px-4 py-2 text-xs font-bold uppercase tracking-[0.14em] transition-colors"
            :class="
              selectedStatusFilter === filter
                ? 'border-sky-700 bg-sky-700 text-white'
                : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900'
            "
          >
            <span>{{ statusFilterLabels[filter] }}</span>
            <span
              class="rounded-full px-2 py-0.5 text-[10px]"
              :class="
                selectedStatusFilter === filter
                  ? 'bg-white/15 text-white'
                  : 'bg-slate-100 text-slate-500'
              "
            >
              {{ countsByFilter[selectedRelationshipFilter][filter] ?? 0 }}
            </span>
          </button>
        </div>
      </div>

      <button
        @click="loadInvoices"
        :disabled="isLoading || isManualRefreshing"
        class="enterprise-button-secondary w-full md:w-auto"
      >
        <BaseIcon
          name="ArrowPathIcon"
          :class="{ 'animate-spin': isManualRefreshing }"
          class="w-4 h-4"
        />
        {{ isManualRefreshing ? 'Refreshing payment requests' : 'Refresh payment requests' }}
      </button>
    </div>

    <div v-if="showInitialLoadingState" class="px-8 py-12 space-y-4">
      <div class="flex items-center gap-3 text-slate-500">
        <BaseIcon name="ArrowPathIcon" class="w-5 h-5 animate-spin" />
        <span class="text-sm font-medium">Loading payment requests...</span>
      </div>
      <div class="space-y-3">
        <div
          v-for="row in 3"
          :key="row"
          class="grid grid-cols-9 gap-4 rounded-2xl border border-slate-100 bg-slate-50/70 px-4 py-4 animate-pulse"
        >
          <div v-for="col in 9" :key="col" class="h-4 rounded-full bg-slate-200"></div>
        </div>
      </div>
    </div>

    <div v-else-if="showBlockingErrorState" class="px-8 py-12">
      <div class="rounded-3xl border border-red-100 bg-red-50 px-6 py-6 flex items-start gap-4">
        <BaseIcon name="ExclamationTriangleIcon" class="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
        <div class="min-w-0 flex-1">
          <p class="text-sm font-semibold text-red-900">Unable to load payment requests.</p>
          <p class="mt-1 text-sm text-red-800" style="overflow-wrap:anywhere;">
            {{ errorMessage }}
          </p>
        </div>
        <button
          @click="loadInvoices"
          class="rounded-full bg-white px-4 py-2 text-sm font-semibold text-red-700 border border-red-200 hover:bg-red-100 transition-colors"
        >
          Retry
        </button>
      </div>
    </div>

    <div v-else class="px-8 py-6 space-y-4">
      <div
        v-if="showInlineErrorNotice"
        class="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-800"
      >
        Unable to refresh payment requests. Showing the last loaded snapshot.
        <span class="mt-1 block" style="overflow-wrap:anywhere;">{{ errorMessage }}</span>
      </div>

      <div v-if="isEmpty" class="py-10 text-center">
        <BaseIcon name="InboxIcon" class="w-12 h-12 text-slate-200 mx-auto mb-4" />
        <p class="text-slate-400 text-sm font-medium">{{ emptyStateTitle }}</p>
        <p class="text-slate-500 text-sm mt-2">{{ emptyStateDescription }}</p>
      </div>

      <div v-else-if="hasInvoices" class="overflow-x-auto">
        <table class="min-w-[1180px] w-full border-separate border-spacing-0">
          <thead class="bg-slate-50/80">
            <tr>
              <th class="px-4 py-4 text-left text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">ID</th>
              <th class="px-4 py-4 text-left text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Creator</th>
              <th class="px-4 py-4 text-left text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Recipient</th>
              <th class="px-4 py-4 text-left text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Billing Token</th>
              <th class="px-4 py-4 text-left text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Amount</th>
              <th class="px-4 py-4 text-left text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Status</th>
              <th class="px-4 py-4 text-left text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Creator Chain</th>
              <th class="px-4 py-4 text-left text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Recipient Chain</th>
              <th class="px-4 py-4 text-left text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Text</th>
              <th class="px-4 py-4 text-left text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Action</th>
            </tr>
          </thead>

          <tbody>
            <tr
              v-for="invoice in invoices"
              :key="invoice.id"
              class="border-t border-slate-100 hover:bg-slate-50/70 transition-colors"
            >
            <td class="px-4 py-4">
              <div class="flex flex-col gap-1">
                <span class="font-mono text-xs font-semibold text-slate-700" :title="invoice.id">
                  {{ truncateMiddle(invoice.id, 12, 8) }}
                </span>
              </div>
            </td>
            <td class="px-4 py-4">
              <span class="font-mono text-xs text-slate-600 whitespace-nowrap" :title="invoice.creator">
                {{ formatCompactAddress(invoice.creator) }}
              </span>
            </td>
            <td class="px-4 py-4">
              <span class="font-mono text-xs text-slate-600 whitespace-nowrap" :title="invoice.recipient">
                {{ formatCompactAddress(invoice.recipient) }}
              </span>
            </td>
            <td class="px-4 py-4">
              <div class="flex flex-col gap-0.5" :title="invoice.billingToken">
                <span class="text-xs font-semibold uppercase tracking-[0.12em] text-slate-800">
                  {{ getBillingTokenSymbol(invoice.billingToken) }}
                </span>
                <span class="font-mono text-[11px] text-slate-500 whitespace-nowrap">
                  {{ formatCompactAddress(invoice.billingToken) }}
                </span>
                <span
                  v-if="hasSettlementDetails(invoice)"
                  class="text-[11px] font-medium uppercase tracking-[0.12em] text-slate-400"
                >
                  Paid with {{ getPaymentTokenSymbol(invoice.paymentToken) }}
                </span>
              </div>
            </td>
            <td class="px-4 py-4">
              <div class="flex flex-col gap-0.5 tabular-nums" :title="formatInvoiceAmount(invoice.amount).full">
                <span class="text-sm font-semibold text-slate-900">
                  {{ formatInvoiceAmount(invoice.amount).whole }}
                </span>
                <span class="text-[11px] font-medium text-slate-400">
                  .{{ formatInvoiceAmount(invoice.amount).fractionDisplay }}
                </span>
                <span
                  v-if="hasSettlementDetails(invoice)"
                  class="text-[11px] font-medium text-slate-500"
                  style="overflow-wrap:anywhere;"
                >
                  Paid {{ settlementSummary(invoice) }}
                </span>
              </div>
            </td>
            <td class="px-4 py-4">
              <div class="flex max-w-[220px] flex-col gap-1">
                <span
                  class="inline-flex w-fit items-center rounded-full border px-3 py-1 text-xs font-bold uppercase tracking-[0.14em]"
                  :class="getStatusClass(invoice.status)"
                >
                  {{ invoice.status }}
                </span>
                <span
                  v-if="hasSettlementDetails(invoice)"
                  class="text-[11px] text-slate-500"
                  style="overflow-wrap:anywhere;"
                >
                  FX {{ settlementFxRate(invoice) }}
                </span>
              </div>
            </td>
            <td class="px-4 py-4">
              <span class="text-sm font-semibold text-slate-700 tabular-nums">{{ invoice.creatorChainId }}</span>
            </td>
            <td class="px-4 py-4">
              <span class="text-sm font-semibold text-slate-700 tabular-nums">{{ invoice.recipientChainId }}</span>
            </td>
            <td class="px-4 py-4">
              <p class="max-w-[320px] text-sm text-slate-600 leading-relaxed" :title="invoice.text" style="overflow-wrap:anywhere;">
                {{ invoice.text }}
              </p>
            </td>
            <td class="px-4 py-4">
              <button
                type="button"
                class="inline-flex min-w-[112px] items-center justify-center rounded-full border px-4 py-2 text-xs font-bold uppercase tracking-[0.14em] transition-colors"
                :class="
                  canPayInvoice(invoice)
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:border-emerald-300 hover:bg-emerald-100'
                    : 'cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400'
                "
                :disabled="!canPayInvoice(invoice)"
                :title="payButtonTitle(invoice)"
                @click="handlePayClick(invoice)"
              >
                <BaseIcon
                  v-if="processingInvoiceId === invoice.id"
                  name="ArrowPathIcon"
                  class="mr-2 h-4 w-4 animate-spin"
                />
                <span>{{ payButtonLabel(invoice) }}</span>
              </button>
            </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
