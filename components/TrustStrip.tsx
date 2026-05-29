const FALLBACK = [
  "INDUS INTERNATIONAL",
  "WINMORE ACADEMY",
  "YELLOW TRAIN",
  "GREENWOOD HIGH",
  "EKYA SCHOOLS",
  "ORCHIDS",
  "VIBGYOR",
  "DPS BANGALORE",
];

export function TrustStrip({ schools }: { schools?: string[] }) {
  const list = schools && schools.length > 0 ? schools : FALLBACK;
  return (
    <section
      aria-label="Schools that trust Inventre"
      className="border-y border-ink-100 bg-cream"
    >
      <div className="mx-auto max-w-7xl px-5 lg:px-8 py-8">
        <div className="flex flex-col md:flex-row items-start md:items-center gap-6">
          <p className="shrink-0 font-display text-[11px] font-semibold tracking-[0.18em] uppercase text-ink-500">
            Trusted by
          </p>
          <div className="relative w-full overflow-hidden">
            <div className="flex w-max animate-marquee gap-12 pr-12 [mask-image:linear-gradient(90deg,transparent,black_8%,black_92%,transparent)]">
              {[...list, ...list].map((s, i) => (
                <span
                  key={i}
                  className="font-display text-[14px] font-semibold tracking-[0.18em] text-ink-400 hover:text-ink-700 transition-colors whitespace-nowrap"
                >
                  {s}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
