/**
 * Selects how many of a task's children (the task aliased `t`) are unfinished, as `unfinishedChildren`,
 * which `unavailability` needs. The server's queries count them the same way, in server/src/application/index.ts.
 */
export const unfinishedChildrenColumn =
  '(SELECT count(*) FROM tasks c WHERE c.parent_id = t.id AND c.completed_at IS NULL) AS "unfinishedChildren"';
