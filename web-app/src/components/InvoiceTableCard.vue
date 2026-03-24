<script setup lang="ts">
import BaseIcon from './BaseIcon.vue';
import { useInvoices } from '../composables/useInvoices';

const { errorMessage, hasInvoices, isEmpty, isLoading, invoices, loadInvoices } = useInvoices();

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
</script>

<template>
  <div class="enterprise-card overflow-hidden">
    <div class="px-8 py-6 border-b border-slate-100 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
      <div class="space-y-1">
        <div class="flex items-center gap-3">
          <h4 class="text-lg font-bold text-slate-900">Invoices</h4>
          <span class="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 bg-slate-50 px-3 py-1 rounded-full border border-slate-100">
            {{ invoices.length }} total
          </span>
        </div>
        <p class="text-sm text-slate-500">
          Fetches dashboard invoices directly from the backend.
        </p>
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
      <p class="text-slate-400 text-sm font-medium">No invoices available</p>
      <p class="text-slate-500 text-sm mt-2">The backend returned an empty invoice list.</p>
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
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
