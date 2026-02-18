/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PRIVIDIUM_API_URL: string;
  readonly VITE_PRIVIDIUM_RPC_URL: string;
  readonly VITE_PRIVIDIUM_AUTH_BASE_URL: string;
  readonly VITE_PRIVIDIUM_CHAIN_ID: string;
  readonly VITE_PRIVIDIUM_CHAIN_NAME: string;
  readonly VITE_PRIVIDIUM_NATIVE_CURRENCY_SYMBOL: string;
  readonly VITE_BACKEND_URL: string;
  readonly VITE_CLIENT_ID: string;
  readonly VITE_COUNTER_CONTRACT_ADDRESS: string;
  readonly VITE_COMPANY_NAME: string;
  readonly VITE_ACCENT_COLOR: string;
  readonly VITE_COMPANY_ICON: string;
  readonly VITE_SSO_CHAIN_ID?: string;
  readonly VITE_SSO_CHAIN_NAME?: string;
  readonly VITE_SSO_WEBAUTHN_VALIDATOR?: string;
  readonly VITE_SSO_ENTRYPOINT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  ethereum?: {
    request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
    on?: (event: string, callback: (...args: unknown[]) => void) => void;
    removeListener?: (event: string, callback: (...args: unknown[]) => void) => void;
  };
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>;
  export default component;
}
