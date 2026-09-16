import { describe, expect, it } from "vitest";
import { DEFAULT_PER_PAGE, pageMeta, readPaging, withPaging } from "@/lib/admin-paging";

describe("readPaging", () => {
  it("defaults to page 1 at the default page size", () => {
    expect(readPaging({})).toEqual({ page: 1, perPage: DEFAULT_PER_PAGE, offset: 0 });
  });

  it("computes the offset from page and perPage", () => {
    expect(readPaging({ page: "3", perPage: "25" })).toEqual({ page: 3, perPage: 25, offset: 50 });
  });

  it("rejects junk and out-of-range values instead of passing them to SQL", () => {
    expect(readPaging({ page: "-4", perPage: "100000" })).toEqual({
      page: 1,
      perPage: DEFAULT_PER_PAGE,
      offset: 0,
    });
    expect(readPaging({ page: "abc", perPage: "7" }).page).toBe(1);
    expect(readPaging({ page: ["2", "9"] }).page).toBe(2);
  });
});

describe("pageMeta", () => {
  it("states the record range of a middle page", () => {
    expect(pageMeta(1628, { page: 2, perPage: 50, offset: 50 })).toEqual({ pages: 33, from: 51, to: 100 });
  });

  it("clips the last page to the total", () => {
    expect(pageMeta(1628, { page: 33, perPage: 50, offset: 1600 })).toEqual({ pages: 33, from: 1601, to: 1628 });
  });

  it("reports one empty page for zero rows", () => {
    expect(pageMeta(0, { page: 1, perPage: 50, offset: 0 })).toEqual({ pages: 1, from: 0, to: 0 });
  });
});

describe("withPaging", () => {
  it("keeps filters and omits defaults", () => {
    expect(withPaging("/admin/discounts?status=active", 1, DEFAULT_PER_PAGE)).toBe("/admin/discounts?status=active");
    expect(withPaging("/admin/discounts?status=active", 3, 25)).toBe(
      "/admin/discounts?status=active&page=3&perPage=25"
    );
  });

  it("replaces an existing page rather than appending a second one", () => {
    expect(withPaging("/admin/catalog/bundles?page=4", 5, DEFAULT_PER_PAGE)).toBe("/admin/catalog/bundles?page=5");
    expect(withPaging("/admin/catalog/bundles?page=4&perPage=100", 1, DEFAULT_PER_PAGE)).toBe("/admin/catalog/bundles");
  });
});
