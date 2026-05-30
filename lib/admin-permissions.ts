import type { CurrentAdmin } from "./session";

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
 * Each admin sidebar item declares a `perm` from this list. The matching
 * enum value lives in `admin_role_permissions.permission` and is loaded
 * into the session's `permissions` Set on each request.
 *
 * Adding a new admin tab? Add a key here, add a row for super-admin via
 * SQL, and reference it from the sidebar entry.
 */
export type AdminPermission = {
  key: string;
  label: string;
  group: string;
};

export const ADMIN_PERMISSIONS: AdminPermission[] = [
  { key: "nav:dashboard",            label: "Dashboard",             group: "Overview" },
  { key: "nav:orders",               label: "Orders",                group: "Sales" },
  { key: "nav:shipments",            label: "Shipments",             group: "Sales" },
  { key: "nav:invoices",             label: "Invoices",              group: "Sales" },
  { key: "nav:returns",              label: "Returns",               group: "Sales" },
  { key: "nav:schools",              label: "Schools",               group: "Network" },
  { key: "nav:grades",               label: "Grades",                group: "Network" },
  { key: "nav:delivery-fees",        label: "Delivery fees",         group: "Network" },
  { key: "nav:customers",            label: "Customers (Parents)",   group: "People" },
  { key: "nav:students",             label: "Students",              group: "People" },
  { key: "nav:mcb",                  label: "MCB",                   group: "People" },
  { key: "nav:guardians",            label: "Guardians",             group: "People" },
  { key: "nav:catalog",              label: "Catalog",               group: "Catalog" },
  { key: "nav:discounts",            label: "Discounts",             group: "Pricing & Tax" },
  { key: "nav:tax",                  label: "Tax & GST",             group: "Pricing & Tax" },
  { key: "nav:suppliers",            label: "Suppliers",             group: "Buying" },
  { key: "nav:purchase-orders",      label: "Purchase orders",       group: "Buying" },
  { key: "nav:payments",             label: "Payments",              group: "Accounting" },
  { key: "nav:payments-ccavenue",    label: "CCAvenue Payment Logs", group: "Accounting" },
  { key: "nav:reviews",              label: "Reviews",               group: "Engagement" },
  { key: "nav:testimonials",         label: "Testimonials",          group: "Engagement" },
  { key: "nav:contact-forms",        label: "Contact forms",         group: "Engagement" },
  { key: "nav:gift-cards",           label: "Gift cards",            group: "Engagement" },
  { key: "nav:content",              label: "Pages & blocks",        group: "Content" },
  { key: "nav:import",               label: "Import CSV/XLSX",       group: "Tools" },
  { key: "nav:reports",              label: "Reports",               group: "Tools" },
  { key: "nav:activity",             label: "Activity log",          group: "Tools" },
  { key: "nav:otp-logs",             label: "OTP Logs",              group: "Tools" },
  { key: "nav:settings-users",       label: "Admin users",           group: "Settings" },
  { key: "nav:settings-otp",         label: "SMS / SMTP OTP",        group: "Settings" },
  { key: "nav:settings-erp-bridge",  label: "ERP bridge (live)",     group: "Settings" },
  { key: "nav:roles",                label: "Roles & permissions",   group: "Settings" },
];

export const ADMIN_PERMISSION_KEYS: ReadonlySet<string> = new Set(
  ADMIN_PERMISSIONS.map((p) => p.key),
);

export const ADMIN_PERMISSION_GROUPS: readonly string[] = [
  "Overview", "Sales", "Network", "People", "Catalog",
  "Pricing & Tax", "Buying", "Accounting", "Engagement",
  "Content", "Tools", "Settings",
];
