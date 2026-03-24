import type { Abi, Address, Hex, Transport } from 'viem';
import { createPublicClient, createWalletClient, defineChain, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import { execCmd } from './exec-cmd';

const DEFAULT_BUNDLER_IMAGE = 'quay.io/matterlabs_enterprise/prividium-bundler:v1.164.2';
const ENTRYPOINT_SIM_V7_ARTIFACT_PATH =
  '/app/apps/bundler/node_modules/@pimlico/alto/esm/contracts/EntryPointSimulations.sol/EntryPointSimulations07.json';
const PIMLICO_SIM_ARTIFACT_PATH =
  '/app/apps/bundler/node_modules/@pimlico/alto/esm/contracts/PimlicoSimulations.sol/PimlicoSimulations.json';

const EMPTY_CONSTRUCTOR_ABI = [
  {
    type: 'constructor',
    inputs: [],
    stateMutability: 'nonpayable'
  }
] as const satisfies Abi;

type BundlerArtifactJson = {
  bytecode?: {
    object?: string;
  };
};

export type BundlerSimulationChainConfig = {
  label: 'A' | 'B';
  chainId: number;
  rpcUrl: string;
  authToken?: string;
  configured?: {
    entryPointSimulationV7?: Address;
    pimlicoSimulation?: Address;
  };
};

export type BundlerSimulationContracts = {
  entryPointSimulationV7: Address;
  pimlicoSimulation: Address;
  deployed: {
    entryPointSimulationV7: boolean;
    pimlicoSimulation: boolean;
  };
};

type DeployBundlerSimulationContractsArgs = {
  rootPath: string;
  executorPrivateKey: `0x${string}`;
  chain: BundlerSimulationChainConfig;
  bundlerImage?: string;
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

function normalizeHexBytecode(contractName: string, rawBytecode: string | undefined): Hex {
  if (!rawBytecode || rawBytecode.trim().length === 0) {
    throw new Error(`Missing bytecode for ${contractName}`);
  }

  const trimmed = rawBytecode.trim();
  const prefixed = trimmed.startsWith('0x') ? trimmed : `0x${trimmed}`;
  if (!/^0x[0-9a-fA-F]+$/.test(prefixed)) {
    throw new Error(`Invalid bytecode format for ${contractName}`);
  }
  return prefixed as Hex;
}

async function loadArtifactBytecodeFromImage(
  rootPath: string,
  image: string,
  artifactPath: string,
  contractName: string
): Promise<Hex> {
  const escapedPath = artifactPath.replace(/'/g, `'\\''`);
  const escapedImage = image.replace(/'/g, `'\\''`);
  const command = `docker run --rm --platform linux/amd64 --entrypoint sh '${escapedImage}' -lc 'cat '${escapedPath}''`;

  const artifactRaw = await execCmd(command, rootPath);
  const artifact = JSON.parse(artifactRaw) as BundlerArtifactJson;
  return normalizeHexBytecode(contractName, artifact.bytecode?.object);
}

export async function deployBundlerSimulationContracts(
  args: DeployBundlerSimulationContractsArgs
): Promise<BundlerSimulationContracts> {
  const bundlerImage = args.bundlerImage ?? DEFAULT_BUNDLER_IMAGE;

  console.log(
    `  Chain ${args.chain.label}: loading bundler simulation artifacts from ${bundlerImage}...`
  );
  const [entryPointSimulationV7Bytecode, pimlicoSimulationBytecode] = await Promise.all([
    loadArtifactBytecodeFromImage(
      args.rootPath,
      bundlerImage,
      ENTRYPOINT_SIM_V7_ARTIFACT_PATH,
      'EntryPointSimulations07'
    ),
    loadArtifactBytecodeFromImage(
      args.rootPath,
      bundlerImage,
      PIMLICO_SIM_ARTIFACT_PATH,
      'PimlicoSimulations'
    )
  ]);

  const account = privateKeyToAccount(args.executorPrivateKey);
  const chain = defineChain({
    id: args.chain.chainId,
    name: `Prividium Chain ${args.chain.label}`,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: {
      default: { http: [args.chain.rpcUrl] },
      public: { http: [args.chain.rpcUrl] }
    }
  });

  const transport = createTransport(args.chain.rpcUrl, args.chain.authToken);
  const publicClient = createPublicClient({ chain, transport });
  const walletClient = createWalletClient({ chain, transport, account });

  async function hasCode(address: Address): Promise<boolean> {
    const code = await publicClient.getBytecode({ address });
    return !!code && code !== '0x';
  }

  async function ensureContract(
    contractName: string,
    configuredAddress: Address | undefined,
    bytecode: Hex
  ): Promise<{ address: Address; deployed: boolean }> {
    if (configuredAddress && (await hasCode(configuredAddress))) {
      return { address: configuredAddress, deployed: false };
    }

    if (configuredAddress) {
      console.log(
        `  Chain ${args.chain.label}: configured ${contractName} ${configuredAddress} has no code, redeploying...`
      );
    } else {
      console.log(`  Chain ${args.chain.label}: deploying ${contractName}...`);
    }

    const hash = await walletClient.deployContract({
      abi: EMPTY_CONSTRUCTOR_ABI,
      bytecode,
      args: [],
      gasPrice: 0n
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    if (receipt.status !== 'success' || !receipt.contractAddress) {
      throw new Error(
        `Failed to deploy ${contractName} on chain ${args.chain.label} (tx: ${hash})`
      );
    }

    return { address: receipt.contractAddress as Address, deployed: true };
  }

  const [entryPointSimulationV7, pimlicoSimulation] = await Promise.all([
    ensureContract(
      'EntryPointSimulations07',
      args.chain.configured?.entryPointSimulationV7,
      entryPointSimulationV7Bytecode
    ),
    ensureContract(
      'PimlicoSimulations',
      args.chain.configured?.pimlicoSimulation,
      pimlicoSimulationBytecode
    )
  ]);

  return {
    entryPointSimulationV7: entryPointSimulationV7.address,
    pimlicoSimulation: pimlicoSimulation.address,
    deployed: {
      entryPointSimulationV7: entryPointSimulationV7.deployed,
      pimlicoSimulation: pimlicoSimulation.deployed
    }
  };
}

