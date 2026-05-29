import Link from "next/link";
import { ChevronRight, Image as ImageIcon } from "lucide-react";
import { db } from "@/db/client";
import { contentBlocks } from "@/db/schema";
import {
  PageHeader,
  Card,
  EmptyState,
} from "@/components/admin/ui/primitives";

const KNOWN_BLOCKS: { key: string; label: string; description: string }[] = [
  {
    key: "home.sale_strip",
    label: "Sale strip",
    description: "Top marquee — short phrases that scroll across the very top.",
  },
  {
    key: "home.hero",
    label: "Hero section",
    description: "Eyebrow, sub-headline, CTA, and the right-side video card.",
  },
  {
    key: "home.stats",
    label: "Stats numbers",
    description: "The four big numbers (students, schools, renewal rate, returns).",
  },
  {
    key: "home.how_it_works",
    label: "How it works",
    description: "Three numbered steps with icons.",
  },
  {
    key: "home.in_the_wild",
    label: "In the wild (videos)",
    description: "Mosaic of three school videos shown mid-page.",
  },
];

export const dynamic = "force-dynamic";

export default async function ContentBlocksPage() {
  const rows = await db.select().from(contentBlocks);
  const present = new Set(rows.map((r) => r.key));

  return (
    <div className="max-w-3xl">
      <PageHeader
        breadcrumb={[
          { label: "Content", href: "/admin/content" },
          { label: "Homepage blocks" },
        ]}
        title="Homepage blocks"
        description="Edit the content shown on the public homepage. Saves take effect immediately."
      />

      {rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={ImageIcon}
            title="No blocks seeded yet"
            description="Run scripts/seed-home-content.ts to populate defaults, or open a block to edit raw JSON."
          />
        </Card>
      ) : (
        <ul className="space-y-2">
          {KNOWN_BLOCKS.map((b) => (
            <li key={b.key}>
              <Link
                href={`/admin/content/blocks/${encodeURIComponent(b.key)}`}
                className="group flex items-center gap-4 rounded-2xl border border-ink-100 bg-white p-4 hover:border-ink-300 hover:shadow-sm transition-all"
              >
                <div className="flex-1 min-w-0">
                  <p className="font-display text-[15px] font-bold text-ink-900">
                    {b.label}
                  </p>
                  <p className="mt-0.5 text-[12.5px] text-ink-600">
                    {b.description}
                  </p>
                  <p className="mt-1 text-[11px] font-mono text-ink-400">
                    {b.key}
                    {!present.has(b.key) ? (
                      <span className="ml-2 text-amber-600">(not seeded)</span>
                    ) : null}
                  </p>
                </div>
                <ChevronRight className="h-4 w-4 text-ink-300 group-hover:text-ink-700 group-hover:translate-x-0.5 transition-all" />
              </Link>
            </li>
          ))}
          {/* Any extra rows not in KNOWN_BLOCKS — show with raw fallback */}
          {rows
            .filter((r) => !KNOWN_BLOCKS.some((k) => k.key === r.key))
            .map((r) => (
              <li key={r.key}>
                <Link
                  href={`/admin/content/blocks/${encodeURIComponent(r.key)}`}
                  className="group flex items-center gap-4 rounded-2xl border border-ink-100 bg-white p-4 hover:border-ink-300 transition-all"
                >
                  <div className="flex-1">
                    <p className="font-mono text-[12.5px] text-ink-700">{r.key}</p>
                    <p className="text-[11px] text-ink-400">Raw JSON editor</p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-ink-300" />
                </Link>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}
