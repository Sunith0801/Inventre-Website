import { describe, expect, it } from "vitest";
import { last10 } from "@/lib/phone";

/**
 * `last10` is the JS half of a pair: the SQL half (`last10Sql`) normalises the
 * stored column the same way. If they ever disagree, OTP login stops matching
 * accounts that exist — so these cases pin the JS side.
 */
describe("last10", () => {
  it("keeps the last ten digits of a formatted number", () => {
    expect(last10("+91 98765 43210")).toBe("9876543210");
    expect(last10("091-98765-43210")).toBe("9876543210");
    expect(last10("98765 43210")).toBe("9876543210");
  });

  it("rejects anything that cannot yield ten digits", () => {
    expect(last10("12345")).toBeNull();
    expect(last10("")).toBeNull();
    expect(last10(null)).toBeNull();
    expect(last10(undefined)).toBeNull();
    expect(last10("no digits here")).toBeNull();
  });

  it("takes the LAST ten, so a country code never shifts the match", () => {
    expect(last10("00919876543210")).toBe("9876543210");
  });
});
