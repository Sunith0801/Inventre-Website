import { chromium } from "/root/Inventre/node_modules/playwright/index.mjs";
import path from "node:path";
const [,, input, output] = process.argv;
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto("file://" + path.resolve(input), { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
await page.pdf({
  path: output, format: "A4", printBackground: true, preferCSSPageSize: true,
  displayHeaderFooter: true,
  headerTemplate: `<div style="width:100%;font-family:Inter,Liberation Sans,sans-serif;font-size:8.5px;color:#8A8A8A;padding:0 14mm;display:flex;justify-content:space-between;"><span class="title"></span><span>Inventre · Confidential</span></div>`,
  footerTemplate: `<div style="width:100%;font-family:Inter,Liberation Sans,sans-serif;font-size:8.5px;color:#8A8A8A;padding:0 14mm;display:flex;justify-content:space-between;"><span>© 2026 Inventre · Engineering</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`,
  margin: { top: "18mm", bottom: "16mm", left: "14mm", right: "14mm" },
});
await browser.close();
console.log("wrote", output);
