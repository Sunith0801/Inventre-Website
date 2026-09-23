"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";

/* ── formatting ──────────────────────────────────────────────────────
   MCB amounts are rupees. Hero figures use Indian compact notation; the
   ledger itself never rounds — an ops person reconciling a receipt needs
   the exact number. */
const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");
function inrShort(n: number) {
  const a = Math.abs(n);
  if (a >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`;
  if (a >= 1e5) return `₹${(n / 1e5).toFixed(1)} L`;
  if (a >= 1e3) return `₹${(n / 1e3).toFixed(1)} K`;
  return inr(n);
}
const pct = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : 0);
const pctLabel = (part: number, whole: number) =>
  whole > 0 ? `${pct(part, whole).toFixed(1)}%` : "—";
const n0 = (n: number) => n.toLocaleString("en-IN");
function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  const t = new Date(d);
  if (Number.isNaN(t.getTime())) return String(d).slice(0, 10);
  return t.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}
/** MCB ships grades as "Class VII" / "Grade 7" / "I" — normalise to a short
 *  ledger form ("G7") without pulling the admin mapping module in. */
const ROMAN: Record<string, number> = {
  I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10, XI: 11, XII: 12,
};
function shortGrade(g: string | null | undefined) {
  if (!g) return "—";
  const t = g.trim().replace(/^(class|grade)\s+/i, "");
  const digits = t.match(/^(\d{1,2})/);
  if (digits) return `G${digits[1]}`;
  const roman = ROMAN[t.toUpperCase().split(/\s|-/)[0]];
  if (roman) return `G${roman}`;
  if (/^(nur|lkg|ukg|pp|kg)/i.test(t)) return t.toUpperCase().slice(0, 4);
  return t.length > 6 ? t.slice(0, 6) : t;
}

type SchoolRow = {
  code: string; name: string; students: number; heads: number;
  gross: number; concession: number; net: number; paid: number;
  balance: number; pendingStudents: number;
  /** Students who have left. Their billed/collected money is inside the
   *  figures above; their balance is not, because it cannot be collected. */
  leftStudents: number; leftBalance: number;
};
type HeadRow = {
  feeHead: string; students: number; installments: number;
  gross: number; concession: number; net: number; paid: number; balance: number;
  pendingStudents: number; concessionStudents: number; lastPaidDate: string | null;
  leftStudents?: number; leftBalance?: number;
  /** Collected but never billed — the figures are receipts, not receivables. */
  receiptOnly?: boolean;
};
/** A student row when the selected head exists only in receipts. */
type ReceiptStudentRow = {
  enrolment: string; referenceCode: string | null; name: string | null;
  grade: string | null; section: string | null; mobile: string | null;
  lines: number; paid: number; lastPaidDate: string | null;
  receipts: string[]; paymentMode: string | null;
};
type Installment = {
  installment: string | null; dueDate: string | null;
  gross: number; concession: number; paid: number; balance: number;
  paidDate: string | null; receiptNo: string | null;
};
type StudentRow = {
  enrolment: string; referenceCode: string | null; name: string | null;
  grade: string | null; section: string | null; mobile: string | null;
  installments: number; paidInstallments: number;
  gross: number; concession: number; net: number; paid: number; balance: number;
  status: "paid" | "partial" | "pending";
  /** Student has left the school — shown only with the leavers toggle on. */
  hasLeft?: boolean;
  lastPaidDate: string | null; nextDueDate: string | null;
  detail: Installment[];
};
type StudentsPayload = {
  page: number; pageSize: number; total: number; grades: string[];
  totals: {
    students: number; paidStudents: number; pendingStudents: number;
    partialStudents: number; concessionStudents: number;
    concession90Students: number; concession50Students: number;
    gross: number; concession: number; net: number; paid: number; balance: number;
    leftStudents: number; leftGross: number; leftPaid: number; leftBalance: number;
    showingLeft: boolean; enrolledOnly: boolean;
  };
  rows: StudentRow[];
  source?: "receipts";
  receiptRows?: ReceiptStudentRow[];
};
type Status =
  | "all" | "paid" | "partial" | "pending"
  | "concession" | "concession90" | "concession50";

/** How much of the academic year has actually been billed yet — the context
 *  the headline figure is meaningless without mid-year. */
type Coverage = {
  ay: string | null;
  priorAy: string | null;
  installments: { name: string; billed: boolean; net: number; priorNet: number }[];
  billedCount: number;
  expectedCount: number;
  perStudent: number;
  priorPerStudent: number;
  minorCount: number;
  minorNet: number;
  currentNet: number;
  priorSameSlice: number;
  priorFull: number;
  notYetBilled: number;
};

/** A real MCB receipt line, fetched live when a student is expanded. See
 *  app/api/admin/mcb/fees/receipts/route.ts for why this cannot come from
 *  the receivables table we already hold. */
type AgeCell = { balance: number; students: number };
type AgeRow = { name: string; code?: string | null; firstDue: string | null; total: number; buckets: Record<string, AgeCell> };
type Ageing = {
  asOf: string;
  buckets: Record<string, AgeCell & { installments: number }>;
  total: number;
  schools: AgeRow[];
  heads: AgeRow[];
  installments: AgeRow[];
  left: { balance: number; students: number };
};
/** Bucket order is the order of the tiles, the bar and the matrix columns:
 *  future first, then older and older. Tone steps from Billed-blue (not a
 *  problem yet) through deepening Outstanding-orange — one role, darkening,
 *  rather than a fifth accent. */
const AGE_BUCKETS: { key: string; label: string; short: string; since: string; tone: string }[] = [
  { key: "not_due", label: "Not due yet", short: "Not due", since: "", tone: "future" },
  { key: "d0_30", label: "Overdue under a month", short: "< 1 month", since: "under a month", tone: "a1" },
  { key: "d31_60", label: "Overdue 1 to 2 months", short: "1–2 months", since: "over a month", tone: "a2" },
  { key: "d61_90", label: "Overdue 2 to 3 months", short: "2–3 months", since: "over two months", tone: "a3" },
  { key: "d91_180", label: "Overdue 3 to 6 months", short: "3–6 months", since: "over three months", tone: "a4" },
  { key: "d180p", label: "Overdue more than 6 months", short: "6+ months", since: "over six months", tone: "a5" },
  { key: "no_due", label: "No due date given by MCB", short: "No date", since: "", tone: "none" },
]

type Collection = {
  asOf: string;
  buckets: Record<string, AgeCell & { installments: number; avgDaysLate: number | null }>;
  total: number;
  schools: AgeRow[];
  heads: AgeRow[];
  installments: AgeRow[];
  partial: { balance: number; students: number };
};
type CollStudent = {
  enrolment: string; student: string; branch: string; code: string | null;
  className: string; section: string; lines: string; installments: number;
  lastPaid: string | null; daysLate: number | null; avgDaysLate: number | null; balance: number;
};
type CollList = { bucket: string; page: number; pageSize: number; total: number; balance: number; rows: CollStudent[] };
/** Collection buckets: green for money that arrived by the due date, then
 *  the same darkening orange as the receivables cards for later and later. */
const COLL_BUCKETS: { key: string; label: string; short: string; tone: string }[] = [
  { key: "on_time", label: "Paid by the due date", short: "On time", tone: "in" },
  { key: "l1_30", label: "Paid under a month late", short: "< 1 month", tone: "a1" },
  { key: "l31_60", label: "Paid 1 to 2 months late", short: "1–2 months", tone: "a2" },
  { key: "l61_90", label: "Paid 2 to 3 months late", short: "2–3 months", tone: "a3" },
  { key: "l91_180", label: "Paid 3 to 6 months late", short: "3–6 months", tone: "a4" },
  { key: "l180p", label: "Paid over 6 months late", short: "6+ months", tone: "a5" },
  { key: "unmatched", label: "Paid, receipt not matched", short: "No receipt", tone: "none" },
];

type AgeStudent = {
  enrolment: string; student: string; branch: string; code: string | null;
  className: string; section: string; heads: string; lines: string;
  installments: number; oldestDue: string | null; daysOverdue: number | null; balance: number;
};
type AgeList = { bucket: string; page: number; pageSize: number; total: number; balance: number; rows: AgeStudent[] };

type Receipt = {
  receiptNo: string | null; paidDate: string | null; amount: number;
  mode: string | null; feeType: string | null; transactionId: string | null;
  isOnline: boolean; academicYear: string | null;
};
type ReceiptState =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; receipts: Receipt[]; total: number; errors?: string[] };

/** Fee heads shown before the tail collapses. Six covers every head that
 *  carries real money at any branch; the rest are clubs and one-off trips. */
const HEADS_SHOWN = 6;

const CHIPS: { key: Status; label: string; countOf: (t: StudentsPayload["totals"]) => number }[] = [
  { key: "all", label: "All", countOf: (t) => t.students },
  { key: "paid", label: "Paid", countOf: (t) => t.paidStudents },
  { key: "partial", label: "Part paid", countOf: (t) => t.partialStudents },
  { key: "pending", label: "Yet to pay", countOf: (t) => t.pendingStudents },
  { key: "concession", label: "Concession", countOf: (t) => t.concessionStudents },
];

/**
 * Concession bands, nested under the Concession chip rather than sitting in
 * the main row. They are a drill-down, not a peer of "Paid" — and on most
 * fee heads they are two near-empty chips taking up the width of the search
 * box. They appear once Concession is selected, and disappear with it.
 *
 * Near-total waivers are the ones worth eyeballing: 79 students sit above
 * 90% on tuition alone, and MCB exposes no reason or approver for any of
 * them (see the concession note in the fee-ledger memory).
 */
const CONCESSION_BANDS: {
  key: Status;
  label: string;
  countOf: (t: StudentsPayload["totals"]) => number;
}[] = [
  { key: "concession", label: "Any", countOf: (t) => t.concessionStudents },
  { key: "concession90", label: "≥90%", countOf: (t) => t.concession90Students },
  { key: "concession50", label: "50–90%", countOf: (t) => t.concession50Students },
];
const isConcessionStatus = (s: Status) => s.startsWith("concession");

export default function FeeConsole({
  initialSchools, academicYears, initialAy, lastSynced, lastReceipt,
  currentEmail = "", canManageUsers = false,
}: {
  initialSchools: SchoolRow[];
  academicYears: string[];
  initialAy: string | null;
  lastSynced: string | null;
  lastReceipt: string | null;
  /** A fee-desk account never sees the admin chrome, so this page carries
   *  its own identity + sign-out. */
  currentEmail?: string;
  canManageUsers?: boolean;
}) {
  const [ay, setAy] = useState<string | null>(initialAy);
  const [schools, setSchools] = useState<SchoolRow[]>(initialSchools);
  /* Scope is a SET of schools. Empty = consolidated, which is why it is a
     list rather than a "ALL" sentinel: "every school" and "these three"
     are the same kind of answer, only a different width. */
  const [selected, setSelected] = useState<string[]>([]);
  const scope = selected.length ? selected.join(",") : "ALL";
  const [heads, setHeads] = useState<HeadRow[] | null>(null);
  const [head, setHead] = useState<string | null>(null);
  const [students, setStudents] = useState<StudentsPayload | null>(null);
  const [status, setStatus] = useState<Status>("all");
  /* Students who have left are off the chase list by default. The desk still
     needs them when reconciling against MCB, so this is a switch, not a
     hard exclusion. */
  const [showLeft, setShowLeft] = useState(false);
  const [grade, setGrade] = useState("");
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [receipts, setReceipts] = useState<Record<string, ReceiptState>>({});
  const [allHeads, setAllHeads] = useState(false);
  const [coverage, setCoverage] = useState<Coverage | null>(null);
  const [ageing, setAgeing] = useState<Ageing | null>(null);
  const [ageBy, setAgeBy] = useState<"schools" | "heads" | "installments">("schools");
  const [ageBucket, setAgeBucket] = useState<string | null>(null);
  const [agePage, setAgePage] = useState(1);
  const [ageQInput, setAgeQInput] = useState("");
  const [ageQ, setAgeQ] = useState("");
  const [ageList, setAgeList] = useState<AgeList | null>(null);
  const [collection, setCollection] = useState<Collection | null>(null);
  const [collBy, setCollBy] = useState<"schools" | "heads" | "installments">("schools");
  const [collBucket, setCollBucket] = useState<string | null>(null);
  const [collPage, setCollPage] = useState(1);
  const [collQInput, setCollQInput] = useState("");
  const [collQ, setCollQ] = useState("");
  const [collList, setCollList] = useState<CollList | null>(null);
  const [busy, setBusy] = useState(0);
  /** Bumped when the tab regains focus, so a dashboard left open overnight
   *  reloads its figures instead of quietly showing yesterday's. */
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const onFocus = () => {
      if (document.visibilityState === "visible") setTick((t) => t + 1);
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, []);

  const ayParam = ay ? `&ay=${encodeURIComponent(ay)}` : "";
  const track = <T,>(p: Promise<T>) => {
    setBusy((b) => b + 1);
    return p.finally(() => setBusy((b) => Math.max(0, b - 1)));
  };

  // Search debounce — each keystroke would otherwise re-run a 200k-row scan.
  useEffect(() => {
    const t = setTimeout(() => {
      setQ(qInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [qInput]);

  // School rollups follow the academic year.
  const [firstAy] = useState(initialAy);
  useEffect(() => {
    if (ay === firstAy && tick === 0) return;
    let dead = false;
    track(
      fetch(`/api/admin/mcb/fees?view=schools${ayParam}`)
        .then((r) => r.json())
        .then((d) => {
          if (!dead) setSchools(d.schools ?? []);
        })
    );
    return () => { dead = true; };
  }, [ayParam, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fee types follow (year, scope). The biggest head auto-selects so the
  // ledger below is never empty on arrival.
  useEffect(() => {
    let dead = false;
    track(
      fetch(`/api/admin/mcb/fees?view=heads&school=${encodeURIComponent(scope)}${ayParam}`)
        .then((r) => r.json())
        .then((d) => {
          if (dead) return;
          // Receipt-only heads are appended so they appear in the same
          // index — a head nobody billed is still a head people paid.
          const list: HeadRow[] = [...(d.heads ?? []), ...(d.receiptOnly ?? [])];
          setHeads(list);
          setHead((cur) => (cur && list.some((h) => h.feeHead === cur) ? cur : (list[0]?.feeHead ?? null)));
        })
    );
    return () => { dead = true; };
  }, [scope, ayParam, tick]);  

  // Billing coverage follows (year, scope) like the band above it.
  useEffect(() => {
    let dead = false;
    setCoverage(null);
    track(
      fetch(`/api/admin/mcb/fees?view=coverage&school=${encodeURIComponent(scope)}${ayParam}`)
        .then((r) => r.json())
        .then((d) => {
          if (!dead) setCoverage(d?.installments ? d : null);
        })
        .catch(() => {})
    );
    return () => { dead = true; };
  }, [scope, ayParam, tick]);  

  // Receivables ageing follows (year, scope) too.
  useEffect(() => {
    let dead = false;
    setAgeing(null);
    track(
      fetch(`/api/admin/mcb/fees?view=ageing&school=${encodeURIComponent(scope)}${ayParam}`)
        .then((r) => r.json())
        .then((d) => {
          if (!dead) setAgeing(d?.buckets ? d : null);
        })
        .catch(() => {})
    );
    return () => { dead = true; };
  }, [scope, ayParam, tick]);

  // Collection ageing follows (year, scope) as well.
  useEffect(() => {
    let dead = false;
    setCollection(null);
    track(
      fetch(`/api/admin/mcb/fees?view=collection&school=${encodeURIComponent(scope)}${ayParam}`)
        .then((r) => r.json())
        .then((d) => { if (!dead) setCollection(d?.buckets ? d : null); })
        .catch(() => {})
    );
    return () => { dead = true; };
  }, [scope, ayParam, tick]);

  // Bucket search debounce.
  useEffect(() => {
    const t = setTimeout(() => { setAgeQ(ageQInput.trim()); setAgePage(1); }, 300);
    return () => clearTimeout(t);
  }, [ageQInput]);
  useEffect(() => {
    const t = setTimeout(() => { setCollQ(collQInput.trim()); setCollPage(1); }, 300);
    return () => clearTimeout(t);
  }, [collQInput]);

  // A new scope or year drops the open bucket — its figures no longer apply.
  useEffect(() => { setAgeBucket(null); setAgePage(1); setCollBucket(null); setCollPage(1); }, [scope, ayParam]);

  // Who paid in the clicked collection bucket.
  useEffect(() => {
    if (!collBucket) { setCollList(null); return; }
    let dead = false;
    track(
      fetch(
        `/api/admin/mcb/fees?view=collection&school=${encodeURIComponent(scope)}${ayParam}` +
        `&bucket=${collBucket}&page=${collPage}${collQ ? `&q=${encodeURIComponent(collQ)}` : ""}`
      )
        .then((r) => r.json())
        .then((d) => { if (!dead) setCollList(d?.rows ? d : null); })
        .catch(() => {})
    );
    return () => { dead = true; };
  }, [scope, ayParam, collBucket, collPage, collQ, tick]);

  // Who owes in the clicked bucket.
  useEffect(() => {
    if (!ageBucket) { setAgeList(null); return; }
    let dead = false;
    track(
      fetch(
        `/api/admin/mcb/fees?view=ageing&school=${encodeURIComponent(scope)}${ayParam}` +
        `&bucket=${ageBucket}&page=${agePage}${ageQ ? `&q=${encodeURIComponent(ageQ)}` : ""}`
      )
        .then((r) => r.json())
        .then((d) => { if (!dead) setAgeList(d?.rows ? d : null); })
        .catch(() => {})
    );
    return () => { dead = true; };
  }, [scope, ayParam, ageBucket, agePage, ageQ, tick]);

  // The ledger.
  useEffect(() => {
    if (!head) { setStudents(null); return; }
    let dead = false;
    const headRow = heads?.find((h) => h.feeHead === head);
    const receiptsMode = Boolean(headRow?.receiptOnly);
    const url =
      `/api/admin/mcb/fees?view=students&school=${encodeURIComponent(scope)}&head=${encodeURIComponent(head)}` +
      `${ayParam}&status=${status}&page=${page}` +
      (showLeft ? "&inactive=1" : "") +
      (receiptsMode ? "&source=receipts" : "") +
      (grade ? `&grade=${encodeURIComponent(grade)}` : "") +
      (q ? `&q=${encodeURIComponent(q)}` : "");
    track(
      fetch(url)
        .then((r) => r.json())
        .then((d) => {
          if (dead) return;
          setStudents(
            d?.source === "receipts" ? { ...d, receiptRows: d.rows, rows: [] } : d
          );
        })
    );
    return () => { dead = true; };
  }, [scope, head, ayParam, status, grade, q, page, tick, heads, showLeft]);  

  /* Receipts are pulled per student, on expand — MCB has no bulk variant.
     The API caches for 5 minutes; this keeps a second copy so re-expanding
     a row inside one session never re-hits the network at all. */
  const loadReceipts = useCallback(
    (enrolment: string) => {
      setReceipts((prev) => {
        if (prev[enrolment]) return prev;
        const url =
          `/api/admin/mcb/fees/receipts?enrolment=${encodeURIComponent(enrolment)}` +
          (ay ? `&ay=${encodeURIComponent(ay)}` : "");
        fetch(url)
          .then(async (r) => {
            const d = await r.json().catch(() => ({}));
            if (!r.ok) throw new Error(d?.error || `MCB lookup failed (${r.status})`);
            setReceipts((cur) => ({
              ...cur,
              [enrolment]: {
                state: "ready",
                receipts: d.receipts ?? [],
                total: d.total ?? 0,
                errors: d.errors,
              },
            }));
          })
          .catch((e: unknown) => {
            setReceipts((cur) => ({
              ...cur,
              [enrolment]: {
                state: "error",
                message: e instanceof Error ? e.message : "MCB lookup failed",
              },
            }));
          });
        return { ...prev, [enrolment]: { state: "loading" } };
      });
    },
    [ay]
  );

  const selectHead = useCallback((h: string) => {
    setHead(h);
    setStatus("all");
    setGrade("");
    setQ("");
    setQInput("");
    setPage(1);
    setExpanded(new Set());
  }, []);
  /** Any change of scope invalidates the drill-down below it. */
  const applyScope = useCallback((next: string[]) => {
    setSelected(next);
    setAllHeads(false);
    setStatus("all");
    setGrade("");
    setPage(1);
    setExpanded(new Set());
  }, []);
  /** Card body: look at this school on its own — the common case. */
  const focusSchool = useCallback((code: string) => applyScope([code]), [applyScope]);
  /** Corner square: add/remove without losing what is already picked.
   *  Removing the last one lands back on consolidated, which is the same
   *  thing as picking none. */
  const togglePick = useCallback(
    (code: string) =>
      setSelected((prev) => {
        const next = prev.includes(code)
          ? prev.filter((c) => c !== code)
          : [...prev, code];
        setAllHeads(false);
        setStatus("all");
        setGrade("");
        setPage(1);
        setExpanded(new Set());
        return next;
      }),
    []
  );

  const allTotals = useMemo(() => {
    const a = {
      gross: 0, concession: 0, paid: 0, balance: 0, students: 0, pendingStudents: 0,
      leftStudents: 0, leftBalance: 0,
    };
    for (const s of schools) {
      a.gross += s.gross; a.concession += s.concession; a.paid += s.paid;
      a.balance += s.balance; a.students += s.students; a.pendingStudents += s.pendingStudents;
      a.leftStudents += s.leftStudents ?? 0; a.leftBalance += s.leftBalance ?? 0;
    }
    return a;
  }, [schools]);
  /* The band is the sum of the picked schools — consolidated when none
     are, a single school's own row when one is. */
  const band = useMemo(() => {
    if (!selected.length) return allTotals;
    const picked = schools.filter((s) => selected.includes(s.code));
    if (!picked.length) return allTotals;
    return picked.reduce(
      (a, s) => ({
        gross: a.gross + s.gross,
        concession: a.concession + s.concession,
        paid: a.paid + s.paid,
        balance: a.balance + s.balance,
        students: a.students + s.students,
        pendingStudents: a.pendingStudents + s.pendingStudents,
        leftStudents: a.leftStudents + (s.leftStudents ?? 0),
        leftBalance: a.leftBalance + (s.leftBalance ?? 0),
      }),
      { gross: 0, concession: 0, paid: 0, balance: 0, students: 0,
        pendingStudents: 0, leftStudents: 0, leftBalance: 0 }
    );
  }, [selected, schools, allTotals]);
  /* Headcount is enrolled-only for the live year only — a closed year counts
     everyone it billed, because MCB's "left" flag is about today, not about
     that year. Keep in step with `currentYear` in the fees API route. */
  const currentYear = Boolean(ay && academicYears[0] && ay === academicYears[0]);
  /** True while the selected year still has instalments left to raise. */
  const partYear = Boolean(coverage && coverage.billedCount < coverage.expectedCount);
  /* Name them while they still fit; past three, a count reads better than
     a run-on list. Both this and the intro line COUNT rather than state a
     number: the copy has gone stale twice already as branches were added
     (five → seven with Pune, → eight with Agra). */
  const scopeLabel = useMemo(() => {
    if (!selected.length) return `All ${schools.length} schools`;
    const names = schools.filter((s) => selected.includes(s.code)).map((s) => s.name);
    if (!names.length) return `All ${schools.length} schools`;
    return names.length <= 3 ? names.join(" · ") : `${names.length} schools`;
  }, [selected, schools]);

  const csvHref =
    head
      ? `/api/admin/mcb/fees?view=students&format=xlsx&school=${encodeURIComponent(scope)}&head=${encodeURIComponent(head)}` +
        `${ayParam}&status=${status}${showLeft ? "&inactive=1" : ""}${grade ? `&grade=${encodeURIComponent(grade)}` : ""}${q ? `&q=${encodeURIComponent(q)}` : ""}`
      : "#";
  const totalPages = students ? Math.max(1, Math.ceil(students.total / students.pageSize)) : 1;
  const receiptsMode = students?.source === "receipts";

  return (
    <div className="fx">
      {busy > 0 ? <div className="fx-sweep"><i /></div> : null}

      {/* ── masthead ─────────────────────────────────────────────── */}
      <header className="fx-top">
        <div>
          <div className="fx-rule-eyebrow">
            <span className="kicker">MyClassBoard · Fee ledger</span>
          </div>
          <h1 className="fx-title">
            Who has paid.<br />
            <em>Who has not.</em>
          </h1>
          <p className="fx-sub">
            Every billed installment across the {schools.length} MCB schools — what was charged,
            what was conceded, what came in, and what is still outstanding.
          </p>
        </div>
        <div className="fx-top-right">
          <div className="fx-account">
            {currentEmail ? <span className="fx-account-who mono">{currentEmail}</span> : null}
            {canManageUsers ? (
              <a className="fx-page" href="/fees/users">Manage access</a>
            ) : null}
            <button
              className="fx-page"
              onClick={() => {
                fetch("/api/fees/auth/logout", { method: "POST" }).then(() => {
                  window.location.href = "/fees/login";
                });
              }}
            >
              Sign out
            </button>
          </div>
          <div className="fx-ay">
            {academicYears.map((y) => (
              <button
                key={y}
                data-on={ay === y ? "1" : "0"}
                onClick={() => { setAy(y); setPage(1); }}
              >
                {y}
              </button>
            ))}
            <button data-on={ay === null ? "1" : "0"} onClick={() => { setAy(null); setPage(1); }}>
              ALL YEARS
            </button>
          </div>
          <div className="kicker" style={{ textAlign: "right", lineHeight: 1.7 }}>
            Last receipt {fmtDate(lastReceipt)}
            <br />
            Synced {lastSynced ? fmtDate(lastSynced) : "—"}
          </div>
        </div>
      </header>

      {/* ── ledger band ──────────────────────────────────────────── */}
      <section className="fx-band">
        <div>
          <div className="kicker">
            Due so far · net of concession
            {partYear ? (
              /* The whole caveat, compressed to two words on the figure it
                 qualifies. It used to be a paragraph below the fold, which
                 is exactly where nobody reads a denominator. */
              <span
                className="fx-part"
                title={
                  `MyClassBoard has raised the whole year's instalments, but its receivables feed ` +
                  `only reports those DUE so far — ${coverage!.billedCount} of ${coverage!.expectedCount}. ` +
                  `The rest exist and are billed; they simply are not due yet, so this figure is not ` +
                  `comparable with a completed year` +
                  (coverage!.priorAy ? ` such as ${coverage!.priorAy}.` : ".") +
                  (coverage!.notYetBilled > 0 && coverage!.priorAy
                    ? ` The instalments still to come were worth ${inrShort(coverage!.notYetBilled)} in ${coverage!.priorAy}.`
                    : "")
                }
              >
                due so far
              </span>
            ) : null}
          </div>
          <div className="fx-figure">{inrShort(band.gross - band.concession)}</div>
          <div className="fx-note">{n0(band.students)} students · {scopeLabel}</div>
        </div>
        <div>
          <div className="kicker">Collected</div>
          <div className="fx-figure is-good">{inrShort(band.paid)}</div>
          <div className="fx-note">{pctLabel(band.paid, band.gross - band.concession)} of billed</div>
        </div>
        <div>
          <div className="kicker">Outstanding</div>
          <div className="fx-figure is-alert">{inrShort(band.balance)}</div>
          <div className="fx-note">
            {n0(band.pendingStudents)} students owe money
            {band.leftStudents > 0 ? (
              <>
                {" · "}
                <span className="fx-left-note">
                  excludes {inrShort(band.leftBalance)} billed to {n0(band.leftStudents)} who
                  have left
                </span>
              </>
            ) : null}
          </div>
        </div>
        <div>
          <div className="kicker">Concession granted</div>
          <div className="fx-figure">{inrShort(band.concession)}</div>
          <div className="fx-note">{pctLabel(band.concession, band.gross)} of gross billing</div>
        </div>
      </section>

      <CoverageStrip coverage={coverage} ay={ay} />

      {/* ── school index ─────────────────────────────────────────── */}
      <div className="fx-sec">
        <h2>01 — School</h2>
        <span className="kicker">
          Select to narrow every figure on this page · tick the corner square to
          compare several
          {selected.length > 1 ? (
            <>
              {" · "}
              <button className="fx-clear" onClick={() => applyScope([])}>
                clear {selected.length} selected
              </button>
            </>
          ) : null}
        </span>
      </div>
      <section className="fx-schools">
        <div className="fx-school" data-on={selected.length === 0 ? "1" : "0"}>
        <button className="fx-school-main" onClick={() => applyScope([])}>
          <div className="kicker">Consolidated</div>
          <div className="fx-school-name">All {schools.length} schools</div>
          <div className="fx-bar"><i style={{ width: `${pct(allTotals.paid, allTotals.gross - allTotals.concession)}%` }} /></div>
          <div className="fx-school-fig">
            <span>{pctLabel(allTotals.paid, allTotals.gross - allTotals.concession)} in</span>
            <span>{inrShort(allTotals.balance)} out</span>
          </div>
        </button>
        </div>
        {schools.map((s) => {
          const p = pct(s.paid, s.net);
          return (
            <div key={s.code} className="fx-school" data-on={selected.includes(s.code) ? "1" : "0"}>
            {/* Corner square adds this school to the comparison; the card
                body still opens it on its own, which is the common case. */}
            <button
              className="fx-pick"
              aria-pressed={selected.includes(s.code)}
              title={selected.includes(s.code)
                ? `Remove ${s.name} from the comparison`
                : `Add ${s.name} to the comparison`}
              onClick={(e) => { e.stopPropagation(); togglePick(s.code); }}
            >
              <span aria-hidden="true" />
            </button>
            <button className="fx-school-main" onClick={() => focusSchool(s.code)}>
              <div className="kicker">
                {s.code} · {n0(s.students)} students
                {currentYear && s.leftStudents > 0 ? (
                  <span className="fx-left-note" title="Since left — not counted">
                    {" "}+{n0(s.leftStudents)} left
                  </span>
                ) : null}
              </div>
              <div className="fx-school-name">{s.name}</div>
              <div className={`fx-bar${p < 75 ? " is-low" : ""}`}><i style={{ width: `${p}%` }} /></div>
              <div className="fx-school-fig">
                <span>{pctLabel(s.paid, s.net)} in</span>
                <span>{inrShort(s.balance)} out</span>
              </div>
            </button>
            </div>
          );
        })}
      </section>

      {/* ── receivables ageing ───────────────────────────────────── */}
      <div className="fx-sec">
        <h2>02 — Fee ageing</h2>
        <span className="kicker">
          {scopeLabel} · how long the unpaid fees have been overdue
          {ageing ? ` · as of ${fmtDate(ageing.asOf)}` : ""}
        </span>
        <span className="fx-exports">
          <a
            className="fx-csv"
            href={`/api/admin/mcb/fees?view=ageing&format=xlsx&school=${encodeURIComponent(scope)}${ayParam}`}
            title="Excel — one row per unpaid installment with its due date, days overdue and bucket"
          >
            Ageing Excel ↓
          </a>
        </span>
      </div>
      <AgeingPanel
        ageing={ageing}
        by={ageBy}
        setBy={setAgeBy}
        bucket={ageBucket}
        setBucket={(k) => { setAgeBucket(k); setAgePage(1); setAgeQInput(""); }}
        list={ageList}
        page={agePage}
        setPage={setAgePage}
        qInput={ageQInput}
        setQInput={setAgeQInput}
        exportBase={`/api/admin/mcb/fees?view=ageing&format=xlsx&school=${encodeURIComponent(scope)}${ayParam}`}
        consolidated={selected.length === 0}
        onSchool={(code) => focusSchool(code)}
        onHead={(h) => selectHead(h)}
      />

      {/* ── collection ageing ────────────────────────────────────── */}
      <div className="fx-sec">
        <h2>03 — Collection ageing</h2>
        <span className="kicker">
          {scopeLabel} · how long after the due date the paid fees came in
          {collection ? ` · as of ${fmtDate(collection.asOf)}` : ""}
        </span>
        <span className="fx-exports">
          <a
            className="fx-csv"
            href={`/api/admin/mcb/fees?view=collection&format=xlsx&school=${encodeURIComponent(scope)}${ayParam}`}
            title="Excel — one row per paid installment with its due date, paid date and days late"
          >
            Collection Excel ↓
          </a>
        </span>
      </div>
      <CollectionPanel
        data={collection}
        by={collBy}
        setBy={setCollBy}
        bucket={collBucket}
        setBucket={(k) => { setCollBucket(k); setCollPage(1); setCollQInput(""); }}
        list={collList}
        page={collPage}
        setPage={setCollPage}
        qInput={collQInput}
        setQInput={setCollQInput}
        consolidated={selected.length === 0}
        onSchool={(code) => focusSchool(code)}
        onHead={(h) => selectHead(h)}
        exportBase={`/api/admin/mcb/fees?view=collection&format=xlsx&school=${encodeURIComponent(scope)}${ayParam}`}
      />

      {/* ── fee-type index ───────────────────────────────────────── */}
      <div className="fx-sec">
        <h2>04 — Fee type</h2>
        <span className="kicker">
          {heads ? `${heads.length} types billed` : "loading"} · ordered by amount billed
        </span>
      </div>
      <section className="fx-heads">
        {(allHeads ? (heads ?? []) : (heads ?? []).slice(0, HEADS_SHOWN)).map((h) => {
          const p = pct(h.paid, h.net);
          return (
            <button
              key={h.feeHead}
              className={`fx-head${h.receiptOnly ? " is-receipt-only" : ""}`}
              data-on={head === h.feeHead ? "1" : "0"}
              onClick={() => selectHead(h.feeHead)}
            >
              <div className="fx-head-name">
                {h.feeHead}
                {h.receiptOnly ? <span className="fx-ro-tag">collected only</span> : null}
              </div>
              {h.receiptOnly ? (
                <>
                  <div className="fx-head-fig">
                    <span>{inrShort(h.paid)} in</span>
                    <span className="is-settled">never billed</span>
                  </div>
                  <div className="fx-note">
                    {n0(h.students)} students · receipts only
                  </div>
                </>
              ) : (
                <>
                  <div className={`fx-bar${p < 75 ? " is-low" : ""}`}><i style={{ width: `${p}%` }} /></div>
                  <div className="fx-head-fig">
                    <span>{inrShort(h.paid)} in</span>
                    <span className={h.balance > 0 ? "" : "is-settled"}>
                      {h.balance > 0 ? `${inrShort(h.balance)} out` : "settled"}
                    </span>
                  </div>
                  <div className="fx-note">
                    {n0(h.students)} students
                    {currentYear && (h.leftStudents ?? 0) > 0 ? (
                      <span className="fx-left-note" title="Billed this head, since left — not counted">
                        {" "}+{n0(h.leftStudents ?? 0)} left
                      </span>
                    ) : null}
                    {" · conc "}{pctLabel(h.concession, h.gross)}
                  </div>
                </>
              )}
            </button>
          );
        })}
        {heads && heads.length === 0 ? (
          <div className="fx-empty" style={{ gridColumn: "1 / -1" }}>No fees billed in this year</div>
        ) : null}
      </section>
      {heads && heads.length > HEADS_SHOWN ? (
        <button className="fx-more" onClick={() => setAllHeads((v) => !v)}>
          {allHeads
            ? "− Collapse to the six largest"
            : `+ ${heads.length - HEADS_SHOWN} more fee types (clubs, sports academies, trips)`}
        </button>
      ) : null}

      {/* ── ledger ───────────────────────────────────────────────── */}
      <div className="fx-sec">
        <h2>05 — {head ?? "Ledger"}</h2>
        <span className="kicker">
          {scopeLabel}
          {students ? ` · ${n0(students.totals.students)} students billed` : ""}
        </span>
      </div>

      <div className="fx-filters">
        {receiptsMode ? (
          <span className="fx-ro-banner">
            Never billed in MyClassBoard — showing what was actually collected
          </span>
        ) : null}
        {receiptsMode ? null : CHIPS.map((c) => (
          <button
            key={c.key}
            className="fx-chip"
            data-on={
              c.key === "concession"
                ? isConcessionStatus(status) ? "1" : "0"
                : status === c.key ? "1" : "0"
            }
            onClick={() => { setStatus(c.key); setPage(1); }}
          >
            {c.label}
            {students ? <b>{n0(c.countOf(students.totals))}</b> : null}
          </button>
        ))}
        {receiptsMode ? null : (
        <select className="fx-select" value={grade} onChange={(e) => { setGrade(e.target.value); setPage(1); }}>
          <option value="">ALL GRADES</option>
          {(students?.grades ?? []).map((g) => (
            <option key={g} value={g}>{g}</option>
          ))}
        </select>
        )}
        <input
          className="fx-input mono"
          value={qInput}
          onChange={(e) => setQInput(e.target.value)}
          placeholder="search name / enrolment / ref code / phone / receipt no"
        />
        {/* Kept as one unit: seven chips + a grade select + the search box
            leave no room, and letting the two links wrap independently put
            "Billing CSV" on top of the search placeholder. */}
        <span className="fx-exports">
          <a
            className="fx-csv"
            href={csvHref}
            title="Excel — one row per billed installment, matching every filter above"
          >
            Billing Excel ↓
          </a>
          <a
            className="fx-csv"
            href={`${csvHref}&level=receipts`}
            title="Excel — one row per receipted payment, with real receipt numbers"
          >
            Receipts Excel ↓
          </a>
        </span>
      </div>

      {!receiptsMode && students && students.totals.enrolledOnly
        && students.totals.leftStudents > 0 ? (
        <div className="fx-left-strip">
          <span className="kicker">Left the school</span>
          <span>
            <b>{n0(students.totals.leftStudents)}</b> student
            {students.totals.leftStudents === 1 ? "" : "s"} on this fee head have left.
            They were billed {inr(students.totals.leftGross)} and paid{" "}
            {inr(students.totals.leftPaid)} — both already counted above.{" "}
            {students.totals.leftBalance > 0 ? (
              <>
                The remaining <b>{inr(students.totals.leftBalance)}</b> is not chased and is
                not in Outstanding.
              </>
            ) : (
              <>Nothing is left outstanding against them.</>
            )}
          </span>
          <button
            className="fx-chip is-band"
            data-on={showLeft ? "1" : "0"}
            onClick={() => { setShowLeft((v) => !v); setPage(1); }}
          >
            {showLeft ? "Hide them" : "Show them"}
          </button>
        </div>
      ) : null}

      {isConcessionStatus(status) && !receiptsMode ? (
        <div className="fx-bands">
          <span className="kicker">Share of the amount originally billed</span>
          {CONCESSION_BANDS.map((b) => (
            <button
              key={b.key}
              className="fx-chip is-band"
              data-on={status === b.key ? "1" : "0"}
              onClick={() => { setStatus(b.key); setPage(1); }}
            >
              {b.label}
              {students ? <b>{n0(b.countOf(students.totals))}</b> : null}
            </button>
          ))}
        </div>
      ) : null}

      {receiptsMode ? (
        <div className="fx-tablewrap">
          <table className="fx-table">
            <thead>
              <tr>
                <th style={{ width: "32%" }}>Student</th>
                <th style={{ width: "9%" }}>Grade</th>
                <th className="num" style={{ width: "13%" }}>Collected</th>
                <th style={{ width: "18%" }}>Receipt</th>
                <th style={{ width: "16%" }}>Mode</th>
                <th style={{ width: "12%" }}>Paid on</th>
              </tr>
            </thead>
            <tbody>
              {(students?.receiptRows ?? []).map((r) => (
                <tr key={r.enrolment}>
                  <td>
                    <div className="fx-name">{r.name ?? "—"}</div>
                    <div className="fx-id">
                      {r.referenceCode ?? r.enrolment}
                      {r.mobile ? ` · ${r.mobile}` : ""}
                    </div>
                  </td>
                  <td className="mono fx-dim">
                    {shortGrade(r.grade)}{r.section ? `·${r.section}` : ""}
                  </td>
                  <td className="num fx-paid">{inr(r.paid)}</td>
                  <td className="mono">
                    {r.receipts.length ? (
                      r.receipts.map((no, i) => (
                        <span key={no}>
                          {i > 0 ? ", " : ""}
                          <a
                            className="fx-receipt-link"
                            href={`/fees/receipt/${encodeURIComponent(no)}?enrolment=${encodeURIComponent(r.enrolment)}`}
                            target="_blank"
                            rel="noopener"
                          >
                            {no}
                          </a>
                        </span>
                      ))
                    ) : (
                      <span className="fx-dim">—</span>
                    )}
                  </td>
                  <td className="fx-dim" style={{ fontSize: 12 }}>{r.paymentMode ?? "—"}</td>
                  <td className="mono fx-dim" style={{ fontSize: 11.5 }}>
                    {fmtDate(r.lastPaidDate)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {students && (students.receiptRows ?? []).length === 0 ? (
            <div className="fx-empty">No receipts match this filter</div>
          ) : null}
        </div>
      ) : (
      <div className="fx-tablewrap">
        <table className="fx-table">
          <thead>
            <tr>
              <th style={{ width: "27%" }}>Student</th>
              <th style={{ width: "7%" }}>Grade</th>
              <th className="num" style={{ width: "10%" }} title="Net of concession, for the instalments due so far">Due so far</th>
              <th className="num" style={{ width: "13%" }}>Concession</th>
              <th className="num" style={{ width: "10%" }}>Paid</th>
              <th className="num" style={{ width: "10%" }}>Balance</th>
              <th style={{ width: "12%" }} title="MCB voucher date — when the receivable was raised. The real payment date is on the receipt, inside the row.">Last voucher</th>
              <th style={{ width: "9%" }}>Status</th>
              <th style={{ width: "4%" }} />
            </tr>
          </thead>
          <tbody>
            {(students?.rows ?? []).map((r) => {
              const open = expanded.has(r.enrolment);
              return (
                <Fragment key={r.enrolment}>
                  <tr>
                    <td>
                      <div className="fx-name">{r.name ?? "—"}</div>
                      <div className="fx-id">
                        {r.referenceCode ?? r.enrolment}
                        {r.mobile ? ` · ${r.mobile}` : ""}
                      </div>
                    </td>
                    <td className="mono fx-dim">
                      {shortGrade(r.grade)}{r.section ? `·${r.section}` : ""}
                    </td>
                    <td className="num fx-billed">{inr(r.net)}</td>
                    <td className="num fx-conc">
                      {r.concession > 0 ? (
                        <>{inr(r.concession)}<span>{pctLabel(r.concession, r.gross)}</span></>
                      ) : (
                        <span className="fx-dim">—</span>
                      )}
                    </td>
                    <td className="num fx-paid">{inr(r.paid)}</td>
                    <td className={`num${r.balance > 0 ? " fx-owe" : " fx-dim"}`}>
                      {r.balance > 0 ? inr(r.balance) : "—"}
                    </td>
                    <td className="mono fx-dim" style={{ fontSize: 11.5 }}>
                      {fmtDate(r.lastPaidDate)}
                      {r.balance > 0 && r.nextDueDate ? (
                        <div style={{ color: "var(--brand)" }}>due {fmtDate(r.nextDueDate)}</div>
                      ) : null}
                    </td>
                    <td>
                      {r.hasLeft ? (
                        <span className="fx-tag left" title="No longer enrolled — not chased">
                          Left
                        </span>
                      ) : null}
                      {r.status === "paid" ? (
                        <span className="fx-tag paid">Paid</span>
                      ) : r.status === "partial" ? (
                        <span className="fx-tag part">{r.paidInstallments}/{r.installments} paid</span>
                      ) : (
                        <span className="fx-tag due">Yet to pay</span>
                      )}
                    </td>
                    <td>
                      <button
                        className="fx-expand"
                        title="Installment-wise detail"
                        onClick={() => {
                          if (!open) loadReceipts(r.enrolment);
                          setExpanded((prev) => {
                            const next = new Set(prev);
                            if (next.has(r.enrolment)) next.delete(r.enrolment);
                            else next.add(r.enrolment);
                            return next;
                          });
                        }}
                      >
                        {open ? "−" : "+"}
                      </button>
                    </td>
                  </tr>
                  {open ? (
                    <tr className="fx-sub">
                      <td colSpan={9}>
                        <div className="fx-sub-inner">
                          <table>
                            <thead>
                              <tr>
                                <th style={{ width: "20%" }}>Installment</th>
                                <th style={{ width: "15%" }}>Due</th>
                                <th className="num" style={{ width: "12%" }}>Billed</th>
                                <th className="num" style={{ width: "14%" }}>Concession</th>
                                <th className="num" style={{ width: "12%" }}>Paid</th>
                                <th className="num" style={{ width: "12%" }}>Balance</th>
                                <th style={{ width: "15%" }} title="MCB voucher date, not the payment date">Voucher</th>
                              </tr>
                            </thead>
                            <tbody>
                              {r.detail.map((d, i) => (
                                <tr key={i}>
                                  <td>{d.installment ?? "—"}</td>
                                  <td className="mono fx-dim">{fmtDate(d.dueDate)}</td>
                                  <td className="num fx-billed">{inr(Number(d.gross) - Number(d.concession))}</td>
                                  <td className="num fx-conc">
                                    {Number(d.concession) > 0 ? inr(Number(d.concession)) : <span className="fx-dim">—</span>}
                                  </td>
                                  <td className="num fx-paid">{inr(Number(d.paid))}</td>
                                  <td className={`num${Number(d.balance) > 0 ? " fx-owe" : " fx-dim"}`}>
                                    {Number(d.balance) > 0 ? inr(Number(d.balance)) : "—"}
                                  </td>
                                  <td className="mono fx-dim">{fmtDate(d.paidDate)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>

                          <ReceiptsPanel state={receipts[r.enrolment]} enrolment={r.enrolment} />
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
        {students && students.rows.length === 0 ? (
          <div className="fx-empty">No students match this filter</div>
        ) : null}
      </div>
      )}

      {students ? (
        <div className="fx-foot">
          <span>
            {n0(students.total)} students
            {status === "all"
              ? ""
              : ` · ${
                  (CHIPS.find((c) => c.key === status) ??
                    CONCESSION_BANDS.find((c) => c.key === status))!.label.toLowerCase()
                }${status === "concession90" || status === "concession50" ? " concession" : ""}`}
            {students.total > students.pageSize ? ` · page ${students.page} of ${totalPages}` : ""}
          </span>
          {students.total > students.pageSize ? (
            <span style={{ display: "flex", gap: 8 }}>
              <button className="fx-page" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                ← Prev
              </button>
              <button className="fx-page" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                Next →
              </button>
            </span>
          ) : null}
        </div>
      ) : null}

      <footer className="fx-colophon">
        <span>Source · MyClassBoard receivables, synced nightly</span>
        <span>
          &ldquo;Yet to pay&rdquo; = billed with money still outstanding. A student MCB never
          billed for a fee type does not appear under it. Students who have left are billed
          and collected as normal, but are never counted as outstanding.
        </span>
        <span><a href="/admin/mcb">MCB master data →</a></span>
      </footer>
    </div>
  );
}

/* ── receipts ────────────────────────────────────────────────────────
   MCB issues no receipt PDF — no endpoint in their API returns a receipt
   document — so this is the receipt *record*: the numbers, dates, modes
   and transaction ids the school's own system holds. It is fetched live
   per student, which is why it carries its own loading and failure states
   instead of arriving with the row. */
function ReceiptsPanel({
  state,
  enrolment,
}: {
  state: ReceiptState | undefined;
  enrolment: string;
}) {
  if (!state || state.state === "loading") {
    return (
      <div className="fx-receipts">
        <div className="fx-receipts-head">
          <span className="kicker">Receipts · live from MyClassBoard</span>
        </div>
        <div className="fx-receipts-msg">Fetching receipts…</div>
      </div>
    );
  }
  if (state.state === "error") {
    return (
      <div className="fx-receipts">
        <div className="fx-receipts-head">
          <span className="kicker">Receipts · live from MyClassBoard</span>
        </div>
        <div className="fx-receipts-msg is-bad">{state.message}</div>
      </div>
    );
  }
  return (
    <div className="fx-receipts">
      <div className="fx-receipts-head">
        <span className="kicker">Receipts · live from MyClassBoard</span>
        <span className="fx-receipts-total">
          {state.receipts.length
            ? `${n0(state.receipts.length)} receipted lines · ${inr(state.total)}`
            : ""}
        </span>
      </div>
      {state.errors?.length ? (
        <div className="fx-receipts-msg is-bad">{state.errors.join(" · ")}</div>
      ) : null}
      {state.receipts.length === 0 ? (
        <div className="fx-receipts-msg">
          MCB holds no receipt for this student{state.errors?.length ? " (see above)" : ""}.
        </div>
      ) : (
        <table className="fx-receipt-table">
          <thead>
            <tr>
              <th style={{ width: "13%" }}>Receipt no</th>
              <th style={{ width: "13%" }}>Paid on</th>
              <th className="num" style={{ width: "12%" }}>Amount</th>
              <th style={{ width: "17%" }}>Mode</th>
              <th style={{ width: "25%" }}>Against</th>
              <th style={{ width: "20%" }}>MCB transaction</th>
            </tr>
          </thead>
          <tbody>
            {state.receipts.map((x, i) => (
              <tr key={`${x.receiptNo}-${x.feeType}-${i}`}>
                <td className="mono fx-receipt-no">
                  {x.receiptNo ? (
                    <a
                      href={`/fees/receipt/${encodeURIComponent(x.receiptNo)}?enrolment=${encodeURIComponent(enrolment)}`}
                      target="_blank"
                      rel="noopener"
                      title="Open the printable receipt"
                    >
                      {x.receiptNo}
                    </a>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="mono">{fmtDate(x.paidDate)}</td>
                <td className="num fx-paid">{inr(x.amount)}</td>
                <td>
                  <span className={`fx-mode${x.isOnline ? " is-online" : ""}`}>
                    {x.mode ?? "—"}
                  </span>
                </td>
                <td className="fx-dim">{x.feeType ?? "—"}</td>
                <td className="mono fx-dim" style={{ fontSize: 11 }}>
                  {x.transactionId ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/* ── billing coverage ────────────────────────────────────────────────
   Why this exists: the headline reads "billed so far", and MCB raises an
   academic year's instalments across twelve months. Five months into
   2026-27 that figure was ~₹70 Cr against 2025-26's ~₹122 Cr, which looks
   like collapse and is nothing of the sort — 2026-27 is 36% AHEAD on the
   same five instalments. A number that invites the wrong conclusion needs
   its denominator on the page, not in someone's head. */
function AgeingPanel({
  ageing, by, setBy, consolidated, onSchool, onHead,
  bucket, setBucket, list, page, setPage, qInput, setQInput, exportBase,
}: {
  ageing: Ageing | null;
  by: "schools" | "heads" | "installments";
  setBy: (b: "schools" | "heads" | "installments") => void;
  consolidated: boolean;
  onSchool: (code: string) => void;
  onHead: (head: string) => void;
  bucket: string | null;
  setBucket: (k: string | null) => void;
  list: AgeList | null;
  page: number;
  setPage: (p: number) => void;
  qInput: string;
  setQInput: (v: string) => void;
  exportBase: string;
}) {
  if (!ageing) {
    return <section className="fx-age"><div className="fx-empty">Working out how old the dues are…</div></section>;
  }
  const total = ageing.total;
  if (total <= 0) {
    return (
      <section className="fx-age">
        <div className="fx-empty">Nothing is outstanding here. Every instalment due so far has been paid.</div>
      </section>
    );
  }
  const amt = (k: string) => ageing.buckets[k]?.balance ?? 0;
  const overdue = AGE_BUCKETS.filter((b) => b.tone.startsWith("a")).reduce((a, b) => a + amt(b.key), 0);
  const notDue = amt("not_due");
  const oldest = AGE_BUCKETS.filter((b) => b.tone.startsWith("a") && amt(b.key) > 0).pop();
  // Cards read left to right from the newest debt to the oldest, the way an
  // ageing report is laid out; only buckets that hold money appear.
  const cards = AGE_BUCKETS.filter((b) => amt(b.key) > 0);
  const biggest = Math.max(...cards.map((b) => amt(b.key)));
  const cols = cards;
  // A one-school scope broken down by school is a single row repeating the
  // headline — skip to fee type instead.
  const effBy = !consolidated && by === "schools" ? "heads" : by;
  const table = ageing[effBy];
  const open = bucket ? AGE_BUCKETS.find((b) => b.key === bucket) : null;
  const pages = list ? Math.max(1, Math.ceil(list.total / list.pageSize)) : 1;

  return (
    <section className="fx-age">
      <p className="fx-age-lead">
        <b className="is-out">{inrShort(overdue)}</b> is overdue
        {oldest && oldest.key !== "d0_30" ? <>, some of it for {oldest.since}</> : null}.
        {notDue > 0 ? (
          <> Another <b className="is-bill">{inrShort(notDue)}</b> is billed but not due yet.</>
        ) : null}
        <span className="fx-age-hint"> Click a card to see who owes it.</span>
      </p>

      <div className="fx-age-cards">
        {cards.map((b) => {
          const v = amt(b.key);
          const c = ageing.buckets[b.key];
          const on = bucket === b.key;
          return (
            <button
              key={b.key}
              className="fx-age-card"
              data-tone={b.tone}
              data-on={on ? "1" : "0"}
              onClick={() => setBucket(on ? null : b.key)}
            >
              <div className="fx-age-card-label">{b.label}</div>
              <div className="fx-age-card-amt">{inrShort(v)}</div>
              <div className="fx-age-card-bar"><i style={{ width: `${(v / biggest) * 100}%` }} /></div>
              <div className="fx-age-card-meta">{pctLabel(v, total)} · {n0(c.students)} students</div>
            </button>
          );
        })}
      </div>

      {open ? (
        <div className="fx-age-detail" data-tone={open.tone}>
          <div className="fx-age-detail-head">
            <div>
              <div className="kicker">{open.label}</div>
              <div className="fx-age-detail-sum">
                {list ? <>{n0(list.total)} students owe <b>{inrShort(list.balance)}</b></> : "Loading…"}
              </div>
            </div>
            <input
              className="fx-input"
              placeholder="Search name or enrolment"
              value={qInput}
              onChange={(e) => setQInput(e.target.value)}
            />
            <span className="fx-exports">
              <a className="fx-csv" href={`${exportBase}&bucket=${open.key}`}
                 title="Excel — one row per unpaid instalment in this bucket">
                This bucket Excel ↓
              </a>
              <button className="fx-page" onClick={() => setBucket(null)}>Close</button>
            </span>
          </div>
          <div className="fx-tablewrap">
            <table className="fx-table fx-age-list">
              <colgroup>
                <col style={{ width: "26%" }} />
                <col style={{ width: "12%" }} />
                <col />
                <col style={{ width: "12%" }} />
                <col style={{ width: "13%" }} />
              </colgroup>
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Class</th>
                  <th>Unpaid instalments</th>
                  <th>Oldest due</th>
                  <th className="num">Owes</th>
                </tr>
              </thead>
              <tbody>
                {(list?.rows ?? []).map((r) => (
                  <tr key={r.enrolment}>
                    <td>
                      <div className="fx-age-stu">{r.student}</div>
                      <div className="fx-age-sub mono">{r.enrolment}{consolidated && r.code ? ` · ${r.code}` : ""}</div>
                    </td>
                    <td>{shortGrade(r.className)}{r.section ? ` ${r.section}` : ""}</td>
                    <td className="fx-age-lines" title={r.lines}>{r.lines}</td>
                    <td>
                      {fmtDate(r.oldestDue)}
                      {r.daysOverdue != null && r.daysOverdue > 0 ? (
                        <div className="fx-age-sub">{n0(r.daysOverdue)} days ago</div>
                      ) : null}
                    </td>
                    <td className="num fx-owe">{inr(r.balance)}</td>
                  </tr>
                ))}
                {list && list.rows.length === 0 ? (
                  <tr><td colSpan={5}><div className="fx-empty">No one matches.</div></td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
          {list && pages > 1 ? (
            <div className="fx-pager">
              <button className="fx-page" disabled={page <= 1} onClick={() => setPage(page - 1)}>← Previous</button>
              <span className="kicker">Page {page} of {n0(pages)}</span>
              <button className="fx-page" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next →</button>
            </div>
          ) : null}
        </div>
      ) : null}

      <p className="fx-age-note">
        Counted per instalment: a student who has missed three months appears in three rows.
        {ageing.left.balance > 0 ? (
          <> Not counted: {inrShort(ageing.left.balance)} owed by {n0(ageing.left.students)} students who have left the school.</>
        ) : null}
      </p>

      <div className="fx-age-by">
        <span className="kicker">See the same by</span>
        {(consolidated
          ? (["schools", "heads", "installments"] as const)
          : (["heads", "installments"] as const)
        ).map((k) => (
          <button key={k} className="fx-chip" data-on={effBy === k ? "1" : "0"} onClick={() => setBy(k)}>
            {k === "schools" ? "School" : k === "heads" ? "Fee type" : "Instalment"}
          </button>
        ))}
      </div>

      <div className="fx-tablewrap">
        <table className="fx-table fx-age-table">
          <colgroup>
            <col style={{ width: "28%" }} />
            {cols.map((b) => <col key={b.key} />)}
            <col />
          </colgroup>
          <thead>
            <tr>
              <th>{effBy === "schools" ? "School" : effBy === "heads" ? "Fee type" : "Instalment"}</th>
              {cols.map((b) => (
                <th key={b.key} className="num" data-tone={b.tone}>{b.short}</th>
              ))}
              <th className="num">Total due</th>
            </tr>
          </thead>
          <tbody>
            {table.map((r) => {
              const name =
                effBy === "schools" && r.code ? (
                  <button className="fx-age-link" onClick={() => onSchool(r.code!)}>{r.name}</button>
                ) : effBy === "heads" ? (
                  <button className="fx-age-link" onClick={() => onHead(r.name)}>{r.name}</button>
                ) : (
                  <span>{r.name}{r.firstDue ? <span className="fx-age-due">due {fmtDate(r.firstDue)}</span> : null}</span>
                );
              return (
                <tr key={r.name}>
                  <td className="fx-age-name">{name}</td>
                  {cols.map((b) => {
                    const c = r.buckets[b.key];
                    return (
                      <td key={b.key} className="num" data-tone={c ? b.tone : undefined}
                          title={c ? `${n0(c.students)} students` : undefined}>
                        {c ? inrShort(c.balance) : <span className="fx-age-nil">—</span>}
                      </td>
                    );
                  })}
                  <td className="num fx-owe">{inrShort(r.total)}</td>
                </tr>
              );
            })}
          </tbody>
          {table.length > 1 ? (
            <tfoot>
              <tr>
                <td>All</td>
                {cols.map((b) => (
                  <td key={b.key} className="num" data-tone={b.tone}>{inrShort(amt(b.key))}</td>
                ))}
                <td className="num fx-owe">{inrShort(total)}</td>
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
    </section>
  );
}

function CollectionPanel({
  data, by, setBy, consolidated, onSchool, onHead,
  bucket, setBucket, list, page, setPage, qInput, setQInput, exportBase,
}: {
  data: Collection | null;
  by: "schools" | "heads" | "installments";
  setBy: (b: "schools" | "heads" | "installments") => void;
  consolidated: boolean;
  onSchool: (code: string) => void;
  onHead: (head: string) => void;
  bucket: string | null;
  setBucket: (k: string | null) => void;
  list: CollList | null;
  page: number;
  setPage: (p: number) => void;
  qInput: string;
  setQInput: (v: string) => void;
  exportBase: string;
}) {
  if (!data) {
    return <section className="fx-age"><div className="fx-empty">Working out how quickly fees were paid…</div></section>;
  }
  const total = data.total;
  if (total <= 0) {
    return (
      <section className="fx-age">
        <div className="fx-empty">No instalment has been paid in full yet in this scope.</div>
      </section>
    );
  }
  const amt = (k: string) => data.buckets[k]?.balance ?? 0;
  const onTime = amt("on_time");
  const unmatched = amt("unmatched");
  const matched = total - unmatched;
  const lateKeys = COLL_BUCKETS.filter((b) => b.tone.startsWith("a"));
  const late = lateKeys.reduce((a, b) => a + amt(b.key), 0);
  // Weighted average lateness across the late buckets, from the per-bucket
  // averages the API returns.
  let lateInst = 0, lateDays = 0;
  for (const b of lateKeys) {
    const c = data.buckets[b.key];
    if (c && c.avgDaysLate != null) { lateInst += c.installments; lateDays += c.avgDaysLate * c.installments; }
  }
  const avgLate = lateInst > 0 ? Math.round(lateDays / lateInst) : null;
  const cards = COLL_BUCKETS.filter((b) => amt(b.key) > 0);
  const biggest = Math.max(...cards.map((b) => amt(b.key)));
  const cols = cards;
  const effBy = !consolidated && by === "schools" ? "heads" : by;
  const table = data[effBy];
  const open = bucket ? COLL_BUCKETS.find((b) => b.key === bucket) : null;
  const pages = list ? Math.max(1, Math.ceil(list.total / list.pageSize)) : 1;

  return (
    <section className="fx-age">
      <p className="fx-age-lead">
        {matched > 0 ? (
          <>
            <b className="is-in">{pctLabel(onTime, matched)}</b> of the fees paid arrived by the due date
            {late > 0 && avgLate != null ? <>. The rest came in <b className="is-out">{n0(avgLate)} days</b> late on average</> : null}.
          </>
        ) : (
          <>None of the paid instalments could be matched to a receipt yet.</>
        )}
        <span className="fx-age-hint"> Click a card to see who paid when.</span>
      </p>

      <div className="fx-age-cards">
        {cards.map((b) => {
          const v = amt(b.key);
          const c = data.buckets[b.key];
          const on = bucket === b.key;
          return (
            <button
              key={b.key}
              className="fx-age-card"
              data-tone={b.tone}
              data-on={on ? "1" : "0"}
              onClick={() => setBucket(on ? null : b.key)}
            >
              <div className="fx-age-card-label">{b.label}</div>
              <div className="fx-age-card-amt">{inrShort(v)}</div>
              <div className="fx-age-card-bar"><i style={{ width: `${(v / biggest) * 100}%` }} /></div>
              <div className="fx-age-card-meta">
                {pctLabel(v, total)} · {n0(c.students)} students
                {c.avgDaysLate != null && b.tone.startsWith("a") ? ` · avg ${n0(c.avgDaysLate)} days` : ""}
              </div>
            </button>
          );
        })}
      </div>

      {open ? (
        <div className="fx-age-detail" data-tone={open.tone}>
          <div className="fx-age-detail-head">
            <div>
              <div className="kicker">{open.label}</div>
              <div className="fx-age-detail-sum">
                {list ? <>{n0(list.total)} students paid <b className="is-in">{inrShort(list.balance)}</b></> : "Loading…"}
              </div>
            </div>
            <input
              className="fx-input"
              placeholder="Search name or enrolment"
              value={qInput}
              onChange={(e) => setQInput(e.target.value)}
            />
            <span className="fx-exports">
              <a className="fx-csv" href={`${exportBase}&bucket=${open.key}`}
                 title="Excel — one row per paid instalment in this bucket">
                This bucket Excel ↓
              </a>
              <button className="fx-page" onClick={() => setBucket(null)}>Close</button>
            </span>
          </div>
          <div className="fx-tablewrap">
            <table className="fx-table fx-age-list">
              <colgroup>
                <col style={{ width: "26%" }} />
                <col style={{ width: "10%" }} />
                <col />
                <col style={{ width: "12%" }} />
                <col style={{ width: "11%" }} />
                <col style={{ width: "12%" }} />
              </colgroup>
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Class</th>
                  <th>Instalments paid</th>
                  <th>Last paid on</th>
                  <th className="num">Days late</th>
                  <th className="num">Paid</th>
                </tr>
              </thead>
              <tbody>
                {(list?.rows ?? []).map((r) => (
                  <tr key={r.enrolment}>
                    <td>
                      <div className="fx-age-stu">{r.student}</div>
                      <div className="fx-age-sub mono">{r.enrolment}{consolidated && r.code ? ` · ${r.code}` : ""}</div>
                    </td>
                    <td>{shortGrade(r.className)}{r.section ? ` ${r.section}` : ""}</td>
                    <td className="fx-age-lines" title={r.lines}>{r.lines}</td>
                    <td>{fmtDate(r.lastPaid)}</td>
                    <td className="num">
                      {r.daysLate == null ? "—" : r.daysLate <= 0 ? <span className="fx-paid">on time</span> : n0(r.daysLate)}
                      {r.avgDaysLate != null && r.installments > 1 && r.daysLate != null && r.daysLate > 0 ? (
                        <div className="fx-age-sub">avg {n0(r.avgDaysLate)}</div>
                      ) : null}
                    </td>
                    <td className="num fx-paid">{inr(r.balance)}</td>
                  </tr>
                ))}
                {list && list.rows.length === 0 ? (
                  <tr><td colSpan={6}><div className="fx-empty">No one matches.</div></td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
          {list && pages > 1 ? (
            <div className="fx-pager">
              <button className="fx-page" disabled={page <= 1} onClick={() => setPage(page - 1)}>← Previous</button>
              <span className="kicker">Page {page} of {n0(pages)}</span>
              <button className="fx-page" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next →</button>
            </div>
          ) : null}
        </div>
      ) : null}

      <p className="fx-age-note">
        Counted per fully paid instalment, dated by its latest MCB receipt.
        {unmatched > 0 ? (
          <> {inrShort(unmatched)} was paid but has no receipt line we could match, so its timing is unknown.</>
        ) : null}
        {data.partial.balance > 0 ? (
          <> Not counted: {inrShort(data.partial.balance)} of part-payments on instalments still open.</>
        ) : null}
      </p>

      <div className="fx-age-by">
        <span className="kicker">See the same by</span>
        {(consolidated
          ? (["schools", "heads", "installments"] as const)
          : (["heads", "installments"] as const)
        ).map((k) => (
          <button key={k} className="fx-chip" data-on={effBy === k ? "1" : "0"} onClick={() => setBy(k)}>
            {k === "schools" ? "School" : k === "heads" ? "Fee type" : "Instalment"}
          </button>
        ))}
      </div>

      <div className="fx-tablewrap">
        <table className="fx-table fx-age-table">
          <colgroup>
            <col style={{ width: "28%" }} />
            {cols.map((b) => <col key={b.key} />)}
            <col />
          </colgroup>
          <thead>
            <tr>
              <th>{effBy === "schools" ? "School" : effBy === "heads" ? "Fee type" : "Instalment"}</th>
              {cols.map((b) => (
                <th key={b.key} className="num" data-tone={b.tone}>{b.short}</th>
              ))}
              <th className="num">Total paid</th>
            </tr>
          </thead>
          <tbody>
            {table.map((r) => {
              const name =
                effBy === "schools" && r.code ? (
                  <button className="fx-age-link" onClick={() => onSchool(r.code!)}>{r.name}</button>
                ) : effBy === "heads" ? (
                  <button className="fx-age-link" onClick={() => onHead(r.name)}>{r.name}</button>
                ) : (
                  <span>{r.name}{r.firstDue ? <span className="fx-age-due">due {fmtDate(r.firstDue)}</span> : null}</span>
                );
              return (
                <tr key={r.name}>
                  <td className="fx-age-name">{name}</td>
                  {cols.map((b) => {
                    const c = r.buckets[b.key];
                    return (
                      <td key={b.key} className="num" data-tone={c ? b.tone : undefined}
                          title={c ? `${n0(c.students)} students` : undefined}>
                        {c ? inrShort(c.balance) : <span className="fx-age-nil">—</span>}
                      </td>
                    );
                  })}
                  <td className="num fx-paid">{inrShort(r.total)}</td>
                </tr>
              );
            })}
          </tbody>
          {table.length > 1 ? (
            <tfoot>
              <tr>
                <td>All</td>
                {cols.map((b) => (
                  <td key={b.key} className="num" data-tone={b.tone}>{inrShort(amt(b.key))}</td>
                ))}
                <td className="num fx-paid">{inrShort(total)}</td>
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
    </section>
  );
}

function CoverageStrip({ coverage, ay }: { coverage: Coverage | null; ay: string | null }) {
  if (!coverage || coverage.installments.length === 0) return null;
  const { billedCount, expectedCount, priorAy } = coverage;
  const complete = billedCount >= expectedCount;
  // Name the instalment the year has actually reached rather than assuming
  // September — the answer moves every month, and differs per school.
  const nextUp = coverage.installments.find((i) => !i.billed)?.name ?? null;
  const delta =
    coverage.priorSameSlice > 0
      ? ((coverage.currentNet - coverage.priorSameSlice) / coverage.priorSameSlice) * 100
      : null;

  return (
    <section className="fx-cov">
      <div className="fx-cov-head">
        <span className="kicker">
          Instalments due so far · {ay ?? "all years"}
        </span>
        <span className="fx-cov-count mono">
          {complete
            ? "whole year now due"
            : nextUp
              ? `${nextUp} onwards raised but not yet due`
              : "later instalments not yet due"}
        </span>
      </div>

      <ol className="fx-cov-rail">
        {coverage.installments.map((i) => (
          <li
            key={i.name}
            className={`fx-cov-chip${i.billed ? " is-billed" : ""}`}
            title={
              i.billed
                ? `${i.name} — ${inr(i.net)} billed`
                : `${i.name} — not raised yet${
                    i.priorNet > 0 && priorAy ? ` (${inr(i.priorNet)} in ${priorAy})` : ""
                  }`
            }
          >
            {i.name}
          </li>
        ))}
      </ol>

      {priorAy && coverage.priorSameSlice > 0 ? (
        <div className="fx-cov-compare">
          <div>
            <div className="kicker">{ay} · due so far</div>
            <div className="fx-cov-fig">{inrShort(coverage.currentNet)}</div>
          </div>
          <div>
            <div className="kicker">{priorAy} · same instalments</div>
            <div className="fx-cov-fig is-prior">{inrShort(coverage.priorSameSlice)}</div>
          </div>
          {delta !== null ? (
            <div>
              <div className="kicker">Like for like</div>
              <div className={`fx-cov-fig ${delta >= 0 ? "is-up" : "is-down"}`}>
                {delta >= 0 ? "+" : ""}
                {delta.toFixed(1)}%
              </div>
            </div>
          ) : null}
          <div>
            <div className="kicker">{priorAy} · whole year</div>
            <div className="fx-cov-fig is-prior">{inrShort(coverage.priorFull)}</div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
