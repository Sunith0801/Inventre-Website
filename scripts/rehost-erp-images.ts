/**
 * One-shot job: move every product_images.url that points at erp.inventre.in
 * (or any other remote upstream) into our own R2 bucket, then rewrite the
 * row to the R2 URL. This eliminates the storefront's runtime dependency
 * on the upstream ERP host and avoids URL-encoding gotchas (raw spaces /
 * parens) that some browsers refuse to fetch.
 *
 * Idempotent:
 *   - Key is sha1(originalUrl) — same upstream → same R2 object.
 *   - HEAD-checks before downloading.
 *   - Already-local rows are skipped.
 *
 * Why we use docker-exec psql for DB access:
 *   The deploy host's .env.deploy doesn't carry DATABASE_URL (the app
 *   container has it). Rather than read secrets, we shell out to
 *   `docker exec inventre-deploy-postgres psql` which uses local socket
 *   auth and needs no password.
 *
 * Usage:
 *   set -a; . .env.deploy; set +a
 *   npx tsx scripts/rehost-erp-images.ts                # dry run
 *   npx tsx scripts/rehost-erp-images.ts --apply
 *   npx tsx scripts/rehost-erp-images.ts --apply --concurrency=8 --limit=50
 */
import "dotenv/config";
import * as crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { S3Client, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";

const APPLY = process.argv.includes("--apply");
const CONCURRENCY = Math.max(
  1,
  Math.min(20, Number(process.argv.find((a) => a.startsWith("--concurrency="))?.split("=")[1] ?? 6)),
);
const LIMIT = Number(process.argv.find((a) => a.startsWith("--limit="))?.split("=")[1] ?? 0);

const PG_CONTAINER = process.env.PG_CONTAINER ?? "inventre-deploy-postgres";
const PG_USER = process.env.PG_USER ?? "inventre";
const PG_DB = process.env.PG_DB ?? "inventre";

function envOrThrow(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} not set`);
  return v;
}

const S3_BUCKET = envOrThrow("S3_BUCKET");
const S3_PUBLIC_URL = envOrThrow("S3_PUBLIC_URL").replace(/\/+$/, "");

const s3 = new S3Client({
  endpoint: envOrThrow("S3_ENDPOINT"),
  region: process.env.S3_REGION ?? "auto",
  credentials: {
    accessKeyId: envOrThrow("S3_ACCESS_KEY_ID"),
    secretAccessKey: envOrThrow("S3_SECRET_ACCESS_KEY"),
  },
  forcePathStyle: true,
});

const ERP_MEDIA_PREFIX = "erp-media/";

function sha1(s: string): string {
  return crypto.createHash("sha1").update(s).digest("hex");
}

function extFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const last = u.pathname.split("/").pop() ?? "";
    const e = last.includes(".") ? last.split(".").pop()! : "bin";
    return e.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 6) || "bin";
  } catch {
    return "bin";
  }
}

function ctFromExt(ext: string): string {
  return (
    { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", svg: "image/svg+xml", avif: "image/avif" }[ext] ??
    "application/octet-stream"
  );
}

function safeFetchUrl(raw: string): string {
  const u = new URL(raw);
  u.pathname = u.pathname
    .split("/")
    .map((seg) => {
      try {
        return encodeURIComponent(decodeURIComponent(seg));
      } catch {
        return encodeURIComponent(seg);
      }
    })
    .join("/");
  return u.toString();
}

function psql(sqlText: string): string {
  return execFileSync(
    "docker",
    ["exec", "-i", PG_CONTAINER, "psql", "-U", PG_USER, "-d", PG_DB, "-t", "-A", "-F", "\t", "-c", sqlText],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
}

async function objectExists(key: string): Promise<boolean> {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: S3_BUCKET, Key: key }));
    return true;
  } catch (e) {
    const status = (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status === 404) return false;
    throw e;
  }
}

type Row = { id: string; url: string };
type Outcome =
  | { kind: "mirrored"; localUrl: string; bytes: number; key: string }
  | { kind: "already_mirrored"; localUrl: string }
  | { kind: "already_local"; localUrl: string }
  | { kind: "failed"; reason: string };

const updates: { id: string; newUrl: string }[] = [];

async function processOne(row: Row): Promise<Outcome> {
  if (row.url.startsWith(S3_PUBLIC_URL)) {
    return { kind: "already_local", localUrl: row.url };
  }

  const ext = extFromUrl(row.url);
  const key = `${ERP_MEDIA_PREFIX}${sha1(row.url)}.${ext}`;
  const publicUrl = `${S3_PUBLIC_URL}/${key}`;

  if (await objectExists(key)) {
    if (APPLY && row.url !== publicUrl) updates.push({ id: row.id, newUrl: publicUrl });
    return { kind: "already_mirrored", localUrl: publicUrl };
  }

  if (!APPLY) return { kind: "already_mirrored", localUrl: publicUrl };

  let res: Response;
  try {
    res = await fetch(safeFetchUrl(row.url), { cache: "no-store" });
  } catch (e) {
    return { kind: "failed", reason: `fetch error: ${(e as Error).message}` };
  }
  if (!res.ok) return { kind: "failed", reason: `upstream ${res.status}` };
  const buffer = Buffer.from(await res.arrayBuffer());
  const ct = res.headers.get("content-type") ?? ctFromExt(ext);

  await s3.send(
    new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: ct,
      CacheControl: "public, max-age=31536000, immutable",
    }),
  );
  updates.push({ id: row.id, newUrl: publicUrl });
  return { kind: "mirrored", localUrl: publicUrl, bytes: buffer.byteLength, key };
}

function flushUpdates() {
  if (!APPLY || updates.length === 0) return;
  // Build a multi-row UPDATE via VALUES, batched at ~200 per round.
  const BATCH = 200;
  for (let i = 0; i < updates.length; i += BATCH) {
    const chunk = updates.slice(i, i + BATCH);
    const values = chunk
      .map((u) => {
        // psql -c interpolates SQL literally; quote-safe by escaping ' as ''.
        const safeId = u.id.replace(/'/g, "''");
        const safeUrl = u.newUrl.replace(/'/g, "''");
        return `('${safeId}'::uuid, '${safeUrl}')`;
      })
      .join(", ");
    const stmt = `UPDATE product_images SET url = v.url FROM (VALUES ${values}) AS v(id, url) WHERE product_images.id = v.id;`;
    psql(stmt);
  }
  updates.length = 0;
}

async function main() {
  console.log(`Mode: ${APPLY ? "APPLY" : "DRY-RUN"}  concurrency=${CONCURRENCY}  limit=${LIMIT || "all"}`);

  const limitClause = LIMIT > 0 ? `LIMIT ${LIMIT}` : "";
  const raw = psql(
    `SELECT id::text, url FROM product_images
       WHERE url IS NOT NULL
         AND url NOT LIKE '${S3_PUBLIC_URL.replace(/'/g, "''")}%'
       ORDER BY id ${limitClause};`,
  );
  const rows: Row[] = raw
    .trim()
    .split("\n")
    .filter((l) => l.length)
    .map((line) => {
      const [id, url] = line.split("\t");
      return { id, url };
    });
  console.log(`Found ${rows.length} rows to process.`);

  const queues: Row[][] = Array.from({ length: CONCURRENCY }, () => []);
  rows.forEach((r, i) => queues[i % CONCURRENCY].push(r));

  let mirrored = 0;
  let alreadyMirrored = 0;
  let alreadyLocal = 0;
  let failed = 0;
  let bytes = 0;
  const errors: { url: string; reason: string }[] = [];

  let done = 0;
  const total = rows.length;
  const tick = setInterval(() => {
    if (done < total) process.stdout.write(`  ...progress ${done}/${total}  mirrored=${mirrored} failed=${failed}\n`);
  }, 5000);

  await Promise.all(
    queues.map(async (q) => {
      for (const row of q) {
        const o = await processOne(row);
        done++;
        if (o.kind === "mirrored") {
          mirrored++;
          bytes += o.bytes;
        } else if (o.kind === "already_mirrored") {
          alreadyMirrored++;
        } else if (o.kind === "already_local") {
          alreadyLocal++;
        } else {
          failed++;
          if (errors.length < 30) errors.push({ url: row.url, reason: o.reason });
        }
      }
    }),
  );
  clearInterval(tick);

  flushUpdates();

  console.log(`\n=== Summary ===`);
  console.log(`  scanned:          ${total}`);
  console.log(`  mirrored:         ${mirrored}    bytes=${(bytes / 1024 / 1024).toFixed(1)} MB`);
  console.log(`  already_mirrored: ${alreadyMirrored}`);
  console.log(`  already_local:    ${alreadyLocal}`);
  console.log(`  failed:           ${failed}`);
  if (errors.length) {
    console.log(`\n  Errors:`);
    for (const e of errors.slice(0, 15)) console.log(`    ${e.reason}  ${e.url.slice(0, 80)}`);
  }
  if (!APPLY) console.log(`\nDry-run only. Re-run with --apply.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
