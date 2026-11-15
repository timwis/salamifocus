import { ProjectStatus } from './organisation.ts';

// Whether a task can be worked on now is worked out from current state and the
// clock each time it is needed, never stored, so each client can answer it
// offline and a deferred task comes back by itself when its date arrives.

export const Unavailable = {
  completed: 'completed',
  /** Waiting on an unfinished child (a prerequisite). */
  blocked: 'blocked',
  /** Deferred, by its own defer date, an unfinished task it is beneath or its project, until a time still to come. */
  deferred: 'deferred',
  /** In a paused project. */
  paused: 'paused',
} as const;

export type Unavailable = (typeof Unavailable)[keyof typeof Unavailable];

export interface AvailabilityFacts {
  completedAt: string | null;
  /** How many of the task's children are unfinished. A parent never blocks its children. */
  unfinishedChildren: number;
  /** The latest defer date among the task, the unfinished tasks it is beneath and its project (see `deferredUntilColumn`), or null. */
  deferredUntil: string | null;
  /** The status of the task's project (see `projectStatusColumn`), or null when it has none. */
  projectStatus: string | null;
}

/** Why a task cannot be worked on at `now`; empty when it is available. A deferred task is available from its defer date on. */
export function unavailability(task: AvailabilityFacts, now: Date): Unavailable[] {
  if (task.completedAt !== null) return [Unavailable.completed];
  const reasons: Unavailable[] = [];
  if (task.unfinishedChildren > 0) reasons.push(Unavailable.blocked);
  if (task.deferredUntil !== null && Date.parse(task.deferredUntil) > now.getTime()) reasons.push(Unavailable.deferred);
  if (task.projectStatus === ProjectStatus.paused) reasons.push(Unavailable.paused);
  return reasons;
}

/**
 * SQL selecting the latest or earliest value of a date column among a task (aliased `t`), the unfinished
 * tasks it is beneath and its project. Runs on Postgres and on the clients' SQLite; UNION stops at a cycle.
 */
const inheritedDate = (column: 'defer_until' | 'due_at', pick: 'max' | 'min', alias: string) =>
  `(WITH RECURSIVE up(id, parent_id, value) AS (
    SELECT t.id, t.parent_id, t.${column}
    UNION SELECT p.id, p.parent_id, CASE WHEN p.completed_at IS NULL THEN p.${column} END FROM tasks p JOIN up ON p.id = up.parent_id
  ) SELECT ${pick}(value) FROM (
    SELECT value FROM up UNION ALL SELECT pr.${column} FROM projects pr WHERE pr.id = t.project_id
  ) AS inherited) AS "${alias}"`;

/** Selects `deferredUntil`: the latest defer date among a task, the unfinished tasks it is beneath and its project, which defer it too. */
export const deferredUntilColumn = inheritedDate('defer_until', 'max', 'deferredUntil');

/** Selects `dueBy`: the earliest due date among a task, the unfinished tasks it is beneath and its project, since it must be done before them. */
export const dueByColumn = inheritedDate('due_at', 'min', 'dueBy');

/** Selects `projectStatus`: the status of a task's (aliased `t`) project, or null when it has none. */
export const projectStatusColumn = '(SELECT pr.status FROM projects pr WHERE pr.id = t.project_id) AS "projectStatus"';
