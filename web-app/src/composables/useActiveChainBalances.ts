import { type Address, formatUnits, getAddress, isAddress, parseAbi } from 'viem';
import { computed, ref, watch } from 'vue';

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
const erc20Abi = parseAbi([
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)'
]);

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

export function useActiveChainBalances() {
  const rpcClient = useRpcClient();
  const { account } = useSsoAccount();
  const { getChain, selectedChainKey } = usePrividium();

  const rows = ref<ActiveChainBalanceRow[]>([]);
  const isLoading = ref(false);
  const error = ref('');
  let requestId = 0;

  const nativeSymbol = computed(() => getChain().nativeCurrency?.symbol || 'ETH');

  const refresh = async () => {
    requestId += 1;
    const activeRequestId = requestId;

    if (!account.value || !rpcClient.value) {
      rows.value = [];
      error.value = '';
      isLoading.value = false;
      return;
    }

    const userAddress = account.value;
    const client = rpcClient.value;
    const currentChainKey = selectedChainKey.value;
    const configuredTokens = getConfiguredTokens(currentChainKey);

    rows.value = [];
    error.value = '';
    isLoading.value = true;

    try {
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
      if (activeRequestId !== requestId) {
        return;
      }

      rows.value = [
        {
          asset: nativeSymbol.value,
          type: 'native',
          balance: formatTokenBalance(nativeBalance, 18),
          rawBalance: nativeBalance,
          decimals: 18
        },
        ...tokenRows
      ];
    } catch (refreshError) {
      if (activeRequestId !== requestId) {
        return;
      }

      rows.value = [];
      error.value = formatReadError(refreshError);
    } finally {
      if (activeRequestId === requestId) {
        isLoading.value = false;
      }
    }
  };

  watch([account, rpcClient, selectedChainKey], () => {
    void refresh();
  }, { immediate: true });

  return {
    rows: computed(() => rows.value),
    isLoading: computed(() => isLoading.value),
    error: computed(() => error.value),
    refresh
  };
}
