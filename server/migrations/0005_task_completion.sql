-- When a task was completed; null while it is unfinished. Kept so completed
-- work can be inspected later.
ALTER TABLE tasks ADD COLUMN completed_at timestamptz;
