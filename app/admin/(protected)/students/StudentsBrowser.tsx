"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  GraduationCap,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Search,
  Download,
  Lock,
  Unlock,
} from "lucide-react";
import {
  Card,
  Th,
  Td,
  Tr,
  Badge,
  EmptyState,
  Toolbar,
} from "@/components/admin/ui/primitives";
import { cn } from "@/lib/cn";
import { STUDENTS_PAGE_SIZE as PAGE_SIZE } from "./_constants";

export type StudentRow = {
  id: string;
  erpName: string | null;
  enabled: boolean;
  enrollmentNumber: string | null;
  // School-side "reference / admission" code from MCB (e.g. AW250526
  // at SMS schools). Shown alongside enrollment so admins searching by
  // either number can recognise the row.
  referenceCode?: string | null;
  firstName: string | null;
  lastName: string | null;
  grade: string | null;
  // School's own grade label resolved via school_grade_mappings (e.g.
  // "Nursery"/"JKG"/"1"/"12" for TSUSC and CAS schools). Null when the
  // school has no mapping configured — UI falls back to `grade`.
  displayGrade?: string | null;
  section: string | null;
  schoolCode: string | null;
  isVerified: boolean;
  isNewStudent: boolean;
  joiningDate: string | null;
  verifiedAt?: string | Date | null;
  parentPhone?: string | null;
  parentLastLoginAt?: string | Date | null;
  /** Most recent storefront activity for this student — defined as the
   *  greatest of (last order placed by this student, parent's last
   *  successful login). Null when neither signal exists. */
  lastActiveAt?: string | Date | null;
  mcbAccessGranted?: boolean;
};

// Format a timestamp as IST (Asia/Kolkata) "dd MMM yyyy, HH:mm" — used
// for the Verified and Last-login admin columns. Server sends a
// Postgres timestamptz; we display in the school's local zone.
function fmtIST(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

type Filters = {
  q: string;
  schoolCode: string;
  grade: string;
  enabled: string;
  verified: string;
  newStudent: string;
  recent: string;
  page: number;
};

type FetchResult = {
  rows: StudentRow[];
  total: number;
  page: number;
  lastPage: number;
};

const DEBOUNCE_MS = 300;

export function StudentsBrowser({
  initial,
  schoolList,
  gradeList,
  gradesBySchool,
  lockedSchoolCode,
}: {
  initial: FetchResult & { filters: Filters };
  schoolList: { code: string | null; name: string | null }[];
  gradeList: { name: string | null }[];
  gradesBySchool: Record<string, string[]>;
  /** When set (school_admin), the school select is locked to this code. */
  lockedSchoolCode: string | null;
}) {
  const [filters, setFilters] = useState<Filters>(initial.filters);
  const [rows, setRows] = useState<StudentRow[]>(initial.rows);
  const [total, setTotal] = useState(initial.total);
  const [lastPage, setLastPage] = useState(initial.lastPage);
  const [busy, setBusy] = useState(false);

  // Skip the very first effect run — we already have SSR data for the
  // initial filters; refetching would be a wasted roundtrip and a flicker.
  const isFirst = useRef(true);
  const reqSeq = useRef(0);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Build the search-params string for a given filter set (used for both
  // the fetch and the URL sync).
  const buildQs = (f: Filters) => {
    const sp = new URLSearchParams();
    if (f.q) sp.set("q", f.q);
    if (f.schoolCode) sp.set("schoolCode", f.schoolCode);
    if (f.grade) sp.set("grade", f.grade);
    if (f.enabled) sp.set("enabled", f.enabled);
    if (f.verified) sp.set("verified", f.verified);
    if (f.newStudent) sp.set("newStudent", f.newStudent);
    if (f.recent) sp.set("recent", f.recent);
    if (f.page > 1) sp.set("page", String(f.page));
    return sp.toString();
  };

  // Debounced text input changes vs. immediate select changes are handled
  // by the caller (text uses `setFilterDebounced`, selects use `setFilter`).
  useEffect(() => {
    if (isFirst.current) {
      isFirst.current = false;
      return;
    }
    const seq = ++reqSeq.current;
    const qs = buildQs(filters);
    setBusy(true);
    fetch(`/api/admin/students?${qs}`, { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error(`Search failed (${r.status})`);
        return (await r.json()) as FetchResult;
      })
      .then((data) => {
        if (seq !== reqSeq.current) return;
        setRows(data.rows);
        setTotal(data.total);
        setLastPage(data.lastPage);
      })
      .catch(() => {
        if (seq !== reqSeq.current) return;
      })
      .finally(() => {
        if (seq === reqSeq.current) setBusy(false);
      });

    // Keep the URL in sync for reload/share/back-button — but bypass
    // Next.js router so we DON'T trigger a Server Component re-fetch on
    // every keystroke. router.replace() (even inside startTransition) was
    // burning ~200 ms per change re-rendering the PageHeader + school +
    // grade dropdowns, which is what made this page feel laggy.
    if (typeof window !== "undefined") {
      const next = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
      if (window.location.pathname + window.location.search !== next) {
        window.history.replaceState({}, "", next);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  // Back / forward — re-read the URL filters and apply. Only triggered by
  // browser navigation buttons; in-app filter changes use history.replaceState
  // above and don't fire popstate.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onPop = () => {
      const sp = new URLSearchParams(window.location.search);
      setFilters({
        q: sp.get("q") ?? "",
        schoolCode: sp.get("schoolCode") ?? "",
        grade: sp.get("grade") ?? "",
        enabled: sp.get("enabled") ?? "",
        verified: sp.get("verified") ?? "",
        newStudent: sp.get("newStudent") ?? "",
        recent: sp.get("recent") ?? "",
        page: Math.max(1, Number(sp.get("page") ?? "1") || 1),
      });
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const setFilter = (patch: Partial<Filters>) => {
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
      debounceTimer.current = null;
    }
    setFilters((prev) => ({ ...prev, page: 1, ...patch }));
  };

  const setQDebounced = (q: string) => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      setFilters((prev) => ({ ...prev, q, page: 1 }));
    }, DEBOUNCE_MS);
  };

  const goPage = (p: number) => setFilters((prev) => ({ ...prev, page: p }));

  const offset = (filters.page - 1) * PAGE_SIZE;
  const showingTo = Math.min(offset + rows.length, total);

  // Bulk new-student action — always available, scoped to whatever the
  // current filter set matches. Safety comes from the confirm modal
  // showing the exact match count (and an extra heads-up for >1000).
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkMsg, setBulkMsg] = useState<string | null>(null);
  const runBulkSetNew = async (isNewStudent: boolean) => {
    if (total === 0) return;
    const verb = isNewStudent ? "Mark" : "Unmark";
    const noun = `student${total === 1 ? "" : "s"}`;
    const big = total > 1000
      ? `\n\nThis will affect ${total.toLocaleString()} ${noun} — much larger than usual. Narrow the filters first if that's not intended.`
      : "";
    if (!window.confirm(
      `${verb} all ${total.toLocaleString()} filtered ${noun} as New?${big}`,
    )) return;
    setBulkBusy(true);
    setBulkMsg(null);
    try {
      const r = await fetch("/api/admin/students/bulk-set-new", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          isNewStudent,
          filters: {
            q: filters.q || undefined,
            schoolCode: filters.schoolCode || undefined,
            grade: filters.grade || undefined,
            enabled: filters.enabled || undefined,
            verified: filters.verified || undefined,
            newStudent: filters.newStudent || undefined,
            recent: filters.recent || undefined,
          },
        }),
      });
      const data = (await r.json().catch(() => null)) as
        | { updated: number }
        | { error: string }
        | null;
      if (!r.ok || !data || "error" in data) {
        setBulkMsg(
          (data && "error" in data ? data.error : null) ?? `Failed (HTTP ${r.status})`,
        );
      } else {
        setBulkMsg(`Updated ${data.updated.toLocaleString()} student${data.updated === 1 ? "" : "s"}.`);
        // Force a refetch with the current filters so the table reflects
        // the new isNewStudent values.
        setFilters((prev) => ({ ...prev }));
      }
    } catch (e) {
      setBulkMsg(e instanceof Error ? e.message : "Network error");
    } finally {
      setBulkBusy(false);
    }
  };

  // ── Website access ────────────────────────────────────────────────
  // ONE master switch. Closing does both halves in a single call — turns
  // every student off (that's the actual gate: lib/session.ts only shows
  // enabled + active students) AND puts up the "Website Access is
  // Currently Closed" screen. Re-opening restores only the students the
  // closure turned off, never the ones disabled by hand beforehand.
  // The per-filter buttons live under Advanced for surgical lockouts.
  const [accessClosed, setAccessClosed] = useState<boolean | null>(null);
  const [accessBusy, setAccessBusy] = useState(false);
  const [accessMsg, setAccessMsg] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch("/api/admin/site-closure");
        if (!r.ok) return;
        const d = (await r.json()) as { closed?: boolean };
        if (alive) setAccessClosed(!!d.closed);
      } catch {
        // Leave it null — the switch renders as "checking" rather than
        // claiming the site is open when we couldn't read the flag.
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const toggleSite = async (next: boolean) => {
    if (
      next &&
      !window.confirm(
        "Close the website for ALL parents?\n\n" +
          "Every student is switched off and parents see the “Website " +
          "Access is Currently Closed” screen. Orders already placed are " +
          "unaffected.\n\nRe-opening restores exactly these students.",
      )
    )
      return;
    if (next) {
      const typed = window.prompt("Type CLOSE to shut the website.");
      if (typed?.trim().toUpperCase() !== "CLOSE") return;
    }
    setAccessBusy(true);
    setAccessMsg(null);
    try {
      const r = await fetch("/api/admin/site-closure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ closed: next }),
      });
      const d = (await r.json().catch(() => null)) as
        | { updated: number }
        | { error: string }
        | null;
      if (!r.ok || !d || "error" in d) {
        setAccessMsg(
          (d && "error" in d ? d.error : null) ?? `Failed (HTTP ${r.status})`,
        );
        return;
      }
      setAccessClosed(next);
      setAccessMsg(
        next
          ? `Website closed — ${d.updated.toLocaleString()} students switched off.`
          : `Website open — ${d.updated.toLocaleString()} students restored.`,
      );
      setFilters((prev) => ({ ...prev }));
    } catch (e) {
      setAccessMsg(e instanceof Error ? e.message : "Network error");
    } finally {
      setAccessBusy(false);
    }
  };

  const runBulkSetEnabled = async (enabled: boolean) => {
    if (total === 0) return;
    const noun = `student${total === 1 ? "" : "s"}`;
    if (
      !window.confirm(
        `${enabled ? "Give" : "Remove"} website access ${enabled ? "to" : "from"} all ` +
          `${total.toLocaleString()} filtered ${noun}?\n\n` +
          (enabled
            ? "They will be able to sign in and shop again."
            : "They will no longer appear on the storefront for their parents. " +
              "Existing orders and deliveries are unaffected.") +
          "\n\nOnly students whose current state differs are touched.",
      )
    )
      return;
    // Anything past a thousand rows is a site-scale action — make the
    // caller type it out so a stray click can't shut the store.
    if (total > 1000) {
      const typed = window.prompt(
        `This affects ${total.toLocaleString()} ${noun}. Type CONFIRM to proceed.`,
      );
      if (typed?.trim().toUpperCase() !== "CONFIRM") return;
    }
    setBulkBusy(true);
    setBulkMsg(null);
    try {
      const r = await fetch("/api/admin/students/bulk-set-enabled", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled,
          filters: {
            q: filters.q || undefined,
            schoolCode: filters.schoolCode || undefined,
            grade: filters.grade || undefined,
            enabled: filters.enabled || undefined,
            verified: filters.verified || undefined,
            newStudent: filters.newStudent || undefined,
            recent: filters.recent || undefined,
          },
        }),
      });
      const data = (await r.json().catch(() => null)) as
        | { updated: number }
        | { error: string }
        | null;
      if (!r.ok || !data || "error" in data) {
        setBulkMsg(
          (data && "error" in data ? data.error : null) ?? `Failed (HTTP ${r.status})`,
        );
      } else {
        setBulkMsg(
          `${enabled ? "Enabled" : "Disabled"} ${data.updated.toLocaleString()} student${
            data.updated === 1 ? "" : "s"
          }.`,
        );
        setFilters((prev) => ({ ...prev }));
      }
    } catch (e) {
      setBulkMsg(e instanceof Error ? e.message : "Network error");
    } finally {
      setBulkBusy(false);
    }
  };

  const selectClass =
    "h-9 px-2.5 rounded-lg border border-ink-200 text-[13px] bg-white disabled:opacity-70 disabled:cursor-not-allowed";
  const navBtn =
    "inline-flex items-center justify-center h-8 w-8 border border-ink-200 rounded-lg hover:bg-cream-50 transition-colors";
  const navBtnDisabled =
    "inline-flex items-center justify-center h-8 w-8 border border-ink-100 rounded-lg text-ink-300 cursor-not-allowed";

  return (
    <div>
      <Toolbar>
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink-400 pointer-events-none" />
          <input
            type="search"
            defaultValue={filters.q}
            onChange={(e) => setQDebounced(e.target.value)}
            placeholder="Search by name, enrollment, email, mobile…"
            className="w-full h-9 pl-9 pr-3 text-[13px] rounded-lg bg-cream-50 border border-ink-100 placeholder:text-ink-400 focus:outline-none focus:bg-white focus:border-ink-300 focus:ring-2 focus:ring-brand-300/40 transition-[background,border,box-shadow]"
          />
        </div>
        <select
          value={filters.schoolCode}
          onChange={(e) => {
            const next = e.target.value;
            // Reset grade if it isn't available at the new school.
            const availableGrades = next ? (gradesBySchool[next] ?? []) : null;
            const dropGrade = availableGrades && filters.grade && !availableGrades.includes(filters.grade);
            setFilter({ schoolCode: next, ...(dropGrade ? { grade: "" } : {}) });
          }}
          disabled={!!lockedSchoolCode}
          className={selectClass}
        >
          {!lockedSchoolCode && <option value="">All schools</option>}
          {schoolList.filter((s) => s.code).map((s) => (
            <option key={s.code!} value={s.code!}>
              {s.code} — {s.name ?? ""}
            </option>
          ))}
        </select>
        <select
          value={filters.grade}
          onChange={(e) => setFilter({ grade: e.target.value })}
          className={selectClass}
        >
          <option value="">All grades</option>
          {(filters.schoolCode && gradesBySchool[filters.schoolCode]
            ? gradesBySchool[filters.schoolCode].map((name) => ({ name }))
            : gradeList
          ).map((g) => (
            <option key={g.name ?? ""} value={g.name ?? ""}>
              {g.name ?? ""}
            </option>
          ))}
        </select>
        <select
          value={filters.enabled}
          onChange={(e) => setFilter({ enabled: e.target.value })}
          className={selectClass}
        >
          <option value="">Enabled: any</option>
          <option value="1">Enabled only</option>
          <option value="0">Disabled only</option>
        </select>
        <select
          value={filters.verified}
          onChange={(e) => setFilter({ verified: e.target.value })}
          className={selectClass}
        >
          <option value="">Verified: any</option>
          <option value="1">Verified only</option>
          <option value="0">Unverified only</option>
        </select>
        <select
          value={filters.newStudent}
          onChange={(e) => setFilter({ newStudent: e.target.value })}
          className={selectClass}
        >
          <option value="">New student: any</option>
          <option value="1">New students only</option>
          <option value="0">Returning only</option>
        </select>
        <select
          value={filters.recent}
          onChange={(e) => setFilter({ recent: e.target.value })}
          className={selectClass}
          title="Filter by last update — synced_at bumps on every MCB grant and edit"
        >
          <option value="">All time</option>
          <option value="1d">Last 24 hours</option>
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
          <option value="90d">Last 90 days</option>
        </select>
        {/* Export honours the current filter set (page is irrelevant — the
            route emits every matching row, not just this slice). */}
        <a
          href={`/api/admin/students/export?${buildQs({ ...filters, page: 1 })}`}
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-ink-200 bg-white text-[13px] font-semibold text-ink-800 hover:bg-cream-50 transition-colors"
          title={`Download the ${total.toLocaleString()} filtered student${total === 1 ? "" : "s"} as Excel`}
        >
          <Download className="h-3.5 w-3.5" />
          Export Excel
        </a>
      </Toolbar>

      {total > 0 && (filters.newStudent === "1" || filters.newStudent === "0") && (
        <div className="mb-2 rounded-lg border border-brand-200 bg-brand-50/70 px-3 py-2 flex flex-wrap items-center gap-3 text-[12.5px]">
          <span className="text-brand-900 font-semibold">
            Bulk action — {total.toLocaleString()} filtered{" "}
            {filters.newStudent === "1" ? "(New students)" : "(Returning)"}
          </span>
          {filters.newStudent === "0" && (
            <button
              type="button"
              disabled={bulkBusy}
              onClick={() => runBulkSetNew(true)}
              className={
                "inline-flex items-center gap-1 rounded-md px-2.5 py-1 font-semibold " +
                (bulkBusy
                  ? "bg-ink-200 text-ink-500 cursor-wait"
                  : "bg-brand-600 text-white hover:bg-brand-700")
              }
            >
              Mark all as New
            </button>
          )}
          {filters.newStudent === "1" && (
            <button
              type="button"
              disabled={bulkBusy}
              onClick={() => runBulkSetNew(false)}
              className={
                "inline-flex items-center gap-1 rounded-md px-2.5 py-1 font-semibold " +
                (bulkBusy
                  ? "bg-ink-100 text-ink-400 cursor-wait"
                  : "border border-ink-300 bg-white text-ink-800 hover:bg-cream-50")
              }
            >
              Unmark all
            </button>
          )}
          {bulkMsg && (
            <span className="text-ink-700">{bulkMsg}</span>
          )}
        </div>
      )}

      {/* Website access — one switch. Everything surgical is behind
          Advanced so the common case is unmistakable. */}
      <div
        className={
          "mb-3 rounded-xl border px-4 py-3.5 " +
          (accessClosed
            ? "border-brand-300 bg-brand-50/70"
            : "border-ink-100 bg-white")
        }
      >
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          {accessClosed ? (
            <Lock className="h-5 w-5 text-brand-700 shrink-0" />
          ) : (
            <Unlock className="h-5 w-5 text-emerald-600 shrink-0" />
          )}
          <div className="min-w-0">
            <div className="text-[13px] font-semibold text-ink-900">
              Website is{" "}
              {accessClosed === null ? (
                <span className="text-ink-400">…</span>
              ) : accessClosed ? (
                <span className="text-brand-700">CLOSED</span>
              ) : (
                <span className="text-emerald-700">OPEN</span>
              )}
            </div>
            <div className="text-[12px] text-ink-500">
              {accessClosed === null
                ? "Checking…"
                : accessClosed
                  ? "Parents see the “Website Access is Currently Closed” screen. Nobody can shop."
                  : "Parents can sign in and shop as normal."}
            </div>
          </div>

          <div className="ml-auto flex items-center gap-3">
            {accessMsg && (
              <span className="text-[12px] text-ink-700">{accessMsg}</span>
            )}
            {/* The switch itself. Reads as a physical toggle so there is
                nothing to interpret — left is open, right is closed. */}
            <button
              type="button"
              role="switch"
              aria-checked={!!accessClosed}
              aria-label="Close the website"
              disabled={accessBusy || accessClosed === null}
              onClick={() => toggleSite(!accessClosed)}
              className={
                "relative h-8 w-[68px] rounded-full transition-colors shrink-0 " +
                (accessBusy || accessClosed === null
                  ? "bg-ink-200 cursor-not-allowed"
                  : accessClosed
                    ? "bg-brand-600 hover:bg-brand-700"
                    : "bg-emerald-500 hover:bg-emerald-600")
              }
            >
              <span
                className={
                  "absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-all " +
                  (accessClosed ? "left-[38px]" : "left-1")
                }
              />
              <span
                className={
                  "absolute top-0 h-8 text-[10px] font-bold uppercase tracking-wide text-white leading-8 " +
                  (accessClosed ? "left-2.5" : "right-2")
                }
              >
                {accessBusy ? "…" : accessClosed ? "Off" : "On"}
              </span>
            </button>
          </div>
        </div>

        {/* Surgical, filter-scoped access — the old two buttons. Folded
            away because 99% of the time the master switch is what's
            wanted, and an unnoticed filter made them dangerous. */}
        <div className="mt-2.5 border-t border-ink-100 pt-2.5">
          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            className="text-[12px] font-semibold text-ink-500 hover:text-ink-800 transition-colors"
          >
            {showAdvanced ? "Hide" : "Advanced"} — access for the{" "}
            {total.toLocaleString()} filtered student{total === 1 ? "" : "s"}
          </button>
          {showAdvanced && (
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <span className="text-[12px] text-ink-500">
                Applies to your current filters only (school, grade, search) —
                use this to shut one school without touching the rest.
              </span>
              <div className="ml-auto flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={bulkBusy || total === 0}
                  onClick={() => runBulkSetEnabled(false)}
                  className={
                    "inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border text-[13px] font-semibold transition-colors " +
                    (bulkBusy || total === 0
                      ? "border-ink-100 text-ink-400 cursor-not-allowed"
                      : "border-ink-200 bg-white text-ink-800 hover:bg-cream-50")
                  }
                >
                  <Lock className="h-3.5 w-3.5" />
                  Disable these ({total.toLocaleString()})
                </button>
                <button
                  type="button"
                  disabled={bulkBusy || total === 0}
                  onClick={() => runBulkSetEnabled(true)}
                  className={
                    "inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border text-[13px] font-semibold transition-colors " +
                    (bulkBusy || total === 0
                      ? "border-ink-100 text-ink-400 cursor-not-allowed"
                      : "border-ink-200 bg-white text-ink-800 hover:bg-cream-50")
                  }
                >
                  <Unlock className="h-3.5 w-3.5" />
                  Enable these
                </button>
              </div>
              {bulkMsg && (
                <div className="w-full text-[12px] text-ink-700">{bulkMsg}</div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="mb-1 h-4 text-[11px] text-ink-400">
        {busy ? "Searching…" : `${total.toLocaleString()} match${total === 1 ? "" : "es"} · page ${filters.page} / ${lastPage}`}
      </div>

      <Card padded={false} className={cn(busy && "opacity-70 transition-opacity")}>
        {rows.length === 0 ? (
          <EmptyState
            icon={GraduationCap}
            title={filters.q ? `No students match "${filters.q}"` : "No students"}
            description="Try clearing filters or run sync."
          />
        ) : (
          <>
            <table className="w-full text-[13.5px] border-collapse">
              <thead className="bg-gradient-to-r from-brand-50 via-cream-50 to-brand-50 border-b border-ink-200">
                <tr>
                  <th className="px-3 py-3 text-left text-[12px] font-bold uppercase tracking-wider text-ink-800">Enrollment</th>
                  <th className="px-3 py-3 text-left text-[12px] font-bold uppercase tracking-wider text-ink-800">Status</th>
                  <th className="px-3 py-3 text-left text-[12px] font-bold uppercase tracking-wider text-ink-800">Name</th>
                  <th className="px-3 py-3 text-left text-[12px] font-bold uppercase tracking-wider text-ink-800">Parent</th>
                  <th className="px-3 py-3 text-left text-[12px] font-bold uppercase tracking-wider text-ink-800">Grade · Section</th>
                  <th className="px-3 py-3 text-left text-[12px] font-bold uppercase tracking-wider text-ink-800">School</th>
                  <th className="px-3 py-3 text-left text-[12px] font-bold uppercase tracking-wider text-ink-800">Joining Date</th>
                  <th className="px-3 py-3 text-left text-[12px] font-bold uppercase tracking-wider text-ink-800">New</th>
                  <th className="px-3 py-3 text-left text-[12px] font-bold uppercase tracking-wider text-ink-800">Verified</th>
                  <th className="px-3 py-3 text-left text-[12px] font-bold uppercase tracking-wider text-ink-800">Last login (IST)</th>
                  <th className="px-3 py-3 text-left text-[12px] font-bold uppercase tracking-wider text-ink-800">Last active</th>
                  <th className="px-3 py-3 text-left text-[12px] font-bold uppercase tracking-wider text-ink-800">Access</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <Tr key={s.id}>
                    <Td>
                      <Link href={`/admin/students/${s.id}`} className="font-mono text-[12px] font-semibold text-ink-800 hover:text-brand-700">
                        {s.enrollmentNumber ?? "—"}
                      </Link>
                      {s.referenceCode && s.referenceCode !== s.enrollmentNumber ? (
                        <div className="font-mono text-[10px] text-ink-500">ref: {s.referenceCode}</div>
                      ) : null}
                    </Td>
                    <Td>
                      <Badge tone={s.enabled ? "success" : "default"} dot size="sm">
                        {s.enabled ? "Enabled" : "Disabled"}
                      </Badge>
                    </Td>
                    <Td>
                      <Link href={`/admin/students/${s.id}`} className="font-semibold text-ink-900 hover:text-brand-700">
                        {[s.firstName, s.lastName].filter(Boolean).join(" ") || s.erpName}
                      </Link>
                    </Td>
                    <Td muted>
                      {s.parentPhone ? (
                        <span className="font-mono text-[11px]">{s.parentPhone}</span>
                      ) : (
                        <span className="text-ink-400 text-[12px]">—</span>
                      )}
                    </Td>
                    <Td muted>
                      {s.displayGrade ?? s.grade ?? "—"}
                      {s.section ? ` · ${s.section}` : ""}
                    </Td>
                    <Td muted>
                      <span className="font-mono text-[11px]">{s.schoolCode ?? "—"}</span>
                    </Td>
                    <Td muted>{s.joiningDate ?? "—"}</Td>
                    <Td>
                      {s.isNewStudent ? (
                        <Badge tone="warning" size="sm">New</Badge>
                      ) : (
                        <span className="text-ink-400 text-[12px]">—</span>
                      )}
                    </Td>
                    <Td>
                      {s.isVerified ? (
                        <div className="flex flex-col gap-0.5">
                          <Badge tone="info" size="sm">✓</Badge>
                          {s.verifiedAt ? (
                            <span className="text-[10px] text-ink-500 whitespace-nowrap">{fmtIST(s.verifiedAt)}</span>
                          ) : null}
                        </div>
                      ) : (
                        <span className="text-ink-400 text-[12px]">—</span>
                      )}
                    </Td>
                    <Td muted>
                      <span className="text-[11px] whitespace-nowrap">{fmtIST(s.parentLastLoginAt)}</span>
                    </Td>
                    <Td muted>
                      {s.lastActiveAt ? (
                        <span className="text-[11px] whitespace-nowrap">{fmtIST(s.lastActiveAt)}</span>
                      ) : (
                        <span className="text-ink-400 text-[12px]">—</span>
                      )}
                    </Td>
                    <Td>
                      {s.mcbAccessGranted ? (
                        <Badge tone="success" size="sm">Granted</Badge>
                      ) : (
                        <span className="text-ink-400 text-[12px]">—</span>
                      )}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </table>
            <div className="flex items-center justify-between p-3 border-t border-ink-100/70 text-[12px]">
              <span className="text-ink-500">
                Showing {offset + 1}-{showingTo} of {total.toLocaleString()}
              </span>
              <div className="flex items-center gap-1.5">
                {filters.page > 1 ? (
                  <button onClick={() => goPage(1)} className={navBtn} aria-label="First page" title="First page">
                    <ChevronsLeft className="h-4 w-4" />
                  </button>
                ) : (
                  <span className={navBtnDisabled}><ChevronsLeft className="h-4 w-4" /></span>
                )}
                {filters.page > 1 ? (
                  <button onClick={() => goPage(filters.page - 1)} className={navBtn} aria-label="Previous page" title="Previous page">
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                ) : (
                  <span className={navBtnDisabled}><ChevronLeft className="h-4 w-4" /></span>
                )}
                <span className="px-3 text-ink-700 font-medium tabular-nums">
                  Page {filters.page} of {lastPage}
                </span>
                {filters.page < lastPage ? (
                  <button onClick={() => goPage(filters.page + 1)} className={navBtn} aria-label="Next page" title="Next page">
                    <ChevronRight className="h-4 w-4" />
                  </button>
                ) : (
                  <span className={navBtnDisabled}><ChevronRight className="h-4 w-4" /></span>
                )}
                {filters.page < lastPage ? (
                  <button onClick={() => goPage(lastPage)} className={navBtn} aria-label="Last page" title="Last page">
                    <ChevronsRight className="h-4 w-4" />
                  </button>
                ) : (
                  <span className={navBtnDisabled}><ChevronsRight className="h-4 w-4" /></span>
                )}
              </div>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}

