"use client";

import { useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  Search,
  LogIn,
  GraduationCap,
  UserCog,
  School,
  Users,
  Truck,
  CreditCard,
  Headphones,
  Repeat,
  ChevronRight,
  Package,
  CheckCircle2,
  ArrowLeft,
} from "lucide-react";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";

/**
 * PUBLIC Parent Support Portal (inventre.in/portal) — no login.
 * Flow: search (Student ID / mobile) → student + orders → pick a concern →
 * dynamic form → CON- ticket. Size Exchange shows a popup pointing to the
 * website. Search display is open per product decision (no verification).
 */

const GRADES = [
  "Nursery", "LKG", "UKG",
  ...Array.from({ length: 12 }, (_, i) => `Grade ${i + 1}`),
];

type Student = {
  id: string;
  name: string;
  enrollment: string | null;
  grade: string | null;
  gender: string | null;
  school: string | null;
  guardianName: string | null;
  guardianMobile: string | null;
};
type Order = {
  orderNumber: string;
  status: string;
  orderedDate: string;
  studentName: string | null;
  carrier: string | null;
  tracking: string | null;
};
type SearchResult = {
  found: boolean;
  parent?: { name: string | null; mobile: string | null };
  students?: Student[];
  orders?: Order[];
};

const CATEGORIES: { key: string; title: string; blurb: string; Icon: typeof LogIn }[] = [
  { key: "login", title: "Website Login", blurb: "Login issues or update mobile number", Icon: LogIn },
  { key: "grade_change", title: "Grade Change", blurb: "Wrong grade shown on the website", Icon: GraduationCap },
  { key: "student_details", title: "Student Details Incorrect", blurb: "Student name is wrong", Icon: UserCog },
  { key: "school_details", title: "School Details Incorrect", blurb: "School is wrong", Icon: School },
  { key: "guardian", title: "Guardian Details", blurb: "Update guardian / sibling info", Icon: Users },
  { key: "order_delivery", title: "Order & Delivery", blurb: "Track or report a delivery problem", Icon: Truck },
  { key: "payment", title: "Payment Issues", blurb: "Deductions or refund requests", Icon: CreditCard },
  { key: "customer_care", title: "Customer Care", blurb: "Talk to our support team", Icon: Headphones },
  { key: "size_exchange", title: "Size Exchange", blurb: "Request an item size exchange", Icon: Repeat },
];

function fmtDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return iso;
  }
}

export default function PortalPage() {
  const [step, setStep] = useState<"search" | "home" | "form" | "done">("search");
  const [q, setQ] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [data, setData] = useState<SearchResult | null>(null);
  const [studentId, setStudentId] = useState<string | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [sizePopup, setSizePopup] = useState(false);
  const [ticket, setTicket] = useState<string | null>(null);

  const student = data?.students?.find((s) => s.id === studentId) ?? data?.students?.[0] ?? null;

  async function runSearch(e?: React.FormEvent) {
    e?.preventDefault();
    if (!q.trim()) return;
    setSearching(true);
    setSearchError(null);
    try {
      const res = await fetch(`/api/portal/search?q=${encodeURIComponent(q.trim())}`);
      const d = (await res.json().catch(() => ({}))) as SearchResult & { error?: string };
      if (!res.ok) {
        setSearchError(d.error || "Search failed.");
        return;
      }
      if (!d.found) {
        setSearchError("No student or account found for that Student ID / mobile number.");
        setData(null);
        return;
      }
      setData(d);
      setStudentId(d.students?.[0]?.id ?? null);
      setStep("home");
    } finally {
      setSearching(false);
    }
  }

  function pickCategory(key: string) {
    if (key === "size_exchange") {
      setSizePopup(true);
      return;
    }
    setCategory(key);
    setStep("form");
  }

  return (
    <main className="min-h-screen bg-cream-50">
      <Nav />
      <div className="mx-auto max-w-2xl px-5 lg:px-8 pt-8 pb-16">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[12px] font-semibold uppercase tracking-wide text-brand">Inventre Support</p>
            <h1 className="font-display text-[26px] font-extrabold text-ink-900">Parent Help Portal</h1>
          </div>
          <Link
            href="/portal/history"
            className="rounded-full bg-white px-4 py-2 text-[13px] font-semibold text-ink-800 ring-1 ring-cream-200 hover:ring-brand/40 transition"
          >
            Track Concern
          </Link>
        </div>

        {/* STEP: search */}
        {step === "search" ? (
          <div className="mt-8">
            <p className="text-[14px] text-ink-600">
              Enter your <strong>Student ID</strong> or <strong>mobile number</strong> to begin.
            </p>
            <form onSubmit={runSearch} className="mt-4 flex gap-2">
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Student ID or 10-digit mobile"
                className="flex-1 rounded-xl border border-cream-300 bg-white px-4 py-3 text-[14px] focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
              />
              <button
                type="submit"
                disabled={searching}
                className="inline-flex items-center gap-1.5 rounded-xl bg-ink-900 px-5 py-3 text-[14px] font-semibold text-white hover:bg-ink-800 transition disabled:opacity-50"
              >
                <Search className="h-4 w-4" /> {searching ? "…" : "Search"}
              </button>
            </form>
            {searchError ? <p className="mt-3 text-[13px] font-medium text-red-600">{searchError}</p> : null}
          </div>
        ) : null}

        {/* STEP: home — student + orders + categories */}
        {step === "home" && student ? (
          <div className="mt-6 space-y-6">
            <StudentCard student={student} orders={data?.orders ?? []} />
            {(data?.students?.length ?? 0) > 1 ? (
              <div className="flex flex-wrap gap-2">
                {data!.students!.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setStudentId(s.id)}
                    className={`rounded-full px-3 py-1 text-[12px] font-semibold transition ${
                      s.id === studentId ? "bg-ink-900 text-white" : "bg-cream-100 text-ink-600 hover:bg-cream-200"
                    }`}
                  >
                    {s.name}
                  </button>
                ))}
              </div>
            ) : null}

            <div>
              <h2 className="font-display text-[16px] font-bold text-ink-900">What can we help you with?</h2>
              <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                {CATEGORIES.map((c) => (
                  <button
                    key={c.key}
                    onClick={() => pickCategory(c.key)}
                    className="group flex items-center gap-3 rounded-2xl bg-white p-4 text-left ring-1 ring-cream-200 hover:ring-brand/40 hover:shadow-[0_10px_30px_-14px_rgba(0,0,0,0.15)] transition-all"
                  >
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-cream-100 text-ink-700 group-hover:bg-brand/10 group-hover:text-brand transition-colors">
                      <c.Icon className="h-5 w-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[14px] font-bold text-ink-900">{c.title}</span>
                      <span className="block text-[12px] text-ink-500">{c.blurb}</span>
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-ink-300 group-hover:text-brand transition" />
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={() => {
                setStep("search");
                setData(null);
                setQ("");
              }}
              className="text-[13px] font-medium text-ink-500 hover:text-ink-900"
            >
              ← Search for another student
            </button>
          </div>
        ) : null}

        {/* STEP: form */}
        {step === "form" && category && student ? (
          <ConcernForm
            category={category}
            student={student}
            defaultPhone={data?.parent?.mobile ?? student.guardianMobile ?? ""}
            defaultName={student.guardianName ?? ""}
            onBack={() => setStep("home")}
            onDone={(ref) => {
              setTicket(ref);
              setStep("done");
            }}
          />
        ) : null}

        {/* STEP: done */}
        {step === "done" ? (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mt-8 rounded-3xl bg-white p-7 ring-1 ring-cream-200 text-center"
          >
            <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-500" />
            <h2 className="mt-3 font-display text-[22px] font-extrabold text-ink-900">Concern submitted</h2>
            <p className="mt-2 text-[14px] text-ink-600">
              Our support team will look into it.
              {ticket ? (
                <>
                  {" "}Your ticket number is <span className="font-semibold text-ink-900">{ticket}</span>.
                </>
              ) : null}
            </p>
            <div className="mt-6 flex justify-center gap-3">
              <button
                onClick={() => setStep("home")}
                className="rounded-xl bg-ink-900 px-5 py-3 text-[14px] font-semibold text-white hover:bg-ink-800 transition"
              >
                Raise another
              </button>
              {ticket ? (
                <Link
                  href={`/portal/history?ref=${encodeURIComponent(ticket)}`}
                  className="rounded-xl bg-white px-5 py-3 text-[14px] font-semibold text-ink-800 ring-1 ring-cream-200 hover:ring-brand/40 transition"
                >
                  Track it
                </Link>
              ) : null}
            </div>
          </motion.div>
        ) : null}
      </div>

      {/* Size Exchange popup */}
      {sizePopup ? (
        <div className="fixed inset-0 z-[70] grid place-items-center bg-black/40 p-4" onClick={() => setSizePopup(false)}>
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 text-center" onClick={(e) => e.stopPropagation()}>
            <Repeat className="mx-auto h-10 w-10 text-brand" />
            <h3 className="mt-3 font-display text-[18px] font-bold text-ink-900">Size Exchange</h3>
            <p className="mt-2 text-[14px] text-ink-600">
              Exchange and Missing requests must be raised through the Inventre website.
            </p>
            <button
              onClick={() => setSizePopup(false)}
              className="mt-5 w-full rounded-xl bg-ink-900 py-3 text-[14px] font-semibold text-white hover:bg-ink-800 transition"
            >
              Got it
            </button>
          </div>
        </div>
      ) : null}
      <Footer />
    </main>
  );
}

function StudentCard({ student, orders }: { student: Student; orders: Order[] }) {
  const latest = orders[0];
  return (
    <div className="rounded-3xl bg-white p-5 ring-1 ring-cream-200">
      <div className="flex items-center gap-4">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-brand/10 font-display text-[18px] font-bold text-brand">
          {(student.name?.[0] ?? "?").toUpperCase()}
        </span>
        <div className="min-w-0">
          <p className="font-display text-[18px] font-bold text-ink-900">{student.name}</p>
          {student.enrollment ? <p className="text-[12px] text-ink-500">ID: {student.enrollment}</p> : null}
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-[13px]">
        <Field label="School" value={student.school} />
        <Field label="Grade" value={student.grade} />
        <Field label="Guardian" value={student.guardianName} />
        <Field label="Mobile" value={student.guardianMobile} />
        {student.gender ? <Field label="Gender" value={student.gender} /> : null}
      </div>

      {orders.length > 0 ? (
        <div className="mt-4 border-t border-cream-100 pt-4">
          <p className="text-[12px] font-semibold uppercase tracking-wide text-ink-400">
            Orders ({orders.length})
          </p>
          {latest ? (
            <div className="mt-2 rounded-2xl bg-cream-50 p-3">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 font-semibold text-ink-900">
                  <Package className="h-4 w-4" /> {latest.orderNumber}
                </span>
                <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-semibold capitalize text-emerald-700">
                  {latest.status}
                </span>
              </div>
              <p className="text-[12px] text-ink-500">Ordered {fmtDate(latest.orderedDate)}</p>
              {latest.carrier || latest.tracking ? (
                <p className="text-[12px] text-ink-500">{[latest.carrier, latest.tracking].filter(Boolean).join(" · ")}</p>
              ) : null}
            </div>
          ) : null}
          {orders.length > 1 ? (
            <ul className="mt-2 space-y-1">
              {orders.slice(1, 6).map((o) => (
                <li key={o.orderNumber} className="flex items-center justify-between text-[12px] text-ink-600">
                  <span>{o.orderNumber}</span>
                  <span className="capitalize text-ink-400">{o.status}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
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

// ─── Dynamic concern form ──────────────────────────────────────────────

function ConcernForm({
  category,
  student,
  defaultName,
  defaultPhone,
  onBack,
  onDone,
}: {
  category: string;
  student: Student;
  defaultName: string;
  defaultPhone: string;
  onBack: () => void;
  onDone: (ref: string) => void;
}) {
  const [name, setName] = useState(defaultName);
  const [phone, setPhone] = useState(defaultPhone);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [subType, setSubType] = useState<string>("");
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (k: string, v: string) => setFields((f) => ({ ...f, [k]: v }));
  const field =
    "mt-1 w-full rounded-xl border border-cream-300 bg-white px-3 py-2.5 text-[14px] focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20";
  const photoRequired = category === "grade_change" || category === "payment";

  const meta = TITLES[category] ?? { title: "Raise a concern", blurb: "" };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) return setError("Please enter your name.");
    if (phone.replace(/\D/g, "").length < 10) return setError("Please enter a valid mobile number.");
    if (photoRequired && files.length === 0) return setError("A photo is required for this request.");

    setSubmitting(true);
    try {
      // Upload photos first (if any).
      let photos: { url: string; key: string }[] = [];
      if (files.length > 0) {
        const fd = new FormData();
        files.forEach((f) => fd.append("files", f));
        const up = await fetch("/api/portal/upload", { method: "POST", body: fd });
        const upd = await up.json().catch(() => ({}));
        if (!up.ok) {
          setError(upd.error || "Photo upload failed.");
          return;
        }
        photos = upd.photos ?? [];
      }

      const details: Record<string, string> = { ...fields };
      const res = await fetch("/api/portal/concerns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category,
          subType: subType || undefined,
          name: name.trim(),
          phone: phone.trim(),
          studentId: student.id,
          details,
          photos,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(d.error || "Could not submit.");
        return;
      }
      onDone(d.concernNumber ?? "");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mt-6">
      <button onClick={onBack} className="flex items-center gap-1 text-[13px] font-medium text-ink-500 hover:text-ink-900">
        <ArrowLeft className="h-4 w-4" /> Back
      </button>
      <h2 className="mt-3 font-display text-[22px] font-extrabold text-ink-900">{meta.title}</h2>
      {meta.blurb ? <p className="text-[13px] text-ink-500">{meta.blurb}</p> : null}

      <form onSubmit={submit} className="mt-5 space-y-4">
        {/* Per-category fields */}
        {category === "login" ? (
          <>
            <Text label="Old mobile number" v={fields.old_mobile} on={(x) => set("old_mobile", x)} cls={field} tel />
            <Text label="New mobile number" v={fields.new_mobile} on={(x) => set("new_mobile", x)} cls={field} tel />
          </>
        ) : null}

        {category === "grade_change" ? (
          <>
            <div>
              <label className="block text-[13px] font-semibold text-ink-800">Grade currently shown</label>
              <input value={student.grade ?? "—"} disabled className={`${field} bg-cream-100 text-ink-500`} />
            </div>
            <Select label="Correct grade" v={fields.correct_grade} on={(x) => set("correct_grade", x)} cls={field} options={GRADES} />
          </>
        ) : null}

        {category === "student_details" ? (
          <>
            <div>
              <label className="block text-[13px] font-semibold text-ink-800">Student ID</label>
              <input value={student.enrollment ?? "—"} disabled className={`${field} bg-cream-100 text-ink-500`} />
            </div>
            <Text label="Correct student name" v={fields.correct_name} on={(x) => set("correct_name", x)} cls={field} />
          </>
        ) : null}

        {category === "school_details" ? (
          <>
            <div>
              <label className="block text-[13px] font-semibold text-ink-800">Student ID</label>
              <input value={student.enrollment ?? "—"} disabled className={`${field} bg-cream-100 text-ink-500`} />
            </div>
            <Text label="Correct school" v={fields.correct_school} on={(x) => set("correct_school", x)} cls={field} />
          </>
        ) : null}

        {category === "guardian" ? (
          <>
            <Text label="Guardian name" v={fields.guardian_name} on={(x) => set("guardian_name", x)} cls={field} />
            <Text label="Guardian mobile" v={fields.guardian_mobile} on={(x) => set("guardian_mobile", x)} cls={field} tel />
            <Text label="Brother / sibling details (if any)" v={fields.sibling} on={(x) => set("sibling", x)} cls={field} />
          </>
        ) : null}

        {category === "order_delivery" ? (
          <>
            <Radio
              label="What's the problem?"
              v={subType}
              on={setSubType}
              options={[
                { value: "where", label: "Where is my order?" },
                { value: "not_delivered", label: "Order not delivered" },
                { value: "partial", label: "Only some items received" },
                { value: "wrong_item", label: "Wrong item delivered" },
              ]}
            />
            <Text label="Order number (optional)" v={fields.order_no} on={(x) => set("order_no", x)} cls={field} />
            <Area label="Details" v={fields.note} on={(x) => set("note", x)} cls={field} />
          </>
        ) : null}

        {category === "payment" ? (
          <>
            <Radio
              label="What happened?"
              v={subType}
              on={setSubType}
              options={[
                { value: "amount_deducted_no_order", label: "Only amount deducted (no order)" },
                { value: "refund", label: "Refund" },
              ]}
            />
            <Text label="Reference ID" v={fields.reference_id} on={(x) => set("reference_id", x)} cls={field} />
            <Text label="Amount deducted" v={fields.amount_deducted} on={(x) => set("amount_deducted", x)} cls={field} numeric />
            {subType === "refund" ? (
              <Text label="Refund amount requested" v={fields.refund_amount} on={(x) => set("refund_amount", x)} cls={field} numeric />
            ) : null}
          </>
        ) : null}

        {category === "customer_care" ? (
          <Area label="How can we help?" v={fields.note} on={(x) => set("note", x)} cls={field} />
        ) : null}

        {/* Contact + photos */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Text label="Your name" v={name} on={setName} cls={field} />
          <Text label="Contact mobile" v={phone} on={setPhone} cls={field} tel />
        </div>

        {photoRequired || category === "order_delivery" ? (
          <div>
            <label className="block text-[13px] font-semibold text-ink-800">
              Photo{photoRequired ? " (required)" : " (optional)"}
            </label>
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
              className="mt-1 block w-full text-[13px] text-ink-600 file:mr-3 file:rounded-lg file:border-0 file:bg-ink-900 file:px-3 file:py-2 file:text-[13px] file:font-semibold file:text-white"
            />
            {files.length > 0 ? <p className="mt-1 text-[12px] text-ink-500">{files.length} photo(s) selected</p> : null}
          </div>
        ) : null}

        {error ? <p className="text-[13px] font-medium text-red-600">{error}</p> : null}
        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-xl bg-ink-900 py-3.5 text-[14px] font-semibold text-white hover:bg-ink-800 transition disabled:opacity-50"
        >
          {submitting ? "Submitting…" : "Submit concern"}
        </button>
      </form>
    </div>
  );
}

const TITLES: Record<string, { title: string; blurb: string }> = {
  login: { title: "Website Login", blurb: "We'll update your login mobile number." },
  grade_change: { title: "Grade Change", blurb: "Upload proof so we can correct the grade." },
  student_details: { title: "Student Details Incorrect", blurb: "Tell us the correct student name." },
  school_details: { title: "School Details Incorrect", blurb: "Tell us the correct school." },
  guardian: { title: "Guardian Details", blurb: "Update guardian or sibling information." },
  order_delivery: { title: "Order & Delivery", blurb: "We'll route this to the right team." },
  payment: { title: "Payment Issues", blurb: "Upload proof of the deduction." },
  customer_care: { title: "Customer Care", blurb: "We'll connect you with support." },
};

function Text({ label, v, on, cls, tel, numeric }: { label: string; v?: string; on: (x: string) => void; cls: string; tel?: boolean; numeric?: boolean }) {
  return (
    <div>
      <label className="block text-[13px] font-semibold text-ink-800">{label}</label>
      <input
        value={v ?? ""}
        onChange={(e) => on(e.target.value)}
        inputMode={tel ? "tel" : numeric ? "numeric" : "text"}
        className={cls}
      />
    </div>
  );
}
function Area({ label, v, on, cls }: { label: string; v?: string; on: (x: string) => void; cls: string }) {
  return (
    <div>
      <label className="block text-[13px] font-semibold text-ink-800">{label}</label>
      <textarea value={v ?? ""} onChange={(e) => on(e.target.value)} rows={4} className={cls} />
    </div>
  );
}
function Select({ label, v, on, cls, options }: { label: string; v?: string; on: (x: string) => void; cls: string; options: string[] }) {
  return (
    <div>
      <label className="block text-[13px] font-semibold text-ink-800">{label}</label>
      <select value={v ?? ""} onChange={(e) => on(e.target.value)} className={cls}>
        <option value="">Select…</option>
        {options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    </div>
  );
}
function Radio({ label, v, on, options }: { label: string; v: string; on: (x: string) => void; options: { value: string; label: string }[] }) {
  return (
    <div>
      <label className="block text-[13px] font-semibold text-ink-800">{label}</label>
      <div className="mt-2 space-y-2">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => on(o.value)}
            className={`flex w-full items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-[14px] transition ${
              v === o.value ? "border-brand bg-brand/5 text-ink-900" : "border-cream-200 bg-white text-ink-700 hover:border-brand/40"
            }`}
          >
            <span className={`grid h-4 w-4 place-items-center rounded-full border ${v === o.value ? "border-brand" : "border-ink-300"}`}>
              {v === o.value ? <span className="h-2 w-2 rounded-full bg-brand" /> : null}
            </span>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
