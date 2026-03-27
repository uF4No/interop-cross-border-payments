import {
  concatHex,
  encodeAbiParameters,
  getAddress,
  parseAbi,
  toHex,
  type Address,
  type Hex
} from 'viem';

import { executorAccount, getChainScopedClients } from '../client';
import { getChainDeploymentById, loadContractsConfig, type ChainDeployment } from '../contractsConfig';
import { addPendingTx, loadFinalizedTxs, loadPendingTxs } from '../relayer/state';

import { loadInvoicePayoutStates, upsertInvoicePayoutState, type InvoicePayoutState } from './state';

const contractsConfig = loadContractsConfig();
const LOCAL_INTEROP_RELAY_ADDRESS = '0x36615Cf349d7F6344891B1e7CA7C72883F5dc049' as Address;
const L2_ASSET_ROUTER_ADDRESS = '0x0000000000000000000000000000000000010003' as Address;
const L2_NATIVE_TOKEN_VAULT_ADDRESS = '0x0000000000000000000000000000000000010004' as Address;
const NEW_ENCODING_VERSION = '0x01' as Hex;
const INDIRECT_CALL_ATTRIBUTE_SELECTOR = '0xc8496ea7' as Hex;
const UNBUNDLER_ATTRIBUTE_SELECTOR = '0xb9c86698' as Hex;
const INVOICE_CHUNK_SIZE = 50;

const INTEROP_CENTER_ABI = parseAbi([
  'function sendBundle(bytes _destinationChainId, (bytes to, bytes data, bytes[] callAttributes)[] _callStarters, bytes[] _bundleAttributes) payable returns (bytes32)'
]);

const ERC20_ABI = parseAbi([
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)'
]);

const INVOICE_ABI = parseAbi([
  'function getInvoiceCount() view returns (uint256)',
  'function getMultipleInvoiceDetails(uint256[] invoiceIds) view returns ((uint256 id,address creator,address recipient,address creatorRefundAddress,address recipientRefundAddress,uint256 creatorChainId,uint256 recipientChainId,address billingToken,uint256 amount,address paymentToken,uint256 paymentAmount,uint8 status,uint256 createdAt,uint256 paidAt,string text)[])',
  'function creatorPayoutInitiated(uint256 invoiceId) view returns (bool)',
  'function triggerCreatorPayout(uint256 invoiceId)'
]);

type InvoiceDetails = {
  id: bigint;
  creator: Address;
  recipient: Address;
  creatorRefundAddress: Address;
  recipientRefundAddress: Address;
  creatorChainId: bigint;
  recipientChainId: bigint;
  billingToken: Address;
  amount: bigint;
  paymentToken: Address;
  paymentAmount: bigint;
  status: number;
  createdAt: bigint;
  paidAt: bigint;
  text: string;
};

function toMinimalChainRef(chainId: bigint): Hex {
  if (chainId === 0n) {
    return '0x00';
  }

  let hex = chainId.toString(16);
  if (hex.length % 2 !== 0) {
    hex = `0${hex}`;
  }

  return `0x${hex}` as Hex;
}

function formatEvmV1(chainId: bigint): Hex {
  const chainRef = toMinimalChainRef(chainId);
  const chainRefLength = (chainRef.length - 2) / 2;
  return concatHex(['0x00010000', toHex(chainRefLength, { size: 1 }), chainRef, '0x00']);
}

function formatEvmV1AddressOnly(address: Address): Hex {
  return concatHex(['0x000100000014', address]);
}

function indirectCallAttribute(messageValue: bigint): Hex {
  return concatHex([
    INDIRECT_CALL_ATTRIBUTE_SELECTOR,
    encodeAbiParameters([{ type: 'uint256' }], [messageValue])
  ]);
}

function unbundlerAddressAttribute(unbundler: Address): Hex {
  return concatHex([
    UNBUNDLER_ATTRIBUTE_SELECTOR,
    encodeAbiParameters([{ type: 'bytes' }], [formatEvmV1AddressOnly(unbundler)])
  ]);
}

function chunkArray<T>(values: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += chunkSize) {
    chunks.push(values.slice(index, index + chunkSize));
  }
  return chunks;
}

function resolveChainCDeployment(): ChainDeployment {
  const deployment = contractsConfig?.chains?.c;
  if (
    !deployment?.chainId ||
    !deployment.rpcUrl ||
    !deployment.apiUrl ||
    !deployment.authBaseUrl ||
    !deployment.interopCenter ||
    !deployment.nativeTokenVault ||
    !deployment.invoicePayment
  ) {
    throw new Error('Chain C config is missing invoice payout runtime data.');
  }

  return deployment;
}

function resolveAssetIdForBillingToken(chainC: ChainDeployment, billingToken: Address): Hex {
  const tokens = chainC.tokens ?? {};
  for (const token of Object.values(tokens)) {
    if (token?.address && token.assetId && token.address.toLowerCase() === billingToken.toLowerCase()) {
      return token.assetId;
    }
  }

  throw new Error(`Missing assetId for billing token ${billingToken} on chain C.`);
}

async function readAllInvoices(invoicePayment: Address, chainCChainId: number): Promise<InvoiceDetails[]> {
  const { client: chainCClients } = getChainScopedClients(chainCChainId);
  const invoiceCount = (await chainCClients.l2.readContract({
    address: invoicePayment,
    abi: INVOICE_ABI,
    functionName: 'getInvoiceCount',
    args: []
  })) as bigint;

  if (invoiceCount === 0n) {
    return [];
  }

  const invoiceIds: bigint[] = [];
  for (let invoiceId = 1n; invoiceId <= invoiceCount; invoiceId += 1n) {
    invoiceIds.push(invoiceId);
  }

  const results: InvoiceDetails[] = [];
  for (const chunk of chunkArray(invoiceIds, INVOICE_CHUNK_SIZE)) {
    const invoices = (await chainCClients.l2.readContract({
      address: invoicePayment,
      abi: INVOICE_ABI,
      functionName: 'getMultipleInvoiceDetails',
      args: [chunk]
    })) as readonly InvoiceDetails[];
    results.push(...invoices);
  }

  return results;
}

function syncCompletedPayoutStates() {
  const finalized = loadFinalizedTxs();
  const finalizedByHash = new Set(finalized.map((tx) => tx.l2TxHash.toLowerCase()));
  const states = loadInvoicePayoutStates();

  for (const state of states) {
    if (
      state.status === 'bridge_submitted' &&
      state.bridgeTxHash &&
      finalizedByHash.has(state.bridgeTxHash.toLowerCase())
    ) {
      upsertInvoicePayoutState({
        ...state,
        status: 'completed',
        updatedAt: new Date().toISOString()
      });
    }
  }
}

function currentPayoutState(invoiceId: bigint): InvoicePayoutState | undefined {
  return loadInvoicePayoutStates().find((state) => state.invoiceId === invoiceId.toString());
}

async function ensurePayoutReleased(
  invoicePayment: Address,
  invoice: InvoiceDetails,
  chainCChainId: number
): Promise<void> {
  const existing = currentPayoutState(invoice.id);
  if (existing?.status === 'released' || existing?.status === 'bridge_submitted' || existing?.status === 'completed') {
    return;
  }

  const { client: chainCClient } = getChainScopedClients(chainCChainId);
  const alreadyReleased = (await chainCClient.l2.readContract({
    address: invoicePayment,
    abi: INVOICE_ABI,
    functionName: 'creatorPayoutInitiated',
    args: [invoice.id]
  })) as boolean;

  if (alreadyReleased) {
    upsertInvoicePayoutState({
      invoiceId: invoice.id.toString(),
      creatorChainId: Number(invoice.creatorChainId),
      creatorRefundAddress: getAddress(invoice.creatorRefundAddress),
      billingToken: getAddress(invoice.billingToken),
      amount: invoice.amount.toString(),
      status: 'released',
      updatedAt: new Date().toISOString()
    });
    return;
  }

  const txHash = await chainCClient.l2Wallet!.writeContract({
    account: executorAccount,
    address: invoicePayment,
    abi: INVOICE_ABI,
    functionName: 'triggerCreatorPayout',
    args: [invoice.id]
  });
  const receipt = await chainCClient.l2.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== 'success') {
    throw new Error(`triggerCreatorPayout reverted for invoice ${invoice.id.toString()}`);
  }

  console.log(`[invoice-payout] released invoice ${invoice.id.toString()} to payout operator tx=${txHash}`);
  upsertInvoicePayoutState({
    invoiceId: invoice.id.toString(),
    creatorChainId: Number(invoice.creatorChainId),
    creatorRefundAddress: getAddress(invoice.creatorRefundAddress),
    billingToken: getAddress(invoice.billingToken),
    amount: invoice.amount.toString(),
    status: 'released',
    releaseTxHash: txHash,
    updatedAt: new Date().toISOString()
  });
}

async function ensureBridgeSubmitted(
  chainC: ChainDeployment,
  invoice: InvoiceDetails
): Promise<void> {
  const existing = currentPayoutState(invoice.id);
  if (existing?.status === 'bridge_submitted' || existing?.status === 'completed') {
    return;
  }

  const destinationChainId = Number(invoice.creatorChainId);
  getChainScopedClients(destinationChainId);

  const sourceChainId = Number(chainC.chainId);
  const assetId = resolveAssetIdForBillingToken(chainC, getAddress(invoice.billingToken));
  const { client: chainCClient } = getChainScopedClients(sourceChainId);

  const currentAllowance = (await chainCClient.l2.readContract({
    address: getAddress(invoice.billingToken),
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [executorAccount.address, getAddress(chainC.nativeTokenVault!)]
  })) as bigint;

  if (currentAllowance < invoice.amount) {
    const approveTxHash = await chainCClient.l2Wallet!.writeContract({
      account: executorAccount,
      address: getAddress(invoice.billingToken),
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [getAddress(chainC.nativeTokenVault!), invoice.amount]
    });
    const approveReceipt = await chainCClient.l2.waitForTransactionReceipt({ hash: approveTxHash });
    if (approveReceipt.status !== 'success') {
      throw new Error(`approve reverted for invoice ${invoice.id.toString()}`);
    }
  }

  const burnData = encodeAbiParameters(
    [{ type: 'uint256' }, { type: 'address' }, { type: 'address' }],
    [invoice.amount, getAddress(invoice.creatorRefundAddress), '0x0000000000000000000000000000000000000000']
  );
  const payload = concatHex([
    NEW_ENCODING_VERSION,
    encodeAbiParameters([{ type: 'bytes32' }, { type: 'bytes' }], [assetId, burnData])
  ]);
  const callStarters = [
    {
      to: formatEvmV1AddressOnly(L2_ASSET_ROUTER_ADDRESS),
      data: payload,
      callAttributes: [indirectCallAttribute(0n)]
    }
  ] as const;
  const bundleAttributes = [unbundlerAddressAttribute(LOCAL_INTEROP_RELAY_ADDRESS)] as const;

  const bridgeTxHash = await chainCClient.l2Wallet!.writeContract({
    account: executorAccount,
    address: getAddress(chainC.interopCenter!),
    abi: INTEROP_CENTER_ABI,
    functionName: 'sendBundle',
    args: [formatEvmV1(BigInt(destinationChainId)), callStarters, bundleAttributes]
  });
  const bridgeReceipt = await chainCClient.l2.waitForTransactionReceipt({ hash: bridgeTxHash });
  if (bridgeReceipt.status !== 'success') {
    upsertInvoicePayoutState({
      invoiceId: invoice.id.toString(),
      creatorChainId: destinationChainId,
      creatorRefundAddress: getAddress(invoice.creatorRefundAddress),
      billingToken: getAddress(invoice.billingToken),
      amount: invoice.amount.toString(),
      status: 'bridge_failed',
      bridgeTxHash,
      updatedAt: new Date().toISOString()
    });
    throw new Error(`payout bridge reverted for invoice ${invoice.id.toString()}`);
  }

  addPendingTx(
    bridgeTxHash,
    {
      action: `Invoice payout ${invoice.id.toString()}`,
      amount: invoice.amount.toString()
    },
    executorAccount.address,
    sourceChainId
  );

  console.log(
    `[invoice-payout] submitted bridge for invoice ${invoice.id.toString()} tx=${bridgeTxHash} destination=${destinationChainId}`
  );

  upsertInvoicePayoutState({
    invoiceId: invoice.id.toString(),
    creatorChainId: destinationChainId,
    creatorRefundAddress: getAddress(invoice.creatorRefundAddress),
    billingToken: getAddress(invoice.billingToken),
    amount: invoice.amount.toString(),
    status: 'bridge_submitted',
    releaseTxHash: existing?.releaseTxHash,
    bridgeTxHash,
    updatedAt: new Date().toISOString()
  });
}

export async function processInvoicePayouts() {
  syncCompletedPayoutStates();

  const chainC = resolveChainCDeployment();
  const chainCChainId = Number(chainC.chainId);
  const invoicePayment = getAddress(chainC.invoicePayment!);
  const invoices = await readAllInvoices(invoicePayment, chainCChainId);
  const pendingByHash = new Set(loadPendingTxs().map((tx) => tx.hash.toLowerCase()));

  for (const invoice of invoices) {
    if (invoice.status !== 1) {
      continue;
    }
    if (Number(invoice.creatorChainId) === chainCChainId) {
      continue;
    }

    const state = currentPayoutState(invoice.id);
    if (state?.status === 'completed') {
      continue;
    }
    if (
      state?.status === 'bridge_submitted' &&
      state.bridgeTxHash &&
      pendingByHash.has(state.bridgeTxHash.toLowerCase())
    ) {
      continue;
    }

    try {
      await ensurePayoutReleased(invoicePayment, invoice, chainCChainId);
      await ensureBridgeSubmitted(chainC, invoice);
    } catch (error) {
      console.error(
        `[invoice-payout] failed for invoice ${invoice.id.toString()}:`,
        error
      );
    }
  }
}
