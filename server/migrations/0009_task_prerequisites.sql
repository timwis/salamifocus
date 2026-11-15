-- A task can sit beneath another task in the same project, as one of its
-- prerequisites: the parent waits while any child is unfinished. Siblings
-- under one parent are ordered by position, as top-level tasks are.
ALTER TABLE tasks ADD COLUMN parent_id uuid REFERENCES tasks (id);

CREATE INDEX tasks_parent ON tasks (parent_id);
