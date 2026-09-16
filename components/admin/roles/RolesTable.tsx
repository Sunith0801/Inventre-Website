"use client";

/**
 * The roles table.
 *
 * No checkbox column and no bulk bar, unlike Users: bulk-editing roles is not
 * a thing anyone does, and an operator with eight rows does not need a select-
 * all they will never use. Density comes from the columns being informative,
 * not from adding controls.
 *
 * ── Guards mirrored from the API ────────────────────────────────────────
 * `DELETE /api/admin/roles/[id]` refuses a system role and refuses any role
 * with users still assigned. Both are disabled here with the reason attached,
 * so an operator learns the rule by looking rather than by clicking into a
 * 400. The server check remains the enforcement.
 */

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Copy, KeyRound, Pencil, Trash2, Users as UsersIcon } from "lucide-react";
import {
  Field,
  Input,
  Menu,
  Td,
  Th,
  Tr,
  type MenuItem,
} from "@/components/admin/ui/primitives";
import { ConfirmDialog } from "@/components/admin/ui/dialog";
import {
  permissionLevel,
  roleCoverage,
  orphanGrants,
  roleHref,
  SUPER_ADMIN_SLUG,
  type RoleListRow,
} from "@/lib/admin-roles-view";
import {
  CoverageMeter,
  ModuleCount,
  PermissionLevelBadge,
  RoleTypeBadge,
  formatDay,
} from "./presentation";

type Pending =
  | { kind: "delete"; role: RoleListRow }
  | { kind: "duplicate"; role: RoleListRow }
  | null;

export function RolesTable({
  roles,
  canWrite,
}: {
  roles: RoleListRow[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = React.useState<Pending>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [copyName, setCopyName] = React.useState("");

  const close = () => {
    setPending(null);
    setError(null);
    setCopyName("");
  };

  /** Why this role cannot be deleted, or null when it can. */
  const deleteBlockedReason = (r: RoleListRow): string | null => {
    if (r.isSystem) return "System roles cannot be deleted.";
    if (r.userCount > 0)
      return `${r.userCount} user${r.userCount === 1 ? " is" : "s are"} still assigned. Reassign them first.`;
    return null;
  };

  const run = async () => {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      if (pending.kind === "delete") {
        const res = await fetch(`/api/admin/roles/${pending.role.id}`, { method: "DELETE" });
        if (!res.ok) {
          const d = (await res.json().catch(() => ({}))) as { error?: string };
          setError(d.error ?? `Delete failed (${res.status}).`);
          return;
        }
      } else {
        const name = copyName.trim();
        if (!name) {
          setError("Give the new role a name.");
          return;
        }
        // Duplicate is a create carrying the source role's grants. The
        // endpoint validates every key against the registry, which means a
        // copy of a role holding orphaned grants is rejected — so they are
        // filtered out here rather than failing the whole request.
        const clean = pending.role.permissions.filter(
          (k) => !orphanGrants([k]).length
        );
        const res = await fetch("/api/admin/roles", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            description: pending.role.description,
            permissions: clean,
          }),
        });
        if (!res.ok) {
          const d = (await res.json().catch(() => ({}))) as { error?: string };
          setError(d.error ?? `Could not duplicate the role (${res.status}).`);
          return;
        }
        const created = (await res.json().catch(() => ({}))) as { redirectTo?: string };
        close();
        router.push(created.redirectTo ?? "/admin/roles");
        router.refresh();
        return;
      }
      close();
      router.refresh();
    } catch {
      setError("Network error — nothing was changed.");
    } finally {
      setBusy(false);
    }
  };

  const menuFor = (r: RoleListRow): MenuItem[] => {
    const href = roleHref(r.slug);
    const items: MenuItem[] = [
      { label: "View permissions", icon: <KeyRound className="h-3.5 w-3.5" />, href },
    ];
    if (canWrite) {
      const blocked = deleteBlockedReason(r);
      items.push(
        { label: "Edit role", icon: <Pencil className="h-3.5 w-3.5" />, href },
        {
          label: "Duplicate role",
          icon: <Copy className="h-3.5 w-3.5" />,
          onSelect: () => {
            setCopyName(`${r.name} (copy)`);
            setPending({ kind: "duplicate", role: r });
          },
        }
      );
      // Super Admin owns the system and can never be deleted, so the
      // dropdown does not offer it at all — not even greyed out.
      if (r.slug !== SUPER_ADMIN_SLUG) {
        items.push(
          { kind: "separator" },
          {
            label: "Delete role",
            icon: <Trash2 className="h-3.5 w-3.5" />,
            danger: true,
            disabled: Boolean(blocked),
            disabledReason: blocked ?? undefined,
            onSelect: () => setPending({ kind: "delete", role: r }),
          }
        );
      }
    }
    if (r.userCount > 0) {
      items.push(
        { kind: "separator" },
        {
          label: `View ${r.userCount} user${r.userCount === 1 ? "" : "s"}`,
          icon: <UsersIcon className="h-3.5 w-3.5" />,
          href: `/admin/settings/users?role=${encodeURIComponent(r.id)}`,
        }
      );
    }
    return items;
  };

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead className="bg-cream-50 border-b border-ink-100">
            <tr>
              <Th>Role</Th>
              <Th>Type</Th>
              <Th right>Users</Th>
              <Th right className="whitespace-nowrap">Modules</Th>
              <Th className="whitespace-nowrap">Page access</Th>
              <Th>Level</Th>
              <Th className="whitespace-nowrap">Last updated</Th>
              <Th right>Actions</Th>
            </tr>
          </thead>
          <tbody>
            {roles.map((r) => {
              const perms = new Set(r.permissions);
              const coverage = roleCoverage(perms);
              const orphans = orphanGrants(r.permissions);
              return (
                <Tr key={r.id}>
                  <Td>
                    <Link
                      href={roleHref(r.slug)}
                      className="block rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
                    >
                      <span className="block text-[13px] font-semibold text-ink-900">
                        {r.name}
                      </span>
                      <span className="block truncate max-w-[34ch] text-[11.5px] text-ink-500">
                        {r.description?.trim() || "No description"}
                      </span>
                    </Link>
                  </Td>

                  <Td>
                    <span className="inline-flex items-center gap-1.5">
                      <RoleTypeBadge isSystem={r.isSystem} />
                      {/* Drift is surfaced on the list, not buried in the
                          editor: a permission count nobody can explain is how
                          an access review stops being believed. */}
                      {orphans.length > 0 ? (
                        <span
                          className="text-[10.5px] font-semibold text-amber-700"
                          title={`Grants for pages that no longer exist: ${orphans.join(", ")}`}
                        >
                          {orphans.length} stale
                        </span>
                      ) : null}
                    </span>
                  </Td>

                  <Td right>
                    {r.userCount > 0 ? (
                      <Link
                        href={`/admin/settings/users?role=${encodeURIComponent(r.id)}`}
                        className="font-semibold tabular-nums text-ink-900 hover:text-brand-700 hover:underline"
                      >
                        {r.userCount}
                      </Link>
                    ) : (
                      <span className="tabular-nums text-ink-300">0</span>
                    )}
                  </Td>

                  <Td right>
                    <ModuleCount coverage={coverage} />
                  </Td>

                  <Td>
                    <CoverageMeter coverage={coverage} />
                  </Td>

                  <Td>
                    <PermissionLevelBadge level={permissionLevel(perms)} />
                  </Td>

                  <Td muted>
                    <span className="text-[12.5px] tabular-nums whitespace-nowrap">
                      {formatDay(r.updatedAt)}
                    </span>
                  </Td>

                  <Td right>
                    <div className="flex justify-end">
                      <Menu items={menuFor(r)} label={`Actions for ${r.name}`} />
                    </div>
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {pending?.kind === "delete" ? (
        <ConfirmDialog
          open
          onClose={close}
          onConfirm={run}
          busy={busy}
          error={error}
          title={`Delete "${pending.role.name}"?`}
          description="The role and its permission grants are removed permanently. This cannot be undone."
          confirmLabel="Delete role"
        />
      ) : null}

      {pending?.kind === "duplicate" ? (
        <ConfirmDialog
          open
          onClose={close}
          onConfirm={run}
          busy={busy}
          error={error}
          tone="primary"
          title="Duplicate role"
          description={`Creates a new custom role with the same ${pending.role.permissions.length} permission grants as "${pending.role.name}". No users are assigned to it.`}
          confirmLabel="Create copy"
        >
          <Field label="New role name" htmlFor="copy-role-name" required>
            <Input
              id="copy-role-name"
              value={copyName}
              onChange={(e) => setCopyName(e.target.value)}
              invalid={Boolean(error) && !copyName.trim()}
            />
          </Field>
        </ConfirmDialog>
      ) : null}
    </>
  );
}
