"use client";

/**
 * Client-side hook + helpers for the per-product draft persistence layer.
 *
 * Two storage tiers, transparent to callers:
 *  - Authed parent: server-side via `/api/shop/draft` (survives logout).
 *  - Guest: localStorage under `inventre:draft:{productId}:{studentId}`.
 *
 * On the PDP, call `useProductDraft({ productId, studentId })`. The hook
 * returns the restored draft (or null), a debounced `save(state)` to
 * persist on every change, and `clear()` to drop the draft (called after
 * a successful Add-to-Cart).
 */

import { useCallback, useEffect, useRef, useState } from "react";

export type ProductDraftState =
  | { kind: "multi-axis"; selection: Record<string, string> }
  | {
      kind: "magic-box";
      picks: { componentProductId: string; variantId: string | null }[];
    };

const lsKey = (productId: string, studentId: string | null | undefined) =>
  `inventre:draft:${productId}:${studentId ?? ""}`;

function readLocalDraft(
  productId: string,
  studentId: string | null
): ProductDraftState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(lsKey(productId, studentId));
    if (!raw) return null;
    return JSON.parse(raw) as ProductDraftState;
  } catch {
    return null;
  }
}

function writeLocalDraft(
  productId: string,
  studentId: string | null,
  state: ProductDraftState
) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(lsKey(productId, studentId), JSON.stringify(state));
  } catch {}
}

function clearLocalDraft(productId: string, studentId: string | null) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(lsKey(productId, studentId));
  } catch {}
}

export function useProductDraft({
  productId,
  studentId,
  enabled,
}: {
  productId: string | undefined;
  studentId: string | null;
  /** Off until the PDP has loaded its product data so we don't fetch a
   *  draft for a slug we don't yet know the productId of. */
  enabled: boolean;
}): {
  /** Restored draft state, or null when nothing's saved. Stable across
   *  renders unless the (productId, studentId) tuple changes. */
  restored: ProductDraftState | null;
  /** Was the most recent restoration sourced from a real saved draft (as
   *  opposed to the initial null)? PDP uses this to show the "Restored
   *  your last selection" toast just once on mount. */
  didRestore: boolean;
  /** Debounced persist. Safe to call on every picker change. */
  save: (state: ProductDraftState) => void;
  /** Drop the draft on both tiers (called after Add-to-Cart success). */
  clear: () => Promise<void>;
} {
  const [restored, setRestored] = useState<ProductDraftState | null>(null);
  const [didRestore, setDidRestore] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestState = useRef<ProductDraftState | null>(null);

  // Restore once per (productId, studentId).
  useEffect(() => {
    if (!enabled || !productId) return;
    let cancelled = false;
    (async () => {
      // Server first (authed parent's source of truth).
      try {
        const params = new URLSearchParams({ productId });
        if (studentId) params.set("studentId", studentId);
        const r = await fetch(`/api/shop/draft?${params.toString()}`, {
          cache: "no-store",
        });
        if (r.ok) {
          const d = (await r.json()) as { state: ProductDraftState | null };
          if (!cancelled && d.state) {
            setRestored(d.state);
            setDidRestore(true);
            return;
          }
        }
      } catch {
        // fall through to local
      }
      // localStorage fallback (works for guests + as a write-through cache).
      const local = readLocalDraft(productId, studentId);
      if (!cancelled && local) {
        setRestored(local);
        setDidRestore(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, productId, studentId]);

  const save = useCallback(
    (state: ProductDraftState) => {
      if (!productId) return;
      latestState.current = state;
      // localStorage write is synchronous and cheap — do it immediately so
      // a parent who reloads in <400 ms doesn't lose state.
      writeLocalDraft(productId, studentId, state);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        const payload = latestState.current;
        if (!payload) return;
        fetch("/api/shop/draft", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            productId,
            studentId: studentId || undefined,
            state: payload,
          }),
        }).catch(() => {
          // Guests + transient network failures fall back to localStorage,
          // which already has the latest payload.
        });
      }, 400);
    },
    [productId, studentId]
  );

  const clear = useCallback(async () => {
    if (!productId) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    clearLocalDraft(productId, studentId);
    try {
      const params = new URLSearchParams({ productId });
      if (studentId) params.set("studentId", studentId);
      await fetch(`/api/shop/draft?${params.toString()}`, { method: "DELETE" });
    } catch {}
  }, [productId, studentId]);

  return { restored, didRestore, save, clear };
}
