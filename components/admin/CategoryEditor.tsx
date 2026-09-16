"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Save, Trash2, Pencil, CornerDownRight } from "lucide-react";
import { Button } from "@/components/admin/ui/primitives-client";
import { Field, Input, Select, FormGrid, FormError, Th, Td, Tr } from "@/components/admin/ui/primitives";
import { ConfirmDialog } from "@/components/admin/ui/dialog";

type Row = {
  id: string;
  slug: string;
  name: string;
  parentId: string | null;
  path: string;
  sortOrder: number;
};

/**
 * The category tree as one table, children indented under their parent.
 * A row opens inline for editing; new rows are added at the bottom.
 */
export function CategoryEditor({ initial }: { initial: Row[] }) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [pending, start] = useTransition();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<Row | null>(null);

  // sort by path so parents render before children
  const sorted = [...rows].sort((a, b) => a.path.localeCompare(b.path));
  const depth = (path: string) => (path ? path.split(".").length - 1 : 0);
  const nameById = new Map(rows.map((r) => [r.id, r.name]));

  const upsert = (id: string, patch: Partial<Row>) =>
    setRows(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const save = (r: Row) =>
    start(async () => {
      setError(null);
      const isNew = r.id.startsWith("new-");
      const res = await fetch(isNew ? "/api/admin/categories" : `/api/admin/categories/${r.id}`, {
        method: isNew ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: r.slug, name: r.name, parentId: r.parentId, sortOrder: r.sortOrder }),
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
        setToDelete(null);
        return;
      }
      const res = await fetch(`/api/admin/categories/${id}`, { method: "DELETE" });
      if (res.ok) {
        setRows(rows.filter((r) => r.id !== id));
        router.refresh();
      } else {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? "Delete failed");
      }
      setToDelete(null);
    });

  const cancel = (r: Row) => {
    if (r.id.startsWith("new-")) setRows(rows.filter((x) => x.id !== r.id));
    setEditingId(null);
    setError(null);
  };

  const addNew = () => {
    const id = `new-${Date.now()}`;
    setRows([...rows, { id, slug: "", name: "", parentId: null, path: "", sortOrder: rows.length }]);
    setEditingId(id);
  };

  const editor = (r: Row) => (
    <div className="space-y-4 bg-cream-50/50 px-5 py-4">
      <FormGrid cols={4}>
        <Field label="Name" htmlFor={`cat-name-${r.id}`} required>
          <Input id={`cat-name-${r.id}`} value={r.name} onChange={(e) => upsert(r.id, { name: e.target.value })} autoFocus />
        </Field>
        <Field label="Slug" htmlFor={`cat-slug-${r.id}`} required>
          <Input id={`cat-slug-${r.id}`} value={r.slug} onChange={(e) => upsert(r.id, { slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-") })} className="font-mono" />
        </Field>
        <Field label="Parent" htmlFor={`cat-parent-${r.id}`}>
          <Select id={`cat-parent-${r.id}`} value={r.parentId ?? ""} onChange={(e) => upsert(r.id, { parentId: e.target.value || null })}>
            <option value="">Top level</option>
            {rows.filter((x) => x.id !== r.id && !x.id.startsWith("new-")).map((x) => (
              <option key={x.id} value={x.id}>{x.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Sort order" htmlFor={`cat-sort-${r.id}`}>
          <Input id={`cat-sort-${r.id}`} type="number" value={r.sortOrder} onChange={(e) => upsert(r.id, { sortOrder: Number(e.target.value) })} className="text-right tabular-nums" />
        </Field>
      </FormGrid>
      <FormError>{error}</FormError>
      <div className="flex items-center justify-between gap-2">
        <div>
          {!r.id.startsWith("new-") ? (
            <Button variant="danger" size="sm" disabled={pending} onClick={() => setToDelete(r)} icon={<Trash2 className="h-3.5 w-3.5" />}>Delete</Button>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" disabled={pending} onClick={() => cancel(r)}>Cancel</Button>
          <Button size="sm" busy={pending} onClick={() => save(r)} icon={<Save className="h-3.5 w-3.5" />}>Save</Button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-2xl border border-ink-100/70 bg-white shadow-[0_1px_2px_rgba(10,10,10,0.04)]">
        <table className="w-full">
          <thead>
            <tr>
              <Th>Category</Th>
              <Th>Slug</Th>
              <Th>Parent</Th>
              <Th right>Order</Th>
              <Th right><span className="sr-only">Actions</span></Th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr><td colSpan={5} className="!py-8 text-center !text-[13px] !font-normal !text-ink-500">No categories yet.</td></tr>
            ) : null}
            {sorted.map((r) => {
              const editing = editingId === r.id || r.id.startsWith("new-");
              const d = depth(r.path);
              if (editing) {
                return (
                  <tr key={r.id}>
                    <td colSpan={5} className="!p-0">{editor(r)}</td>
                  </tr>
                );
              }
              return (
                <Tr key={r.id}>
                  <Td>
                    <span className="flex items-center gap-1.5" style={{ paddingLeft: d * 18 }}>
                      {d > 0 ? <CornerDownRight className="h-3.5 w-3.5 shrink-0 text-ink-300" /> : null}
                      <span className="font-semibold text-ink-900">{r.name}</span>
                    </span>
                  </Td>
                  <Td muted><span className="font-mono">{r.slug}</span></Td>
                  <Td muted>{r.parentId ? nameById.get(r.parentId) ?? "—" : <span className="text-ink-300">Top level</span>}</Td>
                  <Td right muted>{r.sortOrder}</Td>
                  <Td right>
                    <Button variant="ghost" size="sm" onClick={() => setEditingId(r.id)} icon={<Pencil className="h-3.5 w-3.5" />}>Edit</Button>
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Button variant="secondary" onClick={addNew} icon={<Plus className="h-3.5 w-3.5" />}>Add category</Button>

      <ConfirmDialog
        open={toDelete !== null}
        onClose={() => (pending ? undefined : setToDelete(null))}
        onConfirm={() => toDelete && remove(toDelete.id)}
        title={`Delete “${toDelete?.name ?? ""}”?`}
        description="Sub-categories and products in it lose their category; nothing else is removed."
        confirmLabel="Delete category"
        busy={pending}
      />
    </div>
  );
}
