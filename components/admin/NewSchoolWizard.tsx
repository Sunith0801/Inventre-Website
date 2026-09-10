"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Plus, AlertCircle, Eye, Library, Tag, ArrowRight } from "lucide-react";
import { cn } from "@/lib/cn";

export type MasterGrade = {
  name: string;
  common: boolean;
  inUse: boolean;
  code: string | null;
};

type Step = 1 | 2 | 3;

type SchoolBasics = {
  schoolCode: string;
  schoolName: string;
  branchName: string;
  city: string;
  status: "Onboarding" | "Active" | "Inactive";
  uniformDetailsCheckbox: boolean;
  booksDetailsCheckbox: boolean;
};

type GradeRow = {
  /** Either a canonical name from master, or a custom typed string. */
  name: string;
  /** What this school calls it (e.g. "IK 1"). Empty = use canonical. */
  schoolGiven: string;
  /** Sections served at this grade — free text (e.g. "A,B,C"). Optional. */
  sections: string;
  checked: boolean;
};

export function NewSchoolWizard({ masterGrades }: { masterGrades: MasterGrade[] }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // ── Step 1 state ────────────────────────────────────────────────
  const [basics, setBasics] = useState<SchoolBasics>({
    schoolCode: "",
    schoolName: "",
    branchName: "",
    city: "",
    status: "Onboarding",
    uniformDetailsCheckbox: false,
    booksDetailsCheckbox: false,
  });
  const [createdSchoolId, setCreatedSchoolId] = useState<string | null>(null);

  // ── Step 2 state — initial grade rows derived from master + pre-checked ─
  const initialGrades: GradeRow[] = useMemo(
    () =>
      masterGrades.map((g) => ({
        name: g.name,
        schoolGiven: "",
        sections: "",
        checked: g.common,
      })),
    [masterGrades]
  );
  const [gradeRows, setGradeRows] = useState<GradeRow[]>(initialGrades);
  const [customGrade, setCustomGrade] = useState("");

  const selectedCount = gradeRows.filter((g) => g.checked).length;

  // ── Step 1 submit ───────────────────────────────────────────────
  const submitBasics = () => {
    setError(null);
    if (!basics.schoolCode.trim() || !basics.schoolName.trim()) {
      setError("School code and name are both required.");
      return;
    }
    start(async () => {
      try {
        const r = await fetch("/api/admin/data/schools", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            schoolCode: basics.schoolCode.trim(),
            schoolName: basics.schoolName.trim(),
            branchName: basics.branchName.trim() || null,
            city: basics.city.trim() || null,
            status: basics.status,
            uniformDetailsCheckbox: basics.uniformDetailsCheckbox,
            booksDetailsCheckbox: basics.booksDetailsCheckbox,
          }),
        });
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          throw new Error(j.error ?? `HTTP ${r.status}`);
        }
        const j = (await r.json()) as { id: string };
        setCreatedSchoolId(j.id);
        setStep(2);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to create school.");
      }
    });
  };

  // ── Step 2 submit (one POST per checked grade) ──────────────────
  const submitGrades = () => {
    if (!createdSchoolId) return;
    setError(null);
    const picked = gradeRows.filter((g) => g.checked);
    if (picked.length === 0) {
      setError("Pick at least one grade — you can always add more later.");
      return;
    }
    start(async () => {
      try {
        // Single round-trip via the bulk endpoint. Existing grades for this
        // school (none here, since the school was just created) are skipped
        // server-side, so re-submitting after a network blip is safe.
        const r = await fetch(
          `/api/admin/data/schools/${createdSchoolId}/grade-mappings/bulk`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              rows: picked.map((g) => ({
                grade: g.name,
                schoolGivenGradeName: g.schoolGiven.trim() || null,
                sections: g.sections.trim() || null,
              })),
            }),
          }
        );
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          throw new Error(j.error ?? `HTTP ${r.status}`);
        }
        setStep(3);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to save grade mappings.");
      }
    });
  };

  const updateGrade = (idx: number, patch: Partial<GradeRow>) => {
    setGradeRows((rows) => rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };

  const addCustomGrade = () => {
    const name = customGrade.trim();
    if (!name) return;
    if (gradeRows.some((g) => g.name.toLowerCase() === name.toLowerCase())) {
      setError(`"${name}" is already in the list.`);
      return;
    }
    setGradeRows((rows) => [
      ...rows,
      { name, schoolGiven: "", sections: "", checked: true },
    ]);
    setCustomGrade("");
    setError(null);
  };

  return (
    <div className="space-y-4">
      {error && (
        <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-red-50 border border-red-200 text-[13px] text-red-800">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <StepCard
        n={1}
        title="School basics"
        done={step > 1}
        active={step === 1}
        locked={false}
      >
        <fieldset disabled={step > 1 || pending} className="space-y-3 disabled:opacity-60">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Input
              label="School code *"
              hint="Short identifier (e.g. WMAWF). All uppercase, no spaces."
              value={basics.schoolCode}
              onChange={(v) => setBasics({ ...basics, schoolCode: v.toUpperCase().replace(/\s+/g, "") })}
              placeholder="WMAWF"
            />
            <Input
              label="School name *"
              value={basics.schoolName}
              onChange={(v) => setBasics({ ...basics, schoolName: v })}
              placeholder="Winmore Academy"
            />
            <Input
              label="Branch (optional)"
              hint="Used when one school has multiple branches with the same name."
              value={basics.branchName}
              onChange={(v) => setBasics({ ...basics, branchName: v })}
              placeholder="Whitefield"
            />
            <Input
              label="City (optional)"
              value={basics.city}
              onChange={(v) => setBasics({ ...basics, city: v })}
              placeholder="Bangalore"
            />
          </div>
          <Select
            label="Status"
            value={basics.status}
            onChange={(v) => setBasics({ ...basics, status: v as SchoolBasics["status"] })}
            options={[
              { value: "Onboarding", label: "Onboarding — hidden until you promote to Active" },
              { value: "Active", label: "Active — visible everywhere" },
              { value: "Inactive", label: "Inactive — paused" },
            ]}
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
            <label className="flex items-start gap-2.5 p-2.5 rounded-lg border border-ink-100 hover:bg-cream-50 cursor-pointer">
              <input
                type="checkbox"
                checked={basics.uniformDetailsCheckbox}
                onChange={(e) => setBasics({ ...basics, uniformDetailsCheckbox: e.target.checked })}
                className="mt-0.5 h-4 w-4 rounded border-ink-300 text-brand-600 focus:ring-brand-300"
              />
              <span className="min-w-0">
                <span className="block text-[13px] font-medium text-ink-900">Sells uniforms</span>
                <span className="block text-[11px] text-ink-500">Operator will tag uniform items under this school.</span>
              </span>
            </label>
            <label className="flex items-start gap-2.5 p-2.5 rounded-lg border border-ink-100 hover:bg-cream-50 cursor-pointer">
              <input
                type="checkbox"
                checked={basics.booksDetailsCheckbox}
                onChange={(e) => setBasics({ ...basics, booksDetailsCheckbox: e.target.checked })}
                className="mt-0.5 h-4 w-4 rounded border-ink-300 text-brand-600 focus:ring-brand-300"
              />
              <span className="min-w-0">
                <span className="block text-[13px] font-medium text-ink-900">Sells books</span>
                <span className="block text-[11px] text-ink-500">Operator will tag books / bookkits under this school.</span>
              </span>
            </label>
          </div>
          {step === 1 && (
            <div className="pt-2">
              <PrimaryButton onClick={submitBasics} loading={pending}>
                Create school <ArrowRight className="h-3.5 w-3.5" />
              </PrimaryButton>
            </div>
          )}
        </fieldset>
      </StepCard>

      <StepCard
        n={2}
        title="Which grades does this school serve?"
        subtitle={
          step >= 2
            ? `${selectedCount} selected · the school's custom label (e.g. "IK 1") is optional but recommended for branded displays.`
            : undefined
        }
        done={step > 2}
        active={step === 2}
        locked={step < 2}
      >
        <fieldset disabled={step !== 2 || pending} className="space-y-3 disabled:opacity-60">
          <div className="grid grid-cols-[24px_1fr_1fr_120px] gap-3 px-2 pb-1.5 text-[11px] font-semibold tracking-[0.12em] uppercase text-ink-500 border-b border-ink-100">
            <div></div>
            <div>Grade</div>
            <div>School&apos;s custom label</div>
            <div>Sections</div>
          </div>
          <div className="max-h-[440px] overflow-y-auto pr-1 divide-y divide-ink-100/70">
            {gradeRows.map((g, i) => (
              <div key={g.name} className="grid grid-cols-[24px_1fr_1fr_120px] gap-3 items-center px-2 py-2">
                <input
                  type="checkbox"
                  checked={g.checked}
                  onChange={(e) => updateGrade(i, { checked: e.target.checked })}
                  className="h-4 w-4 rounded border-ink-300 text-brand-600 focus:ring-brand-300"
                />
                <div className="text-[13px] font-medium text-ink-900">{g.name}</div>
                <input
                  value={g.schoolGiven}
                  onChange={(e) => updateGrade(i, { schoolGiven: e.target.value })}
                  disabled={!g.checked}
                  placeholder={`e.g. ${g.name === "Grade 1" ? "IK 1" : g.name}`}
                  className="h-8 rounded-md border border-ink-200 bg-white px-2 text-[12.5px] disabled:bg-cream-50 disabled:text-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-300"
                />
                <input
                  value={g.sections}
                  onChange={(e) => updateGrade(i, { sections: e.target.value })}
                  disabled={!g.checked}
                  placeholder="A, B"
                  className="h-8 rounded-md border border-ink-200 bg-white px-2 text-[12.5px] disabled:bg-cream-50 disabled:text-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-300"
                />
              </div>
            ))}
          </div>

          {/* Add custom grade */}
          <div className="pt-3 border-t border-ink-100 flex items-end gap-2">
            <div className="flex-1">
              <label className="block mb-1 text-[11px] font-semibold tracking-[0.12em] uppercase text-ink-500">
                Add a custom grade
              </label>
              <input
                value={customGrade}
                onChange={(e) => setCustomGrade(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addCustomGrade();
                  }
                }}
                placeholder="e.g. PYP 1, Class I, Pre-K Junior…"
                className="w-full h-10 rounded-lg border border-ink-200 bg-white px-3 text-[13.5px] focus:outline-none focus:ring-2 focus:ring-brand-300"
              />
            </div>
            <button
              type="button"
              onClick={addCustomGrade}
              className="h-10 px-3 rounded-lg border border-ink-200 text-ink-700 text-[13px] font-semibold hover:bg-cream-100 inline-flex items-center gap-1.5"
            >
              <Plus className="h-3.5 w-3.5" /> Add
            </button>
          </div>

          {step === 2 && (
            <div className="pt-2">
              <PrimaryButton onClick={submitGrades} loading={pending}>
                Save {selectedCount} grade{selectedCount === 1 ? "" : "s"} <ArrowRight className="h-3.5 w-3.5" />
              </PrimaryButton>
            </div>
          )}
        </fieldset>
      </StepCard>

      <StepCard
        n={3}
        title="You're set — pick what's next"
        done={false}
        active={step === 3}
        locked={step < 3}
      >
        {step === 3 && createdSchoolId && (() => {
          const firstGrade = gradeRows.find((g) => g.checked)?.name;
          const tagHref = firstGrade
            ? `/admin/catalog/setup/${createdSchoolId}/${encodeURIComponent(firstGrade)}/add-items`
            : `/admin/catalog/setup`;
          return (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
              <NextStep
                href={tagHref}
                icon={Tag}
                title="Tag existing items"
                hint={
                  firstGrade
                    ? `Start with ${firstGrade} — bulk-tag products to this (school, grade)`
                    : "Pick a grade from the Setup hub to start tagging products"
                }
              />
              <NextStep
                href={`/admin/boms/new?schoolId=${createdSchoolId}`}
                icon={Library}
                title="Create a Magic Box"
                hint="Bundle items into a per-grade kit"
              />
              <NextStep
                href={`/admin/catalog?schoolId=${createdSchoolId}${firstGrade ? `&grade=${encodeURIComponent(firstGrade)}` : ""}&mode=new`}
                icon={Eye}
                title="Preview as parent"
                hint="See exactly what new families will see (Magic Boxes)"
              />
            </div>
          );
        })()}
        {step === 3 && (
          <div className="mt-3 pt-3 border-t border-ink-100 text-[12.5px] text-ink-500">
            Done for now?{" "}
            <Link href="/admin/catalog/setup" className="font-semibold text-brand-700 hover:underline">
              ← Back to Setup hub
            </Link>
          </div>
        )}
      </StepCard>
    </div>
  );
}

// ─── Small UI helpers (kept local so this file stays self-contained) ────

function StepCard({
  n,
  title,
  subtitle,
  done,
  active,
  locked,
  children,
}: {
  n: number;
  title: string;
  subtitle?: string;
  done: boolean;
  active: boolean;
  locked: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      className={cn(
        "rounded-xl border bg-white transition-colors",
        active && "border-brand-300 ring-1 ring-brand-100",
        done && !active && "border-emerald-200 bg-emerald-50/30",
        locked && "border-ink-100 opacity-70"
      )}
    >
      <header className="flex items-center gap-3 px-4 py-3 border-b border-ink-100">
        <span
          className={cn(
            "grid h-7 w-7 place-items-center rounded-full text-[12px] font-bold",
            done
              ? "bg-emerald-600 text-white"
              : active
                ? "bg-brand-600 text-white"
                : "bg-cream-200 text-ink-500"
          )}
        >
          {done ? <Check className="h-3.5 w-3.5" /> : n}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[14px] font-semibold text-ink-900">{title}</h2>
          {subtitle && <p className="text-[12px] text-ink-500 mt-0.5">{subtitle}</p>}
        </div>
        {locked && <span className="text-[11px] text-ink-400 font-medium">Locked</span>}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

function Input({
  label,
  hint,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="block mb-1 text-[11px] font-semibold tracking-[0.12em] uppercase text-ink-500">
        {label}
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full h-10 rounded-lg border border-ink-200 bg-white px-3 text-[13.5px] focus:outline-none focus:ring-2 focus:ring-brand-300"
      />
      {hint && <span className="block mt-1 text-[11px] text-ink-500">{hint}</span>}
    </label>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="block">
      <span className="block mb-1 text-[11px] font-semibold tracking-[0.12em] uppercase text-ink-500">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full h-10 rounded-lg border border-ink-200 bg-white px-3 text-[13.5px] focus:outline-none focus:ring-2 focus:ring-brand-300"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function PrimaryButton({
  onClick,
  loading,
  children,
}: {
  onClick: () => void;
  loading: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      className="inline-flex items-center gap-1.5 h-10 px-4 rounded-lg bg-ink-900 text-white text-[13px] font-semibold hover:bg-ink-800 disabled:opacity-60"
    >
      {loading ? "Saving…" : children}
    </button>
  );
}

function NextStep({
  href,
  icon: Icon,
  title,
  hint,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  hint: string;
}) {
  return (
    <Link
      href={href}
      className="group flex items-start gap-3 p-3 rounded-lg border border-ink-100 hover:border-ink-300 hover:bg-cream-50 transition-colors"
    >
      <div className="grid h-8 w-8 place-items-center rounded-md bg-cream-100 group-hover:bg-white">
        <Icon className="h-4 w-4 text-ink-700" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1 text-[13px] font-semibold text-ink-900">
          {title}
          <ArrowRight className="h-3 w-3 text-ink-400 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all" />
        </div>
        <div className="text-[11.5px] text-ink-500">{hint}</div>
      </div>
    </Link>
  );
}
