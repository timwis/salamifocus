// Whether a task can be worked on now is worked out from current state and the
// clock each time it is needed, never stored, so each client can answer it
// offline and a deferred task comes back by itself when its date arrives.
// Later tickets add paused projects as a further reason.

export const Unavailable = {
  completed: 'completed',
  /** Waiting on an unfinished child (a prerequisite). */
  blocked: 'blocked',
  /** Deferred, by its own defer date or one of the tasks it is beneath, until a time still to come. */
  deferred: 'deferred',
} as const;

export type Unavailable = (typeof Unavailable)[keyof typeof Unavailable];

export interface AvailabilityFacts {
  completedAt: string | null;
  /** How many of the task's children are unfinished. A parent never blocks its children. */
  unfinishedChildren: number;
  /** The latest defer date among the task and the tasks it is beneath (see `deferredUntil`), or null. */
  deferredUntil: string | null;
}

/** Why a task cannot be worked on at `now`; empty when it is available. A deferred task is available from its defer date on. */
export function unavailability(task: AvailabilityFacts, now: Date): Unavailable[] {
  if (task.completedAt !== null) return [Unavailable.completed];
  const reasons: Unavailable[] = [];
  if (task.unfinishedChildren > 0) reasons.push(Unavailable.blocked);
  if (task.deferredUntil !== null && Date.parse(task.deferredUntil) > now.getTime()) reasons.push(Unavailable.deferred);
  return reasons;
}

/**
 * SQL selecting, as `deferredUntil`, the latest defer date among a task (aliased `t`) and the tasks it is
 * beneath, which defer it too. Runs on Postgres and on the clients' SQLite; UNION stops at a cycle.
 */
export const deferredUntilColumn = `(WITH RECURSIVE up(id, parent_id, defer_until) AS (
    SELECT t.id, t.parent_id, t.defer_until
    UNION SELECT p.id, p.parent_id, p.defer_until FROM tasks p JOIN up ON p.id = up.parent_id
  ) SELECT max(defer_until) FROM up) AS "deferredUntil"`;
