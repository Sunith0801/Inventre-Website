"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronRight, Check, AlertTriangle, X, Eye, Library, Tag, Lock, Unlock, Rocket } from "lucide-react";
import { cn } from "@/lib/cn";

export type SchoolHealth = {
  id: string;
  name: string;
  code: string | null;
  gradesDefined: number;
  productsTagged: number;
  magicBoxes: number;
  /** Admin override: when true, status pill renders as "Complete" regardless
   *  of gaps. Per-grade gaps are still shown so they're discoverable. */
  isSetupComplete: boolean;
  /** Storefront-visible status. 'onboarding' = hidden from parents until
   *  promoted. Wizard-created schools default to 'onboarding'. */
  schoolStatus: "active" | "onboarding";
  grades: {
    grade: string;
    schoolGiven: string | null;
    regularItems: number;
    magicBoxes: number;
  }[];
};

export function SchoolHealthRow({ school }: { school: SchoolHealth }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [marked, setMarked] = useState(school.isSetupComplete);
  const [schoolStatus, setSchoolStatus] = useState(school.schoolStatus);

  // Derive overall status. The thresholds are deliberately blunt — anything
  // more nuanced should be done by the user looking at the per-grade view.
  const status = deriveStatus({ ...school, isSetupComplete: marked });

  // For schools with zero grades defined, expanding doesn't help (there's
  // nothing to show). Treat them as a flat call-to-action row.
  const noGrades = school.gradesDefined === 0;

  const toggleComplete = (next: boolean) => {
    start(async () => {
      const r = await fetch(`/api/admin/schools/${school.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isSetupComplete: next }),
      });
      if (r.ok) {
        setMarked(next);
        router.refresh();
      }
    });
  };

  const promoteToActive = () => {
    if (
      !confirm(
        `Promote "${school.name}" to Active?\n\nThe school will become visible to parents on the storefront. Make sure grades and Magic Boxes are in place first.`
      )
    ) {
      return;
    }
    start(async () => {
      const r = await fetch(`/api/admin/schools/${school.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "active" }),
      });
      if (r.ok) {
        setSchoolStatus("active");
        router.refresh();
      } else {
        const j = await r.json().catch(() => ({}));
        alert(`Failed to promote: ${j.error ?? r.status}`);
      }
    });
  };

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={noGrades}
        className={cn(
          "w-full grid grid-cols-[1fr_90px_90px_90px_140px] items-center gap-3 px-4 py-3 text-left transition-colors",
          noGrades ? "cursor-default" : "hover:bg-cream-50"
        )}
      >
        <div className="flex items-center gap-2 min-w-0">
          {!noGrades && (
            <ChevronRight
              className={cn(
                "h-4 w-4 text-ink-400 transition-transform flex-shrink-0",
                open && "rotate-90"
              )}
            />
          )}
          {noGrades && <span className="w-4 flex-shrink-0" />}
          <div className="min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-[14px] font-semibold text-ink-900 truncate">{school.name}</span>
              {schoolStatus === "onboarding" && (
                <span className="inline-flex items-center gap-1 px-1.5 h-5 rounded-full bg-amber-50 text-amber-800 border border-amber-200 text-[10px] font-bold tracking-[0.08em] uppercase flex-shrink-0">
                  Onboarding
                </span>
              )}
            </div>
            {school.code && (
              <div className="text-[11px] text-ink-500 font-mono truncate">{school.code}</div>
            )}
          </div>
        </div>
        <Metric value={school.gradesDefined} good={school.gradesDefined > 0} />
        <Metric value={school.productsTagged} good={school.productsTagged > 0} />
        <Metric value={school.magicBoxes} good={school.magicBoxes > 0} warn={school.magicBoxes === 0 && school.productsTagged > 0} />
        <div className="text-right">
          <StatusPill status={status} />
        </div>
      </button>

      {open && !noGrades && (
        <div className="bg-cream-50/60 border-t border-ink-100 px-4 py-3">
          <div className="grid grid-cols-[1fr_120px_120px_220px] gap-3 px-1 pb-1.5 text-[11px] font-semibold tracking-[0.12em] uppercase text-ink-500 border-b border-ink-100">
            <div>Grade</div>
            <div className="text-right">Items</div>
            <div className="text-right">Magic boxes</div>
            <div className="text-right">Quick actions</div>
          </div>
          <div className="divide-y divide-ink-100/60">
            {school.grades.map((g) => (
              <GradeRow key={g.grade} schoolId={school.id} g={g} />
            ))}
          </div>
          {school.grades.length === 0 && (
            <div className="px-1 py-3 text-[12.5px] text-ink-500">
              This school has grade mappings but none match the expected shape.
              Check{" "}
              <Link
                href={`/admin/schools/${school.id}`}
                className="font-medium text-brand-700 hover:underline"
              >
                school detail → Grades tab
              </Link>
              .
            </div>
          )}

          {/* Promote-to-Active surfaces only when the school is still onboarding.
              This is the last gate before parents start seeing the school. */}
          {schoolStatus === "onboarding" && (
            <div className="mt-3 pt-3 border-t border-ink-100/70 flex items-center justify-between gap-3">
              <div className="text-[12px] text-ink-700">
                <span className="font-semibold">Hidden from parents.</span>{" "}
                Promote to Active when grades, items and Magic Boxes look right above.
              </div>
              <button
                type="button"
                onClick={promoteToActive}
                disabled={pending}
                className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[11.5px] font-semibold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60"
              >
                <Rocket className="h-3 w-3" /> Promote to Active
              </button>
            </div>
          )}

          {/* Admin override: mark setup complete to silence status pill.
              Visual only — it does NOT change parent-facing queries. */}
          <div className="mt-3 pt-3 border-t border-ink-100/70 flex items-center justify-between gap-3">
            <div className="text-[12px] text-ink-500">
              {marked
                ? "Setup marked complete. Per-grade gaps still shown for reference."
                : "Some gaps may be intentional. Mark setup complete to silence the status pill."}
            </div>
            <button
              type="button"
              onClick={() => toggleComplete(!marked)}
              disabled={pending}
              className={cn(
                "inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[11.5px] font-semibold transition-colors disabled:opacity-60",
                marked
                  ? "text-ink-700 bg-cream-100 hover:bg-cream-200"
                  : "text-emerald-800 bg-emerald-50 hover:bg-emerald-100"
              )}
            >
              {marked ? (
                <>
                  <Unlock className="h-3 w-3" /> Reopen
                </>
              ) : (
                <>
                  <Lock className="h-3 w-3" /> Mark setup complete
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {noGrades && (
        <div className="bg-amber-50/40 border-t border-amber-100 px-4 py-3 text-[12.5px] text-ink-700 flex items-center gap-3">
          <AlertTriangle className="h-4 w-4 text-amber-700 flex-shrink-0" />
          <span className="flex-1">No grades defined yet. The first step is mapping which grades this school serves.</span>
          <Link
            href={`/admin/schools/${school.id}`}
            className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md bg-ink-900 text-white text-[11.5px] font-semibold hover:bg-ink-800"
          >
            Define grades →
          </Link>
        </div>
      )}
    </div>
  );
}

function GradeRow({
  schoolId,
  g,
}: {
  schoolId: string;
  g: SchoolHealth["grades"][number];
}) {
  const itemsOk = g.regularItems > 0;
  const mbOk = g.magicBoxes > 0;
  const previewHref = `/admin/catalog?schoolId=${schoolId}&grade=${encodeURIComponent(g.grade)}`;
  // The Tag-items deep-link goes to the focused bulk-tag tool (multi-select +
  // inline isRequired + per-school price override) rather than the raw
  // products list, which is a browse view not a bulk-tag verb.
  const tagItemsHref = `/admin/catalog/setup/${schoolId}/${encodeURIComponent(g.grade)}/add-items`;
  const newMbHref = `/admin/boms/new?schoolId=${schoolId}&grade=${encodeURIComponent(g.grade)}`;

  return (
    <div className="grid grid-cols-[1fr_120px_120px_220px] gap-3 items-center px-1 py-2">
      <div className="min-w-0">
        <div className="text-[13px] font-medium text-ink-900">{g.grade}</div>
        {g.schoolGiven && (
          <div className="text-[11px] text-ink-500 truncate">labelled “{g.schoolGiven}” here</div>
        )}
      </div>
      <div className="text-right text-[13px]">
        <span className={cn("font-semibold", itemsOk ? "text-emerald-700" : "text-red-700")}>
          {g.regularItems}
        </span>
        <span className="text-ink-400 ml-1">items</span>
      </div>
      <div className="text-right text-[13px]">
        <span className={cn("font-semibold", mbOk ? "text-emerald-700" : "text-red-700")}>
          {g.magicBoxes}
        </span>
        <span className="text-ink-400 ml-1">MB</span>
      </div>
      <div className="flex items-center justify-end gap-1">
        <Link
          href={previewHref}
          className="inline-flex items-center gap-1 h-7 px-2 rounded-md text-[11.5px] text-ink-600 hover:bg-cream-100 hover:text-ink-900"
          title="Preview as parent"
        >
          <Eye className="h-3 w-3" /> Preview
        </Link>
        {!itemsOk && (
          <Link
            href={tagItemsHref}
            className="inline-flex items-center gap-1 h-7 px-2 rounded-md text-[11.5px] text-amber-800 bg-amber-50 hover:bg-amber-100"
            title="Tag products to this grade"
          >
            <Tag className="h-3 w-3" /> Tag items
          </Link>
        )}
        {!mbOk && (
          <Link
            href={newMbHref}
            className="inline-flex items-center gap-1 h-7 px-2 rounded-md text-[11.5px] text-amber-800 bg-amber-50 hover:bg-amber-100"
            title="Create a Magic Box for this grade"
          >
            <Library className="h-3 w-3" /> Add MB
          </Link>
        )}
        {itemsOk && mbOk && (
          <span className="inline-flex items-center gap-1 h-7 px-2 rounded-md text-[11.5px] text-emerald-700 bg-emerald-50">
            <Check className="h-3 w-3" /> Ready
          </span>
        )}
      </div>
    </div>
  );
}

function Metric({ value, good, warn }: { value: number; good?: boolean; warn?: boolean }) {
  const colour = good ? "text-emerald-700" : warn ? "text-amber-700" : "text-red-700";
  return (
    <div className="text-right">
      <span className={cn("text-[14px] font-bold", colour)}>{value}</span>
    </div>
  );
}

type Status = "complete" | "healthy" | "needs-work" | "empty";

function deriveStatus(s: SchoolHealth): Status {
  // Admin override beats data-derived status. Per-grade gaps still render in
  // the expanded view so they're discoverable, but the pill goes quiet.
  if (s.isSetupComplete) return "complete";
  if (s.gradesDefined === 0 || s.productsTagged === 0) return "empty";
  // "Needs work" if any defined grade has zero items or zero magic boxes.
  const gradesWithGaps = s.grades.filter((g) => g.regularItems === 0 || g.magicBoxes === 0).length;
  if (gradesWithGaps > 0) return "needs-work";
  return "healthy";
}

function StatusPill({ status }: { status: Status }) {
  const map = {
    complete: {
      icon: Lock,
      text: "Complete",
      cls: "text-ink-700 bg-cream-100 border-ink-200",
    },
    healthy: {
      icon: Check,
      text: "Healthy",
      cls: "text-emerald-700 bg-emerald-50 border-emerald-200",
    },
    "needs-work": {
      icon: AlertTriangle,
      text: "Needs work",
      cls: "text-amber-800 bg-amber-50 border-amber-200",
    },
    empty: {
      icon: X,
      text: "Empty",
      cls: "text-red-700 bg-red-50 border-red-200",
    },
  }[status];
  const Icon = map.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2 h-6 rounded-full border text-[11px] font-semibold",
        map.cls
      )}
    >
      <Icon className="h-3 w-3" />
      {map.text}
    </span>
  );
}
