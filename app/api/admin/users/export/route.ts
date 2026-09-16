/**
 * CSV export for Administration → Users.
 *
 * Honours exactly the filters on screen (the toolbar builds this URL from the
 * same encoder the table uses), because an export that quietly widens to the
 * whole table hands the operator a file that contradicts what they were
 * looking at — and nothing in the file says so.
 *
 * Read permission, not write: this produces no change. It is still an
 * account-roster download, so it is gated exactly as the screen is.
 */

import { NextResponse } from "next/server";
import { requirePermission, isResponse } from "@/server/admin-guard";
import {
  USER_STATUS_LABEL,
  parseUserFilters,
  type AdminUserRow,
  type RawSearchParams,
} from "@/lib/admin-users-view";
import { listAdminUsers } from "@/server/repos/admin-users";

export const dynamic = "force-dynamic";

/** Page size for the drain loop — large enough to be few round-trips. */
const CHUNK = 500;

/**
 * Hard ceiling. An unbounded export is a way to turn one click into an
 * out-of-memory kill; at this size the file is already past what anyone
 * opens in a spreadsheet, and the filters are the right answer beyond it.
 */
const MAX_ROWS = 50_000;

const HEADERS = [
  "Name",
  "Email",
  "Role",
  "Scope",
  "Status",
  "Last login (IST)",
  "Created (IST)",
] as const;

/**
 * RFC 4180 quoting. Every field is quoted unconditionally rather than only
 * when it contains a comma: it is cheaper to reason about, and a name with a
 * quote in it is the case that breaks the clever version.
 */
const cell = (v: string | null | undefined): string =>
  `"${String(v ?? "").replace(/"/g, '""')}"`;

const IST = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Kolkata",
});

const stamp = (iso: string | null): string => (iso ? IST.format(new Date(iso)) : "");

const toRow = (u: AdminUserRow): string =>
  [
    cell(u.name),
    cell(u.email),
    cell(u.roleName ?? u.legacyRole),
    // Matches the table: an unscoped account is permissive, not missing.
    cell(u.schoolName ?? "All schools"),
    cell(USER_STATUS_LABEL[u.status]),
    cell(stamp(u.lastLoginAt)),
    cell(stamp(u.createdAt)),
  ].join(",");

export async function GET(req: Request) {
  const guard = await requirePermission("settings-users.read");
  if (isResponse(guard)) return guard;

  const sp = Object.fromEntries(new URL(req.url).searchParams) as RawSearchParams;
  const base = parseUserFilters(sp);

  const lines: string[] = [HEADERS.map(cell).join(",")];

  // Drain in chunks rather than one unbounded SELECT, so memory stays flat
  // and a large tenant degrades into more round-trips instead of a crash.
  for (let page = 1; ; page++) {
    const chunk = await listAdminUsers({ ...base, page, perPage: CHUNK });
    for (const u of chunk.rows) lines.push(toRow(u));
    if (page >= chunk.pages || lines.length > MAX_ROWS) break;
  }

  const filename = `users-${new Date().toISOString().slice(0, 10)}.csv`;

  return new NextResponse(
    // Excel reads a bare UTF-8 CSV as latin-1 and mangles every non-ASCII
    // name. The BOM is what makes it open them correctly.
    "﻿" + lines.join("\r\n"),
    {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        // A roster of accounts should not sit in a shared cache.
        "Cache-Control": "no-store",
      },
    }
  );
}
