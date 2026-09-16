import { describe, expect, it } from "vitest";
import {
  aggregateGroundStock,
  keeperRowsToFigures,
  matchItemCodes,
  normalizeItemCode,
} from "./ground-stock-match";

describe("aggregateGroundStock", () => {
  it("sums a code that appears under two scopes and clamps below zero", () => {
    const m = aggregateGroundStock([
      { item_code: "KLS SocksC2XL$", school_name: "KLINK-Kidlink School", available: 4, counted: 10, packed_out: 6, snapshot_at: "2026-09-10T08:00:00" },
      { item_code: "KLS SocksC2XL$", school_name: "General merch", available: -9, counted: 0, packed_out: 9, snapshot_at: "2026-09-12T08:00:00" },
      { item_code: "QLS TieD12$$", available: "3.0" },
    ]);
    const socks = m.get("KLS SocksC2XL$")!;
    expect(socks.rawAvailable).toBe(-5);
    expect(socks.available).toBe(0);
    expect(socks.counted).toBe(10);
    expect(socks.packedOut).toBe(15);
    expect(socks.schoolName).toBe("KLINK-Kidlink School");
    expect(socks.snapshotAt).toBe("2026-09-12T08:00:00");
    expect(m.get("QLS TieD12$$")!.available).toBe(3);
  });

  it("ignores blank codes and non-numeric figures", () => {
    const m = aggregateGroundStock([
      { item_code: "  ", available: 5 },
      { item_code: "X", available: null, counted: "abc" },
    ]);
    expect(m.size).toBe(1);
    expect(m.get("X")!.available).toBe(0);
  });
});

describe("normalizeItemCode", () => {
  it("folds case, spaces, hyphens, $ padding and the CELES- prefix", () => {
    expect(normalizeItemCode("SAS BP Sports T-Shirt C40$$")).toBe("SASBPSPORTSTSHIRTC40");
    expect(normalizeItemCode("CELES-HOODIE-26")).toBe("HOODIE26");
    expect(normalizeItemCode("HOODIE-26")).toBe("HOODIE26");
  });
});

describe("matchItemCodes", () => {
  const variants = [
    { id: "v1", sku: "KLS Boys ShirtJ32$$", erpName: null },
    { id: "v2", sku: "SMS Grade 5 Bookkit", erpName: "SMS Grade 5 Bookkit" },
    { id: "v3", sku: "HOODIE-26", erpName: null },
    { id: "v4", sku: "SAS BP Sports TShirtC40$$", erpName: null },
    { id: "v5", sku: "SAS BP Sports T-ShirtC40$$", erpName: null },
    { id: "v6", sku: "OLD-CODE", erpName: "YIPS Socks7$$$$" },
  ];

  it("matches by exact SKU first, then by mirrored ERP name", () => {
    const r = matchItemCodes(["KLS Boys ShirtJ32$$", "YIPS Socks7$$$$"], variants);
    expect(r.matches).toEqual([
      { variantId: "v1", itemCode: "KLS Boys ShirtJ32$$", matchKind: "sku" },
      { variantId: "v6", itemCode: "YIPS Socks7$$$$", matchKind: "erp_name" },
    ]);
    expect(r.unmatched).toEqual([]);
  });

  it("falls back to the normalised key only when it is unique", () => {
    const r = matchItemCodes(["CELES-HOODIE-26", "SAS BP Sports T-Shirt C40$$"], variants);
    expect(r.matches).toEqual([
      { variantId: "v3", itemCode: "CELES-HOODIE-26", matchKind: "normalized" },
    ]);
    // v4 and v5 both normalise to the same key — never guessed.
    expect(r.unmatched).toEqual(["SAS BP Sports T-Shirt C40$$"]);
    expect(r.ambiguous).toEqual(["SAS BP Sports T-Shirt C40$$"]);
  });

  it("never gives one variant two item codes", () => {
    const r = matchItemCodes(["HOODIE-26", "CELES-HOODIE-26"], variants);
    expect(r.matches.map((m) => m.itemCode)).toEqual(["HOODIE-26"]);
    expect(r.unmatched).toEqual(["CELES-HOODIE-26"]);
  });

  it("exact beats normalised regardless of arrival order", () => {
    const r = matchItemCodes(["CELES-HOODIE-26", "HOODIE-26"], variants);
    expect(r.matches).toEqual([{ variantId: "v3", itemCode: "HOODIE-26", matchKind: "sku" }]);
    expect(r.unmatched).toEqual(["CELES-HOODIE-26"]);
  });

  it("reports codes nothing answers to", () => {
    const r = matchItemCodes(["SAS BP Belt", ""], variants);
    expect(r.matches).toEqual([]);
    expect(r.unmatched).toEqual(["SAS BP Belt"]);
  });
});

describe("keeperRowsToFigures — Ground Stock (New)", () => {
  it("takes the page's Avail. (gs_available) for every legacy code on a linked row, never the keeper qty", () => {
    // SMS Grade 6 Girls Pant M22 on 2026-09-16: keeper qty 113 (shared pile),
    // page Avail. 2 for St Michaels and 117 for Winmore Jakkur.
    const m = keeperRowsToFigures([
      { keeper_sku: "RUSCHSGBLUFP-22", school_code: "SMSAW", school_name: "SMSAW-St. Michaels School", qty: 113, gs_linked: true, gs_stock: 2, gs_packed: 0, gs_available: 2, gs_snapshot_at: null, snapshot_at: "2026-08-18T17:23:32", old_skus: ["SMS Grade 6 Girls PantM22$$"], covers_codes: ["SMSAW", "WMAJK"] },
      { keeper_sku: "RUSCHSGBLUFP-22", school_code: "WMAJK", school_name: "WMAJK-Winmore Academy Jakkur", qty: 113, gs_linked: true, gs_stock: 117, gs_packed: 0, gs_available: 117, gs_snapshot_at: "2026-07-21T10:30:30", old_skus: ["WM JK Girls PantM22$$"], covers_codes: ["WMAJK", "SMSAW"] },
    ]);
    expect(m.get("SMS Grade 6 Girls PantM22$$")!.available).toBe(2);
    expect(m.get("SMS Grade 6 Girls PantM22$$")!.snapshotAt).toBe("2026-08-18T17:23:32");
    expect(m.get("WM JK Girls PantM22$$")!.available).toBe(117);
    expect(m.get("WM JK Girls PantM22$$")!.counted).toBe(117);
    expect(m.get("WM JK Girls PantM22$$")!.snapshotAt).toBe("2026-07-21T10:30:30");
    expect(m.get("SMS Grade 6 Girls PantM22$$")!.keeperSku).toBe("RUSCHSGBLUFP-22");
  });

  it("an unlinked row (the page prints a dash) yields no figure at all", () => {
    const m = keeperRowsToFigures([
      { keeper_sku: "A", qty: 50, gs_linked: false, gs_available: null, old_skus: ["X"] },
    ]);
    expect(m.size).toBe(0);
  });

  it("a zero or negative Avail. is sold out; a duplicated code keeps the larger figure", () => {
    const m = keeperRowsToFigures([
      { keeper_sku: "A", gs_linked: true, gs_available: -3, old_skus: ["X"] },
      { keeper_sku: "B", gs_linked: true, gs_available: 5, old_skus: ["Y"] },
      { keeper_sku: "C", gs_linked: true, gs_available: 2, old_skus: ["Y"] },
      { keeper_sku: "D", gs_linked: true, gs_available: "7.9", old_skus: [" ", null as unknown as string, "Z"] },
    ]);
    expect(m.get("X")!.available).toBe(0);
    expect(m.get("X")!.rawAvailable).toBe(-3);
    expect(m.get("Y")!.available).toBe(5);
    expect(m.get("Y")!.keeperSku).toBe("B");
    expect(m.get("Z")!.available).toBe(7);
    expect(m.size).toBe(3);
  });
});
