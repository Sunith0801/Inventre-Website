"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronRight, Package, Check, Loader2, Layers } from "lucide-react";
import type { BundleNode } from "@/server/repos/products";
import { useCart } from "@/lib/cart";

type Variant = {
  id: string;
  size: string;
  sku: string;
  pricePaise: number | null;
  mrpPaise: number | null;
  available: number;
};

/**
 * A bundle's contents on the PDP — SECTIONS FIRST.
 *
 * When the components carry sections (the section builder writes them),
 * the parent sees "Notebooks · 9 items", "Text books · 5 items" and taps
 * a section to see the items. Components without a section fall under
 * "Other items". A kit built before sections existed has none, so it
 * renders the way it always did: one row per component, bundles expand.
 * Never the whole tree at once.
 */
export function BundleTree({
  nodes,
  depth = 0,
  readOnly = false,
}: {
  nodes: BundleNode[];
  depth?: number;
  readOnly?: boolean;
}) {
  if (nodes.length === 0) return null;
  const sectioned = nodes.some((n) => n.sectionName);
  if (!sectioned) {
    return (
      <ul className={depth === 0 ? "divide-y divide-ink-100 rounded-2xl border border-ink-100 overflow-hidden bg-white" : "divide-y divide-ink-100 bg-cream-50/40"}>
        {nodes.map((node) => (
          <BundleRow key={node.componentId} node={node} depth={depth} readOnly={readOnly} />
        ))}
      </ul>
    );
  }

  // Group by section, keeping the builder's order (nodes arrive sorted by
  // section sort_order). Unsectioned components go last.
  const groups: { key: string; name: string; nodes: BundleNode[] }[] = [];
  for (const n of nodes) {
    const key = n.selectorGroupKey && n.sectionName ? n.selectorGroupKey : "__other";
    const name = n.sectionName ?? "Other items";
    let g = groups.find((x) => x.key === key);
    if (!g) {
      g = { key, name, nodes: [] };
      if (key === "__other") groups.push(g);
      else groups.splice(groups.findIndex((x) => x.key === "__other") === -1 ? groups.length : groups.findIndex((x) => x.key === "__other"), 0, g);
    }
    g.nodes.push(n);
  }
  return (
    <ul className={depth === 0 ? "divide-y divide-ink-100 rounded-2xl border border-ink-100 overflow-hidden bg-white" : "divide-y divide-ink-100 bg-cream-50/40"}>
      {groups.map((g) => (
        <SectionRow key={g.key} name={g.name} nodes={g.nodes} depth={depth} readOnly={readOnly} />
      ))}
    </ul>
  );
}

function rupees(paise: number) {
  return "₹" + Math.round(paise / 100).toLocaleString("en-IN");
}

function SectionRow({ name, nodes, depth, readOnly }: { name: string; nodes: BundleNode[]; depth: number; readOnly: boolean }) {
  const [open, setOpen] = useState(false);
  const indent = depth * 16;
  const units = nodes.reduce((a, n) => a + Math.max(1, n.qty), 0);
  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-cream-50 cursor-pointer"
        style={{ paddingLeft: 16 + indent }}
      >
        <motion.span animate={{ rotate: open ? 90 : 0 }} transition={{ duration: 0.2 }} className="text-ink-400">
          <ChevronRight className="h-4 w-4" />
        </motion.span>
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand/10 text-brand-700">
          <Layers className="h-4 w-4" />
        </span>
        <span className="flex-1 min-w-0">
          <span className="text-[14px] font-semibold text-ink-900 truncate block">{name}</span>
          <span className="text-[12px] text-ink-500">
            {nodes.length} item{nodes.length === 1 ? "" : "s"}{units !== nodes.length ? ` · ${units} pieces` : ""}
          </span>
        </span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div key="body" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
            <ul className="divide-y divide-ink-100 bg-cream-50/40">
              {nodes.map((node) => (
                <BundleRow key={node.componentId} node={node} depth={depth + 1} readOnly={readOnly} />
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  );
}

function BundleRow({ node, depth, readOnly }: { node: BundleNode; depth: number; readOnly?: boolean }) {
  const [open, setOpen] = useState(false);
  const hasChildren = node.children.length > 0;
  const indent = depth * 16;

  // Read-only leaf item: non-interactive bullet list
  if (readOnly && !hasChildren) {
    return (
      <li className="flex items-center gap-3 py-2 pr-4 border-b border-ink-50 last:border-0" style={{ paddingLeft: 20 + indent }}>
        <span className="h-1.5 w-1.5 rounded-full bg-brand/40 shrink-0" />
        <span className="flex-1 text-[13px] text-ink-800">{node.name}</span>
        {node.qty > 1 && <span className="text-[11px] text-ink-400 tabular-nums shrink-0">× {node.qty}</span>}
      </li>
    );
  }

  const childSections = hasChildren && node.children.some((c) => c.sectionName)
    ? new Set(node.children.map((c) => c.sectionName ?? "Other items")).size
    : 0;

  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-cream-50 cursor-pointer"
        style={{ paddingLeft: 16 + indent }}
      >
        <motion.span animate={{ rotate: open ? 90 : 0 }} transition={{ duration: 0.2 }} className="text-ink-400">
          <ChevronRight className="h-4 w-4" />
        </motion.span>
        <span className="flex-1 min-w-0">
          <span className="text-[14px] font-medium text-ink-900 truncate block">{node.name}</span>
          <span className="text-[12px] text-ink-500">
            {hasChildren ? (
              <>
                <Package className="inline h-3 w-3 mr-1 -mt-0.5" />
                {childSections ? `${childSections} section${childSections === 1 ? "" : "s"}` : `${node.children.length} item${node.children.length === 1 ? "" : "s"} inside`}
              </>
            ) : (
              "Tap to choose a variation"
            )}
            {node.qty > 1 ? ` · qty ${node.qty}` : ""}
          </span>
        </span>
        {!readOnly && node.pricePaise > 0 && (
          <span className="text-[13px] text-ink-500 tabular-nums whitespace-nowrap">{rupees(node.pricePaise)}</span>
        )}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div key="body" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
            {hasChildren ? <BundleTree nodes={node.children} depth={depth + 1} readOnly={readOnly} /> : <LeafBuyPanel node={node} indent={16 + indent} />}
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  );
}

/** Variation picker + add-to-cart for one leaf item inside a bundle. */
function LeafBuyPanel({ node, indent }: { node: BundleNode; indent: number }) {
  const searchParams = useSearchParams();
  const studentId = searchParams.get("studentId") ?? "";
  const { refresh } = useCart();

  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [picked, setPicked] = useState<Variant | null>(null);
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState(false);
  const [err, setErr] = useState<string>();

  // Lazy-load this item's variations when the panel first mounts.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const sp = new URLSearchParams({ productId: node.productId });
    if (studentId) sp.set("studentId", studentId);
    fetch(`/api/shop/bundle-item?${sp.toString()}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((data: { variants?: Variant[] }) => {
        if (cancelled) return;
        setVariants(data.variants ?? []);
      })
      .catch(() => {
        if (!cancelled) setErr("Couldn't load variations.");
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [node.productId, studentId]);

  async function addToCart() {
    if (!picked) return;
    setAdding(true);
    setErr(undefined);
    try {
      const res = await fetch("/api/cart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ variantId: picked.id, qty: node.qty > 0 ? node.qty : 1, studentId: studentId || undefined }),
      });
      if (!res.ok) throw new Error();
      await refresh();
      setAdded(true);
      setTimeout(() => setAdded(false), 2000);
    } catch {
      setErr("Couldn't add to cart.");
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="py-3 pr-4 bg-cream-50/60" style={{ paddingLeft: indent + 28 }}>
      {loading && (
        <p className="text-[12px] text-ink-500 flex items-center gap-1.5">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading variations…
        </p>
      )}
      {loaded && variants.length === 0 && <p className="text-[12px] text-ink-500">No variations to choose for this item.</p>}
      {variants.length > 0 && (
        <>
          <div className="flex flex-wrap gap-2">
            {variants.map((v) => {
              const active = picked?.id === v.id;
              const oos = v.available <= 0;
              return (
                <button
                  key={v.id}
                  type="button"
                  disabled={oos}
                  onClick={() => setPicked(v)}
                  className={
                    "rounded-lg border px-3 py-1.5 text-[13px] font-medium transition " +
                    (oos ? "border-ink-100 text-ink-300 line-through cursor-not-allowed" : active ? "border-brand bg-brand/5 text-brand-700" : "border-ink-200 text-ink-700 hover:border-ink-400")
                  }
                >
                  {v.size}
                  {v.pricePaise != null && !oos ? <span className="ml-1.5 text-[11px] font-normal text-ink-500">{rupees(v.pricePaise)}</span> : null}
                </button>
              );
            })}
          </div>
          <div className="mt-3 flex items-center gap-3">
            {picked && picked.pricePaise != null && (
              <span className="text-[15px] font-bold text-ink-900 tabular-nums">
                {rupees(picked.pricePaise)}
                {picked.mrpPaise != null && picked.mrpPaise > picked.pricePaise && (
                  <span className="ml-2 text-[12px] font-normal text-ink-400 line-through">{rupees(picked.mrpPaise)}</span>
                )}
              </span>
            )}
            <button
              type="button"
              disabled={!picked || adding}
              onClick={addToCart}
              className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-brand text-white h-9 px-4 text-[13px] font-bold hover:bg-brand-600 transition disabled:opacity-50"
            >
              {added ? (<><Check className="h-3.5 w-3.5" /> Added</>) : adding ? "Adding…" : "Add to cart"}
            </button>
          </div>
        </>
      )}
      {err && <p className="mt-2 text-[12px] font-medium text-red-500">{err}</p>}
    </div>
  );
}
