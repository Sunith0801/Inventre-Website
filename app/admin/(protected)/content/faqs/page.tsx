import { asc } from "drizzle-orm";
import { db } from "@/db/client";
import { faqs } from "@/db/schema";
import { FaqList } from "@/components/admin/FaqList";

export default async function AdminFaqsPage() {
  const rows = await db.select().from(faqs).orderBy(asc(faqs.sortOrder));
  return (
    <div className="max-w-3xl">
      <a
        href="/admin/content"
        className="text-[13px] font-medium text-ink-500 hover:text-ink-900"
      >
        ← All content
      </a>
      <h1 className="mt-3 font-display text-[28px] font-extrabold tracking-tight text-ink-900">
        FAQs
      </h1>
      <p className="mt-1 text-[14px] text-ink-500">
        Questions shown on the homepage FAQ section.
      </p>
      <div className="mt-6">
        <FaqList initial={rows} />
      </div>
    </div>
  );
}
