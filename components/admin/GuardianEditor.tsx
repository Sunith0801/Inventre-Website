"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Save, Trash2 } from "lucide-react";
import { Button } from "@/components/admin/ui/primitives-client";

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
    if (!guardianId || !confirm("Delete this guardian? Student-guardian links remain (with the name preserved) but the guardian master record is gone.")) return;
    start(async () => {
      const r = await fetch(`/api/admin/data/guardians/${guardianId}`, { method: "DELETE" });
      if (!r.ok) { setErr("Delete failed"); return; }
      router.push("/admin/guardians");
    });
  }

  function set<K extends keyof Form>(k: K, v: Form[K]) { setForm((f) => ({ ...f, [k]: v })); }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Guardian Name *"  value={form.guardianName}    onChange={(v) => set("guardianName", v)} placeholder="Full name" />
        <Field label="Email Address"    value={form.emailAddress}    onChange={(v) => set("emailAddress", v)} placeholder="example@…" />
        <Field label="Mobile Number *"  value={form.mobileNumber}    onChange={(v) => set("mobileNumber", v)} mono placeholder="10-digit" />
        <Field label="Email (secondary)" value={form.email}          onChange={(v) => set("email", v)} placeholder="optional" />
        <Field label="Alternate Number" value={form.alternateNumber} onChange={(v) => set("alternateNumber", v)} mono />
        <Field label="Date of Birth"    value={form.dateOfBirth}     onChange={(v) => set("dateOfBirth", v)} placeholder="YYYY-MM-DD" />
      </div>
      <div className="flex items-center justify-between pt-4 border-t border-ink-100/70">
        <div>{err ? <span className="text-[13px] text-red-700">{err}</span> : null}</div>
        <div className="flex items-center gap-2">
          {mode === "edit" ? <Button busy={busy} onClick={remove} type="button" variant="danger" icon={<Trash2 className="h-3.5 w-3.5" />}>Delete</Button> : null}
          <Button busy={busy} onClick={save} type="button" variant="primary" icon={<Save className="h-3.5 w-3.5" />}>{mode === "create" ? "Create guardian" : "Save"}</Button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, mono }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; mono?: boolean }) {
  return (
    <div>
      <label className="text-[11px] uppercase tracking-wide text-ink-500 mb-1 block">{label}</label>
      <input type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className={(mono ? "font-mono text-[12px] " : "text-[13px] ") + "w-full h-9 px-3 rounded-lg bg-white border border-ink-200 placeholder:text-ink-400 focus:outline-none focus:border-ink-400 focus:ring-2 focus:ring-brand-300/30"} />
    </div>
  );
}
