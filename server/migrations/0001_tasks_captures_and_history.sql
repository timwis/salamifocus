-- Current state. Rows are created with ids chosen by the client that created
-- them, so an item keeps one identity from the moment it is captured offline.
CREATE TABLE tasks (
  id uuid PRIMARY KEY,
  title text NOT NULL,
  created_at timestamptz NOT NULL
);

-- The text exactly as it was captured. It is never updated, so rewording the
-- task cannot destroy it.
CREATE TABLE captures (
  id uuid PRIMARY KEY,
  task_id uuid NOT NULL UNIQUE REFERENCES tasks (id),
  text text NOT NULL,
  captured_at timestamptz NOT NULL
);

CREATE TABLE sessions (
  id uuid PRIMARY KEY,
  token_hash text NOT NULL UNIQUE,
  client text NOT NULL,
  created_at timestamptz NOT NULL,
  last_used_at timestamptz NOT NULL,
  revoked_at timestamptz
);

-- One row per logical operation, keyed by the id the client gave it, so a
-- retried upload is recognised instead of being applied twice.
CREATE TABLE operations (
  id text PRIMARY KEY,
  name text NOT NULL,
  actor_type text NOT NULL,
  actor_id text NOT NULL,
  session_id uuid REFERENCES sessions (id),
  source text,
  outcome text NOT NULL CHECK (outcome IN ('applied', 'rejected')),
  rejection_code text,
  rejection_reason text,
  -- What was submitted, kept so a rejected edit is never silently lost.
  submitted jsonb NOT NULL,
  recorded_at timestamptz NOT NULL,
  deliveries integer NOT NULL DEFAULT 1
);

-- The before and after values of every row an applied operation changed,
-- written in the same transaction as the change itself.
CREATE TABLE changes (
  id bigserial PRIMARY KEY,
  operation_id text NOT NULL REFERENCES operations (id),
  entity text NOT NULL,
  entity_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('create', 'update')),
  before jsonb,
  after jsonb NOT NULL
);

CREATE INDEX changes_entity ON changes (entity, entity_id);

CREATE PUBLICATION powersync FOR TABLE tasks, captures;
