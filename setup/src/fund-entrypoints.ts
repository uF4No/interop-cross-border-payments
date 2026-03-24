import path from 'node:path';
import { intro, outro } from '@clack/prompts';
import { type Address, getAddress } from 'viem';

import { assertDotEnv, extractConfig, extractConfigOptional } from './tools/config-tools';
import { createAdminSession } from './tools/create-admin-client';
import {
  readContractsConfig,
  resolveContractsConfigPath
} from './tools/contracts-config';
import {
  ensureEntrypointsFunded,
  formatFundingSummary
} from './tools/entrypoint-funding';
import { assertPrividiumApiUp, assertZksyncOsIsUp } from './tools/service-assert';

type ChainConfig = {
  key: 'a' | 'b';
  label: 'A' | 'B';
  chainId: number;
  rpcUrl: string;
  apiUrl: string;
  authBaseUrl: string;
  entryPoint: Address;
};

const DEFAULT_ENTRYPOINT_MIN_BALANCE_WEI = 10_000_000_000_000_000n; // 0.01 ETH
const DEFAULT_ENTRYPOINT_TARGET_BALANCE_WEI = 50_000_000_000_000_000n; // 0.05 ETH

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

function readChainConfig(setupEnvPath: string, key: 'a' | 'b'): ChainConfig {
  const label = key.toUpperCase() as 'A' | 'B';
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

async function resolveAuthToken(chain: ChainConfig, adminPrivateKey: `0x${string}`, adminAddress: Address) {
  await assertZksyncOsIsUp(chain.rpcUrl, BigInt(chain.chainId));
  const resolvedApiUrl = await assertPrividiumApiUp(chain.apiUrl);
  const { token } = await createAdminSession(
    resolvedApiUrl,
    new URL(chain.authBaseUrl).host,
    adminPrivateKey,
    adminAddress as `0x${string}`
  );

  return token;
}

async function main() {
  intro('Funding entrypoints on chains A and B...');

  const rootPath = path.join(import.meta.dirname, '..', '..');
  const setupPath = path.join(rootPath, 'setup');
  const setupEnvPath = path.join(setupPath, '.env');

  assertDotEnv(setupPath);

  const chainA = readChainConfig(setupEnvPath, 'a');
  const chainB = readChainConfig(setupEnvPath, 'b');

  const contractsConfigPath = resolveContractsConfigPath(
    rootPath,
    extractConfigOptional(setupEnvPath, 'CONTRACTS_CONFIG_PATH'),
    setupPath
  );
  const contractsConfig = readContractsConfig(contractsConfigPath);

  const chainAEntrypointFromConfig = contractsConfig?.chains?.a?.sso?.entryPoint;
  const chainBEntrypointFromConfig = contractsConfig?.chains?.b?.sso?.entryPoint;

  const adminPrivateKey = toPrivateKey(
    'ADMIN_PRIVATE_KEY',
    extractConfig(setupEnvPath, 'ADMIN_PRIVATE_KEY')
  );
  const adminAddress = toAddress('ADMIN_ADDRESS', extractConfig(setupEnvPath, 'ADMIN_ADDRESS'));
  const executorPrivateKey = extractConfigOptional(setupEnvPath, 'EXECUTOR_PRIVATE_KEY')
    ? toPrivateKey('EXECUTOR_PRIVATE_KEY', extractConfig(setupEnvPath, 'EXECUTOR_PRIVATE_KEY'))
    : adminPrivateKey;

  const minimumBalanceWei = toWei(
    'ENTRYPOINT_MIN_BALANCE_WEI',
    extractConfigOptional(setupEnvPath, 'ENTRYPOINT_MIN_BALANCE_WEI'),
    DEFAULT_ENTRYPOINT_MIN_BALANCE_WEI
  );
  const targetBalanceWei = toWei(
    'ENTRYPOINT_TARGET_BALANCE_WEI',
    extractConfigOptional(setupEnvPath, 'ENTRYPOINT_TARGET_BALANCE_WEI'),
    DEFAULT_ENTRYPOINT_TARGET_BALANCE_WEI
  );

  const [tokenA, tokenB] = await Promise.all([
    resolveAuthToken(chainA, adminPrivateKey, adminAddress),
    resolveAuthToken(chainB, adminPrivateKey, adminAddress)
  ]);

  const results = await ensureEntrypointsFunded({
    executorPrivateKey,
    minimumBalanceWei,
    targetBalanceWei,
    chains: [
      {
        label: 'A',
        chainId: chainA.chainId,
        rpcUrl: chainA.rpcUrl,
        authToken: tokenA,
        entryPoint: chainAEntrypointFromConfig ?? chainA.entryPoint
      },
      {
        label: 'B',
        chainId: chainB.chainId,
        rpcUrl: chainB.rpcUrl,
        authToken: tokenB,
        entryPoint: chainBEntrypointFromConfig ?? chainB.entryPoint
      }
    ]
  });

  console.log('\nEntrypoint funding summary:');
  for (const result of results) {
    console.log(`  ${formatFundingSummary(result)}`);
  }

  outro('Entrypoint funding complete.');
}

main().catch((error) => {
  console.error('\n❌ Entrypoint funding failed:');
  console.error(error);
  process.exit(1);
});
