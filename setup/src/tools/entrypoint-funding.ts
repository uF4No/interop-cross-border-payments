import {
  type Address,
  type Hex,
  createPublicClient,
  createWalletClient,
  defineChain,
  formatEther,
  http
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

export type EntrypointFundingChain = {
  label: 'A' | 'B';
  chainId: number;
  rpcUrl: string;
  authToken?: string;
  entryPoint: Address;
};

export type EntrypointFundingResult = {
  label: 'A' | 'B';
  entryPoint: Address;
  funded: boolean;
  balanceBeforeWei: bigint;
  balanceAfterWei: bigint;
  topUpWei: bigint;
  txHash?: Hex;
};

export type EnsureEntrypointsFundedArgs = {
  executorPrivateKey: `0x${string}`;
  minimumBalanceWei: bigint;
  targetBalanceWei: bigint;
  chains: EntrypointFundingChain[];
};

function createTransport(rpcUrl: string, authToken?: string) {
  if (!authToken) {
    return http(rpcUrl);
  }

  return http(rpcUrl, {
    fetchFn: async (url, init) => {
      const headers = new Headers(init?.headers);
      headers.set('Authorization', `Bearer ${authToken}`);
      return fetch(url, { ...init, headers });
    }
  });
}

function resolveTargetBalance(minimumBalanceWei: bigint, targetBalanceWei: bigint) {
  return targetBalanceWei >= minimumBalanceWei ? targetBalanceWei : minimumBalanceWei;
}

export async function ensureEntrypointsFunded(
  args: EnsureEntrypointsFundedArgs
): Promise<EntrypointFundingResult[]> {
  const account = privateKeyToAccount(args.executorPrivateKey);
  const resolvedTargetBalance = resolveTargetBalance(args.minimumBalanceWei, args.targetBalanceWei);

  const results: EntrypointFundingResult[] = [];

  for (const chainConfig of args.chains) {
    const chain = defineChain({
      id: chainConfig.chainId,
      name: `Prividium Chain ${chainConfig.label}`,
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: {
        default: { http: [chainConfig.rpcUrl] },
        public: { http: [chainConfig.rpcUrl] }
      }
    });

    const transport = createTransport(chainConfig.rpcUrl, chainConfig.authToken);

    const publicClient = createPublicClient({ chain, transport });
    const walletClient = createWalletClient({ chain, transport, account });

    const balanceBeforeWei = await publicClient.getBalance({ address: chainConfig.entryPoint });
    if (balanceBeforeWei >= args.minimumBalanceWei) {
      results.push({
        label: chainConfig.label,
        entryPoint: chainConfig.entryPoint,
        funded: false,
        balanceBeforeWei,
        balanceAfterWei: balanceBeforeWei,
        topUpWei: 0n
      });
      continue;
    }

    const topUpWei = resolvedTargetBalance > balanceBeforeWei ? resolvedTargetBalance - balanceBeforeWei : 0n;

    if (topUpWei === 0n) {
      results.push({
        label: chainConfig.label,
        entryPoint: chainConfig.entryPoint,
        funded: false,
        balanceBeforeWei,
        balanceAfterWei: balanceBeforeWei,
        topUpWei
      });
      continue;
    }

    const txHash = await walletClient.sendTransaction({
      account,
      chain: undefined,
      to: chainConfig.entryPoint,
      value: topUpWei
    });
    await publicClient.waitForTransactionReceipt({ hash: txHash });

    const balanceAfterWei = await publicClient.getBalance({ address: chainConfig.entryPoint });

    results.push({
      label: chainConfig.label,
      entryPoint: chainConfig.entryPoint,
      funded: true,
      balanceBeforeWei,
      balanceAfterWei,
      topUpWei,
      txHash
    });
  }

  return results;
}

export function formatFundingSummary(result: EntrypointFundingResult) {
  return [
    `Chain ${result.label} EntryPoint ${result.entryPoint}`,
    `before=${formatEther(result.balanceBeforeWei)} ETH`,
    `after=${formatEther(result.balanceAfterWei)} ETH`,
    `topUp=${formatEther(result.topUpWei)} ETH`,
    `funded=${result.funded ? 'yes' : 'no'}`,
    result.txHash ? `tx=${result.txHash}` : undefined
  ]
    .filter(Boolean)
    .join(' | ');
}
