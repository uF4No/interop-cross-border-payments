import fs from 'node:fs';
import path from 'node:path';
import {
  http,
  type Abi,
  type Address,
  type Hex,
  createPublicClient,
  createWalletClient,
  defineChain
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { execCmd } from './exec-cmd';

type DeployOptions = {
  rpcUrl: string;
  privateKey: string;
  chainId: number;
  authToken?: string;
};

type DeployedContracts = Record<string, Address>;

export async function deployAndExtractAddress(
  contractsDir: string,
  artifactPath: string,
  options: DeployOptions
): Promise<Address>;
export async function deployAndExtractAddress(
  contractsDir: string,
  artifactPaths: string[],
  options: DeployOptions
): Promise<DeployedContracts>;
export async function deployAndExtractAddress(
  contractsDir: string,
  artifactPathOrPaths: string | string[],
  options: DeployOptions
): Promise<Address | DeployedContracts> {
  try {
    await execCmd('forge soldeer install', contractsDir);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('soldeer') || message.includes('not connected')) {
      console.warn('⚠️  forge soldeer install failed (continuing with existing dependencies).');
    } else {
      throw error;
    }
  }
  await execCmd('pnpm build', contractsDir);

  const artifactPaths = Array.isArray(artifactPathOrPaths)
    ? artifactPathOrPaths
    : [artifactPathOrPaths];

  const account = privateKeyToAccount(options.privateKey as `0x${string}`);
  const chain = defineChain({
    id: options.chainId,
    name: 'Prividium L2',
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: {
      default: { http: [options.rpcUrl] },
      public: { http: [options.rpcUrl] }
    }
  });

  const transport = options.authToken
    ? http(options.rpcUrl, {
        fetchFn: async (url, init) => {
          const headers = new Headers(init?.headers);
          headers.set('Authorization', `Bearer ${options.authToken}`);
          return fetch(url, { ...init, headers });
        }
      })
    : http(options.rpcUrl);

  const publicClient = createPublicClient({ chain, transport });
  const walletClient = createWalletClient({ chain, transport, account });

  const deployed: DeployedContracts = {};

  for (const artifactPath of artifactPaths) {
    const artifactJson = JSON.parse(
      fs.readFileSync(path.join(contractsDir, artifactPath)).toString()
    ) as { abi: unknown; bytecode?: { object?: string } };

    const bytecode = artifactJson.bytecode?.object as Hex | undefined;
    if (!bytecode) {
      throw new Error(`Missing bytecode in artifact: ${artifactPath}`);
    }

    const hash = await walletClient.deployContract({
      abi: artifactJson.abi as Abi,
      bytecode
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== 'success' || !receipt.contractAddress) {
      throw new Error('Contract deployment failed');
    }

    const contractName = path.basename(artifactPath, path.extname(artifactPath));
    deployed[contractName] = receipt.contractAddress as Address;
  }

  if (Array.isArray(artifactPathOrPaths)) {
    return deployed;
  }

  const contractName = path.basename(artifactPathOrPaths, path.extname(artifactPathOrPaths));
  const address = deployed[contractName];
  if (!address) {
    throw new Error(`Missing deployed address for contract: ${contractName}`);
  }
  return address;
}
