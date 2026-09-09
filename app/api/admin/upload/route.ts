import { NextResponse } from "next/server";
import { requireAnyWritePermission, isResponse } from "@/lib/admin-guard";
import { uploadFile } from "@/lib/storage";

const MAX_IMAGE_BYTES = 50 * 1024 * 1024; // 50 MB — DSLR/RAW-exported JPGs etc.
const MAX_VIDEO_BYTES = 500 * 1024 * 1024; // 500 MB — short 4K marketing clips.

const IMAGE_RE = /^image\/(png|jpe?g|webp|avif|gif|svg\+xml)$/;
const VIDEO_RE = /^video\/(mp4|webm|ogg|quicktime|x-matroska)$/;

export async function POST(req: Request) {
  // Cross-area utility: any admin with SOME write permission can push bytes
  // to storage. The real per-area authorization happens at the endpoint that
  // consumes the returned URL — the catalog image route requires catalog.write,
  // the content block route requires content.write, etc. Gating this on a
  // single slug (was content.write) wrongly 403'd catalog editors who upload
  // product images but hold no Content permission.
  const guard = await requireAnyWritePermission();
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
