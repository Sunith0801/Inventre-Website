/**
 * The frame around every page about ONE user.
 *
 * Two routes show a user — the record (`/users/<id>`) and their access
 * (`/users/<id>/access`). They used to render different headers, so moving
 * between them felt like leaving one screen for another rather than turning a
 * page in the same file. This shell gives both the identical header, fact
 * strip and tab bar; only the content under the tabs changes.
 *
 * ── Tabs across routes ──────────────────────────────────────────────────
 * The tab bar is navigation, not state. Overview and Activity are the record
 * page (Activity via `?tab=activity`); Access is its own route, kept separate
 * on purpose — an access review needs a URL that says "this person's
 * permissions" and nothing else. The bar makes the three feel like one
 * document while the URLs stay honest about which is which.
 *
 * Server component. No handlers, so pages can render it straight from a
 * server read.
 */

import * as React from "react";
import Link from "next/link";
import { ChevronLeft, History, ShieldCheck, UserRound } from "lucide-react";
import { PageHeader, Badge } from "@/components/admin/ui/primitives";
import { Tabs, type TabItem } from "@/components/admin/ui/tabs";
import type { AdminUserRow } from "@/lib/admin-users-view";
import { isSchoolScopedRole, roleHref } from "@/lib/admin-roles-view";
import {
  ExceptionBadge,
  LastLogin,
  UserStatusBadge,
  formatDate,
  formatDateTime,
} from "./presentation";

export type UserTab = "overview" | "access" | "activity";

export function userTabHref(userId: string, tab: UserTab): string {
  const base = `/admin/settings/users/${userId}`;
  switch (tab) {
    case "overview":
      return base;
    case "access":
      return `${base}/access`;
    case "activity":
      return `${base}?tab=activity`;
  }
}

export function UserDetailShell({
  user,
  active,
  children,
}: {
  user: AdminUserRow;
  active: UserTab;
  children: React.ReactNode;
}) {
  const display = user.name?.trim() || user.email;
  const exceptions = user.grantCount + user.revokeCount;

  const tabs: TabItem[] = [
    { key: "overview", label: "Overview", icon: <UserRound className="h-3.5 w-3.5" /> },
    {
      key: "access",
      label: "Access",
      icon: <ShieldCheck className="h-3.5 w-3.5" />,
      // The count is the reason to open the tab: a user with zero exceptions
      // has nothing to review there.
      count: exceptions > 0 ? exceptions : undefined,
    },
    { key: "activity", label: "Activity", icon: <History className="h-3.5 w-3.5" /> },
  ];

  return (
    <div>

      <PageHeader
        breadcrumb={[{ label: "Users", href: "/admin/settings/users" }, { label: display }]}
        title={display}
        description={user.email}
        actions={
          <div className="flex items-center gap-2">
            <UserStatusBadge status={user.status} />
            {user.roleName ? (
              <Badge size="sm" tone="subtle">
                {user.roleName}
              </Badge>
            ) : null}
          </div>
        }
      />

      {/* The facts an administrator checks before touching the account. The
          same strip the role page uses, so the two detail pages read alike. */}
      <div className="mb-3 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-ink-100 bg-white px-4 py-2">
        <Fact label="Role">
          {user.roleSlug ? (
            <Link
              href={roleHref(user.roleSlug)}
              className="text-[13px] font-semibold text-ink-900 hover:text-brand-700 hover:underline"
            >
              {user.roleName ?? user.legacyRole}
            </Link>
          ) : (
            <span className="text-[13px] text-ink-400">None</span>
          )}
        </Fact>
        <Fact label="Exceptions">
          {exceptions > 0 ? (
            <Link href={userTabHref(user.id, "access")} className="inline-flex hover:underline">
              <ExceptionBadge grants={user.grantCount} revokes={user.revokeCount} />
            </Link>
          ) : (
            <span className="text-[12.5px] text-ink-400">None — follows the role</span>
          )}
        </Fact>
        {/* Scope only exists for school-side roles; every other role acts
            for all schools, so the fact would say the same thing on every
            record and is left out. */}
        {isSchoolScopedRole(user.roleSlug) ? (
          <Fact label="School">
            <span className="text-[13px] text-ink-800">
              {user.schoolName ?? <span className="font-medium text-amber-700">Not set</span>}
            </span>
          </Fact>
        ) : null}
        <Fact label="Last login">
          <LastLogin iso={user.lastLoginAt} />
        </Fact>
        <Fact label="Created">
          <span
            className="text-[12.5px] tabular-nums text-ink-700"
            title={formatDateTime(user.createdAt)}
          >
            {formatDate(user.createdAt)}
          </span>
        </Fact>
      </div>

      <Tabs
        tabs={tabs}
        active={active}
        hrefFor={(k) => userTabHref(user.id, k as UserTab)}
        className="mb-4"
      />

      {children}
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-400">
        {label}
      </div>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}
