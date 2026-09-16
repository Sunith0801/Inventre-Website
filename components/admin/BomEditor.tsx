"use client";

import { useState, useMemo, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Save } from "lucide-react";
import { Card, CardHeader } from "@/components/admin/ui/primitives";
import { Button } from "@/components/admin/ui/primitives-client";

/**
 * Editable BOM contents for a kit / Magic Box, shown on the product page.
 * Saves through POST /api/admin/boms which upserts product_bundles and
 * replaces bundle_components.
 *
 * Rows are identified by `productId` (UUID) rather than the legacy
 * itemCode — many products (everything created via /admin/catalog/build
 * and a sizeable chunk of imported items) have a null item_code, which
 * previously caused those rows to render as empty "Type to search…"
 * inputs and silently wiped the BOM on the next save.
 */
type CompRow = { productId: string | ""; label: string; qty: number };
type Item = { id: string; code: string | null; name: string };

export function BomEditor({
  productId,
  initial,
  items,
}: {
  productId: string;
  initial: CompRow[];
  items: Item[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [rows, setRows] = useState<CompRow[]>(
    initial.length ? initial : [{ productId: "", label: "", qty: 1 }],
  );

  // Display string the typeahead options expose. We include the itemCode
  // (or a short suffix from the UUID when none) so admins can tell apart
  // two products with identical names — datalist options have no
  // metadata column.
  const optionLabel = (i: Item) =>
    i.code ? `${i.name} (${i.code})` : `${i.name} (${i.id.slice(0, 8)})`;

  // Resolve any label back to a productId — used at save time and when
  // the admin types/pastes a label rather than clicking a suggestion.
  const labelToId = useMemo(() => {
    const m = new Map<string, string>();
    for (const i of items) {
      m.set(optionLabel(i), i.id);
      // Plain-name fallback so a user typing just "Notebook" can still
      // match a uniquely-named product. The label key wins when both are
      // present, and the optionLabel disambiguates collisions.
      if (!m.has(i.name)) m.set(i.name, i.id);
    }
    return m;
  }, [items]);

  const inputCls =
    "h-9 w-full px-2.5 rounded-lg border border-ink-200 text-[13px] bg-white outline-none focus:border-ink-900";

  function save() {
    setErr(null);
    const components: { productId: string; qty: number }[] = [];
    for (const r of rows) {
      const label = r.label.trim();
      if (!label && !r.productId) continue; // blank row — skip
      const id = r.productId || labelToId.get(label) || "";
      if (!id) {
        setErr(`Unknown item: "${label}"`);
        return;
      }
      components.push({ productId: id, qty: r.qty });
    }
    if (!components.length) {
      setErr("Add at least one component.");
      return;
    }
    start(async () => {
      const res = await fetch("/api/admin/boms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId, components }),
      });
      if (!res.ok) {
        setErr("Save failed.");
        return;
      }
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader
        title="BOM contents"
      />
      <datalist id="bom-editor-items">
        {items.map((i) => (
          <option key={i.id} value={optionLabel(i)} />
        ))}
      </datalist>
      <div className="overflow-x-auto">
        <table className="w-full text-[13px] min-w-[480px]">
          <thead>
            <tr className="text-left text-[10px] font-semibold tracking-wider uppercase text-ink-500">
              <th className="py-2 pr-3">Component item</th>
              <th className="py-2 pr-3 w-24 text-right">Qty</th>
              <th className="py-2 w-8"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-ink-100">
                <td className="py-1.5 pr-3">
                  <input
                    list="bom-editor-items"
                    className={inputCls}
                    value={r.label}
                    placeholder="Type to search items…"
                    onChange={(e) => {
                      const v = e.target.value;
                      // Re-resolve productId from the live label so picking
                      // a suggestion (or pasting an exact label) re-binds
                      // the row even after edits.
                      const id = labelToId.get(v.trim()) ?? "";
                      setRows((cur) =>
                        cur.map((x, idx) =>
                          idx === i ? { ...x, label: v, productId: id } : x,
                        ),
                      );
                      setSaved(false);
                    }}
                  />
                </td>
                <td className="py-1.5 pr-3">
                  <input
                    type="number"
                    min={1}
                    className={`${inputCls} text-right`}
                    value={r.qty}
                    onChange={(e) => {
                      const q = parseInt(e.target.value) || 1;
                      setRows((cur) =>
                        cur.map((x, idx) => (idx === i ? { ...x, qty: q } : x)),
                      );
                      setSaved(false);
                    }}
                  />
                </td>
                <td className="py-1.5">
                  <button
                    type="button"
                    onClick={() =>
                      setRows((cur) => cur.filter((_, idx) => idx !== i))
                    }
                    className="grid place-items-center h-7 w-7 rounded-md text-red-600 hover:bg-red-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-3 mt-3">
        <button
          type="button"
          onClick={() =>
            setRows((c) => [...c, { productId: "", label: "", qty: 1 }])
          }
          className="inline-flex items-center gap-1 text-[12px] text-brand-700 font-medium"
        >
          <Plus className="h-3.5 w-3.5" /> Add component
        </button>
        <div className="ml-auto flex items-center gap-3">
          {err ? <span className="text-[12px] text-red-700">{err}</span> : null}
          {saved ? (
            <span className="text-[12px] text-emerald-700">✓ Saved</span>
          ) : null}
          <Button
            type="button"
            busy={pending}
            onClick={save}
            size="sm"
            icon={<Save className="h-3.5 w-3.5" />}
          >
            Save BOM
          </Button>
        </div>
      </div>
    </Card>
  );
}
