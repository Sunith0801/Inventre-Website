"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
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
  LogOut,
  Menu,
  X,
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
  LifeBuoy,
} from "lucide-react";
import type { CurrentAdmin } from "@/lib/session";
import { isReadOnlyAdmin, canSeePage } from "@/lib/admin-permissions";
import { cn } from "@/lib/cn";
import { TopProgressBar } from "@/components/admin/TopProgressBar";

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Permission key from lib/admin-permissions.ts. Item is hidden when
   *  the current admin's permissions Set doesn't include it. Omit to
   *  always show (rare — used only for items pre-RBAC). */
  perm?: string;
};

type NavGroup = { kicker: string; items: NavItem[] };

const groups: NavGroup[] = [
  {
    kicker: "Overview",
    items: [{ href: "/admin/dashboard", label: "Dashboard", icon: LayoutDashboard, perm: "nav:dashboard" }],
  },
  {
    kicker: "Sales",
    items: [
      { href: "/admin/orders",    label: "Orders",    icon: ShoppingBag, perm: "nav:orders" },
      { href: "/admin/shipments", label: "Shipments", icon: Truck,       perm: "nav:shipments" },
      { href: "/admin/invoices",  label: "Invoices",  icon: FileText,    perm: "nav:invoices" },
      { href: "/admin/returns",   label: "Returns",   icon: PackageOpen, perm: "nav:returns" },
    ],
  },
  {
    kicker: "Network",
    items: [
      { href: "/admin/schools",            label: "Schools",       icon: School,        perm: "nav:schools" },
      { href: "/admin/grades",             label: "Grades",        icon: GraduationCap, perm: "nav:grades" },
      { href: "/admin/delivery-fee-rules", label: "Delivery fees", icon: Truck,         perm: "nav:delivery-fees" },
    ],
  },
  {
    kicker: "People",
    items: [
      { href: "/admin/customers", label: "Customers (Parents)", icon: Users,         perm: "nav:customers" },
      { href: "/admin/students",  label: "Students",            icon: GraduationCap, perm: "nav:students" },
      { href: "/admin/mcb",       label: "MCB",                 icon: Wallet,        perm: "nav:mcb" },
      { href: "/admin/guardians", label: "Guardians",           icon: Users,         perm: "nav:guardians" },
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
      { href: "/admin/catalog", label: "Catalog", icon: Eye, perm: "nav:catalog" },
    ],
  },
  {
    kicker: "Pricing & Tax",
    items: [
      { href: "/admin/discounts", label: "Discounts", icon: Tag,     perm: "nav:discounts" },
      { href: "/admin/tax/rates", label: "Tax & GST", icon: Receipt, perm: "nav:tax" },
    ],
  },
  {
    kicker: "Payment Charges",
    items: [
      { href: "/admin/payment-charges", label: "Payment charges", icon: IndianRupee, perm: "nav:payment-charges" },
    ],
  },
  {
    kicker: "Buying",
    items: [
      { href: "/admin/suppliers",       label: "Suppliers",       icon: TruckSupplier,  perm: "nav:suppliers" },
      { href: "/admin/purchase-orders", label: "Purchase orders", icon: ClipboardList,  perm: "nav:purchase-orders" },
    ],
  },
  {
    kicker: "Accounting",
    items: [
      { href: "/admin/payments",          label: "Payments",              icon: CreditCard, perm: "nav:payments" },
      { href: "/admin/payments/ccavenue", label: "CCAvenue Payment Logs", icon: Receipt,    perm: "nav:payments-ccavenue" },
    ],
  },
  {
    kicker: "Engagement",
    items: [
      { href: "/admin/reviews",       label: "Reviews",       icon: Star,                perm: "nav:reviews" },
      { href: "/admin/testimonials",  label: "Testimonials",  icon: MessageSquareQuote,  perm: "nav:testimonials" },
      { href: "/admin/contact-forms", label: "Contact forms", icon: Inbox,               perm: "nav:contact-forms" },
      { href: "/admin/parent-concerns", label: "Parent Concerns", icon: LifeBuoy,        perm: "nav:contact-forms" },
      { href: "/admin/gift-cards",    label: "Gift cards",    icon: Gift,                perm: "nav:gift-cards" },
    ],
  },
  {
    kicker: "Content",
    items: [
      { href: "/admin/content", label: "Pages & blocks", icon: ImageIcon, perm: "nav:content" },
    ],
  },
  {
    kicker: "Tools",
    items: [
      { href: "/admin/import",   label: "Import CSV/XLSX", icon: Upload,        perm: "nav:import" },
      { href: "/admin/reports",  label: "Reports",         icon: BarChart3,     perm: "nav:reports" },
      { href: "/admin/activity", label: "Activity log",    icon: Activity,      perm: "nav:activity" },
      { href: "/admin/otp-logs", label: "OTP Logs",        icon: MessageSquare, perm: "nav:otp-logs" },
      { href: "/admin/order-notifications", label: "Order Notifications", icon: Send, perm: "nav:order-notifications" },
    ],
  },
  {
    kicker: "Settings",
    items: [
      { href: "/admin/settings/users",       label: "Admin users",       icon: Settings, perm: "nav:settings-users" },
      { href: "/admin/roles",                label: "Roles & permissions", icon: KeyRound, perm: "nav:roles" },
      { href: "/admin/settings/otp",         label: "SMS / SMTP OTP",    icon: KeyRound, perm: "nav:settings-otp" },
      { href: "/admin/settings/erp-bridge",  label: "ERP bridge (live)", icon: Activity, perm: "nav:settings-erp-bridge" },
    ],
  },
];

export function AdminShell({
  user,
  children,
}: {
  user: CurrentAdmin;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  // Longest-match-wins so a nested route like `/admin/payments/ccavenue`
  // highlights only the CCAvenue Logs item — not also `/admin/payments`,
  // which would otherwise match via the startsWith() check below.
  const activeHref = (() => {
    const candidates = groups
      .flatMap((g) => g.items.map((i) => i.href))
      .filter((h) => pathname === h || pathname.startsWith(h + "/"));
    if (candidates.length === 0) return null;
    return candidates.sort((a, b) => b.length - a.length)[0];
  })();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);

  const logout = async () => {
    // Admin and parent sessions live in separate cookies — hit the admin
    // logout endpoint so a parent session (e.g. shopping in another tab)
    // isn't dropped when the admin signs out.
    await fetch("/api/admin/auth/logout", { method: "POST" });
    router.push("/admin/login");
  };

  const NavList = ({ onClick }: { onClick?: () => void }) => (
    <div className="space-y-5 py-2">
      {groups.map((g) => {
        const visible = g.items.filter((it) => {
          if (!it.perm) return true;
          // Legacy nav:<slug> keys map to (<slug>.read OR <slug>.write).
          // The 0046 migration replaced nav:* in the DB with .read/.write
          // pairs; AdminShell still labels sidebar items by their legacy
          // nav: identifier for now.
          const slug = it.perm.startsWith("nav:") ? it.perm.slice(4) : it.perm;
          return canSeePage(user.permissions, slug);
        });
        if (visible.length === 0) return null;
        return (
        <div key={g.kicker}>
          <div className="px-3 mb-1.5 text-[10px] font-semibold tracking-[0.18em] uppercase text-ink-400">
            {g.kicker}
          </div>
          <ul className="space-y-0.5">
            {visible.map((it) => {
              const active = it.href === activeHref;
              return (
                <li key={it.href}>
                  <Link
                    href={it.href}
                    onClick={onClick}
                    scroll={false}
                    className={cn(
                      "group relative flex items-center gap-2.5 px-3 h-9 rounded-lg text-[13px] font-medium transition-[background,color] duration-150",
                      active
                        ? "bg-ink-900 text-white shadow-[0_1px_2px_rgba(10,10,10,0.1)]"
                        : "text-ink-600 hover:bg-cream-100 hover:text-ink-900"
                    )}
                  >
                    <it.icon
                      className={cn(
                        "h-[15px] w-[15px] flex-shrink-0",
                        active ? "text-white" : "text-ink-400 group-hover:text-ink-700"
                      )}
                    />
                    <span className="truncate">{it.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
        );
      })}
    </div>
  );

  const UserChip = () => (
    <div className="flex items-center gap-3 p-2 rounded-xl hover:bg-cream-100/60 transition-colors">
      <div className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-brand-400 to-brand-600 text-white text-[12px] font-bold shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]">
        {(user.name ?? user.email).slice(0, 2).toUpperCase()}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold text-ink-900 truncate leading-tight">
          {user.name ?? user.email.split("@")[0]}
        </p>
        <p className="text-[11px] text-ink-500 truncate capitalize">
          {user.role.replace("_", " ")}
        </p>
      </div>
      <button
        onClick={logout}
        aria-label="Sign out"
        className="grid h-8 w-8 place-items-center rounded-lg text-ink-500 hover:text-red-600 hover:bg-red-50 transition-colors"
      >
        <LogOut className="h-3.5 w-3.5" />
      </button>
    </div>
  );

  return (
    <div className="min-h-screen bg-cream-50 grid grid-cols-1 lg:grid-cols-[256px_1fr]">
      <TopProgressBar />
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex lg:flex-col border-r border-ink-100/70 bg-white sticky top-0 h-screen">
        <div className="px-5 py-4 border-b border-ink-100/70 flex items-center gap-2.5">
          <Link href="/admin/dashboard" className="flex items-center gap-2.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="https://pub-d46aef8f98ef4da0a1834fb6f554ae2c.r2.dev/images/INVENTRE_LOGO.png"
              alt="Inventre"
              className="h-7"
            />
            <span className="rounded-md bg-ink-900 text-white px-1.5 py-0.5 text-[9px] font-bold tracking-[0.18em] uppercase leading-none">
              Admin
            </span>
          </Link>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 [scrollbar-width:thin]">
          <NavList />
        </nav>

        <div className="px-2 py-2 border-t border-ink-100/70">
          <UserChip />
        </div>
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div
            className="fixed inset-0 bg-black/50 backdrop-blur-[2px] animate-[fadeIn_180ms_ease-out]"
            onClick={() => setMobileOpen(false)}
            aria-hidden
          />
          <aside className="relative w-[280px] bg-white h-full flex flex-col border-r border-ink-100/70 animate-[slideInLeft_220ms_cubic-bezier(0.32,0.72,0,1)]">
            <div className="px-5 py-4 border-b border-ink-100/70 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="https://pub-d46aef8f98ef4da0a1834fb6f554ae2c.r2.dev/images/INVENTRE_LOGO.png" alt="" className="h-6" />
                <span className="rounded-md bg-ink-900 text-white px-1.5 py-0.5 text-[9px] font-bold tracking-[0.18em] uppercase leading-none">
                  Admin
                </span>
              </div>
              <button
                onClick={() => setMobileOpen(false)}
                aria-label="Close menu"
                className="grid h-9 w-9 place-items-center rounded-lg text-ink-500 hover:bg-cream-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto px-3">
              <NavList onClick={() => setMobileOpen(false)} />
            </nav>
            <div className="px-2 py-2 border-t border-ink-100/70">
              <UserChip />
            </div>
          </aside>
        </div>
      )}

      {/* Main content */}
      <main className="min-h-screen">
        <div className="lg:hidden border-b border-ink-100/70 bg-white px-5 py-3 flex items-center justify-between sticky top-0 z-10">
          <button
            aria-label="Open menu"
            onClick={() => setMobileOpen(true)}
            className="grid h-9 w-9 place-items-center rounded-lg text-ink-700 hover:bg-cream-100"
          >
            <Menu className="h-5 w-5" />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="https://pub-d46aef8f98ef4da0a1834fb6f554ae2c.r2.dev/images/INVENTRE_LOGO.png" alt="" className="h-6" />
          <button
            onClick={logout}
            aria-label="Sign out"
            className="grid h-9 w-9 place-items-center rounded-lg text-ink-500 hover:text-red-600 hover:bg-red-50"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
        {isReadOnlyAdmin(user.role) && (
          <div className="border-b border-amber-200 bg-amber-50 px-5 lg:px-10 py-2.5 text-[12.5px] text-amber-900">
            <strong className="font-semibold">Read-only access.</strong>{" "}
            Your role can browse all data but cannot save changes — writes are blocked by the API.
          </div>
        )}
        <div className="px-5 lg:px-10 py-6 lg:py-9 max-w-[1600px]">{children}</div>
      </main>
    </div>
  );
}
