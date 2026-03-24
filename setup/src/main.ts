import path from 'node:path';
import { intro, outro } from '@clack/prompts';
import type { Abi } from 'abitype';
import { type Address, getAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import InvoicePaymentArtifact from '../../contracts/out/InvoicePayment.sol/InvoicePayment.json';
import TestnetERC20TokenArtifact from '../../contracts/out/TestnetERC20Token.sol/TestnetERC20Token.json';
import { setupPublicContracts } from './setups/public-contracts-setup';
import { setupSsoContracts } from './setups/sso-setup';
import {
  WEB_APP_ORIGIN,
  WEB_APP_REDIRECT_URIS,
  ensureApplication
} from './tools/application-setup';
import { assertDotEnv, extractConfig, extractConfigOptional } from './tools/config-tools';
import {
  type ContractsConfig,
  mergeContractsConfig,
  readContractsConfig,
  resolveContractsConfigPath,
  writeContractsConfig
} from './tools/contracts-config';
import type { Client } from './tools/create-admin-client';
import { createAdminSession } from './tools/create-admin-client';
import { syncEnvFromContractsConfig } from './tools/env-sync';
import {
  ensureEntrypointsFunded,
  formatFundingSummary
} from './tools/entrypoint-funding';
import { updatePermissionApisCompose } from './tools/permissions-api-compose';
import { assertPrividiumApiUp, assertZksyncOsIsUp } from './tools/service-assert';
import { type SsoDeploymentResult, deploySsoContracts } from './tools/sso-deploy';
import { setupThreeChainContracts } from './tools/three-chain-setup';

const DEFAULT_NATIVE_TOKEN_VAULT_ADDRESS = '0x0000000000000000000000000000000000010004' as Address;
const DEFAULT_L2_INTEROP_CENTER_ADDRESS = '0x0000000000000000000000000000000000010010' as Address;
const DEFAULT_ENTRYPOINT_MIN_BALANCE_WEI = 10_000_000_000_000_000n; // 0.01 ETH
const DEFAULT_ENTRYPOINT_TARGET_BALANCE_WEI = 50_000_000_000_000_000n; // 0.05 ETH

type ChainConfig = {
  key: 'a' | 'b' | 'c';
  label: 'A' | 'B' | 'C';
  chainId: number;
  rpcUrl: string;
  apiUrl: string;
  authBaseUrl: string;
  entryPoint: Address;
};

type AuthenticatedChain = {
  chain: ChainConfig;
  resolvedApiUrl: string;
  adminApiClient: Client;
  adminAuthToken: `0x${string}` | string;
};

type TokenDeployments = NonNullable<NonNullable<ContractsConfig['chains']>['a']>['tokens'];

function toAddress(name: string, value: string): Address {
  if (!/^0x[a-fA-F0-9]{40}$/.test(value)) {
    throw new Error(`Invalid address for ${name}: ${value}`);
  }
  return getAddress(value.toLowerCase());
}

function toPrivateKey(name: string, value: string): `0x${string}` {
  if (!/^0x[a-fA-F0-9]{64}$/.test(value)) {
    throw new Error(`Invalid private key for ${name}`);
  }
  return value as `0x${string}`;
}

function toChainId(name: string, value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid chain id for ${name}: ${value}`);
  }
  return parsed;
}

function toWei(name: string, rawValue: string | undefined, fallback: bigint): bigint {
  if (!rawValue || rawValue.trim().length === 0) {
    return fallback;
  }
  if (!/^\d+$/.test(rawValue.trim())) {
    throw new Error(`Invalid wei amount for ${name}: ${rawValue}`);
  }
  return BigInt(rawValue.trim());
}

function readChainConfig(setupEnvPath: string, key: 'a' | 'b' | 'c'): ChainConfig {
  const label = key.toUpperCase() as 'A' | 'B' | 'C';
  const prefix = `CHAIN_${label}`;
  const useLegacyFallback = key === 'a';

  const chainIdRaw =
    extractConfigOptional(setupEnvPath, `${prefix}_CHAIN_ID`) ??
    (useLegacyFallback ? extractConfig(setupEnvPath, 'PRIVIDIUM_CHAIN_ID') : undefined);
  const rpcUrl =
    extractConfigOptional(setupEnvPath, `${prefix}_RPC_URL`) ??
    (useLegacyFallback ? extractConfig(setupEnvPath, 'PRIVIDIUM_RPC_URL') : undefined);
  const apiUrl =
    extractConfigOptional(setupEnvPath, `${prefix}_API_URL`) ??
    (useLegacyFallback ? extractConfig(setupEnvPath, 'PRIVIDIUM_API_URL') : undefined);
  const authBaseUrl =
    extractConfigOptional(setupEnvPath, `${prefix}_AUTH_BASE_URL`) ??
    (useLegacyFallback ? extractConfig(setupEnvPath, 'PRIVIDIUM_AUTH_BASE_URL') : undefined);
  const entryPointRaw =
    extractConfigOptional(setupEnvPath, `${prefix}_ENTRYPOINT_ADDRESS`) ??
    (useLegacyFallback ? extractConfig(setupEnvPath, 'PRIVIDIUM_ENTRYPOINT_ADDRESS') : undefined);

  if (!chainIdRaw || !rpcUrl || !apiUrl || !authBaseUrl || !entryPointRaw) {
    throw new Error(
      `Missing required ${prefix}_* config values in ${setupEnvPath}.${useLegacyFallback ? ' (Or missing legacy PRIVIDIUM_* fallback values.)' : ''}`
    );
  }

  return {
    key,
    label,
    chainId: toChainId(`${prefix}_CHAIN_ID`, chainIdRaw),
    rpcUrl,
    apiUrl,
    authBaseUrl,
    entryPoint: toAddress(`${prefix}_ENTRYPOINT_ADDRESS`, entryPointRaw)
  };
}

function toSsoConfig(result: SsoDeploymentResult) {
  return {
    factory: result.factory,
    beacon: result.beacon,
    accountImplementation: result.accountImplementation,
    ssoBytecodeHash: result.ssoBytecodeHash,
    webauthnValidator: result.webauthnValidator,
    eoaValidator: result.eoaValidator,
    sessionValidator: result.sessionValidator,
    guardianExecutor: result.guardianExecutor,
    entryPoint: result.entryPoint
  };
}

function buildTokenContractsForPublicPermissions(
  chainLabel: 'A' | 'B' | 'C',
  tokenDeployments: TokenDeployments | undefined
) {
  return (['usdc', 'sgd', 'tbill'] as const).map((tokenKey) => {
    const tokenDeployment = tokenDeployments?.[tokenKey];
    if (!tokenDeployment?.address) {
      throw new Error(
        `Missing chain ${chainLabel} ${tokenKey.toUpperCase()} token address after deployment`
      );
    }

    return {
      name: `Chain ${chainLabel} ${tokenKey.toUpperCase()}`,
      description: `${tokenKey.toUpperCase()} token deployed on chain ${chainLabel}.`,
      address: tokenDeployment.address,
      abi: TestnetERC20TokenArtifact.abi as Abi
    };
  });
}

async function validateAndAuthenticateChain(
  chain: ChainConfig,
  adminPrivateKey: `0x${string}`,
  adminAddress: Address
): Promise<AuthenticatedChain> {
  console.log(
    `  Chain ${chain.label}: id=${chain.chainId} rpc=${chain.rpcUrl} api=${chain.apiUrl}`
  );
  await assertZksyncOsIsUp(chain.rpcUrl, BigInt(chain.chainId));

  const resolvedApiUrl = await assertPrividiumApiUp(chain.apiUrl);
  const { client: adminApiClient, token: adminAuthToken } = await createAdminSession(
    resolvedApiUrl,
    new URL(chain.authBaseUrl).host,
    adminPrivateKey,
    adminAddress as `0x${string}`
  );

  return {
    chain,
    resolvedApiUrl,
    adminApiClient,
    adminAuthToken
  };
}

async function deploySsoForChain(
  chain: ChainConfig,
  executorPrivateKey: `0x${string}`,
  existingConfig: ContractsConfig | null,
  authToken?: string
): Promise<SsoDeploymentResult> {
  const existingSso =
    chain.key === 'a'
      ? (existingConfig?.chains?.a?.sso ?? existingConfig?.sso)
      : chain.key === 'b'
        ? existingConfig?.chains?.b?.sso
        : undefined;

  return deploySsoContracts({
    rpcUrl: chain.rpcUrl,
    chainId: chain.chainId,
    executorPrivateKey,
    authToken,
    configured: {
      eoaValidator: existingSso?.eoaValidator,
      webauthnValidator: existingSso?.webauthnValidator,
      sessionValidator: existingSso?.sessionValidator,
      guardianExecutor: existingSso?.guardianExecutor,
      entryPoint: existingSso?.entryPoint ?? chain.entryPoint,
      accountImplementation: existingSso?.accountImplementation,
      beacon: existingSso?.beacon,
      factory: existingSso?.factory
    }
  });
}

async function main() {
  intro('Starting 3-chain setup...');

  const rootPath = path.join(import.meta.dirname, '..', '..');
  const setupPath = path.join(rootPath, 'setup');
  const webAppPath = path.join(rootPath, 'web-app');
  const backendPath = path.join(rootPath, 'backend');
  const contractsDir = path.join(rootPath, 'contracts');
  const setupEnvPath = path.join(setupPath, '.env');
  const backendEnvPath = path.join(backendPath, '.env');

  assertDotEnv(setupPath);
  assertDotEnv(webAppPath);
  assertDotEnv(backendPath);

  const contractsConfigPath = resolveContractsConfigPath(
    rootPath,
    extractConfigOptional(setupEnvPath, 'CONTRACTS_CONFIG_PATH'),
    setupPath
  );
  const existingContractsConfig = readContractsConfig(contractsConfigPath);

  const chainA = readChainConfig(setupEnvPath, 'a');
  const chainB = readChainConfig(setupEnvPath, 'b');
  const chainC = readChainConfig(setupEnvPath, 'c');

  const adminPrivateKey = toPrivateKey(
    'ADMIN_PRIVATE_KEY',
    extractConfig(setupEnvPath, 'ADMIN_PRIVATE_KEY')
  );
  const adminAddress = toAddress('ADMIN_ADDRESS', extractConfig(setupEnvPath, 'ADMIN_ADDRESS'));
  const executorPrivateKey = extractConfigOptional(setupEnvPath, 'EXECUTOR_PRIVATE_KEY')
    ? toPrivateKey('EXECUTOR_PRIVATE_KEY', extractConfig(setupEnvPath, 'EXECUTOR_PRIVATE_KEY'))
    : adminPrivateKey;
  const executorAddress = privateKeyToAccount(executorPrivateKey).address;

  const interopBroadcasterApiUrl =
    extractConfigOptional(setupEnvPath, 'INTEROP_BROADCASTER_API_URL') ??
    extractConfigOptional(setupEnvPath, 'PRIVIDIUM_INTEROP_BROADCASTER_API_URL') ??
    undefined;
  const nativeTokenVaultAddress = toAddress(
    'NATIVE_TOKEN_VAULT_ADDRESS',
    extractConfigOptional(setupEnvPath, 'NATIVE_TOKEN_VAULT_ADDRESS') ??
      DEFAULT_NATIVE_TOKEN_VAULT_ADDRESS
  );
  const l2InteropCenter = toAddress(
    'L2_INTEROP_CENTER_ADDRESS',
    extractConfigOptional(setupEnvPath, 'L2_INTEROP_CENTER_ADDRESS') ??
      DEFAULT_L2_INTEROP_CENTER_ADDRESS
  );
  const entryPointMinBalanceWei = toWei(
    'ENTRYPOINT_MIN_BALANCE_WEI',
    extractConfigOptional(setupEnvPath, 'ENTRYPOINT_MIN_BALANCE_WEI'),
    DEFAULT_ENTRYPOINT_MIN_BALANCE_WEI
  );
  const entryPointTargetBalanceWei = toWei(
    'ENTRYPOINT_TARGET_BALANCE_WEI',
    extractConfigOptional(setupEnvPath, 'ENTRYPOINT_TARGET_BALANCE_WEI'),
    DEFAULT_ENTRYPOINT_TARGET_BALANCE_WEI
  );
  const l1InteropHandler = extractConfigOptional(backendEnvPath, 'L1_INTEROP_HANDLER');

  console.log('\nValidating chains and authenticating admin sessions...');
  const chainASession = await validateAndAuthenticateChain(chainA, adminPrivateKey, adminAddress);
  const chainBSession = await validateAndAuthenticateChain(chainB, adminPrivateKey, adminAddress);
  const chainCSession = await validateAndAuthenticateChain(chainC, adminPrivateKey, adminAddress);

  const appName = extractConfigOptional(setupEnvPath, 'PRIVIDIUM_APP_NAME') ?? 'local-app';

  console.log('\nEnsuring web app applications on chains A and B...');
  const [applicationOnA, applicationOnB] = await Promise.all([
    ensureApplication(chainASession.adminApiClient, {
      name: appName,
      origin: WEB_APP_ORIGIN,
      oauthRedirectUris: WEB_APP_REDIRECT_URIS
    }),
    ensureApplication(chainBSession.adminApiClient, {
      name: appName,
      origin: WEB_APP_ORIGIN,
      oauthRedirectUris: WEB_APP_REDIRECT_URIS
    })
  ]);

  console.log('\nDeploying SSO contracts on chain A...');
  const ssoOnA = await deploySsoForChain(
    chainA,
    executorPrivateKey,
    existingContractsConfig,
    chainASession.adminAuthToken
  );
  await setupSsoContracts(chainASession.adminApiClient, toSsoConfig(ssoOnA));

  console.log('\nDeploying SSO contracts on chain B...');
  const ssoOnB = await deploySsoForChain(
    chainB,
    executorPrivateKey,
    existingContractsConfig,
    chainBSession.adminAuthToken
  );
  await setupSsoContracts(chainBSession.adminApiClient, toSsoConfig(ssoOnB));

  console.log('\nFunding entrypoints on chains A and B...');
  const entryPointFundingResults = await ensureEntrypointsFunded({
    executorPrivateKey,
    minimumBalanceWei: entryPointMinBalanceWei,
    targetBalanceWei: entryPointTargetBalanceWei,
    chains: [
      {
        label: 'A',
        chainId: chainA.chainId,
        rpcUrl: chainA.rpcUrl,
        authToken: chainASession.adminAuthToken,
        entryPoint: ssoOnA.entryPoint
      },
      {
        label: 'B',
        chainId: chainB.chainId,
        rpcUrl: chainB.rpcUrl,
        authToken: chainBSession.adminAuthToken,
        entryPoint: ssoOnB.entryPoint
      }
    ]
  });
  for (const result of entryPointFundingResults) {
    console.log(`  ${formatFundingSummary(result)}`);
  }

  console.log('\nDeploying chain C contracts, token registration, and token bridging...');
  const deployedChains = await setupThreeChainContracts({
    contractsDir,
    executorPrivateKey,
    adminAddress,
    nativeTokenVaultAddress,
    interopCenterAddress: l2InteropCenter,
    chainA: {
      key: 'a',
      label: 'A',
      rpcUrl: chainA.rpcUrl,
      chainId: chainA.chainId,
      authToken: chainASession.adminAuthToken
    },
    chainB: {
      key: 'b',
      label: 'B',
      rpcUrl: chainB.rpcUrl,
      chainId: chainB.chainId,
      authToken: chainBSession.adminAuthToken
    },
    chainC: {
      key: 'c',
      label: 'C',
      rpcUrl: chainC.rpcUrl,
      chainId: chainC.chainId,
      authToken: chainCSession.adminAuthToken
    },
    existingContractsConfig,
    interopBroadcasterApiUrl
  });

  const chainCDeployment = deployedChains.c;
  if (!chainCDeployment) {
    throw new Error('Missing chain C deployment data after setup');
  }

  const invoicePaymentAddress = chainCDeployment.invoicePayment;
  if (!invoicePaymentAddress) {
    throw new Error('Missing chain C InvoicePayment address after deployment');
  }

  const chainATokens = deployedChains.a?.tokens ?? {};
  const chainBTokens = deployedChains.b?.tokens ?? {};
  const chainCTokens = chainCDeployment.tokens ?? {};

  const chainAPublicContracts = buildTokenContractsForPublicPermissions('A', chainATokens);
  const chainBPublicContracts = buildTokenContractsForPublicPermissions('B', chainBTokens);
  const chainCPublicContracts = [
    {
      name: 'Chain C InvoicePayment',
      description: 'InvoicePayment contract deployed on chain C.',
      address: invoicePaymentAddress,
      abi: InvoicePaymentArtifact.abi as Abi
    },
    ...buildTokenContractsForPublicPermissions('C', chainCTokens)
  ];

  console.log('\nRegistering public contracts and permissions on chains A, B, and C...');
  await Promise.all([
    setupPublicContracts(chainASession.adminApiClient, chainAPublicContracts),
    setupPublicContracts(chainBSession.adminApiClient, chainBPublicContracts),
    setupPublicContracts(chainCSession.adminApiClient, chainCPublicContracts)
  ]);

  const chainAConfig = {
    ...deployedChains.a,
    rpcUrl: chainA.rpcUrl,
    apiUrl: chainASession.resolvedApiUrl,
    authBaseUrl: chainA.authBaseUrl,
    sso: toSsoConfig(ssoOnA),
    application: applicationOnA
  };
  const chainBConfig = {
    ...deployedChains.b,
    rpcUrl: chainB.rpcUrl,
    apiUrl: chainBSession.resolvedApiUrl,
    authBaseUrl: chainB.authBaseUrl,
    sso: toSsoConfig(ssoOnB),
    application: applicationOnB
  };
  const chainCConfig = {
    ...deployedChains.c,
    rpcUrl: chainC.rpcUrl,
    apiUrl: chainCSession.resolvedApiUrl,
    authBaseUrl: chainC.authBaseUrl
  };

  const mergedConfig = mergeContractsConfig(existingContractsConfig, {
    metadata: {
      generatedAt: new Date().toISOString(),
      deployer: executorAddress,
      admin: adminAddress
    },
    chains: {
      a: chainAConfig,
      b: chainBConfig,
      c: chainCConfig
    },
    sso: toSsoConfig(ssoOnA),
    interop: {
      l1InteropHandler: l1InteropHandler
        ? toAddress('L1_INTEROP_HANDLER', l1InteropHandler)
        : undefined,
      l2InteropCenter: l2InteropCenter
    }
  });

  writeContractsConfig(contractsConfigPath, mergedConfig);

  const composeUpdate = updatePermissionApisCompose({
    composePath: path.join(rootPath, 'prividium-3chain-local', 'docker-compose.yml'),
    services: [
      {
        serviceName: 'permissions-api-l2a',
        ssoImplementation: ssoOnA.accountImplementation,
        ssoBytecodeHash: ssoOnA.ssoBytecodeHash
      },
      {
        serviceName: 'permissions-api-l2b',
        ssoImplementation: ssoOnB.accountImplementation,
        ssoBytecodeHash: ssoOnB.ssoBytecodeHash
      }
    ]
  });

  syncEnvFromContractsConfig({
    rootPath,
    setupEnvPath,
    setupPath,
    backendPath,
    webAppPath,
    contractsConfigPath
  });

  console.log('\nSetup summary:');
  console.log(`  Contracts config: ${contractsConfigPath}`);
  console.log(`  Chain A SSO Factory: ${ssoOnA.factory}`);
  console.log(`  Chain B SSO Factory: ${ssoOnB.factory}`);
  console.log(`  Chain A app client ID: ${applicationOnA.oauthClientId}`);
  console.log(`  Chain B app client ID: ${applicationOnB.oauthClientId}`);
  console.log(`  Chain C InvoicePayment: ${chainCConfig.invoicePayment ?? 'n/a'}`);
  for (const serviceSummary of composeUpdate.services) {
    console.log(
      `  ${serviceSummary.serviceName} bundler RPC: ${serviceSummary.bundlerRpcUrl}`
    );
  }
  console.log(
    `  Chain C tokens: ${Object.entries(chainCConfig.tokens ?? {})
      .map(([key, value]) => `${key.toUpperCase()}=${value?.address ?? 'n/a'}`)
      .join(', ')}`
  );
  console.log('\nRestart command for permission APIs (A/B):');
  console.log(`  ${composeUpdate.restartCommand}`);

  outro('3-chain setup completed successfully.');
}

main().catch((error) => {
  console.error('\n❌ 3-chain setup failed:');
  console.error(error);
  process.exit(1);
});
