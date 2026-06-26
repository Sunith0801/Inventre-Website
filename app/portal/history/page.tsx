"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ClipboardList } from "lucide-react";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { auth, type Me } from "@/lib/auth";

/**
 * "View My Concern History" / "Track Concern" — lists the parent's concerns
 * raised via the Help Portal. Parent-gated.
 */

type Concern = {
  id: string;
  concernNumber: string | null;
  category: string;
  description: string | null;
  status: string;
  createdAt: string;
};

const CATEGORY_LABEL: Record<string, string> = {
  payment: "Payment Issues",
  order_delivery: "Order & Delivery",
  customer_care: "Customer Care",
  student_details: "Student Details",
  login: "Website Login",
};

const STATUS_STYLE: Record<string, string> = {
  open: "bg-amber-100 text-amber-700",
  in_progress: "bg-blue-100 text-blue-700",
  resolved: "bg-emerald-100 text-emerald-700",
  rejected: "bg-red-100 text-red-700",
};

function fmt(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

export default function ConcernHistoryPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me>(null);
  const [loaded, setLoaded] = useState(false);
  const [items, setItems] = useState<Concern[] | null>(null);

  useEffect(() => {
    auth.me().then(setMe).finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    if (!loaded) return;
    if (!me) router.push("/login?next=/portal/history");
    else if (me.kind !== "parent") router.push("/admin");
  }, [loaded, me, router]);

  useEffect(() => {
    if (me?.kind !== "parent") return;
    fetch("/api/portal/concerns")
      .then((r) => (r.ok ? r.json() : { concerns: [] }))
      .then((d: { concerns: Concern[] }) => setItems(d.concerns ?? []))
      .catch(() => setItems([]));
  }, [me]);

  if (!loaded) {
    return (
      <main className="min-h-screen bg-cream-50">
        <Nav />
        <div className="mx-auto max-w-2xl px-5 py-10">
          <div className="h-24 rounded-2xl bg-cream-200 animate-pulse" />
        </div>
      </main>
    );
  }
  if (!me || me.kind !== "parent") return null;

  return (
    <main className="min-h-screen bg-cream-50">
      <Nav />
      <div className="mx-auto max-w-2xl px-5 lg:px-8 pt-8 pb-16">
        <Link href="/portal" className="text-[13px] font-medium text-ink-500 hover:text-ink-900">
          ← Back to help
        </Link>
        <h1 className="mt-4 font-display text-[26px] font-extrabold text-ink-900">
          My Concern History
        </h1>

        {items === null ? (
          <div className="mt-6 h-20 rounded-2xl bg-cream-200 animate-pulse" />
        ) : items.length === 0 ? (
          <div className="mt-8 rounded-3xl bg-white p-10 text-center ring-1 ring-cream-200">
            <ClipboardList className="mx-auto h-10 w-10 text-ink-300" />
            <p className="mt-3 text-[14px] text-ink-500">
              You haven&apos;t raised any concerns yet.
            </p>
            <Link
              href="/portal"
              className="mt-4 inline-flex rounded-xl bg-ink-900 px-5 py-2.5 text-[13px] font-semibold text-white hover:bg-ink-800 transition"
            >
              Get help
            </Link>
          </div>
        ) : (
          <div className="mt-6 space-y-3">
            {items.map((c) => (
              <div key={c.id} className="rounded-2xl bg-white p-4 ring-1 ring-cream-200">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[14px] font-bold text-ink-900">
                      {CATEGORY_LABEL[c.category] ?? c.category}
                    </p>
                    <p className="text-[12px] text-ink-500">
                      {c.concernNumber ? `${c.concernNumber} · ` : ""}
                      {fmt(c.createdAt)}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold capitalize ${
                      STATUS_STYLE[c.status] ?? "bg-cream-200 text-ink-600"
                    }`}
                  >
                    {c.status.replace(/_/g, " ")}
                  </span>
                </div>
                {c.description ? (
                  <p className="mt-2 line-clamp-2 text-[13px] text-ink-600">{c.description}</p>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>
      <Footer />
    </main>
  );
}
