/* eslint-disable no-console */
/**
 * Dump every Item from the :8443 ERPNext clone to a local JSON snapshot.
 *
 * Auth: POST /api/auth/login (form: username/password) → JWT bearer.
 * List: GET  /api/items?limit=500&start=N (cap is 500, total ~6107).
 *
 * Env (.env.deploy):
 *   ERPNEXT_CLONE_BASE   e.g. https://161.97.132.211:8443
 *   ERPNEXT_CLONE_USER   admin
 *   ERPNEXT_CLONE_PASS   <password>
 *
 * Output: data/erpnext-items-snapshot.json (gitignored).
 *
 * This script does NOT touch the DB. It's safe to re-run.
 */

import { config } from "dotenv";
import path from "path";
config({ path: path.resolve(process.cwd(), ".env.deploy") });
config({ path: path.resolve(process.cwd(), ".env.local") });
config({ path: path.resolve(process.cwd(), ".env") });

import fs from "fs";
import { Agent, setGlobalDispatcher } from "undici";

// :8443 is a self-signed bare-IP host. Trust it for the duration of this
// script ONLY. Don't import this module from anywhere else.
setGlobalDispatcher(new Agent({ connect: { rejectUnauthorized: false } }));

type ErpItem = {
  name: string;
  item_name: string;
  item_group: string | null;
  stock_uom: string | null;
  is_stock_item: boolean;
  gst_hsn_code: string | null;
  custom_school_name: string | null;
  custom_grade: string | null; // comma-separated ERP-offset grades
  custom_gender: string | null;
  custom_sub_category: string | null;
  image: string | null;
  variant_of: string | null;
  has_variants: boolean;
  published_in_website: boolean;
  modified: string;
};

type ItemsPage = {
  rows: ErpItem[];
  total: number;
  start: number;
  limit: number;
};

async function login(base: string, user: string, pass: string): Promise<string> {
  const body = new URLSearchParams({ username: user, password: pass });
  const res = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    throw new Error(`login failed ${res.status}: ${await res.text().catch(() => "")}`.slice(0, 300));
  }
  const json = (await res.json()) as { access_token: string };
  if (!json.access_token) throw new Error("login response missing access_token");
  return json.access_token;
}

async function fetchPage(
  base: string,
  token: string,
  start: number,
  limit: number
): Promise<ItemsPage> {
  const url = `${base}/api/items?limit=${limit}&start=${start}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    throw new Error(`GET ${url} → ${res.status}: ${await res.text().catch(() => "")}`.slice(0, 300));
  }
  return (await res.json()) as ItemsPage;
}

async function main() {
  const base = (process.env.ERPNEXT_CLONE_BASE ?? "").replace(/\/$/, "");
  const user = process.env.ERPNEXT_CLONE_USER ?? "";
  const pass = process.env.ERPNEXT_CLONE_PASS ?? "";
  if (!base || !user || !pass) {
    console.error(
      "ERPNEXT_CLONE_BASE / ERPNEXT_CLONE_USER / ERPNEXT_CLONE_PASS must be set in .env.deploy"
    );
    process.exit(1);
  }

  console.log(`Logging in to ${base} as ${user} …`);
  const token = await login(base, user, pass);
  console.log(`OK (jwt ${token.length} chars)`);

  const limit = 500; // server-side cap
  const all: ErpItem[] = [];
  let total: number | null = null;
  for (let start = 0; ; start += limit) {
    const page = await fetchPage(base, token, start, limit);
    if (total === null) total = page.total;
    all.push(...page.rows);
    console.log(`  fetched ${all.length}/${total}`);
    if (page.rows.length < limit) break;
    if (all.length >= total) break;
  }

  if (total != null && all.length !== total) {
    console.warn(`⚠ Fetched ${all.length} but server reported total=${total}`);
  }

  const outDir = path.resolve(process.cwd(), "data");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, "erpnext-items-snapshot.json");
  fs.writeFileSync(
    outFile,
    JSON.stringify({ fetched_at: new Date().toISOString(), source: base, items: all }, null, 2)
  );
  console.log(`Wrote ${all.length} items → ${outFile}`);

  // Audit
  const withSchool = all.filter((r) => !!r.custom_school_name).length;
  const withGrade = all.filter((r) => !!r.custom_grade).length;
  const tpl = all.filter((r) => r.has_variants).length;
  const variants = all.filter((r) => !!r.variant_of).length;
  console.log(
    `Audit: total=${all.length}  withSchool=${withSchool}  withGrade=${withGrade}  templates=${tpl}  variants=${variants}`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
