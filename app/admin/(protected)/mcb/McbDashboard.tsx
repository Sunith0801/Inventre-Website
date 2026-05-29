"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { GraduationCap, Wallet } from "lucide-react";
import { PageHeader, Card, Th, Td, Tr, Badge, EmptyState, Button } from "@/components/admin/ui/primitives";
import GrantAccessButton from "./GrantAccessButton";
import { mcbGenderToLabel, mcbGradeToCanonical } from "@/lib/mcb/mappings";
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
];

const PAGE_SIZE = 50;

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
  return <Badge tone="neutral" size="sm">— Unpaid</Badge>;
}

const TAB_LINK = "inline-flex items-center gap-2 px-4 py-2 rounded-lg text-[15px] font-medium transition-colors cursor-pointer";
const SUBTAB = "inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-[14px] font-medium transition-colors cursor-pointer";

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
};

export default function McbDashboard({ initialData }: { initialData: InitialData }) {
  const today = todayIst();
  const [tab, setTab] = useState<Tab>(initialData.tab);
  const [school, setSchool] = useState<string>(SCHOOLS[0].code);
  const [access, setAccess] = useState<Access>("all");
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

  const refresh = useCallback(
    (overrides?: Partial<{ tab: Tab; school: string; access: Access; from: string; to: string; q: string; page: number }>) => {
      const s = { tab, school, access, from, to, q, page, ...overrides };
      const u = new URLSearchParams({
        tab: s.tab,
        school: s.school,
        access: s.access,
        from: s.from,
        to: s.to,
        page: String(s.page),
      });
      if (s.q) u.set("q", s.q);
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
    [tab, school, access, from, to, q, page]
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
  }, [tab, school, access, from, to, q, page, refresh]);

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

  const total = data.total;
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const offset = (data.page - 1) * PAGE_SIZE;
  const rangeLabel = from === to ? from : `${from} → ${to}`;

  return (
    <div>
      <PageHeader
        eyebrow="MCB"
        title="MyClassBoard students"
        description={
          tab === "master"
            ? `${total.toLocaleString("en-IN")} student${total === 1 ? "" : "s"} in ${activeSchool.name} · page ${data.page}/${lastPage}`
            : `Fee payments ${rangeLabel} · page ${data.page}/${lastPage}`
        }
      />

      {/* top tabs */}
      <div className="flex gap-2 mb-4">
        <button
          type="button"
          onClick={() => setStateAndResetPage(() => setTab("master"))}
          className={`${TAB_LINK} ${tab === "master" ? "bg-brand-600 text-white" : "bg-cream-100 text-ink-700 hover:bg-cream-200"}`}
        >
          <GraduationCap className="h-4 w-4" /> Student Master Data
        </button>
        <button
          type="button"
          onClick={() => setStateAndResetPage(() => setTab("fees"))}
          className={`${TAB_LINK} ${tab === "fees" ? "bg-brand-600 text-white" : "bg-cream-100 text-ink-700 hover:bg-cream-200"}`}
        >
          <Wallet className="h-4 w-4" /> Fee-Paid Students
        </button>
        {isPending && (
          <span className="self-center text-[13px] text-ink-400 ml-2">Loading…</span>
        )}
        {error && (
          <span className="self-center text-[13px] text-rose-700 ml-2">{error}</span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <input
            type="search"
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            placeholder="Search name / enrolment / mobile…"
            className="h-9 w-72 px-3 rounded-lg border border-ink-200 text-[14px] bg-white"
            aria-label="Search MCB students"
          />
          {qInput && (
            <button
              type="button"
              onClick={() => { setQInput(""); setPage(1); setQ(""); }}
              className="text-[13px] text-ink-500 hover:text-ink-800"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* access filter (master) */}
      {tab === "master" && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-[13px] text-ink-500">Show:</span>
          {(["all", "not", "granted"] as Access[]).map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => setStateAndResetPage(() => setAccess(a))}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-medium ${
                access === a ? "bg-ink-900 text-white" : "bg-white border border-ink-200 text-ink-700 hover:bg-cream-50"
              }`}
            >
              {a === "all" ? "All students" : a === "not" ? "Not granted" : "Granted"}
            </button>
          ))}
        </div>
      )}

      {/* date range (fees) */}
      {tab === "fees" && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <label className="text-[13px] text-ink-500">From</label>
          <input
            type="date"
            value={from}
            onChange={(e) => setStateAndResetPage(() => setFrom(e.target.value))}
            className="h-9 px-2.5 rounded-lg border border-ink-200 text-[13px]"
          />
          <label className="text-[13px] text-ink-500">To</label>
          <input
            type="date"
            value={to}
            onChange={(e) => setStateAndResetPage(() => setTo(e.target.value))}
            className="h-9 px-2.5 rounded-lg border border-ink-200 text-[13px]"
          />
          <span className="mx-2 text-ink-300">·</span>
          {[
            ["Today", today, today],
            ["Last 7d", minusDays(6), today],
            ["Last 30d", minusDays(29), today],
            ["FY 25-26→", "2025-04-01", today],
          ].map(([label, f, t]) => (
            <button
              key={label}
              type="button"
              onClick={() => setStateAndResetPage(() => {
                setFrom(f as string);
                setTo(t as string);
              })}
              className="text-[13px] text-brand-700 hover:underline"
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* school sub-tabs */}
      <div className="flex flex-wrap gap-2 mb-4 pb-3 border-b border-ink-100">
        {SCHOOLS.map((s) => {
          const n = countByCode.get(s.code) ?? 0;
          const isActive = s.code === school;
          return (
            <button
              key={s.code}
              type="button"
              onClick={() => setStateAndResetPage(() => setSchool(s.code))}
              className={`${SUBTAB} ${isActive ? "bg-ink-900 text-white" : "bg-white border border-ink-200 text-ink-700 hover:bg-cream-50"}`}
            >
              {s.name}
              <Badge tone={isActive ? "info" : "default"} size="sm">
                {n.toLocaleString("en-IN")}
              </Badge>
            </button>
          );
        })}
      </div>

      <Card padded={false}>
        {tab === "master" ? (
          data.rows.length === 0 ? (
            <EmptyState
              icon={GraduationCap}
              title="No students match this filter"
              description={`No ${access === "all" ? "" : access === "granted" ? "granted " : "ungranted "}students in ${activeSchool.name}.`}
            />
          ) : (
            <table className="w-full text-[14px]">
              <thead>
                <tr>
                  <Th>{REF_CODE_SCHOOLS.has(school) ? "Ref / Adm No" : "Enrolment"}</Th>
                  <Th>Name</Th>
                  <Th>Grade · Section</Th>
                  <Th>Gender</Th>
                  <Th>Mobile</Th>
                  <Th>Email</Th>
                  <Th>Tuition fee last paid</Th>
                  {school === "SMSAW" && <Th>Magic Box last paid</Th>}
                  <Th>Access</Th>
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
                  const canonical = mcbGradeToCanonical(m.grade) || "";
                  return (
                    <Tr key={m.enrolment_number}>
                      <Td>
                        <span className="font-mono text-[13px] font-semibold text-ink-800">{displayEnrolment(school, m)}</span>
                      </Td>
                      <Td>{m.student_name || "—"}</Td>
                      <Td muted>
                        {m.grade ?? "—"}
                        {m.section ? ` · ${m.section}` : ""}
                      </Td>
                      <Td muted>{gender || "—"}</Td>
                      <Td muted>{m.mobile_number || "—"}</Td>
                      <Td muted>{m.email || "—"}</Td>
                      <Td muted>
                        <div className="flex items-start gap-2">
                          {/* Status badge tracks tuition specifically —
                              ops's "behind on fees" question is about
                              tuition installments, not activity top-ups. */}
                          <FeeStatusBadge date={m.last_tuition_paid_date} />
                          <div>
                            {m.last_tuition_paid_date
                              ? new Date(m.last_tuition_paid_date).toLocaleDateString("en-IN")
                              : "—"}
                          </div>
                        </div>
                      </Td>
                      {school === "SMSAW" && (
                        <Td muted>
                          {m.last_magic_box_paid_date
                            ? new Date(m.last_magic_box_paid_date).toLocaleDateString("en-IN")
                            : "—"}
                        </Td>
                      )}
                      <Td>
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
          )
        ) : data.rows.length === 0 ? (
          <EmptyState
            icon={Wallet}
            title="No fee payments in this range"
            description={`Nothing recorded for ${activeSchool.name} between ${from} and ${to}.`}
          />
        ) : (
          <>
          {ungrantedVisible.length > 0 && (
            <div className="flex items-center gap-3 px-3 py-2 border-b border-ink-100 bg-cream-50/60 text-[13px]">
              <span className="text-ink-500">
                {checked.size > 0
                  ? `${checked.size} selected`
                  : `${ungrantedVisible.length} ungranted on this page`}
              </span>
              <Button
                variant="primary"
                disabled={checked.size === 0 || bulkPending}
                onClick={runBulkGrant}
              >
                {bulkPending ? "Granting…" : `Grant access to ${checked.size || ""}`.trim()}
              </Button>
              {bulkMsg && <span className="text-ink-600">{bulkMsg}</span>}
            </div>
          )}
          <table className="w-full text-[14px]">
            <thead>
              <tr>
                <Th>
                  <input
                    type="checkbox"
                    checked={allChecked}
                    onChange={toggleAll}
                    aria-label="Select all ungranted on this page"
                  />
                </Th>
                <Th>{REF_CODE_SCHOOLS.has(school) ? "Ref / Adm No" : "Enrolment"}</Th>
                <Th>Name</Th>
                <Th>Grade · Section</Th>
                <Th>Parent</Th>
                <Th>Mobile</Th>
                <Th>Email</Th>
                <Th>Last fee paid</Th>
                <Th>Paid in range</Th>
                <Th>Access</Th>
              </tr>
            </thead>
            <tbody>
              {(data.rows as FeeRow[]).map((r) => {
                const mobile = (r.mother_phone || r.father_phone || r.mobile_number || "").replace(/\D/g, "").slice(-10);
                const email = r.father_email || r.mother_email || r.email || "";
                const parentName = r.father_name || r.mother_name || "";
                const canonical = mcbGradeToCanonical(r.grade) || "";
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
                        />
                      )}
                    </Td>
                    <Td><span className="font-mono text-[13px] font-semibold text-ink-800">{displayEnrolment(school, r)}</span></Td>
                    <Td>{r.student_name || "—"}</Td>
                    <Td muted>{r.grade ?? "—"}{r.section ? ` · ${r.section}` : ""}</Td>
                    <Td muted>{parentName || "—"}</Td>
                    <Td muted>{mobile || r.mobile_number || "—"}</Td>
                    <Td muted>{email || "—"}</Td>
                    <Td muted>
                      <div className="flex items-start gap-2">
                        <FeeStatusBadge date={r.last_fee_paid_date} />
                        <div>
                          {r.last_fee_paid_date ? new Date(r.last_fee_paid_date).toLocaleDateString("en-IN") : "—"}
                          {r.last_fee_paid_amount && (
                            <div className="text-[13px] text-ink-500">
                              ₹{Number(r.last_fee_paid_amount).toLocaleString("en-IN")}
                            </div>
                          )}
                        </div>
                      </div>
                    </Td>
                    <Td>
                      {r.day_amount ? (
                        <>
                          <span className="font-semibold">₹{Number(r.day_amount).toLocaleString("en-IN")}</span>
                          {(r.day_receipts ?? 0) > 1 && (
                            <div className="text-[13px] text-ink-500">
                              {r.day_receipts} receipts
                              {r.last_paid_in_range && from !== to ? ` · last ${new Date(r.last_paid_in_range).toLocaleDateString("en-IN")}` : ""}
                            </div>
                          )}
                        </>
                      ) : (
                        "—"
                      )}
                    </Td>
                    <Td>
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
          </>
        )}
      </Card>

      {total > PAGE_SIZE && (
        <div className="flex items-center justify-between mt-3 text-[13px] text-ink-500">
          <span>Showing {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total.toLocaleString("en-IN")}</span>
          <div className="flex items-center gap-1.5">
            <PgBtn label="« First" enabled={data.page > 1} onClick={() => setPage(1)} />
            <PgBtn label="‹ Prev" enabled={data.page > 1} onClick={() => setPage(data.page - 1)} />
            <span className="px-3 tabular-nums">{data.page} / {lastPage}</span>
            <PgBtn label="Next ›" enabled={data.page < lastPage} onClick={() => setPage(data.page + 1)} />
            <PgBtn label="Last »" enabled={data.page < lastPage} onClick={() => setPage(lastPage)} />
          </div>
        </div>
      )}
    </div>
  );
}

function PgBtn({ label, enabled, onClick }: { label: string; enabled: boolean; onClick: () => void }) {
  return enabled ? (
    <button type="button" onClick={onClick} className="px-2 py-1 rounded border border-ink-200 hover:bg-cream-50">
      {label}
    </button>
  ) : (
    <span className="px-2 py-1 rounded border border-ink-100 text-ink-300">{label}</span>
  );
}
