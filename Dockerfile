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

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD ["curl", "--fail", "--silent", "--show-error", "--output", "/dev/null", "http://127.0.0.1/"]

# The base image grants Caddy permission to bind ports 80 and 443, while its
# runtime data directories are writable by an unprivileged process.
USER 10001:10001
