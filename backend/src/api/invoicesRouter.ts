import fs from 'node:fs';
import path from 'node:path';

import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import express, { type Request, type Response, type Router } from 'express';
import { StatusCodes } from 'http-status-codes';
import {
  http,
  type Address,
  createPublicClient,
  defineChain,
  getAddress,
  parseAbiItem,
  zeroAddress
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { z } from 'zod';

import { createApiResponse } from '@/utils/response/openAPIResponseBuilders';
import { ServiceResponse } from '@/utils/response/serviceResponse';

const ADMIN_PRIVATE_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const;
const ADMIN_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as Address;
const INVOICE_CHUNK_SIZE = 25;
const INVOICE_VIEWS = ['all', 'created', 'received'] as const;
const AUTH_COOLDOWN_MS = 30_000;
const TOKEN_EXPIRY_BUFFER_MS = 30_000;
const INVOICE_SNAPSHOT_TTL_MS = 15_000;
const INVOICE_SNAPSHOT_STALE_IF_ERROR_MS = 60_000;
const invoiceCreatedEvent = parseAbiItem(
  'event InvoiceCreated(uint256 indexed id, address indexed creatorRefundAddress, address indexed recipientRefundAddress, uint256 creatorChainId, uint256 recipientChainId, address billingToken, uint256 amount)'
);

const invoiceAbi = [
  {
    type: 'function',
    stateMutability: 'view',
    name: 'getInvoiceCount',
    inputs: [],
    outputs: [{ name: 'count', type: 'uint256' }]
  },
  {
    type: 'function',
    stateMutability: 'view',
    name: 'getUserCreatedInvoiceCount',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ name: 'count', type: 'uint256' }]
  },
  {
    type: 'function',
    stateMutability: 'view',
    name: 'getUserCreatedInvoices',
    inputs: [
      { name: 'user', type: 'address' },
      { name: 'startIndex', type: 'uint256' },
      { name: 'endIndex', type: 'uint256' }
    ],
    outputs: [{ name: 'invoiceIds', type: 'uint256[]' }]
  },
  {
    type: 'function',
    stateMutability: 'view',
    name: 'getUserPendingInvoiceCount',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ name: 'count', type: 'uint256' }]
  },
  {
    type: 'function',
    stateMutability: 'view',
    name: 'getUserPendingInvoices',
    inputs: [
      { name: 'user', type: 'address' },
      { name: 'startIndex', type: 'uint256' },
      { name: 'endIndex', type: 'uint256' }
    ],
    outputs: [{ name: 'invoiceIds', type: 'uint256[]' }]
  },
  {
    type: 'function',
    stateMutability: 'view',
    name: 'getWhitelistedTokens',
    inputs: [],
    outputs: [
      { name: 'tokenAddresses', type: 'address[]' },
      { name: 'symbols', type: 'string[]' }
    ]
  },
  {
    type: 'function',
    stateMutability: 'view',
    name: 'getConversionAmount',
    inputs: [
      { name: 'fromToken', type: 'address' },
      { name: 'toToken', type: 'address' },
      { name: 'amount', type: 'uint256' }
    ],
    outputs: [{ name: 'convertedAmount', type: 'uint256' }]
  },
  {
    type: 'function',
    stateMutability: 'view',
    name: 'getInvoiceDetails',
    inputs: [{ name: 'invoiceId', type: 'uint256' }],
    outputs: [
      {
        name: 'invoice',
        type: 'tuple',
        components: [
          { name: 'id', type: 'uint256' },
          { name: 'creator', type: 'address' },
          { name: 'recipient', type: 'address' },
          { name: 'creatorRefundAddress', type: 'address' },
          { name: 'recipientRefundAddress', type: 'address' },
          { name: 'creatorChainId', type: 'uint256' },
          { name: 'recipientChainId', type: 'uint256' },
          { name: 'billingToken', type: 'address' },
          { name: 'amount', type: 'uint256' },
          { name: 'paymentToken', type: 'address' },
          { name: 'paymentAmount', type: 'uint256' },
          { name: 'status', type: 'uint8' },
          { name: 'createdAt', type: 'uint256' },
          { name: 'paidAt', type: 'uint256' },
          { name: 'text', type: 'string' }
        ]
      }
    ]
  },
  {
    type: 'function',
    stateMutability: 'view',
    name: 'getMultipleInvoiceDetails',
    inputs: [{ name: 'invoiceIds', type: 'uint256[]' }],
    outputs: [
      {
        name: 'invoiceDetails',
        type: 'tuple[]',
        components: [
          { name: 'id', type: 'uint256' },
          { name: 'creator', type: 'address' },
          { name: 'recipient', type: 'address' },
          { name: 'creatorRefundAddress', type: 'address' },
          { name: 'recipientRefundAddress', type: 'address' },
          { name: 'creatorChainId', type: 'uint256' },
          { name: 'recipientChainId', type: 'uint256' },
          { name: 'billingToken', type: 'address' },
          { name: 'amount', type: 'uint256' },
          { name: 'paymentToken', type: 'address' },
          { name: 'paymentAmount', type: 'uint256' },
          { name: 'status', type: 'uint8' },
          { name: 'createdAt', type: 'uint256' },
          { name: 'paidAt', type: 'uint256' },
          { name: 'text', type: 'string' }
        ]
      }
    ]
  }
] as const;

const erc20Abi = [
  {
    type: 'function',
    stateMutability: 'view',
    name: 'balanceOf',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: 'balance', type: 'uint256' }]
  }
] as const;

type ContractsConfig = {
  chains?: {
    c?: {
      chainId?: number | string;
      rpcUrl?: string;
      apiUrl?: string;
      authBaseUrl?: string;
      invoicePayment?: string;
      tokens?: Partial<Record<'usdc' | 'sgd' | 'tbill', { address?: string }>>;
    };
  };
};

type InvoiceStatus = 'Created' | 'Paid' | 'Cancelled';
type InvoiceSourceTag = 'created' | 'pending';
type InvoiceView = (typeof INVOICE_VIEWS)[number];

type RawInvoice = {
  id: bigint;
  creator: Address;
  recipient: Address;
  creatorRefundAddress: Address;
  recipientRefundAddress: Address;
  creatorChainId: bigint;
  recipientChainId: bigint;
  billingToken: Address;
  amount: bigint;
  paymentToken: Address;
  paymentAmount: bigint;
  status: number;
  createdAt: bigint;
  paidAt: bigint;
  text: string;
};

type NormalizedInvoice = {
  id: string;
  creator: Address;
  recipient: Address;
  creatorRefundAddress: Address;
  recipientRefundAddress: Address;
  creatorChainId: number;
  recipientChainId: number;
  billingToken: Address;
  amount: string;
  paymentToken: Address | null;
  paymentAmount: string;
  status: InvoiceStatus | 'Unknown';
  createdAt: string;
  paidAt: string | null;
  text: string;
  sourceTags: InvoiceSourceTag[];
};

type CachedInvoiceSnapshot = Omit<NormalizedInvoice, 'sourceTags'>;

type ChainCContext = {
  chainId: number;
  rpcUrl: string;
  apiUrl: string;
  authBaseUrl: string;
  invoicePayment: Address;
  tokens: Partial<Record<'usdc' | 'sgd' | 'tbill', { address?: Address }>>;
};

type InvoiceResponseObject = {
  chain: {
    chainId: number;
    rpcUrl: string;
    apiUrl: string;
    authBaseUrl: string;
    invoicePayment: Address;
  };
  accountAddress: Address | null;
  adminAddress: Address;
  counts: {
    created: number;
    pending: number;
    total: number;
  };
  view?: InvoiceView;
  availableViews?: InvoiceView[];
  countsByView?: Record<InvoiceView, number>;
  createdInvoiceIds: string[];
  pendingInvoiceIds: string[];
  invoices: NormalizedInvoice[];
};

type PaymentOption = {
  token: Address;
  symbol: string;
  paymentAmount: string;
  isBillingToken: boolean;
};

type InvoicePaymentOptionsResponseObject = {
  invoiceId: string;
  status: InvoiceStatus | 'Unknown';
  billingToken: Address;
  billingTokenSymbol: string;
  billingAmount: string;
  options: PaymentOption[];
  quoteType: 'exact';
  invoicePaymentBillingTokenBalance: string;
  hasSufficientBillingLiquidity: boolean;
};

type AdminAuthState = {
  token: string | null;
  tokenExpiry: number;
  authInFlight: Promise<string> | null;
  authCooldownUntil: number;
};

type InvoiceSnapshotState = {
  value: CachedInvoiceSnapshot[] | null;
  fetchedAt: number;
  inFlight: Promise<CachedInvoiceSnapshot[]> | null;
};

const invoicesRegistry = new OpenAPIRegistry();
export const invoicesRouter: Router = express.Router();
const adminAuthStateByKey = new Map<string, AdminAuthState>();
const invoiceSnapshotStateByKey = new Map<string, InvoiceSnapshotState>();

invoicesRegistry.registerPath({
  method: 'get',
  path: '/invoices',
  tags: ['Invoices'],
  responses: {
    ...createApiResponse(z.any(), 'Success', StatusCodes.OK),
    ...createApiResponse(z.any(), 'Bad Request', StatusCodes.BAD_REQUEST)
  }
});

invoicesRegistry.registerPath({
  method: 'post',
  path: '/invoices',
  tags: ['Invoices'],
  responses: {
    ...createApiResponse(z.any(), 'Success', StatusCodes.OK),
    ...createApiResponse(z.any(), 'Bad Request', StatusCodes.BAD_REQUEST)
  }
});

invoicesRegistry.registerPath({
  method: 'get',
  path: '/invoices/{invoiceId}/payment-options',
  tags: ['Invoices'],
  responses: {
    ...createApiResponse(z.any(), 'Success', StatusCodes.OK),
    ...createApiResponse(z.any(), 'Bad Request', StatusCodes.BAD_REQUEST)
  }
});

function resolveContractsConfigPath(): string {
  const configuredPath = process.env.CONTRACTS_CONFIG_PATH?.trim();
  const candidates = [
    configuredPath ? path.resolve(process.cwd(), configuredPath) : null,
    path.resolve(process.cwd(), 'config', 'contracts.json'),
    path.resolve(process.cwd(), '..', 'config', 'contracts.json')
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(`Unable to locate contracts config. Checked: ${candidates.join(', ')}`);
}

function loadChainCContext(): ChainCContext {
  const configPath = resolveContractsConfigPath();
  const raw = fs.readFileSync(configPath, 'utf8');
  const config = JSON.parse(raw) as ContractsConfig;
  const chainC = config.chains?.c;

  if (!chainC) {
    throw new Error(`Missing chains.c in ${configPath}`);
  }

  const chainId = Number(chainC.chainId);
  const rpcUrl = chainC.rpcUrl?.trim();
  const apiUrl = chainC.apiUrl?.trim();
  const authBaseUrl = chainC.authBaseUrl?.trim();
  const invoicePayment = chainC.invoicePayment?.trim();

  if (!Number.isFinite(chainId) || chainId <= 0) {
    throw new Error(`Invalid chain C chainId in ${configPath}`);
  }
  if (!rpcUrl) {
    throw new Error(`Missing chains.c.rpcUrl in ${configPath}`);
  }
  if (!apiUrl) {
    throw new Error(`Missing chains.c.apiUrl in ${configPath}`);
  }
  if (!authBaseUrl) {
    throw new Error(`Missing chains.c.authBaseUrl in ${configPath}`);
  }
  if (!invoicePayment || !invoicePayment.startsWith('0x')) {
    throw new Error(`Missing chains.c.invoicePayment in ${configPath}`);
  }

  return {
    chainId,
    rpcUrl,
    apiUrl,
    authBaseUrl,
    invoicePayment: getAddress(invoicePayment),
    tokens: {
      usdc: chainC.tokens?.usdc?.address
        ? { address: getAddress(chainC.tokens.usdc.address) }
        : undefined,
      sgd: chainC.tokens?.sgd?.address
        ? { address: getAddress(chainC.tokens.sgd.address) }
        : undefined,
      tbill: chainC.tokens?.tbill?.address
        ? { address: getAddress(chainC.tokens.tbill.address) }
        : undefined
    }
  };
}

function chunkArray<T>(values: readonly T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += chunkSize) {
    chunks.push(values.slice(index, index + chunkSize));
  }
  return chunks;
}

function normalizeInvoice(invoice: RawInvoice, sourceTags: InvoiceSourceTag[]): NormalizedInvoice {
  const statuses: InvoiceStatus[] = ['Created', 'Paid', 'Cancelled'];
  const status = statuses[Number(invoice.status)] ?? 'Unknown';

  return {
    id: invoice.id.toString(),
    creator: invoice.creator,
    recipient: invoice.recipient,
    creatorRefundAddress: invoice.creatorRefundAddress,
    recipientRefundAddress: invoice.recipientRefundAddress,
    creatorChainId: Number(invoice.creatorChainId),
    recipientChainId: Number(invoice.recipientChainId),
    billingToken: invoice.billingToken,
    amount: invoice.amount.toString(),
    paymentToken: invoice.paymentToken === zeroAddress ? null : invoice.paymentToken,
    paymentAmount: invoice.paymentAmount.toString(),
    status,
    createdAt: invoice.createdAt.toString(),
    paidAt: invoice.paidAt === 0n ? null : invoice.paidAt.toString(),
    text: invoice.text,
    sourceTags
  };
}

function getAdminAuthState(cacheKey: string): AdminAuthState {
  const existing = adminAuthStateByKey.get(cacheKey);
  if (existing) {
    return existing;
  }

  const initialState: AdminAuthState = {
    token: null,
    tokenExpiry: 0,
    authInFlight: null,
    authCooldownUntil: 0
  };
  adminAuthStateByKey.set(cacheKey, initialState);
  return initialState;
}

function getInvoiceSnapshotState(cacheKey: string): InvoiceSnapshotState {
  const existing = invoiceSnapshotStateByKey.get(cacheKey);
  if (existing) {
    return existing;
  }

  const initialState: InvoiceSnapshotState = {
    value: null,
    fetchedAt: 0,
    inFlight: null
  };
  invoiceSnapshotStateByKey.set(cacheKey, initialState);
  return initialState;
}

function parseRetryAfterMs(response: globalThis.Response): number {
  const retryAfterHeader = response.headers.get('retry-after');
  const retryAfterSeconds = retryAfterHeader ? Number(retryAfterHeader) : Number.NaN;
  return Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
    ? retryAfterSeconds * 1000
    : AUTH_COOLDOWN_MS;
}

async function postJson(url: string, body: Record<string, unknown>) {
  return fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
}

async function getAdminAuthToken(chainC: ChainCContext): Promise<string> {
  const cacheKey = `${chainC.chainId}:${chainC.apiUrl}:${ADMIN_ADDRESS.toLowerCase()}`;
  const state = getAdminAuthState(cacheKey);

  if (state.authInFlight) {
    return state.authInFlight;
  }
  if (Date.now() < state.authCooldownUntil) {
    throw new Error('Admin auth is cooling down after a rate limit. Retry shortly.');
  }
  if (state.token && Date.now() < state.tokenExpiry - TOKEN_EXPIRY_BUFFER_MS) {
    return state.token;
  }

  const adminAccount = privateKeyToAccount(ADMIN_PRIVATE_KEY);
  if (adminAccount.address.toLowerCase() !== ADMIN_ADDRESS.toLowerCase()) {
    throw new Error('Hardcoded admin private key does not match hardcoded admin address');
  }

  const siweDomain = new URL(chainC.authBaseUrl).host;
  const baseCandidates = [chainC.apiUrl.replace(/\/+$/, '')];
  if (!baseCandidates[0].endsWith('/api')) {
    baseCandidates.push(`${baseCandidates[0]}/api`);
  }

  const run = async () => {
    let lastError: unknown;
    try {
      for (const baseUrl of baseCandidates) {
        try {
          const challengeRes = await postJson(`${baseUrl}/siwe-messages/`, {
            address: ADMIN_ADDRESS,
            domain: siweDomain
          });

          if (!challengeRes.ok) {
            const errorText = await challengeRes.text().catch(() => '');
            if (challengeRes.status === 429) {
              state.authCooldownUntil = Date.now() + parseRetryAfterMs(challengeRes);
            }
            throw new Error(
              `Failed to request SIWE challenge from ${baseUrl}: ${challengeRes.status} ${challengeRes.statusText} ${errorText}`
            );
          }

          const challengeJson = (await challengeRes.json()) as { message?: string; msg?: string };
          const message = challengeJson.message ?? challengeJson.msg;
          if (!message) {
            throw new Error(`SIWE challenge from ${baseUrl} did not include a message`);
          }

          const signature = await adminAccount.signMessage({ message });
          const loginRes = await postJson(`${baseUrl}/auth/login/crypto-native`, {
            message,
            signature
          });

          if (!loginRes.ok) {
            const errorText = await loginRes.text().catch(() => '');
            if (loginRes.status === 429) {
              state.authCooldownUntil = Date.now() + parseRetryAfterMs(loginRes);
            }
            throw new Error(
              `Failed to authenticate admin session against ${baseUrl}: ${loginRes.status} ${loginRes.statusText} ${errorText}`
            );
          }

          const loginJson = (await loginRes.json()) as { token?: string; expiresAt?: string };
          if (!loginJson.token) {
            throw new Error(`Admin login response from ${baseUrl} did not include a token`);
          }

          state.token = loginJson.token;
          state.tokenExpiry = loginJson.expiresAt
            ? Date.parse(loginJson.expiresAt)
            : Date.now() + 60 * 60 * 1000;
          state.authCooldownUntil = 0;
          return loginJson.token;
        } catch (error) {
          lastError = error;
        }
      }

      throw lastError instanceof Error
        ? lastError
        : new Error('Failed to authenticate admin session for chain C');
    } catch (error) {
      state.token = null;
      state.tokenExpiry = 0;
      if (Date.now() >= state.authCooldownUntil) {
        state.authCooldownUntil = Date.now() + AUTH_COOLDOWN_MS;
      }
      throw error;
    } finally {
      state.authInFlight = null;
    }
  };

  state.authInFlight = run();
  return state.authInFlight;
}

function createChainCClient(chainC: ChainCContext, token: string) {
  const chain = defineChain({
    id: chainC.chainId,
    name: 'Prividium Chain C',
    nativeCurrency: {
      name: 'Ether',
      symbol: 'ETH',
      decimals: 18
    },
    rpcUrls: {
      default: { http: [chainC.rpcUrl] },
      public: { http: [chainC.rpcUrl] }
    }
  });

  return createPublicClient({
    chain,
    transport: http(chainC.rpcUrl, {
      fetchFn: async (url, init) => {
        const headers = new Headers(init?.headers);
        headers.set('Authorization', `Bearer ${token}`);
        return fetch(url, { ...init, headers });
      }
    })
  });
}

async function readInvoiceIds(
  client: ReturnType<typeof createChainCClient>,
  functionName: 'getUserCreatedInvoices' | 'getUserPendingInvoices',
  user: Address,
  count: bigint,
  invoicePayment: Address
): Promise<readonly bigint[]> {
  if (count === 0n) {
    return [];
  }

  return (await client.readContract({
    address: invoicePayment,
    abi: invoiceAbi,
    functionName,
    args: [user, 0n, count]
  })) as readonly bigint[];
}

async function readInvoiceDetails(
  client: ReturnType<typeof createChainCClient>,
  invoiceIds: bigint[],
  invoicePayment: Address
): Promise<RawInvoice[]> {
  if (invoiceIds.length === 0) {
    return [];
  }

  const results: RawInvoice[] = [];
  for (const chunk of chunkArray(invoiceIds, INVOICE_CHUNK_SIZE)) {
    try {
      const chunkResults = (await client.readContract({
        address: invoicePayment,
        abi: invoiceAbi,
        functionName: 'getMultipleInvoiceDetails',
        args: [chunk]
      })) as readonly RawInvoice[];
      results.push(...chunkResults);
      continue;
    } catch (error) {
      console.warn('getMultipleInvoiceDetails failed, falling back to per-invoice reads', error);
    }

    for (const invoiceId of chunk) {
      const invoice = (await client.readContract({
        address: invoicePayment,
        abi: invoiceAbi,
        functionName: 'getInvoiceDetails',
        args: [invoiceId]
      })) as unknown as RawInvoice;
      results.push(invoice);
    }
  }

  return results;
}

async function readAllInvoiceIds(
  client: ReturnType<typeof createChainCClient>,
  invoicePayment: Address
): Promise<bigint[]> {
  try {
    const invoiceCount = (await client.readContract({
      address: invoicePayment,
      abi: invoiceAbi,
      functionName: 'getInvoiceCount'
    })) as bigint;

    return buildSequentialInvoiceIds(invoiceCount);
  } catch (error) {
    console.warn(
      'getInvoiceCount unavailable on InvoicePayment, falling back to InvoiceCreated logs',
      error
    );
  }

  const logs = await client.getLogs({
    address: invoicePayment,
    event: invoiceCreatedEvent,
    fromBlock: 0n,
    toBlock: 'latest'
  });

  return [
    ...new Set(logs.map((log) => log.args.id).filter((id): id is bigint => typeof id === 'bigint'))
  ].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

async function readCachedInvoiceSnapshot(
  client: ReturnType<typeof createChainCClient>,
  chainC: ChainCContext
): Promise<CachedInvoiceSnapshot[]> {
  const cacheKey = `${chainC.chainId}:${chainC.rpcUrl}:${chainC.invoicePayment.toLowerCase()}`;
  const state = getInvoiceSnapshotState(cacheKey);
  const now = Date.now();

  if (state.value && now - state.fetchedAt < INVOICE_SNAPSHOT_TTL_MS) {
    return state.value;
  }

  if (state.inFlight) {
    return state.inFlight;
  }

  const run = async () => {
    try {
      const orderedInvoiceIds = await readAllInvoiceIds(client, chainC.invoicePayment);
      const invoices = await readInvoiceDetails(client, orderedInvoiceIds, chainC.invoicePayment);
      const snapshot = invoices.map((invoice) => {
        const { sourceTags, ...normalized } = normalizeInvoice(invoice, []);
        return normalized;
      });

      state.value = snapshot;
      state.fetchedAt = Date.now();
      return snapshot;
    } catch (error) {
      if (state.value && now - state.fetchedAt < INVOICE_SNAPSHOT_STALE_IF_ERROR_MS) {
        console.warn('Serving stale invoice snapshot after refresh failure', error);
        return state.value;
      }
      throw error;
    } finally {
      state.inFlight = null;
    }
  };

  state.inFlight = run();
  return state.inFlight;
}

function resolveRequestedAccountAddress(
  req: Request,
  options: { defaultToAdmin: boolean }
): Address | null {
  const queryValue =
    typeof req.query.accountAddress === 'string' ? req.query.accountAddress : undefined;
  const bodyValue =
    req.body && typeof req.body === 'object' && typeof req.body.accountAddress === 'string'
      ? req.body.accountAddress
      : undefined;
  const candidate = bodyValue?.trim() || queryValue?.trim();

  if (candidate) {
    return getAddress(candidate);
  }

  return options.defaultToAdmin ? ADMIN_ADDRESS : null;
}

function resolveRequestedView(req: Request): InvoiceView | undefined {
  const queryValue = typeof req.query.view === 'string' ? req.query.view : undefined;
  const bodyValue =
    req.body && typeof req.body === 'object' && typeof req.body.view === 'string'
      ? req.body.view
      : undefined;
  const candidate = bodyValue?.trim() || queryValue?.trim();

  if (!candidate) {
    return undefined;
  }

  if ((INVOICE_VIEWS as readonly string[]).includes(candidate)) {
    return candidate as InvoiceView;
  }

  throw new Error(`Unsupported invoice view "${candidate}"`);
}

function buildSequentialInvoiceIds(count: bigint): bigint[] {
  const invoiceIds: bigint[] = [];
  for (let invoiceId = 1n; invoiceId <= count; invoiceId += 1n) {
    invoiceIds.push(invoiceId);
  }
  return invoiceIds;
}

function filterInvoicesByView(
  invoices: NormalizedInvoice[],
  view: InvoiceView
): NormalizedInvoice[] {
  if (view === 'all') {
    return invoices;
  }

  const sourceTag: InvoiceSourceTag = view === 'created' ? 'created' : 'pending';
  return invoices.filter((invoice) => invoice.sourceTags.includes(sourceTag));
}

function resolveConfiguredTokenSymbol(chainC: ChainCContext, token: Address): string | null {
  const normalized = token.toLowerCase();
  const match = Object.entries(chainC.tokens).find(
    ([, deployment]) => deployment?.address && deployment.address.toLowerCase() === normalized
  )?.[0];

  return match ? match.toUpperCase() : null;
}

function normalizeInvoiceStatusCode(status: number): InvoiceStatus | 'Unknown' {
  const statuses: InvoiceStatus[] = ['Created', 'Paid', 'Cancelled'];
  return statuses[status] ?? 'Unknown';
}

async function fetchInvoices(accountAddress: Address | null, view?: InvoiceView) {
  const chainC = loadChainCContext();

  const token = await getAdminAuthToken(chainC);
  const client = createChainCClient(chainC, token);

  const [createdCount, pendingCount] = accountAddress
    ? await Promise.all([
        client.readContract({
          address: chainC.invoicePayment,
          abi: invoiceAbi,
          functionName: 'getUserCreatedInvoiceCount',
          args: [accountAddress]
        }) as Promise<bigint>,
        client.readContract({
          address: chainC.invoicePayment,
          abi: invoiceAbi,
          functionName: 'getUserPendingInvoiceCount',
          args: [accountAddress]
        }) as Promise<bigint>
      ])
    : [0n, 0n];

  const [createdInvoiceIds, pendingInvoiceIds] = accountAddress
    ? await Promise.all([
        readInvoiceIds(
          client,
          'getUserCreatedInvoices',
          accountAddress,
          createdCount,
          chainC.invoicePayment
        ),
        readInvoiceIds(
          client,
          'getUserPendingInvoices',
          accountAddress,
          pendingCount,
          chainC.invoicePayment
        )
      ])
    : [[], []];

  const sourceMap = new Map<string, InvoiceSourceTag[]>();
  for (const invoiceId of createdInvoiceIds) {
    const key = invoiceId.toString();
    sourceMap.set(key, [...(sourceMap.get(key) ?? []), 'created']);
  }
  for (const invoiceId of pendingInvoiceIds) {
    const key = invoiceId.toString();
    sourceMap.set(key, [...(sourceMap.get(key) ?? []), 'pending']);
  }

  if (view) {
    const cachedSnapshot = await readCachedInvoiceSnapshot(client, chainC);
    const normalizedInvoices = cachedSnapshot.map((invoice) => ({
      ...invoice,
      sourceTags: sourceMap.get(invoice.id) ?? []
    }));
    const countsByView = {
      all: normalizedInvoices.length,
      created: normalizedInvoices.filter((invoice) => invoice.sourceTags.includes('created'))
        .length,
      received: normalizedInvoices.filter((invoice) => invoice.sourceTags.includes('pending'))
        .length
    } satisfies Record<InvoiceView, number>;

    return {
      chain: {
        chainId: chainC.chainId,
        rpcUrl: chainC.rpcUrl,
        apiUrl: chainC.apiUrl,
        authBaseUrl: chainC.authBaseUrl,
        invoicePayment: chainC.invoicePayment
      },
      accountAddress,
      adminAddress: ADMIN_ADDRESS,
      counts: {
        created: Number(createdCount),
        pending: Number(pendingCount),
        total: countsByView[view]
      },
      view,
      availableViews: [...INVOICE_VIEWS],
      countsByView,
      createdInvoiceIds: createdInvoiceIds.map((invoiceId) => invoiceId.toString()),
      pendingInvoiceIds: pendingInvoiceIds.map((invoiceId) => invoiceId.toString()),
      invoices: filterInvoicesByView(normalizedInvoices, view)
    } satisfies InvoiceResponseObject;
  }

  const orderedUniqueInvoiceIds = [...sourceMap.keys()].map((value) => BigInt(value));
  const invoices = await readInvoiceDetails(client, orderedUniqueInvoiceIds, chainC.invoicePayment);
  const invoicesById = new Map(invoices.map((invoice) => [invoice.id.toString(), invoice]));

  const normalizedInvoices = orderedUniqueInvoiceIds.map((invoiceId) => {
    const invoice = invoicesById.get(invoiceId.toString());
    if (!invoice) {
      throw new Error(`Missing invoice details for invoice ${invoiceId.toString()}`);
    }

    return normalizeInvoice(invoice, sourceMap.get(invoiceId.toString()) ?? []);
  });

  return {
    chain: {
      chainId: chainC.chainId,
      rpcUrl: chainC.rpcUrl,
      apiUrl: chainC.apiUrl,
      authBaseUrl: chainC.authBaseUrl,
      invoicePayment: chainC.invoicePayment
    },
    accountAddress,
    adminAddress: ADMIN_ADDRESS,
    counts: {
      created: Number(createdCount),
      pending: Number(pendingCount),
      total: normalizedInvoices.length
    },
    createdInvoiceIds: createdInvoiceIds.map((invoiceId) => invoiceId.toString()),
    pendingInvoiceIds: pendingInvoiceIds.map((invoiceId) => invoiceId.toString()),
    invoices: normalizedInvoices
  } satisfies InvoiceResponseObject;
}

async function fetchInvoicePaymentOptions(
  invoiceId: bigint
): Promise<InvoicePaymentOptionsResponseObject> {
  const chainC = loadChainCContext();
  const token = await getAdminAuthToken(chainC);
  const client = createChainCClient(chainC, token);

  let invoice: RawInvoice;
  try {
    invoice = (await client.readContract({
      address: chainC.invoicePayment,
      abi: invoiceAbi,
      functionName: 'getInvoiceDetails',
      args: [invoiceId]
    })) as unknown as RawInvoice;
  } catch (error) {
    throw new Error(
      `Invoice ${invoiceId.toString()} does not exist on chain C. ${error instanceof Error ? error.message : String(error)}`
    );
  }

  const status = normalizeInvoiceStatusCode(Number(invoice.status));
  if (status !== 'Created') {
    throw new Error(`Invoice ${invoiceId.toString()} is ${status} and cannot be paid.`);
  }

  const [whitelistRows, invoicePaymentBillingTokenBalance] = await Promise.all([
    client.readContract({
      address: chainC.invoicePayment,
      abi: invoiceAbi,
      functionName: 'getWhitelistedTokens'
    }) as Promise<readonly [readonly Address[], readonly string[]]>,
    client.readContract({
      address: invoice.billingToken,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [chainC.invoicePayment]
    }) as Promise<bigint>
  ]);

  const [whitelistedTokenAddresses, whitelistedSymbols] = whitelistRows;
  const billingTokenSymbol =
    resolveConfiguredTokenSymbol(chainC, invoice.billingToken) ??
    whitelistedSymbols.find(
      (_, index) =>
        whitelistedTokenAddresses[index] &&
        whitelistedTokenAddresses[index].toLowerCase() === invoice.billingToken.toLowerCase()
    ) ??
    'TOKEN';

  const options: PaymentOption[] = [];

  for (let index = 0; index < whitelistedTokenAddresses.length; index += 1) {
    const rawCandidateToken = whitelistedTokenAddresses[index];
    if (!rawCandidateToken) {
      continue;
    }
    const candidateToken = getAddress(rawCandidateToken);
    const configuredSymbol = resolveConfiguredTokenSymbol(chainC, candidateToken);
    const fallbackSymbol = whitelistedSymbols[index] ?? 'TOKEN';
    const symbol = configuredSymbol ?? fallbackSymbol;
    const isBillingToken = candidateToken.toLowerCase() === invoice.billingToken.toLowerCase();

    if (isBillingToken) {
      options.push({
        token: candidateToken,
        symbol,
        paymentAmount: invoice.amount.toString(),
        isBillingToken: true
      });
      continue;
    }

    try {
      const paymentAmount = (await client.readContract({
        address: chainC.invoicePayment,
        abi: invoiceAbi,
        functionName: 'getConversionAmount',
        args: [invoice.billingToken, candidateToken, invoice.amount]
      })) as bigint;

      options.push({
        token: candidateToken,
        symbol,
        paymentAmount: paymentAmount.toString(),
        isBillingToken: false
      });
    } catch (error) {
      console.warn(
        `Skipping unquoteable payment token ${candidateToken} for invoice ${invoiceId.toString()}:`,
        error
      );
    }
  }

  return {
    invoiceId: invoice.id.toString(),
    status,
    billingToken: getAddress(invoice.billingToken),
    billingTokenSymbol,
    billingAmount: invoice.amount.toString(),
    options,
    quoteType: 'exact',
    invoicePaymentBillingTokenBalance: invoicePaymentBillingTokenBalance.toString(),
    hasSufficientBillingLiquidity: invoicePaymentBillingTokenBalance >= invoice.amount
  };
}

async function handleInvoices(_req: Request, res: Response) {
  let serviceResponse: ServiceResponse<unknown>;
  try {
    const requestedView = resolveRequestedView(_req);
    const accountAddress = resolveRequestedAccountAddress(_req, {
      defaultToAdmin: requestedView === undefined
    });
    const responseObject = await fetchInvoices(accountAddress, requestedView);
    serviceResponse = ServiceResponse.success('Fetched invoices', responseObject);
  } catch (error) {
    serviceResponse = ServiceResponse.failure(
      'Failed to fetch invoices',
      {
        error: error instanceof Error ? error.message : String(error)
      },
      StatusCodes.INTERNAL_SERVER_ERROR
    );
  }

  res.status(serviceResponse.statusCode).send(serviceResponse);
}

async function handleInvoicePaymentOptions(req: Request, res: Response) {
  let serviceResponse: ServiceResponse<unknown>;

  try {
    const invoiceIdRaw = req.params.invoiceId;
    const invoiceIdParam =
      typeof invoiceIdRaw === 'string'
        ? invoiceIdRaw.trim()
        : Array.isArray(invoiceIdRaw)
          ? invoiceIdRaw[0]?.trim()
          : undefined;
    if (!invoiceIdParam || !/^\d+$/.test(invoiceIdParam)) {
      throw new Error('Invoice ID must be a positive integer.');
    }

    const responseObject = await fetchInvoicePaymentOptions(BigInt(invoiceIdParam));
    serviceResponse = ServiceResponse.success('Fetched invoice payment options', responseObject);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Failed to fetch invoice payment options';
    const notFound = /\bdoes not exist\b/i.test(message);
    const conflict = /\bcannot be paid\b/i.test(message);

    serviceResponse = ServiceResponse.failure(
      'Failed to fetch invoice payment options',
      { error: message },
      notFound
        ? StatusCodes.NOT_FOUND
        : conflict
          ? StatusCodes.CONFLICT
          : StatusCodes.INTERNAL_SERVER_ERROR
    );
  }

  res.status(serviceResponse.statusCode).send(serviceResponse);
}

invoicesRouter.get('/:invoiceId/payment-options', handleInvoicePaymentOptions);
invoicesRouter.get('/', handleInvoices);
invoicesRouter.post('/', handleInvoices);
