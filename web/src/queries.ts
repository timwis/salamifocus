import { deferredUntilColumn } from '@salamifocus/domain';

/**
 * Selects how many of a task's children (the task aliased `t`) are unfinished, as `unfinishedChildren`,
 * which `unavailability` needs. The server's queries count them the same way, in server/src/application/index.ts.
 */
const unfinishedChildrenColumn =
  '(SELECT count(*) FROM tasks c WHERE c.parent_id = t.id AND c.completed_at IS NULL) AS "unfinishedChildren"';

/** What a task row (aliased `t`) needs to show its availability and dates. */
export interface TaskState {
  unfinishedChildren: number;
  /** The latest defer date among the task and the tasks it is beneath. */
  deferredUntil: string | null;
  /** The task's own defer date. */
  deferUntil: string | null;
}

/** Selects a task's `TaskState`. */
export const taskStateColumns = `${unfinishedChildrenColumn}, ${deferredUntilColumn}, t.defer_until AS "deferUntil"`;
