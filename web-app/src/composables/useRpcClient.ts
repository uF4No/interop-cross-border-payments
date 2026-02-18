import { type Chain, type Transport, createPublicClient } from 'viem';
import { computed } from 'vue';
import { usePrividium } from './usePrividium';

const client = computed(() => {
  const { getTransport, getChain } = usePrividium();

  return createPublicClient({
    chain: getChain() as unknown as Chain, // viem version conflict
    transport: getTransport() as unknown as Transport
  });
});

export function useRpcClient() {
  return client;
}
