<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue';
import { isAddress } from 'viem';
import BaseIcon from './BaseIcon.vue';
import {
  createEmptyInvoiceFormState,
  getChainOptionById,
  getDefaultCreatorChainId,
  getInvoiceChainOptions,
  getInvoiceTokenOptions,
  getTokenOptionByAddress,
  isAllowedInvoiceChainId,
  normalizeInvoiceAmount,
  type CreateInvoiceSubmitPayload,
  type InvoiceFormState
} from '@/utils/invoiceForm';
import { useSsoAccount } from '@/composables/useSsoAccount';

type InvoiceFieldKey =
  | 'creator'
  | 'recipient'
  | 'amount'
  | 'text'
  | 'billingTokenAddress'
  | 'recipientChainId';

type Props = {
  modelValue: boolean;
  creatorChainId?: number;
  title?: string;
  subtitle?: string;
  initialValues?: Partial<InvoiceFormState>;
};

const props = withDefaults(defineProps<Props>(), {
  title: 'Create Invoice',
  subtitle: 'Prepare a cross-chain invoice using one of the deployed tokens.',
  initialValues: () => ({})
});

const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void;
  (event: 'submit', payload: CreateInvoiceSubmitPayload): void;
  (event: 'cancel'): void;
}>();

const form = reactive<InvoiceFormState>(createEmptyInvoiceFormState());
const creatorDirty = ref(false);
const touched = reactive<Record<InvoiceFieldKey, boolean>>({
  creator: false,
  recipient: false,
  amount: false,
  text: false,
  billingTokenAddress: false,
  recipientChainId: false
});
const showErrors = ref(false);
const { account: ssoAccount } = useSsoAccount();

const invoiceChainOptions = getInvoiceChainOptions();
const invoiceTokenOptions = getInvoiceTokenOptions();

const resolvedCreatorChainId = computed(() => {
  if (typeof props.creatorChainId === 'number' && isAllowedInvoiceChainId(props.creatorChainId)) {
    return props.creatorChainId;
  }

  return getDefaultCreatorChainId();
});

const selectedToken = computed(() => getTokenOptionByAddress(form.billingTokenAddress));
const selectedDestinationChain = computed(() =>
  getChainOptionById(Number.parseInt(form.recipientChainId, 10))
);

const fieldErrors = computed(() => {
  const errors: Partial<Record<InvoiceFieldKey, string>> = {};

  if (!form.creator.trim()) {
    errors.creator = 'Creator address is required.';
  } else if (!isAddress(form.creator.trim())) {
    errors.creator = 'Creator must be a valid address.';
  }

  if (!form.recipient.trim()) {
    errors.recipient = 'Recipient address is required.';
  } else if (!isAddress(form.recipient.trim())) {
    errors.recipient = 'Recipient must be a valid address.';
  }

  const amount = form.amount.trim();
  if (!amount) {
    errors.amount = 'Amount is required.';
  } else {
    try {
      const parsed = normalizeInvoiceAmount(amount);
      if (parsed <= 0n) {
        errors.amount = 'Amount must be greater than zero.';
      }
    } catch {
      errors.amount = 'Enter a valid decimal amount.';
    }
  }

  if (!selectedToken.value) {
    errors.billingTokenAddress = 'Select a deployed token from chain A or B.';
  }

  if (!form.recipientChainId.trim()) {
    errors.recipientChainId = 'Destination chain is required.';
  } else {
    const parsedChainId = Number.parseInt(form.recipientChainId, 10);
    if (!Number.isInteger(parsedChainId) || !isAllowedInvoiceChainId(parsedChainId)) {
      errors.recipientChainId = 'Destination chain must be chain A or B.';
    }
  }

  if (form.text.length > 280) {
    errors.text = 'Description must be 280 characters or fewer.';
  }

  return errors;
});

const hasErrors = computed(() => Object.keys(fieldErrors.value).length > 0);

const visibleError = (field: InvoiceFieldKey) => {
  if (!showErrors.value && !touched[field]) return '';
  return fieldErrors.value[field] ?? '';
};

const resetTouched = () => {
  for (const key of Object.keys(touched) as InvoiceFieldKey[]) {
    touched[key] = false;
  }
};

const resolveCreatorValue = () => {
  return ssoAccount.value?.trim() || props.initialValues?.creator?.trim() || '';
};

const syncCreatorPrefill = () => {
  if (creatorDirty.value) {
    return;
  }

  form.creator = resolveCreatorValue();
};

const resetForm = () => {
  Object.assign(form, createEmptyInvoiceFormState(), props.initialValues ?? {});
  creatorDirty.value = false;
  form.creator = resolveCreatorValue();
  form.recipient = form.recipient.trim();
  form.amount = form.amount.trim();
  form.text = form.text ?? '';

  if (!form.billingTokenAddress || !getTokenOptionByAddress(form.billingTokenAddress)) {
    form.billingTokenAddress = invoiceTokenOptions[0]?.address ?? '';
  }

  const preferredChainId = String(resolvedCreatorChainId.value);
  if (!form.recipientChainId || !isAllowedInvoiceChainId(Number.parseInt(form.recipientChainId, 10))) {
    form.recipientChainId = String(invoiceChainOptions[0]?.chainId ?? preferredChainId);
  }

  resetTouched();
  showErrors.value = false;
};

const markTouched = (field: InvoiceFieldKey) => {
  touched[field] = true;
};

const handleCancel = () => {
  emit('cancel');
  emit('update:modelValue', false);
};

const buildPayload = (): CreateInvoiceSubmitPayload | null => {
  if (!selectedToken.value || !selectedDestinationChain.value) {
    return null;
  }

  return {
    creator: form.creator.trim() as `0x${string}`,
    recipient: form.recipient.trim() as `0x${string}`,
    creatorRefundAddress: form.creator.trim() as `0x${string}`,
    recipientRefundAddress: form.recipient.trim() as `0x${string}`,
    creatorChainId: resolvedCreatorChainId.value,
    recipientChainId: selectedDestinationChain.value.chainId,
    billingTokenAddress: selectedToken.value.address,
    billingTokenSymbol: selectedToken.value.symbol,
    amount: normalizeInvoiceAmount(form.amount),
    amountInput: form.amount.trim(),
    text: form.text.trim()
  };
};

const handleSubmit = () => {
  showErrors.value = true;

  if (hasErrors.value) {
    return;
  }

  const payload = buildPayload();
  if (!payload) {
    return;
  }

  emit('submit', payload);
  emit('update:modelValue', false);
};

const handleBackdropClick = (event: MouseEvent) => {
  if (event.target === event.currentTarget) {
    handleCancel();
  }
};

const handleEscape = (event: KeyboardEvent) => {
  if (event.key === 'Escape') {
    handleCancel();
  }
};

watch(
  () => props.modelValue,
  (isOpen, _, onCleanup) => {
    if (!isOpen) {
      return;
    }

    resetForm();
    window.addEventListener('keydown', handleEscape);
    document.body.classList.add('overflow-hidden');

    onCleanup(() => {
      window.removeEventListener('keydown', handleEscape);
      document.body.classList.remove('overflow-hidden');
    });
  },
  { immediate: true }
);

watch(
  [() => props.initialValues, ssoAccount],
  () => {
    if (props.modelValue) {
      syncCreatorPrefill();
    }
  },
  { deep: true }
);

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleEscape);
  document.body.classList.remove('overflow-hidden');
});
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition duration-200 ease-out"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition duration-150 ease-in"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="modelValue"
        class="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/55 px-4 py-6 backdrop-blur-sm"
        @click="handleBackdropClick"
      >
        <Transition
          appear
          enter-active-class="transition duration-200 ease-out"
          enter-from-class="translate-y-4 scale-[0.98] opacity-0"
          enter-to-class="translate-y-0 scale-100 opacity-100"
          leave-active-class="transition duration-150 ease-in"
          leave-from-class="translate-y-0 scale-100 opacity-100"
          leave-to-class="translate-y-4 scale-[0.98] opacity-0"
        >
          <form
            class="enterprise-card relative w-full max-w-4xl overflow-hidden border border-slate-200 shadow-2xl"
            @submit.prevent="handleSubmit"
          >
            <div class="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-accent via-cyan-400 to-emerald-400"></div>

            <div class="flex items-start justify-between gap-6 border-b border-slate-100 px-6 py-5 sm:px-8">
              <div class="space-y-1">
                <p class="text-[10px] font-black uppercase tracking-[0.28em] text-slate-400">
                  Invoice workflow
                </p>
                <h2 class="text-2xl font-bold tracking-tight text-slate-900">
                  {{ title }}
                </h2>
                <p class="max-w-2xl text-sm text-slate-500">
                  {{ subtitle }}
                </p>
              </div>

              <button
                type="button"
                class="flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-slate-400 transition-colors hover:border-slate-300 hover:text-slate-700"
                @click="handleCancel"
              >
                <BaseIcon name="XMarkIcon" class="h-5 w-5" />
              </button>
            </div>

            <div class="grid gap-8 px-6 py-6 sm:px-8 lg:grid-cols-[1.6fr_1fr]">
              <div class="space-y-6">
                <div
                  v-if="showErrors && hasErrors"
                  class="rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-800"
                >
                  Please fix the highlighted fields before creating the invoice.
                </div>

                <div class="grid gap-4 md:grid-cols-2">
                  <label class="space-y-2">
                    <span class="text-xs font-bold uppercase tracking-widest text-slate-500">
                      Creator
                    </span>
                    <input
                      v-model="form.creator"
                      type="text"
                      inputmode="text"
                      autocomplete="off"
                      placeholder="0x..."
                      class="enterprise-input w-full rounded-2xl px-4 py-3"
                      :class="visibleError('creator') ? 'border-rose-300 bg-rose-50/60 focus:border-rose-400 focus:ring-rose-100' : ''"
                      @input="creatorDirty = true"
                      @blur="markTouched('creator')"
                    />
                    <p v-if="visibleError('creator')" class="text-xs font-medium text-rose-600">
                      {{ visibleError('creator') }}
                    </p>
                  </label>

                  <label class="space-y-2">
                    <span class="text-xs font-bold uppercase tracking-widest text-slate-500">
                      Recipient
                    </span>
                    <input
                      v-model="form.recipient"
                      type="text"
                      inputmode="text"
                      autocomplete="off"
                      placeholder="0x..."
                      class="enterprise-input w-full rounded-2xl px-4 py-3"
                      :class="visibleError('recipient') ? 'border-rose-300 bg-rose-50/60 focus:border-rose-400 focus:ring-rose-100' : ''"
                      @blur="markTouched('recipient')"
                    />
                    <p v-if="visibleError('recipient')" class="text-xs font-medium text-rose-600">
                      {{ visibleError('recipient') }}
                    </p>
                  </label>
                </div>

                <div class="grid gap-4 md:grid-cols-2">
                  <label class="space-y-2">
                    <span class="text-xs font-bold uppercase tracking-widest text-slate-500">
                      Amount
                    </span>
                    <input
                      v-model="form.amount"
                      type="text"
                      inputmode="decimal"
                      placeholder="0.00"
                      class="enterprise-input w-full rounded-2xl px-4 py-3 font-mono"
                      :class="visibleError('amount') ? 'border-rose-300 bg-rose-50/60 focus:border-rose-400 focus:ring-rose-100' : ''"
                      @blur="markTouched('amount')"
                    />
                    <p v-if="visibleError('amount')" class="text-xs font-medium text-rose-600">
                      {{ visibleError('amount') }}
                    </p>
                  </label>

                  <label class="space-y-2">
                    <span class="text-xs font-bold uppercase tracking-widest text-slate-500">
                      Destination chain
                    </span>
                    <select
                      v-model="form.recipientChainId"
                      class="enterprise-input w-full rounded-2xl px-4 py-3"
                      :class="visibleError('recipientChainId') ? 'border-rose-300 bg-rose-50/60 focus:border-rose-400 focus:ring-rose-100' : ''"
                      @blur="markTouched('recipientChainId')"
                    >
                      <option disabled value="">Select chain</option>
                      <option
                        v-for="chain in invoiceChainOptions"
                        :key="chain.chainId"
                        :value="String(chain.chainId)"
                      >
                        {{ chain.label }} ({{ chain.chainId }})
                      </option>
                    </select>
                    <p
                      v-if="visibleError('recipientChainId')"
                      class="text-xs font-medium text-rose-600"
                    >
                      {{ visibleError('recipientChainId') }}
                    </p>
                  </label>
                </div>

                <label class="block space-y-2">
                  <span class="text-xs font-bold uppercase tracking-widest text-slate-500">
                    Description
                  </span>
                  <textarea
                    v-model="form.text"
                    rows="5"
                    maxlength="280"
                    placeholder="Optional invoice description"
                    class="enterprise-input w-full rounded-[24px] px-4 py-3"
                    :class="visibleError('text') ? 'border-rose-300 bg-rose-50/60 focus:border-rose-400 focus:ring-rose-100' : ''"
                    @blur="markTouched('text')"
                  ></textarea>
                  <div class="flex items-start justify-between gap-4">
                    <p v-if="visibleError('text')" class="text-xs font-medium text-rose-600">
                      {{ visibleError('text') }}
                    </p>
                    <p class="ml-auto text-xs text-slate-400">
                      {{ form.text.length }}/280
                    </p>
                  </div>
                </label>
              </div>

              <aside class="space-y-4 rounded-[28px] border border-slate-100 bg-slate-50/70 p-5">
                <div class="flex items-center gap-3">
                  <div
                    class="flex h-11 w-11 items-center justify-center rounded-full bg-white border border-slate-100 text-slate-500 shadow-sm"
                  >
                    <BaseIcon name="ShieldCheckIcon" class="h-5 w-5" />
                  </div>
                  <div>
                    <p class="text-sm font-bold text-slate-900">Invoice settings</p>
                    <p class="text-xs text-slate-500">Fixed refund addresses, dynamic token selection.</p>
                  </div>
                </div>

                <div class="space-y-2">
                  <span class="text-xs font-bold uppercase tracking-widest text-slate-500">
                    Token
                  </span>
                  <select
                    v-model="form.billingTokenAddress"
                    class="enterprise-input w-full rounded-2xl px-4 py-3"
                    :class="visibleError('billingTokenAddress') ? 'border-rose-300 bg-rose-50/60 focus:border-rose-400 focus:ring-rose-100' : ''"
                    @blur="markTouched('billingTokenAddress')"
                  >
                    <option disabled value="">Select token</option>
                    <option
                      v-for="token in invoiceTokenOptions"
                      :key="`${token.address}-${token.chainId}`"
                      :value="token.address"
                    >
                      {{ token.label }} - {{ token.address.slice(0, 8) }}...{{ token.address.slice(-6) }}
                    </option>
                  </select>
                  <p
                    v-if="visibleError('billingTokenAddress')"
                    class="text-xs font-medium text-rose-600"
                  >
                    {{ visibleError('billingTokenAddress') }}
                  </p>
                </div>

                <div class="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
                  <div class="flex items-center justify-between gap-3">
                    <span class="text-xs font-bold uppercase tracking-widest text-slate-400">
                      Creator chain
                    </span>
                    <span class="text-sm font-semibold text-slate-900">
                      {{ resolvedCreatorChainId }}
                    </span>
                  </div>
                  <div class="flex items-center justify-between gap-3">
                    <span class="text-xs font-bold uppercase tracking-widest text-slate-400">
                      Refund addresses
                    </span>
                    <span class="text-xs font-medium text-slate-500 text-right">
                      Forced to match creator and recipient
                    </span>
                  </div>
                  <div v-if="selectedToken" class="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
                    Selected token: <span class="font-mono font-semibold text-slate-900">{{ selectedToken.symbol }}</span>
                    on chain {{ selectedToken.chainId }}
                  </div>
                  <div v-else class="rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700">
                    No deployed token is currently available in the frontend env.
                  </div>
                </div>

                <div class="rounded-2xl border border-slate-200 bg-white p-4">
                  <p class="text-xs font-bold uppercase tracking-widest text-slate-400">Payload preview</p>
                  <dl class="mt-3 space-y-3 text-sm">
                    <div class="flex items-start justify-between gap-4">
                      <dt class="text-slate-500">Creator refund</dt>
                      <dd class="max-w-[55%] break-all text-right font-mono text-slate-900">
                        {{ form.creator || '—' }}
                      </dd>
                    </div>
                    <div class="flex items-start justify-between gap-4">
                      <dt class="text-slate-500">Recipient refund</dt>
                      <dd class="max-w-[55%] break-all text-right font-mono text-slate-900">
                        {{ form.recipient || '—' }}
                      </dd>
                    </div>
                    <div class="flex items-start justify-between gap-4">
                      <dt class="text-slate-500">Destination chain</dt>
                      <dd class="max-w-[55%] break-all text-right font-mono text-slate-900">
                        {{ selectedDestinationChain?.chainId ?? '—' }}
                      </dd>
                    </div>
                  </dl>
                </div>
              </aside>
            </div>

            <div class="flex flex-col-reverse gap-3 border-t border-slate-100 px-6 py-5 sm:flex-row sm:items-center sm:justify-end sm:px-8">
              <button type="button" class="enterprise-button-secondary w-full sm:w-auto" @click="handleCancel">
                Cancel
              </button>
              <button
                type="submit"
                class="enterprise-button-primary w-full sm:w-auto disabled:cursor-not-allowed disabled:opacity-40"
                :disabled="!invoiceTokenOptions.length"
              >
                <BaseIcon name="PlusCircleIcon" class="h-5 w-5" />
                Create invoice
              </button>
            </div>
          </form>
        </Transition>
      </div>
    </Transition>
  </Teleport>
</template>
