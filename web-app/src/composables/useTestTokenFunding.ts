import { computed, ref } from 'vue';
import type { BackendServiceResponse } from '../types/invoices';
import { getBackendUrl } from '../utils/backend';
import { requestBalancesRefresh } from './useDashboardRefresh';
import { usePrividium } from './usePrividium';
import { useSsoAccount } from './useSsoAccount';

type TokenFundingJobStatus = 'queued' | 'running' | 'succeeded' | 'failed';
type TokenFundingNoticeTone = 'info' | 'success' | 'error';

const FUND_TOKENS_POLL_INTERVAL_MS = 15_000;
const FUND_TOKENS_TIMEOUT_MS = 300_000;
const MAX_ERROR_MESSAGE_LENGTH = 220;

const isTokenFunding = ref(false);
const tokenFundingNotice = ref('');
const tokenFundingNoticeTone = ref<TokenFundingNoticeTone>('info');

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const toStringValue = (value: unknown): string | null => {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'bigint') return value.toString();
  return null;
};

const isServiceResponse = <T>(value: unknown): value is BackendServiceResponse<T> => {
  if (!isRecord(value)) return false;
  return (
    typeof value.success === 'boolean' &&
    typeof value.message === 'string' &&
    typeof value.statusCode === 'number'
  );
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

const truncateError = (message: string, maxLength = MAX_ERROR_MESSAGE_LENGTH) => {
  if (message.length <= maxLength) return message;
  return `${message.slice(0, maxLength - 1).trimEnd()}...`;
};

const formatFundingError = (
  error: unknown,
  fallback = 'Failed to request demo funds.'
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

export function useTestTokenFunding() {
  const { selectedChainKey } = usePrividium();
  const { account: ssoAccount } = useSsoAccount();

  const sourceChainLabel = computed(() => `Chain ${selectedChainKey.value}`);
  const tokenFundingNoticeClass = computed(() => {
    if (tokenFundingNoticeTone.value === 'success') {
      return 'border-emerald-100 bg-emerald-50 text-emerald-800';
    }
    if (tokenFundingNoticeTone.value === 'error') {
      return 'border-red-100 bg-red-50 text-red-800';
    }
    return 'border-sky-100 bg-sky-50 text-sky-800';
  });

  const fundTestTokens = async () => {
    if (!ssoAccount.value || isTokenFunding.value) {
      return;
    }

    isTokenFunding.value = true;
    tokenFundingNoticeTone.value = 'info';
    tokenFundingNotice.value = `Requesting demo funds on ${sourceChainLabel.value}.`;

    try {
      const response = await fetch(getBackendUrl('/fund-tokens'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify({
          chainKey: selectedChainKey.value,
          accountAddress: ssoAccount.value
        })
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
        tokenFundingNotice.value = `Demo funding finished with errors for ${immediateFailedTokens.join(', ')}. Check backend logs for details.`;
        requestBalancesRefresh();
        return;
      }

      if (!jobId || (immediateStatus !== 'queued' && immediateStatus !== 'running')) {
        tokenFundingNoticeTone.value = 'success';
        tokenFundingNotice.value = 'Demo funds completed.';
        requestBalancesRefresh();
        return;
      }

      tokenFundingNoticeTone.value = 'info';
      tokenFundingNotice.value = `Demo funding queued (job ${jobId.slice(0, 8)}). Processing...`;

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
          tokenFundingNotice.value = `Demo funding ${status} (job ${jobId.slice(0, 8)}).`;
          continue;
        }

        const failedTokens = listFailedTokens(statusObject.tokenMintResults);
        if (status === 'failed') {
          const detail = toStringValue(statusObject.error);
          tokenFundingNoticeTone.value = 'error';
          tokenFundingNotice.value = failedTokens.length
            ? `Demo funding finished with errors for ${failedTokens.join(', ')}. Check backend logs for details.`
            : detail || 'Demo funding failed. Check backend logs for details.';
        } else if (failedTokens.length > 0) {
          tokenFundingNoticeTone.value = 'error';
          tokenFundingNotice.value = `Demo funding finished with errors for ${failedTokens.join(', ')}. Check backend logs for details.`;
        } else {
          tokenFundingNoticeTone.value = 'success';
          tokenFundingNotice.value = 'Demo funding completed.';
        }

        requestBalancesRefresh();
        return;
      }

      tokenFundingNoticeTone.value = 'error';
      tokenFundingNotice.value = `Demo funding is still ${lastSeenStatus} after ${Math.floor(FUND_TOKENS_TIMEOUT_MS / 1000)}s. Check backend logs and retry refresh later.`;
    } catch (error) {
      tokenFundingNoticeTone.value = 'error';
      tokenFundingNotice.value = formatFundingError(error);
    } finally {
      isTokenFunding.value = false;
    }
  };

  return {
    fundTestTokens,
    isTokenFunding,
    tokenFundingNotice,
    tokenFundingNoticeClass,
    tokenFundingNoticeTone
  };
}
