# Exchange & Missing-Item Flow — Full Report

_Last updated: 2026-07-07. Covers the customer-raised **Exchange** and **Missing-item** flows on inventre.in, how each behaves for the three product types (**Bookkit/Books**, **Magic Box**, **Uniforms/standard products**), the eligibility gates, the data model, admin review, and the round-trip to the audit ERP. **2026-07-07 update:** nested kits (bookkits & book sets) now drill down 3 levels — kit → category → individual book — see §3c._

---

## 1. Overview — what these two flows are

Two separate self-serve flows a parent can raise from **a delivered order** at `/shop/orders/[id]`:

| | **Exchange** | **Missing-item claim** |
|---|---|---|
| Meaning | Item arrived but is wrong/damaged and should be swapped | Item never arrived — short-shipped |
| Customer number | **`RTN-YYYY-NNNNN`** | **`MIS-YYYY-NNNNN`** |
| Reverse logistics | Yes — the old item is picked up | **No** — nothing to return |
| Status machine | `requested → approved → received` (or `rejected`) | `requested → approved → received_at_school → delivered` (or `rejected`) |
| Tables | `returns` + `return_items` | `missing_item_claims` + `missing_item_claim_items` |
| Fulfilment | Handed over physically at school on the next pickup Saturday | Same |

Both are **payment-agnostic** (they act on a delivered order), both fire to `audit.inventre.in` for customer-care review, and both flip status back to inventre so the parent sees live state.

### High-level path

```
Parent at /shop/orders/[id]
   │  (order must be DELIVERED — see gates §4)
   ▼
"Request exchange" / "Report missing item" button
   ▼
Form: pick item(s) → reason → sub-reason → what-you-need → photos → Review → Submit
   ▼
POST /api/returns   |   POST /api/missing
   ▼
lib/exchange.ts createExchange()  |  lib/missing.ts createMissingClaim()
   │  validates scope + delivered + one-per-order lock, writes rows in a txn
   ▼
emitExchangeEvent / emitMissingClaimEvent  ──(HMAC POST)──▶  audit.inventre.in /api/ecom/ingest
   │                                                              │ customer-care reviews,
   │                                                              │ school hands over on Saturday
   ◀────── /api/erp/webhooks/exchange · /api/erp/webhooks/missing (HMAC) ── status flips back
   ▼
Parent's status page (/shop/orders/[id]/exchange/[returnId] · .../missing/[claimId]) updates live
```

---

## 🔑 Business rules (plain English)

The rules that govern **who can raise a request, on what, and how often**. (The code enforcing each is in §4; this is the human-readable contract.)

### Who & when
1. **Only delivered orders.** A parent can raise an exchange or missing claim only once the order is **delivered** — judged by _either_ the local order status _or_ the audit shipment mirror (whichever says delivered). Not-yet-delivered orders show no buttons.
2. **Time window is currently OFF.** The business rule is "available for **15 days after delivery**," but the window is **disabled in code today** (`RETURNS_WINDOW_DAYS = 0`, since 2026-06-30) because ~79% of delivered orders were already past 15 days and had the buttons hidden. So right now **every delivered order stays eligible indefinitely**. (Setting the constant back to `15` re-enables the cut-off. UI copy still says "within 15 days.")
3. **Open to all parents.** Historically phone-allowlisted; now `EXCHANGE_OPEN_TO_ALL=true` opens it to **every logged-in parent** in production (reversible from env alone).
4. **You can only act on your own family's orders.** Ownership is enforced by family-identity (shared phones, enrollment, `customer_link`, co-guardian links) — the same scope as "My Orders". This deliberately covers split-account / guest / co-guardian orders, but never another family's order.

### How many
5. **One exchange AND one missing claim per sale order — for life.** The moment a parent creates _either_ an exchange or a missing claim on an order, **both buttons disappear** on that order.
6. **Rejection releases the slot.** If customer-care **rejects** a request, it no longer counts — the parent may raise a new one. But once a request is **approved (or beyond)**, it **permanently blocks** any further request on that order.
7. **A single request can cover many items.** One RTN/MIS bundle can flag multiple lines (and, for a Magic Box, multiple components) — each with its own reason — but it still counts as the one allowed request for that order.

### What can be exchanged / how it's fulfilled
8. **Exchange = we shipped it wrong.** Wrong size, wrong item, damaged, or defective. If the parent admits **"I ordered the wrong thing"**, exchange is refused and they're sent to customer care (checkout mistakes aren't exchanges).
9. **Missing = it never arrived.** No reason taxonomy, no reverse logistics — just how many units were short (`qtyShort`).
10. **The customer chooses the replacement — we never assume.** They explicitly pick: a fresh copy of the same item (`same_fresh`), a different size/variant (`sibling`, chosen from a dropdown), or something different described in notes (`different_describe`).
11. **ERP-only orphan lines can't be exchanged.** A line imported from the ERP with no local SKU (`variantId = null`) is refused with a "contact support" message.
12. **Physical hand-over on a Saturday.** Both flows fulfil in person: the replacement is collected at the **school** (or the **Inventre store** for store-pickup schools — KLINK/QLPHP) on the **next pickup Saturday** (≥ 7 days out). No courier reverse-logistics for the customer.
13. **Restock only if unopened.** On the admin side, only items received back in `unopened` condition go back into sellable stock.

### Product-type specifics
14. **Uniforms** — the "Wrong Size" reason is offered **only when the product actually has other sizes/variants**; otherwise size isn't a valid reason.
15. **Books / Bookkits** — only "Wrong Book" and "Damaged" apply (no size/defective); wrong-book uses a **second dropdown** (subject/edition, grade, language, missing inserts, different book). Bookkit components are treated as **books**, even though the kit itself is a kit.
16. **Nested kits (bookkits & book sets)** — the parent chooses **whole kit**, **a whole category** (e.g. "Bundle 4 Notebook" / "SMS Grade 9 Hindi"), or **individual books** inside a category. The kit is shown as a 3-level accordion (kit → category → books), re-derived from the catalog bundle tree. Applies to every `kind='kit'`; single-book/flat kits fall back to the flat list. "Just capture the book" — no size picker for kit books. _(Deployed 2026-07-07.)_
16b. **Partial quantity per line** — when any exchangeable line (a kit book, a uniform piece, a plain item) was ordered **× N**, the exchange form lets the customer pick **how many** to exchange (e.g. 1 of 2 damaged); only that count is exchanged. _(Deployed 2026-07-07.)_
17. **Magic Box** — **hybrid**: uniform pieces stay flat (each with its ordered size preserved), while the **bookkit inside the box drills into its category → book accordion** (same as a standalone bookkit). The parent picks whole box, individual uniforms, whole bookkit-category, or individual books. For older boxes whose exact contents weren't recorded, the form first asks **"which size do you currently have?"** for the flat pieces. _(Hybrid deployed 2026-07-07.)_

### Integrity / safety
18. **All-or-nothing writes.** A request and its line items are written in one DB transaction — a half-saved request can never exist.
19. **Numbers are inventre-minted.** `RTN-YYYY-NNNNN` / `MIS-YYYY-NNNNN` are allocated by inventre (single source of truth); when `RETURNS_NUMBER_SINGLE_SOURCE=true`, even audit-raised requests adopt the inventre number.
20. **Status only moves forward.** Transitions are monotonic (e.g. `approved` can't revert to `requested`); a late/duplicate flip is safely rejected.
21. **Photos required for exchange, optional for missing.** Exchange needs at least one photo (categorized, unlimited count); missing allows up to 5 (optional).

---

## 2. Customer-facing UI

### Entry point — the order detail page
`app/shop/orders/[id]/page.tsx` renders a status banner + button per flow. Eligibility for showing the buttons is computed by `app/api/orders/[id]/route.ts` using the shared gate in `lib/return-eligibility.ts` (`isOrderDeliveredForReturns`).

### The exchange form — `components/shop/orders/exchange/ExchangeForm.tsx` (~1,440 lines)
A multi-step, mobile-first form. Steps:
1. **Pick the item(s)** — every unit on the order is listed. Kit/Magic-Box lines are grouped into one card (see §3).
1b. **Quantity** (`⭐ 2026-07-07`) — when the selected line was ordered **more than once** (e.g. a kit sub-item "Crown 50 Pages … × 2"), a **"How many need exchanging?"** stepper (1…ordered) appears in the per-item tab. Only the chosen count is exchanged; the rest stay with the customer. Defaults to the full ordered qty; stored per-tab as `TabState.qty` (0 = full) and submitted as `perItem[].qty` (via `effectiveQty()`). The missing form has the equivalent per-unit `qtyShort` input.
2. **Reason** (`lib/exchange-shared.ts` → `EXCHANGE_REASONS`):
   - `wrong_size_delivered` — Wrong size delivered
   - `damaged` — Item arrived damaged
   - `wrong_item` — Wrong item delivered
   - `defective` — Item is defective
   - `other` — Other (free-text mandatory)
3. **Sub-reason** (`SUB_REASONS`, keyed off the top reason) — e.g. `too_small`/`too_large`, `wrong_language (books)`, `pages torn/missing (books)`, `stitching`, `fabric`, etc.
4. **`wrong_item` fault fork** — the form asks "Did we send the wrong item, or did you order the wrong thing?". If the customer picks **"I ordered the wrong thing"**, exchange bows out and points them at `/support` (exchange only covers _our_ fulfilment mistakes).
5. **Damage location** (`DAMAGE_LOCATIONS`) — only under `damaged`/`defective`: front/back/side/inside/other.
6. **What would you like instead? — replacement mode** (`replacementMode`):
   - `same_fresh` — a fresh copy of the same variant (or "a fresh replacement box" for a whole Magic Box)
   - `sibling` — a different size/variant of the same product (customer picks the exact target from a dropdown of sibling variants → sets `requestedVariantId`)
   - `different_describe` — something different, described in notes
7. **Photos** — categorized (`PHOTO_CATEGORIES`: front_full, issue_close_up, packaging, size_label, other). **No count cap** in the UI (the API allows up to 50).
8. **Review → Submit.**

### Status page — `app/shop/orders/[id]/exchange/[returnId]/page.tsx`
Shows the live status, the Saturday pickup date, per-item cards (reading each `return_items` row's own reason/component — never the head-row snapshot), an intermediate "replacement arrived at school" callout, and the customer-facing rejection reason if rejected.

### Missing flow pages
`app/shop/orders/[id]/missing/new/page.tsx` and `.../missing/[claimId]/page.tsx` mirror the exchange pages. The form is simpler: pick item(s) + `qtyShort` + optional per-item notes + optional photos (max 5). No reason taxonomy — the item simply didn't arrive.

---

## 3. How each PRODUCT TYPE behaves

The reason/sub-reason/damage-location sets are **not one flat list** — they're narrowed per product kind by **`lib/exchange-reasons.ts` → `getReasonOptions(kind, hasSiblings)`**. `ProductKind` = `book | uniform | accessory | kit | sub_bundle | magic_box | consumable | other`. The form (`ExchangeForm.tsx`) also labels units via `categoryLabel(kind)`: `book → "Books"`, `kit → "Kit"`, `magic_box → "Magic Box"`.

### 3a. Uniforms / standard products (`case "uniform"`)
- One order line = one exchangeable unit.
- **Reasons:** `wrong_size_delivered` ("Wrong Size Delivered") — **only offered when the product has sibling variants** (`hasSiblings`) — plus `wrong_item`, `damaged`, `defective`.
- Sub-reasons: `SIZE_SUB` (too_small/too_large/size_chart_mismatch), `WRONG_UNIFORM` (wrong_colour / design / **gender variant (girls vs boys)** / product), `DEFECTIVE_UNIFORM` (stitching/tear/button/fabric/print).
- Damage locations: `DAMAGE_LOC_UNIFORM` (front/back/sleeve/collar/seam/other) — only under damaged/defective.
- Replacement: `same_fresh`, `sibling` (dropdown of same-product variants), or `different_describe`. The line carries its exact `variantId` + `size`, so the swap is unambiguous.

### 3b. Bookkit / Books (`case "book"`)
- **Only two top reasons:** `wrong_item` ("Wrong Book Delivered") and `damaged` ("Item Arrived Damaged"). No size / defective reasons.
- **The "wrong book two-dropdown flow"** is intentional: reason `wrong_item` → sub-reason dropdown `WRONG_BOOK` (wrong subject/edition, wrong grade/class, wrong language version, missing CD/workbook/inserts, completely different book). Damage-location is deliberately **empty** for `wrong_item` on books (`damageLocationsByReason.wrong_item: []`); it only shows for `damaged` (`DAMAGE_LOC_BOOK`: cover/spine/pages/binding).
- `showSiblingPicker: hasSiblings` (books rarely have siblings, but a language/edition axis is offered when present).
- **Bookkit override:** a bookkit is stored as `kind='kit'`, but both new-page builders run `effectiveKind(rawKind, name)` which maps a `kind==="kit"` leaf → `"book"` — so bookkit *components* flow through the **book** reason set. The whole-kit unit keeps raw kind `kit`.
- **Category drill-down** (bookkits and book sets): see §3c — a nested kit's leaf books are grouped by their category (sub_bundle) into an expandable accordion.
- Fulfilment note: bookkits often ship as one parcel with a **blank item_code** at the audit side — status is tracked per-category, not per-line.

### 3c. Nested kits — bookkits & book sets (3-level category drill-down)  ⭐ 2026-07-07
A **nested kit** (`products.kind='kit'` — this covers bookkits like "SMS Grade 9 Bookkit …" **and** book sets like "TSUS Book Set Grade 1") is not a flat list. It's a **3-level tree**: kit → **categories** (`products.kind='sub_bundle'`, e.g. "Bundle 4 Notebook", "SMS Grade 7 Notebook", "SMS Grade 9 Hindi") → **leaf books**. The exchange/missing forms surface all three levels so a parent can pick **the whole kit**, **a whole category**, or **individual books**.

**How the tree is resolved** (`lib/bundle-fallback.ts` → `loadBookkitCategoryTree(variantId, schoolId)`): the category grouping is **not** stored on the order (`order_items.bundle_selections` is a flat leaf list, often NULL for kits). It's re-derived from the live catalog — the same source as the storefront "What's in your kit" accordion — trying two resolvers in order:
1. `loadBundleTree(productId)` — the generic recursive BOM walk. Covers **book sets** and any kit whose product carries real `bundle_components` pointing at `sub_bundle` categories.
2. `loadVariantBundleTree(variantId)` — the storefront's **name-pattern** resolver, needed for **language-template bookkits** ("… Bookkit Hindi 2nd Lan …") whose parent has no direct `bundle_components`.

It returns `[]` when there's **no genuine sub_bundle nesting** (a single-book "kit" wrapper, a flat Grade-12 book set, or a plain magic box) → the form then falls back to the existing flat behaviour, unchanged. (An earlier version gated on `name includes "bookkit"`, which missed **book sets** — fixed 2026-07-07 by triggering on all `kind='kit'` + the two-resolver fallback.)

**The form** (`ExchangeForm.tsx` / `MissingForm.tsx`) builds one `isKitParent` unit (whole kit) + one `isKitComponent` leaf unit per book, each tagged with `categoryKey` / `categoryName`. The kit card has a **scope switch**:
- **`kitScope = "full"` → whole kit.** `isKitParent` selected; everything is exchanged/claimed together.
- **`kitScope = "items"` → category accordion.** Leaf units are grouped by `categoryName` (`categoriesFor()`). Each category header has a **"whole category" checkbox** (`setCategorySelected()` ticks/unticks every book in it) plus expand/collapse to show the individual book checkboxes. Each ticked book becomes its own `return_items` / `missing_item_claim_items` row under one `RTN-`/`MIS-` head.

**"Just capture the book"** — no size picker for kit leaves (books have no size axis that matters). The chosen category rides to audit inside `requestedComponentPath.attributes` (and `missingComponentPath.attributes`) as `{ name: "Category", value: <categoryName> }` — **no schema/API/DB change**. Scope: **kits only**; **Magic Boxes are untouched** (see §3d) because their per-component *sizes* matter.

### 3d. Magic Box (`kind='magic_box'`) — hybrid: flat uniforms + drilled bookkit  ⭐ 2026-07-07
A Magic Box arrives as **one parent order line** with ~12 components inside (`order_items.bundle_selections`) — uniform pieces (shirt, pant, shoes, socks…) **plus a bookkit as one component**. It uses a **hybrid** model:
- **Uniform / size-bearing components stay flat** — each is one selectable line **with its ordered size preserved** (shirt size 44, pant 30, shoe 9UK…). This is why the box is NOT wholesale converted to the §3c tree.
- **The bookkit component drills down** — during unit-building, any component whose variant is `kind='kit'` is expanded via `loadBookkitCategoryTree(componentVariantId, schoolId)` into its category → book leaf units (tagged `categoryKey`/`categoryName`, `componentIndex`-suffixed unit keys). So a parent can reach an individual book inside the magic box's bookkit.

In the form's kit card (scope = "items"), ungrouped components (the uniforms, no `categoryName`) render as **flat rows**, and the bookkit's books render as **category accordions** below them (the card renders both — `ungrouped` list + `categoriesFor()` accordions). If a magic box has no bookkit component, it's simply all-flat (unchanged).

Reasons (shared `case "kit"`/`"magic_box"` in `exchange-reasons.ts`): `wrong_item`, `damaged`, `defective`, `other`; sub-reasons `WRONG_KIT`; `forceKitDrillDown: true`.

Two Magic-Box wrinkles handled in code:
1. **Unknown component size (recovered boxes).** ~66% of magic-box order items never stored `bundle_selections`; `fallbackBundleComponents` (`lib/bundle-fallback.ts`) reconstructs the components from the bundle definition (one level). Since the exact ordered size is then unknown, those components are flagged `currentUnknown: true` and the form asks _"Which size do you currently have?"_ (offering the sibling list) before allowing a swap. The chosen `currentVariantId` becomes the `requestedComponentPath.variantId`.
2. **`requestedComponentPath` is opaque metadata, not a FK.** It records _which_ component the request is about (`{ variantId, componentName, attributes }`). Its `variantId` may be a **SKU string or empty** for ~5,500 legacy/backfilled/recovered components — so the API deliberately types it as `z.string().max(200)`, **not** `.uuid()`. (A `.uuid()` there was the cause of the "Invalid request" bug fixed 2026-07-04.) The real strict-UUID swap target is the item-level `requestedVariantId`. The ERP bridge later enriches this path with the resolved component's `item_code/item_name/size/sku/image_url` so the warehouse packs the right component, not the whole box.

### 3e. Wrong-item fault fork (all kinds)
Whenever the reason is `wrong_item`, the form makes the customer state fault: **"You sent me the wrong item" (`fulfillment`)** → continue; **"I ordered the wrong thing" (`customer`)** → blocked with a "contact customer care" callout (exchange only covers _our_ fulfilment mistakes).

> ⚠️ **Never read the head-row `returns` fields (reason/requestedComponentPath/requestedVariantId) for per-line display.** They are a **primary-only snapshot of the first selected line**, kept only for audit's list-view back-compat. A 9-component magic-box exchange has different values per line — reading the head row is exactly what once labelled all 9 parts "Bloomers" (fixed 2026-06-30). Per-line truth lives on each `return_items` row.

---

## 4. Eligibility gates (`lib/return-eligibility.ts`, `lib/exchange-gate.ts`)

An order shows the Exchange / Missing buttons and accepts a submit only when **all** hold:

1. **Delivered.** `isOrderDeliveredForReturns()` treats an order delivered if **either** the local `orders.status === 'delivered'` **or** the audit/ERP shipment-mirror status is `delivered` (the two lag each other in both directions, so they're OR-ed). This is the same value the order header shows.
2. **Family authorization.** `getParentOrderDetailFromErp()` must return non-null — it applies the same family-identity scope as My-Orders (shared phones, enrollment, `customer_link`, co-guardian ids). A null result = not this family's order → blocked. This is the security boundary that lets the strict `orders.parent_id` match be dropped (fixing split-account / guest orders — `isExchangeOwnershipRelaxed()` returns `true` in all envs).
3. **Within the returns window.** `RETURNS_WINDOW_DAYS` — **currently `0`, i.e. the time window is DISABLED** (set 2026-06-30). A delivered order stays eligible indefinitely because ~79% of delivered orders were past the old 15-day cut-off and had the buttons hidden. Setting it to `15` restores the old rule. (UI copy still mentions "within 15 days"; the code no longer enforces it.)
4. **Rollout gate.** `isExchangeTester(phone)` — historically a phone allowlist (`EXCHANGE_TESTER_PHONES`). **`EXCHANGE_OPEN_TO_ALL=true` opens it to every authenticated parent in production** (Phase 2, 2026-06-14). Reversible from env alone.

### One-request-per-order lock
`findOpenRequestForOrder()` (`lib/exchange.ts`): a parent gets **ONE exchange AND ONE missing claim per sale order, lifetime**. The moment either is created (and not later rejected), both buttons disappear on that order. **Rejected requests don't count** — the customer may retry after a "no". An **approved** (or beyond) request permanently blocks. In dev this lock is disabled (`isExchangeScopeRelaxed()`) so testers can retry.

Other submit-time guards in `createExchange`:
- Every requested `orderItemId` must belong to the order.
- Items with `variantId === null` (ERP-imported orphans with no local SKU) are rejected with "contact support".
- Everything is written in a **DB transaction** (head `returns` + all `return_items` together) so a half-inserted request can never persist.

---

## 5. Data model

### Exchange
- **`returns`** (`db/schema.ts:1219`) — head row. Key columns: `return_number` (RTN-), `parent_id`, `order_id`, `kind` (`'exchange'` vs legacy `'refund'`), `status` (`returnStatusEnum`), `pickup_date` (Saturday), `reason`/`sub_reason`, `photos` (jsonb), `requested_variant_id`, `requested_component_path` (jsonb), `damage_location`, `replacement_mode`, `handover_photos`, `rejection_reason`, `replacement_arrived_at`, `item_ids` (legacy). Unique index on `return_number`.
- **`return_items`** (`db/schema.ts:1297`) — **one row per exchanged component** (migration 0057). Per-item `reason`, `condition`, `sub_reason`, `damage_location`, `replacement_mode`, `requested_variant_id`, `requested_component_path`, `notes`. **This is the source of truth for per-line display/fulfilment.**

### Missing
- **`missing_item_claims`** (`db/schema.ts:1327`) — `claim_number` (MIS-), `order_id`, `parent_id`, `status` (text: requested/approved/rejected/received_at_school/delivered), `notes`, `photos`, `pickup_date`, `rejection_reason`, `replacement_arrived_at`, timestamps.
- **`missing_item_claim_items`** (`db/schema.ts:1363`) — `order_item_id`, `qty_short`, `missing_component_path` (jsonb, enriched by the bridge with item_code/name/size), `notes`.

Numbering (`lib/numbering.ts`): `allocReturnNumber()` → `RTN-{year}-{5-digit}`; `allocClaimNumber()` → `MIS-{year}-{5-digit}`. **Inventre is the single source of numbering** (audit-minted `RTN-M-`/`MIS-M-` manual records are a separate legacy set, not migrated).

---

## 6. API surface

| Route | Method | Purpose |
|---|---|---|
| `app/api/returns/route.ts` | `GET` | list this parent's returns |
| `app/api/returns/route.ts` | `POST` | create exchange (Zod-validated → `createExchange`) |
| `app/api/returns/upload/route.ts` | `POST` | parent-gated multipart photo upload (excluded from the 10 MB middleware cap) |
| `app/api/missing/route.ts` | `GET`/`POST` | list / create missing claim (→ `createMissingClaim`) |
| `app/api/orders/[id]/route.ts` | `GET` | order detail incl. `canExchange` / active-request state for the buttons |
| `app/api/erp/webhooks/exchange/route.ts` | `POST` | **inbound** HMAC status flips from audit |
| `app/api/erp/webhooks/missing/route.ts` | `POST` | **inbound** HMAC status flips from audit |

### Zod validation notes (source of past "Invalid request" bugs)
- `/api/returns`: `photos` is `.min(1).max(50)` (was `.max(5)` — rejected 6+ photo submissions). `requestedComponentPath.variantId` is `z.string().max(200)` (was `.uuid()` — rejected ~5.5k SKU-string components). `perItem` `.min(1).max(50)`, each with reason/subReason/damageLocation/replacementMode/requestedVariantId/requestedComponentPath.
- `/api/missing`: `photos.max(5)`, `items` `.min(1).max(20)`, each `qtyShort 1–50` + optional `missingComponentPath`.

---

## 7. Round-trip to the audit ERP

### Outbound (inventre → audit)
`lib/erp-bridge.ts`:
- `emitExchangeEvent(returnId, "exchange.requested")` → `buildExchangePayload()` — sends `items[]` in the legacy shape **plus** a parallel `per_item_details[]` array (per-component sub_reason, damage_location, replacement_mode, resolved `requested_variant`, `requested_component_path`, notes) so audit renders per-component cards. Item codes resolve via `variant.erpName ?? variant.sku ?? product.erpName ?? product.itemCode ?? variant.id`.
- `emitMissingClaimEvent(claimId, "missing.requested")` — enriches each `missing_component_path` with item_code/name/size.
- Delivered over the existing **HMAC-signed** `/api/ecom/ingest` channel. Fired in the background (`void`) so the parent's POST returns promptly; the durable record is the local row and admin can replay.

### Inbound (audit → inventre) — status flips
`app/api/erp/webhooks/exchange/route.ts` (and `.../missing`):
- **Auth:** `X-ERP-Signature: sha256=<hmac over raw body>` using `ERP_WEBHOOK_SECRET` (symmetrical channel), `crypto.timingSafeEqual`.
- **Events:** `exchange.approved` / `exchange.rejected` / `exchange.received`, plus:
  - `exchange.created` — customer-care raised the exchange manually in audit; `createExchangeFromAudit()` builds a local row and returns its `returns.id` for audit to pin.
  - `exchange.replacement_arrived` — a sub-state (warehouse → school dispatch landed). Stamps `replacement_arrived_at` **without** changing status, so the customer page shows "your replacement is at school" between approved and pickup.
- **Audit alias:** audit's terminal `exchange_completed` → inventre `received`.
- **Monotonic:** `transitionExchangeStatus()` refuses backward moves (`canTransition`), refuses `requested` from a webhook (storefront owns it), and 409s a duplicate/late delivery. Rows resolve by `exchange.id` (UUID) or `return_number`.

---

## 8. Admin (inventre side) review

- `app/admin/(protected)/returns/page.tsx` — the **shared RMA/returns queue** (exchange rows appear here alongside legacy refunds; there is no exchange-only admin queue on inventre). Gated on `returns.read`/`returns.write`, joined to parent + order, most-recent 200. Detail + new pages under `returns/[id]` and `/new`.
- **Actions API** `app/api/admin/returns/[id]/route.ts` (`requirePermission("returns.write")`), status-gated enum `["approve","reject","receive","refund","create_replacement"]`:
  - `receive` — only `condition === "unopened"` items go back to stock (`returnToStock`).
  - `refund` — issues a credit note (`generateCreditNote`), sets `refundMethod` + `creditNoteInvoiceId`.
  - `create_replacement` — spawns a new order (`isReplacement:true`, `replacementForOrderId`, status `confirmed`/`paid`) via `allocOrderNumber()`.
  - All actions log via `logAdminActivity`.
- Missing claims have **no dedicated inventre admin page** — they're managed in the audit ERP and status-flipped back via webhook.
- Audit-originated requests (raised in the call-centre UI) come in via `exchange.created`/`missing.created` → `lib/audit-inbound.ts` (`createExchangeFromAudit`/`createMissingFromAudit`), which build the local row **without re-emitting** (avoids a loop), dedupe to one non-rejected request per order, reverse-match audit's opaque `item_code`s to order lines, and honour `RETURNS_NUMBER_SINGLE_SOURCE` (when `true`, inventre always mints the RTN-/MIS- number and audit adopts it).
- Full customer-care review + approve/reject + school hand-over happens on **audit.inventre.in** (Exchange Requests queue + School Exchange Pickups view), which flips status back via the webhooks in §7.

---

## 9. Status machines (canonical)

**Exchange** (`lib/exchange-shared.ts`): `requested → approved → received`; `requested → rejected` (terminal). `approved` = ready-for-pickup; `received` = delivered/completed. Reuses the existing `returnStatusEnum` — no new enum values.

**Missing** (`lib/missing.ts`): `requested → approved → received_at_school → delivered`; `requested → rejected` (terminal). No reverse logistics.

`isApprovedStatus()` treats `approved`/`received`/`received_at_school`/`delivered`/`completed`/`exchange_completed` as "approved or beyond" — the set that permanently blocks re-raising on the same order.

---

## 10. The status BANNER — exact content shown to the customer

The banner sits at the top of `/shop/orders/[id]` whenever an active request exists on that order. It's a **coloured, clickable card** (tap → the full status page). Rendered by `components/shop/orders/exchange/ExchangeStatusBanner.tsx` and `.../missing/MissingStatusBanner.tsx`. It renders nothing when there's no active request. Each state has its own colour, icon, title (with the RTN-/MIS- number appended) and sub-line:

### Exchange banner (`ExchangeStatusBanner.tsx`)
| Status | Colour / icon | Title | Sub-line |
|---|---|---|---|
| `requested` | amber · Clock | **Exchange request submitted · RTN-…** | "Approval is pending. We'll notify you as soon as our team reviews it." |
| `approved` | emerald · CheckCircle | **Exchange approved · RTN-…** | "Please visit **your school** (or **the store** if `atStore`) on **{Saturday pickup date}** to collect the exchange. Carry a photo of this order so the school/store can verify." |
| `rejected` | rose · AlertCircle | **Exchange request not approved · RTN-…** | "Tap to see why and what to do next." (the actual `rejectionReason` is shown on the status page) |
| `received` | cream/ink · Package | **Exchange completed · RTN-…** | "The exchange was handed over at school/store. Thanks for shopping with Inventre." |

- **`atStore`** flips the wording between "your school" and "the store" — true when the order's school collects at the Inventre store (KLINK / QLPHP), driven by `STORE_PICKUP_SCHOOL_CODES`.
- The pickup date renders via `formatPickupLabel` ("Saturday, 21 June 2026"); falls back to "the scheduled Saturday" / "the scheduled day".

### Missing banner (`MissingStatusBanner.tsx`)
| Status | Colour / icon | Title | Sub-line |
|---|---|---|---|
| `requested` | amber · Clock | **Missing-item claim submitted · MIS-…** | "Approval is pending. We'll notify you as soon as our team reviews it." |
| `approved` | emerald · CheckCircle | **Missing-item claim approved · MIS-…** | "The replacement is on its way to your school. Please visit on **{Saturday pickup date}** to collect it. Carry a photo of this order so the school can verify." |
| `received_at_school` | emerald · Package | **Replacement arrived at school · MIS-…** | "Your replacement has reached the school and is ready for collection." |
| `rejected` | rose · AlertCircle | **Missing-item claim not approved · MIS-…** | "Tap to see why and what to do next." |
| `delivered` | cream/ink · Package | **Missing-item claim completed · MIS-…** | "The replacement was handed over at school. Thanks for shopping with Inventre." |

Both banners are visible only when the order-detail API (`app/api/orders/[id]/route.ts`) returns `activeExchange` / `activeMissing` (i.e. the gate is upstream).

## 11. Notifications

`lib/notifications.ts` → `notifyExchangeStatus()` fires on each transition (requested / approved / completed / rejected). SMS templates are DLT-registered; if a template isn't filed, the SMS shim no-ops silently and the **in-app banner / status page is the customer's signal**.

---

## 12. Quick reference — key files

```
Storefront UI
  app/shop/orders/[id]/page.tsx                         entry (banner + buttons)
  app/shop/orders/[id]/exchange/new/page.tsx            exchange form host
  app/shop/orders/[id]/exchange/[returnId]/page.tsx     exchange status page
  app/shop/orders/[id]/missing/new/page.tsx             missing form host
  app/shop/orders/[id]/missing/[claimId]/page.tsx       missing status page
  components/shop/orders/exchange/ExchangeForm.tsx       the rich multi-step form
  components/shop/orders/exchange/ExchangeStatusBanner.tsx  order-page banner (§10)
  components/shop/orders/missing/MissingForm.tsx            missing multi-step form
  components/shop/orders/missing/MissingStatusBanner.tsx    order-page banner (§10)

API
  app/api/returns/route.ts            create/list exchange
  app/api/returns/upload/route.ts     photo upload
  app/api/missing/route.ts            create/list missing
  app/api/orders/[id]/route.ts        button eligibility
  app/api/erp/webhooks/exchange/route.ts   inbound status flips
  app/api/erp/webhooks/missing/route.ts    inbound status flips

Domain / server
  lib/exchange.ts            createExchange, transitionExchangeStatus, one-per-order lock
  lib/exchange-shared.ts     photo categories, status machine, pickup label (client-safe)
  lib/exchange-reasons.ts    per-product-type reason/sub-reason/damage sets (getReasonOptions)
  lib/bundle-fallback.ts     fallbackBundleComponents (flat magic-box) + loadBookkitCategoryTree (3-level kit→category→book, §3c)
  lib/audit-inbound.ts       createExchangeFromAudit / createMissingFromAudit (audit-raised)
  lib/exchange-gate.ts       rollout + ownership gates (EXCHANGE_OPEN_TO_ALL)
  lib/missing.ts             createMissingClaim
  lib/return-eligibility.ts  delivered + window gate (RETURNS_WINDOW_DAYS=0)
  lib/erp-bridge.ts          buildExchangePayload, emit*Event (outbound to audit)
  lib/numbering.ts           RTN- / MIS- allocation
  lib/notifications.ts       SMS/in-app status notifications

Data model (db/schema.ts)
  returns (1219) · return_items (1297) · missing_item_claims (1327) · missing_item_claim_items (1363)

Admin
  app/admin/(protected)/returns/  list + detail
```
