import fs from 'node:fs';
import path from 'node:path';
import { config, set } from '@dotenvx/dotenvx';

// Remove logs from dotenv parsing.
config({ quiet: true, ignore: ['MISSING_ENV_FILE'] });

export function extractConfig(path: string, name: string): string {
  const configMap: Record<string, string> = {};
  config({
    path,
    processEnv: configMap
  });

  if (configMap[name] === undefined) {
    throw new Error(`Missing config ${name} for ${path}`);
  }

  return configMap[name];
}

export function extractConfigOptional(path: string, name: string): string | undefined {
  const configMap: Record<string, string> = {};
  config({
    path,
    processEnv: configMap
  });

  const value = configMap[name];
  if (value === undefined || value.trim() === '') {
    return undefined;
  }

  return value;
}

export function setDotEnvConfig(dirPath: string, name: string, value: string): void {
  set(name, value, { path: path.join(dirPath, '.env'), encrypt: false });
}

export function assertDotEnv(baseDir: string) {
  if (!fs.existsSync(path.join(baseDir, '.env'))) {
    fs.copyFileSync(path.join(baseDir, '.env.example'), path.join(baseDir, '.env'));
  }
}
