import type { Address, Hex, PublicClient } from 'viem';

import type { BackendServiceResponse } from '@/types/invoices';
import { getBackendUrl } from '@/utils/backend';

export type BundlerUserOpV08 = {
  sender: `0x${string}`;
  nonce: `0x${string}`;
  factory: `0x${string}` | null;
  factoryData: `0x${string}` | null;
  callData: `0x${string}`;
  callGasLimit: `0x${string}`;
  verificationGasLimit: `0x${string}`;
  preVerificationGas: `0x${string}`;
  maxFeePerGas: `0x${string}`;
  maxPriorityFeePerGas: `0x${string}`;
  paymaster: `0x${string}` | null;
  paymasterVerificationGasLimit: `0x${string}` | null;
  paymasterPostOpGasLimit: `0x${string}` | null;
  paymasterData: `0x${string}` | null;
  signature: `0x${string}`;
};

type UserOpReceipt = {
  success: boolean;
  receipt: {
    transactionHash: `0x${string}`;
  };
};

type DirectHandleOpsResponse = {
  chainId: number;
  txHash: `0x${string}`;
  userOpHash: `0x${string}`;
  receiptStatus: 'success' | 'reverted';
  beneficiary: `0x${string}`;
  executor: `0x${string}`;
  bundleHash?: `0x${string}`;
  relayQueued: boolean;
};

export type UserOpSubmissionResult = {
  txHash: Hex;
  source: 'bundler' | 'direct';
  userOpHash?: Hex;
  bundleHash?: Hex;
  relayQueued?: boolean;
};

type RpcRequestArgs = { method: string; params?: unknown[] };

const USER_OP_RECEIPT_POLL_ATTEMPTS = 30;
const USER_OP_RECEIPT_POLL_DELAY_MS = 2000;
const LOCAL_FALLBACK_RECEIPT_POLL_ATTEMPTS = 2;
const LOCAL_FALLBACK_RECEIPT_POLL_DELAY_MS = 1500;
const LOCAL_BACKEND_HOSTS = new Set(['localhost', '127.0.0.1']);

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function canUseDirectFallback() {
  const baseUrl = import.meta.env.VITE_BACKEND_URL?.trim();
  if (!baseUrl) {
    return false;
  }

  try {
    const parsed = new URL(baseUrl);
    return LOCAL_BACKEND_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

function formatErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  return fallback;
}

async function pollUserOpReceipt(
  rpcRequest: (args: RpcRequestArgs) => Promise<unknown>,
  userOpHash: `0x${string}`,
  options?: {
    attempts?: number;
    delayMs?: number;
  }
) {
  const attempts = options?.attempts ?? USER_OP_RECEIPT_POLL_ATTEMPTS;
  const delayMs = options?.delayMs ?? USER_OP_RECEIPT_POLL_DELAY_MS;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await sleep(delayMs);

    const receiptResult = await rpcRequest({
      method: 'eth_getUserOperationReceipt',
      params: [userOpHash]
    });

    if (receiptResult) {
      return receiptResult as UserOpReceipt;
    }
  }

  return null;
}

async function submitDirectHandleOpsFallback(params: {
  chainId: number;
  entryPoint: Address;
  userOp: BundlerUserOpV08;
}): Promise<UserOpSubmissionResult> {
  const response = await fetch(getBackendUrl('/userops/direct-handle-ops'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify(params)
  });

  const payload: BackendServiceResponse<DirectHandleOpsResponse> | null = await response
    .json()
    .catch(() => null);

  if (!response.ok || !payload?.success || !payload.responseObject) {
    const serverMessage =
      payload?.message || `Direct handleOps fallback failed with status ${response.status}`;
    throw new Error(serverMessage);
  }

  return {
    txHash: payload.responseObject.txHash,
    source: 'direct',
    userOpHash: payload.responseObject.userOpHash,
    bundleHash: payload.responseObject.bundleHash,
    relayQueued: payload.responseObject.relayQueued
  };
}

export async function submitUserOpWithFallback(params: {
  readClient: PublicClient;
  chainId: number;
  entryPoint: Address;
  userOp: BundlerUserOpV08;
}): Promise<UserOpSubmissionResult> {
  const rpcRequest = params.readClient.request as unknown as (
    args: RpcRequestArgs
  ) => Promise<unknown>;

  let primaryError: Error | null = null;
  const directFallbackEnabled = canUseDirectFallback();

  try {
    const userOpHashFromBundler = (await rpcRequest({
      method: 'eth_sendUserOperation',
      params: [params.userOp, params.entryPoint]
    })) as `0x${string}`;

    const receipt = await pollUserOpReceipt(
      rpcRequest,
      userOpHashFromBundler,
      directFallbackEnabled
        ? {
            attempts: LOCAL_FALLBACK_RECEIPT_POLL_ATTEMPTS,
            delayMs: LOCAL_FALLBACK_RECEIPT_POLL_DELAY_MS
          }
        : undefined
    );
    if (!receipt) {
      throw new Error('Transaction timeout - could not get receipt');
    }

    if (!receipt.success) {
      throw new Error('Transaction failed');
    }

    return {
      txHash: receipt.receipt.transactionHash,
      source: 'bundler',
      userOpHash: userOpHashFromBundler
    };
  } catch (error) {
    primaryError = error instanceof Error ? error : new Error('UserOperation submission failed');
  }

  if (!directFallbackEnabled) {
    throw primaryError;
  }

  console.warn(
    '[userop] Bundler path failed, attempting direct handleOps fallback:',
    primaryError.message
  );

  try {
    return await submitDirectHandleOpsFallback({
      chainId: params.chainId,
      entryPoint: params.entryPoint,
      userOp: params.userOp
    });
  } catch (fallbackError) {
    const primaryMessage = formatErrorMessage(primaryError, 'Bundler submission failed');
    const fallbackMessage = formatErrorMessage(fallbackError, 'Direct handleOps fallback failed');
    throw new Error(`${primaryMessage}. Direct fallback failed: ${fallbackMessage}`);
  }
}
