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
