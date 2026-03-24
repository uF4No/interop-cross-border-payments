import { computed, onMounted, ref } from 'vue';

import { getBackendUrl } from '../utils/backend';
import type {
  BackendServiceResponse,
  InvoiceRecord,
  InvoiceResponseObject
} from '../types/invoices';

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
  const creator = toStringValue(value.creator);
  const recipient = toStringValue(value.recipient);
  const billingToken = toStringValue(value.billingToken);
  const amount = toStringValue(value.amount);
  const status = toStringValue(value.status);
  const creatorChainId = toNumberValue(value.creatorChainId);
  const recipientChainId = toNumberValue(value.recipientChainId);
  const text = toStringValue(value.text);

  return Boolean(
    id &&
      creator &&
      recipient &&
      billingToken &&
      amount &&
      status &&
      creatorChainId !== null &&
      recipientChainId !== null &&
      text !== null
  );
};

const isInvoiceResponseObject = (value: unknown): value is InvoiceResponseObject => {
  if (!isRecord(value)) return false;
  if (!Array.isArray(value.invoices)) return false;

  return value.invoices.every(isInvoiceRecord);
};

const isServiceResponse = <T>(value: unknown): value is BackendServiceResponse<T> => {
  if (!isRecord(value)) return false;
  return (
    typeof value.success === 'boolean' &&
    typeof value.message === 'string' &&
    typeof value.statusCode === 'number'
  );
};

const formatFetchError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  return 'Failed to fetch invoices.';
};

export function useInvoices() {
  const invoices = ref<InvoiceRecord[]>([]);
  const isLoading = ref(false);
  const errorMessage = ref('');
  const loaded = ref(false);

  const hasInvoices = computed(() => invoices.value.length > 0);
  const isEmpty = computed(() => loaded.value && !isLoading.value && invoices.value.length === 0);

  const loadInvoices = async () => {
    isLoading.value = true;
    errorMessage.value = '';

    try {
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

      const responseObject = payload.responseObject;
      if (!isInvoiceResponseObject(responseObject)) {
        throw new Error('Unexpected invoice payload.');
      }

      invoices.value = responseObject.invoices;
      loaded.value = true;
    } catch (error) {
      errorMessage.value = formatFetchError(error);
      invoices.value = [];
      loaded.value = true;
    } finally {
      isLoading.value = false;
    }
  };

  onMounted(() => {
    void loadInvoices();
  });

  return {
    errorMessage,
    hasInvoices,
    isEmpty,
    isLoading,
    invoices,
    loadInvoices
  };
}
