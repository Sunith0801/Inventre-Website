/**
 * Per-user access overrides — the algebra.
 *
 * A role is the baseline. An override is a deliberate exception on ONE user:
 * give this person one extra module, or take one away, without inventing a
 * whole role for the difference. The runtime computes
 *
 *     effective = (role grants ∪ user grants) \ user revokes
 *
 * and this module is the client-side model of exactly that, so the editor and
 * the session agree on what a set of overrides means.
 *
 * ── Why a separate module from admin-roles-view ─────────────────────────
 * The role matrix edits ONE set. This edits a DIFFERENCE against a set that
 * can itself change underneath it. "Checked" on a role means granted; here it
 * means granted-or-inherited, and those need different words or the screen
 * misleads. The shared part — that write implies read — is imported rather
 * than restated.
 *
 * No database import: the editor is a client component.
 */

import { readKey, writeKey, type AdminPage } from "@/lib/admin-permissions";

/**
 * What the user's own row says about one permission key.
 *
 *   inherit  no row — the role decides
 *   grant    an explicit yes, even if the role says no
 *   revoke   an explicit no, even if the role says yes
 */
export type CellState = "inherit" | "grant" | "revoke";

/** permission key → explicit decision. Absent means inherit. */
export type Overrides = ReadonlyMap<string, boolean>;

export function cellState(overrides: Overrides, key: string): CellState {
  if (!overrides.has(key)) return "inherit";
  return overrides.get(key) ? "grant" : "revoke";
}

/** Does the user effectively hold this key, after the role and the override? */
export function effectiveHas(
  baseline: ReadonlySet<string>,
  overrides: Overrides,
  key: string
): boolean {
  return overrides.has(key) ? Boolean(overrides.get(key)) : baseline.has(key);
}

/** The full effective set — what `CurrentAdmin.permissions` will hold. */
export function effectiveSet(
  baseline: ReadonlySet<string>,
  overrides: Overrides
): Set<string> {
  const out = new Set(baseline);
  for (const [key, granted] of overrides) {
    if (granted) out.add(key);
    else out.delete(key);
  }
  return out;
}

// ════════════════════════════════════════════════════════════════════
// Per-page level
// ════════════════════════════════════════════════════════════════════

export type PageAccess = "none" | "read" | "write";

/** The level the user ends up with on one page. */
export function effectivePageAccess(
  baseline: ReadonlySet<string>,
  overrides: Overrides,
  slug: string
): PageAccess {
  if (effectiveHas(baseline, overrides, writeKey(slug))) return "write";
  if (effectiveHas(baseline, overrides, readKey(slug))) return "read";
  return "none";
}

/** The level the ROLE alone would give — what the row falls back to. */
export function baselinePageAccess(
  baseline: ReadonlySet<string>,
  slug: string
): PageAccess {
  if (baseline.has(writeKey(slug))) return "write";
  if (baseline.has(readKey(slug))) return "read";
  return "none";
}

/**
 * Writes the minimum override needed to reach `target` on one page.
 *
 * Two rules do the work:
 *
 *   1. Never store an override that agrees with the role. If the role already
 *      grants read and you ask for read, the row is deleted, not written as a
 *      redundant grant. Redundant rows are how an override list becomes
 *      unreadable, and they silently stop tracking the role if it later
 *      changes.
 *
 *   2. The effective set keeps the same invariant as a role: no write without
 *      read. Asking for write on a page the role does not grant produces TWO
 *      grants, not one.
 */
export function setPageAccess(
  baseline: ReadonlySet<string>,
  overrides: Overrides,
  slug: string,
  target: PageAccess
): Map<string, boolean> {
  const next = new Map(overrides);
  const r = readKey(slug);
  const w = writeKey(slug);

  /** Force one key to a value, or drop the row when the role already agrees. */
  const force = (key: string, want: boolean) => {
    if (baseline.has(key) === want) next.delete(key);
    else next.set(key, want);
  };

  switch (target) {
    case "none":
      force(r, false);
      force(w, false);
      break;
    case "read":
      force(r, true);
      force(w, false);
      break;
    case "write":
      force(r, true); // write implies read, in the effective set too
      force(w, true);
      break;
  }
  return next;
}

/**
 * Read/Write checkbox behaviour, matching the role matrix so an operator does
 * not have to learn two interaction models for two grids that look alike.
 */
export function toggleRead(
  baseline: ReadonlySet<string>,
  overrides: Overrides,
  slug: string
): Map<string, boolean> {
  const on = effectivePageAccess(baseline, overrides, slug) !== "none";
  return setPageAccess(baseline, overrides, slug, on ? "none" : "read");
}

export function toggleWrite(
  baseline: ReadonlySet<string>,
  overrides: Overrides,
  slug: string
): Map<string, boolean> {
  const isWrite = effectivePageAccess(baseline, overrides, slug) === "write";
  return setPageAccess(baseline, overrides, slug, isWrite ? "read" : "write");
}

/** Drops every override on one page — the row returns to following the role. */
export function resetPage(overrides: Overrides, slug: string): Map<string, boolean> {
  const next = new Map(overrides);
  next.delete(readKey(slug));
  next.delete(writeKey(slug));
  return next;
}

// ════════════════════════════════════════════════════════════════════
// Summary
// ════════════════════════════════════════════════════════════════════

export type OverrideSummary = {
  grants: number;
  revokes: number;
  /** Pages carrying any explicit decision — the "N exceptions" headline. */
  pages: number;
};

export function summarise(
  overrides: Overrides,
  pages: readonly AdminPage[]
): OverrideSummary {
  let grants = 0;
  let revokes = 0;
  for (const granted of overrides.values()) {
    if (granted) grants++;
    else revokes++;
  }
  const touched = pages.filter(
    (p) => overrides.has(readKey(p.slug)) || overrides.has(writeKey(p.slug))
  ).length;
  return { grants, revokes, pages: touched };
}

/** True when this page departs from its role — drives the row marker. */
export function pageIsOverridden(overrides: Overrides, slug: string): boolean {
  return overrides.has(readKey(slug)) || overrides.has(writeKey(slug));
}

// ════════════════════════════════════════════════════════════════════
// Redundancy
// ════════════════════════════════════════════════════════════════════

/**
 * Overrides that AGREE with the role, and therefore change nothing.
 *
 * A grant for a key the role already grants, or a revoke for one it never
 * granted. Harmless today; harmful later, because the user has silently
 * stopped tracking the role — edit the role and this one account keeps its
 * frozen copy. Five of six Operations holders in production carry a
 * redundant `students.read` grant for exactly this reason.
 *
 * The editor never WRITES one (`setPageAccess` deletes the row when the role
 * agrees), but rows written before it existed are still there, so it must
 * also be able to find them.
 */
export function redundantOverrides(
  baseline: ReadonlySet<string>,
  overrides: Overrides
): string[] {
  return [...overrides]
    .filter(([key, granted]) => baseline.has(key) === granted)
    .map(([key]) => key)
    .sort();
}

/** The same map with every redundant row removed. */
export function withoutRedundant(
  baseline: ReadonlySet<string>,
  overrides: Overrides
): Map<string, boolean> {
  const next = new Map(overrides);
  for (const key of redundantOverrides(baseline, overrides)) next.delete(key);
  return next;
}

// ════════════════════════════════════════════════════════════════════
// Wire format
// ════════════════════════════════════════════════════════════════════

export type OverridePayload = { grants: string[]; revokes: string[] };

/**
 * The shape `PATCH /api/admin/users/[id]/permissions` expects. That endpoint
 * rejects a key appearing in both lists, which cannot happen here — a Map has
 * one value per key — but the split is what it wants, so this is where the
 * translation lives rather than inline in a fetch call.
 */
export function toPayload(overrides: Overrides): OverridePayload {
  const grants: string[] = [];
  const revokes: string[] = [];
  for (const [key, granted] of overrides) {
    (granted ? grants : revokes).push(key);
  }
  return { grants: grants.sort(), revokes: revokes.sort() };
}

export function fromRows(
  rows: readonly { permission: string; granted: boolean }[]
): Map<string, boolean> {
  return new Map(rows.map((r) => [r.permission, r.granted]));
}

/** How many override rows differ from what was last saved. */
export function overrideDiffCount(original: Overrides, current: Overrides): number {
  const keys = new Set([...original.keys(), ...current.keys()]);
  let n = 0;
  for (const k of keys) {
    if (cellStateEq(original, current, k)) continue;
    n++;
  }
  return n;
}

function cellStateEq(a: Overrides, b: Overrides, key: string): boolean {
  return a.has(key) === b.has(key) && a.get(key) === b.get(key);
}
