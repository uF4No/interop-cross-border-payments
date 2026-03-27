import {
  type Address,
  type Hex,
  concatHex,
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  defineChain,
  getAddress,
  hexToBigInt,
  http,
  padHex,
  parseAbi
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import { getChainDeploymentById, loadContractsConfig } from '@/utils/contractsConfig';
import { env } from '@/utils/envConfig';
import { addPendingTx } from '@/utils/relayer/state';

const LOCAL_RPC_HOSTS = new Set(['localhost', '127.0.0.1']);

const entryPointAbi = parseAbi([
  'function getUserOpHash((address sender,uint256 nonce,bytes initCode,bytes callData,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData,bytes signature) userOp) view returns (bytes32)',
  'function handleOps((address sender,uint256 nonce,bytes initCode,bytes callData,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData,bytes signature)[] ops, address beneficiary)',
  'error FailedOp(uint256 opIndex, string reason)',
  'error FailedOpWithRevert(uint256 opIndex, string reason, bytes inner)'
]);
const interopCenterAbi = parseAbi([
  'event InteropBundleSent(bytes32 l2l1MsgHash, bytes32 interopBundleHash, (bytes1 version, uint256 sourceChainId, uint256 destinationChainId, bytes32 interopBundleSalt, (bytes1 version, bool shadowAccount, address to, address from, uint256 value, bytes data)[] calls, (bytes executionAddress, bytes unbundlerAddress) bundleAttributes) interopBundle)'
]);

export type RpcUserOpV08 = {
  sender: Address;
  nonce: Hex;
  factory: Address | null;
  factoryData: Hex | null;
  callData: Hex;
  callGasLimit: Hex;
  verificationGasLimit: Hex;
  preVerificationGas: Hex;
  maxFeePerGas: Hex;
  maxPriorityFeePerGas: Hex;
  paymaster: Address | null;
  paymasterVerificationGasLimit: Hex | null;
  paymasterPostOpGasLimit: Hex | null;
  paymasterData: Hex | null;
  signature: Hex;
};

type PackedUserOpV08 = {
  sender: Address;
  nonce: bigint;
  initCode: Hex;
  callData: Hex;
  accountGasLimits: Hex;
  preVerificationGas: bigint;
  gasFees: Hex;
  paymasterAndData: Hex;
  signature: Hex;
};

export type DirectHandleOpsRequest = {
  chainId: number;
  entryPoint: Address;
  userOp: RpcUserOpV08;
  beneficiary?: Address;
};

export type DirectHandleOpsResult = {
  chainId: number;
  txHash: Hex;
  userOpHash: Hex;
  receiptStatus: 'success' | 'reverted';
  beneficiary: Address;
  executor: Address;
  bundleHash?: Hex;
  relayQueued: boolean;
};

function assertLocalFallbackAllowed(rpcUrl: string) {
  if (env.isProduction) {
    throw new Error('Direct handleOps fallback is disabled in production.');
  }

  const parsedUrl = new URL(rpcUrl);
  if (!LOCAL_RPC_HOSTS.has(parsedUrl.hostname)) {
    throw new Error(`Direct handleOps fallback is limited to local RPC URLs. Got ${rpcUrl}.`);
  }
}

function packUserOp(userOp: RpcUserOpV08): PackedUserOpV08 {
  const initCode =
    userOp.factory && userOp.factoryData
      ? concatHex([getAddress(userOp.factory), userOp.factoryData])
      : '0x';

  const paymasterAndData =
    userOp.paymaster &&
    userOp.paymasterVerificationGasLimit &&
    userOp.paymasterPostOpGasLimit &&
    userOp.paymasterData
      ? concatHex([
          getAddress(userOp.paymaster),
          padHex(userOp.paymasterVerificationGasLimit, { size: 16 }),
          padHex(userOp.paymasterPostOpGasLimit, { size: 16 }),
          userOp.paymasterData
        ])
      : '0x';

  return {
    sender: getAddress(userOp.sender),
    nonce: hexToBigInt(userOp.nonce),
    initCode,
    callData: userOp.callData,
    accountGasLimits: concatHex([
      padHex(userOp.verificationGasLimit, { size: 16 }),
      padHex(userOp.callGasLimit, { size: 16 })
    ]),
    preVerificationGas: hexToBigInt(userOp.preVerificationGas),
    gasFees: concatHex([
      padHex(userOp.maxPriorityFeePerGas, { size: 16 }),
      padHex(userOp.maxFeePerGas, { size: 16 })
    ]),
    paymasterAndData,
    signature: userOp.signature
  };
}

function extractBundleHash(params: {
  logs: readonly {
    address: Address;
    data: Hex;
    topics: readonly Hex[];
  }[];
  interopCenter?: Address;
}): Hex | undefined {
  if (!params.interopCenter) {
    return undefined;
  }

  const normalizedInteropCenter = params.interopCenter.toLowerCase();
  for (const log of params.logs) {
    if (log.address.toLowerCase() !== normalizedInteropCenter) {
      continue;
    }
    if (log.topics.length === 0) {
      continue;
    }

    try {
      const decoded = decodeEventLog({
        abi: interopCenterAbi,
        data: log.data,
        topics: log.topics as [Hex, ...Hex[]]
      });

      if (decoded.eventName === 'InteropBundleSent') {
        return decoded.args.interopBundleHash;
      }
    } catch {
      // Ignore unrelated logs from the same contract.
    }
  }

  return undefined;
}

export async function submitUserOpDirectHandleOps(
  request: DirectHandleOpsRequest
): Promise<DirectHandleOpsResult> {
  const contractsConfig = loadContractsConfig();
  const resolvedChain = getChainDeploymentById(contractsConfig, request.chainId);
  if (!resolvedChain || resolvedChain.key === 'c') {
    throw new Error(`Unsupported source chain for direct handleOps fallback: ${request.chainId}`);
  }

  const rpcUrl = resolvedChain.deployment.rpcUrl?.trim();
  const configuredEntrypoint =
    resolvedChain.deployment.sso?.entryPoint ?? contractsConfig?.sso?.entryPoint;
  const configuredInteropCenter = resolvedChain.deployment.interopCenter
    ? getAddress(resolvedChain.deployment.interopCenter)
    : undefined;

  if (!rpcUrl) {
    throw new Error(`Missing rpcUrl for chain ${request.chainId}`);
  }
  if (!configuredEntrypoint) {
    throw new Error(`Missing EntryPoint config for chain ${request.chainId}`);
  }

  assertLocalFallbackAllowed(rpcUrl);

  const normalizedEntrypoint = getAddress(request.entryPoint);
  if (normalizedEntrypoint.toLowerCase() !== configuredEntrypoint.toLowerCase()) {
    throw new Error(
      `EntryPoint mismatch for chain ${request.chainId}: expected ${configuredEntrypoint}, got ${normalizedEntrypoint}`
    );
  }

  const chain = defineChain({
    id: request.chainId,
    name: `Direct HandleOps Chain ${request.chainId}`,
    nativeCurrency: {
      name: 'Ether',
      symbol: 'ETH',
      decimals: 18
    },
    rpcUrls: {
      default: { http: [rpcUrl] },
      public: { http: [rpcUrl] }
    }
  });

  const account = privateKeyToAccount(env.EXECUTOR_PRIVATE_KEY as Hex);
  const beneficiary = request.beneficiary ? getAddress(request.beneficiary) : account.address;
  const packedUserOp = packUserOp(request.userOp);

  const publicClient = createPublicClient({
    chain,
    transport: http(rpcUrl)
  });

  const walletClient = createWalletClient({
    chain,
    account,
    transport: http(rpcUrl)
  });

  const userOpHash = await publicClient.readContract({
    address: normalizedEntrypoint,
    abi: entryPointAbi,
    functionName: 'getUserOpHash',
    args: [packedUserOp]
  });

  await publicClient.simulateContract({
    address: normalizedEntrypoint,
    abi: entryPointAbi,
    functionName: 'handleOps',
    args: [[packedUserOp], beneficiary],
    account
  });

  const gas = await publicClient.estimateContractGas({
    address: normalizedEntrypoint,
    abi: entryPointAbi,
    functionName: 'handleOps',
    args: [[packedUserOp], beneficiary],
    account
  });

  const txHash = await walletClient.writeContract({
    address: normalizedEntrypoint,
    abi: entryPointAbi,
    functionName: 'handleOps',
    args: [[packedUserOp], beneficiary],
    gas
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  const bundleHash = extractBundleHash({
    logs: receipt.logs,
    interopCenter: configuredInteropCenter
  });
  const relayQueued = Boolean(bundleHash) && receipt.status === 'success';

  if (relayQueued) {
    addPendingTx(txHash, { action: 'Interop', amount: '0' }, packedUserOp.sender, request.chainId);
  }

  return {
    chainId: request.chainId,
    txHash,
    userOpHash,
    receiptStatus: receipt.status,
    beneficiary,
    executor: account.address,
    bundleHash,
    relayQueued
  };
}
