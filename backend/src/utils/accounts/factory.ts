import type { Address } from 'viem';

import { client, executorAccount } from '../client';
import { SSO_CONTRACTS } from '../constants';
import { env } from '../envConfig';
import type { ChainRuntime } from '../prividium/chainRuntime';
import { ensureBeaconDeployed } from './beacon';

const runtimeFactoryAddress = new Map<string, Address>();
const LEGACY_ACCOUNT_ENTRYPOINT_HEX = '4337084d9e255ff0702461cf8895ce9e3b5ff108';
const MODULUS_256 = 1n << 256n;
const HEX_WORD_LENGTH = 64;

function toNegatedWordHex(entryPointHex: string): string {
  const entryPointBigInt = BigInt(`0x${entryPointHex}`);
  const negated = (MODULUS_256 - entryPointBigInt) % MODULUS_256;
  return negated.toString(16).padStart(HEX_WORD_LENGTH, '0');
}

const LEGACY_ACCOUNT_ENTRYPOINT_NEGATED_WORD_HEX = toNegatedWordHex(LEGACY_ACCOUNT_ENTRYPOINT_HEX);

function containsLegacyEntrypointMarkers(bytecode: `0x${string}`): boolean {
  const normalized = bytecode.toLowerCase();
  return (
    normalized.includes(LEGACY_ACCOUNT_ENTRYPOINT_HEX) ||
    normalized.includes(LEGACY_ACCOUNT_ENTRYPOINT_NEGATED_WORD_HEX)
  );
}

const MSA_FACTORY_READ_ABI = [
  {
    type: 'function',
    name: 'BEACON',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view'
  }
] as const;

const BEACON_READ_ABI = [
  {
    type: 'function',
    name: 'implementation',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view'
  }
] as const;

const ACCOUNT_ENTRYPOINT_READ_ABI = [
  {
    type: 'function',
    name: 'entryPoint',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view'
  }
] as const;

function getRuntimeKey(runtime?: ChainRuntime): string {
  return runtime?.chainKey ?? 'default';
}

function getPublicClient(runtime?: ChainRuntime) {
  return runtime?.publicClient ?? client.l2;
}

function getExecutorAddress(runtime?: ChainRuntime): Address {
  return runtime?.executorAccount.address ?? executorAccount.address;
}

function getSsoContracts(runtime?: ChainRuntime) {
  return runtime?.ssoContracts ?? SSO_CONTRACTS;
}

async function hasCode(address: Address, runtime?: ChainRuntime): Promise<boolean> {
  const code = await getPublicClient(runtime).getBytecode({ address });
  return !!code && code !== '0x';
}

async function validateFactoryCompatibility(
  factoryAddress: Address,
  runtime?: ChainRuntime
): Promise<Address> {
  const publicClient = getPublicClient(runtime);
  const executorAddress = getExecutorAddress(runtime);
  const ssoContracts = getSsoContracts(runtime);
  const beaconFromFactory = (await publicClient.readContract({
    account: executorAddress,
    address: factoryAddress,
    abi: MSA_FACTORY_READ_ABI,
    functionName: 'BEACON'
  })) as Address;

  if (!(await hasCode(beaconFromFactory, runtime))) {
    throw new Error(`Factory beacon has no code at ${beaconFromFactory}`);
  }

  const implementationFromBeacon = (await publicClient.readContract({
    account: executorAddress,
    address: beaconFromFactory,
    abi: BEACON_READ_ABI,
    functionName: 'implementation'
  })) as Address;

  if (!(await hasCode(implementationFromBeacon, runtime))) {
    throw new Error(`Beacon implementation has no code at ${implementationFromBeacon}`);
  }

  const implementationEntryPoint = (await publicClient.readContract({
    account: executorAddress,
    address: implementationFromBeacon,
    abi: ACCOUNT_ENTRYPOINT_READ_ABI,
    functionName: 'entryPoint'
  })) as Address;

  if (implementationEntryPoint.toLowerCase() !== ssoContracts.entryPoint?.toLowerCase()) {
    throw new Error(
      `Factory ${factoryAddress} is incompatible: implementation ${implementationFromBeacon} uses EntryPoint ${implementationEntryPoint}, expected ${ssoContracts.entryPoint}. Re-run setup to refresh SSO factory/beacon contracts.`
    );
  }

  const implementationBytecode = await publicClient.getBytecode({
    address: implementationFromBeacon
  });
  if (!implementationBytecode || implementationBytecode === '0x') {
    throw new Error(`Beacon implementation has no runtime bytecode at ${implementationFromBeacon}`);
  }

  const expectedEntryPointHex = ssoContracts.entryPoint.toLowerCase().slice(2);
  const expectsNonLegacyEntrypoint = expectedEntryPointHex !== LEGACY_ACCOUNT_ENTRYPOINT_HEX;
  if (expectsNonLegacyEntrypoint && containsLegacyEntrypointMarkers(implementationBytecode)) {
    throw new Error(
      `Factory ${factoryAddress} is incompatible: implementation ${implementationFromBeacon} still contains legacy EntryPoint guard markers (${LEGACY_ACCOUNT_ENTRYPOINT_HEX}) even though entryPoint() reports ${implementationEntryPoint}. Re-run setup to redeploy account implementation/beacon/factory.`
    );
  }

  return beaconFromFactory;
}

export function getFactoryAddress(runtime?: ChainRuntime): Address {
  return (
    runtimeFactoryAddress.get(getRuntimeKey(runtime)) ??
    (getSsoContracts(runtime).factory as Address)
  );
}

export async function ensureFactoryDeployed(runtime?: ChainRuntime): Promise<Address> {
  const cacheKey = getRuntimeKey(runtime);
  const configured =
    runtime?.ssoContracts.factory ?? (env.SSO_FACTORY_CONTRACT as Address | undefined);
  if (configured) {
    console.log(`Checking configured factory address: ${configured}`);
    const configuredHasCode = await hasCode(configured, runtime);
    if (configuredHasCode) {
      const beaconFromFactory = await validateFactoryCompatibility(configured, runtime);
      console.log(`✅ Factory beacon at ${beaconFromFactory}`);
      console.log(`✅ Using configured factory at ${configured}`);
      runtimeFactoryAddress.set(cacheKey, configured);
      return configured;
    }
    console.warn(`⚠️  No code at configured factory address: ${configured}`);
  }

  const defaultFactory = getSsoContracts(runtime).factory as Address;
  console.log(`Checking default factory address: ${defaultFactory}`);
  const defaultHasCode = await hasCode(defaultFactory, runtime);
  if (defaultHasCode) {
    const beaconFromFactory = await validateFactoryCompatibility(defaultFactory, runtime);
    console.log(`✅ Factory beacon at ${beaconFromFactory}`);
    console.log(`✅ Using default factory at ${defaultFactory}`);
    runtimeFactoryAddress.set(cacheKey, defaultFactory);
    return defaultFactory;
  }

  await ensureBeaconDeployed();
  throw new Error('SSO factory contract not found. Run setup-permissions to deploy SSO contracts.');
}
