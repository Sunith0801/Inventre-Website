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

## Acceptance test (dedup)

1. Parent raises an Exchange on Inventre for SO `SAL-ORD-…`.
2. CC opens the Audit portal, tries to add an Exchange (or Missing) for
   the same SO → **blocked with 409 + popup**, no row inserted.
3. CC rejects the existing request → CC (and the parent) can now raise a
   new one (slot released).
4. CC approves the request → both CC and parent are **permanently
   blocked** with the "already approved" message.

---

# Part 2 — Request-number single source of truth

## The rule

**Inventre is the ONLY system that generates Exchange/Missing request
numbers.** Audit must never mint its own number again. All NEW requests
must be `RTN-2026-XXXXX` / `MIS-2026-XXXXX` (5-digit, zero-padded).

- Legacy `RTN-M-XXXXX` / `MIS-M-XXXXX` (audit-minted) must **never** be
  generated for new requests.
- **Existing `-M-` records stay UNCHANGED forever** — they're linked to
  packing, dispatch, QR/barcodes, printed labels, reports, activity
  timelines. Do NOT rename or migrate them (a prefix swap also collides
  with existing `-YYYY-` numbers — they're not unique across the two
  sequences).

## Required Audit-side flow (manual CC create)

1. CC fills the create form. Audit does **NOT** assign a number.
2. Audit calls Inventre's create webhook **without** `return_number` /
   `claim_number`.
3. Inventre mints the number and **returns it** in the response:
   - exchange → `{ ok: true, id, returnNumber }`
   - missing  → `{ ok: true, id, claimNumber }`
   - (on idempotent re-fire the same response now also includes
     `returnNumber`/`claimNumber` so audit can always reconcile.)
4. Audit **stores + displays** that number, and pins `id` as `ecom_id`
   for subsequent status-flip webhooks. Status flips should key on
   `ecom_id`/`id` (not the number) so they're robust.

> Do NOT have audit mint `RTN-2026-` from its own counter — two
> independent counters collide. Inventre's single atomic counter is the
> only safe source.

## Inventre side (already implemented)

Behind env flag **`RETURNS_NUMBER_SINGLE_SOURCE`** (in `lib/audit-inbound.ts`):
- `false` (current default): legacy — uses audit's number if sent.
- `true`: Inventre ignores any number audit sends and always mints.

**Coordinated go-live:** flip `RETURNS_NUMBER_SINGLE_SOURCE=true` on
Inventre **at the same time** Audit ships the flow above. Flipping it
before audit adopts the returned number would desync the two systems'
numbers on new audit requests.

## Acceptance test (numbering)

1. With the flag on + audit updated: CC creates an Exchange in Audit →
   both Inventre and Audit show the **same** `RTN-2026-XXXXX`.
2. Same for Missing → `MIS-2026-XXXXX`.
3. An existing `RTN-M-…` order still flips Approved→Packed→Delivered
   correctly (resolved by `ecom_id`), proving history is unaffected.

---

# Part 3 — Parent concern portal: QR target, prod URLs, menus, ingest

The parent **concern portal** has been built natively in Inventre at
**`https://inventre.in/portal`** (login-gated; 3 Call-Centre modules:
Order & Delivery, Payment Issues, Customer Care). The Audit system keeps
the **staff Admin Panel**. Required Audit-side changes:

### 3.1 QR codes → production Inventre portal (magic-link)
- QR codes are generated by **Audit** and currently encode the
  **dev** URL `http://217.216.58.218:3081/portal`.
- The portal shows the parent's PII (child, mobile, orders), so it can't
  open from a bare URL. Inventre uses a **signed magic-link**: the QR must
  encode **`https://inventre.in/portal/enter?t=<token>`**, which logs the
  parent in (no password) and lands on `/portal`. A bare
  `https://inventre.in/portal` still asks for login.
- **Getting the token:** call Inventre **`POST /api/portal/token`**
  `{ parentId | phone, ttlDays? }` → `{ token, url }` (admin/service auth)
  and encode the returned `url` in the QR. (Or, if Audit shares Inventre's
  `PORTAL_TOKEN_SECRET`, mint locally per `lib/portal-token` format:
  `base64url({p:parentId,exp}).base64url(HMAC-SHA256)`.) Tokens expire
  (default 120 days) — regenerate for long-lived labels.

### 3.2 Admin Panel → production, not dev
- The staff Admin Panel opens `http://217.216.58.218:3081/parent-concerns`
  (**audit-dev**). Point it at **production**:
  `https://audit.inventre.online/parent-concerns` (confirm exact prod
  host/path). The system runs BOTH dev (`:3081`/`:8012`) and prod
  (`audit.inventre.online`/`:8011`) — these links must use **prod**.

### 3.3 Menu visibility split
- **Audit *website* (parent-facing):** show ONLY the Call-Centre modules —
  **Order & Delivery, Payment Issues, Customer Care.** Hide everything
  else. (This mirrors the Inventre `/portal`; if parents are meant to use
  the Inventre portal exclusively, the audit-website parent menu can be
  retired instead.)
- **Admin Panel (staff):** show the FULL set — Website Login, Student
  Details, Order & Delivery, Payment Issues, Customer Care, Size Exchange,
  View My Concern History. These stay **Admin-Panel-only**.

### 3.4 Concern ingest (new) — receive Inventre concerns
Inventre now emits **`concern.created`** to `/api/ecom/ingest` (same
channel + HMAC as orders/exchange). Audit should ingest it into the
call-centre queue so portal concerns appear in the Admin Panel. Envelope:
```jsonc
{ "concern": {
    "id": "<inventre uuid>",            // pin as ecom_id for status flips
    "concern_number": "CON-2026-00001",
    "category": "payment|order_delivery|customer_care",
    "description": "…",
    "contact_phone": "…",
    "status": "open",
    "photos": [],
    "created_at": "<iso>",
    "order": { "id", "order_number", "erp_so_name" } | null,
    "customer": { "display_name", "mobile", "email" } | null
} }
```
Status flips back to Inventre via `/api/erp/webhooks/...` (resolve by
`ecom_id`), same pattern as exchange/missing — wiring TBD when needed.

## Acceptance test (portal)
1. Scan a newly generated QR → opens `https://inventre.in/portal` (prod).
2. Admin Panel link opens the **production** parent-concerns, not `:3081`.
3. Parent raises a Payment Issue on `/portal` → a `CON-2026-…` concern is
   created in Inventre and appears in the Audit call-centre Admin Panel.
