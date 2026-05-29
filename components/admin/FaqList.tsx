"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Save, Trash2 } from "lucide-react";

type Row = {
  id: string;
  question: string;
  answer: string;
  category: string;
  sortOrder: number;
  isActive: boolean;
};

export function FaqList({ initial }: { initial: Row[] }) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [pending, start] = useTransition();
  const [editingId, setEditingId] = useState<string | null>(null);

  const upsert = (id: string, patch: Partial<Row>) =>
    setRows(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const save = (r: Row) =>
    start(async () => {
      const url = r.id.startsWith("new-")
        ? "/api/admin/faqs"
        : `/api/admin/faqs/${r.id}`;
      const method = r.id.startsWith("new-") ? "POST" : "PATCH";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: r.question,
          answer: r.answer,
          category: r.category,
          sortOrder: r.sortOrder,
          isActive: r.isActive,
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
      if (!confirm("Delete this FAQ?")) return;
      const res = await fetch(`/api/admin/faqs/${id}`, { method: "DELETE" });
      if (res.ok) setRows(rows.filter((r) => r.id !== id));
    });

  const addNew = () => {
    const id = `new-${Date.now()}`;
    setRows([
      ...rows,
      {
        id,
        question: "",
        answer: "",
        category: "general",
        sortOrder: rows.length,
        isActive: true,
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
                <label className="flex flex-col">
                  <span className="text-[12px] font-semibold text-ink-700">Question</span>
                  <input
                    type="text"
                    value={r.question}
                    onChange={(e) => upsert(r.id, { question: e.target.value })}
                    className="mt-1 rounded-xl border border-ink-200 bg-white px-3 py-2.5 text-[14px] outline-none focus:border-ink-900"
                  />
                </label>
                <label className="flex flex-col">
                  <span className="text-[12px] font-semibold text-ink-700">Answer</span>
                  <textarea
                    rows={3}
                    value={r.answer}
                    onChange={(e) => upsert(r.id, { answer: e.target.value })}
                    className="mt-1 rounded-xl border border-ink-200 bg-white px-3 py-2.5 text-[14px] outline-none focus:border-ink-900 resize-none"
                  />
                </label>
                <div className="flex items-center justify-between pt-2 border-t border-ink-100">
                  <label className="flex items-center gap-2 text-[13px] text-ink-700">
                    <input
                      type="checkbox"
                      checked={r.isActive}
                      onChange={(e) => upsert(r.id, { isActive: e.target.checked })}
                      className="h-4 w-4 accent-brand"
                    />
                    Active
                  </label>
                  <div className="flex gap-2">
                    <button
                      onClick={() => remove(r.id)}
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
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <p className="font-semibold text-ink-900">{r.question}</p>
                  <p className="mt-1 text-[13px] text-ink-600 line-clamp-2">
                    {r.answer}
                  </p>
                </div>
                <button
                  onClick={() => setEditingId(r.id)}
                  className="text-[13px] font-semibold text-brand"
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
        <Plus className="h-4 w-4" /> Add FAQ
      </button>
    </div>
  );
}
