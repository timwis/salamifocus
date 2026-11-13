import { createHash, randomBytes } from 'node:crypto';
import type { Sql } from '../db.ts';

export interface Session {
  id: string;
  client: string;
}

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

export async function createSession(sql: Sql, client: string, now: Date): Promise<{ token: string; session: Session }> {
  const token = randomBytes(32).toString('base64url');
  const id = crypto.randomUUID();
  await sql`
    INSERT INTO sessions (id, token_hash, client, created_at, last_used_at)
    VALUES (${id}, ${hash(token)}, ${client}, ${now.toISOString()}, ${now.toISOString()})`;
  return { token, session: { id, client } };
}

export async function findSession(sql: Sql, token: string, now: Date): Promise<Session | null> {
  const [row] = await sql<Session[]>`
    UPDATE sessions SET last_used_at = ${now.toISOString()}
    WHERE token_hash = ${hash(token)} AND revoked_at IS NULL
    RETURNING id, client`;
  return row ?? null;
}

export async function revokeSession(sql: Sql, id: string, now: Date): Promise<void> {
  await sql`UPDATE sessions SET revoked_at = ${now.toISOString()} WHERE id = ${id}`;
}
