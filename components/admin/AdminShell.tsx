"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { LogOut, Menu, X, ChevronRight, ArrowLeft } from "lucide-react";
import type { CurrentAdmin } from "@/server/session";
import { isReadOnlyAdmin } from "@/lib/admin-permissions";
import { navSections, visibleItems, sectionHref, findActive } from "@/lib/admin-nav";
import { useAdminBackLink, markBackNavigation } from "@/components/admin/useAdminBackLink";
import { cn } from "@/lib/cn";

export function AdminShell({
  user,
  children,
}: {
  user: CurrentAdmin;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const active = findActive(pathname);
  const activeSection = active?.section ?? null;
  const activeItem = active?.item ?? null;
  const router = useRouter();
  const search = useSearchParams().toString();
  const backLink = useAdminBackLink(pathname, search, activeSection, activeItem, user.permissions);
  const [mobileOpen, setMobileOpen] = useState(false);

  const logout = async () => {
    // Admin and parent sessions live in separate cookies — hit the admin
    // logout endpoint so a parent session (e.g. shopping in another tab)
    // isn't dropped when the admin signs out.
    await fetch("/api/admin/auth/logout", { method: "POST" });
    router.push("/admin/login");
  };

  // The sidebar shows only the sections. A section with a single visible
  // module links straight to it; otherwise it opens the section landing
  // page, and the module strip above the content does the second level.
  const NavList = ({ onClick }: { onClick?: () => void }) => (
    <ul className="space-y-0.5 py-2">
      {navSections.map((sec) => {
        const visible = visibleItems(user.permissions, sec);
        if (visible.length === 0) return null;
        const href = visible.length === 1 ? visible[0]!.href : sectionHref(sec);
        const isActive = activeSection?.slug === sec.slug;
        return (
          <li key={sec.slug}>
            <Link
              href={href}
              onClick={onClick}
              scroll={false}
              className={cn(
                "group relative flex items-center gap-2.5 px-2.5 2xl:px-3 min-h-9 py-1.5 rounded-lg text-[inherit] font-medium leading-tight transition-[background,color] duration-150",
                isActive
                  ? "bg-ink-900 text-white shadow-[0_1px_2px_rgba(10,10,10,0.1)]"
                  : "text-ink-600 hover:bg-cream-100 hover:text-ink-900"
              )}
            >
              <sec.icon
                className={cn(
                  "h-[15px] w-[15px] flex-shrink-0",
                  isActive ? "text-white" : "text-ink-400 group-hover:text-ink-700"
                )}
              />
              <span className="min-w-0 flex-1">{sec.kicker}</span>
              {visible.length > 1 ? (
                <ChevronRight
                  className={cn(
                    "ml-auto h-3.5 w-3.5 flex-shrink-0",
                    isActive ? "text-white/70" : "text-ink-300 group-hover:text-ink-500"
                  )}
                />
              ) : null}
            </Link>
          </li>
        );
      })}
    </ul>
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
    <div className="min-h-screen bg-cream-50 grid grid-cols-1 lg:grid-cols-[220px_1fr] 2xl:grid-cols-[256px_1fr]">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex lg:flex-col border-r border-ink-100/70 bg-white sticky top-0 h-screen text-[12.5px] 2xl:text-[13px]">
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
      {/*
        `min-w-0` is load-bearing, not cosmetic.

        A grid item's default `min-width` is `auto`, which refuses to shrink
        below the intrinsic width of its content. So the `1fr` track above does
        NOT cap this column: one wide table (Orders, Roles, the permission
        matrix) stretches <main>, which stretches the page, and the whole
        layout — sidebar included — scrolls sideways. Every `overflow-x-auto`
        rail inside is powerless while its parent is still free to grow.

        With `min-w-0` the column is finally bounded by the viewport and the
        rails do their job: wide tables scroll inside their own card.
      */}
      <main className="min-h-screen min-w-0">
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
        <div className="admin-scale px-5 lg:px-8 2xl:px-10 py-6 lg:py-8 2xl:py-9 max-w-[1600px]">
          {/* The way out. Where the user came from when that was another
              module (a customer opened from a payment goes back to that
              payment), otherwise one level up — see useAdminBackLink. */}
          {backLink ? (
            <Link
              href={backLink.href}
              // Tells the trail this visit is a step BACK, so the page reached
              // does not then offer the page just left as its own "back".
              onClick={() => markBackNavigation(backLink.href)}
              className="group -mt-2 mb-4 inline-flex items-center gap-1.5 text-[12.5px] font-medium text-ink-500 hover:text-ink-900"
            >
              <span className="grid h-6 w-6 place-items-center rounded-md border border-ink-200 bg-white text-ink-500 transition-colors group-hover:border-ink-300 group-hover:text-ink-900">
                <ArrowLeft className="h-3.5 w-3.5" />
              </span>
              {backLink.label}
            </Link>
          ) : null}
          {children}
        </div>
      </main>
    </div>
  );
}
