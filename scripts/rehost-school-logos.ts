/**
 * Rehost every school_logo_url (and any populated logo_url / banner_url)
 * into R2, then rewrite the column to the R2 URL.
 *
 * Same approach as scripts/rehost-erp-images.ts but targets `schools` rows.
 * After this runs, `lib/session.ts:resolveErpUrl()` passes them through
 * unchanged (they're absolute https URLs), so the StudentBar renders an R2
 * image instead of poking at erp.inventre.in from the browser.
 *
 * Usage:
 *   set -a; . .env.deploy; set +a
 *   npx tsx scripts/rehost-school-logos.ts            # dry-run
 *   npx tsx scripts/rehost-school-logos.ts --apply
 */
import "dotenv/config";
import * as crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { S3Client, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";

const APPLY = process.argv.includes("--apply");
const PG_CONTAINER = process.env.PG_CONTAINER ?? "inventre-deploy-postgres";
const PG_USER = process.env.PG_USER ?? "inventre";
const PG_DB = process.env.PG_DB ?? "inventre";

function envOrThrow(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} not set`);
  return v;
}

const ERP_BASE_URL = (process.env.ERP_BASE_URL ?? "https://erp.inventre.in").replace(/\/+$/, "");
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

function sha1(s: string) {
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

/** /files/foo.png -> https://erp.inventre.in/files/foo.png. https:// passed through. */
function toAbsolute(raw: string): string | null {
  if (!raw) return null;
  if (raw.startsWith("http")) return raw;
  if (raw.startsWith("/")) return ERP_BASE_URL + raw;
  return null;
}

function psql(sqlText: string): string {
  return execFileSync(
    "docker",
    ["exec", "-i", PG_CONTAINER, "psql", "-U", PG_USER, "-d", PG_DB, "-t", "-A", "-F", "\t", "-c", sqlText],
    { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
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

type Row = { id: string; name: string; col: "school_logo_url" | "logo_url" | "banner_url"; raw: string };

async function processOne(row: Row): Promise<{ status: string; newUrl?: string; reason?: string }> {
  const upstream = toAbsolute(row.raw);
  if (!upstream) return { status: "unsupported", reason: `cannot resolve "${row.raw}"` };
  if (upstream.startsWith(S3_PUBLIC_URL)) return { status: "already_local" };

  const ext = extFromUrl(upstream);
  const key = `${ERP_MEDIA_PREFIX}${sha1(upstream)}.${ext}`;
  const publicUrl = `${S3_PUBLIC_URL}/${key}`;

  if (await objectExists(key)) {
    return { status: APPLY ? "already_mirrored_updating" : "already_mirrored", newUrl: publicUrl };
  }
  if (!APPLY) return { status: "would_download", newUrl: publicUrl };

  let res: Response;
  try {
    res = await fetch(safeFetchUrl(upstream), { cache: "no-store" });
  } catch (e) {
    return { status: "failed", reason: `fetch: ${(e as Error).message}` };
  }
  if (!res.ok) return { status: "failed", reason: `upstream ${res.status}` };
  const buf = Buffer.from(await res.arrayBuffer());
  const ct = res.headers.get("content-type") ?? ctFromExt(ext);
  await s3.send(
    new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
      Body: buf,
      ContentType: ct,
      CacheControl: "public, max-age=31536000, immutable",
    }),
  );
  return { status: "mirrored", newUrl: publicUrl };
}

async function main() {
  console.log(`Mode: ${APPLY ? "APPLY" : "DRY-RUN"}`);

  const cols: Array<Row["col"]> = ["school_logo_url", "logo_url", "banner_url"];
  const rows: Row[] = [];
  for (const col of cols) {
    const raw = psql(`SELECT id::text, name, ${col} FROM schools WHERE ${col} IS NOT NULL AND ${col} <> '';`);
    for (const line of raw.trim().split("\n").filter((l) => l)) {
      const [id, name, value] = line.split("\t");
      if (!value) continue;
      if (value.startsWith(S3_PUBLIC_URL)) continue;
      rows.push({ id, name, col, raw: value });
    }
  }

  console.log(`Found ${rows.length} rows to consider.\n`);
  let ok = 0;
  let failed = 0;
  for (const row of rows) {
    const r = await processOne(row);
    const tag = `[${row.col}] ${row.name.slice(0, 40)}  raw=${row.raw.slice(0, 50)}`;
    if (r.status === "mirrored" || r.status === "already_mirrored_updating") {
      if (APPLY && r.newUrl) {
        const safeId = row.id.replace(/'/g, "''");
        const safeUrl = r.newUrl.replace(/'/g, "''");
        psql(`UPDATE schools SET ${row.col} = '${safeUrl}' WHERE id = '${safeId}'::uuid;`);
      }
      ok++;
      console.log(`  [${r.status}] ${tag}`);
      console.log(`           -> ${r.newUrl}`);
    } else if (r.status === "would_download" || r.status === "already_mirrored") {
      console.log(`  [${r.status}] ${tag}`);
    } else {
      failed++;
      console.log(`  [${r.status.toUpperCase()}] ${tag}  ${r.reason ?? ""}`);
    }
  }
  console.log(`\nSummary: ok=${ok} failed=${failed}`);
  if (!APPLY) console.log(`Dry-run only. Re-run with --apply.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
