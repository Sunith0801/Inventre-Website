/**
 * Catalog-aware exchange reasons.
 *
 * The exchange form previously offered the same set of reasons + sub-reasons
 * to every customer, mixing uniform-shaped options ("stitching", "button")
 * into the picker for a book and book-shaped options ("pages", "wrong
 * language") into a uniform. This file makes the option set drive off
 * `product.kind` so the customer only sees options that actually make
 * sense for what they're returning.
 *
 * Wire format unchanged: `reason` and `sub_reason` remain free strings on
 * the network and in DB; we just narrow what the picker shows.
 *
 * Catalog kinds (from products.kind):
 *   book        — printed material; one variant per title, no size
 *   uniform     — multi-size apparel (S/M/L/XL/2XL + colours)
 *   accessory   — belts, water bottles; some sized, some not
 *   kit         — bundle parent; the form forces drill-down to a component
 *   sub_bundle  — kit-internal component item
 *   magic_box   — special kit (single configuration)
 *   consumable  — quantity-based (pencil packs, stationery sets)
 *   other       — fallback when kind is missing/unknown
 */

import type { ExchangeReason } from "./exchange-shared";

export type ProductKind =
  | "book"
  | "uniform"
  | "accessory"
  | "kit"
  | "sub_bundle"
  | "magic_box"
  | "consumable"
  | "other";

export function normalizeKind(raw: string | null | undefined): ProductKind {
  switch ((raw || "").toLowerCase()) {
    case "book":
    case "uniform":
    case "accessory":
    case "kit":
    case "sub_bundle":
    case "magic_box":
    case "consumable":
      return raw as ProductKind;
    default:
      return "other";
  }
}

export type ReasonOption = { value: ExchangeReason; label: string };
export type SubReasonOption = { value: string; label: string };
export type DamageLocationOption = { value: string; label: string };

export interface ReasonOptions {
  reasons: readonly ReasonOption[];
  subReasonsByReason: Readonly<Record<ExchangeReason, readonly SubReasonOption[]>>;
  damageLocationsByReason: Readonly<Record<ExchangeReason, readonly DamageLocationOption[]>>;
  /** Whether sibling-variant swap is even meaningful for this kind. */
  showSiblingPicker: boolean;
  /** Whether kit-component drill-down is required up front. */
  forceKitDrillDown: boolean;
}

// ─── Sub-reason libraries (shared / kind-specific) ────────────────────

const SIZE_SUB: readonly SubReasonOption[] = [
  { value: "too_small", label: "Too small" },
  { value: "too_large", label: "Too large" },
  { value: "size_chart_mismatch", label: "Size label doesn't match brand chart" },
];

const DAMAGED_GENERIC: readonly SubReasonOption[] = [
  { value: "packaging", label: "Packaging damaged in transit" },
  { value: "item", label: "Item damaged in transit" },
  { value: "both", label: "Both packaging and item damaged" },
];

const DAMAGED_BOOK: readonly SubReasonOption[] = [
  { value: "water_damage", label: "Water damage" },
  { value: "cover_damage", label: "Cover damaged" },
  { value: "spine_damage", label: "Spine damaged" },
  { value: "torn_pages", label: "Pages torn" },
  { value: "packaging", label: "Packaging damaged in transit" },
];

const DEFECTIVE_UNIFORM: readonly SubReasonOption[] = [
  { value: "stitching", label: "Stitching issue" },
  { value: "tear", label: "Tear / hole" },
  { value: "button", label: "Button missing / broken" },
  { value: "fabric", label: "Fabric issue" },
  { value: "print", label: "Print / logo quality" },
  { value: "other", label: "Other defect" },
];

const DEFECTIVE_BOOK: readonly SubReasonOption[] = [
  { value: "print_quality", label: "Print quality (faded / smudged)" },
  { value: "binding", label: "Binding loose / falling apart" },
  { value: "missing_pages", label: "Pages missing" },
  { value: "blank_pages", label: "Pages blank where they shouldn't be" },
  { value: "other", label: "Other defect" },
];

const DEFECTIVE_GENERIC: readonly SubReasonOption[] = [
  { value: "broken", label: "Broken / cracked" },
  { value: "not_working", label: "Doesn't work properly" },
  { value: "other", label: "Other defect" },
];

const WRONG_BOOK: readonly SubReasonOption[] = [
  { value: "wrong_subject", label: "Wrong subject / edition" },
  { value: "wrong_grade", label: "Wrong grade / class" },
  { value: "wrong_language", label: "Wrong language version" },
  { value: "missing_components", label: "Missing CD / workbook / inserts" },
  { value: "wrong_product", label: "Completely different book" },
];

const WRONG_UNIFORM: readonly SubReasonOption[] = [
  { value: "wrong_color", label: "Wrong colour" },
  { value: "wrong_design", label: "Wrong design / print" },
  { value: "wrong_gender", label: "Wrong gender variant (girls vs boys)" },
  { value: "wrong_product", label: "Completely different product" },
];

const WRONG_GENERIC: readonly SubReasonOption[] = [
  { value: "wrong_color", label: "Wrong colour" },
  { value: "wrong_product", label: "Completely different product" },
];

const WRONG_KIT: readonly SubReasonOption[] = [
  { value: "missing_components", label: "Kit components missing" },
  { value: "wrong_contents", label: "Kit contents don't match what was ordered" },
  { value: "wrong_grade", label: "Wrong grade / level" },
];

const WRONG_CONSUMABLE: readonly SubReasonOption[] = [
  { value: "wrong_quantity", label: "Wrong quantity in pack" },
  { value: "wrong_product", label: "Completely different product" },
];

// ─── Damage locations (kind-specific) ─────────────────────────────────

const DAMAGE_LOC_GENERIC: readonly DamageLocationOption[] = [
  { value: "front", label: "Front" },
  { value: "back", label: "Back" },
  { value: "side", label: "Side" },
  { value: "other", label: "Other / unsure" },
];

const DAMAGE_LOC_UNIFORM: readonly DamageLocationOption[] = [
  { value: "front", label: "Front" },
  { value: "back", label: "Back" },
  { value: "sleeve", label: "Sleeve" },
  { value: "collar", label: "Collar / neck" },
  { value: "seam", label: "Seam" },
  { value: "other", label: "Other / unsure" },
];

const DAMAGE_LOC_BOOK: readonly DamageLocationOption[] = [
  { value: "cover", label: "Cover" },
  { value: "spine", label: "Spine" },
  { value: "pages", label: "Inner pages" },
  { value: "binding", label: "Binding" },
  { value: "other", label: "Other / unsure" },
];

// ─── Per-kind option assemblies ───────────────────────────────────────

function options(
  kind: ProductKind,
  hasSiblings: boolean
): ReasonOptions {
  switch (kind) {
    case "book":
      return {
        reasons: [
          { value: "wrong_item", label: "Wrong Book Delivered" },
          { value: "damaged", label: "Item Arrived Damaged" },
        ],
        subReasonsByReason: {
          wrong_size_delivered: [],
          wrong_item: WRONG_BOOK,
          damaged: DAMAGED_BOOK,
          defective: DEFECTIVE_BOOK,
          other: [],
        },
        damageLocationsByReason: {
          wrong_size_delivered: [],
          wrong_item: [],
          damaged: DAMAGE_LOC_BOOK,
          defective: DAMAGE_LOC_BOOK,
          other: [],
        },
        // Books rarely have sibling variants, but when one does (e.g. a
        // language/edition axis) let the customer pick the exact one they
        // want instead of describing it in free text.
        showSiblingPicker: hasSiblings,
        forceKitDrillDown: false,
      };

    case "uniform":
      return {
        reasons: [
          ...(hasSiblings ? [{ value: "wrong_size_delivered" as ExchangeReason, label: "Wrong Size Delivered" }] : []),
          { value: "wrong_item", label: "Wrong Item Delivered" },
          { value: "damaged", label: "Item Arrived Damaged" },
          { value: "defective", label: "Item Defective" },
        ],
        subReasonsByReason: {
          wrong_size_delivered: SIZE_SUB,
          damaged: DAMAGED_GENERIC,
          defective: DEFECTIVE_UNIFORM,
          wrong_item: WRONG_UNIFORM,
          other: [],
        },
        damageLocationsByReason: {
          wrong_size_delivered: [],
          damaged: DAMAGE_LOC_UNIFORM,
          defective: DAMAGE_LOC_UNIFORM,
          wrong_item: [],
          other: [],
        },
        showSiblingPicker: hasSiblings,
        forceKitDrillDown: false,
      };

    case "accessory":
      return {
        reasons: [
          ...(hasSiblings ? [{ value: "wrong_size_delivered" as ExchangeReason, label: "Wrong Size Delivered" }] : []),
          { value: "wrong_item", label: "Wrong Item Delivered" },
          { value: "damaged", label: "Item Arrived Damaged" },
          { value: "defective", label: "Item Defective" },
        ],
        subReasonsByReason: {
          wrong_size_delivered: SIZE_SUB,
          damaged: DAMAGED_GENERIC,
          defective: DEFECTIVE_GENERIC,
          wrong_item: WRONG_GENERIC,
          other: [],
        },
        damageLocationsByReason: {
          wrong_size_delivered: [],
          damaged: DAMAGE_LOC_GENERIC,
          defective: DAMAGE_LOC_GENERIC,
          wrong_item: [],
          other: [],
        },
        showSiblingPicker: hasSiblings,
        forceKitDrillDown: false,
      };

    case "kit":
    case "magic_box":
      return {
        reasons: [
          { value: "wrong_item", label: "Kit contents don't match what was ordered" },
          { value: "damaged", label: "Kit arrived damaged" },
          { value: "defective", label: "One of the items inside is defective" },
          { value: "other", label: "Other (please describe)" },
        ],
        subReasonsByReason: {
          wrong_size_delivered: [],
          wrong_item: WRONG_KIT,
          damaged: DAMAGED_GENERIC,
          defective: DEFECTIVE_GENERIC,
          other: [],
        },
        // "Where on the item?" Front/Back/Side does not apply to a kit's
        // internal defective component — the sub-reason already captures
        // what's wrong (broken / not working / other), and the kit-level
        // location field would just confuse the customer.
        damageLocationsByReason: {
          wrong_size_delivered: [],
          wrong_item: [],
          damaged: DAMAGE_LOC_GENERIC,
          defective: [],
          other: [],
        },
        // The drilled-down component (uniform piece, belt, …) may itself
        // carry size/variant siblings — surface them so the customer can
        // say exactly which one they want.
        showSiblingPicker: hasSiblings,
        forceKitDrillDown: true,
      };

    case "sub_bundle":
      // Treated like a kit-internal component. Surface book-leaning reasons
      // since most sub-bundles are books inside a kit. If we ever see
      // sub-bundle uniforms, this is the place to branch.
      return {
        reasons: [
          { value: "wrong_item", label: "Wrong item delivered" },
          { value: "damaged", label: "Item arrived damaged" },
          { value: "defective", label: "Item has a defect" },
          { value: "other", label: "Other (please describe)" },
        ],
        subReasonsByReason: {
          wrong_size_delivered: [],
          wrong_item: WRONG_BOOK,
          damaged: DAMAGED_BOOK,
          defective: DEFECTIVE_BOOK,
          other: [],
        },
        damageLocationsByReason: {
          wrong_size_delivered: [],
          wrong_item: [],
          damaged: DAMAGE_LOC_BOOK,
          defective: DAMAGE_LOC_BOOK,
          other: [],
        },
        showSiblingPicker: hasSiblings,
        forceKitDrillDown: false,
      };

    case "consumable":
      return {
        reasons: [
          { value: "wrong_item", label: "Wrong item / wrong quantity" },
          { value: "damaged", label: "Item arrived damaged" },
          { value: "defective", label: "Item is defective" },
          { value: "other", label: "Other (please describe)" },
        ],
        subReasonsByReason: {
          wrong_size_delivered: [],
          wrong_item: WRONG_CONSUMABLE,
          damaged: DAMAGED_GENERIC,
          defective: DEFECTIVE_GENERIC,
          other: [],
        },
        damageLocationsByReason: {
          wrong_size_delivered: [],
          wrong_item: [],
          damaged: DAMAGE_LOC_GENERIC,
          defective: DAMAGE_LOC_GENERIC,
          other: [],
        },
        showSiblingPicker: hasSiblings,
        forceKitDrillDown: false,
      };

    case "other":
    default:
      return {
        reasons: [
          ...(hasSiblings ? [{ value: "wrong_size_delivered" as ExchangeReason, label: "Wrong Size Delivered" }] : []),
          { value: "wrong_item", label: "Wrong Item Delivered" },
          { value: "damaged", label: "Item Arrived Damaged" },
          { value: "defective", label: "Item Defective" },
        ],
        subReasonsByReason: {
          wrong_size_delivered: SIZE_SUB,
          damaged: DAMAGED_GENERIC,
          defective: DEFECTIVE_GENERIC,
          wrong_item: WRONG_GENERIC,
          other: [],
        },
        damageLocationsByReason: {
          wrong_size_delivered: [],
          damaged: DAMAGE_LOC_GENERIC,
          defective: DAMAGE_LOC_GENERIC,
          wrong_item: [],
          other: [],
        },
        showSiblingPicker: hasSiblings,
        forceKitDrillDown: false,
      };
  }
}

export function getReasonOptions(
  kind: string | null | undefined,
  hasSiblings: boolean
): ReasonOptions {
  return options(normalizeKind(kind), hasSiblings);
}

/**
 * Universal label lookup — covers every sub-reason value across every
 * kind. Useful for the audit-side detail page which renders rows from
 * any kind without knowing which kind produced them. Falls back to the
 * raw value if unknown so we never blank-render.
 */
export function labelForSubReason(value: string | null | undefined): string {
  if (!value) return "—";
  const allLibraries: readonly (readonly SubReasonOption[])[] = [
    SIZE_SUB, DAMAGED_GENERIC, DAMAGED_BOOK, DEFECTIVE_UNIFORM,
    DEFECTIVE_BOOK, DEFECTIVE_GENERIC, WRONG_BOOK, WRONG_UNIFORM,
    WRONG_GENERIC, WRONG_KIT, WRONG_CONSUMABLE,
  ];
  for (const lib of allLibraries) {
    const hit = lib.find((o) => o.value === value);
    if (hit) return hit.label;
  }
  return value;
}

export function labelForDamageLocation(value: string | null | undefined): string {
  if (!value) return "—";
  for (const lib of [DAMAGE_LOC_GENERIC, DAMAGE_LOC_UNIFORM, DAMAGE_LOC_BOOK]) {
    const hit = lib.find((o) => o.value === value);
    if (hit) return hit.label;
  }
  return value;
}
