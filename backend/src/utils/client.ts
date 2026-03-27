import { createViemClient } from '@matterlabs/zksync-js/viem/client';
import { createViemSdk } from '@matterlabs/zksync-js/viem/sdk';
import { createPublicClient, createWalletClient, defineChain, http, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';

import { getChainDeploymentById, loadContractsConfig } from './contractsConfig';
import { L1_RPC_URL, L2_CHAIN_ID, L2_RPC_URL, l2Chain } from './constants';
import { env } from './envConfig';

const EXECUTOR_PRIVATE_KEY = env.EXECUTOR_PRIVATE_KEY as `0x${string}`;
const AUTH_COOLDOWN_MS = 30000;
const TOKEN_EXPIRY_BUFFER_MS = 30000;
const DEFAULT_AUTH_BASE_URL = 'http://localhost:3001';

type ChainScopedRuntime = {
  chainId: number;
  rpcUrl: string;
  apiUrl: string;
  authBaseUrl?: string;
  name: string;
};

type AuthState = {
  token: string | null;
  tokenExpiry: number;
  authInFlight: Promise<string> | null;
  authCooldownUntil: number;
};

type ChainScopedClients = {
  runtime: ChainScopedRuntime;
  client: ReturnType<typeof createViemClient>;
  sdk: ReturnType<typeof createViemSdk>;
};

const contractsConfig = loadContractsConfig();

if (!EXECUTOR_PRIVATE_KEY) {
  console.error('❌ EXECUTOR_PRIVATE_KEY not found in .env file');
  process.exit(1);
}

export const executorAccount = privateKeyToAccount(EXECUTOR_PRIVATE_KEY);

const l1 = createPublicClient({
  chain: sepolia,
  transport: http(L1_RPC_URL)
});

export const l1Wallet = createWalletClient({
  account: executorAccount,
  chain: sepolia,
  transport: http(L1_RPC_URL)
});

const authStateByKey = new Map<string, AuthState>();
const chainScopedClientsByChainId = new Map<number, ChainScopedClients>();

function getAuthState(cacheKey: string): AuthState {
  const existing = authStateByKey.get(cacheKey);
  if (existing) {
    return existing;
  }

  const initialState: AuthState = {
    token: null,
    tokenExpiry: 0,
    authInFlight: null,
    authCooldownUntil: 0
  };
  authStateByKey.set(cacheKey, initialState);
  return initialState;
}

function resolveConfiguredRuntime(chainId: number): ChainScopedRuntime | null {
  const configured = getChainDeploymentById(contractsConfig, chainId);
  if (configured?.deployment.rpcUrl && configured.deployment.apiUrl) {
    return {
      chainId,
      rpcUrl: configured.deployment.rpcUrl,
      apiUrl: configured.deployment.apiUrl,
      authBaseUrl: configured.deployment.authBaseUrl,
      name: `Prividium Chain ${configured.key.toUpperCase()}`
    };
  }

  const chainEnvCandidates = [
    {
      ids: [env.CHAIN_A_CHAIN_ID, env.PRIVIDIUM_CHAIN_A_ID],
      rpcUrl: env.CHAIN_A_RPC_URL,
      apiUrl: env.CHAIN_A_API_URL,
      authBaseUrl: env.CHAIN_A_AUTH_BASE_URL,
      name: 'Prividium Chain A'
    },
    {
      ids: [env.CHAIN_B_CHAIN_ID, env.PRIVIDIUM_CHAIN_B_ID],
      rpcUrl: env.CHAIN_B_RPC_URL,
      apiUrl: env.CHAIN_B_API_URL,
      authBaseUrl: env.CHAIN_B_AUTH_BASE_URL,
      name: 'Prividium Chain B'
    },
    {
      ids: [env.CHAIN_C_CHAIN_ID, env.PRIVIDIUM_CHAIN_C_ID],
      rpcUrl: env.CHAIN_C_RPC_URL,
      apiUrl: env.CHAIN_C_API_URL,
      authBaseUrl: env.CHAIN_C_AUTH_BASE_URL,
      name: 'Prividium Chain C'
    }
  ];

  for (const candidate of chainEnvCandidates) {
    if (
      candidate.ids.some((candidateId) => candidateId === chainId) &&
      candidate.rpcUrl &&
      candidate.apiUrl
    ) {
      return {
        chainId,
        rpcUrl: candidate.rpcUrl,
        apiUrl: candidate.apiUrl,
        authBaseUrl: candidate.authBaseUrl,
        name: candidate.name
      };
    }
  }

  if (chainId === L2_CHAIN_ID || chainId === env.PRIVIDIUM_CHAIN_ID) {
    return {
      chainId,
      rpcUrl: L2_RPC_URL,
      apiUrl: env.PRIVIDIUM_API_URL,
      authBaseUrl: env.PRIVIDIUM_AUTH_BASE_URL,
      name: 'Prividium L2'
    };
  }

  return null;
}

function resolveChainRuntime(chainId: number): ChainScopedRuntime {
  const runtime = resolveConfiguredRuntime(chainId);
  if (!runtime) {
    throw new Error(`No chain-scoped backend runtime configured for source chain ${chainId}.`);
  }

  return runtime;
}

function buildApiUrl(baseUrl: string, path: string) {
  return `${baseUrl.replace(/\/+$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
}

async function getAuthTokenForRuntime(runtime: ChainScopedRuntime): Promise<string> {
  const cacheKey = `${runtime.chainId}:${runtime.apiUrl}`;
  const state = getAuthState(cacheKey);

  if (state.authInFlight) {
    return state.authInFlight;
  }
  if (Date.now() < state.authCooldownUntil) {
    throw new Error(`Auth is in cooldown for chain ${runtime.chainId}. Retry shortly.`);
  }
  if (state.token && Date.now() < state.tokenExpiry - TOKEN_EXPIRY_BUFFER_MS) {
    return state.token;
  }

  const run = async () => {
    try {
      console.log(`🔄 Authenticating with Prividium for chain ${runtime.chainId}...`);

      const authBaseUrl = runtime.authBaseUrl || env.PRIVIDIUM_AUTH_BASE_URL || env.CORS_ORIGIN || DEFAULT_AUTH_BASE_URL;
      const authUrl = new URL(authBaseUrl);
      const siweDomain = env.SIWE_DOMAIN || authUrl.host;
      const siweUri = env.SIWE_URI || authUrl.origin;

      const postJson = (url: string, body: Record<string, unknown>) =>
        fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });

      const challengeUrl = buildApiUrl(runtime.apiUrl, env.SIWE_CHALLENGE_PATH);
      const challengeRes = await postJson(challengeUrl, {
        address: executorAccount.address,
        domain: siweDomain
      });

      if (!challengeRes.ok) {
        const errorText = await challengeRes.text().catch(() => '');
        if (challengeRes.status === 429) {
          const retryAfter = Number(challengeRes.headers.get('retry-after'));
          const cooldownMs =
            Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : AUTH_COOLDOWN_MS;
          state.authCooldownUntil = Date.now() + cooldownMs;
        }
        throw new Error(
          `Failed to get challenge for chain ${runtime.chainId}: ${challengeRes.status} ${challengeRes.statusText} ${errorText}`
        );
      }

      const challengeJson = await challengeRes.json();
      const message = challengeJson?.message || challengeJson?.msg;
      if (!message) {
        throw new Error(
          `SIWE challenge missing message field for chain ${runtime.chainId}. Response: ${JSON.stringify(challengeJson)}`
        );
      }

      const signature = await executorAccount.signMessage({ message });

      const loginUrl = buildApiUrl(runtime.apiUrl, env.SIWE_LOGIN_PATH);
      const loginRes = await postJson(loginUrl, { message, signature });

      if (!loginRes.ok) {
        const errorText = await loginRes.text().catch(() => '');
        throw new Error(
          `Failed to login for chain ${runtime.chainId}: ${loginRes.status} ${loginRes.statusText} ${errorText}`
        );
      }

      const { token, expiresAt } = await loginRes.json();
      state.token = token;
      state.tokenExpiry = expiresAt ? Date.parse(expiresAt) : Date.now() + 3600 * 1000;

      console.log(`✅ Authenticated for chain ${runtime.chainId}`);
      return token as string;
    } catch (error) {
      console.error(`Auth failed for chain ${runtime.chainId}:`, error);
      state.authCooldownUntil = Date.now() + AUTH_COOLDOWN_MS;
      throw error;
    } finally {
      state.authInFlight = null;
    }
  };

  state.authInFlight = run();
  return state.authInFlight;
}

function createAuthenticatedFetch(runtime: ChainScopedRuntime): typeof fetch {
  return async (url, init) => {
    const token = await getAuthTokenForRuntime(runtime);
    const headers = new Headers(init?.headers);
    headers.set('Authorization', `Bearer ${token}`);
    return fetch(url, { ...init, headers });
  };
}

function createChainScopedClients(runtime: ChainScopedRuntime): ChainScopedClients {
  const chain = defineChain({
    id: runtime.chainId,
    name: runtime.name,
    nativeCurrency: {
      name: 'Ether',
      symbol: 'ETH',
      decimals: 18
    },
    rpcUrls: {
      default: { http: [runtime.rpcUrl] },
      public: { http: [runtime.rpcUrl] }
    }
  });

  const authenticatedFetch = createAuthenticatedFetch(runtime);
  const l2 = createPublicClient({
    chain,
    transport: http(runtime.rpcUrl, {
      fetchFn: authenticatedFetch
    })
  });

  const l2Wallet = createWalletClient({
    account: executorAccount,
    transport: http(runtime.rpcUrl, {
      fetchFn: authenticatedFetch
    }),
    chain
  });

  const chainScopedClient = createViemClient({ l1, l2, l1Wallet, l2Wallet });
  const chainScopedSdk = createViemSdk(chainScopedClient);

  return {
    runtime,
    client: chainScopedClient,
    sdk: chainScopedSdk
  };
}

export function getChainScopedClients(sourceChainId: number): ChainScopedClients {
  const existing = chainScopedClientsByChainId.get(sourceChainId);
  if (existing) {
    return existing;
  }

  const runtime = resolveChainRuntime(sourceChainId);
  const created = createChainScopedClients(runtime);
  chainScopedClientsByChainId.set(sourceChainId, created);
  return created;
}

export async function getPrividiumAuthToken(): Promise<string> {
  return getAuthTokenForRuntime(resolveChainRuntime(L2_CHAIN_ID));
}

export async function getPrividiumAuthTokenForChain(sourceChainId: number): Promise<string> {
  return getAuthTokenForRuntime(resolveChainRuntime(sourceChainId));
}

const defaultChainScopedClients = getChainScopedClients(L2_CHAIN_ID);

export const client = defaultChainScopedClients.client;
export const sdk = defaultChainScopedClients.sdk;
export const l2Wallet = createWalletClient({
  account: executorAccount,
  transport: http(L2_RPC_URL, {
    fetchFn: createAuthenticatedFetch(resolveChainRuntime(L2_CHAIN_ID))
  }),
  chain: l2Chain
});

export function clearAuthTokenCacheForTests() {
  authStateByKey.clear();
  chainScopedClientsByChainId.clear();
}
