"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useFocusRefetch } from "@/lib/use-focus-refetch";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { StudentBar } from "@/components/shop/StudentBar";
import { ShopHeader } from "@/components/shop/ShopHeader";
import { FilterSidebar, type Filters } from "@/components/shop/FilterSidebar";
import { ProductGrid } from "@/components/shop/ProductGrid";
import { MiniCart } from "@/components/shop/MiniCart";
import { CompleteTheKit } from "@/components/shop/CompleteTheKit";
import { OrderUpdatesBanner } from "@/components/shop/OrderUpdatesBanner";
import AccessClosed from "@/components/shop/AccessClosed";
import { useCart } from "@/lib/cart";
import type { Product } from "@/lib/products";
import type { ProductCardDto } from "@/server/repos/products";

const initialFilters: Filters = {
  categories: [],
  sizes: [],
};

// Convert a server DTO into the Product shape the existing components expect.
function dtoToProduct(d: ProductCardDto): Product {
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
    isMagicBox: d.isMagicBox,
    isKit: d.isKit,
    hasLangOptions: d.hasLangOptions,
  };
}

function ShopInner() {
  const { legacyLines: lines } = useCart();
  const searchParams = useSearchParams();
  const studentId = searchParams.get("studentId") ?? "";
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("recommended");

  const [products, setProducts] = useState<Product[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [feedError, setFeedError] = useState<string | null>(null);
  // Set when the catalog API answers 403 { closed: true } — this child's
  // website access is switched off (or every child on the account is).
  const [closed, setClosed] = useState<{
    title: string;
    subtitle: string;
    studentName?: string | null;
  } | null>(null);

  const loadCatalog = useCallback(async () => {
    const url = studentId
      ? `/api/shop/products?studentId=${encodeURIComponent(studentId)}`
      : "/api/shop/products";
    try {
      const r = await fetch(url, { cache: "no-store" });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        // 403 { closed: true } is the switched-off case — show the closure
        // screen, not an error. Everything else: the API returns 400 with a
        // human-readable `error` for predictable states (no student
        // attached, no gender set, grade unrecognised). Surface the message
        // instead of rendering an empty grid with the misleading "No items
        // match your filters" text.
        if (data?.closed) {
          setClosed({
            title: data.title as string,
            subtitle: data.subtitle as string,
            studentName: (data.studentName as string) ?? null,
          });
          setFeedError(null);
          setProducts([]);
          return;
        }
        setClosed(null);
        setFeedError(data?.error ?? "Couldn't load your catalog.");
        setProducts([]);
        return;
      }
      setClosed(null);
      setFeedError(null);
      const prods = (data.products as ProductCardDto[]).map(dtoToProduct);
      setProducts(prods);
    } catch {
      setFeedError("Couldn't load your catalog.");
    } finally {
      setLoaded(true);
    }
  }, [studentId]);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  // Reload the catalog whenever the parent switches back to this tab so
  // admin edits (price, stock, BOM, category, new products, deletes) land
  // without a manual refresh.
  useFocusRefetch(loadCatalog);

  const filtered = useMemo(() => {
    let list = products.filter((p) => {
      if (
        filters.categories.length &&
        !p.categoryPath.some((seg) => filters.categories.includes(seg))
      )
        return false;
      if (
        filters.sizes.length &&
        !p.sizes.some((s) => filters.sizes.includes(s))
      )
        return false;
      if (query && !p.name.toLowerCase().includes(query.toLowerCase()))
        return false;
      return true;
    });
    switch (sort) {
      case "price-asc":
        list = [...list].sort((a, b) => a.price - b.price);
        break;
      case "price-desc":
        list = [...list].sort((a, b) => b.price - a.price);
        break;
      case "newest":
        list = [...list].sort((a, b) =>
          a.badge === "NEW" ? -1 : b.badge === "NEW" ? 1 : 0
        );
        break;
    }
    return list;
  }, [products, filters, query, sort]);

  const missingRequired = useMemo(() => {
    const inCart = new Set(lines.map((l) => l.product.id));
    return products.filter((p) => p.required && !inCart.has(p.id));
  }, [products, lines]);

  return (
    <main className="min-h-screen">
      <Nav />
      <StudentBar />
      <OrderUpdatesBanner />
      {closed ? (
        <AccessClosed
          title={closed.title}
          subtitle={closed.subtitle}
          studentName={closed.studentName}
          actions={
            <p className="text-[13px] text-ink-500">
              Pick another student above to continue shopping for them.
            </p>
          }
        />
      ) : (
        <>
      <ShopHeader
        count={filtered.length}
        query={query}
        onQuery={setQuery}
        sort={sort}
        onSort={setSort}
      />

      <div className="mx-auto max-w-7xl px-5 lg:px-8 pb-16">
        <div className="grid lg:grid-cols-[260px_1fr] gap-6 lg:gap-8">
          <FilterSidebar filters={filters} setFilters={setFilters} products={products} />
          {loaded ? (
            feedError ? (
              <CatalogError message={feedError} />
            ) : (
              <ProductGrid
                products={filtered}
                onClear={() => {
                  setFilters({ categories: [], sizes: [] });
                  setQuery("");
                }}
              />
            )
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 lg:gap-5">
              {[...Array(6)].map((_, i) => (
                <div
                  key={i}
                  className="rounded-2xl border border-ink-100 bg-white aspect-[3/4] animate-pulse"
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <CompleteTheKit items={missingRequired} />
        </>
      )}
      <Footer />
      <MiniCart />
    </main>
  );
}

export default function ShopPage() {
  return <ShopInner />;
}

function CatalogError({ message }: { message: string }) {
  // Friendly empty-state that explains WHY the shop is empty instead of
  // looking like a broken filter result. The most common cause is "No
  // student attached" — a parent who self-registered before admin linked
  // them to a school. Give them a concrete next step.
  const isNoStudent = /no student/i.test(message);
  // Offline-only schools (no storefront catalog) aren't an error — say so.
  const isOfflineSchool = /online ordering isn't available/i.test(message);
  return (
    <div className="rounded-2xl border border-ink-100 bg-white p-10 text-center">
      <div className="mx-auto h-12 w-12 grid place-items-center rounded-full bg-amber-50 border border-amber-200 mb-4">
        <span className="text-amber-700 text-xl">!</span>
      </div>
      <h3 className="font-display text-[22px] font-extrabold text-ink-900">
        {isNoStudent
          ? "We couldn't find a student on your account"
          : isOfflineSchool
          ? "Ordering is handled by your school"
          : "Couldn't load your catalog"}
      </h3>
      <p className="mt-2 text-[14px] text-ink-600 max-w-md mx-auto">
        {isNoStudent ? (
          <>
            Your school hasn&apos;t linked any student records to this account
            yet. Please ask your school admin to add your child&apos;s
            enrollment to your number, or email{" "}
            <a href="mailto:support@inventre.in" className="font-semibold text-brand hover:underline">
              support@inventre.in
            </a>{" "}
            and we&apos;ll help sort it.
          </>
        ) : (
          message
        )}
      </p>
    </div>
  );
}
