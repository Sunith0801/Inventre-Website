"use client";

/**
 * "New role" — trigger plus dialog.
 *
 * Replaces the `/admin/roles/new` route, which rendered the full 37-page
 * permission matrix for a role that did not exist yet. That order is
 * backwards: you cannot sensibly grant page access before you have decided
 * what the role is for, and an operator who abandoned the form lost both the
 * name and every checkbox they had set.
 *
 * So creation asks the two questions that define a role — what is it called,
 * and what should it start from — then drops the operator into that role's
 * matrix to configure it. "Start from" matters: almost every new role is a
 * near-copy of an existing one, and starting from a blank set of 37 pages is
 * the slowest possible path to a working role.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button, Field, Input, Select, Textarea } from "@/components/admin/ui/primitives";
import { Dialog } from "@/components/admin/ui/dialog";
import { orphanGrants } from "@/lib/admin-roles-view";

export type RoleTemplate = {
  id: string;
  name: string;
  permissions: string[];
};

/** Sentinel for "grant nothing" — an empty value would read as "unset". */
const BLANK = "__blank__";

export function NewRoleDialog({ templates }: { templates: RoleTemplate[] }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [from, setFrom] = React.useState<string>(BLANK);

  const source = templates.find((t) => t.id === from);

  const close = () => {
    if (busy) return;
    setOpen(false);
    setName("");
    setDescription("");
    setFrom(BLANK);
    setError(null);
  };

  const submit = async () => {
    if (!name.trim()) {
      setError("Give the role a name.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/roles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          // Stale grants are dropped rather than carried into a new role —
          // the endpoint validates every key against the registry and would
          // reject the whole request for one dead key.
          permissions: (source?.permissions ?? []).filter(
            (k) => !orphanGrants([k]).length
          ),
        }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        setError(d.error ?? `Could not create the role (${res.status}).`);
        return;
      }
      const created = (await res.json().catch(() => ({}))) as { redirectTo?: string };
      setOpen(false);
      // Straight into the matrix — creating a role is step one of two, and
      // dropping back to the list would hide the step that remains.
      router.push(created.redirectTo ?? "/admin/roles");
      router.refresh();
    } catch {
      setError("Network error — the role was not created.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setOpen(true)}>
        New role
      </Button>

      <Dialog
        open={open}
        onClose={close}
        title="New role"
        description="Create the role, then set its page permissions on the next screen."
        busy={busy}
        width="lg"
        footer={
          <>
            <Button variant="secondary" onClick={close} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={submit} busy={busy}>
              Create &amp; configure
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Role name" htmlFor="new-role-name" required>
            <Input
              id="new-role-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Dispatch Supervisor"
              autoComplete="off"
              invalid={Boolean(error) && !name.trim()}
            />
          </Field>

          <Field
            label="Description"
            htmlFor="new-role-description"
            hint="Shown on the roles list and when assigning this role to a user."
          >
            <Textarea
              id="new-role-description"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this role responsible for?"
            />
          </Field>

          <Field
            label="Start from"
            htmlFor="new-role-from"
            hint={
              source
                ? `Copies ${source.permissions.length} grants from ${source.name}. You can change any of them on the next screen.`
                : "The role starts with no access at all. Every page is granted explicitly."
            }
          >
            <Select
              id="new-role-from"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            >
              <option value={BLANK}>No permissions (start blank)</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  Copy of {t.name} ({t.permissions.length} grants)
                </option>
              ))}
            </Select>
          </Field>

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
