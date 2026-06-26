# Audit-side change request — block duplicate Exchange/Missing on a Sales Order

**Owner:** Audit backend team (FastAPI + SQLAlchemy, `217.216.58.218`)
**Requested by:** Inventre (sudheer@inventre.in)
**Date:** 2026-06-26
**Related Inventre code:** `lib/exchange.ts` (`findOpenRequestForOrder`), `lib/missing.ts`, `lib/audit-inbound.ts`, `lib/return-eligibility.ts`

---

## Background — what already works

The Exchange / Missing dedup rule is **already enforced on the Inventre
website** and is **already symmetric in one direction**:

- **Parent raises on Inventre** → Inventre emits `exchange.requested` /
  `missing.requested` to audit (`/api/ecom/ingest`), and **blocks any
  further request on that Sales Order** (`findOpenRequestForOrder`).
- **Customer Care raises in Audit** → audit emits `exchange.created` /
  `missing.created` to Inventre → `lib/audit-inbound.ts` creates the
  linked `returns` / `missing_item_claims` row keyed to the Sales Order
  (`orders.erp_so_name = so_erp_name`). The parent is then **blocked on
  the Inventre side** because that local row trips the same lock. ✅

## The gap — the reverse direction is NOT enforced inside Audit

When a **parent has already raised** an Exchange/Missing on Inventre (or
when one already exists for the SO from any source), a **Customer Care
agent can still create a second one in the Audit portal**. Audit does not
currently check for an existing live request before inserting. We need
Audit to apply the **same lock Inventre applies**.

## The business rule (must match Inventre exactly)

Per Sales Order, across BOTH flows (one lock covers exchange + missing):

| Existing request status | New request allowed? |
|---|---|
| `rejected` | ✅ Yes — the slot is released, customer/CC gets one more attempt |
| `requested` (pending / in progress) | ❌ No → 409 "in progress" |
| `approved`, `received`, `received_at_school`, `delivered`, `completed`, `exchange_completed` | ❌ No → 409 "already approved" (permanent) |

- **Cross-flow:** an open *exchange* blocks a new *missing* on the same
  SO and vice-versa.
- **Origin-agnostic:** it does not matter whether the existing request
  was ecom-originated (`ecom_id` set) or CC-created in Audit — any
  non-rejected request for the SO blocks a new one.

## Where to add it

In the Audit backend's **Customer-Care manual create** handler(s) for
exchange and missing (the same endpoint(s) that emit
`exchange.created` / `missing.created` to Inventre — likely under the
`/exchange-requests` / missing routes). Add the guard **before** the
`INSERT` + before firing the `*.created` webhook.

## Reference implementation (SQLAlchemy — adapt names to your models)

```python
# Statuses that mean "approved or beyond" — a PERMANENT block.
APPROVED_STATUSES = {
    "approved", "received", "received_at_school",
    "delivered", "completed", "exchange_completed",
}
# Only "rejected" releases the slot. Everything else is a live request.
def _is_live(status: str | None) -> bool:
    return bool(status) and status != "rejected"


def find_open_request_for_so(db, so_erp_name: str):
    """Mirror of Inventre's findOpenRequestForOrder.
    Returns (kind, status) of the first live request on this SO, else None.
    Checks BOTH the exchange and missing tables (cross-flow)."""
    ex = (
        db.query(ExchangeRequest)
          .filter(ExchangeRequest.so_erp_name == so_erp_name)
          .all()
    )
    for r in ex:
        if _is_live(r.status):
            return ("exchange", r.status)

    mc = (
        db.query(MissingItemClaim)
          .filter(MissingItemClaim.so_erp_name == so_erp_name)
          .all()
    )
    for r in mc:
        if _is_live(r.status):
            return ("missing", r.status)
    return None


# --- inside the CC create handler (exchange shown; mirror for missing) ---
open_req = find_open_request_for_so(db, payload.so_erp_name)
if open_req:
    kind, status = open_req
    label = "Exchange" if kind == "exchange" else "Missing"
    if status in APPROVED_STATUSES:
        msg = (f"An {label} request has already been approved for this "
               f"Sales Order. You cannot raise another request for this order.")
    else:
        msg = (f"A {label} request is already in progress for this Sales "
               f"Order. Please wait for it to be processed before raising "
               f"another request.")
    raise HTTPException(status_code=409, detail=msg)
```

> Adjust `ExchangeRequest` / `MissingItemClaim` / `so_erp_name` to your
> actual model + column names. If exchange & missing share one table with
> a `kind` column, fold the two queries into one filtered by `kind`.

## Frontend (Audit React UI)

When the create call returns **409**, show the returned `detail` message
in a popup/toast and keep the agent on the SO — do not insert. This
mirrors the popup Inventre now shows parents
(`components/shop/orders/RequestBlockedNotice.tsx`).

## Notes / edge cases

- **Idempotent re-fire is fine.** Inventre's inbound create
  (`createExchangeFromAudit` / `createMissingFromAudit`) is idempotent —
  if Audit re-sends `*.created` for the same SO it returns the existing
  row (`deduped: true`). The new guard prevents a *human* second create;
  it does not affect webhook retries.
- **15-day delivery window** is enforced **only on the Inventre
  storefront** (customer self-service) — see `RETURNS_WINDOW_DAYS` in
  `lib/return-eligibility.ts`. Customer Care in Audit is intentionally
  **not** bound by the 15-day window (CC can still act on older orders).
  If you want CC bound too, say so and we'll align.
- **Source of truth for status** stays as today: Audit owns the status
  lifecycle and pushes flips to Inventre via
  `/api/erp/webhooks/exchange|missing`.

## Acceptance test

1. Parent raises an Exchange on Inventre for SO `SAL-ORD-…`.
2. CC opens the Audit portal, tries to add an Exchange (or Missing) for
   the same SO → **blocked with 409 + popup**, no row inserted.
3. CC rejects the existing request → CC (and the parent) can now raise a
   new one (slot released).
4. CC approves the request → both CC and parent are **permanently
   blocked** with the "already approved" message.
