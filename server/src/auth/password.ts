import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, keylen: number, options: object) => Promise<Buffer>;
const params = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const keyLength = 32;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, keyLength, params);
  return ['scrypt', params.N, params.r, params.p, salt.toString('base64url'), key.toString('base64url')].join(':');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, expected] = stored.split(':');
  if (scheme !== 'scrypt' || !n || !r || !p || !salt || !expected) throw new Error('Unrecognised password hash.');
  const expectedKey = Buffer.from(expected, 'base64url');
  const key = await scryptAsync(password, Buffer.from(salt, 'base64url'), expectedKey.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: params.maxmem,
  });
  return timingSafeEqual(key, expectedKey);
}
