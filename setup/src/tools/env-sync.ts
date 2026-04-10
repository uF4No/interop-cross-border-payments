import path from 'node:path';

import { extractConfigOptional, removeDotEnvConfig, setDotEnvConfig } from './config-tools';
import {
  type ChainDeployment,
  type ContractsConfig,
  type PrivateInteropChainDeployment,
  type PrivateInteropDeployment,
  type SsoContracts,
  type TokenDeployment,
  type TokenKey,
  readContractsConfig
} from './contracts-config';

type SyncEnvArgs = {
  rootPath: string;
  setupEnvPath: string;
  setupPath: string;
  backendPath: string;
  webAppPath: string;
  contractsConfigPath: string;
};

type ChainKey = 'a' | 'b' | 'c';

const chainKeys: ChainKey[] = ['a', 'b', 'c'];
const tokenKeys: TokenKey[] = ['usdc', 'sgd', 'tbill'];
const privateChainKeys: ChainKey[] = ['a', 'b', 'c'];
const privateSourceKeys: Array<Exclude<ChainKey, 'c'>> = ['a', 'b'];

const ssoEnvMap: Array<[keyof SsoContracts, string]> = [
  ['factory', 'SSO_FACTORY_CONTRACT'],
  ['beacon', 'SSO_BEACON_CONTRACT'],
  ['accountImplementation', 'SSO_ACCOUNT_IMPLEMENTATION_CONTRACT'],
  ['ssoBytecodeHash', 'SSO_BYTECODE_HASH'],
  ['eoaValidator', 'SSO_EOA_VALIDATOR_CONTRACT'],
  ['webauthnValidator', 'SSO_WEBAUTHN_VALIDATOR_CONTRACT'],
  ['sessionValidator', 'SSO_SESSION_VALIDATOR_CONTRACT'],
  ['guardianExecutor', 'SSO_GUARDIAN_EXECUTOR_CONTRACT'],
  ['entryPoint', 'SSO_ENTRYPOINT_CONTRACT']
];

function chainLabel(key: ChainKey): string {
  return key.toUpperCase();
}

function setOptionalEnv(dirPath: string, name: string, value?: string | number | null): void {
  if (value === undefined || value === null || value === '') {
    return;
  }
  setDotEnvConfig(dirPath, name, String(value));
}

function clearEnvKeys(dirPath: string, names: readonly string[]): void {
  for (const name of names) {
    removeDotEnvConfig(dirPath, name);
  }
}

function syncSso(
  dirPath: string,
  sso: SsoContracts | undefined,
  options?: { suffix?: string; prefix?: string }
): void {
  if (!sso) {
    return;
  }

  const suffix = options?.suffix ?? '';
  const prefix = options?.prefix ?? '';

  for (const [key, envKey] of ssoEnvMap) {
    setOptionalEnv(dirPath, `${prefix}${envKey}${suffix}`, sso[key]);
  }
}

function syncToken(
  dirPath: string,
  tokenKey: TokenKey,
  token: TokenDeployment | undefined,
  options?: { suffix?: string; prefix?: string }
): void {
  if (!token) {
    return;
  }

  const suffix = options?.suffix ?? '';
  const prefix = options?.prefix ?? '';
  const tokenLabel = tokenKey.toUpperCase();

  setOptionalEnv(dirPath, `${prefix}TOKEN_${tokenLabel}_ADDRESS${suffix}`, token.address);
  setOptionalEnv(dirPath, `${prefix}TOKEN_${tokenLabel}_ASSET_ID${suffix}`, token.assetId);
  setOptionalEnv(dirPath, `${prefix}TOKEN_${tokenLabel}_DEPLOYER${suffix}`, token.deployer);
  setOptionalEnv(dirPath, `${prefix}TOKEN_${tokenLabel}_ADMIN${suffix}`, token.admin);
}

function syncChain(
  dirPath: string,
  key: ChainKey,
  chain: ChainDeployment | undefined,
  options?: { prefix?: string }
): void {
  if (!chain) {
    return;
  }

  const prefix = options?.prefix ?? '';
  const label = chainLabel(key);

  setOptionalEnv(dirPath, `${prefix}CHAIN_${label}_CHAIN_ID`, chain.chainId);
  setOptionalEnv(dirPath, `${prefix}CHAIN_${label}_RPC_URL`, chain.rpcUrl);
  setOptionalEnv(dirPath, `${prefix}CHAIN_${label}_API_URL`, chain.apiUrl);
  setOptionalEnv(dirPath, `${prefix}CHAIN_${label}_AUTH_BASE_URL`, chain.authBaseUrl);
  setOptionalEnv(dirPath, `${prefix}CHAIN_${label}_DEPLOYER`, chain.deployer);
  setOptionalEnv(dirPath, `${prefix}CHAIN_${label}_ADMIN`, chain.admin);
  setOptionalEnv(dirPath, `${prefix}CHAIN_${label}_INTEROP_CENTER`, chain.interopCenter);
  setOptionalEnv(dirPath, `${prefix}CHAIN_${label}_NATIVE_TOKEN_VAULT`, chain.nativeTokenVault);
  setOptionalEnv(dirPath, `${prefix}CHAIN_${label}_INVOICE_PAYMENT`, chain.invoicePayment);

  const oauthClientId = chain.application?.oauthClientId;
  if (oauthClientId) {
    setOptionalEnv(dirPath, `${prefix}CLIENT_ID_CHAIN_${label}`, oauthClientId);
    setOptionalEnv(dirPath, `${prefix}CHAIN_${label}_CLIENT_ID`, oauthClientId);
    setOptionalEnv(dirPath, `${prefix}PRIVIDIUM_CHAIN_${label}_CLIENT_ID`, oauthClientId);
  }

  syncSso(dirPath, chain.sso, { suffix: `_CHAIN_${label}`, prefix });

  for (const tokenKey of tokenKeys) {
    syncToken(dirPath, tokenKey, chain.tokens?.[tokenKey], {
      suffix: `_CHAIN_${label}`,
      prefix
    });
  }
}

function syncLegacyBackCompat(
  args: SyncEnvArgs,
  config: ContractsConfig,
  chainA: ChainDeployment | undefined,
  chainC: ChainDeployment | undefined
): void {
  const ssoForLegacy = chainA?.sso ?? config.sso;

  syncSso(args.backendPath, ssoForLegacy);

  if (ssoForLegacy?.webauthnValidator) {
    setDotEnvConfig(args.webAppPath, 'VITE_SSO_WEBAUTHN_VALIDATOR', ssoForLegacy.webauthnValidator);
  }
  if (ssoForLegacy?.entryPoint) {
    setDotEnvConfig(args.webAppPath, 'VITE_SSO_ENTRYPOINT', ssoForLegacy.entryPoint);
  }

  setOptionalEnv(args.backendPath, 'INVOICE_PAYMENT_CONTRACT', chainC?.invoicePayment);
  setOptionalEnv(args.webAppPath, 'VITE_INVOICE_PAYMENT_CONTRACT', chainC?.invoicePayment);

  for (const tokenKey of tokenKeys) {
    const tokenOnA = chainA?.tokens?.[tokenKey];
    const tokenOnC = chainC?.tokens?.[tokenKey];
    const tokenLabel = tokenKey.toUpperCase();

    // Keep old env usage stable, defaulting to chain A (user-facing chains).
    setOptionalEnv(args.backendPath, `TOKEN_${tokenLabel}_ADDRESS`, tokenOnA?.address);
    setOptionalEnv(args.webAppPath, `VITE_TOKEN_${tokenLabel}_ADDRESS`, tokenOnA?.address);

    // Also expose chain C canonical deployment directly for backend integrations.
    setOptionalEnv(args.backendPath, `TOKEN_${tokenLabel}_CHAIN_C_ADDRESS`, tokenOnC?.address);
  }

  if (config.interop?.l1InteropHandler) {
    setDotEnvConfig(args.backendPath, 'L1_INTEROP_HANDLER', config.interop.l1InteropHandler);
  }
  if (config.interop?.l2InteropCenter) {
    setDotEnvConfig(args.backendPath, 'L2_INTEROP_CENTER', config.interop.l2InteropCenter);
  }

  if (config.app) {
    for (const [name, address] of Object.entries(config.app)) {
      const envKey = `VITE_${name
        .replace(/[^a-zA-Z0-9]/g, '_')
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .toUpperCase()}_CONTRACT_ADDRESS`;
      setDotEnvConfig(args.webAppPath, envKey, address);
    }
  }

  const chainAClientId = chainA?.application?.oauthClientId;
  if (chainAClientId) {
    setDotEnvConfig(args.webAppPath, 'VITE_CLIENT_ID', chainAClientId);
  }

  const interopRelayAddress =
    extractConfigOptional(args.setupEnvPath, 'INTEROP_RELAY_ADDRESS') ??
    extractConfigOptional(args.setupEnvPath, 'PRIVIDIUM_INTEROP_RELAY_ADDRESS');
  if (interopRelayAddress) {
    setDotEnvConfig(args.backendPath, 'INTEROP_RELAY_ADDRESS', interopRelayAddress);
    setDotEnvConfig(args.webAppPath, 'VITE_INTEROP_RELAY_ADDRESS', interopRelayAddress);
    setDotEnvConfig(args.webAppPath, 'VITE_CHAIN_C_INTEROP_RELAY_ADDRESS', interopRelayAddress);
  }
}

function privateChainEnvNames(key: ChainKey) {
  const label = chainLabel(key);
  return [
    `VITE_PRIVATE_CHAIN_${label}_CHAIN_ID`,
    `VITE_PRIVATE_CHAIN_${label}_RPC_URL`,
    `VITE_PRIVATE_CHAIN_${label}_INTEROP_CENTER`,
    `VITE_PRIVATE_CHAIN_${label}_INTEROP_HANDLER`,
    `VITE_PRIVATE_CHAIN_${label}_NATIVE_TOKEN_VAULT`,
    `VITE_PRIVATE_CHAIN_${label}_ASSET_ROUTER`
  ] as const;
}

function privatePaymentTokenEnvName(sourceKey: Exclude<ChainKey, 'c'>, tokenKey: TokenKey) {
  return `VITE_PRIVATE_TOKEN_${tokenKey.toUpperCase()}_ADDRESS_CHAIN_C_FROM_${sourceKey.toUpperCase()}`;
}

function syncPrivateInteropChain(
  dirPath: string,
  key: ChainKey,
  chain: PrivateInteropChainDeployment | undefined
) {
  const label = chainLabel(key);
  if (!chain) {
    clearEnvKeys(dirPath, privateChainEnvNames(key));
    return;
  }

  setOptionalEnv(dirPath, `VITE_PRIVATE_CHAIN_${label}_CHAIN_ID`, chain.chainId);
  setOptionalEnv(dirPath, `VITE_PRIVATE_CHAIN_${label}_RPC_URL`, chain.rpcUrl);
  setOptionalEnv(dirPath, `VITE_PRIVATE_CHAIN_${label}_INTEROP_CENTER`, chain.interopCenter);
  setOptionalEnv(dirPath, `VITE_PRIVATE_CHAIN_${label}_INTEROP_HANDLER`, chain.interopHandler);
  setOptionalEnv(
    dirPath,
    `VITE_PRIVATE_CHAIN_${label}_NATIVE_TOKEN_VAULT`,
    chain.nativeTokenVault
  );
  setOptionalEnv(dirPath, `VITE_PRIVATE_CHAIN_${label}_ASSET_ROUTER`, chain.assetRouter);
}

function syncPrivateInterop(args: SyncEnvArgs, privateInterop: PrivateInteropDeployment | undefined) {
  const webAppDir = args.webAppPath;

  if (!privateInterop?.enabled) {
    clearEnvKeys(webAppDir, ['VITE_PRIVATE_INTEROP_ENABLED']);
    for (const key of privateChainKeys) {
      clearEnvKeys(webAppDir, privateChainEnvNames(key));
    }
    for (const sourceKey of privateSourceKeys) {
      for (const tokenKey of tokenKeys) {
        clearEnvKeys(webAppDir, [privatePaymentTokenEnvName(sourceKey, tokenKey)]);
      }
    }
    return;
  }

  setDotEnvConfig(webAppDir, 'VITE_PRIVATE_INTEROP_ENABLED', '1');
  for (const key of privateChainKeys) {
    syncPrivateInteropChain(webAppDir, key, privateInterop.chains?.[key]);
  }

  for (const sourceKey of privateSourceKeys) {
    for (const tokenKey of tokenKeys) {
      const paymentToken = privateInterop.paymentTokens?.[sourceKey]?.[tokenKey]?.address;
      const envName = privatePaymentTokenEnvName(sourceKey, tokenKey);
      if (paymentToken) {
        setDotEnvConfig(webAppDir, envName, paymentToken);
      } else {
        clearEnvKeys(webAppDir, [envName]);
      }
    }
  }
}

export function syncEnvFromContractsConfig(args: SyncEnvArgs) {
  const config = readContractsConfig(args.contractsConfigPath);
  if (!config) {
    throw new Error(`Missing contracts config at ${args.contractsConfigPath}`);
  }

  const relativeToSetup = path.relative(args.setupPath, args.contractsConfigPath);
  const relativeToBackend = path.relative(args.backendPath, args.contractsConfigPath);

  setDotEnvConfig(args.setupPath, 'CONTRACTS_CONFIG_PATH', relativeToSetup);
  setDotEnvConfig(args.backendPath, 'CONTRACTS_CONFIG_PATH', relativeToBackend);

  for (const key of chainKeys) {
    const chain = config.chains?.[key];
    syncChain(args.setupPath, key, chain);
    syncChain(args.backendPath, key, chain);
    syncChain(args.webAppPath, key, chain, { prefix: 'VITE_' });
  }

  const chainA = config.chains?.a;
  const chainB = config.chains?.b;
  const chainC = config.chains?.c;

  syncLegacyBackCompat(args, config, chainA, chainC);
  syncPrivateInterop(args, config.privateInterop);

  const fallbackChainAId = extractConfigOptional(args.setupEnvPath, 'PRIVIDIUM_CHAIN_ID');
  const fallbackChainARpc = extractConfigOptional(args.setupEnvPath, 'PRIVIDIUM_RPC_URL');
  const chainAId = chainA?.chainId?.toString() ?? fallbackChainAId;
  const chainARpc = chainA?.rpcUrl ?? fallbackChainARpc;

  if (chainAId) {
    setDotEnvConfig(args.webAppPath, 'VITE_SSO_CHAIN_ID', chainAId);
    setDotEnvConfig(args.backendPath, 'PRIVIDIUM_CHAIN_ID', chainAId);
  }
  if (chainARpc) {
    setDotEnvConfig(args.webAppPath, 'VITE_SSO_RPC_URL', chainARpc);
    setDotEnvConfig(args.backendPath, 'PRIVIDIUM_RPC_URL', chainARpc);
  }

  const chainBId = chainB?.chainId?.toString();
  const chainCId = chainC?.chainId?.toString();
  if (chainBId) {
    setDotEnvConfig(args.backendPath, 'PRIVIDIUM_CHAIN_B_ID', chainBId);
  }
  if (chainCId) {
    setDotEnvConfig(args.backendPath, 'PRIVIDIUM_CHAIN_C_ID', chainCId);
  }
}
