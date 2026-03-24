import { existsSync, readdirSync } from 'node:fs';
/* eslint-disable @typescript-eslint/no-explicit-any */
// import { zksyncOsTestnet } from "./constants";
import { dirname, join, resolve } from 'node:path';
import { base64UrlToUint8Array, getPublicKeyBytesFromPasskeySignature } from 'sso-legacy/utils';
import {
  concatHex,
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeAbiParameters,
  http,
  parseAbi,
  parseUnits,
  type Address,
  type Hex,
  hexToBytes,
  keccak256,
  toHex,
  zeroAddress
} from 'viem';

import {
  getChainDeploymentById,
  loadContractsConfig,
  resolveTokenAddressFromConfig,
  type TokenKey
} from '@/utils/contractsConfig';
import { configureSmartAccountPermissions } from '@/utils/prividium/smart-account-permissions';
import { associateWalletWithUser } from '@/utils/prividium/user-wallet-association';
import { client, executorAccount, l2Wallet } from '../client';
import { L2_CHAIN_ID, SSO_CONTRACTS } from '../constants';
import { env } from '../envConfig';
import { ensureFactoryDeployed, getFactoryAddress } from './factory';
import { sendFaucetFunds } from './faucet';

const contractsConfig = loadContractsConfig();
const TOKEN_TARGET_BALANCE = '1000';
const TOKEN_FUNDING_ABI = parseAbi([
  'function transfer(address to, uint256 amount) returns (bool)',
  'function balanceOf(address account) view returns (uint256)',
  'function decimals() view returns (uint8)'
]);
const INTEROP_CENTER_ABI = parseAbi([
  'function sendBundle(bytes _destinationChainId, (bytes to, bytes data, bytes[] callAttributes)[] _callStarters, bytes[] _bundleAttributes) payable returns (bytes32)'
]);
const L2_ASSET_ROUTER_ADDRESS = '0x0000000000000000000000000000000000010003' as Address;
const NEW_ENCODING_VERSION = '0x01' as Hex;
const INDIRECT_CALL_ATTRIBUTE_SELECTOR = '0xc8496ea7' as Hex;
const UNBUNDLER_ATTRIBUTE_SELECTOR = '0xb9c86698' as Hex;
const BRIDGE_POLL_INTERVAL_MS = 3000;
const BRIDGE_WAIT_TIMEOUT_MS = 300000;

const tokenSpecs = [
  { key: 'usdc', legacyEnvKeys: ['TOKEN_USDC_ADDRESS', 'TOKEN_USDC_CHAIN_C_ADDRESS'] },
  { key: 'sgd', legacyEnvKeys: ['TOKEN_SGD_ADDRESS', 'TOKEN_SGD_CHAIN_C_ADDRESS'] },
  { key: 'tbill', legacyEnvKeys: ['TOKEN_TBILL_ADDRESS', 'TOKEN_TBILL_CHAIN_C_ADDRESS'] }
] as const satisfies ReadonlyArray<{
  key: TokenKey;
  legacyEnvKeys: readonly (keyof typeof env)[];
}>;

type TokenMintResult = {
  token: TokenKey;
  tokenAddress?: Address;
  minted: boolean;
  source: 'config' | 'env' | 'missing';
  txHash?: Hex;
  bridgeTxHash?: Hex;
  fundingMethod?: 'already-funded' | 'transfer' | 'bridge+transfer';
  error?: string;
};

type ChainAuthContext = {
  chainId: number;
  rpcUrl: string;
  apiUrl: string;
  authBaseUrl: string;
};

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

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveTokenAssetId(tokenKey: TokenKey): Hex | undefined {
  const activeChainAssetId =
    getChainDeploymentById(contractsConfig, L2_CHAIN_ID)?.deployment.tokens?.[tokenKey]?.assetId;
  if (activeChainAssetId) {
    return activeChainAssetId;
  }

  return contractsConfig?.chains?.c?.tokens?.[tokenKey]?.assetId;
}

function resolveLegacyTokenAddress(tokenKey: TokenKey): Address | undefined {
  const spec = tokenSpecs.find((entry) => entry.key === tokenKey);
  if (!spec) {
    return undefined;
  }

  for (const key of spec.legacyEnvKeys) {
    const value = env[key];
    if (typeof value === 'string' && value.startsWith('0x')) {
      return value as Address;
    }
  }

  return undefined;
}

function resolveTokenAddress(tokenKey: TokenKey): {
  address?: Address;
  source: TokenMintResult['source'];
} {
  const configAddress = resolveTokenAddressFromConfig(contractsConfig, tokenKey, L2_CHAIN_ID);
  if (configAddress) {
    return { address: configAddress, source: 'config' };
  }

  const legacyAddress = resolveLegacyTokenAddress(tokenKey);
  if (legacyAddress) {
    return { address: legacyAddress, source: 'env' };
  }

  return { source: 'missing' };
}

async function postJson(url: string, body: Record<string, unknown>) {
  return fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
}

async function getChainAuthToken(context: ChainAuthContext): Promise<string> {
  const siweDomain = new URL(context.authBaseUrl).host;
  const baseCandidates = [context.apiUrl.replace(/\/+$/, '')];
  if (!baseCandidates[0].endsWith('/api')) {
    baseCandidates.push(`${baseCandidates[0]}/api`);
  }

  let lastError: unknown;
  for (const baseUrl of baseCandidates) {
    try {
      const challengeRes = await postJson(`${baseUrl}/siwe-messages/`, {
        address: executorAccount.address,
        domain: siweDomain
      });

      if (!challengeRes.ok) {
        const errorText = await challengeRes.text().catch(() => '');
        throw new Error(
          `Failed to request SIWE challenge from ${baseUrl}: ${challengeRes.status} ${challengeRes.statusText} ${errorText}`
        );
      }

      const challengeJson = (await challengeRes.json()) as { message?: string; msg?: string };
      const message = challengeJson.message ?? challengeJson.msg;
      if (!message) {
        throw new Error(`SIWE challenge from ${baseUrl} did not include a message`);
      }

      const signature = await executorAccount.signMessage({ message });
      const loginRes = await postJson(`${baseUrl}/auth/login/crypto-native`, {
        message,
        signature
      });

      if (!loginRes.ok) {
        const errorText = await loginRes.text().catch(() => '');
        throw new Error(
          `Failed to authenticate executor session against ${baseUrl}: ${loginRes.status} ${loginRes.statusText} ${errorText}`
        );
      }

      const loginJson = (await loginRes.json()) as { token?: string };
      if (!loginJson.token) {
        throw new Error(`Executor login response from ${baseUrl} did not include a token`);
      }

      return loginJson.token;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('Failed to authenticate executor session');
}

function createAuthenticatedChainClients(context: ChainAuthContext, token: string) {
  const chain = defineChain({
    id: context.chainId,
    name: `Prividium Chain ${context.chainId}`,
    nativeCurrency: {
      name: 'Ether',
      symbol: 'ETH',
      decimals: 18
    },
    rpcUrls: {
      default: { http: [context.rpcUrl] },
      public: { http: [context.rpcUrl] }
    }
  });

  const fetchWithAuth: typeof fetch = async (url, init) => {
    const headers = new Headers(init?.headers);
    headers.set('Authorization', `Bearer ${token}`);
    return fetch(url, { ...init, headers });
  };

  const transport = http(context.rpcUrl, { fetchFn: fetchWithAuth });
  return {
    publicClient: createPublicClient({
      chain,
      transport
    }),
    walletClient: createWalletClient({
      account: executorAccount,
      chain,
      transport
    })
  };
}

async function bridgeExecutorLiquidityFromChainC(
  tokenKey: TokenKey,
  activeTokenAddress: Address,
  amount: bigint
): Promise<{ txHash?: Hex; error?: string }> {
  const tokenLabel = tokenKey.toUpperCase();
  if (amount <= 0n) {
    return {};
  }

  const chainC = contractsConfig?.chains?.c;
  if (
    !chainC?.chainId ||
    !chainC.rpcUrl ||
    !chainC.apiUrl ||
    !chainC.authBaseUrl ||
    !chainC.interopCenter
  ) {
    return { error: 'Chain C config is missing rpc/api/auth/interopCenter data' };
  }

  const assetId = resolveTokenAssetId(tokenKey);
  if (!assetId) {
    return { error: `Missing assetId for ${tokenLabel} in contracts config` };
  }

  try {
    console.log(
      `[fund-tokens] ${tokenLabel}: bridging ${amount.toString()} units from chain C to active chain ${L2_CHAIN_ID}`
    );
    const authToken = await getChainAuthToken({
      chainId: Number(chainC.chainId),
      rpcUrl: chainC.rpcUrl,
      apiUrl: chainC.apiUrl,
      authBaseUrl: chainC.authBaseUrl
    });
    const chainCClients = createAuthenticatedChainClients(
      {
        chainId: Number(chainC.chainId),
        rpcUrl: chainC.rpcUrl,
        apiUrl: chainC.apiUrl,
        authBaseUrl: chainC.authBaseUrl
      },
      authToken
    );

    const beforeBalance = (await client.l2.readContract({
      address: activeTokenAddress,
      abi: TOKEN_FUNDING_ABI,
      functionName: 'balanceOf',
      args: [executorAccount.address],
      account: executorAccount.address
    })) as bigint;

    const burnData = encodeAbiParameters(
      [{ type: 'uint256' }, { type: 'address' }, { type: 'address' }],
      [amount, executorAccount.address, zeroAddress]
    );
    const payload = concatHex([
      NEW_ENCODING_VERSION,
      encodeAbiParameters([{ type: 'bytes32' }, { type: 'bytes' }], [assetId, burnData])
    ]);
    const callStarters = [
      {
        to: formatEvmV1AddressOnly(L2_ASSET_ROUTER_ADDRESS),
        data: payload,
        callAttributes: [indirectCallAttribute(0n)]
      }
    ] as const;
    const bundleAttributes = [unbundlerAddressAttribute(executorAccount.address)] as const;

    const txHash = await chainCClients.walletClient.writeContract({
      address: chainC.interopCenter,
      abi: INTEROP_CENTER_ABI,
      functionName: 'sendBundle',
      args: [formatEvmV1(BigInt(L2_CHAIN_ID)), callStarters, bundleAttributes]
    });
    console.log(`[fund-tokens] ${tokenLabel}: bridge bundle submitted tx=${txHash}`);

    const sourceReceipt = await chainCClients.publicClient.waitForTransactionReceipt({ hash: txHash });
    if (sourceReceipt.status !== 'success') {
      return { error: `Bridge tx reverted on chain C: ${txHash}` };
    }
    console.log(`[fund-tokens] ${tokenLabel}: bridge source tx confirmed tx=${txHash}`);

    const expectedBalance = beforeBalance + amount;
    const deadline = Date.now() + BRIDGE_WAIT_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const currentBalance = (await client.l2.readContract({
        address: activeTokenAddress,
        abi: TOKEN_FUNDING_ABI,
        functionName: 'balanceOf',
        args: [executorAccount.address],
        account: executorAccount.address
      })) as bigint;
      if (currentBalance >= expectedBalance) {
        console.log(
          `[fund-tokens] ${tokenLabel}: bridged liquidity arrived. executor_balance=${currentBalance.toString()}`
        );
        return { txHash };
      }
      await sleep(BRIDGE_POLL_INTERVAL_MS);
    }

    return {
      txHash,
      error: `Bridge liquidity did not arrive on chain ${L2_CHAIN_ID} within ${BRIDGE_WAIT_TIMEOUT_MS / 1000}s`
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function fundTokenToAccount(tokenKey: TokenKey, accountAddress: Address): Promise<TokenMintResult> {
  const tokenLabel = tokenKey.toUpperCase();
  console.log(`[fund-tokens] ${tokenLabel}: resolving token address`);
  const resolved = resolveTokenAddress(tokenKey);
  if (!resolved.address) {
    console.warn(`[fund-tokens] ${tokenLabel}: token address unavailable`);
    return {
      token: tokenKey,
      minted: false,
      source: resolved.source,
      error: 'Token address unavailable'
    };
  }

  const bytecode = await client.l2.getBytecode({ address: resolved.address });
  if (!bytecode || bytecode === '0x') {
    console.warn(`[fund-tokens] ${tokenLabel}: no contract code at ${resolved.address}`);
    return {
      token: tokenKey,
      tokenAddress: resolved.address,
      minted: false,
      source: resolved.source,
      error: `No contract code at ${resolved.address}`
    };
  }

  try {
    const decimals = Number(
      (await client.l2.readContract({
        address: resolved.address,
        abi: TOKEN_FUNDING_ABI,
        functionName: 'decimals',
        account: executorAccount.address
      })) as number
    );
    const targetBalance = parseUnits(TOKEN_TARGET_BALANCE, decimals);
    console.log(
      `[fund-tokens] ${tokenLabel}: token=${resolved.address} decimals=${decimals} target=${targetBalance.toString()} recipient=${accountAddress}`
    );

    const recipientBalance = (await client.l2.readContract({
      address: resolved.address,
      abi: TOKEN_FUNDING_ABI,
      functionName: 'balanceOf',
      args: [accountAddress],
      account: executorAccount.address
    })) as bigint;
    console.log(
      `[fund-tokens] ${tokenLabel}: recipient current balance=${recipientBalance.toString()}`
    );

    if (recipientBalance >= targetBalance) {
      console.log(`[fund-tokens] ${tokenLabel}: recipient already funded`);
      return {
        token: tokenKey,
        tokenAddress: resolved.address,
        minted: true,
        source: resolved.source,
        fundingMethod: 'already-funded'
      };
    }

    const amountNeeded = targetBalance - recipientBalance;
    let bridgeTxHash: Hex | undefined;
    let executorBalance = (await client.l2.readContract({
      address: resolved.address,
      abi: TOKEN_FUNDING_ABI,
      functionName: 'balanceOf',
      args: [executorAccount.address],
      account: executorAccount.address
    })) as bigint;
    console.log(`[fund-tokens] ${tokenLabel}: executor balance=${executorBalance.toString()}`);

    if (executorBalance < amountNeeded) {
      console.log(
        `[fund-tokens] ${tokenLabel}: executor shortfall=${(amountNeeded - executorBalance).toString()}`
      );
      const bridgeResult = await bridgeExecutorLiquidityFromChainC(
        tokenKey,
        resolved.address,
        amountNeeded - executorBalance
      );
      bridgeTxHash = bridgeResult.txHash;
      if (bridgeResult.error) {
        return {
          token: tokenKey,
          tokenAddress: resolved.address,
          minted: false,
          source: resolved.source,
          bridgeTxHash,
          error: `Unable to top up executor liquidity: ${bridgeResult.error}`
        };
      }

      executorBalance = (await client.l2.readContract({
        address: resolved.address,
        abi: TOKEN_FUNDING_ABI,
        functionName: 'balanceOf',
        args: [executorAccount.address],
        account: executorAccount.address
      })) as bigint;
      console.log(
        `[fund-tokens] ${tokenLabel}: executor balance after bridge=${executorBalance.toString()}`
      );
    }

    if (executorBalance < amountNeeded) {
      return {
        token: tokenKey,
        tokenAddress: resolved.address,
        minted: false,
        source: resolved.source,
        bridgeTxHash,
        error: `Executor balance ${executorBalance.toString()} is below required ${amountNeeded.toString()}`
      };
    }

    console.log(
      `[fund-tokens] ${tokenLabel}: transferring ${amountNeeded.toString()} to ${accountAddress}`
    );
    const txHash = await l2Wallet.writeContract({
      address: resolved.address,
      abi: TOKEN_FUNDING_ABI,
      functionName: 'transfer',
      args: [accountAddress, amountNeeded]
    });

    await client.l2.waitForTransactionReceipt({ hash: txHash });
    console.log(`[fund-tokens] ${tokenLabel}: transfer confirmed tx=${txHash}`);

    return {
      token: tokenKey,
      tokenAddress: resolved.address,
      minted: true,
      source: resolved.source,
      txHash,
      bridgeTxHash,
      fundingMethod: bridgeTxHash ? 'bridge+transfer' : 'transfer'
    };
  } catch (error) {
    console.error(
      `[fund-tokens] ${tokenLabel}: funding error`,
      error instanceof Error ? error.message : String(error)
    );
    return {
      token: tokenKey,
      tokenAddress: resolved.address,
      minted: false,
      source: resolved.source,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function fundConfiguredTokens(accountAddress: Address): Promise<TokenMintResult[]> {
  const results: TokenMintResult[] = [];
  for (const { key } of tokenSpecs) {
    console.log(`[fund-tokens] starting ${key.toUpperCase()} funding for ${accountAddress}`);
    const result = await fundTokenToAccount(key, accountAddress);
    results.push(result);
    console.log(
      `[fund-tokens] finished ${key.toUpperCase()} funding for ${accountAddress}: success=${result.minted}`
    );
  }
  return results;
}

function deferredTokenFundingResults(): TokenMintResult[] {
  return tokenSpecs.map(({ key }) => {
    const resolved = resolveTokenAddress(key);
    return {
      token: key,
      tokenAddress: resolved.address,
      minted: false,
      source: resolved.source,
      error: 'Deferred: call /fund-tokens to request test token funding.'
    };
  });
}

export async function fundAccountTokens(accountAddress: Address) {
  return fundConfiguredTokens(accountAddress);
}

export async function deploySmartAccount(
  userId: string,
  originDomain: string,
  credentialId: Hex,
  credentialPublicKey: number[]
  // publicKey: { x: Hex; y: Hex }
) {
  console.log('🚀 Deploying smart account...');
  try {
    // Intentionally stripped legacy code comments for brevity

    // Ensure factory is deployed/available before using it
    await ensureFactoryDeployed();

    const deployedAddress = await deployAccountWithoutSDK(
      originDomain,
      credentialId,
      credentialPublicKey
    );
    console.log('deployed Address:', deployedAddress);

    await sendFaucetFunds(deployedAddress);
    console.log('ℹ️ Skipping token funding during /deploy-account. Use /fund-tokens for on-demand token top-up.');
    const tokenMintResults = deferredTokenFundingResults();

    let permissionsConfigured = false;
    let permissionsError: string | undefined;
    try {
      await configureSmartAccountPermissions(deployedAddress);
      permissionsConfigured = true;
      console.log(`✅ Configured contract permissions for smart account ${deployedAddress}`);
    } catch (error) {
      permissionsError = error instanceof Error ? error.message : String(error);
      console.error('Failed to configure smart account permissions:', permissionsError);
    }

    let walletAssociated = false;
    let walletAssociationError: string | undefined;
    let walletAddresses: string[] = [];
    if (permissionsConfigured) {
      try {
        const association = await associateWalletWithUser(userId, deployedAddress);
        walletAssociated = true;
        walletAddresses = association.wallets;
        if (association.alreadyLinked) {
          console.log(`ℹ️ Wallet ${deployedAddress} is already linked to user ${userId}`);
        } else {
          console.log(`✅ Linked wallet ${deployedAddress} to user ${userId}`);
        }
      } catch (error) {
        walletAssociationError = error instanceof Error ? error.message : String(error);
        console.error('Failed to associate wallet after deploy:', walletAssociationError);
      }
    }

    return {
      accountAddress: deployedAddress,
      webauthnValidator: SSO_CONTRACTS.webauthnValidator,
      tokenMintResults,
      permissionsConfigured,
      permissionsError,
      walletAssociated,
      walletAssociationError,
      walletAddresses
    };
  } catch (error) {
    console.error('Error deploying smart account:', error);
    throw error; // Rethrow so the router knows it failed
  }
}

async function deployAccountWithoutSDK(
  originDomain: string,
  credentialId: string,
  credentialPublicKey: number[]
) {
  const currentDir = __dirname;

  const findSdkPackageDir = () => {
    const tryDirs: string[] = [];
    let cursor = currentDir;
    for (let i = 0; i < 6; i += 1) {
      tryDirs.push(cursor);
      const parent = resolve(cursor, '..');
      if (parent === cursor) break;
      cursor = parent;
    }

    for (const base of tryDirs) {
      const directPkg = join(base, 'node_modules', 'zksync-sso-web-sdk', 'package.json');
      if (existsSync(directPkg)) return dirname(directPkg);

      const pnpmDir = join(base, 'node_modules', '.pnpm');
      if (existsSync(pnpmDir)) {
        const matches = readdirSync(pnpmDir).filter((name) =>
          name.startsWith('zksync-sso-web-sdk@')
        );
        if (matches.length > 0) {
          const pkgJson = join(
            pnpmDir,
            matches[0],
            'node_modules',
            'zksync-sso-web-sdk',
            'package.json'
          );
          if (existsSync(pkgJson)) return dirname(pkgJson);
        }
      }
    }

    return null;
  };

  const ssoPkgDir = findSdkPackageDir();
  if (!ssoPkgDir) {
    throw new Error(
      'zksync-sso-web-sdk package not found. Ensure workspace dependencies are installed.'
    );
  }

  const ssoWasmPath = join(ssoPkgDir, 'pkg-node', 'zksync_sso_erc4337_web_ffi.js');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const ssoWasm = require(ssoWasmPath) as {
    PasskeyPayload: new (
      credentialId: Uint8Array,
      passkeyX: Uint8Array,
      passkeyY: Uint8Array,
      originDomain: string
    ) => unknown;
    encode_deploy_account_call_data: (
      accountId: string,
      eoaSigners?: string[] | null,
      eoaValidatorAddress?: string | null,
      passkeyPayload?: unknown | null,
      webauthnValidatorAddress?: string | null,
      sessionValidatorAddress?: string | null,
      executorModules?: string[] | null
    ) => string;
  };

  const webauthnValidator = SSO_CONTRACTS.webauthnValidator as Hex;
  const validatorCode = await client.l2.getBytecode({ address: webauthnValidator });
  if (!validatorCode || validatorCode === '0x') {
    throw new Error(
      `WebAuthn validator not deployed at ${webauthnValidator}. Run setup-permissions to deploy SSO contracts or set SSO_WEBAUTHN_VALIDATOR_CONTRACT.`
    );
  }

  // If credentialId is already hex (0x...), use it directly. Otherwise parse as base64url.
  const credentialIdHex = credentialId.startsWith('0x')
    ? (credentialId as Hex)
    : toHex(base64UrlToUint8Array(credentialId));

  const accountId = keccak256(credentialIdHex);

  // Extract public key coordinates from credentialPublicKey using SDK's COSE parser
  const [xBytes, yBytes] = getPublicKeyBytesFromPasskeySignature(
    new Uint8Array(credentialPublicKey)
  );
  const buildDeployData = (id: string, origin: string) => {
    const passkeyPayload = new ssoWasm.PasskeyPayload(
      hexToBytes(credentialIdHex),
      xBytes,
      yBytes,
      origin
    );
    return ssoWasm.encode_deploy_account_call_data(
      id,
      null,
      null,
      passkeyPayload,
      webauthnValidator,
      null,
      null
    );
  };

  const sendDeploy = async (id: string, origin: string) => {
    const data = buildDeployData(id, origin);
    console.log(
      `Calling factory.deployAccount (with WASM-encoded data). accountId=${id} originDomain=${origin}`
    );
    return l2Wallet.sendTransaction({
      to: getFactoryAddress(),
      data: data as Hex
    });
  };

  const hash = await sendDeploy(accountId, originDomain);

  console.log(`Transaction hash: ${hash}`);
  console.log('Waiting for confirmation...');

  const receipt = await client.l2.waitForTransactionReceipt({ hash });

  if (receipt.status !== 'success') {
    throw new Error('Account deployment transaction reverted');
  }

  // Parse logs to find AccountCreated event
  const accountCreatedTopic = keccak256(toHex('AccountCreated(address,address)'));
  const log = receipt.logs.find((entry) => entry.topics[0] === accountCreatedTopic);

  if (!log || !log.topics[1]) {
    throw new Error('AccountCreated event not found in transaction logs');
  }

  return `0x${log.topics[1].slice(-40)}` as Hex;
}
