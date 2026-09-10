import { describe, expect, it } from "vitest";
import { getTaxTemplateName, isInState, placeOfSupply, stateCodeFromPincode } from "@/lib/tax";

/**
 * The company is in Telangana (state code 36). Whether an order is in-state
 * decides CGST+SGST vs IGST on the invoice, so a wrong answer here is a wrong
 * tax line on a real document.
 */
describe("stateCodeFromPincode", () => {
  it("recognises the Telangana pincode band", () => {
    expect(stateCodeFromPincode("500001")).toBe("36"); // Hyderabad
    expect(stateCodeFromPincode("536999")).toBe("36"); // upper bound, inclusive
    expect(stateCodeFromPincode("500000")).toBe("36"); // lower bound, inclusive
  });

  it("returns the out-state sentinel for everything else", () => {
    expect(stateCodeFromPincode("400001")).toBe("99"); // Mumbai
    expect(stateCodeFromPincode("537000")).toBe("99"); // one past the band
    expect(stateCodeFromPincode("110001")).toBe("99"); // Delhi
  });

  it("does not throw on a non-numeric pincode", () => {
    expect(stateCodeFromPincode("abcdef")).toBe("99");
    expect(stateCodeFromPincode("")).toBe("99");
  });
});

describe("tax template selection", () => {
  it("follows the pincode band", () => {
    expect(getTaxTemplateName("500001")).toBe("Output GST In-state - IESPL");
    expect(getTaxTemplateName("400001")).toBe("Output GST Out-state - IESPL");
  });

  it("reports a place of supply for both cases", () => {
    expect(placeOfSupply("500001")).toContain("36");
    expect(placeOfSupply("400001")).toContain("99");
  });
});

describe("isInState", () => {
  it("compares the company and shipping state codes", () => {
    expect(isInState({ companyStateCode: "36", shippingStateCode: "36" } as never)).toBe(true);
    expect(isInState({ companyStateCode: "36", shippingStateCode: "99" } as never)).toBe(false);
  });
});
