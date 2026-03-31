import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  http,
  type Address,
  type Hex,
  concatHex,
  createPublicClient,
  createWalletClient,
  getAddress,
  hexToBigInt,
  padHex
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import EntryPointArtifact from '../system/contracts/EntryPoint.json';

type RpcEnvelope = {
  method: string;
  params: [RpcUserOp, Address];
};

type RpcUserOp = {
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

type PackedUserOp = {
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

type CliOptions = {
  filePath: string;
  rpcUrl: string;
  privateKey: Hex;
  beneficiary?: Address;
  broadcast: boolean;
};

function usage(): never {
  console.error(`Usage:
  pnpm -C setup tsx src/tools/send-userop-direct.ts <userop-json-file> [--rpc-url <url>] [--private-key <0x...>] [--beneficiary <0x...>] [--broadcast]

Notes:
  - Dry-run only by default.
  - Pass --broadcast to actually submit handleOps.
  - The file can contain the raw eth_sendUserOperation envelope or a JSON-encoded string of it.`);
  process.exit(1);
}

function requireHexPrivateKey(value: string | undefined): Hex {
  if (!value || !/^0x[a-fA-F0-9]{64}$/.test(value)) {
    throw new Error('Expected a 32-byte private key in 0x-prefixed hex format');
  }
  return value as Hex;
}

function requireAddress(label: string, value: string): Address {
  if (!/^0x[a-fA-F0-9]{40}$/.test(value)) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
  return getAddress(value);
}

function parseArgs(argv: string[]): CliOptions {
  if (argv.length === 0) {
    usage();
  }

  const [inputFilePath] = argv;
  if (!inputFilePath) {
    usage();
  }

  const resolvedFilePath = path.resolve(inputFilePath);
  let rpcUrl = process.env.RPC_URL ?? 'http://127.0.0.1:3050';
  let privateKey = process.env.EXECUTOR_PRIVATE_KEY ?? process.env.ADMIN_PRIVATE_KEY;
  let beneficiary: Address | undefined;
  let broadcast = false;

  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) {
      continue;
    }
    if (arg === '--broadcast') {
      broadcast = true;
      continue;
    }
    if (arg === '--rpc-url') {
      rpcUrl = argv[index + 1] ?? usage();
      index += 1;
      continue;
    }
    if (arg === '--private-key') {
      privateKey = argv[index + 1] ?? usage();
      index += 1;
      continue;
    }
    if (arg === '--beneficiary') {
      beneficiary = requireAddress('beneficiary', argv[index + 1] ?? usage());
      index += 1;
      continue;
    }
    usage();
  }

  return {
    filePath: resolvedFilePath,
    rpcUrl,
    privateKey: requireHexPrivateKey(privateKey),
    beneficiary,
    broadcast
  };
}

function parseEnvelope(text: string): RpcEnvelope {
  const firstParse = JSON.parse(text) as unknown;
  const parsed = typeof firstParse === 'string' ? JSON.parse(firstParse) : firstParse;
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    !('method' in parsed) ||
    !('params' in parsed) ||
    (parsed as { method: string }).method !== 'eth_sendUserOperation'
  ) {
    throw new Error('Expected an eth_sendUserOperation JSON-RPC envelope');
  }
  const params = (parsed as { params: unknown }).params;
  if (!Array.isArray(params) || params.length !== 2) {
    throw new Error('Expected exactly two eth_sendUserOperation params');
  }
  return parsed as RpcEnvelope;
}

function packUserOp(userOp: RpcUserOp): PackedUserOp {
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

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const fileText = await readFile(options.filePath, 'utf8');
  const envelope = parseEnvelope(fileText);
  const [userOp, entryPoint] = envelope.params;
  const packedUserOp = packUserOp(userOp);

  const publicClient = createPublicClient({
    transport: http(options.rpcUrl)
  });
  const account = privateKeyToAccount(options.privateKey);
  const beneficiary = options.beneficiary ?? account.address;
  const normalizedEntrypoint = getAddress(entryPoint);

  const userOpHash = await publicClient.readContract({
    address: normalizedEntrypoint,
    abi: EntryPointArtifact.abi,
    functionName: 'getUserOpHash',
    args: [packedUserOp]
  });

  console.log(`rpcUrl: ${options.rpcUrl}`);
  console.log(`entryPoint: ${normalizedEntrypoint}`);
  console.log(`sender: ${packedUserOp.sender}`);
  console.log(`executor: ${account.address}`);
  console.log(`beneficiary: ${beneficiary}`);
  console.log(`userOpHash: ${userOpHash}`);

  await publicClient.simulateContract({
    address: normalizedEntrypoint,
    abi: EntryPointArtifact.abi,
    functionName: 'handleOps',
    args: [[packedUserOp], beneficiary],
    account
  });

  console.log('direct handleOps simulation: success');

  if (!options.broadcast) {
    console.log('broadcast: skipped (pass --broadcast to submit)');
    return;
  }

  const walletClient = createWalletClient({
    account,
    transport: http(options.rpcUrl)
  });

  const gas = await publicClient.estimateContractGas({
    address: normalizedEntrypoint,
    abi: EntryPointArtifact.abi,
    functionName: 'handleOps',
    args: [[packedUserOp], beneficiary],
    account
  });

  const txHash = await walletClient.writeContract({
    address: normalizedEntrypoint,
    abi: EntryPointArtifact.abi,
    functionName: 'handleOps',
    args: [[packedUserOp], beneficiary],
    account,
    gas,
    chain: undefined
  });

  console.log(`txHash: ${txHash}`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  console.log(`status: ${receipt.status}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
