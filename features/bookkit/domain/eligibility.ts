/**
 * Whether a complimentary bookkit may be added to a cart.
 *
 * WHY THIS FILE EXISTS. These rules used to live inside
 * `app/api/cart/route.ts`, interleaved with the six database queries that
 * feed them. Testing "does a second bookkit get refused?" meant standing up
 * Postgres, a parent, a school, a product, a variant, a cart and a paid
 * order — so nobody ever did, and the rules were only ever exercised by
 * customers. Two of the incidents cited below were found that way.
 *
 * Nothing here touches the database, the network or Next.js. Every input is
 * a plain value the caller has already looked up, which is what makes the
 * whole thing testable in microseconds — and what lets the route keep its
 * careful query sequencing instead of being rewritten around the rules.
 *
 * The route remains responsible for GATHERING the facts. This file is only
 * responsible for DECIDING. That split is the entire point.
 */

/**
 * Schools where the bookkit is a one-per-student complimentary item.
 *
 * A list, not a flag on the school row, because it has been exactly one
 * school since it was introduced and a column would have to be backfilled
 * across every school to say "no". Move it to data when a second school
 * needs it and the answer stops being obvious.
 */
export const FREE_BOOKKIT_RESTRICTED_SCHOOL_CODES: readonly string[] = ["SMSAW"];

/** A product counts as a bookkit by NAME. The catalogue has no kind flag that
 *  distinguishes a bookkit from any other kit, and the ERP-mirrored names are
 *  consistent enough that this has held. Matched case-insensitively because
 *  the ERP sends "BookKit", "Bookkit" and "BOOKSET" interchangeably. */
const BOOKKIT_NAME = /bookkit|bookset/i;

export function isBookkitName(productName: string | null | undefined): boolean {
  return BOOKKIT_NAME.test(productName ?? "");
}

/**
 * What a school actually pays for a product: the per-school override when one
 * exists, otherwise the catalogue base price, otherwise nothing.
 *
 * `??` and not `||` deliberately — an override of 0 is the whole point of the
 * feature, and `||` would discard it and charge the base price.
 */
export function effectivePricePaise(
  basePaise: number | null | undefined,
  overridePaise: number | null | undefined,
): number {
  return overridePaise ?? basePaise ?? 0;
}

export type RestrictionFacts = {
  /** The school the cart is being built for. Null when the session carries none. */
  schoolCode: string | null;
  productName: string | null;
  /** Already resolved through `effectivePricePaise`. */
  pricePaise: number;
};

/**
 * Is this specific add subject to the one-per-student rule at all?
 *
 * Everything else in this module only matters when this is true, and it is
 * false for the overwhelming majority of cart adds — which is why the route
 * checks it before running the three further queries the decision needs.
 */
export function isRestrictedFreeBookkit(facts: RestrictionFacts): boolean {
  if (!facts.schoolCode) return false;
  if (!FREE_BOOKKIT_RESTRICTED_SCHOOL_CODES.includes(facts.schoolCode)) return false;
  if (!isBookkitName(facts.productName)) return false;
  // Only FREE bookkits are restricted. A school that charges for its bookkit
  // can sell as many as it likes.
  return facts.pricePaise === 0;
}

export type LimitFacts = {
  /** Quantity the customer asked for on this add. */
  requestedQty: number;
  /**
   * Is a bookkit already sitting in this cart — INCLUDING this exact variant?
   *
   * Including it is deliberate. Re-adding the same bookkit used to increment
   * the existing line silently, which is how SAL-ORD-2026-37803 ended up with
   * a quantity above one on a one-per-student item.
   */
  bookkitAlreadyInCart: boolean;
  /**
   * A previous order that already carried a free bookkit for this student, or
   * null. The caller must count only orders that were PAID or fulfilled — a
   * bare `placed` + `pending` checkout that never completed payment is not a
   * redemption. Student 23SMS0681 was locked out of a bookkit they never
   * received by four abandoned ₹3,860 attempts before that was fixed.
   */
  priorRedemption: { orderNumber: string | null } | null;
};

export type BookkitDecision = {
  /** Null when the add is allowed. */
  block: { message: string; orderNumber: string | null } | null;
  /**
   * True for every restricted free bookkit, ALLOWED OR NOT. The caller pins
   * the cart line to quantity 1 with it, so repeated "Add" clicks cannot
   * accumulate even on the path that succeeds.
   */
  capToOne: boolean;
};

const ALLOWED: BookkitDecision = { block: null, capToOne: true };

/**
 * The decision, given a bookkit already known to be restricted and free.
 *
 * Order matters and is preserved from the original: quantity is judged before
 * the cart, and the cart before order history. A customer asking for three
 * copies is told that it is a free item, not that they have already had one.
 */
export function decideBookkitLimit(facts: LimitFacts): BookkitDecision {
  if (facts.requestedQty > 1) {
    return {
      block: {
        message: "Only 1 complimentary bookkit can be added — it is a free item.",
        orderNumber: null,
      },
      capToOne: true,
    };
  }

  if (facts.bookkitAlreadyInCart) {
    return {
      block: {
        message: "A complimentary bookkit is already in your cart. Only 1 is allowed per order.",
        orderNumber: null,
      },
      capToOne: true,
    };
  }

  if (facts.priorRedemption) {
    return {
      block: {
        message:
          "You have already received a complimentary bookkit in a previous order. Only 1 is allowed per student.",
        // Named so the customer can be shown WHICH order already has it.
        // Null is tolerated: the order is known to exist even when its number
        // could not be resolved, and a blocked add is still correct.
        orderNumber: facts.priorRedemption.orderNumber,
      },
      capToOne: true,
    };
  }

  return ALLOWED;
}

/** The shape the cart route returns to callers. Unrestricted adds never reach
 *  `decideBookkitLimit`, so this is the one place that names them. */
export const NOT_RESTRICTED: BookkitDecision = { block: null, capToOne: false };
