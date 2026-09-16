/**
 * Shared presentation for the roles screens.
 *
 * Server-renderable — no event handlers, so both the server list page and the
 * client editor can use these and stay visually identical.
 */

import * as React from "react";
import { Badge } from "@/components/admin/ui/primitives";
import {
  PERMISSION_LEVEL_LABEL,
  type PermissionLevel,
  type RoleCoverage,
} from "@/lib/admin-roles-view";
import { cn } from "@/lib/cn";

// ════════════════════════════════════════════════════════════════════
// Level
// ════════════════════════════════════════════════════════════════════

/**
 * Colour carries the blast radius, so the palette is ordered by how much
 * damage the role can do: full access is the loudest, no access the quietest.
 * A role that can change everything should not look like one that can read a
 * report.
 */
const LEVEL_TONE: Record<PermissionLevel, "danger" | "warning" | "info" | "default"> = {
  full: "danger",
  readwrite: "warning",
  readonly: "info",
  none: "default",
};

export function PermissionLevelBadge({ level }: { level: PermissionLevel }) {
  return (
    <Badge size="sm" tone={LEVEL_TONE[level]}>
      {PERMISSION_LEVEL_LABEL[level]}
    </Badge>
  );
}

// ════════════════════════════════════════════════════════════════════
// Type
// ════════════════════════════════════════════════════════════════════

/**
 * System roles are seeded and cannot be deleted; their permissions are still
 * editable (except Super Admin's). Marking them is what stops an operator
 * hunting for a delete action that will never appear.
 */
export function RoleTypeBadge({ isSystem }: { isSystem: boolean }) {
  return isSystem ? (
    <Badge size="sm" tone="subtle">
      System
    </Badge>
  ) : (
    <Badge size="sm" tone="brand">
      Custom
    </Badge>
  );
}

// ════════════════════════════════════════════════════════════════════
// Coverage
// ════════════════════════════════════════════════════════════════════

/**
 * "How much of the product does this role reach", as a number plus a two-tone
 * bar: the filled portion is pages the role can read, the darker portion
 * inside it is the subset it can also write.
 *
 * The nesting is the point — writable pages are a subset of readable ones, so
 * drawing them as two separate bars would imply they add up.
 */
export function CoverageMeter({
  coverage,
  className,
}: {
  coverage: RoleCoverage;
  className?: string;
}) {
  const { pages, writablePages, totalPages } = coverage;
  const readPct = totalPages === 0 ? 0 : (pages / totalPages) * 100;
  const writePct = totalPages === 0 ? 0 : (writablePages / totalPages) * 100;

  return (
    <div className={cn("min-w-[104px]", className)}>
      <div className="flex items-baseline gap-1 text-[12.5px] tabular-nums">
        <span className="font-semibold text-ink-800">{pages}</span>
        <span className="text-ink-400">/ {totalPages}</span>
        {writablePages > 0 ? (
          <span className="text-[11px] text-ink-500">({writablePages} write)</span>
        ) : null}
      </div>
      <div
        className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-ink-100"
        role="img"
        aria-label={`${pages} of ${totalPages} pages readable, ${writablePages} writable`}
      >
        <div className="relative h-full" style={{ width: `${readPct}%` }}>
          <div className="absolute inset-0 rounded-full bg-brand-200" />
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-brand"
            style={{ width: totalPages === 0 || readPct === 0 ? 0 : `${(writePct / readPct) * 100}%` }}
          />
        </div>
      </div>
    </div>
  );
}

/** Compact "n of 13 modules" for the list's Modules column. */
export function ModuleCount({ coverage }: { coverage: RoleCoverage }) {
  return (
    <span className="text-[12.5px] tabular-nums text-ink-700">
      <span className="font-semibold">{coverage.modules}</span>
      <span className="text-ink-400"> / {coverage.totalModules}</span>
    </span>
  );
}

// ════════════════════════════════════════════════════════════════════
// Dates
// ════════════════════════════════════════════════════════════════════

const FMT = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "Asia/Kolkata",
});

export const formatDay = (iso: string | null): string =>
  iso ? FMT.format(new Date(iso)) : "—";
