import type { ReceiptWithL2ToL1 } from '@matterlabs/zksync-js/core/rpc/types';
import { type Hex, decodeAbiParameters, decodeFunctionData, formatEther } from 'viem';

import AAVE_POOL_ABI_JSON from '../abis/IPool.json';
import WETH_GATEWAY_ABI_JSON from '../abis/IWrappedTokenGatewayV3.json';
import { L2_INTEROP_CENTER } from '../constants';

export async function extractTxMetadata(receipt: ReceiptWithL2ToL1) {
  try {
    if (!receipt || !receipt.logs || receipt.logs.length === 0) {
      return { action: 'Unknown', amount: '0' };
    }

    const interop = L2_INTEROP_CENTER.toLowerCase();

    // Find the 0x8008 log that corresponds to interop center
    const systemLog = receipt.logs.find((log) => {
      if ((log.address ?? '').toLowerCase() !== '0x0000000000000000000000000000000000008008')
        return false;
      const t1 = (log.topics?.[1] ?? '').toLowerCase();
      const addrFromTopic = `0x${t1.slice(-40)}` as `0x${string}`;
      return addrFromTopic === interop;
    });

    if (!systemLog) return { action: 'Unknown', amount: '0' };

    const { ops } = extractOpsFromSystemLogData(systemLog.data);
    return classifyOps(ops);
  } catch (error) {
    console.error('Error extracting tx metadata:', error);
    return { action: 'Unknown', amount: '0' };
  }
}

type ShadowOp = { target: Hex; value: bigint; data: Hex };
function extractOpsFromSystemLogData(systemLogData: Hex) {
  // Step 1: log.data is ABI-encoded bytes: abi.encode(bytes payload)
  const [payload] = decodeAbiParameters([{ name: 'payload', type: 'bytes' }], systemLogData) as [
    Hex
  ];

  // Step 2: payload is ABI-encoded (address l2Caller, ShadowAccountOp[] ops)
  const [l2Caller, ops] = decodeAbiParameters(
    [
      { name: 'l2Caller', type: 'address' },
      {
        name: 'ops',
        type: 'tuple[]',
        components: [
          { name: 'target', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'data', type: 'bytes' }
        ]
      }
    ],
    payload
  ) as unknown as readonly [Hex, ShadowOp[]];

  return { l2Caller, ops };
}

function classifyOps(ops: ShadowOp[]) {
  if (!ops.length) return { action: 'Unknown', amount: '0' };

  const first = ops[0];

  // Deposit?
  try {
    const d = decodeFunctionData({ abi: WETH_GATEWAY_ABI_JSON.abi, data: first.data });
    if (d.functionName === 'depositETH') {
      return { action: 'Deposit', amount: formatEther(first.value) };
    }
  } catch {
    //
  }

  // Withdrawal?
  try {
    const d = decodeFunctionData({ abi: AAVE_POOL_ABI_JSON.abi, data: first.data });
    if (d.functionName === 'withdraw' && d.args) {
      const amount = d.args[1] as bigint;
      return { action: 'Withdrawal', amount: formatEther(amount) };
    }
  } catch {
    //
  }

  return { action: 'Unknown', amount: '0' };
}
