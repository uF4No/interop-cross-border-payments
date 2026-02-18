import {
  type Address,
  type Hex,
  type PublicClient,
  concat,
  encodeAbiParameters,
  keccak256,
  pad,
  parseAbiParameters,
  toBytes,
  toHex
} from 'viem';
import { requestPasskeyAuthentication } from 'zksync-sso-stable/client/passkey';
import { base64UrlToUint8Array, unwrapEC2Signature } from 'zksync-sso-stable/utils';

import { ssoChain, ssoContracts } from './constants';
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

  // Calculate UserOperation hash manually using EIP-712 for v0.8
  const PACKED_USEROP_TYPEHASH =
    '0x29a0bca4af4be3421398da00295e58e6d7de38cb492214754cb6a47507dd6f8e';

  // EIP-712 domain separator - use toBytes for proper string encoding
  const domainTypeHash = '0x8b73c3c69bb8fe3d512ecc4cf759cc79239f7b179b0ffacaa9a75d522b39400f';
  const nameHash = keccak256(toBytes('ERC4337'));
  const versionHash = keccak256(toBytes('1'));

  const domainSeparator = keccak256(
    encodeAbiParameters(parseAbiParameters('bytes32,bytes32,bytes32,uint256,address'), [
      domainTypeHash,
      nameHash,
      versionHash,
      BigInt(ssoChain.id),
      ssoContracts.entryPoint
    ])
  );

  // Hash the PackedUserOperation struct
  const structHash = keccak256(
    encodeAbiParameters(
      parseAbiParameters('bytes32,address,uint256,bytes32,bytes32,bytes32,uint256,bytes32,bytes32'),
      [
        PACKED_USEROP_TYPEHASH,
        packedUserOp.sender,
        packedUserOp.nonce,
        keccak256(packedUserOp.initCode),
        keccak256(packedUserOp.callData),
        packedUserOp.accountGasLimits,
        packedUserOp.preVerificationGas,
        packedUserOp.gasFees,
        keccak256(packedUserOp.paymasterAndData)
      ]
    )
  );

  // Final EIP-712 hash
  const userOpHash = keccak256(concat(['0x1901', domainSeparator, structHash]));

  console.log('🔐 Requesting passkey authentication...');

  // Sign with passkey
  const passkeySignature = await requestPasskeyAuthentication({
    challenge: userOpHash,
    credentialPublicKey: new Uint8Array(passkeyCredentials.credentialPublicKey)
  });

  // Parse signature using SDK utilities
  const response = passkeySignature.passkeyAuthenticationResponse.response;

  // Decode base64url encoded data
  const authenticatorDataHex = toHex(base64UrlToUint8Array(response.authenticatorData));
  const credentialIdHex = toHex(
    base64UrlToUint8Array(passkeySignature.passkeyAuthenticationResponse.id)
  );

  // Parse DER signature using SDK's unwrapEC2Signature
  const signatureData = unwrapEC2Signature(base64UrlToUint8Array(response.signature));

  // Ensure r and s are exactly 32 bytes (left-padded with zeros if needed)
  const r = pad(toHex(signatureData.r), { size: 32 });
  const s = pad(toHex(signatureData.s), { size: 32 });

  // Encode signature for ERC-4337 bundler (matching test format)
  const passkeySignatureEncoded = encodeAbiParameters(
    [
      { type: 'bytes' }, // authenticatorData
      { type: 'string' }, // clientDataJSON
      { type: 'bytes32[2]' }, // r and s as array
      { type: 'bytes' } // credentialId
    ],
    [
      authenticatorDataHex,
      new TextDecoder().decode(base64UrlToUint8Array(response.clientDataJSON)),
      [r, s],
      credentialIdHex
    ]
  );

  // Prepend validator address (ERC-4337 format)
  packedUserOp.signature = concat([ssoContracts.webauthnValidator, passkeySignatureEncoded]);

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

  type RpcRequestArgs = { method: string; params?: unknown[] };
  const rpcRequest = readClient.request as unknown as (args: RpcRequestArgs) => Promise<unknown>;

  // Submit to bundler (v0.8 RPC format)
  const userOpHashFromBundler = (await rpcRequest({
    method: 'eth_sendUserOperation',
    params: [userOpForBundler, ssoContracts.entryPoint]
  })) as `0x${string}`;
  console.log(`UserOperation submitted: ${userOpHashFromBundler}`);
  console.log('⏳ Waiting for confirmation...');

  // Poll for receipt
  type UserOpReceipt = { success: boolean; receipt: { transactionHash: `0x${string}` } };
  let receipt: UserOpReceipt | null = null;
  for (let i = 0; i < 30; i++) {
    await new Promise((resolve) => setTimeout(resolve, 2000));

    const receiptResult = await rpcRequest({
      method: 'eth_getUserOperationReceipt',
      params: [userOpHashFromBundler]
    });

    if (receiptResult) {
      receipt = receiptResult as UserOpReceipt;
      break;
    }
  }

  if (!receipt) {
    throw new Error('Transaction timeout - could not get receipt');
  }

  if (receipt.success) {
    console.log('RECEIPT:', receipt);
    console.log('✅ Transfer successful!');
    return receipt.receipt.transactionHash;
  }
  throw new Error('Transaction failed');
}
