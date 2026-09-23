# Offline orders: staff SOP when the storefront or CCAvenue is down

**Owner:** Operations · **Related:** DR & BCP v1.2 action D-09, Section 2.2 (CCAvenue fallback), Section 8 (degraded operation) · **Form:** `docs/runbooks/offline-order-form.html` (print one per coordinator) · **Admin page:** `/admin/orders/new`

"Offline mode" means the school coordinator takes orders on paper and staff key them into
Inventre afterwards. It is a fallback for two situations only: the storefront is down during a
school's ordering window, or CCAvenue cannot take payment for a prolonged period. Money is
collected at the school (cash or UPI to the school/Inventre account) and recorded as an offline
payment; the online gateway is never involved.

## Quick checklist (10 lines)

1. Owner declares offline mode for a named school and window (phone + group chat); nobody else may.
2. Comms lead sends template 4 (payment outage) or template 1 (store down) to the school coordinator.
3. Coordinator prints `offline-order-form.html`, one sheet per 6 orders; fills school, date, own name.
4. For each order the coordinator writes: student, **enrolment no.**, class/section, **guardian phone**, items + sizes, amount, cash or UPI ref, guardian signature.
5. Coordinator collects payment at the school and keeps a running cash/UPI tally that matches the sheets.
6. When the store is back, the owner says so; staff key sheets in at `/admin/orders/new` (needs `orders.write`).
7. Match the student by **enrolment + phone**, never by name alone; unresolved rows go to a "held" pile, not into the system.
8. Enter payment as `cash` or `upi` with the UPI reference; status `paid`. Write the order number back on the sheet.
9. Push each keyed order to the Audit ERP (the admin page does not queue it automatically; see Step 5).
10. Owner closes offline mode; coordinator hands in sheets + tally; staff reconcile totals and file the sheets.

## 1. Who decides

- Only the **incident owner** (company owner, see DR-BCP Section 4) switches a school to offline
  mode and back. The decision is per school and per window, never "everyone, indefinitely".
- Triggers: the storefront has been unavailable for more than about 30 minutes inside a school's
  ordering window, or CCAvenue has failed payments for more than about 30 minutes and the
  5-minute reconcile is not healing them (DR-BCP Scenario D). Short blips are not offline mode:
  parents can retry, and their cart is saved.
- The **communications lead** tells the coordinator and the call centre, using the templates in
  DR-BCP Section 7. The parent-facing line for a payment outage is template 4: online payment is
  unavailable, urgent orders can be placed through the school coordinator.
- The **technical lead** records the start and end of offline mode in the incident timeline, so
  the keyed-in orders can be reconciled against the window.

## 2. What the coordinator collects on paper

Use `docs/runbooks/offline-order-form.html` (open in a browser, print A4). Nothing else is
needed. Per order the form asks for:

| Field | Why it matters when keying in |
|---|---|
| Student name | Human check only; the database name can differ ("Daiwik" vs "Daivik S Jain") |
| **Enrolment number** | Primary key for finding the student; MyClassBoard/school roll number |
| Class / section | Confirms the right grade so the right kit or box is picked |
| **Guardian phone (10 digits)** | Second key; this is the parent's login and the order's receiver phone |
| Items: kit / uniform sizes / magic box | Exactly what to add; sizes as printed on the size chart (e.g. `Track Pant 32`) |
| Amount collected (₹) | What the parent actually paid, to the rupee |
| Payment mode: cash or UPI ref | Cash, or the 12-digit UPI transaction reference |
| Guardian signature | Consent for the order and the amount |

Rules for the coordinator:

- One student per row. A sibling is a separate row (their own enrolment and, if different, phone).
- Write sizes for every uniform piece. A Magic Box is one line ("Magic Box G4 boys") plus the
  chosen sizes for its components; a bookkit is one line.
- Price from the school's current price list (staff can read it out of `/admin/products` →
  Price List by school, or the coordinator's printed copy). Do not guess; if unsure, write "TBC"
  and staff confirm the amount before keying.
- Keep a running total of cash and of UPI receipts per sheet, and initial the sheet when full.
- Never write the parent's OTP, password or full card number anywhere.

## 3. Keying the orders in: the admin page (normal path)

When the owner says the store is back, a staff member with the `orders.write` permission opens
**`/admin/orders/new`** ("Create order — walk-in / phone order. Pick a customer and school, add
items, capture payment offline"). Per paper row:

1. **Find the customer** by the guardian's **phone** (the search box takes phone, name or e-mail;
   use the phone). If no customer exists, use *New customer* with the 10-digit phone and the
   guardian's name.
2. **Pick the school**, then the **student** from the dropdown (it shows name and class). The
   dropdown does not show the enrolment number, so confirm it before proceeding: open the
   student in `/admin/students` (search by enrolment) and check the phone on that record is the
   one on the sheet. Enrolment + phone must both match; see Section 4.
3. **Add items**: search the product, click the size/variant shown on the sheet. Quantities
   default to 1. The admin builder handles plain items and kits listed as products; for a
   **Magic Box** with component sizes, key the box as the product and note the component sizes
   in the *Notes* field, then see Section 5 (Magic Boxes need the bundle selections that only
   the storefront or the script write).
4. **Receiver details**: the parent's phone is pre-filled from the customer; address is the one
   on the student's last order (open it from the customer record) or the school's pickup address.
5. **Payment**: method `cash` or `upi`; reference = the UPI reference from the sheet (leave blank
   for cash); status **`paid`**. If the coordinator marked "TBC" or the money was not collected,
   set status `pending` — the order sits at `placed` until payment is confirmed.
6. Click create. The page shows the new **order number** (`SAL-ORD-…`). Write it in the sheet's
   footer line ("Keyed into Inventre by ____ on ____ (order no. ______)") with your name and date.

What the API does on `paid` (from `app/api/admin/orders/route.ts`): marks the order `confirmed`,
decrements stock bins, and writes a `payment_entries` row (the received-cash audit trail) with the
method and reference. Every creation is logged in the admin activity log under `order.create`.

## 4. Matching the student: enrolment + phone, never name only

- Names in the database differ from what parents write (spelling, initials, nicknames), and
  near-namesakes exist in the same grade (a real case: two "Daivik … Jain" in one TSUS grade,
  enrolments 21029 and 21002).
- The rule: the **enrolment number on the sheet must find exactly one active student in that
  school**, and the **guardian phone on the sheet must be the phone on that student's parent
  record** (or a linked co-guardian). If either fails, do not key the order; put the sheet on the
  "held" pile and ask the coordinator to confirm with the parent.
- Do not create a duplicate student to make a row fit. Duplicate students break the one-Magic-Box-
  per-student rule and the sibling picker.
- If the parent has no customer record at all (new admission), create the customer with the
  phone from the sheet, then ask the school to add the student through the usual bulk import;
  key the order once the student exists.

## 5. Keying via script (Magic Boxes, or when the admin page is unavailable)

The reusable engineering path is the one-off script used for the last manual paid offline order
(SAL-ORD-2026-41967, 2026-09-18). It lives **outside the repo** on the production host:

`/root/ops-scripts/create-offline-order-21029-trackpant.ts`

Header, verbatim as to usage:

```
DATABASE_URL=… npx tsx --conditions=react-server \
  scripts/create-offline-order-21029-trackpant.ts [--commit]

Dry-run by default.
```

How it is used (engineering only):

- Copy the file, change the constants at the top (`ENROLLMENT`, `PHONE10`, `SKU`, `QTY`,
  `EXPECT_PAISE`, `PAY_REF`, and the school slug in the student lookup), run it once without
  `--commit` to see the resolved student, parent, item, price and address printed, then run it
  again with `--commit`. There are no other flags.
- It refuses to write if the enrolment is not found, the parent's phone does not end in
  `PHONE10`, the SKU is unknown, the price list disagrees with `EXPECT_PAISE`, or the parent has
  no earlier paid order to copy the address from. It is idempotent on `PAY_REF`
  (`payments.internal_payment_reference`), so a re-run cannot double-create.
- The **offline payment-row convention** it writes (same shape as the 306 YIPS offline orders):
  `provider` and `method` = `offline`, `payment_flow` and `gateway_provider` = `OFFLINE`,
  `payment_mode` = `Offline`, `payment_date` = IST `YYYY-MM-DD` text, `paid_amount` = rupees as
  text (`435.00`), `payment_finalized` = true, `gateway_order_id` = the order number,
  `internal_payment_reference` = `offline:<enrolment>-<what>-<yyyymmdd>`.
- The order number comes from the app's own `allocOrderNumber()`, so it stays in the live
  `SAL-ORD` sequence; the row is `confirmed` / `paid`.
- After the transaction commits it inserts an `erp_outbound_queue` row (`order.created`,
  `pending`); the erp-drain cron (every 30 s) pushes it to the Audit ERP without any further step.
- `DATABASE_URL` is taken from the running app container (pgbouncer rewritten to the host port);
  the command line is in the memory note `manual-offline-order-single-item.md`. Never paste the
  URL into chat, tickets or this document.

For a batch of many offline orders in one school, the CSV importer
`scripts/import-yips-offline-orders.ts <file.csv> [--apply]` is the precedent (one Magic Box per
order, priced as the sum of components, skip-and-report on any ambiguity, dry-run by default). It
is hard-wired to the YIPS school slug and Magic Box shape; adapting it is an engineering task, not
a staff one.

**Pushing admin-page orders to the Audit ERP.** `POST /api/admin/orders` creates the order and
the payment entry but does **not** insert an `erp_outbound_queue` row, so the warehouse will not
see it until it is pushed. After keying a batch, engineering runs, per order id (dry-run first):

```
DATABASE_URL=… npx tsx --conditions=react-server scripts/reemit-one-order.ts <orderId> [--apply]
```

Confirm in the ERP-bridge admin page that each order shows `sent`.

## 6. Payment reconciliation

- Cash and UPI collected at the school are **not** CCAvenue money. They never appear in the
  settlement files, and the hourly `ccavenue-settlement-reconcile` and 5-minute
  `ccavenue-reconcile` crons ignore them. They live only in `payment_entries` (admin page) or the
  `offline` payment row (script). Do not expect them to "heal" from the gateway.
- At the end of offline mode the coordinator hands in: the sheets, the cash, and the UPI receipts.
  Staff total the sheets, total the `payment_entries` rows created that day
  (`/admin/orders` filtered to the window, or the payment entries export), and the two must agree
  to the rupee. Any difference is resolved before the sheets are filed, not after.
- An order the parent placed online *and* on paper during the window is a duplicate: keep the
  online one if its payment captured, cancel the offline one and refund the cash through the
  school. The one-Magic-Box-per-student guard will normally block the second box; a plain kit will
  not be blocked, so check `/admin/orders` by student before keying.
- Orders keyed as `pending` (money not yet in hand) must be closed within the week: either the
  parent pays at the school (mark paid from the order page) or the order is cancelled.

## 7. What to tell the parent

- At the school (coordinator): "Online ordering / payment is unavailable today. Your order has been
  taken on paper and paid at the school; you will receive the same order confirmation once it is
  entered, within [1–2] working days. Keep this slip as your receipt." Write the sheet number and
  row on the parent's copy of the receipt.
- After keying (call centre or SMS, adapt DR-BCP template 3): "Your order [SAL-ORD-…] placed
  through the school on [date] is now in the system. You can see it under My Orders on inventre.in.
  Delivery will follow the school's schedule." Note that the exchange/missing-item window is
  7 days from delivery, exactly as for online orders.
- Do not promise a refund path through CCAvenue for offline payments; refunds of offline money go
  back through the school or bank transfer, recorded as a `payment_entries` row.

## 8. Closing offline mode

1. Owner confirms the storefront (or CCAvenue) is healthy: a test login and a test order to the
   CCAvenue test page succeed (DR-BCP Scenario A step A6 checks).
2. Owner tells the coordinator to stop taking paper orders **at a stated time**; anything after
   that time goes online. Comms lead sends the all-clear (template 3).
3. All sheets are keyed within 2 working days; every row has an order number or is on the
   "held" pile with a reason. Held rows are chased with the coordinator daily.
4. Reconciliation (Section 6) signed off by the owner; sheets filed with the incident record.
5. Technical lead adds the offline window, the number of orders keyed, and any duplicates or
   holds to the post-incident review; this SOP is updated if anything was awkward.
