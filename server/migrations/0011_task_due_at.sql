-- A task's deadline, or null. Separate from deferral: it never changes whether
-- the task can be worked on. A task beneath another is due by the earlier of
-- the two.
ALTER TABLE tasks ADD COLUMN due_at timestamptz;
