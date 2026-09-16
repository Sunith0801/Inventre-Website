"use client";

/**
 * Account — the sensitive actions on a user: lock / reactivate, reset the
 * password.
 *
 * These existed only in the Users list's ⋯ menu. On the user's own page —
 * where an administrator has just read the facts and decided to act — there
 * was nothing to act with. The spec put "Deactivate User" on this page; this
 * is that, plus the password reset that goes with it.
 *
 * Every guard the API enforces is mirrored as a disabled control with its
 * reason: you cannot lock yourself, and you cannot lock the last active Super
 * Admin. The server still refuses either; this just says so before the click.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Lock, Trash2, Unlock } from "lucide-react";
import { Button, Card, Field, Input } from "@/components/admin/ui/primitives";
import { ConfirmDialog } from "@/components/admin/ui/dialog";
import type { UserStatus } from "@/lib/admin-users-view";
import { UserStatusBadge } from "./presentation";

type Pending =
  | { kind: "lock" }
  | { kind: "activate" }
  | { kind: "resetPassword" }
  | { kind: "delete" }
  | null;

const MIN_PASSWORD = 8;

export function AccountActionsCard({
  user,
  activeSuperCount,
  canWrite,
}: {
  user: {
    id: string;
    name: string | null;
    email: string;
    status: UserStatus;
    legacyRole: string;
    isSelf: boolean;
  };
  activeSuperCount: number;
  canWrite: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = React.useState<Pending>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [newPassword, setNewPassword] = React.useState("");

  const display = user.name?.trim() || user.email;
  const locked = user.status === "blocked";

  const lockBlockedReason =
    user.isSelf
      ? "You can't lock your own account."
      : user.legacyRole === "super" && user.status === "active" && activeSuperCount <= 1
        ? "At least one active Super Admin must remain."
        : null;
  // Same two refusals as the server's DELETE.
  const deleteBlockedReason =
    user.isSelf
      ? "You can't delete your own account."
      : user.legacyRole === "super" && user.status === "active" && activeSuperCount <= 1
        ? "At least one active Super Admin must remain."
        : null;

  const close = () => {
    setPending(null);
    setError(null);
    setNewPassword("");
  };

  const run = async () => {
    if (!pending) return;
    if (pending.kind === "resetPassword" && newPassword.length < MIN_PASSWORD) {
      setError(`Use at least ${MIN_PASSWORD} characters.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res =
        pending.kind === "delete"
          ? await fetch(`/api/admin/users/${user.id}`, { method: "DELETE" })
          : await fetch(`/api/admin/users/${user.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(
                pending.kind === "resetPassword"
                  ? { password: newPassword }
                  : { status: pending.kind === "lock" ? "blocked" : "active" }
              ),
            });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        setError(d.error ?? `Request failed (${res.status}).`);
        return;
      }
      if (pending.kind === "delete") {
        // The record no longer exists — back to the list, not a refresh of a 404.
        router.push("/admin/settings/users");
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

  const dialog =
    pending?.kind === "lock"
      ? {
          title: "Lock this account?",
          description: `${display} will be signed out and refused at the login screen until an administrator reactivates the account. Nothing is deleted.`,
          confirmLabel: "Lock account",
          tone: "danger" as const,
        }
      : pending?.kind === "activate"
        ? {
            title: "Reactivate this account?",
            description: `${display} will be able to sign in again immediately, with their current role and scope.`,
            confirmLabel: "Reactivate",
            tone: "primary" as const,
          }
        : pending?.kind === "resetPassword"
          ? {
              title: "Reset password",
              description: `Set a new password for ${display}. They are not notified — you will need to pass it on yourself.`,
              confirmLabel: "Set new password",
              tone: "primary" as const,
            }
          : pending?.kind === "delete"
            ? {
                title: "Delete this user?",
                description: `${display} (${user.email}) will be removed permanently and can no longer sign in. Their activity history is kept. This cannot be undone — to keep the account but stop sign-ins, lock it instead.`,
                confirmLabel: "Delete user",
                tone: "danger" as const,
              }
            : null;

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-[15px] font-bold text-ink-900">Account</h2>
          {locked ? (
            <p className="mt-0.5 text-[12.5px] text-amber-700">
              This account is locked. Sign-in is refused until it is reactivated.
            </p>
          ) : null}
        </div>
        <UserStatusBadge status={user.status} />
      </div>

      {canWrite ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-ink-100 pt-3">
          <Button
            variant="secondary"
            size="sm"
            icon={<KeyRound className="h-3.5 w-3.5" />}
            onClick={() => setPending({ kind: "resetPassword" })}
          >
            Reset password
          </Button>
          {locked ? (
            <Button
              variant="secondary"
              size="sm"
              icon={<Unlock className="h-3.5 w-3.5" />}
              onClick={() => setPending({ kind: "activate" })}
            >
              Reactivate account
            </Button>
          ) : (
            <span title={lockBlockedReason ?? undefined}>
              <Button
                variant="danger"
                size="sm"
                icon={<Lock className="h-3.5 w-3.5" />}
                onClick={() => setPending({ kind: "lock" })}
                disabled={Boolean(lockBlockedReason)}
              >
                Lock account
              </Button>
            </span>
          )}
          {lockBlockedReason && !locked ? (
            <span className="text-[11.5px] text-ink-500">{lockBlockedReason}</span>
          ) : null}
          <span className="ml-auto" title={deleteBlockedReason ?? undefined}>
            <Button
              variant="danger"
              size="sm"
              icon={<Trash2 className="h-3.5 w-3.5" />}
              onClick={() => setPending({ kind: "delete" })}
              disabled={Boolean(deleteBlockedReason)}
            >
              Delete user
            </Button>
          </span>
        </div>
      ) : null}

      {dialog ? (
        <ConfirmDialog
          open
          onClose={close}
          onConfirm={run}
          busy={busy}
          error={error}
          title={dialog.title}
          description={dialog.description}
          confirmLabel={dialog.confirmLabel}
          tone={dialog.tone}
        >
          {pending?.kind === "resetPassword" ? (
            <Field
              label="New password"
              htmlFor="account-new-password"
              hint={`Minimum ${MIN_PASSWORD} characters. Share it through a channel the user already trusts.`}
              required
            >
              <Input
                id="account-new-password"
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
    </Card>
  );
}
