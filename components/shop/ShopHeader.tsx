"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, Search, ChevronDown, Package } from "lucide-react";
import Link from "next/link";
import { auth, type Me } from "@/lib/auth";

function titleCase(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .toLowerCase()
    .replace(/(^|[\s\-'/])(\p{L})/gu, (_, sep, ch) => sep + ch.toUpperCase());
}

function cleanGrade(value: string | null | undefined): string {
  if (!value) return "—";
  return value.replace(/^grade\s+/i, "");
}

type Props = {
  count: number;
  query: string;
  onQuery: (q: string) => void;
  sort: string;
  onSort: (s: string) => void;
};

const sortOptions = [
  { id: "recommended", label: "Recommended" },
  { id: "newest", label: "Newest first" },
  { id: "price-asc", label: "Price: low → high" },
  { id: "price-desc", label: "Price: high → low" },
];

export function ShopHeader({ count, query, onQuery, sort, onSort }: Props) {
  const [me, setMe] = useState<Me>(null);
  const searchParams = useSearchParams();
  const studentIdParam = searchParams?.get("studentId") ?? null;
  useEffect(() => {
    auth.me().then(setMe).catch(() => setMe(null));
  }, []);

  const student =
    me?.kind === "parent"
      ? (studentIdParam && me.students.find((s) => s.id === studentIdParam)) ||
        me.students[0]
      : null;
  const school = student?.school ?? null;
  const studentNameTitled = titleCase(student?.name ?? "");
  const studentFirst = studentNameTitled.split(" ")[0] || "Your";
  // Prefer the school's own label (e.g. "Class 5"/"JKG") over the raw
  // uniform grade. Falls back to `grade` then `class` so legacy rows still
  // render something sensible.
  const displaySource =
    student?.schoolGivenGrade ?? student?.grade ?? student?.class ?? null;
  const cls = cleanGrade(displaySource);
  const grade = displaySource
    ? student?.section
      ? `Class ${cls} · ${student.section}`
      : `Class ${cls}`
    : null;

  return (
    <div className="mx-auto max-w-7xl px-5 lg:px-8 pt-8 pb-6">
      <a
        href="/"
        className="inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-500 hover:text-ink-900 transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back to home
      </a>
      <div className="mt-3 flex flex-col lg:flex-row lg:items-end lg:justify-between gap-5">
        <div className="flex items-center gap-4">
          {school?.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={school.logoUrl}
              alt={school.name}
              className="h-14 w-14 lg:h-16 lg:w-16 rounded-xl object-cover border border-ink-100 bg-white shrink-0"
            />
          ) : null}
          <div>
            <h1 className="font-display text-[28px] sm:text-[34px] lg:text-[42px] font-extrabold tracking-tight text-ink-900 leading-[1.05]">
              {studentFirst}&apos;s school kit
            </h1>
            <p className="mt-2 text-[14px] text-ink-500">
              <span className="font-semibold text-ink-800">{count}</span>{" "}
              {count === 1 ? "item" : "items"}
              {school ? (
                <>
                  {" "}curated for{" "}
                  <span className="font-semibold text-ink-800">{titleCase(school.name)}</span>
                </>
              ) : null}
              {grade ? <> · {grade}</> : null}
            </p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch gap-3">
          <label className="relative">
            <span className="sr-only">Search products</span>
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-400" />
            <input
              type="search"
              value={query}
              onChange={(e) => onQuery(e.target.value)}
              placeholder="Search shirts, shoes, bags…"
              className="w-full sm:w-72 rounded-full border border-ink-200 bg-white pl-10 pr-4 py-2.5 text-[14px] text-ink-900 placeholder:text-ink-400 focus:border-ink-900 focus:outline-none transition-colors"
            />
          </label>

          <div className="relative">
            <select
              value={sort}
              onChange={(e) => onSort(e.target.value)}
              className="appearance-none rounded-full border border-ink-200 bg-white pl-4 pr-10 py-2.5 text-[14px] font-medium text-ink-800 focus:border-ink-900 focus:outline-none transition-colors"
            >
              {sortOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  Sort: {o.label}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-500" />
          </div>

          {me?.kind === "parent" && (
            <Link
              href="/shop/orders"
              className="inline-flex items-center justify-center gap-2 rounded-full border border-brand-200 bg-brand-50 px-4 py-2.5 text-[14px] font-semibold text-brand-700 hover:bg-brand-100 hover:border-brand-300 transition-colors whitespace-nowrap"
            >
              <Package className="h-4 w-4" />
              My Orders
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
