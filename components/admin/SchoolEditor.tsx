"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Save, Trash2, Plus } from "lucide-react";
import { Button } from "@/components/admin/ui/primitives-client";
import { Field, Input, Select, Checkbox, FormGrid, FormError, Th, Td, Tr } from "@/components/admin/ui/primitives";
import { ConfirmDialog } from "@/components/admin/ui/dialog";

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

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-500">{children}</h3>;
}

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
  const [confirmDelete, setConfirmDelete] = useState(false);

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
    start(async () => {
      const r = await fetch(`/api/admin/data/schools/${schoolId}`, { method: "DELETE" });
      if (!r.ok) {
        setError("Delete failed");
        setConfirmDelete(false);
        return;
      }
      router.push("/admin/schools");
    });
  }

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <SectionHeading>School</SectionHeading>
        <FormGrid cols={2}>
          <Field label="School code" htmlFor="s-code" required hint="Short ERPNext code, e.g. SASKS">
            <Input id="s-code" value={form.schoolCode} onChange={(e) => set("schoolCode", e.target.value.toUpperCase())} placeholder="SASKS" className="font-mono uppercase" />
          </Field>
          <Field label="School name" htmlFor="s-name" required>
            <Input id="s-name" value={form.schoolName} onChange={(e) => set("schoolName", e.target.value)} placeholder="St Andrews School" />
          </Field>
          <Field label="Branch" htmlFor="s-branch">
            <Input id="s-branch" value={form.branchName} onChange={(e) => set("branchName", e.target.value)} placeholder="Keesara" />
          </Field>
          <Field label="Status" htmlFor="s-status">
            <Select id="s-status" value={form.status} onChange={(e) => set("status", e.target.value as "Active" | "Inactive")}>
              <option value="Active">Active</option>
              <option value="Inactive">Inactive</option>
            </Select>
          </Field>
          <Field label="Website" htmlFor="s-web">
            <Input id="s-web" type="url" value={form.websiteUrl} onChange={(e) => set("websiteUrl", e.target.value)} placeholder="https://" />
          </Field>
          <Field label="Logo URL" htmlFor="s-logo">
            <Input id="s-logo" type="url" value={form.schoolLogoUrl} onChange={(e) => set("schoolLogoUrl", e.target.value)} placeholder="https://…/logo.png" className="font-mono" />
          </Field>
        </FormGrid>
      </div>

      <div className="space-y-3">
        <SectionHeading>Address</SectionHeading>
        <FormGrid cols={3}>
          <Field label="Street" htmlFor="s-street" className="sm:col-span-2 lg:col-span-2">
            <Input id="s-street" value={form.street} onChange={(e) => set("street", e.target.value)} />
          </Field>
          <Field label="City" htmlFor="s-city">
            <Input id="s-city" value={form.city} onChange={(e) => set("city", e.target.value)} />
          </Field>
          <Field label="State" htmlFor="s-state">
            <Input id="s-state" value={form.state} onChange={(e) => set("state", e.target.value)} />
          </Field>
          <Field label="Country" htmlFor="s-country">
            <Input id="s-country" value={form.country} onChange={(e) => set("country", e.target.value)} placeholder="India" />
          </Field>
          <Field label="Pincode" htmlFor="s-pin">
            <Input id="s-pin" inputMode="numeric" value={form.pincode} onChange={(e) => set("pincode", e.target.value)} className="font-mono" />
          </Field>
        </FormGrid>
      </div>

      <div className="space-y-3">
        <SectionHeading>What this school sells</SectionHeading>
        <div className="flex flex-wrap gap-x-8 gap-y-3">
          <Checkbox label="Uniforms" hint="Uniform SKU mappings apply" checked={form.uniformDetailsCheckbox} onChange={(e) => set("uniformDetailsCheckbox", e.target.checked)} />
          <Checkbox label="Books" hint="Book kits per grade" checked={form.booksDetailsCheckbox} onChange={(e) => set("booksDetailsCheckbox", e.target.checked)} />
        </div>
      </div>

      <FormError>{error}</FormError>

      <div className="flex items-center justify-between gap-2 border-t border-ink-100/70 pt-4">
        <div>
          {mode === "edit" ? (
            <Button busy={busy} variant="danger" onClick={() => setConfirmDelete(true)} type="button" icon={<Trash2 className="h-3.5 w-3.5" />}>
              Delete school
            </Button>
          ) : null}
        </div>
        <Button busy={busy} variant="primary" onClick={save} type="button" icon={<Save className="h-3.5 w-3.5" />}>
          {mode === "create" ? "Create school" : "Save changes"}
        </Button>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => (busy ? undefined : setConfirmDelete(false))}
        onConfirm={remove}
        title="Delete this school?"
        description="Coordinators, grade mappings and uniform SKU mappings are removed with it. Students and orders that reference the school code are left in place. This cannot be undone."
        confirmLabel="Delete school"
        busy={busy}
        error={error}
      />
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
  const blank = { pocName: "", email: "", contactNumber: "", alternateNumber: "", role: "" };
  const [newRow, setNewRow] = useState(blank);
  const [error, setError] = useState<string | null>(null);
  const [toRemove, setToRemove] = useState<{ id: string; name: string } | null>(null);

  function add() {
    if (!newRow.pocName.trim()) { setError("Contact name is required"); return; }
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
      setNewRow(blank);
      router.refresh();
    });
  }

  function remove(rowId: string) {
    start(async () => {
      const r = await fetch(`/api/admin/data/schools/${schoolId}/coordinators/${rowId}`, { method: "DELETE" });
      setToRemove(null);
      if (!r.ok) { setError("Failed to delete"); return; }
      router.refresh();
    });
  }

  const cell = (k: keyof typeof blank, placeholder: string, mono?: boolean) => (
    <Input
      inputSize="sm"
      value={newRow[k]}
      onChange={(e) => setNewRow((r) => ({ ...r, [k]: e.target.value }))}
      placeholder={placeholder}
      aria-label={placeholder}
      className={mono ? "font-mono" : undefined}
    />
  );

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr>
              <Th>Contact</Th>
              <Th>Role</Th>
              <Th>Mobile</Th>
              <Th>Alternate</Th>
              <Th>Email</Th>
              <Th right><span className="sr-only">Actions</span></Th>
            </tr>
          </thead>
          <tbody>
            {initial.length === 0 ? (
              <tr>
                <td colSpan={6} className="!py-6 text-center !text-[13px] !font-normal !text-ink-500">
                  No coordinators yet — add the school&apos;s point of contact below.
                </td>
              </tr>
            ) : null}
            {initial.map((r) => (
              <Tr key={r.id}>
                <Td>{r.pocName ?? "—"}</Td>
                <Td muted>{r.role ?? "—"}</Td>
                <Td muted><span className="font-mono">{r.contactNumber ?? "—"}</span></Td>
                <Td muted><span className="font-mono">{r.alternateNumber ?? "—"}</span></Td>
                <Td muted>{r.email ?? "—"}</Td>
                <Td right>
                  <button
                    onClick={() => setToRemove({ id: r.id, name: r.pocName ?? "this coordinator" })}
                    type="button"
                    className="grid h-7 w-7 place-items-center rounded-md text-ink-300 hover:bg-red-50 hover:text-red-600"
                    aria-label="Remove coordinator"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </Td>
              </Tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="border-t border-ink-100/70 bg-cream-50/40 px-5 py-4">
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-500">Add coordinator</div>
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr_1.4fr_auto]">
          {cell("pocName", "Full name *")}
          {cell("role", "Role, e.g. Principal")}
          {cell("contactNumber", "Mobile", true)}
          {cell("alternateNumber", "Alternate", true)}
          {cell("email", "Email")}
          <Button busy={busy} variant="primary" size="sm" onClick={add} type="button" icon={<Plus className="h-3 w-3" />}>Add</Button>
        </div>
        {error ? <div className="mt-2 text-[12px] font-medium text-red-700">{error}</div> : null}
      </div>

      <ConfirmDialog
        open={toRemove !== null}
        onClose={() => (busy ? undefined : setToRemove(null))}
        onConfirm={() => toRemove && remove(toRemove.id)}
        title="Remove this coordinator?"
        description={toRemove ? `${toRemove.name} is removed from the school's contacts.` : undefined}
        confirmLabel="Remove"
        busy={busy}
      />
    </div>
  );
}
