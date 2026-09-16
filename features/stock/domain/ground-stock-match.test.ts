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
  it("fans a keeper row out to every legacy code it replaced or covers", () => {
    const m = keeperRowsToFigures([
      {
        keeper_sku: "RUPPRPRSCDGNSOCKKL-2XL",
        school_name: "KLINK-Kidlink School",
        school_code: "KLINK",
        qty: 42,
        old_skus: ["KLS SocksC2XL$"],
        covers_codes: ["KLS Sports SocksC2XL$"],
        snapshot_at: "2026-09-10T11:54:42",
      },
    ]);
    expect([...m.keys()].sort()).toEqual(["KLS SocksC2XL$", "KLS Sports SocksC2XL$"]);
    const f = m.get("KLS SocksC2XL$")!;
    expect(f.available).toBe(42);
    expect(f.keeperSku).toBe("RUPPRPRSCDGNSOCKKL-2XL");
    expect(f.schoolCode).toBe("KLINK");
    expect(f.snapshotAt).toBe("2026-09-10T11:54:42");
  });

  it("a zero or negative pile is sold out; a duplicated code keeps the larger pile", () => {
    const m = keeperRowsToFigures([
      { keeper_sku: "A", qty: -3, old_skus: ["X"] },
      { keeper_sku: "B", qty: 5, old_skus: ["Y"] },
      { keeper_sku: "C", qty: 2, old_skus: ["Y"] },
      { keeper_sku: "D", qty: "7.9", old_skus: [" ", null as unknown as string, "Z"] },
    ]);
    expect(m.get("X")!.available).toBe(0);
    expect(m.get("X")!.rawAvailable).toBe(-3);
    expect(m.get("Y")!.available).toBe(5);
    expect(m.get("Y")!.keeperSku).toBe("B");
    expect(m.get("Z")!.available).toBe(7);
    expect(m.size).toBe(3);
  });
});
