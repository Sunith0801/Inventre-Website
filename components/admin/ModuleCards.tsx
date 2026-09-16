import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { Badge, type Tone } from "@/components/admin/ui/primitives";

/**
 * The card grid used by every navigation hub: section landing pages, the
 * Content hub, the Settings hub, the Reports hub. Icon + label (+ an
 * optional one-line description), one card per destination, same look
 * everywhere so a hub never reads as a different kind of page.
 *
 * `status` is optional and only the Settings hub uses it: a small pill in
 * the card's corner ("Configured", "2 failed") so the hub answers "is this
 * working?" before the admin clicks through. A card with no status renders
 * exactly as before.
 */
export type ModuleCard = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  description?: string;
  status?: { label: React.ReactNode; tone?: Tone };
};

export function ModuleCards({ items, columns = 3 }: { items: ModuleCard[]; columns?: 2 | 3 }) {
  return (
    <ul className={cn("grid gap-3 sm:grid-cols-2", columns === 3 && "xl:grid-cols-3")}>
      {items.map((it) => (
        <li key={it.href}>
          <Link
            href={it.href}
            className="group flex h-full items-start gap-3.5 rounded-2xl border border-ink-100/70 bg-white p-4 shadow-[0_1px_2px_rgba(10,10,10,0.03)] transition-[border,box-shadow,transform] hover:-translate-y-px hover:border-ink-200 hover:shadow-[0_6px_18px_rgba(10,10,10,0.06)]"
          >
            <span className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700">
              <it.icon className="h-[18px] w-[18px]" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5 text-[14px] font-semibold text-ink-900">
                {it.label}
                <ArrowUpRight className="h-3.5 w-3.5 text-ink-300 transition-colors group-hover:text-brand-600" />
              </span>
              {it.description ? (
                <span className="mt-0.5 block text-[12px] leading-snug text-ink-500">{it.description}</span>
              ) : null}
            </span>
            {it.status ? (
              <Badge tone={it.status.tone ?? "subtle"} dot size="sm" className="mt-0.5 shrink-0 whitespace-nowrap">
                {it.status.label}
              </Badge>
            ) : null}
          </Link>
        </li>
      ))}
    </ul>
  );
}

/**
 * A titled group of module cards. Hubs with more than ~6 destinations read
 * better as three or four named clusters than as one undifferentiated grid.
 */
export function ModuleGroup({
  title,
  description,
  items,
  columns,
}: {
  title: string;
  description?: string;
  items: ModuleCard[];
  columns?: 2 | 3;
}) {
  if (items.length === 0) return null;
  return (
    <section className="mb-7 last:mb-0">
      <div className="mb-3">
        <h2 className="text-[13px] font-semibold tracking-tight text-ink-900">{title}</h2>
        {description ? <p className="mt-0.5 text-[12px] text-ink-500">{description}</p> : null}
      </div>
      <ModuleCards items={items} columns={columns} />
    </section>
  );
}
