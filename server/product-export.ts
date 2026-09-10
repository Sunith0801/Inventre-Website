import { and, asc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  products,
  categories,
  productVariants,
  productVariantAttributes,
  productAttributes,
  productAttributeValues,
  productSchool,
  productGrades,
  schools,
  itemPrices,
} from "@/db/schema";

/**
 * Row builder behind the /admin/products Excel export.
 *
 * Honours EXACTLY the filter contract of the list page (q / status / schoolId
 * / grade / kind / erp) but emits every matching product instead of one
 * PAGE_SIZE slice.
 *
 * Row shape depends on what the item actually is:
 *   • uniform / accessory / book / consumable / sub_bundle
 *       → ONE ROW PER SELLABLE VARIANT: every size, and — where the school
 *         runs house colours — every colour × size combination, each with its
 *         own price. That is the point of this sheet.
 *   • magic_box / kit (bookkit)
 *       → ONE ROW for the parent at the parent price. Their internals are a
 *         BOM, not a price list; the parent price is what a parent pays.
 */

export const MAX_PRODUCTS = 20_000;

export type VariantRow = {
  id: string;
  productId: string;
  size: string;
  sku: string;
  stockQty: number | null;
};

export type ProductExportFilters = {
  q?: string;
  status?: string;
  schoolId?: string;
  grade?: string;
  erp?: string;
  kind?: string;
};

export const PRODUCT_EXPORT_HEADER = [
  "Item Code",
  "Product",
  "Type",
  "Category",
  "School(s)",
  "Grade(s)",
  "Status",
  "Colour",
  "House Code",
  "Size",
  "SKU",
  "Price (₹)",
  "MRP (₹)",
  "Stock",
];

const KIND_LABEL: Record<string, string> = {
  magic_box: "Magic Box",
  kit: "Bookkit",
  uniform: "Uniform",
  accessory: "Accessory",
  book: "Book",
  consumable: "Consumable",
  sub_bundle: "Sub-bundle",
};

// Parent-priced kinds: never expanded into their components/variants.
const PARENT_PRICED = new Set(["magic_box", "kit"]);

const rupees = (paise: number | null | undefined) =>
  paise == null ? "" : Math.round(paise / 100);

// Sizes are a mixed bag — numeric waists ("24", "Q26(16)"), letter sizes
// (S/M/L/XL/XXL) and "Standard". Sort numerics numerically, letters in
// garment order, everything else alphabetically at the end.
const LETTER_ORDER = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "XXXL", "4XL", "5XL"];
function sizeRank(sizeRaw: string): [number, number, string] {
  const s = (sizeRaw ?? "").trim();
  const num = s.match(/^\D*(\d+)/);
  if (num) return [0, parseInt(num[1], 10), s];
  const li = LETTER_ORDER.indexOf(s.toUpperCase());
  if (li >= 0) return [1, li, s];
  return [2, 0, s.toUpperCase()];
}
function bySize(a: string, b: string) {
  const [ag, an, at] = sizeRank(a);
  const [bg, bn, bt] = sizeRank(b);
  return ag - bg || an - bn || at.localeCompare(bt);
}

// Nursery → LKG → UKG → Grade 1..12, with the DSE streams after the plain
// grade they belong to ("Grade 3" before "Grade 3 DSE").
const EARLY_GRADES = ["Nursery", "LKG", "UKG"];
function gradeRank(gradeRaw: string): [number, number, string] {
  const g = (gradeRaw ?? "").trim();
  const early = EARLY_GRADES.findIndex((e) => e.toLowerCase() === g.toLowerCase());
  if (early >= 0) return [0, early, ""];
  const m = g.match(/^Grade\s+(\d+)\s*(.*)$/i);
  if (m) return [1, parseInt(m[1], 10), m[2]];
  return [2, 0, g.toUpperCase()];
}
export function byGrade(a: string, b: string) {
  const [ag, an, at] = gradeRank(a);
  const [bg, bn, bt] = gradeRank(b);
  return ag - bg || an - bn || at.localeCompare(bt);
}

export type LoadedProductExport = Awaited<ReturnType<typeof loadProductExportData>>;

/**
 * Fetches every product matching the list-page filters plus the side data
 * (schools, grades, variants, prices, colour attributes) both the flat export
 * and the per-school price list are built from.
 */
export async function loadProductExportData(f: ProductExportFilters) {
  const q = (f.q ?? "").trim();
  const { status = "", schoolId = "", grade = "", erp = "" } = f;

  // ── Same WHERE the list page builds ──────────────────────────────────
  const conds = [];
  if (q) {
    conds.push(
      or(
        ilike(products.name, `%${q}%`),
        ilike(products.slug, `%${q}%`),
        ilike(sql`COALESCE(${products.itemCode}, '')`, `%${q}%`),
      )!,
    );
  }
  if (status) conds.push(eq(products.status, status as never));
  if (erp === "disabled") conds.push(eq(products.erpIsDisabled, true));
  if (erp === "enabled") conds.push(eq(products.erpIsDisabled, false));
  const kindFilter = f.kind || "main";
  if (kindFilter === "main") {
    conds.push(sql`products.kind IN ('magic_box','kit','uniform','accessory')`);
  } else if (kindFilter !== "all") {
    conds.push(sql`products.kind = ${kindFilter}`);
  }

  let qb = db
    .select({
      id: products.id,
      name: products.name,
      itemCode: products.itemCode,
      kind: sql<string>`products.kind`,
      status: products.status,
      basePrice: products.basePrice,
      baseMrp: products.baseMrp,
      categoryId: products.categoryId,
    })
    .from(products)
    .$dynamic();
  if (schoolId) {
    qb = qb.innerJoin(
      productSchool,
      and(eq(productSchool.productId, products.id), eq(productSchool.schoolId, schoolId)),
    );
  }
  if (grade) {
    qb = qb.innerJoin(
      productGrades,
      and(eq(productGrades.productId, products.id), eq(productGrades.grade, grade)),
    );
  }
  const rows = await qb
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(asc(products.name))
    .limit(MAX_PRODUCTS);

  const ids = rows.map((r) => r.id);
  const empty = {
    rows: [] as typeof rows,
    catName: new Map<string, string>(),
    schoolsByProduct: new Map<string, { code: string; name: string }[]>(),
    gradesByProduct: new Map<string, string[]>(),
    variantsByProduct: new Map<string, VariantRow[]>(),
    priceByVariant: new Map<string, number>(),
    colourByVariant: new Map<string, { value: string; label: string | null }>(),
    sizeAttrByVariant: new Map<string, string>(),
    schoolCode: null as string | null,
    kindFilter,
  };
  if (!ids.length) return empty;

  // ── Side data ────────────────────────────────────────────────────────
  const [cats, schoolRows, gradeRows, variants, filterSchool] = await Promise.all([
    db.select({ id: categories.id, name: categories.name }).from(categories),
    db
      .select({
        productId: productSchool.productId,
        name: schools.name,
        code: schools.schoolCode,
      })
      .from(productSchool)
      .leftJoin(schools, eq(schools.id, productSchool.schoolId))
      .where(inArray(productSchool.productId, ids)),
    db
      .select({ productId: productGrades.productId, grade: productGrades.grade })
      .from(productGrades)
      .where(inArray(productGrades.productId, ids)),
    db
      .select({
        id: productVariants.id,
        productId: productVariants.productId,
        size: productVariants.size,
        sku: productVariants.sku,
        stockQty: productVariants.stockQty,
      })
      .from(productVariants)
      .where(and(inArray(productVariants.productId, ids), eq(productVariants.isActive, true))),
    schoolId
      ? db
          .select({ code: schools.schoolCode })
          .from(schools)
          .where(eq(schools.id, schoolId))
          .limit(1)
      : Promise.resolve([] as { code: string | null }[]),
  ]);

  const vids = variants.map((v) => v.id);
  const [priceRows, attrRows] = await Promise.all([
    vids.length
      ? db
          .select({ variantId: itemPrices.variantId, price: itemPrices.price })
          .from(itemPrices)
          .where(inArray(itemPrices.variantId, vids))
      : Promise.resolve([] as { variantId: string; price: number }[]),
    vids.length
      ? db
          .select({
            variantId: productVariantAttributes.variantId,
            type: productAttributes.type,
            value: productAttributeValues.value,
            displayLabel: productAttributeValues.displayLabel,
          })
          .from(productVariantAttributes)
          .innerJoin(
            productAttributes,
            eq(productAttributes.id, productVariantAttributes.attributeId),
          )
          .innerJoin(
            productAttributeValues,
            eq(productAttributeValues.id, productVariantAttributes.valueId),
          )
          .where(
            and(
              inArray(productVariantAttributes.variantId, vids),
              inArray(productAttributes.type, ["color", "size"]),
            ),
          )
      : Promise.resolve(
          [] as { variantId: string; type: string; value: string; displayLabel: string | null }[],
        ),
  ]);

  const catName = new Map(cats.map((c) => [c.id, c.name]));

  const schoolsByProduct = new Map<string, { code: string; name: string }[]>();
  for (const r of schoolRows) {
    const name = r.name ?? r.code ?? "";
    const code = r.code ?? r.name ?? "";
    if (!name && !code) continue;
    const list = schoolsByProduct.get(r.productId) ?? [];
    if (!list.some((s) => s.code === code && s.name === name)) list.push({ code, name });
    schoolsByProduct.set(r.productId, list);
  }
  const gradesByProduct = new Map<string, string[]>();
  for (const r of gradeRows) {
    const list = gradesByProduct.get(r.productId) ?? [];
    if (!list.includes(r.grade)) list.push(r.grade);
    gradesByProduct.set(r.productId, list);
  }

  // Lowest listed price per variant — mirrors the variants editor, which
  // shows the cheapest of multiple price-list rows.
  const priceByVariant = new Map<string, number>();
  for (const r of priceRows) {
    const cur = priceByVariant.get(r.variantId);
    if (cur === undefined || r.price < cur) priceByVariant.set(r.variantId, r.price);
  }

  // Colour = the house colour bound to the variant. `value` is the colour
  // name (house names differ per school), `displayLabel` the house/letter code.
  const colourByVariant = new Map<string, { value: string; label: string | null }>();
  const sizeAttrByVariant = new Map<string, string>();
  for (const r of attrRows) {
    if (r.type === "color") {
      if (!colourByVariant.has(r.variantId))
        colourByVariant.set(r.variantId, { value: r.value, label: r.displayLabel });
    } else if (!sizeAttrByVariant.has(r.variantId)) {
      sizeAttrByVariant.set(r.variantId, r.value);
    }
  }

  const variantsByProduct = new Map<string, VariantRow[]>();
  for (const v of variants) {
    const list = variantsByProduct.get(v.productId) ?? [];
    list.push(v);
    variantsByProduct.set(v.productId, list);
  }

  return {
    rows,
    catName,
    schoolsByProduct,
    gradesByProduct,
    variantsByProduct,
    priceByVariant,
    colourByVariant,
    sizeAttrByVariant,
    schoolCode: filterSchool[0]?.code ?? null,
    kindFilter,
  };
}

/**
 * The variable tail of a row — Colour, House Code, Size, SKU, Price, MRP,
 * Stock — for one product. One entry per sellable variant, or a single
 * parent-priced entry for a Magic Box / Bookkit.
 */
export function variantTailRows(
  p: LoadedProductExport["rows"][number],
  d: LoadedProductExport,
): (string | number)[][] {
  const { priceByVariant, colourByVariant, sizeAttrByVariant, variantsByProduct } = d;
  const kids = variantsByProduct.get(p.id) ?? [];
  const out: (string | number)[][] = [];

  // Magic Box / Bookkit: the parent price is the whole story — we never
  // expand them into their component books/garments.
  //
  // The one exception is a bookkit that carries NO parent price and whose
  // variants are priced DIFFERENTLY (Grade 11 stream/subject combinations):
  // there is no single "the" price, so each sellable option gets a row.
  // Those variants are choices, not components.
  if (PARENT_PRICED.has(p.kind)) {
    const kidPrices = kids
      .map((v) => priceByVariant.get(v.id))
      .filter((n): n is number => n != null);
    const distinct = [...new Set(kidPrices)];
    const wholeLabel = `Whole ${p.kind === "magic_box" ? "box" : "kit"}`;

    if (p.basePrice && p.basePrice > 0) {
      out.push(["", "", wholeLabel, "", rupees(p.basePrice), rupees(p.baseMrp), ""]);
    } else if (distinct.length > 1) {
      for (const v of [...kids].sort((a, b) => a.size.localeCompare(b.size))) {
        const price = priceByVariant.get(v.id);
        if (price == null) continue;
        // Variant labels repeat the product name — trim it to the option.
        const option = v.size.startsWith(p.name)
          ? v.size.slice(p.name.length).trim() || v.size
          : v.size;
        out.push(["", "", option, v.sku, rupees(price), rupees(p.baseMrp), v.stockQty ?? 0]);
      }
    } else {
      out.push(["", "", wholeLabel, "", rupees(distinct[0] ?? null), rupees(p.baseMrp), ""]);
    }
    return out;
  }

  // Everything else: one row per sellable variant (colour × size).
  if (!kids.length) {
    out.push(["", "", "", "", rupees(p.basePrice || null), rupees(p.baseMrp), ""]);
    return out;
  }
  const sorted = [...kids].sort((a, b) => {
    const ca = colourByVariant.get(a.id)?.value ?? "";
    const cb = colourByVariant.get(b.id)?.value ?? "";
    return ca.localeCompare(cb) || bySize(a.size, b.size);
  });
  for (const v of sorted) {
    const colour = colourByVariant.get(v.id);
    out.push([
      colour?.value ?? "",
      colour?.label ?? "",
      v.size || sizeAttrByVariant.get(v.id) || "",
      v.sku,
      rupees(priceByVariant.get(v.id) ?? (p.basePrice || null)),
      rupees(p.baseMrp),
      v.stockQty ?? 0,
    ]);
  }
  return out;
}

export async function buildProductExportRows(f: ProductExportFilters): Promise<{
  aoa: (string | number)[][];
  productCount: number;
  schoolCode: string | null;
  kindFilter: string;
}> {
  const d = await loadProductExportData(f);
  const { rows, catName, schoolsByProduct, gradesByProduct } = d;

  const aoa: (string | number)[][] = [PRODUCT_EXPORT_HEADER];

  for (const p of rows) {
    const base = [
      p.itemCode ?? "",
      p.name,
      KIND_LABEL[p.kind] ?? p.kind ?? "",
      (p.categoryId && catName.get(p.categoryId)) || "",
      (schoolsByProduct.get(p.id) ?? [])
        .map((s) => s.name)
        .sort()
        .join(", "),
      (gradesByProduct.get(p.id) ?? []).join(", "),
      p.status,
    ];
    for (const tail of variantTailRows(p, d)) aoa.push([...base, ...tail]);
  }

  return {
    aoa,
    productCount: rows.length,
    schoolCode: d.schoolCode,
    kindFilter: d.kindFilter,
  };
}

