import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { Address } from 'viem';

import { FINALIZED_TXS_FILE, PENDING_TXS_FILE } from '../constants';
import type { FinalizedTxnState, Metadata, PendingTxnState } from '../types';

// Load or initialize pending transactions
export function loadPendingTxs(accountAddress?: Address): PendingTxnState[] {
  if (existsSync(PENDING_TXS_FILE)) {
    const data = readFileSync(PENDING_TXS_FILE, 'utf-8');
    const sanitized = data
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
      .trim();
    if (!sanitized) {
      return [];
    }
    const json = JSON.parse(sanitized);
    if (accountAddress)
      return json.filter((tx: PendingTxnState) => tx.accountAddress === accountAddress);
    return json;
  }
  return [];
}

export function savePendingTxs(txs: PendingTxnState[]) {
  writeFileSync(PENDING_TXS_FILE, JSON.stringify(txs, null, 2));
}

export function loadFinalizedTxs(accountAddress?: Address): FinalizedTxnState[] {
  if (existsSync(FINALIZED_TXS_FILE)) {
    const data = readFileSync(FINALIZED_TXS_FILE, 'utf-8');
    const json = JSON.parse(data);
    if (accountAddress)
      return json.filter((tx: FinalizedTxnState) => tx.accountAddress === accountAddress);
    return json;
  }
  return [];
}

export function saveFinalizedTxs(txs: FinalizedTxnState[]) {
  writeFileSync(FINALIZED_TXS_FILE, JSON.stringify(txs, null, 2));
}

export function addPendingTx(hash: `0x${string}`, metadata: Metadata, accountAddress: Address) {
  const pending = loadPendingTxs();
  const finalized = loadFinalizedTxs();
  if (pending.some((tx) => tx.hash === hash) || finalized.some((tx) => tx.l2TxHash === hash)) {
    return;
  }
  pending.push({
    hash,
    addedAt: new Date().toISOString(),
    status: 'pending',
    action: metadata.action || 'Unknown',
    amount: metadata.amount || '0',
    accountAddress
  });
  savePendingTxs(pending);
}
