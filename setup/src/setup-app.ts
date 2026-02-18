import path from 'node:path';
import { intro, outro, spinner } from '@clack/prompts';
import { extractRes, postApplications } from './tools/api-client';
import { assertDotEnv, extractConfig } from './tools/config-tools';
import { createAdminSession } from './tools/create-admin-client';
import { assertPrividiumApiUp } from './tools/service-assert';

function parseRedirectUris(value: string): string[] {
  return value
    .split(',')
    .map((uri) => uri.trim())
    .filter(Boolean);
}

async function main() {
  intro('Creating Prividium application...');

  const rootPath = path.join(import.meta.dirname, '..', '..');
  const setupPermissionsPath = path.join(rootPath, 'setup');

  assertDotEnv(setupPermissionsPath);

  const permissionsApiUrl = extractConfig(
    path.join(setupPermissionsPath, '.env'),
    'PRIVIDIUM_API_URL'
  );
  const authBaseUrl = extractConfig(
    path.join(setupPermissionsPath, '.env'),
    'PRIVIDIUM_AUTH_BASE_URL'
  );
  const adminPrivateKey = extractConfig(
    path.join(setupPermissionsPath, '.env'),
    'ADMIN_PRIVATE_KEY'
  );
  const adminAddress = extractConfig(path.join(setupPermissionsPath, '.env'), 'ADMIN_ADDRESS');
  const appName = extractConfig(path.join(setupPermissionsPath, '.env'), 'PRIVIDIUM_APP_NAME');
  const appOrigin = extractConfig(path.join(setupPermissionsPath, '.env'), 'PRIVIDIUM_APP_ORIGIN');
  const appRedirectUrisRaw = extractConfig(
    path.join(setupPermissionsPath, '.env'),
    'PRIVIDIUM_APP_REDIRECT_URIS'
  );
  const appRedirectUris = parseRedirectUris(appRedirectUrisRaw);

  const siweDomain = new URL(authBaseUrl).host;

  console.log('\nConfiguration:');
  console.log(`  Permissions API: ${permissionsApiUrl}`);
  console.log(`  Auth Base URL: ${authBaseUrl}`);
  console.log(`  SIWE Domain: ${siweDomain}\n`);

  const resolvedApiBaseUrl = await assertPrividiumApiUp(permissionsApiUrl);

  const s = spinner();
  s.start('Authenticating as admin...');
  const { client: adminApiClient } = await createAdminSession(
    resolvedApiBaseUrl,
    siweDomain,
    adminPrivateKey as `0x${string}`,
    adminAddress as `0x${string}`
  );
  s.stop('Authenticated as admin!');

  const app = extractRes(
    await postApplications(adminApiClient, {
      name: appName,
      origin: appOrigin,
      oauthRedirectUris: appRedirectUris
    })
  );

  console.log('\nCreated application:');
  console.log(`  id: ${app.id}`);
  console.log(`  name: ${app.name}`);
  console.log(`  origin: ${app.origin ?? ''}`);
  console.log(`  oauthClientId: ${app.oauthClientId}`);
  console.log(`  oauthRedirectUris: ${app.oauthRedirectUris.join(', ')}`);

  outro('Application created successfully.');
}

main().catch((e) => {
  console.error('\n❌ App setup failed:');
  console.error(e);
  process.exit(1);
});
