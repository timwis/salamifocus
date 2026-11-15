import { deferredUntilColumn, dueByColumn, unavailability, Visibility, type Unavailable } from '@salamifocus/domain';

/**
 * Selects how many of a task's children (the task aliased `t`) are unfinished, as `unfinishedChildren`,
 * which `unavailability` needs. The server's queries count them the same way, in server/src/application/index.ts.
 */
const unfinishedChildrenColumn =
  '(SELECT count(*) FROM tasks c WHERE c.parent_id = t.id AND c.completed_at IS NULL) AS "unfinishedChildren"';

/** What a task row (aliased `t`) needs to show its availability and dates. */
export interface TaskState {
  /** When the task was completed, or null while it is unfinished. */
  completedAt: string | null;
  unfinishedChildren: number;
  /** The latest defer date among the task, the unfinished tasks it is beneath and its project. */
  deferredUntil: string | null;
  /** The task's own defer date. */
  deferUntil: string | null;
  /** The task's own due date. */
  dueAt: string | null;
  /** The earliest due date among the task, the unfinished tasks it is beneath and its project. */
  dueBy: string | null;
}

/** Selects a task's `TaskState`. */
export const taskStateColumns = `t.completed_at AS "completedAt", ${unfinishedChildrenColumn}, ${deferredUntilColumn}, t.defer_until AS "deferUntil", ${dueByColumn}, t.due_at AS "dueAt"`;

/** Why a task cannot be worked on at `now`, from its `TaskState`. */
export function taskUnavailability(task: Partial<TaskState>, now: Date): Unavailable[] {
  return unavailability({ completedAt: task.completedAt ?? null, unfinishedChildren: task.unfinishedChildren ?? 0, deferredUntil: task.deferredUntil ?? null }, now);
}

/** Limits tasks (aliased `t`) to unfinished ones, except under Everything, which shows completed tasks too. */
export const unfinishedUnless = (visibility: Visibility) => (visibility === Visibility.everything ? 'TRUE' : 't.completed_at IS NULL');
