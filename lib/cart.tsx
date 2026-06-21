"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  ReactNode,
} from "react";
import { useSearchParams } from "next/navigation";
import type { Product } from "./products";

export type ServerCartLine = {
  variantId: string;
  productId: string;
  productSlug: string;
  productName: string;
  size: string;
  qty: number;
  unitPrice: number;
  unitMrp: number | null;
  imageUrl: string | null;
  inStock: boolean;
  stockLeft: number;
  /** Which sibling this line was added for. Null for legacy items
   *  written before cart_items.student_id existed. */
  studentId: string | null;
  /** Magic Box component picks — present only on a configured box line. */
  bundleSelections:
    | {
        componentProductId: string;
        name: string;
        qty: number;
        variantId: string;
        size: string;
        /** Multi-axis attribute breakdown for the picked variant
         *  (Mandate, Core Subject, Elective Subject for SMS Grade 11
         *  Bookkit). Empty for size-only sub-items. */
        attributes?: { name: string; value: string }[];
      }[]
    | null;
  /** Multi-axis Item-Variant attributes (Mandate / Core Subject / Elective).
   *  Empty for single-axis size-only SKUs. */
  attributes: { name: string; value: string }[];
};

type LegacyLine = { product: Product; size: string; qty: number };

/** Per-sibling section of the cart. Populated server-side from
 *  `cart_items.student_id`; consumed by the cart UI to render each
 *  child's items under their own header + subtotal. */
export type CartByStudent = {
  studentId: string | null;
  studentName: string | null;
  schoolName: string | null;
  gradeLabel: string | null;
  lines: ServerCartLine[];
  subtotal: number;
  count: number;
};

type CartCtx = {
  /** Server-side cart lines (variant ids) — use for checkout. */
  lines: ServerCartLine[];
  /** Lines bucketed by sibling for the multi-student cart UI. */
  byStudent: CartByStudent[];
  /** Legacy shape kept so existing UI (CompleteTheKit) doesn't break. */
  legacyLines: LegacyLine[];
  count: number;
  total: number;
  loading: boolean;
  /**
   * Monotonically increments every time the cart is re-synced from the
   * server (initial load, setQty PATCH ack, refresh()). Use this as a
   * dependency in effects that need to re-fetch server-derived data after
   * a confirmed cart mutation — optimistic updates to `lines`/`total`
   * alone aren't enough, since the server may still be on the old state.
   */
  revision: number;
  /** Add/remove via UI. Looks up variant by size. */
  add: (product: Product, size: string, qty?: number) => Promise<{ ok: boolean; error?: string }>;
  /** Add directly by variantId — skips the extra getVariantId round-trip. */
  addByVariantId: (variantId: string, qty?: number) => Promise<{ ok: boolean; error?: string }>;
  setQty: (variantId: string, qty: number) => Promise<{ ok: boolean; error?: string }>;
  remove: (id: string, size: string) => Promise<void>;
  refresh: () => Promise<void>;
  clear: () => Promise<void>;
  /** Notice payload set by the server when grade-mismatched lines were
   *  dropped. Null after the parent dismisses it. */
  staleRemoved: {
    removed: number;
    reason: "grade_changed";
    activeGradeLabel: string | null;
  } | null;
  dismissStaleRemoved: () => void;
};

const Ctx = createContext<CartCtx | null>(null);

async function getVariantId(productId: string, size: string): Promise<string | null> {
  const r = await fetch(`/api/shop/variant?productId=${productId}&size=${encodeURIComponent(size)}`);
  if (!r.ok) return null;
  const data = (await r.json()) as { variantId: string | null };
  return data.variantId ?? null;
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<ServerCartLine[]>([]);
  const [byStudent, setByStudent] = useState<CartByStudent[]>([]);
  const [count, setCount] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  // Surfaced once when the server drops lines for grade mismatch. The
  // cart page reads this on first render to show a one-line notice, then
  // calls dismissStaleRemoved() — subsequent reads return null.
  const [staleRemoved, setStaleRemoved] = useState<{
    removed: number;
    reason: "grade_changed";
    activeGradeLabel: string | null;
  } | null>(null);

  // Active student id from URL, falling back to the last selection we
  // pinned in localStorage. Without the localStorage pin, navigating to a
  // page that drops the `?studentId=` URL param (e.g. opening /cart in a
  // new tab, or clicking "Continue Shopping" to /shop) silently switches
  // the cart context to `me.students[0]` — for multi-school families that
  // made the cart appear empty. We persist the last student the parent
  // shopped for so the cart context survives navigation.
  const searchParams = useSearchParams();
  const urlStudentId = searchParams?.get("studentId") ?? "";
  const [pinnedStudentId, setPinnedStudentId] = useState<string>("");
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const v = window.localStorage.getItem("inventre.activeStudentId") ?? "";
      if (v) setPinnedStudentId(v);
    } catch {
      // ignore localStorage failures (private mode, etc.) — URL still works
    }
  }, []);
  useEffect(() => {
    if (typeof window === "undefined" || !urlStudentId) return;
    try {
      window.localStorage.setItem("inventre.activeStudentId", urlStudentId);
    } catch {}
    setPinnedStudentId(urlStudentId);
  }, [urlStudentId]);
  const studentId = urlStudentId || pinnedStudentId;
  const studentSuffix = studentId
    ? `?studentId=${encodeURIComponent(studentId)}`
    : "";

  const refresh = useCallback(async () => {
    try {
      const r = await fetch(`/api/cart${studentSuffix}`, { cache: "no-store" });
      if (!r.ok) {
        setLines([]);
        setCount(0);
        setTotal(0);
        return;
      }
      const data = (await r.json()) as {
        lines: ServerCartLine[];
        count: number;
        subtotal: number;
        byStudent?: CartByStudent[];
        staleRemoved?: {
          removed: number;
          reason: "grade_changed";
          activeGradeLabel: string | null;
        } | null;
      };
      setLines(data.lines);
      setByStudent(data.byStudent ?? []);
      setCount(data.count);
      setTotal(data.subtotal);
      if (data.staleRemoved) setStaleRemoved(data.staleRemoved);
      setRevision((r) => r + 1);
    } finally {
      setLoading(false);
    }
  }, [studentSuffix]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const add = useCallback(
    async (product: Product, size: string, qty = 1): Promise<{ ok: boolean; error?: string }> => {
      const variantId = await getVariantId(product.id, size);
      if (!variantId) return { ok: false, error: "Size not available" };
      const r = await fetch("/api/cart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          variantId,
          qty,
          studentId: studentId || undefined,
        }),
      });
      if (!r.ok) {
        const data = await r.json().catch(() => null) as { error?: string } | null;
        return { ok: false, error: data?.error ?? "Could not add to cart" };
      }
      await refresh();
      return { ok: true };
    },
    [refresh, studentId]
  );

  const addByVariantId = useCallback(
    async (variantId: string, qty = 1): Promise<{ ok: boolean; error?: string }> => {
      const r = await fetch("/api/cart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ variantId, qty, studentId: studentId || undefined }),
      });
      if (!r.ok) {
        const data = await r.json().catch(() => null) as { error?: string } | null;
        return { ok: false, error: data?.error ?? "Could not add to cart" };
      }
      await refresh();
      return { ok: true };
    },
    [refresh, studentId]
  );

  const setQty = useCallback(
    async (variantId: string, qty: number): Promise<{ ok: boolean; error?: string }> => {
      // Optimistic update — apply immediately so the UI feels instant.
      // Touch BOTH `lines` (legacy consumers) and `byStudent` (the cart
      // page renders from this now), so a delete clicks-then-vanishes
      // instead of waiting for the PATCH round-trip.
      setLines((prev) => {
        if (qty === 0) return prev.filter((l) => l.variantId !== variantId);
        return prev.map((l) => l.variantId === variantId ? { ...l, qty } : l);
      });
      setByStudent((prev) =>
        prev
          .map((g) => {
            const nextLines =
              qty === 0
                ? g.lines.filter((l) => l.variantId !== variantId)
                : g.lines.map((l) =>
                    l.variantId === variantId ? { ...l, qty } : l
                  );
            const subtotal = nextLines.reduce(
              (s, l) => s + l.unitPrice * l.qty,
              0
            );
            const count = nextLines.reduce((s, l) => s + l.qty, 0);
            return { ...g, lines: nextLines, subtotal, count };
          })
          // Hide a group when its last item is removed.
          .filter((g) => g.lines.length > 0)
      );
      setCount((prev) => {
        const line = lines.find((l) => l.variantId === variantId);
        if (!line) return prev;
        return prev - line.qty + (qty === 0 ? 0 : qty);
      });
      setTotal((prev) => {
        const line = lines.find((l) => l.variantId === variantId);
        if (!line) return prev;
        return prev - line.unitPrice * line.qty + line.unitPrice * (qty === 0 ? 0 : qty);
      });

      const prevLines = lines;
      const prevByStudent = byStudent;
      const r = await fetch("/api/cart", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          variantId,
          qty,
          studentId: studentId || undefined,
        }),
      });
      if (!r.ok) {
        const data = await r.json().catch(() => null) as { error?: string } | null;
        // Revert on failure
        setLines(prevLines);
        setByStudent(prevByStudent);
        await refresh();
        return { ok: false, error: data?.error ?? "Could not update cart" };
      }
      // Sync authoritative data from server
      const data = (await r.json().catch(() => null)) as
        | { lines: ServerCartLine[]; count: number; subtotal: number; byStudent?: CartByStudent[] }
        | null;
      if (data) {
        setLines(data.lines);
        if (data.byStudent) setByStudent(data.byStudent);
        setCount(data.count);
        setTotal(data.subtotal);
        setRevision((r) => r + 1);
      }
      return { ok: true };
    },
    [refresh, studentId, lines, byStudent]
  );

  const remove = useCallback(
    async (productId: string, size: string) => {
      const variantId = await getVariantId(productId, size);
      if (!variantId) return;
      await setQty(variantId, 0);
    },
    [setQty]
  );

  const clear = useCallback(async () => {
    await fetch("/api/cart", { method: "DELETE" });
    await refresh();
  }, [refresh]);

  // legacy shape: existing UI components (CompleteTheKit) use lines.map(l => l.product.id)
  const legacyLines: LegacyLine[] = lines.map((l) => ({
    product: {
      id: l.productId,
      name: l.productName,
      categoryPath: [],
      type: "all",
      price: l.unitPrice,
      mrp: l.unitMrp ?? undefined,
      sizes: [l.size],
      inStock: l.inStock,
      img: l.imageUrl,
      required: false,
    } as Product,
    size: l.size,
    qty: l.qty,
  }));

  return (
    <Ctx.Provider
      value={{
        lines,
        byStudent,
        legacyLines,
        count,
        total,
        loading,
        revision,
        add,
        addByVariantId,
        setQty,
        remove,
        refresh,
        clear,
        staleRemoved,
        dismissStaleRemoved: () => setStaleRemoved(null),
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useCart() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useCart must be inside CartProvider");
  return c;
}

/**
 * Same as useCart, but returns null when there's no provider above. Use
 * this in components like the global Nav that are rendered on both
 * cart-aware (/shop/*) and cart-less (/about, /account) pages.
 */
export function useCartOptional(): CartCtx | null {
  return useContext(Ctx);
}
