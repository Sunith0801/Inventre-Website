# Inventre — Option B: Build Everything Native (No ERPNext Integration)

> **Author**: Engineering · **Date**: 2026-05-02 · **Status**: Master Plan v1
> **Decision locked**: Option B — replicate ERPNext functionality natively in Inventre.
> **Pre-Option-B git checkpoint**: `d658171` on `origin/main` (rollback target).
> **Predecessor plan (rejected)**: `ERP_INTEGRATION_PLAN.md` (Option A — integrate with live ERPNext).

---

## 0. Executive Summary

The choice: **Inventre will become a self-contained system.** No live API to ERPNext. Items, variants, attributes, stock, pricing, orders, shipments, invoicing, tax computation, and discount rules are all built natively inside the Inventre Next.js + Postgres stack.

ERPNext at `erp.inventre.in` continues to exist for the foreseeable future, but its role is reduced to **back-office accounting** (general ledger, balance sheet, P&L, GST returns). Inventre exports sales data to it on a schedule. Inventre does not read from it at runtime.

This plan covers **12 phases over ~17–19 weeks solo (~10 weeks with two engineers)**. It is much larger than Option A. The reason is simple: Option A reuses what ERPNext already does; Option B re-builds it. The audit document (`inventre-erp-complete-audit.md`) becomes a **reference for the data model**, not a runtime dependency.

**Core architectural principles:**

1. **Inventre Postgres is the only source of truth** for everything user-facing (catalog, customers, orders, stock, prices, invoices).
2. **The schema is overhauled, not extended.** The current 30-table schema is too thin for what we now need. We add ~15 tables and modify ~6 existing ones.
3. **Scope is bounded.** We build what an e-commerce business needs. We do not build accounting (ledgers, journal entries, balance sheet). That stays in ERPNext or moves to a dedicated tool (Tally/Zoho Books) later.
4. **Data is migrated once.** A one-time bulk import pulls items, customers, and historical orders out of ERPNext into Inventre. After cut-over, ERPNext is read-only for archive purposes.
5. **GST is real but realistic.** We compute and display GST correctly per the audit (Nil-Rated for uniforms, 18% in-state SGST+CGST or 18% out-state IGST for taxables). E-invoicing (IRN) and e-waybill are integrated via a third-party API gateway (ClearTax, Cygnet, Masters India) rather than direct government endpoints — a **design decision deferred** to Phase 7.

---

## 1. What "Build Everything" Means — Scope Boundary

This is the most important section. "Everything" is a slippery word, and ERPNext does dozens of things outside e-commerce. We draw the line clearly.

### 1.1 IN scope (we build all of this)

| Domain | What we build |
|---|---|
| **Catalog** | Items, item groups (categories), item attributes (size, color, house colors per school, bag designs, water bottle models, etc.), multi-attribute variants, images per variant. |
| **Schools** | Multi-tenant school metadata, item-code prefixes, house-color maps, branding (logo, banner, theme). |
| **Pricing** | Multiple price lists (Standard Selling, MRP, POS), school-specific overrides, per-variant prices, validity windows. |
| **Stock** | Multi-warehouse, per-bin stock, reserved stock for confirmed orders, stock ledger (audit trail), low-stock alerts, negative-stock (backorder) handling. |
| **Customers** | Phone-OTP login (existing), multi-student per parent, address book with billing/shipping types, customer groups, notes, tags. |
| **Orders** | Full lifecycle (draft → placed → confirmed → packed → shipped → delivered → returned), partial shipments, manual phone orders, order edits before fulfillment, cancellation + refund. |
| **Shipments** | Separate from orders, multiple shipments per order possible, carrier + tracking number + AWB, delivered/returned status. |
| **Invoicing** | Auto-generated on shipment, GST breakdown (CGST/SGST/IGST), HSN per item, financial-year-aware numbering (`INV-FY-NNNNN`), PDF generation, status tracking (draft → submitted → paid → overdue). |
| **Tax engine** | Per-item HSN code, per-item GST treatment (Nil-Rated, Taxable, Exempt, Zero-Rated), in-state vs out-state detection by pincode, tax computation per line. |
| **Discounts** | Percent off, flat off, bulk discount, BOGO, coupon codes, per-customer usage limits, school/category/product scope. |
| **Bundles** | Fixed bundles + configurable bundles (Books Bundle with grade/language/stream selectors per the audit). |
| **Returns / RMA** | Customer-initiated returns, approval flow, refund tracking. |
| **Reports** | Sales by school/category/item/period, stock valuation, customer LTV, GST summary, fulfillment cycle time. |
| **Notifications** | SMS via MSG91 (existing) for order status, shipment, delivery, refund. Email when address present. |
| **CMS / Content** | Banners, FAQs, testimonials, content blocks (existing — unchanged). |
| **Reviews / Wishlists** | (existing — unchanged). |
| **Audit & RBAC** | Action audit log, role-based access (super, ops, school_admin), school-scoped permissions. |

### 1.2 NOT in scope — you still need ERPNext (or a specialist tool) for these

| Domain | Why we don't build it |
|---|---|
| **Accounting (general ledger, journal entries, chart of accounts)** | India's accounting requirements are heavy. Building a double-entry ledger that satisfies a CA review is a 6+ month project on its own. ERPNext's accounting module covers it. |
| **Balance sheet / P&L / Trial balance** | Same as above. |
| **Bank reconciliation** | Same. |
| **Manufacturing (BOM, production planning, work orders)** | The "M" company in your ERP setup is a manufacturing entity. Out of scope for e-commerce admin. |
| **HR / payroll / leaves / attendance** | Out of scope. |
| **Fixed asset register / depreciation** | Out of scope. |
| **Project management** | Out of scope. |
| **Direct government e-invoicing API** | Use a 3rd-party gateway (ClearTax / Cygnet / Masters India) when we get to Phase 7. The government's IRN portal has a steep certification curve. |

### 1.3 The "what about ERPNext now" decision

Three honest options for ongoing ERPNext usage:

| Option | What it means | Trade-off |
|---|---|---|
| **B-i: Decommission ERPNext entirely** | After data migration, stop using it. Find a different tool for accounting (Zoho Books, Tally). | Saves recurring ERPNext hosting cost; major migration effort to new accounting tool; risk of losing financial-record continuity. |
| **B-ii: ERPNext stays for accounting only (RECOMMENDED)** | Inventre is canonical for e-commerce. Inventre exports order/invoice/payment data to ERPNext nightly for the accountant. ERPNext UI is used only by finance. | Keeps existing accounting + GST + e-invoicing working in ERP; adds a one-way export job; e-commerce team never touches ERP. |
| **B-iii: Keep both fully active in parallel** | ERPNext continues to receive orders too (e.g. POS / phone orders), and there's a manual reconciliation. | Two sources of truth; reconciliation overhead forever. **Not recommended.** |

**The plan below assumes B-ii.** A nightly export job is included in Phase 12. If you want B-i later, that's a separate decommission project.

---

## 2. Architecture Decision Record

| Decision | Choice | Why |
|---|---|---|
| **Source of truth** | Inventre Postgres for all e-commerce domains | Self-contained; no runtime ERP dependency. |
| **Schema strategy** | Overhaul (add ~15 tables, modify ~6) | The existing schema's `productVariants.size` (single string) and `productVariants.stockQty` (single int) cannot represent the audit's complexity (multi-attribute variants, multi-warehouse stock, multiple price lists). Extending in place produces dual-purpose columns; cleaner to add new tables and migrate. |
| **Existing data preservation** | Keep what's there + smart migrate | Preserve the 4 seeded products and any existing dev orders. Migration script converts old rows to new schema. |
| **Identifiers** | Stable UUIDs (existing) for primary keys; SKUs added for variants | UUIDs don't leak business info; SKUs are human-readable for ops. |
| **Currency unit** | Continue with paise (×100 integer) | Proven; no float drift. Display layer converts to ₹. |
| **Order numbering** | Continue `INV-YYYY-NNNN` (existing) | Customer-facing; already deployed in production. |
| **Invoice numbering** | New `INV-FY-NNNNN` (financial-year aware: April–March) | Required for India GST; the audit shows `INV-26-27-00001` format. |
| **Stock model** | Atomic via Postgres row-level locks; `bins` table; reserved + actual; ledger for audit | Proven pattern; works for our scale. |
| **Tax engine** | Pure function in `lib/tax.ts`; deterministic; unit-tested | Tax is too important to be ad-hoc. |
| **PDF generation** | `@react-pdf/renderer` (or Puppeteer for HTML→PDF) | React-PDF is clean for invoices; Puppeteer if we want HTML/CSS fidelity. Decision in Phase 7. |
| **E-invoicing** | 3rd-party gateway in Phase 7 (ClearTax / Cygnet / Masters India) | Don't roll our own government-portal client. Pluggable behind interface. |
| **Background jobs** | Postgres-backed queue (e.g. `pg-boss`) or Redis (`bullmq`) | We already have Redis + Postgres. `bullmq` integrates with our `ioredis`. |
| **File storage** | Existing MinIO/S3 setup | No change. |
| **Search** | Postgres trigram + full-text (`pg_trgm`) for catalog/customer search | Avoids Elasticsearch complexity; sufficient for our scale. |
| **Auth & sessions** | Existing JWT cookies (parent + admin) | No change. |
| **Image processing** | `sharp` for variant thumbnails, Cloudflare Image Resizing in production | Keep current setup. |

---

## 3. New Schema — Complete Design

This is the heart of Option B. Read it carefully — every later phase implements pieces of this.

### 3.1 Existing tables we modify

```sql
-- products: add HSN, GST treatment, item-code prefix
ALTER TABLE products ADD COLUMN itemCode TEXT UNIQUE;        -- "KLS Boys Shirt"
ALTER TABLE products ADD COLUMN hsnCode TEXT;                 -- "61012000"
ALTER TABLE products ADD COLUMN gstTreatment TEXT NOT NULL DEFAULT 'taxable'
  CHECK (gstTreatment IN ('taxable', 'nil_rated', 'exempt', 'non_gst', 'zero_rated'));
ALTER TABLE products ADD COLUMN taxRateId UUID;              -- FK added later
ALTER TABLE products ADD COLUMN sizeChartUrl TEXT;
ALTER TABLE products ADD COLUMN brand TEXT;
ALTER TABLE products ADD COLUMN weightGrams INT;
ALTER TABLE products ADD COLUMN dimensions JSONB;            -- {l, w, h} in cm
ALTER TABLE products ADD COLUMN minOrderQty INT DEFAULT 1;
ALTER TABLE products ADD COLUMN reorderTatDays INT;
ALTER TABLE products ADD COLUMN costPrice INT;               -- paise; reference cost
ALTER TABLE products ADD COLUMN displayPrice INT;            -- paise; for catalog cards

-- productVariants: drop simple size/price/stock, add SKU/barcode
-- Migration is non-destructive: keep "size" temporarily, populate productVariantAttributes from it,
-- then drop "size" in a later migration once all reads are migrated.
ALTER TABLE productVariants ADD COLUMN sku TEXT UNIQUE;
ALTER TABLE productVariants ADD COLUMN barcode TEXT;
ALTER TABLE productVariants ADD COLUMN weightGrams INT;
ALTER TABLE productVariants ADD COLUMN imageUrl TEXT;        -- variant-specific (overrides product)
-- "size" column kept during transition; drop after Phase 2
-- "stockQty" column kept during transition; drop after Phase 3 (stock moves to bins)
-- "price" column kept during transition; drop after Phase 3 (price moves to itemPrices)

-- schools: add prefixes + house color map
ALTER TABLE schools ADD COLUMN itemCodePrefixes TEXT[] DEFAULT '{}'::text[];
ALTER TABLE schools ADD COLUMN colorMap JSONB DEFAULT '{}'::jsonb;
-- colorMap example: {"A":{"label":"Kalpana Chawla - RED","hex":"#C62828"},
--                    "V":{"label":"Vikram Sarabhai - BLUE","hex":"#1565C0"}}
ALTER TABLE schools ADD COLUMN gradesServed TEXT[] DEFAULT '{}'::text[];
ALTER TABLE schools ADD COLUMN curriculum TEXT[];           -- ['CBSE', 'CIE', 'IGCSE']

-- addresses: enrich for billing/shipping + GSTIN
ALTER TABLE addresses ADD COLUMN addressTitle TEXT;          -- "Home", "Office"
ALTER TABLE addresses ADD COLUMN addressType TEXT NOT NULL DEFAULT 'shipping'
  CHECK (addressType IN ('billing', 'shipping', 'both'));
ALTER TABLE addresses ADD COLUMN country TEXT NOT NULL DEFAULT 'India';
ALTER TABLE addresses ADD COLUMN gstin TEXT;                 -- for B2B invoice; NULL for B2C
ALTER TABLE addresses ADD COLUMN companyName TEXT;
ALTER TABLE addresses ADD COLUMN landmark TEXT;

-- orders: add billing-address, financial-year, return tracking
ALTER TABLE orders ADD COLUMN billingAddress JSONB;
ALTER TABLE orders ADD COLUMN financialYear TEXT;            -- "2026-27"
ALTER TABLE orders ADD COLUMN cancellationReason TEXT;
ALTER TABLE orders ADD COLUMN refundedAmount INT DEFAULT 0;
ALTER TABLE orders ADD COLUMN notes TEXT;
ALTER TABLE orders ADD COLUMN tags TEXT[];

-- parents: add email properly + customer group
ALTER TABLE parents ADD COLUMN email TEXT;
ALTER TABLE parents ADD COLUMN customerGroup TEXT DEFAULT 'student';
ALTER TABLE parents ADD COLUMN tags TEXT[];
ALTER TABLE parents ADD COLUMN notes TEXT;
ALTER TABLE parents ADD COLUMN totalLifetimeValue INT DEFAULT 0;     -- denormalized
ALTER TABLE parents ADD COLUMN totalOrderCount INT DEFAULT 0;        -- denormalized
ALTER TABLE parents ADD COLUMN lastOrderAt TIMESTAMPTZ;
```

### 3.2 New tables (Catalog)

```sql
-- 3.2.1 Item attributes (Color, Size, House Color per school, etc.)
CREATE TABLE productAttributes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,                              -- "Shirt Size", "SAM House Color"
  type TEXT NOT NULL CHECK (type IN ('size', 'color', 'design', 'model', 'other')),
  schoolId UUID REFERENCES schools(id) ON DELETE CASCADE, -- NULL = global; set = school-specific
  description TEXT,
  sortOrder INT DEFAULT 0,
  createdAt TIMESTAMPTZ DEFAULT NOW(),
  updatedAt TIMESTAMPTZ DEFAULT NOW()
);

-- 3.2.2 Attribute values (e.g. for "Shirt Size": "20", "22", ..., "58")
CREATE TABLE productAttributeValues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attributeId UUID NOT NULL REFERENCES productAttributes(id) ON DELETE CASCADE,
  value TEXT NOT NULL,                                    -- "22", "L", "Kalpana Chawla - RED"
  shortCode TEXT,                                         -- "K" — used in legacy SKU codes
  displayLabel TEXT,                                      -- shown to customer
  hexColor TEXT,                                          -- swatch (for color attributes)
  imageUrl TEXT,                                          -- swatch image (for design attributes)
  sortOrder INT DEFAULT 0,
  isActive BOOLEAN DEFAULT TRUE,
  createdAt TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(attributeId, value)
);

-- 3.2.3 Which attributes a parent product uses
CREATE TABLE productAttributeBindings (
  productId UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  attributeId UUID NOT NULL REFERENCES productAttributes(id) ON DELETE RESTRICT,
  isRequired BOOLEAN DEFAULT TRUE,
  sortOrder INT DEFAULT 0,
  PRIMARY KEY (productId, attributeId)
);

-- 3.2.4 Which attribute values a specific variant has
CREATE TABLE productVariantAttributes (
  variantId UUID NOT NULL REFERENCES productVariants(id) ON DELETE CASCADE,
  attributeId UUID NOT NULL REFERENCES productAttributes(id),
  valueId UUID NOT NULL REFERENCES productAttributeValues(id),
  PRIMARY KEY (variantId, attributeId)
);
CREATE INDEX idx_pva_value ON productVariantAttributes(valueId);

-- 3.2.5 Product images (multiple per product, ordered)
-- Replaces the existing single-URL pattern
CREATE TABLE productImages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  productId UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  variantId UUID REFERENCES productVariants(id) ON DELETE CASCADE, -- NULL = product-level
  url TEXT NOT NULL,
  altText TEXT,
  sortOrder INT DEFAULT 0,
  isPrimary BOOLEAN DEFAULT FALSE,
  createdAt TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_product_images_product ON productImages(productId, sortOrder);
```

### 3.3 New tables (Pricing)

```sql
CREATE TABLE priceLists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,                              -- "Standard Selling", "MRP", "POS Retail"
  currency TEXT NOT NULL DEFAULT 'INR',
  isActive BOOLEAN DEFAULT TRUE,
  isDefault BOOLEAN DEFAULT FALSE,                        -- exactly one row should have TRUE
  appliesTo TEXT NOT NULL DEFAULT 'selling'
    CHECK (appliesTo IN ('selling', 'buying', 'both')),
  description TEXT,
  createdAt TIMESTAMPTZ DEFAULT NOW(),
  updatedAt TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE itemPrices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  variantId UUID NOT NULL REFERENCES productVariants(id) ON DELETE CASCADE,
  priceListId UUID NOT NULL REFERENCES priceLists(id) ON DELETE CASCADE,
  schoolId UUID REFERENCES schools(id) ON DELETE CASCADE,  -- NULL = global; set = school override
  price INT NOT NULL,                                       -- paise
  validFrom TIMESTAMPTZ,
  validUntil TIMESTAMPTZ,
  minQty INT DEFAULT 0,                                     -- volume pricing
  createdAt TIMESTAMPTZ DEFAULT NOW(),
  updatedAt TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_item_prices_variant ON itemPrices(variantId, priceListId, schoolId);
```

### 3.4 New tables (Stock / Warehouses)

```sql
CREATE TABLE warehouses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,                                -- "Stores - IESPL"
  code TEXT NOT NULL UNIQUE,                                -- "STORES_IESPL"
  address JSONB,
  isDefault BOOLEAN DEFAULT FALSE,
  isActive BOOLEAN DEFAULT TRUE,
  createdAt TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE bins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  variantId UUID NOT NULL REFERENCES productVariants(id) ON DELETE CASCADE,
  warehouseId UUID NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  actualQty INT NOT NULL DEFAULT 0,                         -- physical stock
  reservedQty INT NOT NULL DEFAULT 0,                       -- reserved for confirmed orders
  minStockLevel INT DEFAULT 0,
  reorderTatDays INT,
  valuationRate INT,                                        -- avg cost in paise
  lastCountedAt TIMESTAMPTZ,
  updatedAt TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(variantId, warehouseId)
);
CREATE INDEX idx_bins_variant ON bins(variantId);
CREATE INDEX idx_bins_lowstock ON bins(warehouseId)
  WHERE actualQty - reservedQty <= minStockLevel;

-- Append-only audit ledger
CREATE TABLE stockLedger (
  id BIGSERIAL PRIMARY KEY,
  variantId UUID NOT NULL,
  warehouseId UUID NOT NULL,
  delta INT NOT NULL,                                       -- + receipt, − issue
  newActualQty INT NOT NULL,
  reservedDelta INT DEFAULT 0,
  newReservedQty INT,
  reason TEXT NOT NULL                                      -- 'order_reserve','order_release','shipment_out','receipt','adjustment','return_in'
    CHECK (reason IN ('order_reserve','order_release','shipment_out','receipt','adjustment','return_in')),
  refType TEXT,                                             -- 'order','shipment','receipt','adjustment','return'
  refId UUID,
  createdBy UUID,
  notes TEXT,
  createdAt TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_stock_ledger_variant ON stockLedger(variantId, warehouseId, createdAt DESC);
CREATE INDEX idx_stock_ledger_ref ON stockLedger(refType, refId);
```

### 3.5 New tables (Tax / GST)

```sql
CREATE TABLE taxRates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,                                -- "GST 18%", "GST 5%", "Nil Rated"
  cgstRate NUMERIC(5,2) DEFAULT 0,                          -- 9.00 means 9%
  sgstRate NUMERIC(5,2) DEFAULT 0,
  igstRate NUMERIC(5,2) DEFAULT 0,
  cessRate NUMERIC(5,2) DEFAULT 0,
  hsnPattern TEXT,                                          -- "61012000" or regex
  isDefault BOOLEAN DEFAULT FALSE,
  createdAt TIMESTAMPTZ DEFAULT NOW()
);

-- HSN code library (preset list of HSN codes for picker UI)
CREATE TABLE hsnCodes (
  code TEXT PRIMARY KEY,                                    -- "61012000"
  description TEXT NOT NULL,                                -- "Garments, knitted, men/boys"
  defaultGstRate NUMERIC(5,2),
  category TEXT
);
```

### 3.6 New tables (Shipments / Fulfillment)

```sql
CREATE TABLE shipments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipmentNumber TEXT NOT NULL UNIQUE,                      -- SHP-2026-NNNNN
  orderId UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  warehouseId UUID NOT NULL REFERENCES warehouses(id),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','packed','shipped','out_for_delivery','delivered','returned','cancelled')),
  carrier TEXT,                                             -- "Delhivery", "Bluedart", "DTDC"
  trackingNumber TEXT,                                      -- AWB / LR number
  trackingUrl TEXT,
  packedAt TIMESTAMPTZ,
  shippedAt TIMESTAMPTZ,
  deliveredAt TIMESTAMPTZ,
  shippingAddress JSONB NOT NULL,                           -- snapshot at ship time
  weightGrams INT,
  dimensions JSONB,
  notes TEXT,
  createdBy UUID,
  createdAt TIMESTAMPTZ DEFAULT NOW(),
  updatedAt TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE shipmentItems (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipmentId UUID NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  orderItemId UUID NOT NULL REFERENCES orderItems(id),
  variantId UUID NOT NULL REFERENCES productVariants(id),
  qty INT NOT NULL CHECK (qty > 0),
  createdAt TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_shipment_items_shipment ON shipmentItems(shipmentId);
CREATE INDEX idx_shipment_items_order_item ON shipmentItems(orderItemId);
```

### 3.7 New tables (Invoicing)

```sql
CREATE TABLE invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoiceNumber TEXT NOT NULL UNIQUE,                       -- INV-26-27-00001
  financialYear TEXT NOT NULL,                              -- "2026-27"
  orderId UUID NOT NULL REFERENCES orders(id),
  parentId UUID NOT NULL REFERENCES parents(id),
  postingDate DATE NOT NULL,
  dueDate DATE,
  netTotal INT NOT NULL,                                    -- before tax, paise
  cgstTotal INT DEFAULT 0,
  sgstTotal INT DEFAULT 0,
  igstTotal INT DEFAULT 0,
  taxTotal INT NOT NULL DEFAULT 0,
  roundingAdjustment INT DEFAULT 0,                          -- +/- a few paise to round
  grandTotal INT NOT NULL,
  outstandingAmount INT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','submitted','paid','partially_paid','overdue','cancelled')),
  isReturn BOOLEAN DEFAULT FALSE,                           -- credit note
  parentInvoiceId UUID REFERENCES invoices(id),             -- for credit notes
  billingAddress JSONB NOT NULL,
  shippingAddress JSONB,
  placeOfSupply TEXT,                                       -- "36-Telangana"
  taxBreakdown JSONB,                                       -- detailed per-rate breakdown
  pdfUrl TEXT,
  einvoiceIrn TEXT,                                         -- IRN from government
  einvoiceQrCode TEXT,
  einvoiceStatus TEXT
    CHECK (einvoiceStatus IS NULL OR einvoiceStatus IN ('not_applicable','pending','generated','cancelled','failed')),
  ewaybillNumber TEXT,
  ewaybillStatus TEXT,
  createdAt TIMESTAMPTZ DEFAULT NOW(),
  updatedAt TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_invoices_order ON invoices(orderId);
CREATE INDEX idx_invoices_parent ON invoices(parentId, postingDate DESC);
CREATE INDEX idx_invoices_status ON invoices(status, dueDate);

CREATE TABLE invoiceItems (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoiceId UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  orderItemId UUID REFERENCES orderItems(id),
  variantId UUID NOT NULL REFERENCES productVariants(id),
  hsnCode TEXT,
  itemNameSnapshot TEXT NOT NULL,
  qty INT NOT NULL,
  unitPrice INT NOT NULL,
  discountAmount INT DEFAULT 0,
  netAmount INT NOT NULL,                                   -- after discount, before tax
  taxableAmount INT NOT NULL,                               -- usually = netAmount
  cgstRate NUMERIC(5,2) DEFAULT 0,
  sgstRate NUMERIC(5,2) DEFAULT 0,
  igstRate NUMERIC(5,2) DEFAULT 0,
  cgstAmount INT DEFAULT 0,
  sgstAmount INT DEFAULT 0,
  igstAmount INT DEFAULT 0,
  totalAmount INT NOT NULL,
  gstTreatment TEXT NOT NULL
    CHECK (gstTreatment IN ('taxable','nil_rated','exempt','non_gst','zero_rated'))
);
```

### 3.8 New tables (Discount Rules / Coupons)

```sql
-- Replaces the existing simple "coupons" table; we migrate at Phase 8
CREATE TABLE discountRules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  code TEXT UNIQUE,                                         -- coupon code; NULL = auto-apply
  type TEXT NOT NULL
    CHECK (type IN ('percent','flat','bulk','bxgy','free_shipping')),
  value NUMERIC(10,2) NOT NULL,                              -- percent or paise depending on type
  appliesTo TEXT NOT NULL DEFAULT 'all'
    CHECK (appliesTo IN ('all','school','category','product','variant')),
  schoolId UUID REFERENCES schools(id) ON DELETE CASCADE,
  categoryId UUID REFERENCES categories(id) ON DELETE CASCADE,
  productId UUID REFERENCES products(id) ON DELETE CASCADE,
  variantId UUID REFERENCES productVariants(id) ON DELETE CASCADE,
  minOrderAmount INT,                                        -- paise
  minQty INT,
  maxDiscountAmount INT,                                     -- cap on flat amount (for percent)
  maxUsesTotal INT,                                          -- coupon usage limit
  maxUsesPerCustomer INT,
  usedCount INT DEFAULT 0,
  validFrom TIMESTAMPTZ,
  validUntil TIMESTAMPTZ,
  isActive BOOLEAN DEFAULT TRUE,
  isStackable BOOLEAN DEFAULT FALSE,                         -- can combine with other rules
  priority INT DEFAULT 0,
  createdAt TIMESTAMPTZ DEFAULT NOW(),
  updatedAt TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE discountUsages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ruleId UUID NOT NULL REFERENCES discountRules(id) ON DELETE CASCADE,
  parentId UUID REFERENCES parents(id) ON DELETE SET NULL,
  orderId UUID REFERENCES orders(id) ON DELETE SET NULL,
  amountSaved INT NOT NULL,
  createdAt TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_discount_usages_rule ON discountUsages(ruleId);
CREATE INDEX idx_discount_usages_parent ON discountUsages(parentId);
```

### 3.9 New tables (Bundles)

```sql
CREATE TABLE productBundles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  productId UUID NOT NULL UNIQUE REFERENCES products(id) ON DELETE CASCADE,
  bundleType TEXT NOT NULL                                  -- 'fixed' = same components always
    CHECK (bundleType IN ('fixed','configurable')),         -- 'configurable' = parent picks options
  pricingMode TEXT NOT NULL DEFAULT 'sum'
    CHECK (pricingMode IN ('sum','fixed')),                  -- sum of components vs fixed bundle price
  fixedPrice INT,                                            -- paise; used when pricingMode='fixed'
  createdAt TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE bundleSelectors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bundleId UUID NOT NULL REFERENCES productBundles(id) ON DELETE CASCADE,
  groupKey TEXT NOT NULL,                                   -- "language", "stream", "elective_1"
  name TEXT NOT NULL,                                       -- "2nd Language"
  selectorType TEXT NOT NULL                                -- 'one_of' (radio) or 'multi' (checkbox)
    CHECK (selectorType IN ('one_of','multi')),
  isRequired BOOLEAN DEFAULT TRUE,
  minSelections INT DEFAULT 1,
  maxSelections INT,
  sortOrder INT DEFAULT 0,
  UNIQUE(bundleId, groupKey)
);

CREATE TABLE bundleComponents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bundleId UUID NOT NULL REFERENCES productBundles(id) ON DELETE CASCADE,
  variantId UUID REFERENCES productVariants(id) ON DELETE CASCADE,
  productId UUID REFERENCES products(id) ON DELETE CASCADE,  -- alt: any-variant of this product
  qty INT NOT NULL DEFAULT 1,
  selectorGroupKey TEXT,                                     -- if NULL, always included
  selectorOptionLabel TEXT,                                  -- "Hindi", "MPC Stream"
  isOptional BOOLEAN DEFAULT FALSE,
  CHECK (variantId IS NOT NULL OR productId IS NOT NULL)
);
CREATE INDEX idx_bundle_components_bundle ON bundleComponents(bundleId, selectorGroupKey);

-- Per-school per-grade configuration for "configurable" bundles
CREATE TABLE bundleConfigs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schoolId UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  grade TEXT NOT NULL,
  bundleId UUID NOT NULL REFERENCES productBundles(id) ON DELETE CASCADE,
  isActive BOOLEAN DEFAULT TRUE,
  UNIQUE(schoolId, grade, bundleId)
);
```

### 3.10 New tables (Returns / RMA)

```sql
CREATE TABLE returns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  returnNumber TEXT NOT NULL UNIQUE,                        -- RTN-2026-NNNNN
  orderId UUID NOT NULL REFERENCES orders(id),
  parentId UUID NOT NULL REFERENCES parents(id),
  status TEXT NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested','approved','rejected','received','refunded','closed')),
  reason TEXT NOT NULL,
  notes TEXT,
  approvedBy UUID,
  approvedAt TIMESTAMPTZ,
  receivedAt TIMESTAMPTZ,
  refundedAt TIMESTAMPTZ,
  refundAmount INT,
  refundMethod TEXT,                                         -- 'original','wallet','bank'
  creditNoteInvoiceId UUID REFERENCES invoices(id),
  createdAt TIMESTAMPTZ DEFAULT NOW(),
  updatedAt TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE returnItems (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  returnId UUID NOT NULL REFERENCES returns(id) ON DELETE CASCADE,
  orderItemId UUID NOT NULL REFERENCES orderItems(id),
  variantId UUID NOT NULL REFERENCES productVariants(id),
  qty INT NOT NULL CHECK (qty > 0),
  reason TEXT,
  condition TEXT                                             -- 'unopened','opened','damaged'
    CHECK (condition IN ('unopened','opened','damaged'))
);
```

### 3.11 New tables (Observability / Background Jobs)

```sql
CREATE TABLE backgroundJobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  jobType TEXT NOT NULL,                                    -- 'invoice_pdf','einvoice_irn','sms_send','export_to_erp'
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','running','completed','failed','dead')),
  payload JSONB NOT NULL,
  result JSONB,
  attempts INT DEFAULT 0,
  maxAttempts INT DEFAULT 3,
  lastError TEXT,
  scheduledFor TIMESTAMPTZ DEFAULT NOW(),
  startedAt TIMESTAMPTZ,
  finishedAt TIMESTAMPTZ,
  createdAt TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_jobs_status ON backgroundJobs(status, scheduledFor);

-- Already exists: auditLog. Extend:
ALTER TABLE auditLog ADD COLUMN IF NOT EXISTS entityType TEXT;
ALTER TABLE auditLog ADD COLUMN IF NOT EXISTS entityId UUID;
ALTER TABLE auditLog ADD COLUMN IF NOT EXISTS beforeState JSONB;
ALTER TABLE auditLog ADD COLUMN IF NOT EXISTS afterState JSONB;
```

---

## 4. Twelve Phases

Each phase: Goal → Deliverables → Done criteria → Rollback. Sized for solo or small-team execution.

### Phase 0 — Safety Net (1 day)

**Goal:** A clean, tagged rollback point on GitHub before we start refactoring.

**Deliverables:**
- Commit currently-uncommitted files: `scripts/e2e.ts` (the 127-test suite), `inventre-erp-complete-audit.md`, `ERP_INTEGRATION_PLAN.md` (kept as historical doc), and this plan.
- Tag the commit `v1.0-pre-overhaul`.
- Push tag to origin.
- README addition: "Rollback procedure" section pointing at `git reset --hard v1.0-pre-overhaul`.

**Done when:** `git tag --list` shows `v1.0-pre-overhaul`; `git ls-remote origin refs/tags/v1.0-pre-overhaul` returns the same SHA.
**Rollback:** N/A.

---

### Phase 1 — Schema Foundation (1.5 weeks)

**Goal:** New schema is in place. Existing app still works (schema is additive at this point — old columns remain).

**Deliverables:**
- Drizzle schema additions in `db/schema.ts`: every table from §3.2–3.11 above (~15 new tables, ~6 modified).
- Migration files in `db/migrations/` generated via `drizzle-kit generate`.
- Seed updates in `db/seed.ts`:
  - Default `priceLists`: "Standard Selling" (default), "MRP", "POS Retail".
  - Default `warehouses`: "Stores - IESPL" (default).
  - Default `taxRates`: "GST 18%", "GST 5%", "Nil Rated", "Exempt".
  - Seed `hsnCodes` from a small starter set (61012000, 64041100, 84713010 — common ones).
  - For each seeded variant, create a `bins` row with the existing `stockQty` value.
  - For each seeded variant, create an `itemPrices` row in "Standard Selling" with the existing `price` value.
- Compatibility shim: `lib/repos/products.ts` reads stock from `bins` if present, falls back to `productVariants.stockQty`. Same for price.
- E2E tests pass unchanged.

**Done when:**
- `npm run db:push` applies cleanly to a fresh DB.
- `npm run db:seed` produces a runnable site with bins + itemPrices populated.
- All 127 E2E tests pass.
**Rollback:** revert the migration; the old columns are still there.

---

### Phase 2 — Item & Variant Admin (2 weeks)

**Goal:** A new admin UI to manage items, attributes, and multi-attribute variants.

**Deliverables:**

UI pages (`/admin2/catalog/...` during build, renamed to `/admin/catalog/...` at cutover):

| Page | What it does |
|---|---|
| `/admin/catalog/attributes` | List + create attributes (global or school-scoped). Tab per type. |
| `/admin/catalog/attributes/[id]` | Edit attribute, manage values (with hex/imageUrl swatches), reorder. |
| `/admin/catalog/items` | Tree view: school → category → items. Filter, search, bulk select. |
| `/admin/catalog/items/new` | Create item (basics + HSN + GST treatment + bind attributes + bind to school). |
| `/admin/catalog/items/[id]` | Item detail tabs: Overview · Variants · Images · Pricing · Stock · Schools. |
| `/admin/catalog/items/[id]/variants` | Variant grid editor (matrix of size × color); inline create/disable. |
| `/admin/catalog/items/[id]/images` | Drag-drop multi-image upload to MinIO; per-variant image override. |

API routes:
- `POST/PATCH/DELETE /api/admin/attributes`
- `POST/PATCH/DELETE /api/admin/attributes/[id]/values`
- `POST/PATCH/DELETE /api/admin/products` (extended)
- `POST/PATCH/DELETE /api/admin/products/[id]/variants` (replaces simple variant array)
- `POST /api/admin/products/[id]/variants/bulk` — generate full size×color matrix
- `POST/DELETE /api/admin/products/[id]/images`

Logic:
- When creating variants in bulk, generate SKUs deterministically (e.g. `{itemCode}-{color}-{size}`).
- When toggling an attribute value off, prompt to disable affected variants (don't auto-delete).
- Variant code parser (audit §2.4) — used only for migration; never for new variants.

**Done when:** an ops user can create a brand-new item with 2 attributes (size + color) and 16 variants, upload 5 images, save, and see it on the public catalog with the right variant grid.
**Rollback:** keep `/admin` (old) live; remove `/admin2` route prefix.

---

### Phase 3 — Pricing & Stock Admin (1.5 weeks)

**Goal:** Multiple price lists; multi-warehouse stock with reservation; ledger.

**Deliverables:**

UI pages:
| Page | What it does |
|---|---|
| `/admin/catalog/price-lists` | List/create/edit price lists. |
| `/admin/catalog/pricing` | Grid: rows = variants, columns = price lists (+ per-school overrides). Inline edit. |
| `/admin/catalog/pricing/bulk` | Bulk update by % markup over `costPrice` or current price. |
| `/admin/catalog/warehouses` | List/create/edit warehouses. |
| `/admin/catalog/stock` | Live bin view: filter by school, warehouse, low-stock, negative. |
| `/admin/catalog/stock/[variantId]` | Stock detail + ledger history. |
| `/admin/catalog/stock/adjust` | Stock adjustment form (qty +/-, reason, ledger entry). |

API routes:
- `POST/PATCH/DELETE /api/admin/price-lists`
- `POST/PATCH/DELETE /api/admin/item-prices` (with `schoolId` for overrides)
- `POST /api/admin/item-prices/bulk-update` (markup %)
- `POST/PATCH /api/admin/warehouses`
- `POST /api/admin/stock/adjust` — single endpoint that writes `bins` + `stockLedger` atomically.

Logic:
- Stock writes are wrapped in a Postgres transaction with `SELECT ... FOR UPDATE` on the bin row.
- Public-facing `/api/shop/products` switches to read price from `itemPrices` (default price list) and stock from `bins`.
- The compatibility shim from Phase 1 is removed.

**Done when:**
- `productVariants.price` column is no longer read by any code.
- `productVariants.stockQty` column is no longer read by any code.
- A stock adjustment in the admin shows up in the parent's PDP within seconds.
- Adjusting stock leaves a ledger row visible in the variant detail page.
**Rollback:** Re-enable the shim; revert API code changes.

---

### Phase 4 — Customer & Address Admin (1 week)

**Goal:** Robust customer management. Address improvements. Audit support for customer-facing concerns.

**Deliverables:**

UI pages:
| Page | What it does |
|---|---|
| `/admin/customers` | Search by phone, email, name, school; results show LTV, last order, students. |
| `/admin/customers/[id]` | Profile, orders, addresses, students, notes, tags, audit log. |
| `/admin/customers/[id]/addresses` | Manage addresses (billing/shipping, GSTIN, etc.). |
| `/admin/customers/import` | CSV import with dedup-by-phone, dry-run preview. |

API routes:
- `GET /api/admin/customers?search=…` (uses `pg_trgm`)
- `PATCH /api/admin/customers/[id]` (notes, tags, customerGroup)
- `POST /api/admin/customers/[id]/addresses`
- `PATCH /api/admin/customers/[id]/addresses/[aid]`
- `POST /api/admin/customers/import` (CSV with progress streaming)

Logic:
- LTV/order count are denormalized fields on `parents`; updated by a trigger or by the order pipeline.
- Public-facing `/api/addresses` adds `addressType`, `addressTitle`, `gstin`.

**Done when:** typing a phone fragment in the admin search returns hits in <200ms; an ops user can edit a customer's notes and see the change on their next visit.
**Rollback:** revert the new admin pages.

---

### Phase 5 — Order Management (2 weeks)

**Goal:** Replace the simple admin order page with a full operations dashboard. Add manual order creation. Stock reserve/release on confirm/cancel.

**Deliverables:**

UI pages:
| Page | What it does |
|---|---|
| `/admin/orders` | Dashboard: filters (school, status, payment status, date), bulk export. |
| `/admin/orders/[id]` | Full detail: items, payment, addresses, audit log, timeline, actions. |
| `/admin/orders/new` | Manual phone-order creation (ops user picks customer, items, address). |
| `/admin/orders/[id]/edit` | Edit qty/price (allowed only before confirmation). |

API routes:
- `GET /api/admin/orders?filters=…` (server-side filter + paginate)
- `GET /api/admin/orders/[id]` ← **new** GET handler (the audit's gap from our 127-test E2E)
- `POST /api/admin/orders` ← manual creation
- `PATCH /api/admin/orders/[id]` (status transitions)
- `POST /api/admin/orders/[id]/cancel` ← releases reserved stock + triggers refund flow

Logic:
- **Stock reservation flow** (this replaces the current Razorpay webhook decrement):
  - Order in `placed` → no reservation.
  - Order in `confirmed` (after payment) → bin update: `actualQty unchanged`, `reservedQty += qty`, ledger row `reason='order_reserve'`.
  - Order cancelled before shipment → `reservedQty -= qty`, ledger `reason='order_release'`.
  - Order shipped → see Phase 6: stock moves from reserved → out (actualQty -= qty, reservedQty -= qty).
- All stock changes inside Postgres TX with `FOR UPDATE`.

**Done when:** placing an order through the parent flow reserves stock immediately; cancelling it releases stock; the ledger shows both events.
**Rollback:** revert to the old simple PATCH on order status; the bins still work but without reservation logic.

---

### Phase 6 — Shipments & Delivery (1.5 weeks)

**Goal:** Separate shipments from orders; partial shipments; carrier + tracking; status notifications.

**Deliverables:**

UI pages:
| Page | What it does |
|---|---|
| `/admin/shipments` | List shipments with filters. |
| `/admin/shipments/new?orderId=…` | Pick which order items + qty go in this shipment. |
| `/admin/shipments/[id]` | Shipment detail; mark packed/shipped/delivered. |
| `/admin/orders/[id]` (extended) | Embedded shipments table. |

API routes:
- `POST /api/admin/shipments` (creates draft + reserves nothing extra; just notes intent)
- `PATCH /api/admin/shipments/[id]` (carrier, tracking, status transitions)
- `POST /api/admin/shipments/[id]/mark-shipped` ← stock moves from reserved → out
- `POST /api/admin/shipments/[id]/mark-delivered` ← updates parent's order status when all shipments delivered

Logic:
- Stock-out at ship time: `actualQty -= qty, reservedQty -= qty` per shipment item; ledger `reason='shipment_out'`.
- Order status auto-transitions:
  - First shipment shipped → order `status='shipped'` (or stays `confirmed` if partial).
  - All shipped → `status='shipped'`.
  - All delivered → `status='delivered'`.
- SMS sent to parent on each shipment status change (using existing `notifyOrderStatus`).
- Tracking URL templates per carrier in `lib/carriers.ts`.

**Done when:** a single order can be split into 2 shipments (e.g. uniform now, books later); the parent sees both shipments with separate tracking on the order detail page; the right SMS fires at each event.
**Rollback:** keep the old order-only status flow; shipments remain as draft data with no consequence.

---

### Phase 7 — Invoicing + GST Engine (3 weeks) — **highest complexity**

**Goal:** Auto-generate GST-compliant invoices on shipment. PDF download. (E-invoicing IRN deferred or pluggable.)

**Deliverables:**

Core engine: `lib/tax.ts`
```ts
type LineInput = {
  netAmount: number;       // paise, after discount
  hsnCode: string;
  gstTreatment: 'taxable' | 'nil_rated' | 'exempt' | 'non_gst' | 'zero_rated';
  rateOverride?: TaxRate;
};
type Computed = {
  cgstRate: number; sgstRate: number; igstRate: number;
  cgstAmount: number; sgstAmount: number; igstAmount: number;
  totalTax: number; lineTotal: number;
};
function computeLineTax(line: LineInput, ctx: { isInState: boolean }): Computed;
function computeInvoiceTotals(lines: LineInput[], shippingPincode: string): InvoiceTotals;
```

Logic:
- `isInState` = company state (Telangana, code 36) === customer state (derived from pincode).
- Nil-Rated / Exempt / Zero-Rated → all rates 0.
- Taxable + in-state → CGST + SGST.
- Taxable + out-state → IGST.
- Rounding: per-line amounts stored to paise; invoice grand total rounded to nearest rupee with `roundingAdjustment` saved.

UI pages:
| Page | What it does |
|---|---|
| `/admin/invoices` | List with filters; bulk download PDFs. |
| `/admin/invoices/[id]` | Detail; download PDF; cancel; create credit note. |
| `/admin/invoices/[id]/credit-note` | Generate a credit note (return/refund). |
| `/admin/tax/rates` | List/create/edit `taxRates`. |
| `/admin/tax/hsn` | HSN code library editor + import. |
| `/admin/orders/[id]` (extended) | Generate-invoice button (manual fallback). |

API routes:
- `POST /api/admin/invoices` (auto-called by shipment flow + manual)
- `GET /api/admin/invoices?filters=…`
- `GET /api/admin/invoices/[id]/pdf` — streams PDF
- `POST /api/admin/invoices/[id]/cancel`
- `POST /api/admin/invoices/[id]/credit-note`

Background jobs:
- `invoice_pdf` job: render with `@react-pdf/renderer`, upload to MinIO, store URL on invoice row.
- `einvoice_irn` job (Phase 7.5, optional): post invoice to 3rd-party gateway, store IRN + QR.

Numbering:
- `INV-FY-NNNNN` where FY = `YY-YY` (e.g. `26-27` for April 2026 – March 2027).
- Counter per FY in `systemSettings` with `SELECT FOR UPDATE` to avoid duplicates.

**Done when:**
- A delivered order automatically has an invoice with correct GST breakdown.
- The PDF downloads cleanly and shows: company GSTIN, customer details, HSN per line, CGST/SGST or IGST per line, grand total in words.
- A credit note for a partial return shows negative amounts referencing the original invoice.
- The 50 unit-test pincode → tax-template cases all pass.

**Rollback:** disable auto-invoice generation; orders complete without invoices for the rollback window.

> **Decision deferred to Phase 7.5:** which 3rd-party e-invoicing gateway. Candidates: ClearTax, Cygnet (DigiTax), Masters India. Pick based on pricing for our IRN volume + India Compliance app interop.

---

### Phase 8 — Discount Rules & Coupons (1.5 weeks)

**Goal:** Replace the existing simple `coupons` table with a flexible discount engine.

**Deliverables:**

UI pages:
| Page | What it does |
|---|---|
| `/admin/discounts` | List rules, filter by type, active/expired. |
| `/admin/discounts/new` | Builder: type, scope, validity, usage limits. |
| `/admin/discounts/[id]` | Detail + usage analytics chart. |

API routes:
- `POST/PATCH/DELETE /api/admin/discount-rules`
- `POST /api/cart/apply-coupon` (parent-facing)
- `POST /api/cart/remove-coupon`

Engine: `lib/discounts.ts`
- `evaluate(cart, customer, rules)` — returns ordered list of applied discounts, total saved.
- Auto-apply rules (no code) evaluated server-side every cart-read.
- Code rules require explicit apply.
- `isStackable` flag controls combinability.
- Per-customer usage check via `discountUsages`.

Migration: existing `coupons` table data is moved to `discountRules` with `type='percent'` or `type='flat'`. Old endpoints redirect.

**Done when:** a parent can apply a "10% off uniforms for SAS BP" code, see the discount line in the cart, and the order total reflects it after checkout.
**Rollback:** revert engine; keep old `coupons` table active.

---

### Phase 9 — Bundle Products (2 weeks)

**Goal:** Support fixed and configurable bundles. Render the Books Bundle PDP from the audit.

**Deliverables:**

UI (admin):
| Page | What it does |
|---|---|
| `/admin/catalog/bundles` | List bundles. |
| `/admin/catalog/bundles/new` | Create bundle: pick base product, type, pricing mode. |
| `/admin/catalog/bundles/[id]` | Manage components + selectors. |
| `/admin/catalog/bundles/[id]/configs` | Per-school per-grade activation. |

UI (parent):
- Bundle PDP redesign at `/shop/[slug]` (when product has `productBundles` row): renders selector groups dynamically; price recomputes as parent picks options; cart line records the bundle config.

API routes:
- `POST/PATCH/DELETE /api/admin/bundles`
- `POST/PATCH /api/admin/bundles/[id]/components`
- `POST/PATCH /api/admin/bundles/[id]/selectors`
- `POST /api/admin/bundles/[id]/configs` (school/grade activation)
- `POST /api/cart` extended to accept `bundleSelections: {[groupKey]: variantId | variantId[]}`

Logic:
- Bundle in cart stores selected component variants in cart line metadata.
- At order time, expand into multiple `orderItems` (one per component) so stock + invoicing work per-line.
- The bundle's parent product row holds the human-readable bundle title; line items reference the components.
- Pricing: `pricingMode='sum'` adds component prices; `pricingMode='fixed'` uses bundle price directly (allocate to components proportionally for invoice line breakdown).

**Done when:** a parent can buy "CAS LR Grade 6 Bookkit" picking "Hindi 2nd Lan", and the order shows all 12 component books with stock decremented per book and the invoice listing each book separately.
**Rollback:** disable bundle PDP rendering; bundle products show as plain "out of stock" until re-enabled.

---

### Phase 10 — Returns & RMA (1 week)

**Goal:** Customer-initiated returns with admin approval; refund tracking.

**Deliverables:**

UI (parent):
- "Request return" button on delivered orders (within return window, e.g. 7 days).
- Return form: pick items + qty + reason + condition.
- Returns list page: status of each request.

UI (admin):
| Page | What it does |
|---|---|
| `/admin/returns` | List with filters. |
| `/admin/returns/[id]` | Approve/reject; on receipt, record condition; trigger refund. |

API routes:
- `POST /api/returns` (parent-facing)
- `GET /api/returns` (parent-facing)
- `POST /api/admin/returns/[id]/approve`
- `POST /api/admin/returns/[id]/receive` (writes `stockLedger` `reason='return_in'`)
- `POST /api/admin/returns/[id]/refund` (creates a credit-note invoice; triggers payment refund)

Logic:
- Approved + received → stock back to `actualQty` (only if condition='unopened').
- Refund → background job calls payment gateway refund API.
- Credit note auto-created at refund time linking to original invoice.

**Done when:** a parent requests a return for 1 of 3 items; admin approves; warehouse marks "received" with condition; refund processes; credit note PDF available.
**Rollback:** disable parent-facing return UI; existing returns continue manually.

---

### Phase 11 — Reports & Dashboards (1 week)

**Goal:** Useful operational reports for ops and management.

**Deliverables:**

UI pages:
| Page | What it does |
|---|---|
| `/admin/reports/sales` | Sales by school × category × period; CSV export. |
| ~~`/admin/reports/stock`~~ | Removed 2026-09-15 — stock lives in the audit ERP, local bins were empty. |
| `/admin/reports/customers` | LTV distribution; top 100; new vs returning. |
| `/admin/reports/gst` | GST-summary report (for accountant): in-state vs out-state vs nil-rated sums. |
| `/admin/reports/fulfillment` | Cycle time, status distribution, late shipments. |
| `/admin/reports/refunds` | Refund volume + reasons. |
| `/admin/dashboard` (replace existing) | KPIs for today/this-week/this-month. |

Implementation:
- Heavy queries are pre-aggregated nightly into `reportSnapshots` table (date + dimensions + metrics) for fast UI.
- Live drill-downs hit raw tables.

**Done when:** the GST-summary report for last month matches what the accountant computed manually within 1 rupee.

---

### Phase 12 — Data Migration from ERPNext + Cutover (2 weeks)

**Goal:** Bulk-import items, customers, and historical orders from ERPNext into Inventre. Set up a one-way export job. Cut over.

**Deliverables:**

Bulk import scripts (`scripts/migrate-from-erp/`):
- `01-attributes.ts` → seeds `productAttributes` + `productAttributeValues` from the audit's attribute lists.
- `02-schools.ts` → upserts `schools` from `Item.custom_school_name` + audit's prefix table.
- `03-items.ts` → fetches every `tabItem` (parents) from ERP, creates `products` rows + `productAttributeBindings`. ~6,035 rows.
- `04-variants.ts` → fetches every variant `tabItem`, creates `productVariants` + `productVariantAttributes`. Uses ERP's `attributes` child table as canonical source; falls back to variant-code parser only when child table empty.
- `05-prices.ts` → `tabItem Price` → `itemPrices`. ~6,000 rows.
- `06-stock.ts` → `tabBin` → `bins` + initial `stockLedger` snapshot. ~6,000 rows.
- `07-customers.ts` → `tabCustomer` → `parents`. ~15,614 rows. Phone-based dedup with existing parents.
- `08-addresses.ts` → `tabAddress` → `addresses`. Linked via Dynamic Link.
- `09-orders.ts` → `tabSales Order` (only `order_type='Shopping Cart'`, only `docstatus=1`) → `orders` + `orderItems`. Marks them `status='migrated'`. ~23,436 rows.
- `10-invoices.ts` → `tabSales Invoice` → `invoices` + `invoiceItems`. Read-only archive; no PDF regen.
- All scripts paginate (100/page) with rate limiting (250ms between batches), idempotent, resumable via a checkpoint table.

Verification:
- `scripts/migrate-from-erp/verify.ts` runs counts and totals comparison; produces a CSV diff report.

One-way export job (Phase 12 deliverable for the long-term ERP-as-accounting setup):
- `scripts/export-to-erp.ts` runs nightly: pulls Inventre orders/invoices/payments from the last 24 hours, posts them to ERP as Sales Orders + Sales Invoices for accounting.

Cutover:
1. Freeze writes on production for 30 minutes (maintenance banner).
2. Run all 10 migration scripts in order.
3. Run `verify.ts`; abort if diff > 0.1%.
4. Switch DNS / feature flag `CHECKOUT_BACKEND=inventre`.
5. Unfreeze.
6. Watch error rates for 2 hours.

Decommission of old code paths (one week post-cut):
- Drop `productVariants.size`, `productVariants.price`, `productVariants.stockQty` (replaced by attributes/itemPrices/bins).
- Drop the now-unused `coupons` table (replaced by `discountRules`).
- Remove `lib/razorpay.ts` (already replaced — payment lib is now `lib/payments/` with multiple providers, but Razorpay stays as one of them; we remove only if you confirm CCAvenue is the only gateway you want).

**Done when:**
- Inventre Postgres holds 6,035 items, 15,614 customers, 23,436 historical orders.
- Verify report shows 100% match on customer counts, item counts, and order count.
- Nightly export-to-ERP job runs cleanly for 7 days.
**Rollback:** Phase 12 is the riskiest. Rollback is non-trivial because the data has been migrated. Mitigation: take a Postgres snapshot immediately before migration; if cutover fails, restore the snapshot, flip DNS back, and figure out what went wrong.

---

## 5. Schema-Migration Strategy (Phase-by-Phase)

| Phase | Migration nature | Reversible? |
|---|---|---|
| 0 | None | yes |
| 1 | Additive only (new tables, new columns nullable) | yes |
| 2 | Additive (new admin code paths) | yes |
| 3 | App reads new tables; old columns still present | yes |
| 4 | Additive | yes |
| 5 | Logic change in stock reservation; uses new ledger | yes (revert app code) |
| 6 | Adds shipments path | yes |
| 7 | Adds invoicing path | yes |
| 8 | Migrates `coupons` data into `discountRules` | yes (keep old data) |
| 9 | Adds bundle path | yes |
| 10 | Adds returns path | yes |
| 11 | Reports only | yes |
| 12 | Bulk-imports from ERP + drops old columns | **risky** (snapshot required) |

The principle: every phase is reversible except Phase 12. Phase 12 is gated by snapshot + verify.

---

## 6. Admin Panel Final State

The new admin (post-cut) replaces the existing 17 simple-CRUD pages with this structure:

```
/admin
├── dashboard                        (KPIs)
├── orders/
│   ├── (list)
│   ├── new                          (manual phone order)
│   ├── [id]
│   └── [id]/edit
├── shipments/
│   ├── (list)
│   ├── new
│   └── [id]
├── invoices/
│   ├── (list)
│   ├── [id]
│   └── [id]/credit-note
├── returns/
│   ├── (list)
│   └── [id]
├── customers/
│   ├── (list / search)
│   ├── [id]
│   └── import
├── catalog/
│   ├── attributes/
│   │   ├── (list)
│   │   └── [id]
│   ├── items/
│   │   ├── (list — tree by school × category)
│   │   ├── new
│   │   ├── [id]                     (overview)
│   │   ├── [id]/variants
│   │   ├── [id]/images
│   │   └── [id]/schools             (per-school activation/override)
│   ├── price-lists
│   ├── pricing                      (grid editor)
│   ├── warehouses
│   ├── stock                        (live bin view)
│   ├── stock/adjust
│   └── bundles/
│       ├── (list)
│       ├── new
│       └── [id]
├── tax/
│   ├── rates
│   └── hsn
├── discounts/
│   ├── (list)
│   ├── new
│   └── [id]
├── schools/
│   ├── (list)
│   ├── [id]                         (branding + ERP-prefix + house colors + grades + bundle configs)
│   └── new
├── students/
│   ├── (list)
│   └── import
├── content/                         (UNCHANGED — banners, FAQs, testimonials)
├── reviews/                         (UNCHANGED)
├── reports/
│   ├── sales
│   ├── stock
│   ├── customers
│   ├── gst
│   ├── fulfillment
│   └── refunds
└── settings/
    ├── users                        (RBAC)
    ├── company                      (GSTIN, address, logo, financial year start)
    ├── tax                          (default rates, defaults)
    ├── shipping                     (carriers, default tracking URL templates)
    ├── notifications                (SMS templates, email templates)
    ├── integrations                 (payment gateways, e-invoicing gateway, ERP export schedule)
    └── audit                        (audit log viewer)
```

---

## 7. Risk Register

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| 1 | Schema overhaul takes longer than estimated | high | medium | Phase 1 is additive only; we never block other work on it. Migration shims keep old code running until each call site is updated. |
| 2 | GST computation error → invoice issued with wrong tax | medium | very high | Pure-function tax engine, 50+ unit tests against pincode/HSN combinations, accountant signs off the first 50 production invoices. |
| 3 | E-invoicing IRN integration overruns | medium | medium | Deferred to Phase 7.5; v1 ships invoices without IRN; e-invoicing turned on once gateway is contracted. |
| 4 | PDF rendering quality (alignment, fonts) | medium | low | `@react-pdf/renderer` for predictable layout; print-test 5 invoices before going live. |
| 5 | Variant-code parser misclassifies a code during ERP import | medium | medium | Always prefer ERP's `Item Variant Attribute` over the parser; per-school color maps editable post-import. |
| 6 | Stock race during peak (last item, two parents) | medium | medium | Postgres `SELECT FOR UPDATE` on the bin row inside the order-confirm transaction. |
| 7 | Bulk migration from ERP fails part-way | medium | high | Idempotent + resumable scripts with checkpoint table; pre-migration snapshot. |
| 8 | Books Bundle PDP UX is too ambitious | high | medium | Phase 9 is independent of cutover; bundles can be hidden until UX is right. |
| 9 | Discounts engine has edge cases (stacking, exclusions) | medium | medium | Unit-test the engine first; UI exposes only `isStackable=false` rules in v1. |
| 10 | Return + refund window is unclear | medium | medium | Configurable in `systemSettings` (default 7 days delivered); admin can override per order. |
| 11 | Old data in DB has FK references to dropped columns | low | high | Drop columns only in Phase 12 after confirming zero reads. Run `pg_stat_user_tables` to confirm. |
| 12 | Loss of accountant continuity (no GL in Inventre) | high | high | Phase 12 includes ERP one-way export; accountant continues using ERP for GL/P&L/balance sheet. |

---

## 8. Test Plan

### 8.1 Unit tests (mostly new)
- `lib/tax.test.ts` — 50+ pincode × HSN × treatment combinations.
- `lib/discounts.test.ts` — stacking, exclusions, usage-limit, validity.
- `lib/stock.test.ts` — reserve, release, ship, return scenarios with race-condition tests.
- `lib/invoice-numbering.test.ts` — financial-year boundary cases.
- `lib/bundles.test.ts` — selection validation, price computation.
- `lib/migrate/variant-parser.test.ts` — 30 codes from audit §2.4.

### 8.2 Integration tests
- `scripts/e2e.ts` — extend the current 127-test suite phase by phase.
  - Phase 2: variant grid editor flow.
  - Phase 3: stock reservation flow.
  - Phase 5: manual phone order flow.
  - Phase 6: partial shipment flow.
  - Phase 7: auto-invoice + PDF generation flow.
  - Phase 8: coupon flow.
  - Phase 9: bundle purchase flow.
  - Phase 10: return flow.
- Target: 250+ tests at the end of Phase 12.

### 8.3 Migration tests
- `scripts/migrate-from-erp/test.ts` — runs against staging ERP, populates a throwaway Inventre DB, runs `verify.ts`, asserts 100% match for the first 100 records of each DocType.

### 8.4 Load tests
- k6 scenario: 20K concurrent catalog browsers — cache hit rate >95%.
- k6 scenario: 500 concurrent checkouts — p95 < 1s for cart-validate, p95 < 2s for order-create.

### 8.5 Acceptance tests (manual, with stakeholders)
- Accountant verifies first 50 production invoices.
- Operations manager verifies stock counts after migration match physical inventory.
- 3 parents test the new PDP for bundles (Books Bundle is the hardest).

---

## 9. Environment & Secrets

New `.env` entries (none for ERP API — Option B doesn't connect to ERP at runtime):

```
# CCAvenue (replaces Razorpay if confirmed; both can coexist)
CCAVENUE_MERCHANT_ID=•••
CCAVENUE_ACCESS_CODE=•••
CCAVENUE_WORKING_KEY=•••
CCAVENUE_REDIRECT_URL=https://inventre.in/api/checkout/verify
CCAVENUE_CANCEL_URL=https://inventre.in/shop/checkout?cancelled=1

# Razorpay (if kept as alternate gateway)
# (existing values, unchanged)

# Company (for invoices)
COMPANY_LEGAL_NAME=Inventre Edu Services Pvt Ltd
COMPANY_GSTIN=36AAMCP1199C1ZA
COMPANY_PAN=AAMCP1199C
COMPANY_STATE_CODE=36
COMPANY_REGISTERED_ADDRESS_JSON='{"line1":"24th Floor, One West","line2":"Nanakramguda","city":"Hyderabad","state":"Telangana","pincode":"500032"}'
FINANCIAL_YEAR_START_MONTH=4

# E-invoicing (Phase 7.5; pluggable)
EINVOICE_PROVIDER=clear|cygnet|masters_india|none
EINVOICE_API_BASE=…
EINVOICE_USERNAME=…
EINVOICE_PASSWORD=…
EINVOICE_GSTIN=36AAMCP1199C1ZA

# Optional one-way export to ERPNext (B-ii)
ERP_EXPORT_ENABLED=true
ERP_EXPORT_BASE_URL=https://erp.inventre.in
ERP_EXPORT_API_KEY=•••
ERP_EXPORT_API_SECRET=•••
ERP_EXPORT_SCHEDULE_CRON=0 2 * * *
```

---

## 10. Rough Timeline & Team Sizing

| Phase | Solo (weeks) | 2 engineers | 3 engineers + QA |
|---|---|---|---|
| 0 — Safety net | 0.2 | 0.2 | 0.2 |
| 1 — Schema foundation | 1.5 | 1.0 | 0.7 |
| 2 — Item/variant admin | 2.0 | 1.2 | 0.8 |
| 3 — Pricing & stock | 1.5 | 1.0 | 0.7 |
| 4 — Customer/address | 1.0 | 0.6 | 0.4 |
| 5 — Order management | 2.0 | 1.2 | 0.8 |
| 6 — Shipments | 1.5 | 1.0 | 0.7 |
| 7 — Invoicing & GST | 3.0 | 2.0 | 1.5 |
| 8 — Discounts | 1.5 | 1.0 | 0.7 |
| 9 — Bundles | 2.0 | 1.5 | 1.0 |
| 10 — Returns | 1.0 | 0.7 | 0.5 |
| 11 — Reports | 1.0 | 0.7 | 0.5 |
| 12 — Migration & cutover | 2.0 | 1.5 | 1.0 |
| **Total** | **~20 weeks** | **~13 weeks** | **~9 weeks** |

Realistic with a single engineer: **5 months**. With a small team: **3 months**. With 3 engineers + QA: **2 months**.

The hardest single phase is **Phase 7 (Invoicing & GST)** because it crosses legal compliance, PDF generation, and a deferred 3rd-party integration. Plan for slippage there.

---

## 11. Decisions Locked In

1. Inventre Postgres is canonical for all e-commerce domains.
2. ERPNext is retained for accounting (B-ii) — one-way export from Inventre.
3. Schema is overhauled (~15 new tables, ~6 modified) with additive migrations until Phase 12.
4. Currency is paise across the stack; rounding is per-invoice.
5. Order numbering stays `INV-YYYY-NNNN` (existing).
6. Invoice numbering is new: `INV-FY-NNNNN` (financial-year-aware).
7. Tax engine is a pure function in `lib/tax.ts`; unit-tested.
8. PDF generator is `@react-pdf/renderer` (revisitable in Phase 7).
9. E-invoicing IRN is deferred to Phase 7.5 with a 3rd-party gateway; v1 ships invoices without IRN.
10. Background jobs use `bullmq` over the existing Redis (no new dependency).
11. Stock writes use Postgres `SELECT FOR UPDATE`; no Redis-only stock state.
12. Search uses `pg_trgm` (extension) — no Elasticsearch in v1.
13. The 12 schools in the audit are the active set; additions go through admin UI.
14. Books Bundle UX is the most ambitious parent-side feature; it ships in Phase 9 and may be hidden until polished.

---

## 12. Locked Decisions (resolved 2026-05-02)

These were the 10 open questions; all are now answered with defaults accepted by the business owner.

| # | Topic | Locked decision |
|---|---|---|
| 1 | Payment gateway | **CCAvenue** is the production gateway. Razorpay code path is removed during Phase 5 cutover. |
| 2 | ERPNext post-cutover role | **B-ii** — ERPNext retained for accounting (GL, P&L, balance sheet, GST returns). Inventre exports to it nightly. No runtime read from ERP. |
| 3 | E-invoicing (IRN) | **Deferred to Phase 7.5.** v1 ships invoices without IRN. Pluggable 3rd-party gateway (ClearTax / Cygnet / Masters India) added afterwards. |
| 4 | Company tax IDs | GSTIN `36AAMCP1199C1ZA`. PAN `AAMCP1199C` (derived from GSTIN). Single-state registration (Telangana). |
| 5 | Multi-company invoicing | **IESPL only.** Manufacturing entity "M" is out of scope. |
| 6 | Return window | **7 days** post-delivery default. Per-category overrides stored in `systemSettings.returnPolicy`. |
| 7 | Refund SLA | **5–7 business days.** Used in parent-facing UX copy and SMS templates. |
| 8 | Carriers (preset) | **Delhivery · Bluedart · DTDC** preconfigured with tracking-URL templates. Admins can add more in `/admin/settings/shipping`. |
| 9 | Migration timing | **No financial-year alignment required.** Cutover can happen any time; pre-migration Postgres snapshot is the safety net. |
| 10 | Reports parity | Baseline: **Sales by school × period · GST summary (GSTR-1-style) · Stock valuation.** Additional reports added on request after Phase 11. |

---

## 13. What This Plan Deliberately Does NOT Cover

- Accounting (general ledger, journal entries, balance sheet, P&L). **Stays in ERPNext.**
- Manufacturing module / BOM / production planning.
- HR / payroll / leaves / attendance.
- Fixed assets / depreciation.
- Direct government e-invoicing API (only via 3rd-party gateway).
- Multi-company invoicing (we ship as IESPL only).
- Multi-currency.
- Mobile app — separate track.
- POS / walk-in counter (the audit lists POS items but the POS UI is not in scope).
- B2B portal for school admins to bulk-order — separate track.

---

## 14. Pre-Phase-1 Action Items (you decide; I execute)

1. **Approve this plan.** Sign-off on scope (§1) and decisions (§11).
2. **Answer the 10 open questions** in §12 (or accept the recommended defaults).
3. **Confirm Phase 0 commit policy.** OK for me to commit the current uncommitted state and tag `v1.0-pre-overhaul`?
4. **Choose team size.** Affects realistic timeline.
5. **Confirm rollback comfort.** This plan has 12 reversible phases until Phase 12; at any point before then, rolling back is `git reset --hard v1.0-pre-overhaul` + dropping the new tables. Are you OK with that contract?

Once those five items are answered, I begin Phase 0 (commit + tag) and proceed to Phase 1 (schema additions).

---

*End of Option B master plan.*
