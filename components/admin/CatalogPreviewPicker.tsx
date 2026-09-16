"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { cn } from "@/lib/cn";
import { FilterSelect } from "@/components/admin/ui/primitives";

type Opt = { value: string; label: string };

/**
 * The three pickers that define whose shop is being previewed: school, grade,
 * and whether the student is new (Magic Boxes only) or returning. Same
 * labelled-dropdown toolbar as every list page; changing one navigates.
 */
export function CatalogPreviewPicker({
  schools,
  grades,
  activeSchoolId,
  activeGrade,
  mode,
}: {
  schools: { id: string; name: string }[];
  grades: Opt[];
  activeSchoolId: string;
  activeGrade: string;
  mode: "new" | "ret";
}) {
  const router = useRouter();
  const sp = useSearchParams();
  const [pending, start] = useTransition();

  // Push a new URL with merged search params. Switching schools clears
  // the grade because the available grades depend on the school.
  const update = (patch: { schoolId?: string; grade?: string; mode?: "new" | "ret" }) => {
    const next = new URLSearchParams(sp?.toString() ?? "");
    if (patch.schoolId !== undefined) {
      next.set("schoolId", patch.schoolId);
      next.delete("grade");
    }
    if (patch.grade !== undefined) next.set("grade", patch.grade);
    if (patch.mode !== undefined) next.set("mode", patch.mode);
    start(() => router.push(`/admin/catalog?${next.toString()}`, { scroll: false }));
  };

  return (
    <div className={cn("mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-ink-100/70 bg-white p-2 transition-opacity", pending && "opacity-70")}>
      <FilterSelect
        label="School"
        noAll
        className="min-w-[260px] max-w-[420px] flex-1"
        value={activeSchoolId}
        onChange={(e) => update({ schoolId: e.target.value })}
        disabled={pending || schools.length === 0}
      >
        {schools.length === 0 ? <option value="">No schools</option> : null}
        {schools.map((s) => (
          <option key={s.id} value={s.id}>{s.name}</option>
        ))}
      </FilterSelect>

      <FilterSelect
        label="Grade"
        noAll
        className="min-w-[160px]"
        value={activeGrade}
        onChange={(e) => update({ grade: e.target.value })}
        disabled={pending || grades.length === 0}
      >
        {grades.length === 0 ? <option value="">No grades tagged</option> : null}
        {grades.map((g) => (
          <option key={g.value} value={g.value}>{g.label}</option>
        ))}
      </FilterSelect>

      <div role="tablist" aria-label="Student type" className="inline-flex h-9 items-center rounded-lg bg-cream-100 p-0.5">
        <Toggle active={mode === "ret"} disabled={pending} onClick={() => update({ mode: "ret" })}>Returning student</Toggle>
        <Toggle active={mode === "new"} disabled={pending} onClick={() => update({ mode: "new" })}>New student</Toggle>
      </div>

      {pending ? (
        <span className="inline-flex items-center gap-2 text-[12px] font-medium text-ink-500">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-brand-600" />
          Loading…
        </span>
      ) : null}
    </div>
  );
}

function Toggle({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "h-8 rounded-md px-3 text-[12.5px] font-semibold transition-colors disabled:opacity-60",
        active ? "bg-white text-ink-900 shadow-sm" : "text-ink-500 hover:text-ink-800"
      )}
    >
      {children}
    </button>
  );
}
