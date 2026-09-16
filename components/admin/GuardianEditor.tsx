"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Save, Trash2 } from "lucide-react";
import { Button } from "@/components/admin/ui/primitives-client";
import { Field, Input, FormGrid, FormError } from "@/components/admin/ui/primitives";
import { ConfirmDialog } from "@/components/admin/ui/dialog";

type Form = {
  guardianName: string;
  emailAddress: string;
  mobileNumber: string;
  email: string;
  alternateNumber: string;
  dateOfBirth: string;
};
const empty: Form = { guardianName: "", emailAddress: "", mobileNumber: "", email: "", alternateNumber: "", dateOfBirth: "" };

export function GuardianEditor({ mode, guardianId, initial }: { mode: "create" | "edit"; guardianId?: string; initial?: Partial<Form> }) {
  const router = useRouter();
  const [form, setForm] = useState<Form>({ ...empty, ...initial });
  const [busy, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  function save() {
    setErr(null);
    start(async () => {
      const url = mode === "create" ? "/api/admin/data/guardians" : `/api/admin/data/guardians/${guardianId}`;
      const r = await fetch(url, {
        method: mode === "create" ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          guardianName: form.guardianName,
          emailAddress: form.emailAddress || null,
          mobileNumber: form.mobileNumber,
          email: form.email || null,
          alternateNumber: form.alternateNumber || null,
          dateOfBirth: form.dateOfBirth || null,
        }),
      });
      if (!r.ok) { const d = await r.json().catch(() => ({})); setErr(d.error ?? "Save failed"); return; }
      if (mode === "create") { const d = await r.json(); router.push(`/admin/guardians/${d.id}`); }
      else router.refresh();
    });
  }

  function remove() {
    if (!guardianId) return;
    start(async () => {
      const r = await fetch(`/api/admin/data/guardians/${guardianId}`, { method: "DELETE" });
      if (!r.ok) { setErr("Delete failed"); setConfirmDelete(false); return; }
      router.push("/admin/guardians");
    });
  }

  function set<K extends keyof Form>(k: K, v: Form[K]) { setForm((f) => ({ ...f, [k]: v })); }

  return (
    <div className="space-y-5">
      <FormGrid cols={2}>
        <Field label="Guardian name" htmlFor="g-name" required className="md:col-span-2">
          <Input id="g-name" value={form.guardianName} onChange={(e) => set("guardianName", e.target.value)} placeholder="Full name" autoComplete="off" />
        </Field>
        <Field label="Mobile number" htmlFor="g-mobile" required hint="The number the parent signs in with">
          <Input id="g-mobile" inputMode="numeric" value={form.mobileNumber} onChange={(e) => set("mobileNumber", e.target.value)} placeholder="10 digits" className="font-mono" />
        </Field>
        <Field label="Alternate number" htmlFor="g-alt">
          <Input id="g-alt" inputMode="numeric" value={form.alternateNumber} onChange={(e) => set("alternateNumber", e.target.value)} className="font-mono" />
        </Field>
        <Field label="Email address" htmlFor="g-email">
          <Input id="g-email" type="email" value={form.emailAddress} onChange={(e) => set("emailAddress", e.target.value)} placeholder="name@example.com" />
        </Field>
        <Field label="Secondary email" htmlFor="g-email2">
          <Input id="g-email2" type="email" value={form.email} onChange={(e) => set("email", e.target.value)} placeholder="Optional" />
        </Field>
        {/* Text, not type="date": ERPNext stores this as free text (e.g. "05-03-89")
            and a date control would blank it and save null. */}
        <Field label="Date of birth" htmlFor="g-dob">
          <Input id="g-dob" value={form.dateOfBirth} onChange={(e) => set("dateOfBirth", e.target.value)} placeholder="YYYY-MM-DD" className="font-mono" />
        </Field>
      </FormGrid>
      <FormError>{err}</FormError>
      <div className="flex items-center justify-between gap-2 border-t border-ink-100/70 pt-4">
        <div>
          {mode === "edit" ? (
            <Button busy={busy} onClick={() => setConfirmDelete(true)} type="button" variant="danger" icon={<Trash2 className="h-3.5 w-3.5" />}>Delete guardian</Button>
          ) : null}
        </div>
        <Button busy={busy} onClick={save} type="button" variant="primary" icon={<Save className="h-3.5 w-3.5" />}>{mode === "create" ? "Create guardian" : "Save changes"}</Button>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => (busy ? undefined : setConfirmDelete(false))}
        onConfirm={remove}
        title="Delete this guardian?"
        description="The guardian record is removed. Links from students keep the guardian's name, so student records are not affected."
        confirmLabel="Delete guardian"
        busy={busy}
        error={err}
      />
    </div>
  );
}
