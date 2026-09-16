"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Save, Trash2, Pencil } from "lucide-react";
import { Button } from "@/components/admin/ui/primitives-client";
import { Field, Input, Textarea, Checkbox, Badge } from "@/components/admin/ui/primitives";
import { ConfirmDialog } from "@/components/admin/ui/dialog";

type Row = {
  id: string;
  question: string;
  answer: string;
  category: string;
  sortOrder: number;
  isActive: boolean;
};

/**
 * The storefront FAQ list. Rows read as they do on the site; one opens
 * inline for editing so the page never becomes a wall of forms.
 */
export function FaqList({ initial }: { initial: Row[] }) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [pending, start] = useTransition();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<Row | null>(null);

  const upsert = (id: string, patch: Partial<Row>) =>
    setRows(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const save = (r: Row) =>
    start(async () => {
      const url = r.id.startsWith("new-") ? "/api/admin/faqs" : `/api/admin/faqs/${r.id}`;
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
        setToDelete(null);
        return;
      }
      const res = await fetch(`/api/admin/faqs/${id}`, { method: "DELETE" });
      if (res.ok) setRows(rows.filter((r) => r.id !== id));
      setToDelete(null);
    });

  const cancel = (r: Row) => {
    if (r.id.startsWith("new-")) setRows(rows.filter((x) => x.id !== r.id));
    setEditingId(null);
  };

  const addNew = () => {
    const id = `new-${Date.now()}`;
    setRows([...rows, { id, question: "", answer: "", category: "general", sortOrder: rows.length, isActive: true }]);
    setEditingId(id);
  };

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-2xl border border-ink-100/70 bg-white shadow-[0_1px_2px_rgba(10,10,10,0.04)]">
        {rows.length === 0 ? (
          <p className="px-5 py-8 text-center text-[13px] text-ink-500">No FAQs yet — add the first one below.</p>
        ) : null}
        {rows.map((r, i) => {
          const editing = editingId === r.id || r.id.startsWith("new-");
          return (
            <div key={r.id} className={`${i > 0 ? "border-t border-ink-100/70" : ""} ${editing ? "bg-cream-50/50" : ""}`}>
              {editing ? (
                <div className="space-y-4 p-5">
                  <Field label="Question" htmlFor={`faq-q-${r.id}`} required>
                    <Input id={`faq-q-${r.id}`} value={r.question} onChange={(e) => upsert(r.id, { question: e.target.value })} autoFocus />
                  </Field>
                  <Field label="Answer" htmlFor={`faq-a-${r.id}`} required>
                    <Textarea id={`faq-a-${r.id}`} rows={3} value={r.answer} onChange={(e) => upsert(r.id, { answer: e.target.value })} />
                  </Field>
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink-100/70 pt-4">
                    <Checkbox label="Shown on the website" checked={r.isActive} onChange={(e) => upsert(r.id, { isActive: e.target.checked })} />
                    <div className="flex items-center gap-2">
                      {!r.id.startsWith("new-") ? (
                        <Button variant="danger" size="sm" disabled={pending} onClick={() => setToDelete(r)} icon={<Trash2 className="h-3.5 w-3.5" />}>
                          Delete
                        </Button>
                      ) : null}
                      <Button variant="secondary" size="sm" disabled={pending} onClick={() => cancel(r)}>Cancel</Button>
                      <Button size="sm" busy={pending} onClick={() => save(r)} icon={<Save className="h-3.5 w-3.5" />}>Save</Button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-4 px-5 py-4">
                  <span className="mt-0.5 w-6 shrink-0 text-[12px] font-semibold tabular-nums text-ink-400">{i + 1}.</span>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-ink-900">{r.question || <span className="text-ink-400">Untitled</span>}</p>
                    <p className="mt-0.5 line-clamp-2 text-[13px] text-ink-600">{r.answer}</p>
                  </div>
                  {!r.isActive ? <Badge tone="default" size="sm">Hidden</Badge> : null}
                  <Button variant="ghost" size="sm" onClick={() => setEditingId(r.id)} icon={<Pencil className="h-3.5 w-3.5" />}>
                    Edit
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <Button variant="secondary" onClick={addNew} icon={<Plus className="h-3.5 w-3.5" />}>
        Add FAQ
      </Button>

      <ConfirmDialog
        open={toDelete !== null}
        onClose={() => (pending ? undefined : setToDelete(null))}
        onConfirm={() => toDelete && remove(toDelete.id)}
        title="Delete this FAQ?"
        description={toDelete ? `“${toDelete.question}” is removed from the website.` : undefined}
        confirmLabel="Delete"
        busy={pending}
      />
    </div>
  );
}
