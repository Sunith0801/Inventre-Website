# Inventre ↔ ERPNext — End-to-End Integration & Admin Rebuild Plan

> **Author**: Engineering · **Date**: 2026-05-02 · **Status**: Master Plan v1
> **Scope**: Re-platform `inventre` Next.js site onto ERPNext as system of record.
> **Source documents**: `inventre-erp-complete-audit.md`, current Next.js codebase (`app/`, `db/`, `lib/`).

---

## 0. Executive Summary

We are not building a new e-commerce site. We are **pivoting an existing Next.js site to be the modern front-end of a live ERPNext system** that already processes ~23,400 orders through CCAvenue with 6,035 items and 15,614 customers.

The current Inventre Next.js admin panel is a stand-alone CRUD layer over its own Postgres. After this plan, **ERPNext is the single source of truth**, the Next.js admin becomes a **read-mostly operations console** with deep links into ERP, and orders are written directly into ERP at checkout.

**Three pillars:**

1. **ERP-first data flow.** Catalog, customers, orders, stock, prices, GST come from ERP. Inventre Postgres becomes a thin **mirror + cache + UX-overlay** layer (banners, testimonials, FAQs, CMS, reviews, wishlists, sessions).
2. **Hybrid sync strategy.** Catalog is pulled (initial bulk + webhook + periodic). Orders are pushed (Inventre → ERP at checkout). Stock is checked live at cart-validate and again at order-submit.
3. **Admin panel rebuild.** From a simple CRUD layer to an ERP-aware operations console: live stock, live orders, customer search, school + bundle configuration, sync health, with hard-deep-links into the ERP UI for anything advanced.

**Big migrations involved:**
- Razorpay → **CCAvenue** (ERP already uses CCAvenue with 16 SO custom fields).
- Inventre product schema → **mirror of `tabItem` + variant relationships**.
- Inventre order schema → **gains `erp_so_name` + payment custom fields aligned to ERP**.
- Custom variant codes (e.g. `SAM Boys PantK22$$`) → parsed/decoded at sync, never assembled by hand.
- Tax calc → **pincode-based in-state/out-state with Nil-Rated for uniforms**.

---

## 1. Current State vs Target State

### 1.1 Current Inventre Next.js (verified by E2E test, 127/127 passing)

| Area | Current implementation |
|---|---|
| Catalog | Own `products`, `productVariants`, `categories`, `schools` tables. Admin CRUD via `/api/admin/products`, `/api/admin/categories`, `/api/admin/schools`. |
| Customers | `parents` table; OTP via MSG91; `students` (one student per parent, multi-school). |
| Orders | `orders` + `orderItems` + `payments`; status enum `placed → confirmed → packed → shipped → delivered`; total in paise. |
| Cart | Redis 7d TTL + Postgres mirror. |
| Pricing | `productVariants.price`. Single price per variant, no school overrides used yet. |
| Stock | `productVariants.stockQty` decremented atomically on `payment.captured` webhook. |
| Payments | Razorpay (stub mode in dev). HMAC-verified webhook idempotent. |
| Tax | Hard-coded 0% (`TAX_PCT = 0` in `app/api/checkout/create-order/route.ts`). |
| Admin | 17 pages, simple CRUD. |
| Reviews / FAQs / Testimonials / CMS | Inventre-native — should **stay** Inventre-native (ERP doesn't manage these). |

### 1.2 Target State

| Area | Target implementation |
|---|---|
| Catalog | Mirror from ERPNext (`tabItem`, `tabItem Group`, `tabItem Variant Attribute`, `tabItem Price`, `tabBin`). Inventre keeps a denormalized Postgres copy + Redis cache for fast reads, refreshed by webhook + 5-min cron. |
| Customers | ERP `tabCustomer` is canonical. Inventre `parents` table holds local-only fields (notification preferences, last_login, MSG91 OTP state) and an `erp_customer_name` FK. Find-or-create by phone/email at first OTP. |
| Orders | Inventre creates a draft order in its own DB **and** a draft `Sales Order` in ERP atomically. CCAvenue is hit. On success: PUT the SO with payment fields → submit the SO. Inventre order rows mirror ERP status from webhooks. |
| Cart | Stays Inventre-only (Redis + Postgres). Stock is verified live against ERP `tabBin` at cart-display, cart-add, and again at SO-create. |
| Pricing | Read from ERP `Item Price` (price_list = `Standard Selling`). Cached. |
| Stock | Live read from ERP `tabBin` (cached 60s). Snapshot at order time. |
| Payments | **CCAvenue** replaces Razorpay. New `lib/ccavenue.ts`. SO custom fields: `custom_payment_status`, `custom_gateway_order_id`, `custom_paid_amount`, `custom_gateway_tracking_id` etc. |
| Tax | Auto-detect in-state/out-state via shipping pincode → choose `Output GST In-state - IESPL` or `Output GST Out-state - IESPL` template. Most uniform items are Nil-Rated → 0%. Socks/stationery → 18%. |
| Admin | Rebuilt around ERP semantics. Item browser with variant tree + live Bin. Orders dashboard with payment + fulfillment status from ERP. Customer search. Books bundle configurator. Sync health dashboard. |

---

## 2. Architecture Decision Record

We considered three patterns:

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| **A. Full mirror** — replicate everything to Inventre Postgres on schedule. | Fast reads. Survives ERP outage. | Two sources of truth; sync drift; complex reconciliation; admin writes split-brain. | ❌ |
| **B. Pure pass-through** — every read/write is a live ERP API call. | Single source of truth; no drift. | Latency (each PDP = 4–6 ERP calls); ERP outage = site down; breaks the 20K-concurrent target. | ❌ |
| **C. Hybrid (chosen)** — mirror + cache for reads, direct push for writes. | Fast reads; ERP authoritative; survives short ERP blips for browsing; clear write paths. | Sync code; webhook reliability; needs reconciliation cron. | ✅ |

### 2.1 Hybrid rules of engagement

| Domain | Read path | Write path |
|---|---|---|
| **Items / variants / categories** | Inventre cache (Redis 5min, Postgres mirror). | All writes go through ERP UI. Webhook updates Inventre mirror. |
| **Item Price** | Inventre cache (Redis 5min). | ERP UI / ERP API. Webhook → cache invalidate. |
| **Stock (Bin)** | **Live ERP** at cart-add, cart-display, checkout. Cache 60s for catalog browsing only. | ERP only. Webhook on `Bin.after_save` → invalidate cache for that item. |
| **Customer** | Local cache + ERP fallback. | Inventre creates customer in ERP at first checkout (find-or-create by phone). |
| **Address** | ERP `Address` linked via Dynamic Link. Cache per customer. | Inventre creates address in ERP; mirrors locally for UX. |
| **Sales Order** | ERP at order-detail render; mirrored locally for orders list. | Inventre creates draft SO at checkout; updates payment fields on CCAvenue callback; submits SO. |
| **Delivery Note / Invoice** | ERP via webhook; mirrored locally for "track my order" page. | Created in ERP by warehouse staff. |
| **Reviews / Testimonials / FAQs / CMS / Banners** | Inventre Postgres (unchanged). | Inventre admin (unchanged). |

### 2.2 Why this works for the 20K-concurrent target

The audit shows ERP has 23K+ orders; that's roughly the volume *per year*. Concurrent peak load on the Inventre site (during back-to-school season) is what hits 20K. The hybrid model keeps **the hot path (browsing) entirely on the Inventre cache** while orders (a sub-fraction of traffic) round-trip to ERP. ERP becomes the bottleneck for *checkout throughput*, not for catalog throughput. A queued/retry pattern absorbs ERP transient errors at the order-submit boundary.

---

## 3. Data-Model Mapping

This is the crucial table — it dictates the schema migration in §5.1.

| Inventre table | ERP equivalent | Linking field on Inventre |
|---|---|---|
| `schools` | (not a DocType) — string in `Item.custom_school_name` and `Sales Order.custom_student_school` | `schools.erp_school_name` (TEXT, unique) |
| `categories` | `tabItem Group` (also a tree) | `categories.erp_item_group_name` (TEXT, unique) |
| `products` (`has_variants=1` in ERP) | `tabItem` where `has_variants=1` | `products.erp_item_code` (TEXT, unique = ERP `name` PK) |
| `productVariants` | `tabItem` where `variant_of != null` | `productVariants.erp_item_code` (TEXT, unique) |
| `productImages` | `tabItem.image` (one) + `tabFile` attached | `productImages.erp_file_url` (TEXT) |
| `parents` | `tabCustomer` where `customer_group='Student'` | `parents.erp_customer_name` (TEXT, unique) |
| `students` | (no direct equivalent — stays Inventre-only) | — |
| `addresses` | `tabAddress` linked via `tabDynamic Link` | `addresses.erp_address_name` (TEXT, unique) |
| `orders` | `tabSales Order` where `order_type='Shopping Cart'` | `orders.erp_so_name` (TEXT, unique) |
| `orderItems` | `tabSales Order Item` | `orderItems.erp_so_item_idx` (INT) |
| `payments` | (custom fields on Sales Order — no separate Payment Entry yet) | `payments.erp_so_name` (TEXT) |
| `productVariants.stockQty` | `tabBin.actual_qty - tabBin.reserved_qty` | (no FK; queried by `erp_item_code`) |
| `productVariants.price` | `tabItem Price` where `price_list='Standard Selling'` | (no FK; queried by `erp_item_code`) |
| `reviews`, `testimonials`, `faqs`, `contentBlocks`, `wishlists` | — (Inventre-only) | — |

**Pricing units:** Inventre stores in **paise** (×100). ERP stores in **rupees** (float). Conversion at the boundary in `lib/erp/items.ts`.

**Order numbers:** Inventre generates `INV-2026-XXXX` (already deployed). ERP generates `SAL-ORD-2026-XXXXX`. Both are stored on the order row. Customer-facing UI uses Inventre's number. Internal ops use ERP's.

**The CCAvenue gateway order ID** is generated by Inventre and *passed to ERP* in `custom_gateway_order_id` so ERP and Inventre agree on the gateway reference (audit §4.3 confirms this is the existing flow).

---

## 4. ERP Client — `lib/erp/`

A single dependency, used by every code path that touches ERP.

```
lib/erp/
├── client.ts          // Low-level: erpGet/erpPost/erpPut/erpDelete + auth + retries + circuit breaker
├── items.ts           // Products: parents, variants, attributes, pricing, stock
├── item-groups.ts     // Categories tree
├── customers.ts       // findOrCreate, addresses
├── orders.ts          // create, update payment, submit, cancel, list, get
├── stock.ts           // Bin queries, available = actual - reserved
├── prices.ts          // Item Price reads
├── delivery.ts        // Delivery Note + invoice queries
├── tax.ts             // pincode → tax template + Telangana state detection
├── variants.ts        // Variant code parser + attribute decoder (per-school maps)
├── webhooks.ts        // HMAC verification + payload typings
└── types.ts           // Zod schemas for every DocType we read/write
```

### 4.1 Key invariants

- **Every ERP call is wrapped in `withRetry(fn, { tries: 3, backoff: 'expo' })`.** Idempotent reads retry freely; non-idempotent writes (POST without idempotency key) retry only on connect/5xx.
- **Circuit breaker.** After 5 consecutive failures in 30s, ERP is marked unhealthy → catalog falls back to last cache; checkout returns "Try again" with a clear error.
- **Authentication.** `Authorization: token ${ERP_API_KEY}:${ERP_API_SECRET}` from env.
- **Logging.** Every ERP call logs `{path, method, status, ms, soName?, itemCode?}` to a `tabIntegrationLog` (Inventre-side table) for debugging.
- **All DTOs go through Zod.** ERP returns JSON in unpredictable shapes (Frappe `data` vs `message`); a single normalizer in `client.ts` handles this.

### 4.2 Variant parser (`lib/erp/variants.ts`)

The audit §2.4 gives the pattern: `{ParentItemCode}{ColorLetter}{Size}{Separator}` with separator ∈ {`$`, `$$`, `$$$`}.

```ts
type ParsedVariant = {
  parentItemCode: string;
  colorCode: string;        // single uppercase letter, e.g. "K"
  colorLabel: string | null; // resolved per-school: "Kalpana Chawla - RED"
  size: string;             // "22", "L", "2XL", "4UK"
  separator: "$" | "$$" | "$$$";
};

export function parseVariantCode(itemCode: string, parentCode: string): ParsedVariant;
```

But because the regex is fragile (some sizes contain digits, some letters), the **canonical source for color/size is `tabItem Variant Attribute`**. The parser is a fallback only. At sync time we always pull the attribute child table:

```
GET /api/resource/Item/{variantCode}?fields=["attributes"]
```

Per-school **color-letter → label maps** live in `db.schools.colorMap` (JSONB), populated by an admin tool in §6.

### 4.3 Tax detection (`lib/erp/tax.ts`)

```ts
export function getTaxTemplate(pincode: string): "Output GST In-state - IESPL" | "Output GST Out-state - IESPL" {
  const pin = parseInt(pincode, 10);
  return (pin >= 500000 && pin <= 536999)
    ? "Output GST In-state - IESPL"
    : "Output GST Out-state - IESPL";
}
```

The audit confirms most uniform items are `gst_treatment: "Nil-Rated"` → 0% regardless of template. Socks (HSN 61012000 but `gst_treatment: "Taxable"`) → 18% in-state, 18% out-state IGST. **The template just controls the tax accounts; the rate per item is determined by `gst_treatment` on each Item.** We don't need to compute rates — ERP does that on SO submit.

---

## 5. Phased Implementation Plan

Eight phases, each shippable. Estimated order of size, not committed dates. Each phase has explicit Done criteria and explicit rollback.

### Phase 1 — Foundations & ERP Client (1 week)

**Goal:** ERP is reachable from Inventre in dev. Read-only smoke tests pass.

**Deliverables:**
- `.env.example` adds `ERP_BASE_URL`, `ERP_API_KEY`, `ERP_API_SECRET`, `ERP_DEFAULT_COMPANY=Inventre Edu Services Pvt Ltd`, `ERP_DEFAULT_WAREHOUSE=Stores - IESPL`, `ERP_PRICE_LIST=Standard Selling`.
- `lib/erp/client.ts` (auth + retry + circuit breaker + Zod normalizer).
- `lib/erp/items.ts`, `item-groups.ts`, `customers.ts`, `orders.ts`, `stock.ts`, `prices.ts`, `delivery.ts`, `tax.ts` skeletons.
- `scripts/erp-smoke.ts` — pings ERP, lists 1 school's items, prints variant tree for 1 product, prints stock for 1 variant, prints last 5 SOs.
- Adds `npm run erp:smoke` to `package.json`.
- Migration `db/migrations/2026XXXX_add_erp_link_columns.sql` adding nullable columns:
  - `schools.erp_school_name`
  - `categories.erp_item_group_name`
  - `products.erp_item_code`
  - `productVariants.erp_item_code`
  - `parents.erp_customer_name`
  - `addresses.erp_address_name`
  - `orders.erp_so_name`, `erp_payment_status`, `erp_gateway_order_id`, `erp_gateway_tracking_id`, `erp_paid_amount`, `erp_paid_at`
  - `orderItems.erp_so_item_idx`

**Done when:** `npm run erp:smoke` exits 0 against staging ERP.
**Rollback:** drop the new columns; delete `lib/erp/`. No production impact.

---

### Phase 2 — Catalog Mirror (1.5 weeks)

**Goal:** Inventre Postgres mirrors ERP catalog. Public catalog reads come from the mirror.

**Initial bulk sync (`scripts/erp-bulk-import.ts`):**

1. Pull all `tabItem Group` (audit §5.3). Upsert into `categories` matching by `erp_item_group_name`, building tree via `parent_item_group`.
2. Distinct values of `Item.custom_school_name` → upsert `schools.erp_school_name`. Existing Inventre-managed metadata (logo, banner, color theme) remains.
3. Pull all `tabItem` where `has_variants=1` → upsert `products` (paise conversion on price fields).
4. Pull all `tabItem` where `variant_of IS NOT NULL` → upsert `productVariants`. For each, pull `attributes` child table and store `{size, color}` (resolved) in JSONB.
5. Pull all `tabItem Price` where `price_list='Standard Selling'` → update `productVariants.price`.
6. Pull all `tabBin` where `warehouse='Stores - IESPL'` → update `productVariants.stockQty = actual_qty - reserved_qty`.

**Periodic delta sync (`scripts/erp-delta-sync.ts` run by cron every 5 min):**
- Use ERP's `modified` timestamp filter: `["modified", ">", lastSyncTimestamp]` per DocType. Cheap and reliable.
- Same upsert logic, no destructive deletes (items are `disabled=1`, not deleted, in ERP).

**Webhooks (Phase 4 wires these):**
- `Item.after_save` → re-sync that item.
- `Item Price.after_save` → invalidate price cache for that variant.
- `Bin.after_save` → invalidate stock cache for that item.

**Catalog API rewrite:**
- `GET /api/shop/products` reads from mirror (already does — schema unchanged).
- `GET /api/shop/products/[slug]` reads from mirror **+ live Bin check** for "in stock" badge.
- `GET /api/shop/categories` reads from mirror tree.
- `GET /api/shop/variant?productId=…&size=…` resolves to a specific variant, reads live Bin.

**Done when:** Public site renders the same products/prices/stock as ERP for at least one school (KLS) with 100% match against a hand-checked sample.
**Rollback:** Feature flag `CATALOG_SOURCE=erp_mirror|inventre`. Default stays `inventre` until verification passes.

---

### Phase 3 — Customer Identity & Addresses (1 week)

**Goal:** Logging in or checking out finds-or-creates a `tabCustomer` and links it to the Inventre `parents` row.

**Login flow change (`app/api/auth/otp/verify/route.ts`):**
1. After OTP verifies, call `Customers.findByPhone(phone)`.
2. If found, store `parents.erp_customer_name = customer.name`.
3. If not found, create with `customer_type='Individual'`, `customer_group='Student'`, `gst_category='Unregistered'`, `mobile_no=phone`.

**Address flow change (`app/api/addresses/route.ts`):**
- POST also creates an ERP Address with `links: [{link_doctype:'Customer', link_name: parents.erp_customer_name}]`. Store `addresses.erp_address_name`.
- GET reads from local mirror first, but the **first** GET after login does a one-shot ERP fetch to backfill any addresses that exist in ERP but not locally (existing 15K customers will hit this path).

**Profile data backfill:**
- New `parents.email` field. Audit notes ~80% of ERP customers have no email. UI prompts for email at first login.

**Done when:**
- A new phone number registering via OTP creates a `tabCustomer` in ERP within 2s.
- An existing ERP customer (matched by phone) logs in and immediately sees their saved addresses.
**Rollback:** Disable ERP customer write at the OTP-verify step (feature flag). Inventre `parents` remains canonical for that user until re-enabled.

---

### Phase 4 — Webhooks (Inbound from ERP) (1 week)

**Goal:** Inventre reacts to ERP events in near-real-time without polling.

**ERP-side configuration** (UI, not code): create webhooks at ERPNext → Settings → Integrations → Webhook:

| # | DocType | Event | URL | Header (HMAC) |
|---|---|---|---|---|
| 1 | Sales Order | on_submit | `https://inventre.in/api/erp/webhook/sales-order-submit` | `X-Inventre-Signature` |
| 2 | Sales Order | on_cancel | `https://inventre.in/api/erp/webhook/sales-order-cancel` | same |
| 3 | Sales Order | on_update_after_submit | `https://inventre.in/api/erp/webhook/sales-order-update` | same |
| 4 | Delivery Note | on_submit | `https://inventre.in/api/erp/webhook/delivery-note-submit` | same |
| 5 | Sales Invoice | on_submit | `https://inventre.in/api/erp/webhook/sales-invoice-submit` | same |
| 6 | Bin | after_save | `https://inventre.in/api/erp/webhook/bin-update` | same |
| 7 | Item | after_save | `https://inventre.in/api/erp/webhook/item-update` | same |
| 8 | Item Price | after_save | `https://inventre.in/api/erp/webhook/price-update` | same |

**Inventre-side handlers (`app/api/erp/webhook/*/route.ts`):**

Each handler:
1. Reads raw body.
2. Verifies HMAC against `ERP_WEBHOOK_SECRET`.
3. Idempotency: dedup by `(doctype, name, modified)` against `tabWebhookLog`.
4. Applies the change (status update, cache invalidate, mirror upsert).
5. Returns 200 with `{ok:true, processed:true|false}`.

**Sales Order on_submit** — confirms an order placed online. Update `orders.status='confirmed'`, send SMS via existing `notifyOrderStatus`.

**Delivery Note on_submit** — find Inventre order by `against_sales_order`, write `orders.shippedAt`, store `lr_no`, `transporter`. Send "Order shipped" SMS.

**Sales Invoice on_submit** — store invoice URL, send "Invoice ready" SMS.

**Bin after_save** — invalidate Redis stock cache for `item_code`. Cheap.

**Done when:** A staff member submitting a Delivery Note in ERP UI causes the customer to receive a "shipped" SMS within 10s and the parent's order page shows the tracking number.
**Rollback:** Disable webhook URLs in ERP UI. Inventre status sync degrades to manual / cron-driven; nothing breaks.

---

### Phase 5 — CCAvenue Gateway + Orders → ERP (2 weeks) — **highest-risk phase**

**Goal:** Replace Razorpay with CCAvenue. Every checkout creates a Sales Order in ERP. Successful payments submit the SO.

**Decision: Razorpay code is removed, not kept dormant.** It was the dev-mode placeholder. The live system has always been CCAvenue. Removing it eliminates a source of confusion.

**New file: `lib/ccavenue.ts`**
- `createCheckoutPayload({orderRef, amountPaise, customerName, customerPhone, customerEmail, redirectUrl})` returns the encrypted form-post payload per CCAvenue spec.
- `verifyResponse(encrypted, checksum)` decrypts and returns `{status, trackingId, mode, paidAmount, paidAt}`.
- `isStub()` for dev mode (returns canned success response when keys missing — same idea as current `lib/razorpay.ts`).

**Rewritten `app/api/checkout/create-order/route.ts`** (sequential, idempotent):

1. Auth (parent only).
2. Read cart from Redis, server-side stock check **against live ERP Bin** for each line.
3. Resolve `parents.erp_customer_name` (must exist; if missing, create now).
4. Resolve `addresses.erp_address_name` for the chosen shipping address (create now if missing).
5. Generate `gatewayOrderId = ${orderNumber}${hex(timestamp)}` (per audit §10).
6. Choose tax template via pincode (`getTaxTemplate`).
7. **Inventre transaction:** insert `orders` (status=`placed`, paymentStatus=`pending`, `erp_so_name=null`).
8. **ERP call:** POST `/api/resource/Sales Order` (Draft, docstatus=0) with:
   - `order_type: "Shopping Cart"`
   - `customer: parents.erp_customer_name`
   - `company: ERP_DEFAULT_COMPANY`
   - `selling_price_list: "Standard Selling"`
   - `taxes_and_charges: <pincode-based template>`
   - `set_warehouse: ERP_DEFAULT_WAREHOUSE`
   - `custom_student_school: schools.erp_school_name`
   - `custom_student_grade: students.grade`
   - `customer_address`, `shipping_address_name`, `custom_pin_code`
   - `custom_payment_flow: "ONLINE"`
   - `custom_gateway_provider: "CCAVENUE"`
   - `custom_payment_status: "PENDING"`
   - `custom_gateway_order_id: gatewayOrderId`
   - `items: [{item_code, qty, rate, warehouse}]` — **rate from local mirror, not user-supplied.**
9. ERP returns `{data:{name:"SAL-ORD-2026-…"}}` → update Inventre `orders.erp_so_name = name`.
10. Return CCAvenue redirect payload to client.

**Failure handling:** if step 8 fails, Inventre order is rolled back (DELETE) and user sees "Couldn't reach our order system, try again". A reconciliation cron (§7) catches half-created orphans.

**Rewritten `app/api/checkout/verify/route.ts`** (CCAvenue callback target):

1. Auth (parent — but also accept the unauthenticated server-side callback URL with extra HMAC).
2. Decrypt CCAvenue response.
3. **PUT** `/api/resource/Sales Order/{erp_so_name}` with the 11 payment custom fields (audit §4.1).
4. **POST** `/api/method/frappe.client.submit` for the SO.
5. Mark Inventre `orders.paymentStatus='paid'`, `orders.status='confirmed'`. Clear cart.
6. ERP webhook (Phase 4) will arrive shortly with the same status — handler must be idempotent.

**Failure path** — payment FAILURE: PUT the SO with `custom_payment_status='FAILURE'` but **don't submit**. Keep Inventre order as `placed/payment_status=failed`. Customer sees "Retry payment" button. Retry creates a new gateway attempt against the same SO (increment `custom_payment_attempt_count`).

**Stock:** ERP automatically reserves stock when a SO is submitted (`reserved_qty` increments in `tabBin`). We do not manually decrement. The Razorpay-era manual `stockQty - qty` SQL goes away.

**Done when:** A test parent goes through the entire flow against staging ERP, the SO appears in ERP with all 16 payment fields populated, and a Delivery Note created in ERP UI fires the "shipped" SMS.
**Rollback:** Feature flag `CHECKOUT_BACKEND=erp|inventre`. Initial production rollout is **dual-write** (writes to both ERP and Inventre, with ERP allowed to fail without blocking the user) for one week before flipping ERP to authoritative.

---

### Phase 6 — Admin Panel Rebuild (3 weeks)

**Goal:** Replace the 17-page simple-CRUD admin with an ERP-aware operations console. Hard-link out to ERP UI for anything we deliberately don't reimplement.

**New navigation (replaces `/admin/*`):**

```
/admin
├── /dashboard            ← redesigned, KPIs + sync health
├── /orders               ← ERP-backed list + filters
│   └── /[so_name]        ← full SO detail + timeline + invoice + DN
├── /customers            ← ERP customer search + profile
│   └── /[customer_name]
├── /catalog
│   ├── /items            ← ERP item browser, tree by school/group
│   │   └── /[item_code]  ← item detail (variants, stock, price)
│   ├── /categories       ← Item Group tree (read + reorder local)
│   ├── /pricing          ← Item Price grid edit (writes to ERP)
│   └── /stock            ← Live Bin view, low-stock alerts
├── /schools              ← Inventre metadata + ERP school name mapping + house-color maps
│   └── /[id]
├── /bundles              ← Books Bundle configurator (per-school per-grade language/stream selectors)
├── /students
│   ├── /list
│   └── /import           ← CSV (existing) + grade-up bulk (new)
├── /content              ← UNCHANGED — Inventre-native (CMS, FAQ, testimonials, banners)
├── /reviews              ← UNCHANGED — Inventre-native
├── /settings
│   ├── /users            ← Inventre admin users
│   ├── /erp              ← API keys, webhook secret, default company, default warehouse, sync schedule
│   └── /audit            ← integration log + webhook log viewer
└── /sync                 ← sync health, last-run, next-run, lag chart, replay buttons
```

**Page-by-page detail for the new pages:**

#### `/admin/orders` (rebuild)

- Pulls from local `orders` mirror; each row is enriched with live ERP fields:
  - `erp_so_name` → click-out to `https://erp.inventre.in/app/sales-order/{name}`
  - `payment_status`, `delivery_status`, `billing_status`, `per_delivered`, `per_billed`
- Filters: school, grade, payment status, fulfillment status, date range.
- Bulk export to CSV (admin's existing pattern).
- Per-row actions: "Resend SMS", "Open in ERP", "Mark notification sent".

#### `/admin/orders/[so_name]`

Single page that combines:
- Order summary (items, totals, taxes, addresses).
- Payment timeline (from `custom_payment_*` fields + payment attempts).
- Linked `Delivery Note` (status, AWB, transporter, ship date).
- Linked `Sales Invoice` (URL to download PDF, e-invoice IRN, GST amounts).
- Status timeline pulled from ERP audit trail.
- Top-right deep-link "Open in ERP" → opens the SO in the ERP web UI.

#### `/admin/customers`

- ERP-backed search by phone, email, name, customer-name, address pincode.
- List view: name | phone | email | last order date | total order count | LTV.
- Customer detail: profile, addresses, last 20 orders, students list (Inventre-side), notification preferences.
- Important: this can search the existing 15,614 ERP customers without importing them all; we use ERP API + a thin search index.

#### `/admin/catalog/items`

- Tree view: School → Item Group → Items. Item count badges per node.
- Toggle: "Active only" / "Show disabled".
- Each item row: thumbnail | code | name | variant count | price range | total stock.
- Drill-in (`/admin/catalog/items/[item_code]`):
  - Variant grid (size × color) with stock and price per cell.
  - "Edit" buttons per row deep-link to ERP (most edits stay there).
  - Inline ability to **enable/disable** an item, update `custom_display_price`, upload images.

#### `/admin/catalog/pricing`

- Filter by school + item group → grid of `Item Price` records on `Standard Selling`.
- Inline edit a price → PUT to ERP `Item Price` → Redis invalidate.
- Bulk update by % markup over `custom_inventre_cost_price`.

#### `/admin/catalog/stock`

- Live Bin view (Redis 60s cache, manual refresh button).
- Filter: warehouse (only `Stores - IESPL` for now), school, item group.
- Low-stock alerts: `actual_qty - reserved_qty <= custom_msl`. Configurable threshold.
- Negative-stock alerts: oversold items (audit notes ~15 of these in live data).

#### `/admin/schools/[id]` (rebuild)

Tabs:
- **Branding** (existing) — logo, banner, hex theme, hero copy.
- **ERP mapping** — `erp_school_name`, prefix codes (KLS, etc.), grades served.
- **House colors** — color-letter → label map (e.g. `A → Kalpana Chawla - RED`). **Critical** for variant display.
- **Books bundle config** — per-grade language/stream selectors (audit §2.5).
- **Featured items** — manually pick highlights for school landing page.

#### `/admin/bundles`

The hardest new admin page. Handles audit §2.5's matrix:
- For each school × grade, define which **selections** the parent must choose (language, stream, electives).
- Each selection's options map to specific `Books Bundle` items in ERP.
- The PDP for a Books Bundle reads this config and renders the right multi-step selector.

Stored in Inventre Postgres as `bundle_configs` (new table): `(school_id, grade, selectors JSONB)`.

#### `/admin/sync`

- Last sync run for each domain (items, prices, stock, customers, item groups).
- Webhook health: events received in last hour, signature failures, dedup hits.
- Replay: manually trigger bulk re-sync of any domain.
- Circuit-breaker status for ERP client.

#### `/admin/settings/audit`

Two subtabs:
- **Integration log** — last 1000 ERP API calls with `path | method | status | ms | so_name?`.
- **Webhook log** — last 1000 webhooks received: `(doctype, name, modified, processed, error?)`.

**Done when:** an ops user can place an order on the front-end, see it appear in `/admin/orders` within 2s, click into it, see the ERP SO + DN + invoice all stitched together, mark the customer notified, and never open the ERP UI for routine tasks.

**Rollback:** the new admin pages live alongside the old ones (route prefix `/admin2/*` during build, then renamed to `/admin/*` at cut). Old pages stay accessible at `/admin-legacy/*` for two weeks post-cut.

---

### Phase 7 — Hardening, Reconciliation, Observability (1 week)

**Goal:** the integration is observable and self-healing.

**Reconciliation crons:**

1. **Orphan SO sweeper** (`scripts/reconcile-orders.ts`, hourly): find Inventre orders with `erp_so_name=null` older than 30 min → either backfill (if the ERP SO was created but our DB write failed) or hard-cancel (if user truly abandoned).
2. **Stock drift checker** (daily): pull all Bins, diff against Inventre mirror, log discrepancies > N units.
3. **Price drift checker** (daily): same for Item Price.
4. **Webhook gap finder** (hourly): for each DocType with a webhook, fetch records modified in the last hour from ERP, compare against received webhook log, alert on misses.

**Observability:**
- Add `IntegrationLog` and `WebhookLog` tables (already in §6 audit page).
- `/api/health` extended to include `erp_reachable`, `erp_avg_latency_5min`, `webhook_lag_max_5min`.
- Slack alert (or email) on circuit-breaker open, webhook gap, reconcile error.

**Done when:** the on-call team has a single dashboard page showing ERP health + sync lag + last 50 errors, and reconcile cron has run 7 days clean.

---

### Phase 8 — Cutover & Decommissioning (1 week)

**Goal:** kill all dual-write paths, remove old code, ship.

**Cutover sequence:**

1. **Friday evening**: enable `CATALOG_SOURCE=erp_mirror`, `CHECKOUT_BACKEND=erp`, all webhooks active. Razorpay credentials removed from prod env.
2. **Monitor weekend**: ERP team on standby; reconcile cron + Slack alerts cover edge cases.
3. **Monday**: run a full diff:
   - Inventre orders this weekend vs ERP SOs this weekend. Should match 100%.
   - Inventre stock for top-100 items vs ERP Bin. Should match within 1 unit.
4. **Two weeks post-cut**: delete `lib/razorpay.ts`, drop unused columns, rename `/admin2 → /admin`, retire `/admin-legacy`.
5. **Decommission targets:**
   - `payments` table (replaced by SO custom fields).
   - Razorpay env vars and webhook route.
   - The old `productVariants.stockQty` is repurposed as a *cached* value, not source of truth.

**Done when:** zero non-ERP writes happen on the order path. Razorpay code is deleted. Old admin pages are gone.
**Rollback:** Feature flags reverse the cut. Old code is in git history.

---

## 6. Schema Migrations

A consolidated list of every column added across phases:

```sql
-- Phase 1
ALTER TABLE schools          ADD COLUMN erp_school_name      TEXT UNIQUE;
ALTER TABLE schools          ADD COLUMN color_map            JSONB DEFAULT '{}'::jsonb;
ALTER TABLE schools          ADD COLUMN prefix_codes         TEXT[] DEFAULT '{}'::text[];
ALTER TABLE categories       ADD COLUMN erp_item_group_name  TEXT UNIQUE;
ALTER TABLE products         ADD COLUMN erp_item_code        TEXT UNIQUE;
ALTER TABLE productVariants  ADD COLUMN erp_item_code        TEXT UNIQUE;
ALTER TABLE productVariants  ADD COLUMN attributes           JSONB DEFAULT '{}'::jsonb;
ALTER TABLE parents          ADD COLUMN erp_customer_name    TEXT UNIQUE;
ALTER TABLE parents          ADD COLUMN email                TEXT;
ALTER TABLE addresses        ADD COLUMN erp_address_name     TEXT UNIQUE;
ALTER TABLE orders           ADD COLUMN erp_so_name          TEXT UNIQUE;
ALTER TABLE orders           ADD COLUMN erp_gateway_order_id TEXT;
ALTER TABLE orders           ADD COLUMN erp_payment_status   TEXT;
ALTER TABLE orders           ADD COLUMN erp_gateway_tracking_id TEXT;
ALTER TABLE orders           ADD COLUMN erp_paid_amount      NUMERIC(12,2);
ALTER TABLE orders           ADD COLUMN erp_paid_at          TIMESTAMPTZ;
ALTER TABLE orders           ADD COLUMN erp_lr_no            TEXT;
ALTER TABLE orders           ADD COLUMN erp_transporter      TEXT;
ALTER TABLE orders           ADD COLUMN erp_invoice_name     TEXT;
ALTER TABLE orderItems       ADD COLUMN erp_so_item_idx      INT;

-- Phase 6 (admin)
CREATE TABLE bundle_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  grade TEXT NOT NULL,
  selectors JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(school_id, grade)
);

-- Phase 7 (observability)
CREATE TABLE integration_log (
  id BIGSERIAL PRIMARY KEY,
  ts TIMESTAMPTZ DEFAULT NOW(),
  path TEXT NOT NULL,
  method TEXT NOT NULL,
  status INT NOT NULL,
  duration_ms INT NOT NULL,
  so_name TEXT,
  item_code TEXT,
  error TEXT
);
CREATE INDEX idx_integration_log_ts ON integration_log(ts DESC);

CREATE TABLE webhook_log (
  id BIGSERIAL PRIMARY KEY,
  ts TIMESTAMPTZ DEFAULT NOW(),
  doctype TEXT NOT NULL,
  doc_name TEXT NOT NULL,
  modified TEXT,
  processed BOOLEAN DEFAULT FALSE,
  error TEXT,
  raw JSONB
);
CREATE UNIQUE INDEX idx_webhook_log_dedup ON webhook_log(doctype, doc_name, modified);
```

---

## 7. Risk Register

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| 1 | ERP downtime mid-checkout | medium | high | Circuit breaker; user message "try again in a moment"; nothing is left in inconsistent state because Inventre order isn't created until after ERP SO. |
| 2 | Webhook lost (signed but not delivered) | medium | medium | Hourly reconcile cron compares ERP modified-since to webhook log; replays missing events. |
| 3 | Stock race (two parents take last item) | medium | medium | Live Bin check at SO-create; if oversold, ERP still accepts (negative reserved_qty is allowed by ERP); rely on backorder UX. |
| 4 | CCAvenue callback never arrives | low | high | Status-poll cron: every 5 min, for every Inventre order in `pending` > 10 min, query ERP SO for current `custom_payment_status`. |
| 5 | Variant code parser misclassifies a code | medium | medium | Always prefer `Item Variant Attribute` lookup; parser is fallback only; per-school color maps live in DB and are admin-editable. |
| 6 | Tax template mis-selection (in-state vs out-state) | low | high | Single-source pincode helper; unit-tested against 50 known pincodes; ERP recomputes on submit anyway. |
| 7 | Customer dedup fails (creates duplicate `tabCustomer`) | low | medium | Always lookup-then-create; race-condition guard via Postgres unique constraint on `parents.phone` + ERP unique-by-phone search. |
| 8 | Bulk import overruns ERP rate limits | low | medium | Bulk import paginates 100/page with 250ms delay; runs once. |
| 9 | Books Bundle PDP UX is ambitious | high | medium | Ship Phase 1–5 first with bundles as plain SKUs; bundle config is **Phase 6.5** (after admin rebuild). |
| 10 | The 23K existing customers expect their old order history to render in the new site | medium | high | Phase 3 backfills addresses; Phase 6 `/admin/customers` searches ERP directly. The parent-facing orders page reads ERP for `customer = parents.erp_customer_name` — gets **all** historical orders, not just new ones. |

---

## 8. Test Plan

### 8.1 Unit tests (new)
- `lib/erp/variants.test.ts` — parser against 30 real codes from audit §2.4.
- `lib/erp/tax.test.ts` — 50 pincode → template mappings.
- `lib/erp/customers.test.ts` — find-or-create dedup logic with mocked ERP.

### 8.2 Integration tests (new in `scripts/erp-e2e.ts`)
A new sibling to `scripts/e2e.ts`:
- ERP smoke (Phase 1 deliverable).
- End-to-end checkout against staging ERP creating a real (cancelled-after) SO.
- Webhook receiver verification with a hand-signed payload.
- Reconcile cron dry-run.

### 8.3 Existing E2E suite (`scripts/e2e.ts`)
Update to:
- Replace Razorpay stub assertions with CCAvenue stub assertions.
- After SO creation in checkout, assert `orders.erp_so_name` is populated.
- After webhook simulation, assert `orders.shippedAt` is set.
- The 127 existing tests should all pass through the cutover, just with different assertions in the checkout group.

### 8.4 Load test
- k6 script in `loadtest/` (already an empty dir per audit) hitting `/api/shop/products` for 20K VUs sustained 5 min. Cache hit rate must stay > 95%.
- Separate scenario: 500 concurrent checkouts against staging ERP. Measure SO-create p95 < 2s, p99 < 5s.

---

## 9. Environment & Secrets

New `.env` entries:

```
# ERPNext
ERP_BASE_URL=https://erp.inventre.in
ERP_API_KEY=•••
ERP_API_SECRET=•••
ERP_DEFAULT_COMPANY=Inventre Edu Services Pvt Ltd
ERP_DEFAULT_WAREHOUSE=Stores - IESPL
ERP_PRICE_LIST=Standard Selling
ERP_WEBHOOK_SECRET=•••       # shared with the 8 webhook configs

# CCAvenue
CCAVENUE_MERCHANT_ID=•••
CCAVENUE_ACCESS_CODE=•••
CCAVENUE_WORKING_KEY=•••
CCAVENUE_REDIRECT_URL=https://inventre.in/api/checkout/verify
CCAVENUE_CANCEL_URL=https://inventre.in/shop/checkout?cancelled=1

# Feature flags (Phase 5+)
CATALOG_SOURCE=erp_mirror     # erp_mirror | inventre
CHECKOUT_BACKEND=erp           # erp | inventre
```

Secrets management: per Vercel-Plugin guidance, use `vercel env pull` in dev and `vercel env add` for production. ERP API key + secret are scoped to a single `inventre-ecom` ERP user with restricted DocType permissions (Read on Item/Bin/Item Price/Item Group; Write on Sales Order/Customer/Address; Submit on Sales Order).

---

## 10. Rough Timeline

| Phase | Description | Size | Critical path |
|---|---|---|---|
| 1 | Foundations & ERP Client | 1 wk | yes |
| 2 | Catalog Mirror | 1.5 wk | yes |
| 3 | Customer Identity | 1 wk | yes |
| 4 | Webhooks | 1 wk | parallel to 5 |
| 5 | CCAvenue + Orders → ERP | 2 wk | yes |
| 6 | Admin Panel Rebuild | 3 wk | parallel to 5 partially |
| 7 | Hardening | 1 wk | yes |
| 8 | Cutover | 1 wk | yes |

**Solo engineer**: ~11 weeks.
**Two engineers (one front-end, one integration)**: ~7 weeks.
**Three (+ QA)**: ~5 weeks.

The hardest single step is **Phase 5 (CCAvenue + Orders → ERP)** because it is the only step that can break checkout for real customers. Hence the dual-write week before flipping authority.

---

## 11. Decisions Locked In

1. **Hybrid architecture (Option C)** — confirmed.
2. **CCAvenue replaces Razorpay** — confirmed (it's already what the live system uses).
3. **ERP is canonical** for items, customers, orders, prices, stock, GST, invoices.
4. **Inventre is canonical** for: reviews, testimonials, FAQs, banners, content blocks, wishlists, sessions, OTP state, school-level branding, books-bundle UI configuration, parent-side notification preferences.
5. **Variant codes are never hand-built**. We pull from ERP and parse only as fallback.
6. **Customer-facing order numbers stay `INV-YYYY-NNNN`** (we already use these); ERP `SAL-ORD-YYYY-NNNNN` is internal.
7. **`Stores - IESPL` is the only warehouse for now**. Multi-warehouse split is out-of-scope.
8. **`Standard Selling` is the only price list for parents**. POS/MRP are admin-only.
9. **No webhook-driven Item Variant Attribute sync.** Variant attributes are fetched at item-detail time (cheap, low traffic).
10. **No Pricing Rules / Coupon Code integration in v1** — Inventre coupons stay Inventre-side; future phase to push them as ERP `Pricing Rule` records.

---

## 12. Open Questions to Confirm Before Phase 1

These need a 5-minute conversation with the ERP admin / business owner:

1. Will the existing CCAvenue merchant credentials be shared with the new Inventre site, or do we register a new merchant ID? (Affects refund attribution.)
2. Are there existing webhooks already configured in ERP? (Don't want to clash with `custom_checkout_notification_sent`.)
3. Are the 12 schools in the audit the complete list, or is "Inventre" itself sometimes a generic school for unaffiliated buyers? (Affects the school-required gate at signup.)
4. Should Inventre's new admin allow ops users to **submit** Sales Orders manually (e.g. for a phone order), or is order-create exclusively customer-driven?
5. What is the SLA for Delivery Note creation post-payment? Drives the parent-facing copy ("ships in 2-3 business days" vs "ships within 24h").
6. Is the existing `0.0.1` Inventre custom Frappe app something we own and can extend? (If yes, server-side hooks become an option in Phase 4 instead of webhooks-only.)

---

## 13. What This Plan Deliberately Does NOT Cover (for now)

- Multi-currency or international shipping (ERP `currency` is always INR for IESPL).
- Pricing Rule / Coupon Code synchronisation (Inventre `coupons` stays local in v1).
- Loyalty points / wallet credit (no equivalent in ERP today).
- E-invoice IRN flow on the parent side (only download link from ERP).
- The second company `M` (manufacturing) — out of scope.
- Mobile app — separate track.
- Replacement / return UI on the parent side beyond what already exists in the audit (`custom_is_replacement_so`).

---

*End of plan.*
