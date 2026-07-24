# Builds the frontend and packages it with the PocketBase binary, matching
# scripts/setup.sh's steps (download pinned PocketBase, npm build -> pb_public)
# but as a container image instead of an in-place install.

FROM node:22-alpine AS frontend
WORKDIR /app
COPY scheduler ./scheduler
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM node:22-alpine AS hooks
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY pb_hooks_src ./pb_hooks_src
COPY scripts/build-hooks.mjs ./scripts/build-hooks.mjs
RUN npm run build:hooks

FROM alpine:3.20 AS pocketbase
ARG PB_VERSION=0.30.2
RUN apk add --no-cache curl unzip && \
    case "$(uname -m)" in \
      aarch64|arm64) PB_ARCH=arm64 ;; \
      x86_64|amd64) PB_ARCH=amd64 ;; \
      *) echo "unsupported arch $(uname -m)" >&2; exit 1 ;; \
    esac && \
    curl -fLo /tmp/pb.zip "https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_${PB_ARCH}.zip" && \
    unzip /tmp/pb.zip pocketbase -d /out && chmod +x /out/pocketbase

FROM alpine:3.20
RUN apk add --no-cache ca-certificates
WORKDIR /app
COPY --from=pocketbase /out/pocketbase ./pocketbase
COPY pb_migrations ./pb_migrations
COPY pb_hooks ./pb_hooks
COPY --from=hooks /app/pb_hooks/temp_login.pb.js ./pb_hooks/temp_login.pb.js
COPY --from=frontend /app/pb_public ./pb_public
COPY entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh
EXPOSE 8090
ENTRYPOINT ["./entrypoint.sh"]
