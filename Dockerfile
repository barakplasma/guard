# Serves the pre-built static shift planner with Caddy.
# CI builds dist/ before invoking docker build, so the statics are baked in —
# no runtime build, no node, just Caddy + files.
#
# Run:
#   docker run -p 80:80 ghcr.io/barakplasma/guard:latest
#   docker run -e DOMAIN=guard.example.com -p 80:80 -p 443:443 ghcr.io/barakplasma/guard:latest

FROM caddy:2-alpine

LABEL org.opencontainers.image.title="Guard Shift Planner"
LABEL org.opencontainers.image.description="Static shift planner served by Caddy with automatic HTTPS"
LABEL org.opencontainers.image.source="https://github.com/barakplasma/guard"
LABEL org.opencontainers.image.licenses="MIT"

COPY Caddyfile /etc/caddy/Caddyfile
COPY dist/ /srv/
