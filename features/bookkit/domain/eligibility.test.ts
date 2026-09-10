import { describe, expect, it } from "vitest";
import {
  decideBookkitLimit,
  effectivePricePaise,
  isBookkitName,
  isRestrictedFreeBookkit,
  type LimitFacts,
  type RestrictionFacts,
} from "./eligibility";

/**
 * These rules decide whether a parent may add a free bookkit. Until now they
 * lived inside app/api/cart/route.ts among six database queries, so testing
 * them meant standing up Postgres, a parent, a school, a product, a variant,
 * a cart and a paid order. Nobody did. Customers found the bugs instead.
 *
 * The last block of this file is an EQUIVALENCE PROOF: a literal transcription
 * of the original branching, run against the extracted functions across every
 * combination of inputs. The extraction is a refactor, and this is how that
 * claim is checked rather than asserted.
 */

describe("isBookkitName", () => {
  it("matches the spellings the ERP actually sends", () => {
    for (const n of ["Bookkit", "BookKit", "BOOKSET", "Grade 5 Bookkit Hindi", "bookset"]) {
      expect(isBookkitName(n), n).toBe(true);
    }
  });

  it("does not match ordinary products", () => {
    for (const n of ["Half Pants", "Magic Box", "Notebook", "Book Cover", null, undefined, ""]) {
      expect(isBookkitName(n), String(n)).toBe(false);
    }
  });
});

describe("effectivePricePaise", () => {
  it("prefers the per-school override over the base price", () => {
    expect(effectivePricePaise(50000, 0)).toBe(0);
    expect(effectivePricePaise(50000, 25000)).toBe(25000);
  });

  it("keeps a ZERO override — the whole point of a complimentary bookkit", () => {
    // `||` here instead of `??` would discard the 0 and charge the base price.
    expect(effectivePricePaise(386000, 0)).toBe(0);
  });

  it("falls back to base, then to zero", () => {
    expect(effectivePricePaise(50000, null)).toBe(50000);
    expect(effectivePricePaise(null, null)).toBe(0);
    expect(effectivePricePaise(undefined, undefined)).toBe(0);
  });
});

describe("isRestrictedFreeBookkit", () => {
  const base: RestrictionFacts = { schoolCode: "SMSAW", productName: "Grade 5 Bookkit", pricePaise: 0 };

  it("restricts a free bookkit at a restricted school", () => {
    expect(isRestrictedFreeBookkit(base)).toBe(true);
  });

  it("leaves every other school alone", () => {
    expect(isRestrictedFreeBookkit({ ...base, schoolCode: "SASKS" })).toBe(false);
    expect(isRestrictedFreeBookkit({ ...base, schoolCode: null })).toBe(false);
  });

  it("leaves non-bookkits alone even at a restricted school", () => {
    expect(isRestrictedFreeBookkit({ ...base, productName: "Half Pants" })).toBe(false);
  });

  it("leaves PAID bookkits alone — only free ones are one-per-student", () => {
    expect(isRestrictedFreeBookkit({ ...base, pricePaise: 386000 })).toBe(false);
  });
});

describe("decideBookkitLimit", () => {
  const clean: LimitFacts = { requestedQty: 1, bookkitAlreadyInCart: false, priorRedemption: null };

  it("allows the first one, and still caps the line to 1", () => {
    // capToOne is true even when ALLOWED — that is what stops repeated
    // "Add" clicks accumulating a quantity on a one-per-student item.
    expect(decideBookkitLimit(clean)).toEqual({ block: null, capToOne: true });
  });

  it("refuses a quantity above one before it looks at anything else", () => {
    const d = decideBookkitLimit({ ...clean, requestedQty: 3, bookkitAlreadyInCart: true });
    expect(d.block?.message).toContain("Only 1 complimentary bookkit");
    // Quantity is judged FIRST: someone asking for three is told it is a free
    // item, not that they already have one.
    expect(d.block?.message).not.toContain("already in your cart");
  });

  it("refuses a second bookkit in the same cart", () => {
    const d = decideBookkitLimit({ ...clean, bookkitAlreadyInCart: true });
    expect(d.block?.message).toContain("already in your cart");
    expect(d.block?.orderNumber).toBeNull();
    expect(d.capToOne).toBe(true);
  });

  it("refuses a student who already redeemed one, and names the order", () => {
    const d = decideBookkitLimit({ ...clean, priorRedemption: { orderNumber: "SAL-ORD-2026-37803" } });
    expect(d.block?.message).toContain("already received a complimentary bookkit");
    expect(d.block?.orderNumber).toBe("SAL-ORD-2026-37803");
  });

  it("still blocks when the prior order's number could not be resolved", () => {
    const d = decideBookkitLimit({ ...clean, priorRedemption: { orderNumber: null } });
    expect(d.block).not.toBeNull();
    expect(d.block?.orderNumber).toBeNull();
  });

  it("prefers the cart message over the history message", () => {
    const d = decideBookkitLimit({
      ...clean,
      bookkitAlreadyInCart: true,
      priorRedemption: { orderNumber: "SAL-ORD-1" },
    });
    expect(d.block?.message).toContain("already in your cart");
  });
});

/* ───────────────────────── equivalence proof ───────────────────────── */

/**
 * A literal transcription of the branching as it stood in
 * app/api/cart/route.ts before the extraction — same order, same messages,
 * same return shapes. Only the database calls are replaced by the facts they
 * produced.
 *
 * If the extraction changed any decision, the exhaustive comparison below
 * fails. This is the difference between calling something a refactor and
 * showing that it is one.
 */
function originalBehaviour(f: {
  schoolCode: string | null;
  productName: string | null;
  basePaise: number | null;
  overridePaise: number | null;
  qty: number;
  cartHasBookkit: boolean;
  priorOrderNumber: string | null;
  hasPriorRedemption: boolean;
}) {
  const NOT_RESTRICTED = { block: null as null | { message: string; orderNumber: string | null }, capToOne: false };
  if (!f.schoolCode) return NOT_RESTRICTED;
  if (!["SMSAW"].includes(f.schoolCode ?? "")) return NOT_RESTRICTED;
  if (!/bookkit|bookset/i.test(f.productName ?? "")) return NOT_RESTRICTED;
  let price = f.basePaise ?? 0;
  if (f.overridePaise !== null && f.overridePaise !== undefined) price = f.overridePaise;
  if (price !== 0) return NOT_RESTRICTED;
  if (f.qty > 1) {
    return {
      block: { message: "Only 1 complimentary bookkit can be added — it is a free item.", orderNumber: null },
      capToOne: true,
    };
  }
  if (f.cartHasBookkit) {
    return {
      block: {
        message: "A complimentary bookkit is already in your cart. Only 1 is allowed per order.",
        orderNumber: null,
      },
      capToOne: true,
    };
  }
  if (f.hasPriorRedemption) {
    return {
      block: {
        message:
          "You have already received a complimentary bookkit in a previous order. Only 1 is allowed per student.",
        orderNumber: f.priorOrderNumber,
      },
      capToOne: true,
    };
  }
  return { block: null, capToOne: true };
}

/** The extracted pair, composed exactly as the route composes them. */
function extractedBehaviour(f: Parameters<typeof originalBehaviour>[0]) {
  const price = effectivePricePaise(f.basePaise, f.overridePaise);
  if (!isRestrictedFreeBookkit({ schoolCode: f.schoolCode, productName: f.productName, pricePaise: price })) {
    return { block: null, capToOne: false };
  }
  return decideBookkitLimit({
    requestedQty: f.qty,
    bookkitAlreadyInCart: f.cartHasBookkit,
    priorRedemption: f.hasPriorRedemption ? { orderNumber: f.priorOrderNumber } : null,
  });
}

describe("equivalence with the pre-extraction logic", () => {
  it("agrees on every combination of inputs", () => {
    const schoolCodes = [null, "", "SMSAW", "SASKS"];
    const names = [null, "Grade 5 Bookkit", "BOOKSET", "Half Pants"];
    const bases = [null, 0, 386000];
    const overrides = [null, 0, 25000];
    const qtys = [1, 2, 5];
    const bools = [false, true];
    const orderNumbers = [null, "SAL-ORD-2026-37803"];

    let compared = 0;
    for (const schoolCode of schoolCodes)
      for (const productName of names)
        for (const basePaise of bases)
          for (const overridePaise of overrides)
            for (const qty of qtys)
              for (const cartHasBookkit of bools)
                for (const hasPriorRedemption of bools)
                  for (const priorOrderNumber of orderNumbers) {
                    const input = {
                      schoolCode,
                      productName,
                      basePaise,
                      overridePaise,
                      qty,
                      cartHasBookkit,
                      priorOrderNumber,
                      hasPriorRedemption,
                    };
                    expect(extractedBehaviour(input), JSON.stringify(input)).toEqual(
                      originalBehaviour(input),
                    );
                    compared++;
                  }

    // 4 × 4 × 3 × 3 × 3 × 2 × 2 × 2 = 3,456 cases
    expect(compared).toBe(3456);
  });
});
