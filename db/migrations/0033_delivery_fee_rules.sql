-- Local delivery_fee_rules table (formerly mirrored from ERPNext).
--
-- ERPNext at erp.inventre.in is retired (2026-05). Delivery Fee Rules
-- now live entirely in this app. Shape mirrors the original doctype
-- exactly so the existing TypeScript types in
-- lib/erp/delivery-fee-rules.ts keep working — only the storage backend
-- changes.
--
-- The grade scope side-table `delivery_fee_rule_grades` (0021) keeps its
-- existing schema; its `rule_name` column now references this table's
-- `name`. We don't add a hard FK because the grade table has historical
-- rows for ERP-only rules that may not have a matching local row yet.

CREATE TABLE IF NOT EXISTS delivery_fee_rules (
  -- Stable identifier; matches the ERPNext "DFR-..." naming series so
  -- existing delivery_fee_rule_grades.rule_name rows continue to resolve.
  name                    text PRIMARY KEY,
  is_active               boolean NOT NULL DEFAULT true,
  -- ERPNext name of the school this rule scopes to. References
  -- schools.erp_name (text) — no hard FK because schools may be added
  -- after a rule is drafted, mirroring ERPNext's loose linkage.
  school                  text NOT NULL,
  -- Rupees (not paise). Matches ERPNext's Currency field semantics and
  -- the existing TypeScript `number` shape; we convert to paise at
  -- compute time in lib/delivery-fee.ts.
  min_amount              numeric(12,2) NOT NULL DEFAULT 0,
  max_amount              numeric(12,2) NOT NULL DEFAULT 0,
  delivery_fee            numeric(12,2) NOT NULL DEFAULT 0,
  -- Flat array of category strings ("Uniform" | "Books"). Empty array =
  -- applies to all categories. Stored as jsonb because Drizzle's
  -- text[]-array support is awkward and we never query inside this
  -- column — only read+rewrite on rule updates.
  applicable_item_groups  jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

-- Hot path: lib/delivery-fee.ts:computeShippingFeePaise loads ALL rules
-- then filters in-process by school. Index by school accelerates the
-- admin-side per-school view too.
CREATE INDEX IF NOT EXISTS delivery_fee_rules_school_idx
  ON delivery_fee_rules (school)
  WHERE is_active = true;
