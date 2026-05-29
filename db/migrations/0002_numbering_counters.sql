-- Atomic numbering allocator backing lib/numbering.ts.
-- Replaces COUNT(*)-based generators that were race-prone and grew O(N).

CREATE TABLE IF NOT EXISTS "numbering_counters" (
    "prefix"     varchar(32) NOT NULL,
    "period"     varchar(16) NOT NULL,
    "value"      integer     NOT NULL DEFAULT 0,
    "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT "numbering_counters_pkey" PRIMARY KEY ("prefix", "period")
);

-- parents.customer_code (CUST-YYYY-NNNNN) is declared in db/schema.ts but was
-- never written into 0000/0001 — it only reached prod via `drizzle-kit push`.
-- The CUST counter seed below reads it, so ensure it exists on a freshly
-- migrated DB. IF NOT EXISTS keeps this a no-op where push already added it.
ALTER TABLE "parents" ADD COLUMN IF NOT EXISTS "customer_code" text;

-- Seed counters from existing data so the next allocation continues the
-- sequence (otherwise the first INV-26-27-* alloc would collide on the
-- invoices.invoice_number unique index, etc.).

INSERT INTO "numbering_counters" ("prefix", "period", "value")
SELECT 'INV', period, MAX(seq)
FROM (
    SELECT
        SUBSTRING("invoice_number" FROM '^INV-(\d{2}-\d{2})-')           AS period,
        SUBSTRING("invoice_number" FROM '^INV-\d{2}-\d{2}-(\d+)$')::int  AS seq
    FROM "invoices"
    WHERE "invoice_number" ~ '^INV-\d{2}-\d{2}-\d+$'
) s
WHERE period IS NOT NULL AND seq IS NOT NULL
GROUP BY period
ON CONFLICT ("prefix", "period") DO UPDATE
    SET "value" = GREATEST("numbering_counters"."value", EXCLUDED."value");

-- Orders use legacy "INV-{FY}-NNNN" too (see lib/repos/orders.ts).
-- Allocator key is "ORD" so it shares the FY namespace but allocates
-- independently of invoice numbers. Seed from orders.order_number.
INSERT INTO "numbering_counters" ("prefix", "period", "value")
SELECT 'ORD', period, MAX(seq)
FROM (
    SELECT
        SUBSTRING("order_number" FROM '^INV-(\d{2}-\d{2})-')           AS period,
        SUBSTRING("order_number" FROM '^INV-\d{2}-\d{2}-(\d+)$')::int  AS seq
    FROM "orders"
    WHERE "order_number" ~ '^INV-\d{2}-\d{2}-\d+$'
) s
WHERE period IS NOT NULL AND seq IS NOT NULL
GROUP BY period
ON CONFLICT ("prefix", "period") DO UPDATE
    SET "value" = GREATEST("numbering_counters"."value", EXCLUDED."value");

-- Older calendar-year orders ("INV-2026-NNNN", 4 digits) — pre-FY format.
INSERT INTO "numbering_counters" ("prefix", "period", "value")
SELECT 'ORD', period, MAX(seq)
FROM (
    SELECT
        SUBSTRING("order_number" FROM '^INV-(\d{4})-')           AS period,
        SUBSTRING("order_number" FROM '^INV-\d{4}-(\d+)$')::int  AS seq
    FROM "orders"
    WHERE "order_number" ~ '^INV-\d{4}-\d+$'
) s
WHERE period IS NOT NULL AND seq IS NOT NULL
GROUP BY period
ON CONFLICT ("prefix", "period") DO UPDATE
    SET "value" = GREATEST("numbering_counters"."value", EXCLUDED."value");

-- Returns: RTN-YYYY-NNNNN
INSERT INTO "numbering_counters" ("prefix", "period", "value")
SELECT 'RTN', period, MAX(seq)
FROM (
    SELECT
        SUBSTRING("return_number" FROM '^RTN-(\d{4})-')           AS period,
        SUBSTRING("return_number" FROM '^RTN-\d{4}-(\d+)$')::int  AS seq
    FROM "returns"
    WHERE "return_number" ~ '^RTN-\d{4}-\d+$'
) s
WHERE period IS NOT NULL AND seq IS NOT NULL
GROUP BY period
ON CONFLICT ("prefix", "period") DO UPDATE
    SET "value" = GREATEST("numbering_counters"."value", EXCLUDED."value");

-- Customers: CUST-YYYY-NNNNN
INSERT INTO "numbering_counters" ("prefix", "period", "value")
SELECT 'CUST', period, MAX(seq)
FROM (
    SELECT
        SUBSTRING("customer_code" FROM '^CUST-(\d{4})-')           AS period,
        SUBSTRING("customer_code" FROM '^CUST-\d{4}-(\d+)$')::int  AS seq
    FROM "parents"
    WHERE "customer_code" IS NOT NULL
      AND "customer_code" ~ '^CUST-\d{4}-\d+$'
) s
WHERE period IS NOT NULL AND seq IS NOT NULL
GROUP BY period
ON CONFLICT ("prefix", "period") DO UPDATE
    SET "value" = GREATEST("numbering_counters"."value", EXCLUDED."value");

-- Shipments: SHP-{FY}-NNNNN (no historical data expected; insert is a no-op if
-- the shipment_number column is null/empty)
INSERT INTO "numbering_counters" ("prefix", "period", "value")
SELECT 'SHP', period, MAX(seq)
FROM (
    SELECT
        SUBSTRING("shipment_number" FROM '^SHP-(\d{2}-\d{2})-')           AS period,
        SUBSTRING("shipment_number" FROM '^SHP-\d{2}-\d{2}-(\d+)$')::int  AS seq
    FROM "shipments"
    WHERE "shipment_number" IS NOT NULL
      AND "shipment_number" ~ '^SHP-\d{2}-\d{2}-\d+$'
) s
WHERE period IS NOT NULL AND seq IS NOT NULL
GROUP BY period
ON CONFLICT ("prefix", "period") DO UPDATE
    SET "value" = GREATEST("numbering_counters"."value", EXCLUDED."value");
