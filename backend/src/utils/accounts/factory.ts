import type { Address } from 'viem';

import { client, executorAccount } from '../client';
import { SSO_CONTRACTS } from '../constants';
import { env } from '../envConfig';
import { ensureBeaconDeployed } from './beacon';

let runtimeFactoryAddress: Address | null = null;

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

async function hasCode(address: Address): Promise<boolean> {
  const code = await client.l2.getBytecode({ address });
  return !!code && code !== '0x';
}

async function validateFactoryCompatibility(factoryAddress: Address): Promise<Address> {
  const beaconFromFactory = (await client.l2.readContract({
    account: executorAccount.address,
    address: factoryAddress,
    abi: MSA_FACTORY_READ_ABI,
    functionName: 'BEACON'
  })) as Address;

  if (!(await hasCode(beaconFromFactory))) {
    throw new Error(`Factory beacon has no code at ${beaconFromFactory}`);
  }

  const implementationFromBeacon = (await client.l2.readContract({
    account: executorAccount.address,
    address: beaconFromFactory,
    abi: BEACON_READ_ABI,
    functionName: 'implementation'
  })) as Address;

  if (!(await hasCode(implementationFromBeacon))) {
    throw new Error(`Beacon implementation has no code at ${implementationFromBeacon}`);
  }

  const implementationEntryPoint = (await client.l2.readContract({
    account: executorAccount.address,
    address: implementationFromBeacon,
    abi: ACCOUNT_ENTRYPOINT_READ_ABI,
    functionName: 'entryPoint'
  })) as Address;

  if (implementationEntryPoint.toLowerCase() !== SSO_CONTRACTS.entryPoint.toLowerCase()) {
    throw new Error(
      `Factory ${factoryAddress} is incompatible: implementation ${implementationFromBeacon} uses EntryPoint ${implementationEntryPoint}, expected ${SSO_CONTRACTS.entryPoint}. Re-run setup to refresh SSO factory/beacon contracts.`
    );
  }

  return beaconFromFactory;
}

export function getFactoryAddress(): Address {
  return runtimeFactoryAddress ?? (SSO_CONTRACTS.factory as Address);
}

export async function ensureFactoryDeployed(): Promise<Address> {
  const configured = env.SSO_FACTORY_CONTRACT as Address | undefined;
  if (configured) {
    console.log(`Checking configured factory address: ${configured}`);
    const configuredHasCode = await hasCode(configured);
    if (configuredHasCode) {
      const beaconFromFactory = await validateFactoryCompatibility(configured);
      console.log(`✅ Factory beacon at ${beaconFromFactory}`);
      console.log(`✅ Using configured factory at ${configured}`);
      runtimeFactoryAddress = configured;
      return configured;
    }
    console.warn(`⚠️  No code at configured factory address: ${configured}`);
  }

  const defaultFactory = SSO_CONTRACTS.factory as Address;
  console.log(`Checking default factory address: ${defaultFactory}`);
  const defaultHasCode = await hasCode(defaultFactory);
  if (defaultHasCode) {
    const beaconFromFactory = await validateFactoryCompatibility(defaultFactory);
    console.log(`✅ Factory beacon at ${beaconFromFactory}`);
    console.log(`✅ Using default factory at ${defaultFactory}`);
    runtimeFactoryAddress = defaultFactory;
    return defaultFactory;
  }

  await ensureBeaconDeployed();
  throw new Error('SSO factory contract not found. Run setup-permissions to deploy SSO contracts.');
}
