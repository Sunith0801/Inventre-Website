import { SaleStrip } from "@/components/SaleStrip";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import {
  GRIEVANCE_OFFICER,
  PRIVACY_SECTIONS,
  PRIVACY_VERSION,
} from "@/lib/legal/privacy";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Privacy Notice — Inventre",
  description:
    "What personal information Inventre holds about you and your child, why, who it is shared with, how long it is kept and your rights under the DPDP Act 2023.",
};

export default function PrivacyPage() {
  return (
    <main>
      <SaleStrip />
      <Nav />
      <section className="mx-auto max-w-3xl px-5 lg:px-8 py-16 lg:py-24">
        <div className="inline-flex items-center gap-2 rounded-full bg-brand-50 border border-brand-100 px-3 py-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-brand" />
          <span className="font-display text-[12px] font-semibold tracking-[0.18em] uppercase text-brand-700">
            Privacy
          </span>
        </div>
        <h1 className="mt-4 font-display font-extrabold text-display-md text-ink-900 leading-[1.05]">
          Privacy Notice
        </h1>
        <p className="mt-4 text-[15px] sm:text-[16px] leading-relaxed text-ink-600">
          How Inventre looks after your information and your child&apos;s,
          written for parents. Version{" "}
          <span className="font-mono text-ink-800">{PRIVACY_VERSION}</span>.
        </p>

        <nav
          aria-label="Contents"
          className="mt-8 rounded-2xl border border-ink-100 bg-white p-5 text-[14px]"
        >
          <p className="font-display text-[12px] font-semibold tracking-[0.18em] uppercase text-ink-500">
            Contents
          </p>
          <ol className="mt-3 grid sm:grid-cols-2 gap-x-6 gap-y-1.5 list-decimal list-inside text-ink-700">
            {PRIVACY_SECTIONS.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`} className="hover:text-brand">
                  {s.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <div className="mt-10 space-y-10">
          {PRIVACY_SECTIONS.map((s, i) => (
            <section key={s.id} id={s.id} className="scroll-mt-24">
              <h2 className="font-display text-[22px] sm:text-[24px] font-extrabold text-ink-900 leading-tight">
                <span className="text-brand mr-2">
                  {String(i + 1).padStart(2, "0")}
                </span>
                {s.title}
              </h2>
              {s.paragraphs.map((p, j) => (
                <p
                  key={j}
                  className="mt-3 text-[14.5px] sm:text-[15px] leading-relaxed text-ink-600"
                >
                  {p}
                </p>
              ))}
              {s.bullets && (
                <ul className="mt-3 space-y-2 pl-5 list-disc text-[14.5px] sm:text-[15px] leading-relaxed text-ink-600">
                  {s.bullets.map((b, j) => (
                    <li key={j}>{b}</li>
                  ))}
                </ul>
              )}
              {s.note && (
                <p className="mt-4 rounded-xl border border-brand-100 bg-brand-50 px-4 py-3 text-[13.5px] leading-relaxed text-ink-700">
                  {s.note}
                </p>
              )}
              {s.id === "grievance-officer" && (
                <div className="mt-4 rounded-2xl border border-ink-100 bg-white p-5 text-[14.5px] text-ink-700">
                  <p className="font-display text-[12px] font-semibold tracking-[0.18em] uppercase text-ink-500">
                    Grievance officer
                  </p>
                  <p className="mt-2 font-semibold text-ink-900">
                    {GRIEVANCE_OFFICER.name}
                  </p>
                  <p className="mt-1">
                    <a
                      href={`mailto:${GRIEVANCE_OFFICER.email}`}
                      className="text-brand underline"
                    >
                      {GRIEVANCE_OFFICER.email}
                    </a>
                  </p>
                  <p className="mt-1 text-ink-500">
                    Response within {GRIEVANCE_OFFICER.responseDays} working
                    days.
                  </p>
                </div>
              )}
            </section>
          ))}
        </div>

        <p className="mt-12 pt-6 border-t border-ink-100 text-[13px] text-ink-500">
          Looking for shipping, exchange and returns rules? Read the{" "}
          <a href="/terms" className="text-brand underline">
            Terms &amp; Conditions
          </a>
          .
        </p>
      </section>
      <Footer />
    </main>
  );
}
