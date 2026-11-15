-- A task can carry several tags. Each link is its own row, so adding a tag on
-- one device and removing another on a second device both survive.
CREATE TABLE task_tags (
  id uuid PRIMARY KEY,
  task_id uuid NOT NULL REFERENCES tasks (id),
  tag_id uuid NOT NULL REFERENCES tags (id),
  UNIQUE (task_id, tag_id)
);

CREATE INDEX task_tags_tag ON task_tags (tag_id);

ALTER PUBLICATION powersync ADD TABLE task_tags;

-- Removing a tag from a task deletes its link. The change keeps the removed
-- row as its before value, and has no after value.
ALTER TABLE changes DROP CONSTRAINT changes_kind_check;
ALTER TABLE changes ADD CONSTRAINT changes_kind_check CHECK (kind IN ('create', 'update', 'delete'));
ALTER TABLE changes ALTER COLUMN after DROP NOT NULL;
