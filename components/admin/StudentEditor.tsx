"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Save, Trash2, Plus, AlertCircle, X, Users } from "lucide-react";
import { Button } from "@/components/admin/ui/primitives-client";
import {
  Field as UiField,
  Input as UiInput,
  Select as UiSelect,
  Checkbox as UiCheckbox,
} from "@/components/admin/ui/form";
import { Modal } from "@/components/ui/Modal";

// Identity passthrough — was an ERP→CBSE translator that's now obsolete.
// All grade tables are in CBSE space after the Phase A cleanup
// (scripts/cleanup-erp-* + scripts/revert-mcb-grade-plus3). Keeping the
// function name so the picker's call sites don't need a refactor.
function toTargetedGrade(raw: string): string {
  return raw.trim();
}

type Form = {
  enabled: boolean;
  isNewStudent: boolean;
  schoolCode: string;
  enrollmentNumber: string;
  firstName: string;
  middleName: string;
  lastName: string;
  grade: string;
  section: string;
  joiningDate: string;
  houseColor: string;
  medium: string;
  curriculum: string;
  studentEmailId: string;
  studentMobileNumber: string;
  dateOfBirth: string;
  bloodGroup: string;
  gender: string;
  nationality: string;
};

const empty: Form = {
  enabled: true, isNewStudent: false,
  schoolCode: "", enrollmentNumber: "", firstName: "", middleName: "", lastName: "",
  grade: "", section: "", joiningDate: "", houseColor: "", medium: "", curriculum: "",
  studentEmailId: "", studentMobileNumber: "", dateOfBirth: "", bloodGroup: "", gender: "Male", nationality: "Indian",
};

// Human-readable labels for every field that can carry a validation error.
// Used both as the inline label and in the summary banner.
const FIELD_LABEL: Record<string, string> = {
  schoolCode: "School",
  enrollmentNumber: "Enrollment Number",
  firstName: "First Name",
  grade: "Grade",
  section: "Section",
  studentEmailId: "Student Email",
  gender: "Gender",
  guardianName: "Guardian Name",
  guardianPhone: "Guardian Mobile",
  guardianEmail: "Guardian Email",
};

type Errors = Record<string, string>;

// Fallback section list shown when a school/grade has no sections configured
// in school_grade_mappings. Standard A–H.
const DEFAULT_SECTIONS = ["A", "B", "C", "D", "E", "F", "G", "H"];

type GradeMapping = {
  grade: string;              // canonical (e.g. "Grade 1") — what the API stores
  displayName: string | null; // school-given label (e.g. "Class I" or "Grade UKG")
  sections: string | null;    // comma-separated, e.g. "A,B,C,D"
};

export function StudentEditor({
  mode, studentId, initial, schoolCodes, gradeOptions, gradesBySchool,
}: {
  mode: "create" | "edit";
  studentId?: string;
  initial?: Partial<Form>;
  schoolCodes: { code: string; name: string | null }[];
  // Flat fallback list of every grade label known across the catalog. Only
  // used when the selected school has no school_grade_mappings rows so the
  // admin can at least pick something instead of seeing an empty dropdown.
  gradeOptions: string[];
  // Per-school catalog of (canonical grade, school-given display label,
  // sections). Keyed by school *code* (the value the form holds).
  gradesBySchool?: Record<string, GradeMapping[]>;
}) {
  const router = useRouter();
  const [form, setForm] = useState<Form>({ ...empty, ...initial });
  const [busy, start] = useTransition();
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const fieldRefs = useRef<Record<string, HTMLElement | null>>({});

  // Optional guardian — shown only in create mode. In edit mode guardians
  // continue to be managed by GuardianLinkEditor on the detail page.
  const [guardian, setGuardian] = useState({
    guardianName: "",
    relation: "Father",
    email: "",
    phoneNo: "",
  });

  // In-app confirm modal state for the "this mobile is already a guardian"
  // preflight (replaces the native window.confirm we used to ship). Open
  // when preflight returns matched=true; closing it without confirming
  // aborts the whole create, "Yes, link" calls doCreate to proceed.
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [matchedStudents, setMatchedStudents] = useState<
    Array<{
      id: string;
      name: string;
      enrollmentNumber: string | null;
      guardianName: string | null;
      relation: string | null;
    }>
  >([]);

  function set<K extends keyof Form>(k: K, v: Form[K]) {
    setForm((f) => {
      const next = { ...f, [k]: v };
      // Reset Grade + Section when School changes — the previously-picked
      // grade/section may not exist at the new school.
      if (k === "schoolCode") {
        next.grade = "";
        next.section = "";
      }
      // Reset Section when Grade changes — sections are per (school, grade).
      if (k === "grade") {
        next.section = "";
      }
      return next;
    });
    if (errors[k as string]) {
      setErrors((e) => {
        const n = { ...e };
        delete n[k as string];
        return n;
      });
    }
  }
  function setGuardianField<K extends keyof typeof guardian>(k: K, v: string) {
    setGuardian((g) => ({ ...g, [k]: v }));
    const errKey = k === "guardianName" ? "guardianName"
      : k === "phoneNo" ? "guardianPhone"
      : k === "email" ? "guardianEmail" : null;
    if (errKey && errors[errKey]) {
      setErrors((e) => {
        const n = { ...e };
        delete n[errKey];
        return n;
      });
    }
  }

  function validate(): Errors {
    const e: Errors = {};
    if (!form.schoolCode) e.schoolCode = "Pick the school the student belongs to.";
    if (!form.enrollmentNumber.trim()) e.enrollmentNumber = "Enrollment number is required.";
    if (!form.firstName.trim()) e.firstName = "First name is required.";
    // Student email is optional; only validate the format when present so
    // schools can leave it blank for students who don't have one yet.
    if (
      form.studentEmailId.trim() &&
      !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.studentEmailId.trim())
    ) {
      e.studentEmailId = "Enter a valid email address.";
    }
    if (!form.gender) e.gender = "Choose a gender.";
    if (!form.grade) e.grade = "Pick the grade.";
    // Section is optional — some schools don't split sections at all.

    if (mode === "create") {
      const gTouched =
        guardian.guardianName.trim() !== "" ||
        guardian.phoneNo.trim() !== "" ||
        guardian.email.trim() !== "";
      if (gTouched) {
        if (!guardian.guardianName.trim())
          e.guardianName = "Guardian name is required when guardian details are provided.";
        if (guardian.phoneNo && !/^\d{10}$/.test(guardian.phoneNo))
          e.guardianPhone = "Guardian mobile must be exactly 10 digits.";
        if (guardian.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(guardian.email))
          e.guardianEmail = "Enter a valid guardian email.";
      }
    }
    return e;
  }

  function focusFirstError(e: Errors) {
    const first = Object.keys(e)[0];
    if (!first) return;
    const el = fieldRefs.current[first];
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      setTimeout(() => (el as HTMLInputElement | HTMLSelectElement).focus?.(), 250);
    }
  }

  // Compute "guardian fields touched" — only relevant in create mode.
  const gTouched =
    mode === "create" &&
    (guardian.guardianName.trim() !== "" ||
      guardian.phoneNo.trim() !== "" ||
      guardian.email.trim() !== "");

  // Lightweight "checking the phone" state for the brief window between
  // clicking Save and either opening the confirm modal or starting the
  // create. Drives the button busy indicator so the admin gets feedback
  // without a separate transition.
  const [preflightBusy, setPreflightBusy] = useState(false);

  // Entry point from the Save button. Validates the form, then for
  // create-mode flows with a 10-digit guardian mobile runs the
  // /api/admin/data/guardians/check preflight. If the phone is already
  // a guardian on some student, opens the in-app confirm modal listing
  // the matches; otherwise proceeds directly to doCreate.
  async function save() {
    setFormError(null);
    const e1 = validate();
    if (Object.keys(e1).length) {
      setErrors(e1);
      focusFirstError(e1);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    setErrors({});

    if (
      mode === "create" &&
      gTouched &&
      /^\d{10}$/.test(guardian.phoneNo.trim())
    ) {
      setPreflightBusy(true);
      try {
        const checkRes = await fetch(
          `/api/admin/data/guardians/check?phone=${encodeURIComponent(
            guardian.phoneNo.trim()
          )}`
        );
        if (checkRes.ok) {
          const data = (await checkRes.json()) as {
            matched: boolean;
            students: Array<{
              id: string;
              name: string;
              enrollmentNumber: string | null;
              guardianName: string | null;
              relation: string | null;
            }>;
          };
          if (data.matched && data.students.length > 0) {
            setMatchedStudents(data.students);
            setConfirmOpen(true);
            setPreflightBusy(false);
            return;
          }
        }
      } catch {
        // Preflight is best-effort — fall through to the normal create.
        // The guardians POST does the right thing server-side anyway.
      }
      setPreflightBusy(false);
    }

    doCreate();
  }

  // Actual create / update flow — extracted so the in-app confirm modal
  // can call it after the admin clicks "Yes, link to this family".
  function doCreate() {
    setConfirmOpen(false);
    start(async () => {
      const url = mode === "create" ? "/api/admin/data/students" : `/api/admin/data/students/${studentId}`;
      const body = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, typeof v === "string" && v === "" ? null : v]));
      // On edit, don't re-send the email if it's unchanged. Saving any field
      // re-runs the DB email-normaliser trigger (migration 0058), which NULLs
      // any address that fails its strict regex — so an unrelated edit (e.g.
      // changing the grade) would silently wipe a still-imperfect but valid
      // student email. Only send it when the admin actually edited it.
      if (mode === "edit" && form.studentEmailId === (initial?.studentEmailId ?? "")) {
        delete body.studentEmailId;
      }
      const r = await fetch(url, {
        method: mode === "create" ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        // The shared parseJson helper returns { error: "Validation failed",
        // details: [{path, message}] }. Map those details onto our inline
        // error state so the admin sees specific guidance per field.
        if (Array.isArray(d.details)) {
          const mapped: Errors = {};
          for (const item of d.details as { path: string; message: string }[]) {
            const key = item.path;
            if (key && key in FIELD_LABEL) {
              mapped[key] = humanise(key, item.message);
            }
          }
          if (Object.keys(mapped).length) {
            setErrors(mapped);
            setFormError("Some fields need attention before this can be saved.");
            focusFirstError(mapped);
            window.scrollTo({ top: 0, behavior: "smooth" });
            return;
          }
        }
        setFormError(d.error ?? "Save failed");
        return;
      }
      if (mode === "create") {
        const d = await r.json();
        if (gTouched) {
          const gr = await fetch(`/api/admin/data/students/${d.id}/guardians`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              guardianName: guardian.guardianName.trim(),
              relation: guardian.relation || null,
              email: guardian.email.trim() || null,
              phoneNo: guardian.phoneNo.trim() || null,
            }),
          });
          if (!gr.ok) {
            setFormError("Student created but guardian could not be linked. Add it on the detail page.");
          }
        }
        router.push(`/admin/students/${d.id}`);
      }
      else router.refresh();
    });
  }

  function remove() {
    if (!studentId || !confirm("Delete this student? Addresses, guardian links and siblings are also removed.")) return;
    start(async () => {
      const r = await fetch(`/api/admin/data/students/${studentId}`, { method: "DELETE" });
      if (!r.ok) { setFormError("Delete failed"); return; }
      router.push("/admin/students");
    });
  }

  const errorEntries = Object.entries(errors).filter(([k]) => k in FIELD_LABEL);

  // ── Derive Grade + Section dropdown options from school_grade_mappings ──
  // Rules:
  //   • No school picked → dropdown is empty (only the placeholder).
  //   • School with mapping rows → show ONLY the school-given label as the
  //     option text; the canonical "Grade N" stays in the value submitted to
  //     the API. (User specifically wants this — display = school name,
  //     backend = canonical.)
  //   • School with no mapping rows → fall back to the catalog-wide grade
  //     list so this school still has something selectable. Labels are the
  //     canonical names because no school-given label exists for them.
  //   • If the current form.grade isn't in the resulting choices (edit-mode
  //     with stale data), surface it tagged "(legacy)" so it's still visible.
  const schoolGradeRows: GradeMapping[] = form.schoolCode
    ? gradesBySchool?.[form.schoolCode] ?? []
    : [];
  const hasMapping = schoolGradeRows.length > 0;
  const gradeChoices: { value: string; label: string }[] = !form.schoolCode
    ? []
    : hasMapping
      ? schoolGradeRows.map((m) => ({
          // students.grade stores the Targeted vocab (Nursery / LKG / UKG /
          // Grade 1..12) so the picker's value must be Targeted too, even
          // though school_grade_mappings.grade is still ERP-uniform. Without
          // this translation the form posts a uniform value and the
          // storefront filter — which joins on students.grade — finds zero
          // products for that student.
          value: toTargetedGrade(m.grade),
          // Only the school-given name is shown. Canonical grade is hidden.
          label: m.displayName?.trim() || toTargetedGrade(m.grade),
        }))
      : gradeOptions.map((g) => ({ value: g, label: g }));
  if (form.grade && !gradeChoices.some((c) => c.value === form.grade)) {
    // Stored value isn't in the school's mapped choices — surface it
    // tagged so admin sees and can edit it.
    gradeChoices.unshift({ value: form.grade, label: `${form.grade} (legacy)` });
  }

  const matchedRow = schoolGradeRows.find((m) => toTargetedGrade(m.grade) === form.grade);
  const sectionList = (matchedRow?.sections ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  // When the school hasn't configured sections for this grade in
  // school_grade_mappings, fall back to the standard A–H list so the admin
  // always has something to pick instead of an empty "no sections" dropdown.
  const effectiveSections = sectionList.length > 0 ? sectionList : DEFAULT_SECTIONS;
  const sectionChoices = effectiveSections.map((s) => ({ value: s, label: s }));
  if (form.section && !sectionChoices.some((c) => c.value === form.section)) {
    sectionChoices.unshift({ value: form.section, label: `${form.section} (legacy)` });
  }

  return (
    <div className="space-y-5">
      {/* ── Summary banner ─────────────────────────────────────────────── */}
      {errorEntries.length > 0 && (
        <div role="alert" className="rounded-xl border border-red-300 bg-red-50 p-4 shadow-sm">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-red-600 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <h3 className="text-[14px] font-bold text-red-900">
                Please fix the following before saving
              </h3>
              <ul className="mt-2 space-y-1 text-[13px] text-red-800">
                {errorEntries.map(([k, msg]) => (
                  <li key={k}>
                    <button
                      type="button"
                      className="font-semibold underline underline-offset-2 hover:text-red-900"
                      onClick={() => {
                        const el = fieldRefs.current[k];
                        if (el) {
                          el.scrollIntoView({ behavior: "smooth", block: "center" });
                          setTimeout(() => (el as HTMLInputElement | HTMLSelectElement).focus?.(), 250);
                        }
                      }}
                    >
                      {FIELD_LABEL[k]}
                    </button>
                    {" — "}{msg}
                  </li>
                ))}
              </ul>
            </div>
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => setErrors({})}
              className="text-red-600 hover:text-red-800"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {formError && errorEntries.length === 0 && (
        <div role="alert" className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-[13px] font-medium text-red-800">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <div>{formError}</div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-x-6 gap-y-3 rounded-xl border border-ink-100/70 bg-cream-50/50 px-4 py-3">
        {/* Same `students.enabled` field as before, relabelled: "Enabled"
            gave no hint that unticking it puts the closed screen in front
            of the parent for THIS child while siblings shop on. */}
        <UiCheckbox
          checked={form.enabled}
          onChange={(e) => set("enabled", e.target.checked)}
          label={
            <>
              Website access{" "}
              <span className={form.enabled ? "text-emerald-700" : "text-brand-700"}>
                {form.enabled ? "on" : "off — parent sees the closed screen"}
              </span>
            </>
          }
        />
        <UiCheckbox
          checked={form.isNewStudent}
          onChange={(e) => set("isNewStudent", e.target.checked)}
          label="New student"
        />
      </div>

      <SectionHeading>Identity</SectionHeading>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Select
          label="School" required
          fieldRef={(el) => { fieldRefs.current.schoolCode = el; }}
          value={form.schoolCode} onChange={(v) => set("schoolCode", v)}
          options={[{ value: "", label: "— select —" }, ...schoolCodes.map((s) => ({ value: s.code, label: `${s.code} — ${s.name ?? ""}` }))]}
          error={errors.schoolCode}
        />
        <Field label="Joining Date" value={form.joiningDate} onChange={(v) => set("joiningDate", v)} placeholder="YYYY-MM-DD" />
        <Field
          label="Enrollment Number" required
          fieldRef={(el) => { fieldRefs.current.enrollmentNumber = el; }}
          value={form.enrollmentNumber} onChange={(v) => set("enrollmentNumber", v)} mono
          error={errors.enrollmentNumber}
        />
        <Field label="House Color" value={form.houseColor} onChange={(v) => set("houseColor", v)} />
        <Field
          label="First Name" required
          fieldRef={(el) => { fieldRefs.current.firstName = el; }}
          value={form.firstName} onChange={(v) => set("firstName", v)}
          error={errors.firstName}
        />
        <Field label="Medium" value={form.medium} onChange={(v) => set("medium", v)} placeholder="English / Hindi …" />
        <Field label="Middle Name" value={form.middleName} onChange={(v) => set("middleName", v)} />
        <Field label="Curriculum" value={form.curriculum} onChange={(v) => set("curriculum", v)} placeholder="CBSE / ICSE / IB …" />
        <Field label="Last Name" value={form.lastName} onChange={(v) => set("lastName", v)} />
        <Select
          label="Grade" required
          fieldRef={(el) => { fieldRefs.current.grade = el; }}
          value={form.grade}
          onChange={(v) => set("grade", v)}
          error={errors.grade}
          options={[
            {
              value: "",
              label: !form.schoolCode
                ? "— select a school first —"
                : hasMapping
                  ? "— select grade —"
                  : "— no mapping for this school —",
            },
            ...gradeChoices,
          ]}
        />
        <Select
          label="Section"
          fieldRef={(el) => { fieldRefs.current.section = el; }}
          value={form.section}
          onChange={(v) => set("section", v)}
          error={errors.section}
          options={[
            {
              value: "",
              label: !form.grade
                ? "— select a grade first —"
                : "— select section —",
            },
            ...sectionChoices,
          ]}
        />
      </div>

      <SectionHeading className="mt-2">Personal</SectionHeading>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field
          label="Student Email"
          fieldRef={(el) => { fieldRefs.current.studentEmailId = el; }}
          value={form.studentEmailId} onChange={(v) => set("studentEmailId", v)}
          error={errors.studentEmailId}
        />
        <Field label="Student Mobile" value={form.studentMobileNumber} onChange={(v) => set("studentMobileNumber", v)} mono />
        <Field label="Date of Birth" value={form.dateOfBirth} onChange={(v) => set("dateOfBirth", v)} placeholder="YYYY-MM-DD" />
        <Select
          label="Gender" required
          fieldRef={(el) => { fieldRefs.current.gender = el; }}
          value={form.gender} onChange={(v) => set("gender", v)}
          options={[{ value: "Male", label: "Male" }, { value: "Female", label: "Female" }, { value: "Other", label: "Other" }]}
          error={errors.gender}
        />
        <Field label="Blood Group" value={form.bloodGroup} onChange={(v) => set("bloodGroup", v)} placeholder="O+, A-, …" />
        <Field label="Nationality" value={form.nationality} onChange={(v) => set("nationality", v)} />
      </div>

      {mode === "create" ? (
        <>
          <SectionHeading className="mt-2">
            Guardian <span className="text-[12px] font-normal text-ink-500">(optional)</span>
          </SectionHeading>
          <p className="text-[12px] text-ink-500 -mt-2">
            If you provide a 10-digit mobile, a parent login account is created
            (or linked to an existing one) and the student is attached to it.
            Leave blank to add guardians later on the detail page.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field
              label="Guardian Name"
              fieldRef={(el) => { fieldRefs.current.guardianName = el; }}
              value={guardian.guardianName} onChange={(v) => setGuardianField("guardianName", v)}
              error={errors.guardianName}
            />
            <Select label="Relation" value={guardian.relation}
              onChange={(v) => setGuardian((g) => ({ ...g, relation: v }))}
              options={[
                { value: "Father", label: "Father" },
                { value: "Mother", label: "Mother" },
                { value: "Guardian", label: "Guardian" },
                { value: "Other", label: "Other" },
              ]} />
            <Field
              label="Guardian Email"
              fieldRef={(el) => { fieldRefs.current.guardianEmail = el; }}
              value={guardian.email} onChange={(v) => setGuardianField("email", v)}
              error={errors.guardianEmail}
            />
            <Field
              label="Guardian Mobile"
              fieldRef={(el) => { fieldRefs.current.guardianPhone = el; }}
              value={guardian.phoneNo}
              onChange={(v) => setGuardianField("phoneNo", v.replace(/\D/g, "").slice(0, 10))}
              mono placeholder="10 digits"
              error={errors.guardianPhone}
            />
          </div>
        </>
      ) : null}

      <div className="flex items-center justify-end gap-2 pt-4 border-t border-ink-100/70">
        {mode === "edit" ? <Button busy={busy} onClick={remove} type="button" variant="danger" icon={<Trash2 className="h-3.5 w-3.5" />}>Delete</Button> : null}
        <Button busy={busy || preflightBusy} onClick={save} type="button" variant="primary" icon={<Save className="h-3.5 w-3.5" />}>{mode === "create" ? "Create student" : "Save"}</Button>
      </div>

      {/* ── Confirm linking to an existing family ────────────────────────
          Shown when the entered guardian mobile is already a guardian on
          another student. Lists matched students so the admin can decide
          whether to link (which fan-outs the full roster across this new
          student) or cancel and use a different mobile. */}
      <Modal
        open={confirmOpen}
        onClose={() => {
          setConfirmOpen(false);
          setPreflightBusy(false);
        }}
        title="Link to existing family?"
        maxWidth="max-w-lg"
      >
        <div className="p-6">
          <div className="flex items-start gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-full bg-amber-50 text-amber-600 flex-shrink-0">
              <Users className="h-5 w-5" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-[15px] font-bold text-ink-900">
                Link to existing family?
              </h3>
              <p className="mt-1 text-[12.5px] text-ink-600">
                The mobile <span className="font-mono">{guardian.phoneNo}</span>{" "}
                is already a guardian for the student
                {matchedStudents.length === 1 ? "" : "s"} below. If you link,
                the full guardian roster (all phone numbers and emails) is
                copied across so the same login can sign in for everyone.
              </p>
            </div>
          </div>

          <ul className="mt-4 space-y-2">
            {matchedStudents.slice(0, 6).map((s) => (
              <li
                key={s.id}
                className="rounded-lg border border-ink-100 bg-cream-50/40 px-3 py-2"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <div className="font-semibold text-[13px] text-ink-900 truncate">
                    {s.name}
                  </div>
                  {s.enrollmentNumber ? (
                    <div className="font-mono text-[11.5px] text-ink-500 flex-shrink-0">
                      {s.enrollmentNumber}
                    </div>
                  ) : null}
                </div>
                {s.guardianName ? (
                  <div className="mt-0.5 text-[11.5px] text-ink-600">
                    Guardian: {s.guardianName}
                    {s.relation ? (
                      <span className="text-ink-400"> · {s.relation}</span>
                    ) : null}
                  </div>
                ) : null}
              </li>
            ))}
            {matchedStudents.length > 6 ? (
              <li className="text-[11.5px] text-ink-500 px-1">
                …and {matchedStudents.length - 6} more.
              </li>
            ) : null}
          </ul>

          <div className="mt-5 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setConfirmOpen(false);
                setPreflightBusy(false);
              }}
              className="h-9 px-4 rounded-lg text-[13px] font-semibold text-ink-700 hover:bg-cream-100 transition"
            >
              Cancel
            </button>
            <Button
              busy={busy}
              onClick={doCreate}
              type="button"
              variant="primary"
              icon={<Users className="h-3.5 w-3.5" />}
            >
              Yes, link to this family
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// Map Zod's terser messages to something an admin can act on.
function humanise(field: string, msg: string): string {
  if (/string must contain at least 1 character/i.test(msg) || msg === "Required") {
    const label = FIELD_LABEL[field] ?? "This field";
    return `${label} is required.`;
  }
  if (/invalid email/i.test(msg)) return "Enter a valid email address.";
  if (/expected string/i.test(msg)) return "This field is required.";
  return msg;
}

type SiblingMatch = { id: string; name: string; enrollmentNumber: string | null; guardianName: string | null; relation: string | null };
type ConfirmRequest = { phone: string; matches: SiblingMatch[]; onConfirm: () => void; onCancel: () => void };

export function GuardianLinkEditor({ studentId, initial }: { studentId: string; initial: Array<{ id: string; rowIdx: number; guardianErpName: string | null; guardianName: string | null; relation: string | null; email: string | null; phoneNo: string | null; knownErpNames?: string[] | null; loginStatus?: "ready" | "pending" | "invalid" }> }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [row, setRow] = useState({ guardianName: "", relation: "Father", email: "", phoneNo: "" });
  const [err, setErr] = useState<string | null>(null);
  const [preflightBusy, setPreflightBusy] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState<ConfirmRequest | null>(null);
  // Live preflight: when the admin types a 10-digit phone in the Add
  // row, debounce-fetch the canonical guardians-master row for that
  // phone. Prefill name/email if blank, surface a hint so the admin
  // sees the row will link to the existing master instead of minting
  // a duplicate. Dedup is enforced server-side by ensureGuardianMaster
  // + the guardians_unique_phone partial index from migration 0021 —
  // this is purely the UI affordance.
  const [livePreflight, setLivePreflight] = useState<{
    phone: string;
    master: { erpName: string | null; guardianName: string | null; email: string | null } | null;
    matchedStudentCount: number;
  } | null>(null);
  useEffect(() => {
    const phone = row.phoneNo.replace(/\D/g, "").slice(-10);
    if (!/^\d{10}$/.test(phone)) {
      setLivePreflight(null);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const r = await fetch(
          `/api/admin/data/guardians/check?phone=${encodeURIComponent(phone)}&excludeStudentId=${encodeURIComponent(studentId)}`
        );
        if (!r.ok) return;
        const data = (await r.json()) as {
          matched: boolean;
          students: Array<unknown>;
          master: {
            erpName: string | null;
            guardianName: string | null;
            email: string | null;
          } | null;
        };
        setLivePreflight({
          phone,
          master: data.master,
          matchedStudentCount: data.students.length,
        });
        // Prefill empty fields from the canonical master.
        setRow((curr) => ({
          ...curr,
          guardianName:
            curr.guardianName.trim().length === 0 && data.master?.guardianName
              ? data.master.guardianName
              : curr.guardianName,
          email:
            curr.email.trim().length === 0 && data.master?.email
              ? data.master.email
              : curr.email,
        }));
      } catch {
        // Best-effort UI hint.
      }
    }, 300);
    return () => clearTimeout(t);
  }, [row.phoneNo, studentId]);
  const confirmOpen = pendingConfirm !== null;
  const matchedStudents = pendingConfirm?.matches ?? [];
  const confirmPhone = pendingConfirm?.phone ?? "";
  function closeConfirm() {
    pendingConfirm?.onCancel();
    setPendingConfirm(null);
    setPreflightBusy(false);
  }
  function confirmAccept() {
    const req = pendingConfirm;
    setPendingConfirm(null);
    setPreflightBusy(false);
    req?.onConfirm();
  }

  function doAdd() {
    setPendingConfirm(null);
    start(async () => {
      const r = await fetch(`/api/admin/data/students/${studentId}/guardians`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          guardianName: row.guardianName.trim(),
          relation: row.relation || null,
          email: row.email.trim() || null,
          phoneNo: row.phoneNo.trim() || null,
        }),
      });
      if (!r.ok) { setErr("Failed"); return; }
      setRow({ guardianName: "", relation: "Father", email: "", phoneNo: "" });
      router.refresh();
    });
  }

  async function add() {
    if (!row.guardianName.trim()) { setErr("Guardian name required"); return; }
    setErr(null);
    const phone = row.phoneNo.trim();
    // Preflight: if this 10-digit number is already a guardian on other
    // students, warn the admin that adding it will merge this student into
    // that family (parent_id flip + roster copy + sibling fan-out).
    if (/^\d{10}$/.test(phone)) {
      setPreflightBusy(true);
      try {
        const checkRes = await fetch(
          `/api/admin/data/guardians/check?phone=${encodeURIComponent(phone)}&excludeStudentId=${encodeURIComponent(studentId)}`
        );
        if (checkRes.ok) {
          const data = (await checkRes.json()) as {
            matched: boolean;
            students: Array<{
              id: string;
              name: string;
              enrollmentNumber: string | null;
              guardianName: string | null;
              relation: string | null;
            }>;
          };
          if (data.matched && data.students.length > 0) {
            setPendingConfirm({
              phone,
              matches: data.students,
              onConfirm: doAdd,
              onCancel: () => {},
            });
            setPreflightBusy(false);
            return;
          }
        }
      } catch {
        // Preflight is best-effort — fall through to the normal add.
      }
      setPreflightBusy(false);
    }
    doAdd();
  }

  function remove(rowId: string) {
    if (!confirm("Unlink this guardian?")) return;
    start(async () => {
      const r = await fetch(`/api/admin/data/students/${studentId}/guardians/${rowId}`, { method: "DELETE" });
      if (!r.ok) { setErr("Failed"); return; }
      router.refresh();
    });
  }

  return (
    <div>
      <table className="w-full text-[13px]">
        <thead className="bg-cream-50/60 text-ink-600">
          <tr><th className="px-2 py-2 text-left w-10">No.</th><th className="px-2 py-2 text-left">Guardian Name *</th><th className="px-2 py-2 text-left">Relation</th><th className="px-2 py-2 text-left">Email</th><th className="px-2 py-2 text-left">Phone</th><th className="px-2 py-2 text-left">Login</th><th className="px-2 py-2 w-10"></th></tr>
        </thead>
        <tbody>
          {initial.map((r) => (
            <GuardianLinkRow key={r.id} studentId={studentId} initial={r} onError={setErr} onRequestConfirm={setPendingConfirm} />
          ))}
          <tr className="border-t border-ink-100/70 bg-cream-50/30">
            <td className="px-2 py-1.5 text-ink-400 text-[11px]">{initial.length + 1}</td>
            <td className="px-1 py-1"><Cell value={row.guardianName} onChange={(v) => setRow((r) => ({ ...r, guardianName: v }))} placeholder="name" /></td>
            <td className="px-1 py-1"><select value={row.relation} onChange={(e) => setRow((r) => ({ ...r, relation: e.target.value }))} className="w-full h-8 px-2 text-[13px] rounded bg-white border border-transparent hover:border-ink-200"><option>Father</option><option>Mother</option><option>Guardian</option><option>Other</option></select></td>
            <td className="px-1 py-1"><Cell value={row.email} onChange={(v) => setRow((r) => ({ ...r, email: v }))} placeholder="email" /></td>
            <td className="px-1 py-1"><Cell value={row.phoneNo} onChange={(v) => setRow((r) => ({ ...r, phoneNo: v }))} mono placeholder="phone" /></td>
            <td className="px-2 py-1.5 text-ink-400 text-[11px]">—</td>
            <td className="px-2 py-1 text-right">
              <Button busy={busy || preflightBusy} variant="primary" onClick={add} type="button" icon={<Plus className="h-3 w-3" />}>Add</Button>
            </td>
          </tr>
        </tbody>
      </table>
      {(() => {
        if (!livePreflight || livePreflight.phone !== row.phoneNo.replace(/\D/g, "").slice(-10))
          return null;
        if (livePreflight.master) {
          return (
            <div className="mt-2 rounded-md border border-emerald-200 bg-emerald-50/70 px-3 py-2 text-[12px] text-emerald-800">
              Will link to existing guardian
              {livePreflight.master.guardianName ? (
                <>
                  : <span className="font-semibold">{livePreflight.master.guardianName}</span>
                </>
              ) : null}
              {livePreflight.master.erpName ? (
                <span className="ml-1 font-mono text-[11px] text-emerald-700">
                  ({livePreflight.master.erpName})
                </span>
              ) : null}
              {livePreflight.matchedStudentCount > 0 ? (
                <span className="ml-1 text-emerald-700">
                  · already on {livePreflight.matchedStudentCount} other student
                  {livePreflight.matchedStudentCount === 1 ? "" : "s"} — will join that family
                </span>
              ) : null}
            </div>
          );
        }
        if (livePreflight.matchedStudentCount > 0) {
          return (
            <div className="mt-2 rounded-md border border-amber-200 bg-amber-50/70 px-3 py-2 text-[12px] text-amber-800">
              This phone is on {livePreflight.matchedStudentCount} other student
              {livePreflight.matchedStudentCount === 1 ? "" : "s"}. Adding it here will merge
              this student into that family.
            </div>
          );
        }
        return (
          <div className="mt-2 text-[11.5px] text-ink-500">
            New phone — a fresh guardian + parent record will be created.
          </div>
        );
      })()}
      {err ? <div className="mt-2 text-[12px] text-red-700">{err}</div> : null}

      <Modal
        open={confirmOpen}
        onClose={closeConfirm}
        title="Link to existing family?"
        maxWidth="max-w-lg"
      >
        <div className="p-6">
          <div className="flex items-start gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-full bg-amber-50 text-amber-600 flex-shrink-0">
              <Users className="h-5 w-5" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-[15px] font-bold text-ink-900">
                Link to existing family?
              </h3>
              <p className="mt-1 text-[12.5px] text-ink-600">
                The mobile <span className="font-mono">{confirmPhone}</span>{" "}
                is already a guardian for the student
                {matchedStudents.length === 1 ? "" : "s"} below. If you link,
                this student will be merged into that family — they will
                become siblings, and the full guardian roster is copied
                across so the same login signs in for everyone.
              </p>
            </div>
          </div>

          <ul className="mt-4 space-y-2">
            {matchedStudents.slice(0, 6).map((s) => (
              <li key={s.id} className="rounded-lg border border-ink-100 bg-cream-50/40 px-3 py-2">
                <div className="flex items-baseline justify-between gap-3">
                  <div className="font-semibold text-[13px] text-ink-900 truncate">{s.name}</div>
                  {s.enrollmentNumber ? (
                    <div className="font-mono text-[11.5px] text-ink-500 flex-shrink-0">{s.enrollmentNumber}</div>
                  ) : null}
                </div>
                {s.guardianName ? (
                  <div className="mt-0.5 text-[11.5px] text-ink-600">
                    Guardian: {s.guardianName}
                    {s.relation ? <span className="text-ink-400"> · {s.relation}</span> : null}
                  </div>
                ) : null}
              </li>
            ))}
            {matchedStudents.length > 6 ? (
              <li className="text-[11.5px] text-ink-500 px-1">…and {matchedStudents.length - 6} more.</li>
            ) : null}
          </ul>

          <div className="mt-5 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={closeConfirm}
              className="h-9 px-4 rounded-lg text-[13px] font-semibold text-ink-700 hover:bg-cream-100 transition"
            >
              Cancel
            </button>
            <Button busy={busy} onClick={confirmAccept} type="button" variant="primary" icon={<Users className="h-3.5 w-3.5" />}>
              Yes, link to this family
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

/**
 * Single existing-guardian row. The phone field is editable in place —
 * on blur (or Enter) it PATCHes /api/admin/data/students/[id]/guardians/[rowId]
 * which replays the auto-link pipeline: upsert parents row for the new
 * phone, attach the student if unclaimed, mint LOCAL-PH-{phone} master,
 * and fan the new phone to siblings. After save, router.refresh()
 * recomputes the LoginBadge ("invalid → ready").
 */
function GuardianLinkRow({
  studentId,
  initial,
  onError,
  onRequestConfirm,
}: {
  studentId: string;
  initial: {
    id: string;
    rowIdx: number;
    guardianErpName: string | null;
    guardianName: string | null;
    relation: string | null;
    email: string | null;
    phoneNo: string | null;
    /** Other ERPNext Guardian DocType IDs that share this phone — folded
     *  into this single row by the dedup helper. Surfaced as a small
     *  caption so admins can still trace ERP-side duplication without
     *  seeing them as separate guardians. */
    knownErpNames?: string[] | null;
    loginStatus?: "ready" | "pending" | "invalid";
  };
  onError: (msg: string | null) => void;
  onRequestConfirm: (req: ConfirmRequest) => void;
}) {
  const router = useRouter();
  const [phone, setPhone] = useState<string>(initial.phoneNo ?? "");
  const [busy, start] = useTransition();

  function remove() {
    if (!confirm("Unlink this guardian?")) return;
    start(async () => {
      const r = await fetch(
        `/api/admin/data/students/${studentId}/guardians/${initial.id}`,
        { method: "DELETE" }
      );
      if (!r.ok) {
        onError("Failed to unlink");
        return;
      }
      router.refresh();
    });
  }

  function doPatch(trimmed: string) {
    onError(null);
    start(async () => {
      const r = await fetch(
        `/api/admin/data/students/${studentId}/guardians/${initial.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phoneNo: trimmed || null }),
        }
      );
      if (!r.ok) {
        const data = (await r.json().catch(() => null)) as { error?: string } | null;
        onError(data?.error ?? "Failed to update phone");
        // Revert the local input to the canonical value so admin sees
        // the row in DB state, not the rejected edit.
        setPhone(initial.phoneNo ?? "");
        return;
      }
      router.refresh();
    });
  }

  async function commit() {
    const trimmed = phone.trim();
    const wasTrimmed = (initial.phoneNo ?? "").trim();
    if (trimmed === wasTrimmed) return;
    // Preflight: if changing to a 10-digit number already linked elsewhere,
    // confirm the sibling-merge before issuing the PATCH (which fans the
    // new phone across the household and may re-parent this student).
    const last10 = trimmed.replace(/\D/g, "").slice(-10);
    if (/^\d{10}$/.test(last10)) {
      try {
        const checkRes = await fetch(
          `/api/admin/data/guardians/check?phone=${encodeURIComponent(last10)}&excludeStudentId=${encodeURIComponent(studentId)}`
        );
        if (checkRes.ok) {
          const data = (await checkRes.json()) as {
            matched: boolean;
            students: Array<{ id: string; name: string; enrollmentNumber: string | null; guardianName: string | null; relation: string | null }>;
          };
          if (data.matched && data.students.length > 0) {
            onRequestConfirm({
              phone: trimmed,
              matches: data.students,
              onConfirm: () => doPatch(trimmed),
              onCancel: () => setPhone(initial.phoneNo ?? ""),
            });
            return;
          }
        }
      } catch {
        // Best-effort; fall through to direct patch.
      }
    }
    doPatch(trimmed);
  }

  return (
    <tr className="border-t border-ink-100/70">
      <td className="px-2 py-1.5 text-ink-500">{initial.rowIdx}</td>
      <td className="px-2 py-1.5">
        {initial.guardianName ?? "—"}
        {initial.guardianErpName ? (
          <span className="text-[11px] text-ink-500 ml-1 font-mono">
            ({initial.guardianErpName})
          </span>
        ) : null}
        {(() => {
          // Show other ERPNext Guardian DocType IDs that share this
          // phone — folded into this row by the phone-canonical dedup.
          const extras = (initial.knownErpNames ?? []).filter(
            (n) => n && n !== initial.guardianErpName
          );
          if (extras.length === 0) return null;
          return (
            <div className="text-[11px] text-ink-500 mt-0.5 font-mono">
              Also known in ERPNext as: {extras.join(", ")}
            </div>
          );
        })()}
      </td>
      <td className="px-2 py-1.5">{initial.relation ?? "—"}</td>
      <td className="px-2 py-1.5 text-ink-600">{initial.email ?? "—"}</td>
      <td className="px-1 py-1">
        <div className="relative">
          <input
            type="text"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                (e.target as HTMLInputElement).blur();
              }
            }}
            disabled={busy}
            placeholder="phone"
            className={
              "font-mono text-[12.5px] w-full h-8 px-2 rounded border bg-white " +
              "border-ink-200 hover:border-ink-300 focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-300/30 " +
              (busy ? "opacity-60 cursor-wait" : "")
            }
          />
          {busy ? (
            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-ink-500">
              saving…
            </span>
          ) : null}
        </div>
      </td>
      <td className="px-2 py-1.5">
        <LoginBadge status={initial.loginStatus ?? "invalid"} />
      </td>
      <td className="px-2 py-1.5 text-right">
        <button
          onClick={remove}
          type="button"
          className="text-ink-400 hover:text-red-600 p-1"
          aria-label="Delete"
          disabled={busy}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </td>
    </tr>
  );
}

function LoginBadge({ status }: { status: "ready" | "pending" | "invalid" }) {
  const cfg = {
    ready: { label: "Login-ready", cls: "bg-green-50 text-green-700 border-green-200" },
    pending: { label: "First login pending", cls: "bg-amber-50 text-amber-700 border-amber-200" },
    invalid: { label: "Invalid phone", cls: "bg-red-50 text-red-700 border-red-200" },
  }[status];
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[11px] ${cfg.cls}`}>
      {cfg.label}
    </span>
  );
}

function SectionHeading({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <h3 className={"text-[11px] font-semibold tracking-[0.08em] uppercase text-ink-500 " + (className ?? "")}>
      {children}
    </h3>
  );
}

function Field({
  label, value, onChange, placeholder, mono, required, error, fieldRef,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
  required?: boolean;
  error?: string;
  fieldRef?: (el: HTMLInputElement | null) => void;
}) {
  const id = "sf-" + label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return (
    <UiField label={label} htmlFor={id} required={required} error={error}>
      <UiInput
        id={id}
        ref={fieldRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        invalid={!!error}
        className={mono ? "font-mono" : undefined}
        autoComplete="off"
      />
    </UiField>
  );
}

function Select({
  label, value, onChange, options, required, error, fieldRef,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  required?: boolean;
  error?: string;
  fieldRef?: (el: HTMLSelectElement | null) => void;
}) {
  const id = "ss-" + label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return (
    <UiField label={label} htmlFor={id} required={required} error={error}>
      <UiSelect id={id} ref={fieldRef} value={value} onChange={(e) => onChange(e.target.value)} invalid={!!error}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </UiSelect>
    </UiField>
  );
}

function Cell({
  value,
  onChange,
  placeholder,
  mono,
  onBlur,
  onEnter,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
  onBlur?: () => void;
  onEnter?: () => void;
  disabled?: boolean;
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      onKeyDown={
        onEnter
          ? (e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                (e.target as HTMLInputElement).blur();
                onEnter();
              }
            }
          : undefined
      }
      placeholder={placeholder}
      disabled={disabled}
      className={
        (mono ? "font-mono text-[12px] " : "text-[13px] ") +
        (disabled
          ? "w-full h-8 px-2 rounded bg-cream-50 border border-transparent text-ink-400 "
          : "w-full h-8 px-2 rounded bg-white border border-transparent placeholder:text-ink-400 hover:border-ink-200 focus:outline-none focus:border-ink-400 focus:ring-2 focus:ring-brand-300/30")
      }
    />
  );
}
