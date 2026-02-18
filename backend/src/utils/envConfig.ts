import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  HOST: z.string().min(1).default('localhost'),

  PORT: z.coerce.number().int().positive().default(4340),

  CORS_ORIGIN: z.string().url().default('http://localhost:5173'),

  COMMON_RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(100),

  COMMON_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(1000),

  EXECUTOR_PRIVATE_KEY: z.string().length(66),

  L1_RPC_URL: z.string().url(),

  PRIVIDIUM_RPC_URL: z.string().url().default('https://zksync-os-testnet-alpha.zksync.dev/'),
  PRIVIDIUM_CHAIN_ID: z.coerce.number().int().positive().default(8022833),

  L2_INTEROP_CENTER: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().length(42).optional()
  ),

  L1_INTEROP_HANDLER: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().length(42).optional()
  ),

  SSO_FACTORY_CONTRACT: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().length(42).optional()
  ),
  SSO_BEACON_CONTRACT: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().length(42).optional()
  ),
  SSO_ACCOUNT_IMPLEMENTATION_CONTRACT: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().length(42).optional()
  ),
  SSO_EOA_VALIDATOR_CONTRACT: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().length(42).optional()
  ),
  SSO_WEBAUTHN_VALIDATOR_CONTRACT: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().length(42).optional()
  ),
  SSO_SESSION_VALIDATOR_CONTRACT: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().length(42).optional()
  ),
  SSO_GUARDIAN_EXECUTOR_CONTRACT: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().length(42).optional()
  ),
  SSO_ENTRYPOINT_CONTRACT: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().length(42).optional()
  ),

  CONTRACTS_CONFIG_PATH: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().optional()
  ),

  PRIVIDIUM_API_URL: z.string().url(),
  PRIVIDIUM_AUTH_BASE_URL: z.string().url().optional(),
  SIWE_DOMAIN: z.string().min(1).optional(),
  SIWE_URI: z.string().url().optional(),
  SIWE_CHALLENGE_PATH: z.string().min(1).default('/siwe-messages'),
  SIWE_LOGIN_PATH: z.string().min(1).default('/auth/login/crypto-native'),

  POLL_INTERVAL: z.coerce.number().int().positive().default(30000),

  FINALIZATION_WAIT: z.coerce.number().int().positive().default(900000)
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  console.error('❌ Invalid environment variables:', parsedEnv.error.format());
  throw new Error('Invalid environment variables');
}

export const env = {
  ...parsedEnv.data,
  isDevelopment: parsedEnv.data.NODE_ENV === 'development',
  isProduction: parsedEnv.data.NODE_ENV === 'production',
  isTest: parsedEnv.data.NODE_ENV === 'test'
};
