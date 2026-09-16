/**
 * Shared presentation for the Users screen — the small, boring decisions
 * that have to be made identically in the table, the filter bar and (later)
 * the detail header, or the screen stops looking like one screen.
 *
 * Server-renderable on purpose: the table is a client island, but these are
 * also used by server components, and nothing here needs an event handler.
 */

import * as React from "react";
import { Badge } from "@/components/admin/ui/primitives";
import { USER_STATUS_LABEL, type UserStatus } from "@/lib/admin-users-view";
import { cn } from "@/lib/cn";

// ════════════════════════════════════════════════════════════════════
// Status
// ════════════════════════════════════════════════════════════════════

/**
 * One mapping from status to colour, used everywhere.
 *
 * `blocked` reads as "Locked" because that is what it means to the person
 * reading the row: the account exists and is refused at the door. Calling it
 * "Blocked" invites the reader to wonder what a *blocked* account is, as
 * distinct from a disabled one.
 */
const STATUS_TONE: Record<UserStatus, "success" | "danger" | "warning"> = {
  active: "success",
  blocked: "danger",
  pending: "warning",
};

export function UserStatusBadge({ status }: { status: UserStatus }) {
  return (
    <Badge size="sm" tone={STATUS_TONE[status]}>
      {USER_STATUS_LABEL[status]}
    </Badge>
  );
}

// ════════════════════════════════════════════════════════════════════
// Identity cell
// ════════════════════════════════════════════════════════════════════

/** Initials from a display name, falling back to the email's local part. */
export function initialsOf(name: string | null, email: string): string {
  const source = (name ?? email.split("@")[0] ?? "").trim();
  if (!source) return "?";
  const parts = source.split(/[\s._-]+/).filter(Boolean);
  const letters = parts.length >= 2 ? parts[0][0] + parts[1][0] : source.slice(0, 2);
  return letters.toUpperCase();
}

/**
 * The primary cell: avatar, display name, email. Two lines rather than two
 * columns — an operator scans for a person, and splitting the name from the
 * address makes them read the row twice.
 */
export function UserIdentity({
  name,
  email,
  muted,
}: {
  name: string | null;
  email: string;
  /** Dimmed for a locked account, so a disabled row reads as disabled. */
  muted?: boolean;
}) {
  return (
    <div className="flex items-center gap-2.5 min-w-0">
      <span
        aria-hidden="true"
        className={cn(
          "grid h-7 w-7 shrink-0 place-items-center rounded-full",
          "text-[10.5px] font-bold tracking-wide",
          muted
            ? "bg-ink-100 text-ink-400"
            : "bg-gradient-to-br from-brand-200 to-brand-400 text-white"
        )}
      >
        {initialsOf(name, email)}
      </span>
      <span className="min-w-0">
        <span
          className={cn(
            "block truncate text-[13px] font-semibold",
            muted ? "text-ink-500" : "text-ink-900"
          )}
        >
          {name?.trim() || email.split("@")[0]}
        </span>
        <span className="block truncate text-[11.5px] text-ink-500">{email}</span>
      </span>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// Dates
// ════════════════════════════════════════════════════════════════════

const IST = "Asia/Kolkata";

const DATE_FMT = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: IST,
});

const DATETIME_FMT = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: IST,
});

export const formatDate = (iso: string | null): string =>
  iso ? DATE_FMT.format(new Date(iso)) : "—";

export const formatDateTime = (iso: string | null): string =>
  iso ? `${DATETIME_FMT.format(new Date(iso))} IST` : "—";

/**
 * Relative age at DAY granularity.
 *
 * Granularity is a correctness decision, not a style one: this renders on the
 * server and again on the client during hydration, and a "3 minutes ago"
 * would differ between the two renders and trip a hydration mismatch. Days do
 * not change in the gap.
 */
export function relativeDays(iso: string | null): string | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

/**
 * Last-login cell. "Never" is the security-interesting value, so it is
 * rendered as a real state rather than an em-dash lost among the dates.
 */
export function LastLogin({ iso }: { iso: string | null }) {
  if (!iso) {
    return (
      <span className="text-[12px] font-medium text-amber-700" title="This account has never signed in">
        Never
      </span>
    );
  }
  return (
    <span className="text-[12.5px] tabular-nums text-ink-700" title={formatDateTime(iso)}>
      {relativeDays(iso)}
    </span>
  );
}

// ════════════════════════════════════════════════════════════════════
// Exceptions
// ════════════════════════════════════════════════════════════════════

/**
 * "+3 −2" — how far this user departs from their role.
 *
 * Renders nothing for a clean inheritor, so a list of ten users where three
 * carry exceptions shows exactly three marks. Green is more-than-the-role,
 * amber is less; both carry a title, because colour alone is not a signal.
 */
export function ExceptionBadge({
  grants,
  revokes,
  className,
}: {
  grants: number;
  revokes: number;
  className?: string;
}) {
  if (grants === 0 && revokes === 0) return null;
  const title = [
    grants ? `${grants} permission${grants === 1 ? "" : "s"} granted beyond the role` : null,
    revokes ? `${revokes} revoked from the role` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1 rounded-md border border-ink-100 bg-white px-1.5 py-0.5 font-mono text-[10.5px] font-semibold tabular-nums",
        className
      )}
    >
      {grants > 0 ? <span className="text-emerald-700">+{grants}</span> : null}
      {revokes > 0 ? <span className="text-amber-700">−{revokes}</span> : null}
    </span>
  );
}
