import { startAuthentication } from '@simplewebauthn/browser';
import { type Address, type Hex, type PublicClient, hexToBytes, pad, toHex } from 'viem';
import { generatePasskeyAuthenticationOptions } from 'zksync-sso-stable/client/passkey';
import { registerNewPasskey } from 'zksync-sso-stable/client/passkey';
import {
  base64UrlToUint8Array,
  getPasskeySignatureFromPublicKeyBytes,
  getPublicKeyBytesFromPasskeySignature
} from 'zksync-sso-stable/utils';

import {
  getSsoContracts,
  RP_ID,
  STORAGE_KEY_ACCOUNT,
  STORAGE_KEY_PASSKEY,
  type SsoChainKey,
  type SsoContractsConfig
} from './constants';
import type { PasskeyCredential } from './types';

const ACCOUNT_STORAGE_EVENT = 'sso-account-storage-updated';
const WORD32_ZERO = pad('0x0', { size: 32 }).toLowerCase();
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
const ACCOUNT_ENTRYPOINT_ABI = [
  {
    type: 'function',
    name: 'entryPoint',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view'
  }
] as const;

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

  return passkeyCredentials;
}

function isHexCredentialId(value: string): value is Hex {
  return /^0x[0-9a-fA-F]+$/.test(value) && value.length % 2 === 0;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function normalizeWord32(value: Hex): string {
  return pad(value, { size: 32 }).toLowerCase();
}

export function credentialIdToHex(credentialId: string): Hex {
  if (isHexCredentialId(credentialId)) {
    return credentialId.toLowerCase() as Hex;
  }
  return toHex(base64UrlToUint8Array(credentialId));
}

export function credentialIdToBase64Url(credentialId: string): string {
  if (isHexCredentialId(credentialId)) {
    return bytesToBase64Url(hexToBytes(credentialId));
  }
  return credentialId;
}

export async function assertPasskeyMatchesAccount(params: {
  client: PublicClient;
  webauthnValidator: Address;
  accountAddress: Address;
  passkeyCredentials: PasskeyCredential;
  domain?: string;
  fromAddress?: Address;
}) {
  const domain = params.domain ?? window.location.origin;
  const credentialIdHex = credentialIdToHex(params.passkeyCredentials.credentialId);
  const from = params.fromAddress ?? params.accountAddress;

  const rawKey = (await params.client.readContract({
    address: params.webauthnValidator,
    abi: WEBAUTHN_VALIDATOR_ABI,
    functionName: 'getAccountKey',
    args: [domain, credentialIdHex, params.accountAddress],
    account: from
  })) as [Hex, Hex];

  const onchainX = normalizeWord32(rawKey[0]);
  const onchainY = normalizeWord32(rawKey[1]);
  if (onchainX === WORD32_ZERO && onchainY === WORD32_ZERO) {
    throw new Error(
      `Passkey credential is not linked to account ${params.accountAddress} for origin ${domain}. Re-select your passkey for this account.`
    );
  }

  const [localXBytes, localYBytes] = getPublicKeyBytesFromPasskeySignature(
    new Uint8Array(params.passkeyCredentials.credentialPublicKey)
  );
  const localX = normalizeWord32(toHex(new Uint8Array(localXBytes)));
  const localY = normalizeWord32(toHex(new Uint8Array(localYBytes)));

  if (localX !== onchainX || localY !== onchainY) {
    throw new Error(
      `Saved passkey does not match on-chain key for account ${params.accountAddress}. Re-select the existing passkey before sending transactions.`
    );
  }
}

export async function selectExistingPasskey(
  userName: string,
  client?: PublicClient,
  fromAddress?: Address,
  config?: {
    chainKey?: SsoChainKey;
    ssoContracts?: SsoContractsConfig;
  }
) {
  if (!client) {
    throw new Error('Authenticated RPC client required to load existing passkeys.');
  }
  const resolvedSsoContracts = config?.ssoContracts ?? getSsoContracts(config?.chainKey);
  const authenticationOptions = await generatePasskeyAuthenticationOptions({});
  const authenticationResponse = await startAuthentication({ optionsJSON: authenticationOptions });
  const credentialIdHex = toHex(base64UrlToBytes(authenticationResponse.id));
  const domain = window.location.origin;
  const { savedAccount } = loadExistingPasskey();
  const from =
    fromAddress ?? savedAccount ?? ('0x0000000000000000000000000000000000000001' as Address);
  const authClient = client;

  console.debug('[passkeys] getAccountList', {
    chainKey: config?.chainKey,
    contract: resolvedSsoContracts.webauthnValidator,
    entryPoint: resolvedSsoContracts.entryPoint,
    domain,
    credentialId: credentialIdHex,
    from
  });

  const accounts = (await authClient.readContract({
    address: resolvedSsoContracts.webauthnValidator,
    abi: WEBAUTHN_VALIDATOR_ABI,
    functionName: 'getAccountList',
    args: [domain, credentialIdHex],
    account: from
  })) as Address[];

  if (!accounts.length) {
    throw new Error('No account found for selected passkey');
  }

  const expectedEntryPoint = resolvedSsoContracts.entryPoint.toLowerCase();
  let accountAddress: Address | null = null;

  for (const candidate of accounts) {
    const candidateEntryPoint = await readAccountEntryPoint(authClient, candidate);
    if (candidateEntryPoint?.toLowerCase() === expectedEntryPoint) {
      accountAddress = candidate;
      break;
    }
  }

  if (!accountAddress) {
    throw new Error(
      `No account found for this passkey on the configured EntryPoint (${resolvedSsoContracts.entryPoint}). Create a new passkey account.`
    );
  }

  const rawKey = (await authClient.readContract({
    address: resolvedSsoContracts.webauthnValidator,
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
  window.dispatchEvent(new Event(ACCOUNT_STORAGE_EVENT));
}

// Save wallet address to localStorage
export function saveAccountAddress(accountAddress: Address) {
  localStorage.setItem(STORAGE_KEY_ACCOUNT, accountAddress);
  window.dispatchEvent(new Event(ACCOUNT_STORAGE_EVENT));
}

export function clearSavedAccountAddress() {
  localStorage.removeItem(STORAGE_KEY_ACCOUNT);
  window.dispatchEvent(new Event(ACCOUNT_STORAGE_EVENT));
}

export async function readAccountEntryPoint(
  client: PublicClient,
  accountAddress: Address,
  fromAddress?: Address
): Promise<Address | null> {
  try {
    const entryPoint = (await client.readContract({
      address: accountAddress,
      abi: ACCOUNT_ENTRYPOINT_ABI,
      functionName: 'entryPoint',
      account: fromAddress ?? accountAddress
    })) as Address;
    return entryPoint;
  } catch (_error) {
    return null;
  }
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
    window.dispatchEvent(new Event(ACCOUNT_STORAGE_EVENT));
    location.reload();
  }
}
