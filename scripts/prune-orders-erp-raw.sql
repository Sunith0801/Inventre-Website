-- Run during low-traffic window. Trims unused-by-app fields from orders.erp_raw
-- to shrink the table's TOAST footprint. Each ALTER TABLE rewrite is bounded
-- to one column so the operation is incremental.
--
-- Profile your erp_raw payload first — these field names match the ERPNext
-- "Sales Order" doctype as observed on 2026-05. Add/remove keys as needed:
--   SELECT jsonb_object_keys(erp_raw) AS key, count(*)
--   FROM orders WHERE erp_raw IS NOT NULL
--   GROUP BY 1 ORDER BY 2 DESC;

BEGIN;

-- Audit columns we never read from the app — confirm by grepping the code first.
UPDATE orders
   SET erp_raw = erp_raw
       -- Heavy ERPNext-internal fields we don't render or migrate from:
       - 'docstatus'
       - 'workflow_state'
       - 'idx'
       - '__onload'
       - '__unsaved'
       - 'doctype'
       - 'amended_from'
       - 'amendment_date'
       - 'lft' - 'rgt'      -- nested-set internals (only on hierarchical doctypes)
       - 'inter_company_order_reference'
 WHERE erp_raw IS NOT NULL
   AND erp_raw ?| ARRAY['docstatus','workflow_state','__onload','__unsaved'];

-- Then trigger a VACUUM to release the dead tuples back to OS.
COMMIT;

-- After commit, in a separate transaction:
--   VACUUM (VERBOSE, ANALYZE) orders;
--   (run pg_squeeze or CLUSTER orders later if TOAST table still bloated)
