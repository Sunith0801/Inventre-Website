# Exchange + Missing-Item Test Scenarios (dev)

> Dev surfaces only. Phone-gated to `EXCHANGE_TESTER_PHONES=7013232148`.
> Storefront: `http://localhost:3020` · Audit: `http://217.216.58.218:3081` · Backend API: `http://217.216.58.218:8012`

---

## 0. Test accounts

| Persona              | Where         | Login                            | Sees                                  |
| -------------------- | ------------- | -------------------------------- | ------------------------------------- |
| Tester (customer)    | inventre dev  | OTP login as `7013232148`        | Tarun's order history                 |
| `admin`              | audit dev     | `admin / Admin#123`              | Everything across all schools         |
| `school_smsaw`       | audit dev     | `school_smsaw / <pw>`            | Only SMSAW-scoped exchanges + claims  |
| `school_sasks`       | audit dev     | `school_sasks / <pw>`            | Only SASKS-scoped exchanges + claims  |
| warehouse user       | audit dev     | warehouse_team role              | Pack + returns queues                 |

Customer aliases for Tarun: `CUST-2026-00003`, `CUST-CUST-2026-00003`, `CUST-2026-00003-SASKS`. All three should resolve to the same person in CustomerHero.

---

## 1. EXCHANGE — Happy paths

### 1.1 Wrong size (simple, non-kit)
1. Customer opens a delivered order on storefront → "Need an exchange?"
2. Pick line item (non-kit), reason **wrong_size_delivered**, choose target size, upload photo, submit.
3. ✅ Storefront shows `RTN-…` request created, status "Awaiting review".
4. Audit `agent`: opens `/exchange-requests`, sees card, opens detail.
5. ✅ CustomerHero shows: Tarun · phone · address · school chips · KPIs · recent orders.
6. ✅ "What they got" and "What they want" cards correct.
7. Agent enters approval note → **Approve**. Status flips to `approved`.
8. ✅ Packing unit auto-provisioned → appears in `/warehouse/exchange-packs`.
9. Warehouse: pack + seal + dispatch via existing Warehouse Dispatch flow.
10. School (`school_smsaw` if SMSAW): `/school/exchange-pickups` shows the inbound pickup; mark **handed over to customer** with optional note.
11. ✅ Status: `received` (terminal). Storefront shows "Completed".
12. Reverse leg: school holds the original item → `/school/exchange-returns` → attach carrier + AWB, mark shipped.
13. Warehouse: `/warehouse/exchange-returns` → mark received → choose disposition (restocked / scrapped / repaired / vendor_returned).
14. ✅ Each step writes an activity row visible in detail page's Activity tab.

### 1.2 Damaged item
- Same as 1.1 but reason **damaged**. Photo evidence is required; verify uploader works.

### 1.3 Wrong item shipped
- Reason **wrong_item**. "What they want" should default to the correctly-mapped variant of the same SKU family.

### 1.4 Kit / Magic Box component exchange
1. Customer order contains a kit (e.g. "Grade 5 Magic Box").
2. On exchange form, expand kit → pick **one component** (not the whole box).
3. ✅ Form should accept component-level selection.
4. Audit detail: "What they got" shows component drill-down with parent kit name.
5. Approve → `/warehouse/exchange-packs` shows the **component** as "Item to pack" with `from kit · <parent kit name>` annotation.
6. ✅ Only the component is packed, not the whole kit.

### 1.5 Defective after use
- Reason **defective**, optional text reason. Verify the optional reason text shows in detail page.

---

## 2. EXCHANGE — Rejections & edge cases

### 2.1 Agent rejects with note
- Open requested exchange → Reject with reason text.
- ✅ Status → `rejected`. No packing unit created.
- ✅ Storefront: status shows "Rejected" with reason visible to customer.
- ✅ Cannot approve a rejected request (button disabled).

### 2.2 Storefront — non-tester phone
- Log in with a phone NOT in `EXCHANGE_TESTER_PHONES`.
- ✅ "Need an exchange?" CTA hidden; route returns 403.

### 2.3 Order not delivered yet
- Try raising exchange on a sales order whose status is still in transit.
- ✅ Storefront blocks with helpful copy ("Available after delivery").

### 2.4 Order past return window
- If a window exists (e.g. delivered 90 days ago): exchange should be blocked or warn.
- ✅ Confirm copy matches business policy.

### 2.5 Duplicate exchange against same line
- Raise an exchange on a line. While first is `requested`/`approved`, try raising another on the same line.
- ✅ Storefront should block with "You already have an exchange in progress for this item."

### 2.6 Multiple exchanges, different lines, same order
- Raise wrong_size on line A and damaged on line B of the same SO.
- ✅ Two distinct RTNs, both visible in audit, independently approvable.

### 2.7 Concurrent approve race
- Two agents (or two tabs) open same requested exchange. Both press Approve.
- ✅ Second one returns 409 "Cannot approve from status 'approved'".

### 2.8 Photo upload failures
- Submit form with no photo when reason requires one.
- ✅ Validation error.
- Upload >10MB file → ✅ size limit error surfaces.

### 2.9 Empty / corrupted note
- Approve with empty note → ✅ should be allowed (note is optional in approve).
- Reject with empty reason → ✅ should require reason.

### 2.10 Cancelled by customer
- After raising, customer cancels from storefront before approval.
- ✅ Status → `cancelled`. Agent sees it in `cancelled` filter. No pack provisioned.

---

## 3. MISSING ITEM — Happy paths

### 3.1 Single item missing (non-kit)
1. Customer opens delivered order → "Item missing from delivery?"
2. Select missing line + qty, photo of opened parcel, submit.
3. ✅ MIS-… created, status `requested`.
4. Audit agent: `/missing-claims` → open detail → CustomerHero loads.
5. ✅ "What they say is missing" shows the item + qty.
6. Approve with note → ✅ packing unit auto-provisioned, visible in `/warehouse/missing-packs`.
7. ✅ **Customer column** shows Tarun + phone (the gap we just closed).
8. Warehouse packs + seals + dispatches.
9. School marks **received_at_school**.
10. School hands over to customer → ✅ status `delivered`. No reverse leg.

### 3.2 Kit component missing
- Customer says one item inside a Magic Box was missing.
- ✅ Detail shows component drill-down with parent kit name.
- ✅ Pack unit packs only the missing component.

### 3.3 Multiple items missing, same order
- Raise two MIS rows for the same SO, different items.
- ✅ Two independent records, two pack units, both must complete to close.

---

## 4. MISSING ITEM — Rejections & edge cases

### 4.1 Reject as fraud / not credible
- Agent rejects → ✅ status `rejected`, no pack, customer notified.

### 4.2 Phone outside allowlist
- ✅ CTA hidden, API 403.

### 4.3 Order not yet delivered
- ✅ Storefront blocks: "Available after delivery — please wait."

### 4.4 Missing item is not on the original SO
- Customer claims item X missing, but SO didn't contain X.
- ✅ Storefront line selector only shows SO lines (cannot pick off-order item).

### 4.5 Repeat claims by same customer
- ✅ 90-day count badge ("3 in 90d") appears on queue card.
- ✅ ≥3 claims in 90d should colour badge **rose** (risk flag).
- ✅ CustomerHero "Risk band" should mark as high.

### 4.6 Race against exchange
- Customer has an open exchange AND raises missing-item on different line of same SO.
- ✅ Both should coexist; one packing unit per record.

---

## 5. RBAC — Cross-school isolation

### 5.1 admin sees everything
- `/exchange-requests`: 18 rows · `/missing-claims`: 9 rows (or current totals).

### 5.2 school_smsaw scoping
- Only SMSAW-school rows visible.
- ✅ Opening an SASKS exchange URL directly returns 403 (not just hidden).
- ✅ Pickup + return queues only show SMSAW.

### 5.3 school_sasks scoping
- Only SASKS rows visible. Same direct-URL test.

### 5.4 warehouse user
- `/warehouse/exchange-packs`, `/warehouse/exchange-returns`, `/warehouse/missing-packs` work.
- ✅ Detail page accessible (read-only review of CC fields).

### 5.5 Customer with students at two different schools
- Tarun has students at SMSAW + SASKS.
- ✅ `school_smsaw` sees Tarun's SMSAW exchanges only; `school_sasks` sees SASKS only.
- ✅ Detail page CustomerHero shows BOTH school chips regardless of who's viewing — because identity is across schools.

---

## 6. Customer-summary endpoint (`/api/customers/{name}/summary`)

### 6.1 Alias resolution
- Hit endpoint with `CUST-2026-00003`, `CUST-CUST-2026-00003`, `CUST-2026-00003-SASKS`.
- ✅ All three return same lifetime KPIs (orders, value, exchanges_90d, missing_90d).
- ✅ Issue counts identical (uses ANY(:codes) over all alias keys).

### 6.2 Schools list
- ✅ Returns both SMSAW and SASKS entries with student names + grades.

### 6.3 Recent orders
- ✅ Last ~5 SOs with status, date, value.

### 6.4 Risk band
- 0 issues → none/low. 1–2 → medium. 3+ → high (rose chip).

### 6.5 No-such-customer
- Bad code → ✅ 404, CustomerHero shows null-state without crashing the detail page.

---

## 7. UI / UX surface tests

### 7.1 Queue card — age coloring
- requested + >48h → rose + bold + ring (urgent).
- requested + >24h → amber + bold.
- requested + <24h → slate.
- non-requested status → always slate.

### 7.2 Queue card — history badge
- 0 in 90d → no badge.
- 1–2 → amber badge with `History` icon.
- ≥3 → rose badge with `AlertTriangle` icon.

### 7.3 Search
- Search by phone (full or partial).
- Search by `RTN-…` / `MIS-…` claim number.
- Search by customer name.
- Search by SO number.
- ✅ All four shapes match.

### 7.4 Sort
- Newest first (default).
- Oldest first (urgent for SLA).
- Risk (90-day count desc).

### 7.5 Status filter
- Default `requested`. Each chip filters correctly. "All" clears.

### 7.6 Detail page tabs
- Evidence: photos open in lightbox; ESC closes.
- Activity: chronological event log; system + human entries.
- Logistics: shipping carrier, AWB, dates, disposition.

### 7.7 Approve / Reject zone
- Approve note required visually; field validates.
- Reject inline form requires reason.
- Mark-delivered button only enables in the right precondition state.

### 7.8 CustomerHero actions
- Call → `tel:` link.
- SMS → `sms:` link.
- WhatsApp → `https://wa.me/<digits>` opens in new tab.
- Email → `mailto:` link.

---

## 8. Storefront ↔ Audit sync (webhooks)

### 8.1 Inventre → audit
- Customer raises exchange → audit receives `exchange.created` within 30s.
- Customer cancels → audit receives `exchange.cancelled`.

### 8.2 Audit → inventre
- Agent approves → storefront updates to "Approved" within 30s.
- Warehouse dispatches → storefront shows "In transit".
- School marks delivered → storefront shows "Completed".

### 8.3 Webhook HMAC
- Tamper signature on a replay → ✅ rejected with 401.
- Replay with stale timestamp → ✅ rejected.

### 8.4 Audit downtime
- Stop audit backend, raise an exchange on storefront.
- ✅ Storefront should succeed locally; bridge retries.
- ✅ When audit returns, event lands and request appears.

---

## 9. Data integrity sanity

### 9.1 No orphan pack units
```sql
SELECT pu.* FROM packing_units pu
LEFT JOIN exchange_requests ex ON ex.id = pu.exchange_request_id
LEFT JOIN missing_item_claims mc ON mc.id = pu.missing_claim_id
WHERE pu.exchange_request_id IS NOT NULL AND ex.id IS NULL
   OR pu.missing_claim_id IS NOT NULL AND mc.id IS NULL;
```
✅ Should return 0 rows.

### 9.2 No exchange in terminal state with active pack
```sql
SELECT ex.id, ex.return_number, ex.status, pu.status
FROM exchange_requests ex JOIN packing_units pu ON pu.exchange_request_id = ex.id
WHERE ex.status IN ('rejected','cancelled') AND pu.status IN ('open','sealed');
```
✅ 0 rows expected.

### 9.3 Customer aliases roll up consistently
- For each `mobile_no`, count distinct `customer_name` — should be 1 per phone.

---

## 10. Smoke checklist (5-minute version)

If short on time, run this exact path end-to-end:

- [ ] Customer raises **wrong_size** exchange on SMSAW order (kit component).
- [ ] `admin` approves → pack appears in warehouse queue.
- [ ] Warehouse seals + dispatches.
- [ ] `school_smsaw` confirms handover.
- [ ] `school_sasks` opening the same exchange URL → 403.
- [ ] Customer raises **missing item** claim on SASKS order.
- [ ] `admin` approves → `/warehouse/missing-packs` shows Customer column with Tarun + phone.
- [ ] Mark delivered. Storefront shows both as Completed.

---

_Last updated 2026-06-08._
