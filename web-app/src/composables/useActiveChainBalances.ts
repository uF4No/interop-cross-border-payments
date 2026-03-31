import { type Address, formatUnits, getAddress, isAddress, parseAbi } from 'viem';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';

import { usePrividium } from './usePrividium';
import { useRpcClient } from './useRpcClient';
import { useSsoAccount } from './useSsoAccount';

type TokenSymbol = 'USDC' | 'SGD' | 'TBILL';

type ConfiguredToken = {
  symbol: TokenSymbol;
  address: Address;
};

export type ActiveChainBalanceRow = {
  asset: string;
  type: 'native' | 'token';
  balance: string;
  rawBalance: bigint;
  decimals: number;
  address?: Address;
};

const env = import.meta.env as Record<string, string | undefined>;
const TOKEN_SYMBOLS: TokenSymbol[] = ['USDC', 'SGD', 'TBILL'];
const AUTO_REFRESH_INTERVAL_MS = 120_000;
const MAX_AUTO_REFRESH_BACKOFF_MS = 5 * 60_000;
const erc20Abi = parseAbi([
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)'
]);
type RefreshReason = 'auto' | 'dependency' | 'manual';

function readTokenAddress(symbol: TokenSymbol, chainKey: 'A' | 'B'): Address | undefined {
  const candidates = [
    `VITE_TOKEN_${symbol}_ADDRESS_CHAIN_${chainKey}`,
    `VITE_${symbol}_TOKEN_ADDRESS_CHAIN_${chainKey}`,
    `VITE_TOKEN_${symbol}_ADDRESS`
  ] as const;

  for (const envKey of candidates) {
    const value = env[envKey]?.trim();
    if (value && isAddress(value)) {
      return getAddress(value);
    }
  }

  return undefined;
}

function getConfiguredTokens(chainKey: 'A' | 'B'): ConfiguredToken[] {
  return TOKEN_SYMBOLS.flatMap((symbol) => {
    const address = readTokenAddress(symbol, chainKey);
    return address ? [{ symbol, address }] : [];
  });
}

function addThousandsSeparators(value: string) {
  return value.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function formatTokenBalance(value: bigint, decimals: number) {
  const [whole, fraction = ''] = formatUnits(value, decimals).split('.');
  const trimmedFraction = fraction.slice(0, 6).replace(/0+$/g, '');
  const normalizedWhole = whole === '' ? '0' : addThousandsSeparators(whole);
  return trimmedFraction ? `${normalizedWhole}.${trimmedFraction}` : normalizedWhole;
}

function formatReadError(error: unknown) {
  if (!(error instanceof Error) || !error.message.trim()) {
    return 'Unable to load wallet balances.';
  }

  const firstLine = error.message.split('\n')[0]?.trim();
  return firstLine || 'Unable to load wallet balances.';
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function isRateLimitError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  return /\b429\b|too many requests|rate limit/i.test(error.message);
}

function areBalanceRowsEqual(
  left: readonly ActiveChainBalanceRow[],
  right: readonly ActiveChainBalanceRow[]
) {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((leftRow, index) => {
    const rightRow = right[index];
    return (
      leftRow.asset === rightRow.asset &&
      leftRow.type === rightRow.type &&
      leftRow.balance === rightRow.balance &&
      leftRow.rawBalance === rightRow.rawBalance &&
      leftRow.decimals === rightRow.decimals &&
      leftRow.address === rightRow.address
    );
  });
}

export function useActiveChainBalances() {
  const rpcClient = useRpcClient();
  const { account } = useSsoAccount();
  const { getChain, selectedChainKey } = usePrividium();

  const rows = ref<ActiveChainBalanceRow[]>([]);
  const isLoading = ref(false);
  const isRefreshing = ref(false);
  const error = ref('');
  const activeRefreshReason = ref<RefreshReason | null>(null);
  const lastUpdatedAt = ref<number | null>(null);
  let requestId = 0;
  let queuedRefreshReason: RefreshReason | null = null;
  let autoRefreshTimer: number | null = null;
  let nextAutoRefreshDelayMs = AUTO_REFRESH_INTERVAL_MS;

  const nativeSymbol = computed(() => getChain().nativeCurrency?.symbol || 'ETH');

  const loadBalanceRows = async (userAddress: Address, currentChainKey: 'A' | 'B') => {
    const client = rpcClient.value;
    const configuredTokens = getConfiguredTokens(currentChainKey);

    const nativeBalancePromise = client.getBalance({ address: userAddress });
    const tokenRowsPromise = Promise.all(
      configuredTokens.map(async (token): Promise<ActiveChainBalanceRow> => {
        const [rawBalance, decimals] = await Promise.all([
          client.readContract({
            address: token.address,
            abi: erc20Abi,
            functionName: 'balanceOf',
            args: [userAddress],
            account: userAddress
          }),
          client.readContract({
            address: token.address,
            abi: erc20Abi,
            functionName: 'decimals',
            account: userAddress
          })
        ]);

        return {
          asset: token.symbol,
          type: 'token',
          balance: formatTokenBalance(rawBalance, decimals),
          rawBalance,
          decimals,
          address: token.address
        };
      })
    );

    const [nativeBalance, tokenRows] = await Promise.all([nativeBalancePromise, tokenRowsPromise]);

    return [
      {
        asset: nativeSymbol.value,
        type: 'native' as const,
        balance: formatTokenBalance(nativeBalance, 18),
        rawBalance: nativeBalance,
        decimals: 18
      },
      ...tokenRows
    ];
  };

  const scheduleQueuedRefresh = () => {
    if (!queuedRefreshReason) {
      return;
    }

    const nextReason = queuedRefreshReason;
    queuedRefreshReason = null;
    void runRefresh(nextReason);
  };

  const clearAutoRefreshTimer = () => {
    if (autoRefreshTimer !== null) {
      window.clearTimeout(autoRefreshTimer);
      autoRefreshTimer = null;
    }
  };

  const scheduleAutoRefresh = () => {
    clearAutoRefreshTimer();

    autoRefreshTimer = window.setTimeout(() => {
      if (document.hidden) {
        scheduleAutoRefresh();
        return;
      }

      void runRefresh('auto');
    }, nextAutoRefreshDelayMs);
  };

  const resetAutoRefreshDelay = () => {
    nextAutoRefreshDelayMs = AUTO_REFRESH_INTERVAL_MS;
  };

  const increaseAutoRefreshDelay = () => {
    nextAutoRefreshDelayMs = Math.min(nextAutoRefreshDelayMs * 2, MAX_AUTO_REFRESH_BACKOFF_MS);
  };

  const runRefresh = async (reason: RefreshReason) => {
    if (isLoading.value || isRefreshing.value) {
      queuedRefreshReason =
        queuedRefreshReason === 'manual' || reason !== 'manual'
          ? (queuedRefreshReason ?? reason)
          : reason;
      return;
    }

    requestId += 1;
    const activeRequestId = requestId;

    if (!account.value || !rpcClient.value) {
      rows.value = [];
      error.value = '';
      isLoading.value = false;
      isRefreshing.value = false;
      activeRefreshReason.value = null;
      lastUpdatedAt.value = null;
      resetAutoRefreshDelay();
      if (reason === 'auto') {
        scheduleAutoRefresh();
      }
      return;
    }

    const userAddress = account.value;
    const currentChainKey = selectedChainKey.value;
    const previousRows = rows.value;

    error.value = '';
    const shouldUseBackgroundRefresh = reason !== 'dependency' && previousRows.length > 0;
    isLoading.value = !shouldUseBackgroundRefresh;
    isRefreshing.value = shouldUseBackgroundRefresh;
    activeRefreshReason.value = reason;

    try {
      const nextRows = await loadBalanceRows(userAddress, currentChainKey);
      if (activeRequestId !== requestId) {
        return;
      }

      if (!areBalanceRowsEqual(previousRows, nextRows)) {
        rows.value = nextRows;
      }
      lastUpdatedAt.value = Date.now();
      resetAutoRefreshDelay();
    } catch (initialError) {
      try {
        await sleep(400);
        const nextRows = await loadBalanceRows(userAddress, currentChainKey);
        if (activeRequestId !== requestId) {
          return;
        }

        if (!areBalanceRowsEqual(previousRows, nextRows)) {
          rows.value = nextRows;
        }
        lastUpdatedAt.value = Date.now();
        resetAutoRefreshDelay();
      } catch (refreshError) {
        if (activeRequestId !== requestId) {
          return;
        }

        rows.value = previousRows;
        error.value = formatReadError(refreshError ?? initialError);
        if (reason === 'auto' && isRateLimitError(refreshError ?? initialError)) {
          increaseAutoRefreshDelay();
        }
      }
    } finally {
      if (activeRequestId === requestId) {
        activeRefreshReason.value = null;
        isLoading.value = false;
        isRefreshing.value = false;
        scheduleQueuedRefresh();
        if (reason === 'auto') {
          scheduleAutoRefresh();
        }
      }
    }
  };

  const refresh = () => runRefresh('manual');

  watch(
    [account, rpcClient, selectedChainKey],
    () => {
      void runRefresh('dependency');
    },
    { immediate: true }
  );

  onMounted(() => {
    scheduleAutoRefresh();
  });

  onBeforeUnmount(() => {
    clearAutoRefreshTimer();
  });

  return {
    rows: computed(() => rows.value),
    isLoading: computed(() => isLoading.value),
    isRefreshing: computed(() => isRefreshing.value),
    isManualRefreshing: computed(
      () => activeRefreshReason.value === 'manual' && (isLoading.value || isRefreshing.value)
    ),
    isPolling: computed(
      () => activeRefreshReason.value === 'auto' && (isLoading.value || isRefreshing.value)
    ),
    lastUpdatedAt: computed(() => lastUpdatedAt.value),
    refreshIntervalMs: AUTO_REFRESH_INTERVAL_MS,
    error: computed(() => error.value),
    refresh
  };
}
