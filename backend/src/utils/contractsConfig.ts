import fs from 'node:fs';
import path from 'node:path';
import type { Address } from 'viem';

import { env } from './envConfig';

export type ChainKey = 'a' | 'b' | 'c';
export type TokenKey = 'usdc' | 'sgd' | 'tbill';

export type SsoContracts = {
  factory?: `0x${string}`;
  beacon?: `0x${string}`;
  accountImplementation?: `0x${string}`;
  ssoBytecodeHash?: `0x${string}`;
  webauthnValidator?: `0x${string}`;
  eoaValidator?: `0x${string}`;
  sessionValidator?: `0x${string}`;
  guardianExecutor?: `0x${string}`;
  entryPoint?: `0x${string}`;
};

export type TokenDeployment = {
  address?: `0x${string}`;
  assetId?: `0x${string}`;
  deployer?: `0x${string}`;
  admin?: `0x${string}`;
};

export type ChainDeployment = {
  chainId?: number;
  rpcUrl?: string;
  apiUrl?: string;
  authBaseUrl?: string;
  interopCenter?: `0x${string}`;
  nativeTokenVault?: `0x${string}`;
  deployer?: `0x${string}`;
  admin?: `0x${string}`;
  sso?: SsoContracts;
  invoicePayment?: `0x${string}`;
  tokens?: Partial<Record<TokenKey, TokenDeployment>>;
};

export type ContractsConfig = {
  metadata?: {
    generatedAt?: string;
    deployer?: `0x${string}`;
    admin?: `0x${string}`;
  };
  chains?: Partial<Record<ChainKey, ChainDeployment>>;
  sso?: {
    factory?: `0x${string}`;
    beacon?: `0x${string}`;
    accountImplementation?: `0x${string}`;
    ssoBytecodeHash?: `0x${string}`;
    webauthnValidator?: `0x${string}`;
    eoaValidator?: `0x${string}`;
    sessionValidator?: `0x${string}`;
    guardianExecutor?: `0x${string}`;
    entryPoint?: `0x${string}`;
  };
  interop?: {
    l1InteropHandler?: `0x${string}`;
    l2InteropCenter?: `0x${string}`;
  };
  app?: {
    counter?: `0x${string}`;
  };
};

export type ResolvedChainDeployment = {
  key: ChainKey;
  deployment: ChainDeployment;
};

const DEFAULT_CONFIG_PATH = path.join(process.cwd(), 'config', 'contracts.json');
const chainKeys: ChainKey[] = ['a', 'b', 'c'];

function resolveConfigPath(): string | null {
  if (env.CONTRACTS_CONFIG_PATH) {
    return path.isAbsolute(env.CONTRACTS_CONFIG_PATH)
      ? env.CONTRACTS_CONFIG_PATH
      : path.join(process.cwd(), env.CONTRACTS_CONFIG_PATH);
  }

  if (fs.existsSync(DEFAULT_CONFIG_PATH)) {
    return DEFAULT_CONFIG_PATH;
  }

  return null;
}

export function loadContractsConfig(): ContractsConfig | null {
  const configPath = resolveConfigPath();
  if (!configPath) {
    return null;
  }

  if (!fs.existsSync(configPath)) {
    return null;
  }

  const raw = fs.readFileSync(configPath, 'utf8');
  if (!raw.trim()) {
    return null;
  }

  return JSON.parse(raw) as ContractsConfig;
}

function getOrderedChainEntries(
  config: ContractsConfig | null | undefined,
  preferredChainId?: number
): ResolvedChainDeployment[] {
  const chains = config?.chains;
  if (!chains) {
    return [];
  }

  const entries = chainKeys.flatMap((key) => {
    const deployment = chains[key];
    return deployment ? [{ key, deployment }] : [];
  });

  if (!preferredChainId) {
    return entries;
  }

  const preferredIndex = entries.findIndex(
    ({ deployment }) => deployment.chainId === preferredChainId
  );
  if (preferredIndex <= 0) {
    return entries;
  }

  return [
    entries[preferredIndex],
    ...entries.slice(0, preferredIndex),
    ...entries.slice(preferredIndex + 1)
  ];
}

export function getPreferredChainDeployment(
  config: ContractsConfig | null | undefined,
  preferredChainId?: number
): ResolvedChainDeployment | null {
  const orderedEntries = getOrderedChainEntries(config, preferredChainId);
  return orderedEntries[0] ?? null;
}

export function getChainDeploymentById(
  config: ContractsConfig | null | undefined,
  chainId: number
): ResolvedChainDeployment | null {
  const chains = config?.chains;
  if (!chains) {
    return null;
  }

  for (const key of chainKeys) {
    const deployment = chains[key];
    if (deployment?.chainId === chainId) {
      return { key, deployment };
    }
  }

  return null;
}

export function resolveTokenAddressFromConfig(
  config: ContractsConfig | null | undefined,
  tokenKey: TokenKey,
  preferredChainId?: number
): Address | undefined {
  for (const { deployment } of getOrderedChainEntries(config, preferredChainId)) {
    const tokenAddress = deployment.tokens?.[tokenKey]?.address;
    if (tokenAddress) {
      return tokenAddress;
    }
  }

  return undefined;
}

export function warnIfMismatch(label: string, fromConfig?: string, fromEnv?: string) {
  if (!fromConfig || !fromEnv) return;
  if (fromConfig.toLowerCase() !== fromEnv.toLowerCase()) {
    console.warn(`⚠️  ${label} mismatch: config=${fromConfig} env=${fromEnv}. Using config value.`);
  }
}
