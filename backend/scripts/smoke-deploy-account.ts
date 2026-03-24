import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  getAddress,
  http,
  keccak256,
  parseAbi,
  parseUnits,
  toHex,
  type Address
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const ADMIN_PRIVATE_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const;
const ADMIN_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as const;

const tokenAbi = parseAbi([
  'function mint(address to, uint256 amount) returns (bool)',
  'function balanceOf(address account) view returns (uint256)',
  'function symbol() view returns (string)'
]);

type TokenDeployment = {
  address?: string;
};

type SsoDeployment = {
  factory?: string;
  beacon?: string;
  accountImplementation?: string;
  webauthnValidator?: string;
  eoaValidator?: string;
  sessionValidator?: string;
  guardianExecutor?: string;
  entryPoint?: string;
};

type ChainDeployment = {
  chainId?: number;
  rpcUrl?: string;
  sso?: SsoDeployment;
  tokens?: Partial<Record<'usdc' | 'sgd' | 'tbill', TokenDeployment>>;
  invoicePayment?: string;
};

type ContractsConfig = {
  chains?: Partial<Record<'a' | 'b' | 'c', ChainDeployment>>;
};

type ServiceResponse<T> = {
  success?: boolean;
  message?: string;
  responseObject?: T;
  statusCode?: number;
};

function fail(message: string): never {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function resolveConfigPath(): string {
  const configuredPath = process.env.CONTRACTS_CONFIG_PATH?.trim();
  const fallbackPath = path.resolve(process.cwd(), '..', 'config', 'contracts.json');
  const resolvedPath = configuredPath
    ? path.isAbsolute(configuredPath)
      ? configuredPath
      : path.resolve(process.cwd(), configuredPath)
    : fallbackPath;

  if (!fs.existsSync(resolvedPath)) {
    fail(
      `Missing contracts config at ${resolvedPath}. Run the setup job first or set CONTRACTS_CONFIG_PATH.`
    );
  }

  return resolvedPath;
}

function readJsonFile<T>(filePath: string): T {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
  } catch (error) {
    fail(`Failed to read JSON from ${filePath}: ${error instanceof Error ? error.message : error}`);
  }
}

function toAddress(value: string | undefined, label: string): Address {
  if (!value) {
    fail(`Missing ${label}.`);
  }

  try {
    return getAddress(value);
  } catch {
    fail(`Invalid ${label}: ${value}`);
  }
}

function createChainClient(chainId: number, rpcUrl: string) {
  const chain = defineChain({
    id: chainId,
    name: `Prividium Chain ${chainId}`,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: {
      default: { http: [rpcUrl] },
      public: { http: [rpcUrl] }
    }
  });

  const account = privateKeyToAccount(ADMIN_PRIVATE_KEY);

  return {
    chain,
    account,
    publicClient: createPublicClient({
      chain,
      transport: http(rpcUrl)
    }),
    walletClient: createWalletClient({
      chain,
      account,
      transport: http(rpcUrl)
    })
  };
}

async function assertBackendHealthy(baseUrl: string) {
  const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/health-check`);
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    fail(`Backend health-check failed: ${response.status} ${response.statusText} ${body}`);
  }
}

async function assertBackendDeployValidation(baseUrl: string) {
  const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/deploy-account`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });

  if (response.status !== 400) {
    const body = await response.text().catch(() => '');
    fail(
      `Expected /deploy-account validation failure to return HTTP 400, received ${response.status} ${response.statusText} ${body}`
    );
  }
}

async function assertBackendFaucetBehavior(baseUrl: string, accountAddress: Address) {
  const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/faucet`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accountAddress })
  });

  const text = await response.text().catch(() => '');
  if (!response.ok) {
    fail(`Backend faucet call failed: ${response.status} ${response.statusText} ${text}`);
  }

  let payload: ServiceResponse<{ funded?: Record<string, boolean> }>;
  try {
    payload = JSON.parse(text) as ServiceResponse<{ funded?: Record<string, boolean> }>;
  } catch (error) {
    fail(`Backend faucet returned non-JSON payload: ${error instanceof Error ? error.message : error}`);
  }

  const funded = payload.responseObject?.funded;
  if (!funded || typeof funded !== 'object') {
    fail(`Backend faucet response did not include funding metadata. Payload: ${text}`);
  }

  if (!funded.entryPoint && !funded.ssoAccount && !funded.shadowAccount) {
    fail(`Backend faucet completed but did not fund any balances. Payload: ${text}`);
  }
}

function deriveScratchAddress(label: string): Address {
  const hash = keccak256(toHex(`${label}:${new Date().toISOString()}`));
  return getAddress(`0x${hash.slice(-40)}`);
}

async function main() {
  const configPath = resolveConfigPath();
  const config = readJsonFile<ContractsConfig>(configPath);
  const chainA = config.chains?.a;
  const chainC = config.chains?.c;

  if (!chainA?.chainId || !chainA.rpcUrl || !chainA.sso) {
    fail('Chain A config is incomplete. Expected chainId, rpcUrl, and sso deployment.');
  }

  if (!chainC?.chainId || !chainC.rpcUrl || !chainC.invoicePayment || !chainC.tokens) {
    fail('Chain C config is incomplete. Expected chainId, rpcUrl, invoicePayment, and tokens.');
  }

  const backendBaseUrl = process.env.BACKEND_BASE_URL?.trim() || `http://localhost:${process.env.PORT || '4340'}`;
  const chainAClient = createChainClient(chainA.chainId, chainA.rpcUrl);
  const chainCClient = createChainClient(chainC.chainId, chainC.rpcUrl);
  const scratchAddress = deriveScratchAddress('forge-deploy-account-smoke');
  const mintAmount = parseUnits('1', 18);

  console.log(`Using contracts config: ${configPath}`);
  console.log(`Using backend base URL: ${backendBaseUrl}`);
  console.log(`Scratch address: ${scratchAddress}`);

  if (chainAClient.account.address.toLowerCase() !== ADMIN_ADDRESS.toLowerCase()) {
    fail(
      `ADMIN_PRIVATE_KEY does not match ADMIN_ADDRESS. derived=${chainAClient.account.address} expected=${ADMIN_ADDRESS}`
    );
  }

  await assertBackendHealthy(backendBaseUrl);
  await assertBackendDeployValidation(backendBaseUrl);

  const activeChainId = Number(process.env.PRIVIDIUM_CHAIN_ID || chainA.chainId);
  if (activeChainId !== chainA.chainId) {
    fail(
      `PRIVIDIUM_CHAIN_ID mismatch. Expected backend to target chain A (${chainA.chainId}), got ${activeChainId}.`
    );
  }

  const envTokenAddresses = {
    usdc: process.env.TOKEN_USDC_ADDRESS,
    sgd: process.env.TOKEN_SGD_ADDRESS,
    tbill: process.env.TOKEN_TBILL_ADDRESS
  };

  for (const [tokenKey, envAddress] of Object.entries(envTokenAddresses) as Array<
    [keyof typeof envTokenAddresses, string | undefined]
  >) {
    const chainAddress = chainA.tokens?.[tokenKey]?.address;
    if (!chainAddress) {
      fail(`Missing chain A ${tokenKey.toUpperCase()} token address in contracts config.`);
    }
    if (!envAddress) {
      fail(`Missing backend env TOKEN_${tokenKey.toUpperCase()}_ADDRESS.`);
    }
    if (getAddress(envAddress) !== getAddress(chainAddress)) {
      fail(
        `Backend env TOKEN_${tokenKey.toUpperCase()}_ADDRESS does not match chain A config. env=${envAddress} config=${chainAddress}`
      );
    }
  }

  const invoicePaymentEnv = process.env.INVOICE_PAYMENT_CONTRACT;
  if (!invoicePaymentEnv) {
    fail('Missing backend env INVOICE_PAYMENT_CONTRACT.');
  }
  if (getAddress(invoicePaymentEnv) !== getAddress(chainC.invoicePayment)) {
    fail(
      `Backend env INVOICE_PAYMENT_CONTRACT does not match chain C config. env=${invoicePaymentEnv} config=${chainC.invoicePayment}`
    );
  }

  const requiredSsoAddresses: Array<[string, string | undefined]> = [
    ['SSO_FACTORY_CONTRACT', chainA.sso.factory],
    ['SSO_BEACON_CONTRACT', chainA.sso.beacon],
    ['SSO_ACCOUNT_IMPLEMENTATION_CONTRACT', chainA.sso.accountImplementation],
    ['SSO_WEBAUTHN_VALIDATOR_CONTRACT', chainA.sso.webauthnValidator],
    ['SSO_EOA_VALIDATOR_CONTRACT', chainA.sso.eoaValidator],
    ['SSO_SESSION_VALIDATOR_CONTRACT', chainA.sso.sessionValidator],
    ['SSO_GUARDIAN_EXECUTOR_CONTRACT', chainA.sso.guardianExecutor],
    ['SSO_ENTRYPOINT_CONTRACT', chainA.sso.entryPoint]
  ];

  for (const [label, value] of requiredSsoAddresses) {
    if (!value) {
      fail(`Missing chain A ${label} in contracts config.`);
    }
    const code = await chainAClient.publicClient.getBytecode({ address: toAddress(value, label) });
    if (!code || code === '0x') {
      fail(`No contract code found at ${label} (${value}) on chain A.`);
    }
  }

  const cTokenRows = [
    ['USDC', chainC.tokens.usdc?.address],
    ['SGD', chainC.tokens.sgd?.address],
    ['TBILL', chainC.tokens.tbill?.address]
  ] as const;

  for (const [symbol, value] of cTokenRows) {
    const tokenAddress = toAddress(value, `chain C ${symbol} token`);
    const tokenCode = await chainCClient.publicClient.getBytecode({ address: tokenAddress });
    if (!tokenCode || tokenCode === '0x') {
      fail(`No contract code found at chain C ${symbol} token ${tokenAddress}.`);
    }

    const beforeBalance = (await chainCClient.publicClient.readContract({
      address: tokenAddress,
      abi: tokenAbi,
      functionName: 'balanceOf',
      args: [scratchAddress]
    })) as bigint;

    const mintHash = await chainCClient.walletClient.writeContract({
      address: tokenAddress,
      abi: tokenAbi,
      functionName: 'mint',
      args: [scratchAddress, mintAmount]
    });

    const mintReceipt = await chainCClient.publicClient.waitForTransactionReceipt({ hash: mintHash });
    if (mintReceipt.status !== 'success') {
      fail(`Mint transaction reverted for ${symbol} on chain C. Tx hash: ${mintHash}`);
    }

    const afterBalance = (await chainCClient.publicClient.readContract({
      address: tokenAddress,
      abi: tokenAbi,
      functionName: 'balanceOf',
      args: [scratchAddress]
    })) as bigint;

    if (afterBalance < beforeBalance + mintAmount) {
      fail(
        `Mint balance check failed for ${symbol}. before=${beforeBalance} after=${afterBalance} expectedAtLeast=${beforeBalance + mintAmount}`
      );
    }
  }

  const chainABalanceBefore = await chainAClient.publicClient.getBalance({ address: scratchAddress });
  await assertBackendFaucetBehavior(backendBaseUrl, scratchAddress);
  const chainABalanceAfter = await chainAClient.publicClient.getBalance({ address: scratchAddress });

  if (chainABalanceAfter <= chainABalanceBefore) {
    fail(
      `Backend faucet did not increase active-chain L2 balance for ${scratchAddress}. before=${chainABalanceBefore} after=${chainABalanceAfter}`
    );
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        scratchAddress,
        chainA: {
          id: chainA.chainId,
          rpcUrl: chainA.rpcUrl
        },
        chainC: {
          id: chainC.chainId,
          rpcUrl: chainC.rpcUrl,
          tokenMintPrecheck: 'passed',
          faucetBehavior: 'passed'
        }
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
