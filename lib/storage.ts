import "server-only";
import { S3Client, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import crypto from "crypto";

declare global {
  // eslint-disable-next-line no-var
  var __s3__: S3Client | undefined;
}

function getS3(): S3Client {
  if (globalThis.__s3__) return globalThis.__s3__;
  const endpoint = process.env.S3_ENDPOINT;
  const accessKeyId = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
  const region = process.env.S3_REGION ?? "us-east-1";
  if (!endpoint || !accessKeyId || !secretAccessKey)
    throw new Error("S3_ENDPOINT / S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY are required");

  const client = new S3Client({
    endpoint,
    region,
    credentials: { accessKeyId, secretAccessKey },
    // path-style works for both MinIO and Cloudflare R2
    forcePathStyle: true,
  });
  if (process.env.NODE_ENV !== "production") globalThis.__s3__ = client;
  return client;
}

export async function uploadFile(args: {
  buffer: Buffer;
  contentType: string;
  filename?: string;
  folder?: string; // e.g. 'products', 'schools'
}): Promise<{ url: string; key: string }> {
  const bucket = process.env.S3_BUCKET ?? "inventre";
  const ext = (args.filename?.split(".").pop() ?? "bin").toLowerCase();
  const id = crypto.randomBytes(8).toString("hex");
  const key = `${args.folder ?? "uploads"}/${Date.now()}-${id}.${ext}`;
  await getS3().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: args.buffer,
      ContentType: args.contentType,
      // Far-future cache so Cloudflare/edge keeps these warm indefinitely.
      CacheControl: "public, max-age=31536000, immutable",
    })
  );
  const publicBase = process.env.S3_PUBLIC_URL ?? `${process.env.S3_ENDPOINT}/${bucket}`;
  return { url: `${publicBase}/${key}`, key };
}

/**
 * Upload at a caller-chosen key. Used by the ERP image rehoster so the
 * key is a deterministic sha1-based name and re-runs are idempotent
 * (overwriting the same bytes is a no-op).
 */
export async function uploadAtKey(args: {
  buffer: Buffer;
  contentType: string;
  key: string;
}): Promise<{ url: string; key: string }> {
  const bucket = process.env.S3_BUCKET ?? "inventre";
  await getS3().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: args.key,
      Body: args.buffer,
      ContentType: args.contentType,
      CacheControl: "public, max-age=31536000, immutable",
    })
  );
  const publicBase = process.env.S3_PUBLIC_URL ?? `${process.env.S3_ENDPOINT}/${bucket}`;
  return { url: `${publicBase}/${args.key}`, key: args.key };
}

/**
 * Returns true if an object exists at the given key in the bucket.
 * Used by the rehoster to skip downloads when the bytes are already
 * sitting in MinIO from a previous run.
 */
export async function objectExists(key: string): Promise<boolean> {
  const bucket = process.env.S3_BUCKET ?? "inventre";
  try {
    await getS3().send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch (e) {
    const status = (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status === 404) return false;
    // 403 / network errors — surface so caller can decide
    throw e;
  }
}

/**
 * Construct the public URL for a key without uploading. Used to compute
 * "where this file lives if it's already there" before hitting MinIO.
 */
export function publicUrlForKey(key: string): string {
  const bucket = process.env.S3_BUCKET ?? "inventre";
  const publicBase = process.env.S3_PUBLIC_URL ?? `${process.env.S3_ENDPOINT}/${bucket}`;
  return `${publicBase}/${key}`;
}
