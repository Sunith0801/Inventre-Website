/**
 * Inventre — catalog app (storefront + admin).
 *
 *   npm run demo                 → http://localhost:4317
 *   production (Docker)          → PORT=3000, served at :3010
 *
 *   /shop/*    public storefront — browse the catalog by school + grade
 *   /admin/*   back-office (login: ADMIN_EMAIL / ADMIN_PASSWORD)
 *
 * Catalog-only app on the redesigned 19-table schema. Single-file Node
 * server, no framework.
 */
import { config } from "dotenv";
import path from "path";
config({ path: path.resolve(process.cwd(), ".env.local") });
config({ path: path.resolve(process.cwd(), ".env") });

import http from "http";
import crypto from "crypto";
import postgres from "postgres";

const sql = postgres(
  process.env.DATABASE_URL || process.env.DATABASE_DIRECT_URL!,
  { prepare: false }
);
const PORT = Number(process.env.PORT) || 4317;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@inventre.in";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "inventre@admin";
const PAGE_SIZE = 40;

// ───────────────────────────── plumbing ────────────────────────────────────

const sessions = new Set<string>();

function parseCookies(req: http.IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (req.headers.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function readBody(req: http.IncomingMessage): Promise<Record<string, string>> {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const out: Record<string, string> = {};
      for (const p of raw.split("&")) {
        const i = p.indexOf("=");
        if (i >= 0)
          out[decodeURIComponent(p.slice(0, i))] = decodeURIComponent(
            p.slice(i + 1).replace(/\+/g, " ")
          );
      }
      resolve(out);
    });
  });
}

const e = (v: any) =>
  String(v ?? "").replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!)
  );
const money = (paise: any) =>
  paise == null ? "—" : "₹" + (Number(paise) / 100).toLocaleString("en-IN");
const pill = (on: boolean, yes: string, no: string) =>
  `<span class="pill ${on ? "ok" : "off"}">${on ? yes : no}</span>`;

// ════════════════════════════ STOREFRONT (/shop) ════════════════════════════

const SHOP_CSS = `
 *{box-sizing:border-box} body{font:15px/1.6 system-ui,sans-serif;margin:0;background:#f6f7fb;color:#1a1a2e}
 a{color:#4856c9;text-decoration:none} a:hover{text-decoration:underline}
 .top{background:#1a1a2e;color:#fff;padding:14px 28px;display:flex;align-items:center;gap:18px}
 .top b{font-size:19px} .top .sp{margin-left:auto;font-size:13px;color:#aab}
 main{max-width:1100px;margin:26px auto;padding:0 20px}
 h1{font-size:24px;margin:.1em 0 .1em} .sub{color:#888;margin:.2em 0 1.3em}
 .crumbs{font-size:13px;color:#999;margin-bottom:12px}
 .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:18px}
 .card{background:#fff;border-radius:12px;padding:16px;box-shadow:0 1px 4px rgba(0,0,0,.07);
   display:block;color:inherit}
 .card:hover{box-shadow:0 6px 18px rgba(0,0,0,.13);text-decoration:none}
 .card img{width:100%;height:160px;object-fit:contain;background:#f6f7fb;border-radius:8px}
 .card .nm{font-weight:600;margin:8px 0 2px} .card .cd{color:#999;font-size:12px}
 .card .pr{font-weight:700;color:#1a7f37;margin-top:6px}
 .tag{display:inline-block;background:#eceefb;color:#4856c9;font-size:11px;padding:2px 9px;border-radius:5px;margin:1px}
 .bar{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin:14px 0}
 select{padding:9px 12px;border-radius:8px;border:1px solid #ccd;font:inherit}
 .swatch{display:inline-block;width:14px;height:14px;border-radius:4px;border:1px solid #bbb;vertical-align:-2px;margin-right:4px}
 .pdp{display:flex;gap:30px;flex-wrap:wrap}
 .pdp .ph{width:340px;height:340px;object-fit:contain;background:#fff;border-radius:12px;box-shadow:0 1px 4px rgba(0,0,0,.07)}
 .pdp .info{flex:1;min-width:280px}
 table{width:100%;border-collapse:collapse;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.07)}
 th,td{text-align:left;padding:9px 13px;border-bottom:1px solid #eef0f3;font-size:14px}
 th{background:#fafbfc;color:#778;font-size:12px;text-transform:uppercase}
 tr:last-child td{border-bottom:0}
 .empty{background:#fff;border-radius:12px;padding:40px;text-align:center;color:#999}
`;

function shopPage(title: string, body: string) {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${e(title)} · Inventre</title><style>${SHOP_CSS}</style></head><body>
<div class="top"><b>Inventre</b><a href="/shop" style="color:#cfd3ea">Shop by school</a>
 <span class="sp"><a href="/admin" style="color:#aab">Admin</a></span></div>
<main>${body}</main></body></html>`;
}

async function shopHome() {
  const schools = await sql`
    SELECT s.id, s.name, s.city, s.logo_url,
      (SELECT count(DISTINCT item_id) FROM catalog c WHERE c.school_id=s.id)::int items
    FROM schools s ORDER BY s.name`;
  const cards = schools
    .map(
      (s) => `<a class="card" href="/shop/school/${s.id}">
       <img src="${e(s.logo_url) || ""}" alt="" onerror="this.style.visibility='hidden'">
       <div class="nm">${e(s.name)}</div>
       <div class="cd">${e(s.city) || ""}</div>
       <div class="tag">${s.items} items</div></a>`
    )
    .join("");
  return shopPage(
    "Shop by school",
    `<h1>Find your school</h1>
     <p class="sub">Pick your child's school to see its uniforms, Bookkits and Magic Box.</p>
     <div class="grid">${cards}</div>`
  );
}

async function shopSchool(schoolId: string, gradeId: string) {
  const [s] = await sql`SELECT * FROM schools WHERE id=${schoolId}`;
  if (!s) return null;
  const grades = await sql`
    SELECT DISTINCT g.id, g.name, g.sort_order, sg.school_grade_name
    FROM catalog c JOIN grades g ON g.id=c.organisation_grade_id
    LEFT JOIN school_grades sg ON sg.school_id=${schoolId} AND sg.organisation_grade_id=g.id
    WHERE c.school_id=${schoolId}
    ORDER BY g.sort_order, g.name`;
  const gradeOpt =
    `<option value="">Select grade…</option>` +
    grades
      .map((g) => {
        const lbl = g.school_grade_name ? `${g.school_grade_name} (${g.name})` : g.name;
        return `<option value="${g.id}" ${g.id === gradeId ? "selected" : ""}>${e(lbl)}</option>`;
      })
      .join("");

  let body = `<div class="crumbs"><a href="/shop">Schools</a> › ${e(s.name)}</div>
   <h1>${e(s.name)}</h1>
   <p class="sub">${e(s.city) || ""} — choose a grade to see the kit.</p>
   <form class="bar" method="get" action="/shop/school/${schoolId}">
     <label>Grade</label>
     <select name="grade" onchange="this.form.submit()">${gradeOpt}</select>
   </form>`;

  if (!gradeId) {
    body += `<div class="empty">Select a grade above to view the catalog.</div>`;
    return shopPage(s.name, body);
  }
  // catalog for school + grade — main buyable items, enabled only.
  const items = await sql`
    SELECT DISTINCT c.item_id, c.item_name, c.item_code, c.kind, c.image_url, c.price,
      CASE c.kind WHEN 'magic_box' THEN 0 WHEN 'kit' THEN 1
                  WHEN 'uniform' THEN 2 ELSE 3 END AS sort_class
    FROM catalog c
    WHERE c.school_id=${schoolId} AND NOT c.is_variant AND c.enabled
      AND (c.organisation_grade_id=${gradeId} OR c.organisation_grade_id IS NULL)
    ORDER BY sort_class, c.item_name`;
  body += `<p class="sub">${items.length} items available</p><div class="grid">${
    items
      .map(
        (it) => `<a class="card" href="/shop/item/${it.item_id}">
       <img src="${e(it.image_url) || ""}" alt="" onerror="this.style.visibility='hidden'">
       <div><span class="tag">${e(it.kind)}</span></div>
       <div class="nm">${e(it.item_name)}</div>
       <div class="cd">${e(it.item_code)}</div>
       <div class="pr">${money(it.price)}</div></a>`
      )
      .join("") || `<div class="empty">No items for this grade yet.</div>`
  }</div>`;
  return shopPage(`${s.name} — catalog`, body);
}

async function shopItem(itemId: string) {
  let [it] = await sql`SELECT * FROM items WHERE id=${itemId}`;
  if (!it) return null;
  if (it.is_variant && it.parent_item_id)
    [it] = await sql`SELECT * FROM items WHERE id=${it.parent_item_id}`;
  const img = await sql`
    SELECT url FROM item_images WHERE item_id=${it.id} ORDER BY is_primary DESC LIMIT 1`;
  const prices = await sql`
    SELECT p.price, pl.name list FROM item_prices p
    JOIN price_lists pl ON pl.id=p.price_list_id WHERE p.item_id=${it.id}`;
  const variants = await sql`SELECT * FROM items WHERE parent_item_id=${it.id} ORDER BY item_code`;
  const decoded = await sql`
    SELECT iva.item_id, a.name attr, v.value, v.abbreviation, v.hex_color
    FROM item_variant_attributes iva
    JOIN item_attributes a ON a.id=iva.attribute_id
    JOIN item_attribute_values v ON v.id=iva.attribute_value_id
    WHERE iva.item_id IN ${sql(
      variants.length ? variants.map((x) => x.id) : ["00000000-0000-0000-0000-000000000000"]
    )}`;
  const byVar = new Map<string, any[]>();
  for (const d of decoded) {
    if (!byVar.has(d.item_id)) byVar.set(d.item_id, []);
    byVar.get(d.item_id)!.push(d);
  }
  // BOM contents for kits / boxes
  const boms = await sql`SELECT * FROM boms WHERE item_id=${it.id} AND is_active`;
  let bom = "";
  for (const b of boms) {
    const comps = await sql`
      SELECT bi.quantity, ci.name FROM bom_items bi
      JOIN items ci ON ci.id=bi.item_id WHERE bi.bom_id=${b.id} ORDER BY bi.sort_order`;
    if (comps.length)
      bom += `<h3>What's inside</h3><table><tr><th>Item</th><th>Qty</th></tr>${comps
        .map((c) => `<tr><td>${e(c.name)}</td><td>${e(c.quantity)}</td></tr>`)
        .join("")}</table>`;
  }
  const variantTable = variants.length
    ? `<h3>Available options (${variants.length})</h3>
     <table><tr><th>Option</th><th>Details</th></tr>${variants
       .map((v) => {
         const at = (byVar.get(v.id) || [])
           .map(
             (d) =>
               `<span class="tag">${
                 d.hex_color ? `<span class="swatch" style="background:${e(d.hex_color)}"></span>` : ""
               }${e(d.value)}${d.abbreviation ? ` (${e(d.abbreviation)})` : ""}</span>`
           )
           .join(" ");
         return `<tr><td>${e(v.item_code)}</td><td>${at || "—"}</td></tr>`;
       })
       .join("")}</table>`
    : "";
  const body = `<div class="crumbs"><a href="/shop">Shop</a> › ${e(it.name)}</div>
   <div class="pdp">
     <img class="ph" src="${e(img[0]?.url || "")}" alt="" onerror="this.style.visibility='hidden'">
     <div class="info">
       <h1>${e(it.name)}</h1>
       <p class="sub"><span class="tag">${e(it.kind)}</span> ${e(it.item_code)}</p>
       <div style="font-size:22px;font-weight:800;color:#1a7f37">${money(prices[0]?.price)}</div>
       ${it.description ? `<p>${e(it.description)}</p>` : ""}
       ${variantTable}
     </div>
   </div>
   ${bom}`;
  return shopPage(it.name, body);
}

// ════════════════════════════ ADMIN (/admin) ════════════════════════════════

const CSS = `
 *{box-sizing:border-box} body{font:14px/1.55 system-ui,sans-serif;margin:0;background:#eef0f4;color:#1a1a2e}
 a{color:#4856c9} .layout{display:flex;min-height:100vh}
 aside{width:210px;background:#1a1a2e;color:#c7cad8;flex-shrink:0;padding:18px 0}
 aside .brand{font-weight:700;color:#fff;font-size:17px;padding:0 20px 14px}
 aside a{display:block;color:#aab;text-decoration:none;padding:9px 20px;font-size:14px}
 aside a:hover{background:#2a2a44;color:#fff} aside a.on{background:#4856c9;color:#fff}
 aside .grp{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#667;padding:16px 20px 4px}
 .content{flex:1;padding:24px 30px;max-width:1180px}
 .crumbs{font-size:12px;color:#888;margin-bottom:10px} .crumbs a{text-decoration:none}
 h1{font-size:21px;margin:.1em 0 .5em} h2{font-size:16px;margin:1.5em 0 .5em}
 table{width:100%;border-collapse:collapse;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.07)}
 th,td{text-align:left;padding:9px 12px;border-bottom:1px solid #eef0f3}
 th{background:#fafbfc;color:#667;font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.04em}
 tr:last-child td{border-bottom:0} tbody tr:hover td{background:#fafbff}
 .pill{font-size:11px;padding:2px 9px;border-radius:20px;font-weight:600;white-space:nowrap}
 .pill.ok{background:#e3f6e8;color:#1a7f37} .pill.off{background:#fde8e8;color:#c0392b}
 .tag{display:inline-block;background:#eceefb;color:#4856c9;font-size:11px;padding:2px 8px;border-radius:4px;margin:1px}
 .muted{color:#999} .swatch{display:inline-block;width:12px;height:12px;border-radius:3px;border:1px solid #ccc;vertical-align:-1px;margin-right:3px}
 .cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:14px;margin:14px 0}
 .card{background:#fff;border-radius:8px;padding:15px;box-shadow:0 1px 3px rgba(0,0,0,.07);text-decoration:none;color:inherit}
 .card:hover{box-shadow:0 3px 10px rgba(0,0,0,.13)} .card .big{font-size:25px;font-weight:700;color:#4856c9}
 .card img{width:100%;height:120px;object-fit:contain;background:#f4f5f7;border-radius:6px}
 input,select,button{font:inherit;padding:7px 10px;border-radius:6px;border:1px solid #ccd}
 button{background:#4856c9;color:#fff;border:0;cursor:pointer;font-weight:600}
 button.ghost{background:#eceefb;color:#4856c9} button.danger{background:#fde8e8;color:#c0392b}
 button.sm{padding:4px 9px;font-size:12px}
 form.inline{display:inline} .bar{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0;align-items:center}
 .pg{margin:14px 0;display:flex;gap:6px;align-items:center} .pg a{padding:5px 10px;background:#fff;border-radius:6px;text-decoration:none;border:1px solid #ddd}
 .pg .cur{background:#4856c9;color:#fff;border-color:#4856c9;padding:5px 10px;border-radius:6px}
 .topbar{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px}
 .who{font-size:13px;color:#667} img.thumb{width:46px;height:46px;object-fit:contain;background:#f4f5f7;border-radius:5px}
`;

const NAV: [string, string, string][] = [
  ["catalog", "Dashboard", "/admin"],
  ["catalog", "Catalog", "/admin/catalog"],
  ["catalog", "Items", "/admin/items"],
  ["catalog", "Attributes", "/admin/attributes"],
  ["catalog", "BOMs", "/admin/boms"],
  ["org", "Schools", "/admin/schools"],
  ["org", "Grades", "/admin/grades"],
  ["org", "Students", "/admin/students"],
  ["sales", "Sales Orders", "/admin/orders"],
  ["sales", "Customers", "/admin/customers"],
];

function shell(title: string, current: string, body: string, crumbs: [string, string][] = []) {
  let nav = "";
  let grp = "";
  for (const [g, label, href] of NAV) {
    if (g !== grp) {
      grp = g;
      nav += `<div class="grp">${g}</div>`;
    }
    nav += `<a class="${href === current ? "on" : ""}" href="${href}">${label}</a>`;
  }
  const cr = crumbs
    .map(([t, h], i) =>
      i === crumbs.length - 1 ? `<span>${e(t)}</span>` : `<a href="${h}">${e(t)}</a>`
    )
    .join(" › ");
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${e(title)} · Inventre Admin</title><style>${CSS}</style></head><body>
<div class="layout">
 <aside><div class="brand">Inventre Admin</div>${nav}
   <div class="grp">site</div><a href="/shop">View storefront ↗</a>
   <form method="post" action="/admin/logout"><button class="ghost" style="margin:6px 20px">Log out</button></form>
 </aside>
 <div class="content">
   <div class="topbar"><div class="crumbs">${cr}</div><div class="who">${e(ADMIN_EMAIL)}</div></div>
   ${body}
 </div></div></body></html>`;
}

function loginPage(error = "") {
  return `<!doctype html><html><head><meta charset="utf-8">
<title>Inventre Admin · Login</title><style>${CSS}
 .box{max-width:340px;margin:9vh auto;background:#fff;padding:30px;border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.12)}
 .box h1{margin-top:0} .box input{width:100%;margin:6px 0} .box button{width:100%;margin-top:10px;padding:10px}
 .err{background:#fde8e8;color:#c0392b;padding:8px 12px;border-radius:6px;font-size:13px}
</style></head><body>
<div class="box"><h1>Inventre Admin</h1>
 <p class="muted" style="margin-top:-6px">Sign in to manage the catalog.</p>
 ${error ? `<div class="err">${e(error)}</div>` : ""}
 <form method="post" action="/admin/login">
   <input name="email" type="email" placeholder="Email" required value="${e(ADMIN_EMAIL)}"
     autocomplete="username">
   <input name="password" type="password" placeholder="Password" required
     value="${e(ADMIN_PASSWORD)}" autocomplete="current-password">
   <button>Sign in</button>
 </form>
 <p class="muted" style="font-size:12px;margin-bottom:0">Credentials are pre-filled — just click Sign in.</p>
 </div></body></html>`;
}

function pager(base: string, page: number, total: number) {
  const pages = Math.ceil(total / PAGE_SIZE);
  if (pages <= 1) return "";
  let out = `<div class="pg">`;
  if (page > 1) out += `<a href="${base}page=${page - 1}">‹ Prev</a>`;
  out += `<span class="cur">${page}</span><span class="muted">of ${pages} · ${total.toLocaleString("en-IN")} rows</span>`;
  if (page < pages) out += `<a href="${base}page=${page + 1}">Next ›</a>`;
  return out + `</div>`;
}

// ── admin pages ─────────────────────────────────────────────────────────────

async function pageDashboard() {
  const [c] = await sql`SELECT
    (SELECT count(*) FROM items WHERE NOT is_variant) main_items,
    (SELECT count(*) FROM items WHERE NOT is_variant AND enabled) enabled_items,
    (SELECT count(*) FROM items WHERE is_variant) variants,
    (SELECT count(*) FROM item_attributes) attributes,
    (SELECT count(*) FROM boms) boms,
    (SELECT count(*) FROM boms WHERE is_active) active_boms,
    (SELECT count(*) FROM schools) schools,
    (SELECT count(*) FROM grades) grades,
    (SELECT count(*) FROM customers) customers,
    (SELECT count(*) FROM sales_orders) orders`;
  const card = (label: string, n: any, sub: string, href: string) =>
    `<a class="card" href="${href}"><div class="big">${Number(n).toLocaleString("en-IN")}</div>
      <div>${label}</div><div class="muted" style="font-size:12px">${sub}</div></a>`;
  return shell("Dashboard", "/admin",
    `<h1>Catalog control centre</h1>
     <p class="muted">Disabled items / inactive BOMs are hidden from the storefront.</p>
     <div class="cards">
       ${card("Main items", c.main_items, `${c.enabled_items} enabled`, "/admin/items")}
       ${card("Variations", c.variants, "colour / size SKUs", "/admin/items")}
       ${card("Attributes", c.attributes, "colours, sizes…", "/admin/attributes")}
       ${card("BOMs", c.boms, `${c.active_boms} active`, "/admin/boms")}
       ${card("Schools", c.schools, "+ grade mappings", "/admin/schools")}
       ${card("Grades", c.grades, "organisation grades", "/admin/grades")}
       ${card("Customers", c.customers, "billing accounts", "/admin/customers")}
       ${card("Sales orders", c.orders, "historical", "/admin/orders")}
     </div>`);
}

async function pageCatalog(schoolId: string, gradeId: string, showVariants: boolean) {
  const schools = await sql`SELECT id, code, name FROM schools ORDER BY name`;
  const schoolOpt =
    `<option value="">— select school —</option>` +
    schools
      .map((s) => `<option value="${s.id}" ${s.id === schoolId ? "selected" : ""}>${e(s.name)}</option>`)
      .join("");
  let panel = "";
  if (schoolId) {
    const [sc] = await sql`SELECT * FROM schools WHERE id=${schoolId}`;
    const grades = await sql`
      SELECT DISTINCT g.id, g.name, g.sort_order, sg.school_grade_name
      FROM item_school_grade_map m
      JOIN grades g ON g.id = m.grade_id
      LEFT JOIN school_grades sg
        ON sg.school_id = ${schoolId} AND sg.organisation_grade_id = g.id
      WHERE m.school_id = ${schoolId}
      ORDER BY g.sort_order, g.name`;
    const gradeOpt =
      `<option value="">All uniform grades</option>` +
      grades
        .map((g) => {
          const label = g.school_grade_name ? `${g.school_grade_name} (${g.name})` : g.name;
          return `<option value="${g.id}" ${g.id === gradeId ? "selected" : ""}>${e(label)}</option>`;
        })
        .join("");
    const gradeCond = gradeId
      ? sql`(c.organisation_grade_id = ${gradeId} OR c.organisation_grade_id IS NULL)`
      : sql`TRUE`;
    const varCond = showVariants ? sql`TRUE` : sql`c.is_variant = false`;
    const rows = await sql`
      SELECT c.item_id, c.item_code, c.item_name, c.kind, c.is_variant,
             c.enabled, c.image_url, c.price
      FROM catalog c
      WHERE c.school_id = ${schoolId} AND ${gradeCond} AND ${varCond}
      ORDER BY c.is_variant, c.kind, c.item_name`;
    panel = `<form class="bar" method="get" action="/admin/catalog">
       <input type="hidden" name="school" value="${schoolId}">
       <label>Uniform Grade</label>
       <select name="grade" onchange="this.form.submit()">${gradeOpt}</select>
       <label><input type="checkbox" name="variants" value="1" ${showVariants ? "checked" : ""}
         onchange="this.form.submit()"> show variations</label>
       <button>Apply</button>
     </form>
     <p class="muted">${rows.length.toLocaleString("en-IN")} items mapped to
       <b>${e(sc?.name)}</b>${gradeId ? "" : " (all uniform grades)"}.</p>
     <div class="cards">
     ${
       rows
         .map(
           (r) => `<a class="card" href="/admin/item/${r.item_id}">
         <img src="${e(r.image_url) || ""}" onerror="this.style.visibility='hidden'">
         <div style="margin:6px 0"><span class="tag">${e(r.kind)}</span>
           ${r.is_variant ? '<span class="tag">variation</span>' : ""}
           ${pill(r.enabled, "Enabled", "Disabled")}</div>
         <div style="font-weight:600">${e(r.item_name)}</div>
         <div class="muted" style="font-size:12px">${e(r.item_code)}</div>
         <div style="font-weight:700;color:#1a7f37">${money(r.price)}</div></a>`
         )
         .join("") || '<p class="muted">No items mapped to this school / grade.</p>'
     }</div>`;
  }
  const body = `<h1>Catalog — by school &amp; uniform grade</h1>
   <form class="bar" method="get" action="/admin/catalog">
     <label>School</label>
     <select name="school" onchange="this.form.submit()">${schoolOpt}</select>
     <button>Open</button>
   </form>
   ${panel || '<p class="muted">Pick a school to view its catalog.</p>'}`;
  return shell("Catalog", "/admin/catalog", body, [["Dashboard", "/admin"], ["Catalog", "/admin/catalog"]]);
}

async function pageItems(q: string, kind: string, status: string, page: number) {
  const where: any[] = [sql`NOT i.is_variant`];
  if (q) where.push(sql`(i.name ILIKE ${"%" + q + "%"} OR i.item_code ILIKE ${"%" + q + "%"})`);
  if (kind) where.push(sql`i.kind = ${kind}`);
  if (status === "on") where.push(sql`i.enabled`);
  if (status === "off") where.push(sql`NOT i.enabled`);
  const cond = where.reduce((a, b) => sql`${a} AND ${b}`);
  const [{ n }] = await sql`SELECT count(*)::int n FROM items i WHERE ${cond}`;
  const rows = await sql`
    SELECT i.id, i.item_code, i.name, i.kind, i.enabled,
      (SELECT count(*) FROM items v WHERE v.parent_item_id=i.id)::int variants,
      (SELECT count(*) FROM item_school_grade_map m WHERE m.item_id=i.id)::int maps,
      COALESCE((SELECT url FROM item_images im WHERE im.item_id=i.id LIMIT 1),'') img,
      (SELECT min(price) FROM item_prices p WHERE p.item_id=i.id) price
    FROM items i WHERE ${cond} ORDER BY i.name
    LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`;
  const kinds = ["magic_box", "kit", "sub_bundle", "uniform", "accessory", "book", "consumable"];
  const body = `<h1>Items</h1>
   <form class="bar" method="get" action="/admin/items">
     <input name="q" placeholder="Search name / code" value="${e(q)}" style="width:240px">
     <select name="kind"><option value="">All kinds</option>
       ${kinds.map((k) => `<option ${k === kind ? "selected" : ""}>${k}</option>`).join("")}</select>
     <select name="status"><option value="">All</option>
       <option value="on" ${status === "on" ? "selected" : ""}>Enabled only</option>
       <option value="off" ${status === "off" ? "selected" : ""}>Disabled only</option></select>
     <button>Filter</button> <a href="/admin/items">Reset</a>
   </form>
   <table><tr><th></th><th>Item</th><th>Kind</th><th>Variants</th><th>Maps</th><th>Price</th><th>Status</th><th>Action</th></tr>
   ${rows
     .map(
       (r) => `<tr>
      <td>${r.img ? `<img class="thumb" src="${e(r.img)}" onerror="this.style.visibility='hidden'">` : ""}</td>
      <td><a href="/admin/item/${r.id}">${e(r.name)}</a><br><span class="muted" style="font-size:12px">${e(r.item_code)}</span></td>
      <td><span class="tag">${e(r.kind)}</span></td>
      <td>${r.variants}</td><td>${r.maps}</td><td>${money(r.price)}</td>
      <td>${pill(r.enabled, "Enabled", "Disabled")}</td>
      <td><form class="inline" method="post" action="/admin/item/${r.id}/toggle?back=${encodeURIComponent("/admin/items?q=" + q + "&kind=" + kind + "&status=" + status + "&page=" + page)}">
        <button class="sm ${r.enabled ? "danger" : ""}">${r.enabled ? "Disable" : "Enable"}</button></form></td></tr>`
     )
     .join("")}</table>
   ${pager(`/admin/items?q=${encodeURIComponent(q)}&kind=${kind}&status=${status}&`, page, n)}`;
  return shell("Items", "/admin/items", body, [["Dashboard", "/admin"], ["Items", "/admin/items"]]);
}

async function pageItem(id: string) {
  let [it] = await sql`SELECT * FROM items WHERE id=${id}`;
  if (!it) return null;
  if (it.is_variant && it.parent_item_id)
    [it] = await sql`SELECT * FROM items WHERE id=${it.parent_item_id}`;
  const images = await sql`SELECT url FROM item_images WHERE item_id=${it.id} ORDER BY is_primary DESC`;
  const prices = await sql`
    SELECT p.price, pl.name list FROM item_prices p JOIN price_lists pl ON pl.id=p.price_list_id
    WHERE p.item_id=${it.id}`;
  const maps = await sql`
    SELECT sc.name school, g.name grade FROM item_school_grade_map m
    JOIN schools sc ON sc.id=m.school_id LEFT JOIN grades g ON g.id=m.grade_id
    WHERE m.item_id=${it.id} ORDER BY sc.name`;
  const variants = await sql`SELECT * FROM items WHERE parent_item_id=${it.id} ORDER BY item_code`;
  const decoded = await sql`
    SELECT iva.item_id, a.name attr, v.value, v.abbreviation, v.hex_color
    FROM item_variant_attributes iva
    JOIN item_attributes a ON a.id=iva.attribute_id
    JOIN item_attribute_values v ON v.id=iva.attribute_value_id
    WHERE iva.item_id IN ${sql(
      variants.length ? variants.map((x) => x.id) : ["00000000-0000-0000-0000-000000000000"]
    )}`;
  const byVar = new Map<string, any[]>();
  for (const d of decoded) {
    if (!byVar.has(d.item_id)) byVar.set(d.item_id, []);
    byVar.get(d.item_id)!.push(d);
  }
  const boms = await sql`SELECT * FROM boms WHERE item_id=${it.id}`;
  let bomHtml = "";
  for (const b of boms) {
    const comps = await sql`
      SELECT bi.quantity, ci.name, ci.item_code FROM bom_items bi
      JOIN items ci ON ci.id=bi.item_id WHERE bi.bom_id=${b.id} ORDER BY bi.sort_order`;
    bomHtml += `<h2>BOM ${e(b.bom_code)} ${pill(b.is_active, "Active", "Inactive")}
      <form class="inline" method="post" action="/admin/bom/${b.id}/toggle?back=/admin/item/${it.id}">
        <button class="sm ${b.is_active ? "danger" : ""}">${b.is_active ? "Deactivate" : "Activate"}</button></form></h2>
     <table><tr><th>Component</th><th>Code</th><th>Qty</th></tr>
     ${comps.map((c) => `<tr><td>${e(c.name)}</td><td>${e(c.item_code)}</td><td>${e(c.quantity)}</td></tr>`).join("")}</table>`;
  }
  const body = `<h1>${e(it.name)}</h1>
   <p class="muted">${e(it.item_code)} · <span class="tag">${e(it.kind)}</span>
     <span class="tag">${e(it.item_group) || "—"}</span> ${pill(it.enabled, "Enabled", "Disabled")}</p>
   <div class="bar">
     <form method="post" action="/admin/item/${it.id}/toggle?back=/admin/item/${it.id}">
       <button class="${it.enabled ? "danger" : ""}">${it.enabled ? "Disable item" : "Enable item"}</button></form>
     <a href="/shop/item/${it.id}" style="align-self:center">View on storefront ↗</a>
   </div>
   <div style="display:flex;gap:24px;flex-wrap:wrap">
     <img src="${e(images[0]?.url || "")}" style="width:220px;height:220px;object-fit:contain;background:#fff;border-radius:8px"
       onerror="this.style.visibility='hidden'">
     <div>
       <h2 style="margin-top:0">Pricing</h2>
       ${prices.length
         ? `<table style="width:auto">${prices.map((p) => `<tr><td>${e(p.list)}</td><td><b>${money(p.price)}</b></td></tr>`).join("")}</table>`
         : '<p class="muted">No price entry.</p>'}
       <h2>Mapped to (${maps.length})</h2>
       <div>${maps.map((m) => `<span class="tag">${e(m.school)}${m.grade ? " · " + e(m.grade) : " · all grades"}</span>`).join(" ") || '<span class="muted">not mapped</span>'}</div>
     </div>
   </div>
   ${variants.length
     ? `<h2>Variations — ${variants.length}</h2>
   <table><tr><th>Variation code</th><th>Decoded attributes</th><th>Status</th></tr>
   ${variants
     .map((v) => {
       const at = (byVar.get(v.id) || [])
         .map(
           (d) =>
             `<span class="tag">${d.hex_color ? `<span class="swatch" style="background:${e(d.hex_color)}"></span>` : ""}${e(d.attr)}: <b>${e(d.value)}</b>${d.abbreviation ? ` (${e(d.abbreviation)})` : ""}</span>`
         )
         .join(" ");
       return `<tr><td><a href="/admin/item/${v.id}">${e(v.item_code)}</a></td><td>${at || '<span class="muted">—</span>'}</td><td>${pill(v.enabled, "Enabled", "Disabled")}</td></tr>`;
     })
     .join("")}</table>`
     : ""}
   ${bomHtml}`;
  return shell(it.name, "/admin/items", body, [["Dashboard", "/admin"], ["Items", "/admin/items"], [it.name, "#"]]);
}

async function pageAttributes() {
  const attrs = await sql`
    SELECT a.id, a.name, a.is_numeric, a.enabled,
      (SELECT count(*) FROM item_attribute_values v WHERE v.attribute_id=a.id)::int n
    FROM item_attributes a ORDER BY n DESC, a.name`;
  let body = `<h1>Item Attributes (${attrs.length})</h1>`;
  for (const a of attrs.slice(0, 20)) {
    const vals = await sql`
      SELECT value, abbreviation, hex_color FROM item_attribute_values
      WHERE attribute_id=${a.id} ORDER BY sort_order LIMIT 40`;
    body += `<h2>${e(a.name)} ${pill(a.enabled, "Enabled", "Disabled")}
      <span class="muted" style="font-weight:400">${a.n} values${a.is_numeric ? " · numeric" : ""}</span>
      <form class="inline" method="post" action="/admin/attribute/${a.id}/toggle?back=/admin/attributes">
        <button class="sm ${a.enabled ? "danger" : "ghost"}">${a.enabled ? "Disable" : "Enable"}</button></form></h2>
     <div>${vals
       .map(
         (v) =>
           `<span class="tag">${v.hex_color ? `<span class="swatch" style="background:${e(v.hex_color)}"></span>` : ""}${e(v.value)}${v.abbreviation ? ` = <b>${e(v.abbreviation)}</b>` : ""}</span>`
       )
       .join(" ")}</div>`;
  }
  if (attrs.length > 20) body += `<p class="muted" style="margin-top:16px">Showing 20 of ${attrs.length}.</p>`;
  return shell("Attributes", "/admin/attributes", body, [["Dashboard", "/admin"], ["Attributes", "/admin/attributes"]]);
}

async function pageBoms(q: string, page: number) {
  const cond = q
    ? sql`b.bom_code ILIKE ${"%" + q + "%"} OR i.name ILIKE ${"%" + q + "%"}`
    : sql`TRUE`;
  const [{ n }] = await sql`SELECT count(*)::int n FROM boms b JOIN items i ON i.id=b.item_id WHERE ${cond}`;
  const rows = await sql`
    SELECT b.id, b.bom_code, b.is_active, i.name item,
      (SELECT count(*) FROM bom_items bi WHERE bi.bom_id=b.id)::int comps
    FROM boms b JOIN items i ON i.id=b.item_id WHERE ${cond}
    ORDER BY b.bom_code LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`;
  const body = `<h1>BOMs</h1>
   <form class="bar" method="get" action="/admin/boms">
     <input name="q" placeholder="Search BOM / item" value="${e(q)}" style="width:260px"><button>Search</button>
     <a href="/admin/boms">Reset</a></form>
   <table><tr><th>BOM</th><th>Produces item</th><th>Components</th><th>Status</th><th>Action</th></tr>
   ${rows
     .map(
       (r) => `<tr><td>${e(r.bom_code)}</td><td>${e(r.item)}</td><td>${r.comps}</td>
       <td>${pill(r.is_active, "Active", "Inactive")}</td>
       <td><form class="inline" method="post" action="/admin/bom/${r.id}/toggle?back=${encodeURIComponent("/admin/boms?q=" + q + "&page=" + page)}">
         <button class="sm ${r.is_active ? "danger" : ""}">${r.is_active ? "Deactivate" : "Activate"}</button></form></td></tr>`
     )
     .join("")}</table>
   ${pager(`/admin/boms?q=${encodeURIComponent(q)}&`, page, n)}`;
  return shell("BOMs", "/admin/boms", body, [["Dashboard", "/admin"], ["BOMs", "/admin/boms"]]);
}

async function pageSchools() {
  const rows = await sql`
    SELECT s.id, s.code, s.name, s.city, s.status,
      (SELECT count(*) FROM school_grades g WHERE g.school_id=s.id)::int grades,
      (SELECT count(DISTINCT m.item_id) FROM item_school_grade_map m WHERE m.school_id=s.id)::int items
    FROM schools s ORDER BY s.name`;
  const body = `<h1>Schools (${rows.length})</h1>
   <table><tr><th>School</th><th>Code</th><th>City</th><th>Grades</th><th>Mapped items</th><th>Status</th></tr>
   ${rows
     .map(
       (r) => `<tr><td><a href="/admin/school/${r.id}">${e(r.name)}</a></td><td>${e(r.code)}</td>
      <td>${e(r.city) || "—"}</td><td>${r.grades}</td><td>${r.items}</td>
      <td>${pill(r.status === "active", "Active", r.status)}</td></tr>`
     )
     .join("")}</table>`;
  return shell("Schools", "/admin/schools", body, [["Dashboard", "/admin"], ["Schools", "/admin/schools"]]);
}

async function pageSchool(id: string) {
  const [s] = await sql`SELECT * FROM schools WHERE id=${id}`;
  if (!s) return null;
  const grades = await sql`
    SELECT sg.school_grade_name, sg.sections, g.name org_grade, g.sort_order
    FROM school_grades sg JOIN grades g ON g.id=sg.organisation_grade_id
    WHERE sg.school_id=${id} ORDER BY g.sort_order`;
  const opts = ["active", "onboarding", "paused"]
    .map((o) => `<option ${o === s.status ? "selected" : ""}>${o}</option>`)
    .join("");
  const body = `<h1>${e(s.name)}</h1>
   <p class="muted">Code ${e(s.code)} · ${e(s.city) || ""} ${e(s.state) || ""} · Kit label: <b>${e(s.kit_label)}</b></p>
   <form class="bar" method="post" action="/admin/school/${id}/status">
     <label>Status</label><select name="status">${opts}</select><button>Save</button></form>
   <h2>Grades Details — organisation grade ↔ school-given (uniform) grade</h2>
   <table><tr><th>School-given grade</th><th>Organisation grade</th><th>Sections</th></tr>
   ${grades
     .map(
       (g) => `<tr><td><b>${e(g.school_grade_name)}</b></td><td>${e(g.org_grade)}</td><td>${e(g.sections) || "—"}</td></tr>`
     )
     .join("")}</table>`;
  return shell(s.name, "/admin/schools", body, [["Dashboard", "/admin"], ["Schools", "/admin/schools"], [s.name, "#"]]);
}

async function pageGrades() {
  const rows = await sql`
    SELECT g.id, g.name, g.sort_order,
      (SELECT count(*) FROM school_grades sg WHERE sg.organisation_grade_id=g.id)::int schools
    FROM grades g ORDER BY g.sort_order, g.name`;
  const body = `<h1>Organisation Grades (${rows.length})</h1>
   <table><tr><th>Grade</th><th>Sort</th><th>Used by schools</th></tr>
   ${rows.map((r) => `<tr><td><b>${e(r.name)}</b></td><td>${r.sort_order}</td><td>${r.schools}</td></tr>`).join("")}</table>`;
  return shell("Grades", "/admin/grades", body, [["Dashboard", "/admin"], ["Grades", "/admin/grades"]]);
}

async function pageStudents() {
  const [{ n }] = await sql`SELECT count(*)::int n FROM students`;
  const body = `<h1>Students</h1>
   ${n === 0
     ? `<p class="muted">No students yet — 0 Student records in ERPNext. Re-run <code>npm run erp:import</code> once they exist upstream.</p>`
     : `<p class="muted">${n} students.</p>`}`;
  return shell("Students", "/admin/students", body, [["Dashboard", "/admin"], ["Students", "/admin/students"]]);
}

async function pageOrders(q: string, page: number) {
  const cond = q ? sql`o.order_number ILIKE ${"%" + q + "%"}` : sql`TRUE`;
  const [{ n }] = await sql`SELECT count(*)::int n FROM sales_orders o WHERE ${cond}`;
  const rows = await sql`
    SELECT o.id, o.order_number, o.status, o.total, o.placed_at, c.name customer,
      (SELECT count(*) FROM sales_order_items li WHERE li.sales_order_id=o.id)::int lines
    FROM sales_orders o LEFT JOIN customers c ON c.id=o.customer_id WHERE ${cond}
    ORDER BY o.placed_at DESC NULLS LAST LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`;
  const body = `<h1>Sales Orders</h1>
   <form class="bar" method="get" action="/admin/orders">
     <input name="q" placeholder="Search order #" value="${e(q)}" style="width:240px"><button>Search</button>
     <a href="/admin/orders">Reset</a></form>
   <table><tr><th>Order #</th><th>Customer</th><th>Date</th><th>Lines</th><th>Status</th><th>Total</th></tr>
   ${rows
     .map(
       (r) => `<tr><td><a href="/admin/order/${r.id}">${e(r.order_number)}</a></td><td>${e(r.customer) || "—"}</td>
      <td>${r.placed_at ? new Date(r.placed_at).toLocaleDateString("en-IN") : "—"}</td>
      <td>${r.lines}</td><td><span class="tag">${e(r.status)}</span></td><td><b>${money(r.total)}</b></td></tr>`
     )
     .join("")}</table>
   ${pager(`/admin/orders?q=${encodeURIComponent(q)}&`, page, n)}`;
  return shell("Sales Orders", "/admin/orders", body, [["Dashboard", "/admin"], ["Orders", "/admin/orders"]]);
}

async function pageOrder(id: string) {
  const [o] = await sql`
    SELECT o.*, c.name customer FROM sales_orders o
    LEFT JOIN customers c ON c.id=o.customer_id WHERE o.id=${id}`;
  if (!o) return null;
  const lines = await sql`SELECT * FROM sales_order_items WHERE sales_order_id=${id}`;
  const body = `<h1>Order ${e(o.order_number)}</h1>
   <p class="muted">${e(o.customer) || "—"} · <span class="tag">${e(o.status)}</span>
     · ${o.placed_at ? new Date(o.placed_at).toLocaleDateString("en-IN") : ""}</p>
   <table><tr><th>Item</th><th>Qty</th><th>Unit price</th><th>Total</th></tr>
   ${lines
     .map(
       (l) => `<tr><td>${e(l.item_name_snapshot)}</td><td>${l.quantity}</td><td>${money(l.unit_price)}</td><td>${money(l.total)}</td></tr>`
     )
     .join("")}
   <tr><th colspan="3" style="text-align:right">Grand total</th><th>${money(o.total)}</th></tr></table>`;
  return shell(o.order_number, "/admin/orders", body, [["Dashboard", "/admin"], ["Orders", "/admin/orders"], [o.order_number, "#"]]);
}

async function pageCustomers(q: string, page: number) {
  const cond = q
    ? sql`name ILIKE ${"%" + q + "%"} OR customer_code ILIKE ${"%" + q + "%"}`
    : sql`TRUE`;
  const [{ n }] = await sql`SELECT count(*)::int n FROM customers WHERE ${cond}`;
  const rows = await sql`
    SELECT customer_code, name, email, phone FROM customers WHERE ${cond}
    ORDER BY name LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`;
  const body = `<h1>Customers</h1>
   <form class="bar" method="get" action="/admin/customers">
     <input name="q" placeholder="Search name / code" value="${e(q)}" style="width:240px"><button>Search</button>
     <a href="/admin/customers">Reset</a></form>
   <table><tr><th>Code</th><th>Name</th><th>Email</th><th>Phone</th></tr>
   ${rows
     .map(
       (r) => `<tr><td>${e(r.customer_code)}</td><td>${e(r.name)}</td>
      <td>${e(r.email) || '<span class="muted">—</span>'}</td><td>${e(r.phone) || "—"}</td></tr>`
     )
     .join("")}</table>
   ${pager(`/admin/customers?q=${encodeURIComponent(q)}&`, page, n)}`;
  return shell("Customers", "/admin/customers", body, [["Dashboard", "/admin"], ["Customers", "/admin/customers"]]);
}

// ───────────────────────────── router ──────────────────────────────────────

function redirect(res: http.ServerResponse, to: string, cookie?: string) {
  const h: any = { Location: to };
  if (cookie) h["Set-Cookie"] = cookie;
  res.writeHead(302, h);
  res.end();
}
function send(res: http.ServerResponse, html: string, code = 200) {
  res.writeHead(code, { "content-type": "text/html; charset=utf-8" });
  res.end(html);
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url || "/", "http://x");
  const url = u.pathname.replace(/\/+$/, "") || "/";
  const seg = url.split("/").filter(Boolean);
  const Q = (k: string) => u.searchParams.get(k) || "";
  const page = Math.max(1, parseInt(Q("page")) || 1);
  const authed = sessions.has(parseCookies(req)["inv_admin"] || "");

  try {
    // ── public ──
    if (url === "/") return redirect(res, "/shop");
    if (url === "/shop") return send(res, await shopHome());
    if (seg[0] === "shop" && seg[1] === "school" && seg[2]) {
      const h = await shopSchool(seg[2], Q("grade"));
      return h ? send(res, h) : send(res, shopPage("Not found", "<h1>404</h1>"), 404);
    }
    if (seg[0] === "shop" && seg[1] === "item" && seg[2]) {
      const h = await shopItem(seg[2]);
      return h ? send(res, h) : send(res, shopPage("Not found", "<h1>404</h1>"), 404);
    }

    // ── admin auth ──
    if (url === "/admin/login" && req.method === "GET") return send(res, loginPage());
    if (url === "/admin/login" && req.method === "POST") {
      const b = await readBody(req);
      if (b.email === ADMIN_EMAIL && b.password === ADMIN_PASSWORD) {
        const tok = crypto.randomBytes(24).toString("hex");
        sessions.add(tok);
        return redirect(res, "/admin", `inv_admin=${tok}; HttpOnly; Path=/; Max-Age=43200`);
      }
      return send(res, loginPage("Invalid email or password."), 401);
    }
    if (url === "/admin/logout") {
      sessions.delete(parseCookies(req)["inv_admin"] || "");
      return redirect(res, "/admin/login", "inv_admin=; Path=/; Max-Age=0");
    }
    if (seg[0] === "admin" && !authed) return redirect(res, "/admin/login");

    // ── admin POST actions ──
    if (seg[0] === "admin" && req.method === "POST") {
      const back = Q("back") || "/admin";
      if (seg[1] === "item" && seg[3] === "toggle") {
        await sql`UPDATE items SET enabled = NOT enabled WHERE id=${seg[2]}`;
        return redirect(res, back);
      }
      if (seg[1] === "bom" && seg[3] === "toggle") {
        await sql`UPDATE boms SET is_active = NOT is_active WHERE id=${seg[2]}`;
        return redirect(res, back);
      }
      if (seg[1] === "attribute" && seg[3] === "toggle") {
        await sql`UPDATE item_attributes SET enabled = NOT enabled WHERE id=${seg[2]}`;
        return redirect(res, back);
      }
      if (seg[1] === "school" && seg[3] === "status") {
        const b = await readBody(req);
        if (["active", "onboarding", "paused"].includes(b.status))
          await sql`UPDATE schools SET status=${b.status} WHERE id=${seg[2]}`;
        return redirect(res, `/admin/school/${seg[2]}`);
      }
      return send(res, "bad request", 400);
    }

    // ── admin GET pages ──
    if (seg[0] === "admin") {
      let html: string | null = null;
      if (url === "/admin") html = await pageDashboard();
      else if (url === "/admin/catalog")
        html = await pageCatalog(Q("school"), Q("grade"), Q("variants") === "1");
      else if (url === "/admin/items") html = await pageItems(Q("q"), Q("kind"), Q("status"), page);
      else if (url === "/admin/attributes") html = await pageAttributes();
      else if (url === "/admin/boms") html = await pageBoms(Q("q"), page);
      else if (url === "/admin/schools") html = await pageSchools();
      else if (url === "/admin/grades") html = await pageGrades();
      else if (url === "/admin/students") html = await pageStudents();
      else if (url === "/admin/orders") html = await pageOrders(Q("q"), page);
      else if (url === "/admin/customers") html = await pageCustomers(Q("q"), page);
      else if (seg[1] === "item" && seg[2]) html = await pageItem(seg[2]);
      else if (seg[1] === "school" && seg[2]) html = await pageSchool(seg[2]);
      else if (seg[1] === "order" && seg[2]) html = await pageOrder(seg[2]);
      if (html == null)
        return send(res, shell("Not found", "", "<h1>404</h1><p><a href='/admin'>← Dashboard</a></p>"), 404);
      return send(res, html);
    }

    return send(res, shopPage("Not found", "<h1>404</h1><p><a href='/shop'>← Shop</a></p>"), 404);
  } catch (err: any) {
    console.error(err);
    return send(res, shopPage("Error", `<h1>500</h1><pre>${e(err?.message || err)}</pre>`), 500);
  }
});

server.listen(PORT, () =>
  console.log(`Inventre catalog app → http://localhost:${PORT}  (shop: /shop · admin: /admin)`)
);
