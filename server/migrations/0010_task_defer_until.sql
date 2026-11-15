-- When a deferred task comes back to attention; null when it is not deferred.
-- An instant, resolved from what the user typed in their own time zone. Until
-- then the task, and every task beneath it, is unavailable.
ALTER TABLE tasks ADD COLUMN defer_until timestamptz;
