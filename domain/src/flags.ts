// A flag is the user's intention to do a task now. It is the task's own: a
// task beneath a flagged one, or in a project, is not flagged by it. Whether
// a flagged task is shown depends only on the visibility, so a flagged task
// that is deferred or blocked leaves Available and comes back by itself.

/**
 * Flagged tasks, as a condition over `tasks` aliased `t`. Postgres stores the flag as a boolean and the
 * clients' SQLite as 1 or 0, which this reads the same on both.
 */
export const flaggedCondition = 't.flagged';
