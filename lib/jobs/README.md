# lib/jobs — Background job queue (scaffold)

Status: **scaffold only**. The `background_jobs` table exists in the schema; this folder is the application-side runner.

## Decision pending
Pick one before wiring:

| Option | Pros | Cons |
| --- | --- | --- |
| **pg-boss** (Postgres-backed) | No new infra; uses existing DB; transactional enqueue | Throughput ceiling (~1–5k jobs/min) |
| **BullMQ** (Redis-backed) | High throughput; rich features (retries, repeatable, rate-limit) | Adds Redis as a queue backbone (already deployed for cache, but new operational concern) |
| **Inngest / Trigger.dev** (managed) | Zero ops, observability built-in | Vendor + cost; outbound HTTP latency |

Recommendation: **pg-boss** — Postgres is already the canonical store, jobs are transactional with the writes that enqueue them, and current volume is well under its ceiling.

## Job catalog (initial)
- `send_email`      — order placed/confirmed/shipped/delivered, return approved/refunded, password reset
- `send_sms`        — same set, gated by user prefs
- `erp_push_so`     — push Sales Order to ERPNext after checkout
- `erp_pull_stock`  — periodic stock reconciliation
- `cleanup_carts`   — already exposed as HTTP cron; could move here once a runner exists

## Files (when implemented)
- `runner.ts` — boots queue worker(s) (separate process or `next start` postinit hook)
- `enqueue.ts` — typed `enqueue(jobName, payload)` used by routes
- `handlers/*` — one file per job
