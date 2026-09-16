"use client";

/**
 * Per-user access overrides.
 *
 * The role matrix answers "what can this ROLE do". This answers a different
 * question — "where does this PERSON differ from their role" — and the
 * difference drives the whole layout.
 *
 * ── The column that makes it legible ────────────────────────────────────
 * Every row shows what the role gives BEFORE showing what the user ends up
 * with. Without that column an operator reading a ticked box cannot tell
 * whether they are looking at an inherited permission or an exception someone
 * granted last March, which is the one thing an access review needs to know.
 *
 * So each row reads left to right as a sentence: this page — the role gives
 * you this — you actually get this — and here is why it differs.
 *
 * ── Exceptions are visible, not implied ─────────────────────────────────
 * A checkbox that departs from the role is ringed and the row is tinted:
 * green where the user has MORE than the role, amber where they have LESS.
 * A clean inheritor shows no colour at all, so a user with three exceptions
 * is three coloured rows in an otherwise plain table.
 *
 * The algebra is in `lib/admin-access-view.ts` with 25 unit tests. This
 * component renders it and talks to the API; it decides nothing.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, Minus, Plus, RotateCcw, Save, Search } from "lucide-react";
import {
  Button,
  Card,
  Checkbox,
  Td,
  Th,
} from "@/components/admin/ui/primitives";
import { ConfirmDialog } from "@/components/admin/ui/dialog";
import { readKey, writeKey, type AdminPage } from "@/lib/admin-permissions";
import { groupPages } from "@/lib/admin-roles-view";
import {
  baselinePageAccess,
  cellState,
  effectivePageAccess,
  fromRows,
  overrideDiffCount,
  pageIsOverridden,
  redundantOverrides,
  resetPage,
  withoutRedundant,
  summarise,
  toPayload,
  toggleRead,
  toggleWrite,
  type Overrides,
  type PageAccess,
} from "@/lib/admin-access-view";
import { cn } from "@/lib/cn";

export type AccessUser = {
  id: string;
  email: string;
  name: string | null;
  roleName: string;
  isSelf: boolean;
};

const ACCESS_LABEL: Record<PageAccess, string> = {
  none: "No access",
  read: "Read",
  write: "Read & write",
};

/** How the role's own level reads in the baseline column. */
function BaselineCell({ level }: { level: PageAccess }) {
  return (
    <span
      className={cn(
        "text-[11.5px]",
        level === "none" ? "text-ink-300" : "text-ink-500"
      )}
    >
      {ACCESS_LABEL[level]}
    </span>
  );
}

/**
 * A checkbox that also says WHY it is in the state it is in. The ring is the
 * only thing distinguishing an exception from an inherited value, so it is
 * doubled by a title — colour alone is not an accessible signal.
 */
function OverrideBox({
  checked,
  state,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  state: "inherit" | "grant" | "revoke";
  disabled?: boolean;
  label: string;
  onChange: () => void;
}) {
  const title =
    state === "grant"
      ? "Explicitly granted to this user, on top of their role"
      : state === "revoke"
        ? "Explicitly revoked from this user, despite their role"
        : "Inherited from the role";

  return (
    <span
      title={title}
      className={cn(
        "inline-grid place-items-center rounded-md p-0.5 ring-2 transition-colors",
        state === "grant"
          ? "ring-emerald-400 bg-emerald-50"
          : state === "revoke"
            ? "ring-amber-400 bg-amber-50"
            : "ring-transparent"
      )}
    >
      <Checkbox checked={checked} disabled={disabled} onChange={onChange} aria-label={`${label} — ${title}`} />
    </span>
  );
}

export function AccessMatrix({
  user,
  pages,
  groups,
  baseline,
  savedOverrides,
  canWrite,
}: {
  user: AccessUser;
  pages: AdminPage[];
  groups: string[];
  /** The role's permission keys — what the user inherits. */
  baseline: string[];
  savedOverrides: { permission: string; granted: boolean }[];
  canWrite: boolean;
}) {
  const router = useRouter();

  const base = React.useMemo(() => new Set(baseline), [baseline]);
  const original = React.useMemo(() => fromRows(savedOverrides), [savedOverrides]);

  const [overrides, setOverrides] = React.useState<Overrides>(original);
  const [query, setQuery] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);
  const [confirmReset, setConfirmReset] = React.useState(false);

  React.useEffect(() => setOverrides(original), [original]);

  /**
   * The API refuses a super-admin editing their own overrides — revoking your
   * own access is how an install ends up with nobody able to fix it. Disabled
   * here with the reason, rather than left to fail on save.
   */
  const locked = !canWrite || user.isSelf;

  const changes = overrideDiffCount(original, overrides);
  const summary = summarise(overrides, pages);
  const redundant = redundantOverrides(base, overrides);
  const visible = groupPages(pages, groups, query);

  React.useEffect(() => {
    if (changes === 0) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [changes]);

  const apply = (fn: (cur: Overrides) => Map<string, boolean>) => {
    if (locked) return;
    setSaved(false);
    setOverrides((cur) => fn(cur));
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${user.id}/permissions`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toPayload(overrides)),
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

  return (
    <div className="space-y-4">
      {/* ── Summary ──────────────────────────────────────────────────
          States the relationship in one line: what is inherited, and how many
          deliberate exceptions sit on top. */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-ink-100 bg-white px-4 py-2.5 text-[12.5px]">
        <span className="text-ink-600">
          Inherits from{" "}
          <span className="font-semibold text-ink-900">{user.roleName}</span>
        </span>
        <span className="inline-flex items-center gap-1.5 text-emerald-700">
          <Plus className="h-3 w-3" />
          <span className="font-semibold tabular-nums">{summary.grants}</span> extra grant
          {summary.grants === 1 ? "" : "s"}
        </span>
        <span className="inline-flex items-center gap-1.5 text-amber-700">
          <Minus className="h-3 w-3" />
          <span className="font-semibold tabular-nums">{summary.revokes}</span> revoke
          {summary.revokes === 1 ? "" : "s"}
        </span>
        <span className="text-ink-500">
          across <span className="font-semibold tabular-nums text-ink-800">{summary.pages}</span>{" "}
          page{summary.pages === 1 ? "" : "s"}
        </span>
      </div>

      {locked ? (
        <div className="rounded-xl border border-ink-100 bg-cream-50 px-4 py-2.5 text-[12.5px] text-ink-600">
          {user.isSelf
            ? "You cannot change your own access. Ask another administrator — this is what stops an account locking itself out."
            : "You have read-only access to permissions."}
        </div>
      ) : null}

      {/*
        Rows that agree with the role. Written by the old editor, which did
        not check; they do nothing today and freeze this user's copy of the
        role for tomorrow. One click removes them — as an unsaved change, so
        it can still be discarded.
      */}
      {redundant.length > 0 ? (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5">
          <p className="min-w-0 flex-1 text-[12.5px] leading-relaxed text-amber-900">
            <span className="font-semibold">
              {redundant.length} exception{redundant.length === 1 ? "" : "s"} agree
              {redundant.length === 1 ? "s" : ""} with the role and change
              {redundant.length === 1 ? "s" : ""} nothing.
            </span>{" "}
            <span className="font-mono text-[11.5px]">{redundant.join(", ")}</span> —
            harmless now, but this user stops following the role for{" "}
            {redundant.length === 1 ? "that page" : "those pages"} if the role is edited later.
          </p>
          {!locked ? (
            <Button size="sm" variant="secondary" onClick={() => apply((cur) => withoutRedundant(base, cur))}>
              Remove {redundant.length === 1 ? "it" : "them"}
            </Button>
          ) : null}
        </div>
      ) : null}

      {locked && error ? (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[12.5px] font-medium text-red-700">
          {error}
        </div>
      ) : null}

      <Card padded={false} className="overflow-hidden">
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
          {!locked && summary.pages > 0 ? (
            <Button
              size="sm"
              variant="ghost"
              icon={<RotateCcw className="h-3.5 w-3.5" />}
              onClick={() => apply(() => new Map())}
            >
              Clear all exceptions
            </Button>
          ) : null}
        </div>

        <div className="max-h-[min(58vh,640px)] overflow-auto">
          <table className="w-full border-collapse">
            <thead className="sticky top-0 z-10 bg-white shadow-[0_1px_0_rgba(10,10,10,0.08)]">
              <tr>
                <Th>Page</Th>
                <Th className="whitespace-nowrap">Role gives</Th>
                <Th right className="w-20">Read</Th>
                <Th right className="w-20">Write</Th>
                <Th right className="w-16" />
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-[13px] text-ink-500">
                    No page matches “{query}”.
                  </td>
                </tr>
              ) : (
                visible.map((group) => (
                  <React.Fragment key={group.name}>
                    <tr className="border-t border-ink-100 bg-cream-50/70">
                      <th
                        scope="colgroup"
                        colSpan={5}
                        className="px-4 py-1.5 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-600"
                      >
                        {group.name}
                      </th>
                    </tr>
                    {group.pages.map((p) => {
                      const roleLevel = baselinePageAccess(base, p.slug);
                      const effective = effectivePageAccess(base, overrides, p.slug);
                      const rState = cellState(overrides, readKey(p.slug));
                      const wState = cellState(overrides, writeKey(p.slug));
                      const overridden = pageIsOverridden(overrides, p.slug);
                      // More than the role, or less? Tints the row accordingly.
                      const more =
                        overridden &&
                        ["none", "read", "write"].indexOf(effective) >
                          ["none", "read", "write"].indexOf(roleLevel);

                      return (
                        <tr
                          key={p.slug}
                          className={cn(
                            "border-t border-ink-100/60 transition-colors",
                            !overridden && "hover:bg-cream-50/60",
                            overridden && more && "bg-emerald-50/40",
                            overridden && !more && "bg-amber-50/40"
                          )}
                        >
                          <Td>
                            <span className="flex items-center gap-2">
                              <span className="text-[13px] text-ink-800">{p.label}</span>
                              <span className="font-mono text-[10.5px] text-ink-300">
                                {p.slug}
                              </span>
                            </span>
                          </Td>
                          <Td>
                            <BaselineCell level={roleLevel} />
                          </Td>
                          <Td right>
                            <div className="flex justify-end">
                              <OverrideBox
                                checked={effective !== "none"}
                                state={rState}
                                disabled={locked}
                                label={`Read access to ${p.label}`}
                                onChange={() => apply((cur) => toggleRead(base, cur, p.slug))}
                              />
                            </div>
                          </Td>
                          <Td right>
                            <div className="flex justify-end">
                              <OverrideBox
                                checked={effective === "write"}
                                state={wState}
                                disabled={locked}
                                label={`Write access to ${p.label}`}
                                onChange={() => apply((cur) => toggleWrite(base, cur, p.slug))}
                              />
                            </div>
                          </Td>
                          <Td right>
                            {/* Per-row escape hatch: put this page back to
                                following the role without hunting for which
                                of the two boxes was the exception. */}
                            {overridden && !locked ? (
                              <button
                                type="button"
                                onClick={() => apply((cur) => resetPage(cur, p.slug))}
                                title="Reset this page to follow the role"
                                className="rounded px-1.5 py-0.5 text-[11px] font-semibold text-ink-500 hover:bg-ink-100 hover:text-ink-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
                              >
                                Reset
                              </button>
                            ) : null}
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

      {!locked ? (
        <div className="sticky bottom-0 z-20 -mx-4 border-t border-ink-100 bg-white/95 px-4 py-3 backdrop-blur lg:-mx-6 lg:px-6">
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1 text-[12.5px]">
              {error ? (
                <span role="alert" className="font-medium text-red-600">
                  {error}
                </span>
              ) : changes > 0 ? (
                <span className="text-ink-600">
                  <span className="font-semibold text-ink-900">
                    {changes} exception{changes === 1 ? "" : "s"} changed
                  </span>
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
            {changes > 0 ? (
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
            <Button icon={<Save className="h-3.5 w-3.5" />} onClick={save} busy={busy} disabled={changes === 0}>
              {changes > 0 ? `Save ${changes} change${changes === 1 ? "" : "s"}` : "Save"}
            </Button>
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        onConfirm={() => {
          setOverrides(original);
          setError(null);
          setConfirmReset(false);
        }}
        title="Discard changes?"
        description={`${changes} unsaved exception${changes === 1 ? "" : "s"} will be reverted to the last saved state.`}
        confirmLabel="Discard"
      />
    </div>
  );
}
