import { NextResponse, type NextRequest } from "next/server";
import * as XLSX from "xlsx";
import {
  buildProductExportRows,
  PRODUCT_EXPORT_HEADER,
} from "@/server/product-export";
import { requireAnyPermission, isResponse } from "@/server/admin-guard";

export const dynamic = "force-dynamic";

/**
 * Excel (.xlsx) export of /admin/products — same filters as the list page,
 * every matching row (no pagination), variants expanded per size × colour.
 * Row-building lives in lib/product-export.ts.
 */
export async function GET(req: NextRequest) {
  const guard = await requireAnyPermission("products.read", "products.write", "catalog.read", "catalog.write");
  if (isResponse(guard)) return guard;

  const sp = req.nextUrl.searchParams;
  const filters = {
    q: sp.get("q") ?? "",
    status: sp.get("status") ?? "",
    schoolId: sp.get("schoolId") ?? "",
    grade: sp.get("grade") ?? "",
    erp: sp.get("erp") ?? "",
    kind: sp.get("kind") ?? "",
  };
  const { aoa, schoolCode, kindFilter } = await buildProductExportRows(filters);

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [
    { wch: 16 }, { wch: 42 }, { wch: 12 }, { wch: 18 }, { wch: 28 }, { wch: 18 },
    { wch: 10 }, { wch: 18 }, { wch: 11 }, { wch: 12 }, { wch: 24 }, { wch: 11 },
    { wch: 10 }, { wch: 8 },
  ];
  ws["!freeze"] = { xSplit: 0, ySplit: 1 };
  if (aoa.length > 1) {
    ws["!autofilter"] = {
      ref: XLSX.utils.encode_range({
        s: { r: 0, c: 0 },
        e: { r: aoa.length - 1, c: PRODUCT_EXPORT_HEADER.length - 1 },
      }),
    };
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Products");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

  const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
  const parts = ["products"];
  if (kindFilter !== "main") parts.push(kindFilter);
  if (schoolCode) parts.push(schoolCode);
  if (filters.grade) parts.push(filters.grade.replace(/\s+/g, "-"));
  if (filters.status) parts.push(filters.status);
  if (filters.q || filters.erp) parts.push("filtered");
  parts.push(today);

  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${parts.join("_")}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
