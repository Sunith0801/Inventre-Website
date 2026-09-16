# Inventre — ERPNext Replacement Plan

**Goal**: drop dependency on `erp.inventre.in` (ERPNext). The new admin must be the operations system of record.

Living doc. Tracks the full gap list, status per item, and what's blocking
each. Update as items move from `pending` → `in-progress` → `done`.

---

## Verdict

| Timeline | Realistic? | Why |
|---|---|---|
| Cut over **today** | ❌ No | Checkout still on Razorpay; CCAvenue stub-only; no GSTR-1 JSON export; no real seed data. |
| Cut over **this month** (B2C only) | 🟡 Possible | Needs CCAvenue runtime + open-SO importer + real seed data + GSTR-1 JSON. |
| Full ERPNext parity (incl. B2B GST) | ❌ Multi-week | e-Invoice/IRN + e-Way Bill runtime require GSP credentials and 2–3 weeks of integration. |

---

## Gap categories

Three concentrated risks block the cutover. Everything else is either done,
schema-ready, or NICE-to-have.

1. **Payments**: only Razorpay works. CCAvenue is env-var detection only. No payment retry. No reconciliation.
2. **GST compliance runtime**: tax engine and per-line GST snapshots are done; GSTR-1 JSON, GSTR-3B, HSN-wise summary, IRN generation, e-Way Bill generation are missing.
3. **Accounting + purchasing tail**: Payment Entry exists but isn't reconciled against orders; Purchase Invoice table is missing; Purchase Receipt has schema but no UI; Stock Transfer / Reconciliation absent.

---

## Domain coverage (one row per ERPNext capability)

Status: `done` · `partial` · `missing`. Severity: `BLOCKING` (cutover blocker)
· `IMPORTANT` · `NICE`. Effort: S (≤1 day) · M (≤1 week) · L (multi-week).

### Catalog & variants
- ✅ Item, Item Variants, Item Bundles (incl. configurable)
- ✅ HSN code master, gst_treatment per item, custom_school, grade targeting,
  size chart, QR codes
- 🟡 Item Attribute master — schema present, **not seeded**. IMPORTANT · S.
- 🟡 Variant code parser canonicalization — partial. IMPORTANT · M.
- ❌ `custom_minimum_order_quantity` enforcement at cart. NICE · S.
- ❌ `custom_magic_box` flag. NICE · S.

### Pricing
- ✅ Price List + Item Price + school override + valid_from/until
- ✅ Cost / category margin / customer discount / gst_inclusive
- ✅ Coupons + bulk markup
- 🟡 `custom_organization_*` (suggested/agreed/MRP) — partially via itemPrices.
  IMPORTANT · M.
- ❌ Promotional Schemes, Loyalty, Gift Cards. NICE · L.

### Inventory & stock
- ✅ Warehouse, Bin (actual + reserved + min), Stock Ledger with reasons
  enum, low-stock report, projected_qty from open POs
- ❌ **Stock Reconciliation** (physical count → set qty). IMPORTANT · S. *(planned: this session)*
- ❌ **Stock Transfer** between warehouses. IMPORTANT · S. *(planned: this session)*
- ❌ Item Reorder rule auto-trigger. IMPORTANT · M.
- ❌ Auto-PO on low-stock. NICE · M.
- ❌ Stock Ageing report buckets. IMPORTANT · S. *(planned: this session)*
- ❌ Batch / Serial — uniforms don't need this. OUT OF SCOPE.

### Sales
- ✅ Sales Order, snapshots, replacement schema, walk-in POS, manual order,
  cancel + refund UI, Sales Invoice generation, Returns + Credit Note
- 🟡 **Replacement-order action** — schema supports it, **no admin button**.
  IMPORTANT · S. *(planned: this session)*
- ❌ Item-wise sales report. IMPORTANT · S. *(planned: this session)*

### Purchasing
- ✅ Supplier, Purchase Order list+create
- 🟡 Purchase Receipt — schema only, **no UI**. IMPORTANT · M. *(planned: this session)*
- ❌ Purchase Invoice — table missing. IMPORTANT · M. *(planned: this session)*
- ❌ Supplier-payment ↔ PO link logic. IMPORTANT · M.
- ❌ Purchase Register report. IMPORTANT · S. *(planned: this session)*

### Customer / users
- ✅ Customer naming series, parent/student linkage, Address book, gst_category,
  isFrozen, Role/Permission, audit log
- 🟡 `customer_group` (Student/School/Individual) — implicit. NICE · S.
  *(planned: this session as a small master)*
- ❌ Language preference. NICE · S.

### Tax / GST
- ✅ Tax Templates, HSN master, place_of_supply detection, gst_treatment per
  line, gst_inclusive, in/out-state CGST+SGST/IGST split
- 🟡 GSTR-1 — on-screen summary only. BLOCKING · M. *(scaffold this session: JSON export with the GSTN-portal section emitters; you provide auth)*
- ❌ GSTR-3B summary. BLOCKING · M.
- ❌ HSN-wise summary (GSTR-1 §12). BLOCKING · S. *(planned: this session)*
- ❌ e-Invoice / IRN runtime. BLOCKING for B2B · L.
  *(scaffold this session: NIC client interface; you provide GSP credentials)*
- ❌ e-Way Bill runtime. BLOCKING for shipments > ₹50k · L.

### Payments / accounting
- ✅ Razorpay (working, stubbed dev), 16 audit-listed payment fields, refund
  status lifecycle, payment_schedule, mode-of-payment values inline
- 🟡 Mode of Payment master — values used inline. NICE · S. *(planned: this session)*
- ❌ **CCAvenue gateway** — env detection only. BLOCKING · L.
  *(scaffold this session: AES-128-CBC encrypt + checksum + callback route shape; you provide CCAvenue access code + UAT credentials)*
- ❌ Payment retry route. IMPORTANT · S. *(planned: this session)*
- ❌ Payment Entry ↔ SO reconciliation logic. IMPORTANT · M.
- ❌ Journal Entry / Chart of Accounts / Cost Center / Fiscal Year master.
  NICE for B2C · L.
- ❌ Multi-currency. NICE · L.
- ❌ POS Profile / POS Invoice. NICE · L.

### Configuration
- ✅ Numbering Series (FY-keyed atomic counters), Backups + runbook,
  Data Export per type, Data Import for 6 doctypes
- 🟡 Notification rules (event → email/SMS) — code exists, not user-configurable.
  IMPORTANT · M.
- ❌ Workflow engine (generic state machine). NICE · L.
- ❌ Print Format / Letter Head editable templates. IMPORTANT · M.
- ❌ Email Template editor. IMPORTANT · M.
- ❌ Outbound webhooks. NICE · S.

### Reports
- ✅ Sales Register, Customer-wise sales, Fulfillment, Stock Balance, Stock
  Ledger drill-down
- ❌ Item-wise sales. IMPORTANT · S. *(planned: this session)*
- ❌ HSN-wise summary. BLOCKING · S. *(planned: this session)*
- ❌ Stock Ageing. IMPORTANT · S. *(planned: this session)*
- ❌ Purchase Register. IMPORTANT · S. *(planned: this session)*
- ❌ Outstanding receivables / aging. IMPORTANT · M.
- ❌ Returns analysis. NICE · S.

---

## Migration data plan

Importers present: Customer · Address · Item · Item Price · Bin · Sales Invoice.

| Doctype | Importer? | Action |
|---|---|---|
| Item Group (categories) | ❌ | *(planned: this session — categories CSV importer)* |
| Item Attribute + Values | ❌ | *(planned: this session — attributes CSV importer)* |
| Sales Order (open) | ❌ | *(planned: this session — open-only filter)* |
| Delivery Note (open) | ❌ | NICE — usually re-derived from open SOs |
| Purchase Order (open) | ❌ | IMPORTANT · S (later) |
| Variant attribute mapping | ❌ | NICE (auto-derived from variant code parser) |

Real seed data (12 schools, 30+ attribute types, full category tree) — the
**data itself is not in the repo**. You must export it from ERPNext as CSV and
run the importer; the CSV importer + new doctype handlers will load it.

---

## Top 10 ranked gaps (with detailed dependency notes)

1. **CCAvenue gateway** — *scaffold this session*. Real production cutover requires:
   merchant ID, access code, working_key (UAT first, then prod), the URL
   whitelist for CCAvenue's redirect callback, and at least one successful
   round-trip test against UAT. The crypto helpers and callback route shape
   will land; **you must drop credentials in `.env.deploy` and run the UAT
   transaction yourself.**
2. **Open Sales Order importer** — *this session*. CSV maps to existing
   `orders` table; we filter `status IN ('Draft','To Deliver','To Bill')`.
3. **Real seed data + Item Group + Item Attribute importers** — *importers
   this session; data load is your task* (you have the source ERPNext, this
   side has the receivers).
4. **GSTR-1 JSON export** — *scaffold this session*. Section emitters (B2B,
   B2CL, B2CS, HSN, EXP, CDNR/CDNUR) follow the GSTN portal v2 spec. The
   JSON download lands; **uploading to the portal is your monthly process via
   GST Suvidha Provider.**
5. **HSN-wise summary report** — *this session*. Pure SQL aggregation.
6. **e-Invoice / IRN runtime** — *interface this session*. The NIC GSP
   client (`lib/einvoice.ts`) is structured; you must provide GSP credentials
   (`EINVOICE_USERNAME`, `EINVOICE_PASSWORD`, `EINVOICE_GSTIN`,
   `EINVOICE_API_BASE`) and authorize the GSTIN with NIC IRP.
7. **Payment-retry route** — *this session*. `/api/checkout/retry/[orderId]`.
8. **Replacement-order from return** — *this session*. Action button on
   `/admin/returns/[id]` and a small POST endpoint.
9. **Purchase flow completion** — *this session*. Purchase Receipt UI +
   Purchase Invoice schema + UI.
10. **Stock Reconciliation + Stock Transfer** — *this session*. Two new forms
    on `/admin/catalog/stock`.

---

## What's already ahead of ERPNext (don't rewrite)

- Atomic numbering with FY-keyed UPSERT counters
- Atomic stock decrement via `applyStockChange` + `FOR UPDATE` + ledger
- School-scoped multi-tenancy (no native ERPNext equivalent)
- Full bundle engine with PDP rendering for configurable bundles
- Grade-aware catalog filtering with class normalization
- GST tax engine with inclusive/exclusive + per-line snapshots
- 6 importers covering the bulk of migration weight
- Backups + deploy automation runbook
- Atomic checkout decrement + memoized per-request session loader

---

## Implementation log (this session)

Session date: 2026-05-08. Type-check + production build both clean.

| Status | Item | Where |
|---|---|---|
| ✅ done | Replacement-order action button on returns | `/api/admin/returns/[id]` action `create_replacement` + button on returns detail page |
| ✅ done | Payment retry route | `/api/checkout/retry/[orderId]` |
| ✅ done | Stock Reconciliation form | `/admin/catalog/stock/reconcile` + `/api/admin/stock/reconcile` |
| ✅ done | Stock Transfer form | `/admin/catalog/stock/transfer` + `/api/admin/stock/transfer` |
| ✅ done | HSN-wise summary report | `/admin/reports/hsn` + `/api/admin/reports/hsn` (CSV export) |
| ✅ done | Item-wise sales report | `/admin/reports/items` + `/api/admin/reports/items` (CSV export) |
| ❌ removed 2026-09-15 | Stock ageing report | was `/admin/reports/stock-ageing` — local bins never hold real stock (it lives in the audit ERP) |
| ✅ done | Purchase Register report | `/admin/reports/purchase` (with top-supplier rollup) |
| ✅ done | Purchase Receipt UI | `/admin/purchase-receipts` + `/api/admin/purchase-receipts` + Receive button on PO detail |
| ✅ done | Purchase Invoice schema + UI | `purchase_invoices` + `purchase_invoice_items` tables (migration 0003) + `/admin/purchase-invoices` create/list |
| ✅ done | Open Sales Order importer | `lib/importers/sales-order.ts` |
| ✅ done | Item Group importer | `lib/importers/category.ts` |
| ✅ done | Item Attribute importer | `lib/importers/attribute.ts` |
| ✅ done | Mode of Payment master | `modes_of_payment` table + seed (migration 0003) |
| ✅ done | Customer Group master | `customer_groups` table + seed (migration 0003) |
| ✅ done | MOQ enforcement at cart | `lib/repos/cart.ts` `addToCart` / `setCartQty` |
| 🟡 scaffold | CCAvenue gateway | `lib/ccavenue.ts` (AES-128-CBC + checksum) + `/api/checkout/ccavenue/create-order` + `/api/checkout/ccavenue/callback`. **Real cutover requires CCAvenue UAT credentials in `.env.deploy`: `CCAVENUE_MERCHANT_ID`, `CCAVENUE_ACCESS_CODE`, `CCAVENUE_WORKING_KEY`, `CCAVENUE_API_BASE`, `CCAVENUE_REDIRECT_URL`, `CCAVENUE_CANCEL_URL`. Whitelist redirect URL with CCAvenue support and run a UAT round-trip.** |
| 🟡 scaffold | GSTR-1 JSON export | `lib/gstr1.ts` (B2B/B2CL/B2CS/HSN/CDNR section emitters per v2.1) + `/api/admin/reports/gstr1` (download button on `/admin/reports/gst`). **Set `MERCHANT_GSTIN` env. Accountant must verify before portal upload.** |
| 🟡 scaffold | e-Invoice / IRN runtime | `lib/einvoice.ts` (IRP v1.1 payload builder + GSP relay POST) + `/api/admin/invoices/[id]/einvoice`. **Real cutover requires `EINVOICE_USERNAME`, `EINVOICE_PASSWORD`, `EINVOICE_GSTIN`, `EINVOICE_API_BASE` from a GSP (Cleartax / IRIS / Masters India). Stubbed in dev.** |

### Re-check vs. doc gap matrix

Recheck after this session:

- Catalog/variants — `done` items still done; new: schema + UI for **Magic-box flag** ✅, **MOQ enforcement** ✅. Item Attribute master can now be loaded via importer.
- Pricing — Bulk markup already done. No change.
- Inventory — Stock Reconciliation ✅, Stock Transfer ✅, Stock Ageing ✅. Auto-PO + Material Request remain `❌` (NICE).
- Sales — Replacement-from-return ✅. Item-wise report ✅. Walk-in POS already done.
- Purchasing — Purchase Receipt UI ✅, Purchase Invoice schema + UI ✅, Purchase Register ✅. Supplier-payment ↔ PO link still `❌` (IMPORTANT, M).
- Customer/users — Customer Group master ✅. Language pref still `❌` (NICE, S).
- Tax/GST — GSTR-1 JSON export ✅ scaffold, HSN summary ✅, e-Invoice/IRN ✅ scaffold. GSTR-3B summary remains `❌` (BLOCKING for filing parity, M).
- Payments — Payment retry ✅, CCAvenue ✅ scaffold, Mode of Payment master ✅. Payment Entry ↔ SO reconciliation logic still `❌` (IMPORTANT, M).
- Reports — HSN ✅, item-wise ✅, ageing ✅, purchase register ✅. Outstanding receivables/aging still `❌` (IMPORTANT, M).

### What remains NOT covered this session

(empty — see Session 4 below for the items previously listed)

### Session 3 additions (2026-05-08, second batch)

| Status | Item | Where |
|---|---|---|
| ✅ done | Real seed data scaffolding | `db/seed-real-schools.ts` (already existed) — 12 audit schools, full category tree, 25+ attribute masters with values. Run `npx tsx db/seed-real-schools.ts` |
| ✅ done | GSTR-3B summary report | `/admin/reports/gstr3b` + `/api/admin/reports/gstr3b` (JSON download) + `lib/gstr3b.ts` (sections 3.1, 3.2 auto-computed; 4 + 6 placeholders for accountant) |
| ✅ done | Outstanding receivables aging | `/admin/reports/receivables` (Current / 1–30 / 31–60 / 61–90 / 90+ buckets) |
| ✅ done | Payment Entry ↔ SO reconciliation | `/api/admin/payments` POST now flips `invoices.outstandingAmount` + `status`, `orders.paymentStatus`, and `purchase_invoices.outstandingAmount` based on `direction` and linked refs |
| 🟡 scaffold | e-Way Bill runtime | `lib/ewaybill.ts` (NIC EWB v1.03 payload + GSP relay) + `/api/admin/shipments/[id]/ewaybill`. Stubs in dev. Needs `EWAYBILL_USERNAME/PASSWORD/GSTIN/API_BASE` |
| ✅ done | Notification rules editor | `notification_rules` table + `/admin/settings/notifications-rules` editor + `lib/event-bus.ts` dispatcher with template variable substitution |
| ✅ done | Outbound webhooks | `webhook_endpoints` + `webhook_deliveries` tables + `/admin/settings/webhooks` editor + `lib/event-bus.ts` HMAC-SHA256 signed dispatcher with exponential-backoff retry + `/api/cron/retry-webhooks` cron entry |
| ✅ done | Auto-PO scheduler | `lib/auto-po.ts` — groups low-stock variants by most-recent supplier, drafts one PO per supplier. `/api/cron/auto-po` (cron) + `/api/admin/stock/auto-po` (manual trigger) |

---

### Session 4 additions (2026-05-08, third batch)

| Status | Item | Where |
|---|---|---|
| ✅ done | ERPNext puller | `lib/erp/puller.ts` (Frappe REST list + detail with pagination) + `/admin/settings/erp-sync` page + `/api/admin/erp/pull` endpoint. **Drop `ERP_BASE_URL` / `ERP_API_KEY` / `ERP_API_SECRET` in `.env.deploy`, click "Pull from ERPNext now" — done.** Pulls in dependency order: Item Group → Attributes → Items → Item Prices → Bins → Customers → Addresses → Open SOs → Sales Invoices |
| ✅ done | Variant code canonicalization | `lib/variant-code.ts` parser handles `{SchoolPrefix}{Parent}{Color}{Size}{Separator}` pattern. School-prefix list + size pattern + per-school color resolution against `schools.colorMap`. Available for use in importers and search. |
| ✅ done | Loyalty program | `loyalty_ledger` table (migration 0004) + `lib/repos/loyalty.ts` with earn / preview / redeem / adjust. Auto-awards on order.delivered transition. Configurable via `system_settings`: `loyalty.earn_paise_per_rupee`, `loyalty.redeem_paise_per_point`, `loyalty.max_redeem_pct`. Admin API at `/api/admin/loyalty/[parentId]`; parent balance at `/api/loyalty/balance`. |
| ✅ done | Gift cards | `gift_cards` + `gift_card_redemptions` tables (migration 0004) + `lib/repos/gift-cards.ts` (HMAC-checksum codes, atomic redeem with `FOR UPDATE`). Admin issue UI at `/admin/gift-cards/new` (one-time code reveal). Parent lookup at `/api/gift-cards/lookup`. |

## Cutover readiness checklist

Before throwing the switch from ERPNext:

- [ ] CCAvenue credentials in `.env.deploy`, UAT round-trip verified
- [ ] All 6 existing importers + 3 new ones tested against ERPNext export
- [ ] Open Sales Orders imported and reconciled against ERPNext open list
- [ ] Bin opening balances imported and matched against ERPNext stock balance
- [ ] At least one GSTR-1 JSON download verified by accountant
- [ ] One real customer end-to-end: shop → checkout → invoice → ship → deliver
- [ ] One walk-in admin order end-to-end (cash, UPI)
- [ ] One return end-to-end with refund + credit note
- [ ] Read-only mirror to ERPNext kept for ~30 days for audit comparison
