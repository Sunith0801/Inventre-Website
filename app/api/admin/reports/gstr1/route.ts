import { NextResponse } from "next/server";
import { isResponse, requirePermission } from "@/lib/admin-guard";
import { buildGstr1 } from "@/lib/gstr1";

/**
 * GET /api/admin/reports/gstr1?from=YYYY-MM-DD&to=YYYY-MM-DD
 * Returns the GSTR-1 JSON payload (GSTN portal v2.1 shape).
 *
 * Pass `format=json-download` to receive it as a downloadable .json file.
 */
export async function GET(req: Request) {
  const guard = await requirePermission("reports.read");
  if (isResponse(guard)) return guard;

  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const format = url.searchParams.get("format");

  if (!from || !to) {
    return NextResponse.json(
      { error: "from and to dates required (YYYY-MM-DD)" },
      { status: 400 }
    );
  }

  const doc = await buildGstr1({ from, to });

  if (format === "json-download") {
    return new NextResponse(JSON.stringify(doc, null, 2), {
      headers: {
        "content-type": "application/json",
        "content-disposition": `attachment; filename="gstr1-${doc.fp}.json"`,
      },
    });
  }

  return NextResponse.json(doc);
}
