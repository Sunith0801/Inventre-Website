import { asc } from "drizzle-orm";
import { db } from "@/db/client";
import { faqs } from "@/db/schema";
import { FaqList } from "@/components/admin/FaqList";
import { PageHeader } from "@/components/admin/ui/primitives";

export default async function AdminFaqsPage() {
  const rows = await db.select().from(faqs).orderBy(asc(faqs.sortOrder));
  return (
    <div className="max-w-4xl">
      <PageHeader
        eyebrow="Engagement & Content"
        title="FAQs"
        description={`${rows.length} question${rows.length === 1 ? "" : "s"} on the website's FAQ section, in display order.`}
        breadcrumb={[{ label: "Pages & Content Blocks", href: "/admin/content" }, { label: "FAQs" }]}
      />
      <FaqList initial={rows} />
    </div>
  );
}
