"use client";

/**
 * Mirrors the ERPNext "Website Cart Coupon" form 1:1 — field labels and
 * grouping match the doctype at erp.inventre.in/app/website-cart-coupon.
 *
 * On submit, the API route pushes to ERP first then upserts locally so
 * the two systems stay in sync. New coupons can omit `id`; edits pass it.
 */
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Save, Trash2, RefreshCw, X } from "lucide-react";
import {
  Button,
  Field,
  FormError,
  FormGrid,
  Input,
  Select,
} from "@/components/admin/ui/primitives";

type DType = "Fixed" | "Percentage";

export type CouponInitial = {
  id?: string;
  erpName?: string | null;
  couponCode: string;
  isActive: boolean;
  schoolErpName: string | null;
  studentErpName: string | null;
  /** Local-only optional scope; ignored when no school is set. */
  grade: string | null;
  startDatetime: string | null; // ISO
  endDatetime: string | null;
  oneTimeUse: boolean;
  canUseMultipleTimes: boolean;
  discountType: DType;
  discount: number;
  maximumDiscountAmount: number;
};

const EMPTY: CouponInitial = {
  couponCode: "",
  isActive: true,
  schoolErpName: null,
  studentErpName: null,
  grade: null,
  startDatetime: null,
  endDatetime: null,
  oneTimeUse: true,
  canUseMultipleTimes: false,
  discountType: "Fixed",
  discount: 0,
  maximumDiscountAmount: 0,
};

/** A small heading over one row of fields — the form reads as four rows. */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2.5">
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-500">{title}</h3>
      {children}
    </section>
  );
}

export function WebsiteCartCouponForm({
  initial,
  mode,
}: {
  initial?: CouponInitial;
  mode: "new" | "edit";
}) {
  const router = useRouter();
  const init = initial ?? EMPTY;
  const [couponCode, setCouponCode] = useState(init.couponCode);
  const [isActive, setIsActive] = useState(init.isActive);
  const [schoolErpName, setSchoolErpName] = useState<string | null>(init.schoolErpName);
  const [studentErpName, setStudentErpName] = useState<string | null>(init.studentErpName);
  const [grade, setGrade] = useState<string | null>(init.grade);
  const [gradeOptions, setGradeOptions] = useState<Array<{ grade: string; schoolGiven: string | null }>>([]);
  const [loadingGrades, setLoadingGrades] = useState(false);

  // Load grades whenever the selected school changes. Clearing the school
  // also clears the grade — grade only makes sense scoped to a school.
  useEffect(() => {
    if (!schoolErpName) {
      setGradeOptions([]);
      setGrade(null);
      return;
    }
    const ctrl = new AbortController();
    setLoadingGrades(true);
    fetch(
      `/api/admin/website-cart-coupons/school-grades?school=${encodeURIComponent(schoolErpName)}`,
      { signal: ctrl.signal },
    )
      .then((r) => r.json())
      .then((d) => {
        const list = (d.grades ?? []) as Array<{ grade: string; schoolGiven: string | null }>;
        setGradeOptions(list);
        // Drop the current grade if the new school doesn't offer it.
        if (grade && !list.some((g) => g.grade === grade)) setGrade(null);
      })
      .catch(() => {})
      .finally(() => setLoadingGrades(false));
    return () => ctrl.abort();
    // intentionally not depending on `grade` — we only re-fetch on school change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schoolErpName]);
  const [startDatetime, setStartDatetime] = useState(init.startDatetime ? toLocalInput(init.startDatetime) : "");
  const [endDatetime, setEndDatetime] = useState(init.endDatetime ? toLocalInput(init.endDatetime) : "");
  const [oneTimeUse, setOneTimeUse] = useState(init.oneTimeUse);
  const [canUseMultipleTimes, setCanUseMultipleTimes] = useState(init.canUseMultipleTimes);
  const [discountType, setDiscountType] = useState<DType>(init.discountType);
  const [discount, setDiscount] = useState(String(init.discount));
  const [maximumDiscountAmount, setMaximumDiscountAmount] = useState(String(init.maximumDiscountAmount));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [deleting, startDelete] = useTransition();

  // ERP forbids both one_time_use and can_use_multiple_times being true at
  // the same time. Mirror that constraint here so the form can't enter
  // an unsavable state.
  function setOneTime(v: boolean) {
    setOneTimeUse(v);
    if (v) setCanUseMultipleTimes(false);
  }
  function setMulti(v: boolean) {
    setCanUseMultipleTimes(v);
    if (v) setOneTimeUse(false);
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!couponCode.trim()) return setError("Coupon code is required");
    const disc = Number(discount);
    if (!Number.isFinite(disc) || disc < 0) return setError("Discount must be ≥ 0");
    if (discountType === "Percentage" && disc > 100)
      return setError("Percentage discount cannot exceed 100");

    const body = {
      couponCode: couponCode.trim(),
      isActive,
      schoolErpName: schoolErpName || null,
      studentErpName: studentErpName || null,
      grade: schoolErpName && grade ? grade : null,
      startDatetime: startDatetime ? new Date(startDatetime).toISOString() : null,
      endDatetime: endDatetime ? new Date(endDatetime).toISOString() : null,
      oneTimeUse,
      canUseMultipleTimes,
      discountType,
      discount: disc,
      maximumDiscountAmount: Number(maximumDiscountAmount) || 0,
    };

    start(async () => {
      const url =
        mode === "new"
          ? "/api/admin/website-cart-coupons"
          : `/api/admin/website-cart-coupons/${init.id}`;
      try {
        const r = await fetch(url, {
          method: mode === "new" ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!r.ok) {
          const d = await r.json().catch(() => ({}));
          // Zod / validation errors come back as `issues`; surface the first.
          const msg =
            d.error ??
            (Array.isArray(d.issues) && d.issues[0]?.message) ??
            `Save failed (HTTP ${r.status})`;
          setError(msg);
          return;
        }
        router.push("/admin/discounts");
        router.refresh();
      } catch (e) {
        // Network error, CSP, abort — without this catch useTransition swallows
        // the rejection and the button just returns to idle with no feedback.
        setError("Network error: " + (e instanceof Error ? e.message : "request failed"));
      }
    });
  };

  const remove = () => {
    if (!init.id) return;
    if (!confirm("Delete this coupon? It will also be removed from ERPNext.")) return;
    startDelete(async () => {
      try {
        const r = await fetch(`/api/admin/website-cart-coupons/${init.id}`, { method: "DELETE" });
        if (!r.ok) {
          const d = await r.json().catch(() => ({}));
          setError(d.error ?? `Delete failed (HTTP ${r.status})`);
          return;
        }
        router.push("/admin/discounts");
        router.refresh();
      } catch (e) {
        setError("Network error: " + (e instanceof Error ? e.message : "request failed"));
      }
    });
  };

  const randomize = () =>
    setCouponCode(
      "INV" + Math.random().toString(36).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8),
    );

  const isPct = discountType === "Percentage";

  return (
    <form onSubmit={submit} className="space-y-5">
      <Section title="Code">
        <FormGrid cols={3}>
          <Field label="Coupon code" htmlFor="cp-code" required className="md:col-span-2 lg:col-span-2">
            <div className="flex gap-2">
              <Input
                id="cp-code"
                value={couponCode}
                onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                required
                placeholder="INVABC1234"
                className="font-mono"
                readOnly={mode === "edit"}
              />
              {mode === "new" ? (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={randomize}
                  icon={<RefreshCw className="h-3.5 w-3.5" />}
                  title="Generate a random code"
                >
                  Generate
                </Button>
              ) : null}
            </div>
          </Field>
          <Field label="Status" htmlFor="cp-active">
            <Select id="cp-active" value={isActive ? "1" : "0"} onChange={(e) => setIsActive(e.target.value === "1")}>
              <option value="1">Active</option>
              <option value="0">Inactive</option>
            </Select>
          </Field>
        </FormGrid>
      </Section>

      <Section title="Who can use it">
        <FormGrid cols={3}>
          <Field label="School" htmlFor="cp-school">
            <ErpLinkPicker id="cp-school" kind="school" value={schoolErpName} onChange={setSchoolErpName} placeholder="Any school" />
          </Field>
          <Field label="Student" htmlFor="cp-student">
            <ErpLinkPicker id="cp-student" kind="student" value={studentErpName} onChange={setStudentErpName} placeholder="Any student" />
          </Field>
          <Field label="Grade" htmlFor="cp-grade">
            <Select
              id="cp-grade"
              value={grade ?? ""}
              onChange={(e) => setGrade(e.target.value || null)}
              disabled={!schoolErpName || loadingGrades}
            >
              <option value="">
                {!schoolErpName
                  ? "Any grade"
                  : loadingGrades
                    ? "Loading grades…"
                    : gradeOptions.length === 0
                      ? "No grades mapped for this school"
                      : "Any grade"}
              </option>
              {gradeOptions.map((g) => (
                <option key={g.grade} value={g.grade}>
                  {g.grade}
                  {g.schoolGiven ? ` · ${g.schoolGiven}` : ""}
                </option>
              ))}
            </Select>
          </Field>
        </FormGrid>
      </Section>

      <Section title="Validity">
        <FormGrid cols={3}>
          <Field label="Starts" htmlFor="cp-start">
            <Input id="cp-start" type="datetime-local" value={startDatetime} onChange={(e) => setStartDatetime(e.target.value)} />
          </Field>
          <Field label="Ends" htmlFor="cp-end">
            <Input id="cp-end" type="datetime-local" value={endDatetime} onChange={(e) => setEndDatetime(e.target.value)} />
          </Field>
          <Field label="Usage" htmlFor="cp-usage">
            {/* ERP forbids one_time_use and can_use_multiple_times both set;
                one control makes the invalid combination unreachable. */}
            <Select
              id="cp-usage"
              value={oneTimeUse ? "once" : canUseMultipleTimes ? "multi" : "default"}
              onChange={(e) => {
                if (e.target.value === "once") setOneTime(true);
                else if (e.target.value === "multi") setMulti(true);
                else { setOneTimeUse(false); setCanUseMultipleTimes(false); }
              }}
            >
              <option value="once">One-time use</option>
              <option value="multi">Reusable</option>
              <option value="default">Not set</option>
            </Select>
          </Field>
        </FormGrid>
      </Section>

      <Section title="Discount">
        <FormGrid cols={3}>
          <Field label="Type" htmlFor="cp-type" required>
            <Select id="cp-type" value={discountType} onChange={(e) => setDiscountType(e.target.value as DType)}>
              <option value="Fixed">Fixed amount (₹)</option>
              <option value="Percentage">Percentage (%)</option>
            </Select>
          </Field>
          <Field label={isPct ? "Discount (%)" : "Discount (₹)"} htmlFor="cp-discount" required>
            <Input
              id="cp-discount"
              type="number"
              step="0.01"
              min={0}
              max={isPct ? 100 : undefined}
              value={discount}
              onChange={(e) => setDiscount(e.target.value)}
              required
            />
          </Field>
          <Field label="Maximum discount (₹)" htmlFor="cp-cap">
            <Input
              id="cp-cap"
              type="number"
              min={0}
              step={1}
              value={maximumDiscountAmount}
              onChange={(e) => setMaximumDiscountAmount(e.target.value)}
              disabled={!isPct}
            />
          </Field>
        </FormGrid>
      </Section>

      <FormError>{error}</FormError>

      <div className="flex items-center justify-between gap-2 border-t border-ink-100/70 pt-4">
        <div>
          {mode === "edit" ? (
            <Button
              type="button"
              variant="danger"
              onClick={remove}
              busy={deleting}
              disabled={pending}
              icon={<Trash2 className="h-3.5 w-3.5" />}
            >
              Delete
            </Button>
          ) : null}
        </div>
        <Button busy={pending} icon={<Save className="h-3.5 w-3.5" />} type="submit">
          {mode === "new" ? "Create coupon" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}

/* ───────────────────────────────────────────────────────────────────── */
/* ERP-link picker — type-ahead resolver against local mirror tables,    */
/* returns the canonical ERP `name` string so the saved value is what    */
/* ERPNext stores.                                                       */
function ErpLinkPicker({
  id,
  kind,
  value,
  onChange,
  placeholder,
}: {
  id?: string;
  kind: "school" | "student";
  value: string | null;
  onChange: (v: string | null) => void;
  placeholder?: string;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<Array<{ erpName: string; label: string }>>([]);
  const [loading, setLoading] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  useEffect(() => {
    if (!open) return;
    const ctrl = new AbortController();
    const timer = window.setTimeout(async () => {
      if (kind === "student" && q.trim().length < 2) {
        setResults([]);
        return;
      }
      setLoading(true);
      try {
        const r = await fetch(
          `/api/admin/website-cart-coupons/erp-links?kind=${kind}&q=${encodeURIComponent(q)}`,
          { signal: ctrl.signal },
        );
        const d = await r.json();
        const rows = (d.results ?? []) as Array<{ erpName: string; name?: string; firstName?: string; lastName?: string }>;
        setResults(
          rows.map((row) => ({
            erpName: row.erpName,
            label:
              kind === "school"
                ? `${row.name ?? ""} · ${row.erpName}`
                : `${[row.firstName, row.lastName].filter(Boolean).join(" ")} · ${row.erpName}`,
          })),
        );
      } catch {
        // aborted
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => {
      ctrl.abort();
      window.clearTimeout(timer);
    };
  }, [q, open, kind]);

  return (
    <div className="relative" ref={wrapRef}>
      {value ? (
        <div className="flex h-9 items-center gap-2 rounded-lg border border-ink-100 bg-cream-50 pl-3 pr-1">
          <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-ink-800">{value}</span>
          <button
            type="button"
            onClick={() => onChange(null)}
            className="grid h-7 w-7 place-items-center rounded-md text-ink-400 hover:bg-white hover:text-ink-900"
            aria-label="Clear"
            title="Clear"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <Input
          id={id}
          value={q}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          placeholder={placeholder ?? `Search ${kind}…`}
          autoComplete="off"
        />
      )}
      {open && !value ? (
        <div className="absolute left-0 right-0 z-30 mt-1 max-h-72 overflow-auto rounded-xl border border-ink-100 bg-white shadow-[0_12px_32px_-12px_rgba(10,10,10,0.25)]">
          {loading ? (
            <div className="px-3 py-2 text-[12px] text-ink-400">Searching…</div>
          ) : results.length === 0 ? (
            <div className="px-3 py-2 text-[12px] text-ink-400">
              {kind === "student" && q.trim().length < 2 ? "Type at least 2 letters" : "No matches"}
            </div>
          ) : (
            results.map((r) => (
              <button
                key={r.erpName}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onChange(r.erpName);
                  setOpen(false);
                  setQ("");
                }}
                className="block w-full border-b border-ink-50 px-3 py-2 text-left text-[12.5px] last:border-0 hover:bg-cream-50"
              >
                {r.label}
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
