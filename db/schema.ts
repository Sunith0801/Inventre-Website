import {
  pgTable,
  uuid,
  text,
  varchar,
  bigint,
  integer,
  bigserial,
  boolean,
  timestamp,
  date,
  jsonb,
  pgEnum,
  index,
  uniqueIndex,
  primaryKey,
  numeric,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

// ════════════════════════════════ ENUMS ═════════════════════════════
//
// Pre-existing enums (kept as-is for backwards compatibility):

export const userRoleEnum = pgEnum("user_role", ["super", "ops", "school_admin"]);
export const accountStatusEnum = pgEnum("account_status", [
  "active",
  "blocked",
  "pending",
]);
export const schoolStatusEnum = pgEnum("school_status", [
  "active",
  "onboarding",
  "paused",
]);
export const productStatusEnum = pgEnum("product_status", [
  "draft",
  "active",
  "archived",
]);
export const orderStatusEnum = pgEnum("order_status", [
  "placed",
  "confirmed",
  "packed",
  "shipped",
  "delivered",
  "returned",
  "cancelled",
]);
export const paymentStatusEnum = pgEnum("payment_status", [
  "pending",
  "paid",
  "failed",
  "refunded",
]);
export const reviewStatusEnum = pgEnum("review_status", [
  "pending",
  "approved",
  "rejected",
]);
export const returnStatusEnum = pgEnum("return_status", [
  "requested",
  "approved",
  "received",
  "refunded",
  "rejected",
]);
export const badgeEnum = pgEnum("product_badge", [
  "NEW",
  "BESTSELLER",
  "LOW_STOCK",
]);

// ─── Phase 1 (Option B) — new enums ─────────────────────────────────

export const attributeTypeEnum = pgEnum("attribute_type", [
  "size",
  "color",
  "design",
  "model",
  "other",
]);
export const priceListAppliesToEnum = pgEnum("price_list_applies_to", [
  "selling",
  "buying",
  "both",
]);
export const stockLedgerReasonEnum = pgEnum("stock_ledger_reason", [
  "order_reserve",
  "order_release",
  "shipment_out",
  "receipt",
  "adjustment",
  "return_in",
]);
export const gstTreatmentEnum = pgEnum("gst_treatment", [
  "taxable",
  "nil_rated",
  "exempt",
  "non_gst",
  "zero_rated",
]);
export const addressTypeEnum = pgEnum("address_type", [
  "billing",
  "shipping",
  "both",
]);
export const shipmentStatusEnum = pgEnum("shipment_status", [
  "draft",
  "packed",
  "shipped",
  "out_for_delivery",
  "delivered",
  "returned",
  "cancelled",
]);
export const invoiceStatusEnum = pgEnum("invoice_status", [
  "draft",
  "submitted",
  "paid",
  "partially_paid",
  "overdue",
  "cancelled",
]);
export const einvoiceStatusEnum = pgEnum("einvoice_status", [
  "not_applicable",
  "pending",
  "generated",
  "cancelled",
  "failed",
]);
export const discountTypeEnum = pgEnum("discount_type", [
  "percent",
  "flat",
  "bulk",
  "bxgy",
  "free_shipping",
]);
// Mirrors `Website Cart Coupon.discount_type` on ERPNext.
export const websiteCartCouponDiscountTypeEnum = pgEnum(
  "website_cart_coupon_discount_type",
  ["Fixed", "Percentage"],
);
export const discountAppliesToEnum = pgEnum("discount_applies_to", [
  "all",
  "school",
  "category",
  "product",
  "variant",
]);
export const bundleTypeEnum = pgEnum("bundle_type", ["fixed", "configurable"]);
/**
 * Position of a product in the BOM hierarchy (derived from item-code/name).
 *   magic_box   - root bundle bought by new students (mandatory, gender+grade scoped)
 *   bookkit     - school+grade Bookkit (intermediate; not shown standalone in shop)
 *   sub_bundle  - "Bundle N Textbook/Notebook/Stationery/..." (intermediate)
 *   leaf        - individual purchasable item (book, uniform piece, stationery)
 */
export const bundleLevelEnum = pgEnum("bundle_level", [
  "magic_box",
  "bookkit",
  "sub_bundle",
  "leaf",
]);
/**
 * Catalog-role taxonomy populated at create time (admin form / wizard) and
 * at ERPNext import time (scripts/classify-products.ts). The storefront
 * filters on this column: new students see only `magic_box`; returning
 * students see kinds outside `{magic_box, book, sub_bundle}`. Exposed on
 * the products table below so we can SET it via drizzle insert/update.
 */
export const productKindEnum = pgEnum("product_kind", [
  "magic_box",
  "kit",
  "sub_bundle",
  "uniform",
  "accessory",
  "book",
  "consumable",
  "excluded",
]);
export const bundlePricingModeEnum = pgEnum("bundle_pricing_mode", [
  "sum",
  "fixed",
]);
export const selectorTypeEnum = pgEnum("selector_type", ["one_of", "multi"]);
export const returnConditionEnum = pgEnum("return_condition", [
  "unopened",
  "opened",
  "damaged",
]);
export const refundMethodEnum = pgEnum("refund_method", [
  "original",
  "wallet",
  "bank",
]);
export const backgroundJobStatusEnum = pgEnum("background_job_status", [
  "queued",
  "running",
  "completed",
  "failed",
  "dead",
]);

// ════════════════════════════════ IDENTITY ══════════════════════════

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: userRoleEnum("role").notNull(),
    /** RBAC role row. Populated by db/migrations/0044_admin_rbac.sql.
     *  Nullable for backward compatibility with the legacy enum. */
    roleId: uuid("role_id"),
    schoolId: uuid("school_id"),
    name: text("name"),
    status: accountStatusEnum("status").notNull().default("active"),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    emailIdx: uniqueIndex("users_email_idx").on(t.email),
    schoolIdx: index("users_school_idx").on(t.schoolId),
  })
);

/**
 * Per-user permission overrides on top of the user's role baseline.
 * Created by migration 0046_rbac_read_write_split.sql.
 *
 *   granted=true   add a permission the role doesn't have
 *   granted=false  revoke a permission the role does have
 *
 * Effective permission set = (role perms ∪ user grants) \ user revokes.
 */
export const adminUserPermissions = pgTable(
  "admin_user_permissions",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    permission: text("permission").notNull(),
    granted: boolean("granted").notNull().default(true),
    grantedBy: uuid("granted_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.permission] }),
    userIdx: index("admin_user_permissions_user_idx").on(t.userId),
  })
);

export const parents = pgTable(
  "parents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    phone: varchar("phone", { length: 15 }).notNull(),
    name: text("name"),
    email: text("email"),
    passwordHash: text("password_hash"),
    status: accountStatusEnum("status").notNull().default("active"),
    // ─── Phase 1 additions ────────────────────────────────────────
    customerGroup: text("customer_group").notNull().default("student"),
    tags: text("tags").array(),
    notes: text("notes"),
    totalLifetimeValue: integer("total_lifetime_value").notNull().default(0), // paise
    totalOrderCount: integer("total_order_count").notNull().default(0),
    lastOrderAt: timestamp("last_order_at", { withTimezone: true }),
    // ─── Gap-fix additions ────────────────────────────────────────
    customerCode: text("customer_code"), // CUST-2026-NNNNN (audit §3.2 naming_series)
    gstCategory: text("gst_category").notNull().default("Unregistered"), // 'Unregistered' | 'Registered'
    isFrozen: boolean("is_frozen").notNull().default(false), // separate from blocked status
    language: text("language").notNull().default("en"),
    // Must verify OTP + set own password before first sign-in. Migration 0013.
    firstTimeLogin: boolean("first_time_login").notNull().default(true),
    // Bumped on every successful login OTP verification. Used by
    // /admin/students "Last login" column. Backfilled from otp_logs.
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    // Last accepted T&C version + timestamp. Captured at the end of the
    // first-time login flow; NULL for parents that pre-date migration 0026.
    tcAcceptedAt: timestamp("tc_accepted_at", { withTimezone: true }),
    tcAcceptedVersion: text("tc_accepted_version"),
    // ──────────────────────────────────────────────────────────────
    // ──────────────────────────────────────────────────────────────
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    phoneIdx: uniqueIndex("parents_phone_idx").on(t.phone),
    emailIdx: index("parents_email_idx").on(t.email),
  })
);

export const students = pgTable(
  "students",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    // Nullable since ERP students may not have a registered parent yet.
    parentId: uuid("parent_id").references(() => parents.id, { onDelete: "cascade" }),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id),
    name: text("name").notNull(),
    class: text("class"),
    section: text("section"),
    enrollmentNumber: text("enrollment_number"),
    sizeOverrides: jsonb("size_overrides"),
    avatarUrl: text("avatar_url"),
    status: accountStatusEnum("status").notNull().default("active"),
    // ─── ERP-rich fields (merged from former erp_students) ────────
    enabled: boolean("enabled").notNull().default(true),
    // Set by the site-wide closure switch on the rows IT disabled, so
    // re-opening restores exactly those and leaves individually-disabled
    // students alone. See lib/site-access.ts.
    disabledByClosure: boolean("disabled_by_closure").notNull().default(false),
    isNewStudent: boolean("is_new_student").notNull().default(false),
    isVerified: boolean("is_verified").notNull().default(false),
    // Stamped when is_verified flips true. Backfilled best-effort from
    // the parent's earliest 'verified' OTP log, falling back to created_at.
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    schoolCode: text("school_code"),
    firstName: text("first_name"),
    middleName: text("middle_name"),
    lastName: text("last_name"),
    grade: text("grade"),
    joiningDate: text("joining_date"),
    houseColor: text("house_color"),
    medium: text("medium"),
    curriculum: text("curriculum"),
    shoeSize: text("shoe_size"),
    shirtSize: text("shirt_size"),
    trouserSize: text("trouser_size"),
    profilePictureUrl: text("profile_picture_url"),
    studentEmailId: text("student_email_id"),
    studentMobileNumber: text("student_mobile_number"),
    dateOfBirth: text("date_of_birth"),
    bloodGroup: text("blood_group"),
    gender: text("gender"),
    nationality: text("nationality"),
    customerLink: text("customer_link"),
    customerGroup: text("customer_group"),
    erpName: text("erp_name"),
    erpRaw: jsonb("erp_raw"),
    erpModified: timestamp("erp_modified", { withTimezone: true }),
    syncedAt: timestamp("synced_at", { withTimezone: true }),
    // ──────────────────────────────────────────────────────────────
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    parentIdx: index("students_parent_idx").on(t.parentId),
    schoolIdx: index("students_school_idx").on(t.schoolId, t.status),
    erpNameIdx: uniqueIndex("students_erp_name_idx").on(t.erpName),
    schoolCodeIdx: index("students_school_code_idx").on(t.schoolCode),
    firstNameIdx: index("students_first_name_idx").on(t.firstName),
    gradeIdx: index("students_grade_idx").on(t.grade),
  })
);

// ════════════════════════════════ CATALOG ═══════════════════════════

export const schools = pgTable(
  "schools",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    logoUrl: text("logo_url"),
    bannerUrl: text("banner_url"),
    city: text("city"),
    state: text("state"),
    status: schoolStatusEnum("status").notNull().default("onboarding"),
    isFeatured: boolean("is_featured").notNull().default(false),
    /** Set by admin from /admin/catalog/setup to silence the "Needs work"
     *  status pill when remaining gaps are intentional. Parent-facing
     *  queries ignore this flag. */
    isSetupComplete: boolean("is_setup_complete").notNull().default(false),
    houseColors: jsonb("house_colors"), // legacy — kept for backwards compat
    contactEmail: text("contact_email"),
    contactPhone: text("contact_phone"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    // ─── Phase 1 additions ────────────────────────────────────────
    itemCodePrefixes: text("item_code_prefixes").array().notNull().default(sql`'{}'::text[]`),
    // DEPRECATED: read from `school_color_map` table instead. Kept for
    // backwards compatibility while seed/import paths are migrated.
    colorMap: jsonb("color_map").notNull().default(sql`'{}'::jsonb`),
    gradesServed: text("grades_served").array().notNull().default(sql`'{}'::text[]`),
    curriculum: text("curriculum").array().notNull().default(sql`'{}'::text[]`),
    // ─── ERP-rich fields (merged from former erp_schools) ─────────
    schoolCode: text("school_code"),
    /** Display name. Synced to `name` on write so storefront keeps working. */
    schoolName: text("school_name"),
    branchName: text("branch_name"),
    websiteUrl: text("website_url"),
    schoolLogoUrl: text("school_logo_url"),
    street: text("street"),
    country: text("country"),
    pincode: text("pincode"),
    uniformDetailsCheckbox: boolean("uniform_details_checkbox").notNull().default(false),
    booksDetailsCheckbox: boolean("books_details_checkbox").notNull().default(false),
    erpName: text("erp_name"),
    erpRaw: jsonb("erp_raw"),
    erpModified: timestamp("erp_modified", { withTimezone: true }),
    syncedAt: timestamp("synced_at", { withTimezone: true }),
    // ──────────────────────────────────────────────────────────────
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    slugIdx: uniqueIndex("schools_slug_idx").on(t.slug),
    statusIdx: index("schools_status_idx").on(t.status),
    erpNameIdx: uniqueIndex("schools_erp_name_idx").on(t.erpName),
    schoolCodeIdx: index("schools_school_code_idx").on(t.schoolCode),
  })
);

export const categories = pgTable(
  "categories",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    parentId: uuid("parent_id"),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    path: text("path").notNull(),
  },
  (t) => ({
    slugIdx: uniqueIndex("categories_slug_idx").on(t.slug),
    parentIdx: index("categories_parent_idx").on(t.parentId),
    pathIdx: index("categories_path_idx").on(t.path),
  })
);

export const products = pgTable(
  "products",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    tagline: text("tagline"),
    description: jsonb("description"),
    categoryId: uuid("category_id").references(() => categories.id),
    basePrice: integer("base_price").notNull(),
    baseMrp: integer("base_mrp"),
    specs: jsonb("specs"),
    sizeTable: jsonb("size_table"),
    status: productStatusEnum("status").notNull().default("active"),
    // ─── Phase 1 additions ────────────────────────────────────────
    itemCode: text("item_code"), // e.g. "KLS Boys Shirt"
    hsnCode: text("hsn_code"), // e.g. "61012000"
    gstTreatment: gstTreatmentEnum("gst_treatment").notNull().default("taxable"),
    taxRateId: uuid("tax_rate_id"),
    sizeChartUrl: text("size_chart_url"),
    /** Free-text note shown directly under the product image on the PDP.
     *  Optional; edited in admin → product → Content tab. See migration 0068. */
    imageNote: text("image_note"),
    brand: text("brand"),
    weightGrams: integer("weight_grams"),
    dimensions: jsonb("dimensions"), // {l, w, h} cm
    minOrderQty: integer("min_order_qty").notNull().default(1),
    reorderTatDays: integer("reorder_tat_days"),
    costPrice: integer("cost_price"), // paise
    displayPrice: integer("display_price"), // paise
    // ─── Gap-fix additions (audit §2.3 pricing custom fields) ─────
    gstInclusive: boolean("gst_inclusive").notNull().default(true),
    categoryFixedMarginPercent: numeric("category_fixed_margin_percent", { precision: 5, scale: 2 }),
    customerDiscountPercent: numeric("customer_discount_percent", { precision: 5, scale: 2 }),
    organizationMarginPercent: numeric("organization_margin_percent", { precision: 5, scale: 2 }),
    suggestedOrgPrice: integer("suggested_org_price"), // paise
    agreedOrgPrice: integer("agreed_org_price"), // paise
    organizationMrp: integer("organization_mrp"), // paise
    isMagicBox: boolean("is_magic_box").notNull().default(false),
    /** Catalog-role taxonomy. Drives storefront visibility (see
     *  lib/repos/products.ts:listProductsForStudent). DB-side default
     *  `'book'` makes this safe to add to existing rows. */
    kind: productKindEnum("kind").notNull().default("book"),
    /** BOM hierarchy position — derived from name pattern at import time.
     *  null = not yet classified (legacy rows pre-BOM-import). */
    bundleLevel: bundleLevelEnum("bundle_level"),
    /** Gender scope for Magic Box variants (Boys/Girls). null = ungendered. */
    bundleGender: text("bundle_gender"),
    /** True when this products row is itself an ERPNext variant SKU
     *  (e.g. "WM JK Boys PantM22$$"). The shop only displays templates;
     *  variants exist for cart/checkout via product_variants. */
    isVariantItem: boolean("is_variant_item").notNull().default(false),
    /** When this row is a variant (is_variant_item=true), points at the
     *  template product. Lets the PDP fetch sibling variants for a picker. */
    variantOfProductId: uuid("variant_of_product_id"),
    /** Multi-attribute picker groups for the PDP, e.g.
     *  [{ name: "Uniform Colors", values: ["Red","Blue"] },
     *   { name: "Shirt Size", values: ["28","30",...] }]
     */
    attributeGroups: jsonb("attribute_groups"),
    /** Variant selector metadata (e.g. Bookkit Hindi vs Kannada selector
     *  group + label). Added in migration 0009. */
    variantAttribute: text("variant_attribute"),
    variantAttributeValue: text("variant_attribute_value"),
    /** Item.csv `Country of Origin` */
    countryOfOrigin: text("country_of_origin"),
    /** Item.csv `Customs Tariff Number` */
    customsTariffNumber: text("customs_tariff_number"),
    // QR code (audit §2.3)
    qrCodeData: jsonb("qr_code_data"), // {type, item_code, item_name, weight, cbm, checksum}
    qrCodeSvg: text("qr_code_svg"),
    weightPerUnit: numeric("weight_per_unit", { precision: 10, scale: 3 }), // alias for weightGrams in kg
    // ─── ERP item-feed fields (audit.inventre.online/api/items/export) ───
    erpName: text("erp_name"), // unique product key from feed (`erp_name`)
    erpRaw: jsonb("erp_raw"), // entire ERPNext doc — escape hatch
    erpSubCategory: text("erp_sub_category"), // feed `custom_sub_category`
    erpUom: text("erp_uom"), // feed `stock_uom`
    isStockItem: boolean("is_stock_item").notNull().default(true),
    // ERP feed flags — informational only.
    erpIsDisabled: boolean("erp_is_disabled").notNull().default(false),
    erpIsDeleted: boolean("erp_is_deleted").notNull().default(false),
    lastErpSyncAt: timestamp("last_erp_sync_at", { withTimezone: true }),
    // ──────────────────────────────────────────────────────────────
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    slugIdx: uniqueIndex("products_slug_idx").on(t.slug),
    categoryIdx: index("products_category_idx").on(t.categoryId),
    statusIdx: index("products_status_idx").on(t.status),
    itemCodeIdx: uniqueIndex("products_item_code_idx").on(t.itemCode),
    hsnIdx: index("products_hsn_idx").on(t.hsnCode),
    erpNameIdx: uniqueIndex("products_erp_name_idx").on(t.erpName),
  })
);

// ─── Gap-fix NEW: Product → Grades (audit §2.3 custom_uniform_grade[]) ───
export const productGrades = pgTable(
  "product_grades",
  {
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    grade: text("grade").notNull(), // "Grade 1", "Grade 2", "UKG", "Grade 12", etc.
    isOrganization: boolean("is_organization").notNull().default(false),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.productId, t.grade] }),
    gradeIdx: index("product_grades_grade_idx").on(t.grade),
  })
);

// ─── Gap-fix NEW: Companies (audit §1; minimal — IESPL only for now) ───
export const companies = pgTable(
  "companies",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    abbr: text("abbr").notNull(),
    gstin: text("gstin"),
    pan: text("pan"),
    stateCode: text("state_code"),
    address: jsonb("address"),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    abbrIdx: uniqueIndex("companies_abbr_idx").on(t.abbr),
  })
);

export const productSchool = pgTable(
  "product_school",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    overridePrice: integer("override_price"),
    overrideMrp: integer("override_mrp"),
    isRequired: boolean("is_required").notNull().default(false),
    customImageUrl: text("custom_image_url"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    uq: uniqueIndex("product_school_uq").on(t.productId, t.schoolId),
    schoolIdx: index("product_school_school_idx").on(t.schoolId),
  })
);

export const productVariants = pgTable(
  "product_variants",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    size: text("size").notNull(), // legacy — Phase 2 migrates to productVariantAttributes
    sku: text("sku").notNull(),
    stockQty: integer("stock_qty").notNull().default(0), // legacy — Phase 3 migrates to bins
    lowStockThreshold: integer("low_stock_threshold").notNull().default(5),
    // ─── Phase 1 additions ────────────────────────────────────────
    barcode: text("barcode"),
    weightGrams: integer("weight_grams"),
    imageUrl: text("image_url"), // variant-specific image override
    isActive: boolean("is_active").notNull().default(true),
    // ─── ERP item-feed fields ─────────────────────────────────────
    erpName: text("erp_name"), // unique key for the variant (`erp_name`)
    variantOfErpName: text("variant_of_erp_name"), // parent template `erp_name`; resolved in pass 2
    // ──────────────────────────────────────────────────────────────
  },
  (t) => ({
    productIdx: index("variants_product_idx").on(t.productId),
    skuIdx: uniqueIndex("variants_sku_idx").on(t.sku),
    erpNameIdx: uniqueIndex("variants_erp_name_idx").on(t.erpName),
    variantOfErpIdx: index("variants_variant_of_erp_idx").on(t.variantOfErpName),
  })
);

export const productImages = pgTable(
  "product_images",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    alt: text("alt"),
    sortOrder: integer("sort_order").notNull().default(0),
    // ─── Phase 1 additions ────────────────────────────────────────
    variantId: uuid("variant_id").references(() => productVariants.id, {
      onDelete: "cascade",
    }),
    isPrimary: boolean("is_primary").notNull().default(false),
    // Colour tag: links this image to one attribute value (e.g. Colour=Blue)
    // so the PDP gallery can surface it when the shopper picks that colour.
    // Coarser than variantId on purpose — one photo covers every size of a
    // colour. Migration 0060.
    attributeValueId: uuid("attribute_value_id").references(
      () => productAttributeValues.id,
      { onDelete: "set null" }
    ),
    // ─── ERP feed origin tracking ─────────────────────────────────
    // Original URL from the ERP feed (e.g. https://audit.inventre.online/item-media/<sha1>.png).
    // `url` may diverge — once the rehoster mirrors the file into our MinIO,
    // `url` becomes the local URL while `erpSourceUrl` keeps the upstream
    // pointer so the importer can detect "same image" and skip re-replacing
    // the row on every sync.
    erpSourceUrl: text("erp_source_url"),
    // ──────────────────────────────────────────────────────────────
  },
  (t) => ({
    productIdx: index("images_product_idx").on(t.productId),
    erpSrcIdx: index("images_erp_source_idx").on(t.erpSourceUrl),
    variantIdx: index("images_variant_idx").on(t.variantId),
  })
);

export const productBadges = pgTable("product_badges", {
  id: uuid("id").defaultRandom().primaryKey(),
  productId: uuid("product_id")
    .notNull()
    .references(() => products.id, { onDelete: "cascade" }),
  badge: badgeEnum("badge").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
});

// ─── Phase 1 NEW: Item Attributes ───────────────────────────────────

export const productAttributes = pgTable(
  "product_attributes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    type: attributeTypeEnum("type").notNull(),
    schoolId: uuid("school_id").references(() => schools.id, {
      onDelete: "cascade",
    }),
    description: text("description"),
    sortOrder: integer("sort_order").notNull().default(0),
    // ─── ERP-parity fields ────────────────────────────────────────
    // Enabled/Disabled toggle shown as a badge in the list view.
    isDisabled: boolean("is_disabled").notNull().default(false),
    // Numeric Values: when true, this attribute uses a numeric range
    // (from/to/increment) instead of an explicit value list.
    isNumeric: boolean("is_numeric").notNull().default(false),
    numericFromRange: numeric("numeric_from_range", { precision: 12, scale: 3 }),
    numericToRange: numeric("numeric_to_range", { precision: 12, scale: 3 }),
    numericIncrement: numeric("numeric_increment", { precision: 12, scale: 3 }),
    // External ID kept stable across imports from the legacy ERP
    // (e.g. "3j5brm7hku") so re-imports update in place.
    erpId: text("erp_id"),
    // ──────────────────────────────────────────────────────────────
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    nameIdx: uniqueIndex("attributes_name_idx").on(t.name),
    schoolIdx: index("attributes_school_idx").on(t.schoolId),
    erpIdx: uniqueIndex("attributes_erp_idx").on(t.erpId),
  })
);

export const productAttributeValues = pgTable(
  "product_attribute_values",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    attributeId: uuid("attribute_id")
      .notNull()
      .references(() => productAttributes.id, { onDelete: "cascade" }),
    value: text("value").notNull(),
    shortCode: text("short_code"), // single letter for legacy SKUs
    displayLabel: text("display_label"), // ERP "Abbreviation" column
    hexColor: text("hex_color"),
    imageUrl: text("image_url"),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    erpId: text("erp_id"), // legacy ERPNext value ID for idempotent re-import
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    attrValueUq: uniqueIndex("attr_value_uq").on(t.attributeId, t.value),
    erpIdx: uniqueIndex("attr_values_erp_idx").on(t.erpId),
  })
);

export const productAttributeBindings = pgTable(
  "product_attribute_bindings",
  {
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    attributeId: uuid("attribute_id")
      .notNull()
      .references(() => productAttributes.id, { onDelete: "restrict" }),
    isRequired: boolean("is_required").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.productId, t.attributeId] }),
  })
);

export const productVariantAttributes = pgTable(
  "product_variant_attributes",
  {
    variantId: uuid("variant_id")
      .notNull()
      .references(() => productVariants.id, { onDelete: "cascade" }),
    attributeId: uuid("attribute_id")
      .notNull()
      .references(() => productAttributes.id),
    valueId: uuid("value_id")
      .notNull()
      .references(() => productAttributeValues.id),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.variantId, t.attributeId] }),
    valueIdx: index("pva_value_idx").on(t.valueId),
  })
);

// ─── Phase 1 NEW: Pricing ───────────────────────────────────────────

export const priceLists = pgTable(
  "price_lists",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    currency: text("currency").notNull().default("INR"),
    isActive: boolean("is_active").notNull().default(true),
    isDefault: boolean("is_default").notNull().default(false),
    appliesTo: priceListAppliesToEnum("applies_to").notNull().default("selling"),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    nameIdx: uniqueIndex("price_lists_name_idx").on(t.name),
  })
);

export const itemPrices = pgTable(
  "item_prices",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    variantId: uuid("variant_id")
      .notNull()
      .references(() => productVariants.id, { onDelete: "cascade" }),
    priceListId: uuid("price_list_id")
      .notNull()
      .references(() => priceLists.id, { onDelete: "cascade" }),
    schoolId: uuid("school_id").references(() => schools.id, {
      onDelete: "cascade",
    }),
    price: integer("price").notNull(), // paise
    validFrom: timestamp("valid_from", { withTimezone: true }),
    validUntil: timestamp("valid_until", { withTimezone: true }),
    minQty: integer("min_qty").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    variantIdx: index("item_prices_variant_idx").on(
      t.variantId,
      t.priceListId,
      t.schoolId
    ),
    listIdx: index("item_prices_list_idx").on(t.priceListId),
  })
);

// ─── Phase 1 NEW: Stock / Warehouses / Bins ─────────────────────────

export const warehouses = pgTable(
  "warehouses",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    code: text("code").notNull(),
    address: jsonb("address"),
    isDefault: boolean("is_default").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    nameIdx: uniqueIndex("warehouses_name_idx").on(t.name),
    codeIdx: uniqueIndex("warehouses_code_idx").on(t.code),
  })
);

export const bins = pgTable(
  "bins",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    variantId: uuid("variant_id")
      .notNull()
      .references(() => productVariants.id, { onDelete: "cascade" }),
    warehouseId: uuid("warehouse_id")
      .notNull()
      .references(() => warehouses.id, { onDelete: "cascade" }),
    actualQty: integer("actual_qty").notNull().default(0),
    reservedQty: integer("reserved_qty").notNull().default(0),
    minStockLevel: integer("min_stock_level").notNull().default(0),
    reorderTatDays: integer("reorder_tat_days"),
    valuationRate: integer("valuation_rate"), // paise
    lastCountedAt: timestamp("last_counted_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    variantWarehouseUq: uniqueIndex("bins_variant_warehouse_uq").on(
      t.variantId,
      t.warehouseId
    ),
    variantIdx: index("bins_variant_idx").on(t.variantId),
  })
);

export const stockLedger = pgTable(
  "stock_ledger",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    variantId: uuid("variant_id").notNull(),
    warehouseId: uuid("warehouse_id").notNull(),
    delta: integer("delta").notNull(),
    newActualQty: integer("new_actual_qty").notNull(),
    reservedDelta: integer("reserved_delta").notNull().default(0),
    newReservedQty: integer("new_reserved_qty"),
    reason: stockLedgerReasonEnum("reason").notNull(),
    refType: text("ref_type"),
    refId: uuid("ref_id"),
    createdBy: uuid("created_by"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    variantIdx: index("stock_ledger_variant_idx").on(
      t.variantId,
      t.warehouseId,
      t.createdAt
    ),
    refIdx: index("stock_ledger_ref_idx").on(t.refType, t.refId),
  })
);

// ─── Phase 1 NEW: Tax / GST ─────────────────────────────────────────

export const taxRates = pgTable(
  "tax_rates",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    cgstRate: numeric("cgst_rate", { precision: 5, scale: 2 }).notNull().default("0"),
    sgstRate: numeric("sgst_rate", { precision: 5, scale: 2 }).notNull().default("0"),
    igstRate: numeric("igst_rate", { precision: 5, scale: 2 }).notNull().default("0"),
    cessRate: numeric("cess_rate", { precision: 5, scale: 2 }).notNull().default("0"),
    hsnPattern: text("hsn_pattern"),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    nameIdx: uniqueIndex("tax_rates_name_idx").on(t.name),
  })
);

export const hsnCodes = pgTable("hsn_codes", {
  code: text("code").primaryKey(),
  description: text("description").notNull(),
  defaultGstRate: numeric("default_gst_rate", { precision: 5, scale: 2 }),
  category: text("category"),
});

// ════════════════════════════════ COMMERCE ══════════════════════════

export const addresses = pgTable(
  "addresses",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    parentId: uuid("parent_id")
      .notNull()
      .references(() => parents.id, { onDelete: "cascade" }),
    label: text("label"),
    receiverName: text("receiver_name").notNull(),
    receiverPhone: varchar("receiver_phone", { length: 15 }).notNull(),
    line1: text("line1").notNull(),
    line2: text("line2"),
    city: text("city").notNull(),
    state: text("state").notNull(),
    pincode: varchar("pincode", { length: 10 }).notNull(),
    isDefault: boolean("is_default").notNull().default(false),
    // ─── Phase 1 additions ────────────────────────────────────────
    addressTitle: text("address_title"),
    addressType: addressTypeEnum("address_type").notNull().default("shipping"),
    country: text("country").notNull().default("India"),
    gstin: text("gstin"),
    companyName: text("company_name"),
    landmark: text("landmark"),
    // ──────────────────────────────────────────────────────────────
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    parentIdx: index("addresses_parent_idx").on(t.parentId),
  })
);

export const carts = pgTable(
  "carts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    parentId: uuid("parent_id")
      .notNull()
      .references(() => parents.id, { onDelete: "cascade" }),
    studentId: uuid("student_id").references(() => students.id, {
      onDelete: "set null",
    }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    parentIdx: index("carts_parent_idx").on(t.parentId),
  })
);

export const cartItems = pgTable("cart_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  cartId: uuid("cart_id")
    .notNull()
    .references(() => carts.id, { onDelete: "cascade" }),
  variantId: uuid("variant_id")
    .notNull()
    .references(() => productVariants.id),
  /** Which sibling this line was added for. Nullable for legacy items
   *  written before the column landed (migration 0043). Lines without
   *  a studentId render under a generic "Unassigned" section in the cart. */
  studentId: uuid("student_id").references(() => students.id, {
    onDelete: "set null",
  }),
  qty: integer("qty").notNull().default(1),
  bundleSelections: jsonb("bundle_selections"), // for configurable bundle line items (Phase 9)
  addedAt: timestamp("added_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const erpOutboundQueue = pgTable(
  "erp_outbound_queue",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderId: uuid("order_id").notNull(),
    eventType: text("event_type").notNull(),
    enqueuedAt: timestamp("enqueued_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull(),
    attempts: integer("attempts").notNull().default(0),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    lastError: text("last_error"),
    deliveryId: bigint("delivery_id", { mode: "number" }),
    status: text("status").notNull().default("pending"),
  },
  (t) => ({
    readyIdx: index("erp_outbound_queue_ready_idx").on(t.scheduledFor),
    orderIdx: index("erp_outbound_queue_order_idx").on(t.orderId, t.enqueuedAt),
    sendingIdx: index("erp_outbound_queue_sending_idx").on(t.lastAttemptAt),
  })
);

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderNumber: text("order_number").notNull(),
    parentId: uuid("parent_id")
      .notNull()
      .references(() => parents.id),
    studentId: uuid("student_id").references(() => students.id),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id),
    status: orderStatusEnum("status").notNull().default("placed"),
    paymentStatus: paymentStatusEnum("payment_status")
      .notNull()
      .default("pending"),
    subtotal: integer("subtotal").notNull(),
    tax: integer("tax").notNull().default(0),
    shipping: integer("shipping").notNull().default(0),
    discount: integer("discount").notNull().default(0),
    total: integer("total").notNull(),
    shippingAddress: jsonb("shipping_address").notNull(),
    notes: text("notes"),
    placedAt: timestamp("placed_at", { withTimezone: true }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    packedAt: timestamp("packed_at", { withTimezone: true }),
    shippedAt: timestamp("shipped_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    // ─── Phase 1 additions ────────────────────────────────────────
    billingAddress: jsonb("billing_address"),
    financialYear: text("financial_year"), // "2026-27"
    cancellationReason: text("cancellation_reason"),
    refundedAmount: integer("refunded_amount").notNull().default(0),
    tags: text("tags").array(),
    placeOfSupply: text("place_of_supply"), // e.g. "36-Telangana"
    // ─── Gap-fix additions (audit §3.4) ───────────────────────────
    gradeSnapshot: text("grade_snapshot"), // student grade at order time (custom_student_grade)
    schoolNameSnapshot: text("school_name_snapshot"), // custom_student_school
    warehouseId: uuid("warehouse_id"), // set_warehouse — FK declared in relations
    isReplacement: boolean("is_replacement").notNull().default(false),
    replacementForOrderId: uuid("replacement_for_order_id"),
    deliveredPercent: integer("delivered_percent").notNull().default(0),
    billedPercent: integer("billed_percent").notNull().default(0),
    gstCategory: text("gst_category").notNull().default("Unregistered"),
    displayStatus: text("display_status"), // admin-overridable status text
    deliveryDate: date("delivery_date"), // target ship-by date
    companyId: uuid("company_id"), // FK declared in relations
    // ─── ERP bridge (poll worker) ─────────────────────────────────
    erpSoName: text("erp_so_name"),
    erpLastPolledAt: timestamp("erp_last_polled_at", { withTimezone: true }),
    erpStrandedAlertedAt: timestamp("erp_stranded_alerted_at", { withTimezone: true }),
    /** Full ERPNext Sales Order doc + linked Address + Contact captured
     *  at import time. Lets the admin detail page render the ERP-side
     *  address, payment details, and sub-items exactly as they came from
     *  ERPNext without a round-trip. See migration 0032. */
    erpRaw: jsonb("erp_raw"),
    // ─── Coupon reservation (promoted to website_cart_coupon_usages on paid) ─
    // FK to websiteCartCoupons declared on the side via DB migration; the
    // table is defined later in this file so we keep the column un-FK'd at
    // the Drizzle level (matches the warehouseId/replacementForOrderId
    // pattern above). orderId-set-null lives in migration 0036.
    couponId: uuid("coupon_id"),
    // ──────────────────────────────────────────────────────────────
    /** Multi-sibling checkout link. When a parent checks out a cart that
     *  has items for siblings at different (student, school), we create
     *  ONE order row per (student, school) — each preserving the
     *  single-student schema fulfillment relies on — and stamp them
     *  all with the same `orderGroupId`. The account view groups
     *  orders by this id so the parent sees "Order group #X" with the
     *  child orders nested. NULL for single-student checkouts. */
    orderGroupId: uuid("order_group_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    orderNumberIdx: uniqueIndex("orders_order_number_idx").on(t.orderNumber),
    parentIdx: index("orders_parent_idx").on(t.parentId),
    schoolStatusIdx: index("orders_school_status_idx").on(t.schoolId, t.status),
    createdAtIdx: index("orders_created_at_idx").on(t.createdAt),
    fyIdx: index("orders_fy_idx").on(t.financialYear),
    couponIdx: index("orders_coupon_id_idx").on(t.couponId),
    orderGroupIdx: index("orders_order_group_idx").on(t.orderGroupId),
  })
);

export const orderItems = pgTable("order_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  orderId: uuid("order_id")
    .notNull()
    .references(() => orders.id, { onDelete: "cascade" }),
  /** Nullable — ERPNext imports can reference item_codes that don't yet
   *  exist in our local product_variants catalog. We persist the name +
   *  qty + price snapshot regardless so admins can see the full order
   *  contents; the binding can be filled in later. See migration 0031. */
  variantId: uuid("variant_id").references(() => productVariants.id),
  nameSnapshot: text("name_snapshot").notNull(),
  imageSnapshot: text("image_snapshot"),
  size: text("size").notNull(),
  qty: integer("qty").notNull(),
  unitPrice: integer("unit_price").notNull(),
  total: integer("total").notNull(),
  // ─── Phase 1 additions ────────────────────────────────────────
  hsnCodeSnapshot: text("hsn_code_snapshot"),
  gstTreatmentSnapshot: gstTreatmentEnum("gst_treatment_snapshot"),
  bundleSelections: jsonb("bundle_selections"),
  // ─── Gap-fix: bundle parent reference (audit §3.4 custom_sub_items) ───
  parentBundleProductId: uuid("parent_bundle_product_id"),
  gstInclusiveSnapshot: boolean("gst_inclusive_snapshot"),
  // ──────────────────────────────────────────────────────────────
});

// ─── Shipments (extended in Phase 1 from existing minimal table) ───

export const shipments = pgTable(
  "shipments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    courier: text("courier"), // legacy
    trackingNumber: text("tracking_number"),
    status: text("status"), // legacy text — Phase 6 uses statusEnum
    shippedAt: timestamp("shipped_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    // ─── Phase 1 additions ────────────────────────────────────────
    shipmentNumber: text("shipment_number"), // SHP-2026-NNNNN
    warehouseId: uuid("warehouse_id").references(() => warehouses.id),
    statusEnum: shipmentStatusEnum("status_enum").notNull().default("draft"),
    trackingUrl: text("tracking_url"),
    packedAt: timestamp("packed_at", { withTimezone: true }),
    shippingAddress: jsonb("shipping_address"),
    weightGrams: integer("weight_grams"),
    dimensions: jsonb("dimensions"),
    notes: text("notes"),
    createdBy: uuid("created_by"),
    // e-Way Bill (NIC) — for inter-state shipments > ₹50k
    ewaybillNumber: text("ewaybill_number"),
    ewaybillStatus: text("ewaybill_status"),
    ewaybillValidUpto: timestamp("ewaybill_valid_upto", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // ──────────────────────────────────────────────────────────────
  },
  (t) => ({
    shipmentNumberIdx: uniqueIndex("shipments_number_idx").on(t.shipmentNumber),
    orderIdx: index("shipments_order_idx").on(t.orderId),
  })
);

export const shipmentItems = pgTable(
  "shipment_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    shipmentId: uuid("shipment_id")
      .notNull()
      .references(() => shipments.id, { onDelete: "cascade" }),
    orderItemId: uuid("order_item_id")
      .notNull()
      .references(() => orderItems.id),
    variantId: uuid("variant_id")
      .notNull()
      .references(() => productVariants.id),
    qty: integer("qty").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    shipmentIdx: index("shipment_items_shipment_idx").on(t.shipmentId),
    orderItemIdx: index("shipment_items_order_item_idx").on(t.orderItemId),
  })
);

// ─── Returns (extended in Phase 1) ──────────────────────────────────

export const returns = pgTable(
  "returns",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id),
    itemIds: jsonb("item_ids"), // legacy — string[] of order_item ids; nullable now
    reason: text("reason"),
    photos: jsonb("photos"),
    status: returnStatusEnum("status").notNull().default("requested"),
    refundAmount: integer("refund_amount"),
    // ─── Phase 1 additions ────────────────────────────────────────
    returnNumber: text("return_number"), // RTN-2026-NNNNN
    parentId: uuid("parent_id").references(() => parents.id),
    notes: text("notes"),
    approvedBy: uuid("approved_by"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    receivedAt: timestamp("received_at", { withTimezone: true }),
    refundedAt: timestamp("refunded_at", { withTimezone: true }),
    refundMethod: refundMethodEnum("refund_method"),
    creditNoteInvoiceId: uuid("credit_note_invoice_id"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // ─── Phase: customer-raised exchange flow (migration 0051) ───
    // `kind` distinguishes refund rows from exchange rows so admin code
    // and storefront queries can branch without scanning reason text.
    kind: text("kind").notNull().default("refund"),
    // Who raised this request (migration 0070): "customer" (storefront) or
    // "care_team" (raised in the Audit portal by Customer Care, synced in
    // via createExchangeFromAudit). Drives the "…by the Customer Care Team"
    // wording on the storefront duplicate-guard popup (Condition 4).
    source: text("source").notNull().default("customer"),
    // `pickup_date` is set only on exchange rows; refund rows leave it
    // NULL. See lib/date.ts → firstPickupSaturday for the rule.
    pickupDate: date("pickup_date"),
    // ─── Phase 2 (migration 0052): industry-standard exchange UX ──
    subReason: text("sub_reason"),
    // Variant the customer wants *instead* — NULL on "fresh piece"
    // requests (damaged / defective). No FK so an archived variant
    // doesn't block the row.
    requestedVariantId: uuid("requested_variant_id"),
    // For kit / Magic Box parent lines: which component is the issue.
    // Shape: { variantId, componentName, attributes? } pointing into
    // the original line's bundle_selections.
    requestedComponentPath: jsonb("requested_component_path"),
    damageLocation: text("damage_location"),
    // Photos uploaded by the school at hand-over (separate from the
    // request photos in `photos`). [{ url, key }, ...]
    handoverPhotos: jsonb("handover_photos"),
    // ─── 0053 (2026-06-07): honest replacement mode ───────────────
    // What the customer explicitly chose for the replacement:
    //   'sibling'             — picked a different size/variant
    //   'same_fresh'          — wants a fresh copy of the same variant
    //   'different_describe'  — wants something different (see notes)
    // Replaces the silent "same fresh piece" assumption. NULL on rows
    // that predate this column.
    replacementMode: text("replacement_mode"),
    // ─── 0054 (2026-06-07): customer-facing rejection reason ──────
    // Captured by audit customer-care when rejecting; carried back in
    // the exchange.rejected webhook envelope; persisted here so the
    // customer's exchange-status page can render the actual reason
    // instead of a generic "contact support" message.
    rejectionReason: text("rejection_reason"),
    // ─── 0055 (2026-06-07): replacement-arrived-at-school timestamp
    // Stamped by the audit-side exchange.replacement_arrived webhook
    // when the warehouse→school dispatch leg lands. The customer
    // page renders an intermediate "arrived at school" callout when
    // status='approved' and this is set.
    replacementArrivedAt: timestamp("replacement_arrived_at", { withTimezone: true }),
    // ─── 0069 (2026-07-08): duplicate-of provenance for rejections ──
    // When audit rejects an exchange as a duplicate, it names the other
    // request(s) already covering this item and who raised each. Shape:
    //   [{ return_number: "RTN-2026-01337", status, raised_by:
    //      "team" | "customer" }]
    // Persisted so the customer's status page can point them at the RTN
    // that already exists instead of just "duplicate request". NULL/empty
    // on rejections that aren't duplicates and on rows predating this col.
    duplicateOf: jsonb("duplicate_of"),
    // ──────────────────────────────────────────────────────────────
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    returnNumberIdx: uniqueIndex("returns_number_idx").on(t.returnNumber),
    orderIdx: index("returns_order_idx").on(t.orderId),
    parentStatusIdx: index("returns_parent_status_idx").on(t.parentId, t.status),
  })
);

export const returnItems = pgTable("return_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  returnId: uuid("return_id")
    .notNull()
    .references(() => returns.id, { onDelete: "cascade" }),
  orderItemId: uuid("order_item_id")
    .notNull()
    .references(() => orderItems.id),
  variantId: uuid("variant_id")
    .notNull()
    .references(() => productVariants.id),
  qty: integer("qty").notNull(),
  reason: text("reason"),
  condition: returnConditionEnum("condition"),
  // Per-item exchange detail (migration 0057). The row-level `returns`
  // columns still carry the "primary" (first item's) values for back-compat.
  subReason: text("sub_reason"),
  damageLocation: text("damage_location"),
  replacementMode: text("replacement_mode"),
  requestedVariantId: uuid("requested_variant_id").references(() => productVariants.id),
  requestedComponentPath: jsonb("requested_component_path"),
  notes: text("notes"),
});

// ─── Missing-item claims (migration 0056) ────────────────────────────
// Separate top-level entity from returns/exchanges because semantics
// differ: customer never received the item, no reverse logistics. Same
// shape as the exchange flow's customer-facing surfaces (claim_number,
// status, photos, rejection_reason, replacement_arrived_at) so the form
// + status page can mostly mirror /shop/orders/[id]/exchange/*.
export const missingItemClaims = pgTable(
  "missing_item_claims",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    claimNumber: text("claim_number"),                // MIS-YYYY-NNNNN
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id),
    parentId: uuid("parent_id")
      .notNull()
      .references(() => parents.id),
    // requested | approved | rejected | received_at_school | delivered
    status: text("status").notNull().default("requested"),
    // "customer" (storefront) or "care_team" (raised in Audit by Customer
    // Care and synced via createMissingFromAudit). Migration 0070.
    source: text("source").notNull().default("customer"),
    notes: text("notes"),
    rejectionReason: text("rejection_reason"),
    replacementArrivedAt: timestamp("replacement_arrived_at", { withTimezone: true }),
    pickupDate: date("pickup_date"),
    photos: jsonb("photos"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvedBy: uuid("approved_by"),
    rejectedAt: timestamp("rejected_at", { withTimezone: true }),
    receivedAt: timestamp("received_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    claimNumberIdx: uniqueIndex("missing_item_claims_claim_number_idx").on(t.claimNumber),
    parentStatusIdx: index("ix_missing_claims_parent_status").on(t.parentId, t.status),
    orderIdx: index("ix_missing_claims_order").on(t.orderId),
  }),
);

export const missingItemClaimItems = pgTable("missing_item_claim_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  claimId: uuid("claim_id")
    .notNull()
    .references(() => missingItemClaims.id, { onDelete: "cascade" }),
  orderItemId: uuid("order_item_id").notNull(),
  qtyShort: integer("qty_short").notNull(),
  // {variantId, componentName, attributes} — for kit/Magic-Box claims
  // where only a component is missing. Bridge enriches with item_code +
  // item_name + size before sending to audit.
  missingComponentPath: jsonb("missing_component_path"),
  notes: text("notes"),
});

// Parent concern portal (inventre.in/portal) — migration 0064. A concern
// raised by a parent (payment / order-delivery / customer-care), pushed to
// the Audit call-centre Admin Panel via concern.created. Status flips return
// from audit like exchange/missing.
export const concerns = pgTable(
  "concerns",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    concernNumber: text("concern_number"), // CON-YYYY-NNNNN (inventre-minted)
    parentId: uuid("parent_id").references(() => parents.id),
    orderId: uuid("order_id").references(() => orders.id), // nullable
    category: text("category").notNull(), // login|grade_change|student_details|guardian|order_delivery|payment|customer_care
    subType: text("sub_type"),
    description: text("description"),
    details: jsonb("details"), // per-category captured fields
    team: text("team"), // customer_care | sales | "customer_care,sales"
    contactName: text("contact_name"),
    contactPhone: text("contact_phone"),
    orderRef: text("order_ref"), // free-text order no. a public parent types
    studentId: uuid("student_id"),
    photos: jsonb("photos"),
    status: text("status").notNull().default("submitted"), // submitted|in_progress|waiting_customer|waiting_school|resolved
    assignedToName: text("assigned_to_name"),
    assignedToUserId: uuid("assigned_to_user_id"),
    auditRef: text("audit_ref"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    concernNumberIdx: uniqueIndex("concerns_concern_number_idx").on(t.concernNumber),
    parentIdx: index("concerns_parent_idx").on(t.parentId),
    orderIdx: index("concerns_order_idx").on(t.orderId),
    statusIdx: index("concerns_status_idx").on(t.status),
  }),
);

export const concernMessages = pgTable("concern_messages", {
  id: uuid("id").defaultRandom().primaryKey(),
  concernId: uuid("concern_id")
    .notNull()
    .references(() => concerns.id, { onDelete: "cascade" }),
  author: text("author").notNull(), // parent | agent | system
  authorName: text("author_name"),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const payments = pgTable("payments", {
  id: uuid("id").defaultRandom().primaryKey(),
  orderId: uuid("order_id")
    .notNull()
    .references(() => orders.id),
  provider: text("provider").notNull().default("ccavenue"),
  providerPaymentId: text("provider_payment_id"),
  amount: integer("amount").notNull(),
  status: paymentStatusEnum("status").notNull().default("pending"),
  method: text("method"),
  raw: jsonb("raw"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  // ─── Gap-fix: audit §4.1 structured payment fields ───────────
  paymentFlow: text("payment_flow").notNull().default("ONLINE"), // 'ONLINE' | 'COD'
  gatewayProvider: text("gateway_provider").notNull().default("CCAVENUE"), // 'CCAVENUE' | 'RAZORPAY' (legacy rows only)
  gatewayOrderId: text("gateway_order_id"),
  internalPaymentReference: text("internal_payment_reference"),
  paymentMode: text("payment_mode"), // 'Credit Card' | 'Debit Card' | 'UPI' | 'Net Banking' | 'Wallet' | 'EMI' | 'COD' | etc.
  paymentDate: text("payment_date"), // matches audit's "01/05/2026 23:54:08" format
  paidCurrency: text("paid_currency").notNull().default("INR"),
  paidAmount: text("paid_amount"), // text matches audit pattern
  refundStatus: text("refund_status").notNull().default("NOT_REQUESTED"), // NOT_REQUESTED | PENDING | SUCCESS | FAILED
  gatewayTrackingId: text("gateway_tracking_id"),
  gatewayResponseMessage: text("gateway_response_message"),
  paymentAttemptCount: integer("payment_attempt_count").notNull().default(0),
  paymentRetryCount: integer("payment_retry_count").notNull().default(0),
  paymentFinalized: boolean("payment_finalized").notNull().default(false),
  checkoutNotificationSent: text("checkout_notification_sent"),
  orderSubmitError: boolean("order_submit_error").notNull().default(false),
  /** Last time we asked CCAvenue's Status API about this pending payment.
   *  Updated by both the parent-side status route and the reconciler cron
   *  so neither hammers CCAvenue. Null until first poll; cleared on
   *  finalisation. See migration 0030. */
  lastStatusPollAt: timestamp("last_status_poll_at", { withTimezone: true }),
  // ──────────────────────────────────────────────────────────────
});

// ─── Gap-fix NEW: Payment schedules (audit §3.4 payment_schedule[]) ───
export const paymentSchedules = pgTable("payment_schedules", {
  id: uuid("id").defaultRandom().primaryKey(),
  orderId: uuid("order_id")
    .notNull()
    .references(() => orders.id, { onDelete: "cascade" }),
  invoiceId: uuid("invoice_id"),
  dueDate: date("due_date").notNull(),
  invoicePortion: numeric("invoice_portion", { precision: 5, scale: 2 }).notNull(),
  paymentAmount: integer("payment_amount").notNull(), // paise
  outstandingAmount: integer("outstanding_amount").notNull(), // paise
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ─── Phase 1 NEW: Invoicing ─────────────────────────────────────────

export const invoices = pgTable(
  "invoices",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    invoiceNumber: text("invoice_number").notNull(),
    financialYear: text("financial_year").notNull(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id),
    parentId: uuid("parent_id")
      .notNull()
      .references(() => parents.id),
    postingDate: date("posting_date").notNull(),
    dueDate: date("due_date"),
    netTotal: integer("net_total").notNull(),
    cgstTotal: integer("cgst_total").notNull().default(0),
    sgstTotal: integer("sgst_total").notNull().default(0),
    igstTotal: integer("igst_total").notNull().default(0),
    taxTotal: integer("tax_total").notNull().default(0),
    roundingAdjustment: integer("rounding_adjustment").notNull().default(0),
    grandTotal: integer("grand_total").notNull(),
    outstandingAmount: integer("outstanding_amount").notNull(),
    status: invoiceStatusEnum("status").notNull().default("draft"),
    isReturn: boolean("is_return").notNull().default(false),
    isDebitNote: boolean("is_debit_note").notNull().default(false),
    parentInvoiceId: uuid("parent_invoice_id"),
    gstCategory: text("gst_category").notNull().default("Unregistered"),
    customerGstin: text("customer_gstin"), // for B2B invoices
    companyId: uuid("company_id"), // FK declared in relations
    billingAddress: jsonb("billing_address").notNull(),
    shippingAddress: jsonb("shipping_address"),
    placeOfSupply: text("place_of_supply"),
    taxBreakdown: jsonb("tax_breakdown"),
    pdfUrl: text("pdf_url"),
    einvoiceIrn: text("einvoice_irn"),
    einvoiceQrCode: text("einvoice_qr_code"),
    einvoiceStatus: einvoiceStatusEnum("einvoice_status"),
    ewaybillNumber: text("ewaybill_number"),
    ewaybillStatus: text("ewaybill_status"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    invoiceNumberIdx: uniqueIndex("invoices_number_idx").on(t.invoiceNumber),
    orderIdx: index("invoices_order_idx").on(t.orderId),
    parentIdx: index("invoices_parent_idx").on(t.parentId, t.postingDate),
    statusIdx: index("invoices_status_idx").on(t.status, t.dueDate),
  })
);

export const invoiceItems = pgTable("invoice_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  invoiceId: uuid("invoice_id")
    .notNull()
    .references(() => invoices.id, { onDelete: "cascade" }),
  orderItemId: uuid("order_item_id").references(() => orderItems.id),
  variantId: uuid("variant_id")
    .notNull()
    .references(() => productVariants.id),
  hsnCode: text("hsn_code"),
  itemNameSnapshot: text("item_name_snapshot").notNull(),
  qty: integer("qty").notNull(),
  unitPrice: integer("unit_price").notNull(),
  discountAmount: integer("discount_amount").notNull().default(0),
  netAmount: integer("net_amount").notNull(),
  taxableAmount: integer("taxable_amount").notNull(),
  cgstRate: numeric("cgst_rate", { precision: 5, scale: 2 }).notNull().default("0"),
  sgstRate: numeric("sgst_rate", { precision: 5, scale: 2 }).notNull().default("0"),
  igstRate: numeric("igst_rate", { precision: 5, scale: 2 }).notNull().default("0"),
  cgstAmount: integer("cgst_amount").notNull().default(0),
  sgstAmount: integer("sgst_amount").notNull().default(0),
  igstAmount: integer("igst_amount").notNull().default(0),
  totalAmount: integer("total_amount").notNull(),
  gstTreatment: gstTreatmentEnum("gst_treatment").notNull(),
});

// ─── Phase 1 NEW: Discount Rules (used in Phase 8) ──────────────────

export const coupons = pgTable(
  "coupons",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    code: text("code").notNull(),
    type: text("type").notNull(),
    value: integer("value").notNull(),
    minOrder: integer("min_order").notNull().default(0),
    validFrom: timestamp("valid_from", { withTimezone: true }),
    validTo: timestamp("valid_to", { withTimezone: true }),
    maxUses: integer("max_uses"),
    usedCount: integer("used_count").notNull().default(0),
    schoolId: uuid("school_id").references(() => schools.id),
    isActive: boolean("is_active").notNull().default(true),
  },
  (t) => ({
    codeIdx: uniqueIndex("coupons_code_idx").on(t.code),
  })
);

export const discountRules = pgTable(
  "discount_rules",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    code: text("code"),
    type: discountTypeEnum("type").notNull(),
    value: numeric("value", { precision: 10, scale: 2 }).notNull(),
    appliesTo: discountAppliesToEnum("applies_to").notNull().default("all"),
    schoolId: uuid("school_id").references(() => schools.id, {
      onDelete: "cascade",
    }),
    categoryId: uuid("category_id").references(() => categories.id, {
      onDelete: "cascade",
    }),
    productId: uuid("product_id").references(() => products.id, {
      onDelete: "cascade",
    }),
    variantId: uuid("variant_id").references(() => productVariants.id, {
      onDelete: "cascade",
    }),
    minOrderAmount: integer("min_order_amount"),
    minQty: integer("min_qty"),
    maxDiscountAmount: integer("max_discount_amount"),
    maxUsesTotal: integer("max_uses_total"),
    maxUsesPerCustomer: integer("max_uses_per_customer"),
    usedCount: integer("used_count").notNull().default(0),
    validFrom: timestamp("valid_from", { withTimezone: true }),
    validUntil: timestamp("valid_until", { withTimezone: true }),
    isActive: boolean("is_active").notNull().default(true),
    isStackable: boolean("is_stackable").notNull().default(false),
    priority: integer("priority").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    codeIdx: uniqueIndex("discount_rules_code_idx").on(t.code),
  })
);

export const discountUsages = pgTable(
  "discount_usages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ruleId: uuid("rule_id")
      .notNull()
      .references(() => discountRules.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id").references(() => parents.id, {
      onDelete: "set null",
    }),
    orderId: uuid("order_id").references(() => orders.id, {
      onDelete: "set null",
    }),
    amountSaved: integer("amount_saved").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    ruleIdx: index("discount_usages_rule_idx").on(t.ruleId),
    parentIdx: index("discount_usages_parent_idx").on(t.parentId),
  })
);

// ─── Phase 1 NEW: Bundles (used in Phase 9) ─────────────────────────

export const productBundles = pgTable("product_bundles", {
  id: uuid("id").defaultRandom().primaryKey(),
  productId: uuid("product_id")
    .notNull()
    .unique()
    .references(() => products.id, { onDelete: "cascade" }),
  bundleType: bundleTypeEnum("bundle_type").notNull(),
  pricingMode: bundlePricingModeEnum("pricing_mode").notNull().default("sum"),
  fixedPrice: integer("fixed_price"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const bundleSelectors = pgTable(
  "bundle_selectors",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    bundleId: uuid("bundle_id")
      .notNull()
      .references(() => productBundles.id, { onDelete: "cascade" }),
    groupKey: text("group_key").notNull(),
    name: text("name").notNull(),
    selectorType: selectorTypeEnum("selector_type").notNull(),
    isRequired: boolean("is_required").notNull().default(true),
    minSelections: integer("min_selections").notNull().default(1),
    maxSelections: integer("max_selections"),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => ({
    bundleGroupUq: uniqueIndex("bundle_selector_group_uq").on(
      t.bundleId,
      t.groupKey
    ),
  })
);

export const bundleComponents = pgTable(
  "bundle_components",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    bundleId: uuid("bundle_id")
      .notNull()
      .references(() => productBundles.id, { onDelete: "cascade" }),
    variantId: uuid("variant_id").references(() => productVariants.id, {
      onDelete: "cascade",
    }),
    productId: uuid("product_id").references(() => products.id, {
      onDelete: "cascade",
    }),
    qty: integer("qty").notNull().default(1),
    selectorGroupKey: text("selector_group_key"),
    selectorOptionLabel: text("selector_option_label"),
    isOptional: boolean("is_optional").notNull().default(false),
    isVisible: boolean("is_visible").notNull().default(true),
  },
  (t) => ({
    bundleIdx: index("bundle_components_bundle_idx").on(
      t.bundleId,
      t.selectorGroupKey
    ),
  })
);

export const bundleConfigs = pgTable(
  "bundle_configs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    grade: text("grade").notNull(),
    bundleId: uuid("bundle_id")
      .notNull()
      .references(() => productBundles.id, { onDelete: "cascade" }),
    isActive: boolean("is_active").notNull().default(true),
  },
  (t) => ({
    uq: uniqueIndex("bundle_configs_uq").on(t.schoolId, t.grade, t.bundleId),
  })
);

// ════════════════════════════════ ENGAGEMENT ════════════════════════

export const reviews = pgTable(
  "reviews",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id")
      .notNull()
      .references(() => parents.id),
    studentId: uuid("student_id").references(() => students.id),
    orderId: uuid("order_id").references(() => orders.id),
    rating: integer("rating").notNull(),
    body: text("body").notNull(),
    status: reviewStatusEnum("status").notNull().default("pending"),
    verifiedPurchase: boolean("verified_purchase").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    productStatusIdx: index("reviews_product_status_idx").on(
      t.productId,
      t.status
    ),
  })
);

export const wishlists = pgTable("wishlists", {
  id: uuid("id").defaultRandom().primaryKey(),
  parentId: uuid("parent_id")
    .notNull()
    .references(() => parents.id, { onDelete: "cascade" }),
  studentId: uuid("student_id").references(() => students.id, {
    onDelete: "cascade",
  }),
  variantId: uuid("variant_id")
    .notNull()
    .references(() => productVariants.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const testimonials = pgTable("testimonials", {
  id: uuid("id").defaultRandom().primaryKey(),
  schoolId: uuid("school_id").references(() => schools.id, {
    onDelete: "set null",
  }),
  principalName: text("principal_name").notNull(),
  role: text("role").notNull().default("Principal"),
  shortLabel: text("short_label"),
  quote: text("quote").notNull(),
  photoUrl: text("photo_url"),
  isFeatured: boolean("is_featured").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const faqs = pgTable("faqs", {
  id: uuid("id").defaultRandom().primaryKey(),
  question: text("question").notNull(),
  answer: text("answer").notNull(),
  category: text("category").notNull().default("general"),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
});

// ════════════════════════════════ CMS / CONTENT ═════════════════════

export const contentBlocks = pgTable("content_blocks", {
  key: text("key").primaryKey(),
  data: jsonb("data").notNull(),
  updatedBy: uuid("updated_by").references(() => users.id),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const media = pgTable("media", {
  id: uuid("id").defaultRandom().primaryKey(),
  url: text("url").notNull(),
  alt: text("alt"),
  kind: text("kind").notNull(),
  size: integer("size"),
  mime: text("mime"),
  uploadedBy: uuid("uploaded_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ════════════════════════════════ OPS ═══════════════════════════════

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").references(() => users.id),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    before: jsonb("before"),
    after: jsonb("after"),
    ip: text("ip"),
    ua: text("ua"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    createdAtIdx: index("audit_log_created_at_idx").on(t.createdAt),
    userIdx: index("audit_log_user_idx").on(t.userId),
  })
);

export const contactSubmissions = pgTable(
  "contact_submissions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    phone: varchar("phone", { length: 15 }),
    payload: jsonb("payload"),
    status: text("status").notNull().default("new"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    createdIdx: index("contact_submissions_created_idx").on(t.createdAt),
  })
);

export const systemSettings = pgTable("system_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ─── Phase 1 NEW: Background Jobs ───────────────────────────────────

export const backgroundJobs = pgTable(
  "background_jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    jobType: text("job_type").notNull(),
    status: backgroundJobStatusEnum("status").notNull().default("queued"),
    payload: jsonb("payload").notNull(),
    result: jsonb("result"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    lastError: text("last_error"),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true })
      .notNull()
      .defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    statusIdx: index("background_jobs_status_idx").on(t.status, t.scheduledFor),
    typeIdx: index("background_jobs_type_idx").on(t.jobType),
  })
);

// ════════════════════════════════ RELATIONS ═════════════════════════

export const parentsRelations = relations(parents, ({ many }) => ({
  students: many(students),
  orders: many(orders),
  carts: many(carts),
  addresses: many(addresses),
  reviews: many(reviews),
  wishlists: many(wishlists),
  invoices: many(invoices),
  returns: many(returns),
  discountUsages: many(discountUsages),
}));

export const studentsRelations = relations(students, ({ one, many }) => ({
  parent: one(parents, {
    fields: [students.parentId],
    references: [parents.id],
  }),
  school: one(schools, {
    fields: [students.schoolId],
    references: [schools.id],
  }),
  orders: many(orders),
}));

export const schoolsRelations = relations(schools, ({ many }) => ({
  students: many(students),
  productAssignments: many(productSchool),
  testimonials: many(testimonials),
  orders: many(orders),
  attributes: many(productAttributes),
  itemPriceOverrides: many(itemPrices),
  bundleConfigs: many(bundleConfigs),
  discountRules: many(discountRules),
}));

export const categoriesRelations = relations(categories, ({ one, many }) => ({
  parent: one(categories, {
    fields: [categories.parentId],
    references: [categories.id],
    relationName: "category_parent",
  }),
  children: many(categories, { relationName: "category_parent" }),
  products: many(products),
  discountRules: many(discountRules),
}));

export const productsRelations = relations(products, ({ one, many }) => ({
  category: one(categories, {
    fields: [products.categoryId],
    references: [categories.id],
  }),
  taxRate: one(taxRates, {
    fields: [products.taxRateId],
    references: [taxRates.id],
  }),
  variants: many(productVariants),
  images: many(productImages),
  badges: many(productBadges),
  schoolAssignments: many(productSchool),
  reviews: many(reviews),
  attributeBindings: many(productAttributeBindings),
  bundle: one(productBundles, {
    fields: [products.id],
    references: [productBundles.productId],
  }),
}));

export const productSchoolRelations = relations(productSchool, ({ one }) => ({
  product: one(products, {
    fields: [productSchool.productId],
    references: [products.id],
  }),
  school: one(schools, {
    fields: [productSchool.schoolId],
    references: [schools.id],
  }),
}));

export const productVariantsRelations = relations(
  productVariants,
  ({ one, many }) => ({
    product: one(products, {
      fields: [productVariants.productId],
      references: [products.id],
    }),
    attributes: many(productVariantAttributes),
    images: many(productImages),
    prices: many(itemPrices),
    bins: many(bins),
  })
);

export const productImagesRelations = relations(productImages, ({ one }) => ({
  product: one(products, {
    fields: [productImages.productId],
    references: [products.id],
  }),
  variant: one(productVariants, {
    fields: [productImages.variantId],
    references: [productVariants.id],
  }),
}));

export const productAttributesRelations = relations(
  productAttributes,
  ({ one, many }) => ({
    school: one(schools, {
      fields: [productAttributes.schoolId],
      references: [schools.id],
    }),
    values: many(productAttributeValues),
    bindings: many(productAttributeBindings),
  })
);

export const productAttributeValuesRelations = relations(
  productAttributeValues,
  ({ one }) => ({
    attribute: one(productAttributes, {
      fields: [productAttributeValues.attributeId],
      references: [productAttributes.id],
    }),
  })
);

export const productAttributeBindingsRelations = relations(
  productAttributeBindings,
  ({ one }) => ({
    product: one(products, {
      fields: [productAttributeBindings.productId],
      references: [products.id],
    }),
    attribute: one(productAttributes, {
      fields: [productAttributeBindings.attributeId],
      references: [productAttributes.id],
    }),
  })
);

export const productVariantAttributesRelations = relations(
  productVariantAttributes,
  ({ one }) => ({
    variant: one(productVariants, {
      fields: [productVariantAttributes.variantId],
      references: [productVariants.id],
    }),
    attribute: one(productAttributes, {
      fields: [productVariantAttributes.attributeId],
      references: [productAttributes.id],
    }),
    value: one(productAttributeValues, {
      fields: [productVariantAttributes.valueId],
      references: [productAttributeValues.id],
    }),
  })
);

export const priceListsRelations = relations(priceLists, ({ many }) => ({
  itemPrices: many(itemPrices),
}));

export const itemPricesRelations = relations(itemPrices, ({ one }) => ({
  variant: one(productVariants, {
    fields: [itemPrices.variantId],
    references: [productVariants.id],
  }),
  priceList: one(priceLists, {
    fields: [itemPrices.priceListId],
    references: [priceLists.id],
  }),
  school: one(schools, {
    fields: [itemPrices.schoolId],
    references: [schools.id],
  }),
}));

export const warehousesRelations = relations(warehouses, ({ many }) => ({
  bins: many(bins),
  shipments: many(shipments),
}));

export const binsRelations = relations(bins, ({ one }) => ({
  variant: one(productVariants, {
    fields: [bins.variantId],
    references: [productVariants.id],
  }),
  warehouse: one(warehouses, {
    fields: [bins.warehouseId],
    references: [warehouses.id],
  }),
}));

export const taxRatesRelations = relations(taxRates, ({ many }) => ({
  products: many(products),
}));

export const ordersRelations = relations(orders, ({ one, many }) => ({
  parent: one(parents, { fields: [orders.parentId], references: [parents.id] }),
  student: one(students, {
    fields: [orders.studentId],
    references: [students.id],
  }),
  school: one(schools, { fields: [orders.schoolId], references: [schools.id] }),
  items: many(orderItems),
  shipments: many(shipments),
  payments: many(payments),
  invoices: many(invoices),
  returns: many(returns),
}));

export const orderItemsRelations = relations(orderItems, ({ one, many }) => ({
  order: one(orders, { fields: [orderItems.orderId], references: [orders.id] }),
  variant: one(productVariants, {
    fields: [orderItems.variantId],
    references: [productVariants.id],
  }),
  shipmentItems: many(shipmentItems),
  returnItems: many(returnItems),
}));

export const shipmentsRelations = relations(shipments, ({ one, many }) => ({
  order: one(orders, {
    fields: [shipments.orderId],
    references: [orders.id],
  }),
  warehouse: one(warehouses, {
    fields: [shipments.warehouseId],
    references: [warehouses.id],
  }),
  items: many(shipmentItems),
}));

export const shipmentItemsRelations = relations(shipmentItems, ({ one }) => ({
  shipment: one(shipments, {
    fields: [shipmentItems.shipmentId],
    references: [shipments.id],
  }),
  orderItem: one(orderItems, {
    fields: [shipmentItems.orderItemId],
    references: [orderItems.id],
  }),
  variant: one(productVariants, {
    fields: [shipmentItems.variantId],
    references: [productVariants.id],
  }),
}));

export const returnsRelations = relations(returns, ({ one, many }) => ({
  order: one(orders, { fields: [returns.orderId], references: [orders.id] }),
  parent: one(parents, {
    fields: [returns.parentId],
    references: [parents.id],
  }),
  items: many(returnItems),
}));

export const returnItemsRelations = relations(returnItems, ({ one }) => ({
  return: one(returns, {
    fields: [returnItems.returnId],
    references: [returns.id],
  }),
  orderItem: one(orderItems, {
    fields: [returnItems.orderItemId],
    references: [orderItems.id],
  }),
  variant: one(productVariants, {
    fields: [returnItems.variantId],
    references: [productVariants.id],
  }),
}));

export const invoicesRelations = relations(invoices, ({ one, many }) => ({
  order: one(orders, { fields: [invoices.orderId], references: [orders.id] }),
  parent: one(parents, {
    fields: [invoices.parentId],
    references: [parents.id],
  }),
  items: many(invoiceItems),
}));

export const invoiceItemsRelations = relations(invoiceItems, ({ one }) => ({
  invoice: one(invoices, {
    fields: [invoiceItems.invoiceId],
    references: [invoices.id],
  }),
  variant: one(productVariants, {
    fields: [invoiceItems.variantId],
    references: [productVariants.id],
  }),
}));

export const cartsRelations = relations(carts, ({ one, many }) => ({
  parent: one(parents, { fields: [carts.parentId], references: [parents.id] }),
  student: one(students, {
    fields: [carts.studentId],
    references: [students.id],
  }),
  items: many(cartItems),
}));

export const discountRulesRelations = relations(
  discountRules,
  ({ one, many }) => ({
    school: one(schools, {
      fields: [discountRules.schoolId],
      references: [schools.id],
    }),
    category: one(categories, {
      fields: [discountRules.categoryId],
      references: [categories.id],
    }),
    product: one(products, {
      fields: [discountRules.productId],
      references: [products.id],
    }),
    variant: one(productVariants, {
      fields: [discountRules.variantId],
      references: [productVariants.id],
    }),
    usages: many(discountUsages),
  })
);

export const discountUsagesRelations = relations(discountUsages, ({ one }) => ({
  rule: one(discountRules, {
    fields: [discountUsages.ruleId],
    references: [discountRules.id],
  }),
  parent: one(parents, {
    fields: [discountUsages.parentId],
    references: [parents.id],
  }),
  order: one(orders, {
    fields: [discountUsages.orderId],
    references: [orders.id],
  }),
}));

export const productBundlesRelations = relations(
  productBundles,
  ({ one, many }) => ({
    product: one(products, {
      fields: [productBundles.productId],
      references: [products.id],
    }),
    selectors: many(bundleSelectors),
    components: many(bundleComponents),
    configs: many(bundleConfigs),
  })
);

export const bundleSelectorsRelations = relations(
  bundleSelectors,
  ({ one }) => ({
    bundle: one(productBundles, {
      fields: [bundleSelectors.bundleId],
      references: [productBundles.id],
    }),
  })
);

export const bundleComponentsRelations = relations(
  bundleComponents,
  ({ one }) => ({
    bundle: one(productBundles, {
      fields: [bundleComponents.bundleId],
      references: [productBundles.id],
    }),
    variant: one(productVariants, {
      fields: [bundleComponents.variantId],
      references: [productVariants.id],
    }),
    product: one(products, {
      fields: [bundleComponents.productId],
      references: [products.id],
    }),
  })
);

export const bundleConfigsRelations = relations(bundleConfigs, ({ one }) => ({
  school: one(schools, {
    fields: [bundleConfigs.schoolId],
    references: [schools.id],
  }),
  bundle: one(productBundles, {
    fields: [bundleConfigs.bundleId],
    references: [productBundles.id],
  }),
}));

// ════════════════════════════════ ERPNext-inspired ═══════════════════
// Suppliers, Purchase Orders, Purchase Receipts, Payment Entries,
// Activity Log, Communications.

export const supplierStatusEnum = pgEnum("supplier_status", [
  "active",
  "on_hold",
  "blocked",
]);

export const suppliers = pgTable(
  "suppliers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    supplierCode: text("supplier_code").notNull(),
    name: text("name").notNull(),
    contactName: text("contact_name"),
    phone: text("phone"),
    email: text("email"),
    gstin: text("gstin"),
    pan: text("pan"),
    address: jsonb("address"),
    paymentTerms: text("payment_terms"), // e.g. "Net 30"
    status: supplierStatusEnum("status").notNull().default("active"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    codeIdx: uniqueIndex("suppliers_code_idx").on(t.supplierCode),
    nameIdx: index("suppliers_name_idx").on(t.name),
  })
);

export const purchaseOrderStatusEnum = pgEnum("purchase_order_status", [
  "draft",
  "submitted",
  "partially_received",
  "received",
  "cancelled",
]);

export const purchaseOrders = pgTable(
  "purchase_orders",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    poNumber: text("po_number").notNull(),
    supplierId: uuid("supplier_id")
      .notNull()
      .references(() => suppliers.id),
    status: purchaseOrderStatusEnum("status").notNull().default("draft"),
    orderDate: date("order_date").notNull(),
    expectedDate: date("expected_date"),
    subtotal: integer("subtotal").notNull().default(0), // paise
    taxTotal: integer("tax_total").notNull().default(0),
    grandTotal: integer("grand_total").notNull().default(0),
    notes: text("notes"),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    numberIdx: uniqueIndex("po_number_idx").on(t.poNumber),
    supplierIdx: index("po_supplier_idx").on(t.supplierId),
    statusIdx: index("po_status_idx").on(t.status),
  })
);

export const purchaseOrderItems = pgTable(
  "purchase_order_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    poId: uuid("po_id")
      .notNull()
      .references(() => purchaseOrders.id, { onDelete: "cascade" }),
    variantId: uuid("variant_id").references(() => productVariants.id),
    description: text("description").notNull(), // free-form fallback
    qty: integer("qty").notNull(),
    receivedQty: integer("received_qty").notNull().default(0),
    unitPrice: integer("unit_price").notNull(), // paise
    total: integer("total").notNull(),
  },
  (t) => ({
    poIdx: index("po_items_po_idx").on(t.poId),
  })
);

export const purchaseReceipts = pgTable(
  "purchase_receipts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    receiptNumber: text("receipt_number").notNull(),
    poId: uuid("po_id").references(() => purchaseOrders.id),
    supplierId: uuid("supplier_id")
      .notNull()
      .references(() => suppliers.id),
    warehouseId: uuid("warehouse_id")
      .notNull()
      .references(() => warehouses.id),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    notes: text("notes"),
    createdBy: uuid("created_by"),
  },
  (t) => ({
    numIdx: uniqueIndex("receipts_num_idx").on(t.receiptNumber),
    poIdx: index("receipts_po_idx").on(t.poId),
  })
);

export const purchaseReceiptItems = pgTable(
  "purchase_receipt_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    receiptId: uuid("receipt_id")
      .notNull()
      .references(() => purchaseReceipts.id, { onDelete: "cascade" }),
    poItemId: uuid("po_item_id").references(() => purchaseOrderItems.id),
    variantId: uuid("variant_id").references(() => productVariants.id),
    description: text("description").notNull(),
    qty: integer("qty").notNull(),
  },
  (t) => ({
    receiptIdx: index("receipt_items_receipt_idx").on(t.receiptId),
  })
);

// ─── Loyalty + Gift Cards ──────────────────────────────────────────

export const loyaltyLedger = pgTable(
  "loyalty_ledger",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    parentId: uuid("parent_id")
      .notNull()
      .references(() => parents.id, { onDelete: "cascade" }),
    delta: integer("delta").notNull(), // +earned, -redeemed
    reason: text("reason").notNull(), // 'order_earned' | 'order_redeemed' | 'expired' | 'manual_adjust'
    refType: text("ref_type"), // 'order' | 'manual'
    refId: text("ref_id"),
    notes: text("notes"),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    parentIdx: index("loyalty_ledger_parent_idx").on(t.parentId, t.createdAt),
  })
);

export const giftCards = pgTable(
  "gift_cards",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    code: text("code").notNull(),
    initialBalance: integer("initial_balance").notNull(), // paise
    currentBalance: integer("current_balance").notNull(), // paise
    issuedToParentId: uuid("issued_to_parent_id").references(() => parents.id),
    issuedToEmail: text("issued_to_email"),
    issuedToPhone: text("issued_to_phone"),
    issuedAt: timestamp("issued_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    status: text("status").notNull().default("active"), // active | redeemed | expired | cancelled
    notes: text("notes"),
    createdBy: uuid("created_by"),
  },
  (t) => ({
    codeIdx: uniqueIndex("gift_cards_code_idx").on(t.code),
    statusIdx: index("gift_cards_status_idx").on(t.status),
  })
);

export const giftCardRedemptions = pgTable(
  "gift_card_redemptions",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    giftCardId: uuid("gift_card_id")
      .notNull()
      .references(() => giftCards.id, { onDelete: "cascade" }),
    orderId: uuid("order_id"),
    amount: integer("amount").notNull(), // paise
    redeemedAt: timestamp("redeemed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    cardIdx: index("gift_card_redemptions_card_idx").on(t.giftCardId),
  })
);

// ─── Notification rules + outbound webhooks ────────────────────────

export const notificationRules = pgTable(
  "notification_rules",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    eventType: text("event_type").notNull(),
    channel: text("channel").notNull(),
    recipientType: text("recipient_type").notNull(),
    templateId: text("template_id"),
    subject: text("subject"),
    bodyTemplate: text("body_template"),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    eventIdx: index("notification_rules_event_idx").on(t.eventType, t.enabled),
  })
);

export const webhookEndpoints = pgTable("webhook_endpoints", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  url: text("url").notNull(),
  secret: text("secret").notNull(),
  events: text("events").array().notNull().default(sql`'{}'::text[]`),
  enabled: boolean("enabled").notNull().default(true),
  lastDeliveryAt: timestamp("last_delivery_at", { withTimezone: true }),
  lastStatus: integer("last_status"),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    endpointId: uuid("endpoint_id")
      .notNull()
      .references(() => webhookEndpoints.id, { onDelete: "cascade" }),
    event: text("event").notNull(),
    payload: jsonb("payload").notNull(),
    status: integer("status"),
    responseBody: text("response_body"),
    attempt: integer("attempt").notNull().default(1),
    nextRetryAt: timestamp("next_retry_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  },
  (t) => ({
    endpointIdx: index("webhook_deliveries_endpoint_idx").on(
      t.endpointId,
      t.createdAt
    ),
  })
);

// ─── Mode of Payment master ─────────────────────────────────────────

export const modesOfPayment = pgTable(
  "modes_of_payment",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    type: text("type").notNull(), // 'cash' | 'bank' | 'gateway'
    enabled: boolean("enabled").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => ({
    codeIdx: uniqueIndex("modes_of_payment_code_idx").on(t.code),
  })
);

// ─── Customer Group master ─────────────────────────────────────────

export const customerGroups = pgTable(
  "customer_groups",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => ({
    codeIdx: uniqueIndex("customer_groups_code_idx").on(t.code),
  })
);

// ─── Purchase Invoice (supplier-side counterpart of customer Sales Invoice) ─

export const purchaseInvoiceStatusEnum = pgEnum("purchase_invoice_status", [
  "draft",
  "submitted",
  "paid",
  "partly_paid",
  "cancelled",
]);

export const purchaseInvoices = pgTable(
  "purchase_invoices",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    invoiceNumber: text("invoice_number").notNull(), // our internal number
    supplierInvoiceNumber: text("supplier_invoice_number"), // bill # from supplier
    supplierInvoiceDate: date("supplier_invoice_date"),
    supplierId: uuid("supplier_id")
      .notNull()
      .references(() => suppliers.id),
    poId: uuid("po_id").references(() => purchaseOrders.id),
    receiptId: uuid("receipt_id").references(() => purchaseReceipts.id),
    postingDate: date("posting_date").notNull(),
    dueDate: date("due_date"),
    subtotal: integer("subtotal").notNull().default(0),
    taxTotal: integer("tax_total").notNull().default(0),
    grandTotal: integer("grand_total").notNull().default(0),
    outstandingAmount: integer("outstanding_amount").notNull().default(0),
    status: purchaseInvoiceStatusEnum("status").notNull().default("draft"),
    notes: text("notes"),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    numIdx: uniqueIndex("purchase_invoices_num_idx").on(t.invoiceNumber),
    supplierIdx: index("purchase_invoices_supplier_idx").on(t.supplierId),
    statusIdx: index("purchase_invoices_status_idx").on(t.status),
  })
);

export const purchaseInvoiceItems = pgTable(
  "purchase_invoice_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => purchaseInvoices.id, { onDelete: "cascade" }),
    poItemId: uuid("po_item_id").references(() => purchaseOrderItems.id),
    variantId: uuid("variant_id").references(() => productVariants.id),
    description: text("description").notNull(),
    qty: integer("qty").notNull(),
    unitPrice: integer("unit_price").notNull(),
    taxAmount: integer("tax_amount").notNull().default(0),
    total: integer("total").notNull(),
  },
  (t) => ({
    invIdx: index("purchase_invoice_items_inv_idx").on(t.invoiceId),
  })
);

export const paymentMethodEnum = pgEnum("payment_method", [
  "cash",
  "upi",
  "card",
  "netbanking",
  "wallet",
  "razorpay",
  "ccavenue",
  "bank_transfer",
  "cheque",
  "other",
]);

export const paymentDirectionEnum = pgEnum("payment_direction", [
  "received", // from customer
  "paid",     // refund or to supplier
]);

export const paymentEntries = pgTable(
  "payment_entries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    paymentNumber: text("payment_number").notNull(),
    direction: paymentDirectionEnum("direction").notNull(),
    method: paymentMethodEnum("method").notNull(),
    amount: integer("amount").notNull(), // paise
    parentId: uuid("parent_id").references(() => parents.id),
    supplierId: uuid("supplier_id").references(() => suppliers.id),
    invoiceId: uuid("invoice_id").references(() => invoices.id),
    orderId: uuid("order_id").references(() => orders.id),
    poId: uuid("po_id").references(() => purchaseOrders.id),
    referenceNumber: text("reference_number"), // bank txn id, cheque #, gateway payment id
    paymentDate: date("payment_date").notNull(),
    notes: text("notes"),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    numIdx: uniqueIndex("payment_entries_num_idx").on(t.paymentNumber),
    parentIdx: index("payment_entries_parent_idx").on(t.parentId),
    invoiceIdx: index("payment_entries_invoice_idx").on(t.invoiceId),
  })
);

export const activityLog = pgTable(
  "activity_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    actorId: uuid("actor_id"),
    actorEmail: text("actor_email"),
    actorName: text("actor_name"),
    actorRole: text("actor_role"),
    action: text("action").notNull(), // 'product.update' | 'order.confirm' | ...
    entityType: text("entity_type").notNull(), // 'product' | 'order' | ...
    entityId: text("entity_id"),
    summary: text("summary"),
    // Structured per-field changes: [{ field, label?, old, new }]. Drives the
    // Old → New audit table. `diff` stays for free-form snapshot payloads.
    changes: jsonb("changes"),
    diff: jsonb("diff"),
    remarks: text("remarks"),
    ip: text("ip"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    actorIdx: index("activity_log_actor_idx").on(t.actorId),
    entityIdx: index("activity_log_entity_idx").on(t.entityType, t.entityId),
    createdIdx: index("activity_log_created_idx").on(t.createdAt),
  })
);

export const communicationKindEnum = pgEnum("communication_kind", [
  "call",
  "sms",
  "email",
  "whatsapp",
  "note",
]);

export const communications = pgTable(
  "communications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    parentId: uuid("parent_id").references(() => parents.id),
    supplierId: uuid("supplier_id").references(() => suppliers.id),
    kind: communicationKindEnum("kind").notNull(),
    subject: text("subject"),
    body: text("body").notNull(),
    direction: text("direction").notNull().default("outbound"), // 'inbound' | 'outbound'
    actorId: uuid("actor_id"),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    parentIdx: index("comms_parent_idx").on(t.parentId),
    supplierIdx: index("comms_supplier_idx").on(t.supplierId),
    occurredIdx: index("comms_occurred_idx").on(t.occurredAt),
  })
);

// Relations for new tables (kept minimal to avoid bloating)
export const suppliersRelations = relations(suppliers, ({ many }) => ({
  purchaseOrders: many(purchaseOrders),
  paymentEntries: many(paymentEntries),
}));

export const purchaseOrdersRelations = relations(
  purchaseOrders,
  ({ one, many }) => ({
    supplier: one(suppliers, {
      fields: [purchaseOrders.supplierId],
      references: [suppliers.id],
    }),
    items: many(purchaseOrderItems),
  })
);

export const purchaseOrderItemsRelations = relations(
  purchaseOrderItems,
  ({ one }) => ({
    po: one(purchaseOrders, {
      fields: [purchaseOrderItems.poId],
      references: [purchaseOrders.id],
    }),
    variant: one(productVariants, {
      fields: [purchaseOrderItems.variantId],
      references: [productVariants.id],
    }),
  })
);

// ──────────────────── School color map (per-school letter → swatch) ────
// Replaces the legacy `schools.color_map` JSONB blob with a proper table.
// Variant codes embed a single-letter color; this table resolves it to a
// human label + optional hex swatch for the storefront and admin UIs.
export const schoolColorMap = pgTable(
  "school_color_map",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    schoolId: uuid("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    letter: text("letter").notNull(),
    label: text("label").notNull(),
    hex: text("hex"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    schoolLetterIdx: uniqueIndex("school_color_map_school_letter_idx").on(
      t.schoolId,
      t.letter
    ),
  })
);

// ──────────────────── Numbering counters (atomic) ─────────────────────
// One row per (prefix, period). Allocator does:
//   INSERT … ON CONFLICT (prefix, period) DO UPDATE SET value = counter + 1 RETURNING value
// which is a single round-trip, no row-level locks held across the request,
// and no COUNT(*) hot-spot. period is e.g. "2026" for orders, "26-27" for FY-scoped.
export const numberingCounters = pgTable(
  "numbering_counters",
  {
    prefix: varchar("prefix", { length: 32 }).notNull(),
    period: varchar("period", { length: 16 }).notNull(),
    value: integer("value").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.prefix, t.period] }),
  })
);

// ════════════════════════════════════════════════════════════════════
// Network + People masters (formerly erp_*, merged in commit-this-session)
// ════════════════════════════════════════════════════════════════════

export const guardians = pgTable(
  "guardians",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    erpName: text("erp_name"),
    guardianName: text("guardian_name"),
    emailAddress: text("email_address"),
    mobileNumber: text("mobile_number"),
    email: text("email"),
    alternateNumber: text("alternate_number"),
    dateOfBirth: text("date_of_birth"),
    raw: jsonb("raw"),
    erpModified: timestamp("erp_modified", { withTimezone: true }),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
    // Every ERPNext Guardian DocType ID that's been folded into this
    // master row by the phone-canonical dedup. Mirrors the same column
    // on student_guardian_links — see migration 0021.
    knownErpNames: text("known_erp_names").array().notNull().default(sql`'{}'::text[]`),
  },
  (t) => ({
    erpNameIdx: uniqueIndex("guardians_erp_name_idx").on(t.erpName),
    nameIdx: index("guardians_name_idx").on(t.guardianName),
    mobileIdx: index("guardians_mobile_idx").on(t.mobileNumber),
  })
);

export const grades = pgTable(
  "grades",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    erpName: text("erp_name"),
    gradeName: text("grade_name"),
    gradeCode: text("grade_code"),
    status: text("status"),
    raw: jsonb("raw"),
    erpModified: timestamp("erp_modified", { withTimezone: true }),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    erpNameIdx: uniqueIndex("grades_erp_name_idx").on(t.erpName),
    statusIdx: index("grades_status_idx").on(t.status),
  })
);

export const schoolCoordinators = pgTable(
  "school_coordinators",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    schoolId: uuid("school_id").notNull().references(() => schools.id, { onDelete: "cascade" }),
    rowIdx: integer("row_idx").notNull(),
    pocName: text("poc_name"),
    email: text("email"),
    contactNumber: text("contact_number"),
    alternateNumber: text("alternate_number"),
    role: text("role"),
    raw: jsonb("raw"),
  },
  (t) => ({
    schoolIdx: index("school_coordinators_school_idx").on(t.schoolId),
  })
);

export const schoolGradeMappings = pgTable(
  "school_grade_mappings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    schoolId: uuid("school_id").notNull().references(() => schools.id, { onDelete: "cascade" }),
    rowIdx: integer("row_idx").notNull(),
    grade: text("grade"),
    schoolGivenGradeName: text("school_given_grade_name"),
    sections: text("sections"),
    raw: jsonb("raw"),
  },
  (t) => ({
    schoolIdx: index("school_grade_mappings_school_idx").on(t.schoolId),
    // (school_id, lower(grade)) uniqueness is enforced by the SQL migration
    // (functional indexes can't be expressed in drizzle here) — see
    // db/migrations/0023_school_grade_mappings_uq.sql.
  })
);

export const schoolUniformMappings = pgTable(
  "school_uniform_mappings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    schoolId: uuid("school_id").notNull().references(() => schools.id, { onDelete: "cascade" }),
    rowIdx: integer("row_idx").notNull(),
    grade: text("grade"),
    organisationGivenGrade: text("organisation_given_grade"),
    sections: text("sections"),
    organisationGivenSection: text("organisation_given_section"),
    houseName: text("house_name"),
    raw: jsonb("raw"),
  },
  (t) => ({
    schoolIdx: index("school_uniform_mappings_school_idx").on(t.schoolId),
  })
);

export const studentAddresses = pgTable(
  "student_addresses",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    studentId: uuid("student_id").notNull().references(() => students.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    rowIdx: integer("row_idx").notNull(),
    addressType: text("address_type"),
    addressTitle: text("address_title"),
    addressLine1: text("address_line_1"),
    addressLine2: text("address_line_2"),
    city: text("city"),
    state: text("state"),
    country: text("country"),
    pincode: text("pincode"),
    preferred: boolean("preferred").notNull().default(false),
    disabled: boolean("disabled").notNull().default(false),
    raw: jsonb("raw"),
  },
  (t) => ({
    studentIdx: index("student_addresses_student_idx").on(t.studentId),
  })
);

export const studentGuardianLinks = pgTable(
  "student_guardian_links",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    studentId: uuid("student_id").notNull().references(() => students.id, { onDelete: "cascade" }),
    rowIdx: integer("row_idx").notNull(),
    guardianErpName: text("guardian_erp_name"),
    guardianName: text("guardian_name"),
    relation: text("relation"),
    email: text("email"),
    phoneNo: text("phone_no"),
    raw: jsonb("raw"),
    // Every ERPNext Guardian DocType ID that's been collapsed into this
    // row. Phone is the canonical identifier; when ERP ships two
    // Guardian docs for the same phone (e.g. `79927-N VIKRANTH` and
    // `79928-NEERADI VIKRANTH`), the second one folds into the first
    // and its erp_name lands here so the admin can still trace it back.
    knownErpNames: text("known_erp_names").array().notNull().default(sql`'{}'::text[]`),
  },
  (t) => ({
    studentIdx: index("student_guardian_links_student_idx").on(t.studentId),
    guardianRefIdx: index("student_guardian_links_guardian_ref_idx").on(t.guardianErpName),
  })
);

export const studentSiblings = pgTable(
  "student_siblings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    studentId: uuid("student_id").notNull().references(() => students.id, { onDelete: "cascade" }),
    rowIdx: integer("row_idx").notNull(),
    fullName: text("full_name"),
    gender: text("gender"),
    grade: text("grade"),
    section: text("section"),
    dateOfBirth: text("date_of_birth"),
    raw: jsonb("raw"),
  },
  (t) => ({
    studentIdx: index("student_siblings_student_idx").on(t.studentId),
  })
);

export const otpLogs = pgTable(
  "otp_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    phone: varchar("phone", { length: 10 }).notNull(),
    purpose: text("purpose").notNull(), // 'login' | 'first-time' | 'recover-old' | 'recover-new'
    event: text("event").notNull(),     // 'sent' | 'send_failed' | 'verified' | 'verify_failed'
    transactionId: text("transaction_id"),
    otpCode: varchar("otp_code", { length: 6 }),
    error: text("error"),
    ip: text("ip"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    phoneIdx: index("otp_logs_phone_idx").on(t.phone),
    createdIdx: index("otp_logs_created_idx").on(t.createdAt),
  })
);

// One row per order-confirmation send attempt (SMS or email). Never
// updated in place — resends insert a new row with attempt+1, and the
// idempotency guard in lib/order-confirmation.ts checks for an existing
// 'sent' row per (order, channel).
export const orderNotifications = pgTable(
  "order_notifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    orderNumber: text("order_number").notNull(),
    channel: text("channel").notNull(), // 'sms' | 'email'
    kind: text("kind").notNull().default("order_confirmed"),
    recipient: text("recipient").notNull(), // phone or email ('' when missing)
    subject: text("subject"), // email only
    body: text("body"), // exact SMS text / email text body
    status: text("status").notNull(), // 'sent' | 'failed'
    vendorId: text("vendor_id"), // SMS transactionId / SMTP messageId
    error: text("error"),
    attempt: integer("attempt").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    orderIdx: index("order_notifications_order_idx").on(t.orderId),
    createdIdx: index("order_notifications_created_idx").on(t.createdAt),
  })
);

// ─── Website Cart Coupon (mirrors ERPNext doctype) ────────────────────
//
// Source of truth is `Website Cart Coupon` on erp.inventre.in. Every row
// here either originated from ERP (erp_name set, populated by the importer)
// or was created locally — in which case it should be pushed back to ERP
// by the same script on the next sync. The admin UI at /admin/discounts is
// the only place these are managed.
export const websiteCartCoupons = pgTable(
  "website_cart_coupons",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /** ERPNext docname (= coupon_code in practice). NULL until first sync. */
    erpName: text("erp_name"),
    couponCode: text("coupon_code").notNull(),
    isActive: boolean("is_active").notNull().default(true),

    /** Raw ERPNext "name" of the linked School / Student, kept verbatim so
     * we round-trip cleanly even when the local row doesn't exist yet. */
    schoolErpName: text("school_erp_name"),
    schoolId: uuid("school_id").references(() => schools.id, {
      onDelete: "set null",
    }),
    studentErpName: text("student_erp_name"),
    studentId: uuid("student_id").references(() => students.id, {
      onDelete: "set null",
    }),
    /** Local-only scope: when set with school, coupon applies only to that
     * grade within the linked school. ERPNext doctype has no grade field,
     * so this is never pushed/pulled. */
    grade: text("grade"),

    startDatetime: timestamp("start_datetime", { withTimezone: true }),
    endDatetime: timestamp("end_datetime", { withTimezone: true }),

    oneTimeUse: boolean("one_time_use").notNull().default(true),
    canUseMultipleTimes: boolean("can_use_multiple_times")
      .notNull()
      .default(false),

    discountType: websiteCartCouponDiscountTypeEnum("discount_type").notNull(),
    /** Rupees for Fixed, percent for Percentage. */
    discount: numeric("discount", { precision: 12, scale: 2 }).notNull(),
    /** Rupees. 0 = no cap. Only meaningful for Percentage. */
    maximumDiscountAmount: integer("maximum_discount_amount")
      .notNull()
      .default(0),

    erpCreation: timestamp("erp_creation", { withTimezone: true }),
    erpModified: timestamp("erp_modified", { withTimezone: true }),
    erpOwner: text("erp_owner"),
    erpModifiedBy: text("erp_modified_by"),

    usedCount: integer("used_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    erpNameIdx: uniqueIndex("website_cart_coupons_erp_name_idx")
      .on(t.erpName)
      .where(sql`${t.erpName} IS NOT NULL`),
    codeIdx: uniqueIndex("website_cart_coupons_code_idx").on(
      sql`LOWER(${t.couponCode})`,
    ),
    schoolIdx: index("website_cart_coupons_school_idx").on(t.schoolId),
    studentIdx: index("website_cart_coupons_student_idx").on(t.studentId),
    gradeIdx: index("website_cart_coupons_grade_idx").on(t.grade),
  }),
);

/**
 * Per-rule grade scope for ERPNext Delivery Fee Rules. The doctype has no
 * `grade` field and the admin panel does not modify ERPNext schema, so the
 * grade lives here keyed by the ERPNext rule name. Absent row = rule
 * applies to all grades.
 */
/**
 * In-progress PDP / Magic Box selection state per (parent, product,
 * student). Cart-committed picks live in cart_items.bundle_selections;
 * this table is the "before they hit Add to cart" buffer that survives
 * logout/login. See migration 0029_product_drafts.sql.
 *
 * The composite uniqueness is enforced by a partial unique index in SQL
 * (with COALESCE on student_id) — Drizzle's primaryKey can't express
 * that, so we don't declare a primaryKey here.
 */
export const productDrafts = pgTable(
  "product_drafts",
  {
    parentId: uuid("parent_id")
      .notNull()
      .references(() => parents.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    studentId: uuid("student_id").references(() => students.id, {
      onDelete: "cascade",
    }),
    state: jsonb("state").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    parentIdx: index("product_drafts_parent_idx").on(t.parentId),
  })
);

export const deliveryFeeRuleGrades = pgTable("delivery_fee_rule_grades", {
  ruleName: text("rule_name").primaryKey(),
  grade: text("grade").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Local Delivery Fee Rules — replaces the ERPNext "Delivery Fee Rule"
 * doctype after the legacy erp.inventre.in host was retired (2026-05).
 * Shape mirrors the doctype 1:1 so callers in lib/erp/delivery-fee-rules.ts
 * keep their TypeScript signatures. See migration 0033.
 */
export const deliveryFeeRules = pgTable("delivery_fee_rules", {
  /** Stable identifier in the ERPNext-compatible "DFR-{year}-{n}" format. */
  name: text("name").primaryKey(),
  isActive: boolean("is_active").notNull().default(true),
  /** ERPNext name of the scoped school (joins to schools.erp_name). */
  school: text("school").notNull(),
  minAmount: numeric("min_amount", { precision: 12, scale: 2 })
    .notNull()
    .default("0"),
  maxAmount: numeric("max_amount", { precision: 12, scale: 2 })
    .notNull()
    .default("0"),
  deliveryFee: numeric("delivery_fee", { precision: 12, scale: 2 })
    .notNull()
    .default("0"),
  /** Flat array of category strings ("Uniform" | "Books"). */
  applicableItemGroups: jsonb("applicable_item_groups")
    .$type<string[]>()
    .notNull()
    .default([]),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const websiteCartCouponUsages = pgTable(
  "website_cart_coupon_usages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    couponId: uuid("coupon_id")
      .notNull()
      .references(() => websiteCartCoupons.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id").references(() => parents.id, {
      onDelete: "set null",
    }),
    orderId: uuid("order_id").references(() => orders.id, {
      onDelete: "set null",
    }),
    amountSaved: integer("amount_saved").notNull(),
    /** ERPNext Sales Order name (e.g. SAL-ORD-2026-26596) for redemptions
     * imported from erp.inventre.in. NULL for storefront-placed orders. */
    erpSalesOrder: text("erp_sales_order"),
    customerName: text("customer_name"),
    /** Sales Order grand_total in paise. NULL for storefront orders, which
     * reference the local orders table via order_id. */
    orderAmount: integer("order_amount"),
    transactionDate: date("transaction_date"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    couponIdx: index("website_cart_coupon_usages_coupon_idx").on(t.couponId),
    parentIdx: index("website_cart_coupon_usages_parent_idx").on(t.parentId),
    erpSoIdx: uniqueIndex("website_cart_coupon_usages_erp_so_idx")
      .on(t.erpSalesOrder)
      .where(sql`${t.erpSalesOrder} IS NOT NULL`),
  }),
);
