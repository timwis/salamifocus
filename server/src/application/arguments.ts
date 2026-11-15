import { Rejection } from './rejection.ts';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Rejection('invalid_arguments', 'Expected an object of arguments.');
  }
  return value as Record<string, unknown>;
}

export function uuid(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || !uuidPattern.test(value)) {
    throw new Rejection('invalid_arguments', `${key} must be a UUID.`);
  }
  return value.toLowerCase();
}

export function text(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string') throw new Rejection('invalid_arguments', `${key} must be text.`);
  // Postgres cannot store NUL characters; drop them rather than refuse the text.
  return value.replaceAll('\u0000', '');
}

/** A client-supplied time, or `fallback` when it is missing or unreadable. */
export function timestamp(args: Record<string, unknown>, key: string, fallback: string): string {
  const value = args[key];
  if (typeof value !== 'string') return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
}

/** A UUID or null. Undefined when the key is absent, which operations read as "leave it as it is". */
export function nullableUuid(args: Record<string, unknown>, key: string): string | null | undefined {
  if (args[key] === undefined) return undefined;
  if (args[key] === null) return null;
  return uuid(args, key);
}

export function optionalText(args: Record<string, unknown>, key: string): string | undefined {
  return args[key] === undefined ? undefined : text(args, key);
}

/** A time or null (to clear it). Unlike `timestamp`, an unreadable time is refused rather than replaced. */
export function nullableTime(args: Record<string, unknown>, key: string): string | null {
  const value = args[key];
  if (value === null) return null;
  const parsed = typeof value === 'string' ? new Date(value) : null;
  if (!parsed || Number.isNaN(parsed.getTime())) throw new Rejection('invalid_arguments', `${key} must be a time, or null for none.`);
  return parsed.toISOString();
}
