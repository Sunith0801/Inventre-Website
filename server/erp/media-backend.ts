/**
 * Storage backend for ERP product images.
 *
 *   ERP_MEDIA_BACKEND=local  (default) → write to a folder on the host
 *   ERP_MEDIA_BACKEND=s3              → write to MinIO / S3
 *
 * Why two backends:
 *   - Local folder: easy to see, easy to back up (just zip the dir),
 *     survives `docker compose down -v` which would otherwise wipe
 *     the MinIO volume. Default for now per product-owner ask
 *     (2026-05-17).
 *   - S3 / MinIO: matches the production target. Switch by flipping
 *     ERP_MEDIA_BACKEND=s3 in env; the rest of the rehoster code is
 *     unchanged.
 *
 * In both backends we use the same caller-chosen key (e.g.
 * `erp-media/<sha1>.<ext>`) so the public URL shape and the upserter's
 * idempotency story are identical.
 */
import "server-only";
import fs from "fs/promises";
import path from "path";
import { uploadAtKey as s3UploadAtKey, objectExists as s3ObjectExists, publicUrlForKey as s3PublicUrlForKey } from "@/server/storage";

export type MediaBackendKind = "local" | "s3";

export function currentBackend(): MediaBackendKind {
  return process.env.ERP_MEDIA_BACKEND === "s3" ? "s3" : "local";
}

/** Where local-backend files land. Path is relative to the Next.js cwd. */
const LOCAL_DIR = process.env.ERP_MEDIA_LOCAL_DIR ?? "public/erp-media";
/** Public URL prefix when served by Next from the `public/` folder. */
const LOCAL_URL_PREFIX = process.env.ERP_MEDIA_LOCAL_URL ?? "/erp-media";

function localPathFor(key: string): string {
  // `key` is "erp-media/<sha1>.<ext>"; strip the prefix because LOCAL_DIR
  // already represents that folder.
  const trimmed = key.replace(/^erp-media\//, "");
  return path.join(LOCAL_DIR, trimmed);
}

function localUrlFor(key: string): string {
  const trimmed = key.replace(/^erp-media\//, "");
  return `${LOCAL_URL_PREFIX}/${trimmed}`;
}

export async function mediaKeyExists(key: string): Promise<boolean> {
  if (currentBackend() === "s3") return s3ObjectExists(key);
  try {
    await fs.access(localPathFor(key));
    return true;
  } catch {
    return false;
  }
}

export async function mediaUploadAtKey(args: {
  buffer: Buffer;
  contentType: string;
  key: string;
}): Promise<{ url: string; key: string }> {
  if (currentBackend() === "s3") return s3UploadAtKey(args);
  const filePath = localPathFor(args.key);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, args.buffer);
  return { url: localUrlFor(args.key), key: args.key };
}

export function mediaPublicUrl(key: string): string {
  if (currentBackend() === "s3") return s3PublicUrlForKey(key);
  return localUrlFor(key);
}

/**
 * For the rehoster's "is this URL already pointing at our own storage?"
 * fast-path — works for both backends.
 */
export function isAlreadyLocal(url: string): boolean {
  if (currentBackend() === "s3") {
    const base = process.env.S3_PUBLIC_URL;
    return !!base && url.startsWith(base);
  }
  // local: relative URL like "https://pub-d46aef8f98ef4da0a1834fb6f554ae2c.r2.dev/erp-media/..." OR fully-qualified with our host
  if (url.startsWith(LOCAL_URL_PREFIX + "/")) return true;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (appUrl && url.startsWith(`${appUrl}${LOCAL_URL_PREFIX}/`)) return true;
  return false;
}
