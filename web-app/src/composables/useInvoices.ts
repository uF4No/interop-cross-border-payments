import { computed, onMounted, ref, watch } from 'vue';

import { usePrividium } from './usePrividium';
import { useSsoAccount } from './useSsoAccount';
import { getBackendUrl } from '../utils/backend';
import type {
  BackendServiceResponse,
  InvoiceRecord,
  InvoiceResponseObject,
  InvoiceSourceTag,
  InvoiceView
} from '../types/invoices';

const DEFAULT_VIEWS: InvoiceView[] = ['all', 'created', 'received'];
const env = import.meta.env as Record<string, string | undefined>;

type InvoiceTargetChainFilter = 'all' | number;

type InvoiceTargetChainOption = {
  key: string;
  value: InvoiceTargetChainFilter;
  label: string;
  count: number;
};

const readConfiguredChainId = (...keys: string[]) => {
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
    [readConfiguredChainId('VITE_CHAIN_A_CHAIN_ID', 'VITE_PRIVIDIUM_CHAIN_A_ID'), 'Chain A'],
    [readConfiguredChainId('VITE_CHAIN_B_CHAIN_ID', 'VITE_PRIVIDIUM_CHAIN_B_ID'), 'Chain B']
  ].filter((entry): entry is [number, string] => entry[0] !== null)
);

const formatTargetChainLabel = (chainId: number) =>
  configuredChainLabels.get(chainId) ?? `Chain ${chainId}`;

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

const isInvoiceView = (value: unknown): value is InvoiceView =>
  value === 'all' || value === 'created' || value === 'received';

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
  const sourceTags = value.sourceTags;

  return Boolean(
    id &&
      creator &&
      recipient &&
      billingToken &&
      amount &&
      status &&
      creatorChainId !== null &&
      recipientChainId !== null &&
      text !== null &&
      Array.isArray(sourceTags) &&
      sourceTags.every(isInvoiceSourceTag)
  );
};

const isInvoiceResponseObject = (value: unknown): value is InvoiceResponseObject => {
  if (!isRecord(value)) return false;
  if (!Array.isArray(value.invoices)) return false;
  if (
    value.availableViews !== undefined &&
    (!Array.isArray(value.availableViews) || !value.availableViews.every(isInvoiceView))
  ) {
    return false;
  }
  if (value.countsByView !== undefined) {
    if (!isRecord(value.countsByView)) return false;
    for (const view of DEFAULT_VIEWS) {
      if (typeof value.countsByView[view] !== 'number') {
        return false;
      }
    }
  }

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
  const { getChain } = usePrividium();
  const { account } = useSsoAccount();
  const allInvoices = ref<InvoiceRecord[]>([]);
  const availableViews = ref<InvoiceView[]>([...DEFAULT_VIEWS]);
  const selectedView = ref<InvoiceView>('all');
  const activeChainId = computed(() => Number(getChain().id));
  const selectedTargetChainId = ref<InvoiceTargetChainFilter>(activeChainId.value);
  const countsByView = ref<Record<InvoiceView, number>>({
    all: 0,
    created: 0,
    received: 0
  });
  const isLoading = ref(false);
  const errorMessage = ref('');
  const loaded = ref(false);

  const relationshipFilteredInvoices = computed(() => {
    if (selectedView.value === 'all') {
      return allInvoices.value;
    }

    const sourceTag: InvoiceSourceTag = selectedView.value === 'created' ? 'created' : 'pending';
    return allInvoices.value.filter((invoice) => invoice.sourceTags.includes(sourceTag));
  });
  const targetChainOptions = computed<InvoiceTargetChainOption[]>(() => {
    const counts = new Map<number, number>();
    for (const invoice of relationshipFilteredInvoices.value) {
      counts.set(invoice.recipientChainId, (counts.get(invoice.recipientChainId) ?? 0) + 1);
    }

    const chainIds = new Set<number>(counts.keys());
    if (Number.isFinite(activeChainId.value) && activeChainId.value > 0) {
      chainIds.add(activeChainId.value);
    }

    return [
      {
        key: 'all',
        value: 'all',
        label: 'All targets',
        count: relationshipFilteredInvoices.value.length
      },
      ...[...chainIds]
        .sort((left, right) => left - right)
        .map((chainId) => ({
          key: String(chainId),
          value: chainId,
          label: formatTargetChainLabel(chainId),
          count: counts.get(chainId) ?? 0
        }))
    ];
  });
  const selectedTargetChainLabel = computed(() => {
    const selectedOption = targetChainOptions.value.find(
      (option) => option.value === selectedTargetChainId.value
    );
    return selectedOption?.label ?? 'Selected target';
  });
  const invoices = computed(() => {
    if (selectedTargetChainId.value === 'all') {
      return relationshipFilteredInvoices.value;
    }

    return relationshipFilteredInvoices.value.filter(
      (invoice) => invoice.recipientChainId === selectedTargetChainId.value
    );
  });
  const hasInvoices = computed(() => invoices.value.length > 0);
  const isEmpty = computed(() => loaded.value && !isLoading.value && invoices.value.length === 0);
  const totalInvoices = computed(() => invoices.value.length);

  const setSelectedView = (view: InvoiceView) => {
    selectedView.value = view;
  };

  const setSelectedTargetChainId = (chainId: InvoiceTargetChainFilter) => {
    selectedTargetChainId.value = chainId;
  };

  const loadInvoices = async () => {
    isLoading.value = true;
    errorMessage.value = '';

    try {
      const response = await fetch(getBackendUrl('/invoices'), {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          view: 'all',
          ...(account.value ? { accountAddress: account.value } : {})
        })
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

      allInvoices.value = responseObject.invoices;
      availableViews.value =
        responseObject.availableViews && responseObject.availableViews.length > 0
          ? responseObject.availableViews
          : [...DEFAULT_VIEWS];
      countsByView.value = responseObject.countsByView ?? {
        all: responseObject.invoices.length,
        created: responseObject.invoices.filter((invoice) => invoice.sourceTags.includes('created'))
          .length,
        received: responseObject.invoices.filter((invoice) => invoice.sourceTags.includes('pending'))
          .length
      };
      if (!availableViews.value.includes(selectedView.value)) {
        selectedView.value = 'all';
      }
      loaded.value = true;
    } catch (error) {
      errorMessage.value = formatFetchError(error);
      allInvoices.value = [];
      availableViews.value = [...DEFAULT_VIEWS];
      countsByView.value = {
        all: 0,
        created: 0,
        received: 0
      };
      loaded.value = true;
    } finally {
      isLoading.value = false;
    }
  };

  onMounted(() => {
    void loadInvoices();
  });

  watch(account, () => {
    void loadInvoices();
  });

  watch(activeChainId, (chainId) => {
    if (Number.isFinite(chainId) && chainId > 0) {
      selectedTargetChainId.value = chainId;
    }
  });

  return {
    availableViews,
    countsByView,
    errorMessage,
    hasInvoices,
    isEmpty,
    isLoading,
    invoices,
    selectedView,
    selectedTargetChainId,
    selectedTargetChainLabel,
    setSelectedTargetChainId,
    setSelectedView,
    targetChainOptions,
    totalInvoices,
    loadInvoices
  };
}
