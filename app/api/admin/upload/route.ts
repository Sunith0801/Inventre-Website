import { NextResponse } from "next/server";
import { requirePermission, isResponse } from "@/lib/admin-guard";
import { uploadFile } from "@/lib/storage";

const MAX_IMAGE_BYTES = 50 * 1024 * 1024; // 50 MB — DSLR/RAW-exported JPGs etc.
const MAX_VIDEO_BYTES = 500 * 1024 * 1024; // 500 MB — short 4K marketing clips.

const IMAGE_RE = /^image\/(png|jpe?g|webp|avif|gif|svg\+xml)$/;
const VIDEO_RE = /^video\/(mp4|webm|ogg|quicktime|x-matroska)$/;

export async function POST(req: Request) {
  // Cross-area utility: any user with content.write can upload media.
  // Granular per-area gates happen at the consuming page (e.g. catalog
  // editor calls upload and is itself gated on catalog.write).
  const guard = await requirePermission("content.write");
  if (isResponse(guard)) return guard;

  const form = await req.formData();
  const file = form.get("file");
  const folder = (form.get("folder") as string | null) ?? "uploads";
  if (!file || typeof file === "string")
    return NextResponse.json({ error: "No file uploaded" }, { status: 400 });

  const isImage = IMAGE_RE.test(file.type);
  const isVideo = VIDEO_RE.test(file.type);
  if (!isImage && !isVideo)
    return NextResponse.json(
      { error: `Unsupported file type: ${file.type || "unknown"}` },
      { status: 415 }
    );

  const max = isVideo ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
  if (file.size > max)
    return NextResponse.json(
      { error: `File too large (max ${max / 1024 / 1024}MB)` },
      { status: 413 }
    );

  const buffer = Buffer.from(await file.arrayBuffer());
  try {
    const { url, key } = await uploadFile({
      buffer,
      contentType: file.type,
      filename: file.name,
      folder,
    });
    return NextResponse.json({ url, key });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[admin/upload] failed", {
      name: file.name,
      type: file.type,
      size: file.size,
      folder,
      error: msg,
    });
    return NextResponse.json(
      { error: `Upload failed: ${msg}` },
      { status: 500 }
    );
  }
}
