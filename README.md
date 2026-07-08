# guard

## Hosting

The v3 app (PocketBase + built React/MUI frontend, see `CLAUDE.md`) runs directly on this
Hetzner VPS node (hostname `k3s`), not on a phone/hotspot as `DESIGN.md`'s original plan assumed.

- **Process**: `./pocketbase serve --http=0.0.0.0:8090`, working directory `/root/guard`.
- **Service manager**: systemd **user** unit `guard.service`
  (`~/.config/systemd/user/guard.service`, sourced from `scripts/guard.service`).
  Manage with `systemctl --user {status,restart,stop} guard` and view logs with
  `journalctl --user -u guard.service`.
- **Access**:
  - Locally on the host: `http://localhost:8090`
  - Over Tailscale: `http://k3s.tail38a4e.ts.net:8090` (or `http://100.124.119.42:8090`)
  - Admin UI: `<base-url>/_/`
  - Not exposed via the Cloudflare tunnel / public internet — no k8s Ingress exists for it.
- **Data**: `pb_data/` (SQLite, gitignored) holds all app + auth data and PocketBase's own
  settings/request-log tables; `pb_public/` (gitignored) is the built frontend PocketBase serves
  as static files.
- **(Re)deploy**: `scripts/setup.sh` downloads the pinned PocketBase binary, builds the frontend
  into `pb_public/`, runs `./pocketbase migrate up`, and upserts the superuser — safe to re-run.
  `pb_hooks/*.js` hot-reload on change without a restart; new files under `pb_migrations/` need
  `./pocketbase migrate up` (or a service restart) to apply.