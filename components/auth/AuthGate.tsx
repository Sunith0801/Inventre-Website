"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { auth } from "@/lib/auth";

/**
 * Watches client-side route changes and clears the session whenever the user
 * navigates AWAY from the /shop tree. Each time they come back to
 * "Shop by category" they're asked to log in again.
 *
 * Mounted once at the root layout; renders nothing.
 */
export function AuthGate() {
  const pathname = usePathname();
  const prev = useRef<string | null>(null);

  useEffect(() => {
    const was = prev.current;
    const wasShop = was?.startsWith("/shop") ?? false;
    const isShop = pathname.startsWith("/shop");
    if (wasShop && !isShop) {
      // fire-and-forget — we don't block navigation on this
      auth.logout().catch(() => {});
    }
    prev.current = pathname;
  }, [pathname]);

  return null;
}
