import { NextResponse, type NextRequest } from "next/server";
import { asc, desc, ilike, or, sql, type SQL } from "drizzle-orm";
import * as XLSX from "xlsx";
import { db } from "@/db/client";
import { masterEntity, type MasterColumn } from "@/lib/master-data";
import { requireAnyPermission, isResponse } from "@/server/admin-guard";

export const dynamic = "force-dynamic";

// Excel export of one Master Data table. Same search + sort contract as the
// browser page (q / sort / dir) but every matching row and every field, so a
// filtered view can be handed to someone outside the admin as a sheet.

// A mis-filtered export must not try to put the whole student master into one
// workbook in a single request.
const MAX_ROWS = 50_000;

function cellValue(col: MasterColumn, v: unknown): string | number | boolean | null {
  if (v === null || v === undefined || v === "") return null;
  switch (col.kind) {
    case "bool":
      return v ? "Yes" : "No";
    case "date": {
      const d = new Date(v as string);
      return Number.isNaN(d.getTime()) ? String(v) : d.toISOString().slice(0, 10);
    }
    case "number":
      return Number(v);
    case "list":
      return (Array.isArray(v) ? v : [v]).map(String).join(", ");
    case "json":
      return JSON.stringify(v);
    default:
      return String(v);
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ entity: string }> }) {
  const { entity: key } = await params;
  const entity = masterEntity(key);
  if (!entity) return NextResponse.json({ error: "Unknown master table" }, { status: 404 });

  const guard = await requireAnyPermission(`${entity.slug}.read`, `${entity.slug}.write`);
  if (isResponse(guard)) return guard;

  const sp = req.nextUrl.searchParams;
  const q = sp.get("q")?.trim() || undefined;
  const sortCol = entity.columns.find((c) => c.key === sp.get("sort")) ?? null;
  const dir = sp.get("dir") === "desc" ? "desc" : "asc";

  const searchable = entity.columns.filter((c) => c.search);
  const where: SQL | undefined = q ? or(...searchable.map((c) => ilike(sql`${c.col}::text`, `%${q}%`))) : undefined;
  const orderCol = sortCol?.col ?? entity.orderBy;

  const rows = await db
    .select(Object.fromEntries(entity.columns.map((c) => [c.key, c.col])))
    .from(entity.table)
    .where(where)
    .orderBy(dir === "desc" ? desc(orderCol) : asc(orderCol))
    .limit(MAX_ROWS);

  const header = entity.columns.map((c) => c.label);
  const data = rows.map((r) => entity.columns.map((c) => cellValue(c, (r as Record<string, unknown>)[c.key])));
  const ws = XLSX.utils.aoa_to_sheet([header, ...data]);
  ws["!cols"] = entity.columns.map((c) => ({ wch: Math.min(40, Math.max(10, c.label.length + 4)) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, entity.label.slice(0, 31));
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="master-${entity.key}-${stamp}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
