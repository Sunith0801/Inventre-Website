"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  LogIn,
  GraduationCap,
  Truck,
  CreditCard,
  Headphones,
  Repeat,
  ClipboardList,
  ChevronRight,
  Package,
} from "lucide-react";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { auth, type Me } from "@/lib/auth";

/**
 * Parent Help Portal — inventre.in/portal (the QR-code landing).
 *
 * Login-gated parent view: a student card (child + latest order + tracking)
 * and the full set of help modules. Multi-child parents switch the active
 * child via "Search for another student". Admins → /admin, logged-out →
 * /login. The staff/agent version lives in the Audit Admin Panel.
 */

type Kid = {
  id: string;
  name: string;
  enrollmentNumber: string | null;
  grade: string | null;
  school: string | null;
};
type Summary = {
  parent: { name: string | null; mobile: string | null };
  students: Kid[];
  latestOrder: {
    orderNumber: string;
    status: string;
    orderedDate: string;
    carrier: string | null;
    tracking: string | null;
    studentName: string | null;
  } | null;
};

const MODULES: { key: string; title: string; blurb: string; href: string; Icon: typeof LogIn }[] = [
  { key: "login", title: "Website Login", blurb: "Login issues or update mobile number", href: "/account/change-phone", Icon: LogIn },
  { key: "student", title: "Student Details", blurb: "Update grade, name or school information", href: "/portal/concern?category=student_details", Icon: GraduationCap },
  { key: "order", title: "Order & Delivery", blurb: "Track orders and report delivery problems", href: "/shop/orders", Icon: Truck },
  { key: "payment", title: "Payment Issues", blurb: "Payment deductions or refund requests", href: "/portal/concern?category=payment", Icon: CreditCard },
  { key: "care", title: "Customer Care", blurb: "Connect with our support team directly", href: "/contact", Icon: Headphones },
  { key: "exchange", title: "Size Exchange", blurb: "Request an item size exchange", href: "/shop/orders", Icon: Repeat },
  { key: "history", title: "View My Concern History", blurb: "", href: "/portal/history", Icon: ClipboardList },
];

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

export default function PortalPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me>(null);
  const [loaded, setLoaded] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);

  useEffect(() => {
    auth
      .me()
      .then(setMe)
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    if (!loaded) return;
    if (!me) router.push("/login?next=/portal");
    else if (me.kind !== "parent") router.push("/admin");
  }, [loaded, me, router]);

  useEffect(() => {
    if (me?.kind !== "parent") return;
    fetch("/api/portal/summary")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Summary | null) => {
        if (d) {
          setSummary(d);
          setSelectedId(d.students[0]?.id ?? null);
        }
      })
      .catch(() => {});
  }, [me]);

  if (!loaded) {
    return (
      <main className="min-h-screen bg-cream-50">
        <Nav />
        <div className="mx-auto max-w-2xl px-5 py-10">
          <div className="h-40 rounded-3xl bg-cream-200 animate-pulse mb-6" />
          <div className="grid grid-cols-2 gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-24 rounded-2xl bg-cream-200 animate-pulse" />
            ))}
          </div>
        </div>
      </main>
    );
  }
  if (!me || me.kind !== "parent") return null;

  const kids = summary?.students ?? [];
  const student = kids.find((k) => k.id === selectedId) ?? kids[0] ?? null;
  const order = summary?.latestOrder ?? null;

  return (
    <main className="min-h-screen bg-cream-50">
      <Nav />
      <div className="mx-auto max-w-2xl px-5 lg:px-8 pt-8 pb-16">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[12px] font-semibold uppercase tracking-wide text-brand">
              Inventre Support
            </p>
            <h1 className="font-display text-[26px] font-extrabold text-ink-900">
              Parent Help Portal
            </h1>
          </div>
          <Link
            href="/portal/history"
            className="rounded-full bg-white px-4 py-2 text-[13px] font-semibold text-ink-800 ring-1 ring-cream-200 hover:ring-brand/40 transition"
          >
            Track Concern
          </Link>
        </div>

        {/* Student card */}
        {student ? (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-6 rounded-3xl bg-white p-5 ring-1 ring-cream-200"
          >
            <div className="flex items-center gap-4">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-brand/10 font-display text-[18px] font-bold text-brand">
                {(student.name?.[0] ?? "?").toUpperCase()}
              </span>
              <div className="min-w-0">
                <p className="font-display text-[18px] font-bold text-ink-900">{student.name}</p>
                {student.enrollmentNumber ? (
                  <p className="text-[12px] text-ink-500">ID: {student.enrollmentNumber}</p>
                ) : null}
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-[13px]">
              <Field label="School" value={student.school} />
              <Field label="Mobile" value={summary?.parent.mobile ?? null} />
              {student.grade ? <Field label="Grade" value={student.grade} /> : null}
            </div>

            {order ? (
              <div className="mt-4 rounded-2xl bg-cream-50 p-4">
                <div className="flex items-center justify-between">
                  <p className="text-[12px] font-semibold uppercase tracking-wide text-ink-500">
                    Latest Order
                  </p>
                  <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-semibold capitalize text-emerald-700">
                    {order.status}
                  </span>
                </div>
                <Link
                  href={`/shop/orders/${order.orderNumber}`}
                  className="mt-1 flex items-center gap-1.5 font-semibold text-ink-900 hover:text-brand transition"
                >
                  <Package className="h-4 w-4" /> {order.orderNumber}
                </Link>
                <p className="text-[12px] text-ink-500">Ordered {fmtDate(order.orderedDate)}</p>
                {order.carrier || order.tracking ? (
                  <p className="mt-0.5 text-[12px] text-ink-500">
                    {[order.carrier, order.tracking].filter(Boolean).join(" · ")}
                  </p>
                ) : null}
              </div>
            ) : null}
          </motion.div>
        ) : null}

        {/* Modules */}
        <h2 className="mt-8 font-display text-[16px] font-bold text-ink-900">
          What can we help you with?
        </h2>
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          {MODULES.map((m, i) => (
            <motion.div
              key={m.key}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04, duration: 0.22 }}
            >
              <Link
                href={m.href}
                className="group flex h-full items-center gap-3 rounded-2xl bg-white p-4 ring-1 ring-cream-200 hover:ring-brand/40 hover:shadow-[0_10px_30px_-14px_rgba(0,0,0,0.15)] transition-all"
              >
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-cream-100 text-ink-700 group-hover:bg-brand/10 group-hover:text-brand transition-colors">
                  <m.Icon className="h-5 w-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] font-bold text-ink-900">{m.title}</span>
                  {m.blurb ? (
                    <span className="block text-[12px] text-ink-500">{m.blurb}</span>
                  ) : null}
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-ink-300 group-hover:text-brand transition" />
              </Link>
            </motion.div>
          ))}
        </div>

        {/* Switch student */}
        {kids.length > 1 ? (
          <div className="mt-8">
            <button
              onClick={() => setPicking((v) => !v)}
              className="text-[13px] font-medium text-ink-500 hover:text-ink-900"
            >
              ← Search for another student
            </button>
            {picking ? (
              <div className="mt-3 space-y-2">
                {kids.map((k) => (
                  <button
                    key={k.id}
                    onClick={() => {
                      setSelectedId(k.id);
                      setPicking(false);
                    }}
                    className={`flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left text-[14px] transition ${
                      k.id === selectedId
                        ? "border-brand bg-brand/5"
                        : "border-cream-200 bg-white hover:border-brand/40"
                    }`}
                  >
                    <span className="grid h-8 w-8 place-items-center rounded-full bg-brand/10 text-[13px] font-bold text-brand">
                      {(k.name?.[0] ?? "?").toUpperCase()}
                    </span>
                    <span>
                      <span className="block font-semibold text-ink-900">{k.name}</span>
                      {k.school ? (
                        <span className="block text-[12px] text-ink-500">{k.school}</span>
                      ) : null}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      <Footer />
    </main>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">{label}</p>
      <p className="text-ink-900">{value ?? "—"}</p>
    </div>
  );
}
