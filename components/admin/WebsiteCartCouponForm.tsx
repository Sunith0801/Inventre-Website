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
import { Save, Trash2, RefreshCw } from "lucide-react";
import { Button } from "@/components/admin/ui/primitives-client";

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
  const [schoolErpName, setSchoolErpName] = useState<string | null>(
    init.schoolErpName,
  );
  const [studentErpName, setStudentErpName] = useState<string | null>(
    init.studentErpName,
  );
  const [grade, setGrade] = useState<string | null>(init.grade);
  const [gradeOptions, setGradeOptions] = useState<
    Array<{ grade: string; schoolGiven: string | null }>
  >([]);
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
        const list = (d.grades ?? []) as Array<{
          grade: string;
          schoolGiven: string | null;
        }>;
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
  const [startDatetime, setStartDatetime] = useState(
    init.startDatetime ? toLocalInput(init.startDatetime) : "",
  );
  const [endDatetime, setEndDatetime] = useState(
    init.endDatetime ? toLocalInput(init.endDatetime) : "",
  );
  const [oneTimeUse, setOneTimeUse] = useState(init.oneTimeUse);
  const [canUseMultipleTimes, setCanUseMultipleTimes] = useState(
    init.canUseMultipleTimes,
  );
  const [discountType, setDiscountType] = useState<DType>(init.discountType);
  const [discount, setDiscount] = useState(String(init.discount));
  const [maximumDiscountAmount, setMaximumDiscountAmount] = useState(
    String(init.maximumDiscountAmount),
  );
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
        setError(
          "Network error: " + (e instanceof Error ? e.message : "request failed"),
        );
      }
    });
  };

  const remove = () => {
    if (!init.id) return;
    if (!confirm("Delete this coupon? It will also be removed from ERPNext."))
      return;
    startDelete(async () => {
      try {
        const r = await fetch(`/api/admin/website-cart-coupons/${init.id}`, {
          method: "DELETE",
        });
        if (!r.ok) {
          const d = await r.json().catch(() => ({}));
          setError(d.error ?? `Delete failed (HTTP ${r.status})`);
          return;
        }
        router.push("/admin/discounts");
        router.refresh();
      } catch (e) {
        setError(
          "Network error: " + (e instanceof Error ? e.message : "request failed"),
        );
      }
    });
  };

  const randomize = () =>
    setCouponCode(
      "INV" +
        Math.random().toString(36).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8),
    );

  return (
    <form onSubmit={submit} className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Field label="Coupon code" required hint="Same field as ERPNext.coupon_code">
        <div className="flex gap-2">
          <input
            type="text"
            value={couponCode}
            onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
            required
            className={inputClass + " font-mono"}
            placeholder="INVABC1234"
          />
          {mode === "new" ? (
            <button
              type="button"
              onClick={randomize}
              className="h-9 px-3 rounded-lg border border-ink-200 bg-white text-[12px] font-semibold text-ink-700 hover:bg-cream-50 inline-flex items-center gap-1.5"
              title="Generate random code"
            >
              <RefreshCw className="h-3.5 w-3.5" /> Generate
            </button>
          ) : null}
        </div>
      </Field>

      <Field label="Active">
        <label className="flex items-center gap-2 h-9">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
            className="h-4 w-4"
          />
          <span className="text-[13px] text-ink-700">
            Coupon is currently redeemable
          </span>
        </label>
      </Field>

      <Field label="School" hint="Optional — restricts coupon to one school">
        <ErpLinkPicker
          kind="school"
          value={schoolErpName}
          onChange={setSchoolErpName}
          placeholder="Any school"
        />
      </Field>
      <Field label="Student" hint="Optional — restricts coupon to one student">
        <ErpLinkPicker
          kind="student"
          value={studentErpName}
          onChange={setStudentErpName}
          placeholder="Any student"
        />
      </Field>

      <Field
        label="Grade"
        hint={
          schoolErpName
            ? "Optional — restricts coupon to one grade within the school"
            : "Pick a school first to enable grade selection"
        }
        className="lg:col-span-2"
      >
        <select
          value={grade ?? ""}
          onChange={(e) => setGrade(e.target.value || null)}
          disabled={!schoolErpName || loadingGrades}
          className={inputClass + " disabled:opacity-50"}
        >
          <option value="">
            {!schoolErpName
              ? "— Any grade (no school selected) —"
              : loadingGrades
                ? "Loading grades…"
                : gradeOptions.length === 0
                  ? "— No grades mapped for this school —"
                  : "— Any grade —"}
          </option>
          {gradeOptions.map((g) => (
            <option key={g.grade} value={g.grade}>
              {g.grade}
              {g.schoolGiven ? ` · ${g.schoolGiven}` : ""}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Start date / time">
        <input
          type="datetime-local"
          value={startDatetime}
          onChange={(e) => setStartDatetime(e.target.value)}
          className={inputClass}
        />
      </Field>
      <Field label="End date / time">
        <input
          type="datetime-local"
          value={endDatetime}
          onChange={(e) => setEndDatetime(e.target.value)}
          className={inputClass}
        />
      </Field>

      <Field label="One time use">
        <label className="flex items-center gap-2 h-9">
          <input
            type="checkbox"
            checked={oneTimeUse}
            onChange={(e) => setOneTime(e.target.checked)}
            className="h-4 w-4"
          />
          <span className="text-[13px] text-ink-700">
            Single redemption across the entire site
          </span>
        </label>
      </Field>
      <Field label="Can be used multiple times">
        <label className="flex items-center gap-2 h-9">
          <input
            type="checkbox"
            checked={canUseMultipleTimes}
            onChange={(e) => setMulti(e.target.checked)}
            className="h-4 w-4"
          />
          <span className="text-[13px] text-ink-700">
            Reusable per customer (mutually exclusive with above)
          </span>
        </label>
      </Field>

      <Field label="Discount type" required>
        <select
          value={discountType}
          onChange={(e) => setDiscountType(e.target.value as DType)}
          className={inputClass}
        >
          <option value="Fixed">Fixed (₹)</option>
          <option value="Percentage">Percentage (%)</option>
        </select>
      </Field>
      <Field
        label={discountType === "Percentage" ? "Discount (%)" : "Discount (₹)"}
        required
      >
        <input
          type="number"
          step="0.01"
          min={0}
          max={discountType === "Percentage" ? 100 : undefined}
          value={discount}
          onChange={(e) => setDiscount(e.target.value)}
          required
          className={inputClass}
        />
      </Field>

      <Field
        label="Maximum discount amount (₹)"
        hint={
          discountType === "Percentage"
            ? "Caps the % discount; 0 = no cap"
            : "Ignored for Fixed type"
        }
        className="lg:col-span-2"
      >
        <input
          type="number"
          min={0}
          step={1}
          value={maximumDiscountAmount}
          onChange={(e) => setMaximumDiscountAmount(e.target.value)}
          disabled={discountType === "Fixed"}
          className={inputClass + " disabled:opacity-50"}
        />
      </Field>

      <div className="lg:col-span-2 flex items-center justify-between pt-2">
        <div className="text-[11px] text-ink-500">
          {init.erpName ? (
            <>
              ERPNext docname:{" "}
              <span className="font-mono text-ink-700">{init.erpName}</span>
            </>
          ) : mode === "new" ? (
            "Will be created in ERPNext on save"
          ) : (
            "Local-only (not yet synced to ERPNext)"
          )}
        </div>
        <div className="flex items-center gap-3">
          {error ? <span className="text-[13px] text-red-700">{error}</span> : null}
          {mode === "edit" ? (
            <button
              type="button"
              onClick={remove}
              disabled={deleting || pending}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-[12px] font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" />
              {deleting ? "Deleting…" : "Delete"}
            </button>
          ) : null}
          <Button busy={pending} icon={<Save className="h-3.5 w-3.5" />} type="submit">
            {mode === "new" ? "Create coupon" : "Save changes"}
          </Button>
        </div>
      </div>
    </form>
  );
}

/* ───────────────────────────────────────────────────────────────────── */
/* ERP-link picker — type-ahead resolver against local mirror tables,    */
/* returns the canonical ERP `name` string so the saved value is what    */
/* ERPNext stores.                                                       */
function ErpLinkPicker({
  kind,
  value,
  onChange,
  placeholder,
}: {
  kind: "school" | "student";
  value: string | null;
  onChange: (v: string | null) => void;
  placeholder?: string;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<
    Array<{ erpName: string; label: string }>
  >([]);
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
    const id = window.setTimeout(async () => {
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
        const rows = (d.results ?? []) as Array<{
          erpName: string;
          name?: string;
          firstName?: string;
          lastName?: string;
        }>;
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
      window.clearTimeout(id);
    };
  }, [q, open, kind]);

  return (
    <div className="relative" ref={wrapRef}>
      {value ? (
        <div className="flex items-center gap-2">
          <span className="flex-1 h-9 px-3 inline-flex items-center rounded-lg bg-cream-50 border border-ink-200 text-[12.5px] font-mono text-ink-800 truncate">
            {value}
          </span>
          <button
            type="button"
            onClick={() => onChange(null)}
            className="h-9 px-2.5 rounded-lg border border-ink-200 text-[12px] text-ink-600 hover:bg-cream-50"
            title="Clear"
          >
            ✕
          </button>
        </div>
      ) : (
        <input
          type="text"
          value={q}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          placeholder={placeholder ?? `Search ${kind}…`}
          className={inputClass}
        />
      )}
      {open && !value ? (
        <div className="absolute z-30 left-0 right-0 mt-1 max-h-72 overflow-auto rounded-lg border border-ink-200 bg-white shadow-lg">
          {loading ? (
            <div className="px-3 py-2 text-[12px] text-ink-400">Searching…</div>
          ) : results.length === 0 ? (
            <div className="px-3 py-2 text-[12px] text-ink-400">
              {kind === "student" && q.trim().length < 2
                ? "Type at least 2 letters"
                : "No matches"}
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
                className="w-full text-left px-3 py-2 text-[12.5px] hover:bg-cream-50 border-b border-ink-50 last:border-0"
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

const inputClass =
  "w-full h-9 px-3 text-[13px] rounded-lg bg-white border border-ink-200 placeholder:text-ink-400 " +
  "focus:outline-none focus:border-ink-400 focus:ring-2 focus:ring-brand-300/30 transition";

function Field({
  label,
  hint,
  required,
  children,
  className,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={"block " + (className ?? "")}>
      <span className="text-[12px] font-semibold text-ink-700">
        {label}
        {required ? <span className="text-red-600 ml-0.5">*</span> : null}
      </span>
      {hint ? <span className="text-[11px] text-ink-500 ml-2">{hint}</span> : null}
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
