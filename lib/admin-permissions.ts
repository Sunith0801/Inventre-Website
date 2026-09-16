import type { CurrentAdmin } from "@/server/session";

export type AdminRole = CurrentAdmin["role"];

export function isReadOnlyAdmin(role: AdminRole): boolean {
  return role === "school_admin";
}

export function canWriteAsAdmin(role: AdminRole): boolean {
  return !isReadOnlyAdmin(role);
}

/**
 * Single source of truth for admin nav permission keys.
 *
 * Each admin page declares a `slug` (e.g. "orders"). Permissions come in
 * two flavours per page:
 *
 *   <slug>.read   — render the page and any GET data; sidebar visibility.
 *   <slug>.write  — perform mutations (POST/PATCH/PUT/DELETE) and render
 *                   create/edit/delete UI affordances.
 *
 * The DB stores these strings literally in `admin_role_permissions.permission`
 * and `admin_user_permissions.permission`. Session loads them into
 * `CurrentAdmin.permissions` Set; runtime gates use `requirePermission(key)`
 * for APIs and `hasPermission(me, key)` / `canSeePage(me, slug)` for UI.
 *
 * Adding a new admin page:
 *   1. Add a row below with `slug`, `label`, `group`.
 *   2. The migration adds `slug.read` + `slug.write` to super-admin
 *      automatically — none needed for existing system roles.
 *   3. Reference `slug` from the sidebar (AdminShell.tsx) `pageSlug` field.
 */
export type AdminPage = {
  /** URL-safe page identifier, e.g. "orders", "settings-users". */
  slug: string;
  /** Human label shown in the role/permissions editor and sidebar. */
  label: string;
  /** Grouping bucket for the editor UI. */
  group: string;
};

export const ADMIN_PAGES: AdminPage[] = [
  { slug: "dashboard",            label: "Dashboard",             group: "Overview" },
  { slug: "orders",               label: "Orders",                group: "Sales" },
  { slug: "shipments",            label: "Shipments",             group: "Sales" },
  { slug: "invoices",             label: "Invoices",              group: "Sales" },
  { slug: "returns",              label: "Returns",               group: "Sales" },
  { slug: "schools",              label: "Schools",               group: "Network" },
  { slug: "grades",               label: "Grades",                group: "Network" },
  { slug: "delivery-fees",        label: "Delivery fees",         group: "Network" },
  { slug: "customers",            label: "Customers (Parents)",   group: "People" },
  { slug: "students",             label: "Students",              group: "People" },
  { slug: "mcb",                  label: "MCB",                   group: "People" },
  // Lives outside /admin (see PAGE_HREF_OVERRIDES): a standalone dashboard
  // with its own art direction and no admin chrome. It exists as its own
  // permission so a fee-desk account can be given the ledger and NOTHING
  // else — "mcb.read" would also open MCB master data.
  { slug: "fees",                 label: "Fee ledger",            group: "People" },
  // Account management for the fee ledger only — NOT settings-users, which
  // reaches every staff admin. See lib/fees-users.ts.
  { slug: "fees-users",           label: "Fee ledger access",     group: "People" },
  { slug: "guardians",            label: "Guardians",             group: "People" },
  // Catalog is a FAMILY. `catalog` itself is the hub page and the preview;
  // each module beneath it is its own key, so a stock clerk can be given
  // Stock without Products, and a merchandiser Products without Pricing.
  // Migration 0076 fans existing `catalog.*` grants onto every module so the
  // split changes nobody's access on the day it lands.
  { slug: "catalog",              label: "Catalog overview",      group: "Catalog" },
  { slug: "products",             label: "Products",              group: "Catalog" },
  { slug: "boms",                 label: "BOMs",                  group: "Catalog" },
  { slug: "categories",           label: "Categories",            group: "Catalog" },
  { slug: "catalog-attributes",   label: "Attributes",            group: "Catalog" },
  { slug: "catalog-bundles",      label: "Bundles",               group: "Catalog" },
  { slug: "catalog-build",        label: "Build (bookkit / uniform)", group: "Catalog" },
  { slug: "catalog-pricing",      label: "Pricing",               group: "Catalog" },
  { slug: "catalog-setup",        label: "School setup",          group: "Catalog" },
  { slug: "catalog-stock",        label: "Stock",                 group: "Catalog" },
  { slug: "discounts",            label: "Discounts",             group: "Pricing & Tax" },
  { slug: "payment-charges",      label: "Payment charges",       group: "Payment Charges" },
  // Gateway (CCAvenue) transactions — every online checkout.
  // `payments-ccavenue.*` grants were folded into this key by migration 0082.
  { slug: "payments",             label: "Payments (gateway)",    group: "Accounting" },
  // The manual ledger: cheques, bank transfers, cash and refunds recorded by
  // hand. Its own module so a cashier can be given it without the gateway log.
  { slug: "payment-entries",      label: "Manual payment entries", group: "Accounting" },
  { slug: "reviews",              label: "Reviews",               group: "Engagement" },
  { slug: "contact-forms",        label: "Inquiries",             group: "Engagement" },
  // Testimonials moved under this key (migration 0077): they are homepage
  // copy like the hero and the FAQs, edited from the same content hub.
  { slug: "content",              label: "Pages & content blocks", group: "Content" },
  { slug: "import",               label: "Import CSV/XLSX",       group: "Tools" },
  { slug: "reports",              label: "Reports",               group: "Tools" },
  { slug: "activity",             label: "Activity log",          group: "Tools" },
  { slug: "otp-logs",             label: "OTP Logs",              group: "Tools" },
  { slug: "order-notifications",  label: "Order Notifications",   group: "Tools" },
  { slug: "settings-users",       label: "Admin users",           group: "Settings" },
  { slug: "settings-otp",         label: "SMS / SMTP OTP",        group: "Settings" },
  { slug: "settings-erp-bridge",  label: "ERP bridge (live)",     group: "Settings" },
  { slug: "roles",                label: "Roles & permissions",   group: "Settings" },
];

export type AdminPermissionAction = "read" | "write";

export const ADMIN_PERMISSION_GROUPS: readonly string[] = [
  "Overview", "Sales", "Network", "People", "Catalog",
  "Pricing & Tax", "Payment Charges", "Accounting",
  "Engagement", "Content", "Tools", "Settings",
];

export const readKey = (slug: string): string => `${slug}.read`;
export const writeKey = (slug: string): string => `${slug}.write`;

/** Split a permission key like "orders.write" into ("orders", "write"). */
export function parsePermissionKey(
  key: string,
): { slug: string; action: AdminPermissionAction } | null {
  const dot = key.lastIndexOf(".");
  if (dot <= 0 || dot === key.length - 1) return null;
  const slug = key.slice(0, dot);
  const action = key.slice(dot + 1);
  if (action !== "read" && action !== "write") return null;
  return { slug, action };
}

/** All valid permission keys, as a frozen Set for cheap registry checks
 *  (e.g. `if (!ADMIN_PERMISSION_KEYS.has(p)) return 400`). */
export const ADMIN_PERMISSION_KEYS: ReadonlySet<string> = (() => {
  const s = new Set<string>();
  for (const p of ADMIN_PAGES) {
    s.add(readKey(p.slug));
    s.add(writeKey(p.slug));
  }
  return s;
})();

/** Pages indexed by slug for cheap label/group lookup. */
export const ADMIN_PAGE_BY_SLUG: ReadonlyMap<string, AdminPage> = new Map(
  ADMIN_PAGES.map((p) => [p.slug, p]),
);

/**
 * "Can this admin see the page at all?" — true if they hold either
 * read or write. Drives sidebar visibility and the top-of-page gate that
 * decides between "render page" and "redirect away".
 */
export function canSeePage(
  perms: ReadonlySet<string>,
  slug: string,
): boolean {
  return perms.has(readKey(slug)) || perms.has(writeKey(slug));
}

/**
 * Slug → URL for the handful of pages whose route path doesn't match
 * `/admin/<slug>`. Everything else falls through to the default below.
 */
const PAGE_HREF_OVERRIDES: Readonly<Record<string, string>> = {
  "delivery-fees": "/admin/delivery-fee-rules",
  "catalog-attributes": "/admin/catalog/attributes",
  "catalog-bundles": "/admin/catalog/bundles",
  "catalog-build": "/admin/catalog/build",
  "catalog-pricing": "/admin/catalog/pricing",
  "catalog-setup": "/admin/catalog/setup",
  "catalog-stock": "/admin/catalog/stock",
  "settings-users": "/admin/settings/users",
  "settings-otp": "/admin/settings/otp",
  "settings-erp-bridge": "/admin/settings/erp-bridge",
  "payment-entries": "/admin/payments/entries",
  fees: "/fees",
  "fees-users": "/fees/users",
};

/** The admin URL for a page slug (e.g. "orders" → "/admin/orders"). */
export function pageHref(slug: string): string {
  return PAGE_HREF_OVERRIDES[slug] ?? `/admin/${slug}`;
}

/**
 * Slugs that are NOT valid landing targets: action-only pages reached from
 * elsewhere (e.g. "Raise exchange" opens from an order detail with an
 * ?orderId=… param and shows a dead-end placeholder without it). They hold
 * a permission but have no sidebar entry, so a user should never be dropped
 * on them as their post-login home.
 */
const NON_LANDING_SLUGS: ReadonlySet<string> = new Set([]);

/**
 * Path of the first browsable page (in ADMIN_PAGES order) this admin is
 * allowed to see. Used as the post-login landing and as the safe fallback
 * when a user hits a page they can't access — so a restricted admin is
 * never redirected to a page that redirects them straight back (the
 * /admin/dashboard self-redirect loop) or to a dead-end action page.
 * Returns null when the admin can see no landable pages at all.
 */
export function firstAccessiblePath(
  perms: ReadonlySet<string>,
): string | null {
  for (const p of ADMIN_PAGES) {
    if (NON_LANDING_SLUGS.has(p.slug)) continue;
    if (canSeePage(perms, p.slug)) return pageHref(p.slug);
  }
  return null;
}

/** "Can this admin mutate on the page?" — true iff they hold .write. */
export function canWritePage(
  perms: ReadonlySet<string>,
  slug: string,
): boolean {
  return perms.has(writeKey(slug));
}

/* ─── Back-compat shim ──────────────────────────────────────────────
 * The PRE-0046 sidebar code used `perm: "nav:<slug>"` strings + the
 * registry below. New code uses `pageSlug: "<slug>"` and the helpers
 * above. Leaving the shim until every AdminShell entry is migrated.
 */
export type AdminPermission = {
  key: string;
  label: string;
  group: string;
};
export const ADMIN_PERMISSIONS: AdminPermission[] = ADMIN_PAGES.map((p) => ({
  key: `nav:${p.slug}`,
  label: p.label,
  group: p.group,
}));
