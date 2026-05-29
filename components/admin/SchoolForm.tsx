"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Save, Trash2 } from "lucide-react";
import { ImageUpload } from "./ImageUpload";

type SchoolRow = {
  id: string;
  slug: string;
  name: string;
  city: string | null;
  state: string | null;
  status: "active" | "onboarding" | "paused";
  isFeatured: boolean;
  contactEmail: string | null;
  contactPhone: string | null;
  bannerUrl: string | null;
  logoUrl: string | null;
};

export function SchoolForm({ school }: { school?: SchoolRow }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const isNew = !school;

  const [form, setForm] = useState({
    name: school?.name ?? "",
    slug: school?.slug ?? "",
    city: school?.city ?? "",
    state: school?.state ?? "",
    status: school?.status ?? "onboarding",
    isFeatured: school?.isFeatured ?? false,
    contactEmail: school?.contactEmail ?? "",
    contactPhone: school?.contactPhone ?? "",
    bannerUrl: school?.bannerUrl ?? "",
    logoUrl: school?.logoUrl ?? "",
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    start(async () => {
      const url = isNew ? "/api/admin/schools" : `/api/admin/schools/${school!.id}`;
      const method = isNew ? "POST" : "PATCH";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? "Save failed");
        return;
      }
      router.push("/admin/schools");
      router.refresh();
    });
  };

  const remove = () => {
    if (!school) return;
    if (!confirm("Delete this school? Students and orders linked to it will be affected.")) return;
    start(async () => {
      const res = await fetch(`/api/admin/schools/${school.id}`, { method: "DELETE" });
      if (res.ok) {
        router.push("/admin/schools");
        router.refresh();
      } else {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? "Delete failed");
      }
    });
  };

  return (
    <form onSubmit={submit} className="rounded-2xl border border-ink-100 bg-white p-6 lg:p-8 space-y-5">
      <div className="grid sm:grid-cols-2 gap-4">
        <Input label="Name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} required />
        <Input
          label="Slug"
          value={form.slug}
          onChange={(v) => setForm({ ...form, slug: v.toLowerCase().replace(/[^a-z0-9-]/g, "-") })}
          required
        />
        <Input label="City" value={form.city} onChange={(v) => setForm({ ...form, city: v })} />
        <Input label="State" value={form.state} onChange={(v) => setForm({ ...form, state: v })} />
        <Input
          label="Contact email"
          type="email"
          value={form.contactEmail}
          onChange={(v) => setForm({ ...form, contactEmail: v })}
        />
        <Input
          label="Contact phone"
          value={form.contactPhone}
          onChange={(v) => setForm({ ...form, contactPhone: v })}
        />
        <ImageUpload
          label="Logo"
          value={form.logoUrl || null}
          onChange={(url) => setForm({ ...form, logoUrl: url ?? "" })}
          folder="schools"
          className="sm:col-span-2"
        />
        <ImageUpload
          label="Banner"
          value={form.bannerUrl || null}
          onChange={(url) => setForm({ ...form, bannerUrl: url ?? "" })}
          folder="schools"
          className="sm:col-span-2"
        />

        <label className="flex flex-col">
          <span className="text-[12px] font-semibold text-ink-700">Status</span>
          <select
            value={form.status}
            onChange={(e) => setForm({ ...form, status: e.target.value as SchoolRow["status"] })}
            className="mt-1 rounded-xl border border-ink-200 bg-white px-3 py-2.5 text-[14px] outline-none focus:border-ink-900"
          >
            <option value="onboarding">Onboarding</option>
            <option value="active">Active</option>
            <option value="paused">Paused</option>
          </select>
        </label>

        <label className="flex items-center gap-2 mt-7">
          <input
            type="checkbox"
            checked={form.isFeatured}
            onChange={(e) => setForm({ ...form, isFeatured: e.target.checked })}
            className="h-4 w-4 accent-brand"
          />
          <span className="text-[13px] font-medium text-ink-800">
            Show in homepage trust strip
          </span>
        </label>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">
          {error}
        </div>
      )}

      <div className="flex items-center justify-between pt-4 border-t border-ink-100">
        {!isNew ? (
          <button
            type="button"
            onClick={remove}
            disabled={pending}
            className="inline-flex items-center gap-1.5 text-[13px] font-medium text-red-600 hover:text-red-700"
          >
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </button>
        ) : (
          <span />
        )}
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center gap-2 rounded-full bg-brand text-white px-5 h-10 text-[13px] font-bold hover:bg-brand-600 disabled:opacity-60"
        >
          <Save className="h-3.5 w-3.5" /> {pending ? "Saving…" : "Save school"}
        </button>
      </div>
    </form>
  );
}

function Input({
  label,
  value,
  onChange,
  type = "text",
  required,
  className = "",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  className?: string;
}) {
  return (
    <label className={"flex flex-col " + className}>
      <span className="text-[12px] font-semibold text-ink-700">
        {label} {required && <span className="text-brand">*</span>}
      </span>
      <input
        type={type}
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 rounded-xl border border-ink-200 bg-white px-3 py-2.5 text-[14px] outline-none focus:border-ink-900 transition-colors"
      />
    </label>
  );
}
