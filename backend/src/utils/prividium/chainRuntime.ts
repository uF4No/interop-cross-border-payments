import { http, type Address, createPublicClient, createWalletClient, defineChain } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import {
  type ChainDeployment,
  type ChainKey,
  type SsoContracts,
  loadContractsConfig
} from '../contractsConfig';
import { env } from '../envConfig';

export type SelectedChainKey = 'A' | 'B' | 'C';

export type ChainRuntime = {
  chainKey: SelectedChainKey;
  chainId: number;
  rpcUrl: string;
  apiUrl: string;
  authBaseUrl: string;
  interopCenter?: Address;
  nativeTokenVault?: Address;
  ssoContracts: SsoContracts;
  executorAccount: ReturnType<typeof privateKeyToAccount>;
  publicClient: ReturnType<typeof createPublicClient>;
  walletClient: ReturnType<typeof createWalletClient>;
  getAuthToken: () => Promise<string>;
};

type ChainAuthContext = {
  chainId: number;
  rpcUrl: string;
  apiUrl: string;
  authBaseUrl: string;
};

type AuthState = {
  token: string | null;
  tokenExpiry: number;
  inFlight: Promise<string> | null;
  cooldownUntil: number;
};

const AUTH_COOLDOWN_MS = 30000;
const authStateByChain = new Map<string, AuthState>();
const contractsConfig = loadContractsConfig();
const executorAccount = privateKeyToAccount(env.EXECUTOR_PRIVATE_KEY as `0x${string}`);

function toConfigChainKey(chainKey: SelectedChainKey): ChainKey {
  return chainKey.toLowerCase() as ChainKey;
}

function getAuthState(cacheKey: string): AuthState {
  let state = authStateByChain.get(cacheKey);
  if (!state) {
    state = {
      token: null,
      tokenExpiry: 0,
      inFlight: null,
      cooldownUntil: 0
    };
    authStateByChain.set(cacheKey, state);
  }
  return state;
}

function postJson(url: string, body: Record<string, unknown>) {
  return fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
}

async function getChainAuthToken(context: ChainAuthContext): Promise<string> {
  const cacheKey = `${context.chainId}:${context.apiUrl}`;
  const state = getAuthState(cacheKey);
  if (state.inFlight) {
    return state.inFlight;
  }
  if (Date.now() < state.cooldownUntil) {
    throw new Error('Auth is in cooldown after a failure. Retry shortly.');
  }
  if (state.token && Date.now() < state.tokenExpiry - 30000) {
    return state.token;
  }

  const run = async () => {
    try {
      const siweDomain = new URL(context.authBaseUrl).host;
      const baseCandidates = [context.apiUrl.replace(/\/+$/, '')];
      if (!baseCandidates[0].endsWith('/api')) {
        baseCandidates.push(`${baseCandidates[0]}/api`);
      }

      let lastError: unknown;
      for (const baseUrl of baseCandidates) {
        try {
          const challengeRes = await postJson(`${baseUrl}/siwe-messages/`, {
            address: executorAccount.address,
            domain: siweDomain
          });

          if (!challengeRes.ok) {
            const errorText = await challengeRes.text().catch(() => '');
            throw new Error(
              `Failed to request SIWE challenge from ${baseUrl}: ${challengeRes.status} ${challengeRes.statusText} ${errorText}`
            );
          }

          const challengeJson = (await challengeRes.json()) as { message?: string; msg?: string };
          const message = challengeJson.message ?? challengeJson.msg;
          if (!message) {
            throw new Error(`SIWE challenge from ${baseUrl} did not include a message`);
          }

          const signature = await executorAccount.signMessage({ message });
          const loginRes = await postJson(`${baseUrl}/auth/login/crypto-native`, {
            message,
            signature
          });

          if (!loginRes.ok) {
            const errorText = await loginRes.text().catch(() => '');
            throw new Error(
              `Failed to authenticate executor session against ${baseUrl}: ${loginRes.status} ${loginRes.statusText} ${errorText}`
            );
          }

          const loginJson = (await loginRes.json()) as { token?: string; expiresAt?: string };
          if (!loginJson.token) {
            throw new Error(`Executor login response from ${baseUrl} did not include a token`);
          }

          state.token = loginJson.token;
          state.tokenExpiry = loginJson.expiresAt
            ? Date.parse(loginJson.expiresAt)
            : Date.now() + 3600 * 1000;
          return state.token;
        } catch (error) {
          lastError = error;
        }
      }

      throw lastError instanceof Error
        ? lastError
        : new Error('Failed to authenticate executor session');
    } catch (error) {
      state.cooldownUntil = Date.now() + AUTH_COOLDOWN_MS;
      throw error;
    } finally {
      state.inFlight = null;
    }
  };

  state.inFlight = run();
  return state.inFlight;
}

function resolveChainDeployment(chainKey: SelectedChainKey): ChainDeployment {
  const deployment = contractsConfig?.chains?.[toConfigChainKey(chainKey)];
  if (!deployment) {
    throw new Error(`Missing contracts config for chain ${chainKey}`);
  }
  if (!deployment.chainId || !deployment.rpcUrl || !deployment.apiUrl || !deployment.authBaseUrl) {
    throw new Error(`Incomplete chain config for chain ${chainKey}`);
  }
  return deployment;
}

export function createChainRuntime(chainKey: SelectedChainKey): ChainRuntime {
  const deployment = resolveChainDeployment(chainKey);
  const chainId = Number(deployment.chainId);
  const rpcUrl = deployment.rpcUrl as string;
  const apiUrl = deployment.apiUrl as string;
  const authBaseUrl = deployment.authBaseUrl as string;
  const ssoContracts = deployment.sso ?? {};

  if (
    !ssoContracts.factory ||
    !ssoContracts.webauthnValidator ||
    !ssoContracts.entryPoint ||
    !ssoContracts.beacon ||
    !ssoContracts.accountImplementation
  ) {
    throw new Error(`Missing SSO contracts in config for chain ${chainKey}`);
  }

  const chain = defineChain({
    id: chainId,
    name: `Prividium Chain ${chainId}`,
    nativeCurrency: {
      name: 'Ether',
      symbol: 'ETH',
      decimals: 18
    },
    rpcUrls: {
      default: { http: [rpcUrl] },
      public: { http: [rpcUrl] }
    }
  });

  const fetchWithAuth: typeof fetch = async (url, init) => {
    const token = await getChainAuthToken({ chainId, rpcUrl, apiUrl, authBaseUrl });
    const headers = new Headers(init?.headers);
    headers.set('Authorization', `Bearer ${token}`);
    return fetch(url, { ...init, headers });
  };

  const transport = http(rpcUrl, { fetchFn: fetchWithAuth });

  return {
    chainKey,
    chainId,
    rpcUrl,
    apiUrl,
    authBaseUrl,
    interopCenter: deployment.interopCenter,
    nativeTokenVault: deployment.nativeTokenVault,
    ssoContracts,
    executorAccount,
    publicClient: createPublicClient({
      chain,
      transport
    }),
    walletClient: createWalletClient({
      account: executorAccount,
      chain,
      transport
    }),
    getAuthToken: () => getChainAuthToken({ chainId, rpcUrl, apiUrl, authBaseUrl })
  };
}
