import { describe, expect, it } from "vitest";
import {
  aggregateGroundStock,
  indexKeeperMap,
  keeperRowsToFigures,
  matchItemCodes,
  matchMerchandiseByName,
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

describe("keeperRowsToFigures — shared General Merchandise via the keeper map", () => {
  const keeperMap = indexKeeperMap([
    { old_sku: "SAS BP ShoesI10S$", keeper_sku: "BLSHOE-10S", school_code: "SASBP" },
    { old_sku: "SMS ShoesI10S$", keeper_sku: "BLSHOE-10S", school_code: "SMSAW" },
    { old_sku: "KIDLINK SHOESI10S$$", keeper_sku: "BLSHOE-10S", school_code: "KLINK" },
    { old_sku: "SMS Grade 6 Girls PantM22$$", keeper_sku: "RUSCHSGBLUFP-22", school_code: "SMSAW" },
    { old_sku: "WM JK Girls PantM22$$", keeper_sku: "RUSCHSGBLUFP-22", school_code: "WMAJK" },
    { old_sku: "", keeper_sku: "X", school_code: "SMSAW" },
  ]);

  it("an All-schools row with no old_skus fans out to every school's code with the shared Avail.", () => {
    const m = keeperRowsToFigures(
      [{ keeper_sku: "BLSHOE-10S", keeper_description: "Black 10S Shoes", school_code: "ALL", school_name: "All schools", all_schools: true, qty: 329, gs_linked: true, gs_available: 312, old_skus: [], covers_codes: ["KLINK", "SASBP", "SMSAW"] }],
      keeperMap
    );
    expect(m.get("SAS BP ShoesI10S$")!.available).toBe(312);
    expect(m.get("SMS ShoesI10S$")!.available).toBe(312);
    expect(m.get("KIDLINK SHOESI10S$$")!.available).toBe(312);
    expect(m.get("SAS BP ShoesI10S$")!.keeperSku).toBe("BLSHOE-10S");
    expect(m.get("SAS BP ShoesI10S$")!.keeperDescription).toBe("Black 10S Shoes");
  });

  it("a per-school row only takes the map's codes for its own school", () => {
    const m = keeperRowsToFigures(
      [{ keeper_sku: "RUSCHSGBLUFP-22", school_code: "SMSAW", gs_linked: true, gs_available: 2, old_skus: [] }],
      keeperMap
    );
    expect(m.get("SMS Grade 6 Girls PantM22$$")!.available).toBe(2);
    expect(m.has("WM JK Girls PantM22$$")).toBe(false);
  });

  it("bags and bottles are one shelf: school rows fold into All schools with the largest figure", () => {
    const m = keeperRowsToFigures(
      [
        { keeper_sku: "PPRCRIBAG-S", merch_group: "General Merchandise", category: "Bags", school_code: "SMSAW", school_name: "SMSAW-St. Michaels School", gs_linked: true, gs_available: 0, old_skus: ["SMS PP BagS$$"] },
        { keeper_sku: "PPRCRIBAG-S", merch_group: "General Merchandise", category: "Bags", school_code: "SASAND", school_name: "SASAND", gs_linked: true, gs_available: 57, old_skus: ["SAS BP PP BagS$$", "SAS KS PP BagS$$"] },
        { keeper_sku: "PPRCRIBAG-S", merch_group: "General Merchandise", category: "Bags", school_code: "TSUSC", school_name: "TSUSC", gs_linked: false, gs_available: null, old_skus: ["TSUSC BagS$$"] },
      ],
      indexKeeperMap([{ old_sku: "WM JK PP BagS$$", keeper_sku: "PPRCRIBAG-S", school_code: "WMAJK" }])
    );
    for (const code of ["SMS PP BagS$$", "SAS BP PP BagS$$", "SAS KS PP BagS$$", "TSUSC BagS$$", "WM JK PP BagS$$"]) {
      expect(m.get(code)!.available).toBe(57);
      expect(m.get(code)!.schoolName).toBe("All schools");
    }
  });

  it("works without a map (old_skus only) and ignores blank map entries", () => {
    expect(keeperMap.has("X")).toBe(false);
    const m = keeperRowsToFigures([{ keeper_sku: "BLSHOE-10S", all_schools: true, gs_linked: true, gs_available: 5, old_skus: [] }]);
    expect(m.size).toBe(0);
  });
});

describe("matchMerchandiseByName — all-school bags and bottles", () => {
  const fig = (keeperSku: string, keeperDescription: string, keeperCategory: string) => ({
    itemCode: keeperSku, keeperSku, keeperDescription, keeperCategory, keeperGroup: "General Merchandise",
    schoolCode: null, schoolName: "All schools", available: 1, rawAvailable: 1, counted: 1, packedOut: 0, snapshotAt: null,
  });
  const figures = [
    fig("PPRDCHARMBAG-S", "Pre-Primary Dino Charm Bag-Small Size", "Bags"),
    fig("PRDRUNICORNBLACKBAG-M", "Primary Dreamy Unicorn Black Bag- M Size", "Bags"),
    fig("PRDRUNICORNNBLUEBAG-M", "Primary Dreamy Unicorn Navy Blue Bag- M Size", "Bags"),
    fig("PRIDRUNICORNTURQBAG-M", "Primary Dreamy Unicorn Turquiose Bag- M Size", "Bags"),
    fig("PRIRAREXNBLUEBAG-M", "Primary Racing Rex Navy Blue Bag- M Size", "Bags"),
    fig("PRIRAREXSBLUEBAG-M", "Primary Racing Rex Sky Blue Bag- M Size", "Bags"),
    fig("PRPIPARADISEPURPLEBAG-M", "Primary Pink Paradise Navy Purple Bag- M Size", "Bags"),
    fig("PRISPADVENTUREBLACKBAG-M", "Primary Space Adevnture Black Bag- M Size", "Bags"),
    fig("PRISPADVENTURENBLUEBAG-M", "Primary Space Adevnture Navy Blue Bag- M Size", "Bags"),
    fig("PRISPAADVENTURESBLUEBAG-M", "Primary Space Adventure Sky Blue Bag- M Size", "Bags"),
    fig("SCCLASSICBAGCRI-L", "Secondary Crimson Classic Bag-L: Crimson Schools", "Bags"),
    fig("SCCOSNGTRBAG-L", "Secondary Cosmic Navigator Bag-L: All Schools", "Bags"),
    fig("WBCLSPBROWN", "Water Bottle- Cloud Sipper Brown", "Bottle"),
    fig("WBDSPBEAR", "Water Bottle- Dual Sipper Bear", "Bottle"),
    fig("WBUMSTSTDPINK", "Water Bottle- Urban Matt Stainless Steel Dark Pink", "Bottle"),
    fig("WMSVBLUEPINK", "Water Bottle- Smart Vaccum Blue And Pink", "Bottle"),
    fig("BLSHOE-10S", "Black 10S Shoes", "Shoes"),
  ];
  const v = (id: string, productName: string, size: string) => ({ id, productName, size });

  it("matches the storefront's all-school bag and bottle names to the audit description", () => {
    const m = matchMerchandiseByName(figures, [
      v("a", "INVENTRE BAGS", "DINO CHARM S"),
      v("b", "CRIMSON BAGS", "DinoCharm S"),
      v("c", "CRIMSON BAGS", "Dreamy unicorn (Black) M"),
      v("d", "INVENTRE BAGS", "DREAMY UNICORN NAVY BLUE M"),
      v("e", "CRIMSON BAGS", "Dreamy unicorn (turqoise) M"),
      v("f", "INVENTRE BAGS", "RACING REX NAVY M"),
      v("g", "INVENTRE BAGS", "PINK PARADISE PURPLE M"),
      v("h", "CRIMSON BAGS", "Space adventure (Black) M"),
      v("i", "INVENTRE BAGS", "INVENTRE CLASSIC L"),
      v("j", "CRIMSON BAGS", "Cosmic Navigator L"),
      v("k", "WATER BOTTLES", "Cloud stiper Brown"),
      v("l", "WATER BOTTLES", "Dual Sippers Bear"),
      v("m", "WATER BOTTLES", "Urban Matt staniless steel Dark Pink"),
      v("n", "WATER BOTTLES", "Smart Vaccum Blue and Pink"),
    ]);
    expect(Object.fromEntries(m)).toEqual({
      a: "PPRDCHARMBAG-S", b: "PPRDCHARMBAG-S", c: "PRDRUNICORNBLACKBAG-M", d: "PRDRUNICORNNBLUEBAG-M",
      e: "PRIDRUNICORNTURQBAG-M", f: "PRIRAREXNBLUEBAG-M", g: "PRPIPARADISEPURPLEBAG-M", h: "PRISPADVENTUREBLACKBAG-M",
      i: "SCCLASSICBAGCRI-L", j: "SCCOSNGTRBAG-L", k: "WBCLSPBROWN", l: "WBDSPBEAR", m: "WBUMSTSTDPINK", n: "WMSVBLUEPINK",
    });
  });

  it("never guesses: an ambiguous colour is left alone, and shoes are not name-matched", () => {
    const m = matchMerchandiseByName(figures, [
      v("x", "CRIMSON BAGS", "Space adventure(Blue) M"), // navy blue or sky blue? unknown
      v("y", "NIVIA SHOES", "UK 10"),
    ]);
    expect(m.size).toBe(0);
  });
});
