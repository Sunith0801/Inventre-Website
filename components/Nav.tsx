"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ShoppingBag, User, Menu, X, LogOut, UserCircle2, Package } from "lucide-react";
import { cn } from "@/lib/cn";
import { auth } from "@/lib/auth";
import { useCartOptional } from "@/lib/cart";

const links = [
  { label: "Home", href: "/" },
  { label: "About Us", href: "/about" },
  { label: "Shop by category", href: "/shop", guarded: true },
  { label: "Experience Store", href: "/experience-store" },
  { label: "Contact Us", href: "/contact" },
];

export function Nav() {
  const router = useRouter();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const [cartCount, setCartCount] = useState<number | null>(null);
  const [authenticated, setAuthenticated] = useState(false);
  // Inside /shop/* the CartProvider is mounted, so we can read the live
  // count straight from context — that keeps the badge in sync after every
  // add/remove. On non-shop pages the provider is absent and we fall back
  // to the one-shot fetch below.
  const cartCtx = useCartOptional();
  const displayCount = cartCtx ? cartCtx.count : (cartCount ?? 0);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Lazy-fetch the cart count + auth state once on mount. On /shop/* the
  // CartProvider already owns the count, so skip the extra fetch there.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const me = await auth.me();
        if (cancelled) return;
        setAuthenticated(me?.kind === "parent");
        if (!cartCtx && me?.kind === "parent") {
          const r = await fetch("/api/cart", { cache: "no-store" });
          if (r.ok) {
            const data = (await r.json()) as { count: number };
            if (!cancelled) setCartCount(data.count);
          }
        }
      } catch {}
    })();
    return () => {
      cancelled = true;
    };
  }, [cartCtx]);

  const handleNav = async (
    e: React.MouseEvent<HTMLAnchorElement>,
    link: { href: string; guarded?: boolean }
  ) => {
    if (!link.guarded) return;
    e.preventDefault();
    setOpen(false);
    if (authenticated) router.push(link.href);
    else router.push("/login");
  };

  const handleCart = async (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    if (authenticated) router.push("/shop/cart");
    else router.push("/login");
  };

  const [acctOpen, setAcctOpen] = useState(false);
  const handleAccount = async (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    if (!authenticated) {
      router.push("/login");
      return;
    }
    setAcctOpen((v) => !v);
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!acctOpen) return;
    const close = () => setAcctOpen(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [acctOpen]);

  const handleLogout = async () => {
    setAcctOpen(false);
    await fetch("/api/auth/logout", {
      method: "POST",
      headers: { Origin: window.location.origin },
    });
    setAuthenticated(false);
    router.push("/");
    router.refresh();
  };

  return (
    <header
      className={cn(
        "sticky top-0 z-50 w-full transition-all duration-300 ease-out-expo",
        scrolled
          ? "bg-cream/90 backdrop-blur-md border-b border-ink-100 shadow-[0_2px_20px_-10px_rgba(0,0,0,0.1)]"
          : "bg-cream/60 backdrop-blur-sm border-b border-transparent"
      )}
    >
      <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-3 lg:px-8">
        <a href="/" aria-label="Inventre home" className="flex items-center shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="https://pub-d46aef8f98ef4da0a1834fb6f554ae2c.r2.dev/images/INVENTRE_LOGO.png"
            alt="Inventre"
            className="h-9 sm:h-10 w-auto"
          />
        </a>

        <nav className="hidden md:flex items-center gap-9">
          {links.filter((l) => !l.guarded || authenticated).map((l) => (
            <a
              key={l.href}
              href={l.href}
              onClick={(e) => handleNav(e, l)}
              className="relative text-[14px] font-semibold text-ink-800 hover:text-brand transition-colors after:absolute after:left-0 after:-bottom-1.5 after:h-0.5 after:w-0 after:bg-brand after:transition-all hover:after:w-full"
            >
              {l.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-1.5 sm:gap-2">
          {/* Search icon was confusing + redundant with /shop link;
              hidden globally per product decision. Profile + cart only
              show once signed in (parents need a session to interact
              with either, so showing them logged-out invites the
              "what does this do?" question). */}
          {!authenticated ? (
            <a
              href="/login"
              className="inline-flex items-center gap-1.5 rounded-full bg-brand px-4 sm:px-5 py-2 text-[13px] sm:text-[14px] font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.25)] hover:bg-brand-600 transition-colors"
            >
              <User className="h-4 w-4" strokeWidth={2.2} />
              <span>Login</span>
            </a>
          ) : (
          <div className="relative" onClick={(e) => e.stopPropagation()}>
            <a
              href="/account"
              onClick={handleAccount}
              aria-label="Account menu"
              aria-expanded={acctOpen}
              className="grid h-10 w-10 place-items-center rounded-full text-ink-800 hover:text-brand hover:bg-brand-50 transition-colors"
            >
              <User className="h-[18px] w-[18px]" strokeWidth={2} />
            </a>
            {acctOpen && authenticated && (
              <div className="absolute right-0 mt-2 w-56 rounded-2xl border border-ink-100 bg-white shadow-[0_20px_40px_-12px_rgba(0,0,0,0.12)] overflow-hidden z-50">
                <a
                  href="/account"
                  onClick={() => setAcctOpen(false)}
                  className="flex items-center gap-2.5 px-4 py-3 text-[13.5px] text-ink-800 hover:bg-cream-100"
                >
                  <UserCircle2 className="h-4 w-4 text-ink-500" />
                  My profile
                </a>
                <a
                  href="/shop/orders"
                  onClick={() => setAcctOpen(false)}
                  className="flex items-center gap-2.5 px-4 py-3 text-[13.5px] text-ink-800 hover:bg-cream-100"
                >
                  <Package className="h-4 w-4 text-ink-500" />
                  My orders
                </a>
                <button
                  onClick={handleLogout}
                  className="w-full flex items-center gap-2.5 px-4 py-3 text-[13.5px] text-red-700 hover:bg-red-50 border-t border-ink-100"
                >
                  <LogOut className="h-4 w-4" />
                  Sign out
                </button>
              </div>
            )}
          </div>
          )}
          {authenticated && (
            <a
              href="/shop/cart"
              onClick={handleCart}
              aria-label="Cart"
              className="relative grid h-10 w-10 place-items-center rounded-full text-ink-800 hover:text-brand hover:bg-brand-50 transition-colors"
            >
              <ShoppingBag className="h-[18px] w-[18px]" strokeWidth={2} />
              {displayCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 grid h-4 min-w-4 px-1 place-items-center rounded-full bg-brand text-white text-[10px] font-bold">
                  {displayCount > 99 ? "99+" : displayCount}
                </span>
              )}
            </a>
          )}

          <button
            aria-label="Toggle menu"
            onClick={() => setOpen(!open)}
            className="md:hidden ml-1 grid h-10 w-10 place-items-center rounded-full text-ink-900 hover:bg-brand-50"
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {open && (
        <div className="md:hidden border-t border-ink-100 bg-cream">
          <div className="mx-auto max-w-7xl px-5 py-5 flex flex-col gap-1">
            {links.filter((l) => !l.guarded || authenticated).map((l) => (
              <a
                key={l.href}
                href={l.href}
                onClick={(e) => {
                  handleNav(e, l);
                  setOpen(false);
                }}
                className="py-2.5 text-[15px] font-semibold text-ink-800 hover:text-brand transition-colors"
              >
                {l.label}
              </a>
            ))}
          </div>
        </div>
      )}
    </header>
  );
}
