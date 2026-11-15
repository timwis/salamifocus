-- A task's history includes its tag links, which are found by the task they
-- joined. Deleted links keep that only in their before value.
CREATE INDEX changes_task_tag_task ON changes ((COALESCE(after, before) ->> 'task_id')) WHERE entity = 'task_tag';
