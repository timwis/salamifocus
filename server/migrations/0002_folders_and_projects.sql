-- Folders organise projects and other folders, nested to any depth. Projects
-- and single-action lists live in a folder or at the top level. Containers
-- are referred to by id, so renaming a folder never loses what is inside it.
--
-- Siblings (folders and projects together) are ordered by a fractional sort
-- key. COLLATE "C" makes Postgres compare keys byte by byte, as the clients'
-- SQLite does. The order is presentation only.
CREATE TABLE folders (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  parent_id uuid REFERENCES folders (id),
  position text COLLATE "C" NOT NULL
);

CREATE TABLE projects (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  -- A single-action list holds standalone tasks; it is never complete merely
  -- because it is empty.
  kind text NOT NULL CHECK (kind IN ('project', 'single_actions')),
  folder_id uuid REFERENCES folders (id),
  position text COLLATE "C" NOT NULL
);

ALTER PUBLICATION powersync ADD TABLE folders, projects;
