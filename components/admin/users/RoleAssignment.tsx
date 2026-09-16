"use client";

/**
 * Role assignment for one user.
 *
 * This is all that belongs on a user's record. It used to sit above a full
 * 37-page Read/Write grid — the same grid the Roles screen already owns —
 * which meant the permission model was authored in two places and an operator
 * could not tell which one was authoritative.
 *
 * The split now:
 *
 *   /admin/roles/<role>               what a ROLE grants   (the matrix)
 *   /admin/settings/users/<id>        which role a USER has (this)
 *   /admin/settings/users/<id>/access that user's EXCEPTIONS to their role
 *
 * Changing the role here changes it for this user only. Changing what the
 * role means is a different screen, deliberately — edit it once and it
 * applies to everyone holding it.
 */

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Save, ShieldCheck } from "lucide-react";
import { Button, Card, Field, Select } from "@/components/admin/ui/primitives";
import { isSchoolScopedRole, roleHref } from "@/lib/admin-roles-view";

export type AssignableRole = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  isSystem: boolean;
};

export function RoleAssignment({
  user,
  roles,
  schools,
  canWrite,
  canEditRoles = false,
}: {
  user: {
    id: string;
    email: string;
    name: string | null;
    roleId: string | null;
    schoolId: string | null;
    isSelf: boolean;
  };
  roles: AssignableRole[];
  schools: { id: string; name: string }[];
  canWrite: boolean;
  /** Only a Super Admin (the `roles.write` holder) gets the shortcut into
   *  the role editor; for everyone else the link would lead to a denial. */
  canEditRoles?: boolean;
}) {
  const router = useRouter();
  const [roleId, setRoleId] = React.useState<string | null>(user.roleId);
  const [schoolId, setSchoolId] = React.useState(user.schoolId ?? "");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);

  React.useEffect(() => setRoleId(user.roleId), [user.roleId]);
  React.useEffect(() => setSchoolId(user.schoolId ?? ""), [user.schoolId]);

  // The API refuses to let anyone change their own role — that is how an
  // install ends up with nobody able to administer it.
  const locked = !canWrite || user.isSelf;
  const selected = roles.find((r) => r.id === roleId) ?? null;
  // Scope belongs to school-side roles only. Any other role acts for all
  // schools, so the control is not shown and a scope left over from an
  // earlier school role is cleared on save.
  const scoped = isSchoolScopedRole(selected?.slug);
  const effectiveSchoolId = scoped ? schoolId || null : null;
  const dirty = roleId !== user.roleId || effectiveSchoolId !== user.schoolId;

  const save = async () => {
    if (scoped && !schoolId) {
      setError(`A ${selected?.name ?? "school"} account must be scoped to a school.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roleId, schoolId: effectiveSchoolId }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        setError(d.error ?? `Could not change the role (${res.status}).`);
        return;
      }
      setSaved(true);
      router.refresh();
    } catch {
      setError("Network error — the role was not changed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-[15px] font-bold text-ink-900">Role</h2>
        </div>
        {/* The way out to the two neighbouring screens, so the relationship
            between role and exception is navigable rather than implied. */}
        <div className="flex flex-wrap items-center gap-2">
          {selected && canEditRoles ? (
            <Link href={roleHref(selected.slug)}>
              <Button variant="ghost" size="sm" iconRight={<ArrowRight className="h-3.5 w-3.5" />}>
                Edit the {selected.name} role
              </Button>
            </Link>
          ) : null}
          <Link href={`/admin/settings/users/${user.id}/access`}>
            <Button variant="secondary" size="sm" icon={<ShieldCheck className="h-3.5 w-3.5" />}>
              Manage access
            </Button>
          </Link>
        </div>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field
          label="Assigned role"
          htmlFor="user-role"
          hint={
            locked
              ? user.isSelf
                ? "You cannot change your own role."
                : "You have read-only access to roles."
              : undefined
          }
        >
          <Select
            id="user-role"
            value={roleId ?? ""}
            disabled={locked}
            onChange={(e) => {
              setRoleId(e.target.value || null);
              setSaved(false);
            }}
          >
            <option value="">No role assigned</option>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
                {r.isSystem ? " (system)" : ""}
              </option>
            ))}
          </Select>
        </Field>
        {scoped ? (
          <Field
            label="School"
            htmlFor="user-school"
            required
            hint="This role acts for one school only."
          >
            <Select
              id="user-school"
              value={schoolId}
              disabled={locked}
              invalid={Boolean(error) && !schoolId}
              onChange={(e) => {
                setSchoolId(e.target.value);
                setSaved(false);
              }}
            >
              <option value="">Choose a school…</option>
              {schools.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
      </div>

      {error ? (
        <div
          role="alert"
          className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-[12.5px] font-medium text-red-700"
        >
          {error}
        </div>
      ) : null}

      {!locked ? (
        <div className="mt-3 flex items-center justify-end gap-3 border-t border-ink-100 pt-3">
          {saved && !dirty ? (
            <span className="text-[12.5px] font-medium text-emerald-700">Saved</span>
          ) : null}
          <Button
            icon={<Save className="h-3.5 w-3.5" />}
            onClick={save}
            busy={busy}
            disabled={!dirty}
          >
            Save role
          </Button>
        </div>
      ) : null}
    </Card>
  );
}
