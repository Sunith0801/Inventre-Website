import Link from "next/link";
import { redirect } from "next/navigation";
import { Book, Shirt, Sparkles, ShoppingBag, Box } from "lucide-react";
import { requireAnyPermission, isResponse } from "@/server/admin-guard";
import { PageHeader } from "@/components/admin/ui/primitives";

export const dynamic = "force-dynamic";

type Tile = {
  href: string | null;
  label: string;
  blurb: string;
  icon: React.ComponentType<{ className?: string }>;
};

const TILES: Tile[] = [
  {
    href: "/admin/catalog/build/bookkit",
    label: "Bookkit",
    blurb: "Books + sub-bundles, optional 2nd/3rd language axes",
    icon: Book,
  },
  {
    href: "/admin/catalog/build/uniform",
    label: "Uniform",
    blurb: "With size and colour axes",
    icon: Shirt,
  },
  {
    href: null, // wired in #17
    label: "Magic Box",
    blurb: "Bundle of existing kit + uniforms",
    icon: Sparkles,
  },
  {
    href: null, // wired in #18
    label: "Accessory",
    blurb: "Bag, Bottle, Belt, Cap…",
    icon: ShoppingBag,
  },
  {
    href: null, // wired in #18
    label: "Other catalog item",
    blurb: "Anything else at a school + grade",
    icon: Box,
  },
];

export default async function CatalogBuildEntry() {
  const guard = await requireAnyPermission("catalog.read", "catalog.write");
  if (isResponse(guard)) redirect("/admin/dashboard");

  return (
    <div>
      <PageHeader
        eyebrow="Catalog"
        title="Create new item"
        description="Guided wizard — pick the type below. Each flow writes only NEW rows; existing items and links are never touched."
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {TILES.map((t) => {
          const disabled = t.href === null;
          const inner = (
            <div
              className={
                "rounded-2xl border bg-white p-5 h-full transition-all " +
                (disabled
                  ? "border-ink-100 opacity-60 cursor-not-allowed"
                  : "border-ink-200 hover:border-ink-900 hover:shadow-sm cursor-pointer")
              }
            >
              <div className="flex items-start gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-xl bg-cream-100 border border-ink-100 shrink-0">
                  <t.icon className="h-5 w-5 text-ink-700" />
                </div>
                <div className="min-w-0">
                  <p className="font-display text-[16px] font-bold text-ink-900">
                    {t.label}
                    {disabled && (
                      <span className="ml-2 text-[10px] font-medium uppercase tracking-wider text-ink-400">
                        coming next
                      </span>
                    )}
                  </p>
                  <p className="mt-1 text-[13px] text-ink-500 leading-snug">
                    {t.blurb}
                  </p>
                </div>
              </div>
            </div>
          );
          return disabled ? (
            <div key={t.label}>{inner}</div>
          ) : (
            <Link key={t.label} href={t.href!}>
              {inner}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
