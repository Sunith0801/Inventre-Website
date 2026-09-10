import { describe, expect, it } from "vitest";
import { clampRequestedQty, exceedsQtyCeiling } from "@/lib/return-qty";

/**
 * These take whatever an `<input type="number">` hands back — including the
 * empty string from a cleared box and "abc" from some mobile keyboards. A
 * request line for zero units is meaningless, so junk floors to 1 rather
 * than 0.
 */
describe("clampRequestedQty", () => {
  it("keeps a valid quantity", () => {
    expect(clampRequestedQty(2, 5)).toBe(2);
    expect(clampRequestedQty("3", 5)).toBe(3);
  });

  it("floors junk and non-positive input to 1, never 0", () => {
    for (const junk of ["", "abc", 0, -4, null, undefined, NaN]) {
      expect(clampRequestedQty(junk, 5)).toBe(1);
    }
  });

  it("caps at the ceiling", () => {
    expect(clampRequestedQty(99, 3)).toBe(3);
    expect(clampRequestedQty(3.9, 3)).toBe(3);
  });

  it("treats a missing or nonsense ceiling as 1", () => {
    expect(clampRequestedQty(9, 0)).toBe(1);
    expect(clampRequestedQty(9, NaN)).toBe(1);
  });
});

describe("exceedsQtyCeiling", () => {
  it("is true only when the customer typed above the ceiling", () => {
    expect(exceedsQtyCeiling(4, 3)).toBe(true);
    expect(exceedsQtyCeiling(3, 3)).toBe(false);
    expect(exceedsQtyCeiling(1, 3)).toBe(false);
  });

  it("stays quiet for junk — a cleared box is not an error", () => {
    expect(exceedsQtyCeiling("", 3)).toBe(false);
    expect(exceedsQtyCeiling("abc", 3)).toBe(false);
  });
});
