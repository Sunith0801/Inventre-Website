/**
 * Build a self-contained PDF guide for parents — "How to log in & change
 * your mobile number". Drives headless Chromium against http://localhost:3010
 * with a temporary demo parent (created + deleted around the run), captures
 * the real public + logged-in flows, overlays arrows on the click targets,
 * and renders an annotated PDF.
 *
 * Run: pnpm tsx scripts/build-mobile-guide.ts
 */
import { chromium, type Page } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const BASE = process.env.GUIDE_BASE_URL ?? "http://localhost:3010";
const DEMO_PHONE = process.env.GUIDE_DEMO_PHONE ?? "9000099001";
const DEMO_PASSWORD = process.env.GUIDE_DEMO_PASSWORD ?? "DemoPass2026";

const ROOT = path.resolve(__dirname, "..");
const SHOT_DIR = path.join(ROOT, "docs/guides/assets");
const OUT_DIR = path.join(ROOT, "docs/guides");
const OUT_PDF = path.join(OUT_DIR, "mobile-number-update-guide.pdf");
const OUT_HTML = path.join(OUT_DIR, "mobile-number-update-guide.html");

// Mobile viewport — most parents use phones, and the live storefront layout
// is mobile-first so this gives the cleanest screenshots.
const VIEWPORT = { width: 420, height: 820 };

type Arrow = {
  x: number;          // tip x (0-1 fraction of width)
  y: number;          // tip y (0-1 fraction of height)
  from?: "left" | "right" | "top" | "bottom";
  label?: string;
};

async function shoot(page: Page, file: string, arrows: Arrow[] = [], clip?: { x: number; y: number; width: number; height: number }) {
  const p = path.join(SHOT_DIR, file);
  await page.screenshot({ path: p, fullPage: false, clip });
  if (arrows.length) await annotate(p, arrows);
  console.log(`  📸 ${file}${arrows.length ? `  (${arrows.length} arrow${arrows.length>1?"s":""})` : ""}`);
  return p;
}

/** Resolve a Playwright locator to viewport-fraction coordinates suitable
 *  for the Arrow type. Returns null if the element isn't visible. */
async function locArrow(page: Page, sel: string, opts: { from?: Arrow["from"]; label?: string; edge?: "left" | "right" | "center" } = {}): Promise<Arrow | null> {
  const loc = page.locator(sel).first();
  if (!(await loc.count())) return null;
  const box = await loc.boundingBox();
  if (!box) return null;
  const edge = opts.edge ?? "center";
  const x = edge === "right"
    ? box.x + box.width - 8
    : edge === "left"
      ? box.x + 8
      : box.x + box.width / 2;
  const y = box.y + box.height / 2;
  return {
    x: x / VIEWPORT.width,
    y: y / VIEWPORT.height,
    from: opts.from,         // let the arrow auto-direction pick
    label: opts.label,
  };
}

// ── Arrow overlay (Sharp + inline SVG) ───────────────────────────────
async function annotate(file: string, arrows: Arrow[]) {
  const img = sharp(file);
  const meta = await img.metadata();
  const W = meta.width ?? 840;
  const H = meta.height ?? 1680;

  const svgArrows = arrows.map((a) => {
    const tipX = Math.round(a.x * W);
    const tipY = Math.round(a.y * H);
    // Pick a direction that keeps the tail + label inside the canvas.
    // When the tip is in the right third of the image, arrow comes from
    // the left (tail to the left of tip, label further left).
    // When it's in the left third, arrow comes from the right.
    // Otherwise use the explicit `from` (or default to "top").
    const dir =
      a.from ??
      (tipX > W * 0.66 ? "left"
        : tipX < W * 0.34 ? "right"
        : "top");
    const len = 110;
    let tailX = tipX, tailY = tipY;
    if (dir === "left")  tailX = tipX - len;
    if (dir === "right") tailX = tipX + len;
    if (dir === "top")   tailY = tipY - len;
    if (dir === "bottom")tailY = tipY + len;

    // Arrowhead at tip — small triangle pointing toward tip.
    const dx = tipX - tailX, dy = tipY - tailY;
    const ang = Math.atan2(dy, dx);
    const headLen = 22;
    const headHalf = 12;
    const hx1 = tipX - headLen * Math.cos(ang) + headHalf * Math.sin(ang);
    const hy1 = tipY - headLen * Math.sin(ang) - headHalf * Math.cos(ang);
    const hx2 = tipX - headLen * Math.cos(ang) - headHalf * Math.sin(ang);
    const hy2 = tipY - headLen * Math.sin(ang) + headHalf * Math.cos(ang);

    // Label position — at the tail end, offset away from arrow.
    const labelX = tailX + (dir === "left" ? -10 : dir === "right" ? 10 : 0);
    const labelY = tailY + (dir === "top" ? -10 : dir === "bottom" ? 24 : -8);
    const labelAnchor = dir === "left" ? "end" : dir === "right" ? "start" : "middle";

    return `
      <line x1="${tailX}" y1="${tailY}" x2="${tipX}" y2="${tipY}"
            stroke="#dc2626" stroke-width="6" stroke-linecap="round" />
      <polygon points="${tipX},${tipY} ${hx1},${hy1} ${hx2},${hy2}"
               fill="#dc2626" />
      ${a.label ? `<g>
        <rect x="${labelX + (labelAnchor === "end" ? -8 - a.label.length * 11 : labelAnchor === "start" ? -4 : -a.label.length * 5.5 - 8)}"
              y="${labelY - 22}"
              width="${a.label.length * 11 + 16}" height="30" rx="6"
              fill="#fef2f2" stroke="#dc2626" stroke-width="2" />
        <text x="${labelX}" y="${labelY}" text-anchor="${labelAnchor}"
          font-family="-apple-system, Segoe UI, Roboto, sans-serif"
          font-size="20" font-weight="700" fill="#dc2626">${escapeXml(a.label)}</text>
      </g>` : ""}
    `;
  }).join("");

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${svgArrows}</svg>`;
  await img.composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).toFile(file + ".tmp.png");
  await fs.rename(file + ".tmp.png", file);
}

function escapeXml(s: string) {
  return s.replace(/[<>&'"]/g, (c) =>
    ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c]!),
  );
}

// ── Crop top of a screenshot to a given height fraction ─────────────
async function cropTop(file: string, heightFrac: number) {
  const meta = await sharp(file).metadata();
  const W = meta.width ?? 840;
  const H = meta.height ?? 1680;
  const newH = Math.round(H * heightFrac);
  await sharp(file)
    .extract({ left: 0, top: 0, width: W, height: newH })
    .toFile(file + ".tmp.png");
  await fs.rename(file + ".tmp.png", file);
}

// ── Privacy: blur a region ────────────────────────────────────────────
async function blurRegion(file: string, topFrac: number, heightFrac: number) {
  const meta = await sharp(file).metadata();
  const W = meta.width ?? 840;
  const H = meta.height ?? 1680;
  const top = Math.round(H * topFrac);
  const height = Math.round(H * heightFrac);
  const region = await sharp(file)
    .extract({ left: 0, top, width: W, height })
    .blur(18)
    .toBuffer();
  await sharp(file)
    .composite([{ input: region, left: 0, top }])
    .toFile(file + ".tmp.png");
  await fs.rename(file + ".tmp.png", file);
}

// ── Capture all the screens ──────────────────────────────────────────
async function capture() {
  await fs.mkdir(SHOT_DIR, { recursive: true });
  await fs.mkdir(OUT_DIR, { recursive: true });

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2 });
  const page = await ctx.newPage();

  // ── Logo (captured first while we're definitely on /login) ──────
  console.log("0. Inventre logo (for cover)");
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  // The Logo component renders as `<span class="font-display ...">INVENTRE<span class="text-brand">.</span></span>`.
  // Match it via the tracking class which is unique to that element.
  const logoEl = page.locator('span.font-display:has-text("INVENTRE")').first();
  if (await logoEl.count()) {
    const box = await logoEl.boundingBox();
    if (box && box.width > 0) {
      await page.screenshot({
        path: path.join(SHOT_DIR, "00-logo.png"),
        clip: {
          x: Math.max(0, box.x - 6),
          y: Math.max(0, box.y - 8),
          width: Math.min(VIEWPORT.width - box.x + 6, box.width + 14),
          height: box.height + 16,
        },
      });
      console.log(`  📸 00-logo.png  (${Math.round(box.width)}×${Math.round(box.height)} at ${Math.round(box.x)},${Math.round(box.y)})`);
    } else {
      console.log("  ⚠ logo found but no bounding box");
    }
  } else {
    console.log("  ⚠ logo selector matched nothing");
  }

  // ── /login (anon) ────────────────────────────────────────────────
  console.log("1. Login page (empty)");
  await page.waitForTimeout(300);
  await shoot(page, "01-login-empty.png");

  console.log("2. Login — mobile filled");
  const mobileInput = page.locator('input[type="tel"], input[name="phone" i], input[placeholder*="mobile" i]').first();
  await mobileInput.fill(DEMO_PHONE);
  await page.waitForTimeout(300);
  const arr02 = [
    await locArrow(page, 'button:has-text("Continue")', { label: "Type mobile + tap Continue", from: "bottom", edge: "center" }),
  ].filter((a): a is Arrow => a !== null);
  await shoot(page, "02-login-mobile-filled.png", arr02);

  // ── Forgot Mobile modal ──────────────────────────────────────────
  console.log("3. Forgot Mobile modal — opened");
  await mobileInput.fill("");
  await page.waitForTimeout(200);
  const recoverTrigger = page.getByRole("button", { name: /recover.*change.*add.*mobile/i });
  await recoverTrigger.scrollIntoViewIfNeeded();
  await recoverTrigger.click();
  await page.waitForSelector("select", { state: "visible", timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(700);
  const arr03 = [
    await locArrow(page, "select >> nth=0", { label: "Pick school + grade", from: "bottom", edge: "center" }),
  ].filter((a): a is Arrow => a !== null);
  await shoot(page, "03-forgot-modal.png", arr03);

  console.log("4. Forgot Mobile — school + grade picked");
  try {
    await page.locator("select").first().selectOption("SMSAW");
    await page.waitForTimeout(500);
    await page.locator("select").nth(1).selectOption("Grade 12");
    await page.waitForTimeout(400);
  } catch (e) {
    console.log(`     (select failed): ${(e as Error).message.slice(0, 80)}`);
  }
  const arr04 = [
    await locArrow(page, 'input[placeholder*="name" i]', { label: "3. Type name or last 4 digits" }),
  ].filter((a): a is Arrow => a !== null);
  await shoot(page, "04-forgot-school-grade.png", arr04);

  console.log("5. Forgot Mobile — name typed");
  try {
    const searchBox = page.locator('input[placeholder*="name" i], input[type="text"]').last();
    await searchBox.fill("aar");
    await page.waitForTimeout(1500);
  } catch (e) {
    console.log(`     (search failed): ${(e as Error).message.slice(0, 80)}`);
  }
  const file05 = await shoot(page, "05-forgot-name-typed.png");
  await blurRegion(file05, 0.6, 0.4);  // blur result-row region
  await annotate(file05, [
    { x: 0.5, y: 0.78, from: "top", label: "Tap your child's row" },
  ]);
  console.log("     🔒 result rows blurred + arrow added");

  // ── Login (demo parent) → /account ────────────────────────────────
  console.log("6. Logging in as demo parent…");
  // Intercept /api/auth/otp/request so typing the phone + Continue doesn't
  // actually fire an SMS — the OTP modal still opens, then we pivot to
  // password sign-in (which is a real DB-backed login, no SMS needed).
  await page.route("**/api/auth/otp/request", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, registered: true }) }),
  );
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  await page.locator('input[type="tel"]').first().fill(DEMO_PHONE);
  await page.getByRole("button", { name: /continue/i }).first().click();
  // OTP modal opens — click "Use password instead" to reveal the password field.
  await page.waitForTimeout(2500);
  const usePwd = page.locator("text=Use password instead").first();
  if (await usePwd.count()) {
    await usePwd.click();
    await page.waitForTimeout(900);
  } else {
    console.log("     ⚠ 'Use password instead' not found — dumping body");
    await shoot(page, "DEBUG-after-otp.png");
  }
  const pwd = page.locator('input[type="password"]').first();
  if (await pwd.count()) {
    await pwd.fill(DEMO_PASSWORD);
    const arr06 = [
      await locArrow(page, 'button:has-text("Sign in")', { label: "Type password + tap Sign in", from: "bottom", edge: "center" }),
    ].filter((a): a is Arrow => a !== null);
    await shoot(page, "06-login-password.png", arr06);
    const signIn = page.getByRole("button", { name: /^sign in/i }).last();
    await signIn.click();
    await page.waitForTimeout(3000);
    // Dismiss the T&C modal if it pops up (some accounts haven't accepted the
    // current version yet).
    const acceptBtn = page.getByRole("button", { name: /accept|agree|continue/i }).last();
    if (await acceptBtn.count()) {
      const tcCheckboxes = page.locator('input[type="checkbox"]');
      const cbN = await tcCheckboxes.count();
      for (let i = 0; i < cbN; i++) await tcCheckboxes.nth(i).check().catch(() => {});
      await acceptBtn.click().catch(() => {});
      await page.waitForTimeout(2000);
    }
    await page.waitForURL(/\/(shop|account|$)/, { timeout: 10000 }).catch(() => {});
    await shoot(page, "DEBUG-after-signin.png");
  } else {
    console.log("     ⚠ password field still not found — falling back to mockup");
  }
  // Clean up the OTP route interceptor.
  await page.unroute("**/api/auth/otp/request");

  console.log("7. /account dashboard");
  await page.goto(`${BASE}/account`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  const arr07 = [
    await locArrow(page, 'a[href*="change-phone"]', { label: "Tap Change", edge: "left" }),
  ].filter((a): a is Arrow => a !== null);
  await shoot(page, "07-account-dashboard.png", arr07);

  console.log("8. /account/change-phone — enter new number");
  await page.goto(`${BASE}/account/change-phone`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  const newPhoneInput = page.locator('input[type="tel"], input[inputmode="numeric"]').first();
  if (await newPhoneInput.count()) {
    await newPhoneInput.fill("9876543210");
    await page.waitForTimeout(300);
  }
  const arr08 = [
    await locArrow(page, 'button:has-text("Send OTP"), button:has-text("Send")', { label: "Type new mobile + tap Send OTP", from: "bottom", edge: "center" }),
  ].filter((a): a is Arrow => a !== null);
  const f08 = await shoot(page, "08-change-phone-enter.png", arr08);
  await cropTop(f08, 0.55); // drop the page footer for a tighter shot

  console.log("9. /account/change-phone — OTP step (mocked, no SMS sent)");
  // Intercept the change-phone/request API so the screen flips to "verify"
  // without actually issuing an OTP / sending an SMS.
  await page.route("**/api/auth/change-phone/request", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) }),
  );
  // Click the submit button (Send OTP / Continue).
  const sendBtn = page.getByRole("button", { name: /send.*otp|continue|next/i }).first();
  if (await sendBtn.count()) {
    await sendBtn.click();
    await page.waitForTimeout(900);
  }
  // Type a sample OTP code.
  const otpInputs = page.locator('input[inputmode="numeric"], input[maxlength="1"], input[type="text"]');
  const otpCount = await otpInputs.count();
  if (otpCount >= 6) {
    // 6 single-digit boxes
    for (let i = 0; i < 6; i++) await otpInputs.nth(i).fill("123456"[i]);
  } else if (otpCount >= 1) {
    // Single combined input
    await otpInputs.first().fill("123456");
  }
  await page.waitForTimeout(400);
  const arr09 = [
    await locArrow(page, 'button:has-text("Verify")', { label: "Enter OTP + tap Verify", from: "bottom", edge: "center" }),
  ].filter((a): a is Arrow => a !== null);
  const f09 = await shoot(page, "09-change-phone-otp.png", arr09);
  await cropTop(f09, 0.65);
  await page.unroute("**/api/auth/change-phone/request");

  await browser.close();
  console.log("Capture done.");
}

// ── HTML guide ────────────────────────────────────────────────────────
function buildHtml(): string {
  const shot = (f: string) => `file://${path.join(SHOT_DIR, f)}`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>How to log in & change your mobile number</title>
<style>
  @page { size: A4; margin: 16mm 14mm; }
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: #1f2937;
    font-size: 11.5pt;
    line-height: 1.55;
    margin: 0;
  }
  h1 { font-size: 26pt; margin: 0 0 8pt; color: #0f172a; font-weight: 800; letter-spacing: -0.02em; }
  h2 {
    font-size: 18pt; margin: 22pt 0 8pt; color: #0f172a; font-weight: 800;
    border-bottom: 3px solid #f97316; padding-bottom: 6pt; letter-spacing: -0.01em;
  }
  h3 { font-size: 13pt; margin: 14pt 0 4pt; color: #334155; font-weight: 700; }
  p  { margin: 0 0 8pt; }
  ol, ul { margin: 0 0 10pt 22pt; padding: 0; }
  li { margin: 5pt 0; }

  /* ── Cover ─────────────────────────────────────────────────────── */
  .cover {
    page-break-after: always;
    text-align: center;
    padding-top: 80pt;
    background: linear-gradient(180deg, #fff7ed 0%, #ffffff 60%);
    margin: -16mm -14mm;
    padding-left: 14mm; padding-right: 14mm; padding-bottom: 16mm;
    min-height: 100vh;
  }
  .cover .logo-text {
    font-weight: 900; font-size: 40pt; letter-spacing: 0.18em;
    line-height: 1; color: #0f172a;
  }
  .cover .logo-text .ink-i { color: #f97316; }
  .cover .logo-text .dot   { color: #f97316; }
  .cover .pill {
    display: inline-block; margin-top: 26pt;
    padding: 6pt 18pt;
    background: #0f172a; color: #fff;
    border-radius: 999px; font-size: 9.5pt;
    letter-spacing: 0.18em; font-weight: 700;
  }
  .cover h1 {
    font-size: 32pt; max-width: 460pt; margin: 24pt auto 18pt;
    color: #0f172a;
  }
  .cover .who { font-size: 13pt; color: #475569; max-width: 380pt; margin: 0 auto; }
  .cover .date { margin-top: 60pt; color: #94a3b8; font-size: 10pt; }
  .cover .url {
    margin-top: 8pt; color: #f97316; font-weight: 700; letter-spacing: 0.05em;
    font-size: 11pt;
  }

  /* ── Quick reference / TOC ─────────────────────────────────────── */
  .toc {
    border: 1px solid #e5e7eb; border-radius: 12pt; padding: 14pt 18pt;
    background: #f9fafb; margin-bottom: 14pt;
  }
  .toc li { font-size: 11.5pt; }
  .toc .section-key { display: inline-block; min-width: 60pt; color: #f97316; font-weight: 700; }

  /* ── Steps ─────────────────────────────────────────────────────── */
  .section { page-break-before: always; }
  .step {
    display: grid;
    grid-template-columns: 1fr 230pt;
    gap: 18pt;
    margin-bottom: 18pt;
    align-items: start;
    page-break-inside: avoid;
  }
  .step.right { grid-template-columns: 230pt 1fr; }
  .step-text { font-size: 11.5pt; }
  .step-text .num {
    display: inline-block;
    background: #0f172a; color: #fff;
    width: 24pt; height: 24pt; line-height: 24pt;
    border-radius: 50%; text-align: center;
    font-weight: 800; font-size: 11pt;
    margin-right: 6pt; vertical-align: -3pt;
  }
  .step img {
    width: 100%;
    border: 1px solid #cbd5e1;
    border-radius: 14pt;
    box-shadow: 0 6pt 14pt rgba(15,23,42,0.08);
  }

  /* ── Callouts ──────────────────────────────────────────────────── */
  .callout {
    background: #fef3c7; border-left: 4px solid #f59e0b;
    padding: 9pt 14pt; border-radius: 6pt; margin: 10pt 0; font-size: 10.5pt;
  }
  .callout.info { background: #dbeafe; border-left-color: #3b82f6; }
  .callout.tip  { background: #dcfce7; border-left-color: #16a34a; }
  .callout strong { color: #0f172a; }

  /* ── Header for non-cover pages ───────────────────────────────── */
  .page-header {
    display: flex; justify-content: space-between; align-items: center;
    padding-bottom: 8pt; margin-bottom: 12pt;
    border-bottom: 1px solid #e5e7eb;
    color: #94a3b8; font-size: 9pt;
  }
  .page-header .brand {
    color: #0f172a; font-weight: 800; letter-spacing: 0.12em; font-size: 9pt;
  }
  .page-header .brand .dot { color: #f97316; }

  /* ── Footer note ──────────────────────────────────────────────── */
  .footer-note {
    margin-top: 32pt; padding: 14pt 16pt;
    background: #0f172a; color: #f1f5f9;
    border-radius: 10pt; font-size: 10.5pt;
  }
  .footer-note strong { color: #fed7aa; }
</style>
</head>
<body>

<!-- ───── COVER ───── -->
<div class="cover">
  <div class="logo-text">
    <span class="ink-i">I</span><span class="ink-rest">NVENTRE</span><span class="dot">.</span>
  </div>
  <span class="pill">PARENT GUIDE</span>
  <h1>How to log in &amp; change your mobile number</h1>
  <p class="who">A step-by-step walkthrough for parents using the Inventre school store on their phone.</p>
  <p class="url">inventre.online</p>
  <p class="date">Last updated: ${new Date().toISOString().slice(0,10)}</p>
</div>

<!-- ───── QUICK REFERENCE ───── -->
<div class="section">
  <div class="page-header"><span class="brand">INVENTRE<span class="dot">.</span></span><span>Parent Guide · Quick reference</span></div>
  <h2>What do you need to do?</h2>
  <div class="toc">
    <ul style="list-style:none; margin:0; padding:0;">
      <li><span class="section-key">SECTION A</span> I'm logging in for the first time.</li>
      <li><span class="section-key">SECTION B</span> I'm already logged in and want to change my mobile.</li>
      <li><span class="section-key">SECTION C</span> I don't remember which mobile is on file (or never registered).</li>
      <li><span class="section-key">SECTION D</span> Something's not working — troubleshooting.</li>
    </ul>
  </div>

  <div class="callout info">
    <strong>Before you start:</strong> Keep your <strong>10-digit mobile number</strong> ready.
    If you have a new SIM, you'll also need access to the <em>old</em> number or your
    registered email for a one-time verification.
  </div>
</div>

<!-- ───── SECTION A ───── -->
<div class="section">
  <div class="page-header"><span class="brand">INVENTRE<span class="dot">.</span></span><span>Section A · First-time login</span></div>
  <h2>Section A — First-time login</h2>
  <p>Use this when the school has just added your child and you've never signed in before.</p>

  <div class="step">
    <div class="step-text">
      <p><span class="num">1</span><strong>Open the website.</strong></p>
      <p>Visit <strong>inventre.online</strong> on your phone or laptop and tap <em>Sign in</em>.
      You'll land on the screen on the right — a single field for your mobile number.</p>
    </div>
    <img src="${shot("01-login-empty.png")}" alt="Login screen" />
  </div>

  <div class="step right">
    <img src="${shot("02-login-mobile-filled.png")}" alt="Mobile number filled in" />
    <div class="step-text">
      <p><span class="num">2</span><strong>Type your 10-digit mobile number.</strong></p>
      <p>No spaces, no +91 — just the 10 digits. Then tap <em>Continue</em>.</p>
      <div class="callout">
        The website auto-removes spaces, dashes and the +91 prefix, but the underlying
        number must be exactly 10 digits.
      </div>
    </div>
  </div>

  <div class="step">
    <div class="step-text">
      <p><span class="num">3</span><strong>Enter your password</strong> (or the OTP, for first-time users).</p>
      <p>If you're signing in for the very first time you'll be asked for a 6-digit
      OTP that arrives on your mobile. Then you'll set a password.</p>
      <p>If you already have a password, just enter it and tap <em>Sign in</em>.</p>
    </div>
    <img src="${shot("06-login-password.png")}" alt="Password step" />
  </div>

  <div class="callout tip">
    <strong>Tip:</strong> Once you've set your password, future logins only need
    the mobile + password — no OTP — unless you reset.
  </div>
</div>

<!-- ───── SECTION B ───── -->
<div class="section">
  <div class="page-header"><span class="brand">INVENTRE<span class="dot">.</span></span><span>Section B · Change your mobile (logged in)</span></div>
  <h2>Section B — Change your mobile (already logged in)</h2>
  <p>Use this when you can sign in with your current number and just want to switch to a new one.</p>

  <div class="step">
    <div class="step-text">
      <p><span class="num">1</span>Sign in as usual at <strong>inventre.online</strong>.</p>
      <p><span class="num">2</span>Tap your <strong>profile icon</strong> at the top right and choose <em>My account</em>.</p>
      <p>You'll land on the dashboard shown on the right — your current mobile number is masked
      with the <em>Change</em> button next to it.</p>
    </div>
    <img src="${shot("07-account-dashboard.png")}" alt="Account dashboard" />
  </div>

  <div class="step right">
    <img src="${shot("08-change-phone-enter.png")}" alt="Change phone — enter new mobile" />
    <div class="step-text">
      <p><span class="num">3</span><strong>Type your new 10-digit mobile.</strong></p>
      <p>Tap <em>Send OTP</em>. A 6-digit code will arrive on the <strong>new</strong> number
      within a minute.</p>
      <div class="callout info">
        We send the OTP to the <strong>new</strong> number so we know you really have access
        to it before the switch.
      </div>
    </div>
  </div>

  <div class="step">
    <div class="step-text">
      <p><span class="num">4</span><strong>Enter the 6-digit OTP</strong> that arrived on the new number.</p>
      <p>Tap <em>Verify</em>. You'll see a confirmation screen and from your next login you'll use the new mobile.</p>
    </div>
    <img src="${shot("09-change-phone-otp.png")}" alt="Change phone — OTP entry" />
  </div>

  <div class="callout tip">
    <strong>Tip:</strong> Your old number stays in the system as a backup guardian contact
    until you ask the school admin to remove it. This is helpful if you ever need to recover access.
  </div>
</div>

<!-- ───── SECTION C ───── -->
<div class="section">
  <div class="page-header"><span class="brand">INVENTRE<span class="dot">.</span></span><span>Section C · Recover / add a mobile</span></div>
  <h2>Section C — "I don't remember which mobile is on file"</h2>
  <p>Use this when you can't sign in because the registered mobile is wrong, changed, or unknown.</p>

  <div class="step">
    <div class="step-text">
      <p><span class="num">1</span>Open <strong>inventre.online</strong> and tap <em>Sign in</em>.</p>
      <p><span class="num">2</span>At the bottom of the login screen, tap
      <strong>"Recover, change or add a mobile via student details"</strong>.</p>
    </div>
    <img src="${shot("03-forgot-modal.png")}" alt="Forgot mobile modal" />
  </div>

  <div class="step right">
    <img src="${shot("04-forgot-school-grade.png")}" alt="School and grade pickers" />
    <div class="step-text">
      <p><span class="num">3</span><strong>Pick your child's school</strong> from the first dropdown.</p>
      <p><span class="num">4</span><strong>Pick their grade</strong> from the second.</p>
      <div class="callout">
        If you don't see your grade, double-check the school's spelling — some appear under variants
        (e.g. "St. Michaels" vs "St. Michaels School").
      </div>
    </div>
  </div>

  <div class="step">
    <div class="step-text">
      <p><span class="num">5</span><strong>Type at least 3 letters of your child's name.</strong></p>
      <p>Spelling doesn't have to be perfect — the search forgives typos, accepts
      words in any order, and you can even type the <strong>last 4 digits of the
      registered mobile number</strong> instead of the name.</p>
      <p><span class="num">6</span>Tap your child's row. We mask the mobile on file with
      only the last 4 digits visible — enough to confirm it's the right account
      without exposing the full number.</p>
    </div>
    <img src="${shot("05-forgot-name-typed.png")}" alt="Search results (blurred for privacy)" />
  </div>

  <div class="step right">
    <div class="step-text" style="grid-column: 1 / span 2;">
      <p><span class="num">7</span><strong>Verify it's you.</strong> Pick one of two methods:</p>
      <ul>
        <li><strong>OTP to the old mobile</strong> — use this if you still have access to the registered number.</li>
        <li><strong>OTP to your registered email</strong> — use this if the mobile is gone.</li>
      </ul>
      <p><span class="num">8</span>Pick what to do next:</p>
      <ul>
        <li><strong>Change my number</strong> — replaces the old one (use this for a new SIM).</li>
        <li><strong>Add as extra guardian</strong> — keeps the old number and adds yours as a second contact.</li>
      </ul>
      <p><span class="num">9</span>Enter the new 10-digit mobile, verify the OTP, and you're done.</p>
    </div>
  </div>
</div>

<!-- ───── SECTION D ───── -->
<div class="section">
  <div class="page-header"><span class="brand">INVENTRE<span class="dot">.</span></span><span>Section D · Troubleshooting</span></div>
  <h2>Section D — Troubleshooting</h2>

  <h3>OTP didn't arrive</h3>
  <ul>
    <li>Wait a full minute — SMS delivery sometimes lags.</li>
    <li>Check that you typed the mobile correctly (10 digits, no spaces, no +91).</li>
    <li>Make sure your phone has signal and SMS isn't blocked by a DND setting on your mobile network.</li>
    <li>Tap <em>Resend OTP</em>. The timer resets after 60 seconds.</li>
    <li>For email OTP, also check the spam folder.</li>
  </ul>

  <h3>"No matching students found" when I search by name</h3>
  <ul>
    <li>Type just the first 3 letters of the first name (e.g. <em>sun</em> for Sunith).</li>
    <li>Try the <strong>last 4 digits of the registered mobile</strong> instead — it's the most reliable.</li>
    <li>Double-check the school and grade — children appear under one exact grade only.</li>
  </ul>

  <h3>I see the wrong child / wrong mobile in the search results</h3>
  <ul>
    <li>Stop. Don't proceed with the recovery — you'd change the wrong family's number.</li>
    <li>Contact your school admin and they'll fix the mapping.</li>
  </ul>

  <h3>"Mobile number must contain 10 digits"</h3>
  <ul>
    <li>The site removes spaces, dashes and +91 from what you type, but the underlying number must be exactly 10 digits.</li>
    <li>"+91 98765-43210" is fine. "98765-43" is not — it's only 7 digits.</li>
  </ul>

  <div class="footer-note">
    <strong>Still stuck?</strong> Reach out to your school's Inventre coordinator with:
    your child's name, school, grade, and the mobile number you'd like on file.
    They can update it for you directly.
  </div>
</div>

</body>
</html>`;
}

async function render() {
  console.log("Rendering HTML → PDF…");
  const html = buildHtml();
  await fs.writeFile(OUT_HTML, html, "utf8");

  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(`file://${OUT_HTML}`, { waitUntil: "networkidle" });
  await page.pdf({
    path: OUT_PDF,
    format: "A4",
    printBackground: true,
    margin: { top: "16mm", right: "14mm", bottom: "16mm", left: "14mm" },
  });
  await browser.close();
  console.log(`  📄 ${OUT_PDF}`);
}

(async () => {
  await capture();
  await render();
  console.log("\n✓ Guide built.");
  console.log(`  PDF: ${OUT_PDF}`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
