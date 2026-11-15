// Whether a task can be worked on now is worked out from current state each
// time it is needed, never stored, so each client can answer it offline.
// Later tickets add deferral and paused projects as further reasons.

export const Unavailable = {
  completed: 'completed',
  /** Waiting on an unfinished child (a prerequisite). */
  blocked: 'blocked',
} as const;

export type Unavailable = (typeof Unavailable)[keyof typeof Unavailable];

export interface AvailabilityFacts {
  completedAt: string | null;
  /** How many of the task's children are unfinished. A parent never blocks its children. */
  unfinishedChildren: number;
}

/** Why a task cannot be worked on now; empty when it is available. */
export function unavailability(task: AvailabilityFacts): Unavailable[] {
  if (task.completedAt !== null) return [Unavailable.completed];
  return task.unfinishedChildren > 0 ? [Unavailable.blocked] : [];
}
