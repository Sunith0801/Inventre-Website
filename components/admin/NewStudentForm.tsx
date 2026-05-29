"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Save,
  GraduationCap,
  UserPlus,
  AlertCircle,
  CheckCircle2,
  X,
} from "lucide-react";
import { Button } from "@/components/admin/ui/primitives-client";

type SchoolOpt = { id: string; name: string; slug: string };

const GRADES = [
  "Nursery",
  "LKG",
  "UKG",
  "Grade 1",
  "Grade 2",
  "Grade 3",
  "Grade 4",
  "Grade 5",
  "Grade 6",
  "Grade 7",
  "Grade 8",
  "Grade 9",
  "Grade 10",
  "Grade 11",
  "Grade 12",
];

// Human-readable labels for each error key, used in the summary banner.
const FIELD_LABEL: Record<string, string> = {
  name: "Student name",
  schoolId: "School",
  guardianName: "Guardian name",
  guardianPhone: "Guardian mobile",
  guardianEmail: "Guardian email",
};

type Errors = Partial<Record<keyof typeof FIELD_LABEL, string>>;

/**
 * Single-page student creation form. Student and Guardian are rendered as two
 * stacked sections (not tabs) so the admin sees every required field at once.
 * Guardian is optional — if the admin enters any guardian fields, both name
 * and a 10-digit mobile are required together (the mobile is the parent
 * login key on the shop).
 */
export function NewStudentForm({ schools }: { schools: SchoolOpt[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);
  const fieldRefs = useRef<Record<string, HTMLElement | null>>({});

  // Student fields
  const [name, setName] = useState("");
  const [schoolId, setSchoolId] = useState(schools[0]?.id ?? "");
  const [grade, setGrade] = useState("");
  const [section, setSection] = useState("");
  const [enrollmentNumber, setEnrollmentNumber] = useState("");

  // Guardian fields
  const [gName, setGName] = useState("");
  const [gPhone, setGPhone] = useState("");
  const [gEmail, setGEmail] = useState("");
  const [gNotes, setGNotes] = useState("");

  const clearFieldError = (k: keyof typeof FIELD_LABEL) =>
    setErrors((e) => {
      if (!e[k]) return e;
      const next = { ...e };
      delete next[k];
      return next;
    });

  const validate = (): Errors => {
    const e: Errors = {};
    if (!name.trim()) e.name = "Enter the student's full name.";
    if (!schoolId) e.schoolId = "Choose the student's school.";

    // Guardian is optional, but if the admin touched any guardian field we
    // require name + 10-digit mobile together (the mobile is the parent
    // login key on the shop).
    const guardianTouched =
      gName.trim() !== "" ||
      gPhone !== "" ||
      gEmail.trim() !== "" ||
      gNotes.trim() !== "";
    if (guardianTouched) {
      if (!gName.trim()) e.guardianName = "Guardian name is required.";
      if (!/^\d{10}$/.test(gPhone))
        e.guardianPhone = "Guardian mobile must be exactly 10 digits.";
      if (gEmail.trim() !== "" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(gEmail))
        e.guardianEmail = "Enter a valid email address.";
    }
    return e;
  };

  const focusFirstError = (e: Errors) => {
    const first = Object.keys(e)[0];
    if (!first) return;
    const el = fieldRefs.current[first];
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      // tiny delay so the scroll has visibly started before the input grabs focus
      setTimeout(() => (el as HTMLInputElement | HTMLSelectElement).focus?.(), 250);
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setSuccess(null);

    const e1 = validate();
    if (Object.keys(e1).length) {
      setErrors(e1);
      focusFirstError(e1);
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    setErrors({});

    const guardianTouched =
      gName.trim() !== "" ||
      gPhone !== "" ||
      gEmail.trim() !== "" ||
      gNotes.trim() !== "";

    start(async () => {
      const r = await fetch("/api/admin/students", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          schoolId,
          class: grade || null,
          section: section.trim() || null,
          enrollmentNumber: enrollmentNumber.trim() || null,
          guardianName: guardianTouched ? gName.trim() : null,
          guardianPhone: guardianTouched ? gPhone : null,
          guardianEmail: guardianTouched ? gEmail.trim() || null : null,
          guardianNotes: guardianTouched ? gNotes.trim() || null : null,
        }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        // Map structured field errors from the API onto the inline form state
        // so the admin doesn't have to translate Zod-speak. Fall back to a
        // top-of-form message for anything else (auth, network, server).
        if (d.fields && typeof d.fields === "object") {
          const mapped: Errors = {};
          for (const [path, msg] of Object.entries(d.fields)) {
            if (path in FIELD_LABEL) {
              (mapped as Record<string, string>)[path] = String(msg);
            }
          }
          if (Object.keys(mapped).length) {
            setErrors(mapped);
            setFormError(d.error ?? "Some fields need attention.");
            focusFirstError(mapped);
            return;
          }
        }
        setFormError(d.error ?? "Couldn't create the student. Try again.");
        return;
      }
      const data = await r.json();
      setSuccess(
        data.parentPhone
          ? `Created. Guardian ${data.parentCreated ? "added" : "linked"} — they can now log in with ${data.parentPhone} via OTP.`
          : "Student created (no guardian linked).",
      );
      setTimeout(() => router.push("/admin/students"), 1200);
    });
  };

  const errorEntries = Object.entries(errors).filter(([k]) => k in FIELD_LABEL) as [
    keyof typeof FIELD_LABEL,
    string,
  ][];

  return (
    <form ref={formRef} onSubmit={submit} className="space-y-6" noValidate>
      {/* ── Summary banner ─────────────────────────────────────────────── */}
      {errorEntries.length > 0 && (
        <div
          role="alert"
          className="rounded-xl border border-red-300 bg-red-50 p-4 shadow-sm"
        >
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
                          setTimeout(
                            () => (el as HTMLInputElement | HTMLSelectElement).focus?.(),
                            250,
                          );
                        }
                      }}
                    >
                      {FIELD_LABEL[k]}
                    </button>
                    {" — "}
                    {msg}
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
        <div
          role="alert"
          className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-[13px] font-medium text-red-800"
        >
          <div className="flex items-start gap-2">
            <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <div>{formError}</div>
          </div>
        </div>
      )}

      {success && (
        <div
          role="status"
          className="rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-[13px] font-medium text-emerald-800"
        >
          <div className="flex items-start gap-2">
            <CheckCircle2 className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <div>{success}</div>
          </div>
        </div>
      )}

      {/* ── Student section ────────────────────────────────────────────── */}
      <section>
        <SectionHeader
          icon={<GraduationCap className="h-3.5 w-3.5" />}
          title="Student"
        />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Field
            label="Student name"
            required
            error={errors.name}
            className="lg:col-span-2"
          >
            <input
              ref={(el) => {
                fieldRefs.current.name = el;
              }}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                clearFieldError("name");
              }}
              className={inputClass(!!errors.name)}
              placeholder="e.g. A J Aarti"
              aria-invalid={!!errors.name}
              aria-describedby={errors.name ? "err-name" : undefined}
            />
          </Field>
          <Field label="School" required error={errors.schoolId}>
            <select
              ref={(el) => {
                fieldRefs.current.schoolId = el;
              }}
              value={schoolId}
              onChange={(e) => {
                setSchoolId(e.target.value);
                clearFieldError("schoolId");
              }}
              className={inputClass(!!errors.schoolId)}
              aria-invalid={!!errors.schoolId}
              aria-describedby={errors.schoolId ? "err-schoolId" : undefined}
            >
              <option value="">Select a school…</option>
              {schools.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Grade / Class">
            <select
              value={grade}
              onChange={(e) => setGrade(e.target.value)}
              className={inputClass(false)}
            >
              <option value="">—</option>
              {GRADES.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Section">
            <input
              value={section}
              onChange={(e) => setSection(e.target.value)}
              className={inputClass(false)}
              placeholder="A, B, …"
              maxLength={4}
            />
          </Field>
          <Field label="Enrollment number">
            <input
              value={enrollmentNumber}
              onChange={(e) => setEnrollmentNumber(e.target.value)}
              className={inputClass(false) + " font-mono"}
            />
          </Field>
        </div>
      </section>

      {/* ── Guardian section (optional) ────────────────────────────────── */}
      <section>
        <SectionHeader
          icon={<UserPlus className="h-3.5 w-3.5" />}
          title="Guardian (optional)"
        />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="lg:col-span-2 rounded-xl border border-ink-200 bg-cream-50 p-3 text-[12px] text-ink-700">
            Guardian details are optional. If you provide them, the mobile is
            the login key on the shop — a parent with the same number is
            linked, otherwise a new parent record is created. Both name and a
            10-digit mobile are needed together.
          </div>
          <Field label="Guardian name" error={errors.guardianName}>
            <input
              ref={(el) => {
                fieldRefs.current.guardianName = el;
              }}
              value={gName}
              onChange={(e) => {
                setGName(e.target.value);
                clearFieldError("guardianName");
              }}
              className={inputClass(!!errors.guardianName)}
              placeholder="e.g. SRIVANDLA JALENDHAR NATH"
              aria-invalid={!!errors.guardianName}
            />
          </Field>
          <Field
            label="Guardian mobile"
            hint="10 digits, login key"
            error={errors.guardianPhone}
          >
            <input
              ref={(el) => {
                fieldRefs.current.guardianPhone = el;
              }}
              value={gPhone}
              onChange={(e) => {
                setGPhone(e.target.value.replace(/\D/g, "").slice(0, 10));
                clearFieldError("guardianPhone");
              }}
              className={inputClass(!!errors.guardianPhone) + " font-mono"}
              placeholder="9885319071"
              maxLength={10}
              inputMode="numeric"
              aria-invalid={!!errors.guardianPhone}
            />
          </Field>
          <Field label="Guardian email" error={errors.guardianEmail}>
            <input
              ref={(el) => {
                fieldRefs.current.guardianEmail = el;
              }}
              type="email"
              value={gEmail}
              onChange={(e) => {
                setGEmail(e.target.value);
                clearFieldError("guardianEmail");
              }}
              className={inputClass(!!errors.guardianEmail)}
              aria-invalid={!!errors.guardianEmail}
            />
          </Field>
          <Field label="Notes">
            <input
              value={gNotes}
              onChange={(e) => setGNotes(e.target.value)}
              className={inputClass(false)}
            />
          </Field>
        </div>
      </section>

      {/* ── Footer ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-end gap-3 pt-2 border-t border-ink-100">
        <Button busy={pending} icon={<Save className="h-3.5 w-3.5" />} type="submit">
          Save student
        </Button>
      </div>
    </form>
  );
}

function inputClass(hasError: boolean) {
  return (
    "w-full h-9 px-3 text-[13px] rounded-lg bg-white placeholder:text-ink-400 transition " +
    "focus:outline-none focus:ring-2 " +
    (hasError
      ? "border border-red-400 focus:border-red-500 focus:ring-red-200"
      : "border border-ink-200 focus:border-ink-400 focus:ring-brand-300/30")
  );
}

function Field({
  label,
  hint,
  required,
  error,
  children,
  className,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  error?: string;
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
      {error && (
        <p className="mt-1 text-[11.5px] font-medium text-red-600 flex items-center gap-1">
          <AlertCircle className="h-3 w-3 flex-shrink-0" />
          {error}
        </p>
      )}
    </label>
  );
}

function SectionHeader({
  icon,
  title,
  required,
}: {
  icon: React.ReactNode;
  title: string;
  required?: boolean;
}) {
  return (
    <div className="flex items-center gap-2 mb-3 pb-2 border-b border-ink-100">
      <span className="inline-flex items-center justify-center h-6 w-6 rounded-md bg-cream-200 text-ink-700">
        {icon}
      </span>
      <h2 className="text-[14px] font-bold text-ink-900">
        {title}
        {required ? <span className="text-red-600 ml-1">*</span> : null}
      </h2>
    </div>
  );
}
