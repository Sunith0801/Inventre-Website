"use client";

/**
 * "Add user" — trigger plus dialog.
 *
 * A dialog rather than a `/new` route because creating a staff account is six
 * fields with no sub-objects and no draft worth preserving. A full page would
 * cost a navigation each way and lose the operator's filters and scroll
 * position on cancel, to show a form shorter than the table it covers.
 * Anything with tabs or a permission matrix earns a page; this does not.
 *
 * The role picker lists the real roles from Roles & permissions, in hierarchy
 * order — the same list the user's detail page offers — so an account is
 * created with the right role in one step instead of "create as Operations,
 * then go and change it".
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { UserPlus } from "lucide-react";
import {
  Button,
  Field,
  Input,
  Select,
} from "@/components/admin/ui/primitives";
import { Dialog } from "@/components/admin/ui/dialog";
import { isSchoolScopedRole } from "@/lib/admin-roles-view";

export type RoleChoice = { id: string; slug: string; name: string; description: string | null };

const MIN_PASSWORD = 8;

export function AddUserDialog({
  roles,
  schools,
}: {
  roles: RoleChoice[];
  schools: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [roleId, setRoleId] = React.useState("");
  const [schoolId, setSchoolId] = React.useState("");

  const role = roles.find((r) => r.id === roleId) ?? null;
  // Only a school-side role carries a school; the field is absent, not
  // greyed, for every other role.
  const scoped = isSchoolScopedRole(role?.slug);

  const reset = () => {
    setName("");
    setEmail("");
    setPassword("");
    setRoleId("");
    setSchoolId("");
    setError(null);
  };

  const close = () => {
    if (busy) return;
    setOpen(false);
    reset();
  };

  const submit = async () => {
    // Validated here for an instant answer, and again by the endpoint's zod
    // schema because a client check is a courtesy, never a control.
    if (!email.trim()) return setError("Email is required.");
    if (password.length < MIN_PASSWORD)
      return setError(`Password must be at least ${MIN_PASSWORD} characters.`);
    if (!role) return setError("Choose a role.");
    if (scoped && !schoolId)
      return setError(`A ${role.name} account must be scoped to a school.`);

    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          name: name.trim() || null,
          password,
          roleId: role.id,
          schoolId: scoped ? schoolId : null,
          status: "active",
        }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        // The endpoint returns a generic message on a duplicate email; say the
        // useful thing instead of making the operator guess.
        setError(
          res.status === 409
            ? "An account with that email already exists."
            : (d.error ?? `Could not create the user (${res.status}).`)
        );
        return;
      }
      setOpen(false);
      reset();
      router.refresh();
    } catch {
      setError("Network error — the user was not created.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button icon={<UserPlus className="h-3.5 w-3.5" />} onClick={() => setOpen(true)}>
        Add user
      </Button>

      <Dialog
        open={open}
        onClose={close}
        title="Add user"
        description="Creates a staff account that can sign in to the admin panel immediately."
        busy={busy}
        width="lg"
        footer={
          <>
            <Button variant="secondary" onClick={close} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={submit} busy={busy}>
              Create user
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name" htmlFor="new-user-name">
              <Input
                id="new-user-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Priya Nair"
                autoComplete="off"
              />
            </Field>
            <Field label="Email" htmlFor="new-user-email" required>
              <Input
                id="new-user-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="priya@inventre.in"
                autoComplete="off"
                invalid={Boolean(error) && !email.trim()}
              />
            </Field>
          </div>

          <Field
            label="Temporary password"
            htmlFor="new-user-password"
            hint={`At least ${MIN_PASSWORD} characters. The user is not emailed — pass it on yourself.`}
            required
          >
            <Input
              id="new-user-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              invalid={Boolean(error) && password.length < MIN_PASSWORD}
            />
          </Field>

          <Field
            label="Role"
            htmlFor="new-user-role"
            hint={role?.description?.trim() || "What this account can open is set on the Roles & permissions page."}
            required
          >
            <Select
              id="new-user-role"
              value={roleId}
              onChange={(e) => {
                setRoleId(e.target.value);
                setSchoolId("");
              }}
              invalid={Boolean(error) && !roleId}
            >
              <option value="">Choose a role…</option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
          </Field>

          {scoped ? (
            <Field
              label="School"
              htmlFor="new-user-school"
              hint="This account will see only this school's data."
              required
            >
              <Select
                id="new-user-school"
                value={schoolId}
                onChange={(e) => setSchoolId(e.target.value)}
                invalid={Boolean(error) && !schoolId}
              >
                <option value="">Select a school…</option>
                {schools.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}

          {error ? (
            <div
              role="alert"
              className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-[12.5px] font-medium text-red-700"
            >
              {error}
            </div>
          ) : null}
        </div>
      </Dialog>
    </>
  );
}
