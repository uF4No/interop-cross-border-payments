import { randomBytes } from 'node:crypto';
import type { Abi, Address, Hex, Transport } from 'viem';
import { createPublicClient, createWalletClient, defineChain, http, keccak256 } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import EOAKeyValidatorArtifact from '../system/contracts/EOAKeyValidator.json';
import GuardianExecutorArtifact from '../system/contracts/GuardianExecutor.json';
import MSAFactoryArtifact from '../system/contracts/MSAFactory.json';
import ModularSmartAccountArtifact from '../system/contracts/ModularSmartAccount.json';
import SessionKeyValidatorArtifact from '../system/contracts/SessionKeyValidator.json';
import UpgradeableBeaconArtifact from '../system/contracts/UpgradeableBeacon.json';
import WebAuthnValidatorArtifact from '../system/contracts/WebAuthnValidator.json';

const UPGRADEABLE_BEACON_ABI = UpgradeableBeaconArtifact.abi as Abi;
const UPGRADEABLE_BEACON_BYTECODE = UpgradeableBeaconArtifact.bytecode?.object as Hex;

const ACCOUNT_IMPL_ABI = ModularSmartAccountArtifact.abi as Abi;
const ACCOUNT_IMPL_BYTECODE = ModularSmartAccountArtifact.bytecode?.object as Hex;

const MSA_FACTORY_ABI = MSAFactoryArtifact.abi as Abi;
const MSA_FACTORY_BYTECODE = MSAFactoryArtifact.bytecode?.object as Hex;

const EOA_VALIDATOR_ABI = EOAKeyValidatorArtifact.abi as Abi;
const EOA_VALIDATOR_BYTECODE = EOAKeyValidatorArtifact.bytecode?.object as Hex;

const SESSION_VALIDATOR_ABI = SessionKeyValidatorArtifact.abi as Abi;
const SESSION_VALIDATOR_BYTECODE = SessionKeyValidatorArtifact.bytecode?.object as Hex;

const WEBAUTHN_VALIDATOR_ABI = WebAuthnValidatorArtifact.abi as Abi;
const WEBAUTHN_VALIDATOR_BYTECODE = WebAuthnValidatorArtifact.bytecode?.object as Hex;

const GUARDIAN_EXECUTOR_ABI = GuardianExecutorArtifact.abi as Abi;
const GUARDIAN_EXECUTOR_BYTECODE = GuardianExecutorArtifact.bytecode?.object as Hex;

const BEACON_READ_ABI = [
  {
    type: 'function',
    name: 'implementation',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view'
  }
] as const;

const MSA_FACTORY_READ_ABI = [
  {
    type: 'function',
    name: 'BEACON',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view'
  }
] as const;

export type SsoDeployConfig = {
  rpcUrl: string;
  chainId: number;
  executorPrivateKey: `0x${string}`;
  authToken?: string;
  configured?: {
    eoaValidator?: Address;
    webauthnValidator?: Address;
    sessionValidator?: Address;
    guardianExecutor?: Address;
    entryPoint?: Address;
    accountImplementation?: Address;
    beacon?: Address;
    factory?: Address;
  };
};

export type SsoDeploymentResult = {
  eoaValidator: Address;
  webauthnValidator: Address;
  sessionValidator: Address;
  guardianExecutor: Address;
  entryPoint: Address;
  accountImplementation: Address;
  beacon: Address;
  factory: Address;
  ssoBytecodeHash: `0x${string}`;
  deployed: {
    eoaValidator: boolean;
    webauthnValidator: boolean;
    sessionValidator: boolean;
    guardianExecutor: boolean;
    entryPoint: boolean;
    accountImplementation: boolean;
    beacon: boolean;
    factory: boolean;
  };
};

function createTransport(rpcUrl: string, authToken?: string): Transport {
  if (!authToken) {
    return http(rpcUrl);
  }

  const fetchFn: typeof fetch = async (url, init) => {
    const headers = new Headers(init?.headers);
    headers.set('Authorization', `Bearer ${authToken}`);
    return fetch(url, { ...init, headers });
  };

  return http(rpcUrl, { fetchFn });
}

export async function deploySsoContracts(config: SsoDeployConfig): Promise<SsoDeploymentResult> {
  const account = privateKeyToAccount(config.executorPrivateKey);
  const chain = defineChain({
    id: config.chainId,
    name: 'Prividium L2',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: {
      default: { http: [config.rpcUrl] },
      public: { http: [config.rpcUrl] }
    }
  });

  const transport = createTransport(config.rpcUrl, config.authToken);
  const publicClient = createPublicClient({ chain, transport });
  const walletClient = createWalletClient({ chain, transport, account });

  async function hasCode(address: Address): Promise<boolean> {
    const code = await publicClient.getBytecode({ address });
    return !!code && code !== '0x';
  }

  async function ensureAccountImplementation(): Promise<{ address: Address; deployed: boolean }> {
    const configured = config.configured?.accountImplementation;
    if (configured) {
      if (await hasCode(configured)) {
        return { address: configured, deployed: false };
      }
      throw new Error(`No code at configured account implementation: ${configured}`);
    }

    console.log('🚀 Deploying ModularSmartAccount implementation...');
    const hash = await walletClient.deployContract({
      abi: ACCOUNT_IMPL_ABI,
      bytecode: ACCOUNT_IMPL_BYTECODE,
      args: []
    });

    console.log(`Account implementation deployment tx: ${hash}`);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    if (receipt.status !== 'success' || !receipt.contractAddress) {
      throw new Error('Account implementation deployment failed');
    }

    const deployedAddress = receipt.contractAddress as Address;
    console.log(`✅ Account implementation deployed at: ${deployedAddress}`);
    return { address: deployedAddress, deployed: true };
  }

  async function deploySsoAccountAndComputeBytecodeHash(factoryAddress: Address): Promise<Hex> {
    const salt = `0x${randomBytes(32).toString('hex')}` as Hex;
    const initData = '0x' as Hex;

    console.log('🚀 Deploying SSO account via factory.deployAccount...');
    const { request, result: deployedAccount } = await publicClient.simulateContract({
      account,
      address: factoryAddress,
      abi: MSA_FACTORY_ABI,
      functionName: 'deployAccount',
      args: [salt, initData]
    });

    const hash = await walletClient.writeContract(request);
    console.log(`Factory deployAccount tx: ${hash}`);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== 'success') {
      throw new Error('MSAFactory deployAccount failed');
    }

    const code = await publicClient.getBytecode({ address: deployedAccount });
    if (!code || code === '0x') {
      throw new Error(`No code at deployed SSO account: ${deployedAccount}`);
    }

    const bytecodeHash = keccak256(code);
    console.log(`✅ SSO account deployed at: ${deployedAccount}`);
    console.log(`✅ SSO account bytecode hash: ${bytecodeHash}`);
    return bytecodeHash;
  }

  async function ensureBeacon(): Promise<{
    address: Address;
    implementation: Address;
    deployed: boolean;
    implementationDeployed: boolean;
  }> {
    const configured = config.configured?.beacon;
    if (configured) {
      if (!(await hasCode(configured))) {
        throw new Error(`No code at configured beacon address: ${configured}`);
      }
      const implementation = (await publicClient.readContract({
        address: configured,
        abi: BEACON_READ_ABI,
        functionName: 'implementation'
      })) as Address;
      if (!(await hasCode(implementation))) {
        throw new Error(`Beacon implementation has no code at ${implementation}`);
      }
      return {
        address: configured,
        implementation,
        deployed: false,
        implementationDeployed: false
      };
    }

    const { address: implementation, deployed: implementationDeployed } =
      await ensureAccountImplementation();

    console.log('🚀 Deploying UpgradeableBeacon...');
    const hash = await walletClient.deployContract({
      abi: UPGRADEABLE_BEACON_ABI,
      bytecode: UPGRADEABLE_BEACON_BYTECODE,
      args: [implementation, account.address]
    });

    console.log(`Beacon deployment tx: ${hash}`);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    if (receipt.status !== 'success' || !receipt.contractAddress) {
      throw new Error('UpgradeableBeacon deployment failed');
    }

    const deployedAddress = receipt.contractAddress as Address;
    console.log(`✅ Beacon deployed at: ${deployedAddress}`);
    console.log(`✅ Beacon implementation at: ${implementation}`);
    return {
      address: deployedAddress,
      implementation,
      deployed: true,
      implementationDeployed
    };
  }

  async function ensureFactory(
    beaconAddress: Address
  ): Promise<{ address: Address; deployed: boolean }> {
    const configured = config.configured?.factory;
    if (configured) {
      if (!(await hasCode(configured))) {
        throw new Error(`No code at configured factory address: ${configured}`);
      }
      const beaconFromFactory = (await publicClient.readContract({
        address: configured,
        abi: MSA_FACTORY_READ_ABI,
        functionName: 'BEACON'
      })) as Address;
      if (!(await hasCode(beaconFromFactory))) {
        throw new Error(`Factory beacon has no code at ${beaconFromFactory}`);
      }
      return { address: configured, deployed: false };
    }

    console.log('🚀 Deploying MSAFactory...');
    const hash = await walletClient.deployContract({
      abi: MSA_FACTORY_ABI,
      bytecode: MSA_FACTORY_BYTECODE,
      args: [beaconAddress]
    });

    console.log(`Factory deployment tx: ${hash}`);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    if (receipt.status !== 'success' || !receipt.contractAddress) {
      throw new Error('MSAFactory deployment failed');
    }

    const deployedAddress = receipt.contractAddress as Address;
    console.log(`✅ MSAFactory deployed at: ${deployedAddress}`);
    return { address: deployedAddress, deployed: true };
  }

  async function ensureWebauthnValidator(): Promise<{ address: Address; deployed: boolean }> {
    const configured = config.configured?.webauthnValidator;
    if (configured) {
      if (await hasCode(configured)) {
        return { address: configured, deployed: false };
      }
      throw new Error(`No code at configured WebAuthn validator: ${configured}`);
    }

    console.log('🚀 Deploying WebAuthnValidator...');
    const hash = await walletClient.deployContract({
      abi: WEBAUTHN_VALIDATOR_ABI,
      bytecode: WEBAUTHN_VALIDATOR_BYTECODE,
      args: []
    });

    console.log(`WebAuthn validator deployment tx: ${hash}`);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    if (receipt.status !== 'success' || !receipt.contractAddress) {
      throw new Error('WebAuthn validator deployment failed');
    }

    const deployedAddress = receipt.contractAddress as Address;
    console.log(`✅ WebAuthn validator deployed at: ${deployedAddress}`);
    return { address: deployedAddress, deployed: true };
  }

  async function ensureEoaValidator(): Promise<{ address: Address; deployed: boolean }> {
    const configured = config.configured?.eoaValidator;
    if (configured) {
      if (await hasCode(configured)) {
        return { address: configured, deployed: false };
      }
      throw new Error(`No code at configured EOA validator: ${configured}`);
    }

    console.log('🚀 Deploying EOAKeyValidator...');
    const hash = await walletClient.deployContract({
      abi: EOA_VALIDATOR_ABI,
      bytecode: EOA_VALIDATOR_BYTECODE,
      args: []
    });

    console.log(`EOA validator deployment tx: ${hash}`);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    if (receipt.status !== 'success' || !receipt.contractAddress) {
      throw new Error('EOA validator deployment failed');
    }

    const deployedAddress = receipt.contractAddress as Address;
    console.log(`✅ EOA validator deployed at: ${deployedAddress}`);
    return { address: deployedAddress, deployed: true };
  }

  async function ensureSessionValidator(): Promise<{ address: Address; deployed: boolean }> {
    const configured = config.configured?.sessionValidator;
    if (configured) {
      if (await hasCode(configured)) {
        return { address: configured, deployed: false };
      }
      throw new Error(`No code at configured session validator: ${configured}`);
    }

    console.log('🚀 Deploying SessionKeyValidator...');
    const hash = await walletClient.deployContract({
      abi: SESSION_VALIDATOR_ABI,
      bytecode: SESSION_VALIDATOR_BYTECODE,
      args: []
    });

    console.log(`Session validator deployment tx: ${hash}`);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    if (receipt.status !== 'success' || !receipt.contractAddress) {
      throw new Error('Session validator deployment failed');
    }

    const deployedAddress = receipt.contractAddress as Address;
    console.log(`✅ Session validator deployed at: ${deployedAddress}`);
    return { address: deployedAddress, deployed: true };
  }

  async function ensureGuardianExecutor(
    webauthnValidator: Address,
    eoaValidator: Address
  ): Promise<{ address: Address; deployed: boolean }> {
    const configured = config.configured?.guardianExecutor;
    if (configured) {
      if (await hasCode(configured)) {
        return { address: configured, deployed: false };
      }
      throw new Error(`No code at configured guardian executor: ${configured}`);
    }

    console.log('🚀 Deploying GuardianExecutor...');
    const hash = await walletClient.deployContract({
      abi: GUARDIAN_EXECUTOR_ABI,
      bytecode: GUARDIAN_EXECUTOR_BYTECODE,
      args: [webauthnValidator, eoaValidator]
    });

    console.log(`Guardian executor deployment tx: ${hash}`);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    if (receipt.status !== 'success' || !receipt.contractAddress) {
      throw new Error('Guardian executor deployment failed');
    }

    const deployedAddress = receipt.contractAddress as Address;
    console.log(`✅ Guardian executor deployed at: ${deployedAddress}`);
    return { address: deployedAddress, deployed: true };
  }

  async function ensureEntryPoint(): Promise<{ address: Address; deployed: boolean }> {
    const configured = config.configured?.entryPoint;
    if (!configured) {
      throw new Error(
        'Missing entryPoint address. Set PRIVIDIUM_ENTRYPOINT_ADDRESS in .env or contracts config.'
      );
    }
    const hasEntryPoint = await hasCode(configured);
    if (!hasEntryPoint) {
      throw new Error(`No code at configured EntryPoint address: ${configured}`);
    }
    return { address: configured, deployed: false };
  }

  const webauthnValidator = await ensureWebauthnValidator();
  const eoaValidator = await ensureEoaValidator();
  const sessionValidator = await ensureSessionValidator();
  const guardianExecutor = await ensureGuardianExecutor(
    webauthnValidator.address,
    eoaValidator.address
  );
  const entryPoint = await ensureEntryPoint();
  const beacon = await ensureBeacon();
  const factory = await ensureFactory(beacon.address);
  const ssoBytecodeHash = await deploySsoAccountAndComputeBytecodeHash(factory.address);

  return {
    eoaValidator: eoaValidator.address,
    webauthnValidator: webauthnValidator.address,
    sessionValidator: sessionValidator.address,
    guardianExecutor: guardianExecutor.address,
    entryPoint: entryPoint.address,
    accountImplementation: beacon.implementation,
    beacon: beacon.address,
    factory: factory.address,
    ssoBytecodeHash,
    deployed: {
      eoaValidator: eoaValidator.deployed,
      webauthnValidator: webauthnValidator.deployed,
      sessionValidator: sessionValidator.deployed,
      guardianExecutor: guardianExecutor.deployed,
      entryPoint: entryPoint.deployed,
      accountImplementation: beacon.implementationDeployed,
      beacon: beacon.deployed,
      factory: factory.deployed
    }
  };
}
