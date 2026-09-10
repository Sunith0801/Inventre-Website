import { Image as ImageIcon } from "lucide-react";
import { getAllMediaUrls } from "@/server/repos/media";
import { MediaSlotsGallery } from "@/components/admin/MediaSlotsGallery";

export const dynamic = "force-dynamic";

export default async function MediaGalleryPage() {
  const slots = await getAllMediaUrls();
  return (
    <div>
      <nav className="mb-2 text-[12px] text-ink-500">
        <a href="/admin/content" className="hover:text-ink-900">Content</a>
        <span className="mx-1.5">/</span>
        <span>Marketing media</span>
      </nav>
      <h1 className="font-display text-[28px] font-extrabold tracking-tight text-ink-900 flex items-center gap-2">
        <ImageIcon className="h-6 w-6 text-brand" />
        Marketing media
      </h1>
      <p className="mt-1 text-[14px] text-ink-500 max-w-2xl">
        Every image and video shown on the public marketing pages. Click any
        card to replace, reset to the original, or open the full-size file.
        Changes are live within seconds.
      </p>

      <MediaSlotsGallery initial={slots} />
    </div>
  );
}
