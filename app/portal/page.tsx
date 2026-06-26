"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { motion } from "framer-motion";
import { Truck, CreditCard, Headphones, ChevronRight } from "lucide-react";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { auth, type Me } from "@/lib/auth";

/**
 * Parent concern portal — the QR-code landing (inventre.in/portal).
 *
 * Parent-gated (admins go to /admin, logged-out to /login). Shows ONLY the
 * three Call-Centre modules the spec calls for. The fuller staff module set
 * (Website Login, Student Details, Size Exchange, Concern History, …) lives
 * in the Audit Admin Panel, not here.
 */

const MODULES: {
  key: string;
  title: string;
  blurb: string;
  href: string;
  Icon: typeof Truck;
}[] = [
  {
    key: "order_delivery",
    title: "Order & Delivery",
    blurb: "Track your orders and report delivery problems.",
    href: "/shop/orders",
    Icon: Truck,
  },
  {
    key: "payment",
    title: "Payment Issues",
    blurb: "Payment deductions or refund requests.",
    href: "/portal/payment-issue",
    Icon: CreditCard,
  },
  {
    key: "customer_care",
    title: "Customer Care",
    blurb: "Connect with our support team directly.",
    href: "/contact",
    Icon: Headphones,
  },
];

export default function PortalPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me>(null);
  const [loaded, setLoaded] = useState(false);

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

  if (!loaded) {
    return (
      <main className="min-h-screen bg-cream-50">
        <Nav />
        <div className="mx-auto max-w-3xl px-5 py-10">
          <div className="h-24 rounded-3xl bg-cream-200 animate-pulse mb-6" />
          <div className="space-y-4">
            <div className="h-24 rounded-3xl bg-cream-200 animate-pulse" />
            <div className="h-24 rounded-3xl bg-cream-200 animate-pulse" />
            <div className="h-24 rounded-3xl bg-cream-200 animate-pulse" />
          </div>
        </div>
      </main>
    );
  }

  if (!me || me.kind !== "parent") return null;

  const firstName = (me.name ?? "").trim().split(" ")[0] || "there";

  return (
    <main className="min-h-screen bg-cream-50">
      <Nav />
      <div className="mx-auto max-w-3xl px-5 lg:px-8 pt-10 pb-16">
        <h1 className="font-display text-[30px] font-extrabold text-ink-900">
          How can we help, {firstName}?
        </h1>
        <p className="mt-1 text-[14px] text-ink-500">
          Pick what you need help with — our Call Centre team will take it from here.
        </p>

        <div className="mt-8 space-y-4">
          {MODULES.map((m, i) => (
            <motion.div
              key={m.key}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05, duration: 0.25 }}
            >
              <Link
                href={m.href}
                className="group flex items-center gap-4 rounded-3xl bg-white p-5 ring-1 ring-cream-200 hover:ring-brand/40 hover:shadow-[0_10px_30px_-12px_rgba(0,0,0,0.15)] transition-all"
              >
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-cream-100 text-ink-700 group-hover:bg-brand/10 group-hover:text-brand transition-colors">
                  <m.Icon className="h-6 w-6" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-display text-[17px] font-bold text-ink-900">
                    {m.title}
                  </span>
                  <span className="block text-[13px] text-ink-500">{m.blurb}</span>
                </span>
                <ChevronRight className="h-5 w-5 shrink-0 text-ink-300 group-hover:text-brand transition-colors" />
              </Link>
            </motion.div>
          ))}
        </div>
      </div>
      <Footer />
    </main>
  );
}
