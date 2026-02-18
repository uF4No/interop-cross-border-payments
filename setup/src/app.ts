import path from 'node:path';
import { intro, outro, spinner } from '@clack/prompts';
import { setupCounterDapp } from './setups/counter-setup';
import { assertDotEnv, extractConfig, extractConfigOptional } from './tools/config-tools';
import {
  mergeContractsConfig,
  readContractsConfig,
  resolveContractsConfigPath,
  writeContractsConfig
} from './tools/contracts-config';
import { createAdminSession } from './tools/create-admin-client';
import { syncEnvFromContractsConfig } from './tools/env-sync';
import { assertPrividiumApiUp, assertZksyncOsIsUp } from './tools/service-assert';

async function main() {
  intro('Deploying app contracts...');

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
  const existingContractsConfig = readContractsConfig(contractsConfigPath);

  const permissionsApiUrl = extractConfig(setupEnvPath, 'PRIVIDIUM_API_URL');
  const authBaseUrl = extractConfig(setupEnvPath, 'PRIVIDIUM_AUTH_BASE_URL');
  const proxyUrl = extractConfig(setupEnvPath, 'PRIVIDIUM_RPC_URL');

  const siweDomain = new URL(authBaseUrl).host;
  const zksyncOsUrl = proxyUrl;

  const resolvedApiBaseUrl = await assertPrividiumApiUp(permissionsApiUrl);
  const chainIdRaw = extractConfig(setupEnvPath, 'PRIVIDIUM_CHAIN_ID');
  const l2ChainId = Number(chainIdRaw);
  if (!Number.isFinite(l2ChainId)) {
    throw new Error(`Invalid PRIVIDIUM_CHAIN_ID in ${setupEnvPath}: ${chainIdRaw}`);
  }
  await assertZksyncOsIsUp(zksyncOsUrl, BigInt(l2ChainId));

  const s = spinner();
  s.start('Authenticating as admin...');
  const adminPrivateKey = extractConfig(setupEnvPath, 'ADMIN_PRIVATE_KEY') as `0x${string}`;
  const adminAddress = extractConfig(setupEnvPath, 'ADMIN_ADDRESS') as `0x${string}`;
  const { client: adminApiClient, token: adminAuthToken } = await createAdminSession(
    resolvedApiBaseUrl,
    siweDomain,
    adminPrivateKey,
    adminAddress
  );
  s.stop('Authenticated as admin!');

  const executorPrivateKey =
    (extractConfigOptional(setupEnvPath, 'EXECUTOR_PRIVATE_KEY') as `0x${string}` | undefined) ??
    adminPrivateKey;

  console.log('\nDeploying app contracts and configuring permissions...');
  const appContracts = await setupCounterDapp(adminApiClient, {
    rpcUrl: proxyUrl,
    privateKey: executorPrivateKey,
    chainId: l2ChainId,
    authToken: adminAuthToken
  });

  const finalContractsConfig = mergeContractsConfig(existingContractsConfig, {
    app: appContracts
  });
  writeContractsConfig(contractsConfigPath, finalContractsConfig);

  syncEnvFromContractsConfig({
    rootPath,
    setupEnvPath,
    setupPath,
    backendPath,
    webAppPath,
    contractsConfigPath
  });

  outro('App contracts setup complete.');
}

main().catch((e) => {
  console.error('\n❌ App setup failed:');
  console.error(e);
  process.exit(1);
});
