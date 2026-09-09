"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  CheckCircle2,
  ArrowRight,
  Users,
  School,
  Building2,
  Phone,
  Mail,
  Clock,
  Instagram,
  Linkedin,
  Copy,
  Check,
} from "lucide-react";

type Kind = "parent" | "school" | "business";

const tabs: { id: Kind; label: string; icon: typeof Users }[] = [
  { id: "parent", label: "Parent", icon: Users },
  { id: "school", label: "School", icon: School },
  { id: "business", label: "Business", icon: Building2 },
];

const partnershipOptions = ["Academic", "Technology", "Training"];
const boardOptions = ["CBSE", "ICSE", "State Board", "IB", "Cambridge"];
const businessTypes = ["Distributor", "Reseller", "Manufacturer", "Other"];

const channelInfo: Record<Kind, { phone: string; email: string }> = {
  parent: { phone: "+91 90599 90804", email: "support@inventre.in" },
  school: { phone: "+91 90599 90804", email: "connect@inventre.in" },
  business: { phone: "+91 90599 90804", email: "connect@inventre.in" },
};

export function ContactForm() {
  const [kind, setKind] = useState<Kind>("school");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    organization: "",
    interest: "Academic",
    board: "CBSE",
    businessType: "Distributor",
    address: "",
    gst: "",
    message: "",
  });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!form.name || !form.email || !form.phone) {
      setError("Name, email and phone are required");
      return;
    }
    if (!/^\d{10}$/.test(form.phone.replace(/\D/g, ""))) {
      setError("Phone must be 10 digits");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, ...form }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? "Submission failed");
      }
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submission failed");
    } finally {
      setSubmitting(false);
    }
  };

  const ch = channelInfo[kind];

  const copyEmail = async () => {
    await navigator.clipboard.writeText(ch.email);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <section
      id="contact-form"
      className="bg-cream-200 border-y border-ink-100 scroll-mt-24"
    >
      <div className="mx-auto max-w-7xl px-5 lg:px-8 py-16 lg:py-20">
        <AnimatePresence mode="wait">
          {done ? (
            <motion.div
              key="ok"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              className="text-center py-12 max-w-xl mx-auto"
            >
              <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-emerald-50 border border-emerald-200">
                <CheckCircle2 className="h-7 w-7 text-emerald-500" />
              </div>
              <h3 className="mt-5 font-display text-[28px] sm:text-[34px] font-extrabold text-ink-900">
                Message received
              </h3>
              <p className="mt-3 text-[15px] text-ink-600">
                Thanks {form.name}. The Inventre team will get back to you at{" "}
                <span className="font-semibold text-ink-900">{form.email}</span>{" "}
                within 24 business hours.
              </p>
              <button
                type="button"
                onClick={() => {
                  setDone(false);
                  setForm({
                    name: "",
                    email: "",
                    phone: "",
                    organization: "",
                    interest: "Academic",
                    board: "CBSE",
                    businessType: "Distributor",
                    address: "",
                    gst: "",
                    message: "",
                  });
                }}
                className="mt-6 inline-flex items-center gap-2 rounded-full border border-ink-200 bg-white px-5 h-11 text-[13px] font-semibold text-ink-800 hover:border-ink-900"
              >
                Send another message
              </button>
            </motion.div>
          ) : (
            <motion.div
              key="form"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              {/* TOP — heading block (spans both columns) */}
              <div>
                <div className="inline-flex items-center gap-2 rounded-full bg-brand-50 border border-brand-100 px-3 py-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-brand" />
                  <span className="font-display text-[12px] font-semibold tracking-[0.18em] uppercase text-brand-700">
                    Send a message
                  </span>
                </div>
                <h2 className="mt-4 font-display font-extrabold text-display-md text-ink-900 leading-[1.05]">
                  Tell us what you need.
                </h2>
                <p className="mt-3 text-[14px] text-ink-600 max-w-md">
                  We read every message. Real humans. No bots, no auto-replies.
                </p>

                {/* Tabs */}
                <div
                  id={`contact-form-${kind}`}
                  className="mt-6 inline-flex rounded-full border border-ink-200 bg-white p-1"
                >
                  {tabs.map((t) => {
                    const active = t.id === kind;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setKind(t.id)}
                        className={
                          "inline-flex items-center gap-1.5 rounded-full px-4 h-9 text-[13px] font-semibold transition-all " +
                          (active
                            ? "bg-ink-900 text-white"
                            : "text-ink-600 hover:text-ink-900")
                        }
                      >
                        <t.icon className="h-3.5 w-3.5" />
                        {t.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* BOTTOM — 2-col: form card + sidebar (aligned starts) */}
              <div className="mt-8 grid lg:grid-cols-[1.5fr_1fr] gap-6 lg:gap-10">
                <form
                  onSubmit={submit}
                  className="rounded-2xl border border-ink-100 bg-white p-6 lg:p-7 space-y-4"
                >
                  <div className="grid sm:grid-cols-2 gap-4">
                    <Input
                      label={kind === "parent" ? "Your name" : "Contact person"}
                      value={form.name}
                      onChange={(v) => setForm({ ...form, name: v })}
                      required
                    />
                    <Input
                      label="Email"
                      type="email"
                      value={form.email}
                      onChange={(v) => setForm({ ...form, email: v })}
                      required
                    />
                    <Input
                      label="Phone (10 digits)"
                      inputMode="numeric"
                      value={form.phone}
                      onChange={(v) =>
                        setForm({
                          ...form,
                          phone: v.replace(/\D/g, "").slice(0, 10),
                        })
                      }
                      required
                    />
                    {kind === "school" && (
                      <Input
                        label="School name"
                        value={form.organization}
                        onChange={(v) => setForm({ ...form, organization: v })}
                        required
                      />
                    )}
                    {kind === "business" && (
                      <Input
                        label="Business name"
                        value={form.organization}
                        onChange={(v) => setForm({ ...form, organization: v })}
                        required
                      />
                    )}

                    {kind === "school" && (
                      <>
                        <Select
                          label="Partnership interest"
                          value={form.interest}
                          onChange={(v) => setForm({ ...form, interest: v })}
                          options={partnershipOptions}
                        />
                        <Select
                          label="School board"
                          value={form.board}
                          onChange={(v) => setForm({ ...form, board: v })}
                          options={boardOptions}
                        />
                      </>
                    )}

                    {kind === "business" && (
                      <>
                        <Select
                          label="Business type"
                          value={form.businessType}
                          onChange={(v) => setForm({ ...form, businessType: v })}
                          options={businessTypes}
                        />
                        <Input
                          label="GST number (optional)"
                          value={form.gst}
                          onChange={(v) =>
                            setForm({ ...form, gst: v.toUpperCase() })
                          }
                        />
                      </>
                    )}

                    {(kind === "school" || kind === "business") && (
                      <Input
                        label="Address"
                        value={form.address}
                        onChange={(v) => setForm({ ...form, address: v })}
                        className="sm:col-span-2"
                      />
                    )}
                  </div>

                  <label className="flex flex-col">
                    <span className="text-[12px] font-semibold text-ink-700">
                      {kind === "parent"
                        ? "How can we help?"
                        : "Additional information"}
                    </span>
                    <textarea
                      rows={4}
                      value={form.message}
                      onChange={(e) =>
                        setForm({ ...form, message: e.target.value })
                      }
                      className="mt-1 rounded-xl border border-ink-200 bg-white px-3 py-2.5 text-[14px] outline-none focus:border-ink-900 resize-none"
                      placeholder={
                        kind === "school"
                          ? "Tell us about your school, term timeline, and what you're hoping to streamline."
                          : kind === "business"
                            ? "Tell us about your business and how we can collaborate."
                            : "Order number, issue, or anything we should know."
                      }
                    />
                  </label>

                  {error && (
                    <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">
                      {error}
                    </div>
                  )}

                  <div className="flex items-center justify-between flex-wrap gap-3 pt-2 border-t border-ink-100">
                    <p className="text-[12px] text-ink-500">
                      We typically respond within 24 business hours.
                    </p>
                    <button
                      type="submit"
                      disabled={submitting}
                      className="inline-flex items-center gap-2 rounded-full bg-brand text-white px-6 h-11 text-[14px] font-bold hover:bg-brand-600 active:scale-[0.99] transition-all disabled:opacity-60"
                    >
                      {submitting ? "Sending…" : "Send message"}
                      {!submitting && <ArrowRight className="h-4 w-4" />}
                    </button>
                  </div>
                </form>

                {/* RIGHT — unified contact panel (sticky on desktop) */}
                <aside className="lg:sticky lg:top-24 lg:self-start">
                <div className="rounded-2xl border border-ink-100 bg-white overflow-hidden">
                  {/* 1. Live availability */}
                  <div className="p-5">
                    <div className="inline-flex items-center gap-2 rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-1">
                      <span className="relative flex h-1.5 w-1.5">
                        <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-70 animate-ping" />
                        <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500" />
                      </span>
                      <span className="font-display text-[10px] font-bold tracking-[0.18em] uppercase text-emerald-700">
                        Online · we&apos;re here
                      </span>
                    </div>
                    <p className="mt-3 font-display text-[18px] font-extrabold text-ink-900 leading-tight">
                      Reply within{" "}
                      <span className="text-brand">24 hours.</span>
                    </p>
                    <p className="mt-1.5 text-[12px] text-ink-500">
                      Faster on weekdays. Real humans, no bots.
                    </p>
                  </div>

                  <div className="border-t border-dashed border-ink-100" />

                  {/* 2. Tap to call */}
                  <a
                    href={`tel:${ch.phone.replace(/\s/g, "")}`}
                    className="group block p-5 hover:bg-cream-50 transition-colors"
                  >
                    <p className="font-display text-[10px] font-semibold tracking-[0.18em] uppercase text-brand-700">
                      Or just call
                    </p>
                    <p className="mt-2 font-display text-[22px] sm:text-[24px] font-extrabold text-ink-900 leading-none tracking-tight font-mono">
                      {ch.phone}
                    </p>
                    <p className="mt-2 inline-flex items-center gap-1.5 text-[12px] font-semibold text-brand">
                      <Phone className="h-3 w-3" /> Tap to call
                    </p>
                  </a>

                  <div className="border-t border-dashed border-ink-100" />

                  {/* 3. Email + copy */}
                  <div className="p-5">
                    <p className="font-display text-[10px] font-semibold tracking-[0.18em] uppercase text-brand-700">
                      Email
                    </p>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <a
                        href={`mailto:${ch.email}`}
                        className="font-display text-[14px] sm:text-[15px] font-bold text-ink-900 hover:text-brand truncate"
                      >
                        {ch.email}
                      </a>
                      <button
                        type="button"
                        onClick={copyEmail}
                        className="shrink-0 inline-flex items-center gap-1 rounded-full border border-ink-200 px-2.5 h-7 text-[11px] font-semibold text-ink-700 hover:border-ink-900"
                      >
                        {copied ? (
                          <>
                            <Check className="h-3 w-3 text-emerald-600" />
                            Copied
                          </>
                        ) : (
                          <>
                            <Copy className="h-3 w-3" />
                            Copy
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                  <div className="border-t border-dashed border-ink-100" />

                  {/* 4. Hours */}
                  <div className="p-5">
                    <div className="flex items-center gap-2">
                      <Clock className="h-3.5 w-3.5 text-brand" />
                      <p className="font-display text-[10px] font-semibold tracking-[0.18em] uppercase text-brand-700">
                        Hours
                      </p>
                    </div>
                    <div className="mt-3 space-y-1.5 text-[13px]">
                      <div className="flex items-center justify-between">
                        <span className="text-ink-600">Mon–Fri</span>
                        <span className="font-mono font-semibold text-ink-900">
                          9 am – 8 pm
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-ink-600">Sat</span>
                        <span className="font-mono font-semibold text-ink-900">
                          10 am – 6 pm
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-ink-600">Sun</span>
                        <span className="font-mono text-ink-400">closed</span>
                      </div>
                    </div>
                  </div>

                  <div className="border-t border-dashed border-ink-100" />

                  {/* 5. Social */}
                  <div className="p-5 bg-cream-50">
                    <p className="font-display text-[10px] font-semibold tracking-[0.18em] uppercase text-brand-700">
                      Or say hi on
                    </p>
                    <div className="mt-3 flex gap-2">
                      <a
                        href="https://instagram.com/inventre.in"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 rounded-full border border-ink-200 bg-white px-3 h-9 text-[12px] font-semibold text-ink-800 hover:border-ink-900"
                      >
                        <Instagram className="h-3.5 w-3.5 text-brand" />
                        Instagram
                      </a>
                      <a
                        href="https://linkedin.com/company/inventre"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 rounded-full border border-ink-200 bg-white px-3 h-9 text-[12px] font-semibold text-ink-800 hover:border-ink-900"
                      >
                        <Linkedin className="h-3.5 w-3.5 text-brand" />
                        LinkedIn
                      </a>
                    </div>
                  </div>
                </div>
              </aside>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </section>
  );
}

function Input({
  label,
  value,
  onChange,
  type = "text",
  required,
  inputMode,
  className = "",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  inputMode?: "text" | "numeric";
  className?: string;
}) {
  return (
    <label className={"flex flex-col " + className}>
      <span className="text-[12px] font-semibold text-ink-700">
        {label} {required && <span className="text-brand">*</span>}
      </span>
      <input
        type={type}
        inputMode={inputMode}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        className="mt-1 rounded-xl border border-ink-200 bg-white px-3 py-2.5 text-[14px] outline-none focus:border-ink-900"
      />
    </label>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <label className="flex flex-col">
      <span className="text-[12px] font-semibold text-ink-700">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 rounded-xl border border-ink-200 bg-white px-3 py-2.5 text-[14px] outline-none focus:border-ink-900"
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}
