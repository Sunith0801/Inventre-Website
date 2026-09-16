"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, XCircle, AlertCircle, ArrowUpRight, Rocket } from "lucide-react";
import { Button } from "@/components/admin/ui/primitives-client";
import { FormError } from "@/components/admin/ui/form";
import { cn } from "@/lib/cn";
import type { ReadinessCheck } from "@/server/admin/product-readiness";

type Status = "draft" | "active" | "archived";

const STATUSES: { value: Status; label: string; blurb: string }[] = [
  { value: "draft", label: "Draft", blurb: "Being set up. Never shown on the shop." },
  { value: "archived", label: "Hidden", blurb: "Finished but withdrawn — kept for orders and history, not listed." },
  { value: "active", label: "Published", blurb: "Live on the storefront for its schools and grades." },
];

/**
 * The last step. A checklist computed on the server, then the status
 * choice. Publish is only offered when every required item passes — and
 * the API enforces the same list, so this is a mirror, not the gate.
 */
export function PublishPanel({
  productId,
  status,
  checks,
  publishable,
  shopHref,
  stepMap = {},
}: {
  productId: string;
  status: Status;
  checks: ReadinessCheck[];
  publishable: boolean;
  shopHref: string;
  /** Check step → the step key this product actually shows (a staged kit
   *  folds pricing/images/sections into two stages). Plain data: this is
   *  a client component and a server page cannot hand it a function. */
  stepMap?: Partial<Record<ReadinessCheck["step"], string>>;
}) {
  const router = useRouter();
  const [next, setNext] = useState<Status>(status);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const required = checks.filter((c) => c.required);
  const recommended = checks.filter((c) => !c.required);
  const failing = required.filter((c) => !c.ok);
  const blocked = next === "active" && !publishable;
  const dirty = next !== status;

  function save() {
    setError(null);
    start(async () => {
      const r = await fetch(`/api/admin/products/${productId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        setError(d.error ?? "Could not change the status.");
        return;
      }
      router.refresh();
    });
  }

  const Row = ({ c }: { c: ReadinessCheck }) => (
    <li className="flex items-start gap-3 px-5 py-2.5">
      {c.ok ? (
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
      ) : c.required ? (
        <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
      ) : (
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
      )}
      <span className="min-w-0 flex-1">
        <span className={cn("block text-[13px] font-medium", c.ok ? "text-ink-800" : "text-ink-900")}>{c.label}</span>
        {c.detail ? <span className="block text-[12px] text-ink-500">{c.detail}</span> : null}
      </span>
      {!c.ok ? (
        <Link href={`/admin/products/${productId}?step=${stepMap[c.step] ?? c.step}`} className="shrink-0 text-[12px] font-semibold text-brand-700 hover:text-brand-800">
          Fix
        </Link>
      ) : null}
    </li>
  );

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
      <div className="space-y-5 xl:col-span-2">
        <section className="rounded-2xl border border-ink-100/70 bg-white">
          <div className="border-b border-ink-100/70 px-5 py-3">
            <h3 className="text-[14px] font-semibold text-ink-900">Required to publish</h3>
            <p className="text-[12px] text-ink-500">{failing.length === 0 ? "Everything a parent needs to buy this is in place." : `${failing.length} thing${failing.length === 1 ? "" : "s"} still missing.`}</p>
          </div>
          <ul className="divide-y divide-ink-100/70">{required.map((c) => <Row key={c.key} c={c} />)}</ul>
        </section>
        <section className="rounded-2xl border border-ink-100/70 bg-white">
          <div className="border-b border-ink-100/70 px-5 py-3">
            <h3 className="text-[14px] font-semibold text-ink-900">Recommended</h3>
            <p className="text-[12px] text-ink-500">Not blocking, but the shop page is thinner without them.</p>
          </div>
          <ul className="divide-y divide-ink-100/70">{recommended.map((c) => <Row key={c.key} c={c} />)}</ul>
        </section>
      </div>

      <div className="space-y-5">
        <section className="rounded-2xl border border-ink-100/70 bg-white p-5">
          <h3 className="mb-3 text-[14px] font-semibold text-ink-900">Website status</h3>
          <div role="radiogroup" className="space-y-2">
            {STATUSES.map((s) => {
              const on = next === s.value;
              const disabled = s.value === "active" && !publishable;
              return (
                <button
                  key={s.value}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  disabled={disabled}
                  onClick={() => setNext(s.value)}
                  className={cn(
                    "flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors",
                    on ? "border-ink-900 bg-ink-900 text-white" : "border-ink-100 bg-white hover:border-ink-300",
                    disabled && "cursor-not-allowed opacity-50",
                  )}
                >
                  <span className={cn("mt-1 h-3 w-3 shrink-0 rounded-full border-2", on ? "border-brand-300 bg-brand-400" : "border-ink-300")} />
                  <span className="min-w-0">
                    <span className="block text-[13px] font-semibold">{s.label}</span>
                    <span className={cn("block text-[11.5px] leading-snug", on ? "text-white/70" : "text-ink-500")}>{s.blurb}</span>
                  </span>
                </button>
              );
            })}
          </div>
          {blocked ? <p className="mt-3 text-[12px] text-red-700">Fix the required items first.</p> : null}
          {error ? <FormError className="mt-3">{error}</FormError> : null}
          <div className="mt-4 flex items-center justify-end gap-2 border-t border-ink-100/70 pt-4">
            {status === "active" ? (
              <a href={shopHref} target="_blank" rel="noreferrer" className="mr-auto inline-flex items-center gap-1 text-[12px] font-semibold text-brand-700 hover:text-brand-800">
                View on shop <ArrowUpRight className="h-3 w-3" />
              </a>
            ) : null}
            <Button busy={pending} disabled={!dirty || blocked} icon={next === "active" ? <Rocket className="h-3.5 w-3.5" /> : undefined} onClick={save}>
              {next === "active" ? "Publish product" : next === "archived" ? "Hide product" : "Save as draft"}
            </Button>
          </div>
        </section>
      </div>
    </div>
  );
}
