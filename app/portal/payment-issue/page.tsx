"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { motion } from "framer-motion";
import { CreditCard, CheckCircle2 } from "lucide-react";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { auth, type Me } from "@/lib/auth";

/**
 * Payment Issues concern form (inventre.in/portal/payment-issue).
 *
 * Posts to /api/portal/concerns (category "payment"); Inventre mints the
 * CON- number and pushes the concern to the Audit call-centre. Parent-gated.
 */

export default function PaymentIssuePage() {
  const router = useRouter();
  const [me, setMe] = useState<Me>(null);
  const [loaded, setLoaded] = useState(false);

  const [description, setDescription] = useState("");
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null); // concern number

  useEffect(() => {
    auth
      .me()
      .then((u) => {
        setMe(u);
        if (u?.kind === "parent") setPhone(u.loggedInPhone ?? u.phone ?? "");
      })
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    if (!loaded) return;
    if (!me) router.push("/login?next=/portal/payment-issue");
    else if (me.kind !== "parent") router.push("/admin");
  }, [loaded, me, router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (description.trim().length < 1) {
      setError("Please describe the payment issue.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/portal/concerns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: "payment",
          description: description.trim(),
          contactPhone: phone.trim() || undefined,
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

  if (!loaded) {
    return (
      <main className="min-h-screen bg-cream-50">
        <Nav />
        <div className="mx-auto max-w-xl px-5 py-10">
          <div className="h-72 rounded-3xl bg-cream-200 animate-pulse" />
        </div>
      </main>
    );
  }
  if (!me || me.kind !== "parent") return null;

  return (
    <main className="min-h-screen bg-cream-50">
      <Nav />
      <div className="mx-auto max-w-xl px-5 lg:px-8 pt-8 pb-16">
        <Link
          href="/portal"
          className="text-[13px] font-medium text-ink-500 hover:text-ink-900"
        >
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
              Our Call Centre team will look into your payment concern and reach out.
              {done ? (
                <>
                  {" "}Your reference is{" "}
                  <span className="font-semibold text-ink-900">{done}</span>.
                </>
              ) : null}
            </p>
            <Link
              href="/portal"
              className="mt-6 inline-flex rounded-xl bg-ink-900 px-5 py-3 text-[14px] font-semibold text-white hover:bg-ink-800 transition-colors"
            >
              Back to help
            </Link>
          </motion.div>
        ) : (
          <>
            <div className="mt-4 flex items-center gap-3">
              <span className="grid h-11 w-11 place-items-center rounded-2xl bg-cream-100 text-ink-700">
                <CreditCard className="h-6 w-6" />
              </span>
              <div>
                <h1 className="font-display text-[24px] font-extrabold text-ink-900">
                  Payment Issues
                </h1>
                <p className="text-[13px] text-ink-500">
                  Payment deductions or refund requests.
                </p>
              </div>
            </div>

            <form onSubmit={submit} className="mt-6 space-y-5">
              <div>
                <label className="block text-[13px] font-semibold text-ink-800">
                  What happened?
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={5}
                  placeholder="e.g. Amount was deducted but the order didn't confirm / I was charged twice / refund not received. Mention the order number if you have it."
                  className="mt-2 w-full rounded-2xl border border-cream-300 bg-white px-4 py-3 text-[14px] text-ink-900 placeholder:text-ink-400 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
                />
              </div>
              <div>
                <label className="block text-[13px] font-semibold text-ink-800">
                  Contact number
                </label>
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  inputMode="tel"
                  className="mt-2 w-full rounded-2xl border border-cream-300 bg-white px-4 py-3 text-[14px] text-ink-900 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
                />
              </div>
              {error ? (
                <p className="text-[13px] font-medium text-red-600">{error}</p>
              ) : null}
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
      <Footer />
    </main>
  );
}
