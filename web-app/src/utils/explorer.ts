const env = import.meta.env as Record<string, string | undefined>;

export type ExplorerChainKey = 'A' | 'B' | 'C';
export type ExplorerLinkKind = 'address' | 'tx' | 'token';

const LOCALHOST_HOSTNAMES = new Set(['localhost', '127.0.0.1']);

const readEnv = (key: string) => env[key]?.trim() || undefined;

const readFirstDefined = (...keys: Array<string | undefined>) => {
  for (const key of keys) {
    if (!key) continue;
    const value = readEnv(key);
    if (value) {
      return value;
    }
  }

  return undefined;
};

const sanitizeBaseUrl = (value?: string) => {
  if (!value) {
    return undefined;
  }

  return value.replace(/\/+$/u, '');
};

const inferLocalExplorerUrl = (chainKey: ExplorerChainKey) => {
  const authBaseUrl = readFirstDefined(
    `VITE_CHAIN_${chainKey}_AUTH_BASE_URL`,
    `VITE_PRIVIDIUM_CHAIN_${chainKey}_AUTH_BASE_URL`,
    chainKey === 'A' ? 'VITE_PRIVIDIUM_AUTH_BASE_URL' : undefined
  );

  if (!authBaseUrl) {
    return undefined;
  }

  try {
    const url = new URL(authBaseUrl);
    if (!LOCALHOST_HOSTNAMES.has(url.hostname) || !url.port.endsWith('01')) {
      return undefined;
    }

    url.port = `${url.port.slice(0, -2)}10`;
    url.pathname = '';
    url.search = '';
    url.hash = '';
    return sanitizeBaseUrl(url.toString());
  } catch {
    return undefined;
  }
};

const readChainId = (chainKey: ExplorerChainKey) => {
  const value = readFirstDefined(
    `VITE_CHAIN_${chainKey}_CHAIN_ID`,
    `VITE_PRIVIDIUM_CHAIN_${chainKey}_ID`,
    chainKey === 'A' ? 'VITE_PRIVIDIUM_CHAIN_ID' : undefined
  );

  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

export const isExplorerAddress = (value: string) => /^0x[a-fA-F0-9]{40}$/u.test(value.trim());

export const isExplorerTxHash = (value: string) => /^0x[a-fA-F0-9]{64}$/u.test(value.trim());

export const getExplorerBaseUrl = (chainKey: ExplorerChainKey) =>
  sanitizeBaseUrl(
    readFirstDefined(
      `VITE_CHAIN_${chainKey}_EXPLORER_URL`,
      `VITE_PRIVIDIUM_CHAIN_${chainKey}_EXPLORER_URL`,
      `VITE_EXPLORER_URL_CHAIN_${chainKey}`,
      chainKey === 'A' ? 'VITE_EXPLORER_URL' : undefined
    )
  ) ?? inferLocalExplorerUrl(chainKey);

export const getExplorerChainKeyForChainId = (chainId: number): ExplorerChainKey | undefined => {
  for (const chainKey of ['A', 'B', 'C'] as const) {
    if (readChainId(chainKey) === chainId) {
      return chainKey;
    }
  }

  return undefined;
};

export const buildExplorerUrl = (
  chainKey: ExplorerChainKey,
  kind: ExplorerLinkKind,
  value: string
) => {
  const baseUrl = getExplorerBaseUrl(chainKey);
  if (!baseUrl) {
    return undefined;
  }

  const normalizedValue = value.trim();
  if (kind === 'address' && !isExplorerAddress(normalizedValue)) {
    return undefined;
  }
  if (kind === 'tx' && !isExplorerTxHash(normalizedValue)) {
    return undefined;
  }
  if (kind === 'token' && !isExplorerAddress(normalizedValue)) {
    return undefined;
  }

  const path = kind === 'tx' ? 'tx' : kind;
  return `${baseUrl}/${path}/${normalizedValue}`;
};

export const buildExplorerAddressUrl = (chainKey: ExplorerChainKey, address: string) =>
  buildExplorerUrl(chainKey, 'address', address);

export const buildExplorerTokenUrl = (chainKey: ExplorerChainKey, address: string) =>
  buildExplorerUrl(chainKey, 'token', address);

export const buildExplorerTxUrl = (chainKey: ExplorerChainKey, hash: string) =>
  buildExplorerUrl(chainKey, 'tx', hash);
