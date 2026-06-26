"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  CreditCard,
  GraduationCap,
  Headphones,
  Truck,
  LogIn,
  Repeat,
  CheckCircle2,
} from "lucide-react";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";

/**
 * PUBLIC concern form for the Parent Help Portal — no login. Category from
 * ?category=. Captures the parent's name + mobile + issue and posts to the
 * public /api/portal/concerns, returning a CON- ticket number.
 */

const CATEGORIES: Record<
  string,
  { title: string; blurb: string; placeholder: string; Icon: typeof CreditCard }
> = {
  login: {
    title: "Website Login",
    blurb: "Login issues or update mobile number.",
    placeholder: "Describe the login problem, or the mobile number you want updated.",
    Icon: LogIn,
  },
  student_details: {
    title: "Student Details",
    blurb: "Request an update to grade, name or school information.",
    placeholder: "Tell us what needs correcting — current vs. correct grade / name / school.",
    Icon: GraduationCap,
  },
  order_delivery: {
    title: "Order & Delivery",
    blurb: "Track orders or report a delivery problem.",
    placeholder: "Describe the delivery problem. Add the order number below if you have it.",
    Icon: Truck,
  },
  payment: {
    title: "Payment Issues",
    blurb: "Payment deductions or refund requests.",
    placeholder: "e.g. Amount deducted but order didn't confirm / charged twice / refund pending.",
    Icon: CreditCard,
  },
  customer_care: {
    title: "Customer Care",
    blurb: "Tell us how we can help.",
    placeholder: "Describe your concern and we'll get back to you.",
    Icon: Headphones,
  },
  size_exchange: {
    title: "Size Exchange",
    blurb: "Request an item size exchange.",
    placeholder: "Which item + current size + the size you need. Add the order number below.",
    Icon: Repeat,
  },
};

function ConcernForm() {
  const params = useSearchParams();
  const category = params.get("category") ?? "customer_care";
  const cfg = CATEGORIES[category] ?? CATEGORIES.customer_care;
  const showOrder = category === "order_delivery" || category === "size_exchange" || category === "payment";

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [orderRef, setOrderRef] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) return setError("Please enter your name.");
    if (phone.replace(/\D/g, "").length < 10) return setError("Please enter a valid mobile number.");
    if (!description.trim()) return setError("Please describe the issue.");
    setSubmitting(true);
    try {
      const res = await fetch("/api/portal/concerns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category,
          name: name.trim(),
          phone: phone.trim(),
          description: description.trim(),
          orderRef: orderRef.trim() || undefined,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        concernNumber?: string;
        error?: string;
      };
      if (!res.ok) {
        setError(data.error || "Could not submit. Please try again.");
        return;
      }
      setDone(data.concernNumber ?? "");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl px-5 lg:px-8 pt-8 pb-16">
      <Link href="/portal" className="text-[13px] font-medium text-ink-500 hover:text-ink-900">
        ← Back to help
      </Link>

      {done !== null ? (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-6 rounded-3xl bg-white p-7 ring-1 ring-cream-200 text-center"
        >
          <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-500" />
          <h1 className="mt-3 font-display text-[22px] font-extrabold text-ink-900">
            Thanks — we&apos;ve got it
          </h1>
          <p className="mt-2 text-[14px] text-ink-600">
            Our support team will look into this and reach out.
            {done ? (
              <>
                {" "}Your ticket number is{" "}
                <span className="font-semibold text-ink-900">{done}</span> — save it to
                track your concern.
              </>
            ) : null}
          </p>
          <div className="mt-6 flex justify-center gap-3">
            <Link
              href="/portal"
              className="rounded-xl bg-ink-900 px-5 py-3 text-[14px] font-semibold text-white hover:bg-ink-800 transition-colors"
            >
              Back to help
            </Link>
            {done ? (
              <Link
                href={`/portal/history?ref=${encodeURIComponent(done)}`}
                className="rounded-xl bg-white px-5 py-3 text-[14px] font-semibold text-ink-800 ring-1 ring-cream-200 hover:ring-brand/40 transition"
              >
                Track it
              </Link>
            ) : null}
          </div>
        </motion.div>
      ) : (
        <>
          <div className="mt-4 flex items-center gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-2xl bg-cream-100 text-ink-700">
              <cfg.Icon className="h-6 w-6" />
            </span>
            <div>
              <h1 className="font-display text-[24px] font-extrabold text-ink-900">{cfg.title}</h1>
              <p className="text-[13px] text-ink-500">{cfg.blurb}</p>
            </div>
          </div>

          <form onSubmit={submit} className="mt-6 space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input label="Your name" value={name} onChange={setName} placeholder="Full name" />
              <Input label="Mobile number" value={phone} onChange={setPhone} placeholder="10-digit mobile" inputMode="tel" />
            </div>
            {showOrder ? (
              <Input
                label="Order number (optional)"
                value={orderRef}
                onChange={setOrderRef}
                placeholder="e.g. SAL-ORD-2026-XXXXX"
              />
            ) : null}
            <div>
              <label className="block text-[13px] font-semibold text-ink-800">What happened?</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={5}
                placeholder={cfg.placeholder}
                className="mt-2 w-full rounded-2xl border border-cream-300 bg-white px-4 py-3 text-[14px] text-ink-900 placeholder:text-ink-400 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
              />
            </div>
            {error ? <p className="text-[13px] font-medium text-red-600">{error}</p> : null}
            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-xl bg-ink-900 py-3.5 text-[14px] font-semibold text-white hover:bg-ink-800 transition-colors disabled:opacity-50"
            >
              {submitting ? "Submitting…" : "Submit concern"}
            </button>
          </form>
        </>
      )}
    </div>
  );
}

function Input({
  label,
  value,
  onChange,
  placeholder,
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  inputMode?: "tel" | "text";
}) {
  return (
    <div>
      <label className="block text-[13px] font-semibold text-ink-800">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        inputMode={inputMode}
        className="mt-2 w-full rounded-2xl border border-cream-300 bg-white px-4 py-3 text-[14px] text-ink-900 placeholder:text-ink-400 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
      />
    </div>
  );
}

export default function ConcernPage() {
  return (
    <main className="min-h-screen bg-cream-50">
      <Nav />
      <Suspense
        fallback={
          <div className="mx-auto max-w-xl px-5 py-10">
            <div className="h-72 rounded-3xl bg-cream-200 animate-pulse" />
          </div>
        }
      >
        <ConcernForm />
      </Suspense>
      <Footer />
    </main>
  );
}
