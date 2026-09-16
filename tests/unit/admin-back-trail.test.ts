import { describe, expect, it } from "vitest";
import { recordVisit } from "@/components/admin/useAdminBackLink";

/**
 * The trail behind the admin "←" link. Each case is a navigation an admin
 * actually makes; the last-but-one entry of the result is where "←" points.
 */
describe("admin back-link trail", () => {
  it("a forward visit keeps the page it came from", () => {
    expect(recordVisit(["/admin/payments/ccavenue/9"], "/admin/customers/3", false)).toEqual([
      "/admin/payments/ccavenue/9",
      "/admin/customers/3",
    ]);
  });

  it("filter and page changes replace the list entry instead of becoming back steps", () => {
    let t = recordVisit([], "/admin/orders", false);
    t = recordVisit(t, "/admin/orders?statusBucket=confirmed", false);
    t = recordVisit(t, "/admin/orders?statusBucket=pending&page=2", false);
    expect(t).toEqual(["/admin/orders?statusBucket=pending&page=2"]);
  });

  it("list → record → ← returns to the filtered list and forgets the record", () => {
    const t = recordVisit(["/admin/orders?statusBucket=pending", "/admin/orders/SAL-1"], "/admin/orders?statusBucket=pending", true);
    expect(t).toEqual(["/admin/orders?statusBucket=pending"]);
  });

  it("the browser back button collapses the trail the same way", () => {
    const t = recordVisit(["/admin/dashboard", "/admin/orders", "/admin/orders/SAL-1"], "/admin/orders", false);
    expect(t).toEqual(["/admin/dashboard", "/admin/orders"]);
  });

  it("landing on a list after deleting one of its records never offers the deleted record", () => {
    const t = recordVisit(["/admin/orders?q=x", "/admin/orders/SAL-1"], "/admin/orders", false);
    expect(t).toEqual(["/admin/orders"]);
  });

  it("going UP with ← from a record opened in a fresh tab does not point back down to it", () => {
    expect(recordVisit(["/admin/orders/SAL-1"], "/admin/orders", true)).toEqual(["/admin/orders"]);
  });

  it("module → ← section keeps what came before the section", () => {
    const t = recordVisit(["/admin/dashboard", "/admin/sections/sales", "/admin/invoices"], "/admin/sections/sales", true);
    expect(t).toEqual(["/admin/dashboard", "/admin/sections/sales"]);
  });

  it("is idempotent, because React runs effects twice in development", () => {
    const forward = recordVisit(["/admin/orders"], "/admin/orders/SAL-1", false);
    expect(recordVisit(forward, "/admin/orders/SAL-1", false)).toEqual(forward);
    const up = recordVisit(["/admin/orders/SAL-1"], "/admin/orders", true);
    expect(recordVisit(up, "/admin/orders", false)).toEqual(up);
  });

  it("keeps at most 30 entries", () => {
    let t: string[] = [];
    for (let i = 0; i < 40; i++) t = recordVisit(t, `/admin/orders/SAL-${i}`, false);
    expect(t).toHaveLength(30);
    expect(t.at(-1)).toBe("/admin/orders/SAL-39");
  });
});
