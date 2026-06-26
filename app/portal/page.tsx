import Link from "next/link";
import {
  LogIn,
  GraduationCap,
  Truck,
  CreditCard,
  Headphones,
  Repeat,
  ClipboardList,
  ChevronRight,
} from "lucide-react";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";

/**
 * PUBLIC Parent Help Portal — inventre.in/portal (the QR-code landing).
 *
 * No login. A parent scans the QR, picks a concern category, and submits a
 * ticket (their name/phone/issue captured on the form). Server component,
 * fully static — there is intentionally NO auth gate and NO redirect to
 * /login. Each module opens the public concern form; "View My Concern
 * History" tracks a ticket by its reference number.
 */

export const dynamic = "force-static";

const MODULES: { title: string; blurb: string; href: string; Icon: typeof LogIn }[] = [
  { title: "Website Login", blurb: "Login issues or update mobile number", href: "/portal/concern?category=login", Icon: LogIn },
  { title: "Student Details", blurb: "Update grade, name or school information", href: "/portal/concern?category=student_details", Icon: GraduationCap },
  { title: "Order & Delivery", blurb: "Track orders and report delivery problems", href: "/portal/concern?category=order_delivery", Icon: Truck },
  { title: "Payment Issues", blurb: "Payment deductions or refund requests", href: "/portal/concern?category=payment", Icon: CreditCard },
  { title: "Customer Care", blurb: "Connect with our support team directly", href: "/portal/concern?category=customer_care", Icon: Headphones },
  { title: "Size Exchange", blurb: "Request an item size exchange", href: "/portal/concern?category=size_exchange", Icon: Repeat },
  { title: "View My Concern History", blurb: "Track a concern by its ticket number", href: "/portal/history", Icon: ClipboardList },
];

export default function PortalPage() {
  return (
    <main className="min-h-screen bg-cream-50">
      <Nav />
      <div className="mx-auto max-w-2xl px-5 lg:px-8 pt-8 pb-16">
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

        <p className="mt-3 text-[14px] text-ink-500">
          Tell us what you need help with — no login required. We&apos;ll give you a
          ticket number to track it.
        </p>

        <h2 className="mt-8 font-display text-[16px] font-bold text-ink-900">
          What can we help you with?
        </h2>
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          {MODULES.map((m) => (
            <Link
              key={m.title}
              href={m.href}
              className="group flex h-full items-center gap-3 rounded-2xl bg-white p-4 ring-1 ring-cream-200 hover:ring-brand/40 hover:shadow-[0_10px_30px_-14px_rgba(0,0,0,0.15)] transition-all"
            >
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-cream-100 text-ink-700 group-hover:bg-brand/10 group-hover:text-brand transition-colors">
                <m.Icon className="h-5 w-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-bold text-ink-900">{m.title}</span>
                <span className="block text-[12px] text-ink-500">{m.blurb}</span>
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-ink-300 group-hover:text-brand transition" />
            </Link>
          ))}
        </div>
      </div>
      <Footer />
    </main>
  );
}
