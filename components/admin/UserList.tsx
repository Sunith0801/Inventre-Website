"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Save, Trash2, ShieldCheck } from "lucide-react";

type Row = {
  id: string;
  email: string;
  name: string | null;
  role: "super" | "ops" | "school_admin";
  schoolId: string | null;
  schoolName: string | null;
  status: "active" | "blocked" | "pending";
};

const roleStyle: Record<string, string> = {
  super: "bg-violet-50 text-violet-700",
  ops: "bg-blue-50 text-blue-700",
  school_admin: "bg-amber-50 text-amber-700",
};

export function UserList({
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
  const [pwd, setPwd] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const upsert = (id: string, patch: Partial<Row>) =>
    setRows(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const save = (r: Row) =>
    start(async () => {
      setError(null);
      const isNew = r.id.startsWith("new-");
      const url = isNew ? "/api/admin/users" : `/api/admin/users/${r.id}`;
      const method = isNew ? "POST" : "PATCH";
      const body: Record<string, unknown> = {
        email: r.email,
        name: r.name,
        role: r.role,
        schoolId: r.role === "school_admin" ? r.schoolId : null,
        status: r.status,
      };
      if (pwd[r.id]) body.password = pwd[r.id];
      else if (isNew) {
        setError("Password required for new users");
        return;
      }
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? "Save failed");
        return;
      }
      setEditingId(null);
      setPwd({ ...pwd, [r.id]: "" });
      router.refresh();
    });

  const remove = (id: string) =>
    start(async () => {
      if (id.startsWith("new-")) {
        setRows(rows.filter((r) => r.id !== id));
        return;
      }
      if (!confirm("Delete this admin user?")) return;
      const res = await fetch(`/api/admin/users/${id}`, { method: "DELETE" });
      if (res.ok) {
        setRows(rows.filter((r) => r.id !== id));
        router.refresh();
      }
    });

  const addNew = () => {
    const id = `new-${Date.now()}`;
    setRows([
      ...rows,
      {
        id,
        email: "",
        name: "",
        role: "ops",
        schoolId: null,
        schoolName: null,
        status: "active",
      },
    ]);
    setEditingId(id);
  };

  return (
    <div className="space-y-3">
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">
          {error}
        </div>
      )}
      {rows.map((r) => {
        const editing = editingId === r.id || r.id.startsWith("new-");
        return (
          <div
            key={r.id}
            className="rounded-2xl border border-ink-100 bg-white p-5"
          >
            {editing ? (
              <div className="space-y-3">
                <div className="grid sm:grid-cols-2 gap-3">
                  <Input
                    label="Email"
                    type="email"
                    value={r.email}
                    onChange={(v) => upsert(r.id, { email: v })}
                  />
                  <Input
                    label="Name"
                    value={r.name ?? ""}
                    onChange={(v) => upsert(r.id, { name: v })}
                  />
                  <label className="flex flex-col">
                    <span className="text-[12px] font-semibold text-ink-700">
                      Role
                    </span>
                    <select
                      value={r.role}
                      onChange={(e) =>
                        upsert(r.id, {
                          role: e.target.value as Row["role"],
                          schoolId: null,
                        })
                      }
                      className="mt-1 rounded-xl border border-ink-200 bg-white px-3 py-2.5 text-[14px] outline-none focus:border-ink-900"
                    >
                      <option value="super">Super (Inventre)</option>
                      <option value="ops">Ops</option>
                      <option value="school_admin">School admin</option>
                    </select>
                  </label>
                  {r.role === "school_admin" && (
                    <label className="flex flex-col">
                      <span className="text-[12px] font-semibold text-ink-700">
                        School
                      </span>
                      <select
                        value={r.schoolId ?? ""}
                        onChange={(e) =>
                          upsert(r.id, { schoolId: e.target.value || null })
                        }
                        className="mt-1 rounded-xl border border-ink-200 bg-white px-3 py-2.5 text-[14px] outline-none focus:border-ink-900"
                      >
                        <option value="">— select school —</option>
                        {schools.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <label className="flex flex-col">
                    <span className="text-[12px] font-semibold text-ink-700">
                      Status
                    </span>
                    <select
                      value={r.status}
                      onChange={(e) =>
                        upsert(r.id, { status: e.target.value as Row["status"] })
                      }
                      className="mt-1 rounded-xl border border-ink-200 bg-white px-3 py-2.5 text-[14px] outline-none focus:border-ink-900"
                    >
                      <option value="active">Active</option>
                      <option value="blocked">Blocked</option>
                      <option value="pending">Pending</option>
                    </select>
                  </label>
                  <Input
                    label={r.id.startsWith("new-") ? "Password" : "New password (optional)"}
                    type="password"
                    value={pwd[r.id] ?? ""}
                    onChange={(v) => setPwd({ ...pwd, [r.id]: v })}
                  />
                </div>
                <div className="flex items-center justify-end gap-2 pt-2 border-t border-ink-100">
                  <button
                    onClick={() => remove(r.id)}
                    className="inline-flex items-center gap-1.5 text-[13px] font-medium text-red-600 hover:text-red-700"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Delete
                  </button>
                  <button
                    onClick={() => save(r)}
                    disabled={pending}
                    className="inline-flex items-center gap-2 rounded-full bg-brand text-white px-4 h-9 text-[12px] font-bold hover:bg-brand-600 disabled:opacity-60"
                  >
                    <Save className="h-3 w-3" /> Save
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-4">
                <ShieldCheck className="h-5 w-5 text-brand shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-ink-900">
                      {r.name || r.email}
                    </span>
                    <span
                      className={
                        "rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wider uppercase " +
                        (roleStyle[r.role] ?? "")
                      }
                    >
                      {r.role.replace("_", " ")}
                    </span>
                    {r.schoolName && (
                      <span className="text-[11px] text-ink-500">
                        · {r.schoolName}
                      </span>
                    )}
                  </div>
                  <p className="text-[12px] text-ink-500 truncate">{r.email}</p>
                </div>
                <button
                  onClick={() => setEditingId(r.id)}
                  className="text-[13px] font-semibold text-brand"
                >
                  Edit
                </button>
              </div>
            )}
          </div>
        );
      })}
      <button
        onClick={addNew}
        className="w-full inline-flex items-center justify-center gap-2 rounded-2xl border border-dashed border-ink-200 bg-white py-5 text-[13px] font-semibold text-ink-700 hover:border-brand hover:text-brand transition-colors"
      >
        <Plus className="h-4 w-4" /> Add admin user
      </button>
    </div>
  );
}

function Input({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <label className="flex flex-col">
      <span className="text-[12px] font-semibold text-ink-700">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 rounded-xl border border-ink-200 bg-white px-3 py-2.5 text-[14px] outline-none focus:border-ink-900"
      />
    </label>
  );
}
