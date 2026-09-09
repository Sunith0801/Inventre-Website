import SignOutLink from "./SignOutLink";

/**
 * Full-page storefront closure screen.
 *
 * Shown by app/shop/layout.tsx to a signed-in parent who has no enabled
 * student left *while* the site-access switch is on (lib/site-access.ts).
 * Deliberately a dead end: no catalog, no cart, no nav — the only ways
 * out are signing out or calling support.
 *
 * Server component. Animation is pure CSS in a scoped <style> block so
 * this file carries its own look without new globals.css / tailwind
 * config entries, and the global prefers-reduced-motion rule in
 * globals.css already flattens it for anyone who asked for less motion.
 */
export default function AccessClosed({
  title,
  subtitle,
  studentName,
  actions,
}: {
  title: string;
  subtitle: string;
  /** Set when the closure is for ONE student and siblings still shop. */
  studentName?: string | null;
  /** e.g. a "Shop for <sibling>" button rendered under the message. */
  actions?: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-cream-100 flex items-center justify-center px-5 py-16">
      <style>{`
        @keyframes acFloat {
          0%, 100% { transform: translateY(0) }
          50%      { transform: translateY(-10px) }
        }
        @keyframes acRipple {
          0%   { transform: scale(0.72); opacity: 0.55 }
          80%  { transform: scale(1.5);  opacity: 0 }
          100% { transform: scale(1.5);  opacity: 0 }
        }
        @keyframes acRise {
          from { opacity: 0; transform: translateY(14px) }
          to   { opacity: 1; transform: translateY(0) }
        }
        @keyframes acSweep {
          from { background-position: 200% 0 }
          to   { background-position: -200% 0 }
        }
        .ac-float  { animation: acFloat 4.5s ease-in-out infinite }
        .ac-ripple { animation: acRipple 3.2s cubic-bezier(0.16, 1, 0.3, 1) infinite }
        .ac-rise   { animation: acRise 620ms cubic-bezier(0.16, 1, 0.3, 1) both }
        .ac-sweep {
          background-image: linear-gradient(
            90deg,
            transparent 0%,
            rgba(228, 113, 39, 0.55) 50%,
            transparent 100%
          );
          background-size: 200% 100%;
          animation: acSweep 2.6s linear infinite;
        }
      `}</style>

      <div className="w-full max-w-md text-center">
        {/* Padlock, floating inside two staggered ripples. */}
        <div className="relative mx-auto mb-9 h-28 w-28">
          <span className="ac-ripple absolute inset-0 rounded-full bg-brand-200/70" />
          <span
            className="ac-ripple absolute inset-0 rounded-full bg-brand-200/50"
            style={{ animationDelay: "1.1s" }}
          />
          <div className="ac-float relative flex h-28 w-28 items-center justify-center rounded-full bg-white shadow-[0_18px_40px_-18px_rgba(10,10,10,0.35)]">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-11 w-11 text-brand-600"
              aria-hidden="true"
            >
              <rect x="4" y="10.5" width="16" height="10.5" rx="2.5" />
              <path d="M8 10.5V7a4 4 0 1 1 8 0v3.5" />
              <circle cx="12" cy="15.6" r="1.15" fill="currentColor" stroke="none" />
            </svg>
          </div>
        </div>

        <h1
          className="ac-rise text-[26px] sm:text-[30px] font-semibold tracking-[-0.02em] text-ink-900 leading-tight"
          style={{ animationDelay: "80ms" }}
        >
          {title}
        </h1>
        {studentName && (
          <p
            className="ac-rise mt-2 text-[14px] font-semibold text-brand-700"
            style={{ animationDelay: "140ms" }}
          >
            for {studentName}
          </p>
        )}
        <p
          className="ac-rise mt-3 text-[15px] text-ink-500"
          style={{ animationDelay: "200ms" }}
        >
          {subtitle}
        </p>
        {actions && (
          <div className="ac-rise mt-6" style={{ animationDelay: "260ms" }}>
            {actions}
          </div>
        )}

        {/* Thin progress sweep — reads as "in progress", not as a real bar. */}
        <div
          className="ac-rise mx-auto mt-8 h-[3px] w-40 overflow-hidden rounded-full bg-ink-100"
          style={{ animationDelay: "320ms" }}
        >
          <div className="ac-sweep h-full w-full" />
        </div>

        <div
          className="ac-rise mt-10 rounded-2xl border border-ink-100 bg-white/70 px-5 py-4 text-[13px] leading-relaxed text-ink-500"
          style={{ animationDelay: "440ms" }}
        >
          Already placed an order? Your delivery is unaffected. For anything
          urgent, please contact your school or write to{" "}
          <a
            href="mailto:support@inventre.in"
            className="font-semibold text-brand-600 hover:text-brand-700"
          >
            support@inventre.in
          </a>
          .
        </div>

        <div className="ac-rise mt-6" style={{ animationDelay: "560ms" }}>
          <SignOutLink className="text-[13px] font-semibold text-ink-400 hover:text-ink-700 transition-colors disabled:opacity-60" />
        </div>
      </div>
    </div>
  );
}
