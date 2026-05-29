"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Save, Trash2 } from "lucide-react";
import { Button } from "@/components/admin/ui/primitives-client";

type Form = { gradeName: string; gradeCode: string; status: "Active" | "Inactive" };

export function GradeEditor({ mode, gradeId, initial }: { mode: "create" | "edit"; gradeId?: string; initial?: Partial<Form> }) {
  const router = useRouter();
  const [form, setForm] = useState<Form>({ gradeName: "", gradeCode: "", status: "Active", ...initial });
  const [busy, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

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
      if (mode === "create") { const d = await r.json(); router.push(`/admin/grades`); }
      else router.refresh();
    });
  }
  function remove() {
    if (!gradeId || !confirm("Delete this grade? Students referencing it by name will keep working but the grade row will disappear.")) return;
    start(async () => {
      const r = await fetch(`/api/admin/data/grades/${gradeId}`, { method: "DELETE" });
      if (!r.ok) { setErr("Delete failed"); return; }
      router.push("/admin/grades");
    });
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Grade Name *" value={form.gradeName} onChange={(v) => setForm((f) => ({ ...f, gradeName: v }))} placeholder="Grade 10" />
        <Field label="Grade Code"   value={form.gradeCode} onChange={(v) => setForm((f) => ({ ...f, gradeCode: v }))} mono placeholder="6543" />
        <div>
          <label className="text-[11px] uppercase tracking-wide text-ink-500 mb-1 block">Status</label>
          <select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as "Active" | "Inactive" }))} className="w-full h-9 px-3 text-[13px] rounded-lg bg-white border border-ink-200">
            <option>Active</option><option>Inactive</option>
          </select>
        </div>
      </div>
      <div className="flex items-center justify-between pt-4 border-t border-ink-100/70">
        <div>{err ? <span className="text-[13px] text-red-700">{err}</span> : null}</div>
        <div className="flex items-center gap-2">
          {mode === "edit" ? <Button busy={busy} onClick={remove} type="button" variant="danger" icon={<Trash2 className="h-3.5 w-3.5" />}>Delete</Button> : null}
          <Button busy={busy} onClick={save} type="button" variant="primary" icon={<Save className="h-3.5 w-3.5" />}>{mode === "create" ? "Create grade" : "Save"}</Button>
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
