import { computed } from 'vue';
import {
  type Address,
  type Hex,
  type PublicClient,
  concat,
  concatHex,
  decodeEventLog,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  isAddress,
  keccak256,
  pad,
  parseAbi,
  parseAbiParameters,
  toBytes,
  toHex
} from 'viem';
import { requestPasskeyAuthentication } from 'zksync-sso-stable/client/passkey';
import { base64UrlToUint8Array, unwrapEC2Signature } from 'zksync-sso-stable/utils';

import { usePrividium } from './usePrividium';
import { useRpcClient } from './useRpcClient';
import { useSsoAccount } from './useSsoAccount';
import type { CreateInvoiceSubmitPayload } from '@/utils/invoiceForm';
import {
  clearSavedAccountAddress,
  loadExistingPasskey,
  readAccountEntryPoint
} from '@/utils/sso/passkeys';
import type { PasskeyCredential } from '@/utils/sso/types';

type WalletAuthorizer = (params: {
  walletAddress: `0x${string}`;
  contractAddress: `0x${string}`;
  nonce: number;
  calldata: `0x${string}`;
}) => Promise<{ message: string; activeUntil: string }>;

type SourceChainKey = 'A' | 'B';
type BillingTokenSymbol = CreateInvoiceSubmitPayload['billingTokenSymbol'];

type GasOptions = {
  gasFees: Hex;
  accountGasLimits: Hex;
  callGasLimit: bigint;
  verificationGasLimit: bigint;
  preVerificationGas: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
};

type SourceInteropConfig = {
  chainKey: SourceChainKey;
  chainId: number;
  interopCenter?: Address;
  entryPoint?: Address;
  webauthnValidator?: Address;
};

type DestinationInteropConfig = {
  chainId?: number;
  invoicePayment?: Address;
  tokenAddresses: Record<BillingTokenSymbol, Address | undefined>;
};

type SendCreateInvoiceResult = {
  transactionHash: `0x${string}`;
  bundleHash?: `0x${string}`;
  destinationBillingToken: Address;
  sourceInteropCenter: Address;
  destinationInvoicePayment: Address;
  destinationChainId: number;
};

const env = import.meta.env as Record<string, string | undefined>;

const interopCenterAbi = parseAbi([
  'function sendBundle(bytes _destinationChainId, (bytes to, bytes data, bytes[] callAttributes)[] _callStarters, bytes[] _bundleAttributes) payable returns (bytes32)',
  'event InteropBundleSent(bytes32 l2l1MsgHash, bytes32 interopBundleHash, (bytes1 version, uint256 sourceChainId, uint256 destinationChainId, bytes32 interopBundleSalt, (bytes1 version, bool shadowAccount, address to, address from, uint256 value, bytes data)[] calls, (bytes executionAddress, bytes unbundlerAddress) bundleAttributes) interopBundle)'
]);

const invoicePaymentAbi = parseAbi([
  'function createInvoice(address recipient, uint256 recipientChainId, address billingToken, uint256 amount, uint256 creatorChainId, address creatorRefundAddress, address recipientRefundAddress, string text) returns (uint256 invoiceId)'
]);

const entryPointAbi = parseAbi([
  'function getNonce(address sender, uint192 key) view returns (uint256 nonce)'
]);

function readAddress(...keys: string[]): Address | undefined {
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value && isAddress(value)) {
      return getAddress(value);
    }
  }
  return undefined;
}

function readChainId(...keys: string[]): number | undefined {
  for (const key of keys) {
    const value = env[key]?.trim();
    if (!value) continue;

    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return undefined;
}

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

function buildGasOptions(): GasOptions {
  const callGasLimit = 500000n;
  const verificationGasLimit = 2000000n;
  const maxFeePerGas = 10000000000n;
  const maxPriorityFeePerGas = 5000000000n;
  const preVerificationGas = 200000n;

  const accountGasLimits = pad(toHex((verificationGasLimit << 128n) | callGasLimit), {
    size: 32
  });
  const gasFees = pad(toHex((maxPriorityFeePerGas << 128n) | maxFeePerGas), { size: 32 });

  return {
    gasFees,
    accountGasLimits,
    callGasLimit,
    verificationGasLimit,
    preVerificationGas,
    maxFeePerGas,
    maxPriorityFeePerGas
  };
}

function resolveSourceChainKey(chainId: number): SourceChainKey {
  const chainAId = readChainId('VITE_CHAIN_A_CHAIN_ID', 'VITE_PRIVIDIUM_CHAIN_A_ID', 'VITE_SSO_CHAIN_ID');
  const chainBId = readChainId('VITE_CHAIN_B_CHAIN_ID', 'VITE_PRIVIDIUM_CHAIN_B_ID');

  if (chainBId && chainId === chainBId) {
    return 'B';
  }

  if (chainAId && chainId === chainAId) {
    return 'A';
  }

  return 'A';
}

function getSourceInteropConfig(chainId: number): SourceInteropConfig {
  const chainKey = resolveSourceChainKey(chainId);

  return {
    chainKey,
    chainId,
    interopCenter: readAddress(`VITE_CHAIN_${chainKey}_INTEROP_CENTER`),
    entryPoint: readAddress(
      `VITE_SSO_ENTRYPOINT_CONTRACT_CHAIN_${chainKey}`,
      `VITE_SSO_ENTRYPOINT_CHAIN_${chainKey}`,
      'VITE_SSO_ENTRYPOINT'
    ),
    webauthnValidator: readAddress(
      `VITE_SSO_WEBAUTHN_VALIDATOR_CONTRACT_CHAIN_${chainKey}`,
      `VITE_SSO_WEBAUTHN_VALIDATOR_CHAIN_${chainKey}`,
      'VITE_SSO_WEBAUTHN_VALIDATOR'
    )
  };
}

function getDestinationInteropConfig(): DestinationInteropConfig {
  return {
    chainId: readChainId('VITE_CHAIN_C_CHAIN_ID'),
    invoicePayment: readAddress('VITE_CHAIN_C_INVOICE_PAYMENT', 'VITE_INVOICE_PAYMENT_CONTRACT'),
    tokenAddresses: {
      USDC: readAddress('VITE_TOKEN_USDC_ADDRESS_CHAIN_C'),
      SGD: readAddress('VITE_TOKEN_SGD_ADDRESS_CHAIN_C'),
      TBILL: readAddress('VITE_TOKEN_TBILL_ADDRESS_CHAIN_C')
    }
  };
}

async function sendTxWithPasskeyForChain(
  accountAddress: Address,
  passkeyCredentials: PasskeyCredential,
  txData: {
    to: Address;
    value: bigint;
    data: Hex;
  }[],
  gasOptions: GasOptions,
  readClient: PublicClient,
  sourceConfig: Required<Pick<SourceInteropConfig, 'chainId' | 'entryPoint' | 'webauthnValidator'>>,
  enableWalletToken?: WalletAuthorizer
) {
  const modeCode = pad('0x01', { dir: 'right', size: 32 });

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

  const callData = concat([
    '0xe9ae5c53',
    encodeAbiParameters([{ type: 'bytes32' }, { type: 'bytes' }], [modeCode, executionData])
  ]);

  const nonce = await readClient.readContract({
    address: sourceConfig.entryPoint,
    abi: entryPointAbi,
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

  const packedUserOpTypehash =
    '0x29a0bca4af4be3421398da00295e58e6d7de38cb492214754cb6a47507dd6f8e';
  const domainTypeHash = '0x8b73c3c69bb8fe3d512ecc4cf759cc79239f7b179b0ffacaa9a75d522b39400f';
  const nameHash = keccak256(toBytes('ERC4337'));
  const versionHash = keccak256(toBytes('1'));

  const domainSeparator = keccak256(
    encodeAbiParameters(parseAbiParameters('bytes32,bytes32,bytes32,uint256,address'), [
      domainTypeHash,
      nameHash,
      versionHash,
      BigInt(sourceConfig.chainId),
      sourceConfig.entryPoint
    ])
  );

  const structHash = keccak256(
    encodeAbiParameters(
      parseAbiParameters('bytes32,address,uint256,bytes32,bytes32,bytes32,uint256,bytes32,bytes32'),
      [
        packedUserOpTypehash,
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

  const userOpHash = keccak256(concat(['0x1901', domainSeparator, structHash]));

  const passkeySignature = await requestPasskeyAuthentication({
    challenge: userOpHash,
    credentialPublicKey: new Uint8Array(passkeyCredentials.credentialPublicKey)
  });

  const response = passkeySignature.passkeyAuthenticationResponse.response;
  const authenticatorDataHex = toHex(base64UrlToUint8Array(response.authenticatorData));
  const credentialIdHex = toHex(
    base64UrlToUint8Array(passkeySignature.passkeyAuthenticationResponse.id)
  );
  const signatureData = unwrapEC2Signature(base64UrlToUint8Array(response.signature));
  const r = pad(toHex(signatureData.r), { size: 32 });
  const s = pad(toHex(signatureData.s), { size: 32 });

  const passkeySignatureEncoded = encodeAbiParameters(
    [{ type: 'bytes' }, { type: 'string' }, { type: 'bytes32[2]' }, { type: 'bytes' }],
    [
      authenticatorDataHex,
      new TextDecoder().decode(base64UrlToUint8Array(response.clientDataJSON)),
      [r, s],
      credentialIdHex
    ]
  );

  packedUserOp.signature = concat([sourceConfig.webauthnValidator, passkeySignatureEncoded]);

  const userOpForBundler = {
    sender: packedUserOp.sender,
    nonce: toHex(packedUserOp.nonce),
    factory: null,
    factoryData: null,
    callData: packedUserOp.callData,
    callGasLimit: toHex(gasOptions.callGasLimit),
    verificationGasLimit: toHex(gasOptions.verificationGasLimit),
    preVerificationGas: toHex(gasOptions.preVerificationGas),
    maxFeePerGas: toHex(gasOptions.maxFeePerGas),
    maxPriorityFeePerGas: toHex(gasOptions.maxPriorityFeePerGas),
    paymaster: null,
    paymasterVerificationGasLimit: null,
    paymasterPostOpGasLimit: null,
    paymasterData: null,
    signature: packedUserOp.signature
  };

  type RpcRequestArgs = { method: string; params?: unknown[] };
  const rpcRequest = readClient.request as unknown as (args: RpcRequestArgs) => Promise<unknown>;

  const userOpHashFromBundler = (await rpcRequest({
    method: 'eth_sendUserOperation',
    params: [userOpForBundler, sourceConfig.entryPoint]
  })) as `0x${string}`;

  type UserOpReceipt = { success: boolean; receipt: { transactionHash: `0x${string}` } };
  let receipt: UserOpReceipt | null = null;

  for (let attempt = 0; attempt < 30; attempt += 1) {
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

  if (!receipt.success) {
    throw new Error('Transaction failed');
  }

  return receipt.receipt.transactionHash;
}

function extractBundleHash(
  receipt: Awaited<ReturnType<PublicClient['getTransactionReceipt']>>,
  interopCenter: Address
): `0x${string}` | undefined {
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== interopCenter.toLowerCase()) {
      continue;
    }

    try {
      const decoded = decodeEventLog({
        abi: interopCenterAbi,
        data: log.data,
        topics: log.topics
      });

      if (decoded.eventName === 'InteropBundleSent') {
        return decoded.args.interopBundleHash;
      }
    } catch {
      // Ignore unrelated logs.
    }
  }

  return undefined;
}

export function useInteropInvoice() {
  const rpcClient = useRpcClient();
  const { enableWalletToken, getChain } = usePrividium();
  const { account } = useSsoAccount();

  const sourceConfig = computed(() => getSourceInteropConfig(Number(getChain().id)));
  const destinationConfig = computed(() => getDestinationInteropConfig());

  const sendCreateInvoiceBundle = async (
    payload: CreateInvoiceSubmitPayload
  ): Promise<SendCreateInvoiceResult> => {
    const currentRpcClient = rpcClient.value;
    if (!currentRpcClient) {
      throw new Error('Authenticated RPC client not available.');
    }

    const resolvedSourceConfig = sourceConfig.value;
    const resolvedDestinationConfig = destinationConfig.value;
    const interopCenter = resolvedSourceConfig.interopCenter;
    const entryPoint = resolvedSourceConfig.entryPoint;
    const webauthnValidator = resolvedSourceConfig.webauthnValidator;
    const destinationChainId = resolvedDestinationConfig.chainId;
    const destinationInvoicePayment = resolvedDestinationConfig.invoicePayment;
    const destinationBillingToken = resolvedDestinationConfig.tokenAddresses[payload.billingTokenSymbol];

    if (!interopCenter) {
      throw new Error(`Missing interop center address for chain ${resolvedSourceConfig.chainKey}.`);
    }
    if (!entryPoint || !webauthnValidator) {
      throw new Error(
        `Missing SSO validator or entrypoint config for chain ${resolvedSourceConfig.chainKey}.`
      );
    }
    if (!destinationChainId || !destinationInvoicePayment) {
      throw new Error('Missing chain C destination config for InvoicePayment.');
    }
    if (!destinationBillingToken) {
      throw new Error(`Missing chain C token address for ${payload.billingTokenSymbol}.`);
    }

    const { savedPasskey, savedAccount } = loadExistingPasskey();
    if (!savedPasskey || !savedAccount) {
      throw new Error('No SSO account found. Create and link a passkey first.');
    }

    if (account.value && account.value.toLowerCase() !== savedAccount.toLowerCase()) {
      throw new Error('Linked passkey account does not match the current SSO session.');
    }

    const accountEntryPoint = await readAccountEntryPoint(currentRpcClient, savedAccount);
    if (accountEntryPoint && accountEntryPoint.toLowerCase() !== entryPoint.toLowerCase()) {
      clearSavedAccountAddress();
      throw new Error(
        `Linked passkey account was created for EntryPoint ${accountEntryPoint}, but chain ${resolvedSourceConfig.chainKey} expects ${entryPoint}. Re-login and create/link a compatible passkey account.`
      );
    }

    const createInvoiceData = encodeFunctionData({
      abi: invoicePaymentAbi,
      functionName: 'createInvoice',
      args: [
        payload.recipient,
        BigInt(payload.recipientChainId),
        destinationBillingToken,
        payload.amount,
        BigInt(payload.creatorChainId),
        payload.creatorRefundAddress,
        payload.recipientRefundAddress,
        payload.text
      ]
    });

    const sendBundleData = encodeFunctionData({
      abi: interopCenterAbi,
      functionName: 'sendBundle',
      args: [
        formatEvmV1(BigInt(destinationChainId)),
        [
          {
            to: formatEvmV1AddressOnly(destinationInvoicePayment),
            data: createInvoiceData,
            // InvoicePayment exists only on chain C, so this must remain a direct interop call.
            callAttributes: []
          }
        ],
        []
      ]
    });

    const transactionHash = await sendTxWithPasskeyForChain(
      savedAccount,
      savedPasskey,
      [
        {
          to: interopCenter,
          value: 0n,
          data: sendBundleData
        }
      ],
      buildGasOptions(),
      currentRpcClient,
      {
        chainId: resolvedSourceConfig.chainId,
        entryPoint,
        webauthnValidator
      },
      enableWalletToken as WalletAuthorizer
    );

    const receipt = await currentRpcClient.getTransactionReceipt({ hash: transactionHash });

    return {
      transactionHash,
      bundleHash: extractBundleHash(receipt, interopCenter),
      destinationBillingToken,
      sourceInteropCenter: interopCenter,
      destinationInvoicePayment,
      destinationChainId
    };
  };

  return {
    sourceConfig,
    destinationConfig,
    sendCreateInvoiceBundle
  };
}
