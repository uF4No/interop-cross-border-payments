import path from 'node:path';
import { intro, outro } from '@clack/prompts';

import { assertDotEnv, extractConfigOptional } from './tools/config-tools';
import { readContractsConfig, resolveContractsConfigPath } from './tools/contracts-config';
import { updatePermissionApisCompose } from './tools/permissions-api-compose';
import { initRuntimeLogging } from './tools/runtime-logging';

function requiredValue(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing required value in contracts config: ${name}`);
  }
  return value;
}

initRuntimeLogging('setup-update-permissions-compose');

async function main() {
  intro('Updating permissions-api compose config (bundler + dispatcher)...');

  const rootPath = path.join(import.meta.dirname, '..', '..');
  const setupPath = path.join(rootPath, 'setup');
  const setupEnvPath = path.join(setupPath, '.env');
  const composePath = path.join(rootPath, 'prividium-3chain-local', 'docker-compose.yml');
  const bundlerComposePath = path.join(
    rootPath,
    'prividium-3chain-local',
    'docker-compose-deps.yml'
  );

  assertDotEnv(setupPath);

  const contractsConfigPath = resolveContractsConfigPath(
    rootPath,
    extractConfigOptional(setupEnvPath, 'CONTRACTS_CONFIG_PATH'),
    setupPath
  );
  const contractsConfig = readContractsConfig(contractsConfigPath);
  if (!contractsConfig) {
    throw new Error(`Missing contracts config at ${contractsConfigPath}`);
  }

  const chainASso = contractsConfig.chains?.a?.sso;
  const chainBSso = contractsConfig.chains?.b?.sso;

  const result = updatePermissionApisCompose({
    composePath,
    bundlerComposePath,
    services: [
      {
        serviceName: 'permissions-api-l2a',
        ssoImplementation: requiredValue(
          'chains.a.sso.accountImplementation',
          chainASso?.accountImplementation
        ) as `0x${string}`,
        ssoBytecodeHash: requiredValue(
          'chains.a.sso.ssoBytecodeHash',
          chainASso?.ssoBytecodeHash
        ) as `0x${string}`
      },
      {
        serviceName: 'permissions-api-l2b',
        ssoImplementation: requiredValue(
          'chains.b.sso.accountImplementation',
          chainBSso?.accountImplementation
        ) as `0x${string}`,
        ssoBytecodeHash: requiredValue(
          'chains.b.sso.ssoBytecodeHash',
          chainBSso?.ssoBytecodeHash
        ) as `0x${string}`
      }
    ],
    bundlers: [
      {
        serviceName: 'bundler-l2a',
        entryPoint: requiredValue('chains.a.sso.entryPoint', chainASso?.entryPoint) as `0x${string}`
      },
      {
        serviceName: 'bundler-l2b',
        entryPoint: requiredValue('chains.b.sso.entryPoint', chainBSso?.entryPoint) as `0x${string}`
      }
    ]
  });

  console.log(`\nUpdated compose file: ${result.composePath}`);
  if (result.bundlerComposePath) {
    console.log(`Updated bundler compose file: ${result.bundlerComposePath}`);
  }
  for (const service of result.services) {
    console.log(`  ${service.serviceName} bundler RPC: ${service.bundlerRpcUrl}`);
  }
  console.log('\nRestart command for permission APIs (A/B):');
  console.log(`  ${result.restartCommand}`);

  outro('permissions-api compose update completed.');
}

main().catch((error) => {
  console.error('\n❌ permissions-api compose update failed:');
  console.error(error);
  process.exit(1);
});
