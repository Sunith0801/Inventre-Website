"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { GraduationCap, IdCard, User2, BadgeCheck, Users, Package } from "lucide-react";
import Link from "next/link";
import { auth, type Me } from "@/lib/auth";

function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

/** Normalise ERP names that arrive ALL CAPS or rough into Title Case. */
function titleCase(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .toLowerCase()
    .replace(/(^|[\s\-'/])(\p{L})/gu, (_, sep, ch) => sep + ch.toUpperCase());
}

/** Strip a duplicate "Grade " prefix so we don't render "Grade Grade 9". */
function cleanGrade(value: string | null | undefined): string {
  if (!value) return "—";
  return value.replace(/^grade\s+/i, "");
}

/** The grade to show a parent: the school's own name for it when mapped,
 *  otherwise the raw uniform grade. */
function gradeOf(s: {
  schoolGivenGrade?: string | null;
  grade?: string | null;
  class: string | null;
}): string {
  return cleanGrade(s.schoolGivenGrade ?? s.grade ?? s.class);
}

export function StudentBar() {
  const [me, setMe] = useState<Me>(null);
  const [loaded, setLoaded] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const studentIdParam = searchParams.get("studentId");

  useEffect(() => {
    auth
      .me()
      .then((u) => setMe(u))
      .finally(() => setLoaded(true));
  }, []);

  // Restore previously chosen student from localStorage when the URL has no
  // explicit ?studentId. Validates against the parent's actual student list
  // so a stale id never sticks. Persists on every pick below.
  useEffect(() => {
    if (!me || me.kind !== "parent") return;
    if (studentIdParam) return;
    if (typeof window === "undefined") return;
    const saved = window.localStorage.getItem("inv:lastStudentId");
    if (!saved) return;
    if (!me.students.some((s) => s.id === saved)) return;
    const sp = new URLSearchParams(Array.from(searchParams.entries()));
    sp.set("studentId", saved);
    router.replace(`${pathname}?${sp.toString()}`);
  }, [me, studentIdParam, searchParams, pathname, router]);

  useEffect(() => {
    if (studentIdParam && typeof window !== "undefined") {
      window.localStorage.setItem("inv:lastStudentId", studentIdParam);
    }
  }, [studentIdParam]);

  if (!loaded) {
    return (
      <section className="border-b border-ink-100 bg-cream-200 h-[180px] lg:h-[260px] animate-pulse" />
    );
  }
  if (me?.kind !== "parent") return null;

  const students = me.students;
  const student =
    (studentIdParam && students.find((s) => s.id === studentIdParam)) ||
    students[0];
  // Welcome line: prefer the guardian name attached to the active student
  // (student_guardian_links is the source of truth admins edit), and only
  // fall back to parents.name if no guardian is linked. Drops a leading
  // "Parent-" placeholder and shows only a first-name token.
  const rawName = (
    student?.guardianName ?? me.name ?? ""
  )
    .replace(/^parent[\s\-_]+/i, "")
    .trim();
  const guardianFirst = titleCase(rawName.split(" ")[0]) || "there";
  const studentDisplayName = titleCase(student?.name ?? "");
  const studentFirst = studentDisplayName.split(" ")[0] || "your child";
  const school = student?.school;
  const hasMultiple = students.length > 1;

  function pickStudent(id: string) {
    const sp = new URLSearchParams(Array.from(searchParams.entries()));
    sp.set("studentId", id);
    router.push(`${pathname}?${sp.toString()}`);
  }

  return (
    <section className="relative bg-cream-200 border-b border-ink-100 overflow-hidden">
      <div
        aria-hidden
        className="absolute inset-0 -z-0"
        style={{
          background:
            "radial-gradient(50% 80% at 0% 50%, rgba(228,113,39,0.08) 0%, rgba(228,113,39,0) 60%)",
        }}
      />
      <div className="relative mx-auto max-w-7xl px-5 lg:px-8 py-6 lg:py-10">
        <div className="grid lg:grid-cols-[1.2fr_1fr] gap-6 lg:gap-10 items-stretch">
          <div className="flex flex-col justify-center">
            <p className="text-[12px] font-semibold tracking-[0.18em] uppercase text-brand">
              Welcome
            </p>
            <h1 className="mt-2 font-display text-[36px] sm:text-[44px] lg:text-[56px] font-extrabold tracking-tight text-ink-900 leading-[1.0]">
              Hi, <span className="text-brand">{guardianFirst}</span>
            </h1>
            <p className="mt-3 text-[14px] sm:text-[15px] text-ink-600 max-w-md">
              {studentFirst}&apos;s school kit is ready below. Add what you
              need — we&apos;ll deliver it home in one labeled box before term
              begins.
            </p>

            {hasMultiple && (
              <div className="mt-6 max-w-xl">
                <p className="inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.14em] uppercase text-ink-500 mb-2">
                  <Users className="h-3.5 w-3.5" /> You have {students.length} students — pick one
                </p>
                <div className="flex flex-wrap gap-2">
                  {students.map((s) => {
                    const active = s.id === student?.id;
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => pickStudent(s.id)}
                        className={
                          (active
                            ? "border-brand-600 bg-brand-50 text-brand-700 ring-2 ring-brand-300/40 "
                            : "border-ink-200 bg-white text-ink-700 hover:border-ink-400 ") +
                          "rounded-full px-3 py-1.5 text-[13px] font-medium border transition flex items-center gap-2"
                        }
                        aria-pressed={active}
                      >
                        <span className={(active ? "bg-brand-200 text-brand-800" : "bg-cream-200 text-ink-700") + " grid h-6 w-6 place-items-center rounded-full text-[10px] font-bold"}>
                          {initials(s.name)}
                        </span>
                        <span>{titleCase(s.name)}</span>
                        <span className="text-[11px] text-ink-500">{gradeOf(s)}{s.section ? ` · ${s.section}` : ""}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {student && (
              <div className="mt-6 rounded-2xl border border-ink-100 bg-white p-5 lg:p-6 max-w-xl">
                <div className="flex items-center gap-2 pb-4 border-b border-ink-100">
                  <div className="grid h-8 w-8 place-items-center rounded-full bg-brand-50 text-brand">
                    <User2 className="h-4 w-4" />
                  </div>
                  <p className="text-[11px] font-bold tracking-[0.16em] uppercase text-ink-500">
                    Shopping for
                  </p>
                  <BadgeCheck className="h-4 w-4 text-brand fill-brand-50 ml-auto" />
                </div>

                <div className="mt-4 flex items-center gap-3">
                  <div className="grid h-12 w-12 place-items-center rounded-full bg-gradient-to-br from-brand-300 to-brand-500 font-display text-[15px] font-bold text-white">
                    {initials(student.name)}
                  </div>
                  <p className="font-display text-[22px] lg:text-[26px] font-extrabold tracking-tight text-ink-900 leading-tight">
                    {studentDisplayName || "—"}
                  </p>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3">
                  <Field
                    icon={<IdCard className="h-3.5 w-3.5" />}
                    label="Enrollment no."
                    value={student.enrollmentNumber ?? "—"}
                    mono
                  />
                  <Field
                    icon={<GraduationCap className="h-3.5 w-3.5" />}
                    label="Grade"
                    value={
                      student.section
                        ? `${gradeOf(student)} · ${student.section}`
                        : gradeOf(student)
                    }
                  />
                </div>

                <Link
                  href="/shop/orders"
                  className="mt-5 -mb-1 flex items-center justify-between gap-2 rounded-xl border border-ink-100 bg-cream-100 px-4 py-3 text-[13px] font-semibold text-ink-800 hover:border-brand-300 hover:bg-brand-50/60 hover:text-brand-700 transition-colors"
                >
                  <span className="inline-flex items-center gap-2">
                    <Package className="h-4 w-4 text-brand" />
                    View {studentFirst}&apos;s order history
                  </span>
                  <span aria-hidden className="text-ink-400">→</span>
                </Link>
              </div>
            )}
          </div>

          {school && (() => {
            // Resolved banner image. Render only when we actually have a
            // school-specific source — previously this fell back to a
            // hardcoded TSUS banner, which made every school whose banner
            // wasn't yet uploaded *look like* TSUS Chennai on the
            // storefront. Better to show the dark gradient backdrop with
            // the school name in white than impersonate another school.
            //
            // Source order:
            //   1. bannerUrl (full R2 URL, admin-uploaded).
            //   2. logoUrl (full R2 URL, admin-uploaded).
            //   3. schoolLogoUrl, only when it's a full https:// URL —
            //      legacy /files/* paths pointed at the retired ERPNext
            //      (erp.inventre.in) and 404 today, so they're skipped.
            const bannerSrc =
              school.bannerUrl ||
              school.logoUrl ||
              (school.schoolLogoUrl?.startsWith("http") ? school.schoolLogoUrl : null);
            return (
            <div className="relative rounded-2xl overflow-hidden border border-ink-100 bg-ink-900 min-h-[260px] lg:min-h-[340px]">
              {bannerSrc ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={bannerSrc}
                  alt={school.name}
                  loading="lazy"
                  className="absolute inset-0 h-full w-full object-cover"
                />
              ) : null}
              <div className="absolute inset-0 bg-gradient-to-t from-ink-900/85 via-ink-900/20 to-transparent" />
              <div className="relative h-full p-6 flex flex-col justify-between text-white">
                <span className="self-start rounded-full bg-white/15 backdrop-blur border border-white/25 px-3 py-1.5 text-[10px] font-bold tracking-[0.16em] uppercase">
                  Your school
                </span>
                <div className="flex items-center gap-3">
                  {bannerSrc ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={bannerSrc}
                      alt={school.name}
                      className="h-14 w-14 rounded-xl object-cover bg-white p-1 shrink-0"
                    />
                  ) : null}
                  <div>
                    <p className="font-display text-[22px] sm:text-[26px] font-extrabold leading-tight">
                      {school.name}
                    </p>
                  </div>
                </div>
              </div>
            </div>
            );
          })()}
        </div>
      </div>
    </section>
  );
}

function Field({
  icon,
  label,
  value,
  mono = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <p className="inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.14em] uppercase text-ink-500">
        <span className="text-ink-400">{icon}</span>
        {label}
      </p>
      <p
        className={`mt-1 text-[20px] font-bold text-ink-900 ${mono ? "font-mono" : ""}`}
      >
        {value}
      </p>
    </div>
  );
}
