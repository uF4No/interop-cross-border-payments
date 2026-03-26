<script setup lang="ts">
import { computed } from 'vue';

import BaseIcon from './BaseIcon.vue';
import { useInvoices } from '../composables/useInvoices';
import type { InvoiceView } from '../types/invoices';
import type { InvoiceRecord } from '../types/invoices';

const props = defineProps<{
  activeChainId: number;
  isInteropProcessing?: boolean;
  processingInvoiceId?: string;
}>();

const emit = defineEmits<{
  pay: [invoice: InvoiceRecord];
}>();

const {
  availableViews,
  countsByView,
  errorMessage,
  hasInvoices,
  isEmpty,
  isLoading,
  invoices,
  loadInvoices,
  selectedTargetChainId,
  selectedTargetChainLabel,
  selectedView,
  setSelectedTargetChainId,
  setSelectedView,
  targetChainOptions,
  totalInvoices
} = useInvoices();

const env = import.meta.env as Record<string, string | undefined>;

const viewLabels: Record<InvoiceView, string> = {
  all: 'All',
  created: 'Created by me',
  received: 'Received by me'
};

const emptyStateTitle = computed(() => {
  if (selectedView.value === 'created') return 'No created invoices';
  if (selectedView.value === 'received') return 'No received invoices';
  return 'No invoices available';
});

const targetScopeLabel = computed(() =>
  selectedTargetChainId.value === 'all' ? 'all target chains' : selectedTargetChainLabel.value
);

const emptyStateDescription = computed(() => {
  if (selectedView.value === 'created') {
    return `The connected wallet has not created any invoices targeting ${targetScopeLabel.value}.`;
  }
  if (selectedView.value === 'received') {
    return `The connected wallet is not the recipient for any invoices targeting ${targetScopeLabel.value}.`;
  }
  return `No invoices are currently available for ${targetScopeLabel.value}.`;
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
    return `Invoice is already ${status}.`;
  }
  if (props.isInteropProcessing) {
    return 'Another interop transaction is already in progress.';
  }
  if (props.activeChainId !== invoice.recipientChainId) {
    return `This invoice can only be paid from ${formatChainLabel(invoice.recipientChainId)}.`;
  }
  return 'Pay this invoice from the active recipient chain.';
};

const handlePayClick = (invoice: InvoiceRecord) => {
  if (!canPayInvoice(invoice)) {
    return;
  }
  emit('pay', invoice);
};
</script>

<template>
  <div class="enterprise-card overflow-hidden">
    <div class="px-8 py-6 border-b border-slate-100 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
      <div class="space-y-3">
        <div class="flex items-center gap-3">
          <h4 class="text-lg font-bold text-slate-900">Invoices</h4>
          <span class="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 bg-slate-50 px-3 py-1 rounded-full border border-slate-100">
            {{ totalInvoices }} shown
          </span>
        </div>
        <p class="text-sm text-slate-500">
          Fetches every chain C invoice once, then filters locally for the connected wallet.
        </p>
        <div class="flex flex-wrap gap-2">
          <button
            v-for="view in availableViews"
            :key="view"
            type="button"
            @click="setSelectedView(view)"
            class="inline-flex items-center gap-2 rounded-full border px-4 py-2 text-xs font-bold uppercase tracking-[0.14em] transition-colors"
            :class="
              selectedView === view
                ? 'border-slate-900 bg-slate-900 text-white'
                : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900'
            "
          >
            <span>{{ viewLabels[view] }}</span>
            <span
              class="rounded-full px-2 py-0.5 text-[10px]"
              :class="
                selectedView === view ? 'bg-white/15 text-white' : 'bg-slate-100 text-slate-500'
              "
            >
              {{ countsByView[view] ?? 0 }}
            </span>
          </button>
        </div>
        <div class="space-y-2">
          <p class="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
            Target chain
          </p>
          <div class="flex flex-wrap gap-2">
            <button
              v-for="option in targetChainOptions"
              :key="option.key"
              type="button"
              @click="setSelectedTargetChainId(option.value)"
              class="inline-flex items-center gap-2 rounded-full border px-4 py-2 text-xs font-bold uppercase tracking-[0.14em] transition-colors"
              :class="
                selectedTargetChainId === option.value
                  ? 'border-sky-700 bg-sky-700 text-white'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900'
              "
            >
              <span>{{ option.label }}</span>
              <span
                class="rounded-full px-2 py-0.5 text-[10px]"
                :class="
                  selectedTargetChainId === option.value
                    ? 'bg-white/15 text-white'
                    : 'bg-slate-100 text-slate-500'
                "
              >
                {{ option.count }}
              </span>
            </button>
          </div>
        </div>
      </div>

      <button
        @click="loadInvoices"
        :disabled="isLoading"
        class="enterprise-button-secondary w-full md:w-auto"
      >
        <BaseIcon name="ArrowPathIcon" :class="{ 'animate-spin': isLoading }" class="w-4 h-4" />
        Refresh invoices
      </button>
    </div>

    <div v-if="isLoading" class="px-8 py-12 space-y-4">
      <div class="flex items-center gap-3 text-slate-500">
        <BaseIcon name="ArrowPathIcon" class="w-5 h-5 animate-spin" />
        <span class="text-sm font-medium">Loading invoices...</span>
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

    <div v-else-if="errorMessage" class="px-8 py-12">
      <div class="rounded-3xl border border-red-100 bg-red-50 px-6 py-6 flex items-start gap-4">
        <BaseIcon name="ExclamationTriangleIcon" class="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
        <div class="min-w-0 flex-1">
          <p class="text-sm font-semibold text-red-900">Unable to load invoices.</p>
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

    <div v-else-if="isEmpty" class="px-8 py-16 text-center">
      <BaseIcon name="InboxIcon" class="w-12 h-12 text-slate-200 mx-auto mb-4" />
      <p class="text-slate-400 text-sm font-medium">{{ emptyStateTitle }}</p>
      <p class="text-slate-500 text-sm mt-2">{{ emptyStateDescription }}</p>
    </div>

    <div v-else-if="hasInvoices" class="overflow-x-auto">
      <table class="min-w-[1280px] w-full border-separate border-spacing-0">
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
              <span class="font-mono text-xs text-slate-600" :title="invoice.creator">
                {{ truncateMiddle(invoice.creator) }}
              </span>
            </td>
            <td class="px-4 py-4">
              <span class="font-mono text-xs text-slate-600" :title="invoice.recipient">
                {{ truncateMiddle(invoice.recipient) }}
              </span>
            </td>
            <td class="px-4 py-4">
              <span class="font-mono text-xs text-slate-600" :title="invoice.billingToken">
                {{ truncateMiddle(invoice.billingToken) }}
              </span>
            </td>
            <td class="px-4 py-4">
              <span class="text-sm font-semibold text-slate-900 tabular-nums">{{ invoice.amount }}</span>
            </td>
            <td class="px-4 py-4">
              <span
                class="inline-flex items-center rounded-full border px-3 py-1 text-xs font-bold uppercase tracking-[0.14em]"
                :class="getStatusClass(invoice.status)"
              >
                {{ invoice.status }}
              </span>
            </td>
            <td class="px-4 py-4">
              <span class="text-sm font-semibold text-slate-700 tabular-nums">{{ invoice.creatorChainId }}</span>
            </td>
            <td class="px-4 py-4">
              <span class="text-sm font-semibold text-slate-700 tabular-nums">{{ invoice.recipientChainId }}</span>
            </td>
            <td class="px-4 py-4">
              <p class="max-w-[320px] text-sm text-slate-600 leading-relaxed" :title="invoice.text">
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
</template>
