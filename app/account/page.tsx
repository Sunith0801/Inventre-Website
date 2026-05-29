"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import {
  User2,
  Phone,
  Mail,
  LogOut,
  Pencil,
  Check,
  X,
  ShoppingBag,
  Package,
  Sparkles,
  ChevronRight,
} from "lucide-react";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { auth, type Me } from "@/lib/auth";
import { SiblingsList } from "@/components/account/SiblingsList";

function titleCase(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .toLowerCase()
    .replace(/(^|[\s\-'/])(\p{L})/gu, (_, sep, ch) => sep + ch.toUpperCase());
}

function maskPhone(p: string) {
  if (p.length < 10) return p;
  return `+91 ${p.slice(0, 5)} ${p.slice(5)}`;
}

function initialsOf(name: string | null | undefined) {
  return (name ?? "?")
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase() || "?";
}

export default function AccountPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me>(null);
  const [loaded, setLoaded] = useState(false);
  const [editField, setEditField] = useState<"name" | "email" | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState<string | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    auth
      .me()
      .then((u) => {
        setMe(u);
        if (u?.kind === "parent") {
          setName(u.name ?? "");
          setEmail(u.email ?? "");
        }
      })
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    if (loaded && !me) router.push("/login");
  }, [loaded, me, router]);

  async function save(field: "name" | "email") {
    setSaving(true);
    try {
      const value = (field === "name" ? name : email).trim();
      const res = await fetch("/api/auth/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value === "" ? null : value }),
      });
      if (!res.ok) throw new Error(await res.text());
      const refreshed = await auth.me();
      setMe(refreshed);
      setEditField(null);
      setSavedFlash(field === "name" ? "Name updated" : "Email updated");
      setTimeout(() => setSavedFlash(null), 2000);
    } finally {
      setSaving(false);
    }
  }

  async function logout() {
    setLoggingOut(true);
    await fetch("/api/auth/logout", {
      method: "POST",
      headers: { Origin: window.location.origin },
    });
    router.push("/");
    router.refresh();
  }

  if (!loaded) {
    return (
      <main className="min-h-screen bg-cream-50">
        <Nav />
        <div className="mx-auto max-w-5xl px-5 py-10">
          <div className="h-48 rounded-3xl bg-cream-200 animate-pulse mb-6" />
          <div className="grid lg:grid-cols-[1fr_1.2fr] gap-6">
            <div className="h-72 rounded-3xl bg-cream-200 animate-pulse" />
            <div className="h-72 rounded-3xl bg-cream-200 animate-pulse" />
          </div>
        </div>
      </main>
    );
  }

  if (!me || me.kind !== "parent") return null;

  const parentName = titleCase(me.name ?? "");
  // Prefer the guardian whose phone matches this session (now stamped on
  // session.ts) over the family-level parents.name placeholder, so when
  // two guardians share one family the header reads "Hi, <whoever just
  // logged in>" rather than always the primary guardian.
  const loggedInGuardian = titleCase(
    me.students.find((s) => s.guardianName)?.guardianName ?? me.name ?? ""
  ).replace(/^Parent[\s\-_]+/i, "");
  const firstName = loggedInGuardian.split(" ")[0] || "there";
  const hasMultipleStudents = me.students.length > 1;

  return (
    <main className="min-h-screen bg-cream-50 pb-20">
      <Nav />

      {/* Hero — premium membership-card feel */}
      <section className="relative overflow-hidden">
        <div
          aria-hidden
          className="absolute inset-0 -z-10"
          style={{
            background:
              "radial-gradient(60% 80% at 0% 0%, rgba(228,113,39,0.10) 0%, transparent 60%), radial-gradient(50% 70% at 100% 0%, rgba(228,113,39,0.06) 0%, transparent 55%)",
          }}
        />
        <div
          aria-hidden
          className="absolute inset-0 -z-10 opacity-[0.4]"
          style={{
            backgroundImage:
              "repeating-linear-gradient(135deg, rgba(228,113,39,0.04) 0 1px, transparent 1px 18px)",
          }}
        />
        <div className="mx-auto max-w-5xl px-5 pt-10 pb-12">
          <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6">
            <div className="flex items-center gap-5">
              <div className="relative">
                <div className="grid h-20 w-20 place-items-center rounded-2xl bg-gradient-to-br from-brand-400 via-brand-500 to-brand-700 text-white font-display text-[26px] font-extrabold shadow-[0_10px_25px_-10px_rgba(228,113,39,0.6)]">
                  {initialsOf(me.name)}
                </div>
                <span className="absolute -bottom-1 -right-1 grid h-6 w-6 place-items-center rounded-full bg-emerald-500 text-white border-2 border-cream-50">
                  <Sparkles className="h-3 w-3" />
                </span>
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-bold tracking-[0.22em] uppercase text-brand">
                  Welcome back
                </p>
                <h1 className="mt-1 font-display text-[32px] sm:text-[40px] lg:text-[44px] font-extrabold tracking-tight text-ink-900 leading-[1.05] truncate">
                  Hi, {firstName}
                </h1>
                <p className="mt-1.5 text-[13.5px] text-ink-600 inline-flex items-center gap-1.5">
                  <Phone className="h-3.5 w-3.5 text-ink-400" />
                  <span className="font-mono tabular-nums">{maskPhone(me.phone)}</span>
                </p>
              </div>
            </div>

            {/* Quick stats */}
            <div className="flex items-stretch gap-3">
              <Stat label="Students" value={me.students.length.toString()} />
              <Stat
                label="Schools"
                value={new Set(me.students.map((s) => s.school.id)).size.toString()}
              />
              <Link
                href="/shop"
                className="rounded-2xl border border-brand bg-brand text-white px-5 flex items-center gap-2 hover:bg-brand-700 transition-colors shadow-[0_10px_25px_-10px_rgba(228,113,39,0.6)]"
              >
                <ShoppingBag className="h-4 w-4" />
                <div className="text-left leading-tight py-2">
                  <p className="text-[10px] font-bold tracking-[0.18em] uppercase opacity-90">
                    Continue
                  </p>
                  <p className="text-[13px] font-bold">Shopping</p>
                </div>
              </Link>
            </div>
          </div>

          {/* Saved flash */}
          <AnimatePresence>
            {savedFlash && (
              <motion.div
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                className="mt-5 inline-flex items-center gap-2 rounded-full bg-emerald-100 border border-emerald-200 px-3.5 py-1.5 text-[12.5px] font-semibold text-emerald-800"
              >
                <Check className="h-3.5 w-3.5" /> {savedFlash}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </section>

      <div className="mx-auto max-w-5xl px-5">
        <div className="grid lg:grid-cols-[1fr_1.2fr] gap-6">
          {/* LEFT — Personal info */}
          <Card title="Personal information" subtitle="Click any field to edit.">
            <EditableRow
              icon={<User2 className="h-3.5 w-3.5" />}
              label="Full name"
              value={parentName}
              placeholder="Add your name"
              editing={editField === "name"}
              inputValue={name}
              onInputChange={setName}
              onEdit={() => setEditField("name")}
              onCancel={() => {
                setName(me.name ?? "");
                setEditField(null);
              }}
              onSave={() => save("name")}
              saving={saving}
            />
            <EditableRow
              icon={<Mail className="h-3.5 w-3.5" />}
              label="Email address"
              value={me.email ?? ""}
              placeholder="parent@example.com"
              editing={editField === "email"}
              inputValue={email}
              onInputChange={setEmail}
              onEdit={() => setEditField("email")}
              onCancel={() => {
                setEmail(me.email ?? "");
                setEditField(null);
              }}
              onSave={() => save("email")}
              saving={saving}
              inputType="email"
            />
            <PhoneRow phone={me.phone} loggedInPhone={me.loggedInPhone ?? null} />
          </Card>

          {/* RIGHT — Siblings */}
          <Card
            title={
              hasMultipleStudents
                ? "Siblings on this account"
                : "Your student"
            }
            subtitle={
              hasMultipleStudents
                ? "Every child on this number, with their school, grade, and section."
                : "Tap to start shopping."
            }
            accent
          >
            <SiblingsList students={me.students} />
          </Card>
        </div>

        {/* Quick actions */}
        <Card title="Quick actions" subtitle="">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <ActionTile
              href="/shop/orders"
              icon={<Package className="h-5 w-5" />}
              title="My orders"
              hint="Track or reorder"
            />
            <ActionTile
              href="/shop/cart"
              icon={<ShoppingBag className="h-5 w-5" />}
              title="My cart"
              hint="Items you're considering"
            />
            <ActionTile
              href="/shop"
              icon={<Sparkles className="h-5 w-5" />}
              title="Continue shopping"
              hint="Back to the catalog"
            />
          </div>
        </Card>

        {/* Footer-style sign out */}
        <div className="mt-8 flex items-center justify-between px-1 py-4 border-t border-ink-100">
          <p className="text-[12px] text-ink-500">
            Signed in as{" "}
            <span className="font-mono text-ink-700">{maskPhone(me.phone)}</span>
          </p>
          <button
            onClick={logout}
            disabled={loggingOut}
            className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-ink-700 hover:text-red-700 transition-colors disabled:opacity-40"
          >
            <LogOut className="h-3.5 w-3.5" />
            {loggingOut ? "Signing out…" : "Sign out"}
          </button>
        </div>
      </div>
      <Footer />
    </main>
  );
}

/* ============================================================
   Sub-components
   ============================================================ */

function Card({
  title,
  subtitle,
  children,
  accent,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <section
      className={
        "rounded-3xl bg-white p-6 mt-6 first:mt-0 " +
        (accent
          ? "border border-brand-100 shadow-[0_20px_50px_-30px_rgba(228,113,39,0.30)]"
          : "border border-ink-100 shadow-[0_10px_30px_-18px_rgba(0,0,0,0.10)]")
      }
    >
      <header className="mb-4">
        <h2 className="font-display text-[16px] font-bold text-ink-900">
          {title}
        </h2>
        {subtitle && (
          <p className="mt-0.5 text-[12.5px] text-ink-500">{subtitle}</p>
        )}
      </header>
      {children}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-ink-100 bg-white px-4 py-2.5 min-w-[88px] text-center shadow-[0_10px_25px_-15px_rgba(0,0,0,0.08)]">
      <p className="text-[10px] font-bold tracking-[0.18em] uppercase text-ink-500">
        {label}
      </p>
      <p className="mt-0.5 font-display text-[22px] font-extrabold text-ink-900 tabular-nums">
        {value}
      </p>
    </div>
  );
}

function EditableRow({
  icon,
  label,
  value,
  placeholder,
  editing,
  inputValue,
  onInputChange,
  onEdit,
  onCancel,
  onSave,
  saving,
  inputType = "text",
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  placeholder: string;
  editing: boolean;
  inputValue: string;
  onInputChange: (v: string) => void;
  onEdit: () => void;
  onCancel: () => void;
  onSave: () => void;
  saving: boolean;
  inputType?: string;
}) {
  return (
    <div className="group flex items-center justify-between gap-3 py-3.5 border-b last:border-b-0 border-ink-100/70">
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-bold tracking-[0.14em] uppercase text-ink-500 inline-flex items-center gap-1.5">
          <span className="text-ink-400">{icon}</span>
          {label}
        </p>
        <AnimatePresence mode="wait" initial={false}>
          {editing ? (
            <motion.div
              key="edit"
              initial={{ opacity: 0, y: -2 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -2 }}
              className="mt-1.5 flex items-center gap-2"
            >
              <input
                autoFocus
                type={inputType}
                value={inputValue}
                onChange={(e) => onInputChange(e.target.value)}
                placeholder={placeholder}
                className="form-input flex-1 text-[15px]"
                onKeyDown={(e) => {
                  if (e.key === "Enter") onSave();
                  if (e.key === "Escape") onCancel();
                }}
              />
              <button
                onClick={onSave}
                disabled={saving}
                className="grid h-9 w-9 place-items-center rounded-lg bg-brand text-white hover:bg-brand-700 transition-colors disabled:opacity-40"
                aria-label="Save"
              >
                <Check className="h-4 w-4" />
              </button>
              <button
                onClick={onCancel}
                className="grid h-9 w-9 place-items-center rounded-lg border border-ink-200 bg-white text-ink-700 hover:border-ink-400"
                aria-label="Cancel"
              >
                <X className="h-4 w-4" />
              </button>
            </motion.div>
          ) : (
            <motion.button
              key="view"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              type="button"
              onClick={onEdit}
              className="mt-1.5 inline-flex items-center gap-2 text-[15px] text-ink-900 font-medium"
            >
              <span className={value ? "" : "text-ink-400 italic font-normal"}>
                {value || placeholder}
              </span>
              <Pencil className="h-3.5 w-3.5 text-ink-300 group-hover:text-brand transition-colors" />
            </motion.button>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function PhoneRow({
  phone,
  loggedInPhone,
}: {
  phone: string;
  loggedInPhone: string | null;
}) {
  // Show the "Also signed in via" row only when the session phone is a
  // different number than the family's primary. Strip non-digits + take
  // the last 10 to compare so an extension like "+91" doesn't confuse the
  // equality check.
  const last10 = (raw: string | null) =>
    raw ? raw.replace(/\D/g, "").slice(-10) : "";
  const altShown =
    loggedInPhone && last10(loggedInPhone) !== last10(phone)
      ? loggedInPhone
      : null;
  return (
    <div className="pt-3.5 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold tracking-[0.14em] uppercase text-ink-500 inline-flex items-center gap-1.5">
            <Phone className="h-3.5 w-3.5 text-ink-400" />
            Primary phone
          </p>
          <p className="mt-1.5 text-[15px] font-mono font-semibold text-ink-900 tabular-nums">
            {maskPhone(phone)}
          </p>
          <p className="mt-0.5 text-[11.5px] text-ink-500">
            Used for OTP login. Verifying a new number takes 30 seconds.
          </p>
        </div>
        <Link
          href="/account/change-phone"
          className="self-start inline-flex items-center gap-1 rounded-full border border-ink-200 bg-white px-3.5 h-9 text-[12.5px] font-semibold text-ink-800 hover:border-brand-300 hover:text-brand transition-colors"
        >
          Change
          <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      {altShown && (
        <div className="rounded-xl border border-ink-100 bg-cream-50 px-3.5 py-2.5">
          <p className="text-[11px] font-bold tracking-[0.14em] uppercase text-ink-500 inline-flex items-center gap-1.5">
            <Phone className="h-3.5 w-3.5 text-ink-400" />
            Also signed in via
          </p>
          <p className="mt-1 text-[14px] font-mono font-semibold text-ink-800 tabular-nums">
            {maskPhone(altShown)}
          </p>
          <p className="mt-0.5 text-[11px] text-ink-500">
            This guardian's number is linked to the same family.
          </p>
        </div>
      )}
    </div>
  );
}

function ActionTile({
  href,
  icon,
  title,
  hint,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  hint: string;
}) {
  return (
    <Link
      href={href}
      className="group rounded-2xl border border-ink-100 bg-cream-50 hover:bg-white hover:border-brand-200 hover:shadow-[0_15px_30px_-18px_rgba(0,0,0,0.15)] transition-all p-4 flex items-start gap-3"
    >
      <div className="grid h-10 w-10 place-items-center rounded-xl bg-brand-50 text-brand group-hover:bg-brand group-hover:text-white transition-colors shrink-0">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-display text-[14px] font-bold text-ink-900">
          {title}
        </p>
        <p className="text-[12px] text-ink-500 mt-0.5">{hint}</p>
      </div>
      <ChevronRight className="h-4 w-4 text-ink-300 group-hover:text-brand mt-0.5" />
    </Link>
  );
}

