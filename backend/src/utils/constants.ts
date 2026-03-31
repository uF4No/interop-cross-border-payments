import { join } from 'node:path';
import { defineChain } from 'viem';

import {
  type ContractsConfig,
  getPreferredChainDeployment,
  loadContractsConfig,
  warnIfMismatch
} from './contractsConfig';
import { env } from './envConfig';

const contractsConfig = loadContractsConfig();
const activeChainDeployment = getPreferredChainDeployment(contractsConfig, env.PRIVIDIUM_CHAIN_ID);
const configSso = activeChainDeployment?.deployment.sso ?? contractsConfig?.sso ?? {};
const configInterop: NonNullable<ContractsConfig['interop']> = contractsConfig?.interop ?? {};
const activeChainInteropCenter = activeChainDeployment?.deployment.interopCenter;

warnIfMismatch('L1_INTEROP_HANDLER', configInterop.l1InteropHandler, env.L1_INTEROP_HANDLER);
warnIfMismatch(
  'L2_INTEROP_CENTER',
  configInterop.l2InteropCenter ?? activeChainInteropCenter,
  env.L2_INTEROP_CENTER
);

export const ACTIVE_CHAIN_DEPLOYMENT = activeChainDeployment;

// Contract addresses
export const L1_INTEROP_HANDLER = (configInterop.l1InteropHandler ??
  env.L1_INTEROP_HANDLER) as `0x${string}`;
export const L2_INTEROP_CENTER = (configInterop.l2InteropCenter ??
  activeChainInteropCenter ??
  env.L2_INTEROP_CENTER) as `0x${string}`;
export const BASE_TOKEN_ADDRESS: `0x${string}` = '0x000000000000000000000000000000000000800A';

// RPC URLs
export const L1_RPC_URL = env.L1_RPC_URL;
export const L2_RPC_URL = env.PRIVIDIUM_RPC_URL;
export const L2_CHAIN_ID = env.PRIVIDIUM_CHAIN_ID;

// FILE PATHS
export const TXNS_STATE_FOLDER = join(__dirname, 'txn-state');
export const PENDING_TXS_FILE = join(TXNS_STATE_FOLDER, 'pending-txs.json');
export const FINALIZED_TXS_FILE = join(TXNS_STATE_FOLDER, 'finalized-txs.json');
export const INVOICE_PAYOUTS_FILE = join(TXNS_STATE_FOLDER, 'invoice-payouts.json');

// ZKsync OS testnet chain info
export const l2Chain = defineChain({
  id: L2_CHAIN_ID,
  name: 'Prividium L2',
  nativeCurrency: {
    name: 'Ether',
    symbol: 'ETH',
    decimals: 18
  },
  rpcUrls: {
    default: {
      http: [L2_RPC_URL]
    },
    public: {
      http: [L2_RPC_URL]
    }
  }
});

export const SSO_CONTRACTS = {
  eoaValidator: (configSso.eoaValidator ?? env.SSO_EOA_VALIDATOR_CONTRACT) as `0x${string}`,
  webauthnValidator: (configSso.webauthnValidator ??
    env.SSO_WEBAUTHN_VALIDATOR_CONTRACT) as `0x${string}`,
  sessionValidator: (configSso.sessionValidator ??
    env.SSO_SESSION_VALIDATOR_CONTRACT) as `0x${string}`,
  guardianExecutor: (configSso.guardianExecutor ??
    env.SSO_GUARDIAN_EXECUTOR_CONTRACT) as `0x${string}`,
  accountImplementation: (configSso.accountImplementation ??
    env.SSO_ACCOUNT_IMPLEMENTATION_CONTRACT) as `0x${string}`,
  beacon: (configSso.beacon ?? env.SSO_BEACON_CONTRACT) as `0x${string}`,
  factory: (configSso.factory ?? env.SSO_FACTORY_CONTRACT) as `0x${string}`,
  entryPoint: (configSso.entryPoint ?? env.SSO_ENTRYPOINT_CONTRACT) as `0x${string}`
};

const missingSso = Object.entries(SSO_CONTRACTS)
  .filter(([, value]) => !value)
  .map(([key]) => key);

if (missingSso.length > 0) {
  throw new Error(
    `Missing SSO contract addresses: ${missingSso.join(
      ', '
    )}. Set CONTRACTS_CONFIG_PATH or SSO_* env vars.`
  );
}

if (!L1_INTEROP_HANDLER || !L2_INTEROP_CENTER) {
  throw new Error(
    'Missing interop contract addresses. Set CONTRACTS_CONFIG_PATH or L1_INTEROP_HANDLER/L2_INTEROP_CENTER env vars.'
  );
}
