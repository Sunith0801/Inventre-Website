export function SaleStrip({
  items = ["SALE IS LIVE", "FREE SHIPPING ON KITS", "TRY BEFORE YOU BUY", "BACK TO SCHOOL '26"],
}: {
  items?: string[];
}) {
  if (!items.length) return null;
  return (
    <div className="bg-brand text-white overflow-hidden border-b border-brand-600">
      <div className="flex w-max animate-marquee gap-10 py-2.5 pr-10 [animation-duration:35s]">
        {[...items, ...items, ...items, ...items].map((t, i) => (
          <span key={i} className="flex items-center gap-10 font-display text-[12px] font-bold tracking-[0.22em] whitespace-nowrap">
            {t}
            <span aria-hidden className="opacity-70">|</span>
          </span>
        ))}
      </div>
    </div>
  );
}
