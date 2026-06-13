/**
 * Sidebar navigation source-of-truth. Imported by AdminShell (for the
 * sidebar render) and UniversalSearch (for the dashboard search). Keep
 * the two in sync by editing here only.
 */
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
  Truck as TruckSupplier,
  Gift,
  MessageSquare,
  Eye,
  KeyRound,
  Wallet,
  Inbox,
  Send,
} from "lucide-react";

export type AdminRole = "super" | "ops" | "school_admin";

export type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  /** If set, only admins with one of these roles see this item. */
  roles?: AdminRole[];
};

export type NavGroup = { kicker: string; items: NavItem[] };

export const ADMIN_NAV_GROUPS: NavGroup[] = [
  {
    kicker: "Overview",
    items: [{ href: "/admin/dashboard", label: "Dashboard", icon: LayoutDashboard }],
  },
  {
    kicker: "Sales",
    items: [
      { href: "/admin/orders", label: "Orders", icon: ShoppingBag },
      { href: "/admin/shipments", label: "Shipments", icon: Truck },
      { href: "/admin/invoices", label: "Invoices", icon: FileText },
      { href: "/admin/returns", label: "Returns", icon: PackageOpen },
    ],
  },
  {
    kicker: "Network",
    items: [
      { href: "/admin/schools",   label: "Schools",   icon: School },
      { href: "/admin/grades",    label: "Grades",    icon: GraduationCap },
      { href: "/admin/delivery-fee-rules", label: "Delivery fees", icon: Truck },
    ],
  },
  {
    kicker: "People",
    items: [
      { href: "/admin/customers", label: "Customers (Parents)", icon: Users },
      { href: "/admin/students",  label: "Students",            icon: GraduationCap },
      { href: "/admin/mcb",       label: "MCB",                 icon: Wallet },
      { href: "/admin/guardians", label: "Guardians",           icon: Users },
    ],
  },
  {
    kicker: "Catalog",
    items: [
      { href: "/admin/catalog", label: "Catalog", icon: Eye },
      { href: "/admin/catalog/build", label: "Create new item (guided)", icon: Boxes },
    ],
  },
  {
    kicker: "Pricing & Tax",
    items: [
      { href: "/admin/discounts", label: "Discounts", icon: Tag },
      { href: "/admin/tax/rates", label: "Tax & GST", icon: Receipt },
    ],
  },
  {
    kicker: "Payment Charges",
    items: [
      { href: "/admin/payment-charges", label: "Payment charges", icon: IndianRupee },
    ],
  },
  {
    kicker: "Buying",
    items: [
      { href: "/admin/suppliers", label: "Suppliers", icon: TruckSupplier },
      { href: "/admin/purchase-orders", label: "Purchase orders", icon: ClipboardList },
    ],
  },
  {
    kicker: "Accounting",
    items: [
      { href: "/admin/payments", label: "Payments", icon: CreditCard },
      { href: "/admin/payments/ccavenue", label: "CCAvenue Payment Logs", icon: Receipt },
    ],
  },
  {
    kicker: "Engagement",
    items: [
      { href: "/admin/reviews", label: "Reviews", icon: Star },
      { href: "/admin/testimonials", label: "Testimonials", icon: MessageSquareQuote },
      { href: "/admin/contact-forms", label: "Contact forms", icon: Inbox },
      { href: "/admin/gift-cards", label: "Gift cards", icon: Gift },
    ],
  },
  {
    kicker: "Content",
    items: [
      { href: "/admin/content", label: "Pages & blocks", icon: ImageIcon },
    ],
  },
  {
    kicker: "Tools",
    items: [
      { href: "/admin/import", label: "Import CSV/XLSX", icon: Upload },
      { href: "/admin/reports", label: "Reports", icon: BarChart3 },
      { href: "/admin/activity", label: "Activity log", icon: Activity },
      { href: "/admin/otp-logs", label: "OTP Logs", icon: MessageSquare, roles: ["super"] },
      { href: "/admin/order-notifications", label: "Order Notifications", icon: Send },
    ],
  },
  {
    kicker: "Settings",
    items: [
      { href: "/admin/settings/users", label: "Admin users", icon: Settings },
      { href: "/admin/settings/otp", label: "SMS / SMTP OTP", icon: KeyRound, roles: ["super"] },
      { href: "/admin/settings/erp-bridge", label: "ERP bridge (live)", icon: Activity },
    ],
  },
];
