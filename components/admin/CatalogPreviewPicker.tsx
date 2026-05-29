"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { cn } from "@/lib/cn";

type Opt = { value: string; label: string };

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
    <div className="space-y-3">
      {/* Visible "loading" strip above the picker — opacity-60 alone wasn't
          legible enough to communicate that the page IS reacting to the
          dropdown change. Catalog server-render can take 1-2s cold; admins
          were calling the filter "frozen". */}
      {pending && (
        <div className="inline-flex items-center gap-2 rounded-full bg-brand-50 border border-brand-100 px-3 py-1 text-[12px] font-semibold text-brand-700">
          <span className="inline-block h-2 w-2 rounded-full bg-brand-600 animate-pulse" />
          Loading catalog for new filter…
        </div>
      )}
    <div
      className={cn(
        "flex flex-col md:flex-row md:items-end gap-3 md:gap-4 transition-opacity",
        pending && "opacity-60 pointer-events-none"
      )}
    >
      <Field label="School">
        <select
          value={activeSchoolId}
          onChange={(e) => update({ schoolId: e.target.value })}
          disabled={pending}
          className="w-full md:w-72 h-10 rounded-lg border border-ink-200 bg-white px-3 text-[13.5px] text-ink-900 focus:outline-none focus:ring-2 focus:ring-brand-300 disabled:bg-cream-50"
        >
          {schools.length === 0 ? (
            <option value="">No schools</option>
          ) : (
            schools.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))
          )}
        </select>
      </Field>

      <Field label="Grade">
        <select
          value={activeGrade}
          onChange={(e) => update({ grade: e.target.value })}
          disabled={grades.length === 0}
          className="w-full md:w-56 h-10 rounded-lg border border-ink-200 bg-white px-3 text-[13.5px] text-ink-900 disabled:bg-cream-50 disabled:text-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-300"
        >
          {grades.length === 0 ? (
            <option value="">No grades tagged</option>
          ) : (
            grades.map((g) => (
              <option key={g.value} value={g.value}>
                {g.label}
              </option>
            ))
          )}
        </select>
      </Field>

      <Field label="Student type">
        <div
          role="tablist"
          className="inline-flex rounded-lg border border-ink-200 bg-white p-0.5"
        >
          <Toggle active={mode === "ret"} onClick={() => update({ mode: "ret" })}>
            Returning
          </Toggle>
          <Toggle active={mode === "new"} onClick={() => update({ mode: "new" })}>
            New
          </Toggle>
        </div>
      </Field>
    </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block mb-1 text-[11px] font-semibold tracking-[0.12em] uppercase text-ink-500">
        {label}
      </span>
      {children}
    </label>
  );
}

function Toggle({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "px-3 h-9 rounded-md text-[13px] font-medium transition-colors",
        active ? "bg-ink-900 text-white" : "text-ink-600 hover:text-ink-900"
      )}
    >
      {children}
    </button>
  );
}
