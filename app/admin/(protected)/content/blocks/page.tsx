import Link from "next/link";
import { Layers } from "lucide-react";
import { db } from "@/db/client";
import { contentBlocks } from "@/db/schema";
import {
  PageHeader,
  Card,
  EmptyState,
  Th,
  Td,
  Tr,
  Badge,
} from "@/components/admin/ui/primitives";

const KNOWN_BLOCKS: { key: string; label: string; description: string }[] = [
  { key: "home.sale_strip", label: "Sale strip", description: "Short phrases that scroll across the very top of the home page." },
  { key: "home.hero", label: "Hero section", description: "Eyebrow, sub-headline, call to action and the video card." },
  { key: "home.stats", label: "Stats numbers", description: "The four big numbers — students, schools, renewal rate, returns." },
  { key: "home.how_it_works", label: "How it works", description: "Three numbered steps with icons." },
  { key: "home.in_the_wild", label: "In the wild", description: "Mosaic of three school videos shown mid-page." },
];

export const dynamic = "force-dynamic";

const IST = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" });

/**
 * The editable sections of the storefront home page, one row each.
 * `media.*` rows also live in content_blocks but are the marketing-media
 * slots — they have their own page, so they are not listed here.
 */
export default async function ContentBlocksPage() {
  const rows = await db.select().from(contentBlocks);
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const extras = rows.filter((r) => !KNOWN_BLOCKS.some((k) => k.key === r.key) && !r.key.startsWith("media."));

  return (
    <div>
      <PageHeader
        eyebrow="Engagement & Content"
        breadcrumb={[{ label: "Pages & Content Blocks", href: "/admin/content" }, { label: "Homepage blocks" }]}
        title="Homepage blocks"
        description="The sections of the storefront home page, top to bottom. Open one to edit its text."
      />

      {rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={Layers}
            title="No blocks seeded yet"
            description="Run scripts/seed-home-content.ts to populate the defaults."
          />
        </Card>
      ) : (
        <Card padded={false} className="overflow-hidden">
          <table className="w-full">
            <thead>
              <tr>
                <Th>Section</Th>
                <Th>What it holds</Th>
                <Th>Last edited</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {KNOWN_BLOCKS.map((b) => {
                const row = byKey.get(b.key);
                return (
                  <Tr key={b.key}>
                    <Td>
                      <Link href={`/admin/content/blocks/${encodeURIComponent(b.key)}`} className="group/name block">
                        <span className="block font-semibold text-ink-900 group-hover/name:text-brand-700">{b.label}</span>
                        <span className="block font-mono text-[11.5px] font-normal text-ink-500">{b.key}</span>
                      </Link>
                    </Td>
                    <Td muted>{b.description}</Td>
                    <Td muted className="whitespace-nowrap">{row?.updatedAt ? IST.format(new Date(row.updatedAt)) : "—"}</Td>
                    <Td>
                      {row ? <Badge tone="success" dot size="sm">Live</Badge> : <Badge tone="warning" dot size="sm">Not seeded</Badge>}
                    </Td>
                  </Tr>
                );
              })}
              {extras.map((r) => (
                <Tr key={r.key}>
                  <Td>
                    <Link href={`/admin/content/blocks/${encodeURIComponent(r.key)}`} className="font-mono text-ink-800 hover:text-brand-700">{r.key}</Link>
                  </Td>
                  <Td muted>Custom block (raw JSON)</Td>
                  <Td muted className="whitespace-nowrap">{r.updatedAt ? IST.format(new Date(r.updatedAt)) : "—"}</Td>
                  <Td><Badge tone="default" dot size="sm">Custom</Badge></Td>
                </Tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
