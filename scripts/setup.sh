#!/usr/bin/env bash
# Guard v3 install script (DESIGN.md section 2.4).
#
# Internet is needed ONCE, here, to download the PocketBase binary and to
# `npm ci` + build the frontend. After this script finishes, the app is fully
# offline: PocketBase serves the already-built pb_public/ as static files and
# never makes an outbound request.
#
# Usage: SUPERUSER_EMAIL=you@example.com SUPERUSER_PASSWORD=... ./scripts/setup.sh
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

PB_VERSION="${PB_VERSION:-0.30.2}"
SUPERUSER_EMAIL="${SUPERUSER_EMAIL:?Set SUPERUSER_EMAIL before running this script}"
SUPERUSER_PASSWORD="${SUPERUSER_PASSWORD:?Set SUPERUSER_PASSWORD before running this script}"

if [ "${#SUPERUSER_PASSWORD}" -lt 8 ]; then
  echo "SUPERUSER_PASSWORD must be at least 8 characters (PocketBase requirement)." >&2
  exit 1
fi

case "$(uname -m)" in
  aarch64|arm64) PB_ARCH="arm64" ;;
  x86_64|amd64) PB_ARCH="amd64" ;;
  *) echo "Unsupported architecture: $(uname -m)" >&2; exit 1 ;;
esac

if [ ! -x ./pocketbase ]; then
  echo "==> Downloading PocketBase ${PB_VERSION} (linux_${PB_ARCH})"
  PB_ZIP="pocketbase_${PB_VERSION}_linux_${PB_ARCH}.zip"
  curl -fLo "/tmp/${PB_ZIP}" \
    "https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/${PB_ZIP}"
  curl -fLo "/tmp/${PB_ZIP}.sha256" \
    "https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/checksums.txt"
  (cd /tmp && grep "${PB_ZIP}\$" "${PB_ZIP}.sha256" | sha256sum -c -)
  unzip -o "/tmp/${PB_ZIP}" pocketbase -d .
  chmod +x ./pocketbase
else
  echo "==> ./pocketbase already present, skipping download"
fi

echo "==> Building PocketBase hooks (bundle npm validation dependencies)"
npm ci
npm run build:hooks

echo "==> Building frontend (npm ci && npm run build -> pb_public/)"
(cd frontend && npm ci && npm run build)

echo "==> Applying migrations"
# `migrate up` can print "Error: ..." for an individual bad migration while
# still exiting 0, so grep the output instead of trusting the exit code alone.
migrate_output="$(./pocketbase migrate up 2>&1)"
echo "$migrate_output"
if echo "$migrate_output" | grep -q "Error:"; then
  echo "Migration failed - see errors above." >&2
  exit 1
fi

echo "==> Creating/updating superuser"
superuser_output="$(./pocketbase superuser upsert "$SUPERUSER_EMAIL" "$SUPERUSER_PASSWORD" 2>&1)"
echo "$superuser_output"
if echo "$superuser_output" | grep -q "Error:"; then
  echo "Superuser upsert failed - see errors above." >&2
  exit 1
fi

echo
echo "Setup complete. Start the server with:"
echo "  ./pocketbase serve --http=0.0.0.0:8090"
echo
echo "Test URLs once running:"
echo "  http://localhost:8090            (from within the Debian VM/Termux)"
echo "  http://<forwarded-host-port>:8090 (from the Android host, after enabling"
echo "                                      Terminal app port forwarding)"
echo "  http://<hotspot-ip>:8090          (from a guard's phone on the hotspot -"
echo "                                      verify this first, see DESIGN.md section 9)"
echo
echo "Admin UI: http://localhost:8090/_/"
