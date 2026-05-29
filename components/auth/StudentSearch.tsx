"use client";

import { useEffect, useRef, useState } from "react";
import { auth } from "@/lib/auth";

export type FoundStudentPhone = {
  /** "Father" | "Mother" | null — null when the relation is blank, "Guardian", "Self", etc. */
  relation: "Father" | "Mother" | null;
  mobileMasked: string;
};

export type FoundStudent = {
  studentId: string;
  name: string;
  enrollment: string;
  school: string;
  /** All phones on file for this student, ordered by row_idx then parents.phone fallback. */
  phones: FoundStudentPhone[];
  /** First phone in `phones` (legacy single-value field — kept for callers that still need it). */
  mobileMasked: string;
};

/**
 * School + grade dropdowns and a name box that searches students live as
 * you type (debounced, no search button). Stale responses are discarded so
 * fast typing never shows out-of-order results.
 *
 * Used by both the "recover my number" flow and new-user registration.
 */
export function StudentSearch({
  onPick,
  showMasked = false,
  pickedId = null,
}: {
  onPick: (s: FoundStudent) => void;
  /** Show the masked mobile (last 4) on each result — for the recover flow. */
  showMasked?: boolean;
  /** Highlight the currently-selected student. */
  pickedId?: string | null;
}) {
  type GradeChoice = { value: string; label: string };
  const [opts, setOpts] = useState<{
    schools: { code: string; name: string }[];
    grades: string[];
    gradesBySchool: Record<string, GradeChoice[]>;
  }>({ schools: [], grades: [], gradesBySchool: {} });
  const [school, setSchool] = useState("");
  const [grade, setGrade] = useState("");

  // Grade choices for the currently-selected school. Each entry is the
  // canonical grade (submitted) + the school-given display label. When no
  // school is picked, fall back to the flat canonical list (label==value).
  const visibleGrades: GradeChoice[] = (() => {
    if (!school) return opts.grades.map((g) => ({ value: g, label: g }));
    const perSchool = opts.gradesBySchool[school];
    if (perSchool && perSchool.length > 0) return perSchool;
    return opts.grades.map((g) => ({ value: g, label: g }));
  })();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<FoundStudent[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string>();
  const reqSeq = useRef(0);

  useEffect(() => {
    auth.recoverOptions().then(setOpts).catch(() => {});
  }, []);

  // Debounced live search — fires ~300ms after the last change.
  useEffect(() => {
    if (!school || !grade || q.trim().length < 3) {
      setResults([]);
      setNote(undefined);
      return;
    }
    const seq = ++reqSeq.current;
    setBusy(true);
    const t = setTimeout(async () => {
      try {
        const r = await auth.recoverSearch(school, grade, q.trim());
        if (seq !== reqSeq.current) return; // a newer search superseded us
        setResults(r.results);
        setNote(r.results.length === 0 ? "No matching students found." : undefined);
      } catch (err) {
        if (seq !== reqSeq.current) return;
        setNote(err instanceof Error ? err.message : "Search failed");
      } finally {
        if (seq === reqSeq.current) setBusy(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [school, grade, q]);

  const field =
    "w-full px-4 py-3 text-[15px] text-ink-900 placeholder:text-ink-400 rounded-xl border border-ink-200 bg-white outline-none focus:border-ink-900";

  return (
    <div>
      <div className="grid sm:grid-cols-2 gap-3">
        <select
          value={school}
          onChange={(e) => {
            const next = e.target.value;
            setSchool(next);
            // If the previously-selected grade isn't valid for the new school,
            // clear it so the user is forced to re-pick.
            const allowed = next
              ? opts.gradesBySchool[next]?.map((c) => c.value) ?? opts.grades
              : opts.grades;
            if (grade && !allowed.includes(grade)) setGrade("");
          }}
          className={field}
        >
          <option value="">Select school</option>
          {opts.schools.map((s) => (
            <option key={s.code} value={s.code}>
              {s.name}
            </option>
          ))}
        </select>
        <select
          value={grade}
          onChange={(e) => setGrade(e.target.value)}
          disabled={!school}
          className={field + (school ? "" : " opacity-60 cursor-not-allowed")}
        >
          <option value="">
            {school ? "Select grade" : "Pick a school first"}
          </option>
          {visibleGrades.map((g) => (
            <option key={g.value} value={g.value}>
              {g.label}
            </option>
          ))}
        </select>
      </div>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Student's name or last 4 digits of mobile (min 3 characters)"
        className={field + " mt-3"}
      />
      <p className="mt-1 text-[11px] text-ink-500">
        Typos, partial words, or any order are OK. You can also search by the
        last 4 digits of the registered mobile number.
      </p>

      {busy && (
        <p className="mt-2 text-[12px] text-ink-500">Searching…</p>
      )}
      {note && (
        <p className="mt-2 text-[12px] font-medium text-ink-500">{note}</p>
      )}

      {results.length > 0 && (
        <ul className="mt-3 space-y-2 max-h-64 overflow-y-auto">
          {results.map((s) => (
            <li key={s.studentId}>
              <button
                type="button"
                onClick={() => onPick(s)}
                className={
                  "w-full text-left rounded-xl border p-3 transition-colors " +
                  (pickedId === s.studentId
                    ? "border-brand bg-brand/5"
                    : "border-ink-200 bg-white hover:border-brand")
                }
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-semibold text-ink-900 text-[14px]">
                    {s.name}
                  </span>
                </div>
                <p className="mt-0.5 text-[12px] text-ink-500">
                  {s.enrollment} · {s.school}
                </p>
                {showMasked && s.phones.length > 0 && (
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]">
                    {s.phones.map((ph, i) => (
                      <span key={i} className="inline-flex items-center gap-1 text-ink-700">
                        {ph.relation && (
                          <span className="text-ink-500">{ph.relation}</span>
                        )}
                        <span className="font-mono text-ink-700">{ph.mobileMasked}</span>
                      </span>
                    ))}
                  </div>
                )}
                {showMasked && s.phones.length > 0 && (
                  <p className="mt-1 text-[11px] text-brand font-medium">
                    Use any of these numbers to log in.
                  </p>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
