import { client } from '../client';
import { finalizeTx } from './finalize';
import { extractTxMetadata } from './metadata';
import { loadFinalizedTxs, loadPendingTxs, saveFinalizedTxs, savePendingTxs } from './state';

// Lock to prevent concurrent processing
let isProcessing = false;

export async function processQueue() {
  // Skip if already processing
  if (isProcessing) {
    console.log('⏭️  Skipping queue processing - already in progress');
    return;
  }

  isProcessing = true;
  try {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`🔄 Processing queue... ${new Date().toLocaleTimeString()}`);
    console.log('='.repeat(80));

    const pendingTxs = loadPendingTxs();
    const finalizedTxs = loadFinalizedTxs();

    if (pendingTxs.length === 0) {
      console.log('ℹ️  No pending transactions to process');
      return;
    }

    console.log(`📋 Found ${pendingTxs.length} pending transaction(s)`);

    const stillPending = [];

    for (const tx of pendingTxs) {
      // Backfill metadata for old transactions that don't have it
      if (!tx.action || !tx.amount) {
        try {
          const receipt = await client.zks.getReceiptWithL2ToL1(tx.hash);
          if (receipt) {
            const metadata = await extractTxMetadata(receipt);
            tx.action = metadata.action;
            tx.amount = metadata.amount;
            console.log(
              `📝 Backfilled metadata for ${tx.hash}: ${metadata.action} ${metadata.amount} ETH`
            );
          }
        } catch {
          // If we can't get metadata, set defaults
          tx.action = tx.action || 'Unknown';
          tx.amount = tx.amount || '0';
        }
      }

      const result = await finalizeTx(tx.hash, tx.accountAddress);

      if (result.success) {
        console.log(`✅ Removed from queue: ${tx.hash}`);
        finalizedTxs.unshift({
          l2TxHash: tx.hash,
          l1FinalizeTxHash: result.txHash || '0x000',
          finalizedAt: new Date().toISOString(),
          action: tx.action,
          amount: tx.amount,
          accountAddress: result.accountAddress
        });
      } else if (
        result.reason === 'proof_not_ready' ||
        result.reason === 'l1_pending' ||
        result.reason === 'withdrawal_not_ready'
      ) {
        console.log(`⏳ Still pending: ${tx.hash}`);
        stillPending.push({
          ...tx,
          lastFinalizeHash: tx.lastFinalizeHash,
          updatedAt: new Date().toISOString()
        });
      } else {
        console.log(`❌ Failed permanently: ${tx.hash} (${result.reason})`);
      }

      // Small delay between transactions
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    savePendingTxs(stillPending);
    saveFinalizedTxs(finalizedTxs.slice(0, 50));
    console.log(`\n📊 Queue updated: ${stillPending.length} remaining`);
  } finally {
    isProcessing = false;
  }
}
