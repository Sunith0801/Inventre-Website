import { NextResponse } from "next/server";
import { isResponse, requirePermission } from "@/lib/admin-guard";
import { detectImporter, parseSpreadsheet, IMPORTERS } from "@/lib/importers";

export const runtime = "nodejs"; // need Buffer
export const maxDuration = 60;

/**
 * POST multipart/form-data with one field "file" (CSV or XLSX).
 * Returns: { doctype, totalRows, headers, sample (first 10 rows), suggestedImporter }
 *
 * Optional: ?force=Customer in querystring to override auto-detection.
 */
export async function POST(req: Request) {
  const guard = await requirePermission("import.write");
  if (isResponse(guard)) return guard;

  const url = new URL(req.url);
  const forceDoctype = url.searchParams.get("force");

  const form = await req.formData();
  const file = form.get("file");
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "no file uploaded" }, { status: 400 });
  }
  const buf = Buffer.from(await file.arrayBuffer());

  let rows: Record<string, unknown>[];
  let headers: string[];
  try {
    const out = parseSpreadsheet(buf, file.name);
    rows = out.rows;
    headers = out.headers;
  } catch (e) {
    return NextResponse.json(
      { error: `parse failed: ${e instanceof Error ? e.message : String(e)}` },
      { status: 400 }
    );
  }

  const detected = forceDoctype
    ? IMPORTERS.find((x) => x.doctype === forceDoctype) ?? null
    : detectImporter({ filename: file.name, headers });

  return NextResponse.json({
    filename: file.name,
    fileSize: buf.length,
    headers,
    totalRows: rows.length,
    sample: rows.slice(0, 10),
    detectedDoctype: detected?.doctype ?? null,
    availableDoctypes: IMPORTERS.map((x) => x.doctype),
  });
}
