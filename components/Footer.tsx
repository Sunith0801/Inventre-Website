"use client";

import { useState } from "react";
import {
  Instagram,
  Linkedin,
  Youtube,
  Mail,
  Phone,
  ArrowRight,
  CheckCircle2,
  ShieldCheck,
  RotateCw,
  Truck,
  Award,
  MapPin,
} from "lucide-react";

const trust = [
  { icon: Award, label: "Branded for your school" },
  { icon: RotateCw, label: "Free 7-day returns" },
  { icon: Truck, label: "All-India delivery" },
  { icon: ShieldCheck, label: "Secure payments" },
];

const cols: { title: string; links: { label: string; href: string }[] }[] = [
  {
    title: "Shop",
    links: [
      { label: "Regular Uniforms", href: "/shop" },
      { label: "Sports Uniforms", href: "/shop" },
      { label: "Accessories", href: "/shop" },
      { label: "Essentials", href: "/shop" },
      { label: "Bags & Shoes", href: "/shop" },
    ],
  },
  {
    title: "For Schools",
    links: [
      { label: "Become a partner", href: "/contact?kind=school" },
      { label: "Brand customization", href: "/about#innovations" },
      { label: "Our process", href: "/about" },
      { label: "Vision & mission", href: "/about" },
    ],
  },
  {
    title: "Support",
    links: [
      { label: "Track order", href: "/shop/orders" },
      { label: "Returns & exchanges", href: "/contact?kind=parent" },
      { label: "FAQ", href: "/#faq" },
      { label: "Contact us", href: "/contact" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "About", href: "/about" },
      { label: "Sustainability", href: "/about#sustainability" },
      { label: "Experience Store", href: "/experience-store" },
      { label: "Contact", href: "/contact" },
    ],
  },
];

export function Footer() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const subscribe = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError("Enter a valid email");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/newsletter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? "Subscription failed");
      }
      setSubmitted(true);
      setEmail("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Try again");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <footer className="relative bg-ink-900 text-white overflow-hidden">
      {/* warm glow */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-90 pointer-events-none"
        style={{
          background:
            "radial-gradient(60% 50% at 90% 0%, rgba(228,113,39,0.18) 0%, rgba(228,113,39,0) 60%), radial-gradient(50% 40% at 0% 100%, rgba(228,113,39,0.10) 0%, rgba(228,113,39,0) 60%)",
        }}
      />
      {/* dot grid */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.04] pointer-events-none"
        style={{
          backgroundImage:
            "linear-gradient(white 1px, transparent 1px), linear-gradient(90deg, white 1px, transparent 1px)",
          backgroundSize: "32px 32px",
        }}
      />

      {/* Trust strip */}
      <div className="relative border-b border-white/10">
        <div className="mx-auto max-w-7xl px-5 lg:px-8 py-6 grid grid-cols-2 md:grid-cols-4 gap-4">
          {trust.map((t) => (
            <div
              key={t.label}
              className="flex items-center gap-2.5 text-[12.5px] font-medium text-white/80"
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/5 border border-white/10 text-brand-300">
                <t.icon className="h-4 w-4" />
              </span>
              {t.label}
            </div>
          ))}
        </div>
      </div>

      {/* Main */}
      <div className="relative mx-auto max-w-7xl px-5 lg:px-8 py-16 lg:py-20">
        <div className="grid lg:grid-cols-[1.4fr_2fr] gap-10 lg:gap-16">
          {/* Brand + newsletter */}
          <div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="https://pub-d46aef8f98ef4da0a1834fb6f554ae2c.r2.dev/images/INVENTRE_LOGO.png"
              alt="Inventre"
              className="h-9 w-auto brightness-0 invert"
            />
            <p className="mt-5 max-w-sm text-[14px] leading-relaxed text-white/70">
              Your child&apos;s entire school kit. One box. Branded by your
              school. Delivered to your door.
            </p>

            {/* Newsletter */}
            <form onSubmit={subscribe} className="mt-7 max-w-md">
              <p className="font-display text-[12px] font-bold tracking-[0.16em] uppercase text-brand-300">
                Stay in the loop
              </p>
              <p className="mt-1 text-[13px] text-white/60">
                Back-to-school tips, new drops, and partner-school updates.
              </p>

              {submitted ? (
                <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-emerald-500/10 border border-emerald-400/30 px-4 py-2 text-[13px] font-medium text-emerald-300">
                  <CheckCircle2 className="h-4 w-4" />
                  You&apos;re on the list. See you in your inbox.
                </div>
              ) : (
                <>
                  <div
                    className={
                      "mt-3 flex items-stretch rounded-full border bg-white/5 backdrop-blur overflow-hidden transition-colors focus-within:border-brand " +
                      (error ? "border-red-400/60" : "border-white/15")
                    }
                  >
                    <span className="grid place-items-center pl-4 text-white/40">
                      <Mail className="h-4 w-4" />
                    </span>
                    <input
                      type="email"
                      autoComplete="email"
                      value={email}
                      onChange={(e) => {
                        setEmail(e.target.value);
                        if (error) setError(null);
                      }}
                      placeholder="you@example.com"
                      className="flex-1 bg-transparent px-3 py-3 text-[14px] text-white placeholder:text-white/40 outline-none"
                    />
                    <button
                      type="submit"
                      disabled={submitting}
                      className="inline-flex items-center gap-1.5 bg-brand text-white px-5 text-[13px] font-bold hover:bg-brand-600 transition-colors disabled:opacity-60"
                    >
                      {submitting ? "…" : "Subscribe"}
                      {!submitting && <ArrowRight className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                  {error && (
                    <p className="mt-2 text-[12px] text-red-300">{error}</p>
                  )}
                  <p className="mt-2 text-[11px] text-white/40">
                    No spam. Unsubscribe with one click.
                  </p>
                </>
              )}
            </form>

            {/* Contact + social */}
            <div className="mt-8 flex flex-col gap-2 text-[13px] text-white/70">
              <a
                href="mailto:support@inventre.in"
                className="inline-flex items-center gap-2 hover:text-white transition-colors"
              >
                <Mail className="h-3.5 w-3.5 text-brand-300" />
                support@inventre.in
              </a>
              <a
                href="tel:+919059990804"
                className="inline-flex items-center gap-2 hover:text-white transition-colors"
              >
                <Phone className="h-3.5 w-3.5 text-brand-300" />
                <span className="font-mono">+91 90599 90804</span>
              </a>
              <a
                href="/experience-store"
                className="inline-flex items-center gap-2 hover:text-white transition-colors"
              >
                <MapPin className="h-3.5 w-3.5 text-brand-300" />
                Ashoka One Mall, Hyderabad
              </a>
            </div>

            <div className="mt-7 flex items-center gap-3">
              {[
                { Icon: Instagram, href: "#", label: "Instagram" },
                { Icon: Linkedin, href: "#", label: "LinkedIn" },
                { Icon: Youtube, href: "#", label: "YouTube" },
              ].map(({ Icon, href, label }) => (
                <a
                  key={label}
                  href={href}
                  aria-label={label}
                  className="grid h-10 w-10 place-items-center rounded-full bg-white/5 border border-white/10 text-white/70 hover:border-brand hover:text-brand hover:bg-brand/10 transition-all"
                >
                  <Icon className="h-4 w-4" />
                </a>
              ))}
            </div>
          </div>

          {/* Link columns */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-8">
            {cols.map((c) => (
              <div key={c.title}>
                <h4 className="font-display text-[12px] font-bold tracking-[0.18em] uppercase text-brand-300">
                  {c.title}
                </h4>
                <ul className="mt-4 space-y-3">
                  {c.links.map((l) => (
                    <li key={l.label}>
                      <a
                        href={l.href}
                        className="group inline-flex items-center gap-1 text-[13.5px] text-white/70 hover:text-white transition-colors"
                      >
                        <span className="border-b border-transparent group-hover:border-brand transition-colors">
                          {l.label}
                        </span>
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Bottom strip */}
      <div className="relative border-t border-white/10">
        <div className="mx-auto max-w-7xl px-5 lg:px-8 py-5 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <p className="text-[12px] text-white/50">
            © {new Date().getFullYear()} Inventre · An initiative by JV
            Ventures · Made in India 🇮🇳
          </p>
          <div className="flex items-center gap-5 flex-wrap">
            <div className="flex flex-wrap gap-x-5 gap-y-2 text-[12px] text-white/50">
              <a href="/privacy" className="hover:text-white">Privacy</a>
              <a href="/terms" className="hover:text-white">Terms</a>
              <a href="/contact?kind=parent" className="hover:text-white">
                Returns
              </a>
              <a href="#" className="hover:text-white">Shipping</a>
            </div>
            <div className="flex items-center gap-1.5 pl-5 border-l border-white/10">
              <PayBadge label="UPI" />
              <PayBadge label="Visa" />
              <PayBadge label="MC" />
              <PayBadge label="RuPay" />
              <PayBadge label="NB" />
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}

function PayBadge({ label }: { label: string }) {
  return (
    <span className="inline-grid place-items-center rounded-md border border-white/10 bg-white/5 px-2 h-6 text-[10px] font-bold tracking-wider uppercase text-white/60">
      {label}
    </span>
  );
}
