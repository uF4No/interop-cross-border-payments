import type { Address, Hex } from 'viem';

export interface Metadata {
  action: string;
  amount: string;
}

export interface FinalizedTxnState extends Metadata {
  l2TxHash: Hex;
  l1FinalizeTxHash: Hex;
  finalizedAt: string;
  accountAddress: Address;
}

export interface PendingTxnState extends Metadata {
  hash: Hex;
  addedAt: string;
  status: string;
  lastFinalizeHash?: Hex;
  updatedAt?: string;
  accountAddress: Address;
}

export interface InteropParams {
  chainId: number;
  l2BatchNumber: bigint;
  l2MessageIndex: bigint;
  l2Sender: Address;
  l2TxNumberInBatch: number;
  merkleProof: Hex[];
  message: string;
}

export type FinalizeAttemptStatus = FinalizeAttemptSuccess | FinalizeAttemptError;

export interface FinalizeAttemptError {
  success: false;
  reason: FailureReasons;
  error?: string;
}

export interface FinalizeAttemptSuccess {
  success: true;
  reason: SuccessReasons;
  accountAddress: Address;
  txHash?: Hex;
}

export type FailureReasons =
  | 'tx_not_found'
  | 'withdrawal_not_ready'
  | 'proof_not_ready'
  | 'error'
  | 'no_message'
  | 'l1_pending'
  | 'tx_failed'
  | 'no_log';
export type SuccessReasons = 'no_logs' | 'no_interop_logs' | 'already_finalized' | 'finalized';

type GetParamsSuccess = {
  ok: true;
  params: InteropParams;
};

type GetParamsFailure = {
  ok: false;
  error: FinalizeAttemptError;
};

export type GetParamsResult = GetParamsSuccess | GetParamsFailure;
