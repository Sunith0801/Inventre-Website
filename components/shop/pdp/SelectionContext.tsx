"use client";

import { createContext, useContext, useMemo, useState } from "react";

/**
 * Shares the BuyBox's non-size attribute selection (Colour, House, …) with
 * sibling PDP components — today only the Gallery, which reorders its
 * images so the selected colour's photos show first.
 *
 * Both consumers are written to work WITHOUT a provider (context = null →
 * no-op): BuyBox and Gallery render in other layouts (kits, magic boxes)
 * where no selection sharing is needed.
 */
type PdpSelection = {
  /** Mirror of BuyBox's `attrSel`: axis name → selected value. */
  attrSel: Record<string, string>;
  setAttrSel: (sel: Record<string, string>) => void;
};

const Ctx = createContext<PdpSelection | null>(null);

export function PdpSelectionProvider({ children }: { children: React.ReactNode }) {
  const [attrSel, setAttrSel] = useState<Record<string, string>>({});
  const value = useMemo(() => ({ attrSel, setAttrSel }), [attrSel]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePdpSelection(): PdpSelection | null {
  return useContext(Ctx);
}
