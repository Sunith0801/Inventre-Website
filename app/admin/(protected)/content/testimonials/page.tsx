import { asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { testimonials, schools } from "@/db/schema";
import { TestimonialList } from "@/components/admin/TestimonialList";
import { PageHeader } from "@/components/admin/ui/primitives";

/**
 * Testimonials live inside Pages & Content Blocks: they are homepage copy
 * like the hero and the FAQs, so they share the `content` permission and
 * the content hub rather than being a module of their own. The section
 * layout above already gates on `content`.
 */
export const dynamic = "force-dynamic";

export default async function TestimonialsPage() {
  const rows = await db
    .select({ t: testimonials, school: schools })
    .from(testimonials)
    .leftJoin(schools, eq(schools.id, testimonials.schoolId))
    .orderBy(asc(testimonials.sortOrder));

  const allSchools = await db.select().from(schools).orderBy(asc(schools.name));

  return (
    <div className="max-w-4xl">
      <PageHeader
        eyebrow="Engagement & Content"
        title="Testimonials"
        description={`${rows.length} principal quote${rows.length === 1 ? "" : "s"} for the home page, in display order.`}
        breadcrumb={[{ label: "Pages & Content Blocks", href: "/admin/content" }, { label: "Testimonials" }]}
      />
      <TestimonialList
          initial={rows.map(({ t, school }) => ({
            id: t.id,
            principalName: t.principalName,
            role: t.role,
            shortLabel: t.shortLabel,
            quote: t.quote,
            photoUrl: t.photoUrl,
            isFeatured: t.isFeatured,
            sortOrder: t.sortOrder,
            schoolId: t.schoolId,
            schoolName: school?.name ?? null,
          }))}
          schools={allSchools.map((s) => ({ id: s.id, name: s.name }))}
        />
    </div>
  );
}
