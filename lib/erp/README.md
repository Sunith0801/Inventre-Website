# lib/erp — ERPNext integration (scaffold)

Status: **scaffold only**. Nothing here is wired into runtime code yet.

See `ROADMAP_DEFERRED.md` (repo root) for the implementation plan.

Files:
- `client.ts` — single `erpFetch()` helper with auth + retry
- `types.ts` — minimal DocType payload shapes (Customer, Item, SalesOrder, …)
- `sync/` — pull/push handlers per DocType (one file per DocType — keeps blast radius small per DocType)
- `webhooks/` — verify + dispatch ERPNext webhook events

Integration points (to be wired in subsequent PRs, not here):
- `app/api/checkout/create-order/route.ts`  → call `pushSalesOrder()` after DB insert
- `lib/repos/products.ts`                   → optional read-through cache from ERP
- `app/api/erp/webhook/route.ts` (new)      → receive ERP-side updates and mirror
