import { defineChain } from 'viem';

// LocalStorage keys
export const STORAGE_KEY_PASSKEY = 'zksync_sso_passkey';
export const STORAGE_KEY_ACCOUNT = 'zksync_sso_account';
const SELECTED_CHAIN_STORAGE_KEY = 'prividium.selectedChainKey';
export type SsoChainKey = 'A' | 'B';
export type SsoContractsConfig = {
  webauthnValidator: `0x${string}`;
  entryPoint: `0x${string}`;
};

export const RP_ID = window.location.hostname;

export const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:4340';
export const DEPLOY_ACCOUNT_ENDPOINT = `${BACKEND_URL}/deploy-account`;

export const DEFAULT_ZKSYNC_OS_RPC_URL = 'https://zksync-os-testnet-alpha.zksync.dev/';
export const SSO_RPC_URL = import.meta.env.VITE_PRIVIDIUM_RPC_URL || DEFAULT_ZKSYNC_OS_RPC_URL;
const DEFAULT_WEBAUTHN_VALIDATOR = '0xD52c9b1bA249f877C8492F64c096E37a8072982A';
const DEFAULT_ENTRYPOINT = '0x38a024C0b412B9d1db8BC398140D00F5Af3093D4';

function readSelectedChainKey(): SsoChainKey {
  if (typeof window === 'undefined') return 'A';
  return window.localStorage.getItem(SELECTED_CHAIN_STORAGE_KEY) === 'B' ? 'B' : 'A';
}

function readFirstDefined(...keys: string[]) {
  for (const key of keys) {
    const value = import.meta.env[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

export function getSsoContracts(chainKey: SsoChainKey = readSelectedChainKey()): SsoContractsConfig {
  return {
    webauthnValidator: (readFirstDefined(
      `VITE_SSO_WEBAUTHN_VALIDATOR_CONTRACT_CHAIN_${chainKey}`,
      `VITE_SSO_WEBAUTHN_VALIDATOR_CHAIN_${chainKey}`,
      'VITE_SSO_WEBAUTHN_VALIDATOR'
    ) || DEFAULT_WEBAUTHN_VALIDATOR) as `0x${string}`,
    entryPoint: (readFirstDefined(
      `VITE_SSO_ENTRYPOINT_CONTRACT_CHAIN_${chainKey}`,
      `VITE_SSO_ENTRYPOINT_CHAIN_${chainKey}`,
      'VITE_SSO_ENTRYPOINT'
    ) || DEFAULT_ENTRYPOINT) as `0x${string}`
  };
}

const ssoChainId = Number(
  import.meta.env.VITE_SSO_CHAIN_ID || import.meta.env.VITE_PRIVIDIUM_CHAIN_ID || 8022833
);
const ssoChainName =
  import.meta.env.VITE_SSO_CHAIN_NAME || import.meta.env.VITE_PRIVIDIUM_CHAIN_NAME || 'ZKsync SSO';

// SSO chain configuration
export const ssoChain = defineChain({
  id: ssoChainId,
  name: ssoChainName,
  nativeCurrency: {
    name: 'Ether',
    symbol: 'ETH',
    decimals: 18
  },
  rpcUrls: {
    default: {
      http: [SSO_RPC_URL]
    },
    public: {
      http: [SSO_RPC_URL]
    }
  },
  blockExplorers: {
    default: {
      name: 'Explorer',
      // TODO: update with prividium explorer
      url: 'https://explorer.zksync.io/'
    }
  }
});

export const ssoContracts = {
  get webauthnValidator() {
    return getSsoContracts().webauthnValidator;
  },
  get entryPoint() {
    return getSsoContracts().entryPoint;
  }
} as const satisfies SsoContractsConfig;
