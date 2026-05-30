import { asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { testimonials, schools } from "@/db/schema";
import { TestimonialList } from "@/components/admin/TestimonialList";
import { redirect } from "next/navigation";
import { requireAnyPermission, isResponse } from "@/lib/admin-guard";

export default async function TestimonialsPage() {
  const guard = await requireAnyPermission("testimonials.read", "testimonials.write");
  if (isResponse(guard)) redirect("/admin/dashboard");

  const rows = await db
    .select({ t: testimonials, school: schools })
    .from(testimonials)
    .leftJoin(schools, eq(schools.id, testimonials.schoolId))
    .orderBy(asc(testimonials.sortOrder));

  const allSchools = await db.select().from(schools).orderBy(asc(schools.name));

  return (
    <div className="max-w-4xl">
      <h1 className="font-display text-[28px] font-extrabold tracking-tight text-ink-900">
        Testimonials
      </h1>
      <p className="mt-1 text-[14px] text-ink-500">
        These appear on the homepage &ldquo;Schools we serve&rdquo; section.
      </p>
      <div className="mt-6">
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
    </div>
  );
}
