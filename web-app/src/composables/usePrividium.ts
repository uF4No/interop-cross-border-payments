import { type PrividiumChain, type UserProfile, createPrividiumChain } from 'prividium';
import { computed, ref } from 'vue';
import { STORAGE_KEY_ACCOUNT, STORAGE_KEY_PASSKEY } from '../utils/sso/constants';

export type PrividiumChainKey = 'A' | 'B';

type ChainEnvConfig = {
  chainKey: PrividiumChainKey;
  chainId: number;
  chainName: string;
  apiUrl: string;
  rpcUrl: string;
  authBaseUrl: string;
  clientId: string;
  nativeCurrencySymbol: string;
  companyName: string;
  accentColor: string;
  companyIcon: string;
};

const DEFAULT_CHAIN_KEY: PrividiumChainKey = 'A';
const SELECTED_CHAIN_STORAGE_KEY = 'prividium.selectedChainKey';
const env = import.meta.env as Record<string, string | undefined>;

const stripApiSuffix = (url?: string) => {
  const base = url?.replace(/\/$/, '');
  if (!base) return undefined;
  return base.endsWith('/api') ? base.slice(0, -4) : base;
};

const readEnv = (key: string) => env[key]?.trim() || undefined;
const readFirstDefined = (...keys: string[]) => {
  for (const key of keys) {
    const value = readEnv(key);
    if (value) return value;
  }
  return undefined;
};

const readStoredChainKey = (): PrividiumChainKey => {
  if (typeof window === 'undefined') return DEFAULT_CHAIN_KEY;
  const raw = window.localStorage.getItem(SELECTED_CHAIN_STORAGE_KEY);
  return raw === 'B' ? 'B' : 'A';
};

const readChainEnv = (chainKey: PrividiumChainKey): ChainEnvConfig => {
  const suffix = chainKey;

  const chainIdRaw = readFirstDefined(
    `VITE_PRIVIDIUM_CHAIN_${suffix}_ID`,
    `VITE_CHAIN_${suffix}_CHAIN_ID`,
    'VITE_PRIVIDIUM_CHAIN_ID'
  );
  const chainName = readFirstDefined(
    `VITE_PRIVIDIUM_CHAIN_${suffix}_NAME`,
    `VITE_CHAIN_${suffix}_CHAIN_NAME`,
    'VITE_PRIVIDIUM_CHAIN_NAME',
    `Chain ${suffix}`
  );
  const apiUrl = readFirstDefined(
    `VITE_PRIVIDIUM_CHAIN_${suffix}_API_URL`,
    `VITE_CHAIN_${suffix}_API_URL`,
    'VITE_PRIVIDIUM_API_URL'
  );
  const rpcUrl = readFirstDefined(
    `VITE_PRIVIDIUM_CHAIN_${suffix}_RPC_URL`,
    `VITE_CHAIN_${suffix}_RPC_URL`,
    'VITE_PRIVIDIUM_RPC_URL'
  );
  const authBaseUrl = readFirstDefined(
    `VITE_PRIVIDIUM_CHAIN_${suffix}_AUTH_BASE_URL`,
    `VITE_CHAIN_${suffix}_AUTH_BASE_URL`,
    'VITE_PRIVIDIUM_AUTH_BASE_URL'
  );
  const clientId = readFirstDefined(
    `VITE_PRIVIDIUM_CHAIN_${suffix}_CLIENT_ID`,
    `VITE_CLIENT_ID_CHAIN_${suffix}`,
    `VITE_CHAIN_${suffix}_CLIENT_ID`,
    'VITE_CLIENT_ID'
  );
  const nativeCurrencySymbol =
    readFirstDefined(
      `VITE_PRIVIDIUM_CHAIN_${suffix}_NATIVE_CURRENCY_SYMBOL`,
      `VITE_CHAIN_${suffix}_NATIVE_CURRENCY_SYMBOL`,
      'VITE_PRIVIDIUM_NATIVE_CURRENCY_SYMBOL',
      'ETH'
    );
  const companyName = readFirstDefined(
    `VITE_PRIVIDIUM_CHAIN_${suffix}_COMPANY_NAME`,
    `VITE_CHAIN_${suffix}_COMPANY_NAME`,
    `VITE_COMPANY_${suffix}_NAME`,
    'VITE_COMPANY_NAME',
    'Prividium™'
  ) ?? 'Prividium™';
  const accentColor = readFirstDefined(
    `VITE_PRIVIDIUM_CHAIN_${suffix}_ACCENT_COLOR`,
    `VITE_CHAIN_${suffix}_ACCENT_COLOR`,
    `VITE_ACCENT_${suffix}_COLOR`,
    'VITE_ACCENT_COLOR',
    '#2563eb'
  ) ?? '#2563eb';
  const companyIcon = readFirstDefined(
    `VITE_PRIVIDIUM_CHAIN_${suffix}_COMPANY_ICON`,
    `VITE_CHAIN_${suffix}_COMPANY_ICON`,
    `VITE_COMPANY_${suffix}_ICON`,
    'VITE_COMPANY_ICON',
    'CubeIcon'
  ) ?? 'CubeIcon';

  if (!chainIdRaw || !chainName || !apiUrl || !rpcUrl || !authBaseUrl || !clientId || !nativeCurrencySymbol) {
    throw new Error(
      `Missing Prividium env for chain ${chainKey}. Set the chain-specific VITE_PRIVIDIUM_CHAIN_${suffix}_* vars or the legacy single-chain fallbacks.`
    );
  }

  const chainId = Number.parseInt(chainIdRaw, 10);
  if (Number.isNaN(chainId)) {
    throw new Error(`Invalid chain id for chain ${chainKey}: ${chainIdRaw}`);
  }

  return {
    chainKey,
    chainId,
    chainName,
    apiUrl,
    rpcUrl,
    authBaseUrl,
    clientId,
    nativeCurrencySymbol,
    companyName,
    accentColor,
    companyIcon
  };
};

const buildSdkChain = (config: ChainEnvConfig) =>
  ({
    id: config.chainId,
    name: config.chainName,
    rpcUrls: {
      default: {
        http: [config.rpcUrl]
      },
      public: {
        http: [config.rpcUrl]
      }
    },
    nativeCurrency: {
      name: config.nativeCurrencySymbol,
      symbol: config.nativeCurrencySymbol,
      decimals: 18
    },
    blockExplorers: {
      default: {
        name: 'Explorer',
        url: 'https://explorer.zksync.io/'
      }
    }
  }) as const;

let prividiumInstance: PrividiumChain | null = null;
let prividiumInstanceChainKey: PrividiumChainKey | null = null;
let allowStoredSessionBootstrap = true;
let sessionGeneration = 0;

type AppUserProfile = UserProfile & {
  userId: string;
  walletAddresses: string[];
};

const selectedChainKey = ref<PrividiumChainKey>(readStoredChainKey());
const isAuthenticated = ref(false);
const isAuthenticating = ref(false);
const userProfile = ref<AppUserProfile | null>(null);
const authError = ref<string | null>(null);

const looksLikeAddress = (value: unknown): value is string =>
  typeof value === 'string' && /^0x[a-fA-F0-9]{40}$/.test(value.trim());

function mapWalletAddresses(wallets: unknown[]): string[] {
  return wallets
    .map((wallet) => {
      if (typeof wallet === 'string') {
        return looksLikeAddress(wallet) ? wallet : null;
      }
      if (
        wallet &&
        typeof wallet === 'object' &&
        'walletAddress' in wallet &&
        typeof (wallet as { walletAddress?: unknown }).walletAddress === 'string'
      ) {
        return (wallet as { walletAddress: string }).walletAddress;
      }
      if (
        wallet &&
        typeof wallet === 'object' &&
        'address' in wallet &&
        typeof (wallet as { address?: unknown }).address === 'string'
      ) {
        return (wallet as { address: string }).address;
      }
      if (
        wallet &&
        typeof wallet === 'object' &&
        'accountAddress' in wallet &&
        typeof (wallet as { accountAddress?: unknown }).accountAddress === 'string'
      ) {
        return (wallet as { accountAddress: string }).accountAddress;
      }
      if (wallet && typeof wallet === 'object') {
        const candidateKeys = ['wallet', 'value', 'id', 'addressHex'] as const;
        for (const key of candidateKeys) {
          const candidate = (wallet as Record<string, unknown>)[key];
          if (looksLikeAddress(candidate)) {
            return candidate;
          }
        }

        for (const candidate of Object.values(wallet as Record<string, unknown>)) {
          if (looksLikeAddress(candidate)) {
            return candidate;
          }
        }
      }
      return null;
    })
    .filter((walletAddress): walletAddress is string => walletAddress !== null);
}

function toAppUserProfile(profile: UserProfile): AppUserProfile {
  const profileLike = profile as UserProfile & {
    walletAddresses?: unknown;
    wallets?: unknown[];
  };
  const walletAddressesFromField = Array.isArray(profileLike.walletAddresses)
    ? profileLike.walletAddresses.filter((entry): entry is string => typeof entry === 'string')
    : [];
  const walletAddressesFromWallets = Array.isArray(profileLike.wallets)
    ? mapWalletAddresses(profileLike.wallets)
    : [];
  const dedupedWallets = [...walletAddressesFromField, ...walletAddressesFromWallets].filter(
    (address, index, all) =>
      all.findIndex((candidate) => candidate.toLowerCase() === address.toLowerCase()) === index
  );

  return {
    ...profile,
    userId: profile.id,
    walletAddresses: dedupedWallets
  };
}

function clearRuntimeState(options?: { clearAuthStorage?: boolean }) {
  sessionGeneration += 1;
  isAuthenticated.value = false;
  isAuthenticating.value = false;
  userProfile.value = null;
  authError.value = null;

  if (options?.clearAuthStorage && prividiumInstance) {
    try {
      prividiumInstance.unauthorize();
    } catch (error) {
      console.warn('Failed to clear Prividium auth state during chain change:', error);
    }
  }
}

function clearClientStorage() {
  if (typeof window === 'undefined') return;

  const exactKeys = [STORAGE_KEY_PASSKEY, STORAGE_KEY_ACCOUNT, SELECTED_CHAIN_STORAGE_KEY];
  for (const key of exactKeys) {
    window.localStorage.removeItem(key);
    window.sessionStorage.removeItem(key);
  }

  const fuzzyMarkers = ['prividium', 'oauth', 'oidc', 'pkce', 'wagmi', 'zksync_sso'];
  const clearByMarker = (storage: Storage) => {
    const keysToRemove: string[] = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (!key) continue;
      const normalized = key.toLowerCase();
      if (fuzzyMarkers.some((marker) => normalized.includes(marker))) {
        keysToRemove.push(key);
      }
    }
    for (const key of keysToRemove) {
      storage.removeItem(key);
    }
  };

  clearByMarker(window.localStorage);
  clearByMarker(window.sessionStorage);
}

function disposePrividiumInstance(options?: { clearAuthStorage?: boolean }) {
  clearRuntimeState(options);
  prividiumInstance = null;
  prividiumInstanceChainKey = null;
}

function buildPrividiumInstance(chainConfig: ChainEnvConfig) {
  return createPrividiumChain({
    clientId: chainConfig.clientId,
    chain: buildSdkChain(chainConfig),
    authBaseUrl: chainConfig.authBaseUrl,
    redirectUrl: `${window.location.origin}/auth-callback.html`,
    prividiumApiBaseUrl: stripApiSuffix(chainConfig.apiUrl) ?? '',
    onAuthExpiry: () => {
      console.log('Authentication expired');
      clearRuntimeState();
    }
  });
}

function initializePrividium(): PrividiumChain {
  const chainKey = selectedChainKey.value;
  if (!prividiumInstance || prividiumInstanceChainKey !== chainKey) {
    if (prividiumInstance && prividiumInstanceChainKey !== chainKey) {
      disposePrividiumInstance({ clearAuthStorage: true });
      allowStoredSessionBootstrap = false;
    }

    const chainConfig = readChainEnv(chainKey);
    prividiumInstance = buildPrividiumInstance(chainConfig);
    prividiumInstanceChainKey = chainKey;

    if (allowStoredSessionBootstrap) {
      isAuthenticated.value = prividiumInstance.isAuthorized();
      if (isAuthenticated.value) {
        void loadUserProfile(sessionGeneration);
      }
    } else {
      isAuthenticated.value = false;
    }

    allowStoredSessionBootstrap = true;
  }

  // Keep auth state aligned with SDK even when instance is reused.
  isAuthenticated.value = prividiumInstance.isAuthorized();

  return prividiumInstance;
}

async function loadUserProfile(requestGeneration = sessionGeneration) {
  const prividium = initializePrividium();
  const chainConfig = readChainEnv(selectedChainKey.value);

  try {
    const sdkProfile = await prividium.fetchUser();
    if (requestGeneration !== sessionGeneration) return null;
    console.debug('[prividium] fetchUser result', sdkProfile);
    userProfile.value = toAppUserProfile(sdkProfile);
    return userProfile.value;
  } catch (error) {
    if (requestGeneration !== sessionGeneration) return null;
    console.error('Failed to fetch user profile via SDK:', error);
  }

  const headers = prividium.getAuthHeaders();
  if (!headers) {
    if (requestGeneration === sessionGeneration) {
      userProfile.value = null;
    }
    return null;
  }

  const apiBaseUrl = chainConfig.apiUrl.replace(/\/$/, '');
  const candidates = apiBaseUrl ? [`${apiBaseUrl}/profiles/me`] : [];

  for (const url of candidates) {
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...headers
        }
      });
      if (!response.ok) {
        continue;
      }
      const data = (await response.json()) as {
        walletAddresses?: string[];
        wallets?: unknown[];
        userId?: string;
        id?: string;
        user?: { id?: string };
        profileId?: string;
        createdAt: string;
        updatedAt: string;
        displayName?: string;
        roles?: unknown[];
      };
      if (requestGeneration !== sessionGeneration) return null;
      console.debug('[prividium] /profiles/me response', data);
      const walletAddresses = Array.isArray(data.walletAddresses)
        ? data.walletAddresses.filter((entry): entry is string => looksLikeAddress(entry))
        : [];
      const walletAddressesFromWallets = Array.isArray(data.wallets)
        ? mapWalletAddresses(data.wallets)
        : [];
      const mergedWalletAddresses = [...walletAddresses, ...walletAddressesFromWallets].filter(
        (address, index, all) =>
          all.findIndex((candidate) => candidate.toLowerCase() === address.toLowerCase()) === index
      );
      const userId = data.userId ?? data.id ?? data.user?.id ?? data.profileId ?? null;
      if (!userId) {
        throw new Error('User profile missing id');
      }
      const roles = Array.isArray(data.roles)
        ? data.roles
            .map((role) => {
              if (typeof role === 'string') {
                return { roleName: role };
              }
              if (
                role &&
                typeof role === 'object' &&
                'roleName' in role &&
                typeof (role as { roleName?: unknown }).roleName === 'string'
              ) {
                return { roleName: (role as { roleName: string }).roleName };
              }
              return null;
            })
            .filter((role): role is { roleName: string } => role !== null)
        : [];
      userProfile.value = {
        id: userId,
        userId,
        createdAt: new Date(data.createdAt),
        displayName: data.displayName ?? null,
        updatedAt: new Date(data.updatedAt),
        roles,
        wallets: mergedWalletAddresses,
        walletAddresses: mergedWalletAddresses
      };
      return userProfile.value;
    } catch (fallbackError) {
      if (requestGeneration !== sessionGeneration) return null;
      console.warn('Fallback profile fetch failed:', fallbackError);
    }
  }

  if (requestGeneration === sessionGeneration) {
    userProfile.value = null;
  }
  return null;
}

function setSelectedChainKey(chainKey: PrividiumChainKey) {
  if (selectedChainKey.value === chainKey) {
    return;
  }

  if (typeof window !== 'undefined') {
    window.localStorage.setItem(SELECTED_CHAIN_STORAGE_KEY, chainKey);
  }

  disposePrividiumInstance({ clearAuthStorage: true });
  selectedChainKey.value = chainKey;
  allowStoredSessionBootstrap = false;
}

const prividiumFacade = {
  get chain() {
    return initializePrividium().chain;
  },
  get transport() {
    return initializePrividium().transport;
  },
  isAuthorized() {
    return initializePrividium().isAuthorized();
  },
  authorize() {
    return initializePrividium().authorize();
  },
  unauthorize() {
    return initializePrividium().unauthorize();
  },
  getAuthHeaders() {
    return initializePrividium().getAuthHeaders();
  },
  authorizeTransaction(params: {
    walletAddress: `0x${string}`;
    toAddress: `0x${string}`;
    nonce: number;
    calldata: `0x${string}`;
  }) {
    return initializePrividium().authorizeTransaction(params);
  },
  addNetworkToWallet() {
    return initializePrividium().addNetworkToWallet();
  },
  getWalletToken() {
    return initializePrividium().getWalletToken();
  },
  getWalletRpcUrl() {
    return initializePrividium().getWalletRpcUrl();
  }
} as const;

export function usePrividium() {
  initializePrividium();

  const userEmail = computed(() => userProfile.value?.displayName || userProfile.value?.userId || null);
  const userName = computed(() => userProfile.value?.displayName || 'User');
  const userRoles = computed(() => userProfile.value?.roles || []);
  const userWallets = computed(() => userProfile.value?.walletAddresses || []);

  async function authenticate() {
    const requestGeneration = sessionGeneration;
    const activeChainKey = selectedChainKey.value;
    isAuthenticating.value = true;
    authError.value = null;

    try {
      const activePrividium = initializePrividium();
      await activePrividium.authorize();

      if (requestGeneration !== sessionGeneration || activeChainKey !== selectedChainKey.value) {
        return false;
      }

      isAuthenticated.value = true;
      await loadUserProfile(requestGeneration);

      return true;
    } catch (error) {
      if (requestGeneration !== sessionGeneration || activeChainKey !== selectedChainKey.value) {
        return false;
      }
      console.error('Authentication failed:', error);
      authError.value = error instanceof Error ? error.message : 'Authentication failed';
      isAuthenticated.value = false;
      return false;
    } finally {
      if (requestGeneration === sessionGeneration) {
        isAuthenticating.value = false;
      }
    }
  }

  function signOut() {
    for (const chainKey of ['A', 'B'] as const) {
      try {
        buildPrividiumInstance(readChainEnv(chainKey)).unauthorize();
      } catch (error) {
        console.warn(`Failed to clear auth state for chain ${chainKey}`, error);
      }
    }

    clearClientStorage();
    disposePrividiumInstance({ clearAuthStorage: true });
    selectedChainKey.value = DEFAULT_CHAIN_KEY;
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(SELECTED_CHAIN_STORAGE_KEY);
    }
    allowStoredSessionBootstrap = false;
    authError.value = null;
  }

  function getAuthHeaders() {
    return initializePrividium().getAuthHeaders();
  }

  async function refreshUserProfile() {
    return loadUserProfile(sessionGeneration);
  }

  function getTransport() {
    return initializePrividium().transport;
  }

  function getChain() {
    return initializePrividium().chain;
  }

  async function enableWalletToken(params: {
    walletAddress: `0x${string}`;
    contractAddress: `0x${string}`;
    nonce: number;
    calldata: `0x${string}`;
  }) {
    return initializePrividium().authorizeTransaction({
      walletAddress: params.walletAddress,
      toAddress: params.contractAddress,
      nonce: params.nonce,
      calldata: params.calldata
    });
  }

  async function addNetworkToWallet() {
    return initializePrividium().addNetworkToWallet();
  }

  async function getWalletToken() {
    return initializePrividium().getWalletToken();
  }

  async function getWalletRpcUrl() {
    return initializePrividium().getWalletRpcUrl();
  }

  return {
    isAuthenticated: computed(() => isAuthenticated.value),
    isAuthenticating: computed(() => isAuthenticating.value),
    selectedChainKey: computed(() => selectedChainKey.value),
    branding: computed(() => {
      const chainConfig = readChainEnv(selectedChainKey.value);
      return {
        companyName: chainConfig.companyName,
        accentColor: chainConfig.accentColor,
        companyIcon: chainConfig.companyIcon
      };
    }),
    setSelectedChainKey,
    userEmail,
    userName,
    userRoles,
    userWallets,
    authError: computed(() => authError.value),
    userProfile: computed(() => userProfile.value),

    authenticate,
    signOut,
    getAuthHeaders,
    refreshUserProfile,
    getTransport,
    getChain,
    enableWalletToken,
    addNetworkToWallet,
    getWalletToken,
    getWalletRpcUrl,

    prividium: prividiumFacade
  };
}
