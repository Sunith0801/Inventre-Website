"use client";

import Link from "next/link";
import {
  GraduationCap,
  IdCard,
  ChevronRight,
  Cake,
  School2,
  User as UserIcon,
} from "lucide-react";
import type { Me } from "@/lib/auth";

type Parent = Extract<Me, { kind: "parent" }>;
type Student = Parent["students"][number];

function titleCase(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .toLowerCase()
    .replace(/(^|[\s\-'/])(\p{L})/gu, (_, sep, ch) => sep + ch.toUpperCase());
}

function initials(name: string) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .map((p) => p[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?"
  );
}

function cleanGrade(value: string | null | undefined): string {
  if (!value) return "—";
  return value.replace(/^grade\s+/i, "");
}

function gradeOf(s: Student): string {
  return cleanGrade(s.schoolGivenGrade ?? s.grade ?? s.class);
}

function formatDob(raw: string | null | undefined): string | null {
  if (!raw) return null;
  // ERP stores DOB as text in mixed formats (ISO, DD/MM/YYYY, etc.).
  // Best-effort parse; if it can't be parsed, show the raw string verbatim
  // so the parent still sees the value they entered rather than nothing.
  const t = Date.parse(raw);
  if (!Number.isNaN(t)) {
    return new Date(t).toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  }
  return raw;
}

export function SiblingsList({ students }: { students: Student[] }) {
  if (students.length === 0) {
    return (
      <div className="text-center py-8">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-cream-100 text-ink-500">
          <GraduationCap className="h-5 w-5" />
        </div>
        <p className="mt-3 text-[14px] font-semibold text-ink-900">
          No students linked
        </p>
        <p className="mt-1 text-[12.5px] text-ink-500 max-w-xs mx-auto">
          Contact your school coordinator to link your child.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {students.map((s) => (
        <SiblingCard key={s.id} s={s} />
      ))}
    </div>
  );
}

function SiblingCard({ s }: { s: Student }) {
  const displayName = titleCase(s.name);
  const dob = formatDob(s.dateOfBirth);
  const grade = gradeOf(s);
  const gender = s.gender ? titleCase(s.gender) : null;

  return (
    <Link
      href={`/shop?studentId=${s.id}`}
      className="group block rounded-2xl border border-ink-100 bg-cream-50 hover:bg-white hover:border-brand-200 hover:shadow-[0_15px_30px_-18px_rgba(0,0,0,0.15)] transition-all"
    >
      <div className="flex items-start gap-4 p-4">
        <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-brand-200 to-brand-400 text-brand-900 font-display text-[14px] font-bold">
          {initials(displayName)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-display text-[16px] font-extrabold text-ink-900 leading-tight truncate">
              {displayName}
            </p>
            {gender && (
              <span className="inline-flex items-center gap-1 rounded-full bg-ink-100 text-ink-700 px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide">
                <UserIcon className="h-2.5 w-2.5" />
                {gender}
              </span>
            )}
          </div>

          <p className="mt-1 inline-flex items-center gap-1.5 text-[12.5px] text-ink-600 truncate">
            <School2 className="h-3 w-3 text-ink-400 shrink-0" />
            <span className="truncate">{titleCase(s.school.name)}</span>
          </p>

          <div className="mt-2 flex items-center gap-2 flex-wrap text-[11.5px]">
            <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 text-brand-700 px-2 py-0.5 font-semibold">
              <GraduationCap className="h-3 w-3" />
              {grade}
              {s.section ? ` · ${s.section}` : ""}
            </span>

            {s.enrollmentNumber && (
              <span className="inline-flex items-center gap-1 rounded-full bg-ink-100 text-ink-700 px-2 py-0.5 font-mono">
                <IdCard className="h-3 w-3" />
                {s.enrollmentNumber}
              </span>
            )}

            {dob && (
              <span className="inline-flex items-center gap-1 rounded-full bg-cream-200 text-ink-700 px-2 py-0.5 font-semibold">
                <Cake className="h-3 w-3" />
                {dob}
              </span>
            )}
          </div>
        </div>
        <ChevronRight className="h-4 w-4 text-ink-300 group-hover:text-brand group-hover:translate-x-0.5 transition-all shrink-0 mt-1" />
      </div>
    </Link>
  );
}
