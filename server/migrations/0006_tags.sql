-- Tags represent contexts, effort, places and people. They nest to any depth
-- and are referred to by id, so renaming or moving one keeps its tasks.
-- Siblings are ordered by a fractional sort key, as folders are.
CREATE TABLE tags (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  parent_id uuid REFERENCES tags (id),
  position text COLLATE "C" NOT NULL
);

ALTER PUBLICATION powersync ADD TABLE tags;
