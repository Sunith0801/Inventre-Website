import Link from "next/link";
import { redirect } from "next/navigation";
import { Shirt, BookOpen, Library, Gift, ArrowUpRight } from "lucide-react";
import { requireAnyPermission, isResponse } from "@/server/admin-guard";
import { PageHeader } from "@/components/admin/ui/primitives";

export const dynamic = "force-dynamic";

/**
 * "What do you want to create?" — the one door into product creation.
 * Four types, four workflows: a uniform never sees a sections builder and
 * a kit never sees a size matrix. Every one of them starts with school
 * and grade, and none reaches the website until its last step.
 */
const TYPES = [
  { href: "/admin/products/new/uniform", label: "Uniform", icon: Shirt, steps: "Basic info → Variants → Pricing → Content → Kit contents → Review", blurb: "Shirts, trousers, ties, sports kit. Colours × sizes, each with its own SKU and price." },
  { href: "/admin/products/new/book", label: "Book kit item", icon: BookOpen, steps: "Basic info → Pricing → Content → Review", blurb: "One textbook, notebook or stationery item, mapped from inventory." },
  { href: "/admin/products/new/kit", label: "Book kit", icon: Library, steps: "Sections → Items per section → Price & publish", blurb: "A grade's full set, built section by section from Book kit items." },
  { href: "/admin/products/new/magic_box", label: "Magic box", icon: Gift, steps: "Sub-bundles → Items per sub-bundle → Price & publish", blurb: "A new student's box: uniform set, book kit and other items, priced as one." },
];

export default async function NewProductChooser() {
  const guard = await requireAnyPermission("products.write", "catalog.write");
  if (isResponse(guard)) redirect("/admin/products");

  return (
    <div className="max-w-4xl">
      <PageHeader
        eyebrow="Products"
        breadcrumb={[{ label: "Products", href: "/admin/products" }, { label: "New" }]}
        title="What do you want to create?"
        description="Pick the type first — each has its own short set of steps. Nothing goes on the website until you publish it on the last one."
      />
      <p className="mb-4 -mt-2 text-[12.5px] text-ink-500">
        A kit that comes in language editions (Hindi / Kannada / Telugu siblings) is built with the{" "}
        <Link href="/admin/catalog/build/bookkit" className="font-semibold text-brand-700 hover:text-brand-800">language-variant kit builder</Link>.
      </p>
      <ul className="grid gap-3 sm:grid-cols-2">
        {TYPES.map((t) => (
          <li key={t.href}>
            <Link
              href={t.href}
              className="group flex h-full gap-4 rounded-2xl border border-ink-100/70 bg-white p-5 shadow-[0_1px_2px_rgba(10,10,10,0.03)] transition-[border,box-shadow,transform] hover:-translate-y-px hover:border-ink-200 hover:shadow-[0_6px_18px_rgba(10,10,10,0.06)]"
            >
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700">
                <t.icon className="h-5 w-5" />
              </span>
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 text-[15px] font-semibold text-ink-900">
                  {t.label}
                  <ArrowUpRight className="h-3.5 w-3.5 text-ink-300 transition-colors group-hover:text-brand-600" />
                </span>
                <span className="mt-1 block text-[12.5px] leading-snug text-ink-600">{t.blurb}</span>
                <span className="mt-2 block text-[11px] font-medium uppercase tracking-[0.08em] text-ink-400">{t.steps}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
