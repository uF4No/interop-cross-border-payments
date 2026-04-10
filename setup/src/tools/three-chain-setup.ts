import fs from 'node:fs';
import path from 'node:path';
import {
  http,
  type Abi,
  type Address,
  type Hex,
  concatHex,
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeAbiParameters,
  formatEther,
  getAddress,
  maxUint256,
  parseAbi,
  parseUnits,
  toHex,
  zeroAddress
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import { ensureContractsArtifacts } from './contracts-artifacts';
import type { ChainDeployment, ChainKey, ContractsConfig, TokenKey } from './contracts-config';

const L2_ASSET_ROUTER_ADDRESS = '0x0000000000000000000000000000000000010003' as Address;
const ZERO_BYTES32 = `0x${'0'.repeat(64)}` as Hex;
const NEW_ENCODING_VERSION = '0x01' as Hex;
const INDIRECT_CALL_ATTRIBUTE_SELECTOR = '0xc8496ea7' as Hex;
const UNBUNDLER_ATTRIBUTE_SELECTOR = '0xb9c86698' as Hex;

const BRIDGE_MATERIALIZATION_AMOUNT = 1n;
const WAIT_INTERVAL_MS = 3_000;
const WAIT_TIMEOUT_MS = 300_000;

const invoicePaymentAbi = parseAbi([
  'function admin() view returns (address)',
  'function setAdmin(address newAdmin)',
  'function whitelistToken(address token, string symbol)',
  'function getWhitelistedTokens() view returns (address[] tokens, string[] symbols)',
  'function exchangeRates(address token1, address token2) view returns (uint256)',
  'function setExchangeRate(address token1, address token2, uint256 rate)'
]);

const erc20Abi = parseAbi([
  'function mint(address to, uint256 amount) returns (bool)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address account) view returns (uint256)',
  'function symbol() view returns (string)'
]);

const nativeTokenVaultAbi = parseAbi([
  'function ensureTokenIsRegistered(address nativeToken) returns (bytes32)',
  'function assetId(address token) view returns (bytes32)',
  'function tokenAddress(bytes32 assetId) view returns (address)'
]);

const interopCenterAbi = parseAbi([
  'function sendBundle(bytes _destinationChainId, (bytes to, bytes data, bytes[] callAttributes)[] _callStarters, bytes[] _bundleAttributes) payable returns (bytes32)'
]);

const TOKEN_SPECS = [
  {
    key: 'usdc',
    name: 'USD Coin',
    symbol: 'USDC',
    decimals: 18,
    premintAmount: parseUnits('1000000', 18)
  },
  {
    key: 'sgd',
    name: 'Singapore Dollar',
    symbol: 'SGD',
    decimals: 18,
    premintAmount: parseUnits('1000000', 18)
  },
  {
    key: 'tbill',
    name: 'Tokenized Treasury Bill',
    symbol: 'TBILL',
    decimals: 18,
    premintAmount: parseUnits('1000000', 18)
  }
] as const satisfies ReadonlyArray<{
  key: TokenKey;
  name: string;
  symbol: string;
  decimals: number;
  premintAmount: bigint;
}>;

const EXCHANGE_RATES = [
  { from: 'sgd', to: 'usdc', rate: parseUnits('0.74', 18) },
  { from: 'sgd', to: 'tbill', rate: parseUnits('0.74', 18) },
  { from: 'tbill', to: 'usdc', rate: parseUnits('1.02', 18) }
] as const satisfies ReadonlyArray<{ from: TokenKey; to: TokenKey; rate: bigint }>;

const INVOICE_PAYMENT_INITIAL_TOKEN_LIQUIDITY = parseUnits('100000000', 18);

type ArtifactJson = {
  abi: unknown;
  bytecode?: {
    object?: string;
  };
};

type ChainRuntimeConfig = {
  key: ChainKey;
  label: string;
  rpcUrl: string;
  chainId: number;
  authToken?: string;
};

type ChainContext = ChainRuntimeConfig & {
  deployer: Address;
  publicClient: ReturnType<typeof createPublicClient>;
  walletClient: ReturnType<typeof createWalletClient>;
};

type SetupThreeChainContractsArgs = {
  contractsDir: string;
  executorPrivateKey: `0x${string}`;
  adminAddress: Address;
  invoiceInitialEthWei: bigint;
  nativeTokenVaultAddress: Address;
  interopCenterAddress: Address;
  chainA: ChainRuntimeConfig;
  chainB: ChainRuntimeConfig;
  chainC: ChainRuntimeConfig;
  existingContractsConfig: ContractsConfig | null;
  interopBroadcasterApiUrl?: string;
};

type BundleDebugInfo = {
  txHash: Hex;
  l2l1MessageHash?: Hex;
  bundleHash?: Hex;
  blockNumber?: bigint;
};

type RelayStatusDebugInfo = {
  endpoint: string;
  httpStatus?: number;
  status?: string;
};

type BridgeDebugContext = {
  tokenSymbol: string;
  source: ChainContext;
  destination: ChainContext;
  nativeTokenVaultAddress: Address;
  assetId: Hex;
  relayStatus?: RelayStatusDebugInfo;
  bundle?: BundleDebugInfo;
};

function walletAccount(context: ChainContext) {
  const account = context.walletClient.account;
  if (!account) {
    throw new Error(`Missing wallet account for chain ${context.label}`);
  }
  return account;
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

function createChainContext(
  config: ChainRuntimeConfig,
  executorPrivateKey: `0x${string}`
): ChainContext {
  const account = privateKeyToAccount(executorPrivateKey);
  const chain = defineChain({
    id: config.chainId,
    name: `Prividium Chain ${config.label}`,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: {
      default: { http: [config.rpcUrl] },
      public: { http: [config.rpcUrl] }
    }
  });
  const transport = createTransport(config.rpcUrl, config.authToken);

  return {
    ...config,
    deployer: account.address,
    publicClient: createPublicClient({ chain, transport }),
    walletClient: createWalletClient({ chain, transport, account })
  };
}

function readArtifact(contractsDir: string, artifactPath: string): { abi: Abi; bytecode: Hex } {
  const artifact = JSON.parse(
    fs.readFileSync(path.join(contractsDir, artifactPath), 'utf8')
  ) as ArtifactJson;
  const bytecode = artifact.bytecode?.object as Hex | undefined;
  if (!bytecode) {
    throw new Error(`Missing bytecode in artifact ${artifactPath}`);
  }

  return {
    abi: artifact.abi as Abi,
    bytecode
  };
}

async function hasCode(client: ChainContext['publicClient'], address: Address): Promise<boolean> {
  const bytecode = await client.getBytecode({ address });
  return bytecode !== undefined && bytecode !== '0x';
}

async function deployContractFromArtifact(args: {
  context: ChainContext;
  contractsDir: string;
  artifactPath: string;
  constructorArgs: readonly unknown[];
  existingAddress?: Address;
  contractLabel: string;
}): Promise<{ address: Address; deployed: boolean }> {
  const existingAddress = args.existingAddress ? getAddress(args.existingAddress) : undefined;
  if (existingAddress) {
    if (await hasCode(args.context.publicClient, existingAddress)) {
      return { address: existingAddress, deployed: false };
    }
  }

  const artifact = readArtifact(args.contractsDir, args.artifactPath);
  const hash = await args.context.walletClient.deployContract({
    abi: artifact.abi,
    bytecode: artifact.bytecode,
    args: args.constructorArgs,
    chain: undefined,
    account: walletAccount(args.context)
  });
  const receipt = await args.context.publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success' || !receipt.contractAddress) {
    throw new Error(`${args.contractLabel} deployment failed on chain ${args.context.label}`);
  }

  return { address: getAddress(receipt.contractAddress), deployed: true };
}

async function ensureMintedBalance(
  context: ChainContext,
  tokenAddress: Address,
  account: Address,
  minimumBalance: bigint
): Promise<void> {
  const balance = (await context.publicClient.readContract({
    address: tokenAddress,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [account]
  })) as bigint;

  if (balance >= minimumBalance) {
    return;
  }

  const hash = await context.walletClient.writeContract({
    address: tokenAddress,
    abi: erc20Abi,
    functionName: 'mint',
    args: [account, minimumBalance - balance],
    chain: undefined,
    account: walletAccount(context)
  });
  await context.publicClient.waitForTransactionReceipt({ hash });
}

async function mintToAccount(
  context: ChainContext,
  tokenAddress: Address,
  account: Address,
  amount: bigint
): Promise<void> {
  if (amount <= 0n) {
    return;
  }

  const hash = await context.walletClient.writeContract({
    address: tokenAddress,
    abi: erc20Abi,
    functionName: 'mint',
    args: [account, amount],
    chain: undefined,
    account: walletAccount(context)
  });
  await context.publicClient.waitForTransactionReceipt({ hash });
}

async function ensureAllowance(
  context: ChainContext,
  tokenAddress: Address,
  spender: Address,
  minimumAllowance: bigint
): Promise<void> {
  const allowance = (await context.publicClient.readContract({
    address: tokenAddress,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [context.deployer, spender]
  })) as bigint;

  if (allowance >= minimumAllowance) {
    return;
  }

  const hash = await context.walletClient.writeContract({
    address: tokenAddress,
    abi: erc20Abi,
    functionName: 'approve',
    args: [spender, maxUint256],
    chain: undefined,
    account: walletAccount(context)
  });
  await context.publicClient.waitForTransactionReceipt({ hash });
}

async function ensureTokenRegistered(
  context: ChainContext,
  nativeTokenVaultAddress: Address,
  tokenAddress: Address
): Promise<Hex> {
  const existingAssetId = (await context.publicClient.readContract({
    address: nativeTokenVaultAddress,
    abi: nativeTokenVaultAbi,
    functionName: 'assetId',
    args: [tokenAddress]
  })) as Hex;

  if (existingAssetId !== ZERO_BYTES32) {
    return existingAssetId;
  }

  const hash = await context.walletClient.writeContract({
    address: nativeTokenVaultAddress,
    abi: nativeTokenVaultAbi,
    functionName: 'ensureTokenIsRegistered',
    args: [tokenAddress],
    chain: undefined,
    account: walletAccount(context)
  });
  await context.publicClient.waitForTransactionReceipt({ hash });

  return (await context.publicClient.readContract({
    address: nativeTokenVaultAddress,
    abi: nativeTokenVaultAbi,
    functionName: 'assetId',
    args: [tokenAddress]
  })) as Hex;
}

async function readTokenAddressForAsset(
  context: ChainContext,
  nativeTokenVaultAddress: Address,
  assetId: Hex
): Promise<Address | null> {
  const address = (await context.publicClient.readContract({
    address: nativeTokenVaultAddress,
    abi: nativeTokenVaultAbi,
    functionName: 'tokenAddress',
    args: [assetId]
  })) as Address;

  return address.toLowerCase() === zeroAddress ? null : getAddress(address);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatRelayStatus(debug: RelayStatusDebugInfo | undefined) {
  if (!debug) {
    return 'not checked (INTEROP_BROADCASTER_API_URL unset)';
  }

  return [
    `endpoint=${debug.endpoint}`,
    debug.httpStatus !== undefined ? `http=${debug.httpStatus}` : undefined,
    debug.status ? `status=${debug.status}` : 'status=unknown'
  ]
    .filter(Boolean)
    .join(' ');
}

function formatBundleDebug(debug: BundleDebugInfo | undefined) {
  if (!debug) {
    return 'unavailable';
  }

  return [
    `tx=${debug.txHash}`,
    debug.bundleHash ? `bundle=${debug.bundleHash}` : undefined,
    debug.l2l1MessageHash ? `l2l1=${debug.l2l1MessageHash}` : undefined,
    debug.blockNumber !== undefined ? `block=${debug.blockNumber}` : undefined
  ]
    .filter(Boolean)
    .join(' ');
}

function extractBundleDebugInfo(
  receipt: Awaited<ReturnType<ChainContext['publicClient']['waitForTransactionReceipt']>>,
  interopCenterAddress: Address
): BundleDebugInfo {
  const debugInfo: BundleDebugInfo = {
    txHash: receipt.transactionHash,
    blockNumber: receipt.blockNumber
  };

  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== interopCenterAddress.toLowerCase()) {
      continue;
    }

    if (log.data.length < 2 + 64 * 3) {
      continue;
    }

    debugInfo.l2l1MessageHash = `0x${log.data.slice(2, 66)}` as Hex;
    debugInfo.bundleHash = `0x${log.data.slice(66, 130)}` as Hex;
    return debugInfo;
  }

  return debugInfo;
}

async function waitForMaterializedToken(
  destination: ChainContext,
  nativeTokenVaultAddress: Address,
  assetId: Hex,
  debugContext: BridgeDebugContext,
  timeoutMs = WAIT_TIMEOUT_MS
): Promise<Address> {
  const deadline = Date.now() + timeoutMs;
  let attempt = 0;
  while (Date.now() < deadline) {
    attempt += 1;
    const tokenAddress = await readTokenAddressForAsset(
      destination,
      nativeTokenVaultAddress,
      assetId
    );
    if (tokenAddress) {
      return tokenAddress;
    }

    if (attempt === 1 || attempt % 10 === 0) {
      const head = await destination.publicClient.getBlockNumber();
      console.log(
        `  Waiting for ${debugContext.tokenSymbol} bridge ${debugContext.source.label}->${debugContext.destination.label}: assetId=${assetId} head=${head} bundle=[${formatBundleDebug(debugContext.bundle)}] relay=[${formatRelayStatus(debugContext.relayStatus)}]`
      );
    }

    await sleep(WAIT_INTERVAL_MS);
  }

  const destinationHead = await destination.publicClient.getBlockNumber();
  const currentTokenAddress =
    (await destination.publicClient.readContract({
      address: nativeTokenVaultAddress,
      abi: nativeTokenVaultAbi,
      functionName: 'tokenAddress',
      args: [assetId]
    })) as Address;

  throw new Error(
    `Timed out waiting for bridged token ${assetId} to materialize on chain ${destination.label}. token=${debugContext.tokenSymbol} source=${debugContext.source.label}(${debugContext.source.chainId}) destination=${debugContext.destination.label}(${debugContext.destination.chainId}) vault=${nativeTokenVaultAddress} bundle=[${formatBundleDebug(debugContext.bundle)}] relay=[${formatRelayStatus(debugContext.relayStatus)}] destinationHead=${destinationHead} destinationTokenAddress=${currentTokenAddress}`
  );
}

async function waitForInteropRelay(
  broadcasterApiUrl: string,
  txHash: Hex,
  senderChainId: number,
  timeoutMs = WAIT_TIMEOUT_MS
): Promise<RelayStatusDebugInfo> {
  const baseUrl = broadcasterApiUrl.replace(/\/+$/, '');
  const deadline = Date.now() + timeoutMs;
  let lastStatus: RelayStatusDebugInfo = { endpoint: baseUrl };

  while (Date.now() < deadline) {
    const url = new URL(`${baseUrl}/api/interop-transaction-status`);
    url.searchParams.set('transactionHash', txHash);
    url.searchParams.set('senderChainId', String(senderChainId));

    const response = await fetch(url);
    lastStatus = { endpoint: baseUrl, httpStatus: response.status };
    if (response.ok) {
      const payload = (await response.json()) as { status?: string };
      lastStatus.status = payload.status;
      if (payload.status === 'completed') {
        return lastStatus;
      }
      if (payload.status === 'failed') {
        throw new Error(
          `Interop relay reported failure for ${txHash}. relay=[${formatRelayStatus(lastStatus)}]`
        );
      }
    }

    await sleep(WAIT_INTERVAL_MS);
  }

  throw new Error(
    `Timed out waiting for interop relay completion for ${txHash}. relay=[${formatRelayStatus(lastStatus)}]`
  );
}

async function materializeBridgedToken(args: {
  source: ChainContext;
  destination: ChainContext;
  nativeTokenVaultAddress: Address;
  interopCenterAddress: Address;
  assetId: Hex;
  tokenSymbol: string;
  broadcasterApiUrl?: string;
}): Promise<Address> {
  const existingAddress = await readTokenAddressForAsset(
    args.destination,
    args.nativeTokenVaultAddress,
    args.assetId
  );
  if (existingAddress) {
    return existingAddress;
  }

  const burnData = encodeAbiParameters(
    [{ type: 'uint256' }, { type: 'address' }, { type: 'address' }],
    [BRIDGE_MATERIALIZATION_AMOUNT, args.source.deployer, zeroAddress]
  );
  const payload = concatHex([
    NEW_ENCODING_VERSION,
    encodeAbiParameters([{ type: 'bytes32' }, { type: 'bytes' }], [args.assetId, burnData])
  ]);

  const callStarters = [
    {
      to: formatEvmV1AddressOnly(L2_ASSET_ROUTER_ADDRESS),
      data: payload,
      callAttributes: [indirectCallAttribute(0n)]
    }
  ] as const;
  const bundleAttributes = [unbundlerAddressAttribute(args.source.deployer)] as const;

  const txHash = await args.source.walletClient.writeContract({
    address: args.interopCenterAddress,
    abi: interopCenterAbi,
    functionName: 'sendBundle',
    args: [formatEvmV1(BigInt(args.destination.chainId)), callStarters, bundleAttributes],
    chain: undefined,
    account: walletAccount(args.source)
  });
  const receipt = await args.source.publicClient.waitForTransactionReceipt({ hash: txHash });
  const bundleDebug = extractBundleDebugInfo(receipt, args.interopCenterAddress);
  console.log(
    `  Sent ${args.tokenSymbol} bridge bundle ${args.source.label}->${args.destination.label}: assetId=${args.assetId} ${formatBundleDebug(bundleDebug)} interopCenter=${args.interopCenterAddress}`
  );

  let relayStatus: RelayStatusDebugInfo | undefined;
  if (args.broadcasterApiUrl) {
    relayStatus = await waitForInteropRelay(args.broadcasterApiUrl, txHash, args.source.chainId);
    console.log(
      `  Relay status for ${args.tokenSymbol} bridge ${args.source.label}->${args.destination.label}: ${formatRelayStatus(relayStatus)}`
    );
  } else {
    console.log(
      `  No broadcaster API configured for ${args.tokenSymbol} bridge ${args.source.label}->${args.destination.label}; waiting for token materialization using on-chain polling only`
    );
  }

  return waitForMaterializedToken(
    args.destination,
    args.nativeTokenVaultAddress,
    args.assetId,
    {
      tokenSymbol: args.tokenSymbol,
      source: args.source,
      destination: args.destination,
      nativeTokenVaultAddress: args.nativeTokenVaultAddress,
      assetId: args.assetId,
      relayStatus,
      bundle: bundleDebug
    }
  );
}

async function ensureInvoiceAdmin(
  context: ChainContext,
  invoicePaymentAddress: Address,
  adminAddress: Address
): Promise<void> {
  const currentAdmin = getAddress(
    (await context.publicClient.readContract({
      address: invoicePaymentAddress,
      abi: invoicePaymentAbi,
      functionName: 'admin'
    })) as Address
  );

  if (currentAdmin.toLowerCase() === adminAddress.toLowerCase()) {
    return;
  }

  const hash = await context.walletClient.writeContract({
    address: invoicePaymentAddress,
    abi: invoicePaymentAbi,
    functionName: 'setAdmin',
    args: [adminAddress],
    chain: undefined,
    account: walletAccount(context)
  });
  await context.publicClient.waitForTransactionReceipt({ hash });
}

async function ensureInvoiceFunding(
  context: ChainContext,
  invoicePaymentAddress: Address,
  targetBalanceWei: bigint
): Promise<void> {
  if (targetBalanceWei <= 0n) {
    return;
  }

  const balanceBeforeWei = await context.publicClient.getBalance({
    address: invoicePaymentAddress
  });
  if (balanceBeforeWei >= targetBalanceWei) {
    return;
  }

  const topUpWei = targetBalanceWei - balanceBeforeWei;
  const hash = await context.walletClient.sendTransaction({
    account: walletAccount(context),
    chain: undefined,
    to: invoicePaymentAddress,
    value: topUpWei
  });
  await context.publicClient.waitForTransactionReceipt({ hash });

  const balanceAfterWei = await context.publicClient.getBalance({
    address: invoicePaymentAddress
  });
  console.log(
    `Funded InvoicePayment on chain ${context.label}: before=${formatEther(balanceBeforeWei)} ETH after=${formatEther(balanceAfterWei)} ETH topUp=${formatEther(topUpWei)} ETH tx=${hash}`
  );
}

async function ensureInvoiceWhitelist(
  context: ChainContext,
  invoicePaymentAddress: Address,
  tokenAddress: Address,
  symbol: string
): Promise<void> {
  const whitelisted = (await context.publicClient.readContract({
    address: invoicePaymentAddress,
    abi: invoicePaymentAbi,
    functionName: 'getWhitelistedTokens'
  })) as readonly [readonly Address[], readonly string[]];

  const alreadyWhitelisted = whitelisted[0].some(
    (candidate) => candidate.toLowerCase() === tokenAddress.toLowerCase()
  );
  if (alreadyWhitelisted) {
    return;
  }

  const hash = await context.walletClient.writeContract({
    address: invoicePaymentAddress,
    abi: invoicePaymentAbi,
    functionName: 'whitelistToken',
    args: [tokenAddress, symbol],
    chain: undefined,
    account: walletAccount(context)
  });
  await context.publicClient.waitForTransactionReceipt({ hash });
}

async function ensureExchangeRate(
  context: ChainContext,
  invoicePaymentAddress: Address,
  fromToken: Address,
  toToken: Address,
  rate: bigint
): Promise<void> {
  const currentRate = (await context.publicClient.readContract({
    address: invoicePaymentAddress,
    abi: invoicePaymentAbi,
    functionName: 'exchangeRates',
    args: [fromToken, toToken]
  })) as bigint;

  if (currentRate === rate) {
    return;
  }

  const hash = await context.walletClient.writeContract({
    address: invoicePaymentAddress,
    abi: invoicePaymentAbi,
    functionName: 'setExchangeRate',
    args: [fromToken, toToken, rate],
    chain: undefined,
    account: walletAccount(context)
  });
  await context.publicClient.waitForTransactionReceipt({ hash });
}

async function assertTokenSymbol(
  context: ChainContext,
  tokenAddress: Address,
  expectedSymbol: string
): Promise<void> {
  const symbol = (await context.publicClient.readContract({
    address: tokenAddress,
    abi: erc20Abi,
    functionName: 'symbol'
  })) as string;

  if (symbol !== expectedSymbol) {
    throw new Error(
      `Configured token ${tokenAddress} on chain ${context.label} has symbol ${symbol}, expected ${expectedSymbol}`
    );
  }
}

export async function setupThreeChainContracts(
  args: SetupThreeChainContractsArgs
): Promise<NonNullable<ContractsConfig['chains']>> {
  await ensureContractsArtifacts(args.contractsDir);

  const chainA = createChainContext(args.chainA, args.executorPrivateKey);
  const chainB = createChainContext(args.chainB, args.executorPrivateKey);
  const chainC = createChainContext(args.chainC, args.executorPrivateKey);

  const invoiceDeployment = await deployContractFromArtifact({
    context: chainC,
    contractsDir: args.contractsDir,
    artifactPath: path.join('out', 'InvoicePayment.sol', 'InvoicePayment.json'),
    constructorArgs: [args.adminAddress],
    existingAddress: args.existingContractsConfig?.chains?.c?.invoicePayment,
    contractLabel: 'InvoicePayment'
  });
  await ensureInvoiceAdmin(chainC, invoiceDeployment.address, args.adminAddress);
  await ensureInvoiceFunding(chainC, invoiceDeployment.address, args.invoiceInitialEthWei);

  const chains: Record<ChainKey, ChainDeployment> = {
    a: {
      chainId: chainA.chainId,
      interopCenter: args.interopCenterAddress,
      nativeTokenVault: args.nativeTokenVaultAddress,
      deployer: chainA.deployer,
      admin: args.adminAddress
    },
    b: {
      chainId: chainB.chainId,
      interopCenter: args.interopCenterAddress,
      nativeTokenVault: args.nativeTokenVaultAddress,
      deployer: chainB.deployer,
      admin: args.adminAddress
    },
    c: {
      chainId: chainC.chainId,
      interopCenter: args.interopCenterAddress,
      nativeTokenVault: args.nativeTokenVaultAddress,
      deployer: chainC.deployer,
      admin: args.adminAddress,
      invoicePayment: invoiceDeployment.address,
      tokens: {}
    }
  };

  for (const tokenSpec of TOKEN_SPECS) {
    const canonicalDeployment = await deployContractFromArtifact({
      context: chainC,
      contractsDir: args.contractsDir,
      artifactPath: path.join('out', 'TestnetERC20Token.sol', 'TestnetERC20Token.json'),
      constructorArgs: [tokenSpec.name, tokenSpec.symbol, tokenSpec.decimals],
      existingAddress: args.existingContractsConfig?.chains?.c?.tokens?.[tokenSpec.key]?.address,
      contractLabel: `${tokenSpec.symbol} token`
    });

    await assertTokenSymbol(chainC, canonicalDeployment.address, tokenSpec.symbol);
    await ensureMintedBalance(
      chainC,
      canonicalDeployment.address,
      chainC.deployer,
      tokenSpec.premintAmount
    );
    if (invoiceDeployment.deployed) {
      await mintToAccount(
        chainC,
        canonicalDeployment.address,
        invoiceDeployment.address,
        INVOICE_PAYMENT_INITIAL_TOKEN_LIQUIDITY
      );
    }
    await ensureAllowance(
      chainC,
      canonicalDeployment.address,
      args.nativeTokenVaultAddress,
      BRIDGE_MATERIALIZATION_AMOUNT * 2n
    );

    const assetId = await ensureTokenRegistered(
      chainC,
      args.nativeTokenVaultAddress,
      canonicalDeployment.address
    );
    console.log(
      `  Prepared public token ${tokenSpec.symbol} on chain C: token=${canonicalDeployment.address} assetId=${assetId}`
    );
    const chainATokenAddress = await materializeBridgedToken({
      source: chainC,
      destination: chainA,
      nativeTokenVaultAddress: args.nativeTokenVaultAddress,
      interopCenterAddress: args.interopCenterAddress,
      assetId,
      tokenSymbol: tokenSpec.symbol,
      broadcasterApiUrl: args.interopBroadcasterApiUrl
    });
    const chainBTokenAddress = await materializeBridgedToken({
      source: chainC,
      destination: chainB,
      nativeTokenVaultAddress: args.nativeTokenVaultAddress,
      interopCenterAddress: args.interopCenterAddress,
      assetId,
      tokenSymbol: tokenSpec.symbol,
      broadcasterApiUrl: args.interopBroadcasterApiUrl
    });

    chains.c.tokens ??= {};
    chains.c.tokens[tokenSpec.key] = {
      address: canonicalDeployment.address,
      assetId,
      deployer: chainC.deployer,
      admin: args.adminAddress
    };
    chains.a.tokens ??= {};
    chains.a.tokens[tokenSpec.key] = {
      address: chainATokenAddress,
      assetId,
      deployer: chainA.deployer,
      admin: args.adminAddress
    };
    chains.b.tokens ??= {};
    chains.b.tokens[tokenSpec.key] = {
      address: chainBTokenAddress,
      assetId,
      deployer: chainB.deployer,
      admin: args.adminAddress
    };

    await ensureInvoiceWhitelist(
      chainC,
      invoiceDeployment.address,
      canonicalDeployment.address,
      tokenSpec.symbol
    );
  }

  for (const rate of EXCHANGE_RATES) {
    const fromToken = chains.c.tokens?.[rate.from]?.address;
    const toToken = chains.c.tokens?.[rate.to]?.address;
    if (!fromToken || !toToken) {
      throw new Error(`Missing token addresses for exchange rate ${rate.from}/${rate.to}`);
    }

    await ensureExchangeRate(chainC, invoiceDeployment.address, fromToken, toToken, rate.rate);
  }

  return chains;
}
