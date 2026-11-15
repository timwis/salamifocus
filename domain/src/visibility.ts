import type { Unavailable } from './availability.ts';

// How much of the system a view shows. Projects and Tags let the user choose,
// and default to Remaining.

export const Visibility = {
  /** Only tasks that can be worked on now. */
  available: 'available',
  /** Every unfinished task, whatever holds it back. */
  remaining: 'remaining',
} as const;

export type Visibility = (typeof Visibility)[keyof typeof Visibility];

export const visibilities: readonly Visibility[] = [Visibility.available, Visibility.remaining];

export function isVisibility(value: unknown): value is Visibility {
  return visibilities.includes(value as Visibility);
}

/** Whether a task, unavailable for these reasons (see `unavailability`), is shown under a visibility. */
export function shownUnder(visibility: Visibility, unavailable: readonly Unavailable[]): boolean {
  if (visibility === Visibility.available) return unavailable.length === 0;
  return !unavailable.includes('completed');
}
