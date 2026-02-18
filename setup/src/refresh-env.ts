import path from 'node:path';
import { intro, outro } from '@clack/prompts';
import { assertDotEnv, extractConfigOptional } from './tools/config-tools';
import { resolveContractsConfigPath } from './tools/contracts-config';
import { syncEnvFromContractsConfig } from './tools/env-sync';

async function main() {
  intro('Refreshing env from contracts config...');

  const rootPath = path.join(import.meta.dirname, '..', '..');
  const setupPath = path.join(rootPath, 'setup');
  const webAppPath = path.join(rootPath, 'web-app');
  const backendPath = path.join(rootPath, 'backend');
  const setupEnvPath = path.join(setupPath, '.env');

  assertDotEnv(setupPath);
  assertDotEnv(webAppPath);
  assertDotEnv(backendPath);

  const contractsConfigPath = resolveContractsConfigPath(
    rootPath,
    extractConfigOptional(setupEnvPath, 'CONTRACTS_CONFIG_PATH'),
    setupPath
  );

  syncEnvFromContractsConfig({
    rootPath,
    setupEnvPath,
    setupPath,
    backendPath,
    webAppPath,
    contractsConfigPath
  });

  outro('Env refreshed from contracts config.');
}

main().catch((e) => {
  console.error('\n❌ Env refresh failed:');
  console.error(e);
  process.exit(1);
});
