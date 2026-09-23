# Inventre

E‑commerce platform for school uniforms + books. Parents log in by phone,
see catalog filtered to their child's school and grade, build orders
(many via the "Magic Box" bundle configurator), and pay through
CCAvenue. The local DB is the source of truth; an ERP bridge keeps
ERPNext (production fulfilment) in sync.

- **Stack**: Next.js 15 (App Router) · TypeScript · Drizzle ORM · Postgres 16 · Redis · MinIO/R2 · CCAvenue
- **Live prod**: <https://inventre.in>
- **Staging**: <https://test.inventre.in>
- **Architecture**: `docs/architecture/Inventre-HLD-v1.5.pdf` (high-level) and `docs/architecture/Inventre-LLD-v1.5.pdf` (low-level); sources in `docs/architecture/design-docs/`. Superseded plans live in `docs/history/`.

---

## 1. Prerequisites

Install these on your laptop before doing anything else.

| Tool | Why | macOS | Windows | Linux |
|---|---|---|---|---|
| **Node.js 20.x LTS** | App runtime + scripts | `brew install node@20` | [installer](https://nodejs.org/en/download/) | `nvm install 20` |
| **Docker Desktop** (or Docker Engine + Compose plugin) | Postgres, Redis, MinIO containers | [Docker Desktop](https://www.docker.com/products/docker-desktop) | Docker Desktop + WSL2 | `docker.io` + `docker-compose-plugin` |
| **Git** | Source control | `brew install git` | [Git for Windows](https://git-scm.com/) | `apt install git` |
| **PostgreSQL client tools** *(optional — needed for `pg_restore`/`psql` from your host)* | DB backup + restore | `brew install libpq && brew link --force libpq` | Comes with [PostgreSQL installer](https://www.postgresql.org/download/) | `apt install postgresql-client-16` |

**Versions used in production:** Node 20 (Alpine) · Postgres 16 · Redis 7 · Next.js 15.5.

> **Windows note:** strongly recommend running everything inside **WSL2** (Ubuntu). The repo expects POSIX‑style paths in `scripts/`. PowerShell will work for `npm` but compose volume binds get awkward.

---

## 2. Clone

```bash
git clone https://github.com/mahendrateja95/Inventre.git
cd Inventre
git checkout wip/tc-fees-payment-logs   # or main, whichever you're targeting
```

---

## 3. Install dependencies

```bash
npm install
```

This installs ~1,200 packages. Takes 1–3 minutes. If you see warnings about peer deps or audit issues, those are non‑fatal.

> **Native module note:** `@node-rs/bcrypt` ships per‑platform binaries (linux‑x64‑gnu, darwin‑arm64, etc.). npm picks the one that matches your laptop automatically. No build tooling required on your end.

---

## 4. Environment variables

```bash
cp .env.example .env.local
```

Open `.env.local` and fill in the **minimum required values** for local dev. Most external integrations can be left blank — the code falls back to console‑logging OTPs, stub email, etc.

### Must‑set (local dev won't start without these)

```ini
DATABASE_URL=postgres://inventre:inventre_dev@localhost:6432/inventre
DATABASE_DIRECT_URL=postgres://inventre:inventre_dev@localhost:55432/inventre
REDIS_URL=redis://localhost:6379

# Generate fresh with:  openssl rand -base64 32
AUTH_SECRET=<paste 32+ random bytes here>
JWT_SECRET=<paste 32+ different random bytes here>

NEXT_PUBLIC_APP_URL=http://localhost:3000

# Object storage — MinIO (bundled in docker-compose.yml). Leave as-is for dev.
S3_ENDPOINT=http://localhost:9000
S3_REGION=us-east-1
S3_BUCKET=inventre
S3_ACCESS_KEY_ID=inventre
S3_SECRET_ACCESS_KEY=inventre_dev_secret
S3_PUBLIC_URL=http://localhost:9000/inventre
```

### Safe to leave blank in dev

| Var | What happens if blank |
|---|---|
| `MSG91_AUTH_KEY` / `SMS_API_*` | OTPs get **`console.log`'d** instead of sent. Pick the code from your terminal during sign‑in. |
| `RESEND_API_KEY` / `SMTP_*` | Email is stubbed; recovery flow uses the `OTP_BYPASS_CODE` instead. |
| `CCAVENUE_*` | `/api/checkout/ccavenue/*` returns 503; use COD path or set `PAYMENT_BYPASS=1` to simulate success. |
| `MCB_*` (MyClassBoard) | MCB sync skipped. |
| `ERPNEXT_BASE` / `ERPNEXT_TOKEN` | **Legacy host is retired in prod**; leave blank in dev. Has no effect after the 2026‑05 migration to the local `delivery_fee_rules` table. |
| `S3_*` for R2 | Use MinIO defaults; only switch to Cloudflare R2 when you genuinely need to test prod media. |

### Optional but useful for dev

```ini
# Fixed OTP code returned when SMS/email are stubbed.
# Lets you log in / recover without watching terminal output.
OTP_BYPASS_CODE=123456

# Skip CCAvenue completely — marks orders paid on checkout submit.
PAYMENT_BYPASS=1
```

See `.env.example` for the full canonical list with comments on each section.

---

## 5. Start the local infrastructure

The bundled `docker-compose.yml` runs the four services Inventre depends on:

| Service | Container | Host port | What it is |
|---|---|---|---|
| Postgres 16 | `inventre-postgres` | `55432` (direct), `5432` not exposed | Primary database |
| PgBouncer | `inventre-pgbouncer` | `6432` | Connection pool the app talks to (transaction mode) |
| Redis 7 | `inventre-redis` | `6379` | Cart hot path, OTP storage, rate limits |
| MinIO | `inventre-minio` | `9000` (API), `9001` (console) | S3‑compatible object storage for product images |

```bash
npm run db:up
```

Wait ~10 seconds for healthchecks. Verify:

```bash
docker compose ps         # all 4 services should be 'Up'
docker compose logs -f    # tail logs (Ctrl-C to exit, services keep running)
```

**MinIO console:** <http://localhost:9001> · login `inventre` / `inventre_dev_secret`. The `inventre` bucket is auto‑created and public‑read by the `minio-init` one‑shot container.

---

## 6. Database — pick ONE path

### Path A — Empty DB + seed data (cleanest, for new devs)

Creates schema, then loads small demo data (a few schools, products, testimonials, an admin user).

```bash
npm run db:push          # creates all ~80 tables from db/schema.ts
npm run db:seed          # loads demo schools, products, admin
```

After seeding you have:
- **Admin login**: `/admin/login` · `admin@inventre.in` / `admin123` (role: super)
- **Parent login**: register via OTP on `/login` using any 10‑digit phone. With `OTP_BYPASS_CODE=123456`, the OTP is always `123456`.

### Path B — Restore from a production DB dump (recommended for realistic testing)

The repo's `backups/` folder contains custom‑format Postgres dumps from production. Latest:

```
backups/inventre_20260526-073003.dump   (108 MB — taken 2026-05-26 07:30 CEST)
```

The `backups/` folder is `.gitignore`'d, so the dump file isn't in the repo itself — get it from the team's shared drive or the server at `/root/Inventre/backups/`.

**Restore:**

```bash
# 1. Make sure the docker stack is up
npm run db:up

# 2. Drop the local DB so the restore is clean
PGPASSWORD=inventre_dev psql -h localhost -p 55432 -U inventre -d postgres \
  -c "DROP DATABASE IF EXISTS inventre; CREATE DATABASE inventre OWNER inventre;"

# 3. Restore the dump (takes ~30s on a recent laptop)
PGPASSWORD=inventre_dev pg_restore \
  -h localhost -p 55432 -U inventre -d inventre \
  --no-owner --no-privileges --jobs=4 \
  backups/inventre_20260526-073003.dump
```

> **`pg_restore: error: did not find magic string in file header`** → you piped the wrong file. Custom‑format dumps are binary; don't `gunzip` or `cat` them, just feed the path directly.

After restore you have **real prod data**: parents, students, the full catalog, ~10 real CCAvenue invoices. Parents will exist with real phone numbers — log in by picking one and using `OTP_BYPASS_CODE=123456`.

**Admin login on a restored DB:** use whichever admin email exists in `users` table. Check with:

```bash
PGPASSWORD=inventre_dev psql -h localhost -p 55432 -U inventre -d inventre \
  -c "SELECT email, role, status FROM users WHERE role IN ('super','ops') ORDER BY email;"
```

If you don't know the password, reset it via the admin password‑set script (or re‑seed: `npm run db:seed`).

### Path C — Push the latest schema only (when migrating an existing local DB)

```bash
npm run db:push
```

`db:push` reads `db/schema.ts` and applies any missing tables/columns directly. Lossy on column renames; use `db:generate` + `db:migrate:run` for production‑style versioned migrations.

---

## 7. Run the app

```bash
npm run dev
```

- Open <http://localhost:3000>.
- Hot reload is on (Turbopack).
- First page render compiles ~3,000 modules; takes 5–10 seconds on cold start.

Once running you can also hit:

- `/admin/dashboard` — staff portal
- `/shop` — catalog (need to be logged in as a parent)
- `/api/health` — JSON health check (db + redis ping)

---

## 8. Common dev commands

| Command | What it does |
|---|---|
| `npm run dev` | Start Next.js dev server with hot reload |
| `npm run build` | Production build (used by `scripts/deploy.sh`) |
| `npm run start` | Run the production build locally |
| `npm run lint` | ESLint |
| `npm run db:up` | Start Postgres + Redis + MinIO via Docker |
| `npm run db:down` | Stop the stack (preserves volumes) |
| `npm run db:reset` | **Nuke** volumes and restart fresh (full data loss) |
| `npm run db:push` | Sync `db/schema.ts` → live DB (dev only) |
| `npm run db:generate` | Generate a versioned migration SQL file |
| `npm run db:migrate:run` | Apply versioned migrations (via `db/migrate.ts`) |
| `npm run db:studio` | Drizzle Studio — visual DB browser at <https://local.drizzle.studio> |
| `npm run db:seed` | Re‑seed demo data (truncates first) |
| `npm run e2e` | End‑to‑end test suite (see `scripts/e2e.ts` for setup) |

### One‑off scripts (run with `tsx`)

```bash
npx tsx scripts/check-admin-users.ts          # list admin users
npx tsx scripts/test-smtp.ts you@example.com  # SMTP smoke test
npx tsx scripts/fix-order-status.ts <ORDER#> confirmed  # patch a stuck order
```

A handful of scripts import server‑only Next.js code and need a shim when run outside the dev server:

```bash
mkdir -p node_modules/server-only && \
  printf '{"name":"server-only","version":"0.0.1","main":"index.js"}\n' > node_modules/server-only/package.json && \
  : > node_modules/server-only/index.js
```

---

## 9. Project layout

```
app/                    Next.js App Router
  (homepage)/           public marketing site
  shop/                 catalog + PDP + cart + checkout (parent-auth)
  admin/(protected)/    staff portal (super / ops / school_admin)
  api/                  route handlers
    auth/               phone-OTP login, first-time setup, recovery
    cart/               cart CRUD
    checkout/ccavenue/  create-order, callback, status poll
    cron/               scheduled jobs (call from host crontab)
    erp/webhooks/       inbound from ERPNext
components/
  shop/                 PDP, MagicBoxConfigurator, cart UI
  admin/                AdminShell (nav drawer), primitives, forms
  auth/                 LoginForm, FirstTimeModal, TermsAcceptanceModal
db/
  schema.ts             Drizzle schema (single source of truth, ~80 tables)
  client.ts             postgres-js + drizzle wrapped in a lazy proxy
  seed.ts               demo data loader
  migrate.ts            versioned migration applier (used by start.sh)
  migrations/           generated + hand-edited SQL files (0000-0033)
lib/
  ccavenue.ts           AES-128-CBC encrypt/decrypt + Status API client
  ccavenue-finalize.ts  Shared paid/failed finaliser (callback + poller + cron)
  erp-bridge.ts         Outbound queue → ERP signed-event POST
  erp-poll.ts           Inbound delta sync from ERP
  erp-customer-orders.ts /shop/orders SQL (UNION local + ERP mirror)
  delivery-fee.ts       Per-school shipping rule resolution
  repos/                Domain repositories (cart, invoices, products, …)
  redis.ts              ioredis with retryStrategy + reconnectOnError
  email.ts              SMTP / Resend / stub fallback
  session.ts            JWT-in-cookie session helpers
docker-compose.yml      Local dev stack
docker-compose.deploy.yml Production stack (run on the deploy server only)
scripts/
  deploy.sh             Build + sync into container + restart (server-side)
  test-smtp.ts          SMTP smoke test
  backfill-*.ts         One-shot data backfills
backups/                 Prod DB dumps (.gitignore'd — bring your own)
```

---

## 10. How key flows work (quick reference)

- **Parent login** — `POST /api/auth/phone-status` decides if the phone is a new family vs returning user; new families go through the first‑time setup modal (OTP + password + T&C), existing ones use password login at `POST /api/auth/login`.
- **Cart** — Redis hash keyed by `parentId` (qty per variant), Postgres mirror for bundle picks (`cart_items.bundleSelections` JSONB).
- **Checkout** — `/api/checkout/ccavenue/create-order` allocates a `SAL-ORD-YYYY-N` number via `numbering_counters`, inserts pending order + payment, returns the CCAvenue form payload. Browser POSTs to CCAvenue's hosted page. CCAvenue posts the encrypted result back to `/api/checkout/ccavenue/callback`. The callback decrypts and calls `finalizeOrderPayment()` (in `lib/ccavenue-finalize.ts`) which is idempotent and shared with the status poller + reconcile cron.
- **My orders** — `/api/orders` calls `listParentOrdersFromErp()` (`lib/erp-customer-orders.ts`) which UNIONs the local `orders` table with the `erp.sales_orders` mirror (matched by phone). Local rows win on dedup. Per‑student grouping happens in the client (`/shop/orders/page.tsx`) using `students.name`.
- **Admin** — every protected route is gated by `requireAdmin(...roles)` in `lib/admin-guard.ts`. The drawer items live in `components/admin/AdminShell.tsx`.

---

## 11. Troubleshooting

### "Cannot find module 'server-only'"
You ran a `tsx` script on the host that pulls in server‑only Next.js code. Either run it inside `npm run dev` context, or apply the shim from the **One‑off scripts** section above.

### Port already in use (5432, 6432, 6379, 9000, 9001)
Stop a host‑installed Postgres/Redis, or change the host port in `docker-compose.yml`.

### `next build` hangs at "Creating an optimized production build…"
Native module being bundled. The repo already has `serverExternalPackages: ["@node-rs/bcrypt"]` in `next.config.mjs`; if you add another native dep, list it there too.

### Redis ETIMEDOUTs in logs
The repo's `lib/redis.ts` already has reconnect + keep‑alive, but if the daemon dies mid‑session, restart the redis container: `docker compose restart redis`.

### `pg_restore: did not find magic string in file header`
You passed a `.sql` plain‑text dump instead of a custom‑format `.dump`. Use `psql -f file.sql` for plain SQL, `pg_restore file.dump` for custom format.

### Drizzle Studio empty
Make sure `DATABASE_DIRECT_URL` is set (not just `DATABASE_URL`). Drizzle Kit talks directly to Postgres, not PgBouncer.

### CCAvenue test creds
Test mode uses `https://test.ccavenue.com` (set via `CCAVENUE_API_BASE`). The repo ships test credentials in `.env.example`; production credentials live in `.env.deploy` on the server only. For local payment testing, set `PAYMENT_BYPASS=1` instead of plugging in real keys.

---

## 12. Day‑to‑day deployment (on the existing prod server)

```bash
# On the deploy server (Ubuntu 24, /root/Inventre)
./scripts/deploy.sh         # full mode — recreates compose, ~8–10 min
./scripts/deploy.sh --fast  # code-only, ~3–6 min
```

The script builds locally on the host, syncs `.next/standalone` into the running container via `docker cp`, then restarts. See `scripts/deploy.sh` for the full flow.

`.env.deploy` (server‑side env, gitignored) holds production secrets — CCAvenue prod creds, SMTP, R2, ERP webhook signing key, etc.

---

## 13. Deploying to a NEW server (or migrating to a beefier VPS)

**See [`deploy/PRODUCTION-MIGRATION.md`](./deploy/PRODUCTION-MIGRATION.md)** — full playbook including:

- Recommended VPS specs (current + scaling targets)
- Base OS prep on Ubuntu 24.04 (packages, swap, swappiness, UFW)
- Docker + Node 20 install commands
- DB restore from a `pg_dump --format=custom` and **the 7 critical post‑restore DBA tasks** (missing indexes, `pg_stat_statements`, drop the duplicate `erp_src` schema, etc.)
- Nginx + Let's Encrypt setup + the **systemd auto‑restart override** for nginx (kernel‑bug workaround)
- The 5 cron jobs we run (ERP drain, poll, webhook drain, CCAvenue reconcile, retry webhooks, sync items) plus the Redis client‑count alert cron
- Logrotate config
- Office 365 SMTP setup gotchas (Authenticated SMTP enable, App Password for MFA, Send‑As alignment)
- CCAvenue dashboard URL whitelist
- DNS cutover sequence
- Optional Prometheus + Grafana stack
- **§16 — Post‑deploy verification checklist** (the 10 things we hardened against — every box should be GREEN before declaring the new server live)
- **§17 — full inventory of what we hardened** in code + server config + database

If you just `git clone` this repo onto a new server, the code‑level perf fixes (`max: 30` DB pool, `globalThis` singleton, native bcrypt, async webhook drain, etc.) come along for free — but the **database indexes, server‑level cron jobs, swap file, nginx auto‑restart, and pg_stat_statements extension are NOT in the repo** — apply them via §7c, §8, §9 of the migration doc.

---

## 14. What's already hardened in this branch (so you don't break it)

If you fork this repo or rip out modules, these are the production‑critical pieces — keep them:

| File | What's special |
|---|---|
| `lib/redis.ts` | `globalThis` singleton ALWAYS cached (the prod‑only `NODE_ENV !== "production"` gate was the root cause of the 2026‑05 outage); `retryStrategy` + `reconnectOnError` for EPIPE/ETIMEDOUT/ECONNRESET; 30 s `keepAlive` |
| `db/client.ts` | Same singleton fix; `max: 30` request pool + `dbCron` isolated pool (`max: 8`) so cron workloads can't starve customer requests |
| `lib/numbering.ts` | `allocOrderNumber` skips the 4.7 s `latestSalOrd` re‑seed when the counter row is < 60 s fresh |
| `lib/erp/client.ts` | `AbortSignal.timeout(8000)` per attempt; capped retry — was previously unbounded and would hang for 2+ minutes on dead ERPNext |
| `lib/erp/delivery-fee-rules.ts` | Fully local DB. ERPNext is retired. |
| `lib/ccavenue.ts` + `lib/ccavenue-finalize.ts` | Mapper accepts both `Success`/`Successful` enums; stock‑decrement failure does NOT downgrade order status |
| `lib/erp-webhook-dispatch.ts` | Batched dispatcher; `deriveStatusForErpOrderName` deduped per chunk |
| `app/api/erp/webhooks/route.ts` | Insert‑only receiver — returns 200 in ms; processing happens out‑of‑band |
| `app/api/cron/erp-webhook-drain/route.ts` | `FOR UPDATE SKIP LOCKED` drain on `dbCron` pool |
| `next.config.mjs` | `serverExternalPackages: ['@node-rs/bcrypt']` — without this, `next build` hangs forever trying to bundle the native binding |
| `package.json` | `@node-rs/bcrypt` (Rust, worker‑thread) replaces `bcryptjs` (pure JS, blocks event loop) |
| `docker-compose.deploy.yml` | `pgbouncer DEFAULT_POOL_SIZE=50`; `app stop_grace_period: 25s`; healthcheck on `127.0.0.1:3000` (IPv4 — Alpine resolves `localhost` to IPv6 but Next binds IPv4 only); MinIO healthcheck disabled (seccomp issue) |
| `scripts/deploy.sh` | Auto‑reconnects app to default network after `docker compose --force-recreate`; ships the musl bcrypt binding into Alpine; cleaner output banner |

---

## 15. Where to read next

| Doc | What's in it |
|---|---|
| [`deploy/PRODUCTION-MIGRATION.md`](./deploy/PRODUCTION-MIGRATION.md) | New‑server / migration playbook (the doc you actually want when standing up a fresh box) |
| [`deploy/replicas/postgres-replica-setup.md`](./deploy/replicas/postgres-replica-setup.md) | Postgres streaming read replica |
| [`deploy/replicas/redis-sentinel-setup.md`](./deploy/replicas/redis-sentinel-setup.md) | Redis HA pair with Sentinel |
| [`deploy/cdn/cloudflare-setup.md`](./deploy/cdn/cloudflare-setup.md) | Cloudflare in front of nginx |
| [`deploy/monitoring/README.md`](./deploy/monitoring/README.md) | Prometheus + Grafana stack |
| `docs/architecture/Inventre-HLD-v1.5.pdf`, `Inventre-LLD-v1.5.pdf` | Architecture (as built) + detailed design, with the rectification register |
| `db/schema.ts` | All tables, columns, indexes (single source of truth) |
| `db/migrations/` | Numbered SQL migrations 0000 → 0034 |
| `docker-compose.deploy.yml` | Production service topology |
| `lib/ccavenue.ts`, `lib/ccavenue-finalize.ts` | Payment integration |
| `lib/erp-bridge.ts`, `lib/erp-poll.ts` | ERP outbound + inbound |

Anything missing? Open a PR against this README.
