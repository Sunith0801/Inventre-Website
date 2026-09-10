"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { auth } from "@/lib/auth";
import { useFocusRefetch } from "@/lib/use-focus-refetch";
import { ChevronRight, ArrowLeft } from "lucide-react";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { MiniCart } from "@/components/shop/MiniCart";
import { Gallery } from "@/components/shop/pdp/Gallery";
import { BuyBox } from "@/components/shop/pdp/BuyBox";
import { Tabs } from "@/components/shop/pdp/Tabs";
import { SizeGuide } from "@/components/shop/pdp/SizeGuide";
import { Reviews } from "@/components/shop/pdp/Reviews";
import { RelatedProducts } from "@/components/shop/pdp/RelatedProducts";
import { StickyMobileBar } from "@/components/shop/pdp/StickyMobileBar";
import { BundleTree } from "@/components/shop/BundleTree";
import { MagicBoxConfigurator } from "@/components/shop/MagicBoxConfigurator";
import { MultiAttributePicker } from "@/components/shop/pdp/MultiAttributePicker";
import { PdpSelectionProvider } from "@/components/shop/pdp/SelectionContext";
import { useProductDraft, type ProductDraftState } from "@/lib/product-draft";
import { Package } from "lucide-react";
import { parseKitLang, parseKitThirdLang, parseBookkitLangs, type LangPair } from "@/lib/bookkit-langs";
import { useCart } from "@/lib/cart";
import { motion, AnimatePresence } from "framer-motion";
import type { Product } from "@/lib/products";
import type {
  ProductDetailDto,
  ProductCardDto,
  BundleNode,
} from "@/server/repos/products";

function dtoToProduct(d: ProductDetailDto): Product {
  return {
    id: d.id,
    slug: d.slug,
    name: d.name,
    categoryPath: d.categoryPath,
    type: "all",
    price: d.price,
    mrp: d.mrp ?? undefined,
    sizes: d.sizes,
    inStock: d.inStock,
    badge:
      d.badge === "LOW_STOCK"
        ? "LOW STOCK"
        : (d.badge as Product["badge"]) ?? undefined,
    img: d.img,
    images: d.images.length > 0 ? d.images : undefined,
    required: d.required,
    tagline: d.tagline ?? undefined,
    description: d.description ?? undefined,
    specs: d.specs ?? undefined,
    sizeTable: d.sizeTable ?? undefined,
    sizeChartUrl: d.sizeChartUrl ?? null,
    imageNote: d.imageNote ?? null,
    rating: d.rating ?? undefined,
    // Full per-variant rows — required so BuyBox can look up the exact
    // pricePaise of the resolved Colour × Size variant via
    // variantsByAttributeKey. Without this, the size-only `variantPrices`
    // map below is the only signal, and it collapses multiple colours
    // sharing one size into a single (last-wins) price.
    variants: d.variants.map((v) => ({
      id: v.id,
      size: v.size,
      sku: v.sku,
      stockQty: v.stockQty,
      pricePaise: v.pricePaise,
      mrpPaise: v.mrpPaise,
      priced: v.priced,
    })),
    variantPrices: d.variants.length > 0
      ? Object.fromEntries(
          d.variants.map((v) => [
            v.size,
            {
              price: Math.round(v.pricePaise / 100),
              mrp: v.mrpPaise != null ? Math.round(v.mrpPaise / 100) : null,
              priced: v.priced,
            },
          ])
        )
      : undefined,
    variantIds: d.variants.length > 0
      ? Object.fromEntries(d.variants.map((v) => [v.size, v.id]))
      : undefined,
    variantStocks: d.variants.length > 0
      ? Object.fromEntries(d.variants.map((v) => [v.size, v.stockQty]))
      : undefined,
    reviews: [],
    stockLeft: d.variants.reduce((s, v) => s + v.stockQty, 0),
    templateVariants: d.templateVariants,
    attributeGroups: d.attributeGroups,
    variantsByAttributeKey: d.variantsByAttributeKey,
    fallbackImageUrl: d.fallbackImageUrl,
    kind: d.kind,
  };
}

const LANG_COLORS: Record<string, { bg: string; ring: string; text: string; gradient: string }> = {
  Hindi:   { bg: "bg-orange-50",  ring: "ring-orange-400",  text: "text-orange-700", gradient: "bg-gradient-to-br from-orange-100 via-orange-200 to-orange-300" },
  Telugu:  { bg: "bg-teal-50",    ring: "ring-teal-400",    text: "text-teal-700",   gradient: "bg-gradient-to-br from-teal-100 via-teal-200 to-teal-300" },
  French:  { bg: "bg-blue-50",    ring: "ring-blue-400",    text: "text-blue-700",   gradient: "bg-gradient-to-br from-blue-100 via-blue-200 to-blue-300" },
  Kannada: { bg: "bg-yellow-50",  ring: "ring-yellow-400",  text: "text-yellow-700", gradient: "bg-gradient-to-br from-yellow-100 via-yellow-200 to-yellow-300" },
  Sanskrit:{ bg: "bg-purple-50",  ring: "ring-purple-400",  text: "text-purple-700", gradient: "bg-gradient-to-br from-purple-100 via-purple-200 to-purple-300" },
  Marathi: { bg: "bg-rose-50",    ring: "ring-rose-400",    text: "text-rose-700",   gradient: "bg-gradient-to-br from-rose-100 via-rose-200 to-rose-300" },
  Tamil:   { bg: "bg-emerald-50", ring: "ring-emerald-400", text: "text-emerald-700",gradient: "bg-gradient-to-br from-emerald-100 via-emerald-200 to-emerald-300" },
  English: { bg: "bg-sky-50",     ring: "ring-sky-400",     text: "text-sky-700",    gradient: "bg-gradient-to-br from-sky-100 via-sky-200 to-sky-300" },
  _default:{ bg: "bg-cream-100",  ring: "ring-ink-400",     text: "text-ink-700",    gradient: "bg-gradient-to-br from-cream-100 via-cream-200 to-cream-300" },
};

function LangCard({
  lang,
  subtitle,
  price,
  active,
  onClick,
}: {
  lang: string;
  subtitle?: string;
  price?: number;
  active: boolean;
  onClick: () => void;
}) {
  const col = LANG_COLORS[lang] ?? LANG_COLORS._default;
  return (
    <motion.button
      type="button"
      onClick={onClick}
      layout
      whileTap={{ scale: 0.97 }}
      animate={active ? { scale: 1.02 } : { scale: 1 }}
      transition={{ type: "spring", stiffness: 400, damping: 25 }}
      className={[
        "relative flex flex-col items-center justify-center gap-1 rounded-2xl cursor-pointer select-none transition-all duration-200",
        "border-2",
        active
          ? `${col.gradient} ${col.ring.replace("ring-", "border-")} ${col.text} shadow-lg px-8 py-5 min-w-[130px]`
          : `bg-white border-ink-100 text-ink-700 hover:border-ink-300 px-5 py-4 min-w-[96px]`,
      ].join(" ")}
    >
      {active && (
        <motion.span
          layoutId="lang-active-dot"
          className={`absolute top-2 right-2.5 h-2.5 w-2.5 rounded-full ${col.ring.replace("ring-", "bg-")}`}
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
        />
      )}
      <span className={`text-[10px] font-bold uppercase tracking-[0.16em] opacity-70 ${active ? col.text : "text-ink-400"}`}>
        2nd Language
      </span>
      <span className={`font-display tracking-tight leading-tight ${active ? "text-[20px] font-extrabold" : "text-[17px] font-bold"}`}>
        {lang}
      </span>
      {subtitle && (
        <span className={`text-[10px] font-semibold mt-0.5 ${active ? col.text : "text-ink-400"}`}>
          {subtitle}
        </span>
      )}
      {price != null && price > 0 && (
        <span className={`font-bold mt-0.5 ${active ? "text-[14px]" : "text-[12px] text-ink-500"}`}>
          ₹{price.toLocaleString("en-IN")}
        </span>
      )}
    </motion.button>
  );
}

function LangSummary({ secondLang, thirdLang, color }: { secondLang: string; thirdLang?: string; color: { bg: string; text: string; ring: string; gradient: string } }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      className={`mt-3 mb-1 flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 ${color.gradient} ${color.ring.replace("ring-", "border-")}`}
    >
      <div className="flex items-center gap-2">
        <span className={`text-[11px] font-bold uppercase tracking-widest opacity-70 ${color.text}`}>2nd Language</span>
        <span className={`text-[16px] font-extrabold font-display ${color.text}`}>{secondLang}</span>
      </div>
      {thirdLang && (
        <>
          <span className="text-ink-300">·</span>
          <div className="flex items-center gap-2">
            <span className={`text-[11px] font-bold uppercase tracking-widest opacity-70 ${color.text}`}>3rd Language (auto)</span>
            <span className={`text-[16px] font-extrabold font-display ${color.text}`}>{thirdLang}</span>
          </div>
        </>
      )}
    </motion.div>
  );
}

function KitLangPicker({
  variants,
  activeSlug,
  onPick,
}: {
  variants: { id: string; name: string; slug: string; price?: number; img?: string | null }[];
  activeSlug: string;
  onPick: (slug: string) => void;
}) {
  const activeVariant = variants.find((v) => v.slug === activeSlug);
  const activeLang = activeVariant ? (parseKitLang(activeVariant.name) ?? activeVariant.name) : null;
  const activeThird = activeVariant ? parseKitThirdLang(activeVariant.name) : null;
  const col = activeLang ? (LANG_COLORS[activeLang] ?? LANG_COLORS._default) : LANG_COLORS._default;

  return (
    <div className="mb-6">
      <p className="text-[11px] font-semibold tracking-[0.16em] uppercase text-ink-500 mb-3">
        Select 2nd Language
      </p>
      <div className="flex flex-wrap gap-3">
        {variants.map((v) => {
          const lang = parseKitLang(v.name) ?? v.name;
          const third = parseKitThirdLang(v.name);
          return (
            <LangCard
              key={v.id}
              lang={lang}
              subtitle={third ? `3rd: ${third}` : undefined}
              price={v.price}
              active={v.slug === activeSlug}
              onClick={() => onPick(v.slug)}
            />
          );
        })}
      </div>
      <AnimatePresence>
        {activeLang && (
          <LangSummary
            key={activeLang}
            secondLang={activeLang}
            thirdLang={activeThird ?? undefined}
            color={col}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function TemplateLangPicker({
  pairs,
  selected,
  onPick,
}: {
  pairs: LangPair[];
  selected: LangPair | null;
  onPick: (pair: LangPair) => void;
}) {
  const secondLangs = [...new Set(pairs.map((p) => p.secondLang))];
  const col = selected ? (LANG_COLORS[selected.secondLang] ?? LANG_COLORS._default) : LANG_COLORS._default;

  return (
    <div className="mb-6">
      <p className="text-[11px] font-semibold tracking-[0.16em] uppercase text-ink-500 mb-3">
        Select 2nd Language
      </p>
      <div className="flex flex-wrap gap-3">
        {secondLangs.map((lang) => {
          const pair = pairs.find((p) => p.secondLang === lang)!;
          return (
            <LangCard
              key={lang}
              lang={lang}
              price={pair.price > 0 ? pair.price : undefined}
              active={selected?.variantId === pair.variantId}
              onClick={() => onPick(pair)}
            />
          );
        })}
      </div>
      <AnimatePresence>
        {selected && (
          <LangSummary
            key={selected.variantId}
            secondLang={selected.secondLang}
            thirdLang={selected.thirdLang || undefined}
            color={col}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function cardDtoToProduct(d: ProductCardDto): Product {
  return {
    id: d.id,
    slug: d.slug,
    name: d.name,
    categoryPath: d.categoryPath,
    type: "all",
    price: d.price,
    mrp: d.mrp ?? undefined,
    sizes: d.sizes,
    inStock: d.inStock,
    badge:
      d.badge === "LOW_STOCK"
        ? "LOW STOCK"
        : (d.badge as Product["badge"]) ?? undefined,
    img: d.img,
    required: d.required,
  };
}

export default function ProductPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const studentId = searchParams.get("studentId") ?? "";
  const studentQuery = studentId
    ? `?studentId=${encodeURIComponent(studentId)}`
    : "";

  // Backfill `?studentId=` from localStorage when the URL has none.
  // StudentBar does this on /shop, but PDP is reachable by deep link,
  // browser refresh, or external nav — without this, addToCart fires
  // with no studentId and `/api/cart` POST now rejects the request
  // (see app/api/cart/route.ts). Validates against the parent's actual
  // student list so a stale id never sticks.
  useEffect(() => {
    if (studentId) return;
    if (typeof window === "undefined") return;
    const saved = window.localStorage.getItem("inv:lastStudentId");
    let cancelled = false;
    auth.me().then((me) => {
      if (cancelled) return;
      if (!me || me.kind !== "parent") return;
      if (me.students.length === 0) return;
      // Prefer the previously-selected child; fall back to me.students[0]
      // (deterministic post-c58d7fe — oldest enrollment first) when the
      // saved id is missing or stale. Single-child families with a fresh
      // browser were hitting "Missing studentId" 400s on Add-to-cart
      // because the saved id was null and we returned without setting
      // the URL.
      const validSaved =
        saved && me.students.some((s) => s.id === saved) ? saved : null;
      const targetId = validSaved ?? me.students[0].id;
      const sp = new URLSearchParams(Array.from(searchParams.entries()));
      sp.set("studentId", targetId);
      router.replace(`${pathname}?${sp.toString()}`);
    });
    return () => {
      cancelled = true;
    };
  }, [studentId, searchParams, pathname, router]);
  const [product, setProduct] = useState<Product | null>(null);
  const [bundleTree, setBundleTree] = useState<BundleNode[]>([]);
  const [isMagicBox, setIsMagicBox] = useState(false);
  const [boxVariantId, setBoxVariantId] = useState("");
  const [productKind, setProductKind] = useState<string>('');
  // Raw template variant rows (kept separately because Product type
  // strips them). Used by the language-picker Add-to-Cart to map a
  // selected sibling slug → the template's variant id.
  const [templateVariants, setTemplateVariants] = useState<
    { id: string; size: string }[]
  >([]);
  const [kitLanguageVariants, setKitLanguageVariants] = useState<
    { id: string; name: string; slug: string; price: number; img: string | null }[]
  >([]);
  const [related, setRelated] = useState<Product[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [notFound, setNotFound] = useState(false);

  // Language-switching state for kit PDPs — avoids full page navigation.
  const [activeLangSlug, setActiveLangSlug] = useState<string>(id);
  const [langData, setLangData] = useState<Map<string, { bundleTree: BundleNode[]; price: number; name: string; img: string | null; variantId: string | null }>>(new Map());
  // Template-variant language pairs (Grade 7 style: language options stored as product_variants)
  const [templateLangPairs, setTemplateLangPairs] = useState<LangPair[] | null>(null);
  const [selectedTemplateLang, setSelectedTemplateLang] = useState<LangPair | null>(null);
  const [templateLangTree, setTemplateLangTree] = useState<BundleNode[]>([]);
  const [templateLangTreeLoading, setTemplateLangTreeLoading] = useState(false);
  // Multi-axis Item-Variant picker state for kits like SMS Grade 11 Bookkit.
  const [multiAxisVariantId, setMultiAxisVariantId] = useState<string | null>(null);
  const [multiAxisSections, setMultiAxisSections] = useState<
    { axisName: string; value: string; productName: string | null; tree: BundleNode[] }[]
  >([]);
  const [multiAxisLoading, setMultiAxisLoading] = useState(false);
  const [multiAxisVariantPrice, setMultiAxisVariantPrice] = useState<number | null>(null);
  const [mandatesByAxis, setMandatesByAxis] = useState<{
    axisName: string;
    subjectsByValue: Record<string, string[]>;
  } | null>(null);
  // Bumped on tab focus to force the main PDP fetch effect to re-run so
  // any admin update lands without a manual refresh.
  const [refreshTick, setRefreshTick] = useState(0);
  const { add: addToCart, addByVariantId, lines: cartLines } = useCart();
  const [addError, setAddError] = useState<string | null>(null);
  // When a bookkit add is blocked because it's already placed for the
  // student, this carries the existing order to link to ("view").
  const [addOrderLink, setAddOrderLink] = useState<string | null>(null);
  const [addBusy, setAddBusy] = useState(false);

  // Per-product draft persistence. Survives navigation away (in-app or
  // browser-tab) and logout/login. Restored silently on revisit; cleared
  // on successful Add-to-Cart.
  const draft = useProductDraft({
    productId: product?.id,
    studentId: studentId || null,
    enabled: !!product,
  });
  // Show "Restored your last selection" once, fade after 4s.
  const [showRestoreToast, setShowRestoreToast] = useState(false);
  useEffect(() => {
    if (!draft.didRestore) return;
    setShowRestoreToast(true);
    const t = setTimeout(() => setShowRestoreToast(false), 4000);
    return () => clearTimeout(t);
  }, [draft.didRestore]);

  useEffect(() => {
    setMandatesByAxis(null);
    if (!product?.id) return;
    let cancelled = false;
    fetch(`/api/shop/kit-mandates/${product.id}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data?.axisName) return;
        setMandatesByAxis({
          axisName: data.axisName,
          subjectsByValue: data.subjectsByValue ?? {},
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [product?.id]);

  // True when a complimentary (₹0) bookkit is already in the cart — used to
  // disable the Add to Cart button on bookkit PDPs so the restriction is
  // visible upfront rather than shown as an error after clicking.
  const freeBookkitInCart = cartLines.some(
    (l) => l.unitPrice === 0 && /bookkit|bookset/i.test(l.productName)
  );
  const isBookkitProduct = /bookkit|bookset/i.test(product?.name ?? "");

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch(`/api/shop/products/${id}${studentQuery}`, { cache: "no-store" }).then((r) => {
        if (r.status === 404) {
          setNotFound(true);
          return null;
        }
        return r.json();
      }),
      fetch(`/api/shop/products${studentQuery}`, { cache: "no-store" }).then((r) => r.json()),
    ])
      .then(([p, all]) => {
        if (cancelled) return;
        if (p?.product) {
          setProduct(dtoToProduct(p.product));
          const initialTree: BundleNode[] = p.product.bundleTree ?? [];
          setBundleTree(initialTree);
          setTemplateVariants(
            (p.product.variants ?? []).map(
              (v: { id: string; size: string }) => ({ id: v.id, size: v.size })
            )
          );
          setIsMagicBox(!!p.product.isMagicBox);
          setBoxVariantId(p.product.variants?.[0]?.id ?? "");
          setProductKind(p.product.kind ?? '');
          const langVariants: { id: string; name: string; slug: string; price: number; img: string | null }[] =
            p.product.kitLanguageVariants ?? [];
          setKitLanguageVariants(langVariants);
          setActiveLangSlug(id);
          // If no sibling lang kits found, check for template-variant language pattern
          if (
            langVariants.length === 0 &&
            (p.product.kind === 'kit' || p.product.kind === 'set')
          ) {
            const rawVars = (p.product.variants ?? []).map((v: { id: string; size: string; pricePaise: number }) => ({
              id: v.id,
              size: v.size,
              pricePaise: v.pricePaise,
            }));
            const pairs = parseBookkitLangs(rawVars);
            setTemplateLangPairs(pairs);
          }

          // Seed the current page's data into langData.
          const initialMap = new Map<string, { bundleTree: BundleNode[]; price: number; name: string; img: string | null; variantId: string | null }>();
          initialMap.set(id, {
            bundleTree: initialTree,
            price: p.product.price,
            name: p.product.name,
            img: p.product.img ?? null,
            variantId: p.product.variants?.[0]?.id ?? null,
          });
          setLangData(initialMap);

          // Prefetch bundle trees for all language variants in parallel.
          if (langVariants.length > 0) {
            Promise.all(
              langVariants.map((v) =>
                fetch(`/api/shop/products/${v.slug}${studentQuery}`, { cache: "no-store" })
                  .then((r) => r.ok ? r.json() : null)
                  .then((data) => ({ slug: v.slug, data }))
                  .catch(() => ({ slug: v.slug, data: null }))
              )
            ).then((results) => {
              if (cancelled) return;
              setLangData((prev) => {
                const next = new Map(prev);
                for (const { slug, data } of results) {
                  if (data?.product) {
                    next.set(slug, {
                      bundleTree: data.product.bundleTree ?? [],
                      price: data.product.price,
                      name: data.product.name,
                      img: data.product.img ?? null,
                      variantId: data.product.variants?.[0]?.id ?? null,
                    });
                  }
                }
                return next;
              });
            });
          }
        }
        if (all?.products) {
          setRelated(
            (all.products as ProductCardDto[])
              .filter((x) => x.slug !== id)
              .slice(0, 3)
              .map(cardDtoToProduct)
          );
        }
      })
      .finally(() => !cancelled && setLoaded(true));
    return () => {
      cancelled = true;
    };
  }, [id, studentQuery, refreshTick]);

  // Refetch the PDP whenever the tab regains focus so admin updates
  // (price, BOM, images, attribute values, category move) show live.
  const bumpRefresh = useCallback(() => setRefreshTick((n) => n + 1), []);
  useFocusRefetch(bumpRefresh);

  // Fetch the per-axis bundle trees + the variant's own price whenever
  // the multi-axis picker resolves to a complete selection.
  useEffect(() => {
    if (!multiAxisVariantId) {
      setMultiAxisSections([]);
      setMultiAxisVariantPrice(null);
      return;
    }
    let cancelled = false;
    setMultiAxisLoading(true);
    fetch(`/api/shop/variant-contents?variantId=${multiAxisVariantId}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        setMultiAxisSections(data?.sections ?? []);
      })
      .catch(() => {
        if (!cancelled) setMultiAxisSections([]);
      })
      .finally(() => {
        if (!cancelled) setMultiAxisLoading(false);
      });
    // Pull the variant's own price out of the DTO that loaded with the
    // page — no extra request needed.
    if (product?.variantPrices) {
      // variantPrices is keyed by `size` (the legacy SKU label). We need to
      // map back from variantId → price. variantIds is the reverse lookup.
      const sizeForVariant = Object.entries(product.variantIds ?? {}).find(
        ([, vid]) => vid === multiAxisVariantId
      )?.[0];
      if (sizeForVariant && product.variantPrices[sizeForVariant]) {
        setMultiAxisVariantPrice(product.variantPrices[sizeForVariant].price);
      }
    }
    return () => {
      cancelled = true;
    };
  }, [multiAxisVariantId, product]);

  // Fetch BOM tree for selected template language variant
  useEffect(() => {
    if (!selectedTemplateLang) { setTemplateLangTree([]); return; }
    let cancelled = false;
    setTemplateLangTreeLoading(true);
    fetch(`/api/shop/bundle-for-variant?variantId=${selectedTemplateLang.variantId}${studentQuery ? `&${studentQuery.slice(1)}` : ''}`, { cache: "no-store" })
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (!cancelled) setTemplateLangTree(data?.bundleTree ?? []); })
      .catch(() => { if (!cancelled) setTemplateLangTree([]); })
      .finally(() => { if (!cancelled) setTemplateLangTreeLoading(false); });
    return () => { cancelled = true; };
  }, [selectedTemplateLang, studentQuery]);

  const scrollToSizeGuide = () => {
    const el = document.getElementById("size-guide");
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      const btn = el.querySelector<HTMLButtonElement>("button");
      btn?.click();
    }
  };

  // Both 'kit' and 'set' use the same PDP layout — they're the same
  // architectural concept (composite parent product whose pricing/contents
  // are derived from selections). 'set' was treated as a regular product
  // earlier, which surfaced the variant SKUs as a size picker — wrong.
  const isKit = productKind === 'kit' || productKind === 'set';

  if (!loaded) {
    return (
      <main className="min-h-screen">
        <Nav />
        <div className="mx-auto max-w-7xl px-5 lg:px-8 pt-10">
          <div className="grid lg:grid-cols-2 gap-10">
            <div className="aspect-square rounded-2xl bg-cream-200 animate-pulse" />
            <div className="space-y-4">
              <div className="h-6 w-24 bg-cream-200 rounded animate-pulse" />
              <div className="h-12 w-3/4 bg-cream-200 rounded animate-pulse" />
              <div className="h-4 w-full bg-cream-200 rounded animate-pulse" />
              <div className="h-12 w-1/2 bg-cream-200 rounded animate-pulse" />
            </div>
          </div>
        </div>
      </main>
    );
  }

  if (notFound || !product) {
    return (
      <main className="min-h-screen">
        <Nav />
        <div className="mx-auto max-w-2xl px-5 py-24 text-center">
          <h1 className="font-display text-3xl font-extrabold text-ink-900">
            Product not found
          </h1>
          <p className="mt-2 text-ink-500">
            That item isn&apos;t in your school&apos;s catalog.
          </p>
          <a
            href={`/shop${studentQuery}`}
            className="mt-6 inline-flex items-center gap-1.5 text-brand font-semibold underline underline-offset-4"
          >
            ← Back to shop
          </a>
        </div>
      </main>
    );
  }

  const breadcrumb = product.categoryPath.map((seg) =>
    seg.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
  );

  return (
    <main className="min-h-screen pb-24 lg:pb-0">
      <Nav />
      {/* Draft-restore toast — appears once when we restored a saved
          selection, fades after 4s. Doesn't block any UI underneath. */}
      {showRestoreToast && (
        <div className="fixed bottom-6 right-6 z-50 max-w-xs rounded-xl border border-emerald-200 bg-white shadow-lg px-4 py-3 flex items-start gap-2.5">
          <span className="mt-1 h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
          <p className="text-[13px] text-ink-700 leading-snug">
            Restored your last selection.
          </p>
        </div>
      )}
      <div className="mx-auto max-w-7xl px-5 lg:px-8 pt-6 lg:pt-8">
        <a
          href={`/shop${studentQuery}`}
          className="inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-500 hover:text-ink-900 transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to shop
        </a>
        <nav
          aria-label="breadcrumb"
          className="mt-3 flex items-center gap-1.5 text-[12px] text-ink-500 flex-wrap"
        >
          <a href={`/shop${studentQuery}`} className="hover:text-ink-900">Shop</a>
          {breadcrumb.map((label, i) => (
            <span key={i} className="inline-flex items-center gap-1.5">
              <ChevronRight className="h-3 w-3 text-ink-300" />
              {i === breadcrumb.length - 1 ? (
                <span className="text-ink-900 font-medium">{label}</span>
              ) : (
                <a href={`/shop${studentQuery}`} className="hover:text-ink-900">{label}</a>
              )}
            </span>
          ))}
        </nav>
      </div>

      {isMagicBox ? (
        <section className="mx-auto max-w-7xl px-5 lg:px-8 pt-6 lg:pt-8">
          <div className="grid lg:grid-cols-[420px_1fr] gap-6 lg:gap-10 items-start">
            {/* Left: product image + info */}
            <div className="lg:sticky lg:top-28 max-w-[340px] mx-auto lg:mx-0">
              {product.img || product.images?.[0]?.url ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={product.img ?? product.images![0].url}
                  alt={product.name}
                  className="block max-h-[300px] w-auto max-w-full rounded-2xl border border-ink-100 bg-cream-100 object-contain p-2"
                  style={{ imageRendering: "auto" }}
                />
              ) : (
                <div className="h-[240px] w-[240px] grid place-items-center rounded-2xl border border-ink-100 bg-cream-100">
                  <Package className="h-12 w-12 text-ink-300" />
                </div>
              )}
              <p className="mt-4 text-[11px] font-semibold tracking-[0.16em] uppercase text-brand">
                Magic Box
              </p>
              <h1 className="mt-1 font-display text-[22px] font-extrabold tracking-tight text-ink-900 leading-tight">
                {product.name}
              </h1>
              {product.tagline && (
                <p className="mt-1.5 text-[13px] text-ink-500">{product.tagline}</p>
              )}
              <div className="mt-3 rounded-xl border border-brand/30 bg-brand/5 px-3 py-2.5 text-[12px] text-ink-700">
                Pick a size for <span className="font-semibold">every item</span>, then add the whole box to your cart in one go.
              </div>
            </div>

            {/* Right: configurator */}
            <div>
              <header className="mb-3 flex items-center gap-2">
                <Package className="h-5 w-5 text-brand" />
                <h2 className="font-display text-[18px] font-extrabold text-ink-900">
                  Configure your Magic Box
                </h2>
                <span className="text-[12px] text-ink-500 ml-1">
                  {bundleTree.length} items — choose a size for each
                </span>
              </header>
              <MagicBoxConfigurator
                nodes={bundleTree}
                boxPrice={product.price}
                boxVariantId={boxVariantId}
                initialPicks={
                  draft.restored?.kind === "magic-box"
                    ? Object.fromEntries(
                        draft.restored.picks.map((p) => [
                          p.componentProductId,
                          p.variantId,
                        ])
                      )
                    : undefined
                }
                onPicksChange={(picks) =>
                  draft.save({
                    kind: "magic-box",
                    picks: Object.entries(picks).map(([componentProductId, variantId]) => ({
                      componentProductId,
                      variantId,
                    })),
                  })
                }
                onAddSuccess={() => draft.clear()}
              />
            </div>
          </div>
        </section>
      ) : isKit ? (
        <section className="mx-auto max-w-7xl px-5 lg:px-8 pt-6 lg:pt-8">
          <div className="grid lg:grid-cols-[420px_1fr] gap-6 lg:gap-10 items-start">
            {/* Left: sticky image + title — updates when language tab is switched */}
            <div className="lg:sticky lg:top-28 max-w-[340px] mx-auto lg:mx-0">
              {(() => {
                // When a language is selected, show that variant's image.
                // Sibling kits (`BookkitHindi`/`BookkitKannada` rows) almost
                // never have their own product_images — they're imported
                // from ERP as variant skeletons. So fall through to the
                // parent template's image, then to the nearest-grade
                // reference photo, before deciding the PDP is image-less.
                // This keeps the gallery populated for every (school, grade,
                // language) combination across all bookkits.
                const isLangSelected = activeLangSlug !== id;
                const ownImg = product.img ?? product.images?.[0]?.url ?? null;
                const langImg = langData.get(activeLangSlug)?.img ?? null;
                const activeImg = isLangSelected
                  ? (langImg ?? ownImg ?? product.fallbackImageUrl ?? null)
                  : (ownImg ?? product.fallbackImageUrl ?? null);
                const isFallback = !langImg && !ownImg && !!product.fallbackImageUrl;
                if (activeImg) {
                  return (
                    <div className="relative inline-block">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={activeImg}
                        alt={langData.get(activeLangSlug)?.name ?? product.name}
                        className="block max-h-[300px] w-auto max-w-full rounded-2xl border border-ink-100 bg-cream-100 object-contain p-2"
                      />
                      {isFallback && (
                        <span className="absolute top-2 right-2 rounded-full bg-ink-900/75 text-white text-[10px] font-semibold uppercase tracking-wider px-2 py-1">
                          Reference image
                        </span>
                      )}
                    </div>
                  );
                }
                // No uploaded photo — render a stylized fallback card so
                // multi-axis kits don't show a blank Package icon. The card
                // surfaces the product name and, when the picker has resolved
                // a selection, the picked subject chips.
                const selectedChips = multiAxisSections.map((s) => s.value);
                return (
                  <div className="w-full max-w-[300px] h-[300px] rounded-2xl border border-ink-100 bg-gradient-to-br from-cream-100 via-cream-50 to-white p-6 flex flex-col">
                    <div className="flex items-center gap-2 text-brand">
                      <Package className="h-5 w-5" />
                      <span className="text-[11px] font-semibold tracking-[0.16em] uppercase">
                        Book Kit
                      </span>
                    </div>
                    <div className="mt-auto">
                      <p className="font-display text-[22px] font-extrabold text-ink-900 leading-tight">
                        {product.name}
                      </p>
                      {selectedChips.length > 0 ? (
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          {selectedChips.map((c) => (
                            <span
                              key={c}
                              className="inline-flex items-center rounded-full bg-ink-900/90 text-white text-[11px] font-semibold px-2.5 py-1"
                            >
                              {c}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <p className="mt-2 text-[12px] text-ink-500">
                          {!isLangSelected && kitLanguageVariants.length > 0
                            ? "Select a language to preview"
                            : "Pick your subjects to preview your kit"}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })()}
              <p className="mt-4 text-[11px] font-semibold tracking-[0.16em] uppercase text-brand">
                Book Kit
              </p>
              <h1 className="mt-1 font-display text-[22px] font-extrabold tracking-tight text-ink-900 leading-tight">
                {langData.get(activeLangSlug)?.name ?? product.name}
              </h1>
              {product.tagline && (
                <p className="mt-1.5 text-[13px] text-ink-500">{product.tagline}</p>
              )}
              {(() => {
                // Multi-axis kits price ₹0 at the template level — show
                // the resolved variant's price once the picker has settled,
                // otherwise hide the price block to avoid a misleading ₹0.
                const livePrice =
                  multiAxisVariantPrice ??
                  langData.get(activeLangSlug)?.price ??
                  product.price;
                const isMultiAxisKit =
                  (product.attributeGroups?.length ?? 0) >= 2 &&
                  Object.keys(product.variantsByAttributeKey ?? {}).length > 1;
                if (isMultiAxisKit && multiAxisVariantPrice == null) {
                  return (
                    <p className="mt-3 text-[12px] text-ink-500">
                      Price shown once your selection is complete
                    </p>
                  );
                }
                return (
                  <div className="mt-3 flex items-baseline gap-2">
                    <span className="font-display text-[28px] font-extrabold text-ink-900">
                      ₹{livePrice.toLocaleString("en-IN")}
                    </span>
                    {product.mrp && product.mrp > livePrice && (
                      <>
                        <span className="text-[15px] line-through text-ink-400">
                          ₹{product.mrp.toLocaleString("en-IN")}
                        </span>
                        <span className="text-[12px] font-bold text-brand">
                          {Math.round((1 - livePrice / product.mrp) * 100)}% OFF
                        </span>
                      </>
                    )}
                  </div>
                );
              })()}
            </div>

            {/* Right: language picker + read-only BOM */}
            <div>
              {kitLanguageVariants.length > 0 && (
                <KitLangPicker
                  variants={kitLanguageVariants}
                  activeSlug={activeLangSlug}
                  onPick={(slug) => setActiveLangSlug(slug)}
                />
              )}
              {kitLanguageVariants.length === 0 && templateLangPairs && templateLangPairs.length > 0 && (
                <TemplateLangPicker
                  pairs={templateLangPairs}
                  selected={selectedTemplateLang}
                  onPick={(pair) => setSelectedTemplateLang(pair)}
                />
              )}
              {(() => {
                const activeLangTree = langData.get(activeLangSlug)?.bundleTree ?? bundleTree;
                const hasLangSelection = kitLanguageVariants.length > 0 || (templateLangPairs && templateLangPairs.length > 0);
                if (activeLangTree.length > 0) {
                  // Add-to-cart for a language-picked kit. When the user
                  // picked a sibling via KitLangPicker, resolve the
                  // template's product_variants entry whose size matches
                  // that sibling's name — that variantId is what the cart
                  // mirrors (siblings don't have their own variants).
                  // For kits with no picker at all, fall back to the
                  // product's first size.
                  const sibling = kitLanguageVariants.find(
                    (v) => v.slug === activeLangSlug
                  );
                  const matchedVariant = sibling
                    ? templateVariants.find((v) => v.size === sibling.name)
                    : undefined;
                  const langData_ = langData.get(activeLangSlug);
                  const displayPrice = langData_?.price ?? product.price;
                  return (
                    <div className="space-y-4">
                      <div>
                        <header className="mb-3 flex items-center gap-2">
                          <Package className="h-5 w-5 text-brand" />
                          <h2 className="font-display text-[18px] font-extrabold text-ink-900">
                            What&apos;s in your kit
                          </h2>
                          <span className="text-[12px] text-ink-500 ml-1">
                            {activeLangTree.length} item{activeLangTree.length === 1 ? "" : "s"} — tap to expand
                          </span>
                        </header>
                        <BundleTree nodes={activeLangTree} readOnly />
                      </div>
                      {product && (
                        <div>
                          <button
                            type="button"
                            disabled={addBusy || (freeBookkitInCart && isBookkitProduct)}
                            onClick={async () => {
                              if (addBusy) return;
                              setAddBusy(true);
                              // Kit-with-language PDPs: the current `product`
                              // is the template (0 variants of its own). Each
                              // sibling language ships its own single variant
                              // id via the prefetch into `langData`. Prefer
                              // that over the legacy size-based lookup, which
                              // can never resolve for kits (no real size axis).
                              const langVariantId = langData.get(activeLangSlug)?.variantId ?? null;
                              const kitFallbackVariantId =
                                product.kind === "kit" || product.isKit === true
                                  ? Object.values(product.variantIds ?? {})[0] ?? null
                                  : null;
                              const r = matchedVariant
                                ? await addByVariantId(matchedVariant.id, 1)
                                : langVariantId
                                  ? await addByVariantId(langVariantId, 1)
                                  : kitFallbackVariantId
                                    ? await addByVariantId(kitFallbackVariantId, 1)
                                    : await addToCart(product, product.sizes[0] ?? "");
                              setAddBusy(false);
                              if (!r.ok && r.error) { setAddError(r.error); setAddOrderLink(r.orderNumber ?? null); }
                              else { setAddError(null); setAddOrderLink(null); }
                            }}
                            className="w-full rounded-full bg-ink-900 px-6 py-3.5 text-[15px] font-bold text-white hover:bg-brand transition-colors shadow-sm disabled:opacity-60 disabled:cursor-not-allowed"
                          >
                            {addBusy ? "Adding…" : `Add to Cart — ₹${displayPrice.toLocaleString("en-IN")}`}
                          </button>
                          {freeBookkitInCart && isBookkitProduct && (
                            <p className="mt-2 text-[14px] font-semibold text-amber-700 text-center leading-snug">Complimentary bookkit already in your cart</p>
                          )}
                          {addError && (
                            <div className="mt-2 text-center leading-snug">
                              <p className="text-[15px] font-semibold text-red-600">{addError}</p>
                              {addOrderLink && (
                                <a href={`/shop/orders/${encodeURIComponent(addOrderLink)}`} className="mt-1 inline-block text-[14px] font-bold text-amber-800 underline underline-offset-2 hover:text-brand">
                                  Order already placed — click here to view
                                </a>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                }
                if (kitLanguageVariants.length > 0) {
                  return (
                    <div className="rounded-xl border border-ink-100 bg-cream-50 px-5 py-8 text-center mt-2">
                      <p className="text-[14px] text-ink-500">
                        Select a language above to see what&apos;s included in your kit.
                      </p>
                    </div>
                  );
                }
                if (templateLangPairs && templateLangPairs.length > 0) {
                  if (!selectedTemplateLang) {
                    return (
                      <div className="rounded-xl border border-ink-100 bg-cream-50 px-5 py-8 text-center mt-2">
                        <p className="text-[14px] text-ink-500">
                          Select a language above to see what&apos;s included in your kit.
                        </p>
                      </div>
                    );
                  }
                  return (
                    <div className="mt-2 space-y-4">
                      {templateLangTreeLoading ? (
                        <div className="rounded-xl border border-ink-100 bg-cream-50 px-5 py-6 text-center">
                          <p className="text-[13px] text-ink-400">Loading kit contents…</p>
                        </div>
                      ) : templateLangTree.length > 0 ? (
                        <div>
                          <header className="mb-3 flex items-center gap-2">
                            <Package className="h-5 w-5 text-brand" />
                            <h2 className="font-display text-[18px] font-extrabold text-ink-900">
                              What&apos;s in your kit
                            </h2>
                            <span className="text-[12px] text-ink-500 ml-1">
                              {templateLangTree.length} item{templateLangTree.length === 1 ? "" : "s"} — tap to expand
                            </span>
                          </header>
                          <BundleTree nodes={templateLangTree} readOnly />
                        </div>
                      ) : (
                        <div className="rounded-xl border border-ink-100 bg-cream-50 px-5 py-6 text-center">
                          <p className="text-[13px] text-ink-400">Kit contents are being set up.</p>
                        </div>
                      )}
                      {product && (
                        <div>
                          <button
                            type="button"
                            disabled={addBusy || (freeBookkitInCart && isBookkitProduct)}
                            onClick={async () => {
                              if (addBusy) return;
                              setAddBusy(true);
                              const r = await addByVariantId(selectedTemplateLang.variantId);
                              setAddBusy(false);
                              if (!r.ok && r.error) { setAddError(r.error); setAddOrderLink(r.orderNumber ?? null); }
                              else { setAddError(null); setAddOrderLink(null); }
                            }}
                            className="w-full rounded-full bg-ink-900 px-6 py-3 text-[14px] font-semibold text-white hover:bg-brand transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                          >
                            {addBusy ? "Adding…" : `Add to Cart — ${selectedTemplateLang.secondLang} (2nd Lang)`}
                          </button>
                          {freeBookkitInCart && isBookkitProduct && (
                            <p className="mt-2 text-[14px] font-semibold text-amber-700 text-center leading-snug">Complimentary bookkit already in your cart</p>
                          )}
                          {addError && (
                            <div className="mt-2 text-center leading-snug">
                              <p className="text-[15px] font-semibold text-red-600">{addError}</p>
                              {addOrderLink && (
                                <a href={`/shop/orders/${encodeURIComponent(addOrderLink)}`} className="mt-1 inline-block text-[14px] font-bold text-amber-800 underline underline-offset-2 hover:text-brand">
                                  Order already placed — click here to view
                                </a>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                }
                // Multi-axis Item-Variant kit (e.g. SMS Grade 11 Bookkit with
                // Mandate × Core × Elective). Picker resolves a variant SKU,
                // /api/shop/variant-contents returns the per-axis BOM trees.
                const multiGroups = product?.attributeGroups ?? [];
                const variantMap = product?.variantsByAttributeKey ?? {};
                const isMultiAxisKit =
                  product != null &&
                  multiGroups.length >= 2 &&
                  Object.keys(variantMap).length > 1;
                if (isMultiAxisKit) {
                  const livePrice =
                    multiAxisVariantPrice ?? product!.price;
                  return (
                    <div className="space-y-4 mt-2">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[11px] text-ink-500 leading-snug">
                          Your picks are auto-saved — come back any time, even after logging out.
                        </p>
                        {multiAxisVariantId && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                            <span className="h-1 w-1 rounded-full bg-emerald-500" />
                            Saved
                          </span>
                        )}
                      </div>
                      <MultiAttributePicker
                        groups={multiGroups}
                        variantsByAttributeKey={variantMap}
                        onResolve={setMultiAxisVariantId}
                        initialSelection={
                          draft.restored?.kind === "multi-axis"
                            ? draft.restored.selection
                            : undefined
                        }
                        onSelectionChange={(selection) =>
                          draft.save({ kind: "multi-axis", selection })
                        }
                        mandatesByAxis={mandatesByAxis ?? undefined}
                      />
                      {multiAxisVariantId == null ? (
                        <div className="rounded-xl border border-ink-100 bg-cream-50 px-5 py-6 text-center">
                          <p className="text-[13px] text-ink-500">
                            Pick each option above to see your kit contents.
                          </p>
                        </div>
                      ) : multiAxisLoading ? (
                        <div className="rounded-xl border border-ink-100 bg-cream-50 px-5 py-6 text-center">
                          <p className="text-[13px] text-ink-400">Loading kit contents…</p>
                        </div>
                      ) : multiAxisSections.length > 0 ? (
                        <div className="space-y-5">
                          <header className="flex items-center gap-2">
                            <Package className="h-5 w-5 text-brand" />
                            <h2 className="font-display text-[18px] font-extrabold text-ink-900">
                              What&apos;s in your kit
                            </h2>
                          </header>
                          {multiAxisSections.map((sec) => (
                            <div key={`${sec.axisName}-${sec.value}`}>
                              <p className="mb-2 text-[11px] font-semibold tracking-[0.16em] uppercase text-ink-500">
                                {sec.value}
                              </p>
                              {sec.tree.length > 0 ? (
                                <BundleTree nodes={sec.tree} readOnly />
                              ) : (
                                <p className="text-[12px] text-ink-400 italic">
                                  Contents pending for {sec.productName ?? sec.value}.
                                </p>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="rounded-xl border border-ink-100 bg-cream-50 px-5 py-6 text-center">
                          <p className="text-[13px] text-ink-400">
                            No contents found for the selected combination.
                          </p>
                        </div>
                      )}
                      <div>
                        <button
                          type="button"
                          disabled={
                            addBusy ||
                            !multiAxisVariantId ||
                            (freeBookkitInCart && isBookkitProduct)
                          }
                          onClick={async () => {
                            if (addBusy || !multiAxisVariantId) return;
                            setAddBusy(true);
                            const r = await addByVariantId(multiAxisVariantId);
                            setAddBusy(false);
                            if (!r.ok && r.error) {
                              setAddError(r.error);
                              setAddOrderLink(r.orderNumber ?? null);
                            } else {
                              setAddError(null);
                              setAddOrderLink(null);
                              // Drop the draft once committed — re-visiting
                              // the same product after Add-to-Cart shouldn't
                              // restore the now-stale picker state.
                              draft.clear();
                            }
                          }}
                          className="w-full rounded-full bg-ink-900 px-6 py-3.5 text-[15px] font-bold text-white hover:bg-brand transition-colors shadow-sm disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                          {addBusy
                            ? "Adding…"
                            : multiAxisVariantId
                              ? livePrice > 0
                                ? `Add to Cart — ₹${livePrice.toLocaleString("en-IN")}`
                                : "Add to Cart"
                              : "Select all options to continue"}
                        </button>
                        {freeBookkitInCart && isBookkitProduct && (
                          <p className="mt-2 text-[14px] font-semibold text-amber-700 text-center leading-snug">
                            Complimentary bookkit already in your cart
                          </p>
                        )}
                        {addError && (
                          <div className="mt-2 text-center leading-snug">
                            <p className="text-[15px] font-semibold text-red-600">{addError}</p>
                            {addOrderLink && (
                              <a href={`/shop/orders/${encodeURIComponent(addOrderLink)}`} className="mt-1 inline-block text-[14px] font-bold text-amber-800 underline underline-offset-2 hover:text-brand">
                                Order already placed — click here to view
                              </a>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                }

                return (
                  <div className="space-y-4 mt-2">
                    <div className="rounded-xl border border-ink-100 bg-cream-50 px-5 py-8 text-center">
                      <p className="text-[14px] text-ink-500">
                        Kit contents are being updated. Check back soon.
                      </p>
                    </div>
                    {product && (
                      <div>
                        <button
                          type="button"
                          disabled={addBusy || (freeBookkitInCart && isBookkitProduct)}
                          onClick={async () => {
                            if (addBusy) return;
                            setAddBusy(true);
                            // Same kit single-variant shortcut as above —
                            // skip the size-based lookup for bookkits whose
                            // "size" is just the "Standard" placeholder.
                            const kitFallbackVariantId =
                              product.kind === "kit" || product.isKit === true
                                ? Object.values(product.variantIds ?? {})[0] ?? null
                                : null;
                            const r = kitFallbackVariantId
                              ? await addByVariantId(kitFallbackVariantId, 1)
                              : await addToCart(product, product.sizes[0] ?? "");
                            setAddBusy(false);
                            if (!r.ok && r.error) { setAddError(r.error); setAddOrderLink(r.orderNumber ?? null); }
                            else { setAddError(null); setAddOrderLink(null); }
                          }}
                          className="w-full rounded-full bg-ink-900 px-6 py-3.5 text-[15px] font-bold text-white hover:bg-brand transition-colors shadow-sm disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                          {addBusy ? "Adding…" : `Add to Cart — ₹${product.price.toLocaleString("en-IN")}`}
                        </button>
                        {freeBookkitInCart && isBookkitProduct && (
                          <p className="mt-2 text-[14px] font-semibold text-amber-700 text-center leading-snug">Complimentary bookkit already in your cart</p>
                        )}
                        {addError && (
                          <p className="mt-2 text-[15px] font-semibold text-red-600 text-center leading-snug">{addError}</p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>
        </section>
      ) : (
        <>
          <section className="mx-auto max-w-7xl px-5 lg:px-8 pt-6 lg:pt-10">
            {/* Provider lets BuyBox's colour pick reach the Gallery so the
                selected colour's images surface first. */}
            <PdpSelectionProvider>
              <div className="grid lg:grid-cols-[380px_1fr] gap-10 lg:gap-16 items-start">
                {/* Left column: image + optional admin-authored note beneath it. */}
                <div>
                  <Gallery product={product} />
                  {product.imageNote ? (
                    <div className="mt-5 space-y-3 text-[14px] leading-relaxed text-ink-700">
                      {product.imageNote
                        .split(/\n\s*\n|\n/)
                        .map((line) => line.trim())
                        .filter(Boolean)
                        .map((line, i) => (
                          <p key={i}>{line}</p>
                        ))}
                    </div>
                  ) : null}
                </div>
                {/* key by product.id so navigating to a different product
                    remounts BuyBox with fresh size/qty/attribute defaults —
                    otherwise its selection state persists across products and
                    desyncs from the pills shown (wrong size/qty added). */}
                <BuyBox
                  key={product.id}
                  product={product}
                  onSizeGuide={scrollToSizeGuide}
                />
              </div>
            </PdpSelectionProvider>
          </section>

          {bundleTree.length > 0 && (
            <section className="mx-auto max-w-7xl px-5 lg:px-8 mt-12 lg:mt-16">
              <header className="mb-4 flex items-center gap-2">
                <Package className="h-5 w-5 text-brand" />
                <h2 className="font-display text-[18px] font-extrabold text-ink-900">
                  What&apos;s inside
                </h2>
                <span className="text-[12px] text-ink-500 ml-1">
                  {bundleTree.length} item{bundleTree.length === 1 ? "" : "s"}{" "}
                  included — tap each to see its contents
                </span>
              </header>
              <BundleTree nodes={bundleTree} />
            </section>
          )}
        </>
      )}
      <div className="mx-auto max-w-7xl px-5 lg:px-8">
        <Tabs product={product} />
      </div>
      <div className="mx-auto max-w-7xl px-5 lg:px-8">
        <Reviews product={product} />
      </div>
      <div className="mx-auto max-w-7xl px-5 lg:px-8">
        <RelatedProducts current={product} all={related} />
      </div>

      <section className="mt-16 lg:mt-24 bg-ink-900 text-white">
        <div className="mx-auto max-w-7xl px-5 lg:px-8 py-12 lg:py-16 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
          <div>
            <p className="font-display text-[12px] font-semibold tracking-[0.18em] uppercase text-brand-300">
              Need it before term?
            </p>
            <h2 className="mt-2 font-display text-[24px] sm:text-[28px] font-extrabold tracking-tight">
              Order now, delivered before classes start.
            </h2>
          </div>
          <a
            href="#"
            className="inline-flex items-center gap-2 rounded-full bg-brand text-white px-6 h-12 text-[14px] font-bold hover:bg-brand-600 transition-colors"
          >
            View cart →
          </a>
        </div>
      </section>

      <Footer />
      <MiniCart />
      <StickyMobileBar product={product} />
    </main>
  );
}
