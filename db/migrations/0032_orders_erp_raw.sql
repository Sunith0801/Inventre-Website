-- Store the entire ERPNext Sales Order doc + its linked Address + Contact
-- as JSONB on the orders row so the admin detail page can render the
-- same tabs ERPNext shows (Address & Contact, Terms, More Info,
-- Connections, Payment Details) without round-tripping back to ERPNext
-- on every page load.
--
-- Shape (set by lib/erp-import-orders.ts):
--   {
--     "salesOrder": { ...full ERP SO doc, child items[] inlined... },
--     "address":    { ...ERP Address doc... } | null,
--     "contact":    { ...ERP Contact doc... } | null,
--     "fetchedAt":  "2026-05-25T…"
--   }
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS erp_raw jsonb;
