import { SaleStrip } from "@/components/SaleStrip";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { TC_SECTIONS, TC_VERSION } from "@/lib/legal/terms";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Terms & Conditions — Inventre",
  description:
    "Inventre's shipping, 7-day exchange, returns and delivery terms for school kit orders.",
};

export default function TermsPage() {
  return (
    <main>
      <SaleStrip />
      <Nav />
      <section className="mx-auto max-w-3xl px-5 lg:px-8 py-16 lg:py-24">
        <div className="inline-flex items-center gap-2 rounded-full bg-brand-50 border border-brand-100 px-3 py-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-brand" />
          <span className="font-display text-[12px] font-semibold tracking-[0.18em] uppercase text-brand-700">
            Terms
          </span>
        </div>
        <h1 className="mt-4 font-display font-extrabold text-display-md text-ink-900 leading-[1.05]">
          Terms &amp; Conditions
        </h1>
        <p className="mt-4 text-[15px] sm:text-[16px] leading-relaxed text-ink-600">
          Shipping, the 7-day exchange guarantee, returns and delivery. Version{" "}
          <span className="font-mono text-ink-800">{TC_VERSION}</span>.
        </p>

        <div className="mt-10 space-y-10">
          {TC_SECTIONS.map((s, i) => (
            <section key={s.heading} className="scroll-mt-24">
              <h2 className="font-display text-[22px] sm:text-[24px] font-extrabold text-ink-900 leading-tight">
                <span className="text-brand mr-2">
                  {String(i + 1).padStart(2, "0")}
                </span>
                {s.heading}
              </h2>
              {s.paragraphs.map((p, j) => (
                <p
                  key={j}
                  className="mt-3 text-[14.5px] sm:text-[15px] leading-relaxed text-ink-600"
                >
                  {p}
                </p>
              ))}
            </section>
          ))}
        </div>

        <p className="mt-12 pt-6 border-t border-ink-100 text-[13px] text-ink-500">
          How we handle your information is explained in the{" "}
          <a href="/privacy" className="text-brand underline">
            Privacy Notice
          </a>
          .
        </p>
      </section>
      <Footer />
    </main>
  );
}
