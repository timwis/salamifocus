// Inbox is a view, not a place: an unfinished task is in it while it lacks a
// project (a single-action list counts) or lacks a tag, however it was
// created. Assigning only one leaves it there. Completed tasks never count as
// Inbox work, whatever they lack.

/**
 * The Inbox rule as a condition over `tasks` aliased `t`, in SQL that both
 * Postgres and SQLite accept, so the server and the web client agree.
 * Android repeats it in its Inbox query.
 */
export const inboxCondition = `t.completed_at IS NULL AND (t.project_id IS NULL OR NOT EXISTS (SELECT 1 FROM task_tags tt WHERE tt.task_id = t.id))`;
