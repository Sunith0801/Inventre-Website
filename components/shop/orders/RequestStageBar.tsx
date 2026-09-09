import { CheckCircle2, Package } from "lucide-react";

/**
 * Horizontal step tracker for a customer-raised exchange / missing request,
 * mirroring the order-detail delivery stepper (see StageBar in
 * app/shop/orders/[id]/page.tsx). Purely presentational — the caller maps the
 * request's status + progress timestamps to `reachedIdx`.
 *
 * Each leg (Approved / Packed / Dispatched / Delivered) is driven by a
 * dedicated audit webhook (exchange.packed / exchange.dispatched / …), so the
 * columns light individually as the request moves through the warehouse.
 */
export function RequestStageBar({
  steps,
  reachedIdx,
  accent = "emerald",
}: {
  steps: readonly string[];
  reachedIdx: number;
  accent?: "brand" | "emerald" | "rose";
}) {
  const fill =
    accent === "emerald"
      ? "bg-emerald-500 border-emerald-500"
      : accent === "rose"
        ? "bg-rose-500 border-rose-500"
        : "bg-brand border-brand";
  const segFill =
    accent === "emerald" ? "bg-emerald-400" : accent === "rose" ? "bg-rose-400" : "bg-brand";
  return (
    // Inline grid-template (not `grid-cols-N`) on purpose: a freshly-added
    // arbitrary column count can be missing from the JIT stylesheet in dev,
    // which silently collapses the bar to one vertical column. An inline
    // style is always present, so the horizontal layout never depends on
    // Tailwind having generated that exact utility.
    <ol
      className="grid gap-x-0.5"
      style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}
    >
      {steps.map((s, i) => {
        const reached = i <= reachedIdx;
        const last = i === steps.length - 1;
        const segFilled = i < reachedIdx;
        return (
          <li key={s} className="relative flex flex-col items-center text-center">
            {!last && (
              <span
                className={
                  "absolute top-4 left-1/2 h-[3px] w-full -translate-y-1/2 " +
                  (segFilled ? segFill : "bg-ink-200")
                }
              />
            )}
            <span
              className={
                "relative z-10 grid h-8 w-8 place-items-center rounded-full border-2 text-white " +
                (reached ? fill : "bg-white border-ink-200 text-ink-400")
              }
            >
              {reached ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : (
                <Package className="h-3.5 w-3.5" />
              )}
            </span>
            <span
              className={
                "relative z-10 mt-2 text-[8.5px] sm:text-[9.5px] font-semibold tracking-wider uppercase leading-[1.1] break-words px-0.5 " +
                (reached ? "text-ink-900" : "text-ink-400")
              }
            >
              {s}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The shared 5-step lifecycle both flows render. The final label reflects how
 * audit delivers: store-pickup schools collect at the Inventre Experience
 * Store, everyone else at their school office.
 */
export function requestStages(atStore: boolean): readonly string[] {
  return [
    "Raised",
    "Approved",
    "Packed",
    "Dispatched",
    atStore ? "Delivered to store" : "Delivered to school",
  ];
}
