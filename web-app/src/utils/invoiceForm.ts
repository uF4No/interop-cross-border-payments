import { isAddress, parseUnits } from 'viem';

export type InvoiceChainKey = 'a' | 'b';

export type InvoiceChainOption = {
  key: InvoiceChainKey;
  chainId: number;
  label: string;
};

export type InvoiceTokenOption = {
  symbol: 'USDC' | 'SGD' | 'TBILL';
  address: `0x${string}`;
  chainKey: InvoiceChainKey;
  chainId: number;
  label: string;
};

export type InvoiceFormState = {
  creator: string;
  recipient: string;
  amount: string;
  text: string;
  billingTokenAddress: string;
  recipientChainId: string;
};

export type CreateInvoiceSubmitPayload = {
  creator: `0x${string}`;
  recipient: `0x${string}`;
  creatorRefundAddress: `0x${string}`;
  recipientRefundAddress: `0x${string}`;
  creatorChainId: number;
  recipientChainId: number;
  billingTokenAddress: `0x${string}`;
  billingTokenSymbol: 'USDC' | 'SGD' | 'TBILL';
  amount: bigint;
  amountInput: string;
  text: string;
};

const FALLBACK_CHAIN_IDS: Record<InvoiceChainKey, number> = {
  a: 6565,
  b: 6566
};

const TOKEN_SYMBOLS = ['USDC', 'SGD', 'TBILL'] as const;

const chainOptions: InvoiceChainOption[] = [
  {
    key: 'a',
    chainId: readChainId('VITE_CHAIN_A_CHAIN_ID', FALLBACK_CHAIN_IDS.a),
    label: 'Chain A'
  },
  {
    key: 'b',
    chainId: readChainId('VITE_CHAIN_B_CHAIN_ID', FALLBACK_CHAIN_IDS.b),
    label: 'Chain B'
  }
];

const tokenOptions = buildTokenOptions();

function readChainId(envKey: string, fallback: number): number {
  const raw = import.meta.env[envKey];
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readTokenAddress(symbol: (typeof TOKEN_SYMBOLS)[number], chainKey: InvoiceChainKey) {
  const chainSuffix = chainKey === 'a' ? '_CHAIN_A' : '_CHAIN_B';
  const candidates = [
    `VITE_TOKEN_${symbol}_ADDRESS${chainSuffix}`,
    `VITE_${symbol}_TOKEN_ADDRESS${chainSuffix}`,
    `VITE_TOKEN_${symbol}_ADDRESS`
  ] as const;

  for (const envKey of candidates) {
    const value = import.meta.env[envKey];
    if (value && isAddress(value)) {
      return value as `0x${string}`;
    }
  }

  return undefined;
}

function buildTokenOptions(): InvoiceTokenOption[] {
  const dedupeByAddress = new Set<string>();
  const dedupeBySymbol = new Set<string>();
  const options: InvoiceTokenOption[] = [];

  for (const chain of chainOptions) {
    for (const symbol of TOKEN_SYMBOLS) {
      const address = readTokenAddress(symbol, chain.key);
      if (!address) continue;

      const addressKey = address.toLowerCase();
      const symbolKey = symbol.toLowerCase();
      if (dedupeByAddress.has(addressKey) || dedupeBySymbol.has(symbolKey)) {
        continue;
      }

      dedupeByAddress.add(addressKey);
      dedupeBySymbol.add(symbolKey);
      options.push({
        symbol,
        address,
        chainKey: chain.key,
        chainId: chain.chainId,
        label: `${symbol} - ${chain.label}`
      });
    }
  }

  return options;
}

export function getInvoiceChainOptions(): InvoiceChainOption[] {
  return chainOptions;
}

export function getInvoiceTokenOptions(): InvoiceTokenOption[] {
  return tokenOptions;
}

export function getDefaultCreatorChainId(): number {
  const appChainId = readChainId('VITE_PRIVIDIUM_CHAIN_ID', chainOptions[0]?.chainId ?? 0);
  return chainOptions.some((chain) => chain.chainId === appChainId)
    ? appChainId
    : chainOptions[0]?.chainId ?? appChainId;
}

export function getDefaultDestinationChainId(): number {
  return chainOptions[0]?.chainId ?? 0;
}

export function createEmptyInvoiceFormState(): InvoiceFormState {
  return {
    creator: '',
    recipient: '',
    amount: '',
    text: '',
    billingTokenAddress: tokenOptions[0]?.address ?? '',
    recipientChainId: String(getDefaultDestinationChainId())
  };
}

export function normalizeInvoiceAmount(amountInput: string): bigint {
  return parseUnits(amountInput.trim(), 18);
}

export function isAllowedInvoiceChainId(chainId: number): boolean {
  return chainOptions.some((chain) => chain.chainId === chainId);
}

export function getChainOptionById(chainId: number): InvoiceChainOption | undefined {
  return chainOptions.find((chain) => chain.chainId === chainId);
}

export function getTokenOptionByAddress(
  address: string
): InvoiceTokenOption | undefined {
  const normalized = address.toLowerCase();
  return tokenOptions.find((token) => token.address.toLowerCase() === normalized);
}

