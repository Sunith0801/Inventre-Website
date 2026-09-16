"use client";

import { createContext, useContext, useMemo, useState } from "react";

/**
 * Shares the BuyBox's selection with sibling PDP components — today only
 * the Gallery, which shows the selected colour's photos first and, when a
 * photo is pinned to one variant, shows that photo only for that size.
 *
 * Both consumers are written to work WITHOUT a provider (context = null →
 * no-op): BuyBox and Gallery render in other layouts (kits, magic boxes)
 * where no selection sharing is needed.
 */
type PdpSelection = {
  /** Mirror of BuyBox's `attrSel`: axis name → selected value. */
  attrSel: Record<string, string>;
  setAttrSel: (sel: Record<string, string>) => void;
  /** The exact variant the current colour + size resolves to, if known. */
  variantId: string | null;
  setVariantId: (id: string | null) => void;
};

const Ctx = createContext<PdpSelection | null>(null);

export function PdpSelectionProvider({ children }: { children: React.ReactNode }) {
  const [attrSel, setAttrSel] = useState<Record<string, string>>({});
  const [variantId, setVariantId] = useState<string | null>(null);
  const value = useMemo(() => ({ attrSel, setAttrSel, variantId, setVariantId }), [attrSel, variantId]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePdpSelection(): PdpSelection | null {
  return useContext(Ctx);
}
