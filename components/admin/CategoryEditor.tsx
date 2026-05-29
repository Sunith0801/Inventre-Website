"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Save, Trash2, ChevronRight } from "lucide-react";

type Row = {
  id: string;
  slug: string;
  name: string;
  parentId: string | null;
  path: string;
  sortOrder: number;
};

export function CategoryEditor({ initial }: { initial: Row[] }) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [pending, start] = useTransition();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // sort by path so parents render before children
  const sorted = [...rows].sort((a, b) => a.path.localeCompare(b.path));

  const upsert = (id: string, patch: Partial<Row>) =>
    setRows(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const save = (r: Row) =>
    start(async () => {
      setError(null);
      const isNew = r.id.startsWith("new-");
      const url = isNew ? "/api/admin/categories" : `/api/admin/categories/${r.id}`;
      const method = isNew ? "POST" : "PATCH";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: r.slug,
          name: r.name,
          parentId: r.parentId,
          sortOrder: r.sortOrder,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? "Save failed");
        return;
      }
      setEditingId(null);
      router.refresh();
    });

  const remove = (id: string) =>
    start(async () => {
      if (id.startsWith("new-")) {
        setRows(rows.filter((r) => r.id !== id));
        return;
      }
      if (
        !confirm(
          "Delete this category? Sub-categories and product mappings will be orphaned."
        )
      )
        return;
      const res = await fetch(`/api/admin/categories/${id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setRows(rows.filter((r) => r.id !== id));
        router.refresh();
      } else {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? "Delete failed");
      }
    });

  const addNew = () => {
    const id = `new-${Date.now()}`;
    setRows([
      ...rows,
      { id, slug: "", name: "", parentId: null, path: "", sortOrder: rows.length },
    ]);
    setEditingId(id);
  };

  const depth = (path: string) =>
    path ? path.split(".").length - 1 : 0;

  return (
    <div className="space-y-2">
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">
          {error}
        </div>
      )}
      {sorted.map((r) => {
        const editing = editingId === r.id || r.id.startsWith("new-");
        const indent = depth(r.path) * 16;
        return (
          <div
            key={r.id}
            className="rounded-2xl border border-ink-100 bg-white p-4"
            style={{ marginLeft: indent }}
          >
            {editing ? (
              <div className="space-y-3">
                <div className="grid sm:grid-cols-2 gap-3">
                  <Input
                    label="Name"
                    value={r.name}
                    onChange={(v) => upsert(r.id, { name: v })}
                  />
                  <Input
                    label="Slug"
                    value={r.slug}
                    onChange={(v) =>
                      upsert(r.id, {
                        slug: v.toLowerCase().replace(/[^a-z0-9-]/g, "-"),
                      })
                    }
                  />
                  <label className="flex flex-col">
                    <span className="text-[12px] font-semibold text-ink-700">
                      Parent
                    </span>
                    <select
                      value={r.parentId ?? ""}
                      onChange={(e) =>
                        upsert(r.id, { parentId: e.target.value || null })
                      }
                      className="mt-1 rounded-xl border border-ink-200 bg-white px-3 py-2.5 text-[13px] outline-none focus:border-ink-900"
                    >
                      <option value="">— top-level —</option>
                      {rows
                        .filter((x) => x.id !== r.id)
                        .map((x) => (
                          <option key={x.id} value={x.id}>
                            {x.path || x.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label className="flex flex-col">
                    <span className="text-[12px] font-semibold text-ink-700">
                      Sort order
                    </span>
                    <input
                      type="number"
                      value={r.sortOrder}
                      onChange={(e) =>
                        upsert(r.id, { sortOrder: Number(e.target.value) })
                      }
                      className="mt-1 rounded-xl border border-ink-200 bg-white px-3 py-2.5 text-[13px] tabular-nums outline-none focus:border-ink-900"
                    />
                  </label>
                </div>
                <div className="flex justify-end gap-2 pt-2 border-t border-ink-100">
                  <button
                    onClick={() => remove(r.id)}
                    className="inline-flex items-center gap-1.5 text-[12px] font-medium text-red-600 hover:text-red-700"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Delete
                  </button>
                  <button
                    onClick={() => save(r)}
                    disabled={pending}
                    className="inline-flex items-center gap-2 rounded-full bg-brand text-white px-4 h-9 text-[12px] font-bold hover:bg-brand-600 disabled:opacity-60"
                  >
                    <Save className="h-3 w-3" /> Save
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                {depth(r.path) > 0 && (
                  <ChevronRight className="h-3.5 w-3.5 text-ink-400" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-ink-900">{r.name}</p>
                  <p className="text-[11px] font-mono text-ink-500">{r.path}</p>
                </div>
                <button
                  onClick={() => setEditingId(r.id)}
                  className="text-[12px] font-semibold text-brand"
                >
                  Edit
                </button>
              </div>
            )}
          </div>
        );
      })}
      <button
        onClick={addNew}
        className="w-full inline-flex items-center justify-center gap-2 rounded-2xl border border-dashed border-ink-200 bg-white py-4 text-[13px] font-semibold text-ink-700 hover:border-brand hover:text-brand transition-colors"
      >
        <Plus className="h-4 w-4" /> Add category
      </button>
    </div>
  );
}

function Input({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col">
      <span className="text-[12px] font-semibold text-ink-700">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 rounded-xl border border-ink-200 bg-white px-3 py-2.5 text-[13px] outline-none focus:border-ink-900"
      />
    </label>
  );
}
