# Deploying and restoring

How salamifocus is run on a single server, kept up to date, backed up and restored. [ADR 0004](adr/0004-hosting-and-deployment.md) explains why it is done this way. Everything specific to one deployment, such as hostnames, paths and where secrets are kept, lives only on the server. The examples here use placeholders.

The stack is [`deploy/compose.yml`](../deploy/compose.yml):

- **Postgres** holds the application database and PowerSync's storage database. It publishes no port.
- **PowerSync** runs from an image that carries this repository's sync rules.
- **The app server** serves the web client, the API and sync (proxied to PowerSync under `/powersync`). It is the only service the reverse proxy reaches, on port 3100.

CI publishes both images to GHCR from every push to `main` that passes the checks: `ghcr.io/<owner>/salamifocus` and `ghcr.io/<owner>/salamifocus-powersync`. Each image is tagged `latest` and `sha-<commit>`.

## What the server needs

- Docker with Compose 2.23 or later.
- An HTTPS reverse proxy that runs in Docker, on a network the stack can join.
- A way to put secrets into the environment when the stack starts. The examples use 1Password's `op run`.
- A backup tool on the host. The examples use borgmatic.

## First deploy

1. **Make the packages public.** After CI first publishes the images, open each package's settings on GitHub and set its visibility to public. New packages start private.
2. **Create the secrets** in your secrets manager:
   - four database passwords: `POSTGRES_PASSWORD`, `SALAMIFOCUS_DB_PASSWORD`, `POWERSYNC_DB_PASSWORD` and `POWERSYNC_STORAGE_DB_PASSWORD`. They go into connection URLs, so use letters and digits only;
   - `OWNER_PASSWORD_HASH`, from `pnpm --filter @salamifocus/server hash-password`;
   - `SIGNING_KEY`, from `openssl genpkey -algorithm ed25519`. Store the whole PEM; the line breaks may be dropped.

   Clients' sessions survive a server rebuild only if the signing key stays the same. Postgres reads its passwords only when the data directory is first created.
3. **Copy the files.** Put `deploy/compose.yml` in a directory on the server, and next to it put `deploy/.env.example` saved as `.env`. Fill in `.env`: image names, host directories, the proxy's network, and secret references rather than secret values.
4. **Create the host directories.** The app runs as uid 1000, so give it the media directory:

   ```sh
   mkdir -p <DATA_DIR> <MEDIA_DIR> && chown 1000:1000 <MEDIA_DIR>
   ```

5. **Start the stack.** Postgres creates its roles and databases the first time. The app server runs migrations each time it starts, and PowerSync begins replicating once the app is healthy.

   ```sh
   op run -- docker compose up -d --wait
   ```

6. **Route the hostname** to the app server with the snippet in [`deploy/Caddyfile.example`](../deploy/Caddyfile.example), then reload the proxy.
7. **Check it works.** `curl https://<hostname>/api/health` should return `{"ok":true}`. Then sign in from a browser and from the phone.

Every client must use the same address. A browser keeps its local copy of the data per origin, so a second hostname for the same server would mean a second copy and a second sign-in.

## Updating

```sh
docker compose pull
op run -- docker compose up -d --wait
```

To pin a build or roll back, set `VERSION=sha-<commit>` in `.env`. Migrations only move forward, so a rollback past a migration needs a restore. When `deploy/compose.yml` changes, copy it over again.

## Backups

Merge [`deploy/borgmatic.example.yaml`](../deploy/borgmatic.example.yaml) into the host's borgmatic configuration. Each run then:

- takes a `pg_dump` of the `salamifocus` database by running it inside the Postgres container;
- backs up the media directory directly.

PowerSync's storage database is not backed up, because it is rebuilt from the application database. Replication slots are not in a dump either.

To check that a backup holds the dump:

```sh
borgmatic list --archive latest | grep postgresql_databases
```

## Restoring

Changes uploaded after the backup was taken are lost. In the drill, a client that already held such data dropped it once it reconnected, matching the restored server. Changes a client made while the server was down, and had not yet uploaded, were uploaded after the restore and applied. Only changes to records that are missing from the backup would be rejected.

### Into the running stack

Stop the app and PowerSync, so no client writes during the restore:

```sh
docker compose stop app powersync
```

Discard PowerSync's derived state, so it re-replicates from the restored database:

```sh
docker exec -i salamifocus-postgres psql -v ON_ERROR_STOP=1 -U postgres -d postgres <<'SQL'
SELECT pg_drop_replication_slot(slot_name) FROM pg_replication_slots WHERE slot_name LIKE 'powersync%';
DROP DATABASE powersync_storage WITH (FORCE);
CREATE DATABASE powersync_storage OWNER powersync_storage;
SQL
```

Restore the database (and, if needed, the media directory), then start everything again:

```sh
borgmatic restore --archive latest --data-source salamifocus
op run -- docker compose up -d --wait
```

Clients then re-sync without signing in again.

### Onto a new server

1. Follow the first-deploy steps up to creating the directories. Use the same secrets, so existing sessions keep working.
2. Start only Postgres, which creates empty databases and roles:

   ```sh
   op run -- docker compose up -d --wait postgres
   ```

3. Restore and start the rest:

   ```sh
   borgmatic restore --archive latest --data-source salamifocus
   op run -- docker compose up -d --wait
   ```

4. Restore the media directory with `borgmatic extract` if it was lost too.

## Installing the Android app

The phone runs a release build, signed with your own key and installed over USB. A release build has no default server address, so you type it on the sign-in screen. To build one with the address filled in, set `salamifocus.releaseServerUrl=https://<hostname>` in `~/.gradle/gradle.properties`.

**Once, create a signing key** outside the repository, and keep its password in your secrets manager:

```sh
keytool -genkeypair -keystore ~/.android/salamifocus-release.p12 -storetype PKCS12 \
  -alias salamifocus -keyalg RSA -keysize 4096 -validity 10000 -dname "CN=salamifocus"
```

Keep a copy of the keystore file somewhere safe too. Updates must be signed with the same key. Without it, the app has to be uninstalled first, which discards anything on the phone that has not synced.

**To build**, put the keystore location and a reference to its password in an environment file outside the repository:

```sh
SALAMIFOCUS_KEYSTORE=/absolute/path/to/salamifocus-release.p12
SALAMIFOCUS_KEYSTORE_PASSWORD="op://<vault>/<item>/password"
```

Then, from `android/`:

```sh
op run --env-file=<that file> -- ./gradlew assembleRelease
adb install -r app/build/outputs/apk/release/app-release.apk
```

A debug build of the app is signed with a different key, so remove it first with `adb uninstall dev.salamifocus`. The phone must be connected to the private network to reach the server.
