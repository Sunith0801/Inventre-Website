import { describe, expect, it } from "vitest";
import { EXCHANGE_REASONS, isExchangeReason, isValidSubReason } from "@/lib/exchange-shared";

/**
 * These validators run on both sides — the browser form and the API that
 * accepts it. A reason the server rejects but the form offers is a dead end
 * for a parent mid-request.
 */
describe("isExchangeReason", () => {
  it("accepts every reason the form offers", () => {
    for (const r of EXCHANGE_REASONS) expect(isExchangeReason(r.value)).toBe(true);
  });

  it("rejects anything else, including non-strings", () => {
    expect(isExchangeReason("not_a_reason")).toBe(false);
    expect(isExchangeReason("")).toBe(false);
    expect(isExchangeReason(null)).toBe(false);
    expect(isExchangeReason(42)).toBe(false);
  });
});

describe("isValidSubReason", () => {
  it("rejects a sub-reason that does not belong to its top-level reason", () => {
    expect(isValidSubReason("damaged", "definitely-not-a-sub-reason")).toBe(false);
  });
});
