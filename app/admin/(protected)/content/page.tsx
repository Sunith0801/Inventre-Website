import { asc } from "drizzle-orm";
import {
  HelpCircle,
  Megaphone,
  Layers,
  Image as ImageIcon,
  ArrowRight,
} from "lucide-react";

const sections = [
  {
    title: "Marketing media",
    description:
      "Replace any image or video on the public marketing pages — About, For Schools, etc. Visual gallery with one-click upload.",
    href: "/admin/content/media",
    icon: ImageIcon,
  },
  {
    title: "Homepage blocks",
    description:
      "Edit hero, sale strip, stats, in-the-wild videos, how-it-works, and other home page sections.",
    href: "/admin/content/blocks",
    icon: Layers,
  },
  {
    title: "FAQs",
    description: "Add, edit and reorder questions shown on the homepage.",
    href: "/admin/content/faqs",
    icon: HelpCircle,
  },
  {
    title: "Testimonials",
    description: "Principal quotes shown on the homepage.",
    href: "/admin/testimonials",
    icon: Megaphone,
  },
];

export default function ContentIndex() {
  return (
    <div>
      <h1 className="font-display text-[28px] font-extrabold tracking-tight text-ink-900">
        Content
      </h1>
      <p className="mt-1 text-[14px] text-ink-500">
        Edit everything that shows on the public site.
      </p>

      <div className="mt-8 grid sm:grid-cols-2 gap-4">
        {sections.map((s) => (
          <a
            key={s.href}
            href={s.href}
            className="group rounded-2xl border border-ink-100 bg-white p-6 hover:border-brand hover:shadow-[0_15px_30px_-15px_rgba(228,113,39,0.25)] transition-all"
          >
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-50 text-brand">
              <s.icon className="h-5 w-5" />
            </span>
            <h3 className="mt-4 font-display text-[18px] font-bold text-ink-900">
              {s.title}
            </h3>
            <p className="mt-1.5 text-[13px] text-ink-600 leading-relaxed">
              {s.description}
            </p>
            <span className="mt-4 inline-flex items-center gap-1 text-[12px] font-semibold text-brand">
              Open <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
            </span>
          </a>
        ))}
      </div>
    </div>
  );
}
