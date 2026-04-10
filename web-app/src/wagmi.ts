import { metaMask } from '@wagmi/connectors';
import { http, createConfig } from '@wagmi/core';
import { defineChain } from 'viem';
import { getExplorerBaseUrl } from './utils/explorer';

export const prividiumChain = defineChain({
  id: Number.parseInt(import.meta.env.VITE_PRIVIDIUM_CHAIN_ID),
  name: import.meta.env.VITE_PRIVIDIUM_CHAIN_NAME,
  nativeCurrency: {
    name: import.meta.env.VITE_PRIVIDIUM_NATIVE_CURRENCY_SYMBOL,
    symbol: import.meta.env.VITE_PRIVIDIUM_NATIVE_CURRENCY_SYMBOL,
    decimals: 18
  },
  rpcUrls: {
    default: {
      http: [import.meta.env.VITE_PRIVIDIUM_RPC_URL]
    },
    public: {
      http: [import.meta.env.VITE_PRIVIDIUM_RPC_URL]
    }
  },
  blockExplorers: {
    default: {
      name: 'Explorer',
      url: getExplorerBaseUrl('A') ?? 'https://explorer.zksync.io'
    }
  },
  testnet: true
});

export function createWagmiConfig(walletRpcUrl?: string) {
  const rpcUrl = walletRpcUrl || import.meta.env.VITE_PRIVIDIUM_RPC_URL;

  return createConfig({
    chains: [prividiumChain],
    connectors: [metaMask()],
    transports: {
      [prividiumChain.id]: http(rpcUrl)
    }
  });
}

export const config = createWagmiConfig();
