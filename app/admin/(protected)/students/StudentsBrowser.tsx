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
  Lock,
  Unlock,
  BadgeCheck,
} from "lucide-react";
import {
  Card,
  Th,
  Td,
  Tr,
  Badge,
  Button,
  EmptyState,
  Toolbar,
  FilterSelect,
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

  const pageNav = (enabled: boolean) =>
    cn(
      "inline-flex h-8 items-center gap-1 rounded-lg border px-2.5 text-[12.5px] font-semibold transition-colors",
      enabled
        ? "border-ink-200 bg-white text-ink-800 hover:bg-cream-100 hover:border-ink-300"
        : "border-ink-100 bg-cream-50 text-ink-300 cursor-not-allowed"
    );

  const gradeChoices =
    filters.schoolCode && gradesBySchool[filters.schoolCode]
      ? gradesBySchool[filters.schoolCode].map((name) => ({ name }))
      : gradeList;

  return (
    <div>
      {/* ── Filters ─────────────────────────────────────────────────── */}
      <Toolbar className="flex-col items-stretch gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink-400 pointer-events-none" />
          <input
            type="search"
            defaultValue={filters.q}
            onChange={(e) => setQDebounced(e.target.value)}
            placeholder="Search name, enrollment, mobile…"
            className="w-full h-9 pl-9 pr-3 text-[13px] rounded-lg bg-cream-50 border border-ink-100 placeholder:text-ink-400 focus:outline-none focus:bg-white focus:border-ink-300 focus:ring-2 focus:ring-brand-300/40 transition-[background,border,box-shadow]"
          />
        </div>
        <FilterSelect label="School" noAll={!!lockedSchoolCode} className="w-[300px]" value={filters.schoolCode} onChange={(e) => {
            const next = e.target.value;
            // Reset grade if it isn't available at the new school.
            const availableGrades = next ? (gradesBySchool[next] ?? []) : null;
            const dropGrade = availableGrades && filters.grade && !availableGrades.includes(filters.grade);
            setFilter({ schoolCode: next, ...(dropGrade ? { grade: "" } : {}) });
          }}
          disabled={!!lockedSchoolCode}
        >
          {schoolList.filter((s) => s.code).map((s) => (
            <option key={s.code!} value={s.code!}>
              {s.code} — {s.name ?? ""}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect label="Grade" value={filters.grade} onChange={(e) => setFilter({ grade: e.target.value })} className="min-w-[130px]">
          {gradeChoices.map((g) => (
            <option key={g.name ?? ""} value={g.name ?? ""}>
              {g.name ?? ""}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect label="Enabled" value={filters.enabled} onChange={(e) => setFilter({ enabled: e.target.value })} className="min-w-[130px]">
          <option value="1">Yes</option>
          <option value="0">No</option>
        </FilterSelect>
        <FilterSelect label="Verified" value={filters.verified} onChange={(e) => setFilter({ verified: e.target.value })} className="min-w-[130px]">
          <option value="1">Yes</option>
          <option value="0">No</option>
        </FilterSelect>
        <FilterSelect label="New student" value={filters.newStudent} onChange={(e) => setFilter({ newStudent: e.target.value })} className="min-w-[130px]">
          <option value="1">Yes</option>
          <option value="0">No</option>
        </FilterSelect>
      </Toolbar>

      {total > 0 && (filters.newStudent === "1" || filters.newStudent === "0") && (
        <div className="mb-3 flex flex-wrap items-center gap-3 rounded-xl border border-brand-200 bg-brand-50/70 px-4 py-2.5 text-[12.5px]">
          <span className="font-semibold text-brand-900">
            {total.toLocaleString()} {filters.newStudent === "1" ? "new" : "returning"} student{total === 1 ? "" : "s"} in this filter
          </span>
          <Button
            type="button"
            size="sm"
            variant={filters.newStudent === "0" ? "primary" : "secondary"}
            busy={bulkBusy}
            onClick={() => runBulkSetNew(filters.newStudent === "0")}
          >
            {filters.newStudent === "0" ? "Mark all as New" : "Unmark all"}
          </Button>
          {bulkMsg && <span className="text-ink-700">{bulkMsg}</span>}
        </div>
      )}

      {/* ── Website access — one switch. Everything surgical is behind
          Advanced so the common case is unmistakable. ───────────────── */}
      <div
        className={cn(
          "mb-4 rounded-2xl border px-4 py-3",
          accessClosed ? "border-brand-300 bg-brand-50/70" : "border-ink-100/70 bg-white"
        )}
      >
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <span
            className={cn(
              "grid h-9 w-9 place-items-center rounded-xl",
              accessClosed ? "bg-brand-100 text-brand-700" : "bg-emerald-50 text-emerald-600"
            )}
          >
            {accessClosed ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" />}
          </span>
          <div className="min-w-0">
            <div className="text-[13px] font-semibold text-ink-900">
              Website is{" "}
              {accessClosed === null ? (
                <span className="text-ink-400">…</span>
              ) : accessClosed ? (
                <span className="text-brand-700">closed</span>
              ) : (
                <span className="text-emerald-700">open</span>
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
            {accessMsg && <span className="text-[12px] text-ink-700">{accessMsg}</span>}
            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              className="text-[12px] font-semibold text-ink-500 hover:text-ink-800 transition-colors"
            >
              {showAdvanced ? "Hide advanced" : "Advanced"}
            </button>
            {/* The switch itself. Reads as a physical toggle so there is
                nothing to interpret — left is open, right is closed. */}
            <button
              type="button"
              role="switch"
              aria-checked={!!accessClosed}
              aria-label="Close the website"
              disabled={accessBusy || accessClosed === null}
              onClick={() => toggleSite(!accessClosed)}
              className={cn(
                "relative h-7 w-[56px] rounded-full transition-colors shrink-0",
                accessBusy || accessClosed === null
                  ? "bg-ink-200 cursor-not-allowed"
                  : accessClosed
                    ? "bg-brand-600 hover:bg-brand-700"
                    : "bg-emerald-500 hover:bg-emerald-600"
              )}
            >
              <span
                className={cn(
                  "absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all",
                  accessClosed ? "left-[30px]" : "left-1"
                )}
              />
            </button>
          </div>
        </div>

        {showAdvanced && (
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-ink-100/70 pt-3">
            <span className="text-[12px] text-ink-500">
              Access for the <b className="text-ink-800">{total.toLocaleString()}</b> student{total === 1 ? "" : "s"} in the current filter only —
              use this to shut one school without touching the rest.
            </span>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={bulkBusy || total === 0}
                onClick={() => runBulkSetEnabled(false)}
                icon={<Lock className="h-3.5 w-3.5" />}
              >
                Disable these
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={bulkBusy || total === 0}
                onClick={() => runBulkSetEnabled(true)}
                icon={<Unlock className="h-3.5 w-3.5" />}
              >
                Enable these
              </Button>
            </div>
            {bulkMsg && <div className="w-full text-[12px] text-ink-700">{bulkMsg}</div>}
          </div>
        )}
      </div>

      {/* ── Table ───────────────────────────────────────────────────── */}
      <Card padded={false} className={cn("overflow-hidden", busy && "opacity-70 transition-opacity")}>
        {rows.length === 0 ? (
          <EmptyState
            icon={GraduationCap}
            title={filters.q ? `No students match “${filters.q}”` : "No students"}
            description="Try widening the search or clearing a filter."
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr>
                    <Th>Student</Th>
                    <Th>Class</Th>
                    <Th>School</Th>
                    <Th>Parent</Th>
                    <Th>Status</Th>
                    <Th>Verified</Th>
                    <Th>Last active</Th>
                    <Th>MCB</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((s) => {
                    const name = [s.firstName, s.lastName].filter(Boolean).join(" ") || s.erpName || "—";
                    return (
                      <Tr key={s.id} className={cn(!s.enabled && "opacity-70")}>
                        <Td>
                          <Link href={`/admin/students/${s.id}`} className="group/name block">
                            <span className="block font-semibold text-ink-900 group-hover/name:text-brand-700">{name}</span>
                            <span className="mt-0.5 block font-mono text-[11.5px] text-ink-500">
                              {s.enrollmentNumber ?? "—"}
                              {s.referenceCode && s.referenceCode !== s.enrollmentNumber ? (
                                <span className="text-ink-400"> · ref {s.referenceCode}</span>
                              ) : null}
                            </span>
                          </Link>
                        </Td>
                        <Td>
                          <span className="whitespace-nowrap">{s.displayGrade ?? s.grade ?? "—"}</span>
                          {s.section ? <span className="text-ink-400"> · {s.section}</span> : null}
                        </Td>
                        <Td muted>
                          <span className="font-mono text-[12px]">{s.schoolCode ?? "—"}</span>
                        </Td>
                        <Td muted>
                          {s.parentPhone ? <span className="font-mono text-[12px]">{s.parentPhone}</span> : <span className="text-ink-300">—</span>}
                        </Td>
                        <Td>
                          <span className="inline-flex flex-wrap items-center gap-1">
                            <Badge tone={s.enabled ? "success" : "default"} dot size="sm">
                              {s.enabled ? "Enabled" : "Disabled"}
                            </Badge>
                            {s.isNewStudent ? <Badge tone="warning" size="sm">New</Badge> : null}
                          </span>
                        </Td>
                        <Td>
                          {s.isVerified ? (
                            <span
                              className="inline-flex items-center gap-1 text-[12px] font-medium text-sky-700"
                              title={s.verifiedAt ? `Verified ${fmtIST(s.verifiedAt)}` : "Verified by the parent"}
                            >
                              <BadgeCheck className="h-4 w-4" />
                              {s.verifiedAt ? fmtIST(s.verifiedAt).split(",")[0] : "Yes"}
                            </span>
                          ) : (
                            <span className="text-ink-300">—</span>
                          )}
                        </Td>
                        <Td muted>
                          <span className="whitespace-nowrap text-[12px]">
                            {s.lastActiveAt ? fmtIST(s.lastActiveAt) : s.parentLastLoginAt ? fmtIST(s.parentLastLoginAt) : "—"}
                          </span>
                        </Td>
                        <Td>
                          {s.mcbAccessGranted ? <Badge tone="success" size="sm">Granted</Badge> : <span className="text-ink-300">—</span>}
                        </Td>
                      </Tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <nav aria-label="Pagination" className="flex flex-wrap items-center justify-between gap-3 border-t border-ink-100 px-4 py-2.5">
              <p className="text-[12.5px] text-ink-500 tabular-nums">
                {busy ? (
                  "Searching…"
                ) : (
                  <>
                    Showing <span className="font-semibold text-ink-800">{(offset + 1).toLocaleString()}–{showingTo.toLocaleString()}</span> of{" "}
                    {total.toLocaleString()} student{total === 1 ? "" : "s"}
                  </>
                )}
              </p>
              <div className="flex items-center gap-1.5">
                <button type="button" onClick={() => goPage(1)} disabled={filters.page <= 1} className={pageNav(filters.page > 1)} aria-label="First page">
                  <ChevronsLeft className="h-3.5 w-3.5" />
                </button>
                <button type="button" onClick={() => goPage(filters.page - 1)} disabled={filters.page <= 1} className={pageNav(filters.page > 1)} aria-label="Previous page">
                  <ChevronLeft className="h-3.5 w-3.5" /> Prev
                </button>
                <span className="px-2 text-[12.5px] text-ink-500 tabular-nums">
                  Page <span className="font-semibold text-ink-800">{filters.page.toLocaleString()}</span> of {lastPage.toLocaleString()}
                </span>
                <button type="button" onClick={() => goPage(filters.page + 1)} disabled={filters.page >= lastPage} className={pageNav(filters.page < lastPage)} aria-label="Next page">
                  Next <ChevronRight className="h-3.5 w-3.5" />
                </button>
                <button type="button" onClick={() => goPage(lastPage)} disabled={filters.page >= lastPage} className={pageNav(filters.page < lastPage)} aria-label="Last page">
                  <ChevronsRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </nav>
          </>
        )}
      </Card>
    </div>
  );
}
