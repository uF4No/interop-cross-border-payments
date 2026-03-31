import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { type Address, type Hex, getAddress } from 'viem';

import { INVOICE_PAYOUTS_FILE } from '../constants';

export type InvoicePayoutStatus = 'released' | 'bridge_submitted' | 'bridge_failed' | 'completed';

export type InvoicePayoutState = {
  invoiceId: string;
  creatorChainId: number;
  creatorRefundAddress: Address;
  billingToken: Address;
  amount: string;
  status: InvoicePayoutStatus;
  releaseTxHash?: Hex;
  bridgeTxHash?: Hex;
  updatedAt: string;
};

function normalizeInvoicePayoutState(state: InvoicePayoutState): InvoicePayoutState {
  return {
    ...state,
    creatorRefundAddress: getAddress(state.creatorRefundAddress),
    billingToken: getAddress(state.billingToken)
  };
}

export function loadInvoicePayoutStates(): InvoicePayoutState[] {
  if (!existsSync(INVOICE_PAYOUTS_FILE)) {
    return [];
  }

  const data = readFileSync(INVOICE_PAYOUTS_FILE, 'utf8').trim();
  if (!data) {
    return [];
  }

  return (JSON.parse(data) as InvoicePayoutState[]).map(normalizeInvoicePayoutState);
}

export function saveInvoicePayoutStates(states: InvoicePayoutState[]) {
  writeFileSync(INVOICE_PAYOUTS_FILE, JSON.stringify(states, null, 2));
}

export function upsertInvoicePayoutState(nextState: InvoicePayoutState) {
  const states = loadInvoicePayoutStates();
  const next = normalizeInvoicePayoutState(nextState);
  const existingIndex = states.findIndex((state) => state.invoiceId === next.invoiceId);

  if (existingIndex >= 0) {
    states[existingIndex] = next;
  } else {
    states.push(next);
  }

  saveInvoicePayoutStates(states);
}
