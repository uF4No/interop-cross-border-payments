import { startAuthentication } from '@simplewebauthn/browser';
import {
  type Address,
  type Hex,
  type PublicClient,
  encodeAbiParameters,
  hexToBytes,
  pad,
  toHex
} from 'viem';

import { credentialIdToHex } from './passkeys';

const SECP256R1_N = BigInt('0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551');
const SECP256R1_HALF_N = SECP256R1_N / 2n;
const ERC1271_MAGIC_VALUE = '0x1626ba7e';
const WEBAUTHN_VALIDATOR_ABI = [
  {
    type: 'function',
    name: 'isValidSignatureWithSender',
    inputs: [
      { name: 'sender', type: 'address' },
      { name: 'signedHash', type: 'bytes32' },
      { name: 'signature', type: 'bytes' }
    ],
    outputs: [{ name: '', type: 'bytes4' }],
    stateMutability: 'view'
  }
] as const;

function uint8ArrayToBase64url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64urlToUint8Array(base64url: string): Uint8Array {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function readDerLength(input: Uint8Array, offset: number): { length: number; bytesRead: number } {
  const first = input[offset];
  if ((first & 0x80) === 0) {
    return { length: first, bytesRead: 1 };
  }

  const bytesLength = first & 0x7f;
  if (bytesLength === 0 || bytesLength > 4) {
    throw new Error('Invalid DER length encoding');
  }

  let length = 0;
  for (let i = 0; i < bytesLength; i += 1) {
    length = (length << 8) | input[offset + 1 + i];
  }

  return { length, bytesRead: 1 + bytesLength };
}

function normalizeLowS(input: Uint8Array): Uint8Array {
  let value = 0n;
  for (let i = 0; i < input.length; i += 1) {
    value = (value << 8n) | BigInt(input[i]);
  }

  if (value <= SECP256R1_HALF_N) {
    return input;
  }

  let normalized = SECP256R1_N - value;
  const bytes: number[] = [];
  while (normalized > 0n) {
    bytes.unshift(Number(normalized & 0xffn));
    normalized >>= 8n;
  }

  return new Uint8Array(bytes.length ? bytes : [0]);
}

function parseDerSignature(signatureBytes: Uint8Array): { r: Uint8Array; s: Uint8Array } {
  let offset = 0;
  if (signatureBytes[offset++] !== 0x30) {
    throw new Error('Invalid DER signature sequence header');
  }

  const sequenceLength = readDerLength(signatureBytes, offset);
  offset += sequenceLength.bytesRead;

  if (signatureBytes[offset++] !== 0x02) {
    throw new Error('Invalid DER signature: missing r marker');
  }
  const rLength = readDerLength(signatureBytes, offset);
  offset += rLength.bytesRead;
  let r = signatureBytes.slice(offset, offset + rLength.length);
  offset += rLength.length;

  if (signatureBytes[offset++] !== 0x02) {
    throw new Error('Invalid DER signature: missing s marker');
  }
  const sLength = readDerLength(signatureBytes, offset);
  offset += sLength.bytesRead;
  let s = signatureBytes.slice(offset, offset + sLength.length);

  while (r.length > 32 && r[0] === 0x00) {
    r = r.slice(1);
  }
  while (s.length > 32 && s[0] === 0x00) {
    s = s.slice(1);
  }

  if (r.length > 32 || s.length > 32) {
    throw new Error(`Invalid passkey signature component length: r=${r.length}, s=${s.length}`);
  }

  return {
    r,
    s: normalizeLowS(s)
  };
}

export async function signUserOpWithPasskey(params: {
  hash: Hex;
  credentialId: string;
  validatorAddress: Hex;
  rpId: string;
  origin: string;
}): Promise<{ signature: Hex; credentialId: Hex; expectedCredentialId: Hex }> {
  const expectedCredentialId = credentialIdToHex(params.credentialId);
  const challengeBase64url = uint8ArrayToBase64url(hexToBytes(params.hash));
  const allowCredentialId = uint8ArrayToBase64url(hexToBytes(expectedCredentialId));

  const authResponse = await startAuthentication({
    optionsJSON: {
      challenge: challengeBase64url,
      rpId: params.rpId,
      userVerification: 'required',
      allowCredentials: [
        {
          id: allowCredentialId,
          type: 'public-key'
        }
      ]
    }
  });

  const usedCredentialId = toHex(base64urlToUint8Array(authResponse.id));
  const authenticatorData = base64urlToUint8Array(authResponse.response.authenticatorData);
  const clientDataJSONBytes = base64urlToUint8Array(authResponse.response.clientDataJSON);
  const clientDataJSON = new TextDecoder().decode(clientDataJSONBytes);
  const signatureBytes = base64urlToUint8Array(authResponse.response.signature);
  const { r, s } = parseDerSignature(signatureBytes);

  try {
    const parsedClientData = JSON.parse(clientDataJSON) as { challenge?: string; origin?: string };
    if (parsedClientData.challenge !== challengeBase64url) {
      throw new Error('WebAuthn challenge mismatch');
    }
    if (parsedClientData.origin && parsedClientData.origin !== params.origin) {
      throw new Error(
        `WebAuthn origin mismatch: expected ${params.origin}, got ${parsedClientData.origin}`
      );
    }
  } catch (error) {
    if (error instanceof Error) throw error;
    throw new Error('Invalid WebAuthn clientDataJSON payload');
  }

  const passkeySignature = encodeAbiParameters(
    [{ type: 'bytes' }, { type: 'string' }, { type: 'bytes32[2]' }, { type: 'bytes' }],
    [
      toHex(authenticatorData),
      clientDataJSON,
      [pad(toHex(r), { size: 32 }), pad(toHex(s), { size: 32 })],
      usedCredentialId
    ]
  );

  return {
    signature: `${params.validatorAddress}${passkeySignature.slice(2)}` as Hex,
    credentialId: usedCredentialId,
    expectedCredentialId
  };
}

export async function assertPasskeyUserOpSignatureValid(params: {
  client: PublicClient;
  validatorAddress: Address;
  accountAddress: Address;
  entryPointAddress?: Address;
  userOpHash: Hex;
  signature: Hex;
}) {
  if (params.signature.length <= 42) {
    throw new Error('Invalid passkey signature format');
  }

  const signatureBody = `0x${params.signature.slice(42)}` as Hex;

  const checkFromContext = async (fromAddress: Address): Promise<Hex | null> => {
    try {
      const result = (await params.client.readContract({
        address: params.validatorAddress,
        abi: WEBAUTHN_VALIDATOR_ABI,
        functionName: 'isValidSignatureWithSender',
        args: [params.accountAddress, params.userOpHash, signatureBody],
        account: fromAddress
      })) as Hex;
      return result;
    } catch {
      return null;
    }
  };

  const accountContextResult = await checkFromContext(params.accountAddress);
  const accountContextValid =
    accountContextResult?.toLowerCase() === ERC1271_MAGIC_VALUE.toLowerCase();

  if (!params.entryPointAddress) {
    if (!accountContextValid) {
      throw new Error(
        'Passkey signature did not validate on-chain for this account. Re-select or re-create a passkey linked to this wallet.'
      );
    }
    return;
  }

  const entryPointContextResult = await checkFromContext(params.entryPointAddress);
  if (entryPointContextResult === null) {
    if (!accountContextValid) {
      throw new Error(
        'Passkey signature did not validate on-chain for this account. Re-select or re-create a passkey linked to this wallet.'
      );
    }
    return;
  }

  const entryPointContextValid =
    entryPointContextResult.toLowerCase() === ERC1271_MAGIC_VALUE.toLowerCase();

  if (!entryPointContextValid) {
    throw new Error(
      `Passkey signature failed EntryPoint-context validation (account ctx: ${accountContextResult ?? 'error'}, entrypoint ctx: ${entryPointContextResult ?? 'error'}). Re-select the existing passkey for this account and retry.`
    );
  }
}
