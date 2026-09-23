// Usage: BASE=http://localhost:3033 SMOKE_PHONE=<dev parent phone> SMOKE_STUDENT_ID=<uuid> node scripts/smoke-storefront.mjs
// Run against a LOCAL build pointed at the dev database (never production):
//   NEXT_DIST_DIR=.next-verify npm run build && cp -r .next-verify/static .next-verify/standalone/.next-verify/ && cp -r public .next-verify/standalone/
//   set -a; . ./.env.local; set +a; NEXT_DIST_DIR=.next-verify COOKIE_INSECURE=1 ALLOW_INSECURE_COOKIES_IN_PROD=1 PORT=3033 node .next-verify/standalone/server.js
// Screenshots + axe-report.json land in $OUT. Serious/critical axe findings print per page. (F-08 / F-15, 2026-09-23)
// Storefront smoke + accessibility scan against a local build (F-08 / F-15).
// Logs in through the OTP API with the dev bypass code, walks shop → PDP →
// cart → orders → order detail, screenshots each, and runs axe-core on each.
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";
const BASE = process.env.BASE ?? "http://localhost:3033";
const OUT = process.env.OUT ?? "/tmp/inventre-smoke"; import { mkdirSync } from "node:fs"; mkdirSync(OUT, { recursive: true });
const phone = process.env.SMOKE_PHONE ?? ""; const studentId = process.env.SMOKE_STUDENT_ID ?? "";
if (!phone || !studentId) { console.error("set SMOKE_PHONE and SMOKE_STUDENT_ID (a dev parent + student)"); process.exit(2); }
const env = Object.fromEntries(readFileSync(process.env.ENV_FILE ?? ".env.local", "utf8").split("\n").filter(l => /^[A-Z_]+=/.test(l)).map(l => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, "")]; }));
const otp = env.DEV_OTP || env.OTP_BYPASS_CODE;
const axeSrc = readFileSync("node_modules/axe-core/axe.min.js", "utf8");
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 420, height: 860 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const report = [];
async function axe(name) {
  await page.addScriptTag({ content: axeSrc });
  const r = await page.evaluate(async () => await window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa"] }));
  const bad = r.violations.filter(v => ["serious", "critical"].includes(v.impact));
  report.push({ name, url: page.url(), serious: bad.map(v => `${v.id} (${v.nodes.length})`), minor: r.violations.filter(v => !["serious","critical"].includes(v.impact)).map(v => v.id) });
}
async function shot(name) { await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false }); }
const hdr = { "Content-Type": "application/json", Origin: BASE };
let r = await page.request.post(`${BASE}/api/auth/otp/request`, { headers: hdr, data: { phone } });
console.log("otp/request", r.status());
r = await page.request.post(`${BASE}/api/auth/otp/verify`, { headers: hdr, data: { phone, code: otp, otp } });
console.log("otp/verify", r.status(), (await r.text()).slice(0, 120));
await page.goto(`${BASE}/login`, { waitUntil: "networkidle" }); await axe("login");
await page.goto(`${BASE}/shop?studentId=${studentId}`, { waitUntil: "networkidle" }); await shot("01-shop"); await axe("shop");
const links = await page.$$eval('a[href^="/shop/"]', as => as.map(a => a.getAttribute("href")).filter(h => h && !/^\/shop\/(cart|checkout|orders)/.test(h)));
console.log("product links", links.length);
if (links[0]) { await page.goto(`${BASE}${links[0]}`, { waitUntil: "networkidle" }); await page.waitForTimeout(800); await shot("02-pdp"); await axe("pdp"); }
// find a bookkit with a language picker, if any
const kit = await page.request.get(`${BASE}/api/shop/products?studentId=${studentId}`).then(async x => { try { const j = await x.json(); const arr = j.products ?? j.items ?? j; return (Array.isArray(arr) ? arr : []).find(p => /book ?kit/i.test(p.name ?? "")); } catch { return null; } });
if (kit?.slug) { await page.goto(`${BASE}/shop/${kit.slug}?studentId=${studentId}`, { waitUntil: "networkidle" }); await page.waitForTimeout(800); await shot("03-bookkit"); await axe("bookkit"); }
await page.goto(`${BASE}/shop/cart`, { waitUntil: "networkidle" }); await shot("04-cart"); await axe("cart");
await page.goto(`${BASE}/shop/orders`, { waitUntil: "networkidle" }); await shot("05-orders"); await axe("orders");
const ol = await page.$$eval('a[href^="/shop/orders/"]', as => as.map(a => a.getAttribute("href")));
console.log("order links", ol.length);
if (ol[0]) { await page.goto(`${BASE}${ol[0]}`, { waitUntil: "networkidle" }); await page.waitForTimeout(800); await shot("06-order-detail"); await axe("order-detail"); }
await page.goto(`${BASE}/definitely-not-a-page`, { waitUntil: "networkidle" }); await shot("07-404"); await axe("not-found");
const errors = [];
page.on("pageerror", e => errors.push(String(e)));
writeFileSync(`${OUT}/axe-report.json`, JSON.stringify(report, null, 2));
for (const x of report) console.log(`${x.name.padEnd(13)} serious/critical: ${x.serious.length ? x.serious.join(", ") : "none"}${x.minor.length ? `  | minor: ${x.minor.join(", ")}` : ""}`);
await browser.close();
