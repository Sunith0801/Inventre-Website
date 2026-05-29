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
  firstName: string | null;
  lastName: string | null;
  grade: string | null;
  section: string | null;
  schoolCode: string | null;
  isVerified: boolean;
  isNewStudent: boolean;
  joiningDate: string | null;
};

type Filters = {
  q: string;
  schoolCode: string;
  grade: string;
  enabled: string;
  verified: string;
  newStudent: string;
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
  lockedSchoolCode,
}: {
  initial: FetchResult & { filters: Filters };
  schoolList: { code: string | null; name: string | null }[];
  gradeList: { name: string | null }[];
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
          onChange={(e) => setFilter({ schoolCode: e.target.value })}
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
          {gradeList.map((g) => (
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
      </Toolbar>

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
            <table className="w-full text-[13px]">
              <thead>
                <tr>
                  <Th>Enrollment</Th>
                  <Th>Status</Th>
                  <Th>Name</Th>
                  <Th>Grade · Section</Th>
                  <Th>School</Th>
                  <Th>Joining Date</Th>
                  <Th>New</Th>
                  <Th>Verified</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <Tr key={s.id}>
                    <Td>
                      <Link href={`/admin/students/${s.id}`} className="font-mono text-[11px] text-ink-700 hover:text-brand-700">
                        {s.enrollmentNumber ?? "—"}
                      </Link>
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
                      {s.grade ?? "—"}
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
                        <Badge tone="info" size="sm">✓</Badge>
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

