/**
 * Re-host a remote image into our own MinIO bucket so the storefront
 * doesn't depend on the upstream host (e.g. audit.inventre.online)
 * staying alive.
 *
 * Key scheme: `erp-media/<sha1-of-url>.<ext>` — deterministic, so:
 *   - Re-runs are no-ops once the file is in MinIO (we HEAD first).
 *   - Two products referencing the same upstream URL share one stored copy.
 *
 * On failure (404, network drop, S3 down) we return the original URL
 * unchanged so the row stays usable — the next mirror run will retry.
 */

import "server-only";
import crypto from "crypto";
import {
  isAlreadyLocal as backendIsAlreadyLocal,
  mediaKeyExists,
  mediaPublicUrl,
  mediaUploadAtKey,
} from "@/lib/erp/media-backend";

const ERP_MEDIA_PREFIX = "erp-media/";

function sha1(input: string): string {
  return crypto.createHash("sha1").update(input).digest("hex");
}

function extFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const last = u.pathname.split("/").pop() ?? "";
    const ext = last.includes(".") ? last.split(".").pop()! : "bin";
    // sanitise — strip query, lowercase, cap length
    return ext.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 6) || "bin";
  } catch {
    return "bin";
  }
}

function contentTypeFromExt(ext: string): string {
  switch (ext) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    case "svg":
      return "image/svg+xml";
    case "avif":
      return "image/avif";
    default:
      return "application/octet-stream";
  }
}

export type RehostOutcome =
  | { status: "mirrored"; localUrl: string; bytes: number }
  | { status: "already_mirrored"; localUrl: string }
  | { status: "skipped_local"; localUrl: string }
  | { status: "failed"; originalUrl: string; reason: string };

export async function rehostRemoteImage(url: string): Promise<RehostOutcome> {
  if (backendIsAlreadyLocal(url)) {
    return { status: "skipped_local", localUrl: url };
  }

  const ext = extFromUrl(url);
  const key = `${ERP_MEDIA_PREFIX}${sha1(url)}.${ext}`;

  // Fast path: file is already in our storage from a previous run.
  if (await mediaKeyExists(key)) {
    return { status: "already_mirrored", localUrl: mediaPublicUrl(key) };
  }

  // Download upstream → write into our storage (local FS or S3).
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      return {
        status: "failed",
        originalUrl: url,
        reason: `upstream ${res.status}`,
      };
    }
    const ab = await res.arrayBuffer();
    const buffer = Buffer.from(ab);
    const contentType = res.headers.get("content-type") ?? contentTypeFromExt(ext);
    const { url: localUrl } = await mediaUploadAtKey({ buffer, contentType, key });
    return { status: "mirrored", localUrl, bytes: buffer.byteLength };
  } catch (e) {
    return {
      status: "failed",
      originalUrl: url,
      reason: e instanceof Error ? e.message : String(e),
    };
  }
}
