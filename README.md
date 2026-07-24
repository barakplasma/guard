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

### k3s / Helm

The Helm chart at `charts/guard` packages the application, its persistent PocketBase data volume,
service, and Cloudflare Tunnel ingress. It uses the same defaults as the manifests in `k8s/`; by
default it exposes the app at `https://guard.526462738.xyz`, matching Readeck's tunnel setup.

Create the required namespace secrets before installing (omit the image-pull secret if the image is
public):

```bash
kubectl create namespace guard
kubectl -n guard create secret generic guard-superuser \
  --from-literal=SUPERUSER_EMAIL=you@example.com \
  --from-literal=SUPERUSER_PASSWORD='choose-a-long-password'
# kubectl -n guard create secret docker-registry ghcr-pull ...
```

Install or upgrade the release:

```bash
helm upgrade --install guard ./charts/guard --namespace guard
```

The chart expects its `guard-superuser` and optional `ghcr-pull` Secrets to already exist. Override
the image, hostname, storage, or disable the ingress in a values file as needed.

### Temporary read-only roster link

PocketBase creates a superuser-only `app_settings` record with a four-digit
`temp_login_code`. Change that value in PocketBase Admin to rotate the
unauthenticated read-only roster URL immediately. PocketBase also rotates it
automatically every day at noon in the `Asia/Jerusalem` timezone.

```text
https://your-host/#/temp-login/1234
```

The page mirrors the guard roster (including past-shift and guard filters) but
does not grant an authenticated session or access to any other collection API.
Zod validates the PocketBase hook configuration while generating its
closure-free JSVM file, and validates the endpoint payload again in the
frontend before it is displayed.

### Container image

GitHub Actions builds the Dockerfile for `linux/amd64` and `linux/arm64`.
Pull requests verify that the image builds; pushes to `main` publish `latest`
and `sha-*` tags to `ghcr.io/barakplasma/guard`, while `v*` tags also publish
matching semantic-version tags.
