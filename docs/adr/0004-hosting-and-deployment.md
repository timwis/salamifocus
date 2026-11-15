---
status: accepted
date: 2026-11-13
status_note: "Accepted by the user on 13 November 2026 (ticket 04). Rebuilding PowerSync's storage rather than backing it up was accepted after a restore drill on the deployed stack the same day."
---

# Hosting, reachability and backups

salamifocus has a single user whose phone and desktop browsers need HTTPS access from anywhere, with a stack that stays portable between hosts and providers so later features can be tried in daily use. Run Postgres, PowerSync and the app server in Docker Compose on one self-managed server, reached through a private mesh VPN, with nightly off-site backups of application data and recordings and PowerSync storage rebuilt on restore. The measured stack fits a small machine and avoids the greater provider dependence of managed Postgres plus hosted PowerSync.

## Considered Options

The ticket's default was one small self-managed server running everything in containers. The alternative was managed Postgres plus hosted PowerSync: less operations work, more dependence on providers. ADR 0001 measured the self-hosted stack at a few hundred MiB of memory at idle, which fits a small machine.

## Consequences

1. **One self-managed server, everything in containers.** Postgres, the PowerSync service and the app server run together from one Docker Compose file on a single home server. Postgres holds both the application data and PowerSync's bucket storage, in separate databases. Moving to another host means copying the Compose file, its environment and a backup.

2. **Reachable only over a private network for now.** The server is reached through a private mesh VPN (Tailscale). Every device that uses salamifocus joins it, and the VPN is what makes "away from home" work. Nothing is exposed to the public internet.
   - An existing HTTPS reverse proxy on the server terminates TLS for a hostname that resolves to the server's VPN address. The app server joins the proxy's Docker network. Postgres and PowerSync stay on the stack's internal network.
   - **The app server is the only exposed service.** It already proxies PowerSync under `/powersync` (ADR 0003), and it also serves the built web client. Each client therefore needs exactly one address.
   - **There is one canonical address.** A browser keeps the local database per origin, so reaching the same server under two hostnames would give two separate local copies and two sign-ins. Every client uses the same address.

3. **Images are built in CI and pulled by the server.** GitHub Actions builds the app server image, which includes the built web client, and publishes it to the GitHub Container Registry as a public package. Postgres uses its pinned upstream image. PowerSync uses its pinned upstream image with this repository's configuration and sync rules added, published alongside the app server image and tagged with the same commit, so the rules always match the server that writes the data. Updating is a manual pull and restart on the server. Migrations run when the server starts.

4. **Secrets live in a secrets manager, never in the repository.** The repository carries the Compose file and an example environment file with placeholders. On the server, the environment file holds references to secrets, and those are resolved when the stack starts (for example with 1Password's `op run`). Hostnames, paths and vault names exist only on the server.

5. **Backups use the host's existing backup tool, nightly and off-site.** The backup tool runs on the host and takes a logical dump of the application database by running `pg_dump` inside the Postgres container, so Postgres publishes no port. It also backs up the host directory where recordings are stored (ticket 21). The Postgres container has a fixed name so that command is stable.

6. **PowerSync's bucket storage is not backed up.** Its contents are derived from the application database. Logical replication slots are not part of a dump either, so a restored copy of PowerSync's storage would not match the restored source anyway. On restore, PowerSync starts with empty storage and re-replicates from the restored application database, and clients re-sync. The restore drill confirmed this. Clients that held data uploaded after the backup dropped it and matched the restored server. Changes still queued on a client were uploaded and applied after the restore.

7. **Android release builds have no default server address.** The user enters the address on the sign-in screen, or supplies it at build time from outside the repository. Builds are signed with a keystore whose passwords come from the secrets manager, and installed on the user's own device by sideloading. Debug builds keep the emulator default from ADR 0003.

- Devices that cannot join the private network cannot use salamifocus, for example a managed work laptop or a cloud-hosted agent calling the API or MCP interface (tickets 26 to 28). Exposing the app publicly is a later decision. Options considered:
  - **Tailscale Funnel** on a dedicated, isolated node: public HTTPS with TLS ending on the server, but on a `ts.net` hostname.
  - **Cloudflare Tunnel with Access:** a custom domain and an extra login layer, but Cloudflare sees plaintext, and Access sits awkwardly in front of token-authenticated clients.
  - **Enrolling the device** in the private network, restricted to this one service.

  Whichever is chosen must keep a single canonical address for all clients.
- An agent running on the same server, for example in a container, can reach the app server over the shared Docker network.
- The app's own sign-in is not the only line of defence while the app is private, but sign-in rate limiting is added now anyway. It becomes essential if the app is ever exposed publicly.
- The setup depends on the private network provider only for reachability. The stack, data and backups don't depend on it.
