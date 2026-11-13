-- Runs once, when the Postgres data volume is first created.

-- The app server owns the application schema and runs its migrations.
CREATE ROLE salamifocus WITH LOGIN PASSWORD 'salamifocus' CREATEDB;
CREATE DATABASE salamifocus OWNER salamifocus;

-- PowerSync reads the application database through logical replication.
CREATE ROLE powersync_role WITH REPLICATION LOGIN PASSWORD 'powersync';

-- PowerSync keeps its bucket storage in a database of its own.
CREATE ROLE powersync_storage WITH LOGIN PASSWORD 'powersync';
CREATE DATABASE powersync_storage OWNER powersync_storage;

\connect salamifocus
GRANT CONNECT ON DATABASE salamifocus TO powersync_role;
GRANT USAGE ON SCHEMA public TO powersync_role;
ALTER DEFAULT PRIVILEGES FOR ROLE salamifocus IN SCHEMA public GRANT SELECT ON TABLES TO powersync_role;
