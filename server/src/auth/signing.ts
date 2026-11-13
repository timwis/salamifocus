import { generateKeyPairSync } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { calculateJwkThumbprint, exportJWK, importPKCS8, SignJWT, type JWK } from 'jose';
import type { Config } from '../config.ts';

const alg = 'EdDSA';

export interface Signer {
  jwks: { keys: JWK[] };
  /** A short-lived token the PowerSync service accepts for syncing as `subject`. */
  powersyncToken(subject: string, now: Date): Promise<{ token: string; expiresAt: string }>;
}

export async function createSigner(pem: string, audience: string, lifetimeSeconds = 10 * 60): Promise<Signer> {
  const privateKey = await importPKCS8(pem, alg, { extractable: true });
  const { d: _private, ...publicJwk } = await exportJWK(privateKey);
  const kid = await calculateJwkThumbprint(publicJwk);
  return {
    jwks: { keys: [{ ...publicJwk, kid, alg, use: 'sig' }] },
    async powersyncToken(subject, now) {
      const issuedAt = Math.floor(now.getTime() / 1000);
      const expiresAt = issuedAt + lifetimeSeconds;
      const token = await new SignJWT({})
        .setProtectedHeader({ alg, kid })
        .setSubject(subject)
        .setAudience(audience)
        .setIssuedAt(issuedAt)
        .setExpirationTime(expiresAt)
        .sign(privateKey);
      return { token, expiresAt: new Date(expiresAt * 1000).toISOString() };
    },
  };
}

export function generateSigningKeyPem(): string {
  return generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
}

/** Uses the configured key, or outside production creates and keeps one under .data. */
export async function loadSigningKey(config: Config): Promise<string> {
  if (config.signingKeyPem) return config.signingKeyPem;
  try {
    return await readFile(config.signingKeyFile, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    if (config.production) throw new Error('SIGNING_KEY or SIGNING_KEY_FILE must provide a signing key in production.');
    const pem = generateSigningKeyPem();
    await mkdir(dirname(config.signingKeyFile), { recursive: true });
    await writeFile(config.signingKeyFile, pem, { mode: 0o600 });
    return pem;
  }
}
