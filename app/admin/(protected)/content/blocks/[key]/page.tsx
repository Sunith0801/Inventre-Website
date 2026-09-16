import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db/client";
import { contentBlocks } from "@/db/schema";
import { HomeContentEditor } from "@/components/admin/HomeContentEditor";
import { PageHeader } from "@/components/admin/ui/primitives";
import { RecordHistory } from "@/components/admin/RecordHistory";

const LABELS: Record<string, string> = {
  "home.sale_strip": "Sale strip",
  "home.hero": "Hero section",
  "home.stats": "Stats numbers",
  "home.in_the_wild": "In the wild (videos)",
  "home.how_it_works": "How it works",
};

export default async function ContentBlockEdit({
  params,
}: {
  params: Promise<{ key: string }>;
}) {
  const { key } = await params;
  const decoded = decodeURIComponent(key);
  const [block] = await db
    .select()
    .from(contentBlocks)
    .where(eq(contentBlocks.key, decoded))
    .limit(1);
  if (!block) notFound();

  return (
    <div className="max-w-3xl">
      <PageHeader
        breadcrumb={[{ label: "Pages & Content Blocks", href: "/admin/content" }, { label: "Homepage blocks", href: "/admin/content/blocks" }, { label: LABELS[decoded] ?? decoded }]}
        title={LABELS[decoded] ?? decoded}
        description={
          <span className="font-mono text-[12px] text-ink-500">{decoded}</span>
        }
      />
      <HomeContentEditor blockKey={decoded} initial={block.data} />

      <div className="mt-5">
        <RecordHistory entityType="content" entityId={decoded} title="Content history" />
      </div>
    </div>
  );
}
