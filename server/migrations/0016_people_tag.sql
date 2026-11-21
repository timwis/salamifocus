-- The People tag: each tag beneath it stands for a person, and Agendas groups
-- their tasks by them. Held by id, so renaming or moving it keeps it chosen.
ALTER TABLE settings ADD COLUMN people_tag_id uuid REFERENCES tags (id);
