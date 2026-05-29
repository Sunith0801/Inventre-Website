"use client";

import { useState, useMemo, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Save } from "lucide-react";
import { Button } from "@/components/admin/ui/primitives-client";

type Item = { id: string; code: string; name: string };
type GradeOpt = { value: string; label: string };

export function NewBomForm({
  schools,
  schoolGrades,
  items,
  bomItems,
  initialSchoolId,
  initialGrade,
}: {
  schools: { id: string; name: string }[];
  schoolGrades: Record<string, GradeOpt[]>;
  items: Item[];
  /** Kit / Magic Box products — the only valid "BOM item". */
  bomItems: Item[];
  initialSchoolId?: string;
  initialGrade?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const [schoolId, setSchoolId] = useState(initialSchoolId ?? "");
  const [grade, setGrade] = useState(initialGrade ?? "");
  const [kit, setKit] = useState("");
  const [comps, setComps] = useState<{ code: string; qty: number }[]>([
    { code: "", qty: 1 },
  ]);

  const codeToId = useMemo(
    () => new Map(items.map((i) => [i.code, i.id])),
    [items]
  );
  const grades = schoolGrades[schoolId] ?? [];

  // When a BOM item is chosen, prefill its existing components from ERP.
  const kitId = codeToId.get(kit.trim());
  useEffect(() => {
    if (!kitId) return;
    let cancelled = false;
    fetch(`/api/admin/boms?productId=${kitId}`)
      .then((r) => r.json())
      .then((d: { components?: { code: string | null; qty: number }[] }) => {
        if (cancelled || !d.components?.length) return;
        setComps(
          d.components.map((c) => ({
            code: c.code ?? "",
            qty: Math.max(1, Math.round(Number(c.qty) || 1)),
          }))
        );
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [kitId]);

  const inputCls =
    "h-9 w-full px-2.5 rounded-lg border border-ink-200 text-[13px] bg-white outline-none focus:border-ink-900";

  function submit() {
    setErr(null);
    const productId = codeToId.get(kit.trim());
    if (!productId) {
      setErr("Pick a valid BOM item (use the dropdown suggestions).");
      return;
    }
    const components: { productId: string; qty: number }[] = [];
    for (const c of comps) {
      const code = c.code.trim();
      if (!code) continue;
      const id = codeToId.get(code);
      if (!id) {
        setErr(`Unknown component item: "${code}"`);
        return;
      }
      components.push({ productId: id, qty: c.qty });
    }
    if (!components.length) {
      setErr("Add at least one component item.");
      return;
    }
    start(async () => {
      const res = await fetch("/api/admin/boms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId,
          schoolId: schoolId || undefined,
          grade: grade || undefined,
          components,
        }),
      });
      if (!res.ok) {
        setErr("Save failed.");
        return;
      }
      router.push(`/admin/products/${productId}`);
    });
  }

  return (
    <div className="space-y-5">
      <datalist id="bom-items">
        {items.map((i) => (
          <option key={i.id} value={i.code}>
            {i.name}
          </option>
        ))}
      </datalist>
      <datalist id="bom-kit-items">
        {bomItems.map((i) => (
          <option key={i.id} value={i.code}>
            {i.name}
          </option>
        ))}
      </datalist>

      <div className="grid grid-cols-2 gap-4">
        <label className="block">
          <span className="text-[12px] font-medium text-ink-600">School</span>
          <select
            className={inputCls}
            value={schoolId}
            onChange={(e) => {
              setSchoolId(e.target.value);
              setGrade("");
            }}
          >
            <option value="">— select school —</option>
            {schools.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-[12px] font-medium text-ink-600">Grade</span>
          <select
            className={inputCls}
            value={grade}
            onChange={(e) => setGrade(e.target.value)}
            disabled={!schoolId}
          >
            <option value="">
              {schoolId ? "— select grade —" : "pick a school first"}
            </option>
            {grades.map((g) => (
              <option key={g.value} value={g.value}>
                {g.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="block">
        <span className="text-[12px] font-medium text-ink-600">
          BOM item (the Bookkit / Magic Box)
        </span>
        <input
          list="bom-kit-items"
          className={inputCls}
          value={kit}
          placeholder="Type to search Bookkit / Magic Box items…"
          onChange={(e) => setKit(e.target.value)}
        />
      </label>

      <div>
        <span className="text-[12px] font-medium text-ink-600">Components</span>
        <table className="w-full text-[13px] mt-1">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wider text-ink-500">
              <th className="py-1.5 pr-3">Item</th>
              <th className="py-1.5 pr-3 w-24 text-right">Qty</th>
              <th className="py-1.5 w-8"></th>
            </tr>
          </thead>
          <tbody>
            {comps.map((c, i) => (
              <tr key={i}>
                <td className="py-1 pr-3">
                  <input
                    list="bom-items"
                    className={inputCls}
                    value={c.code}
                    placeholder="Type to search items…"
                    onChange={(e) =>
                      setComps((cur) =>
                        cur.map((x, idx) =>
                          idx === i ? { ...x, code: e.target.value } : x
                        )
                      )
                    }
                  />
                </td>
                <td className="py-1 pr-3">
                  <input
                    type="number"
                    min={1}
                    className={`${inputCls} text-right`}
                    value={c.qty}
                    onChange={(e) =>
                      setComps((cur) =>
                        cur.map((x, idx) =>
                          idx === i
                            ? { ...x, qty: parseInt(e.target.value) || 1 }
                            : x
                        )
                      )
                    }
                  />
                </td>
                <td className="py-1">
                  <button
                    type="button"
                    onClick={() =>
                      setComps((cur) => cur.filter((_, idx) => idx !== i))
                    }
                    className="grid place-items-center h-8 w-8 rounded-md text-red-600 hover:bg-red-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button
          type="button"
          onClick={() => setComps((c) => [...c, { code: "", qty: 1 }])}
          className="mt-2 inline-flex items-center gap-1 text-[12px] text-brand-700 font-medium"
        >
          <Plus className="h-3.5 w-3.5" /> Add component
        </button>
      </div>

      <div className="flex items-center gap-3 pt-3 border-t border-ink-100">
        {err ? <span className="text-[13px] text-red-700">{err}</span> : null}
        <Button
          busy={pending}
          onClick={submit}
          icon={<Save className="h-3.5 w-3.5" />}
          className="ml-auto"
        >
          Create BOM
        </Button>
      </div>
    </div>
  );
}
