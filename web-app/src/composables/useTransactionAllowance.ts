import type { Address, Hex } from 'viem';
import { usePrividium } from './usePrividium';

export interface EnableTransactionAllowanceParams {
  walletAddress: Address;
  contractAddress: Address;
  nonce: number;
  calldata: Hex;
}

export function useTransactionAllowance() {
  const { enableWalletToken } = usePrividium();

  const enableTransactionAllowance = async (
    params: EnableTransactionAllowanceParams
  ): Promise<void> => {
    try {
      const response = await enableWalletToken({
        walletAddress: params.walletAddress,
        contractAddress: params.contractAddress,
        nonce: params.nonce,
        calldata: params.calldata
      });

      console.log('Transaction allowance enabled:', response);
    } catch (error) {
      console.error('Failed to enable transaction allowance:', error);
      throw new Error(
        `Failed to enable transaction allowance: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  };

  return {
    enableTransactionAllowance
  };
}
