import { NextResponse } from "next/server";
import { and, asc, desc, eq, gt, gte, ilike, isNotNull, lt, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db/client";
import {
  orders,
  parents,
  invoices,
  products,
  productVariants,
  bins,
  schools,
  websiteCartCoupons,
  students,
} from "@/db/schema";
import { requirePermission, isResponse } from "@/lib/admin-guard";

/**
 * Unified CSV export for admin list pages.
 *   GET /api/admin/export/orders
 *   GET /api/admin/export/customers
 *   GET /api/admin/export/invoices
 *   GET /api/admin/export/products
 *   GET /api/admin/export/stock
 */

function csvCell(v: unknown): string {
  if (v == null) return "";
  const s = String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function rowsToCsv(headers: string[], rows: (string | number | null | undefined)[][]) {
  const lines = [headers.map(csvCell).join(",")];
  for (const r of rows) lines.push(r.map(csvCell).join(","));
  return lines.join("\n");
}

function csvResponse(filename: string, body: string) {
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ type: string }> }
) {
  // Cross-area CSV export. Gated on reports.read because export is
  // semantically a reporting/extraction action; the page that triggers
  // an export (e.g. /admin/orders) is itself gated on its own .read perm.
  const guard = await requirePermission("reports.read");
  if (isResponse(guard)) return guard;
  const { type } = await params;
  const today = new Date().toISOString().slice(0, 10);
  const url = new URL(req.url);

  if (type === "orders") {
    const rows = await db
      .select({
        orderNumber: orders.orderNumber,
        status: orders.status,
        paymentStatus: orders.paymentStatus,
        total: orders.total,
        createdAt: orders.createdAt,
        parentName: parents.name,
        parentPhone: parents.phone,
      })
      .from(orders)
      .leftJoin(parents, eq(parents.id, orders.parentId))
      .orderBy(desc(orders.createdAt));
    const csv = rowsToCsv(
      ["Order #", "Status", "Payment", "Total (₹)", "Date", "Customer", "Phone"],
      rows.map((r) => [
        r.orderNumber,
        r.status,
        r.paymentStatus,
        Math.round((r.total ?? 0) / 100),
        r.createdAt?.toISOString?.() ?? "",
        r.parentName,
        r.parentPhone,
      ])
    );
    return csvResponse(`orders-${today}.csv`, csv);
  }

  if (type === "customers") {
    const rows = await db.select().from(parents).orderBy(desc(parents.createdAt));
    const csv = rowsToCsv(
      ["Name", "Phone", "Email", "Status", "Created"],
      rows.map((r) => [
        r.name,
        r.phone,
        r.email,
        r.status,
        r.createdAt?.toISOString?.() ?? "",
      ])
    );
    return csvResponse(`customers-${today}.csv`, csv);
  }

  if (type === "invoices") {
    const rows = await db
      .select({
        invoiceNumber: invoices.invoiceNumber,
        postingDate: invoices.postingDate,
        status: invoices.status,
        netTotal: invoices.netTotal,
        taxTotal: invoices.taxTotal,
        grandTotal: invoices.grandTotal,
        outstanding: invoices.outstandingAmount,
        parentName: parents.name,
        parentPhone: parents.phone,
      })
      .from(invoices)
      .leftJoin(parents, eq(parents.id, invoices.parentId))
      .orderBy(desc(invoices.postingDate));
    const csv = rowsToCsv(
      ["Invoice #", "Date", "Status", "Net (₹)", "Tax (₹)", "Total (₹)", "Outstanding (₹)", "Customer", "Phone"],
      rows.map((r) => [
        r.invoiceNumber,
        r.postingDate,
        r.status,
        Math.round((r.netTotal ?? 0) / 100),
        Math.round((r.taxTotal ?? 0) / 100),
        Math.round((r.grandTotal ?? 0) / 100),
        Math.round((r.outstanding ?? 0) / 100),
        r.parentName,
        r.parentPhone,
      ])
    );
    return csvResponse(`invoices-${today}.csv`, csv);
  }

  if (type === "products") {
    const rows = await db.select().from(products).orderBy(desc(products.createdAt));
    const csv = rowsToCsv(
      [
        "Item Code",
        "Name",
        "Slug",
        "Brand",
        "Status",
        "HSN",
        "GST",
        "Cost (₹)",
        "Base Price (₹)",
        "MRP (₹)",
      ],
      rows.map((r) => [
        r.itemCode,
        r.name,
        r.slug,
        r.brand,
        r.status,
        r.hsnCode,
        r.gstTreatment,
        r.costPrice != null ? Math.round(r.costPrice / 100) : null,
        Math.round(r.basePrice / 100),
        r.baseMrp != null ? Math.round(r.baseMrp / 100) : null,
      ])
    );
    return csvResponse(`products-${today}.csv`, csv);
  }

  if (type === "stock") {
    const rows = await db
      .select({
        sku: productVariants.sku,
        size: productVariants.size,
        productName: products.name,
        actualQty: bins.actualQty,
        reservedQty: bins.reservedQty,
        legacyStockQty: productVariants.stockQty,
      })
      .from(productVariants)
      .leftJoin(products, eq(products.id, productVariants.productId))
      .leftJoin(bins, eq(bins.variantId, productVariants.id));
    const csv = rowsToCsv(
      ["SKU", "Size", "Product", "Actual", "Reserved", "Available", "Legacy stockQty"],
      rows.map((r) => [
        r.sku,
        r.size,
        r.productName,
        r.actualQty ?? 0,
        r.reservedQty ?? 0,
        (r.actualQty ?? 0) - (r.reservedQty ?? 0),
        r.legacyStockQty,
      ])
    );
    return csvResponse(`stock-${today}.csv`, csv);
  }

  if (type === "coupons") {
    // Filter set mirrors /admin/discounts list filters so an admin can
    // export exactly the rows visible on screen.
    const term = (url.searchParams.get("q") ?? "").trim();
    const status = url.searchParams.get("status") ?? "";
    const couponType = url.searchParams.get("type") ?? "";
    const school = url.searchParams.get("school") ?? "";
    const codesOnly = url.searchParams.get("codesOnly") === "1";
    const now = new Date();

    const where: SQL[] = [];
    if (term) {
      where.push(
        or(
          ilike(websiteCartCoupons.couponCode, `%${term}%`),
          ilike(websiteCartCoupons.erpName, `%${term}%`),
        )!,
      );
    }
    if (status === "active") {
      where.push(eq(websiteCartCoupons.isActive, true));
      where.push(or(sql`${websiteCartCoupons.startDatetime} IS NULL`, lt(websiteCartCoupons.startDatetime, now))!);
      where.push(or(sql`${websiteCartCoupons.endDatetime} IS NULL`, gt(websiteCartCoupons.endDatetime, now))!);
    } else if (status === "inactive") {
      where.push(eq(websiteCartCoupons.isActive, false));
    } else if (status === "expired") {
      where.push(isNotNull(websiteCartCoupons.endDatetime));
      where.push(lt(websiteCartCoupons.endDatetime, now));
    } else if (status === "scheduled") {
      where.push(isNotNull(websiteCartCoupons.startDatetime));
      where.push(gte(websiteCartCoupons.startDatetime, now));
    } else if (status === "used") {
      where.push(gt(websiteCartCoupons.usedCount, 0));
    }
    if (couponType === "Fixed" || couponType === "Percentage") {
      where.push(eq(websiteCartCoupons.discountType, couponType));
    }
    if (school) {
      where.push(eq(websiteCartCoupons.schoolErpName, school));
    }

    const rows = await db
      .select({
        couponCode: websiteCartCoupons.couponCode,
        schoolName: schools.name,
        schoolErpName: websiteCartCoupons.schoolErpName,
        grade: websiteCartCoupons.grade,
        studentFirstName: students.firstName,
        studentLastName: students.lastName,
        discountType: websiteCartCoupons.discountType,
        discount: websiteCartCoupons.discount,
        cap: websiteCartCoupons.maximumDiscountAmount,
        oneTime: websiteCartCoupons.oneTimeUse,
        startDt: websiteCartCoupons.startDatetime,
        endDt: websiteCartCoupons.endDatetime,
        isActive: websiteCartCoupons.isActive,
        usedCount: websiteCartCoupons.usedCount,
        createdAt: websiteCartCoupons.createdAt,
      })
      .from(websiteCartCoupons)
      .leftJoin(schools, eq(schools.id, websiteCartCoupons.schoolId))
      .leftJoin(students, eq(students.id, websiteCartCoupons.studentId))
      .where(where.length ? and(...where) : undefined)
      .orderBy(asc(websiteCartCoupons.couponCode));

    if (codesOnly) {
      const csv = "coupon_code\n" + rows.map((r) => r.couponCode).join("\n") + "\n";
      return csvResponse(`coupon-codes-${today}.csv`, csv);
    }

    const csv = rowsToCsv(
      ["Coupon code", "School", "Grade", "Student", "Type", "Value", "Max cap (₹)", "One-time", "Valid from", "Valid until", "Active", "Uses"],
      rows.map((r) => [
        r.couponCode,
        r.schoolName ?? r.schoolErpName ?? "Universal",
        r.grade ?? "",
        [r.studentFirstName, r.studentLastName].filter(Boolean).join(" ").trim(),
        r.discountType,
        r.discountType === "Percentage" ? `${r.discount}%` : `₹${r.discount}`,
        r.cap ? Math.round(r.cap / 100) : "",
        r.oneTime ? "yes" : "no",
        r.startDt?.toISOString?.() ?? "",
        r.endDt?.toISOString?.() ?? "",
        r.isActive ? "yes" : "no",
        r.usedCount,
      ])
    );
    return csvResponse(`coupons-${today}.csv`, csv);
  }

  if (type === "schools") {
    const rows = await db.select().from(schools);
    const csv = rowsToCsv(
      ["Slug", "Name", "City", "State"],
      rows.map((r) => [r.slug, r.name, r.city, r.state])
    );
    return csvResponse(`schools-${today}.csv`, csv);
  }

  return NextResponse.json({ error: "Unknown export type" }, { status: 400 });
}
