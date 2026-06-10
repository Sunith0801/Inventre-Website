export type Product = {
  id: string;
  /** URL slug used by the PDP route (/shop/[slug]). */
  slug?: string;
  name: string;
  categoryPath: string[];
  type: "boys" | "girls" | "all";
  price: number;
  mrp?: number;
  sizes: string[];
  inStock: boolean;
  stockLeft?: number; // for "Only X left" indicator
  badge?: "NEW" | "BESTSELLER" | "LOW STOCK";
  img: string | null;
  /** Optional gallery — falls back to [img] if absent. */
  images?: { id: string; url: string; alt: string | null }[];
  required: boolean;
  isMagicBox?: boolean;
  isKit?: boolean;
  hasLangOptions?: boolean;
  /** Backend `products.kind` (e.g. 'kit' | 'uniform' | 'book' | …). Optional
   *  on the legacy seed data — PDP code that gates on kit-specific behavior
   *  should fall back to `isKit` when this isn't set. */
  kind?: string;
  // PDP-only fields (optional — fall back to defaults)
  tagline?: string;
  description?: string[];
  specs?: { label: string; value: string }[];
  sizeTable?: { size: string; chest: string; length: string; sleeve: string }[];
  /** Optional size-chart reference image rendered above the size table. */
  sizeChartUrl?: string | null;
  /** Template-level variant options (e.g. Hindi / Kannada Bookkit). When
   *  present, the PDP renders an attribute selector that navigates to the
   *  chosen variant's own PDP. */
  templateVariants?: {
    id: string;
    name: string;
    slug: string;
    price: number;
    mrp: number | null;
    inStock: boolean;
    attributeName: string | null;
    attributeValue: string | null;
  }[];
  /** Multi-attribute selectors (Uniform Colors, Shirt Size, etc.). */
  attributeGroups?: { name: string; values: string[] }[];
  /** {buildAttributeKey({attr → value})}-keyed map → variantId. Present on
   *  Item-Variant template PDPs so the multi-axis picker can resolve a
   *  full selection client-side. See lib/attribute-key.ts. */
  variantsByAttributeKey?: Record<string, string>;
  /** Stand-in PDP image for kits without uploaded photos (sibling kit's
   *  photo, nearest grade). Only consumed by the PDP, never by grid cards. */
  fallbackImageUrl?: string | null;
  rating?: { score: number; count: number; distribution: number[] };
  variantPrices?: { [size: string]: { price: number; mrp: number | null } };
  /** Full per-variant rows, populated on the PDP. Used to look up the
   *  resolved variant's price when the customer's picked colour + size,
   *  which the size-keyed `variantPrices` map can't disambiguate. */
  variants?: {
    id: string;
    size: string;
    sku: string;
    stockQty: number;
    pricePaise: number;
    mrpPaise: number | null;
  }[];
  /** size → variantId map, populated on the PDP. Allows add-to-cart to skip
   *  the getVariantId round-trip when the id is already known. */
  variantIds?: { [size: string]: string };
  /** size → remaining stock count. Drives the "Only N left" indicator per
   *  variant on the PDP, replacing the previous catalog-wide stockLeft. */
  variantStocks?: { [size: string]: number };
  reviews?: {
    name: string;
    school: string;
    rating: number;
    date: string;
    verified: boolean;
    body: string;
  }[];
};

const enc = encodeURI;

export const PRODUCTS: Product[] = [
  {
    id: "regular-shirt",
    name: "Regular Uniform Shirt",
    categoryPath: ["uniform", "regular", "shirt"],
    type: "all",
    price: 549,
    mrp: 649,
    sizes: ["XS", "S", "M", "L", "XL"],
    inStock: true,
    badge: "BESTSELLER",
    img: enc("https://pub-d46aef8f98ef4da0a1834fb6f554ae2c.r2.dev/images/REGULAR UNIFORM.png"),
    required: true,
  },
  {
    id: "sports-set",
    name: "Sports Uniform Set",
    categoryPath: ["uniform", "sports", "track-pant"],
    type: "all",
    price: 899,
    mrp: 999,
    sizes: ["XS", "S", "M", "L", "XL"],
    inStock: true,
    img: enc("https://pub-d46aef8f98ef4da0a1834fb6f554ae2c.r2.dev/images/Sports uniform.png"),
    required: true,
  },
  {
    id: "tshirt",
    name: "House T-Shirt",
    categoryPath: ["uniform", "regular", "t-shirt"],
    type: "all",
    price: 399,
    mrp: 499,
    sizes: [
      "18", "20", "22", "24", "26", "28", "30", "32",
      "34", "36", "38", "40", "42", "44", "46", "48",
    ],
    inStock: true,
    stockLeft: 8,
    badge: "NEW",
    img: enc("https://pub-d46aef8f98ef4da0a1834fb6f554ae2c.r2.dev/images/Tshirt(product range).webp"),
    required: false,
    tagline:
      "Pre-shrunk cotton-blend tee in your school's house colors. Soft on day one, holds shape after fifty washes.",
    description: [
      "The House T-Shirt is the everyday workhorse of the Inventre kit. Cut from a 200 GSM cotton-blend pique with a tailored collar, it sits clean under blazers and breathes through long sports periods.",
      "Engineered for Indian classrooms — the placket sits flat, the side seams are double-stitched against pull, and the collar holds its shape through monsoon-season laundry. Pre-shrunk so the fit you order is the fit your child wears in October.",
    ],
    specs: [
      { label: "Fabric", value: "60% Cotton · 40% Polyester pique, 200 GSM" },
      { label: "Fit", value: "Tailored regular (true to size)" },
      { label: "Care", value: "Machine wash cold · tumble dry low · low iron" },
      { label: "Origin", value: "Made in Tirupur, India" },
      { label: "Stitch", value: "Double-stitched seams · reinforced shoulder" },
      { label: "Approval", value: "School-approved house tee · Inventre QC tested" },
    ],
    sizeTable: [
      { size: "18", chest: "18 in", length: "16 in", sleeve: "5 in" },
      { size: "20", chest: "20 in", length: "17 in", sleeve: "5.5 in" },
      { size: "22", chest: "22 in", length: "18 in", sleeve: "6 in" },
      { size: "24", chest: "24 in", length: "19 in", sleeve: "6.5 in" },
      { size: "26", chest: "26 in", length: "20 in", sleeve: "7 in" },
      { size: "28", chest: "28 in", length: "21 in", sleeve: "7.5 in" },
      { size: "30", chest: "30 in", length: "22 in", sleeve: "8 in" },
      { size: "32", chest: "32 in", length: "23 in", sleeve: "8.5 in" },
      { size: "34", chest: "34 in", length: "24 in", sleeve: "9 in" },
      { size: "36", chest: "36 in", length: "25 in", sleeve: "9.5 in" },
      { size: "38", chest: "38 in", length: "26 in", sleeve: "10 in" },
      { size: "40", chest: "40 in", length: "27 in", sleeve: "10.5 in" },
      { size: "42", chest: "42 in", length: "28 in", sleeve: "11 in" },
      { size: "44", chest: "44 in", length: "28.5 in", sleeve: "11.25 in" },
      { size: "46", chest: "46 in", length: "29 in", sleeve: "11.5 in" },
      { size: "48", chest: "48 in", length: "29.5 in", sleeve: "12 in" },
    ],
    rating: {
      score: 4.7,
      count: 184,
      distribution: [142, 32, 6, 2, 2], // 5★ to 1★
    },
    reviews: [
      {
        name: "Ramya Iyer",
        school: "Indus International",
        rating: 5,
        date: "12 days ago",
        verified: true,
        body: "Has held up through five months of monsoon laundry without losing shape. The collar still stands. Bought a second one in M after my son grew.",
      },
      {
        name: "Vikram Shetty",
        school: "Yellow Train Intl.",
        rating: 5,
        date: "3 weeks ago",
        verified: true,
        body: "Quality genuinely surprised me — feels closer to a brand sportswear tee than a school uniform. Stitching is tight, no bobble after PE classes.",
      },
      {
        name: "Anitha M.",
        school: "Winmore Academy",
        rating: 4,
        date: "1 month ago",
        verified: true,
        body: "Solid build. Only feedback: the M ran slightly slim — sized up to L for a roomier fit. Otherwise, thrilled with the colors.",
      },
    ],
  },
  {
    id: "hoodie",
    name: "Winter Hoodie",
    categoryPath: ["uniform", "winter", "hoodie"],
    type: "all",
    price: 1199,
    mrp: 1399,
    sizes: ["S", "M", "L", "XL"],
    inStock: true,
    badge: "LOW STOCK",
    img: enc("https://pub-d46aef8f98ef4da0a1834fb6f554ae2c.r2.dev/images/WinterHoodie.png"),
    required: false,
  },
  {
    id: "school-bag",
    name: "School Backpack",
    categoryPath: ["uniform", "accessories", "bags"],
    type: "all",
    price: 1499,
    sizes: ["Standard"],
    inStock: true,
    img: enc("https://pub-d46aef8f98ef4da0a1834fb6f554ae2c.r2.dev/images/bags.png"),
    required: true,
  },
  {
    id: "school-shoes",
    name: "School Shoes",
    categoryPath: ["uniform", "essentials", "shoes"],
    type: "all",
    price: 1299,
    mrp: 1499,
    sizes: ["UK 1", "UK 2", "UK 3", "UK 4", "UK 5", "UK 6"],
    inStock: true,
    img: enc("https://pub-d46aef8f98ef4da0a1834fb6f554ae2c.r2.dev/images/shoes.png"),
    required: true,
  },
  {
    id: "socks",
    name: "Uniform Socks (5 pairs)",
    categoryPath: ["uniform", "accessories", "socks"],
    type: "all",
    price: 449,
    sizes: ["S", "M", "L"],
    inStock: true,
    img: enc("https://pub-d46aef8f98ef4da0a1834fb6f554ae2c.r2.dev/images/socks(product range).webp"),
    required: true,
  },
  {
    id: "bottle",
    name: "Insulated Water Bottle",
    categoryPath: ["uniform", "essentials", "bottle"],
    type: "all",
    price: 599,
    mrp: 699,
    sizes: ["500ml", "750ml"],
    inStock: true,
    badge: "BESTSELLER",
    img: enc("https://pub-d46aef8f98ef4da0a1834fb6f554ae2c.r2.dev/images/bottle(product range).webp"),
    required: true,
  },
  {
    id: "accessories-bundle",
    name: "Accessories Bundle",
    categoryPath: ["uniform", "accessories"],
    type: "all",
    price: 799,
    sizes: ["One size"],
    inStock: false,
    img: enc("https://pub-d46aef8f98ef4da0a1834fb6f554ae2c.r2.dev/images/ACCESSORIES.png"),
    required: false,
  },
  {
    id: "essentials-kit",
    name: "K-12 Essentials Kit",
    categoryPath: ["books-bundle"],
    type: "all",
    price: 2499,
    mrp: 2899,
    sizes: ["S", "M", "L"],
    inStock: true,
    badge: "BESTSELLER",
    img: enc("https://pub-d46aef8f98ef4da0a1834fb6f554ae2c.r2.dev/images/All-K-12-essentials.webp"),
    required: false,
  },
];

// Hierarchical category tree (matches inventre.in/profile.html structure)
export type CategoryNode = {
  id: string;
  label: string;
  children?: CategoryNode[];
};

export const CATEGORY_TREE: CategoryNode[] = [
  {
    id: "uniform",
    label: "Uniform",
    children: [
      {
        id: "winter",
        label: "Winter Uniform",
        children: [{ id: "hoodie", label: "Hoodie" }],
      },
      {
        id: "essentials",
        label: "Essentials",
        children: [
          { id: "bottle", label: "Bottle" },
          { id: "shoes", label: "Shoes" },
        ],
      },
      {
        id: "accessories",
        label: "Accessories",
        children: [
          { id: "bloomers", label: "Bloomers" },
          { id: "tights", label: "Tights" },
          { id: "scarf", label: "Scarf" },
          { id: "tie", label: "Tie" },
          { id: "bow-tie", label: "Bow Tie" },
          { id: "caps", label: "Caps" },
          { id: "belt", label: "Belt" },
          { id: "bags", label: "Bags" },
          { id: "socks", label: "Socks" },
        ],
      },
      {
        id: "regular",
        label: "Regular",
        children: [
          { id: "waist-coat", label: "Waist Coat" },
          { id: "blazers", label: "Blazers" },
          { id: "t-shirt", label: "T-Shirt" },
          { id: "skort", label: "Skort" },
          { id: "frock", label: "Frock" },
          { id: "skirt", label: "Skirt" },
          { id: "half-pants", label: "Half Pants" },
          { id: "full-pants", label: "Full Pants" },
          { id: "shirt", label: "Shirt" },
        ],
      },
      {
        id: "sports",
        label: "Sports Uniform",
        children: [
          { id: "track-shorts", label: "Track Shorts" },
          { id: "rnt", label: "RNT" },
          { id: "track-pant", label: "Track Pant" },
          { id: "sports-tshirt", label: "Tshirt" },
        ],
      },
    ],
  },
  {
    id: "books-bundle",
    label: "Books Bundle",
  },
];

export const ALL_SIZES = ["XS", "S", "M", "L", "XL"];
