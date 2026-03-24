import fs from 'node:fs';
import path from 'node:path';
import type { Address, Hex } from 'viem';

export type ChainKey = 'a' | 'b' | 'c';
export type TokenKey = 'usdc' | 'sgd' | 'tbill';

export type SsoContracts = {
  factory?: Address;
  beacon?: Address;
  accountImplementation?: Address;
  ssoBytecodeHash?: Hex;
  webauthnValidator?: Address;
  eoaValidator?: Address;
  sessionValidator?: Address;
  guardianExecutor?: Address;
  entryPoint?: Address;
};

export type TokenDeployment = {
  address?: Address;
  assetId?: Hex;
  deployer?: Address;
  admin?: Address;
};

export type ApplicationDeployment = {
  id?: string;
  name?: string;
  oauthClientId?: string;
  origin?: string | null;
  oauthRedirectUris?: string[];
};

export type ChainDeployment = {
  chainId?: number;
  rpcUrl?: string;
  apiUrl?: string;
  authBaseUrl?: string;
  interopCenter?: Address;
  nativeTokenVault?: Address;
  deployer?: Address;
  admin?: Address;
  sso?: SsoContracts;
  invoicePayment?: Address;
  application?: ApplicationDeployment;
  tokens?: Partial<Record<TokenKey, TokenDeployment>>;
};

export type ContractsConfig = {
  metadata?: {
    generatedAt?: string;
    deployer?: Address;
    admin?: Address;
  };
  chains?: Partial<Record<ChainKey, ChainDeployment>>;
  sso?: SsoContracts;
  interop?: {
    l1InteropHandler?: Address;
    l2InteropCenter?: Address;
  };
  app?: Record<string, Address>;
};

const chainKeys: ChainKey[] = ['a', 'b', 'c'];
const tokenKeys: TokenKey[] = ['usdc', 'sgd', 'tbill'];

function mergeRecord<T extends Record<string, unknown>>(
  base: T | undefined,
  update: Partial<T> | undefined
): T | undefined {
  if (!base && !update) {
    return undefined;
  }

  return {
    ...base,
    ...(update ?? {})
  } as T;
}

function mergeTokenDeployments(
  base: ChainDeployment['tokens'],
  update: ChainDeployment['tokens']
): ChainDeployment['tokens'] | undefined {
  if (!base && !update) {
    return undefined;
  }

  const merged: NonNullable<ChainDeployment['tokens']> = {};
  for (const tokenKey of tokenKeys) {
    const mergedToken = mergeRecord(base?.[tokenKey], update?.[tokenKey]);
    if (mergedToken) {
      merged[tokenKey] = mergedToken;
    }
  }

  return Object.keys(merged).length > 0 ? merged : undefined;
}

function mergeChainDeployment(
  base: ChainDeployment | undefined,
  update: Partial<ChainDeployment> | undefined
): ChainDeployment | undefined {
  if (!base && !update) {
    return undefined;
  }

  const mergedSso = mergeRecord(base?.sso, update?.sso);
  const mergedApplication = mergeRecord(base?.application, update?.application);
  const mergedTokens = mergeTokenDeployments(base?.tokens, update?.tokens);

  return {
    ...base,
    ...(update ?? {}),
    ...(mergedSso ? { sso: mergedSso } : {}),
    ...(mergedApplication ? { application: mergedApplication } : {}),
    ...(mergedTokens ? { tokens: mergedTokens } : {})
  };
}

function mergeChains(
  base: ContractsConfig['chains'],
  update: ContractsConfig['chains']
): ContractsConfig['chains'] | undefined {
  if (!base && !update) {
    return undefined;
  }

  const merged: NonNullable<ContractsConfig['chains']> = {};
  for (const chainKey of chainKeys) {
    const mergedChain = mergeChainDeployment(base?.[chainKey], update?.[chainKey]);
    if (mergedChain) {
      merged[chainKey] = mergedChain;
    }
  }

  return Object.keys(merged).length > 0 ? merged : undefined;
}

export function resolveContractsConfigPath(
  rootPath: string,
  configuredPath?: string,
  basePath?: string
): string {
  if (configuredPath) {
    const resolvedBase = basePath ?? rootPath;
    return path.isAbsolute(configuredPath)
      ? configuredPath
      : path.join(resolvedBase, configuredPath);
  }

  return path.join(rootPath, 'config', 'contracts.json');
}

export function readContractsConfig(configPath: string): ContractsConfig | null {
  if (!fs.existsSync(configPath)) {
    return null;
  }

  const raw = fs.readFileSync(configPath, 'utf8');
  if (!raw.trim()) {
    return null;
  }

  return JSON.parse(raw) as ContractsConfig;
}

export function writeContractsConfig(configPath: string, config: ContractsConfig): void {
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

export function mergeContractsConfig(
  base: ContractsConfig | null,
  update: Partial<ContractsConfig>
): ContractsConfig {
  const mergedMetadata = mergeRecord(base?.metadata, update.metadata);
  const mergedSso = mergeRecord(base?.sso, update.sso);
  const mergedInterop = mergeRecord(base?.interop, update.interop);
  const mergedApp = mergeRecord(base?.app, update.app);
  const mergedChains = mergeChains(base?.chains, update.chains);

  return {
    ...(mergedMetadata ? { metadata: mergedMetadata } : {}),
    ...(mergedChains ? { chains: mergedChains } : {}),
    ...(mergedSso ? { sso: mergedSso } : {}),
    ...(mergedInterop ? { interop: mergedInterop } : {}),
    ...(mergedApp ? { app: mergedApp } : {})
  };
}

export function assertContractsConfig(
  config: ContractsConfig,
  sections: Array<keyof ContractsConfig>
) {
  for (const section of sections) {
    const values = config[section];
    if (!values) {
      throw new Error(`Missing contracts config section: ${section}`);
    }
    for (const [key, value] of Object.entries(values)) {
      if (!value) {
        throw new Error(`Missing contracts config value: ${section}.${key}`);
      }
    }
  }
}
