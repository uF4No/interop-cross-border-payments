<script setup lang="ts">
import { formatUnits } from 'viem';
import { computed, onBeforeUnmount, ref, watch } from 'vue';

import type { InvoicePaymentOption, InvoiceRecord } from '@/types/invoices';
import BaseIcon from './BaseIcon.vue';

type Props = {
  modelValue: boolean;
  invoice: InvoiceRecord | null;
  paymentOptions: InvoicePaymentOption[];
  billingTokenSymbol?: string;
  quoteType?: string;
  loading?: boolean;
  loadError?: string;
  isSubmitting?: boolean;
  disableConfirmReason?: string;
  hasSufficientBillingLiquidity?: boolean;
  billingLiquidityAmount?: string;
};

const props = withDefaults(defineProps<Props>(), {
  billingTokenSymbol: '',
  quoteType: 'exact',
  loading: false,
  loadError: '',
  isSubmitting: false,
  disableConfirmReason: '',
  hasSufficientBillingLiquidity: true,
  billingLiquidityAmount: '0'
});

const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void;
  (event: 'confirm', option: InvoicePaymentOption): void;
  (event: 'cancel'): void;
}>();

const selectedToken = ref('');
const env = import.meta.env as Record<string, string | undefined>;

const selectedOption = computed(() => {
  if (!selectedToken.value) {
    return props.paymentOptions[0] ?? null;
  }

  return (
    props.paymentOptions.find(
      (option) => option.token.toLowerCase() === selectedToken.value.toLowerCase()
    ) ?? null
  );
});

const formatAmount = (rawAmount: string, options?: { maxDecimals?: number }) => {
  try {
    const full = formatUnits(BigInt(rawAmount), 18);
    const [whole, fraction = ''] = full.split('.');
    const trimmedFraction = fraction.replace(/0+$/g, '');
    const maxDecimals = options?.maxDecimals ?? 4;

    if (!trimmedFraction) {
      return whole;
    }

    return `${whole}.${trimmedFraction.slice(0, maxDecimals)}`;
  } catch {
    return rawAmount;
  }
};

const formatFullAmount = (rawAmount: string) => {
  try {
    return formatUnits(BigInt(rawAmount), 18);
  } catch {
    return rawAmount;
  }
};

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

const readFirstDefined = (...keys: string[]) => {
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value) {
      return value;
    }
  }

  return null;
};

const readChainCompanyName = (chainKey: 'A' | 'B') =>
  readFirstDefined(
    `VITE_PRIVIDIUM_CHAIN_${chainKey}_COMPANY_NAME`,
    `VITE_CHAIN_${chainKey}_COMPANY_NAME`,
    `VITE_COMPANY_${chainKey}_NAME`
  ) ?? `Chain ${chainKey}`;

const configuredChainLabels = new Map<number, string>(
  [
    [readChainId('VITE_CHAIN_A_CHAIN_ID', 'VITE_PRIVIDIUM_CHAIN_A_ID'), readChainCompanyName('A')],
    [readChainId('VITE_CHAIN_B_CHAIN_ID', 'VITE_PRIVIDIUM_CHAIN_B_ID'), readChainCompanyName('B')],
    [readChainId('VITE_CHAIN_C_CHAIN_ID'), 'Chain C']
  ].filter((entry): entry is [number, string] => entry[0] !== null)
);

const formatChainLabel = (chainId: number) =>
  configuredChainLabels.get(chainId) ?? `Chain ${chainId}`;

const selectedFxRate = computed(() => {
  if (!props.invoice || !selectedOption.value || selectedOption.value.isBillingToken) {
    return '';
  }

  try {
    const billingAmount = Number(formatUnits(BigInt(props.invoice.amount), 18));
    const paymentAmount = Number(formatUnits(BigInt(selectedOption.value.paymentAmount), 18));
    if (!Number.isFinite(billingAmount) || billingAmount <= 0 || !Number.isFinite(paymentAmount)) {
      return '';
    }

    const rate = paymentAmount / billingAmount;
    const formattedRate =
      rate >= 100 ? rate.toFixed(2) : rate >= 1 ? rate.toFixed(4) : rate.toFixed(6);

    return `1 ${props.billingTokenSymbol || 'TOKEN'} = ${formattedRate.replace(/\.?0+$/g, '')} ${selectedOption.value.symbol}`;
  } catch {
    return '';
  }
});

const syncDefaultOption = () => {
  const preferred =
    props.paymentOptions.find((option) => option.isBillingToken) ?? props.paymentOptions[0] ?? null;
  selectedToken.value = preferred?.token ?? '';
};

const close = () => {
  if (props.isSubmitting) {
    return;
  }

  emit('cancel');
  emit('update:modelValue', false);
};

const handleConfirm = () => {
  if (!selectedOption.value || props.disableConfirmReason || props.loading || props.isSubmitting) {
    return;
  }

  emit('confirm', selectedOption.value);
};

const handleBackdropClick = (event: MouseEvent) => {
  if (event.target === event.currentTarget) {
    close();
  }
};

const handleEscape = (event: KeyboardEvent) => {
  if (event.key === 'Escape') {
    close();
  }
};

watch(
  () => [props.modelValue, props.paymentOptions] as const,
  ([isOpen]) => {
    if (!isOpen) {
      return;
    }

    syncDefaultOption();
  },
  { immediate: true, deep: true }
);

watch(
  () => props.modelValue,
  (isOpen, _, onCleanup) => {
    if (!isOpen) {
      return;
    }

    window.addEventListener('keydown', handleEscape);
    document.body.classList.add('overflow-hidden');

    onCleanup(() => {
      window.removeEventListener('keydown', handleEscape);
      document.body.classList.remove('overflow-hidden');
    });
  },
  { immediate: true }
);

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleEscape);
  document.body.classList.remove('overflow-hidden');
});
</script>

<template>
  <div
    v-if="modelValue"
    class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 px-4 py-8 backdrop-blur-sm"
    @click="handleBackdropClick"
  >
    <div class="w-full max-w-2xl overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-2xl">
      <div class="flex items-start justify-between gap-4 border-b border-slate-100 px-8 py-6">
        <div class="space-y-2">
          <p class="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">
            Pay Invoice
          </p>
          <h3 class="text-2xl font-bold text-slate-900">
            Invoice {{ invoice?.id ?? '...' }}
          </h3>
          <p class="text-sm text-slate-500">
            Choose the token you want to pay with. The displayed amount is an {{ quoteType }} chain C quote.
          </p>
        </div>

        <button
          type="button"
          class="rounded-full border border-slate-200 p-2 text-slate-400 transition-colors hover:border-slate-300 hover:text-slate-600"
          :disabled="isSubmitting"
          @click="close"
        >
          <BaseIcon name="XMarkIcon" class="h-5 w-5" />
        </button>
      </div>

      <div class="space-y-6 px-8 py-6">
        <div v-if="invoice" class="space-y-3">
          <div class="grid gap-4 rounded-3xl border border-slate-100 bg-slate-50/70 p-6 md:grid-cols-[minmax(0,1.35fr)_minmax(220px,0.65fr)] md:items-start">
            <div class="min-w-0">
              <p class="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Billed amount</p>
              <p
                class="mt-3 break-words text-3xl font-black tracking-tight text-slate-900"
                style="overflow-wrap:anywhere;"
              >
                {{ formatAmount(invoice.amount, { maxDecimals: 2 }) }} {{ billingTokenSymbol || 'TOKEN' }}
              </p>
              <p class="mt-2 text-xs font-mono text-slate-500" style="overflow-wrap:anywhere;">
                {{ invoice.billingToken }}
              </p>
            </div>

            <div class="min-w-0 rounded-2xl border border-slate-200 bg-white/80 px-4 py-4">
              <p class="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Status</p>
              <p class="mt-2 text-2xl font-bold text-slate-900">{{ invoice.status }}</p>
              <p class="mt-2 text-xs leading-relaxed text-slate-500" style="overflow-wrap:anywhere;">
                Recipient {{ formatChainLabel(invoice.recipientChainId) }}, creator {{ formatChainLabel(invoice.creatorChainId) }}
              </p>
            </div>
          </div>

          <div class="rounded-3xl border border-slate-100 bg-slate-50/70 p-5">
            <div class="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
              <div class="min-w-0">
                <p class="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Creator</p>
                <p class="mt-2 text-base font-bold text-slate-900">
                  {{ formatChainLabel(invoice.creatorChainId) }}
                </p>
              </div>
              <p
                class="text-xs font-mono text-slate-500 md:text-right"
                style="overflow-wrap:anywhere;"
                :title="invoice.creatorRefundAddress"
              >
                {{ truncateMiddle(invoice.creatorRefundAddress, 12, 8) }}
              </p>
            </div>
          </div>
        </div>

        <div
          v-if="invoice?.text"
          class="rounded-3xl border border-slate-100 bg-slate-50/70 p-5"
        >
          <p class="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Description</p>
          <p class="mt-2 text-sm leading-relaxed text-slate-700" style="overflow-wrap:anywhere;">
            {{ invoice.text }}
          </p>
        </div>

        <div
          v-if="!hasSufficientBillingLiquidity"
          class="rounded-3xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900"
        >
          <p class="font-semibold">InvoicePayment lacks billed-token liquidity.</p>
          <p class="mt-1">
            Current billed-token balance: {{ formatAmount(billingLiquidityAmount) }} {{ billingTokenSymbol || 'TOKEN' }}. Payment is blocked until the chain C contract is replenished.
          </p>
        </div>

        <div
          v-if="loadError"
          class="rounded-3xl border border-red-100 bg-red-50 px-5 py-4 text-sm text-red-800"
        >
          {{ loadError }}
        </div>

        <div v-else-if="loading" class="rounded-3xl border border-slate-100 bg-slate-50 px-5 py-8 text-sm text-slate-500">
          <div class="flex items-center gap-3">
            <BaseIcon name="ArrowPathIcon" class="h-5 w-5 animate-spin" />
            Loading payment options from chain C.
          </div>
        </div>

        <div v-else class="space-y-6">
          <div class="space-y-3">
            <p class="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Payment token</p>
            <div class="grid gap-3 md:grid-cols-3">
              <button
                v-for="option in paymentOptions"
                :key="option.token"
                type="button"
                class="min-w-0 rounded-3xl border px-4 py-4 text-left transition-colors"
                :class="
                  selectedOption?.token.toLowerCase() === option.token.toLowerCase()
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                "
                @click="selectedToken = option.token"
              >
                <p class="text-sm font-bold uppercase tracking-[0.14em]">{{ option.symbol }}</p>
                <p
                  class="mt-2 text-lg font-bold leading-tight"
                  style="overflow-wrap:anywhere;"
                  :title="formatFullAmount(option.paymentAmount)"
                >
                  {{ formatAmount(option.paymentAmount, { maxDecimals: 4 }) }}
                </p>
                <p
                  class="mt-1 text-[11px] uppercase tracking-[0.14em]"
                  :class="selectedOption?.token.toLowerCase() === option.token.toLowerCase() ? 'text-white/75' : 'text-slate-400'"
                >
                  {{ option.isBillingToken ? 'Same as billing token' : 'Converted quote' }}
                </p>
              </button>
            </div>
          </div>

          <div
            v-if="selectedOption"
            class="min-w-0 rounded-3xl border border-slate-100 bg-slate-50/70 p-5"
          >
            <p class="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Selected payment</p>
            <p
              class="mt-2 break-words text-2xl font-bold text-slate-900"
              style="overflow-wrap:anywhere;"
              :title="`${formatFullAmount(selectedOption.paymentAmount)} ${selectedOption.symbol}`"
            >
              {{ formatAmount(selectedOption.paymentAmount, { maxDecimals: 4 }) }} {{ selectedOption.symbol }}
            </p>
            <p
              v-if="selectedFxRate"
              class="mt-2 text-sm font-semibold text-slate-700"
              style="overflow-wrap:anywhere;"
            >
              FX rate: {{ selectedFxRate }}
            </p>
            <p class="mt-2 text-sm text-slate-500">
              This exact quoted amount will be bridged into your chain C shadow account and then used for settlement.
            </p>
          </div>

          <div
            v-if="disableConfirmReason"
            class="rounded-3xl border border-slate-200 bg-slate-50 px-5 py-4 text-sm text-slate-700"
          >
            {{ disableConfirmReason }}
          </div>
        </div>
      </div>

      <div class="flex flex-col-reverse gap-3 border-t border-slate-100 px-8 py-6 md:flex-row md:justify-end">
        <button type="button" class="enterprise-button-secondary" :disabled="isSubmitting" @click="close">
          Cancel
        </button>
        <button
          type="button"
          class="enterprise-button-primary"
          :disabled="Boolean(disableConfirmReason) || loading || isSubmitting || !selectedOption"
          @click="handleConfirm"
        >
          <BaseIcon
            v-if="isSubmitting"
            name="ArrowPathIcon"
            class="h-4 w-4 animate-spin"
          />
          {{ isSubmitting ? 'Paying invoice...' : 'Confirm payment' }}
        </button>
      </div>
    </div>
  </div>
</template>
