/**
 * Admin navigation — the ONLY definition (F-05, 2026-09-23).
 *
 * AdminShell renders it; UniversalSearch searches it; both filter with
 * canSeePage(permissions, item.perm). `perm` is the page slug from
 * lib/admin-permissions.ts ADMIN_PAGES (visible when the admin holds
 * <slug>.read or <slug>.write). A unit test asserts every slug is real.
 */
import {
  LayoutDashboard,
  School,
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
  BarChart3,
  Upload,
  GraduationCap,
  ClipboardList,
  CreditCard,
  Activity,
  Truck as TruckSupplier,
  Gift,
  MessageSquare,
  Eye,
  KeyRound,
  Wallet,
  Inbox,
  Send,
  LifeBuoy,
} from "lucide-react";

export type AdminRole = "super" | "ops" | "school_admin";

export type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Page slug from ADMIN_PAGES; item shows when canSeePage(perms, perm). */
  perm: string;
};

export type NavGroup = { kicker: string; items: NavItem[] };

export const ADMIN_NAV_GROUPS: NavGroup[] = [
  {
    kicker: "Overview",
    items: [{ href: "/admin/dashboard", label: "Dashboard", icon: LayoutDashboard, perm: "dashboard" }],
  },
  {
    kicker: "Sales",
    items: [
      { href: "/admin/orders",    label: "Orders",    icon: ShoppingBag, perm: "orders" },
      { href: "/admin/shipments", label: "Shipments", icon: Truck,       perm: "shipments" },
      { href: "/admin/invoices",  label: "Invoices",  icon: FileText,    perm: "invoices" },
      { href: "/admin/returns",   label: "Returns",   icon: PackageOpen, perm: "returns" },
    ],
  },
  {
    kicker: "Network",
    items: [
      { href: "/admin/schools",            label: "Schools",       icon: School,        perm: "schools" },
      { href: "/admin/grades",             label: "Grades",        icon: GraduationCap, perm: "grades" },
      { href: "/admin/delivery-fee-rules", label: "Delivery fees", icon: Truck,         perm: "delivery-fees" },
    ],
  },
  {
    kicker: "People",
    items: [
      { href: "/admin/customers", label: "Customers (Parents)", icon: Users,         perm: "customers" },
      { href: "/admin/students",  label: "Students",            icon: GraduationCap, perm: "students" },
      { href: "/admin/mcb",       label: "MCB",                 icon: Wallet,        perm: "mcb" },
      { href: "/admin/guardians", label: "Guardians",           icon: Users,         perm: "guardians" },
    ],
  },
  {
    // One door for catalog. The Catalog page is the Shop Preview — pick
    // (school, grade, new/returning) and see what parents see. Deep
    // editors (Products, BOMs, Pricing, Stock, etc.) are linked from
    // within that page so the sidebar stays uncluttered and there's no
    // "which tab do I click first?" confusion.
    kicker: "Catalog",
    items: [
      { href: "/admin/catalog", label: "Catalog", icon: Eye, perm: "catalog" },
      { href: "/admin/ground-stock", label: "Ground Stock", icon: Boxes, perm: "catalog" },
    ],
  },
  {
    kicker: "Pricing & Tax",
    items: [
      { href: "/admin/discounts", label: "Discounts", icon: Tag,     perm: "discounts" },
      { href: "/admin/tax/rates", label: "Tax & GST", icon: Receipt, perm: "tax" },
    ],
  },
  {
    kicker: "Payment Charges",
    items: [
      { href: "/admin/payment-charges", label: "Payment charges", icon: IndianRupee, perm: "payment-charges" },
    ],
  },
  {
    kicker: "Buying",
    items: [
      { href: "/admin/suppliers",       label: "Suppliers",       icon: TruckSupplier,  perm: "suppliers" },
      { href: "/admin/purchase-orders", label: "Purchase orders", icon: ClipboardList,  perm: "purchase-orders" },
    ],
  },
  {
    kicker: "Accounting",
    items: [
      { href: "/admin/payments",          label: "Payments",              icon: CreditCard, perm: "payments" },
      { href: "/admin/payments/ccavenue", label: "CCAvenue Payment Logs", icon: Receipt,    perm: "payments-ccavenue" },
    ],
  },
  {
    kicker: "Engagement",
    items: [
      { href: "/admin/reviews",       label: "Reviews",       icon: Star,                perm: "reviews" },
      { href: "/admin/testimonials",  label: "Testimonials",  icon: MessageSquareQuote,  perm: "testimonials" },
      { href: "/admin/contact-forms", label: "Contact forms", icon: Inbox,               perm: "contact-forms" },
      { href: "/admin/parent-concerns", label: "Parent Concerns", icon: LifeBuoy,        perm: "contact-forms" },
      { href: "/admin/gift-cards",    label: "Gift cards",    icon: Gift,                perm: "gift-cards" },
    ],
  },
  {
    kicker: "Content",
    items: [
      { href: "/admin/content", label: "Pages & blocks", icon: ImageIcon, perm: "content" },
    ],
  },
  {
    kicker: "Tools",
    items: [
      { href: "/admin/import",   label: "Import CSV/XLSX", icon: Upload,        perm: "import" },
      { href: "/admin/reports",  label: "Reports",         icon: BarChart3,     perm: "reports" },
      { href: "/admin/activity", label: "Activity log",    icon: Activity,      perm: "activity" },
      { href: "/admin/otp-logs", label: "OTP Logs",        icon: MessageSquare, perm: "otp-logs" },
      { href: "/admin/order-notifications", label: "Order Notifications", icon: Send, perm: "order-notifications" },
    ],
  },
  {
    kicker: "Settings",
    items: [
      { href: "/admin/settings/users",       label: "Admin users",       icon: Settings, perm: "settings-users" },
      { href: "/admin/roles",                label: "Roles & permissions", icon: KeyRound, perm: "roles" },
      { href: "/admin/settings/otp",         label: "SMS / SMTP OTP",    icon: KeyRound, perm: "settings-otp" },
      { href: "/admin/settings/erp-bridge",  label: "ERP bridge (live)", icon: Activity, perm: "settings-erp-bridge" },
    ],
  },
];
