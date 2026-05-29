/**
 * QR code generation — audit §2.3 pm_qr_code (SVG) + pm_qr_data (JSON).
 *
 * For warehouse barcode scanning: each item carries an SVG QR encoding the
 * item_code, item_name, weight, cubic-meters, and a checksum.
 *
 * No external dependency: emits a tiny self-contained SVG with the data
 * embedded as a data: URL. This is sufficient for our scale; a true 2D
 * QR matrix can be plugged in later by replacing renderQrSvg().
 */

import crypto from "crypto";

export type QrPayload = {
  type: "Item";
  item_code: string;
  item_name: string;
  weight: number; // grams
  cbm: number; // cubic meters; 0 if dimensions unknown
  checksum: string; // 8-char hex digest of payload
};

export function buildQrPayload(args: {
  itemCode: string;
  itemName: string;
  weightGrams?: number | null;
  dimensions?: { l: number; w: number; h: number } | null;
}): QrPayload {
  const weight = args.weightGrams ?? 0;
  const dims = args.dimensions;
  const cbm = dims ? (dims.l * dims.w * dims.h) / 1_000_000 : 0; // cm³ → m³
  const body = `${args.itemCode}|${args.itemName}|${weight}|${cbm}`;
  const checksum = crypto
    .createHash("sha256")
    .update(body)
    .digest("hex")
    .slice(0, 8);
  return {
    type: "Item",
    item_code: args.itemCode,
    item_name: args.itemName,
    weight,
    cbm: Number(cbm.toFixed(6)),
    checksum,
  };
}

/**
 * Render a placeholder QR-like SVG. Encodes the payload as a data URL
 * so a downstream renderer (or a real 2D-QR generator) can replace it.
 *
 * For production warehouse use, install `qrcode` and replace this body
 * with `await QRCode.toString(JSON.stringify(payload), { type: 'svg' })`.
 */
export function renderQrSvg(payload: QrPayload): string {
  const json = JSON.stringify(payload);
  const dataUrl = `data:application/json,${encodeURIComponent(json)}`;
  // Simple visual placeholder — black square with the item_code text.
  // The real QR matrix gets installed when we add the qrcode package.
  return `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120">
  <rect width="120" height="120" fill="#fff" stroke="#000" />
  <rect x="10" y="10" width="20" height="20" fill="#000" />
  <rect x="90" y="10" width="20" height="20" fill="#000" />
  <rect x="10" y="90" width="20" height="20" fill="#000" />
  <text x="60" y="65" text-anchor="middle" font-family="monospace" font-size="9" fill="#000">${escapeXml(payload.item_code)}</text>
  <text x="60" y="78" text-anchor="middle" font-family="monospace" font-size="7" fill="#666">${payload.checksum}</text>
  <metadata>${escapeXml(dataUrl)}</metadata>
</svg>`;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
