import { resolve } from 'node:path';

export interface Config {
  port: number;
  host: string;
  databaseUrl: string;
  ownerPasswordHash: string;
  /** Where the app server reaches the PowerSync service, for proxying client sync traffic. */
  powersyncUrl: string;
  powersyncAudience: string;
  signingKeyPem: string | null;
  signingKeyFile: string;
  production: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const required = (name: string): string => {
    const value = env[name];
    if (!value) throw new Error(`${name} must be set.`);
    return value;
  };
  return {
    port: Number(env.PORT ?? 3100),
    host: env.HOST ?? '127.0.0.1',
    databaseUrl: required('DATABASE_URL'),
    ownerPasswordHash: required('OWNER_PASSWORD_HASH'),
    powersyncUrl: env.POWERSYNC_URL ?? 'http://127.0.0.1:8080',
    powersyncAudience: env.POWERSYNC_AUDIENCE ?? 'powersync',
    signingKeyPem: env.SIGNING_KEY ?? null,
    signingKeyFile: resolve(env.SIGNING_KEY_FILE ?? new URL('../../.data/signing-key.pem', import.meta.url).pathname),
    production: env.NODE_ENV === 'production',
  };
}
