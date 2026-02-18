import fs from 'node:fs';
import path from 'node:path';

import { env } from './envConfig';

export type ContractsConfig = {
  sso?: {
    factory?: `0x${string}`;
    beacon?: `0x${string}`;
    accountImplementation?: `0x${string}`;
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

const DEFAULT_CONFIG_PATH = path.join(process.cwd(), 'config', 'contracts.json');

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

export function warnIfMismatch(label: string, fromConfig?: string, fromEnv?: string) {
  if (!fromConfig || !fromEnv) return;
  if (fromConfig.toLowerCase() !== fromEnv.toLowerCase()) {
    console.warn(`⚠️  ${label} mismatch: config=${fromConfig} env=${fromEnv}. Using config value.`);
  }
}
