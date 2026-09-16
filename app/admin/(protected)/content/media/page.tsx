import { getAllMediaUrls } from "@/server/repos/media";
import { MediaSlotsGallery } from "@/components/admin/MediaSlotsGallery";
import { PageHeader } from "@/components/admin/ui/primitives";

export const dynamic = "force-dynamic";

export default async function MediaGalleryPage() {
  const slots = await getAllMediaUrls();
  return (
    <div>
      <PageHeader
        eyebrow="Engagement & Content"
        title="Marketing media"
        description={`${slots.length} image and video slots across the website. Drop a file on a card to replace it.`}
        breadcrumb={[{ label: "Pages & Content Blocks", href: "/admin/content" }, { label: "Marketing media" }]}
      />

      <MediaSlotsGallery initial={slots} />
    </div>
  );
}
