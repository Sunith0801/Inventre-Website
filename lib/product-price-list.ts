import {
  loadProductExportData,
  variantTailRows,
  byGrade,
  type ProductExportFilters,
  type LoadedProductExport,
} from "@/server/product-export";

/**
 * School-segregated price list behind the /admin/products "Price List" export.
 *
 * Same filter contract as the flat export, but the workbook carries ONE SHEET
 * PER SCHOOL (plus an "All schools" sheet that keeps every row in one place).
 *
 * Rows are exploded so the sheet is genuinely grade-wise AND SKU-wise:
 * a shirt mapped to 3 schools × 5 grades × 12 size/colour variants emits
 * 3 × 5 × 12 rows — one per school × grade × SKU — so any single grade can be
 * filtered down to the exact price list a parent of that grade sees.
 *
 * Magic Boxes / Bookkits stay one parent-priced row (see variantTailRows).
 */

const KIND_LABEL: Record<string, string> = {
  magic_box: "Magic Box",
  kit: "Bookkit",
  uniform: "Uniform",
  accessory: "Accessory",
  book: "Book",
  consumable: "Consumable",
  sub_bundle: "Sub-bundle",
};

/** Products with no school / no grade mapping still have to land somewhere. */
const NO_SCHOOL = { code: "ZZ-UNASSIGNED", name: "Not mapped to a school" };
const NO_GRADE = "(not set)";

export const PRICE_LIST_HEADER = [
  "Grade",
  "Item Code",
  "Product",
  "Type",
  "Category",
  "Status",
  "Colour",
  "House Code",
  "Size",
  "SKU",
  "Price (₹)",
  "MRP (₹)",
  "Stock",
];

export const PRICE_LIST_ALL_HEADER = ["School Code", "School", ...PRICE_LIST_HEADER];

export const PRICE_LIST_COL_WIDTHS = [
  { wch: 14 }, // Grade
  { wch: 16 }, // Item Code
  { wch: 42 }, // Product
  { wch: 12 }, // Type
  { wch: 18 }, // Category
  { wch: 10 }, // Status
  { wch: 18 }, // Colour
  { wch: 11 }, // House Code
  { wch: 14 }, // Size
  { wch: 24 }, // SKU
  { wch: 11 }, // Price
  { wch: 10 }, // MRP
  { wch: 8 }, // Stock
];

export type PriceListSheet = { name: string; aoa: (string | number)[][] };

/** Excel tab names: ≤31 chars, and none of : \ / ? * [ ] */
function sheetName(raw: string, taken: Set<string>) {
  let base = (raw || "Sheet").replace(/[:\\/?*[\]]/g, "-").slice(0, 31).trim() || "Sheet";
  let name = base;
  let n = 2;
  while (taken.has(name.toLowerCase())) {
    const suffix = ` (${n++})`;
    name = base.slice(0, 31 - suffix.length) + suffix;
  }
  taken.add(name.toLowerCase());
  return name;
}

type Entry = { grade: string; product: string; seq: number; row: (string | number)[] };

export async function buildProductPriceList(f: ProductExportFilters): Promise<{
  sheets: PriceListSheet[];
  productCount: number;
  rowCount: number;
  schoolCount: number;
  schoolCode: string | null;
  kindFilter: string;
}> {
  const d: LoadedProductExport = await loadProductExportData(f);
  const { rows, catName, schoolsByProduct, gradesByProduct } = d;
  const onlySchool = f.schoolId ? d.schoolCode : null;
  const onlyGrade = (f.grade ?? "").trim() || null;

  // school code → { name, entries }
  const bySchool = new Map<string, { name: string; entries: Entry[] }>();
  const all: Entry[] = [];
  let seq = 0;

  for (const p of rows) {
    const tails = variantTailRows(p, d);
    if (!tails.length) continue;

    const mid = [
      p.itemCode ?? "",
      p.name,
      KIND_LABEL[p.kind] ?? p.kind ?? "",
      (p.categoryId && catName.get(p.categoryId)) || "",
      p.status,
    ];
    // An active school / grade filter narrows the ROWS too, not just which
    // products qualify — a "Grade 5" price list must contain Grade 5 rows only.
    let schoolList = schoolsByProduct.get(p.id)?.length
      ? schoolsByProduct.get(p.id)!
      : [NO_SCHOOL];
    if (onlySchool) schoolList = schoolList.filter((s) => s.code === onlySchool);
    let gradeList = gradesByProduct.get(p.id)?.length
      ? [...gradesByProduct.get(p.id)!].sort(byGrade)
      : [NO_GRADE];
    if (onlyGrade) gradeList = gradeList.filter((g) => g === onlyGrade);
    if (!schoolList.length || !gradeList.length) continue;

    for (const school of schoolList) {
      const bucket = bySchool.get(school.code) ?? { name: school.name, entries: [] };
      for (const grade of gradeList) {
        for (const tail of tails) {
          const row = [grade, ...mid, ...tail];
          const entry = { grade, product: p.name, seq: seq++, row };
          bucket.entries.push(entry);
          all.push({ ...entry, row: [school.code, school.name, ...row] });
        }
      }
      bySchool.set(school.code, bucket);
    }
  }

  // Grade first (Nursery → Grade 12), then product, then the variant order
  // variantTailRows already put colour/size in.
  const sortEntries = (a: Entry, b: Entry) =>
    byGrade(a.grade, b.grade) || a.product.localeCompare(b.product) || a.seq - b.seq;

  const taken = new Set<string>();
  const sheets: PriceListSheet[] = [];

  // "All schools" first — every row, with the school spelled out.
  const allSorted = [...all].sort(
    (a, b) =>
      String(a.row[0]).localeCompare(String(b.row[0])) ||
      byGrade(a.grade, b.grade) ||
      a.product.localeCompare(b.product) ||
      a.seq - b.seq,
  );
  sheets.push({
    name: sheetName("All schools", taken),
    aoa: [PRICE_LIST_ALL_HEADER, ...allSorted.map((e) => e.row)],
  });

  // One tab per school, alphabetical by code; unmapped items last.
  const codes = [...bySchool.keys()].sort((a, b) => {
    const au = a === NO_SCHOOL.code ? 1 : 0;
    const bu = b === NO_SCHOOL.code ? 1 : 0;
    return au - bu || a.localeCompare(b);
  });
  for (const code of codes) {
    const bucket = bySchool.get(code)!;
    const label = code === NO_SCHOOL.code ? "Unassigned" : code;
    sheets.push({
      name: sheetName(label, taken),
      aoa: [PRICE_LIST_HEADER, ...bucket.entries.sort(sortEntries).map((e) => e.row)],
    });
  }

  return {
    sheets,
    productCount: rows.length,
    rowCount: all.length,
    schoolCount: codes.filter((c) => c !== NO_SCHOOL.code).length,
    schoolCode: d.schoolCode,
    kindFilter: d.kindFilter,
  };
}
