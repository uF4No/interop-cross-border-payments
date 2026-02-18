import path from 'node:path';

import { extractConfigOptional, setDotEnvConfig } from './config-tools';
import { readContractsConfig } from './contracts-config';

type SyncEnvArgs = {
  rootPath: string;
  setupEnvPath: string;
  setupPath: string;
  backendPath: string;
  webAppPath: string;
  contractsConfigPath: string;
};

export function syncEnvFromContractsConfig(args: SyncEnvArgs) {
  const config = readContractsConfig(args.contractsConfigPath);
  if (!config) {
    throw new Error(`Missing contracts config at ${args.contractsConfigPath}`);
  }

  const relativeToSetup = path.relative(args.setupPath, args.contractsConfigPath);
  const relativeToBackend = path.relative(args.backendPath, args.contractsConfigPath);

  setDotEnvConfig(args.setupPath, 'CONTRACTS_CONFIG_PATH', relativeToSetup);
  setDotEnvConfig(args.backendPath, 'CONTRACTS_CONFIG_PATH', relativeToBackend);

  if (config.sso?.eoaValidator) {
    setDotEnvConfig(args.backendPath, 'SSO_EOA_VALIDATOR_CONTRACT', config.sso.eoaValidator);
  }
  if (config.sso?.webauthnValidator) {
    setDotEnvConfig(
      args.backendPath,
      'SSO_WEBAUTHN_VALIDATOR_CONTRACT',
      config.sso.webauthnValidator
    );
    setDotEnvConfig(args.webAppPath, 'VITE_SSO_WEBAUTHN_VALIDATOR', config.sso.webauthnValidator);
  }
  if (config.sso?.sessionValidator) {
    setDotEnvConfig(
      args.backendPath,
      'SSO_SESSION_VALIDATOR_CONTRACT',
      config.sso.sessionValidator
    );
  }
  if (config.sso?.guardianExecutor) {
    setDotEnvConfig(
      args.backendPath,
      'SSO_GUARDIAN_EXECUTOR_CONTRACT',
      config.sso.guardianExecutor
    );
  }
  if (config.sso?.entryPoint) {
    setDotEnvConfig(args.backendPath, 'SSO_ENTRYPOINT_CONTRACT', config.sso.entryPoint);
    setDotEnvConfig(args.webAppPath, 'VITE_SSO_ENTRYPOINT', config.sso.entryPoint);
  }
  if (config.sso?.accountImplementation) {
    setDotEnvConfig(
      args.backendPath,
      'SSO_ACCOUNT_IMPLEMENTATION_CONTRACT',
      config.sso.accountImplementation
    );
  }
  if (config.sso?.beacon) {
    setDotEnvConfig(args.backendPath, 'SSO_BEACON_CONTRACT', config.sso.beacon);
  }
  if (config.sso?.factory) {
    setDotEnvConfig(args.backendPath, 'SSO_FACTORY_CONTRACT', config.sso.factory);
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

  const chainId = extractConfigOptional(args.setupEnvPath, 'PRIVIDIUM_CHAIN_ID');
  if (chainId) {
    setDotEnvConfig(args.webAppPath, 'VITE_SSO_CHAIN_ID', chainId);
  }

  const proxyUrl = extractConfigOptional(args.setupEnvPath, 'PRIVIDIUM_RPC_URL');
  if (proxyUrl) {
    setDotEnvConfig(args.webAppPath, 'VITE_SSO_RPC_URL', proxyUrl);
  }
}
