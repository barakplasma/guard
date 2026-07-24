#!/bin/sh
set -eu

./pocketbase migrate up

if [ -n "${SUPERUSER_EMAIL:-}" ] && [ -n "${SUPERUSER_PASSWORD:-}" ]; then
  ./pocketbase superuser upsert "$SUPERUSER_EMAIL" "$SUPERUSER_PASSWORD"
fi

exec ./pocketbase serve --http=0.0.0.0:8090
