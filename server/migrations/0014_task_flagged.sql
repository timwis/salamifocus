-- Whether the user currently intends to do the task. Independent of its dates
-- and availability: a flagged task that is deferred or blocked keeps its flag.
-- Not inherited by the tasks beneath it.
ALTER TABLE tasks ADD COLUMN flagged boolean NOT NULL DEFAULT false;
