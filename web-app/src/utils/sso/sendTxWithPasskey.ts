import {
  type Address,
  type Hex,
  type PublicClient,
  concat,
  encodeAbiParameters,
  pad,
  toHex
} from 'viem';

import { ssoContracts } from './constants';
import { assertPasskeyMatchesAccount, savePasskeyCredentials } from './passkeys';
import { assertPasskeyUserOpSignatureValid, signUserOpWithPasskey } from './signUserOpWithPasskey';
import { submitUserOpWithFallback } from './submitUserOpWithFallback';
import type { PasskeyCredential } from './types';

// NOTE: this method will be replaced with a much simpler implementation
// once the zksync-sso SDK is finalized for 4337 support
export async function sendTxWithPasskey(
  accountAddress: Address,
  passkeyCredentials: PasskeyCredential,
  txData: {
    to: Address;
    value: bigint;
    data: Hex;
  }[],
  gasOptions: {
    gasFees: Hex;
    accountGasLimits: Hex;
    callGasLimit: bigint;
    verificationGasLimit: bigint;
    preVerificationGas: bigint;
    maxFeePerGas: bigint;
    maxPriorityFeePerGas: bigint;
  },
  readClient?: PublicClient,
  enableWalletToken?: (params: {
    walletAddress: `0x${string}`;
    contractAddress: `0x${string}`;
    nonce: number;
    calldata: `0x${string}`;
  }) => Promise<{ message: string; activeUntil: string }>
) {
  if (!readClient) {
    throw new Error('Authenticated RPC client required to send transactions.');
  }
  // Create UserOperation for ETH transfer
  // Use ERC-7579 execute(bytes32 mode, bytes executionData) format
  const modeCode = pad('0x01', { dir: 'right', size: 32 }); // simple batch execute

  // Encode execution data as Call[] array
  const executionData = encodeAbiParameters(
    [
      {
        components: [
          { name: 'to', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'data', type: 'bytes' }
        ],
        name: 'Call',
        type: 'tuple[]'
      }
    ],
    [txData]
  );

  // Encode execute(bytes32,bytes) call
  const callData = concat([
    '0xe9ae5c53', // execute(bytes32,bytes) selector
    encodeAbiParameters([{ type: 'bytes32' }, { type: 'bytes' }], [modeCode, executionData])
  ]);

  // Get nonce from EntryPoint
  const ENTRYPOINT_ABI = [
    {
      type: 'function',
      name: 'getNonce',
      inputs: [
        { name: 'sender', type: 'address' },
        { name: 'key', type: 'uint192' }
      ],
      outputs: [{ name: 'nonce', type: 'uint256' }],
      stateMutability: 'view'
    },
    {
      type: 'function',
      name: 'getUserOpHash',
      inputs: [
        {
          components: [
            { name: 'sender', type: 'address' },
            { name: 'nonce', type: 'uint256' },
            { name: 'initCode', type: 'bytes' },
            { name: 'callData', type: 'bytes' },
            { name: 'accountGasLimits', type: 'bytes32' },
            { name: 'preVerificationGas', type: 'uint256' },
            { name: 'gasFees', type: 'bytes32' },
            { name: 'paymasterAndData', type: 'bytes' },
            { name: 'signature', type: 'bytes' }
          ],
          name: 'userOp',
          type: 'tuple'
        }
      ],
      outputs: [{ name: 'hash', type: 'bytes32' }],
      stateMutability: 'view'
    }
  ];

  const nonce = await readClient.readContract({
    address: ssoContracts.entryPoint,
    abi: ENTRYPOINT_ABI,
    functionName: 'getNonce',
    args: [accountAddress, 0n],
    account: accountAddress
  });

  if (enableWalletToken && txData.length > 0) {
    const primaryCall = txData[0];
    const nonceNumber = Number(nonce);
    if (!Number.isSafeInteger(nonceNumber)) {
      throw new Error('Nonce too large to authorize transaction');
    }
    await enableWalletToken({
      walletAddress: accountAddress,
      contractAddress: primaryCall.to,
      nonce: nonceNumber,
      calldata: primaryCall.data
    });
  }

  // Create PackedUserOperation for v0.8
  const packedUserOp = {
    sender: accountAddress,
    nonce: nonce as bigint,
    initCode: '0x' as Hex,
    callData,
    accountGasLimits: gasOptions.accountGasLimits,
    preVerificationGas: gasOptions.preVerificationGas,
    gasFees: gasOptions.gasFees,
    paymasterAndData: '0x' as Hex,
    signature: '0x' as Hex
  };

  // Derive the hash exactly as EntryPoint computes it on-chain.
  const userOpHash = (await readClient.readContract({
    address: ssoContracts.entryPoint,
    abi: ENTRYPOINT_ABI,
    functionName: 'getUserOpHash',
    args: [packedUserOp],
    account: accountAddress
  })) as Hex;

  console.log('🔐 Requesting passkey authentication...');
  const signed = await signUserOpWithPasskey({
    hash: userOpHash,
    credentialId: passkeyCredentials.credentialId,
    validatorAddress: ssoContracts.webauthnValidator,
    rpId: window.location.hostname,
    origin: window.location.origin
  });
  packedUserOp.signature = signed.signature;

  if (signed.credentialId !== signed.expectedCredentialId) {
    const refreshedCredentials = {
      ...passkeyCredentials,
      credentialId: signed.credentialId
    };
    await assertPasskeyMatchesAccount({
      client: readClient,
      webauthnValidator: ssoContracts.webauthnValidator,
      accountAddress,
      passkeyCredentials: refreshedCredentials
    });
    savePasskeyCredentials(refreshedCredentials);
  }
  await assertPasskeyUserOpSignatureValid({
    client: readClient,
    validatorAddress: ssoContracts.webauthnValidator,
    accountAddress,
    userOpHash,
    signature: packedUserOp.signature
  });

  console.log('📤 Submitting UserOperation via Prividium RPC...');

  // Submit v0.8 packed format via authenticated RPC proxy
  const userOpForBundler = {
    sender: packedUserOp.sender,
    nonce: toHex(packedUserOp.nonce),
    factory: null, // No factory since account already deployed
    factoryData: null,
    callData: packedUserOp.callData,
    callGasLimit: toHex(gasOptions.callGasLimit),
    verificationGasLimit: toHex(gasOptions.verificationGasLimit),
    preVerificationGas: toHex(gasOptions.preVerificationGas),
    maxFeePerGas: toHex(gasOptions.maxFeePerGas),
    maxPriorityFeePerGas: toHex(gasOptions.maxPriorityFeePerGas),
    paymaster: null, // No paymaster
    paymasterVerificationGasLimit: null,
    paymasterPostOpGasLimit: null,
    paymasterData: null,
    signature: packedUserOp.signature
  };

  console.log('⏳ Waiting for confirmation...');
  const submission = await submitUserOpWithFallback({
    readClient,
    chainId: Number(readClient.chain?.id ?? 0),
    entryPoint: ssoContracts.entryPoint,
    userOp: userOpForBundler
  });
  const transactionHash = submission.txHash;
  console.log(`Source transaction confirmed: ${transactionHash}`);
  console.log('✅ Transfer successful!');
  return transactionHash;
}
