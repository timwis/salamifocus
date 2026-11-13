import { generateKeyBetween } from 'fractional-indexing';

// Siblings are ordered by a sort key that can always be placed between two
// others, so moving one item rewrites only that item. The order is
// presentation only: it never implies that one item must happen first.
// Keys compare by code point, so Postgres must store them with COLLATE "C".

export interface Positioned {
  id: string;
  position: string | null;
}

/** Sibling order: by position (missing positions last), then by id so ties are stable everywhere. */
export function comparePositions(a: Positioned, b: Positioned): number {
  if (a.position !== b.position) {
    if (a.position === null) return 1;
    if (b.position === null) return -1;
    return a.position < b.position ? -1 : 1;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Returns a reason the position is not a usable sort key, or null if it is fine. */
export function positionProblem(position: string): string | null {
  if (position.length === 0 || position.length > 200) return 'A position must be a short sort key.';
  try {
    generateKeyBetween(position, null);
    return null;
  } catch {
    return 'A position must be a valid sort key.';
  }
}

/** A position after `before` and, where possible, before `after` (either may be null for "no bound"). */
export function positionBetween(before: string | null, after: string | null): string {
  return generateKeyBetween(before, after !== null && before !== null && after <= before ? null : after);
}

/**
 * A position that puts an item at `index` among `siblings`, which must be in
 * sibling order and must not include the item being placed.
 */
export function positionAt(siblings: readonly Positioned[], index: number): string {
  const positions = siblings.map((s) => s.position).filter((p): p is string => p !== null);
  const clamped = Math.max(0, Math.min(index, positions.length));
  const before = positions[clamped - 1] ?? null;
  // Two devices can create siblings with the same key while offline; skip
  // past equal keys so there is always room between the bounds.
  const after = positions.slice(clamped).find((p) => before === null || p > before) ?? null;
  return positionBetween(before, after);
}
