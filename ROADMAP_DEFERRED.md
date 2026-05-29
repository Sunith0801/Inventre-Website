# Deferred Work — Roadmap

This document tracks the items called out in the structural audit that need real engineering effort and product input beyond what was done in the security/correctness pass. The pass shipped:

- `middleware.ts` — route-level auth gate (no DB)
- `lib/parent-guard.ts` + `lib/admin-guard.ts` (with `schoolScope` / `assertSchoolAccess`)
- Closed order-id enumeration on `/api/returns`, scoped via single-query JOIN on `parentId`
- Fixed broken `sql\`… IN ${array}\`` patterns (now `inArray`)
- Atomic stock decrement on `/api/checkout/verify` (conditional UPDATE inside tx)
- `lib/grade-filter.ts` — normalization (Grade 5 / Class 5 / V → "5") + applied in `/api/shop/products`
- `lib/numbering.ts` — atomic UPSERT-based allocator backed by `numbering_counters` table; replaces every COUNT(*)-based numbering call site
- `/api/cron/cleanup-carts` — cart TTL endpoint behind `CRON_TOKEN`

Below: what was deferred, why, and a concrete shape for each.

---

## 1. ERPNext pivot — `lib/erp/`

**Status:** scaffold only (`client.ts`, `types.ts`, README).

**Why deferred:** the full integration is the multi-phase plan in `ERP_INTEGRATION_PLAN.md`. It's weeks of work and requires product decisions per DocType (read-through vs mirror, conflict resolution, write timing).

**Recommended sequencing:**
1. **Phase A — read-only mirror.** Wire `erp_pull_*` jobs that nightly snapshot Items/Customers from ERP into our tables. Ship behind a feature flag (`ERP_MIRROR_ENABLED`); read-paths still use Postgres as authoritative.
2. **Phase B — order push.** After successful payment, enqueue `erp_push_so` to create the SalesOrder in ERPNext. Idempotent on our `orderNumber`.
3. **Phase C — webhook receive.** New route `/api/erp/webhook` verifies HMAC + dispatches into `lib/erp/webhooks/`. Triggers cache invalidation and status mirroring.
4. **Phase D — read-through caching.** Catalog calls hit ERP first, fall back to Postgres mirror. Stock check at checkout is live ERP only.
5. **Phase E — cutover.** Postgres becomes the cache; ERP becomes system of record. Migration of existing orders done via a one-shot reconciliation job.

**Decisions you owe before starting Phase A:**
- ERPNext company name (used as `company` field on every SO)
- Default warehouse in ERP that maps to our `warehouses.code = "MAIN"`
- Tax templates ("Output GST In-state" vs "Out-state") — exact ERP names
- Customer Group / Territory defaults for new customers

---

## 2. Background jobs runner — `lib/jobs/`

**Status:** scaffold only (`enqueue.ts` writes to `background_jobs` but no worker reads it).

**Why deferred:** picking a runner is a product/ops decision, not a code decision.

**Concrete plan:**
- Pick **pg-boss** (recommended — see `lib/jobs/README.md`). One package, no new infra.
- Add `lib/jobs/runner.ts` as a separate process: `npm run jobs:worker`. Boots pg-boss, registers handlers from `lib/jobs/handlers/*`.
- Move `cleanup-carts` from HTTP cron to a pg-boss repeatable job once the worker is alive.
- Wire `notifyOrderStatus` → `enqueue("send_email", …)` instead of fire-and-forget.

**Effort:** ~1 day to get pg-boss + 6 email handlers + worker process. Email copy/templates can be done in parallel by anyone with HTML access.

---

## 3. Transactional emails

**Status:** `lib/email.ts` stub exists; logs to console in dev, calls Resend in prod.

**Why deferred:** real emails need (a) HTML templates, (b) decisions about which events trigger sends, (c) a job runner so a Resend outage doesn't block checkout.

**Initial event matrix:**

| Event | To | When |
| --- | --- | --- |
| order.placed | parent | post-payment |
| order.shipped | parent | shipment created |
| order.delivered | parent | status=delivered |
| return.approved | parent | admin approves |
| return.refunded | parent | refund processed |
| password.reset | parent | reset link requested |

All triggered via `enqueue("send_email", { template, …data })` once the runner exists.

---

## 4. Variant code canonicalization

**Status:** still regex-based (`lib/repos/variant-resolver.ts`).

**Why deferred:** this is a data migration touching every product/variant + every read site that parses codes. High blast radius.

**Plan:**
1. Add a column `productVariants.canonical_attrs jsonb` (already implied by `productVariantAttributes` join table).
2. Backfill script: parse existing SKUs via the regex one last time, insert rows into `productVariantAttributes`, set `canonical_attrs` JSON for fast read.
3. Dual-write window: every write to a variant updates both regex SKU and the attribute table.
4. Switch reads (PDP, cart, checkout) to use attributes; remove regex.
5. Cutover: drop the regex parser; SKU becomes a display-only string.

**Effort:** 2–3 days including the backfill.

---

## 5. API versioning, tracing

**API versioning:** the audit flagged this; on reflection it's low-value churn. The mitigation that actually matters — keeping clients in lockstep with the server — is already true (single Next.js app, no external API consumers). **Recommendation: skip.**

**Tracing:** wire OpenTelemetry → either Honeycomb or self-hosted Tempo.
- `instrumentation.ts` at repo root with `@vercel/otel` (~30 LOC)
- Span per route handler, per DB query, per external HTTP call
- ~half a day, deferred until there's a concrete debugging need

---

## Migration to apply

`db/schema.ts` gained one new table:

```sql
CREATE TABLE numbering_counters (
  prefix     varchar(32) NOT NULL,
  period     varchar(16) NOT NULL,
  value      integer     NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (prefix, period)
);
```

Run `npm run db:generate` and `npm run db:migrate` to apply.

The first allocation per (prefix, period) starts at 1, matching the prior COUNT(*)+1 behavior, so existing numbering sequences continue without a gap. **Caveat:** if production already has e.g. `INV-26-27-00045` and you deploy this without seeding the counter, the next allocation will be `INV-26-27-00001` and will collide on a unique index. Seed the counter once before deploying:

```sql
INSERT INTO numbering_counters (prefix, period, value)
SELECT 'INV', '26-27', COALESCE(MAX(seq), 0)
  FROM (SELECT (regexp_match(invoice_number, 'INV-26-27-(\d+)'))[1]::int AS seq
          FROM invoices) s;
-- repeat for ORD/RTN/CUST/SHP across each period.
```
