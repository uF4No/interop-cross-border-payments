import { startAuthentication } from '@simplewebauthn/browser';
import { type Address, type Hex, type PublicClient, hexToBytes, toHex } from 'viem';
import { generatePasskeyAuthenticationOptions } from 'zksync-sso-stable/client/passkey';
import { registerNewPasskey } from 'zksync-sso-stable/client/passkey';
import { getPasskeySignatureFromPublicKeyBytes } from 'zksync-sso-stable/utils';

import { RP_ID, STORAGE_KEY_ACCOUNT, STORAGE_KEY_PASSKEY, ssoContracts } from './constants';
import type { PasskeyCredential } from './types';

const base64UrlToBytes = (input: string): Uint8Array => {
  const base64 = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

export function loadExistingPasskey() {
  const savedPasskey = localStorage.getItem(STORAGE_KEY_PASSKEY);
  const savedAccount = localStorage.getItem(STORAGE_KEY_ACCOUNT);

  return {
    savedPasskey: savedPasskey ? (JSON.parse(savedPasskey) as PasskeyCredential) : undefined,
    savedAccount: savedAccount ? (savedAccount as Address) : undefined
  };
}

export async function createNewPasskey(userName: string) {
  console.log('🔐 Creating passkey...');

  const passkeyName = userName.toLowerCase().replace(/\s+/g, '');

  const result = await registerNewPasskey({
    rpID: RP_ID,
    rpName: 'SSO Interop Portal',
    userName: passkeyName,
    userDisplayName: userName
  });

  // Store credentials
  const passkeyCredentials = {
    // Keep base64url id; backend supports non-hex credential IDs.
    credentialId: result.credentialId,
    credentialPublicKey: Array.from(result.credentialPublicKey) as number[],
    userName: passkeyName,
    userDisplayName: userName
  };

  console.log('✅ Passkey created successfully!');

  // Store credentials
  savePasskeyCredentials(passkeyCredentials);
  return passkeyCredentials;
}

export async function selectExistingPasskey(
  userName: string,
  client?: PublicClient,
  fromAddress?: Address
) {
  if (!client) {
    throw new Error('Authenticated RPC client required to load existing passkeys.');
  }
  const options = await generatePasskeyAuthenticationOptions({});
  const authenticationResponse = await startAuthentication({ optionsJSON: options });
  const credentialIdHex = toHex(base64UrlToBytes(authenticationResponse.id));
  const domain = window.location.origin;
  const { savedAccount } = loadExistingPasskey();
  const from =
    fromAddress ?? savedAccount ?? ('0x0000000000000000000000000000000000000001' as Address);
  const authClient = client;

  console.debug('[passkeys] getAccountList', {
    contract: ssoContracts.webauthnValidator,
    domain,
    credentialId: credentialIdHex,
    from
  });

  const WEBAUTHN_VALIDATOR_ABI = [
    {
      type: 'function',
      name: 'getAccountList',
      inputs: [
        { name: 'domain', type: 'string' },
        { name: 'credentialId', type: 'bytes' }
      ],
      outputs: [{ name: '', type: 'address[]' }],
      stateMutability: 'view'
    },
    {
      type: 'function',
      name: 'getAccountKey',
      inputs: [
        { name: 'domain', type: 'string' },
        { name: 'credentialId', type: 'bytes' },
        { name: 'account', type: 'address' }
      ],
      outputs: [{ name: '', type: 'bytes32[2]' }],
      stateMutability: 'view'
    }
  ] as const;

  const accounts = (await authClient.readContract({
    address: ssoContracts.webauthnValidator,
    abi: WEBAUTHN_VALIDATOR_ABI,
    functionName: 'getAccountList',
    args: [domain, credentialIdHex],
    account: from
  })) as Address[];

  if (!accounts.length) {
    throw new Error('No account found for selected passkey');
  }

  const accountAddress = accounts[0];
  const rawKey = (await authClient.readContract({
    address: ssoContracts.webauthnValidator,
    abi: WEBAUTHN_VALIDATOR_ABI,
    functionName: 'getAccountKey',
    args: [domain, credentialIdHex, accountAddress],
    account: from
  })) as [`0x${string}`, `0x${string}`];

  console.debug('[passkeys] getAccountKey result', {
    rawKey,
    xType: typeof rawKey?.[0],
    yType: typeof rawKey?.[1]
  });

  const normalizeHex = (value: Hex | Uint8Array | number[]) => {
    if (typeof value === 'string') return value;
    if (value instanceof Uint8Array) return toHex(value);
    return toHex(new Uint8Array(value));
  };

  const xHex = normalizeHex(rawKey[0] as Hex | Uint8Array | number[]);
  const yHex = normalizeHex(rawKey[1] as Hex | Uint8Array | number[]);
  const coseKey = getPasskeySignatureFromPublicKeyBytes([xHex, yHex]);

  const passkeyCredentials: PasskeyCredential = {
    credentialId: credentialIdHex as Hex,
    credentialPublicKey: Array.from(coseKey) as number[],
    userName: userName.toLowerCase().replace(/\s+/g, ''),
    userDisplayName: userName
  };

  savePasskeyCredentials(passkeyCredentials);
  saveAccountAddress(accountAddress);

  return { passkeyCredentials, accountAddress };
}

// Save passkey to localStorage
export function savePasskeyCredentials(passkeyCredentials: PasskeyCredential) {
  localStorage.setItem(STORAGE_KEY_PASSKEY, JSON.stringify(passkeyCredentials));
}

// Save wallet address to localStorage
export function saveAccountAddress(accountAddress: Address) {
  localStorage.setItem(STORAGE_KEY_ACCOUNT, accountAddress);
}

// Reset passkey
export function handleResetPasskey() {
  if (
    confirm(
      'Are you sure you want to reset your passkey? You will need to create a new one and deploy a new account.'
    )
  ) {
    localStorage.removeItem(STORAGE_KEY_PASSKEY);
    localStorage.removeItem(STORAGE_KEY_ACCOUNT);
    location.reload();
  }
}
