"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Search, ClipboardList } from "lucide-react";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";

/**
 * PUBLIC concern tracking — no login. Enter a ticket number (CON-…) to see
 * its status + the message thread. Tracking is by ticket number only (not
 * phone), so no one can enumerate another parent's concerns.
 */

const CATEGORY_LABEL: Record<string, string> = {
  login: "Website Login",
  grade_change: "Grade Change",
  student_details: "Student Details",
  guardian: "Guardian Details",
  order_delivery: "Order & Delivery",
  payment: "Payment Issues",
  customer_care: "Customer Care",
};
const STATUS_STYLE: Record<string, string> = {
  submitted: "bg-amber-100 text-amber-700",
  in_progress: "bg-blue-100 text-blue-700",
  waiting_customer: "bg-violet-100 text-violet-700",
  waiting_school: "bg-violet-100 text-violet-700",
  resolved: "bg-emerald-100 text-emerald-700",
};

type Result = {
  concern: { concernNumber: string; category: string; status: string; description: string | null; createdAt: string };
  messages: { author: string; authorName: string | null; body: string; createdAt: string }[];
};

function fmt(iso: string) {
  try {
    return new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

function Tracker() {
  const params = useSearchParams();
  const [ref, setRef] = useState(params.get("ref") ?? "");
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function lookup(q: string) {
    const ticket = q.trim();
    if (!ticket) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(`/api/portal/concerns?ref=${encodeURIComponent(ticket)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "No ticket found.");
        return;
      }
      setResult(data as Result);
    } finally {
      setLoading(false);
    }
  }

  // Auto-lookup if a ?ref= was passed (e.g. straight after submitting).
  useEffect(() => {
    const r = params.get("ref");
    if (r) lookup(r);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="mx-auto max-w-xl px-5 lg:px-8 pt-8 pb-16">
      <Link href="/portal" className="text-[13px] font-medium text-ink-500 hover:text-ink-900">
        ← Back to help
      </Link>
      <h1 className="mt-4 font-display text-[26px] font-extrabold text-ink-900">Track a Concern</h1>
      <p className="mt-1 text-[13px] text-ink-500">
        Enter the ticket number (e.g. CON-2026-00001) we gave you.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          lookup(ref);
        }}
        className="mt-5 flex gap-2"
      >
        <input
          value={ref}
          onChange={(e) => setRef(e.target.value)}
          placeholder="CON-2026-XXXXX"
          className="flex-1 rounded-xl border border-cream-300 bg-white px-4 py-3 text-[14px] text-ink-900 placeholder:text-ink-400 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
        />
        <button
          type="submit"
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-xl bg-ink-900 px-4 py-3 text-[14px] font-semibold text-white hover:bg-ink-800 transition disabled:opacity-50"
        >
          <Search className="h-4 w-4" /> {loading ? "…" : "Track"}
        </button>
      </form>

      {error ? <p className="mt-4 text-[13px] font-medium text-red-600">{error}</p> : null}

      {result ? (
        <div className="mt-6 rounded-3xl bg-white p-5 ring-1 ring-cream-200">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-display text-[16px] font-bold text-ink-900">
                {CATEGORY_LABEL[result.concern.category] ?? result.concern.category}
              </p>
              <p className="text-[12px] text-ink-500">
                {result.concern.concernNumber} · {fmt(result.concern.createdAt)}
              </p>
            </div>
            <span
              className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold capitalize ${
                STATUS_STYLE[result.concern.status] ?? "bg-cream-200 text-ink-600"
              }`}
            >
              {result.concern.status.replace(/_/g, " ")}
            </span>
          </div>

          <div className="mt-4 space-y-3 border-t border-cream-100 pt-4">
            {result.messages.map((m, i) => (
              <div key={i} className={m.author === "agent" ? "pl-6" : ""}>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">
                  {m.author === "agent" ? "Support" : m.authorName || "You"} · {fmt(m.createdAt)}
                </p>
                <p className="text-[13px] text-ink-700">{m.body}</p>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {!result && !error && !loading ? (
        <div className="mt-8 rounded-3xl bg-white p-8 text-center ring-1 ring-cream-200">
          <ClipboardList className="mx-auto h-9 w-9 text-ink-300" />
          <p className="mt-2 text-[13px] text-ink-500">
            Your ticket number was shown when you submitted a concern.
          </p>
        </div>
      ) : null}
    </div>
  );
}

export default function HistoryPage() {
  return (
    <main className="min-h-screen bg-cream-50">
      <Nav />
      <Suspense
        fallback={
          <div className="mx-auto max-w-xl px-5 py-10">
            <div className="h-24 rounded-2xl bg-cream-200 animate-pulse" />
          </div>
        }
      >
        <Tracker />
      </Suspense>
      <Footer />
    </main>
  );
}
