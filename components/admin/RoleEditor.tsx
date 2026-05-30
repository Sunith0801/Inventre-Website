"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Save, Trash2, AlertCircle } from "lucide-react";
import { Button } from "@/components/admin/ui/primitives-client";
import { readKey, writeKey } from "@/lib/admin-permissions";

type RoleInput = {
  id: string;
  slug: string;
  name: string;
  description: string;
  isSystem: boolean;
  isSuperAdmin: boolean;
  assignedUsers: number;
};

type PageItem = { slug: string; label: string; group: string };

export function RoleEditor({
  role,
  /** Pages list — for back-compat the API may still pass `permissions`
   *  with the legacy {key, label, group} shape; both are accepted. */
  pages,
  permissions,
  groups,
  granted,
}: {
  role: RoleInput | null;
  pages?: PageItem[];
  permissions?: { key: string; label: string; group: string }[];
  groups: string[];
  granted: string[];
}) {
  const router = useRouter();
  const isNew = role === null;
  const isSuper = role?.isSuperAdmin ?? false;
  const isSystem = role?.isSystem ?? false;

  const pageList: PageItem[] = useMemo(() => {
    if (pages?.length) return pages;
    // Legacy callsite — derive slug from "nav:foo" key prefix.
    if (permissions?.length) {
      return permissions.map((p) => ({
        slug: p.key.startsWith("nav:") ? p.key.slice(4) : p.key,
        label: p.label,
        group: p.group,
      }));
    }
    return [];
  }, [pages, permissions]);

  const [name, setName] = useState(role?.name ?? "");
  const [description, setDescription] = useState(role?.description ?? "");
  const [checked, setChecked] = useState<Set<string>>(new Set(granted));
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const grouped = useMemo(() => {
    const out = new Map<string, PageItem[]>();
    for (const g of groups) out.set(g, []);
    for (const p of pageList) {
      const arr = out.get(p.group);
      if (arr) arr.push(p);
    }
    return out;
  }, [pageList, groups]);

  const toggleKey = (k: string) =>
    setChecked((cur) => {
      const n = new Set(cur);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  /** Tri-state per page: "none" | "read" | "rw". Clicking Write turns on
   *  Read implicitly (write-without-read is meaningless and would let
   *  someone POST to an endpoint they can't load). */
  const toggleRead = (slug: string) => {
    const rk = readKey(slug);
    const wk = writeKey(slug);
    setChecked((cur) => {
      const n = new Set(cur);
      if (n.has(rk)) {
        n.delete(rk);
        n.delete(wk); // removing read implicitly removes write
      } else {
        n.add(rk);
      }
      return n;
    });
  };
  const toggleWrite = (slug: string) => {
    const rk = readKey(slug);
    const wk = writeKey(slug);
    setChecked((cur) => {
      const n = new Set(cur);
      if (n.has(wk)) {
        n.delete(wk);
      } else {
        n.add(wk);
        n.add(rk); // adding write implicitly adds read
      }
      return n;
    });
  };

  /** Group-level master toggles: cycles none → all-read → all-rw → none. */
  const cycleGroup = (g: string) => {
    const items = grouped.get(g) ?? [];
    const reads = items.map((p) => readKey(p.slug));
    const writes = items.map((p) => writeKey(p.slug));
    const allReads = reads.every((k) => checked.has(k));
    const allWrites = writes.every((k) => checked.has(k));
    setChecked((cur) => {
      const n = new Set(cur);
      if (allWrites) {
        for (const k of reads) n.delete(k);
        for (const k of writes) n.delete(k);
      } else if (allReads) {
        for (const k of writes) n.add(k);
      } else {
        for (const k of reads) n.add(k);
      }
      return n;
    });
  };

  const save = () => {
    setError(null);
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    start(async () => {
      const body = {
        name: name.trim(),
        description: description.trim() || null,
        permissions: [...checked],
      };
      const res = isNew
        ? await fetch("/api/admin/roles", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
        : await fetch(`/api/admin/roles/${role!.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error ?? `Save failed (${res.status})`);
        return;
      }
      const j = await res.json();
      router.push(j.redirectTo ?? "/admin/roles");
      router.refresh();
    });
  };

  const onDelete = () => {
    if (!role || isSystem) return;
    if (role.assignedUsers > 0) {
      setError(`${role.assignedUsers} user(s) still assigned to this role. Reassign them first.`);
      return;
    }
    if (!window.confirm(`Delete role "${role.name}"? This cannot be undone.`)) return;
    start(async () => {
      const res = await fetch(`/api/admin/roles/${role.id}`, { method: "DELETE" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error ?? `Delete failed (${res.status})`);
        return;
      }
      router.push("/admin/roles");
      router.refresh();
    });
  };

  return (
    <div className="space-y-5">
      <div className="mt-2 mb-1">
        <h1 className="font-display text-[28px] font-extrabold tracking-tight text-ink-900">
          {isNew ? "New role" : role!.name}
        </h1>
        {!isNew && (
          <p className="text-[13px] text-ink-500 mt-1">
            {isSystem ? "System role — name + description editable, but cannot be deleted." : "Custom role."}
            {isSuper ? " Super Admin's permission set is always all-on and read-only here." : ""}
            {!isNew && ` · ${role!.assignedUsers} user${role!.assignedUsers === 1 ? "" : "s"} assigned`}
          </p>
        )}
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 flex items-start gap-2 text-[13px] text-red-700">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" /> <span>{error}</span>
        </div>
      )}

      <section className="rounded-2xl border border-ink-100 bg-white p-5 space-y-4">
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="text-[12px] font-semibold text-ink-700">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full h-10 px-3 rounded-xl border border-ink-200 bg-white text-[14px] outline-none focus:border-ink-900"
            />
          </div>
          <div>
            <label className="text-[12px] font-semibold text-ink-700">Description</label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What does this role do?"
              className="mt-1 w-full h-10 px-3 rounded-xl border border-ink-200 bg-white text-[14px] outline-none focus:border-ink-900"
            />
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-ink-100 bg-white p-5">
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <h2 className="font-display text-[16px] font-bold text-ink-900">Page access</h2>
            <p className="text-[12.5px] text-ink-500 mt-0.5">
              <b>Read</b> = view the page and its data. <b>Write</b> = create/edit/delete.
              Write implies read. Group headers cycle through none → all-read → all-read+write.
            </p>
          </div>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {groups.map((g) => {
            const items = grouped.get(g) ?? [];
            if (items.length === 0) return null;
            const reads  = items.filter((p) => checked.has(readKey(p.slug))).length;
            const writes = items.filter((p) => checked.has(writeKey(p.slug))).length;
            return (
              <div key={g} className="rounded-xl border border-ink-100 bg-cream-50/40 p-3">
                <button
                  type="button"
                  onClick={() => !isSuper && cycleGroup(g)}
                  disabled={isSuper}
                  className="flex items-center justify-between w-full text-left mb-2 disabled:cursor-not-allowed"
                >
                  <span className="text-[11.5px] font-semibold uppercase tracking-wider text-ink-700">
                    {g}
                  </span>
                  <span className="text-[10.5px] text-ink-500">
                    R {reads}/{items.length} · W {writes}/{items.length}
                  </span>
                </button>
                <ul className="space-y-1.5">
                  {items.map((p) => {
                    const rOn = isSuper || checked.has(readKey(p.slug));
                    const wOn = isSuper || checked.has(writeKey(p.slug));
                    return (
                      <li key={p.slug} className="flex items-center justify-between gap-2 text-[13px] text-ink-800">
                        <span className="truncate">{p.label}</span>
                        <span className="flex items-center gap-2 shrink-0">
                          <label className="flex items-center gap-1 cursor-pointer" title="Read">
                            <input
                              type="checkbox"
                              checked={rOn}
                              disabled={isSuper}
                              onChange={() => toggleRead(p.slug)}
                              className="h-3.5 w-3.5 rounded border-ink-300 disabled:opacity-50"
                            />
                            <span className="text-[11px] text-ink-500">R</span>
                          </label>
                          <label className="flex items-center gap-1 cursor-pointer" title="Write">
                            <input
                              type="checkbox"
                              checked={wOn}
                              disabled={isSuper}
                              onChange={() => toggleWrite(p.slug)}
                              className="h-3.5 w-3.5 rounded border-ink-300 disabled:opacity-50"
                            />
                            <span className="text-[11px] text-ink-500">W</span>
                          </label>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
        {isSuper && (
          <p className="mt-3 text-[12px] text-ink-500">
            Super Admin permissions auto-include every page — even ones added later. Cannot be edited.
          </p>
        )}
      </section>

      <div className="flex items-center justify-between gap-3 sticky bottom-0 -mx-4 sm:-mx-6 px-4 sm:px-6 py-3 bg-white/95 backdrop-blur border-t border-ink-100">
        <div>
          {!isNew && !isSystem && (
            <Button variant="danger" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={onDelete} disabled={pending}>
              Delete role
            </Button>
          )}
        </div>
        <Button variant="primary" icon={<Save className="h-3.5 w-3.5" />} onClick={save} disabled={pending}>
          {pending ? "Saving…" : isNew ? "Create role" : "Save changes"}
        </Button>
      </div>
    </div>
  );
}
