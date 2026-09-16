/**
 * The product types an admin can create and where each one goes after
 * step 1. Plain data, importable from server AND client components — a
 * "use client" module cannot export values to a server component (they
 * arrive as client references), which is why this lives on its own.
 */
export type CreateKind = "uniform" | "book" | "accessory" | "consumable" | "kit" | "magic_box";

export const KIND_META: Record<CreateKind, { label: string; nextStep: string; blurb: string }> = {
  uniform: { label: "Uniform", nextStep: "variants", blurb: "Sizes and colours come next." },
  book: { label: "Book kit item", nextStep: "pricing", blurb: "Mapped from inventory; price and a photo come next." },
  accessory: { label: "Stationery / Item", nextStep: "variants", blurb: "Sizes (if any) come next." },
  consumable: { label: "Consumable", nextStep: "pricing", blurb: "Price comes next." },
  kit: { label: "Book kit", nextStep: "sections", blurb: "You pick its sections next, then fill each one." },
  magic_box: { label: "Magic box", nextStep: "sections", blurb: "You pick its sub-bundles next, then fill each one." },
};

export function isCreateKind(s: string): s is CreateKind {
  return s in KIND_META;
}

/** Sub-bundles of a Magic box — fixed, not a master list the admin edits. */
export const MAGIC_BOX_GROUPS = [
  { groupKey: "uniform", name: "Uniform set", kinds: ["uniform"], hint: "Shirt, trousers, belt, tie… one size picker applies to all on the shop." },
  { groupKey: "bookkit", name: "Book kit", kinds: ["kit"], onlyPublished: true, hint: "The published kit for this grade. Editing the kit updates the box." },
  { groupKey: "other", name: "Other items", kinds: ["accessory", "consumable", "book"], hint: "Bag, ID card, shoes, bottle…" },
] as const;
