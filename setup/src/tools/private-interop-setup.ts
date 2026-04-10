import fs from 'node:fs';
import path from 'node:path';
import {
  concatHex,
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  defineChain,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  http,
  maxUint256,
  parseAbi,
  type Address,
  type Hex,
  type PublicClient
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import type {
  ChainDeployment,
  ChainKey,
  ContractsConfig,
  PrivateInteropDeployment,
  TokenKey
} from './contracts-config';

type RuntimeChainConfig = {
  key: ChainKey;
  label: string;
  rpcUrl: string;
  chainId: number;
  authToken?: string;
};

type PrivateInteropManifest = {
  chains: Record<
    string,
    {
      key: string;
      rpcUrl: string;
      connectRpcUrl?: string;
      assetTracker: Address;
      ntv: Address;
      assetRouter: Address;
      interopCenter: Address;
      interopHandler: Address;
    }
  >;
};

type PrivateChainContext = {
  key: ChainKey;
  label: string;
  chainId: number;
  rpcUrl: string;
  interopCenter: Address;
  interopHandler: Address;
  nativeTokenVault: Address;
  assetRouter: Address;
  publicClient: PublicClient;
  walletClient: ReturnType<typeof createWalletClient>;
  account: Address;
};

const NEW_ENCODING_VERSION = '0x01' as Hex;
const ZERO_BYTES32 = `0x${'0'.repeat(64)}` as Hex;
const WAIT_INTERVAL_MS = 3_000;
const WAIT_TIMEOUT_MS = 120_000;
const SAME_SYMBOL_RATE = 10n ** 18n;

const privateInteropCenterAbi = parseAbi([
  'function sendBundle(bytes _destinationChainId, (bytes to, bytes data, bytes[] callAttributes)[] _callStarters, bytes[] _bundleAttributes) payable returns (bytes32)',
  'event InteropBundleSent(bytes32 l2l1MsgHash, bytes32 interopBundleHash, (bytes1 version, uint256 sourceChainId, uint256 destinationChainId, bytes32 destinationBaseTokenAssetId, bytes32 interopBundleSalt, (bytes1 version, bool shadowAccount, address to, address from, uint256 value, bytes data)[] calls, (bytes executionAddress, bytes unbundlerAddress, bool useFixedFee) bundleAttributes) interopBundle)'
]);

const privateInteropHandlerAbi = parseAbi([
  'function executeBundle(bytes _bundle, (uint256 chainId, uint256 l1BatchNumber, uint256 l2MessageIndex, (uint16 txNumberInBatch, address sender, bytes data) message, bytes32[] proof) _proof)',
  'function bundleStatus(bytes32 bundleHash) view returns (uint8)'
]);

const invoicePaymentAbi = parseAbi([
  'function getWhitelistedTokens() view returns (address[] tokens, string[] symbols)',
  'function whitelistToken(address token, string symbol)',
  'function exchangeRates(address token1, address token2) view returns (uint256)',
  'function setExchangeRate(address token1, address token2, uint256 rate)'
]);

const privateNtvAbi = parseAbi([
  'function ensureTokenIsRegistered(address _nativeToken) returns (bytes32)',
  'function assetId(address token) view returns (bytes32)',
  'function tokenAddress(bytes32 assetId) view returns (address)'
]);

const erc20Abi = parseAbi([
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)'
]);

const interopAttributesAbi = parseAbi([
  'function indirectCall(uint256)',
  'function interopCallValue(uint256)'
]);

const interopBundleTuple = [
  {
    type: 'tuple',
    name: 'interopBundle',
    components: [
      { name: 'version', type: 'bytes1' },
      { name: 'sourceChainId', type: 'uint256' },
      { name: 'destinationChainId', type: 'uint256' },
      { name: 'destinationBaseTokenAssetId', type: 'bytes32' },
      { name: 'interopBundleSalt', type: 'bytes32' },
      {
        name: 'calls',
        type: 'tuple[]',
        components: [
          { name: 'version', type: 'bytes1' },
          { name: 'shadowAccount', type: 'bool' },
          { name: 'to', type: 'address' },
          { name: 'from', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'data', type: 'bytes' }
        ]
      },
      {
        name: 'bundleAttributes',
        type: 'tuple',
        components: [
          { name: 'executionAddress', type: 'bytes' },
          { name: 'unbundlerAddress', type: 'bytes' },
          { name: 'useFixedFee', type: 'bool' }
        ]
      }
    ]
  }
] as const;

const supportedTokenKeys: TokenKey[] = ['usdc', 'sgd', 'tbill'];

function createTransport(rpcUrl: string, authToken?: string) {
  if (!authToken) {
    return http(rpcUrl);
  }

  return http(rpcUrl, {
    fetchFn: async (url, init) => {
      const headers = new Headers(init?.headers);
      headers.set('Authorization', `Bearer ${authToken}`);
      return fetch(url, { ...init, headers });
    }
  });
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

function encodeEvmChain(chainId: bigint): Hex {
  const chainRef = toMinimalChainRef(chainId);
  const chainRefLength = (chainRef.length - 2) / 2;
  return concatHex(['0x00010000', `0x${chainRefLength.toString(16).padStart(2, '0')}` as Hex, chainRef, '0x00']);
}

function encodeEvmAddress(address: Address): Hex {
  return concatHex(['0x000100000014', address]);
}

function indirectCallAttribute(messageValue: bigint): Hex {
  return encodeFunctionData({
    abi: interopAttributesAbi,
    functionName: 'indirectCall',
    args: [messageValue]
  });
}

function walletAccount(context: PrivateChainContext) {
  const account = context.walletClient.account;
  if (!account) {
    throw new Error(`Missing wallet account for chain ${context.label}`);
  }
  return account;
}

function interopCallValueAttribute(value: bigint): Hex {
  return encodeFunctionData({
    abi: interopAttributesAbi,
    functionName: 'interopCallValue',
    args: [value]
  });
}

function createPrivateChainContext(
  runtime: RuntimeChainConfig,
  manifest: PrivateInteropManifest,
  executorPrivateKey: `0x${string}`
): PrivateChainContext {
  const manifestEntry = manifest.chains[String(runtime.chainId)];
  if (!manifestEntry) {
    throw new Error(`Missing private interop manifest entry for chain ${runtime.chainId}.`);
  }

  const account = privateKeyToAccount(executorPrivateKey);
  const chain = defineChain({
    id: runtime.chainId,
    name: `Prividium Chain ${runtime.label}`,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: {
      default: { http: [runtime.rpcUrl] },
      public: { http: [runtime.rpcUrl] }
    }
  });
  const transport = createTransport(runtime.rpcUrl, runtime.authToken);

  return {
    key: runtime.key,
    label: runtime.label,
    chainId: runtime.chainId,
    rpcUrl: runtime.rpcUrl,
    interopCenter: getAddress(manifestEntry.interopCenter),
    interopHandler: getAddress(manifestEntry.interopHandler),
    nativeTokenVault: getAddress(manifestEntry.ntv),
    assetRouter: getAddress(manifestEntry.assetRouter),
    publicClient: createPublicClient({ chain, transport }),
    walletClient: createWalletClient({ chain, transport, account }),
    account: account.address
  };
}

function buildPrivateTransferCall(
  assetId: Hex,
  amount: bigint,
  recipient: Address,
  sourceTokenAddress: Address,
  assetRouter: Address
) {
  const burnData = encodeAbiParameters(
    [{ type: 'uint256' }, { type: 'address' }, { type: 'address' }],
    [amount, recipient, sourceTokenAddress]
  );
  const depositData = concatHex([
    NEW_ENCODING_VERSION,
    encodeAbiParameters([{ type: 'bytes32' }, { type: 'bytes' }], [assetId, burnData])
  ]);

  return {
    to: encodeEvmAddress(assetRouter),
    data: depositData,
    callAttributes: [indirectCallAttribute(0n), interopCallValueAttribute(0n)]
  };
}

async function ensureAllowance(
  context: PrivateChainContext,
  tokenAddress: Address,
  spender: Address
) {
  const allowance = (await context.publicClient.readContract({
    address: tokenAddress,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [context.account, spender]
  })) as bigint;

  if (allowance >= 1n) {
    return;
  }

  const hash = await context.walletClient.writeContract({
    address: tokenAddress,
    abi: erc20Abi,
    functionName: 'approve',
    args: [spender, maxUint256],
    account: walletAccount(context),
    chain: undefined
  });
  await context.publicClient.waitForTransactionReceipt({ hash });
}

async function ensurePrivateTokenRegistered(
  context: PrivateChainContext,
  tokenAddress: Address
): Promise<Hex> {
  const currentAssetId = (await context.publicClient.readContract({
    address: context.nativeTokenVault,
    abi: privateNtvAbi,
    functionName: 'assetId',
    args: [tokenAddress]
  })) as Hex;

  if (currentAssetId !== ZERO_BYTES32) {
    return currentAssetId;
  }

  const hash = await context.walletClient.writeContract({
    address: context.nativeTokenVault,
    abi: privateNtvAbi,
    functionName: 'ensureTokenIsRegistered',
    args: [tokenAddress],
    account: walletAccount(context),
    chain: undefined
  });
  await context.publicClient.waitForTransactionReceipt({ hash });

  return (await context.publicClient.readContract({
    address: context.nativeTokenVault,
    abi: privateNtvAbi,
    functionName: 'assetId',
    args: [tokenAddress]
  })) as Hex;
}

async function readPrivateDestinationToken(
  context: PrivateChainContext,
  assetId: Hex
): Promise<Address | null> {
  const tokenAddress = (await context.publicClient.readContract({
    address: context.nativeTokenVault,
    abi: privateNtvAbi,
    functionName: 'tokenAddress',
    args: [assetId]
  })) as Address;

  return tokenAddress.toLowerCase() === '0x0000000000000000000000000000000000000000'
    ? null
    : getAddress(tokenAddress);
}

async function waitForPrivateDestinationToken(
  context: PrivateChainContext,
  assetId: Hex
): Promise<Address> {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const tokenAddress = await readPrivateDestinationToken(context, assetId);
    if (tokenAddress) {
      return tokenAddress;
    }
    await new Promise((resolve) => setTimeout(resolve, WAIT_INTERVAL_MS));
  }

  throw new Error(
    `Timed out waiting for private token ${assetId} to materialize on chain ${context.label}.`
  );
}

async function executePrivateBundle(args: {
  source: PrivateChainContext;
  destination: PrivateChainContext;
  bundle: unknown;
  bundleHash: Hex;
}) {
  const bundleData = encodeAbiParameters(interopBundleTuple, [args.bundle] as never);
  const proof = {
    chainId: BigInt(args.source.chainId),
    l1BatchNumber: 0n,
    l2MessageIndex: 0n,
    message: {
      txNumberInBatch: 0,
      sender: args.source.interopCenter,
      data: '0x' as Hex
    },
    proof: [] as Hex[]
  };

  try {
    const hash = await args.destination.walletClient.writeContract({
      address: args.destination.interopHandler,
      abi: privateInteropHandlerAbi,
      functionName: 'executeBundle',
      args: [bundleData, proof],
      account: walletAccount(args.destination),
      chain: undefined
    });
    await args.destination.publicClient.waitForTransactionReceipt({ hash });
  } catch (error) {
    const status = (await args.destination.publicClient.readContract({
      address: args.destination.interopHandler,
      abi: privateInteropHandlerAbi,
      functionName: 'bundleStatus',
      args: [args.bundleHash]
    })) as number;
    if (status === 2) {
      return;
    }
    throw error;
  }
}

async function materializePrivatePaymentToken(args: {
  source: PrivateChainContext;
  destination: PrivateChainContext;
  sourceTokenAddress: Address;
}): Promise<{ assetId: Hex; destinationToken: Address }> {
  const assetId = await ensurePrivateTokenRegistered(args.source, args.sourceTokenAddress);
  const existingDestinationToken = await readPrivateDestinationToken(args.destination, assetId);
  if (existingDestinationToken) {
    return { assetId, destinationToken: existingDestinationToken };
  }

  await ensureAllowance(args.source, args.sourceTokenAddress, args.source.nativeTokenVault);

  const txHash = await args.source.walletClient.writeContract({
    address: args.source.interopCenter,
    abi: privateInteropCenterAbi,
    functionName: 'sendBundle',
    args: [
      encodeEvmChain(BigInt(args.destination.chainId)),
      [
        buildPrivateTransferCall(
          assetId,
          1n,
          args.destination.account,
          args.sourceTokenAddress,
          args.source.assetRouter
        )
      ],
      []
    ],
    account: walletAccount(args.source),
    chain: undefined
  });
  const receipt = await args.source.publicClient.waitForTransactionReceipt({ hash: txHash });

  let bundleHash: Hex | null = null;
  let bundle: unknown = null;
  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({
        abi: privateInteropCenterAbi,
        data: log.data,
        topics: log.topics
      });
      if (decoded.eventName !== 'InteropBundleSent') {
        continue;
      }
      const args = decoded.args as { interopBundleHash: Hex; interopBundle: unknown };
      bundleHash = args.interopBundleHash;
      bundle = args.interopBundle;
      break;
    } catch {
      // Skip unrelated logs.
    }
  }

  if (!bundleHash || !bundle) {
    throw new Error(
      `Missing InteropBundleSent event for private token materialization on chain ${args.source.label}.`
    );
  }

  await executePrivateBundle({
    source: args.source,
    destination: args.destination,
    bundleHash,
    bundle
  });

  const destinationToken = await waitForPrivateDestinationToken(args.destination, assetId);
  return { assetId, destinationToken };
}

async function ensureInvoiceWhitelist(
  chainC: PrivateChainContext,
  invoicePaymentAddress: Address,
  tokenAddress: Address,
  symbol: string
) {
  const [tokenAddresses] = (await chainC.publicClient.readContract({
    address: invoicePaymentAddress,
    abi: invoicePaymentAbi,
    functionName: 'getWhitelistedTokens'
  })) as readonly [readonly Address[], readonly string[]];

  if (tokenAddresses.some((candidate) => candidate.toLowerCase() === tokenAddress.toLowerCase())) {
    return;
  }

  const hash = await chainC.walletClient.writeContract({
    address: invoicePaymentAddress,
    abi: invoicePaymentAbi,
    functionName: 'whitelistToken',
    args: [tokenAddress, symbol],
    account: walletAccount(chainC),
    chain: undefined
  });
  await chainC.publicClient.waitForTransactionReceipt({ hash });
}

async function ensureExchangeRate(
  chainC: PrivateChainContext,
  invoicePaymentAddress: Address,
  fromToken: Address,
  toToken: Address,
  rate: bigint
) {
  const currentRate = (await chainC.publicClient.readContract({
    address: invoicePaymentAddress,
    abi: invoicePaymentAbi,
    functionName: 'exchangeRates',
    args: [fromToken, toToken]
  })) as bigint;

  if (currentRate === rate) {
    return;
  }

  const hash = await chainC.walletClient.writeContract({
    address: invoicePaymentAddress,
    abi: invoicePaymentAbi,
    functionName: 'setExchangeRate',
    args: [fromToken, toToken, rate],
    account: walletAccount(chainC),
    chain: undefined
  });
  await chainC.publicClient.waitForTransactionReceipt({ hash });
}

function symbolFromTokenKey(tokenKey: TokenKey) {
  return tokenKey.toUpperCase();
}

function loadPrivateManifest(rootPath: string): PrivateInteropManifest | null {
  const manifestPath = path.join(
    rootPath,
    'prividium-3chain-local',
    '.runtime',
    'private-interop.json'
  );
  if (!fs.existsSync(manifestPath)) {
    return null;
  }

  return JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as PrivateInteropManifest;
}

function getPublicTokenAddress(
  chain: ChainDeployment | undefined,
  tokenKey: TokenKey,
  chainLabel: string
): Address {
  const address = chain?.tokens?.[tokenKey]?.address;
  if (!address) {
    throw new Error(`Missing ${tokenKey.toUpperCase()} token on chain ${chainLabel}.`);
  }
  return getAddress(address);
}

async function readReferenceRate(
  chainC: PrivateChainContext,
  invoicePaymentAddress: Address,
  publicChains: NonNullable<ContractsConfig['chains']>,
  billingTokenKey: TokenKey,
  paymentTokenKey: TokenKey
): Promise<bigint> {
  if (billingTokenKey === paymentTokenKey) {
    return SAME_SYMBOL_RATE;
  }

  const publicBillingToken = getPublicTokenAddress(publicChains.c, billingTokenKey, 'C');
  const publicPaymentToken = getPublicTokenAddress(publicChains.c, paymentTokenKey, 'C');

  return (await chainC.publicClient.readContract({
    address: invoicePaymentAddress,
    abi: invoicePaymentAbi,
    functionName: 'exchangeRates',
    args: [publicBillingToken, publicPaymentToken]
  })) as bigint;
}

export async function setupPrivateInteropConfig(args: {
  rootPath: string;
  executorPrivateKey: `0x${string}`;
  invoicePaymentAddress: Address;
  chainA: RuntimeChainConfig;
  chainB: RuntimeChainConfig;
  chainC: RuntimeChainConfig;
  publicChains: NonNullable<ContractsConfig['chains']>;
}): Promise<PrivateInteropDeployment | undefined> {
  const manifest = loadPrivateManifest(args.rootPath);
  if (!manifest) {
    return undefined;
  }

  const chainA = createPrivateChainContext(args.chainA, manifest, args.executorPrivateKey);
  const chainB = createPrivateChainContext(args.chainB, manifest, args.executorPrivateKey);
  const chainC = createPrivateChainContext(args.chainC, manifest, args.executorPrivateKey);

  const privateInterop: PrivateInteropDeployment = {
    enabled: true,
    chains: {
      a: {
        chainId: chainA.chainId,
        rpcUrl: chainA.rpcUrl,
        interopCenter: chainA.interopCenter,
        interopHandler: chainA.interopHandler,
        nativeTokenVault: chainA.nativeTokenVault,
        assetRouter: chainA.assetRouter
      },
      b: {
        chainId: chainB.chainId,
        rpcUrl: chainB.rpcUrl,
        interopCenter: chainB.interopCenter,
        interopHandler: chainB.interopHandler,
        nativeTokenVault: chainB.nativeTokenVault,
        assetRouter: chainB.assetRouter
      },
      c: {
        chainId: chainC.chainId,
        rpcUrl: chainC.rpcUrl,
        interopCenter: chainC.interopCenter,
        interopHandler: chainC.interopHandler,
        nativeTokenVault: chainC.nativeTokenVault,
        assetRouter: chainC.assetRouter
      }
    },
    paymentTokens: {
      a: {},
      b: {}
    }
  };
  const privatePaymentTokens =
    privateInterop.paymentTokens as NonNullable<PrivateInteropDeployment['paymentTokens']>;

  const privateSources: Array<[Exclude<ChainKey, 'c'>, PrivateChainContext]> = [
    ['a', chainA],
    ['b', chainB]
  ];

  for (const [sourceKey, sourceContext] of privateSources) {
    for (const tokenKey of supportedTokenKeys) {
      const sourceTokenAddress = getPublicTokenAddress(
        args.publicChains[sourceKey],
        tokenKey,
        sourceContext.label
      );
      const { assetId, destinationToken } = await materializePrivatePaymentToken({
        source: sourceContext,
        destination: chainC,
        sourceTokenAddress
      });
      await ensureInvoiceWhitelist(
        chainC,
        args.invoicePaymentAddress,
        destinationToken,
        symbolFromTokenKey(tokenKey)
      );

      const sourcePaymentTokens = privatePaymentTokens[sourceKey] ?? {};
      privatePaymentTokens[sourceKey] = sourcePaymentTokens;
      sourcePaymentTokens[tokenKey] = {
        address: destinationToken,
        assetId,
        sourceToken: sourceTokenAddress
      };
    }
  }

  for (const billingTokenKey of supportedTokenKeys) {
    const publicBillingToken = getPublicTokenAddress(args.publicChains.c, billingTokenKey, 'C');
    for (const [sourceKey, tokens] of Object.entries(
      privateInterop.paymentTokens ?? {}
    ) as Array<[Exclude<ChainKey, 'c'>, Partial<Record<TokenKey, { address?: Address }>>]>) {
      for (const paymentTokenKey of supportedTokenKeys) {
        const privatePaymentToken = tokens[paymentTokenKey]?.address;
        if (!privatePaymentToken) {
          continue;
        }
        const rate = await readReferenceRate(
          chainC,
          args.invoicePaymentAddress,
          args.publicChains,
          billingTokenKey,
          paymentTokenKey
        );
        await ensureExchangeRate(
          chainC,
          args.invoicePaymentAddress,
          publicBillingToken,
          getAddress(privatePaymentToken),
          rate
        );
      }
    }
  }

  return privateInterop;
}
