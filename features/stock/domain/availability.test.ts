import { describe, expect, it } from "vitest";
import {
  DEFAULT_GROUND_STOCK_GATE,
  UNTRACKED_AVAILABLE,
  availabilityFor,
  parseGroundStockGate,
} from "./availability";

const on = DEFAULT_GROUND_STOCK_GATE;
const lenient = { enabled: true, unmatched: "available" as const };
const off = { enabled: false, unmatched: "out_of_stock" as const };

describe("availabilityFor — counted kinds follow the Ground Stock bin", () => {
  it("sells exactly what the audit counted", () => {
    expect(availabilityFor({ kind: "uniform", binAvailable: 7, gate: on })).toBe(7);
    expect(availabilityFor({ kind: "accessory", binAvailable: 1, gate: on })).toBe(1);
  });

  it("a zero or negative audit figure is sold out", () => {
    // 1,104 of 3,520 item codes read below zero on the audit dashboard on
    // 2026-09-16 (packing deductions past the last count). The audit's own
    // page shows those as "out"; the storefront must agree.
    expect(availabilityFor({ kind: "uniform", binAvailable: 0, gate: on })).toBe(0);
    expect(availabilityFor({ kind: "uniform", binAvailable: -12, gate: on })).toBe(0);
  });

  it("an unmatched garment is sold out by default, available under the lenient policy", () => {
    expect(availabilityFor({ kind: "uniform", binAvailable: null, gate: on })).toBe(0);
    expect(availabilityFor({ kind: "consumable", binAvailable: null, gate: on })).toBe(0);
    expect(availabilityFor({ kind: "uniform", binAvailable: null, gate: lenient })).toBe(
      UNTRACKED_AVAILABLE
    );
  });

  it("a book off the sheet stays available; a book on the sheet follows it", () => {
    expect(availabilityFor({ kind: "book", binAvailable: null, gate: on })).toBe(
      UNTRACKED_AVAILABLE
    );
    expect(availabilityFor({ kind: "book", binAvailable: 0, gate: on })).toBe(0);
    expect(availabilityFor({ kind: "book", binAvailable: 3, gate: on })).toBe(3);
  });
});

describe("availabilityFor — assembled kinds are never gated", () => {
  it.each(["kit", "sub_bundle", "magic_box", "excluded", null, undefined])(
    "%s reads as freely available whatever the bin says",
    (kind) => {
      expect(availabilityFor({ kind, binAvailable: 0, gate: on })).toBe(UNTRACKED_AVAILABLE);
      expect(availabilityFor({ kind, binAvailable: null, gate: on })).toBe(UNTRACKED_AVAILABLE);
    }
  );
});

describe("availabilityFor — gate off restores the pre-bridge storefront", () => {
  it("everything is available, even a counted zero", () => {
    expect(availabilityFor({ kind: "uniform", binAvailable: 0, gate: off })).toBe(
      UNTRACKED_AVAILABLE
    );
    expect(availabilityFor({ kind: "uniform", binAvailable: null, gate: off })).toBe(
      UNTRACKED_AVAILABLE
    );
  });
});

describe("parseGroundStockGate", () => {
  it("defaults to enabled + strict on garbage", () => {
    expect(parseGroundStockGate(null)).toEqual(on);
    expect(parseGroundStockGate("x")).toEqual(on);
    expect(parseGroundStockGate({ enabled: "yes", unmatched: "maybe" })).toEqual(on);
  });
  it("keeps a valid stored value", () => {
    expect(parseGroundStockGate({ enabled: false, unmatched: "available" })).toEqual({
      enabled: false,
      unmatched: "available",
    });
  });
});
