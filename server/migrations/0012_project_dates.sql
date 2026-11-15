-- A project or single-action list can be deferred and given a due date, like a
-- task. Its tasks are deferred until the latest defer date among themselves,
-- the unfinished tasks above them and their project, and due by the earliest due date.
ALTER TABLE projects ADD COLUMN defer_until timestamptz;
ALTER TABLE projects ADD COLUMN due_at timestamptz;
