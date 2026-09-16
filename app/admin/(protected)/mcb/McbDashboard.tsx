"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { GraduationCap, Wallet, Download, Search, ChevronLeft, ChevronRight } from "lucide-react";
import { PageHeader, Card, Th, Td, Tr, Badge, EmptyState, Button, FilterSelect } from "@/components/admin/ui/primitives";
import GrantAccessButton from "./GrantAccessButton";
import { mcbGenderToLabel, mcbGradeToCbse } from "@/lib/mcb/mappings";
import { bulkGrantMcbAccess } from "./actions";

type Tab = "master" | "fees";
type Access = "all" | "granted" | "not";

type School = { code: string; name: string; mcbBranch: string };

const SCHOOLS: School[] = [
  { code: "SASKS", name: "St Andrews Keesara",  mcbBranch: "St. ANDREWS SCHOOL KEESARA" },
  { code: "SASBP", name: "St Andrews Suchitra", mcbBranch: "St. ANDREWS HIGH SCHOOL SUCHITRA" },
  { code: "SMSAW", name: "St Michaels Alwal",   mcbBranch: "St. MICHAELS SCHOOL[ALWAL]" },
  { code: "WMAJK", name: "Winmore Jakkur",      mcbBranch: "Winmore Academy Jakkur" },
  { code: "WMAWF", name: "Winmore Whitefield",  mcbBranch: "Winmore Academy Whitefield" },
  { code: "CAGSM", name: "Crimson Anisha Marunji", mcbBranch: "Crimson Anisha Global School Marunji" },
  { code: "CAGSU", name: "Crimson Anisha Undri",   mcbBranch: "Crimson Anisha Global School Undri" },
  { code: "CWSAG", name: "Crimson World Agra",    mcbBranch: "Crimson World School Agra" },
];

// MUST match PAGE_SIZE in /api/admin/mcb/data and /admin/mcb (server page).
const PAGE_SIZE = 100;

type MasterRow = {
  enrolment_number: string;
  reference_code: string | null;
  student_name: string | null;
  grade: string | null;
  section: string | null;
  mobile_number: string | null;
  email: string | null;
  gender_raw: unknown;
  father_name: string | null;
  mother_name: string | null;
  father_phone: string | null;
  mother_phone: string | null;
  father_email: string | null;
  mother_email: string | null;
  last_fee_paid_date: string | null;
  last_fee_paid_amount: string | null;
  // Per-head latest-paid pivots. Tuition is rendered for every school;
  // Magic Box is rendered only when the active sub-tab is St Michaels Alwal
  // (the only school with material Magic Box volume).
  last_tuition_paid_date: string | null;
  last_magic_box_paid_date: string | null;
  website_access: boolean;
  website_access_at: string | null;
  website_access_by: string | null;
};
type FeeRow = MasterRow & {
  day_amount: string | null;
  day_receipts: number | null;
  last_paid_in_range: string | null;
};

function todayIst() {
  return new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
}
function minusDays(n: number) {
  return new Date(Date.now() + 5.5 * 3600_000 - n * 86400_000).toISOString().slice(0, 10);
}

/**
 * Classify a last-fee-paid date against the ops-defined "April current"
 * line for the academic year. Returns one of:
 *   "current" — paid in April 2026 or later (✓)
 *   "march"   — paid in March 2026 (⚠)
 *   "earlier" — paid before March 2026 (✗)
 *   "unpaid"  — null / empty
 */
const APRIL_LINE = new Date("2026-04-01T00:00:00Z");
const MARCH_LINE = new Date("2026-03-01T00:00:00Z");
function feePaidStatus(date: string | null): "current" | "march" | "earlier" | "unpaid" {
  if (!date) return "unpaid";
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return "unpaid";
  if (d.getTime() >= APRIL_LINE.getTime()) return "current";
  if (d.getTime() >= MARCH_LINE.getTime()) return "march";
  return "earlier";
}
function FeeStatusBadge({ date }: { date: string | null }) {
  const s = feePaidStatus(date);
  if (s === "current") return <Badge tone="success" size="sm">✓ April+</Badge>;
  if (s === "march") return <Badge tone="warning" size="sm">⚠ March</Badge>;
  if (s === "earlier") return <Badge tone="danger" size="sm">✗ Behind</Badge>;
  return <Badge tone="default" size="sm">— Unpaid</Badge>;
}


/** Schools where the enrolment column should display the MCB Ref/Adm code
 *  (StudentReferencesCode, e.g. KS260293) instead of the internal enrolment_number.
 *  Jakkur is excluded — keep its enrolment_number as-is. */
const REF_CODE_SCHOOLS = new Set(["SASKS", "SASBP", "SMSAW", "WMAWF"]);
function displayEnrolment(schoolCode: string, row: { enrolment_number: string; reference_code: string | null }) {
  if (REF_CODE_SCHOOLS.has(schoolCode)) return row.reference_code || row.enrolment_number;
  return row.enrolment_number;
}

type InitialData = {
  tab: Tab;
  page: number;
  total: number;
  counts: { mcb_branch: string; n: number }[];
  rows: (MasterRow | FeeRow)[];
  /** Pipeline heartbeat. Surfaced as pills in the dashboard header so ops
   *  can spot silent drift the next morning instead of after a parent
   *  complaint. Hydrated by app/admin/(protected)/mcb/page.tsx. */
  syncStatus?: {
    studentsLastSynced: string | null;
    feesLastSynced: string | null;
    feesLastPaymentDate: string | null;
    feesRowsLast24h: number;
  };
};

function hoursSince(iso: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return (Date.now() - t) / 3600_000;
}
function fmtRelative(iso: string | null): string {
  if (!iso) return "never";
  const h = hoursSince(iso);
  if (h == null) return "never";
  if (h < 1) return `${Math.round(h * 60)}m ago`;
  if (h < 36) return `${Math.round(h)}h ago`;
  return `${Math.round(h / 24)}d ago`;
}
function SyncPill({
  label,
  iso,
  warnAfterH,
  failAfterH,
  detail,
}: {
  label: string;
  iso: string | null;
  warnAfterH: number;
  failAfterH: number;
  detail?: string;
}) {
  const h = hoursSince(iso);
  const tone: "success" | "warning" | "danger" =
    h == null || h >= failAfterH ? "danger" : h >= warnAfterH ? "warning" : "success";
  return (
    <Badge tone={tone} size="sm">
      {label}: {fmtRelative(iso)}
      {detail ? ` · ${detail}` : ""}
    </Badge>
  );
}

export default function McbDashboard({ initialData }: { initialData: InitialData }) {
  const today = todayIst();
  const [tab, setTab] = useState<Tab>(initialData.tab);
  const [school, setSchool] = useState<string>(SCHOOLS[0].code);
  const [access, setAccess] = useState<Access>("all");
  // YYYY-MM. Empty string = any month (no filter).
  const [month, setMonth] = useState<string>("");
  const [from, setFrom] = useState<string>(today);
  const [to, setTo] = useState<string>(today);
  const [q, setQ] = useState<string>("");
  const [qInput, setQInput] = useState<string>("");
  const [page, setPage] = useState<number>(1);
  const [data, setData] = useState<InitialData>(initialData);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [bulkPending, startBulkTransition] = useTransition();
  const [bulkMsg, setBulkMsg] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const abortRef = useRef<AbortController | null>(null);

  const activeSchool = useMemo(
    () => SCHOOLS.find((s) => s.code === school) ?? SCHOOLS[0],
    [school]
  );

  // 24 most-recent months (this month + previous 23) as YYYY-MM. Labelled
  // "May 2026" for the dropdown. Computed in IST so the boundary matches
  // the server-side date_trunc('month', payment_date).
  const monthOptions = useMemo(() => {
    const now = new Date(Date.now() + 5.5 * 3600_000);
    const out: { value: string; label: string }[] = [];
    const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    for (let i = 0; i < 24; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      out.push({ value: `${y}-${m}`, label: `${monthNames[d.getMonth()]} ${y}` });
    }
    return out;
  }, []);

  const refresh = useCallback(
    (overrides?: Partial<{ tab: Tab; school: string; access: Access; from: string; to: string; q: string; page: number; month: string }>) => {
      const s = { tab, school, access, from, to, q, page, month, ...overrides };
      const u = new URLSearchParams({
        tab: s.tab,
        school: s.school,
        access: s.access,
        from: s.from,
        to: s.to,
        page: String(s.page),
      });
      if (s.q) u.set("q", s.q);
      if (s.month) u.set("month", s.month);
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      startTransition(() => {
        fetch(`/api/admin/mcb/data?${u.toString()}`, { signal: ac.signal, cache: "no-store" })
          .then((r) => r.json())
          .then((j) => {
            if (j?.error) {
              setError(j.error);
              return;
            }
            setError(null);
            setData(j);
          })
          .catch((e) => {
            if (e.name !== "AbortError") setError(String(e?.message || e));
          });
      });
    },
    [tab, school, access, from, to, q, page, month]
  );

  // Re-fetch whenever any state changes (after initial paint).
  const isFirstRun = useRef(true);
  useEffect(() => {
    if (isFirstRun.current) {
      isFirstRun.current = false;
      return;
    }
    setChecked(new Set()); // reset selection on any nav change
    refresh();
  }, [tab, school, access, from, to, q, page, month, refresh]);

  // Debounce search input → committed `q` (which triggers the refetch).
  useEffect(() => {
    const t = setTimeout(() => {
      if (qInput !== q) {
        setPage(1);
        setQ(qInput);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [qInput, q]);

  const ungrantedVisible = useMemo(
    () => (data.rows as FeeRow[]).filter((r) => !r.website_access).map((r) => r.enrolment_number),
    [data.rows]
  );
  const allChecked = ungrantedVisible.length > 0 && ungrantedVisible.every((id) => checked.has(id));
  const toggleAll = () => {
    if (allChecked) setChecked(new Set());
    else setChecked(new Set(ungrantedVisible));
  };
  const toggleOne = (id: string) =>
    setChecked((cur) => {
      const n = new Set(cur);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const runBulkGrant = () => {
    const ids = [...checked];
    if (ids.length === 0) return;
    setBulkMsg(null);
    startBulkTransition(async () => {
      const r = await bulkGrantMcbAccess(ids);
      setBulkMsg(
        `Granted ${r.granted} · Skipped ${r.skipped} · Failed ${r.failed}` +
          (r.errors.length ? ` — ${r.errors[0]}` : "")
      );
      setChecked(new Set());
      refresh();
    });
  };

  const setStateAndResetPage = (fn: () => void) => {
    setPage(1);
    fn();
  };

  const countByCode = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of SCHOOLS) {
      const branch = data.counts.find((c) => c.mcb_branch === s.mcbBranch);
      m.set(s.code, branch?.n ?? 0);
    }
    return m;
  }, [data.counts]);

  // Export URL carries the active filters (minus pagination — the export
  // route emits every matching row). Built to match /api/admin/mcb/data's
  // param contract so the spreadsheet equals the filtered on-screen view.
  const exportHref = useMemo(() => {
    const u = new URLSearchParams({ tab, school, access, from, to });
    if (q) u.set("q", q);
    if (month) u.set("month", month);
    return `/api/admin/mcb/export?${u.toString()}`;
  }, [tab, school, access, from, to, q, month]);

  const total = data.total;
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const offset = (data.page - 1) * PAGE_SIZE;
  const rangeLabel = from === to ? from : `${from} → ${to}`;

  return (
    <div>
      <PageHeader
        eyebrow="Customer Relationship (CRM)"
        title="MyClassBoard students"
        description={
          tab === "master"
            ? `${total.toLocaleString("en-IN")} student${total === 1 ? "" : "s"} in ${activeSchool.name}`
            : `Fee payments ${rangeLabel} · ${activeSchool.name}`
        }
        actions={
          <a href={exportHref} download>
            <Button variant="secondary" icon={<Download className="h-3.5 w-3.5" />}>
              Export Excel
            </Button>
          </a>
        }
      />

      {/* Pipeline heartbeat. Students sync goes green within 36h, amber 36–48h,
          red beyond. Fees sync similarly but with a smaller wider band — we
          also surface the latest payment_date MCB has returned, since fees
          may be back-stamped weeks late (see import-from-mcb.ts window). */}
      {initialData.syncStatus ? (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-500">Sync</span>
          <SyncPill
            label="Students"
            iso={initialData.syncStatus.studentsLastSynced}
            warnAfterH={30}
            failAfterH={48}
          />
          <SyncPill
            label="Fees"
            iso={initialData.syncStatus.feesLastSynced}
            warnAfterH={30}
            failAfterH={48}
            detail={`${initialData.syncStatus.feesRowsLast24h} rows / 24h`}
          />
          <SyncPill
            label="Newest payment"
            iso={initialData.syncStatus.feesLastPaymentDate}
            warnAfterH={72}
            failAfterH={168}
          />
        </div>
      ) : null}

      {/* Which school — one chip per MCB branch, count = rows synced */}
      <div className="mb-4 flex flex-wrap gap-1.5">
        {SCHOOLS.map((s) => {
          const n = countByCode.get(s.code) ?? 0;
          const isActive = s.code === school;
          return (
            <button
              key={s.code}
              type="button"
              onClick={() => setStateAndResetPage(() => setSchool(s.code))}
              aria-pressed={isActive}
              className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[12.5px] font-semibold transition-colors ${
                isActive ? "bg-ink-900 text-white" : "bg-white text-ink-600 ring-1 ring-ink-100 hover:bg-cream-50 hover:text-ink-900"
              }`}
            >
              {s.name}
              <span className={`rounded-full px-1.5 py-0.5 text-[10.5px] tabular-nums ${isActive ? "bg-white/15 text-white" : "bg-ink-100 text-ink-500"}`}>
                {n.toLocaleString("en-IN")}
              </span>
            </button>
          );
        })}
      </div>

      {/* Toolbar — view switch, search, filters. Everything applies as you pick it. */}
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-ink-100/70 bg-white p-2">
        <div className="inline-flex h-9 items-center rounded-lg bg-cream-100 p-0.5" role="tablist">
          {([
            ["master", "Student master", GraduationCap],
            ["fees", "Fee payments", Wallet],
          ] as const).map(([key, label, Icon]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setStateAndResetPage(() => setTab(key))}
              className={`inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[12.5px] font-semibold transition-colors ${
                tab === key ? "bg-white text-ink-900 shadow-sm" : "text-ink-500 hover:text-ink-800"
              }`}
            >
              <Icon className="h-3.5 w-3.5" /> {label}
            </button>
          ))}
        </div>

        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-400" />
          <input
            type="search"
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            placeholder="Search name, enrolment or mobile…"
            className="h-9 w-full rounded-lg border border-ink-100 bg-cream-50 pl-9 pr-3 text-[13px] placeholder:text-ink-400 transition-[background,border,box-shadow] focus:border-ink-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-300/40"
            aria-label="Search MCB students"
          />
        </div>

        {tab === "master" ? (
          <>
            <FilterSelect
              label="Website access"
              value={access === "all" ? "" : access}
              onChange={(e) => setStateAndResetPage(() => setAccess((e.target.value || "all") as Access))}
            >
              <option value="granted">Granted</option>
              <option value="not">Not granted</option>
            </FilterSelect>
            <FilterSelect
              label="Tuition paid in"
              allLabel="Any month"
              value={month}
              onChange={(e) => setStateAndResetPage(() => setMonth(e.target.value))}
            >
              {monthOptions.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </FilterSelect>
          </>
        ) : (
          <>
            <label className="inline-flex h-9 items-center overflow-hidden rounded-lg border border-ink-100 bg-white text-[13px]">
              <span className="flex h-full items-center border-r border-ink-100 bg-cream-50 px-2.5 text-[12px] font-medium text-ink-500">From</span>
              <input
                type="date"
                value={from}
                max={to}
                onChange={(e) => setStateAndResetPage(() => setFrom(e.target.value))}
                className="h-full bg-transparent px-2.5 text-[13px] outline-none"
              />
            </label>
            <label className="inline-flex h-9 items-center overflow-hidden rounded-lg border border-ink-100 bg-white text-[13px]">
              <span className="flex h-full items-center border-r border-ink-100 bg-cream-50 px-2.5 text-[12px] font-medium text-ink-500">To</span>
              <input
                type="date"
                value={to}
                min={from}
                max={today}
                onChange={(e) => setStateAndResetPage(() => setTo(e.target.value))}
                className="h-full bg-transparent px-2.5 text-[13px] outline-none"
              />
            </label>
            <div className="flex items-center gap-1">
              {[
                ["Today", today, today],
                ["7 days", minusDays(6), today],
                ["30 days", minusDays(29), today],
                ["This FY", "2025-04-01", today],
              ].map(([label, f, t]) => {
                const on = from === f && to === t;
                return (
                  <button
                    key={label}
                    type="button"
                    onClick={() => setStateAndResetPage(() => { setFrom(f as string); setTo(t as string); })}
                    className={`h-8 rounded-lg px-2.5 text-[12px] font-medium transition-colors ${on ? "bg-ink-900 text-white" : "text-ink-600 hover:bg-cream-100 hover:text-ink-900"}`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </>
        )}

        {isPending ? <span className="text-[12px] text-ink-400">Loading…</span> : null}
        {error ? <span className="text-[12px] font-medium text-red-600">{error}</span> : null}
      </div>

      <Card padded={false} className="overflow-hidden">
        {ungrantedVisible.length > 0 && data.rows.length > 0 ? (
          <div className="flex flex-wrap items-center gap-3 border-b border-ink-100 bg-cream-50/60 px-5 py-2.5 text-[13px]">
            <span className="text-ink-600">
              {checked.size > 0
                ? <><strong className="text-ink-900">{checked.size}</strong> selected</>
                : `${ungrantedVisible.length} on this page without website access`}
            </span>
            <Button
              variant="primary"
              size="sm"
              disabled={checked.size === 0 || bulkPending}
              onClick={runBulkGrant}
            >
              {bulkPending ? "Granting…" : checked.size ? `Grant access to ${checked.size}` : "Grant access"}
            </Button>
            {bulkMsg ? <span className="text-ink-600">{bulkMsg}</span> : null}
          </div>
        ) : null}

        {tab === "master" ? (
          data.rows.length === 0 ? (
            <EmptyState
              icon={GraduationCap}
              title="No students match"
              description={`No ${access === "all" ? "" : access === "granted" ? "granted " : "ungranted "}students in ${activeSchool.name}${q ? ` for "${q}"` : ""}.`}
            />
          ) : (
            <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <Th className="w-10">
                    <input
                      type="checkbox"
                      checked={allChecked}
                      onChange={toggleAll}
                      aria-label="Select all ungranted on this page"
                      className="accent-brand"
                    />
                  </Th>
                  <Th>Student</Th>
                  <Th>Class</Th>
                  <Th>Gender</Th>
                  <Th>Mobile</Th>
                  <Th>Email</Th>
                  <Th>Tuition last paid</Th>
                  {school === "SMSAW" && <Th>Magic Box last paid</Th>}
                  <Th>Website access</Th>
                </tr>
              </thead>
              <tbody>
                {(data.rows as MasterRow[]).map((m) => {
                  const gender = mcbGenderToLabel(m.gender_raw as boolean | string | null);
                  const fatherMobile = (m.father_phone || "").replace(/\D/g, "").slice(-10);
                  const motherMobile = (m.mother_phone || "").replace(/\D/g, "").slice(-10);
                  const grantMobile =
                    (/^\d{10}$/.test(fatherMobile) && fatherMobile) ||
                    (/^\d{10}$/.test(motherMobile) && motherMobile) ||
                    (m.mobile_number || "").replace(/\D/g, "").slice(-10);
                  const parentName = m.father_name || m.mother_name || "";
                  const grantEmail = m.father_email || m.mother_email || m.email || "";
                  const canonical = mcbGradeToCbse(m.grade) || "";
                  return (
                    <Tr key={m.enrolment_number}>
                      <Td>
                        {!m.website_access && (
                          <input
                            type="checkbox"
                            checked={checked.has(m.enrolment_number)}
                            onChange={() => toggleOne(m.enrolment_number)}
                            aria-label={`Select ${m.enrolment_number}`}
                            className="accent-brand"
                          />
                        )}
                      </Td>
                      <Td>
                        <span className="block font-semibold text-ink-900">{m.student_name || "—"}</span>
                        <span className="mt-0.5 block font-mono text-[11.5px] font-normal text-ink-500">{displayEnrolment(school, m)}</span>
                      </Td>
                      <Td muted>
                        {m.grade ?? "—"}
                        {m.section ? ` · ${m.section}` : ""}
                      </Td>
                      <Td muted>{gender || "—"}</Td>
                      <Td muted><span className="font-mono">{m.mobile_number || "—"}</span></Td>
                      <Td muted>{m.email || "—"}</Td>
                      <Td muted>
                        <span className="inline-flex items-center gap-2 whitespace-nowrap">
                          {/* Status badge tracks tuition specifically —
                              ops's "behind on fees" question is about
                              tuition installments, not activity top-ups. */}
                          <FeeStatusBadge date={m.last_tuition_paid_date} />
                          {m.last_tuition_paid_date ? fmtDay(m.last_tuition_paid_date) : null}
                        </span>
                      </Td>
                      {school === "SMSAW" && (
                        <Td muted>{m.last_magic_box_paid_date ? fmtDay(m.last_magic_box_paid_date) : "—"}</Td>
                      )}
                      <Td className="whitespace-nowrap">
                        <GrantAccessButton
                          enrolmentNumber={m.enrolment_number}
                          granted={!!m.website_access}
                          grantedAt={m.website_access_at}
                          grantedBy={m.website_access_by}
                          onChange={refresh}
                          defaults={{
                            fullName: m.student_name || "",
                            grade: canonical,
                            mcbGrade: m.grade || "",
                            section: m.section || "",
                            gender: gender as "Male" | "Female" | "",
                            mobile: grantMobile,
                            email: grantEmail,
                            parentName: parentName,
                          }}
                        />
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          )
        ) : data.rows.length === 0 ? (
          <EmptyState
            icon={Wallet}
            title="No fee payments in this range"
            description={`Nothing recorded for ${activeSchool.name} between ${from} and ${to}.`}
          />
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <Th className="w-10">
                  <input
                    type="checkbox"
                    checked={allChecked}
                    onChange={toggleAll}
                    aria-label="Select all ungranted on this page"
                    className="accent-brand"
                  />
                </Th>
                <Th>Student</Th>
                <Th>Class</Th>
                <Th>Parent</Th>
                <Th>Mobile</Th>
                <Th>Email</Th>
                <Th>Last fee paid</Th>
                <Th right>Paid in range</Th>
                <Th>Website access</Th>
              </tr>
            </thead>
            <tbody>
              {(data.rows as FeeRow[]).map((r) => {
                const mobile = (r.mother_phone || r.father_phone || r.mobile_number || "").replace(/\D/g, "").slice(-10);
                const email = r.father_email || r.mother_email || r.email || "";
                const parentName = r.father_name || r.mother_name || "";
                const canonical = mcbGradeToCbse(r.grade) || "";
                const gender = mcbGenderToLabel(r.gender_raw as boolean | string | null) || "";
                return (
                  <Tr key={r.enrolment_number}>
                    <Td>
                      {!r.website_access && (
                        <input
                          type="checkbox"
                          checked={checked.has(r.enrolment_number)}
                          onChange={() => toggleOne(r.enrolment_number)}
                          aria-label={`Select ${r.enrolment_number}`}
                          className="accent-brand"
                        />
                      )}
                    </Td>
                    <Td>
                      <span className="block font-semibold text-ink-900">{r.student_name || "—"}</span>
                      <span className="mt-0.5 block font-mono text-[11.5px] font-normal text-ink-500">{displayEnrolment(school, r)}</span>
                    </Td>
                    <Td muted>{r.grade ?? "—"}{r.section ? ` · ${r.section}` : ""}</Td>
                    <Td muted>{parentName || "—"}</Td>
                    <Td muted><span className="font-mono">{mobile || r.mobile_number || "—"}</span></Td>
                    <Td muted>{email || "—"}</Td>
                    <Td muted>
                      <span className="inline-flex items-center gap-2 whitespace-nowrap">
                        <FeeStatusBadge date={r.last_fee_paid_date} />
                        {r.last_fee_paid_date ? fmtDay(r.last_fee_paid_date) : null}
                        {r.last_fee_paid_amount ? (
                          <span className="text-ink-500">₹{Number(r.last_fee_paid_amount).toLocaleString("en-IN")}</span>
                        ) : null}
                      </span>
                    </Td>
                    <Td right>
                      {r.day_amount ? (
                        <>
                          <span className="font-semibold">₹{Number(r.day_amount).toLocaleString("en-IN")}</span>
                          {(r.day_receipts ?? 0) > 1 && (
                            <span className="block text-[12px] font-normal text-ink-500">
                              {r.day_receipts} receipts
                              {r.last_paid_in_range && from !== to ? ` · last ${fmtDay(r.last_paid_in_range)}` : ""}
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="text-ink-300">—</span>
                      )}
                    </Td>
                    <Td className="whitespace-nowrap">
                      <GrantAccessButton
                        enrolmentNumber={r.enrolment_number}
                        granted={!!r.website_access}
                        grantedAt={r.website_access_at}
                        grantedBy={r.website_access_by}
                        onChange={refresh}
                        defaults={{
                          fullName: r.student_name || "",
                          grade: canonical,
                          mcbGrade: r.grade || "",
                          section: r.section || "",
                          gender: gender as "Male" | "Female" | "",
                          mobile: mobile,
                          email: email,
                          parentName: parentName,
                        }}
                      />
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </table>
          </div>
        )}

        {total > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink-100/70 px-5 py-3 text-[12.5px] text-ink-500">
            <span>
              Showing <strong className="font-semibold text-ink-800">{(offset + 1).toLocaleString("en-IN")}–{Math.min(offset + PAGE_SIZE, total).toLocaleString("en-IN")}</strong> of{" "}
              <strong className="font-semibold text-ink-800">{total.toLocaleString("en-IN")}</strong> student{total === 1 ? "" : "s"}
            </span>
            {total > PAGE_SIZE ? (
              <div className="flex items-center gap-1.5">
                <PgBtn label="Previous" enabled={data.page > 1} onClick={() => setPage(data.page - 1)} icon="prev" />
                <span className="px-2 tabular-nums">Page {data.page} of {lastPage}</span>
                <PgBtn label="Next" enabled={data.page < lastPage} onClick={() => setPage(data.page + 1)} icon="next" />
              </div>
            ) : null}
          </div>
        ) : null}
      </Card>
    </div>
  );
}

const fmtDay = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

function PgBtn({ label, enabled, onClick, icon }: { label: string; enabled: boolean; onClick: () => void; icon: "prev" | "next" }) {
  const cls = `inline-flex h-8 items-center gap-1 rounded-lg border px-2.5 text-[12.5px] font-semibold transition-colors ${
    enabled ? "border-ink-200 bg-white text-ink-800 hover:border-ink-300 hover:bg-cream-100" : "cursor-not-allowed border-ink-100 bg-cream-50 text-ink-300"
  }`;
  return (
    <button type="button" onClick={onClick} disabled={!enabled} className={cls} aria-label={label}>
      {icon === "prev" ? <ChevronLeft className="h-3.5 w-3.5" /> : null}
      {label}
      {icon === "next" ? <ChevronRight className="h-3.5 w-3.5" /> : null}
    </button>
  );
}
