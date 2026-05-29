"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, X, Search } from "lucide-react";
import type { Product } from "@/lib/products";

export type Filters = {
  categories: string[];
  sizes: string[];
};

type CatNode = {
  slug: string;
  label: string;
  children: CatNode[];
};

type Props = {
  filters: Filters;
  setFilters: (f: Filters) => void;
  /** Products visible in the grid — drives the dynamic facet options. */
  products: Product[];
};

/** Build a hierarchical category tree from the products' categoryPath arrays. */
function buildCategoryTree(products: Product[]): CatNode[] {
  const root: CatNode[] = [];
  for (const p of products) {
    let level = root;
    for (const seg of p.categoryPath) {
      let node = level.find((n) => n.slug === seg);
      if (!node) {
        node = {
          slug: seg,
          label: seg.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
          children: [],
        };
        level.push(node);
      }
      level = node.children;
    }
  }
  // Sort each level alphabetically by label
  const sortRec = (nodes: CatNode[]) => {
    nodes.sort((a, b) => a.label.localeCompare(b.label));
    for (const n of nodes) sortRec(n.children);
  };
  sortRec(root);
  return root;
}

const ALPHA_ORDER = ["XXS","XS","S","M","L","XL","XXL","2XL","3XL","4XL","5XL","6XL"];
function sortSizes(sizes: string[]): string[] {
  const key = (s: string): [number, number, number, string] => {
    if (/^\d+$/.test(s)) return [1, parseInt(s, 10), 0, s];
    const d = s.match(/^(\d+)-(\d+)$/);
    if (d) return [2, parseInt(d[1], 10), parseInt(d[2], 10), s];
    const ai = ALPHA_ORDER.indexOf(s.toUpperCase());
    if (ai >= 0) return [3, ai, 0, s];
    const lead = s.match(/^(\d+)/);
    if (lead) return [4, parseInt(lead[1], 10), 0, s];
    return [5, 0, 0, s.toUpperCase()];
  };
  return [...sizes].sort((a, b) => {
    const ka = key(a), kb = key(b);
    for (let i = 0; i < 3; i++) if (ka[i] !== kb[i]) return (ka[i] as number) - (kb[i] as number);
    return (ka[3] as string).localeCompare(kb[3] as string);
  });
}

/** Filter a tree by label match, preserving ancestor chains. */
function filterTree(nodes: CatNode[], q: string): CatNode[] {
  if (!q) return nodes;
  const needle = q.toLowerCase();
  const walk = (list: CatNode[]): CatNode[] => {
    const out: CatNode[] = [];
    for (const n of list) {
      const hit = n.label.toLowerCase().includes(needle);
      const kids = walk(n.children);
      if (hit || kids.length) {
        out.push({ ...n, children: hit ? n.children : kids });
      }
    }
    return out;
  };
  return walk(nodes);
}

export function FilterSidebar({ filters, setFilters, products }: Props) {
  const categoryTree = useMemo(() => buildCategoryTree(products), [products]);
  const [search, setSearch] = useState("");
  const visibleTree = useMemo(
    () => filterTree(categoryTree, search.trim()),
    [categoryTree, search]
  );
  const flatCount = useMemo(() => {
    let c = 0;
    const walk = (l: CatNode[]) => {
      for (const n of l) {
        c++;
        walk(n.children);
      }
    };
    walk(categoryTree);
    return c;
  }, [categoryTree]);

  // Sizes are hidden until at least one category is picked, then narrow to
  // that category's actual size list (Belt → S/M/L/XL/2XL, Shirt → 18-48, …).
  // Showing every size cross-category upfront is noisy and meaningless.
  const availableSizes = useMemo(() => {
    if (filters.categories.length === 0) return [];
    const matching = products.filter((p) =>
      p.categoryPath.some((seg) => filters.categories.includes(seg))
    );
    const set = new Set<string>();
    for (const p of matching) for (const s of p.sizes) if (s) set.add(s);
    return sortSizes([...set]);
  }, [products, filters.categories]);

  const toggle = (key: "categories" | "sizes", val: string) => {
    const list = filters[key];
    setFilters({
      ...filters,
      [key]: list.includes(val) ? list.filter((v) => v !== val) : [...list, val],
    });
  };

  const activeCount = filters.categories.length + filters.sizes.length;

  const clear = () => setFilters({ categories: [], sizes: [] });

  return (
    <aside className="lg:sticky lg:top-28 lg:self-start">
      <div className="rounded-2xl border border-ink-100 bg-white p-5">
        <div className="flex items-center justify-between pb-4 border-b border-ink-200">
          <h2 className="font-display text-[15px] font-extrabold tracking-[0.14em] uppercase text-ink-900">
            Categories
          </h2>
          {activeCount > 0 && (
            <button
              onClick={clear}
              className="inline-flex items-center gap-1 text-[12px] font-medium text-brand hover:text-brand-700"
            >
              Clear ({activeCount}) <X className="h-3 w-3" />
            </button>
          )}
        </div>

        {flatCount > 8 && (
          <div className="relative mt-3">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink-400" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search categories…"
              aria-label="Search categories"
              className="w-full h-9 pl-8 pr-7 rounded-lg border border-ink-200 bg-white text-[13px] outline-none focus:border-ink-900 placeholder:text-ink-400"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                aria-label="Clear category search"
                className="absolute right-2 top-1/2 -translate-y-1/2 grid h-5 w-5 place-items-center rounded-full text-ink-400 hover:text-ink-700"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        )}

        <ul className="mt-3 space-y-0.5">
          {categoryTree.length === 0 ? (
            <li className="text-[12px] text-ink-500 px-2 py-1">No categories.</li>
          ) : visibleTree.length === 0 ? (
            <li className="text-[12px] text-ink-500 px-2 py-2">
              No categories match &ldquo;{search}&rdquo;.
            </li>
          ) : (
            visibleTree.map((node) => (
              <CategoryItem
                key={node.slug}
                node={node}
                depth={0}
                selected={filters.categories}
                onToggle={(slug) => toggle("categories", slug)}
                forceOpen={search.trim().length > 0}
              />
            ))
          )}
        </ul>

        {availableSizes.length > 0 && (
          <Section title="Size">
            <div className="flex flex-wrap gap-2">
              {availableSizes.map((s) => {
                const active = filters.sizes.includes(s);
                return (
                  <button
                    key={s}
                    onClick={() => toggle("sizes", s)}
                    className={
                      "h-9 min-w-9 px-3 rounded-md border text-[12px] font-semibold transition-all " +
                      (active
                        ? "bg-ink-900 text-white border-ink-900"
                        : "bg-white text-ink-700 border-ink-200 hover:border-ink-900")
                    }
                  >
                    {s}
                  </button>
                );
              })}
            </div>
          </Section>
        )}

      </div>
    </aside>
  );
}

function CategoryItem({
  node,
  depth,
  selected,
  onToggle,
  forceOpen = false,
}: {
  node: CatNode;
  depth: number;
  selected: string[];
  onToggle: (slug: string) => void;
  forceOpen?: boolean;
}) {
  const hasChildren = node.children.length > 0;
  const [openState, setOpen] = useState(depth === 0);
  const open = forceOpen || openState;
  const checked = selected.includes(node.slug);
  return (
    <li>
      <div
        className="group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-cream-100 transition-colors"
        style={{ paddingLeft: 8 + depth * 16 }}
      >
        <input
          type="checkbox"
          checked={checked}
          onChange={() => onToggle(node.slug)}
          aria-label={node.label}
          className="h-4 w-4 rounded border-ink-300 accent-brand cursor-pointer shrink-0"
        />
        <button
          type="button"
          onClick={() => (hasChildren ? setOpen(!open) : onToggle(node.slug))}
          className={
            "flex-1 flex items-center justify-between gap-2 text-left transition-colors " +
            (depth === 0
              ? "font-display font-bold text-[14px] text-ink-900"
              : depth === 1
              ? "font-semibold text-[13.5px] text-ink-800"
              : "text-[13px] text-ink-600")
          }
        >
          <span className={checked ? "text-brand" : ""}>{node.label}</span>
          {hasChildren && (
            <ChevronDown
              className={`h-3.5 w-3.5 text-ink-400 transition-transform ${open ? "rotate-0" : "-rotate-90"}`}
            />
          )}
        </button>
      </div>
      {hasChildren && (
        <AnimatePresence initial={false}>
          {open && (
            <motion.ul
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
              className="overflow-hidden"
            >
              {node.children.map((c) => (
                <CategoryItem
                  key={c.slug}
                  node={c}
                  depth={depth + 1}
                  selected={selected}
                  onToggle={onToggle}
                  forceOpen={forceOpen}
                />
              ))}
            </motion.ul>
          )}
        </AnimatePresence>
      )}
    </li>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-6 pt-6 border-t border-ink-100">
      <h3 className="font-display text-[11px] font-semibold tracking-[0.16em] uppercase text-ink-500 mb-3">
        {title}
      </h3>
      {children}
    </div>
  );
}
