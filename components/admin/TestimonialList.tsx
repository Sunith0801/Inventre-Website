"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Save, Trash2 } from "lucide-react";

type Row = {
  id: string;
  principalName: string;
  role: string;
  shortLabel: string | null;
  quote: string;
  photoUrl: string | null;
  isFeatured: boolean;
  sortOrder: number;
  schoolId: string | null;
  schoolName: string | null;
};

export function TestimonialList({
  initial,
  schools,
}: {
  initial: Row[];
  schools: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [pending, start] = useTransition();
  const [editingId, setEditingId] = useState<string | null>(null);

  const upsert = (id: string, patch: Partial<Row>) => {
    setRows(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  const save = (r: Row) =>
    start(async () => {
      const url = r.id.startsWith("new-")
        ? "/api/admin/testimonials"
        : `/api/admin/testimonials/${r.id}`;
      const method = r.id.startsWith("new-") ? "POST" : "PATCH";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          principalName: r.principalName,
          role: r.role,
          shortLabel: r.shortLabel,
          quote: r.quote,
          photoUrl: r.photoUrl,
          isFeatured: r.isFeatured,
          sortOrder: r.sortOrder,
          schoolId: r.schoolId,
        }),
      });
      if (res.ok) {
        setEditingId(null);
        router.refresh();
      }
    });

  const remove = (id: string) =>
    start(async () => {
      if (id.startsWith("new-")) {
        setRows(rows.filter((r) => r.id !== id));
        return;
      }
      if (!confirm("Delete this testimonial?")) return;
      const res = await fetch(`/api/admin/testimonials/${id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setRows(rows.filter((r) => r.id !== id));
        router.refresh();
      }
    });

  const addNew = () => {
    const id = `new-${Date.now()}`;
    setRows([
      ...rows,
      {
        id,
        principalName: "",
        role: "Principal",
        shortLabel: "",
        quote: "",
        photoUrl: "",
        isFeatured: true,
        sortOrder: rows.length,
        schoolId: null,
        schoolName: null,
      },
    ]);
    setEditingId(id);
  };

  return (
    <div className="space-y-3">
      {rows.map((r) => {
        const editing = editingId === r.id || r.id.startsWith("new-");
        return (
          <div
            key={r.id}
            className="rounded-2xl border border-ink-100 bg-white p-5"
          >
            {editing ? (
              <div className="space-y-3">
                <div className="grid sm:grid-cols-2 gap-3">
                  <Input
                    label="Principal name"
                    value={r.principalName}
                    onChange={(v) => upsert(r.id, { principalName: v })}
                  />
                  <Input
                    label="Role"
                    value={r.role}
                    onChange={(v) => upsert(r.id, { role: v })}
                  />
                  <Input
                    label="Short label (e.g. INDUS INTL)"
                    value={r.shortLabel ?? ""}
                    onChange={(v) => upsert(r.id, { shortLabel: v })}
                  />
                  <label className="flex flex-col">
                    <span className="text-[12px] font-semibold text-ink-700">
                      School
                    </span>
                    <select
                      value={r.schoolId ?? ""}
                      onChange={(e) =>
                        upsert(r.id, { schoolId: e.target.value || null })
                      }
                      className="mt-1 rounded-xl border border-ink-200 bg-white px-3 py-2.5 text-[14px] outline-none focus:border-ink-900"
                    >
                      <option value="">— none —</option>
                      {schools.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <Input
                    label="Photo URL"
                    value={r.photoUrl ?? ""}
                    onChange={(v) => upsert(r.id, { photoUrl: v })}
                    className="sm:col-span-2"
                  />
                </div>
                <label className="flex flex-col">
                  <span className="text-[12px] font-semibold text-ink-700">
                    Quote
                  </span>
                  <textarea
                    value={r.quote}
                    onChange={(e) => upsert(r.id, { quote: e.target.value })}
                    rows={3}
                    className="mt-1 rounded-xl border border-ink-200 bg-white px-3 py-2.5 text-[14px] outline-none focus:border-ink-900 resize-none"
                  />
                </label>
                <div className="flex items-center justify-between pt-2 border-t border-ink-100">
                  <label className="flex items-center gap-2 text-[13px] text-ink-700">
                    <input
                      type="checkbox"
                      checked={r.isFeatured}
                      onChange={(e) =>
                        upsert(r.id, { isFeatured: e.target.checked })
                      }
                      className="h-4 w-4 accent-brand"
                    />
                    Show on homepage
                  </label>
                  <div className="flex gap-2">
                    <button
                      onClick={() => remove(r.id)}
                      disabled={pending}
                      className="inline-flex items-center gap-1.5 text-[13px] font-medium text-red-600 hover:text-red-700"
                    >
                      <Trash2 className="h-3.5 w-3.5" /> Delete
                    </button>
                    <button
                      onClick={() => save(r)}
                      disabled={pending}
                      className="inline-flex items-center gap-2 rounded-full bg-brand text-white px-4 h-9 text-[12px] font-bold hover:bg-brand-600"
                    >
                      <Save className="h-3 w-3" /> Save
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex gap-4">
                <div className="h-14 w-14 rounded-full bg-cream-100 overflow-hidden shrink-0">
                  {r.photoUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={r.photoUrl}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-ink-900">
                    {r.principalName}
                  </p>
                  <p className="text-[12px] text-ink-500">
                    {r.role}
                    {r.schoolName && ` · ${r.schoolName}`}
                  </p>
                  <p className="mt-2 text-[13px] text-ink-700 line-clamp-2">
                    "{r.quote}"
                  </p>
                </div>
                <button
                  onClick={() => setEditingId(r.id)}
                  className="text-[13px] font-semibold text-brand self-start"
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
        className="w-full inline-flex items-center justify-center gap-2 rounded-2xl border border-dashed border-ink-200 bg-white py-5 text-[13px] font-semibold text-ink-700 hover:border-brand hover:text-brand transition-colors"
      >
        <Plus className="h-4 w-4" /> Add testimonial
      </button>
    </div>
  );
}

function Input({
  label,
  value,
  onChange,
  className = "",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  className?: string;
}) {
  return (
    <label className={"flex flex-col " + className}>
      <span className="text-[12px] font-semibold text-ink-700">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 rounded-xl border border-ink-200 bg-white px-3 py-2.5 text-[14px] outline-none focus:border-ink-900"
      />
    </label>
  );
}
