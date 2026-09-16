import type * as React from "react";
import {
  LayoutDashboard,
  School,
  Package,
  ListTree,
  ShoppingBag,
  Users,
  MessageSquareQuote,
  Star,
  Image as ImageIcon,
  Settings,
  Truck,
  FileText,
  Tag,
  Boxes,
  IndianRupee,
  Receipt,
  PackageOpen,
  Layers,
  BarChart3,
  Upload,
  GraduationCap,
  Library,
  ClipboardList,
  CreditCard,
  Activity,
  MessageSquare,
  Eye,
  KeyRound,
  Wallet,
  Inbox,
  Send,
  LifeBuoy,
} from "lucide-react";
import { canSeePage } from "@/lib/admin-permissions";

/**
 * The admin information architecture — one place for the sidebar, the
 * section landing pages and the in-section module strip. Sections carry
 * the enterprise names; hrefs and permission keys are the original ones.
 */
export type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Permission key from lib/admin-permissions.ts. Item is hidden when
   *  the current admin's permissions Set doesn't include it. Omit to
   *  always show (rare — used only for items pre-RBAC). */
  perm?: string;
  /** Show when the admin holds ANY of these slugs — for a hub item whose
   *  modules are permissioned individually (Catalog). */
  anyOf?: readonly string[];
};

export type NavSection = {
  /** URL segment of the section landing page: /admin/sections/<slug>. */
  slug: string;
  kicker: string;
  icon: React.ComponentType<{ className?: string }>;
  description: string;
  items: NavItem[];
};

export const navSections: NavSection[] = [
  {
    slug: "overview",
    kicker: "Overview & Analytics",
    icon: LayoutDashboard,
    description: "Your daily snapshot, plus reports across sales, students and operations.",
    items: [
      { href: "/admin/dashboard", label: "Dashboard", icon: LayoutDashboard, perm: "nav:dashboard" },
      { href: "/admin/reports",   label: "Reports",   icon: BarChart3,       perm: "nav:reports" },
    ],
  },
  {
    slug: "sales",
    kicker: "Sales & Distribution",
    icon: ShoppingBag,
    description: "Orders, fulfilment, invoicing and returns.",
    items: [
      { href: "/admin/orders",    label: "Sales Orders",    icon: ShoppingBag, perm: "nav:orders" },
      { href: "/admin/shipments", label: "Shipments", icon: Truck,       perm: "nav:shipments" },
      { href: "/admin/invoices",  label: "Invoices",  icon: FileText,    perm: "nav:invoices" },
      { href: "/admin/returns",   label: "Returns",   icon: PackageOpen, perm: "nav:returns" },
    ],
  },
  {
    slug: "master-data",
    kicker: "Master Data",
    icon: Library,
    description: "The complete record of every school, grade, customer, student and guardian. Read-only.",
    items: [
      { href: "/admin/master-data/schools",   label: "Schools",             icon: School,        perm: "nav:schools" },
      { href: "/admin/master-data/grades",    label: "Grades",              icon: GraduationCap, perm: "nav:grades" },
      { href: "/admin/master-data/customers", label: "Customers (Parents)", icon: Users,         perm: "nav:customers" },
      { href: "/admin/master-data/students",  label: "Students",            icon: GraduationCap, perm: "nav:students" },
      { href: "/admin/master-data/guardians", label: "Guardians",           icon: Users,         perm: "nav:guardians" },
    ],
  },
  {
    slug: "crm",
    kicker: "Customer Relationship (CRM)",
    icon: Users,
    description: "Create and edit schools, grades, parents, students and guardians.",
    items: [
      { href: "/admin/customers", label: "Customers (Parents)", icon: Users,         perm: "nav:customers" },
      { href: "/admin/students",  label: "Students",            icon: GraduationCap, perm: "nav:students" },
      { href: "/admin/guardians", label: "Guardians",           icon: Users,         perm: "nav:guardians" },
      { href: "/admin/mcb",       label: "Fee Portal Sync (MCB)",                 icon: Wallet,        perm: "nav:mcb" },
    ],
  },
  {
    // One door for catalog. The Catalog page is the Shop Preview — pick
    // (school, grade, new/returning) and see what parents see. Deep
    // editors (Products, BOMs, Pricing, Stock, etc.) are linked from
    // within that page so the sidebar stays uncluttered and there's no
    // "which tab do I click first?" confusion.
    // ── The catalogue, regrouped around how the team works (2026-09-16):
    // Products (things that are sold) · Catalog (schools, grades, setup) ·
    // Bundles (kits and boxes) · Pricing & Tax · Inventory · Website.
    slug: "catalog",
    kicker: "Products",
    icon: Package,
    description: "Everything that can be sold — create it, find it, describe it.",
    items: [
      { href: "/admin/products/new",       label: "Create Product",  icon: Upload,   perm: "nav:catalog-build", anyOf: ["catalog-build", "catalog"] },
      { href: "/admin/products",           label: "All Products",    icon: Package,  perm: "nav:products", anyOf: ["products", "catalog"] },
      { href: "/admin/products?kind=uniform", label: "Uniforms",     icon: Package,  perm: "nav:products", anyOf: ["products", "catalog"] },
      { href: "/admin/products?kind=book", label: "Book kit items",  icon: Library,  perm: "nav:products", anyOf: ["products", "catalog"] },
      { href: "/admin/categories",         label: "Categories",      icon: ListTree, perm: "nav:categories", anyOf: ["categories", "catalog"] },
      { href: "/admin/catalog/attributes", label: "Attributes",      icon: Layers,   perm: "nav:catalog-attributes", anyOf: ["catalog-attributes", "catalog"] },
    ],
  },
  {
    slug: "catalog-setup",
    kicker: "Catalog",
    icon: School,
    description: "Which schools and grades exist, and what each one's catalogue looks like.",
    items: [
      { href: "/admin/schools",       label: "Schools",      icon: School,        perm: "nav:schools" },
      { href: "/admin/grades",        label: "Grades",       icon: GraduationCap, perm: "nav:grades" },
      { href: "/admin/catalog/setup", label: "School Setup", icon: School,        perm: "nav:catalog-setup", anyOf: ["catalog-setup", "catalog"] },
      { href: "/admin/catalog",       label: "Shop Preview", icon: Eye,           perm: "nav:catalog" },
    ],
  },
  {
    slug: "bundles",
    kicker: "Bundles",
    icon: Boxes,
    description: "Book kits and Magic boxes, and what goes inside them.",
    items: [
      { href: "/admin/products?kind=kit",       label: "Book kits",        icon: Library,        perm: "nav:products", anyOf: ["products", "catalog"] },
      { href: "/admin/products?kind=magic_box", label: "Magic boxes",      icon: Boxes,          perm: "nav:products", anyOf: ["products", "catalog"] },
      { href: "/admin/catalog/bundles",         label: "Bundle contents",  icon: Boxes,          perm: "nav:catalog-bundles", anyOf: ["catalog-bundles", "catalog"] },
      { href: "/admin/boms",                    label: "Bills of Materials", icon: ClipboardList, perm: "nav:boms", anyOf: ["boms", "catalog"] },
    ],
  },
  {
    slug: "pricing",
    kicker: "Pricing & Tax",
    icon: Tag,
    description: "Price lists, discounts, delivery fees and payment surcharges.",
    items: [
      { href: "/admin/catalog/pricing",    label: "Price Lists",           icon: IndianRupee, perm: "nav:catalog-pricing", anyOf: ["catalog-pricing", "catalog"] },
      { href: "/admin/discounts",          label: "Discounts & Promotions", icon: Tag,        perm: "nav:discounts" },
      { href: "/admin/delivery-fee-rules", label: "Delivery Fee Rules",    icon: Truck,       perm: "nav:delivery-fees" },
      { href: "/admin/payment-charges",    label: "Payment Surcharges",    icon: IndianRupee, perm: "nav:payment-charges" },
    ],
  },
  {
    slug: "inventory",
    kicker: "Inventory",
    icon: Truck,
    description: "What is on the shelf — counted by the audit ERP, mirrored here.",
    items: [
      { href: "/admin/catalog/stock", label: "Stock",        icon: Truck, perm: "nav:catalog-stock", anyOf: ["catalog-stock", "catalog"] },
      // The audit ERP's shelf count, mirrored into bins every 5 minutes; its
      // layout gates on `catalog` like the prod branch it came from.
      { href: "/admin/ground-stock",  label: "Ground Stock", icon: Boxes, perm: "nav:catalog" },
    ],
  },
  {
    slug: "website",
    kicker: "Website",
    icon: Eye,
    description: "What parents can see right now, what is still in draft, and a preview.",
    items: [
      { href: "/admin/products?status=active", label: "Published", icon: Eye,     perm: "nav:products", anyOf: ["products", "catalog"] },
      { href: "/admin/products?status=draft",  label: "Drafts",    icon: Package, perm: "nav:products", anyOf: ["products", "catalog"] },
      { href: "/admin/catalog",                label: "Preview",   icon: Eye,     perm: "nav:catalog" },
    ],
  },
  {
    slug: "finance",
    kicker: "Finance",
    icon: CreditCard,
    description: "Gateway (CCAvenue) transactions and the manual payment ledger.",
    items: [
      { href: "/admin/payments",         label: "Payments",       icon: CreditCard, perm: "nav:payments" },
      { href: "/admin/payments/entries", label: "Manual Entries", icon: Receipt,    perm: "nav:payment-entries" },
    ],
  },
  {
    slug: "engagement",
    kicker: "Engagement & Content",
    icon: LifeBuoy,
    description: "Product reviews, inquiries and site content.",
    items: [
      { href: "/admin/reviews",       label: "Product Reviews",       icon: Star,                perm: "nav:reviews" },
      { href: "/admin/contact-forms", label: "Inquiries", icon: Inbox,               perm: "nav:contact-forms" },
      // Testimonials are a sub-module of the content hub (/admin/content/testimonials).
      { href: "/admin/content",       label: "Pages & Content Blocks", icon: ImageIcon, perm: "nav:content" },
    ],
  },
  {
    slug: "administration",
    kicker: "Administration",
    icon: KeyRound,
    description: "Users, roles, permissions and the audit trail.",
    items: [
      { href: "/admin/settings/users",       label: "Users",             icon: Settings, perm: "nav:settings-users" },
      { href: "/admin/roles",                label: "Roles & Permissions", icon: KeyRound, perm: "nav:roles" },
      { href: "/admin/activity", label: "Activity Log",    icon: Activity,      perm: "nav:activity" },
    ],
  },
  {
    slug: "system",
    kicker: "System Configuration",
    icon: Settings,
    description: "Messaging channels, delivery logs and the ERP integration.",
    items: [
      { href: "/admin/settings/otp",         label: "Messaging Channels (SMS / SMTP OTP)",    icon: KeyRound, perm: "nav:settings-otp" },
      { href: "/admin/otp-logs", label: "OTP Delivery Logs",        icon: MessageSquare, perm: "nav:otp-logs" },
      { href: "/admin/order-notifications", label: "Order Notification Logs", icon: Send, perm: "nav:order-notifications" },
      { href: "/admin/settings/erp-bridge",  label: "ERP Integration (Live)", icon: Activity, perm: "nav:settings-erp-bridge" },
    ],
  },
];


/** Items of a section the current admin is allowed to see. */
export function visibleItems(perms: ReadonlySet<string>, section: NavSection): NavItem[] {
  return section.items.filter((it) => {
    if (!it.perm) return true;
    if (it.anyOf) return it.anyOf.some((s) => canSeePage(perms, s));
    // Legacy nav:<slug> keys map to (<slug>.read OR <slug>.write).
    const slug = it.perm.startsWith("nav:") ? it.perm.slice(4) : it.perm;
    return canSeePage(perms, slug);
  });
}

export function sectionHref(section: NavSection): string {
  return `/admin/sections/${section.slug}`;
}

/**
 * Admin pages with no sidebar module of their own, and the section they sit
 * in. Without this they highlighted no section and their "←" had no
 * one-level-up answer, so it pointed at whatever page happened to be open
 * before. Sidebar modules always win (longest match runs first), so
 * /admin/settings/users and /admin/settings/otp keep their own entries.
 */
const UNLISTED_PAGES: readonly { prefix: string; section: string }[] = [
  // The settings hub and its sub-pages (shipping, payments, email & SMS,
  // notification rules, webhooks, ERP sync).
  { prefix: "/admin/settings", section: "system" },
  // The ERPNext CSV / Excel importer.
  { prefix: "/admin/import", section: "system" },
];

/** Longest-match item for a pathname, so /admin/payments/ccavenue wins over /admin/payments. */
export function findActive(pathname: string): { section: NavSection; item: NavItem | null } | null {
  let best: { section: NavSection; item: NavItem; len: number } | null = null;
  for (const section of navSections) {
    for (const item of section.items) {
      if (pathname === item.href || pathname.startsWith(item.href + "/")) {
        if (!best || item.href.length > best.len) best = { section, item, len: item.href.length };
      }
    }
  }
  if (best) return { section: best.section, item: best.item };
  const unlisted = UNLISTED_PAGES.find((u) => pathname === u.prefix || pathname.startsWith(u.prefix + "/"));
  if (unlisted) {
    const section = navSections.find((x) => x.slug === unlisted.section);
    if (section) return { section, item: null };
  }
  const m = pathname.match(/^\/admin\/sections\/([^/]+)/);
  if (m) {
    const section = navSections.find((x) => x.slug === m[1]);
    if (section) return { section, item: null };
  }
  return null;
}
