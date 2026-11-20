-- The user's settings, as a single row with a fixed id (settingsId in
-- domain/src/settings.ts) that every client updates.
--
-- The Actionable perspectives each show one part of the user's life: the
-- folder designated for it, with everything inside. Folders are referred to
-- by id, so renaming or moving one keeps it designated.
CREATE TABLE settings (
  id uuid PRIMARY KEY CHECK (id = '00000000-0000-4000-8000-000000000001'),
  personal_folder_id uuid REFERENCES folders (id),
  work_folder_id uuid REFERENCES folders (id)
);

ALTER PUBLICATION powersync ADD TABLE settings;

-- Published first: a row inserted before then never reaches a PowerSync that is
-- already running, and clients wait for this row.
INSERT INTO settings (id) VALUES ('00000000-0000-4000-8000-000000000001');
