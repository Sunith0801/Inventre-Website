import { HelpCircle, Megaphone, Layers, Image as ImageIcon } from "lucide-react";
import { redirect } from "next/navigation";
import { requireAnyPermission, isResponse } from "@/server/admin-guard";
import { PageHeader } from "@/components/admin/ui/primitives";
import { ModuleCards } from "@/components/admin/ModuleCards";

const sections = [
  { label: "Marketing media", href: "/admin/content/media", icon: ImageIcon },
  { label: "Homepage blocks", href: "/admin/content/blocks", icon: Layers },
  { label: "FAQs", href: "/admin/content/faqs", icon: HelpCircle },
  { label: "Testimonials", href: "/admin/content/testimonials", icon: Megaphone },
];

export default async function ContentIndex() {
  const guard = await requireAnyPermission("content.read", "content.write");
  if (isResponse(guard)) redirect("/admin/dashboard");

  return (
    <div>
      <PageHeader eyebrow="Engagement & Content" title="Pages & Content Blocks" description="Everything on the website that is words, pictures or video rather than products." />
      <ModuleCards items={sections} />
    </div>
  );
}
