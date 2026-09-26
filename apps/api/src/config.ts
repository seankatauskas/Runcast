import { z } from 'zod';

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1).default('postgres://runcast:runcast@localhost:5432/runcast'),
  ACCESS_TOKEN_SECRET: z.string().min(32).default('development-only-access-secret-change-me'),
  CREDENTIAL_ENCRYPTION_KEY: z.string().default(''),
  APPLE_CLIENT_ID: z.string().default('com.seankatauskas.runcast'),
  APPLE_TEAM_ID: z.string().default(''),
  APPLE_KEY_ID: z.string().default(''),
  APPLE_PRIVATE_KEY: z.string().default(''),
  STRAVA_CLIENT_ID: z.string().default(''),
  STRAVA_CLIENT_SECRET: z.string().default(''),
  STRAVA_CALLBACK_URL: z
    .string()
    .url()
    .default('http://localhost:3000/v1/integrations/strava/callback'),
  MOBILE_DEEP_LINK: z.string().url().default('runcast://account'),
  EXPO_ACCESS_TOKEN: z.string().default(''),
  LOG_LEVEL: z.string().default('info'),
  OPENAPI_ENABLED: z.string().default('false'),
  DEPLOYMENT_ENVIRONMENT: z.enum(['local', 'staging', 'production']).default('local'),
  RELEASE_SHA: z.string().min(1).max(200).optional(),
  RENDER_GIT_COMMIT: z.string().min(1).max(200).optional(),
  CANOPY_MODEL_MODE: z.enum(['off', 'active']).default('active'),
  EVALUATION_RETENTION_DAYS: z.coerce.number().int().min(7).max(3650).default(30),
  WATCH_REVISION_MODE: z.enum(['off', 'shadow', 'active']).default('off'),
});

const env = environmentSchema.parse(process.env);

function encryptionKey(value: string): Buffer {
  if (value) {
    const decoded = Buffer.from(value, 'base64');
    if (decoded.length !== 32)
      throw new Error('CREDENTIAL_ENCRYPTION_KEY must be 32 bytes in base64');
    return decoded;
  }
  if (env.NODE_ENV === 'production') throw new Error('CREDENTIAL_ENCRYPTION_KEY is required');
  return Buffer.from('12345678901234567890123456789012');
}

export const config = {
  nodeEnv: env.NODE_ENV,
  host: env.HOST,
  port: env.PORT,
  databaseUrl: env.DATABASE_URL,
  accessTokenSecret: env.ACCESS_TOKEN_SECRET,
  credentialEncryptionKey: encryptionKey(env.CREDENTIAL_ENCRYPTION_KEY),
  apple: {
    clientId: env.APPLE_CLIENT_ID,
    teamId: env.APPLE_TEAM_ID,
    keyId: env.APPLE_KEY_ID,
    privateKey: env.APPLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  },
  strava: {
    clientId: env.STRAVA_CLIENT_ID,
    clientSecret: env.STRAVA_CLIENT_SECRET,
    callbackUrl: env.STRAVA_CALLBACK_URL,
  },
  mobileDeepLink: env.MOBILE_DEEP_LINK,
  expoAccessToken: env.EXPO_ACCESS_TOKEN,
  logLevel: env.LOG_LEVEL,
  openApiEnabled: env.OPENAPI_ENABLED === 'true' || env.NODE_ENV === 'development',
  release: {
    environment: env.DEPLOYMENT_ENVIRONMENT,
    sha: env.RELEASE_SHA ?? env.RENDER_GIT_COMMIT ?? 'development',
  },
  canopyModelMode: env.CANOPY_MODEL_MODE,
  watchRevisionMode: env.WATCH_REVISION_MODE,
  evaluationRetentionDays: env.EVALUATION_RETENTION_DAYS,
} as const;

export function assertProviderConfiguration(provider: 'apple' | 'strava'): void {
  const values =
    provider === 'apple'
      ? Object.values(config.apple)
      : [config.strava.clientId, config.strava.clientSecret, config.strava.callbackUrl];
  if (values.some((value) => !value)) throw new Error(`${provider} integration is not configured`);
}
