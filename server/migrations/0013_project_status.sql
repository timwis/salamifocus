-- A project or single-action list is active or paused. A paused one stays in
-- the sidebar and can be inspected and edited, but none of its tasks can be
-- worked on until it is resumed.
ALTER TABLE projects ADD COLUMN status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused'));
