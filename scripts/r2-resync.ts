/**
 * Re-uploads local media originals to Cloudflare R2 under versioned keys.
 *
 * Why versioned (/v2/...): permanent 301 redirects + immutable Cache-Control
 * mean browsers and edge caches will keep serving any previously-cached
 * lower-quality copy at the old key essentially forever. Writing to a new
 * key path forces a cold fetch and guarantees users see the fresh bytes.
 *
 * Usage:
 *   DOTENV=.env.deploy npx tsx scripts/r2-resync.ts            # dry-run
 *   DOTENV=.env.deploy npx tsx scripts/r2-resync.ts --apply    # actually upload
 *   DOTENV=.env.deploy npx tsx scripts/r2-resync.ts --apply --only=images
 *
 * Source: ./public.r2-backup/{images,erp-media,contact-parent.png}
 * Dest:   s3://$S3_BUCKET/v2/images/...   and  v2/erp-media/...
 */
import "dotenv/config";
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { S3Client, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";

const ROOT = path.resolve(process.cwd(), "public.r2-backup");
const APPLY = process.argv.includes("--apply");
const ONLY = process.argv.find((a) => a.startsWith("--only="))?.split("=")[1];

const CONTENT_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
};

function getClient() {
  const endpoint = process.env.S3_ENDPOINT;
  const accessKeyId = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error("Missing S3_ENDPOINT / S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY. Did you load the right .env?");
  }
  return new S3Client({
    endpoint,
    region: process.env.S3_REGION ?? "auto",
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
  });
}

function* walk(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(p);
    else if (entry.isFile()) yield p;
  }
}

type Job = { localPath: string; key: string; size: number };

function collectJobs(): Job[] {
  const jobs: Job[] = [];
  const groups: Array<{ name: string; src: string; keyPrefix: string }> = [
    { name: "images", src: path.join(ROOT, "images"), keyPrefix: "v2/images" },
    { name: "erp-media", src: path.join(ROOT, "erp-media"), keyPrefix: "v2/erp-media" },
  ];
  for (const g of groups) {
    if (ONLY && ONLY !== g.name) continue;
    if (!fs.existsSync(g.src)) {
      console.warn(`  (skip) source not found: ${g.src}`);
      continue;
    }
    for (const file of walk(g.src)) {
      const rel = path.relative(g.src, file);
      jobs.push({ localPath: file, key: `${g.keyPrefix}/${rel}`, size: fs.statSync(file).size });
    }
  }
  const rootSingle = path.join(ROOT, "contact-parent.png");
  if ((!ONLY || ONLY === "images") && fs.existsSync(rootSingle)) {
    jobs.push({ localPath: rootSingle, key: "v2/contact-parent.png", size: fs.statSync(rootSingle).size });
  }
  return jobs;
}

async function alreadyUploadedIdentical(
  client: S3Client,
  bucket: string,
  key: string,
  buf: Buffer,
): Promise<boolean> {
  try {
    const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    if (head.ContentLength !== buf.length) return false;
    const localMd5 = crypto.createHash("md5").update(buf).digest("hex");
    const remoteEtag = (head.ETag ?? "").replaceAll('"', "");
    // R2/S3 returns md5 as ETag for single-part puts; multipart uploads use a different format.
    return remoteEtag === localMd5;
  } catch (e) {
    const status = (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status === 404) return false;
    throw e;
  }
}

async function main() {
  const bucket = process.env.S3_BUCKET;
  if (!bucket) throw new Error("S3_BUCKET not set");
  const client = getClient();
  const jobs = collectJobs();

  const totalBytes = jobs.reduce((a, j) => a + j.size, 0);
  console.log(`Found ${jobs.length} files, ${(totalBytes / 1024 / 1024).toFixed(1)} MB total.`);
  console.log(`Bucket: ${bucket}    Endpoint: ${process.env.S3_ENDPOINT}`);
  console.log(`Mode:   ${APPLY ? "APPLY (will upload)" : "DRY RUN (no writes)"}\n`);

  let uploaded = 0;
  let skipped = 0;
  let failed = 0;
  let bytesUploaded = 0;

  for (const job of jobs) {
    const ext = path.extname(job.localPath).toLowerCase();
    const ct = CONTENT_TYPES[ext] ?? "application/octet-stream";
    const sizeKB = (job.size / 1024).toFixed(0);
    const tag = `${job.key}  (${sizeKB} KB, ${ct})`;

    if (!APPLY) {
      console.log(`  [dry] ${tag}`);
      continue;
    }

    try {
      const buf = fs.readFileSync(job.localPath);
      if (await alreadyUploadedIdentical(client, bucket, job.key, buf)) {
        console.log(`  [skip] ${tag}`);
        skipped++;
        continue;
      }
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: job.key,
          Body: buf,
          ContentType: ct,
          CacheControl: "public, max-age=31536000, immutable",
        }),
      );
      console.log(`  [ok]   ${tag}`);
      uploaded++;
      bytesUploaded += job.size;
    } catch (e) {
      console.error(`  [FAIL] ${tag}: ${(e as Error).message}`);
      failed++;
    }
  }

  console.log(`\nDone. uploaded=${uploaded}  skipped=${skipped}  failed=${failed}  bytes=${(bytesUploaded / 1024 / 1024).toFixed(1)} MB`);
  if (!APPLY) console.log(`Re-run with --apply to perform uploads.`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
