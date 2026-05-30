"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Save, AlertCircle, Check, X, Minus } from "lucide-react";
import { Button } from "@/components/admin/ui/primitives-client";
import { readKey, writeKey } from "@/lib/admin-permissions";

type Role = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  isSystem: boolean;
};

type UserInput = {
  id: string;
  email: string;
  name: string | null;
  roleId: string | null;
  status: "active" | "blocked" | "pending";
  isSelf: boolean;
};

type PageItem = { slug: string; label: string; group: string };
type Override = { permission: string; granted: boolean };

/**
 * Tri-state per (page, action) cell:
 *   - "inherit"      → no override row; effective value comes from the role
 *   - "force-on"     → override row with granted=true
 *   - "force-off"    → override row with granted=false
 *
 * In UI: clicking cycles inherit → force-on → force-off → inherit if the
 * role baseline is OFF; or inherit → force-off → force-on → inherit if the
 * role baseline is ON. (Always 3 states; click moves to "the next one
 * that visibly changes effective access".)
 */
type CellState = "inherit" | "force-on" | "force-off";

export function UserPermissionsEditor({
  user,
  roles,
  pages,
  groups,
  rolePerms,
  overrides,
}: {
  user: UserInput;
  roles: Role[];
  pages: PageItem[];
  groups: string[];
  rolePerms: string[];
  overrides: Override[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [roleId, setRoleId] = useState<string | null>(user.roleId);
  const [cells, setCells] = useState<Map<string, CellState>>(() => {
    const m = new Map<string, CellState>();
    for (const o of overrides) m.set(o.permission, o.granted ? "force-on" : "force-off");
    return m;
  });

  const roleBaseline = useMemo(() => new Set(rolePerms), [rolePerms]);

  const grouped = useMemo(() => {
    const out = new Map<string, PageItem[]>();
    for (const g of groups) out.set(g, []);
    for (const p of pages) {
      const arr = out.get(p.group);
      if (arr) arr.push(p);
    }
    return out;
  }, [pages, groups]);

  const cycleCell = (perm: string) => {
    setCells((cur) => {
      const next = new Map(cur);
      const inherited = roleBaseline.has(perm);
      const state: CellState = cur.get(perm) ?? "inherit";
      // Cycle: inherit → opposite-of-baseline → same-as-baseline → inherit.
      // Going through both override states gives the admin a visible audit
      // trail in case they want to ESTABLISH the value explicitly even
      // though it matches inheritance.
      let nextState: CellState;
      if (state === "inherit") nextState = inherited ? "force-off" : "force-on";
      else if (state === (inherited ? "force-off" : "force-on")) nextState = inherited ? "force-on" : "force-off";
      else nextState = "inherit";
      if (nextState === "inherit") next.delete(perm);
      else next.set(perm, nextState);
      return next;
    });
  };

  const effectiveOn = (perm: string): boolean => {
    const state = cells.get(perm) ?? "inherit";
    if (state === "force-on") return true;
    if (state === "force-off") return false;
    return roleBaseline.has(perm);
  };

  const renderCell = (perm: string) => {
    const state = cells.get(perm) ?? "inherit";
    const on = effectiveOn(perm);
    const baseColor = on ? "text-emerald-600 border-emerald-200 bg-emerald-50" : "text-ink-400 border-ink-100 bg-white";
    const ringByOverride =
      state === "force-on" ? "ring-2 ring-emerald-400" :
      state === "force-off" ? "ring-2 ring-amber-400" :
      "";
    const icon = state === "inherit"
      ? <Minus className="h-3 w-3" />
      : state === "force-on"
        ? <Check className="h-3 w-3" />
        : <X className="h-3 w-3" />;
    return (
      <button
        type="button"
        onClick={() => cycleCell(perm)}
        disabled={user.isSelf}
        title={
          state === "inherit"
            ? `Inherits from role (${on ? "ON" : "OFF"})`
            : state === "force-on"
              ? "Granted as override"
              : "Revoked as override"
        }
        className={`inline-flex items-center justify-center h-6 w-6 rounded-md border ${baseColor} ${ringByOverride} disabled:opacity-50 disabled:cursor-not-allowed`}
      >
        {icon}
      </button>
    );
  };

  const save = () => {
    setError(null);
    start(async () => {
      // 1. Save role + status if changed (small PATCH).
      if (roleId !== user.roleId) {
        const r = await fetch(`/api/admin/users/${user.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ roleId }),
        });
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          setError(j.error ?? `Role save failed (${r.status})`);
          return;
        }
      }
      // 2. Replace per-user overrides.
      const grants: string[] = [];
      const revokes: string[] = [];
      for (const [perm, state] of cells.entries()) {
        if (state === "force-on") grants.push(perm);
        else if (state === "force-off") revokes.push(perm);
      }
      const r = await fetch(`/api/admin/users/${user.id}/permissions`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ grants, revokes }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        setError(j.error ?? `Permission save failed (${r.status})`);
        return;
      }
      router.refresh();
    });
  };

  const selectedRole = roles.find((r) => r.id === roleId) ?? null;

  return (
    <div className="space-y-5">
      <div className="mt-2 mb-1">
        <h1 className="font-display text-[28px] font-extrabold tracking-tight text-ink-900">
          {user.name || user.email}
        </h1>
        <p className="text-[13px] text-ink-500 mt-1">
          {user.email} · {user.status}{user.isSelf ? " · This is you — role and permissions are locked." : ""}
        </p>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 flex items-start gap-2 text-[13px] text-red-700">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" /> <span>{error}</span>
        </div>
      )}

      <section className="rounded-2xl border border-ink-100 bg-white p-5">
        <h2 className="font-display text-[16px] font-bold text-ink-900 mb-3">Role</h2>
        <div className="grid sm:grid-cols-2 gap-3 items-start">
          <select
            value={roleId ?? ""}
            disabled={user.isSelf}
            onChange={(e) => setRoleId(e.target.value || null)}
            className="h-10 rounded-xl border border-ink-200 bg-white px-3 text-[14px] outline-none focus:border-ink-900 disabled:opacity-60"
          >
            <option value="">— no role —</option>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}{r.isSystem ? " (system)" : ""}
              </option>
            ))}
          </select>
          {selectedRole?.description && (
            <p className="text-[12.5px] text-ink-500">{selectedRole.description}</p>
          )}
        </div>
      </section>

      <section className="rounded-2xl border border-ink-100 bg-white p-5">
        <div className="mb-3">
          <h2 className="font-display text-[16px] font-bold text-ink-900">Page access</h2>
          <p className="text-[12.5px] text-ink-500 mt-0.5">
            Each row shows two cells (Read · Write). Default state is{" "}
            <span className="inline-flex items-center gap-1 align-middle">
              <span className="inline-flex h-4 w-4 items-center justify-center rounded border border-ink-200 bg-white text-ink-400"><Minus className="h-2.5 w-2.5" /></span> inherit
            </span>{" "}
            (whatever the role grants). Click to add an{" "}
            <span className="inline-flex items-center gap-1 align-middle">
              <span className="inline-flex h-4 w-4 items-center justify-center rounded border border-emerald-200 bg-emerald-50 text-emerald-600 ring-2 ring-emerald-400"><Check className="h-2.5 w-2.5" /></span> explicit grant
            </span>{" "}
            or{" "}
            <span className="inline-flex items-center gap-1 align-middle">
              <span className="inline-flex h-4 w-4 items-center justify-center rounded border border-ink-100 bg-white text-ink-400 ring-2 ring-amber-400"><X className="h-2.5 w-2.5" /></span> explicit revoke
            </span>
            . Green cells mean the user effectively has access.
          </p>
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          {groups.map((g) => {
            const items = grouped.get(g) ?? [];
            if (items.length === 0) return null;
            return (
              <div key={g} className="rounded-xl border border-ink-100 bg-cream-50/40 p-3">
                <div className="text-[11.5px] font-semibold uppercase tracking-wider text-ink-700 mb-2">{g}</div>
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="text-[10px] text-ink-400">
                      <th className="text-left font-medium pb-1"></th>
                      <th className="font-medium pb-1 w-12 text-center">R</th>
                      <th className="font-medium pb-1 w-12 text-center">W</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((p) => (
                      <tr key={p.slug}>
                        <td className="py-1 pr-2 text-ink-800 truncate">{p.label}</td>
                        <td className="py-1 text-center">{renderCell(readKey(p.slug))}</td>
                        <td className="py-1 text-center">{renderCell(writeKey(p.slug))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      </section>

      <div className="flex items-center justify-end gap-3 sticky bottom-0 -mx-4 sm:-mx-6 px-4 sm:px-6 py-3 bg-white/95 backdrop-blur border-t border-ink-100">
        <Button
          variant="primary"
          icon={<Save className="h-3.5 w-3.5" />}
          onClick={save}
          disabled={pending || user.isSelf}
        >
          {pending ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </div>
  );
}
