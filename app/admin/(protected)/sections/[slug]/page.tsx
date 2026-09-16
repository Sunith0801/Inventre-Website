import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/server/session";
import { navSections, visibleItems } from "@/lib/admin-nav";
import { PageHeader } from "@/components/admin/ui/primitives";
import { ModuleCards } from "@/components/admin/ModuleCards";

/**
 * Section landing page — the second level of the sidebar. Lists the modules
 * of one section the current admin may open. Pure navigation: no data.
 */
export default async function SectionPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const section = navSections.find((s) => s.slug === slug);
  if (!section) notFound();

  const me = await getCurrentUser();
  if (!me || me.kind !== "admin") redirect("/admin/login");

  const items = visibleItems(me.permissions, section);
  if (items.length === 0) redirect("/admin/dashboard");
  if (items.length === 1) redirect(items[0]!.href);

  return (
    <div>
      <PageHeader eyebrow="Modules" title={section.kicker} description={section.description} />
      <ModuleCards items={items} />
    </div>
  );
}
