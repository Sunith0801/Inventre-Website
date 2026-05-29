# Inventre Build vs ERPNext Audit — Gap Report

> **Date**: 2026-05-02 · **Auditor**: Engineering
> **Reference**: `inventre-erp-complete-audit.md` (1500 lines, 12 parts)
> **Build state**: tag `v1.11-phase-2-to-11-complete` (commit `98c9353`)
> **Method**: Line-by-line comparison of audit doc vs schema, libs, routes, seed.

---

## TL;DR

The build covers the **structural** spine of the audit — schema, GST engine, invoicing, shipments, returns, discounts, bundles, reports, and admin pages all line up with what the audit describes. **But three production-blocking gaps remain**, and a long tail of medium-severity items is unmet.

| Category | Gaps | Status |
|---|---|---|
| 🔴 **Critical** | 3 | Block production cutover |
| 🟡 **High** | 9 | Degrade ops; workarounds exist |
| 🟠 **Medium** | 13 | Need before "feature parity" claim |
| 🟢 **Low** | 6 | Polish |
| ⚪ **Out-of-scope (correct)** | 4 | Option B excludes them by design |

---

## 🔴 CRITICAL gaps (production blockers)

### C1. CCAvenue payment integration — **ENTIRELY MISSING**

**Audit §4 (whole section)** describes the live payment system:
- 16 custom fields on Sales Order (`custom_gateway_provider`, `custom_payment_flow`, `custom_gateway_order_id`, `custom_payment_status`, `custom_payment_mode`, `custom_paid_amount`, `custom_gateway_tracking_id`, `custom_gateway_response_message`, `custom_refund_status`, `custom_payment_attempt_count`, `custom_payment_retry_count`, `custom_payment_finalized`, `custom_checkout_notification_sent`, etc.)
- 11 modes of payment (Credit Card, Debit Card, Net Banking, UPI, Wallet, EMI, COD, Cash, Amazon Pay, …)
- ONLINE vs COD `payment_flow` distinction
- Full payment flow §4.3: Draft SO → CCAvenue redirect → callback → submit
- `custom_refund_status`: NOT_REQUESTED / PENDING / SUCCESS / FAILED

**What we have:**
- `lib/razorpay.ts` (stub mode in dev) — wrong gateway, was supposed to be replaced per `OPTION_B_PLAN.md` §11 #1 "CCAvenue replaces Razorpay"
- `payments` table with **6 generic fields** (provider, providerPaymentId, amount, status, method, raw) instead of CCAvenue's 16 specific ones
- `app/api/checkout/create-order/route.ts` calls `createRzpOrder()` (Razorpay)
- `app/api/checkout/verify/route.ts` calls `verifyPaymentSignature()` (Razorpay HMAC)
- Verified by codebase search: `ccavenue|CCAvenue|CCAVENUE` returns **only documentation files**, zero implementation files.

**Impact:** Cannot accept production payments. Cannot match the live ERP's payment-status field semantics. Refund tracking has no place to live.

**Required work:**
- New `lib/ccavenue.ts` — encrypted form-post payload + checksum verifier
- Schema: extend `payments` (or `orders`) with the 16 audit-listed fields
- Rewrite `/api/checkout/create-order` to build CCAvenue redirect
- Rewrite `/api/checkout/verify` to decrypt CCAvenue response + signature check
- New `/api/ccavenue/webhook` for server-to-server callbacks
- New `/api/checkout/retry` for `payment_retry_count` increments
- Modes-of-Payment table or enum (currently ad-hoc text)

**Estimated effort:** 1.5–2 weeks.

---

### C2. Grade-based item targeting — **MISSING from schema**

**Audit §2.3 + §6.2 step 2:**
```
custom_uniform_grade[]  → Grades this item is for (Grade 4–10 etc.)
custom_organization_grade[] → Org-level grade assignments
```
**Audit §6 step 2:** "Parent selects child's grade (Grade 1, Grade 2... Grade 12) → Filter items by `custom_uniform_grade[].grade = "Grade X"`"

This is how the live ERP shows a Grade-5 student only the books and uniform sized for Grade 5.

**What we have:**
- `students.class` (text field) and `schools.gradesServed` (text array)
- Verified by codebase search: `custom_uniform_grade|uniform_grade|gradeFilter|gradesAvailable` returns **only audit doc**, zero implementation
- **No way to associate a product with the grades it's intended for.**

**Impact:** Without this, the parent's catalog can't be filtered to relevant uniform sizes for their student. Today every parent sees every product, regardless of student grade.

**Required work:**
- New table `productGrades`: `(productId, grade, isOrganization)` PRIMARY KEY (productId, grade)
  ```sql
  CREATE TABLE product_grades (
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    grade TEXT NOT NULL,
    is_organization BOOLEAN DEFAULT FALSE,
    PRIMARY KEY (product_id, grade)
  );
  ```
- API: `/api/admin/products/[id]/grades` — set grades the product applies to
- Public catalog filter: `GET /api/shop/products?grade=Grade%205` adds `WHERE EXISTS (SELECT 1 FROM product_grades WHERE product_id = products.id AND grade = 'Grade 5')`
- PDP: don't show variant if grade doesn't match (or show "not for your grade" badge)
- Admin UI: grade picker in product edit form

**Estimated effort:** 3 days.

---

### C3. Real seed data not loaded — **schema correct, content empty**

**Audit §2.1, §2.5, §12** describe the live data:
- 12 schools with item-code prefixes (KLS, QLS, SAM/SAMYU, SAS BP, SAS KS, SAS SC/SMS, CAS LR, CAS NIBM, DLSU, WM JK, WM WF, TSUS)
- Full category tree (Uniform → Regular/Sports/Accessories/Essentials/Winter, plus Books, Books Bundle, etc.)
- ~30 attribute types with all their values (Shirt Size 18-58 even, Half Pants Size with A-D sub-codes, 18 color attribute groups including per-school house colors, 17 INVENTRE BAG DESIGNs, water bottle models, etc.)
- Books Bundle configs per school × grade (CAS LR Grade 9 → AI/Painting/FM Stream, etc.)

**What we have:**
- `db/seed.ts` seeds **demo schools** (Indus, Yellow Train, Winmore, Greenwood, Ekya, Orchids, VIBGYOR, DPS) — NOT the real 12.
- `productAttributes`, `productAttributeValues`, `productBundles`, `bundleSelectors`, `bundleComponents`, `bundleConfigs` tables are **all empty by default**.
- Verified: `grep -n "KLS\|KLINK\|SAMYU\|SAS BP\|TSUS" db/seed.ts` returns nothing.

**Impact:** Ops users testing the system see fake schools and zero attributes. Bundle products can't be configured. The admin panel is structurally correct but feels empty.

**Required work:**
- Update `db/seed.ts` to seed the 12 real schools with their prefixes, grades, curriculum
- Seed the audit's full category tree (~30 categories)
- Seed all 30+ attribute types from audit §2.5 with their values (Shirt Size 18→58, all colors, all bag designs, water bottle models)
- Seed at least one Books Bundle config per school (per audit §2.5 last table)
- This is mostly data, no logic

**Estimated effort:** 2 days (mechanical translation from audit doc).

---

## 🟡 HIGH gaps (degrade ops, workarounds exist)

### H1. Multi-layer pricing fields missing

**Audit §2.3 PRICING CUSTOM FIELDS:**
```
custom_inventre_cost_price        → Inventre's cost          ← we have (costPrice)
custom_category_fixed_margin      → Fixed margin %           ← MISSING
custom_suggested_organization_price → Suggested org price    ← MISSING
custom_agreed_price_org           → Agreed school price      ← MISSING
custom_organization_margin        → School markup            ← MISSING
custom_organization_mrp           → School MRP override      ← MISSING (we have school_id on item_prices but no separate MRP per school)
custom_customer_discount          → Customer discount %      ← MISSING (different from discount_rules — this is product-level)
custom_display_price              → For ecommerce display    ← we have (displayPrice)
```

**What we have:** A single `costPrice` + `displayPrice` on products, plus `itemPrices` table with school overrides. We can store *one* school price, not the full audit waterfall (cost → category margin → suggested org → agreed org → org markup → org MRP → customer discount → display).

**Impact:** Pricing flows that rely on margin layers (the way the live business prices items) cannot be expressed.

**Recommended fix:** Add columns to `products`:
- `categoryFixedMarginPercent`
- `customerDiscountPercent`

Plus rows in `itemPrices` for each school in the `MRP` price list.

**Effort:** 2 days.

---

### H2. `custom_gst_inclusiveexclusive` flag — missing

**Audit §2.3:** `custom_gst_inclusiveexclusive: "Inclusive" or "Exclusive"`

If a price is inclusive of GST, the displayed price is the customer's final amount and tax is computed by reversal. If exclusive, tax is added on top. The audit's CCAvenue invoices likely show inclusive pricing; ours has no flag.

**Impact:** Price displays may show pre-tax when audit expects post-tax (or vice versa). Invoice line-item math could be off.

**Fix:** Add `products.gstInclusive BOOLEAN DEFAULT TRUE` (Indian retail convention is inclusive).

**Effort:** 1 day (schema + tax engine adjustment).

---

### H3. Order does not snapshot grade

**Audit §3.4 SO fields:**
```json
"custom_student_school": "SAMYU-Samyuktha School",
"custom_student_grade": "Grade 9"
```

**What we have:** `orders.studentId` (FK). Grade is `students.class`. If the student moves up a grade after the order, the order will reflect the *new* grade, not what was true at order time.

**Impact:** Audit trail integrity. Reports broken down by grade-at-time-of-purchase are wrong.

**Fix:** Add `orders.gradeSnapshot TEXT` populated at order create.

**Effort:** 1 hour (column + 1-line write).

---

### H4. No manual order creation UI

**Audit §6** assumes a phone-order workflow exists somewhere (ops staff places orders for parents who call). The plan §5 said "Phase 5: manual phone-order creation".

**What we have:** API endpoint exists (`POST /api/admin/orders/...`), but **no admin UI form** at `/admin/orders/new`.

**Fix:** Build the form.

**Effort:** 1 day.

---

### H5. No shipment creation UI

**What we have:** `POST /api/admin/shipments` works (validated in E2E), but the admin user has no `/admin/shipments/new` form. They must POST via curl or the browser console.

**Fix:** "Create shipment from order" form on `/admin/orders/[id]` page (pick items + qty).

**Effort:** 1 day.

---

### H6. Stock adjustment UI missing

**What we have:** `POST /api/admin/stock/adjust` works. No form.

**Fix:** Modal or page at `/admin/catalog/stock/adjust` (variant, warehouse, +/- qty, reason).

**Effort:** 0.5 day.

---

### H7. Returns approval / receive / refund UI missing

**What we have:** `POST /api/admin/returns/[id]` accepts `{action: approve|reject|receive|refund}`. The list page renders. No action buttons.

**Fix:** Add action buttons + modals to `/admin/returns/[id]/page.tsx`.

**Effort:** 1 day.

---

### H8. Bundle PDP frontend missing

**What we have:** `GET /api/shop/bundles/[productId]` returns the selector config. The parent-facing `/shop/[slug]` PDP is not aware of bundles — it renders a flat product page.

**Fix:** PDP detects `productBundles` row → renders dynamic selectors → adds bundle line to cart with selections.

**Effort:** 3 days (this is the user-facing innovation from audit §2.5 last table).

---

### H9. Discount apply UI in cart

**What we have:** `POST /api/cart/apply-coupon` works. The parent `/shop/cart` page has no input field to type a code.

**Fix:** Coupon input + display on cart page.

**Effort:** 0.5 day.

---

## 🟠 MEDIUM gaps (need before "complete" claim)

### M1. Replacement orders (`custom_is_replacement_so`)

Audit §3.4 has a `custom_is_replacement_so` flag. If a return is approved and the customer wants a replacement (not a refund), an SO with this flag = 1 is created.

**We don't model replacements at all.** Returns can only refund.

**Fix:** Add `orders.isReplacement BOOLEAN`, `orders.replacementForOrderId UUID`, and a "Create replacement" action on the return detail page.

**Effort:** 2 days.

---

### M2. Magic Box product type (`custom_magic_box`)

Audit §3.4 has `custom_magic_box: 0` and §2.2 lists "Magic Box" as a top-level item group. It's a premium bundle product.

**We don't recognize this concept.**

**Fix:** Either treat it as just-another-bundle (likely fine) or add a flag if the business needs special handling.

**Effort:** 1 day if special handling needed; 0 days if treated as a regular bundle.

---

### M3. Custom_sub_items child table at order time

Audit §3.4 shows orders carry a `custom_sub_items[]` table snapshotting bundle components. This is what makes order returns work for bundles ("return only the Hindi book from the bundle").

**What we have:** Bundle is expanded into separate `orderItems` rows (Phase 9 design), which is functionally equivalent BUT loses the parent-bundle reference.

**Fix:** Add `orderItems.parentBundleProductId` to track which bundle a line came from.

**Effort:** 1 day.

---

### M4. Order percentages: `delivery_status`, `billing_status`, `per_delivered`, `per_billed`

Audit §3.4 shows these fields. They show "30% delivered" etc. Used in admin dashboards to spot stuck orders.

**What we have:** Order has a single `status` enum.

**Fix:** Add computed views or denormalized columns updated on shipment events:
- `orders.deliveredPercent INT` (0-100)
- `orders.billedPercent INT` (0-100)
- Recompute on shipment.markDelivered + invoice.create

**Effort:** 2 days.

---

### M5. Orders need order-level warehouse selection

Audit §3.4: `set_warehouse: "Stores - IESPL"`. If we ever add multi-warehouse, the order needs to remember which warehouse it shipped from.

**What we have:** Default warehouse only; warehouse is on `bins` and `shipments` but not `orders`.

**Fix:** Add `orders.warehouseId UUID` snapshot.

**Effort:** 0.5 day.

---

### M6. `gst_category` on customer + invoice

Audit §3.2 + §3.5: customers can be `Unregistered` (B2C, default) or `Registered` (B2B with GSTIN). Invoices reflect this.

**What we have:** `addresses.gstin TEXT` only. No `gstCategory` on `parents` or `invoices`.

**Impact:** B2B invoices can't be flagged as GSTIN-bearing without code changes.

**Fix:**
- `parents.gstCategory` ENUM('Unregistered','Registered')
- `invoices.gstCategory` (snapshot)
- B2B customers see GSTIN field on checkout

**Effort:** 1.5 days.

---

### M7. Multiple companies (audit's IESPL + M)

Audit §1 mentions IESPL (e-commerce) + M (manufacturing). All e-commerce goes to IESPL, so we can ignore M for v1, but the invoice print page hard-codes "Inventre Edu Services Pvt Ltd" / GSTIN `36AAMCP1199C1ZA`. If a second company is ever added, we'd need a `companies` table and per-order company assignment.

**Fix:** Defer until needed.

---

### M8. Customer naming series (CUST-2026-NNNNN)

Audit §3.2: customers have `naming_series: "CUST-.YYYY.-"` and a human-readable name.

**What we have:** UUIDs only.

**Impact:** Ops can't quickly read a customer ID. Admin URLs are long UUID hashes.

**Fix:** Add `parents.customerCode TEXT UNIQUE` populated at create.

**Effort:** 0.5 day.

---

### M9. `is_frozen` separate from `status`

Audit §3.2: customer has `is_frozen` (no new orders allowed) AND `disabled` separately.

**What we have:** Just `status` (active/blocked/pending).

**Impact:** Can't soft-freeze a customer (e.g., for fraud review) without fully blocking them.

**Fix:** Add `parents.isFrozen BOOLEAN`.

**Effort:** 0.5 day (low priority).

---

### M10. Invoice `is_debit_note`, `payment_schedule[]`

Audit §3.5: invoices can be `is_debit_note=1` (different from credit note via `is_return=1`). And `payment_schedule[]` is a child table for installment plans.

**What we have:** Only `isReturn` flag.

**Impact:** Can't issue debit notes (charge corrections) or split payments across due dates.

**Fix:** Add `invoices.isDebitNote BOOLEAN` and a `paymentSchedules` child table if needed.

**Effort:** 1 day.

---

### M11. `projected_qty` for purchase orders

Audit §3.7: `projected_qty = actual_qty - reserved_qty + ordered_qty`. The `ordered_qty` reflects incoming purchase orders.

**What we have:** No purchase order concept. We only track outgoing reservations.

**Impact:** Can't show "X units arriving from supplier on Y date" in stock view.

**Fix:** Add `purchaseOrders` + `purchaseOrderItems` tables (out of scope for v1; plan it for v1.2).

---

### M12. Variant code parser

Audit §2.4: variant codes follow `{Parent}{ColorLetter}{Size}{Separator}` pattern. Our schema doesn't enforce or parse these.

**Impact:** Only matters for Phase 12 ERPNext data migration.

**Fix:** `lib/variant-parser.ts` — already mentioned in plan, not yet written. **Defer to Phase 12.**

---

### M13. Item QR codes (`pm_qr_code`, `pm_qr_data`)

Audit §2.3: items carry an SVG QR code with `{type, item_code, item_name, weight, cbm, checksum}`. Used by warehouse staff for physical inventory and packing.

**What we have:** None.

**Impact:** Warehouse barcode workflows not supported.

**Fix:** Generate QR at item save (use a library like `qrcode`); store in `products.qrCodeSvg` + `products.qrCodeData JSONB`.

**Effort:** 1 day.

---

## 🟢 LOW gaps (polish)

| # | Item | Effort |
|---|---|---|
| L1 | Customer language preference (`parents.language`) | 0.5 day |
| L2 | `custom_display_status` — admin-overridable order status text | 0.5 day |
| L3 | Order `delivery_date` field (target ship-by date) | 0.5 day |
| L4 | `custom_minimum_order_quantity` per product (we have it, not enforced in cart) | 0.5 day |
| L5 | Item dimensions used in shipping rate calc | varies |
| L6 | `weightPerUnit` standard field separate from `weightGrams` | 0.5 day |

---

## ⚪ OUT-OF-SCOPE (correctly excluded by Option B)

| # | Audit section | Why excluded |
|---|---|---|
| O1 | §5 ERPNext API client code | Option B: no runtime ERP calls |
| O2 | §7 ERPNext webhooks | Same reason |
| O3 | §8 ERP database schema reference | Informational only |
| O4 | §9 Live stock samples | Comes via Phase 12 migration |

---

## What this means

Today's build is **structurally complete** but **functionally incomplete for production cutover**:

- **Schema**: ~85% of audit's data model is captured. Missing: grade-on-product, the 7 audit pricing custom fields, GST inclusive flag, replacement-SO concept.
- **APIs**: ~90% of admin operations are exposed as endpoints. Missing: CCAvenue everything.
- **Admin UI**: ~70% — list pages exist, but several create/action forms aren't built (shipments, returns approval, stock adjust, manual order, bundle config).
- **Parent UI**: ~95% — only bundle PDP and coupon-input field are missing.
- **Seed data**: ~20% — 8 demo schools + 10 test products vs the audit's 12 schools + ~6,000 items. Real data lands in Phase 12.
- **CCAvenue**: 0% — biggest single gap.

## Recommended order to close gaps

| Order | Item | Reason |
|---|---|---|
| 1 | **C1 — CCAvenue** | Production blocker; nothing else matters if payments don't work |
| 2 | **C2 — Grade targeting** | Core e-commerce filter; without it the parent's catalog is useless |
| 3 | **H1 — Multi-layer pricing** | Without it, ops can't reproduce live business pricing |
| 4 | **H2 — GST inclusive flag** | Tax math is wrong on display until this is set |
| 5 | **H3 — Order grade snapshot** | 1-hour fix; just do it |
| 6 | **H4-H7 — Admin UI gaps** | Make ops self-sufficient (shipment create, returns approve, stock adjust, manual order) |
| 7 | **H8 — Bundle PDP frontend** | Books Bundle is the audit's most distinctive parent-side feature |
| 8 | **C3 — Real seed data** | Once code is stable, replace demo schools with the 12 real ones |
| 9 | **M-series** | Per business need |

## Estimated work to close all 🔴 + 🟡 gaps

| Phase | Items | Days |
|---|---|---|
| **Phase B-12 (CCAvenue)** | C1 | 8–10 |
| **Phase B-13 (Grade & Pricing)** | C2, H1, H2, H3 | 5 |
| **Phase B-14 (Admin UI completion)** | H4, H5, H6, H7, H9 | 4 |
| **Phase B-15 (Bundle PDP)** | H8 | 3 |
| **Phase B-16 (Real seed)** | C3 | 2 |
| **Total to "production-ready"** | | **22–24 days** |

---

*End of gap report. The Option B build at `v1.11` is structurally sound but is not yet a drop-in replacement for the live ERPNext system. The biggest single missing piece is CCAvenue.*
