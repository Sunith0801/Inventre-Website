"use client";
/**
 * Shared inline-row editors for the four remaining child tables:
 *   - Student.addresses (billing + shipping)
 *   - Student.siblings
 *   - School.grade-mappings
 *   - School.uniform-mappings
 *
 * Same pattern as GuardianLinkEditor: existing rows are read-only with a
 * trash-icon DELETE; a permanent footer row hosts the add-new form.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/admin/ui/primitives-client";

// ─── Common helpers ──────────────────────────────────────────────

function Cell({ value, onChange, placeholder, mono }: { value: string; onChange: (v: string) => void; placeholder?: string; mono?: boolean }) {
  return (
    <input type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
      className={(mono ? "font-mono text-[12px] " : "text-[13px] ") + "w-full h-8 px-2 rounded bg-white border border-transparent placeholder:text-ink-400 hover:border-ink-200 focus:outline-none focus:border-ink-400 focus:ring-2 focus:ring-brand-300/30"} />
  );
}

function CellSelect({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full h-8 px-2 text-[13px] rounded bg-white border border-transparent hover:border-ink-200">
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

// ─── Student Address Editor ──────────────────────────────────────

type AddressRow = {
  id: string; rowIdx: number;
  kind: "billing" | "shipping";
  addressType: string | null;
  addressTitle: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  pincode: string | null;
  preferred: boolean;
  disabled: boolean;
};

export function AddressEditor({
  studentId, kind, initial,
}: { studentId: string; kind: "billing" | "shipping"; initial: AddressRow[] }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [draft, setDraft] = useState({ addressType: "Home", addressTitle: "", addressLine1: "", addressLine2: "", city: "", state: "", country: "India", pincode: "" });

  function add() {
    if (!draft.addressLine1.trim()) { setErr("Address Line 1 is required"); return; }
    setErr(null);
    start(async () => {
      const r = await fetch(`/api/admin/data/students/${studentId}/addresses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          addressType: draft.addressType || null,
          addressTitle: draft.addressTitle.trim() || null,
          addressLine1: draft.addressLine1.trim(),
          addressLine2: draft.addressLine2.trim() || null,
          city: draft.city.trim() || null,
          state: draft.state.trim() || null,
          country: draft.country.trim() || null,
          pincode: draft.pincode.trim() || null,
        }),
      });
      if (!r.ok) { setErr("Failed to add"); return; }
      setDraft({ addressType: "Home", addressTitle: "", addressLine1: "", addressLine2: "", city: "", state: "", country: "India", pincode: "" });
      router.refresh();
    });
  }

  function remove(rowId: string) {
    if (!confirm("Remove this address?")) return;
    start(async () => {
      const r = await fetch(`/api/admin/data/students/${studentId}/addresses/${rowId}`, { method: "DELETE" });
      if (!r.ok) { setErr("Failed to delete"); return; }
      router.refresh();
    });
  }

  return (
    <div>
      <table className="w-full text-[13px]">
        <thead className="bg-cream-50/60 text-ink-600">
          <tr>
            <th className="px-2 py-2 text-left w-10">No.</th>
            <th className="px-2 py-2 text-left">Type</th>
            <th className="px-2 py-2 text-left">Title</th>
            <th className="px-2 py-2 text-left">Line 1 *</th>
            <th className="px-2 py-2 text-left">Line 2</th>
            <th className="px-2 py-2 text-left">City</th>
            <th className="px-2 py-2 text-left">State</th>
            <th className="px-2 py-2 text-left">Pincode</th>
            <th className="px-2 py-2 w-10"></th>
          </tr>
        </thead>
        <tbody>
          {initial.map((r) => (
            <tr key={r.id} className="border-t border-ink-100/70">
              <td className="px-2 py-1.5 text-ink-500">{r.rowIdx}</td>
              <td className="px-2 py-1.5">{r.addressType ?? "—"}</td>
              <td className="px-2 py-1.5 text-ink-600">{r.addressTitle ?? "—"}</td>
              <td className="px-2 py-1.5">{r.addressLine1 ?? "—"}</td>
              <td className="px-2 py-1.5 text-ink-600">{r.addressLine2 ?? "—"}</td>
              <td className="px-2 py-1.5 text-ink-600">{r.city ?? "—"}</td>
              <td className="px-2 py-1.5 text-ink-600">{r.state ?? "—"}</td>
              <td className="px-2 py-1.5 text-ink-600 font-mono text-[12px]">{r.pincode ?? "—"}</td>
              <td className="px-2 py-1.5 text-right">
                <button onClick={() => remove(r.id)} type="button" className="text-ink-400 hover:text-red-600 p-1" aria-label="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
              </td>
            </tr>
          ))}
          <tr className="border-t border-ink-100/70 bg-cream-50/30">
            <td className="px-2 py-1.5 text-ink-400 text-[11px]">{initial.length + 1}</td>
            <td className="px-1 py-1"><CellSelect value={draft.addressType} onChange={(v) => setDraft((d) => ({ ...d, addressType: v }))} options={["Home", "Office", "Other"]} /></td>
            <td className="px-1 py-1"><Cell value={draft.addressTitle} onChange={(v) => setDraft((d) => ({ ...d, addressTitle: v }))} placeholder="title" /></td>
            <td className="px-1 py-1"><Cell value={draft.addressLine1} onChange={(v) => setDraft((d) => ({ ...d, addressLine1: v }))} placeholder="address line" /></td>
            <td className="px-1 py-1"><Cell value={draft.addressLine2} onChange={(v) => setDraft((d) => ({ ...d, addressLine2: v }))} placeholder="line 2" /></td>
            <td className="px-1 py-1"><Cell value={draft.city} onChange={(v) => setDraft((d) => ({ ...d, city: v }))} placeholder="city" /></td>
            <td className="px-1 py-1"><Cell value={draft.state} onChange={(v) => setDraft((d) => ({ ...d, state: v }))} placeholder="state" /></td>
            <td className="px-1 py-1"><Cell value={draft.pincode} onChange={(v) => setDraft((d) => ({ ...d, pincode: v }))} mono placeholder="pincode" /></td>
            <td className="px-2 py-1 text-right">
              <Button busy={busy} variant="primary" onClick={add} type="button" icon={<Plus className="h-3 w-3" />}>Add</Button>
            </td>
          </tr>
        </tbody>
      </table>
      {err ? <div className="mt-2 text-[12px] text-red-700">{err}</div> : null}
    </div>
  );
}

// ─── Sibling Editor ──────────────────────────────────────────────

type SiblingGradeMapping = {
  grade: string;
  displayName: string | null;
  sections: string | null;
};

export function SiblingEditor({
  studentId,
  initial,
  schoolCodes,
  gradesBySchool,
}: {
  studentId: string;
  initial: Array<{ id: string; rowIdx: number; fullName: string | null; gender: string | null; grade: string | null; section: string | null; dateOfBirth: string | null }>;
  // Optional — when provided, school/grade/section render as dropdowns
  // (same UX as the new-student form). When omitted, grade/section fall
  // back to free-text inputs (so callers that haven't been wired up yet
  // keep working).
  schoolCodes?: Array<{ code: string; name: string | null }>;
  gradesBySchool?: Record<string, SiblingGradeMapping[]>;
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  // `schoolCode` is UI-only — used to drive the grade/section choices.
  // studentSiblings has no school column, so we never send it to the API.
  const [draft, setDraft] = useState({ fullName: "", gender: "Male", schoolCode: "", grade: "", section: "", dateOfBirth: "" });
  const useDropdowns = !!schoolCodes && !!gradesBySchool;

  const gradeRows: SiblingGradeMapping[] = useDropdowns && draft.schoolCode
    ? gradesBySchool?.[draft.schoolCode] ?? []
    : [];
  const gradeChoices = gradeRows.map((m) => ({
    value: m.grade,
    label: m.displayName?.trim() || m.grade,
  }));
  const matchedGrade = gradeRows.find((m) => m.grade === draft.grade);
  const sectionChoices = (matchedGrade?.sections ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  function add() {
    if (!draft.fullName.trim()) { setErr("Full name is required"); return; }
    setErr(null);
    start(async () => {
      const r = await fetch(`/api/admin/data/students/${studentId}/siblings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: draft.fullName.trim(),
          gender: draft.gender || null,
          grade: draft.grade.trim() || null,
          section: draft.section.trim() || null,
          dateOfBirth: draft.dateOfBirth.trim() || null,
        }),
      });
      if (!r.ok) { setErr("Failed to add"); return; }
      setDraft({ fullName: "", gender: "Male", schoolCode: "", grade: "", section: "", dateOfBirth: "" });
      router.refresh();
    });
  }

  function remove(rowId: string) {
    if (!confirm("Remove this sibling?")) return;
    start(async () => {
      const r = await fetch(`/api/admin/data/students/${studentId}/siblings/${rowId}`, { method: "DELETE" });
      if (!r.ok) { setErr("Failed to delete"); return; }
      router.refresh();
    });
  }

  return (
    <div>
      <table className="w-full text-[13px]">
        <thead className="bg-cream-50/60 text-ink-600">
          <tr>
            <th className="px-2 py-2 text-left w-10">No.</th>
            <th className="px-2 py-2 text-left">Full Name *</th>
            <th className="px-2 py-2 text-left">Gender</th>
            {useDropdowns && <th className="px-2 py-2 text-left">School</th>}
            <th className="px-2 py-2 text-left">Grade</th>
            <th className="px-2 py-2 text-left">Section</th>
            <th className="px-2 py-2 text-left">DOB</th>
            <th className="px-2 py-2 w-10"></th>
          </tr>
        </thead>
        <tbody>
          {initial.map((r) => (
            <tr key={r.id} className="border-t border-ink-100/70">
              <td className="px-2 py-1.5 text-ink-500">{r.rowIdx}</td>
              <td className="px-2 py-1.5">{r.fullName ?? "—"}</td>
              <td className="px-2 py-1.5 text-ink-600">{r.gender ?? "—"}</td>
              {/* Existing rows have no school column to render — leave a placeholder
                  to keep the table aligned. */}
              {useDropdowns && <td className="px-2 py-1.5 text-ink-400">—</td>}
              <td className="px-2 py-1.5 text-ink-600">{r.grade ?? "—"}</td>
              <td className="px-2 py-1.5 text-ink-600">{r.section ?? "—"}</td>
              <td className="px-2 py-1.5 text-ink-600">{r.dateOfBirth ?? "—"}</td>
              <td className="px-2 py-1.5 text-right">
                <button onClick={() => remove(r.id)} type="button" className="text-ink-400 hover:text-red-600 p-1" aria-label="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
              </td>
            </tr>
          ))}
          <tr className="border-t border-ink-100/70 bg-cream-50/30">
            <td className="px-2 py-1.5 text-ink-400 text-[11px]">{initial.length + 1}</td>
            <td className="px-1 py-1"><Cell value={draft.fullName} onChange={(v) => setDraft((d) => ({ ...d, fullName: v }))} placeholder="full name" /></td>
            <td className="px-1 py-1"><CellSelect value={draft.gender} onChange={(v) => setDraft((d) => ({ ...d, gender: v }))} options={["Male", "Female", "Other"]} /></td>
            {useDropdowns && (
              <td className="px-1 py-1">
                <select
                  value={draft.schoolCode}
                  onChange={(e) => setDraft((d) => ({ ...d, schoolCode: e.target.value, grade: "", section: "" }))}
                  className="w-full h-8 px-2 text-[13px] rounded bg-white border border-transparent hover:border-ink-200"
                >
                  <option value="">— pick school —</option>
                  {schoolCodes!.map((s) => (
                    <option key={s.code} value={s.code}>{s.name ?? s.code}</option>
                  ))}
                </select>
              </td>
            )}
            <td className="px-1 py-1">
              {useDropdowns ? (
                <select
                  value={draft.grade}
                  onChange={(e) => setDraft((d) => ({ ...d, grade: e.target.value, section: "" }))}
                  disabled={!draft.schoolCode}
                  className="w-full h-8 px-2 text-[13px] rounded bg-white border border-transparent hover:border-ink-200 disabled:bg-cream-100 disabled:text-ink-400"
                >
                  <option value="">{draft.schoolCode ? "— grade —" : "pick school first"}</option>
                  {gradeChoices.map((g) => (
                    <option key={g.value} value={g.value}>{g.label}</option>
                  ))}
                </select>
              ) : (
                <Cell value={draft.grade} onChange={(v) => setDraft((d) => ({ ...d, grade: v }))} placeholder="grade" />
              )}
            </td>
            <td className="px-1 py-1">
              {useDropdowns ? (
                <select
                  value={draft.section}
                  onChange={(e) => setDraft((d) => ({ ...d, section: e.target.value }))}
                  disabled={!draft.grade || sectionChoices.length === 0}
                  className="w-full h-8 px-2 text-[13px] rounded bg-white border border-transparent hover:border-ink-200 disabled:bg-cream-100 disabled:text-ink-400"
                >
                  <option value="">
                    {!draft.grade ? "pick grade first" : sectionChoices.length === 0 ? "no sections" : "— section —"}
                  </option>
                  {sectionChoices.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              ) : (
                <Cell value={draft.section} onChange={(v) => setDraft((d) => ({ ...d, section: v }))} placeholder="section" />
              )}
            </td>
            <td className="px-1 py-1"><Cell value={draft.dateOfBirth} onChange={(v) => setDraft((d) => ({ ...d, dateOfBirth: v }))} placeholder="YYYY-MM-DD" /></td>
            <td className="px-2 py-1 text-right">
              <Button busy={busy} variant="primary" onClick={add} type="button" icon={<Plus className="h-3 w-3" />}>Add</Button>
            </td>
          </tr>
        </tbody>
      </table>
      {err ? <div className="mt-2 text-[12px] text-red-700">{err}</div> : null}
    </div>
  );
}

// ─── Sibling Student Editor (real students sharing parent_id) ────
//
// Replaces the read-only "Linked children in this account" card +
// the manual SiblingEditor with a single unified editor. Existing
// siblings here are real students (sharing parent_id with the page's
// student); the Add row creates a NEW student attached to the same
// family and copies the source student's guardian roster onto it.

export function SiblingStudentEditor({
  studentId,
  defaultSchoolCode,
  siblings,
  schoolCodes,
  gradesBySchool,
}: {
  studentId: string;
  defaultSchoolCode: string | null;
  siblings: Array<{
    id: string;
    name: string;
    firstName: string | null;
    lastName: string | null;
    enrollmentNumber: string | null;
    schoolCode: string | null;
    grade: string | null;
    section: string | null;
    gender: string | null;
    dateOfBirth: string | null;
    isVerified: boolean;
  }>;
  schoolCodes: Array<{ code: string; name: string | null }>;
  gradesBySchool: Record<string, SiblingGradeMapping[]>;
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [draft, setDraft] = useState({
    fullName: "",
    gender: "Male",
    schoolCode: defaultSchoolCode ?? "",
    grade: "",
    section: "",
    dateOfBirth: "",
  });

  const gradeRows: SiblingGradeMapping[] = draft.schoolCode
    ? gradesBySchool?.[draft.schoolCode] ?? []
    : [];
  const gradeChoices = gradeRows.map((m) => ({
    value: m.grade,
    label: m.displayName?.trim() || m.grade,
  }));
  const matchedGrade = gradeRows.find((m) => m.grade === draft.grade);
  const sectionChoices = (matchedGrade?.sections ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const schoolNameByCode = new Map(
    schoolCodes.map((s) => [s.code, s.name ?? s.code])
  );
  function gradeLabelFor(
    schoolCode: string | null,
    grade: string | null
  ): string {
    if (!grade) return "—";
    if (!schoolCode) return grade;
    const map = gradesBySchool[schoolCode] ?? [];
    const m = map.find((x) => x.grade === grade);
    return m?.displayName?.trim() || grade;
  }

  function unlink(siblingId: string, fullName: string) {
    if (
      !confirm(
        `Remove ${fullName} from this family?\n\nThe student will be disabled and detached. Their guardian-link rows carrying this family's phone will be deleted. Order history is preserved.`
      )
    ) {
      return;
    }
    setErr(null);
    start(async () => {
      // Reuse the existing per-student unlink route — same body that
      // the "Remove from family" button on the student detail page hits.
      const r = await fetch(`/api/admin/data/students/${siblingId}/unlink`, {
        method: "POST",
      });
      if (!r.ok) {
        const data = (await r.json().catch(() => null)) as { error?: string } | null;
        setErr(data?.error ?? `Failed to remove (HTTP ${r.status})`);
        return;
      }
      router.refresh();
    });
  }

  function add() {
    if (!draft.fullName.trim()) {
      setErr("Full name is required");
      return;
    }
    setErr(null);
    start(async () => {
      const r = await fetch(
        `/api/admin/data/students/${studentId}/sibling-student`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fullName: draft.fullName.trim(),
            gender: draft.gender || null,
            schoolCode: draft.schoolCode || null,
            grade: draft.grade || null,
            section: draft.section || null,
            dateOfBirth: draft.dateOfBirth.trim() || null,
          }),
        }
      );
      if (!r.ok) {
        try {
          const data = await r.json();
          setErr(data.error || "Failed to add");
        } catch {
          setErr("Failed to add");
        }
        return;
      }
      setDraft({
        fullName: "",
        gender: "Male",
        schoolCode: defaultSchoolCode ?? "",
        grade: "",
        section: "",
        dateOfBirth: "",
      });
      router.refresh();
    });
  }

  return (
    <div>
      <table className="w-full text-[13px]">
        <thead className="bg-cream-50/60 text-ink-600">
          <tr>
            <th className="px-2 py-2 text-left w-10">No.</th>
            <th className="px-2 py-2 text-left">Name</th>
            <th className="px-2 py-2 text-left">Enrollment</th>
            <th className="px-2 py-2 text-left">School</th>
            <th className="px-2 py-2 text-left">Grade</th>
            <th className="px-2 py-2 text-left">Section</th>
            <th className="px-2 py-2 text-left">Gender</th>
            <th className="px-2 py-2 text-left">DOB</th>
            <th className="px-2 py-2 text-left">Verified</th>
            <th className="px-2 py-2 w-16"></th>
          </tr>
        </thead>
        <tbody>
          {siblings.map((s, i) => {
            const fullName =
              [s.firstName, s.lastName].filter(Boolean).join(" ") || s.name;
            return (
              <tr
                key={s.id}
                className="border-t border-ink-100/70 hover:bg-cream-50/40"
              >
                <td className="px-2 py-1.5 text-ink-500">{i + 1}</td>
                <td className="px-2 py-1.5">
                  <Link
                    href={`/admin/students/${s.id}`}
                    className="text-brand-700 hover:underline font-semibold"
                  >
                    {fullName}
                  </Link>
                </td>
                <td className="px-2 py-1.5 text-ink-600 font-mono text-[12px]">
                  {s.enrollmentNumber ?? "—"}
                </td>
                <td className="px-2 py-1.5 text-ink-600">
                  {schoolNameByCode.get(s.schoolCode ?? "") ??
                    s.schoolCode ??
                    "—"}
                </td>
                <td className="px-2 py-1.5 text-ink-600">
                  {gradeLabelFor(s.schoolCode, s.grade)}
                </td>
                <td className="px-2 py-1.5 text-ink-600">
                  {s.section ?? "—"}
                </td>
                <td className="px-2 py-1.5 text-ink-600">
                  {s.gender ?? "—"}
                </td>
                <td className="px-2 py-1.5 text-ink-600">
                  {s.dateOfBirth ?? "—"}
                </td>
                <td className="px-2 py-1.5">
                  <span
                    className={
                      "inline-block rounded-full px-1.5 py-0.5 text-[10.5px] font-bold " +
                      (s.isVerified
                        ? "bg-emerald-100 text-emerald-800"
                        : "bg-cream-200 text-ink-700")
                    }
                  >
                    {s.isVerified ? "Yes" : "No"}
                  </span>
                </td>
                <td className="px-2 py-1.5 text-right">
                  <button
                    type="button"
                    onClick={() => unlink(s.id, fullName)}
                    disabled={busy}
                    aria-label={`Remove ${fullName} from family`}
                    title="Remove from family"
                    className="text-ink-400 hover:text-red-600 p-1 disabled:opacity-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </td>
              </tr>
            );
          })}
          {/* Add new sibling row — creates a real student attached to this family */}
          <tr className="border-t border-ink-100/70 bg-cream-50/30">
            <td className="px-2 py-1.5 text-ink-400 text-[11px]">
              {siblings.length + 1}
            </td>
            <td className="px-1 py-1">
              <Cell
                value={draft.fullName}
                onChange={(v) => setDraft((d) => ({ ...d, fullName: v }))}
                placeholder="full name"
              />
            </td>
            <td className="px-2 py-1.5 text-ink-400 text-[11px]">auto</td>
            <td className="px-1 py-1">
              <select
                value={draft.schoolCode}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    schoolCode: e.target.value,
                    grade: "",
                    section: "",
                  }))
                }
                className="w-full h-8 px-2 text-[13px] rounded bg-white border border-transparent hover:border-ink-200"
              >
                <option value="">— pick school —</option>
                {schoolCodes.map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.name ?? s.code}
                  </option>
                ))}
              </select>
            </td>
            <td className="px-1 py-1">
              <select
                value={draft.grade}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, grade: e.target.value, section: "" }))
                }
                disabled={!draft.schoolCode}
                className="w-full h-8 px-2 text-[13px] rounded bg-white border border-transparent hover:border-ink-200 disabled:bg-cream-100 disabled:text-ink-400"
              >
                <option value="">
                  {draft.schoolCode ? "— grade —" : "pick school first"}
                </option>
                {gradeChoices.map((g) => (
                  <option key={g.value} value={g.value}>
                    {g.label}
                  </option>
                ))}
              </select>
            </td>
            <td className="px-1 py-1">
              <select
                value={draft.section}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, section: e.target.value }))
                }
                disabled={!draft.grade || sectionChoices.length === 0}
                className="w-full h-8 px-2 text-[13px] rounded bg-white border border-transparent hover:border-ink-200 disabled:bg-cream-100 disabled:text-ink-400"
              >
                <option value="">
                  {!draft.grade
                    ? "pick grade first"
                    : sectionChoices.length === 0
                      ? "no sections"
                      : "— section —"}
                </option>
                {sectionChoices.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </td>
            <td className="px-1 py-1">
              <CellSelect
                value={draft.gender}
                onChange={(v) => setDraft((d) => ({ ...d, gender: v }))}
                options={["Male", "Female", "Other"]}
              />
            </td>
            <td className="px-1 py-1">
              <Cell
                value={draft.dateOfBirth}
                onChange={(v) => setDraft((d) => ({ ...d, dateOfBirth: v }))}
                placeholder="YYYY-MM-DD"
              />
            </td>
            <td className="px-2 py-1.5 text-ink-400 text-[11px]">auto</td>
            <td className="px-2 py-1 text-right">
              <Button
                busy={busy}
                variant="primary"
                onClick={add}
                type="button"
                icon={<Plus className="h-3 w-3" />}
              >
                Add
              </Button>
            </td>
          </tr>
        </tbody>
      </table>
      {err ? (
        <div className="mt-2 text-[12px] text-red-700">{err}</div>
      ) : null}
    </div>
  );
}

// ─── School Grade Mapping Editor ─────────────────────────────────

export function SchoolGradeMappingEditor({ schoolId, initial, standardGrades = [] }: { schoolId: string; initial: Array<{ id: string; rowIdx: number; grade: string | null; schoolGivenGradeName: string | null; sections: string | null }>; standardGrades?: string[] }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [draft, setDraft] = useState({ grade: "", schoolGivenGradeName: "", sections: "" });

  function add() {
    if (!draft.grade.trim()) { setErr("Grade is required"); return; }
    setErr(null);
    start(async () => {
      const r = await fetch(`/api/admin/data/schools/${schoolId}/grade-mappings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grade: draft.grade.trim(),
          schoolGivenGradeName: draft.schoolGivenGradeName.trim() || null,
          sections: draft.sections.trim() || null,
        }),
      });
      if (!r.ok) { setErr("Failed to add"); return; }
      setDraft({ grade: "", schoolGivenGradeName: "", sections: "" });
      router.refresh();
    });
  }

  function remove(rowId: string) {
    if (!confirm("Remove this mapping?")) return;
    start(async () => {
      const r = await fetch(`/api/admin/data/schools/${schoolId}/grade-mappings/${rowId}`, { method: "DELETE" });
      if (!r.ok) { setErr("Failed to delete"); return; }
      router.refresh();
    });
  }

  return (
    <div>
      <table className="w-full text-[13px]">
        <thead className="bg-cream-50/60 text-ink-600">
          <tr><th className="px-2 py-2 text-left w-10">No.</th><th className="px-2 py-2 text-left">Grade *</th><th className="px-2 py-2 text-left">School-Given Name</th><th className="px-2 py-2 text-left">Sections</th><th className="px-2 py-2 w-10"></th></tr>
        </thead>
        <tbody>
          {initial.map((r) => (
            <tr key={r.id} className="border-t border-ink-100/70">
              <td className="px-2 py-1.5 text-ink-500">{r.rowIdx}</td>
              <td className="px-2 py-1.5">{r.grade ?? "—"}</td>
              <td className="px-2 py-1.5 text-ink-600">{r.schoolGivenGradeName ?? "—"}</td>
              <td className="px-2 py-1.5 text-ink-600">{r.sections ?? "—"}</td>
              <td className="px-2 py-1.5 text-right">
                <button onClick={() => remove(r.id)} type="button" className="text-ink-400 hover:text-red-600 p-1" aria-label="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
              </td>
            </tr>
          ))}
          <tr className="border-t border-ink-100/70 bg-cream-50/30">
            <td className="px-2 py-1.5 text-ink-400 text-[11px]">{initial.length + 1}</td>
            <td className="px-1 py-1">
              {standardGrades.length > 0 ? (
                <CellSelect value={draft.grade} onChange={(v) => setDraft((d) => ({ ...d, grade: v }))} options={["", ...standardGrades]} />
              ) : (
                <Cell value={draft.grade} onChange={(v) => setDraft((d) => ({ ...d, grade: v }))} placeholder="Grade 10" />
              )}
            </td>
            <td className="px-1 py-1"><Cell value={draft.schoolGivenGradeName} onChange={(v) => setDraft((d) => ({ ...d, schoolGivenGradeName: v }))} placeholder="e.g. Nursery / IK 1" /></td>
            <td className="px-1 py-1"><Cell value={draft.sections} onChange={(v) => setDraft((d) => ({ ...d, sections: v }))} placeholder="A, B, C" /></td>
            <td className="px-2 py-1 text-right">
              <Button busy={busy} variant="primary" onClick={add} type="button" icon={<Plus className="h-3 w-3" />}>Add</Button>
            </td>
          </tr>
        </tbody>
      </table>
      {err ? <div className="mt-2 text-[12px] text-red-700">{err}</div> : null}
    </div>
  );
}

// ─── Uniform Mapping Editor ──────────────────────────────────────

export function UniformMappingEditor({ schoolId, initial }: { schoolId: string; initial: Array<{ id: string; rowIdx: number; grade: string | null; organisationGivenGrade: string | null; sections: string | null; organisationGivenSection: string | null; houseName: string | null }> }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [draft, setDraft] = useState({ grade: "", organisationGivenGrade: "", sections: "", organisationGivenSection: "", houseName: "" });

  function add() {
    if (!draft.grade.trim()) { setErr("Grade is required"); return; }
    setErr(null);
    start(async () => {
      const r = await fetch(`/api/admin/data/schools/${schoolId}/uniform-mappings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grade: draft.grade.trim(),
          organisationGivenGrade: draft.organisationGivenGrade.trim() || null,
          sections: draft.sections.trim() || null,
          organisationGivenSection: draft.organisationGivenSection.trim() || null,
          houseName: draft.houseName.trim() || null,
        }),
      });
      if (!r.ok) { setErr("Failed to add"); return; }
      setDraft({ grade: "", organisationGivenGrade: "", sections: "", organisationGivenSection: "", houseName: "" });
      router.refresh();
    });
  }

  function remove(rowId: string) {
    if (!confirm("Remove this mapping?")) return;
    start(async () => {
      const r = await fetch(`/api/admin/data/schools/${schoolId}/uniform-mappings/${rowId}`, { method: "DELETE" });
      if (!r.ok) { setErr("Failed to delete"); return; }
      router.refresh();
    });
  }

  return (
    <div>
      <table className="w-full text-[13px]">
        <thead className="bg-cream-50/60 text-ink-600">
          <tr><th className="px-2 py-2 text-left w-10">No.</th><th className="px-2 py-2 text-left">Grade *</th><th className="px-2 py-2 text-left">Org-Given Grade</th><th className="px-2 py-2 text-left">Sections</th><th className="px-2 py-2 text-left">Org-Given Section</th><th className="px-2 py-2 text-left">House</th><th className="px-2 py-2 w-10"></th></tr>
        </thead>
        <tbody>
          {initial.map((r) => (
            <tr key={r.id} className="border-t border-ink-100/70">
              <td className="px-2 py-1.5 text-ink-500">{r.rowIdx}</td>
              <td className="px-2 py-1.5">{r.grade ?? "—"}</td>
              <td className="px-2 py-1.5 text-ink-600">{r.organisationGivenGrade ?? "—"}</td>
              <td className="px-2 py-1.5 text-ink-600">{r.sections ?? "—"}</td>
              <td className="px-2 py-1.5 text-ink-600">{r.organisationGivenSection ?? "—"}</td>
              <td className="px-2 py-1.5">{r.houseName ?? "—"}</td>
              <td className="px-2 py-1.5 text-right">
                <button onClick={() => remove(r.id)} type="button" className="text-ink-400 hover:text-red-600 p-1" aria-label="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
              </td>
            </tr>
          ))}
          <tr className="border-t border-ink-100/70 bg-cream-50/30">
            <td className="px-2 py-1.5 text-ink-400 text-[11px]">{initial.length + 1}</td>
            <td className="px-1 py-1"><Cell value={draft.grade} onChange={(v) => setDraft((d) => ({ ...d, grade: v }))} placeholder="Grade 10" /></td>
            <td className="px-1 py-1"><Cell value={draft.organisationGivenGrade} onChange={(v) => setDraft((d) => ({ ...d, organisationGivenGrade: v }))} placeholder="optional" /></td>
            <td className="px-1 py-1"><Cell value={draft.sections} onChange={(v) => setDraft((d) => ({ ...d, sections: v }))} placeholder="A, B" /></td>
            <td className="px-1 py-1"><Cell value={draft.organisationGivenSection} onChange={(v) => setDraft((d) => ({ ...d, organisationGivenSection: v }))} placeholder="optional" /></td>
            <td className="px-1 py-1"><Cell value={draft.houseName} onChange={(v) => setDraft((d) => ({ ...d, houseName: v }))} placeholder="house" /></td>
            <td className="px-2 py-1 text-right">
              <Button busy={busy} variant="primary" onClick={add} type="button" icon={<Plus className="h-3 w-3" />}>Add</Button>
            </td>
          </tr>
        </tbody>
      </table>
      {err ? <div className="mt-2 text-[12px] text-red-700">{err}</div> : null}
    </div>
  );
}
