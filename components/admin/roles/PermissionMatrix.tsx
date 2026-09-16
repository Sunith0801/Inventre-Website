"use client";

/**
 * The permission matrix — the screen where a role is actually configured.
 *
 * ── What it replaces ────────────────────────────────────────────────────
 * A three-column masonry of 13 bordered cards, each holding a bullet list of
 * pages with two unlabelled "R" / "W" checkboxes. To answer "can this role
 * edit purchase orders?" you had to find the right card by eye, because
 * nothing was aligned to anything. There was no search over the 37 pages, no
 * indication of what you had changed, and navigating away lost the lot in
 * silence.
 *
 * This is one table. Two fixed columns mean every checkbox for Read sits in
 * the same place on every row, which is the entire reason a matrix is a
 * matrix. Groups are header rows inside it rather than separate containers,
 * so the columns stay aligned across the whole registry.
 *
 * ── The three states a row can be in ────────────────────────────────────
 *   none   neither box
 *   read   Read only
 *   write  both — write implies read, enforced by the algebra, not the UI
 *
 * All of that logic lives in `lib/admin-roles-view.ts` and is unit-tested.
 * This component renders it and talks to the API; it decides nothing.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, RotateCcw, Save, Search } from "lucide-react";
import {
  Button,
  Card,
  Checkbox,
  Field,
  Input,
  Td,
  Th,
  Textarea,
} from "@/components/admin/ui/primitives";
import { ConfirmDialog } from "@/components/admin/ui/dialog";
import { ADMIN_PERMISSION_KEYS, type AdminPage } from "@/lib/admin-permissions";
import {
  groupLevel,
  groupPages,
  missingGrants,
  nextGroupLevel,
  orphanGrants,
  pageChanged,
  pageLevel,
  permissionDiff,
  permissionLevel,
  roleCoverage,
  setGroupLevel,
  toggleRead,
  toggleWrite,
  type GroupLevel,
} from "@/lib/admin-roles-view";
import { CoverageMeter, PermissionLevelBadge } from "./presentation";
import { cn } from "@/lib/cn";

export type MatrixRole = {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  isSuperAdmin: boolean;
  userCount: number;
  permissions: string[];
};

// ════════════════════════════════════════════════════════════════════
// Group header
// ════════════════════════════════════════════════════════════════════

const GROUP_HINT: Record<GroupLevel, string> = {
  none: "No access — click for read",
  read: "Read only — click for write",
  write: "Read & write — click to clear",
  mixed: "Mixed — click to set all to read",
};

function GroupRow({
  name,
  pages,
  perms,
  locked,
  onCycle,
}: {
  name: string;
  pages: AdminPage[];
  perms: ReadonlySet<string>;
  locked: boolean;
  onCycle: () => void;
}) {
  const level = groupLevel(perms, pages);
  const reads = pages.filter((p) => pageLevel(perms, p.slug) !== "none").length;
  const writes = pages.filter((p) => pageLevel(perms, p.slug) === "write").length;

  return (
    <tr className="border-t border-ink-100 bg-cream-50/70">
      <th scope="colgroup" className="px-4 py-1.5 text-left">
        <button
          type="button"
          onClick={onCycle}
          disabled={locked}
          title={locked ? undefined : GROUP_HINT[level]}
          className={cn(
            "inline-flex items-center gap-2 rounded text-[11px] font-semibold uppercase tracking-[0.08em]",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300",
            locked ? "cursor-default text-ink-500" : "text-ink-600 hover:text-ink-900"
          )}
        >
          {name}
          <span className="font-mono text-[10px] normal-case tracking-normal text-ink-400">
            {reads}/{pages.length}
            {writes > 0 ? ` · ${writes}w` : ""}
          </span>
        </button>
      </th>
      <td colSpan={2} />
    </tr>
  );
}

// ════════════════════════════════════════════════════════════════════
// Matrix
// ════════════════════════════════════════════════════════════════════

export function PermissionMatrix({
  role,
  pages,
  groups,
  canWrite,
}: {
  role: MatrixRole;
  pages: AdminPage[];
  groups: string[];
  canWrite: boolean;
}) {
  const router = useRouter();

  // The saved state, held for the diff. Re-derived whenever the server sends
  // a new role (after a successful save + refresh).
  const original = React.useMemo(
    () => new Set(role.permissions),
    [role.permissions]
  );

  const [perms, setPerms] = React.useState<ReadonlySet<string>>(original);
  const [name, setName] = React.useState(role.name);
  const [description, setDescription] = React.useState(role.description ?? "");
  const [query, setQuery] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);
  const [confirmReset, setConfirmReset] = React.useState(false);

  React.useEffect(() => {
    setPerms(original);
    setName(role.name);
    setDescription(role.description ?? "");
  }, [original, role.name, role.description]);

  /**
   * Super Admin's set is forced to "everything" by the API on every write, so
   * editing it here would show a change that the server discards. The matrix
   * renders it as all-on and read-only instead of lying.
   */
  const locked = !canWrite || role.isSuperAdmin;

  const diff = permissionDiff(original, perms);
  const metaChanged =
    name.trim() !== role.name || description.trim() !== (role.description ?? "").trim();
  const dirty = diff.count > 0 || metaChanged;

  const coverage = roleCoverage(perms, pages);
  const orphans = orphanGrants(role.permissions);
  // Only meaningful for a role expected to hold everything.
  const missing = role.isSuperAdmin ? missingGrants(perms) : [];
  const visible = groupPages(pages, groups, query);

  // ── Unsaved-changes guard ──────────────────────────────────────────
  // Covers reload, tab close and external navigation. In-app navigation via
  // next/link cannot be intercepted from here in the App Router, which is why
  // the save bar stays pinned and states the count — the visible reminder is
  // the part that actually works for every exit route.
  React.useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  // ── Mutations ──────────────────────────────────────────────────────

  const apply = (fn: (cur: ReadonlySet<string>) => Set<string>) => {
    if (locked) return;
    setSaved(false);
    setPerms((cur) => fn(cur));
  };

  /**
   * Writes the whole registry to this role. Used only to repair Super Admin:
   * the endpoint already forces the full set for that slug, so this is the
   * operator-visible way to trigger what the API would do anyway.
   */
  const grantAll = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/roles/${role.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ permissions: [...ADMIN_PERMISSION_KEYS] }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        setError(d.error ?? `Could not update the role (${res.status}).`);
        return;
      }
      router.refresh();
    } catch {
      setError("Network error — nothing was saved.");
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/roles/${role.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          // Orphans are dropped on every save: the endpoint validates each key
          // against the registry and would reject the whole request otherwise.
          permissions: [...perms].filter((k) => !orphanGrants([k]).length),
        }),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        setError(d.error ?? `Save failed (${res.status}).`);
        return;
      }
      setSaved(true);
      router.refresh();
    } catch {
      setError("Network error — nothing was saved.");
    } finally {
      setBusy(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* ── Identity ─────────────────────────────────────────────── */}
      <Card>
        <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr]">
          <Field label="Role name" htmlFor="role-name" required>
            <Input
              id="role-name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setSaved(false);
              }}
              disabled={!canWrite}
              invalid={Boolean(error) && !name.trim()}
            />
          </Field>
          <Field
            label="Description"
            htmlFor="role-description"
          >
            <Textarea
              id="role-description"
              rows={2}
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
                setSaved(false);
              }}
              disabled={!canWrite}
              placeholder="e.g. Handles day-to-day order dispatch across all schools."
            />
          </Field>
        </div>
      </Card>

      {/* ── Drift notice ─────────────────────────────────────────── */}
      {orphans.length > 0 ? (
        <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <div className="text-[12.5px] leading-relaxed text-amber-900">
            <span className="font-semibold">
              {orphans.length} stale grant{orphans.length === 1 ? "" : "s"} on this role.
            </span>{" "}
            <span className="font-mono text-[11.5px]">{orphans.join(", ")}</span> —{" "}
            {orphans.length === 1 ? "this key names" : "these keys name"} a page that no
            longer exists, so {orphans.length === 1 ? "it grants" : "they grant"} nothing.
            Saving this role removes {orphans.length === 1 ? "it" : "them"}.
          </div>
        </div>
      ) : null}

      {/* The save bar carries errors for an editable role, but it is not
          rendered for a locked one — so a failed "Grant all" needs somewhere
          of its own to be seen. */}
      {locked && error ? (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[12.5px] font-medium text-red-700"
        >
          {error}
        </div>
      ) : null}

      {/* ── Matrix ───────────────────────────────────────────────── */}
      <Card padded={false} className="overflow-hidden">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2 border-b border-ink-100 px-4 py-2.5">
          <div className="relative min-w-[180px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-400" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Filter ${pages.length} pages…`}
              aria-label="Filter pages"
              className="h-8 w-full rounded-lg border border-ink-100 bg-cream-50 pl-9 pr-3 text-[12.5px] placeholder:text-ink-400 focus:border-ink-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-300/40"
            />
          </div>

          {!locked ? (
            <>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => apply((cur) => setGroupLevel(cur, pages, "read"))}
              >
                All read
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => apply(() => new Set())}
              >
                Clear all
              </Button>
            </>
          ) : null}

          <div className="ml-auto flex items-center gap-3">
            <PermissionLevelBadge level={permissionLevel(perms, pages)} />
            <CoverageMeter coverage={coverage} />
          </div>
        </div>

        {locked ? (
          <div className="border-b border-ink-100 bg-cream-50/60 px-4 py-2 text-[12px] text-ink-600">
            {role.isSuperAdmin
              ? "Super Admin is forced to the full permission set every time it is saved, so its boxes are not editable here."
              : "You have read-only access to roles."}
          </div>
        ) : null}

        {/*
          Super Admin is SUPPOSED to hold every registry key, but the seed and
          the registry drift apart as pages are added — this role is currently
          short of the full set, and nothing else in the panel says so. The
          checkboxes above show the real stored state; this repairs it.
        */}
        {role.isSuperAdmin && missing.length > 0 ? (
          <div className="flex flex-wrap items-center gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2.5">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
            <p className="min-w-0 flex-1 text-[12.5px] leading-relaxed text-amber-900">
              <span className="font-semibold">
                Missing {missing.length} of {ADMIN_PERMISSION_KEYS.size} permissions.
              </span>{" "}
              <span className="font-mono text-[11.5px]">{missing.join(", ")}</span> —
              added to the registry after this role was seeded, so Super Admin does not
              currently hold {missing.length === 1 ? "it" : "them"}.
            </p>
            {canWrite ? (
              <Button size="sm" onClick={grantAll} busy={busy}>
                Grant all
              </Button>
            ) : null}
          </div>
        ) : null}

        {/* The table. Sticky header needs a scrolling ancestor with a height
            bound, which the max-height here supplies. */}
        <div className="max-h-[min(58vh,640px)] overflow-auto">
          <table className="w-full border-collapse">
            <thead className="sticky top-0 z-10 bg-white shadow-[0_1px_0_rgba(10,10,10,0.08)]">
              <tr>
                <Th>Page</Th>
                <Th right className="w-20 whitespace-nowrap">Read</Th>
                <Th right className="w-20 whitespace-nowrap">Write</Th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-4 py-10 text-center text-[13px] text-ink-500">
                    No page matches “{query}”.
                  </td>
                </tr>
              ) : (
                visible.map((group) => (
                  <React.Fragment key={group.name}>
                    <GroupRow
                      name={group.name}
                      pages={group.pages}
                      perms={perms}
                      locked={locked}
                      onCycle={() =>
                        apply((cur) =>
                          setGroupLevel(
                            cur,
                            group.pages,
                            nextGroupLevel(groupLevel(cur, group.pages))
                          )
                        )
                      }
                    />
                    {group.pages.map((p) => {
                      // The real stored level, including for Super Admin.
                      // Rendering that role as all-on would hide exactly the
                      // drift this screen exists to reveal.
                      const level = pageLevel(perms, p.slug);
                      const changed = pageChanged(original, perms, p.slug);
                      return (
                        <tr
                          key={p.slug}
                          className={cn(
                            "border-t border-ink-100/60 transition-colors",
                            changed ? "bg-brand-50/40" : "hover:bg-cream-50/60"
                          )}
                        >
                          <Td>
                            <span className="flex items-center gap-2">
                              {/* An unsaved row is marked, so a long edit
                                  session can be reviewed before saving. */}
                              <span
                                className={cn(
                                  "h-1.5 w-1.5 shrink-0 rounded-full",
                                  changed ? "bg-brand" : "bg-transparent"
                                )}
                                aria-hidden="true"
                              />
                              <span className="text-[13px] text-ink-800">{p.label}</span>
                              <span className="font-mono text-[10.5px] text-ink-300">
                                {p.slug}
                              </span>
                            </span>
                          </Td>
                          <Td right>
                            <div className="flex justify-end">
                              <Checkbox
                                checked={level !== "none"}
                                disabled={locked}
                                onChange={() => apply((cur) => toggleRead(cur, p.slug))}
                                aria-label={`Read access to ${p.label}`}
                              />
                            </div>
                          </Td>
                          <Td right>
                            <div className="flex justify-end">
                              <Checkbox
                                checked={level === "write"}
                                disabled={locked}
                                onChange={() => apply((cur) => toggleWrite(cur, p.slug))}
                                aria-label={`Write access to ${p.label}`}
                              />
                            </div>
                          </Td>
                        </tr>
                      );
                    })}
                  </React.Fragment>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* ── Save bar ─────────────────────────────────────────────────
          Pinned rather than parked at the bottom of the document: the matrix
          scrolls, and a save button you have to scroll to find is a save
          button that gets forgotten with changes pending. */}
      {!locked ? (
        <div className="sticky bottom-0 z-20 -mx-4 border-t border-ink-100 bg-white/95 px-4 py-3 backdrop-blur lg:-mx-6 lg:px-6">
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1 text-[12.5px]">
              {error ? (
                <span role="alert" className="font-medium text-red-600">
                  {error}
                </span>
              ) : dirty ? (
                <span className="text-ink-600">
                  <span className="font-semibold text-ink-900">
                    {diff.count > 0
                      ? `${diff.count} permission change${diff.count === 1 ? "" : "s"}`
                      : "Details edited"}
                  </span>
                  {diff.added.length > 0 ? (
                    <span className="text-emerald-700"> · +{diff.added.length} granted</span>
                  ) : null}
                  {diff.removed.length > 0 ? (
                    <span className="text-red-600"> · −{diff.removed.length} revoked</span>
                  ) : null}
                  <span className="text-ink-400"> · not saved yet</span>
                </span>
              ) : saved ? (
                <span className="inline-flex items-center gap-1.5 font-medium text-emerald-700">
                  <Check className="h-3.5 w-3.5" /> Saved
                </span>
              ) : (
                <span className="text-ink-400">No changes</span>
              )}
            </div>

            {dirty ? (
              <Button
                variant="ghost"
                size="sm"
                icon={<RotateCcw className="h-3.5 w-3.5" />}
                onClick={() => setConfirmReset(true)}
                disabled={busy}
              >
                Discard
              </Button>
            ) : null}
            <Button
              icon={<Save className="h-3.5 w-3.5" />}
              onClick={save}
              busy={busy}
              disabled={!dirty}
            >
              {diff.count > 0 ? `Save ${diff.count} change${diff.count === 1 ? "" : "s"}` : "Save"}
            </Button>
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        onConfirm={() => {
          setPerms(original);
          setName(role.name);
          setDescription(role.description ?? "");
          setError(null);
          setConfirmReset(false);
        }}
        title="Discard changes?"
        description={
          diff.count > 0
            ? `${diff.count} unsaved permission change${diff.count === 1 ? "" : "s"} will be reverted to the last saved state.`
            : "Unsaved edits will be reverted to the last saved state."
        }
        confirmLabel="Discard"
      />
    </div>
  );
}
