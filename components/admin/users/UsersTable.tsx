"use client";

/**
 * The Users table.
 *
 * One client island for the whole table rather than one per row: selection,
 * the bulk bar, every row menu and the dialogs share state, and splitting
 * them would mean lifting that state to a provider for no benefit. Rows
 * arrive already shaped from the server — this component renders and mutates,
 * it never queries.
 *
 * ── Mirroring the server's guards ───────────────────────────────────────
 * `PATCH /api/admin/users/[id]` refuses three things: changing your own role,
 * disabling your own account, and any change that would leave zero active
 * Super Admins. Those rules live on the server and stay there — but the menu
 * also disables the actions they would refuse, with the reason in a tooltip.
 *
 * An operator should learn that an action is impossible by looking at it, not
 * by clicking it and reading a 400. The server check is the enforcement; this
 * is the affordance. Neither replaces the other.
 */

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Eye,
  KeyRound,
  Lock,
  Pencil,
  ScrollText,
  ShieldCheck,
  Trash2,
  Unlock,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import {
  Checkbox,
  Field,
  Input,
  Menu,
  Td,
  Th,
  Tr,
  Button,
  type MenuItem,
} from "@/components/admin/ui/primitives";
import { ConfirmDialog } from "@/components/admin/ui/dialog";
// From lib/, never server/repos/: this is a client component, and importing
// the repo module would pull `postgres` into the browser bundle.
import {
  usersHref,
  type AdminUserRow,
  type SortKey,
  type UserFilters,
} from "@/lib/admin-users-view";
import {
  ExceptionBadge,
  LastLogin,
  UserIdentity,
  UserStatusBadge,
  formatDate,
} from "./presentation";
import { cn } from "@/lib/cn";

// ════════════════════════════════════════════════════════════════════
// Action model
// ════════════════════════════════════════════════════════════════════

/**
 * Every confirmable action is one value, so there is ONE dialog in the tree
 * instead of one boolean per action type. Adding "force sign-out" later is a
 * new variant here and a new menu entry — not a fourth `useState`.
 */
type PendingAction =
  | { kind: "lock"; targets: AdminUserRow[] }
  | { kind: "activate"; targets: AdminUserRow[] }
  | { kind: "resetPassword"; target: AdminUserRow }
  | { kind: "delete"; target: AdminUserRow }
  | null;

const describe = (a: NonNullable<PendingAction>) => {
  switch (a.kind) {
    case "lock": {
      const n = a.targets.length;
      return {
        title: n === 1 ? "Lock this account?" : `Lock ${n} accounts?`,
        description:
          n === 1
            ? `${label(a.targets[0])} will be signed out and refused at the login screen until an administrator unlocks the account. Nothing is deleted.`
            : `${n} accounts will be signed out and refused at the login screen until unlocked. Nothing is deleted.`,
        confirmLabel: n === 1 ? "Lock account" : `Lock ${n} accounts`,
        tone: "danger" as const,
      };
    }
    case "activate": {
      const n = a.targets.length;
      return {
        title: n === 1 ? "Reactivate this account?" : `Reactivate ${n} accounts?`,
        description:
          n === 1
            ? `${label(a.targets[0])} will be able to sign in again immediately, with the role and scope shown in the table.`
            : `${n} accounts will be able to sign in again immediately, each with the role and scope shown in the table.`,
        confirmLabel: n === 1 ? "Reactivate" : `Reactivate ${n}`,
        tone: "primary" as const,
      };
    }
    case "resetPassword":
      return {
        title: "Reset password",
        description: `Set a new password for ${label(a.target)}. They are not notified — you will need to pass it on yourself.`,
        confirmLabel: "Set new password",
        tone: "primary" as const,
      };
    case "delete":
      return {
        title: "Delete this user?",
        description: `${label(a.target)} (${a.target.email}) will be removed permanently and can no longer sign in. Their activity history is kept. This cannot be undone — to keep the account but stop sign-ins, lock it instead.`,
        confirmLabel: "Delete user",
        tone: "danger" as const,
      };
  }
};

const label = (u: AdminUserRow) => u.name?.trim() || u.email;

// ════════════════════════════════════════════════════════════════════
// Sortable header
// ════════════════════════════════════════════════════════════════════

function SortHeader({
  column,
  children,
  filters,
  right,
}: {
  column: SortKey;
  children: React.ReactNode;
  filters: UserFilters;
  right?: boolean;
}) {
  const active = filters.sort === column;
  // Clicking the active column flips direction; a new column starts ascending,
  // which is what "sort by name" means to everyone who is not a database.
  const nextDir = active && filters.dir === "asc" ? "desc" : "asc";
  const Arrow = filters.dir === "asc" ? ArrowUp : ArrowDown;

  return (
    <Th right={right} className="whitespace-nowrap">
      <Link
        href={usersHref(filters, { sort: column, dir: nextDir, page: 1 })}
        aria-sort={active ? (filters.dir === "asc" ? "ascending" : "descending") : undefined}
        className={cn(
          "group inline-flex items-center gap-1 rounded transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300",
          active ? "text-ink-900" : "hover:text-ink-800"
        )}
      >
        {children}
        <Arrow
          className={cn(
            "h-3 w-3 transition-opacity",
            active ? "opacity-100" : "opacity-0 group-hover:opacity-40"
          )}
        />
      </Link>
    </Th>
  );
}

// ════════════════════════════════════════════════════════════════════
// Table
// ════════════════════════════════════════════════════════════════════

export function UsersTable({
  rows,
  filters,
  currentUserId,
  canWrite,
  activeSuperCount,
  canManageAccess,
}: {
  rows: AdminUserRow[];
  filters: UserFilters;
  /** Drives the "you cannot do this to yourself" guards. */
  currentUserId: string;
  /** False for a read-only admin — every mutating affordance disappears. */
  canWrite: boolean;
  /** Lets the menu disable the change the server would refuse. */
  activeSuperCount: number;
  /**
   * Whether this operator can open the per-user ACCESS page.
   *
   * The user record itself is gated on `settings-users.*` — the same grant
   * that put the operator on this list — so View and Edit always lead
   * somewhere. The access page (`/access`) edits permission overrides and is
   * gated on `roles.*`; that is the one link that can legitimately be closed
   * to a user-manager, so it is disabled with the reason rather than offered
   * and bounced.
   */
  canManageAccess: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [pending, setPending] = React.useState<PendingAction>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [newPassword, setNewPassword] = React.useState("");

  const pageIds = React.useMemo(() => rows.map((r) => r.id), [rows]);

  // Selection is per page. Paging or re-filtering drops it deliberately:
  // carrying hidden selections across pages is how an operator locks twelve
  // accounts they cannot see. Reconciling against the current page also keeps
  // a stale id from a previous render out of a bulk request.
  React.useEffect(() => {
    setSelected((prev) => {
      const next = new Set([...prev].filter((id) => pageIds.includes(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [pageIds]);

  const selectedRows = rows.filter((r) => selected.has(r.id));
  const allSelected = rows.length > 0 && selected.size === rows.length;

  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(pageIds));

  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // ── Guards, mirrored from the API ──────────────────────────────────
  const isSelf = (u: AdminUserRow) => u.id === currentUserId;
  /**
   * The server refuses to let the last active Super Admin be locked. Count
   * comes from the server so this cannot drift from the real rule.
   */
  const isLastActiveSuper = (u: AdminUserRow) =>
    u.legacyRole === "super" && u.status === "active" && activeSuperCount <= 1;

  const lockBlockedReason = (u: AdminUserRow): string | null => {
    if (isSelf(u)) return "You can't lock your own account.";
    if (isLastActiveSuper(u)) return "At least one active Super Admin must remain.";
    return null;
  };

  // ── Mutations ──────────────────────────────────────────────────────

  const patch = async (id: string, body: Record<string, unknown>) => {
    const res = await fetch(`/api/admin/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(d.error ?? `Request failed (${res.status})`);
    }
  };

  const closeDialog = () => {
    setPending(null);
    setError(null);
    setNewPassword("");
  };

  const run = async () => {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      if (pending.kind === "resetPassword") {
        if (newPassword.length < 8) {
          setError("Use at least 8 characters.");
          return;
        }
        await patch(pending.target.id, { password: newPassword });
      } else if (pending.kind === "delete") {
        const res = await fetch(`/api/admin/users/${pending.target.id}`, { method: "DELETE" });
        if (!res.ok) {
          const d = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(d.error ?? `Request failed (${res.status})`);
        }
      } else {
        const status = pending.kind === "lock" ? "blocked" : "active";
        // Sequential, not Promise.all: the last-Super-Admin check is
        // evaluated per request, and firing a batch in parallel lets several
        // requests each see a world where another Super Admin is still
        // active. One at a time, the server's count is always truthful.
        const failures: string[] = [];
        for (const u of pending.targets) {
          try {
            await patch(u.id, { status });
          } catch (e) {
            failures.push(`${label(u)}: ${(e as Error).message}`);
          }
        }
        if (failures.length) {
          setError(
            failures.length === pending.targets.length
              ? failures[0]
              : `${failures.length} of ${pending.targets.length} could not be changed — ${failures[0]}`
          );
          router.refresh();
          return;
        }
      }
      setSelected(new Set());
      closeDialog();
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // ── Row menu ───────────────────────────────────────────────────────

  const menuFor = (u: AdminUserRow): MenuItem[] => {
    const detail = `/admin/settings/users/${u.id}`;
    const accessGate = canManageAccess
      ? undefined
      : "Needs the Roles & permissions permission.";

    const items: MenuItem[] = [
      { label: "View user", icon: <Eye className="h-3.5 w-3.5" />, href: detail },
    ];

    if (canWrite) {
      const lockReason = lockBlockedReason(u);
      items.push(
        { label: "Edit user", icon: <Pencil className="h-3.5 w-3.5" />, href: detail },
        {
          // Its own page, not an anchor into the profile — see
          // app/.../users/[id]/access/page.tsx for why.
          label: "Manage access",
          icon: <ShieldCheck className="h-3.5 w-3.5" />,
          href: canManageAccess ? `${detail}/access` : undefined,
          disabled: !canManageAccess,
          disabledReason: accessGate,
        },
        { kind: "separator" },
        {
          label: "Reset password",
          icon: <KeyRound className="h-3.5 w-3.5" />,
          onSelect: () => setPending({ kind: "resetPassword", target: u }),
        },
        u.status === "blocked"
          ? {
              label: "Reactivate user",
              icon: <Unlock className="h-3.5 w-3.5" />,
              onSelect: () => setPending({ kind: "activate", targets: [u] }),
            }
          : {
              // One entry, not "Lock" plus "Deactivate": account_status has no
              // `inactive`, so both would write `blocked`. Two menu items for
              // one effect teaches the operator a distinction that isn't there.
              label: "Lock user",
              icon: <Lock className="h-3.5 w-3.5" />,
              danger: true,
              disabled: Boolean(lockReason),
              disabledReason: lockReason ?? undefined,
              onSelect: () => setPending({ kind: "lock", targets: [u] }),
            }
      );
      // Delete mirrors the server's two refusals: never yourself, never the
      // last active Super Admin.
      const deleteReason = isSelf(u)
        ? "You can't delete your own account."
        : isLastActiveSuper(u)
          ? "At least one active Super Admin must remain."
          : null;
      items.push({
        label: "Delete user",
        icon: <Trash2 className="h-3.5 w-3.5" />,
        danger: true,
        disabled: Boolean(deleteReason),
        disabledReason: deleteReason ?? undefined,
        onSelect: () => setPending({ kind: "delete", target: u }),
      });
    }

    items.push(
      { kind: "separator" },
      {
        label: "View activity",
        icon: <ScrollText className="h-3.5 w-3.5" />,
        href: `/admin/activity?actor=${encodeURIComponent(u.id)}`,
      }
    );
    return items;
  };

  const dialog = pending ? describe(pending) : null;

  return (
    <>
      {/* ── Bulk bar ──────────────────────────────────────────────────
          Occupies the toolbar's place only while a selection exists, so it
          never competes with the filters for the operator's attention. */}
      {canWrite && selected.size > 0 ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-ink-100 bg-brand-50/60 px-4 py-2">
          <span className="text-[12.5px] font-semibold text-ink-800 tabular-nums">
            {selected.size} selected
          </span>
          <div className="ml-auto flex items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              icon={<Unlock className="h-3.5 w-3.5" />}
              onClick={() => setPending({ kind: "activate", targets: selectedRows })}
            >
              Reactivate
            </Button>
            <Button
              size="sm"
              variant="danger"
              icon={<Lock className="h-3.5 w-3.5" />}
              onClick={() => setPending({ kind: "lock", targets: selectedRows })}
            >
              Lock
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              Clear
            </Button>
          </div>
        </div>
      ) : null}

      {/* ── Table ─────────────────────────────────────────────────────
          The rail scrolls in BOTH axes so the header can stick: `sticky` is
          resolved against the nearest scrolling ancestor, so a header inside
          a container with no height constraint has nothing to stick to. The
          viewport-relative max-height gives it one. */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead className="sticky top-0 z-10 bg-cream-50 shadow-[0_1px_0_rgba(10,10,10,0.08)]">
            <tr>
              {canWrite ? (
                <Th className="w-8">
                  <Checkbox
                    checked={allSelected}
                    onChange={toggleAll}
                    aria-label="Select all users on this page"
                  />
                </Th>
              ) : null}
              <SortHeader column="user" filters={filters}>User</SortHeader>
              <SortHeader column="role" filters={filters}>Role</SortHeader>
              <SortHeader column="school" filters={filters}>Scope</SortHeader>
              <SortHeader column="status" filters={filters}>Status</SortHeader>
              <SortHeader column="lastLogin" filters={filters}>Last login</SortHeader>
              <SortHeader column="created" filters={filters}>Created</SortHeader>
              <Th right>Actions</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => {
              const locked = u.status === "blocked";
              return (
                <Tr key={u.id}>
                  {canWrite ? (
                    <Td>
                      <Checkbox
                        checked={selected.has(u.id)}
                        onChange={() => toggleOne(u.id)}
                        aria-label={`Select ${label(u)}`}
                      />
                    </Td>
                  ) : null}

                  <Td>
                    <Link
                      href={`/admin/settings/users/${u.id}`}
                      className="block rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
                    >
                      <UserIdentity name={u.name} email={u.email} muted={locked} />
                    </Link>
                  </Td>

                  <Td>
                    <span className="inline-flex items-center gap-1.5">
                      <span className="text-[12.5px] font-medium text-ink-800">
                        {u.roleName ?? u.legacyRole}
                      </span>
                      {/* System vs custom is a property of the ROLE and is
                          shown on the Roles page; on a person's row it only
                          reads as part of their title. */}
                      <ExceptionBadge grants={u.grantCount} revokes={u.revokeCount} />
                    </span>
                  </Td>

                  <Td muted className="whitespace-nowrap">
                    {u.schoolName ? (
                      <span className="text-[12.5px]">{u.schoolName}</span>
                    ) : (
                      // Not an em-dash: "no school" is a REAL and permissive
                      // state (the account sees every school), and reading it
                      // as missing data gets the blast radius backwards.
                      <span className="text-[12px] font-medium text-ink-400">All schools</span>
                    )}
                  </Td>

                  <Td>
                    <UserStatusBadge status={u.status} />
                  </Td>

                  <Td>
                    <LastLogin iso={u.lastLoginAt} />
                  </Td>

                  <Td muted>
                    <span className="text-[12.5px] tabular-nums whitespace-nowrap">
                      {formatDate(u.createdAt)}
                    </span>
                  </Td>

                  <Td right>
                    <div className="flex justify-end">
                      <Menu items={menuFor(u)} label={`Actions for ${label(u)}`} />
                    </div>
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── Confirmation ──────────────────────────────────────────────── */}
      {dialog ? (
        <ConfirmDialog
          open
          onClose={closeDialog}
          onConfirm={run}
          title={dialog.title}
          description={dialog.description}
          confirmLabel={dialog.confirmLabel}
          tone={dialog.tone}
          busy={busy}
          error={error}
        >
          {pending?.kind === "resetPassword" ? (
            <Field
              label="New password"
              htmlFor="new-password"
              hint="Minimum 8 characters. Share it through a channel the user already trusts."
              required
            >
              <Input
                id="new-password"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                invalid={Boolean(error)}
              />
            </Field>
          ) : null}
        </ConfirmDialog>
      ) : null}
    </>
  );
}
