import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import {
  http,
  type Address,
  createPublicClient,
  createWalletClient,
  defineChain,
  getAddress,
  parseAbi,
  parseUnits
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const ADMIN_PRIVATE_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const;
const ADMIN_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as const;

const invoicePaymentAbi = parseAbi([
  'function getUserCreatedInvoiceCount(address user) view returns (uint256)',
  'function getUserCreatedInvoices(address user, uint256 startIndex, uint256 endIndex) view returns (uint256[])',
  'function getWhitelistedTokens() view returns (address[] tokenAddresses, string[] symbols)',
  'function getConversionAmount(address fromToken, address toToken, uint256 amount) view returns (uint256)',
  'function createInvoice(address recipient, uint256 recipientChainId, address billingToken, uint256 amount, uint256 creatorChainId, address creatorRefundAddress, address recipientRefundAddress, string text) returns (uint256 invoiceId)'
]);

const erc20Abi = parseAbi(['function balanceOf(address account) view returns (uint256)']);

type TokenDeployment = {
  address?: string;
};

type ChainDeployment = {
  chainId?: number;
  rpcUrl?: string;
  invoicePayment?: string;
  tokens?: Partial<Record<'usdc' | 'sgd' | 'tbill', TokenDeployment>>;
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

function requireChainCConfig(config: ContractsConfig): ChainDeployment {
  const chainC = config.chains?.c;
  if (!chainC) {
    fail('Missing chain C deployment in contracts config.');
  }

  if (!chainC.chainId || !chainC.rpcUrl || !chainC.invoicePayment) {
    fail('Chain C config is incomplete. Expected chainId, rpcUrl, and invoicePayment.');
  }

  return chainC;
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

async function callInvoicesEndpoint(baseUrl: string) {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, '');
  const attempts: Array<{
    method: 'GET' | 'POST';
    init?: { headers?: Record<string, string>; body?: string };
  }> = [
    { method: 'GET' },
    {
      method: 'POST',
      init: {
        headers: { 'Content-Type': 'application/json' },
        body: '{}'
      }
    }
  ];

  const errors: string[] = [];

  for (const attempt of attempts) {
    const response = await fetch(`${normalizedBaseUrl}/invoices`, {
      method: attempt.method,
      ...(attempt.init ?? {})
    });

    const text = await response.text().catch(() => '');
    if (response.ok) {
      try {
        return JSON.parse(text) as ServiceResponse<unknown> | unknown;
      } catch (error) {
        fail(
          `/invoices returned non-JSON payload for ${attempt.method}: ${error instanceof Error ? error.message : error}`
        );
      }
    }

    errors.push(`${attempt.method}: ${response.status} ${response.statusText} ${text}`);

    if (![400, 404, 405].includes(response.status) || attempt.method === 'POST') {
      break;
    }
  }

  fail(`Unable to reach /invoices endpoint. Attempts: ${errors.join(' | ')}`);
}

async function callInvoicePaymentOptionsEndpoint(baseUrl: string, invoiceId: string) {
  const response = await fetch(
    `${baseUrl.replace(/\/+$/, '')}/invoices/${encodeURIComponent(invoiceId)}/payment-options`,
    {
      headers: {
        Accept: 'application/json'
      }
    }
  );

  const text = await response.text().catch(() => '');
  if (!response.ok) {
    fail(
      `/invoices/${invoiceId}/payment-options failed: ${response.status} ${response.statusText} ${text}`
    );
  }

  try {
    return JSON.parse(text) as ServiceResponse<unknown> | unknown;
  } catch (error) {
    fail(
      `/invoices/${invoiceId}/payment-options returned non-JSON payload: ${error instanceof Error ? error.message : error}`
    );
  }
}

function unwrapResponseObject(payload: unknown): unknown {
  if (payload && typeof payload === 'object' && 'responseObject' in payload) {
    return (payload as ServiceResponse<unknown>).responseObject;
  }

  return payload;
}

function findInvoiceById(value: unknown, invoiceId: string): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const match = findInvoiceById(item, invoiceId);
      if (match) {
        return match;
      }
    }
    return null;
  }

  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;
  const candidateId = record.id ?? record.invoiceId;
  if (candidateId !== undefined && String(candidateId) === invoiceId) {
    return record;
  }

  const nestedInvoice = record.invoice;
  if (nestedInvoice && typeof nestedInvoice === 'object') {
    const nestedId =
      (nestedInvoice as Record<string, unknown>).id ??
      (nestedInvoice as Record<string, unknown>).invoiceId;
    if (nestedId !== undefined && String(nestedId) === invoiceId) {
      return nestedInvoice as Record<string, unknown>;
    }
  }

  for (const nested of Object.values(record)) {
    const match = findInvoiceById(nested, invoiceId);
    if (match) {
      return match;
    }
  }

  return null;
}

async function main() {
  const configPath = resolveConfigPath();
  const config = readJsonFile<ContractsConfig>(configPath);
  const chainC = requireChainCConfig(config);
  const contractAddress = toAddress(chainC.invoicePayment, 'chain C invoicePayment');
  const rpcUrl = chainC.rpcUrl;
  const chainId = chainC.chainId;
  const backendBaseUrl =
    process.env.BACKEND_BASE_URL?.trim() || `http://localhost:${process.env.PORT || '4340'}`;

  const { publicClient, walletClient, account } = createChainClient(chainId, rpcUrl);
  if (account.address.toLowerCase() !== ADMIN_ADDRESS.toLowerCase()) {
    fail(
      `ADMIN_PRIVATE_KEY does not match ADMIN_ADDRESS. derived=${account.address} expected=${ADMIN_ADDRESS}`
    );
  }

  console.log(`Using contracts config: ${configPath}`);
  console.log(`Using chain C RPC: ${rpcUrl}`);
  console.log(`Using backend base URL: ${backendBaseUrl}`);

  await assertBackendHealthy(backendBaseUrl);

  const invoicePaymentCode = await publicClient.getBytecode({ address: contractAddress });
  if (!invoicePaymentCode || invoicePaymentCode === '0x') {
    fail(`No contract code found at invoicePayment ${contractAddress} on chain C.`);
  }

  const tokenRows = await publicClient.readContract({
    address: contractAddress,
    abi: invoicePaymentAbi,
    functionName: 'getWhitelistedTokens'
  });

  const whitelistedTokens = tokenRows[0] as Address[];
  const whitelistedSymbols = tokenRows[1] as string[];
  if (whitelistedTokens.length === 0) {
    fail(`InvoicePayment at ${contractAddress} has no whitelisted tokens.`);
  }

  const configuredTokens = chainC.tokens ?? {};
  const tokenCandidates: Array<{ symbol: string; address: Address }> = [
    {
      symbol: 'USDC',
      address: toAddress(configuredTokens.usdc?.address, 'chain C USDC token')
    },
    {
      symbol: 'SGD',
      address: toAddress(configuredTokens.sgd?.address, 'chain C SGD token')
    },
    {
      symbol: 'TBILL',
      address: toAddress(configuredTokens.tbill?.address, 'chain C TBILL token')
    }
  ];

  const billingTokenCandidate =
    tokenCandidates.find((entry) =>
      whitelistedTokens.some((token) => token.toLowerCase() === entry.address.toLowerCase())
    ) ?? null;

  if (!billingTokenCandidate) {
    fail(
      `None of the configured chain C tokens are whitelisted in InvoicePayment. Whitelisted symbols: ${whitelistedSymbols.join(', ')}`
    );
  }

  const creatorRefundAddress = account.address;
  const recipientRefundAddress = account.address;
  const uniqueText = `FORGE invoice smoke ${new Date().toISOString()}`;
  const billingAmount = parseUnits('1', 18);
  const createdCountBefore = (await publicClient.readContract({
    address: contractAddress,
    abi: invoicePaymentAbi,
    functionName: 'getUserCreatedInvoiceCount',
    args: [creatorRefundAddress]
  })) as bigint;

  const txHash = await walletClient.writeContract({
    address: contractAddress,
    abi: invoicePaymentAbi,
    functionName: 'createInvoice',
    args: [
      creatorRefundAddress,
      chainId,
      billingTokenCandidate.address,
      billingAmount,
      chainId,
      creatorRefundAddress,
      recipientRefundAddress,
      uniqueText
    ]
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== 'success') {
    fail(`Invoice creation reverted on chain C. Tx hash: ${txHash}`);
  }

  const createdCountAfter = (await publicClient.readContract({
    address: contractAddress,
    abi: invoicePaymentAbi,
    functionName: 'getUserCreatedInvoiceCount',
    args: [creatorRefundAddress]
  })) as bigint;

  if (createdCountAfter <= createdCountBefore) {
    fail(
      `Invoice count did not increase after createInvoice. before=${createdCountBefore} after=${createdCountAfter}`
    );
  }

  const createdIds = (await publicClient.readContract({
    address: contractAddress,
    abi: invoicePaymentAbi,
    functionName: 'getUserCreatedInvoices',
    args: [creatorRefundAddress, Number(createdCountBefore), Number(createdCountAfter)]
  })) as bigint[];

  const createdInvoiceId = createdIds.at(-1);
  if (createdInvoiceId === undefined) {
    fail('No invoice ID was returned after createInvoice.');
  }

  const backendPayload = unwrapResponseObject(await callInvoicesEndpoint(backendBaseUrl));
  const invoiceRecord = findInvoiceById(backendPayload, createdInvoiceId.toString());

  if (!invoiceRecord) {
    fail(
      `Backend /invoices response did not include invoice ${createdInvoiceId.toString()}. Payload: ${JSON.stringify(backendPayload)}`
    );
  }

  const endpointInvoiceText = invoiceRecord.text;
  if (typeof endpointInvoiceText === 'string' && endpointInvoiceText !== uniqueText) {
    fail(
      `Backend /invoices returned invoice ${createdInvoiceId.toString()}, but the invoice text did not match the smoke marker. expected=${uniqueText} actual=${endpointInvoiceText}`
    );
  }

  const paymentOptionsPayload = unwrapResponseObject(
    await callInvoicePaymentOptionsEndpoint(backendBaseUrl, createdInvoiceId.toString())
  );
  if (!paymentOptionsPayload || typeof paymentOptionsPayload !== 'object') {
    fail(`Payment options payload for invoice ${createdInvoiceId.toString()} was not an object.`);
  }

  const paymentOptionsRecord = paymentOptionsPayload as Record<string, unknown>;
  const billingAmountFromEndpoint = paymentOptionsRecord.billingAmount;
  if (String(billingAmountFromEndpoint) !== billingAmount.toString()) {
    fail(
      `Payment options billingAmount mismatch. expected=${billingAmount.toString()} actual=${String(billingAmountFromEndpoint)}`
    );
  }

  const options = Array.isArray(paymentOptionsRecord.options)
    ? (paymentOptionsRecord.options as Array<Record<string, unknown>>)
    : [];
  if (options.length === 0) {
    fail(
      `Payment options endpoint returned no quoteable payment options for invoice ${createdInvoiceId.toString()}.`
    );
  }

  const sameTokenOption = options.find(
    (option) =>
      typeof option.token === 'string' && getAddress(option.token) === billingTokenCandidate.address
  );
  if (!sameTokenOption) {
    fail(
      `Payment options endpoint did not include the billing token ${billingTokenCandidate.address}.`
    );
  }
  if (String(sameTokenOption.paymentAmount) !== billingAmount.toString()) {
    fail(
      `Same-token payment amount mismatch. expected=${billingAmount.toString()} actual=${String(sameTokenOption.paymentAmount)}`
    );
  }

  const alternateTokenCandidate =
    tokenCandidates.find((entry) => entry.address !== billingTokenCandidate.address) ?? null;
  if (!alternateTokenCandidate) {
    fail('Unable to find an alternate payment token candidate for quote verification.');
  }

  const alternateOption = options.find(
    (option) =>
      typeof option.token === 'string' &&
      getAddress(option.token) === alternateTokenCandidate.address
  );
  if (!alternateOption) {
    fail(
      `Payment options endpoint did not include alternate token ${alternateTokenCandidate.address}.`
    );
  }

  const expectedAlternateAmount = (await publicClient.readContract({
    address: contractAddress,
    abi: invoicePaymentAbi,
    functionName: 'getConversionAmount',
    args: [billingTokenCandidate.address, alternateTokenCandidate.address, billingAmount]
  })) as bigint;
  if (String(alternateOption.paymentAmount) !== expectedAlternateAmount.toString()) {
    fail(
      `Alternate-token payment amount mismatch. expected=${expectedAlternateAmount.toString()} actual=${String(alternateOption.paymentAmount)}`
    );
  }

  const invoicePaymentBillingTokenBalance = (await publicClient.readContract({
    address: billingTokenCandidate.address,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [contractAddress]
  })) as bigint;
  const expectedLiquidityFlag = invoicePaymentBillingTokenBalance >= billingAmount;
  if (Boolean(paymentOptionsRecord.hasSufficientBillingLiquidity) !== expectedLiquidityFlag) {
    fail(
      `Liquidity flag mismatch. expected=${expectedLiquidityFlag} actual=${String(paymentOptionsRecord.hasSufficientBillingLiquidity)}`
    );
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        createdInvoiceId: createdInvoiceId.toString(),
        billingToken: billingTokenCandidate.address,
        backendInvoiceFound: true,
        alternatePaymentToken: alternateTokenCandidate.address
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
