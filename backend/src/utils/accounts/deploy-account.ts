import { existsSync, readdirSync } from 'node:fs';
/* eslint-disable @typescript-eslint/no-explicit-any */
// import { zksyncOsTestnet } from "./constants";
import { dirname, join, resolve } from 'node:path';
import { base64UrlToUint8Array, getPublicKeyBytesFromPasskeySignature } from 'sso-legacy/utils';
import { type Hex, hexToBytes, keccak256, toHex } from 'viem';

import { configureSmartAccountPermissions } from '@/utils/prividium/smart-account-permissions';
import { associateWalletWithUser } from '@/utils/prividium/user-wallet-association';
import { client, l2Wallet } from '../client';
import { SSO_CONTRACTS } from '../constants';
import { ensureFactoryDeployed, getFactoryAddress } from './factory';
import { sendFaucetFunds } from './faucet';

export async function deploySmartAccount(
  userId: string,
  originDomain: string,
  credentialId: Hex,
  credentialPublicKey: number[]
  // publicKey: { x: Hex; y: Hex }
) {
  console.log('🚀 Deploying smart account...');
  try {
    // Intentionally stripped legacy code comments for brevity

    // Ensure factory is deployed/available before using it
    await ensureFactoryDeployed();

    const deployedAddress = await deployAccountWithoutSDK(
      originDomain,
      credentialId,
      credentialPublicKey
    );
    console.log('deployed Address:', deployedAddress);

    await sendFaucetFunds(deployedAddress);

    let permissionsConfigured = false;
    let permissionsError: string | undefined;
    try {
      await configureSmartAccountPermissions(deployedAddress);
      permissionsConfigured = true;
      console.log(`✅ Configured contract permissions for smart account ${deployedAddress}`);
    } catch (error) {
      permissionsError = error instanceof Error ? error.message : String(error);
      console.error('Failed to configure smart account permissions:', permissionsError);
    }

    let walletAssociated = false;
    let walletAssociationError: string | undefined;
    let walletAddresses: string[] = [];
    if (permissionsConfigured) {
      try {
        const association = await associateWalletWithUser(userId, deployedAddress);
        walletAssociated = true;
        walletAddresses = association.wallets;
        if (association.alreadyLinked) {
          console.log(`ℹ️ Wallet ${deployedAddress} is already linked to user ${userId}`);
        } else {
          console.log(`✅ Linked wallet ${deployedAddress} to user ${userId}`);
        }
      } catch (error) {
        walletAssociationError = error instanceof Error ? error.message : String(error);
        console.error('Failed to associate wallet after deploy:', walletAssociationError);
      }
    }

    return {
      accountAddress: deployedAddress,
      webauthnValidator: SSO_CONTRACTS.webauthnValidator,
      permissionsConfigured,
      permissionsError,
      walletAssociated,
      walletAssociationError,
      walletAddresses
    };
  } catch (error) {
    console.error('Error deploying smart account:', error);
    throw error; // Rethrow so the router knows it failed
  }
}

async function deployAccountWithoutSDK(
  originDomain: string,
  credentialId: string,
  credentialPublicKey: number[]
) {
  const currentDir = __dirname;

  const findSdkPackageDir = () => {
    const tryDirs: string[] = [];
    let cursor = currentDir;
    for (let i = 0; i < 6; i += 1) {
      tryDirs.push(cursor);
      const parent = resolve(cursor, '..');
      if (parent === cursor) break;
      cursor = parent;
    }

    for (const base of tryDirs) {
      const directPkg = join(base, 'node_modules', 'zksync-sso-web-sdk', 'package.json');
      if (existsSync(directPkg)) return dirname(directPkg);

      const pnpmDir = join(base, 'node_modules', '.pnpm');
      if (existsSync(pnpmDir)) {
        const matches = readdirSync(pnpmDir).filter((name) =>
          name.startsWith('zksync-sso-web-sdk@')
        );
        if (matches.length > 0) {
          const pkgJson = join(
            pnpmDir,
            matches[0],
            'node_modules',
            'zksync-sso-web-sdk',
            'package.json'
          );
          if (existsSync(pkgJson)) return dirname(pkgJson);
        }
      }
    }

    return null;
  };

  const ssoPkgDir = findSdkPackageDir();
  if (!ssoPkgDir) {
    throw new Error(
      'zksync-sso-web-sdk package not found. Ensure workspace dependencies are installed.'
    );
  }

  const ssoWasmPath = join(ssoPkgDir, 'pkg-node', 'zksync_sso_erc4337_web_ffi.js');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const ssoWasm = require(ssoWasmPath) as {
    PasskeyPayload: new (
      credentialId: Uint8Array,
      passkeyX: Uint8Array,
      passkeyY: Uint8Array,
      originDomain: string
    ) => unknown;
    encode_deploy_account_call_data: (
      accountId: string,
      eoaSigners?: string[] | null,
      eoaValidatorAddress?: string | null,
      passkeyPayload?: unknown | null,
      webauthnValidatorAddress?: string | null,
      sessionValidatorAddress?: string | null,
      executorModules?: string[] | null
    ) => string;
  };

  const webauthnValidator = SSO_CONTRACTS.webauthnValidator as Hex;
  const validatorCode = await client.l2.getBytecode({ address: webauthnValidator });
  if (!validatorCode || validatorCode === '0x') {
    throw new Error(
      `WebAuthn validator not deployed at ${webauthnValidator}. Run setup-permissions to deploy SSO contracts or set SSO_WEBAUTHN_VALIDATOR_CONTRACT.`
    );
  }

  // If credentialId is already hex (0x...), use it directly. Otherwise parse as base64url.
  const credentialIdHex = credentialId.startsWith('0x')
    ? (credentialId as Hex)
    : toHex(base64UrlToUint8Array(credentialId));

  const accountId = keccak256(credentialIdHex);

  // Extract public key coordinates from credentialPublicKey using SDK's COSE parser
  const [xBytes, yBytes] = getPublicKeyBytesFromPasskeySignature(
    new Uint8Array(credentialPublicKey)
  );
  const buildDeployData = (id: string, origin: string) => {
    const passkeyPayload = new ssoWasm.PasskeyPayload(
      hexToBytes(credentialIdHex),
      xBytes,
      yBytes,
      origin
    );
    return ssoWasm.encode_deploy_account_call_data(
      id,
      null,
      null,
      passkeyPayload,
      webauthnValidator,
      null,
      null
    );
  };

  const sendDeploy = async (id: string, origin: string) => {
    const data = buildDeployData(id, origin);
    console.log(
      `Calling factory.deployAccount (with WASM-encoded data). accountId=${id} originDomain=${origin}`
    );
    return l2Wallet.sendTransaction({
      to: getFactoryAddress(),
      data: data as Hex
    });
  };

  const hash = await sendDeploy(accountId, originDomain);

  console.log(`Transaction hash: ${hash}`);
  console.log('Waiting for confirmation...');

  const receipt = await client.l2.waitForTransactionReceipt({ hash });

  if (receipt.status !== 'success') {
    throw new Error('Account deployment transaction reverted');
  }

  // Parse logs to find AccountCreated event
  const accountCreatedTopic = keccak256(toHex('AccountCreated(address,address)'));
  const log = receipt.logs.find((entry) => entry.topics[0] === accountCreatedTopic);

  if (!log || !log.topics[1]) {
    throw new Error('AccountCreated event not found in transaction logs');
  }

  return `0x${log.topics[1].slice(-40)}` as Hex;
}
