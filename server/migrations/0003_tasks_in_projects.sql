-- A task can belong to a project or single-action list. Captures start
-- without one. Tasks in a project are ordered among themselves for
-- presentation only; siblings never depend on each other.
ALTER TABLE tasks
  ADD COLUMN project_id uuid REFERENCES projects (id),
  ADD COLUMN position text COLLATE "C";

CREATE INDEX tasks_project ON tasks (project_id);
