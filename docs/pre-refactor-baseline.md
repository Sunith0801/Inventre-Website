# Pre-Refactor Baseline

**Date:** 2026-09-09 (backup snapshot 11:41:49 UTC / 17:11 IST)
**Engineer:** sunith@inventre.in
**Phase:** 0 — Safety checkpoint. No application code, schema, migration or data was changed.
**Branch:** `stop-writing-grade-snapshot`
**HEAD SHA:** `3b066b150e8d7d3ab542a312ee45cfae48e16cf6`
**Production SHA:** ⚠️ **Not determinable — see "Critical caveat" below.**
**Database:** `inventre` @ container `1c61220878ef_inventre-deploy-postgres` (host `127.0.0.1:55433`), PostgreSQL 16.14
**Database backup:** `/root/backups/inventre-pre-refactor-20260909/db/inventre-pre-refactor-20260909.dump`
**Backup verification:** ✅ **VERIFIED** — structural check + full restore into an isolated instance + row-count and schema comparison
**Migration state:** 88 applied, latest `0074_mcb_fee_transactions.sql` (2026-08-27)

---

## Critical caveat — read before any rollback

**The running production code cannot be rebuilt from this repository.**

- Live container BUILD_ID: `PBCFJwPRNO02QUKjmIYgE`
- This checkout's `.next/BUILD_ID`: `rDJB2ZNZy33vD12dL4_ei` (built 2026-07-06, two months stale)
- No build tree anywhere on this host produced the live BUILD_ID — the isolated build checkout it came from was removed.
- The image carries no git SHA, version label or provenance metadata (only Docker Compose labels).
- `scripts/deploy.sh` builds from the **working tree**, which currently differs from `HEAD` by 207 files and from `main` by 244.

**Consequence:** code rollback is **image-based, not git-based.** Git preserves the source we are about to refactor. The Docker image preserves what is actually running. Both are pinned below. Do not assume checking out a tag and rebuilding reproduces production — it does not.

---

## Code State

### Summary vs `HEAD` (`3b066b1`)

| | Count |
|---|---|
| Modified | 202 |
| Untracked | 123 entries (1,273 files when expanded) |
| Deleted | 5 |
| Staged | 0 |
| Stashes | 0 |
| **Total `git status` entries** | **330** |

### Deleted files (recoverable from tag `inventre-pre-refactor-20260909`)

```
1.png
122.png
2.png
ROADMAP_DEFERRED.md
drizzle.config.ts
```

`drizzle.config.ts` is notable — the Drizzle CLI config has been removed from the working tree. This is consistent with migrations being run by the custom `db/migrate.js` runner rather than `drizzle-kit`.

### Preservation artefacts

| Artefact | Ref / ID | Contents |
|---|---|---|
| Annotated tag | `inventre-pre-refactor-20260909` → `4f75984` | Committed baseline at `HEAD` |
| Backup branch | `backup/inventre-pre-refactor-20260909` → `d08747a` | **Verbatim working tree** (all 202 modified + 123 untracked + 5 deletions) |
| Git bundle | `git/inventre-pre-refactor-20260909.bundle` | Complete history, all refs, clone-able standalone |
| Docker image | `inventre-app:rollback-pre-refactor-20260909` | `sha256:a65fed7b8cbc…` — the live artefact, immutably tagged |
| Env files | `env/.env.deploy`, `.env.local`, `.env.example` | Mode 600, outside the repo, outside the Docker build context |

The working-tree snapshot was built with a throwaway index (`GIT_INDEX_FILE`) via `write-tree` / `commit-tree` / `update-ref`. `HEAD`, the index and the working tree were **not** touched — verified by comparing `.git/index` SHA-1 and `git status` count before and after (identical: `4d50eace…`, 330 entries).

**Snapshot fidelity: verified byte-for-byte.** All 1,273 blobs in `d08747a` hash-match the corresponding file on disk (`git hash-object`, NUL-delimited traversal). Nothing differs, nothing is missing.

**Secret hygiene:** the snapshot contains no `.env`, `.pem`, `.key` or secret-bearing file — `.gitignore` excludes them. Env files are preserved separately at mode 600 under `/root/backups/`, which is outside both the repository and the Docker build context.

---

## Runtime State

| | Value |
|---|---|
| Application version | Next.js 15.5.15, Node 20.20.2 |
| Live BUILD_ID | `PBCFJwPRNO02QUKjmIYgE` |
| API health | `{"db":true,"redis":true}` |
| Deployment | container `inventre-deploy-app`, image `inventre-app:latest` = `sha256:a65fed7b8cbc…` |
| Image built | 2026-09-04 11:25:56 UTC |
| Container started | 2026-09-04 11:26:21 UTC (uninterrupted since) |
| Serving | `127.0.0.1:3010`, fronted by nginx (`inventre.in`) |
| Redis | `inventre-deploy-redis` @ `:6390` |
| Connection pooling | `inventre-deploy-pgbouncer` @ `:6433`, transaction mode, max 1000 client conns |

`inventre-app:latest` is a **mutable tag** — the next deploy overwrites it. `inventre-app:rollback-pre-refactor-20260909` is the immutable pin and is the only reliable pointer to the currently-live code.

---

## Database State

| | Value |
|---|---|
| Host (from host machine) | `127.0.0.1:55433` (direct) — **not** pgbouncer `:6433` |
| Host (from app) | `postgres:5432` via `pgbouncer:5432` |
| Database / role | `inventre` / `inventre` |
| Version | PostgreSQL 16.14 (Alpine) |
| Size | 2,795 MB |
| Volume | `inventre-deploy_pgdata` |
| Schemas | `public` (114 base tables), `erp`, `drizzle`, `scratch` — 155 tables total |
| Rows | 2,832,827 at snapshot |
| Orders / students / parents | 31,388 / 24,196 / 24,330 |
| Order value (non-cancelled) | ₹17,35,43,177.16 |

### Migration state

Two ledgers exist. The authoritative one is **not** Drizzle's.

| Ledger | Rows | Meaning |
|---|---|---|
| `public.__schema_migrations` | **88** | ✅ Authoritative — written by `db/migrate.js` |
| `drizzle.__drizzle_migrations` | 1 | Vestigial (last write 2026-05-22) |
| `public.migration_checkpoint` | 4 | |
| `public.migration_errors` | 7 | Worth reviewing separately; not blocking |

- `.sql` files on disk: **84**
- Latest applied: `0074_mcb_fee_transactions.sql` @ 2026-08-27 05:27:23 UTC
- 88 applied > 84 on disk: some applied migrations no longer exist as files, and two files share the `0073_` prefix (`0073_students_disabled_by_closure.sql`, `0073_exchange_missing_pack_dispatch.sql`). **Do not renumber or reconcile these during refactoring** — the runner keys on filename.

---

## Backup Verification

`BACKUP VERIFIED = YES`

A backup is not verified because a command exited 0. All four checks below were run.

**1 · Exists and non-zero** — 219,722,958 bytes (210 MB), custom format, gzip compressed.

**2 · Structurally valid** — `pg_restore --list` exits 0; 980 TOC entries; 155 `TABLE` + 155 `TABLE DATA` (every table has a data section), 264 indexes, 140 FK constraints, 34 types, 16 sequences.

**3 · Restored into an isolated instance** — a throwaway `postgres:16-alpine` container with **no published host port**, ephemeral volume and generated credentials. Globals applied, database created, then:

```
pg_restore --no-owner --no-privileges --exit-on-error --jobs=4   →  exit 0  (12 s)
```

**4 · Compared against production**

| Dimension | Production | Restored |
|---|---|---|
| Tables | 155 | 155 ✅ |
| Indexes | 400 | 400 ✅ |
| Constraints | 279 | 279 ✅ |
| Foreign keys | 140 | 140 ✅ |
| Sequences | 13 | 13 ✅ |
| Functions | 48 | 48 ✅ |
| Triggers | 9 | 9 ✅ |
| Enum types | 34 | 34 ✅ |
| `__schema_migrations` | 88 | 88 ✅ |
| Rows | 2,832,827 | 2,832,835 |

**The 8-row difference is expected and was proven, not assumed.** `pg_dump` takes a single-transaction snapshot; production kept serving traffic afterwards. Evidence:

- Dump snapshot: `2026-09-09 11:41:49 UTC`
- `otp_logs` max `created_at` in the restore: `11:40:56` (before the snapshot)
- `otp_logs` max `created_at` in production: `11:42:39` — a real parent login at `11:42:23 sent` / `11:42:39 verified`, **after** the snapshot
- `cart_items`: restore 5,278 vs production 5,268 — 10 rows removed post-snapshot (checkout conversion / cart cleanup)

The backup is an internally consistent point-in-time image. It is not lossy.

### Chain of custody

SHA-256 verified identical at every hop — inside the source container, on the host after `docker cp`, and inside the verification container:

```
d62d52d16a779928fe2656ce2be03667af68d2e6a1c7330fbacd80aa64418e4c   inventre dump
019304aa0904515b23501179556aa04ff0da0d0317c9528a352168196f35a713   globals
d5a3be611711dc48726737a9226df167a3c8fdd14703ef908b19d849ab9517cf   git bundle
```

Full manifest: `/root/backups/inventre-pre-refactor-20260909/SHA256SUMS`

---

## Recovery

### Code recovery — image-based (the real path)

```bash
# 1. Stop the bad container
docker stop inventre-deploy-app && docker rm inventre-deploy-app

# 2. Restore the pinned artefact to the tag compose expects
docker tag inventre-app:rollback-pre-refactor-20260909 inventre-app:latest

# 3. Bring it back up
cd /root/Inventre
docker-compose -p inventre-deploy --env-file .env.deploy \
  -f docker-compose.deploy.yml up -d --no-deps app

# 4. Verify — must return PBCFJwPRNO02QUKjmIYgE
curl -s http://127.0.0.1:3010/api/version
curl -s http://127.0.0.1:3010/api/health
```

Recovery does **not** depend on remembering which files changed.

### Source recovery — for the refactoring work itself

```bash
cd /root/Inventre

# Committed baseline
git checkout inventre-pre-refactor-20260909

# The full uncommitted working tree as it stood on 2026-09-09
git checkout backup/inventre-pre-refactor-20260909

# Restore a single file (e.g. one of the 5 deletions)
git checkout inventre-pre-refactor-20260909 -- drizzle.config.ts

# If .git itself is lost — the bundle is a complete standalone clone source
git clone /root/backups/inventre-pre-refactor-20260909/git/inventre-pre-refactor-20260909.bundle recovered
```

### Environment recovery

```bash
cp -a /root/backups/inventre-pre-refactor-20260909/env/.env.deploy /root/Inventre/.env.deploy
chmod 600 /root/Inventre/.env.deploy
```

### Database recovery

```bash
BK=/root/backups/inventre-pre-refactor-20260909/db
PGC=1c61220878ef_inventre-deploy-postgres

# ALWAYS restore through the DIRECT port/container, never pgbouncer (:6433) —
# transaction pooling breaks pg_restore.

# 1. Verify the artefact first
cd /root/backups/inventre-pre-refactor-20260909 && sha256sum -c SHA256SUMS

# 2. Stop the app so nothing writes mid-restore
docker stop inventre-deploy-app

# 3. Copy the dump in
docker cp "$BK/inventre-pre-refactor-20260909.dump" $PGC:/tmp/

# 4. Restore into a NEW database first, verify, then swap. Never restore
#    directly over the live `inventre` database.
docker exec $PGC sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" createdb -U "$POSTGRES_USER" inventre_restored'
docker exec $PGC sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" pg_restore -U "$POSTGRES_USER" \
  -d inventre_restored --no-owner --no-privileges --exit-on-error --jobs=4 \
  /tmp/inventre-pre-refactor-20260909.dump'

# 5. Verify: 155 tables, 88 migration rows, 31,388 orders
# 6. Swap under change control:
#      ALTER DATABASE inventre RENAME TO inventre_broken_<ts>;
#      ALTER DATABASE inventre_restored RENAME TO inventre;
# 7. docker start inventre-deploy-app
```

---

## Recovery Rehearsal — performed, not assumed

The full path was executed end-to-end on 2026-09-09 before this document was written.

1. Spun up an isolated `postgres:16-alpine` (no host port, ephemeral volume, generated credentials).
2. Restored the backup into it — `pg_restore` exit 0.
3. Booted **the pinned rollback image** against that restored database, on an isolated Docker network, with ERP ingest, ERP polling, SMS and SMTP neutralised, on `127.0.0.1:3099`.
4. Observed: `[migrate] up to date (84 migrations)` → `Next.js 15.5.15 ✓ Ready in 106ms`.

| Probe | Result |
|---|---|
| `/api/health` | `{"db":true,"redis":true}` |
| `/api/version` | `PBCFJwPRNO02QUKjmIYgE` — **identical to live** |
| `GET /` | 200, 64,949 bytes rendered |
| `GET /admin/login` | 200 |
| `GET /shop` | 307 (auth redirect — session guard working) |

5. Rehearsal environment destroyed; the dump artefact retained.
6. Production confirmed untouched: same container start time (2026-09-04, never restarted), health OK, `git status` still exactly 330 entries, `HEAD` unchanged.

**The recovery path is proven, not theoretical.**

---

## Important Warning

Do not restore a production database backup into production without following the approved recovery / change-management procedure.

Specifically for this system:

- Restore into a **new database name** and verify before swapping. Never `pg_restore` over the live `inventre` database.
- Always use the **direct** connection (container `1c61220878ef_inventre-deploy-postgres` / host `:55433`). pgbouncer on `:6433` runs in transaction-pooling mode and will corrupt or fail a restore.
- **Restoring this backup rolls the database back to 2026-09-09 11:41:49 UTC.** Every order, payment, OTP, cart and ERP event after that moment is lost. Production takes live traffic continuously — take a fresh dump immediately before any restore so the delta can be reconciled.
- Restoring the database **without** also rolling back the application image, or vice versa, can produce a schema/code mismatch. Roll both back together, or confirm compatibility first.
- The 210 MB dump and the env files under `/root/backups/` contain complete customer PII and live credentials. Mode 600, never commit, never copy into the repository or the Docker build context.

---

## Phase 0 Checklist

- [x] Current Git state captured
- [x] Recovery branch/tag created (tag `inventre-pre-refactor-20260909` + branch `backup/inventre-pre-refactor-20260909` + standalone bundle)
- [x] Production/deployed SHA identified — **as an image digest; no git SHA exists.** Pinned as `inventre-app:rollback-pre-refactor-20260909`
- [x] Database backup completed (210 MB custom format + globals)
- [x] Backup verified (structural + full isolated restore + row/schema comparison)
- [x] Restore procedure documented **and rehearsed end-to-end**
- [x] Baseline document created

**Phase 0 complete. Awaiting explicit approval before Phase 1 (F-01).**

---

## Open items surfaced during Phase 0

Not blockers for Phase 1, but they change how rollback must be handled and should be fixed early:

1. **No build → commit provenance.** Nothing links a deployed image to source. Stamping the git SHA into the image at build time and exposing it at `/api/version` would make "what is live?" answerable. This is audit finding F-07.
2. **`db/migrate.js` is a committed 77 KB build artefact** with `node_modules/postgres` inlined. It is the real migration runner, so it must be treated as production code despite being generated.
3. **`public.migration_errors` holds 7 rows.** Not investigated in Phase 0. Review before any migration work.
4. **Backups are local-only.** `/root/backups/` sits on the same host and the same disk as production. This is a checkpoint, not a disaster-recovery strategy — a host loss takes both. Copy off-box before relying on it.
