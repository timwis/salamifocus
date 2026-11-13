-- Free text kept alongside a task, such as reference details or context.
ALTER TABLE tasks ADD COLUMN note text NOT NULL DEFAULT '';
