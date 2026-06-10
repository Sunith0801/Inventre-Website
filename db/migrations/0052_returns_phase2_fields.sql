-- 0052 — Phase 2 exchange-flow fields on `returns` (2026-06-07)
--
-- Phase 1 (migration 0051) gave us `kind` + `pickup_date` so the
-- exchange round-trip works. Phase 2 makes the request actionable:
-- customer-care + school staff need to know exactly what the customer
-- *wants back* and which part of a kit is problematic. Fields added
-- here mirror the same set added to `exchange_requests` on audit.
--
--   • sub_reason            — the dropdown sub-reason under the
--                             top-level reason (e.g. "too_small" under
--                             "wrong_size_delivered"). Free text in DB,
--                             enum-shaped in app code (lib/exchange-shared.ts).
--   • requested_variant_id  — for size-swap / colour-swap requests, the
--                             variant the customer wants instead. NULL
--                             when "same variant, fresh piece" applies
--                             (damaged / defective).
--   • requested_component_path — for kit / Magic Box parent lines, a
--                             jsonb pointer into the original line's
--                             bundle_selections so audit knows *which*
--                             of the kit's components is the problem.
--   • damage_location       — front / back / side / other; only set
--                             when reason ∈ (damaged, defective).
--   • handover_photos       — separate from request photos. Populated
--                             by the school operator at hand-over via
--                             the audit-side flow, stored as
--                             `[{url, key}, ...]`.
--
-- All columns nullable + IF NOT EXISTS for safe re-run. No FK on
-- requested_variant_id — the variant may be archived between request
-- and approval, and we'd rather keep the audit trail than block the
-- write.

BEGIN;

ALTER TABLE returns
  ADD COLUMN IF NOT EXISTS sub_reason text,
  ADD COLUMN IF NOT EXISTS requested_variant_id uuid,
  ADD COLUMN IF NOT EXISTS requested_component_path jsonb,
  ADD COLUMN IF NOT EXISTS damage_location text,
  ADD COLUMN IF NOT EXISTS handover_photos jsonb;

-- No new indexes — these columns are read-via-row not queried.

COMMIT;
