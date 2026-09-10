import { NextResponse } from "next/server";
import { isResponse, requirePermission } from "@/server/admin-guard";
import { applyImport, detectImporter, parseSpreadsheet, IMPORTERS } from "@/server/importers";

export const runtime = "nodejs";
export const maxDuration = 600; // 10 minutes — lots of rows possible

/**
 * POST multipart/form-data:
 *   file:        CSV or XLSX
 *   doctype:     (optional) override auto-detection — must match a known importer
 *   dryRun:      "1" → count only, no writes
 *   limit:       (optional) cap rows processed
 *
 * Returns: ImportSummary { total, new, updated, skipped, errors, errorDetails[] }
 */
export async function POST(req: Request) {
  const guard = await requirePermission("import.write");
  if (isResponse(guard)) return guard;

  const form = await req.formData();
  const file = form.get("file");
  const forceDoctype = (form.get("doctype") as string | null) ?? null;
  const dryRun = (form.get("dryRun") as string | null) === "1";
  const limitStr = form.get("limit") as string | null;
  const limit = limitStr ? parseInt(limitStr, 10) : undefined;

  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "no file uploaded" }, { status: 400 });
  }
  const buf = Buffer.from(await file.arrayBuffer());

  const { rows, headers } = parseSpreadsheet(buf, file.name);
  const importer = forceDoctype
    ? IMPORTERS.find((x) => x.doctype === forceDoctype)
    : detectImporter({ filename: file.name, headers });
  if (!importer) {
    return NextResponse.json(
      {
        error: "could not detect doctype — pass doctype field explicitly",
        availableDoctypes: IMPORTERS.map((x) => x.doctype),
      },
      { status: 400 }
    );
  }

  const summary = await applyImport(importer, rows, { dryRun, limit });
  return NextResponse.json(summary);
}
