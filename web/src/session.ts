import { useSyncExternalStore } from 'react';

const key = 'salamifocus.session';
const listeners = new Set<() => void>();

function set(token: string | null) {
  if (token) localStorage.setItem(key, token);
  else localStorage.removeItem(key);
  for (const listener of listeners) listener();
}

export function sessionToken(): string | null {
  return localStorage.getItem(key);
}

export function useSessionToken(): string | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    sessionToken,
  );
}

export async function signIn(password: string): Promise<string | null> {
  const response = await fetch('/api/auth/sign-in', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password, client: 'web' }),
  });
  if (response.status === 401 || response.status === 429) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    return body?.error ?? 'That password is not right.';
  }
  if (!response.ok) return 'Could not reach the server.';
  set(((await response.json()) as { token: string }).token);
  return null;
}

export async function signOut(): Promise<void> {
  const token = sessionToken();
  set(null);
  if (token) {
    await fetch('/api/auth/sign-out', { method: 'POST', headers: { authorization: `Bearer ${token}` } }).catch(() => {});
  }
}

/** The server no longer accepts the session. Local data and pending changes are kept. */
export function sessionExpired(): void {
  set(null);
}
