import type { ProofNormalized, ReceiptWithL2ToL1 } from '@matterlabs/zksync-js/core/rpc/types';
import { type Address, type Hex, keccak256 } from 'viem';

import L1_INTEROP_HANDLER_ABI_JSON from '../abis/L1InteropHandler.json';
import { client, sdk } from '../client';
import { BASE_TOKEN_ADDRESS, L1_INTEROP_HANDLER, L2_INTEROP_CENTER } from '../constants';
import type { FinalizeAttemptStatus, GetParamsResult, InteropParams } from '../types';

export async function finalizeTx(
  txHash: Hex,
  accountAddress: Address
): Promise<FinalizeAttemptStatus> {
  try {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`🚀 Attempting to finalize: ${txHash}`);
    console.log('='.repeat(80));

    // Step 1: Get receipt with L2-to-L1 logs
    console.log('📜 Getting receipt with L2-to-L1 logs...');
    const receipt = await client.zks.getReceiptWithL2ToL1(txHash);

    if (!receipt || receipt.status !== '0x1') {
      console.log('❌ Transaction not found or not successful');
      return { success: false, reason: 'tx_not_found' };
    }

    if (!receipt.l2ToL1Logs || receipt.l2ToL1Logs.length === 0) {
      console.log('ℹ️  No L2-to-L1 logs found - nothing to finalize');
      return { success: true, reason: 'no_logs', accountAddress };
    }

    console.log(`✅ Found ${receipt.l2ToL1Logs.length} L2-to-L1 log(s)`);

    const baseTokenKey = BASE_TOKEN_ADDRESS.toLowerCase().slice(2);
    const baseTokenLogIndex = receipt.l2ToL1Logs.findIndex((entry) => {
      const sender = entry.sender?.toLowerCase();
      const key = entry.key?.toLowerCase();
      return sender === BASE_TOKEN_ADDRESS.toLowerCase() || key?.includes(baseTokenKey);
    });

    if (baseTokenLogIndex >= 0) {
      console.log(`💸 Base-token withdrawal log detected (index ${baseTokenLogIndex}).`);
      const status = await sdk.withdrawals.status(txHash);

      if (status.phase === 'FINALIZED') {
        console.log(`✅ Withdrawal already finalized for ${txHash}`);
        // Continue to check if there's an L2InteropCenter message to finalize
      } else if (status.phase === 'READY_TO_FINALIZE') {
        // Ready to finalize - execute now
        console.log('🚀 Withdrawal is ready - finalizing now...');
        await sdk.withdrawals.tryFinalize(txHash);
        await sdk.withdrawals.wait(txHash, { for: 'finalized' });
        console.log(`✅ Withdrawal finalized for ${txHash}`);
        // Continue to check if there's an L2InteropCenter message to finalize
      } else {
        // Not ready yet - return and try again later
        console.log(`⏳ Withdrawal not ready yet (phase: ${status.phase}) - will retry later`);
        return { success: false, reason: 'withdrawal_not_ready' };
      }
    }

    // Step 2: Find the log from L2InteropCenter
    // Note: The L2InteropCenter address is in the 'key' field, not 'sender'
    // The sender is the L1 Messenger system contract (0x0000000000000000000000000000000000008008)
    const logIndex = await getLogIndex(receipt);
    if (logIndex === -1) {
      console.log('ℹ️  No logs from L2InteropCenter - nothing to finalize');
      return { success: true, reason: 'no_interop_logs', accountAddress };
    }

    // Step 3: Get proof
    const proof = await getProof(txHash, logIndex);
    if (!proof) {
      console.log('⏳ Proof not available yet - message not finalized on L2');
      return { success: false, reason: 'proof_not_ready' };
    }
    console.log('✅ Proof obtained');
    console.log(`   Batch: ${proof.batchNumber}, Message Index: ${proof.id}`);

    // Step 4: Extract message data from logs
    const paramsOrResp = await getParams(receipt, logIndex, proof);
    if (!paramsOrResp.ok) {
      return paramsOrResp.error;
    }

    // Step 5: Execute on L1
    const resp = await executeOnL1(paramsOrResp.params, accountAddress);
    return resp;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Error: ${errorMessage}`);
    return { success: false, reason: 'error', error: errorMessage };
  }
}

async function getLogIndex(receipt: ReceiptWithL2ToL1) {
  const l2InteropCenter = L2_INTEROP_CENTER.toLowerCase();
  const logIndex = receipt.l2ToL1Logs?.findIndex((entry) => {
    // The key contains the L2InteropCenter address (padded to 32 bytes)
    const key = entry.key?.toLowerCase();
    // Remove 0x and get last 40 chars (20 bytes = address)
    const addressFromKey = key ? `0x${key.slice(-40)}` : '';
    return addressFromKey === l2InteropCenter;
  });
  return logIndex ?? -1;
}

async function getProof(txHash: `0x${string}`, logIndex: number) {
  console.log('🔐 Fetching Merkle proof...');
  let proof: ProofNormalized | null = null;
  try {
    proof = await client.zks.getL2ToL1LogProof(txHash, logIndex);
    return proof;
  } catch (proofError) {
    console.log('proof error:', proofError);
    // Check if it's a "batch not executed yet" error
    const message = proofError instanceof Error ? proofError.message : String(proofError);
    if (message.includes('not been executed yet') || message.includes('proof not available')) {
      console.log('⏳ Proof not available yet - L1 batch not executed');
      return;
    }
    throw proofError; // Re-throw if it's a different error
  }
}

async function getParams(
  receipt: ReceiptWithL2ToL1,
  logIndex: number,
  proof: ProofNormalized
): Promise<GetParamsResult> {
  const log = receipt.l2ToL1Logs?.[logIndex];
  if (!log) {
    return { ok: false, error: { success: false, reason: 'no_log' } };
  }
  const l2BatchNumber = proof.batchNumber;
  const messageIndex = proof.id;

  console.log('📋 Building execution parameters...');
  console.log(`   Batch: ${l2BatchNumber}`);
  console.log(`   Message Index: ${messageIndex}`);

  // Extract sender from log (L2InteropCenter address is in the key field)
  const systemMessenger = '0x0000000000000000000000000000000000008008';
  let sender = log.sender;
  if (sender?.toLowerCase() === systemMessenger.toLowerCase() && log.key.length >= 66) {
    sender = `0x${log.key.slice(-40)}`;
  }

  // Find the message data in the logs
  const candidateLogs = receipt.logs?.filter((entry) => entry.data && entry.data.length > 130);
  let message: Hex | null = null;

  if (log.value && Array.isArray(candidateLogs)) {
    const expectedHash = log.value.toLowerCase();
    for (const entry of candidateLogs) {
      const candidate: `0x${string}` = `0x${entry.data.slice(130)}`;
      if (keccak256(candidate).toLowerCase() === expectedHash) {
        message = candidate;
        break;
      }
    }
  }

  if (!message) {
    if (Array.isArray(candidateLogs)) {
      const messageLog =
        candidateLogs.find(
          (entry) => entry.address?.toLowerCase() === L2_INTEROP_CENTER.toLowerCase()
        ) || candidateLogs[0];
      if (messageLog) {
        message = `0x${messageLog.data.slice(130)}`;
      }
    }
  }

  if (!message || message === '0x') {
    console.log('❌ Could not extract message data');
    return { ok: false, error: { success: false, reason: 'no_message' } };
  }

  // Build params for receiveInteropFromL2
  const params: InteropParams = {
    chainId: 8022833, // ZKSync OS Testnet chain ID
    l2BatchNumber: l2BatchNumber,
    l2MessageIndex: messageIndex,
    l2Sender: sender,
    l2TxNumberInBatch: log.tx_number_in_block,
    merkleProof: proof.proof,
    message
  };

  console.log(`   Sender: ${params.l2Sender}`);
  console.log(`   Message length: ${message.length} bytes`);
  return { ok: true, params };
}

async function executeOnL1(
  params: InteropParams,
  accountAddress: Address
): Promise<FinalizeAttemptStatus> {
  console.log('💰 Sending finalization transaction...');
  const baseGasPrice = await client.l1.getGasPrice();
  const bumpedGasPrice = (baseGasPrice * 12n) / 10n;
  console.log(`⛽ Gas price: ${baseGasPrice} → ${bumpedGasPrice}`);

  let finalizeHash: Hex;
  try {
    finalizeHash = await client.l1Wallet.writeContract({
      address: L1_INTEROP_HANDLER,
      abi: L1_INTEROP_HANDLER_ABI_JSON.abi,
      functionName: 'receiveInteropFromL2',
      args: [params],
      gasPrice: bumpedGasPrice
    });
  } catch (writeError) {
    // Log the full error for debugging
    const errorMessage = writeError instanceof Error ? writeError.message : String(writeError);
    console.log('❌ Error sending finalization transaction:');
    console.log(`   Error: ${errorMessage}`);

    // Check if error indicates message already finalized
    // Only treat as already finalized if we have strong evidence
    if (
      errorMessage.includes('already finalized') ||
      errorMessage.includes('AlreadyExecuted') ||
      errorMessage.includes('MessageAlreadyFinalized')
    ) {
      console.log('✅ Message appears to be already finalized');
      return { success: true, reason: 'already_finalized', accountAddress };
    }

    // For other errors (including generic "call failed"), throw so we can retry
    console.log('⚠️  Transaction failed - will retry later');
    throw writeError;
  }

  console.log(`✅ Transaction sent: ${finalizeHash}`);
  console.log('⏳ Waiting for confirmation...');

  let finalizeReceipt: Awaited<ReturnType<typeof client.l1.waitForTransactionReceipt>>;
  try {
    finalizeReceipt = await client.l1.waitForTransactionReceipt({
      hash: finalizeHash,
      timeout: 300_000
    });
  } catch (waitError) {
    const errorMessage = waitError instanceof Error ? waitError.message : String(waitError);
    if (errorMessage.includes('Timed out')) {
      console.log(`⏳ L1 finalize tx still pending: ${finalizeHash}`);
      return { success: false, reason: 'l1_pending' };
    }
    throw waitError;
  }

  if (finalizeReceipt.status === 'success') {
    console.log('✅ Message finalized successfully!');
    console.log(`   Block: ${finalizeReceipt.blockNumber}`);
    console.log(`   Gas used: ${finalizeReceipt.gasUsed}`);
    return { success: true, reason: 'finalized', txHash: finalizeHash, accountAddress };
  }
  console.log('❌ Finalization transaction failed');
  return { success: false, reason: 'tx_failed' };
}
