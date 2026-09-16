"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Save, Trash2, Pencil } from "lucide-react";
import { Button } from "@/components/admin/ui/primitives-client";
import { Field, Input, Select, Textarea, Checkbox, FormGrid, Badge } from "@/components/admin/ui/primitives";
import { ConfirmDialog } from "@/components/admin/ui/dialog";

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

/**
 * Homepage testimonials — principal quotes. Same inline-edit pattern as
 * the FAQ list: rows read as they do on the site, one opens for editing.
 */
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
  const [toDelete, setToDelete] = useState<Row | null>(null);

  const upsert = (id: string, patch: Partial<Row>) => {
    setRows(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  const save = (r: Row) =>
    start(async () => {
      const url = r.id.startsWith("new-") ? "/api/admin/testimonials" : `/api/admin/testimonials/${r.id}`;
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
        setToDelete(null);
        return;
      }
      const res = await fetch(`/api/admin/testimonials/${id}`, { method: "DELETE" });
      if (res.ok) {
        setRows(rows.filter((r) => r.id !== id));
        router.refresh();
      }
      setToDelete(null);
    });

  const cancel = (r: Row) => {
    if (r.id.startsWith("new-")) setRows(rows.filter((x) => x.id !== r.id));
    setEditingId(null);
  };

  const addNew = () => {
    const id = `new-${Date.now()}`;
    setRows([
      ...rows,
      { id, principalName: "", role: "Principal", shortLabel: "", quote: "", photoUrl: "", isFeatured: true, sortOrder: rows.length, schoolId: null, schoolName: null },
    ]);
    setEditingId(id);
  };

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-2xl border border-ink-100/70 bg-white shadow-[0_1px_2px_rgba(10,10,10,0.04)]">
        {rows.length === 0 ? (
          <p className="px-5 py-8 text-center text-[13px] text-ink-500">No testimonials yet — add the first one below.</p>
        ) : null}
        {rows.map((r, i) => {
          const editing = editingId === r.id || r.id.startsWith("new-");
          return (
            <div key={r.id} className={`${i > 0 ? "border-t border-ink-100/70" : ""} ${editing ? "bg-cream-50/50" : ""}`}>
              {editing ? (
                <div className="space-y-4 p-5">
                  <FormGrid cols={3}>
                    <Field label="Name" htmlFor={`t-name-${r.id}`} required>
                      <Input id={`t-name-${r.id}`} value={r.principalName} onChange={(e) => upsert(r.id, { principalName: e.target.value })} placeholder="Mrs. Aparna Menon" autoFocus />
                    </Field>
                    <Field label="Role" htmlFor={`t-role-${r.id}`}>
                      <Input id={`t-role-${r.id}`} value={r.role} onChange={(e) => upsert(r.id, { role: e.target.value })} placeholder="Principal" />
                    </Field>
                    <Field label="School" htmlFor={`t-school-${r.id}`}>
                      <Select id={`t-school-${r.id}`} value={r.schoolId ?? ""} onChange={(e) => upsert(r.id, { schoolId: e.target.value || null })}>
                        <option value="">Not linked</option>
                        {schools.map((s) => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Short label" htmlFor={`t-label-${r.id}`} hint="Shown under the name, e.g. INDUS INTL">
                      <Input id={`t-label-${r.id}`} value={r.shortLabel ?? ""} onChange={(e) => upsert(r.id, { shortLabel: e.target.value })} />
                    </Field>
                    <Field label="Photo URL" htmlFor={`t-photo-${r.id}`} className="sm:col-span-2">
                      <Input id={`t-photo-${r.id}`} value={r.photoUrl ?? ""} onChange={(e) => upsert(r.id, { photoUrl: e.target.value })} placeholder="https://…" className="font-mono" />
                    </Field>
                    <Field label="Quote" htmlFor={`t-quote-${r.id}`} required className="sm:col-span-2 lg:col-span-3">
                      <Textarea id={`t-quote-${r.id}`} rows={3} value={r.quote} onChange={(e) => upsert(r.id, { quote: e.target.value })} />
                    </Field>
                  </FormGrid>
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink-100/70 pt-4">
                    <Checkbox label="Show on the home page" checked={r.isFeatured} onChange={(e) => upsert(r.id, { isFeatured: e.target.checked })} />
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
                  <div className="h-11 w-11 shrink-0 overflow-hidden rounded-full bg-cream-100">
                    {r.photoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={r.photoUrl} alt="" className="h-full w-full object-cover" />
                    ) : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-ink-900">
                      {r.principalName || <span className="text-ink-400">Unnamed</span>}
                      <span className="ml-2 text-[12px] font-normal text-ink-500">
                        {r.role}
                        {r.schoolName ? ` · ${r.schoolName}` : ""}
                      </span>
                    </p>
                    <p className="mt-0.5 line-clamp-2 text-[13px] text-ink-600">“{r.quote}”</p>
                  </div>
                  {!r.isFeatured ? <Badge tone="default" size="sm">Hidden</Badge> : null}
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
        Add testimonial
      </Button>

      <ConfirmDialog
        open={toDelete !== null}
        onClose={() => (pending ? undefined : setToDelete(null))}
        onConfirm={() => toDelete && remove(toDelete.id)}
        title="Delete this testimonial?"
        description={toDelete ? `${toDelete.principalName || "This quote"} is removed from the home page.` : undefined}
        confirmLabel="Delete"
        busy={pending}
      />
    </div>
  );
}
