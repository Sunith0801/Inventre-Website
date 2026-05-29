"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Save, Trash2, Plus } from "lucide-react";
import { Button } from "@/components/admin/ui/primitives-client";

type SchoolForm = {
  schoolCode: string;
  schoolName: string;
  branchName: string;
  websiteUrl: string;
  status: "Active" | "Inactive";
  schoolLogoUrl: string;
  street: string;
  city: string;
  state: string;
  country: string;
  pincode: string;
  uniformDetailsCheckbox: boolean;
  booksDetailsCheckbox: boolean;
};

const empty: SchoolForm = {
  schoolCode: "",
  schoolName: "",
  branchName: "",
  websiteUrl: "",
  status: "Active",
  schoolLogoUrl: "",
  street: "",
  city: "",
  state: "",
  country: "",
  pincode: "",
  uniformDetailsCheckbox: false,
  booksDetailsCheckbox: false,
};

export function SchoolEditor({
  mode,
  schoolId,
  initial,
}: {
  mode: "create" | "edit";
  schoolId?: string;
  initial?: Partial<SchoolForm>;
}) {
  const router = useRouter();
  const [form, setForm] = useState<SchoolForm>({ ...empty, ...initial });
  const [busy, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof SchoolForm>(k: K, v: SchoolForm[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function save() {
    setError(null);
    start(async () => {
      const url = mode === "create" ? "/api/admin/data/schools" : `/api/admin/data/schools/${schoolId}`;
      const r = await fetch(url, {
        method: mode === "create" ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          branchName: form.branchName || null,
          websiteUrl: form.websiteUrl || null,
          schoolLogoUrl: form.schoolLogoUrl || null,
          street: form.street || null,
          city: form.city || null,
          state: form.state || null,
          country: form.country || null,
          pincode: form.pincode || null,
        }),
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        setError(data.error ?? "Save failed");
        return;
      }
      if (mode === "create") {
        const data = await r.json();
        // Land on the Grades tab so grade assignment is part of the flow.
        router.push(`/admin/schools/${data.id}?tab=grades`);
      } else {
        router.refresh();
      }
    });
  }

  function remove() {
    if (!schoolId) return;
    if (!confirm("Delete this school? Coordinators, grade mappings and SKU mappings will also be removed. This cannot be undone.")) return;
    start(async () => {
      const r = await fetch(`/api/admin/data/schools/${schoolId}`, { method: "DELETE" });
      if (!r.ok) {
        setError("Delete failed");
        return;
      }
      router.push("/admin/schools");
    });
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="School Code *" value={form.schoolCode} onChange={(v) => set("schoolCode", v)} mono placeholder="TSUSC" />
        <Field label="School Name *" value={form.schoolName} onChange={(v) => set("schoolName", v)} placeholder="TSUS Chennai" />
        <Field label="Branch Name" value={form.branchName} onChange={(v) => set("branchName", v)} placeholder="Chennai" />
        <Field label="Website URL" value={form.websiteUrl} onChange={(v) => set("websiteUrl", v)} placeholder="https://…" />
        <SelectField label="Status" value={form.status} onChange={(v) => set("status", v as "Active" | "Inactive")} options={["Active", "Inactive"]} />
        <Field label="School Logo URL" value={form.schoolLogoUrl} onChange={(v) => set("schoolLogoUrl", v)} placeholder="https://pub-d46aef8f98ef4da0a1834fb6f554ae2c.r2.dev/erp-media/…png" mono />
      </div>

      <h3 className="text-[14px] font-semibold text-ink-800 mt-4">Address & Contacts</h3>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Field label="Street" value={form.street} onChange={(v) => set("street", v)} className="md:col-span-2" />
        <Field label="City" value={form.city} onChange={(v) => set("city", v)} />
        <Field label="State" value={form.state} onChange={(v) => set("state", v)} />
        <Field label="Country" value={form.country} onChange={(v) => set("country", v)} />
        <Field label="Pincode" value={form.pincode} onChange={(v) => set("pincode", v)} mono />
      </div>

      <div className="flex gap-4 pt-2">
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={form.uniformDetailsCheckbox} onChange={(e) => set("uniformDetailsCheckbox", e.target.checked)} className="h-4 w-4 rounded border-ink-300" />
          <span className="text-[13px]">Uniform details</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={form.booksDetailsCheckbox} onChange={(e) => set("booksDetailsCheckbox", e.target.checked)} className="h-4 w-4 rounded border-ink-300" />
          <span className="text-[13px]">Books details</span>
        </label>
      </div>

      <div className="flex items-center justify-between pt-4 border-t border-ink-100/70">
        <div>{error ? <span className="text-[13px] text-red-700">{error}</span> : null}</div>
        <div className="flex items-center gap-2">
          {mode === "edit" ? (
            <Button busy={busy} variant="danger" onClick={remove} type="button" icon={<Trash2 className="h-3.5 w-3.5" />}>
              Delete
            </Button>
          ) : null}
          <Button busy={busy} variant="primary" onClick={save} type="button" icon={<Save className="h-3.5 w-3.5" />}>
            {mode === "create" ? "Create school" : "Save changes"}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function CoordinatorEditor({
  schoolId,
  initial,
}: {
  schoolId: string;
  initial: Array<{
    id: string;
    rowIdx: number;
    pocName: string | null;
    email: string | null;
    contactNumber: string | null;
    alternateNumber: string | null;
    role: string | null;
  }>;
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [newRow, setNewRow] = useState({ pocName: "", email: "", contactNumber: "", alternateNumber: "", role: "" });
  const [error, setError] = useState<string | null>(null);

  function add() {
    if (!newRow.pocName.trim()) { setError("POC name required"); return; }
    setError(null);
    start(async () => {
      const r = await fetch(`/api/admin/data/schools/${schoolId}/coordinators`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pocName: newRow.pocName.trim(),
          email: newRow.email.trim() || null,
          contactNumber: newRow.contactNumber.trim() || null,
          alternateNumber: newRow.alternateNumber.trim() || null,
          role: newRow.role.trim() || null,
        }),
      });
      if (!r.ok) { setError("Failed to add"); return; }
      setNewRow({ pocName: "", email: "", contactNumber: "", alternateNumber: "", role: "" });
      router.refresh();
    });
  }

  function remove(rowId: string) {
    if (!confirm("Remove this coordinator?")) return;
    start(async () => {
      const r = await fetch(`/api/admin/data/schools/${schoolId}/coordinators/${rowId}`, { method: "DELETE" });
      if (!r.ok) { setError("Failed to delete"); return; }
      router.refresh();
    });
  }

  return (
    <div>
      <table className="w-full text-[13px]">
        <thead className="bg-cream-50/60 text-ink-600">
          <tr>
            <th className="px-2 py-2 text-left w-10">No.</th>
            <th className="px-2 py-2 text-left">POC Name</th>
            <th className="px-2 py-2 text-left">Email</th>
            <th className="px-2 py-2 text-left">Contact</th>
            <th className="px-2 py-2 text-left">Alternate</th>
            <th className="px-2 py-2 text-left">Role</th>
            <th className="px-2 py-2 text-right w-10"></th>
          </tr>
        </thead>
        <tbody>
          {initial.map((r) => (
            <tr key={r.id} className="border-t border-ink-100/70">
              <td className="px-2 py-1.5 text-ink-500">{r.rowIdx}</td>
              <td className="px-2 py-1.5">{r.pocName ?? "—"}</td>
              <td className="px-2 py-1.5 text-ink-600">{r.email ?? "—"}</td>
              <td className="px-2 py-1.5 text-ink-600 font-mono text-[12px]">{r.contactNumber ?? "—"}</td>
              <td className="px-2 py-1.5 text-ink-600 font-mono text-[12px]">{r.alternateNumber ?? "—"}</td>
              <td className="px-2 py-1.5">{r.role ?? "—"}</td>
              <td className="px-2 py-1.5 text-right">
                <button onClick={() => remove(r.id)} type="button" className="text-ink-400 hover:text-red-600 p-1" aria-label="Delete">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </td>
            </tr>
          ))}
          <tr className="border-t border-ink-100/70 bg-cream-50/30">
            <td className="px-2 py-1.5 text-ink-400 text-[11px]">{initial.length + 1}</td>
            <td className="px-1 py-1"><CellInput value={newRow.pocName} onChange={(v) => setNewRow((r) => ({ ...r, pocName: v }))} placeholder="Full name *" /></td>
            <td className="px-1 py-1"><CellInput value={newRow.email} onChange={(v) => setNewRow((r) => ({ ...r, email: v }))} placeholder="email@…" /></td>
            <td className="px-1 py-1"><CellInput value={newRow.contactNumber} onChange={(v) => setNewRow((r) => ({ ...r, contactNumber: v }))} placeholder="+91-…" mono /></td>
            <td className="px-1 py-1"><CellInput value={newRow.alternateNumber} onChange={(v) => setNewRow((r) => ({ ...r, alternateNumber: v }))} placeholder="alt" mono /></td>
            <td className="px-1 py-1"><CellInput value={newRow.role} onChange={(v) => setNewRow((r) => ({ ...r, role: v }))} placeholder="role" /></td>
            <td className="px-2 py-1 text-right">
              <Button busy={busy} variant="primary" onClick={add} type="button" icon={<Plus className="h-3 w-3" />}>Add</Button>
            </td>
          </tr>
        </tbody>
      </table>
      {error ? <div className="mt-2 text-[12px] text-red-700">{error}</div> : null}
    </div>
  );
}

function Field({ label, value, onChange, mono, placeholder, className }: { label: string; value: string; onChange: (v: string) => void; mono?: boolean; placeholder?: string; className?: string }) {
  return (
    <div className={className}>
      <label className="text-[11px] uppercase tracking-wide text-ink-500 mb-1 block">{label}</label>
      <input type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className={(mono ? "font-mono text-[12px] " : "text-[13px] ") + "w-full h-9 px-3 rounded-lg bg-white border border-ink-200 placeholder:text-ink-400 focus:outline-none focus:border-ink-400 focus:ring-2 focus:ring-brand-300/30 transition"}
      />
    </div>
  );
}

function SelectField({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <div>
      <label className="text-[11px] uppercase tracking-wide text-ink-500 mb-1 block">{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full h-9 px-3 text-[13px] rounded-lg bg-white border border-ink-200 focus:outline-none focus:border-ink-400 focus:ring-2 focus:ring-brand-300/30 transition">
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

function CellInput({ value, onChange, placeholder, mono }: { value: string; onChange: (v: string) => void; placeholder?: string; mono?: boolean }) {
  return (
    <input type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
      className={(mono ? "font-mono text-[12px] " : "text-[13px] ") + "w-full h-8 px-2 rounded bg-white border border-transparent placeholder:text-ink-400 hover:border-ink-200 focus:outline-none focus:border-ink-400 focus:ring-2 focus:ring-brand-300/30 transition"}
    />
  );
}
