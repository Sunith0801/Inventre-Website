import { NextResponse, type NextRequest } from "next/server";
import * as XLSX from "xlsx";
import {
  buildProductPriceList,
  PRICE_LIST_ALL_HEADER,
  PRICE_LIST_COL_WIDTHS,
  PRICE_LIST_HEADER,
} from "@/lib/product-price-list";
import { requireAnyPermission, isResponse } from "@/server/admin-guard";

export const dynamic = "force-dynamic";

/**
 * Excel (.xlsx) price list for /admin/products — same filters as the list
 * page, but ONE SHEET PER SCHOOL, each row a school × grade × SKU price.
 * Row-building lives in lib/product-price-list.ts.
 */
export async function GET(req: NextRequest) {
  const guard = await requireAnyPermission("catalog-pricing.read", "catalog-pricing.write", "catalog.read", "catalog.write");
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
  const { sheets, schoolCode, kindFilter } = await buildProductPriceList(filters);

  const wb = XLSX.utils.book_new();
  for (const sheet of sheets) {
    const wide = sheet.aoa[0]?.length === PRICE_LIST_ALL_HEADER.length;
    const ws = XLSX.utils.aoa_to_sheet(sheet.aoa);
    ws["!cols"] = wide
      ? [{ wch: 14 }, { wch: 30 }, ...PRICE_LIST_COL_WIDTHS]
      : PRICE_LIST_COL_WIDTHS;
    ws["!freeze"] = { xSplit: 0, ySplit: 1 };
    if (sheet.aoa.length > 1) {
      ws["!autofilter"] = {
        ref: XLSX.utils.encode_range({
          s: { r: 0, c: 0 },
          e: {
            r: sheet.aoa.length - 1,
            c: (wide ? PRICE_LIST_ALL_HEADER : PRICE_LIST_HEADER).length - 1,
          },
        }),
      };
    }
    XLSX.utils.book_append_sheet(wb, ws, sheet.name);
  }
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

  const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
  const parts = ["price-list"];
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
