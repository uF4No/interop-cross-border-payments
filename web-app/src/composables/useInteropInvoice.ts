import { computed } from 'vue';
import {
  createPublicClient,
  defineChain,
  type Address,
  type Hex,
  type PublicClient,
  concat,
  concatHex,
  encodeAbiParameters,
  encodeFunctionData,
  formatUnits,
  getAddress,
  http,
  isAddress,
  pad,
  parseAbi,
  toHex
} from 'viem';

import { usePrividium } from './usePrividium';
import { useRpcClient } from './useRpcClient';
import type { CreateInvoiceSubmitPayload } from '@/utils/invoiceForm';
import {
  assertPasskeyMatchesAccount,
  clearSavedAccountAddress,
  loadExistingPasskey,
  readAccountEntryPoint,
  savePasskeyCredentials
} from '@/utils/sso/passkeys';
import {
  assertPasskeyUserOpSignatureValid,
  signUserOpWithPasskey
} from '@/utils/sso/signUserOpWithPasskey';
import {
  submitUserOpWithFallback,
  type UserOpSubmissionResult
} from '@/utils/sso/submitUserOpWithFallback';
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
  nativeTokenVault?: Address;
  interopCenter?: Address;
  entryPoint?: Address;
  webauthnValidator?: Address;
  tokenAddresses: Record<BillingTokenSymbol, Address | undefined>;
  tokenAssetIds: Record<BillingTokenSymbol, Hex | undefined>;
};

type DestinationInteropConfig = {
  chainId?: number;
  rpcUrl?: string;
  invoicePayment?: Address;
  relayAddress?: Address;
  interopHandler?: Address;
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

type SendPayInvoicePayload = {
  invoiceId: string;
  paymentAmount: string;
  paymentToken: Address;
  payerRefundAddress?: Address;
};

type FundPayInvoiceResult = {
  approvalTransactionHash?: `0x${string}`;
  transactionHash?: `0x${string}`;
  bundleHash?: `0x${string}`;
  paymentToken: Address;
  paymentTokenSymbol: BillingTokenSymbol;
  paymentAmount: bigint;
  requiredFundingAmount: bigint;
  shadowAccount: Address;
  destinationBalanceBeforeFunding: bigint;
  sourceInteropCenter: Address;
  destinationInvoicePayment: Address;
  destinationChainId: number;
};

type SettlePayInvoiceResult = {
  transactionHash: `0x${string}`;
  bundleHash?: `0x${string}`;
  paymentToken: Address;
  shadowAccount: Address;
  sourceInteropCenter: Address;
  destinationInvoicePayment: Address;
  destinationChainId: number;
};

type ReadPayInvoicePreflightPayload = {
  creatorChainId: number;
};

type ReadPayInvoicePreflightResult = {
  crossChainFee: bigint;
  destinationChainId: number;
  invoicePaymentBalance: bigint;
  hasSufficientInvoicePaymentBalance: boolean;
  requiresCrossChainPayout: boolean;
};

type ReadDestinationTokenBalancePayload = {
  token: Address;
  account: Address;
};

type ResolvedInteropSession = {
  rpcClient: PublicClient;
  sourceChainId: number;
  sourceChainKey: SourceChainKey;
  interopCenter: Address;
  entryPoint: Address;
  webauthnValidator: Address;
  destinationChainId: number;
  destinationInvoicePayment: Address;
  destinationRelayAddress: Address;
  savedAccount: Address;
  savedPasskey: PasskeyCredential;
};

type DestinationCallStarter = {
  to: Address;
  data: Hex;
  callAttributes: Hex[];
};

type PayInvoiceContext = {
  paymentAmount: bigint;
  paymentToken: Address;
  payerRefundAddress: Address;
  session: ResolvedInteropSession;
  sourceToken: Address;
  sourceAssetId: Hex;
  symbol: BillingTokenSymbol;
  destinationChainId: number;
  destinationRpcUrl: string;
  destinationInteropHandler: Address;
  shadowAccount: Address;
  destinationBalance: bigint;
};

const env = import.meta.env as Record<string, string | undefined>;
const L2_ASSET_ROUTER_ADDRESS = '0x0000000000000000000000000000000000010003' as Address;
const L2_INTEROP_HANDLER_ADDRESS = '0x000000000000000000000000000000000001000d' as Address;
const L2_NATIVE_TOKEN_VAULT_ADDRESS = '0x0000000000000000000000000000000000010004' as Address;
const NEW_ENCODING_VERSION = '0x01' as Hex;
const INDIRECT_CALL_ATTRIBUTE_SELECTOR = '0xc8496ea7' as Hex;
const SHADOW_ACCOUNT_ATTRIBUTE_SELECTOR = '0x3569f7f7' as Hex;
const UNBUNDLER_ATTRIBUTE_SELECTOR = '0xb9c86698' as Hex;
const LOCAL_INTEROP_RELAY_ADDRESS = '0x36615Cf349d7F6344891B1e7CA7C72883F5dc049' as Address;
const MAX_UINT256 = (1n << 256n) - 1n;

const interopCenterAbi = parseAbi([
  'function sendBundle(bytes _destinationChainId, (bytes to, bytes data, bytes[] callAttributes)[] _callStarters, bytes[] _bundleAttributes) payable returns (bytes32)',
  'event InteropBundleSent(bytes32 l2l1MsgHash, bytes32 interopBundleHash, (bytes1 version, uint256 sourceChainId, uint256 destinationChainId, bytes32 interopBundleSalt, (bytes1 version, bool shadowAccount, address to, address from, uint256 value, bytes data)[] calls, (bytes executionAddress, bytes unbundlerAddress) bundleAttributes) interopBundle)'
]);

const invoicePaymentAbi = parseAbi([
  'function createInvoice(address recipient, uint256 recipientChainId, address billingToken, uint256 amount, uint256 creatorChainId, address creatorRefundAddress, address recipientRefundAddress, string text) returns (uint256 invoiceId)',
  'function payInvoice(uint256 invoiceId, address paymentToken) payable',
  'function crossChainFee() view returns (uint256)'
]);

const erc20Abi = parseAbi([
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 value) returns (bool)',
  'function balanceOf(address owner) view returns (uint256)'
]);

const entryPointAbi = parseAbi([
  'function getNonce(address sender, uint192 key) view returns (uint256 nonce)',
  'function getUserOpHash((address sender,uint256 nonce,bytes initCode,bytes callData,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData,bytes signature) userOp) view returns (bytes32)',
  'function balanceOf(address account) view returns (uint256)'
]);

const interopHandlerAbi = parseAbi([
  'function getShadowAccountAddress(uint256 ownerChainId, address ownerAddress) view returns (address)'
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

function readHex(...keys: string[]): Hex | undefined {
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value && /^0x[0-9a-fA-F]+$/.test(value)) {
      return value as Hex;
    }
  }
  return undefined;
}

function readUrl(...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value) {
      return value;
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

function shadowAccountAttribute(): Hex {
  return SHADOW_ACCOUNT_ATTRIBUTE_SELECTOR;
}

function readInteropRelayAddress(): Address | undefined {
  const configured = readAddress('VITE_CHAIN_C_INTEROP_RELAY_ADDRESS', 'VITE_INTEROP_RELAY_ADDRESS');
  if (configured) {
    return configured;
  }

  const endpoints = [
    env.VITE_BACKEND_URL?.trim(),
    env.VITE_CHAIN_A_RPC_URL?.trim(),
    env.VITE_CHAIN_C_RPC_URL?.trim()
  ].filter((value): value is string => Boolean(value));

  const looksLocalStack = endpoints.some((value) =>
    /(^https?:\/\/)?(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(value)
  );

  return looksLocalStack ? LOCAL_INTEROP_RELAY_ADDRESS : undefined;
}

function readInteropHandlerAddress(): Address | undefined {
  const configured = readAddress('VITE_CHAIN_C_INTEROP_HANDLER');
  if (configured) {
    return configured;
  }

  const endpoints = [env.VITE_CHAIN_C_RPC_URL?.trim(), env.VITE_BACKEND_URL?.trim()].filter(
    (value): value is string => Boolean(value)
  );
  const looksLocalStack = endpoints.some((value) =>
    /(^https?:\/\/)?(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(value)
  );

  return looksLocalStack ? L2_INTEROP_HANDLER_ADDRESS : undefined;
}

function buildGasOptions(): GasOptions {
  const callGasLimit = 500000n;
  const verificationGasLimit = 2000000n;
  const maxFeePerGas = 10000000000n;
  // Chain A/B bundler expects legacy-style pricing on these local chains.
  const maxPriorityFeePerGas = maxFeePerGas;
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
    nativeTokenVault: readAddress(`VITE_CHAIN_${chainKey}_NATIVE_TOKEN_VAULT`) ?? L2_NATIVE_TOKEN_VAULT_ADDRESS,
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
    ),
    tokenAddresses: {
      USDC: readAddress(`VITE_TOKEN_USDC_ADDRESS_CHAIN_${chainKey}`, 'VITE_TOKEN_USDC_ADDRESS'),
      SGD: readAddress(`VITE_TOKEN_SGD_ADDRESS_CHAIN_${chainKey}`, 'VITE_TOKEN_SGD_ADDRESS'),
      TBILL: readAddress(`VITE_TOKEN_TBILL_ADDRESS_CHAIN_${chainKey}`, 'VITE_TOKEN_TBILL_ADDRESS')
    },
    tokenAssetIds: {
      USDC: readHex(`VITE_TOKEN_USDC_ASSET_ID_CHAIN_${chainKey}`),
      SGD: readHex(`VITE_TOKEN_SGD_ASSET_ID_CHAIN_${chainKey}`),
      TBILL: readHex(`VITE_TOKEN_TBILL_ASSET_ID_CHAIN_${chainKey}`)
    }
  };
}

function getDestinationInteropConfig(): DestinationInteropConfig {
  return {
    chainId: readChainId('VITE_CHAIN_C_CHAIN_ID'),
    rpcUrl: readUrl('VITE_CHAIN_C_RPC_URL'),
    invoicePayment: readAddress('VITE_CHAIN_C_INVOICE_PAYMENT', 'VITE_INVOICE_PAYMENT_CONTRACT'),
    relayAddress: readInteropRelayAddress(),
    interopHandler: readInteropHandlerAddress(),
    tokenAddresses: {
      USDC: readAddress('VITE_TOKEN_USDC_ADDRESS_CHAIN_C'),
      SGD: readAddress('VITE_TOKEN_SGD_ADDRESS_CHAIN_C'),
      TBILL: readAddress('VITE_TOKEN_TBILL_ADDRESS_CHAIN_C')
    }
  };
}

function createReadOnlyClient(chainId: number, rpcUrl: string) {
  return createPublicClient({
    chain: defineChain({
      id: chainId,
      name: `Prividium Chain ${chainId}`,
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: {
        default: { http: [rpcUrl] },
        public: { http: [rpcUrl] }
      }
    }),
    transport: http(rpcUrl)
  });
}

function formatTokenAmount(amount: bigint) {
  return formatUnits(amount, 18);
}

function estimateRequiredUserOpPrefund(gasOptions: GasOptions) {
  return (
    gasOptions.callGasLimit + gasOptions.verificationGasLimit + gasOptions.preVerificationGas
  ) * gasOptions.maxFeePerGas;
}

async function assertSufficientUserOpPrefund(params: {
  accountAddress: Address;
  gasOptions: GasOptions;
  readClient: PublicClient;
  entryPoint: Address;
  chainKey: SourceChainKey;
}) {
  const [accountBalance, entryPointDeposit] = await Promise.all([
    params.readClient.getBalance({ address: params.accountAddress }),
    params.readClient.readContract({
      address: params.entryPoint,
      abi: entryPointAbi,
      functionName: 'balanceOf',
      args: [params.accountAddress],
      account: params.accountAddress
    }) as Promise<bigint>
  ]);

  const availablePrefund = accountBalance + entryPointDeposit;
  const requiredPrefund = estimateRequiredUserOpPrefund(params.gasOptions);

  if (availablePrefund >= requiredPrefund) {
    return;
  }

  throw new Error(
    `Insufficient ETH on source chain ${params.chainKey} to cover the user-op prefund. Need about ${formatUnits(requiredPrefund, 18)} ETH across the wallet balance and EntryPoint deposit, but only ${formatUnits(availablePrefund, 18)} ETH is available. Use Get test funds and retry.`
  );
}

function resolveConfiguredPaymentToken(
  paymentToken: Address,
  source: SourceInteropConfig,
  destination: DestinationInteropConfig
) {
  const symbol = (Object.entries(destination.tokenAddresses) as Array<
    [BillingTokenSymbol, Address | undefined]
  >).find(
    ([, tokenAddress]) =>
      tokenAddress !== undefined && tokenAddress.toLowerCase() === paymentToken.toLowerCase()
  )?.[0];

  if (!symbol) {
    throw new Error(
      `Payment token ${paymentToken} is not one of the configured chain C invoice tokens.`
    );
  }

  const sourceToken = source.tokenAddresses[symbol];
  const sourceAssetId = source.tokenAssetIds[symbol];

  if (!sourceToken) {
    throw new Error(
      `Missing source-chain ${symbol} token address for chain ${source.chainKey}.`
    );
  }
  if (!sourceAssetId) {
    throw new Error(`Missing source-chain ${symbol} asset ID for chain ${source.chainKey}.`);
  }

  return {
    symbol,
    sourceAssetId,
    sourceToken
  };
}

function buildTokenTransferCall(
  sourceAssetId: Hex,
  amount: bigint,
  recipient: Address
): DestinationCallStarter {
  const burnData = encodeAbiParameters(
    [{ type: 'uint256' }, { type: 'address' }, { type: 'address' }],
    [amount, recipient, '0x0000000000000000000000000000000000000000']
  );
  const data = concatHex([
    NEW_ENCODING_VERSION,
    encodeAbiParameters([{ type: 'bytes32' }, { type: 'bytes' }], [sourceAssetId, burnData])
  ]);

  return {
    to: L2_ASSET_ROUTER_ADDRESS,
    data,
    callAttributes: [indirectCallAttribute(0n)]
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
): Promise<UserOpSubmissionResult> {
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

  await assertSufficientUserOpPrefund({
    accountAddress,
    gasOptions,
    readClient,
    entryPoint: sourceConfig.entryPoint,
    chainKey: resolveSourceChainKey(sourceConfig.chainId)
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

  const userOpHash = (await readClient.readContract({
    address: sourceConfig.entryPoint,
    abi: entryPointAbi,
    functionName: 'getUserOpHash',
    args: [packedUserOp],
    account: accountAddress
  })) as Hex;

  const signed = await signUserOpWithPasskey({
    hash: userOpHash,
    credentialId: passkeyCredentials.credentialId,
    validatorAddress: sourceConfig.webauthnValidator,
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
      webauthnValidator: sourceConfig.webauthnValidator,
      accountAddress,
      passkeyCredentials: refreshedCredentials
    });
    savePasskeyCredentials(refreshedCredentials);
  }
  await assertPasskeyUserOpSignatureValid({
    client: readClient,
    validatorAddress: sourceConfig.webauthnValidator,
    accountAddress,
    userOpHash,
    signature: packedUserOp.signature
  });

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

  return await submitUserOpWithFallback({
    readClient,
    chainId: sourceConfig.chainId,
    entryPoint: sourceConfig.entryPoint,
    userOp: userOpForBundler
  });
}

function buildSendBundleData(
  destinationChainId: number,
  destinationRelayAddress: Address,
  callStarters: DestinationCallStarter[]
) {
  return encodeFunctionData({
    abi: interopCenterAbi,
    functionName: 'sendBundle',
    args: [
      formatEvmV1(BigInt(destinationChainId)),
      callStarters.map((callStarter) => ({
        to: formatEvmV1AddressOnly(callStarter.to),
        data: callStarter.data,
        callAttributes: callStarter.callAttributes
      })),
      [unbundlerAddressAttribute(destinationRelayAddress)]
    ]
  });
}

async function resolveInteropSession(
  rpcClient: PublicClient,
  linkedWallets: Address[],
  resolvedSourceConfig: SourceInteropConfig,
  resolvedDestinationConfig: DestinationInteropConfig
): Promise<ResolvedInteropSession> {
  const interopCenter = resolvedSourceConfig.interopCenter;
  const entryPoint = resolvedSourceConfig.entryPoint;
  const webauthnValidator = resolvedSourceConfig.webauthnValidator;
  const destinationChainId = resolvedDestinationConfig.chainId;
  const destinationInvoicePayment = resolvedDestinationConfig.invoicePayment;
  const destinationRelayAddress = resolvedDestinationConfig.relayAddress;

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
  if (!destinationRelayAddress) {
    throw new Error(
      'Missing chain C interop relay address. Set VITE_INTEROP_RELAY_ADDRESS or VITE_CHAIN_C_INTEROP_RELAY_ADDRESS.'
    );
  }

  const { savedPasskey, savedAccount } = loadExistingPasskey();
  if (!savedPasskey || !savedAccount) {
    throw new Error('No SSO account found. Create and link a passkey first.');
  }

  if (
    linkedWallets.length > 0 &&
    !linkedWallets.some((walletAddress) => walletAddress.toLowerCase() === savedAccount.toLowerCase())
  ) {
    throw new Error(
      'Selected passkey account is not linked to the authenticated profile on the current chain. Re-login with that chain and re-select the passkey.'
    );
  }

  const accountEntryPoint = await readAccountEntryPoint(rpcClient, savedAccount);
  if (accountEntryPoint && accountEntryPoint.toLowerCase() !== entryPoint.toLowerCase()) {
    clearSavedAccountAddress();
    throw new Error(
      `Linked passkey account was created for EntryPoint ${accountEntryPoint}, but chain ${resolvedSourceConfig.chainKey} expects ${entryPoint}. Re-login and create/link a compatible passkey account.`
    );
  }

  await assertPasskeyMatchesAccount({
    client: rpcClient,
    webauthnValidator,
    accountAddress: savedAccount,
    passkeyCredentials: savedPasskey
  });

  return {
    rpcClient,
    sourceChainId: resolvedSourceConfig.chainId,
    sourceChainKey: resolvedSourceConfig.chainKey,
    interopCenter,
    entryPoint,
    webauthnValidator,
    destinationChainId,
    destinationInvoicePayment,
    destinationRelayAddress,
    savedAccount,
    savedPasskey
  };
}

async function submitInteropBundle(
  session: ResolvedInteropSession,
  callStarters: DestinationCallStarter[],
  enableWalletToken?: WalletAuthorizer
) {
  const sendBundleData = buildSendBundleData(
    session.destinationChainId,
    session.destinationRelayAddress,
    callStarters
  );

  return await sendTxWithPasskeyForChain(
    session.savedAccount,
    session.savedPasskey,
    [
      {
        to: session.interopCenter,
        value: 0n,
        data: sendBundleData
      }
    ],
    buildGasOptions(),
    session.rpcClient,
    {
      chainId: session.sourceChainId,
      entryPoint: session.entryPoint,
      webauthnValidator: session.webauthnValidator
    },
    enableWalletToken
  );
}

async function resolvePayInvoiceContext(
  payload: SendPayInvoicePayload,
  rpcClient: PublicClient,
  resolvedSourceConfig: SourceInteropConfig,
  resolvedDestinationConfig: DestinationInteropConfig,
  refreshUserProfile: () => Promise<unknown>,
  userWallets: string[]
): Promise<PayInvoiceContext> {
  const invoiceId = payload.invoiceId.trim();
  const paymentAmount = BigInt(payload.paymentAmount);

  if (!/^\d+$/.test(invoiceId)) {
    throw new Error('Invalid invoice ID.');
  }
  if (paymentAmount <= 0n) {
    throw new Error('Invalid payment amount.');
  }

  await refreshUserProfile();
  const linkedWallets = userWallets
    .map((walletAddress) => getAddress(walletAddress))
    .filter((walletAddress, index, all) => all.indexOf(walletAddress) === index);

  const session = await resolveInteropSession(
    rpcClient,
    linkedWallets,
    resolvedSourceConfig,
    resolvedDestinationConfig
  );

  const payerRefundAddress = payload.payerRefundAddress
    ? getAddress(payload.payerRefundAddress)
    : session.savedAccount;
  if (payerRefundAddress.toLowerCase() !== session.savedAccount.toLowerCase()) {
    throw new Error(
      `Active passkey account ${session.savedAccount} does not match invoice recipient ${payerRefundAddress}. Re-select the correct passkey account and retry.`
    );
  }

  const paymentToken = getAddress(payload.paymentToken);
  const { sourceToken, sourceAssetId, symbol } = resolveConfiguredPaymentToken(
    paymentToken,
    resolvedSourceConfig,
    resolvedDestinationConfig
  );

  if (!resolvedSourceConfig.nativeTokenVault) {
    throw new Error(
      `Missing native token vault address for source chain ${resolvedSourceConfig.chainKey}.`
    );
  }
  if (!resolvedDestinationConfig.rpcUrl || !resolvedDestinationConfig.interopHandler) {
    throw new Error('Missing chain C RPC URL or interop handler configuration.');
  }

  const destinationChainId = resolvedDestinationConfig.chainId;
  const destinationRpcUrl = resolvedDestinationConfig.rpcUrl;
  const destinationInteropHandler = resolvedDestinationConfig.interopHandler;
  if (!destinationChainId) {
    throw new Error('Missing chain C destination chain ID.');
  }

  const destinationClient = createReadOnlyClient(destinationChainId, destinationRpcUrl);
  const shadowAccount = getAddress(
    (await destinationClient.readContract({
      address: destinationInteropHandler,
      abi: interopHandlerAbi,
      functionName: 'getShadowAccountAddress',
      args: [BigInt(session.sourceChainId), payerRefundAddress]
    })) as Address
  );
  const destinationBalance = (await destinationClient.readContract({
    address: paymentToken,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [shadowAccount]
  })) as bigint;

  return {
    paymentAmount,
    paymentToken,
    payerRefundAddress,
    session,
    sourceToken,
    sourceAssetId,
    symbol,
    destinationChainId,
    destinationRpcUrl,
    destinationInteropHandler,
    shadowAccount,
    destinationBalance
  };
}

export function useInteropInvoice() {
  const rpcClient = useRpcClient();
  const { enableWalletToken, getChain, refreshUserProfile, userWallets } = usePrividium();

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
    const destinationBillingToken = resolvedDestinationConfig.tokenAddresses[payload.billingTokenSymbol];
    await refreshUserProfile();
    const linkedWallets = userWallets.value
      .map((walletAddress) => getAddress(walletAddress))
      .filter((walletAddress, index, all) => all.indexOf(walletAddress) === index);

    if (!destinationBillingToken) {
      throw new Error(`Missing chain C token address for ${payload.billingTokenSymbol}.`);
    }

    const session = await resolveInteropSession(
      currentRpcClient,
      linkedWallets,
      resolvedSourceConfig,
      resolvedDestinationConfig
    );

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

    const submission = await submitInteropBundle(
      session,
      [
        {
          to: session.destinationInvoicePayment,
          data: createInvoiceData,
          // InvoicePayment validates cross-chain creators via the deterministic shadow account.
          callAttributes: [shadowAccountAttribute()]
        }
      ],
      enableWalletToken as WalletAuthorizer
    );

    return {
      transactionHash: submission.txHash,
      bundleHash: submission.bundleHash,
      destinationBillingToken,
      sourceInteropCenter: session.interopCenter,
      destinationInvoicePayment: session.destinationInvoicePayment,
      destinationChainId: session.destinationChainId
    };
  };

  const sendFundPayInvoiceBundle = async (
    payload: SendPayInvoicePayload
  ): Promise<FundPayInvoiceResult> => {
    const currentRpcClient = rpcClient.value;
    if (!currentRpcClient) {
      throw new Error('Authenticated RPC client not available.');
    }

    const resolvedSourceConfig = sourceConfig.value;
    const resolvedDestinationConfig = destinationConfig.value;
    const nativeTokenVault = resolvedSourceConfig.nativeTokenVault;
    const {
      paymentAmount,
      paymentToken,
      payerRefundAddress,
      session,
      sourceToken,
      sourceAssetId,
      symbol,
      shadowAccount,
      destinationBalance
    } = await resolvePayInvoiceContext(
      payload,
      currentRpcClient,
      resolvedSourceConfig,
      resolvedDestinationConfig,
      refreshUserProfile,
      userWallets.value
    );

    if (!nativeTokenVault) {
      throw new Error(
        `Missing native token vault address for source chain ${resolvedSourceConfig.chainKey}.`
      );
    }

    const sourceBalance = (await currentRpcClient.readContract({
      address: sourceToken,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [payerRefundAddress],
      account: payerRefundAddress
    })) as bigint;

    if (sourceBalance < paymentAmount) {
      throw new Error(
        `Insufficient ${symbol} balance on source chain ${resolvedSourceConfig.chainKey}. Need ${formatTokenAmount(paymentAmount)} but linked wallet holds ${formatTokenAmount(sourceBalance)}.`
      );
    }

    const requiredFundingAmount =
      destinationBalance >= paymentAmount ? 0n : paymentAmount - destinationBalance;

    const allowance = (await currentRpcClient.readContract({
      address: sourceToken,
      abi: erc20Abi,
      functionName: 'allowance',
      args: [payerRefundAddress, nativeTokenVault],
      account: payerRefundAddress
    })) as bigint;

    let approvalTransactionHash: `0x${string}` | undefined;
    if (requiredFundingAmount > 0n && allowance < requiredFundingAmount) {
      const approveSourceVaultData = encodeFunctionData({
        abi: erc20Abi,
        functionName: 'approve',
        args: [nativeTokenVault, requiredFundingAmount]
      });

      const approvalSubmission = await sendTxWithPasskeyForChain(
        session.savedAccount,
        session.savedPasskey,
        [
          {
            to: sourceToken,
            value: 0n,
            data: approveSourceVaultData
          }
        ],
        buildGasOptions(),
        session.rpcClient,
        {
          chainId: session.sourceChainId,
          entryPoint: session.entryPoint,
          webauthnValidator: session.webauthnValidator
        },
        enableWalletToken as WalletAuthorizer
      );
      approvalTransactionHash = approvalSubmission.txHash;
    }

    let transactionHash: `0x${string}` | undefined;
    let bundleHash: `0x${string}` | undefined;
    if (requiredFundingAmount > 0n) {
      const submission = await submitInteropBundle(
        session,
        [buildTokenTransferCall(sourceAssetId, requiredFundingAmount, shadowAccount)],
        enableWalletToken as WalletAuthorizer
      );
      transactionHash = submission.txHash;
      bundleHash = submission.bundleHash;
    }

    return {
      approvalTransactionHash,
      transactionHash,
      bundleHash,
      paymentToken,
      paymentTokenSymbol: symbol,
      paymentAmount,
      requiredFundingAmount,
      shadowAccount,
      destinationBalanceBeforeFunding: destinationBalance,
      sourceInteropCenter: session.interopCenter,
      destinationInvoicePayment: session.destinationInvoicePayment,
      destinationChainId: session.destinationChainId
    };
  };

  const sendSettlePayInvoiceBundle = async (
    payload: SendPayInvoicePayload
  ): Promise<SettlePayInvoiceResult> => {
    const currentRpcClient = rpcClient.value;
    if (!currentRpcClient) {
      throw new Error('Authenticated RPC client not available.');
    }

    const resolvedSourceConfig = sourceConfig.value;
    const resolvedDestinationConfig = destinationConfig.value;
    const invoiceId = payload.invoiceId.trim();
    const {
      paymentAmount,
      paymentToken,
      session,
      shadowAccount,
      destinationBalance
    } = await resolvePayInvoiceContext(
      payload,
      currentRpcClient,
      resolvedSourceConfig,
      resolvedDestinationConfig,
      refreshUserProfile,
      userWallets.value
    );

    if (destinationBalance < paymentAmount) {
      throw new Error(
        `Shadow account ${shadowAccount} has ${formatTokenAmount(destinationBalance)} available on chain C but invoice ${invoiceId} needs ${formatTokenAmount(paymentAmount)}. Wait for destination funding to settle and retry.`
      );
    }

    const approvePaymentData = encodeFunctionData({
      abi: erc20Abi,
      functionName: 'approve',
      args: [session.destinationInvoicePayment, MAX_UINT256]
    });
    const payInvoiceData = encodeFunctionData({
      abi: invoicePaymentAbi,
      functionName: 'payInvoice',
      args: [BigInt(invoiceId), paymentToken]
    });

    const submission = await submitInteropBundle(
      session,
      [
        {
          to: paymentToken,
          data: approvePaymentData,
          callAttributes: [shadowAccountAttribute()]
        },
        {
          to: session.destinationInvoicePayment,
          data: payInvoiceData,
          callAttributes: [shadowAccountAttribute()]
        }
      ],
      enableWalletToken as WalletAuthorizer
    );

    return {
      transactionHash: submission.txHash,
      bundleHash: submission.bundleHash,
      paymentToken,
      shadowAccount,
      sourceInteropCenter: session.interopCenter,
      destinationInvoicePayment: session.destinationInvoicePayment,
      destinationChainId: session.destinationChainId
    };
  };

  const readDestinationTokenBalance = async (
    payload: ReadDestinationTokenBalancePayload
  ): Promise<bigint> => {
    const resolvedDestinationConfig = destinationConfig.value;
    if (!resolvedDestinationConfig.chainId || !resolvedDestinationConfig.rpcUrl) {
      throw new Error('Missing chain C destination config for token balance reads.');
    }

    const destinationClient = createReadOnlyClient(
      resolvedDestinationConfig.chainId,
      resolvedDestinationConfig.rpcUrl
    );

    return (await destinationClient.readContract({
      address: payload.token,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [payload.account]
    })) as bigint;
  };

  const readPayInvoicePreflight = async (
    payload: ReadPayInvoicePreflightPayload
  ): Promise<ReadPayInvoicePreflightResult> => {
    const resolvedDestinationConfig = destinationConfig.value;

    if (
      !resolvedDestinationConfig.chainId ||
      !resolvedDestinationConfig.rpcUrl ||
      !resolvedDestinationConfig.invoicePayment
    ) {
      throw new Error('Missing chain C destination config for invoice payment preflight.');
    }

    const destinationClient = createReadOnlyClient(
      resolvedDestinationConfig.chainId,
      resolvedDestinationConfig.rpcUrl
    );
    const [crossChainFee, invoicePaymentBalance] = await Promise.all([
      destinationClient.readContract({
        address: resolvedDestinationConfig.invoicePayment,
        abi: invoicePaymentAbi,
        functionName: 'crossChainFee'
      }) as Promise<bigint>,
      destinationClient.getBalance({ address: resolvedDestinationConfig.invoicePayment })
    ]);

    const requiresCrossChainPayout =
      payload.creatorChainId !== resolvedDestinationConfig.chainId;

    return {
      crossChainFee,
      destinationChainId: resolvedDestinationConfig.chainId,
      invoicePaymentBalance,
      hasSufficientInvoicePaymentBalance: invoicePaymentBalance >= crossChainFee,
      requiresCrossChainPayout
    };
  };

  return {
    sourceConfig,
    destinationConfig,
    readDestinationTokenBalance,
    readPayInvoicePreflight,
    sendCreateInvoiceBundle,
    sendFundPayInvoiceBundle,
    sendSettlePayInvoiceBundle
  };
}
