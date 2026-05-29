import { NextResponse } from "next/server";
import { requireAdmin, isResponse } from "@/lib/admin-guard";
import { buildGstr3b } from "@/lib/gstr3b";

export async function GET(req: Request) {
  const guard = await requireAdmin("super", "ops");
  if (isResponse(guard)) return guard;

  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const format = url.searchParams.get("format");

  if (!from || !to) {
    return NextResponse.json(
      { error: "from and to dates required" },
      { status: 400 }
    );
  }

  const doc = await buildGstr3b({ from, to });

  if (format === "json-download") {
    return new NextResponse(JSON.stringify(doc, null, 2), {
      headers: {
        "content-type": "application/json",
        "content-disposition": `attachment; filename="gstr3b-${doc.ret_period}.json"`,
      },
    });
  }

  return NextResponse.json(doc);
}
