import fs from 'node:fs';
import path from 'node:path';

export type ContractsConfig = {
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
  app?: Record<string, `0x${string}`>;
};

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
  return {
    sso: {
      ...base?.sso,
      ...(update.sso ?? {})
    },
    interop: {
      ...base?.interop,
      ...(update.interop ?? {})
    },
    app: {
      ...base?.app,
      ...(update.app ?? {})
    }
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
