# syntax=docker/dockerfile:1.6
# The leading directive enables BuildKit cache mounts below. With it, code-only
# redeploys reuse the npm cache + the Next.js incremental compile cache — drops
# a clean rebuild from ~5 min to ~90 s. Build is otherwise hermetic.

# ─── deps ───
FROM node:20-alpine AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY package.json package-lock.json* ./
# Persist npm's download/extraction cache across builds. Lockfile-driven (`npm ci`)
# so the cache only speeds up the install — it can't change which versions resolve.
RUN --mount=type=cache,target=/root/.npm,sharing=locked \
    npm ci --prefer-offline

# ─── builder ───
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Persist Next.js's incremental compile cache. SWC reuses prior transforms for
# files that didn't change between builds; first build still cold, subsequent
# code-only builds are dramatically faster.
RUN --mount=type=cache,target=/app/.next/cache,sharing=locked \
    npm run build
# Compile the file-based migrator to plain JS so the runner image doesn't
# need tsx. Only `postgres` is external (kept as a runtime require); fs/path
# are node built-ins. drizzle-orm is no longer used by the migrator.
RUN npx --yes esbuild db/migrate.ts \
      --bundle --platform=node --target=node20 \
      --outfile=.next/standalone/db/migrate.js \
      --external:postgres

# ─── runner ───
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# Migration SQL must be present at runtime; standalone build doesn't include it.
COPY --from=builder --chown=nextjs:nodejs /app/db/migrations ./db/migrations
# The migrator was bundled with `postgres` as an external, so the module
# must be reachable at runtime. Next.js standalone DOES include `postgres`
# (db/client.ts uses it), but copy explicitly to be deterministic regardless
# of Next's trace heuristics.
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/postgres ./node_modules/postgres
COPY --chown=nextjs:nodejs scripts/start.sh /app/start.sh
# Defensive: strip any CR so a Windows (CRLF) checkout can't break the
# shebang inside the Linux container (exec → "/bin/sh\r: not found", exit 127).
RUN sed -i 's/\r$//' /app/start.sh && chmod +x /app/start.sh

USER nextjs
EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0
CMD ["/app/start.sh"]
