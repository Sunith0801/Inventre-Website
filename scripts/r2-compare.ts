/**
 * Compares every local file in public.r2-backup/ to its counterpart in R2.
 * Checks both the legacy key (images/foo.png) and the new v2 key (v2/images/foo.png).
 *
 * Reports any file where:
 *   - the size differs from local, OR
 *   - the object is missing from R2.
 *
 * Usage:
 *   set -a; . .env.deploy; set +a; npx tsx scripts/r2-compare.ts
 */
import "dotenv/config";
import * as fs from "node:fs";
import * as path from "node:path";
import { S3Client, HeadObjectCommand } from "@aws-sdk/client-s3";

const ROOT = path.resolve(process.cwd(), "public.r2-backup");

function getClient() {
  return new S3Client({
    endpoint: process.env.S3_ENDPOINT!,
    region: process.env.S3_REGION ?? "auto",
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID!,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
    },
    forcePathStyle: true,
  });
}

function* walk(dir: string): Generator<string> {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.isFile()) yield p;
  }
}

async function headSize(client: S3Client, bucket: string, key: string): Promise<number | null> {
  try {
    const r = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return r.ContentLength ?? null;
  } catch (e) {
    const status = (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status === 404) return null;
    throw e;
  }
}

type Row = {
  rel: string;
  localSize: number;
  legacyKey: string;
  legacySize: number | null;
  v2Key: string;
  v2Size: number | null;
};

async function main() {
  const bucket = process.env.S3_BUCKET!;
  const client = getClient();

  const groups: Array<{ src: string; legacyPrefix: string; v2Prefix: string }> = [
    { src: path.join(ROOT, "images"), legacyPrefix: "images", v2Prefix: "v2/images" },
    { src: path.join(ROOT, "erp-media"), legacyPrefix: "erp-media", v2Prefix: "v2/erp-media" },
  ];

  const jobs: Array<{ localPath: string; legacyKey: string; v2Key: string }> = [];
  for (const g of groups) {
    if (!fs.existsSync(g.src)) continue;
    for (const f of walk(g.src)) {
      const rel = path.relative(g.src, f).split(path.sep).join("/");
      jobs.push({
        localPath: f,
        legacyKey: `${g.legacyPrefix}/${rel}`,
        v2Key: `${g.v2Prefix}/${rel}`,
      });
    }
  }
  const rootSingle = path.join(ROOT, "contact-parent.png");
  if (fs.existsSync(rootSingle)) {
    jobs.push({ localPath: rootSingle, legacyKey: "contact-parent.png", v2Key: "v2/contact-parent.png" });
  }

  console.log(`Comparing ${jobs.length} local files vs R2 bucket ${bucket}...\n`);

  const rows: Row[] = [];
  const CONCURRENCY = 16;
  let idx = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (idx < jobs.length) {
        const j = jobs[idx++];
        const localSize = fs.statSync(j.localPath).size;
        const [legacySize, v2Size] = await Promise.all([
          headSize(client, bucket, j.legacyKey),
          headSize(client, bucket, j.v2Key),
        ]);
        rows.push({ rel: j.legacyKey, localSize, legacyKey: j.legacyKey, legacySize, v2Key: j.v2Key, v2Size });
      }
    }),
  );

  rows.sort((a, b) => a.rel.localeCompare(b.rel));

  const legacyMismatch = rows.filter((r) => r.legacySize !== r.localSize);
  const legacyMissing = rows.filter((r) => r.legacySize === null);
  const v2Mismatch = rows.filter((r) => r.v2Size !== r.localSize);
  const v2Missing = rows.filter((r) => r.v2Size === null);

  console.log(`=== Legacy keys (images/* and erp-media/*) ===`);
  console.log(`  total checked: ${rows.length}`);
  console.log(`  missing:       ${legacyMissing.length}`);
  console.log(`  size mismatch: ${legacyMismatch.length}`);
  if (legacyMismatch.length) {
    console.log(`\n  Files where legacy R2 size != local:`);
    for (const r of legacyMismatch) {
      const remote = r.legacySize === null ? "MISSING" : `${r.legacySize}`;
      console.log(`    ${r.rel}    local=${r.localSize}  remote=${remote}`);
    }
  }

  console.log(`\n=== v2 keys (v2/images/* and v2/erp-media/*) ===`);
  console.log(`  total checked: ${rows.length}`);
  console.log(`  missing:       ${v2Missing.length}`);
  console.log(`  size mismatch: ${v2Mismatch.length}`);
  if (v2Mismatch.length) {
    console.log(`\n  Files where v2 R2 size != local:`);
    for (const r of v2Mismatch) {
      const remote = r.v2Size === null ? "MISSING" : `${r.v2Size}`;
      console.log(`    ${r.v2Key}    local=${r.localSize}  remote=${remote}`);
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`  Local files:                  ${rows.length}`);
  console.log(`  Legacy R2 byte-identical:     ${rows.length - legacyMismatch.length}`);
  console.log(`  Legacy R2 degraded/missing:   ${legacyMismatch.length}`);
  console.log(`  v2 R2 byte-identical:         ${rows.length - v2Mismatch.length}`);
  console.log(`  v2 R2 degraded/missing:       ${v2Mismatch.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
