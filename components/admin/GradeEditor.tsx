"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Save, Trash2 } from "lucide-react";
import { Button } from "@/components/admin/ui/primitives-client";
import { Field, Input, Select, FormGrid, FormError } from "@/components/admin/ui/primitives";
import { ConfirmDialog } from "@/components/admin/ui/dialog";

type Form = { gradeName: string; gradeCode: string; status: "Active" | "Inactive" };

export function GradeEditor({ mode, gradeId, initial }: { mode: "create" | "edit"; gradeId?: string; initial?: Partial<Form> }) {
  const router = useRouter();
  const [form, setForm] = useState<Form>({ gradeName: "", gradeCode: "", status: "Active", ...initial });
  const [busy, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  function save() {
    setErr(null);
    start(async () => {
      const url = mode === "create" ? "/api/admin/data/grades" : `/api/admin/data/grades/${gradeId}`;
      const r = await fetch(url, {
        method: mode === "create" ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gradeName: form.gradeName, gradeCode: form.gradeCode || null, status: form.status }),
      });
      if (!r.ok) { const d = await r.json().catch(() => ({})); setErr(d.error ?? "Save failed"); return; }
      if (mode === "create") router.push(`/admin/grades`);
      else router.refresh();
    });
  }
  function remove() {
    if (!gradeId) return;
    start(async () => {
      const r = await fetch(`/api/admin/data/grades/${gradeId}`, { method: "DELETE" });
      if (!r.ok) { setErr("Delete failed"); setConfirmDelete(false); return; }
      router.push("/admin/grades");
    });
  }

  return (
    <div className="space-y-5">
      <FormGrid cols={2}>
        <Field label="Grade name" htmlFor="gr-name" required hint="As it appears in ERPNext, e.g. Grade 10">
          <Input id="gr-name" value={form.gradeName} onChange={(e) => setForm((f) => ({ ...f, gradeName: e.target.value }))} placeholder="Grade 10" />
        </Field>
        <Field label="Grade code" htmlFor="gr-code">
          <Input id="gr-code" value={form.gradeCode} onChange={(e) => setForm((f) => ({ ...f, gradeCode: e.target.value }))} placeholder="Optional" className="font-mono" />
        </Field>
        <Field label="Status" htmlFor="gr-status">
          <Select id="gr-status" value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as "Active" | "Inactive" }))}>
            <option value="Active">Active</option>
            <option value="Inactive">Inactive</option>
          </Select>
        </Field>
      </FormGrid>
      <FormError>{err}</FormError>
      <div className="flex items-center justify-between gap-2 border-t border-ink-100/70 pt-4">
        <div>
          {mode === "edit" ? (
            <Button busy={busy} onClick={() => setConfirmDelete(true)} type="button" variant="danger" icon={<Trash2 className="h-3.5 w-3.5" />}>Delete grade</Button>
          ) : null}
        </div>
        <Button busy={busy} onClick={save} type="button" variant="primary" icon={<Save className="h-3.5 w-3.5" />}>{mode === "create" ? "Create grade" : "Save changes"}</Button>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => (busy ? undefined : setConfirmDelete(false))}
        onConfirm={remove}
        title="Delete this grade?"
        description="Students keep the grade name on their record and continue to work; only this grade row is removed."
        confirmLabel="Delete grade"
        busy={busy}
        error={err}
      />
    </div>
  );
}
