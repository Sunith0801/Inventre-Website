#!/bin/bash
# Production deploy: build on host (reuses .next/cache), sync into container, restart.
#
# Modes:
#   ./scripts/deploy.sh         — full deploy: build → stop+rm+compose-recreate → sync → start.
#                                 Required when .env.deploy or docker-compose.deploy.yml
#                                 changed (env / command / volume changes only apply via
#                                 recreate).
#   ./scripts/deploy.sh --fast  — code-only deploy: build → docker cp into the live
#                                 container → docker restart. Skips compose recreate
#                                 (~20-30s saved). Safe whenever only application
#                                 code / Next assets changed.
#
# Typical time:
#   full  — 3-4 min first run, ~90s for code-only changes with warm cache.
#   fast  — ~build time + ~10s.

set -e
cd "$(dirname "$0")/.."

MODE="full"
for arg in "$@"; do
  case "$arg" in
    --fast) MODE="fast" ;;
    --full) MODE="full" ;;
  esac
done

START=$(date +%s)

echo "▶ Building (${MODE} mode)…"
# Override DB URL so static-page generation reaches the host-mapped port
# instead of timing out on the Docker-internal 'pgbouncer' hostname.
# NEXT_DIST_DIR pinned: .env.local points dev servers at .next-dev so they
# can't corrupt prod bundles mid-build (2026-06-12 outage); the explicit env
# here outranks .env.local and keeps the deploy build in .next.
DATABASE_URL="postgres://inventre:inventre_prod@localhost:6433/inventre" \
DATABASE_DIRECT_URL="postgres://inventre:inventre_prod@localhost:55433/inventre" \
NEXT_DIST_DIR=".next" \
  npm run build

echo "▶ Bundling migrations…"
npx esbuild db/migrate.ts \
  --bundle --platform=node --target=node20 \
  --outfile=.next/standalone/db/migrate.js 2>/dev/null

if [ "$MODE" = "full" ]; then
  echo "▶ Stopping container…"
  docker stop inventre-deploy-app 2>/dev/null || true

  echo "▶ Removing old container (force-recreate with correct config)…"
  docker rm inventre-deploy-app 2>/dev/null || true

  echo "▶ Creating container with correct config…"
  # --force-recreate ensures command/env changes from compose file are applied.
  docker-compose -p inventre-deploy --env-file .env.deploy -f docker-compose.deploy.yml up \
    --no-deps --no-start --force-recreate app

  # docker-compose with --no-deps + single-service --force-recreate
  # occasionally attaches the new container to ONLY the external network
  # declared in the compose file (erp-staging_default in our case) and
  # drops the project's default network — where postgres / redis / minio
  # service-name lookups happen. Without this reconnect the next boot
  # crashes migrations with `getaddrinfo EAI_AGAIN postgres`. The connect
  # is a no-op when the attachment is already present.
  docker network connect inventre-deploy_default inventre-deploy-app 2>/dev/null || true
fi

# Ensure container is running so we can stream tar through `docker exec`.
# In fast mode it's whatever state it was in (probably running); in full
# mode it was just force-recreated with --no-start, so it's Created.
# `docker start` is a no-op if already running.
docker start inventre-deploy-app >/dev/null 2>&1 || true

echo "▶ Syncing build into container…"
# Standalone output → /app (server.js, .next/server/, node_modules/)
#
# We stream tar through `docker exec tar -x --overwrite` rather than
# `docker cp`. Two reasons:
#
#  1. The standalone tree contains pnpm-style symlinks
#     (node_modules/@aws-sdk/client-s3 → ../.pnpm/@aws-sdk+…) which
#     `docker cp` packs as symlink entries; the daemon's tar extractor
#     then rejects them when the destination already has a real dir at
#     the same path ("cannot overwrite directory … with non-directory").
#  2. Even with -h to dereference, the new build's pnpm layout often has
#     leaf files where the previous build had subdirs (or vice-versa);
#     `docker cp`'s extractor errors on those conflicts, but GNU tar's
#     `--overwrite` deletes the conflicting target first and proceeds.
#
# Running tar inside the container also avoids the daemon-side tar
# extractor entirely, so we get to pick the conflict policy ourselves.
# Node holds previously-loaded modules in memory, so overlaying its own
# source files mid-flight is safe — we restart at the end anyway.
#
# Symlinks are preserved (no -h/--hard-dereference). The standalone tree
# is pnpm-layout: node_modules/@aws-sdk/client-s3 is a symlink into
# .pnpm/<pkg>@<ver>/node_modules/, and Node resolves that package's deps
# against its REAL path's siblings. Dereferencing the top-level symlink
# into a plain copy made its require('@smithy/core') resolve against
# whatever stale /app/node_modules/@smithy/core a previous deploy left
# behind — which broke prod uploads on 2026-06-11 with "Package subpath
# './client' is not defined" when a new @aws-sdk needed a newer
# @smithy/core than the leftover.
#
# The container's tar is BusyBox (no --recursive-unlink), so symlinks
# can't replace the real dirs older --hard-dereference deploys created
# in place. Instead, wipe node_modules and extract fresh: a pristine
# tree every deploy, nothing stale to shadow resolution. Node keeps
# already-loaded modules in memory, so the running process survives the
# ~seconds-long gap until the restart below picks up the new tree.
docker exec -u 0 inventre-deploy-app rm -rf /app/node_modules
( cd .next/standalone && tar -cf - . ) \
  | docker exec -i -u 0 inventre-deploy-app tar -xf - --overwrite -C /app

# @node-rs/bcrypt ships per-platform native bindings; the build host is
# glibc (linux-x64-gnu) but the container is Alpine (musl). npm skips
# the wrong-libc variant at install time, so Next.js's standalone trace
# only carries the gnu .node binding — and Alpine then 'MODULE_NOT_FOUND's
# on the bcrypt require. Push the musl binding in explicitly. The
# pre-extracted dir lives in host node_modules after the manual
# `npm pack @node-rs/bcrypt-linux-x64-musl` we ran on 2026-05-26.
if [ -d node_modules/@node-rs/bcrypt-linux-x64-musl ]; then
  docker exec inventre-deploy-app mkdir -p /app/node_modules/@node-rs 2>/dev/null || true
  docker cp node_modules/@node-rs/bcrypt-linux-x64-musl \
    inventre-deploy-app:/app/node_modules/@node-rs/
fi
# Wipe the static tree before we re-copy — without this, docker cp
# into the existing /app/.next/static path leaves stale chunk files
# from prior builds. Next emits new content-hashed chunks every
# build and the page HTML references them by exact name, so a
# leftover-only tree causes 404s ("ChunkLoadError: Loading chunk
# 4520 failed.") in the browser.
docker exec inventre-deploy-app rm -rf /app/.next/static 2>/dev/null || true
docker cp .next/static inventre-deploy-app:/app/.next/
# Public directory (robots.txt, favicon, etc.)
docker cp public inventre-deploy-app:/app/public
# start.sh entry point (standalone output doesn't include scripts/ dir)
mkdir -p /tmp/_deploy_scripts && cp scripts/start.sh /tmp/_deploy_scripts/
docker cp /tmp/_deploy_scripts inventre-deploy-app:/app/scripts
# Migration SQL files (referenced at runtime by migrate.js)
#
# Trailing `/.` on the source + trailing `/` on the dest tells docker cp to
# merge *contents* rather than nest. Without it, when /app/db/migrations
# already exists in the container, docker cp creates
# /app/db/migrations/migrations/ and any newly added .sql file gets
# stranded there — the migrator reads only the top level, so the file
# silently never runs. (Hit this for migration 0059 on 2026-06-11.)
docker cp db/migrations/. inventre-deploy-app:/app/db/migrations/

echo "▶ Restarting to load synced code…"
# Container was running through the sync (so we could docker-exec tar -x);
# its node process is still holding the previous build's loaded modules.
# Restart picks up the freshly-synced files. Capture the restart timestamp
# so the ready-signal check below only looks at NEW logs — otherwise it
# would match "Ready in …" from the pre-sync boot and return instantly.
RESTART_TS=$(date +%s)
docker restart inventre-deploy-app >/dev/null

echo "▶ Waiting for ready signal…"
for i in $(seq 1 30); do
  if docker logs inventre-deploy-app --since "$RESTART_TS" 2>&1 | grep -q "Ready in\|started server\|Listening"; then
    break
  fi
  sleep 2
done

END=$(date +%s)
echo ""
echo "✓ Deployed in $((END - START))s (${MODE} mode)"

# Show the actual user-facing URL (read APP_PUBLIC_URL from .env.deploy,
# fall back to the host's :3010 port-map). Avoid dumping `docker logs` here
# because Next.js's startup banner prints "Local: http://localhost:3000"
# which is the container's internal binding, not the public address —
# confusing when you're verifying a server deploy.
PUBLIC_URL=$(grep -E '^APP_PUBLIC_URL=' .env.deploy | head -1 | cut -d= -f2- | tr -d '"' || true)
echo "   Public:   ${PUBLIC_URL:-(APP_PUBLIC_URL not set — set in .env.deploy)}"
echo "   Host:     http://$(hostname -I 2>/dev/null | awk '{print $1}'):3010"
echo "   Container: localhost:3000 (internal — not user-facing)"

# Confirm the container actually finished booting; surface only the
# "Ready in …" line, never the localhost/network banner.
docker logs inventre-deploy-app --tail 20 2>&1 | grep -E '✓ Ready in|✗ |Error:' | tail -3 || true
