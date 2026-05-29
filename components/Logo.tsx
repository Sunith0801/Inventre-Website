export function Logo({ className = "" }: { className?: string }) {
  return (
    <span
      className={`font-display text-[26px] font-extrabold tracking-[0.18em] leading-none ${className}`}
    >
      INVENTRE
      <span className="text-brand">.</span>
    </span>
  );
}
