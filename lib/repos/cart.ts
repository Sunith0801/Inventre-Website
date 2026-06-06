import "server-only";
import { eq, inArray, and } from "drizzle-orm";
import { redis } from "@/lib/redis";
import { db } from "@/db/client";
import {
  productVariants,
  products,
  productImages,
  productSchool,
  productAttributes,
  productAttributeValues,
  productVariantAttributes,
  productGrades,
  carts,
  cartItems,
  students,
  schools,
} from "@/db/schema";
import { safeImgUrl } from "@/lib/safe-url";

/**
 * Cart storage strategy:
 *
 *   - Redis is the hot path: a hash keyed by parentId where each field = variantId
 *     and each value = qty. TTL = 7 days, sliding (refreshed on every mutation).
 *   - Postgres is the durable mirror: `carts` (per parent) + `cart_items`.
 *     Every mutation writes through. If Redis evicts (LRU pressure or restart),
 *     the next read transparently rehydrates from Postgres.
 *
 * This means a parent's cart survives Redis flushes / multi-week absences,
 * which the pure-Redis version did not.
 */

const CART_TTL = 60 * 60 * 24 * 7;
const cartKey = (parentId: string) => `cart:${parentId}`;

export type CartLine = {
  variantId: string;
  productId: string;
  productSlug: string;
  productName: string;
  size: string;
  qty: number;
  unitPrice: number;
  unitMrp: number | null;
  imageUrl: string | null;
  inStock: boolean;
  stockLeft: number;
  /** Sibling this line was added for. NULL for legacy items inserted
   *  before cart_items.student_id was introduced (migration 0043).
   *  Multi-sibling cart UI groups by this field. */
  studentId: string | null;
  /** Configured component picks for a Magic Box line. null for ordinary
   *  lines. The line price stays the fixed Magic Box price. */
  bundleSelections: BundleSelection[] | null;
  /** Multi-axis Item-Variant attributes (e.g. Mandate=…, Core Subject=…,
   *  Elective Subject=…). Empty for single-axis size-only SKUs. The cart UI
   *  shows these instead of the (often unreadable) full SKU `size` string. */
  attributes: { name: string; value: string }[];
};

/** One component pick inside a configured Magic Box line. */
export type BundleSelection = {
  componentProductId: string;
  name: string;
  qty: number;
  variantId: string;
  size: string;
  /** Multi-axis attribute breakdown for the picked variant (e.g.
   *  Mandate=…, Core Subject=Commerce). Enriched at read time from
   *  product_variant_attributes — never written back to the stored JSON.
   *  Empty for plain size-only sub-items. */
  attributes?: { name: string; value: string }[];
};

export type CartSnapshot = {
  lines: CartLine[];
  count: number;
  subtotal: number;
  /** Per-sibling subtotals + display metadata. The cart UI renders one
   *  section per entry; checkout uses the same grouping to fan out into
   *  per-student orders sharing a single `order_group_id`. */
  byStudent: {
    studentId: string | null;
    studentName: string | null;
    schoolName: string | null;
    gradeLabel: string | null;
    lines: CartLine[];
    subtotal: number;
    count: number;
  }[];
  /** When the active student's grade no longer fits one or more cart
   *  lines, those lines are silently removed (Redis + Postgres) and the
   *  count surfaces here so the UI can flash a one-line "X items removed"
   *  notice. `null` when no removals happened. */
  staleRemoved?: {
    removed: number;
    reason: "grade_changed";
    activeGradeLabel: string | null;
  };
};

// ── Postgres mirror helpers ─────────────────────────────────

async function getOrCreateDbCart(parentId: string): Promise<string> {
  const [existing] = await db
    .select()
    .from(carts)
    .where(eq(carts.parentId, parentId))
    .limit(1);
  if (existing) return existing.id;
  const [created] = await db
    .insert(carts)
    .values({ parentId, expiresAt: new Date(Date.now() + CART_TTL * 1000) })
    .returning();
  return created.id;
}

async function mirrorWriteToDb(
  parentId: string,
  variantId: string,
  qty: number,
  bundleSelections?: BundleSelection[],
  studentId?: string | null
) {
  const cartId = await getOrCreateDbCart(parentId);
  await db.update(carts).set({ updatedAt: new Date() }).where(eq(carts.id, cartId));
  if (qty <= 0) {
    await db
      .delete(cartItems)
      .where(and(eq(cartItems.cartId, cartId), eq(cartItems.variantId, variantId)));
    return;
  }
  // Atomic upsert against the (cart_id, variant_id) unique index added in
  // migration 0050. The old SELECT-then-INSERT/UPDATE pattern raced under
  // rapid double-clicks and produced duplicate cart_items rows (visible
  // for ~275 cart lines pre-cleanup, 2026-06-06). ON CONFLICT collapses
  // the race to a single statement and keeps the most recent qty/student.
  await db
    .insert(cartItems)
    .values({
      cartId,
      variantId,
      qty,
      bundleSelections: bundleSelections ?? null,
      studentId: studentId ?? null,
    })
    .onConflictDoUpdate({
      target: [cartItems.cartId, cartItems.variantId],
      set: {
        qty,
        // Only overwrite the JSON / studentId binding when the caller
        // supplied a fresh value. Re-adds with `undefined` (e.g. quantity
        // bumps via PATCH) preserve the original binding so we don't
        // accidentally null out a Magic Box's component picks or move a
        // line to the wrong sibling.
        ...(bundleSelections !== undefined ? { bundleSelections } : {}),
        ...(studentId !== undefined ? { studentId } : {}),
      },
    });
}

async function mirrorClearDb(parentId: string) {
  const [existing] = await db
    .select()
    .from(carts)
    .where(eq(carts.parentId, parentId))
    .limit(1);
  if (!existing) return;
  await db.delete(cartItems).where(eq(cartItems.cartId, existing.id));
}

async function rehydrateRedisFromDb(parentId: string): Promise<Record<string, string>> {
  const [c] = await db
    .select()
    .from(carts)
    .where(eq(carts.parentId, parentId))
    .limit(1);
  if (!c) return {};
  const items = await db
    .select()
    .from(cartItems)
    .where(eq(cartItems.cartId, c.id));
  if (items.length === 0) return {};
  const map: Record<string, string> = {};
  for (const it of items) map[it.variantId] = String(it.qty);
  // populate Redis
  await redis.hset(cartKey(parentId), map);
  await redis.expire(cartKey(parentId), CART_TTL);
  return map;
}

// ── public API ──────────────────────────────────────────────

export async function readCart(
  parentId: string,
  schoolId?: string,
  /** Active student's grade. The grade-mismatch sweep applies to lines
   *  whose `cart_items.student_id` MATCHES `activeStudentId` (so a Kid B
   *  read doesn't wipe Kid A's items). Lines belonging to other siblings
   *  are filtered through their own student's grade on their respective
   *  cart fetch. */
  activeGrade?: string | null,
  /** Label rendered in the "X items removed" notice. Falls back to
   *  activeGrade when omitted. */
  activeGradeLabel?: string | null,
  /** Every school any of this parent's children attends. The school-
   *  mismatch sweep keeps cart lines whose product belongs to ANY of
   *  these schools — so a parent with siblings at different schools can
   *  order items for each sibling from a single cart. Omitted ⇒ falls
   *  back to schoolId. */
  allowedSchoolIds?: string[],
  /** The currently-viewed student. Grade-mismatch sweep ONLY touches
   *  lines tagged with this id; other siblings' items are preserved. */
  activeStudentId?: string | null
): Promise<CartSnapshot> {
  let raw = await redis.hgetall(cartKey(parentId));
  if (!raw || Object.keys(raw).length === 0) {
    // Redis miss — try DB
    raw = await rehydrateRedisFromDb(parentId);
  }
  const variantIds = Object.keys(raw);
  if (variantIds.length === 0)
    return { lines: [], count: 0, subtotal: 0, byStudent: [], staleRemoved: undefined };

  // Persisted Magic Box component picks live only in the Postgres mirror
  // (the Redis hash is qty-only). One indexed lookup per cart read.
  const selByVariant = new Map<string, BundleSelection[]>();
  {
    const [c] = await db
      .select()
      .from(carts)
      .where(eq(carts.parentId, parentId))
      .limit(1);
    if (c) {
      const ci = await db
        .select()
        .from(cartItems)
        .where(eq(cartItems.cartId, c.id));
      for (const it of ci) {
        if (it.bundleSelections != null)
          selByVariant.set(it.variantId, it.bundleSelections as BundleSelection[]);
      }
    }
  }

  // Drop any variants admin has soft-deleted (isActive=false). Their cart
  // entries silently disappear from the snapshot rather than letting parents
  // checkout a discontinued SKU. The Redis row stays — we don't proactively
  // garbage-collect, but it can never re-surface in a future read.
  const variants = await db
    .select()
    .from(productVariants)
    .where(
      and(
        inArray(productVariants.id, variantIds),
        eq(productVariants.isActive, true)
      )
    );

  if (variants.length === 0) return { lines: [], count: 0, subtotal: 0, byStudent: [] };

  const productIds = Array.from(new Set(variants.map((v) => v.productId)));
  // Lazy-import the resolver to avoid circular imports.
  const { resolveVariants } = await import("./variant-resolver");
  const [productRows, imageRows, psRows, resolved, attrRows] = await Promise.all([
    db.select().from(products).where(inArray(products.id, productIds)),
    db.select().from(productImages).where(inArray(productImages.productId, productIds)),
    schoolId
      ? db
          .select()
          .from(productSchool)
          .where(inArray(productSchool.productId, productIds))
      : Promise.resolve([] as (typeof productSchool.$inferSelect)[]),
    resolveVariants(variantIds, schoolId ?? null),
    // Per-line attribute breakdown for multi-axis Item-Variant SKUs —
    // includes both the top-level cart variants AND every variant
    // referenced by a Magic Box's bundleSelections, so the configurator's
    // review summary + the cart's Box-contents row can render attributes
    // instead of the (often unreadable) concatenated SKU `size` string.
    (() => {
      const bundleVariantIds: string[] = [];
      for (const list of selByVariant.values()) {
        for (const sel of list) if (sel.variantId) bundleVariantIds.push(sel.variantId);
      }
      const allVariantIds = Array.from(new Set([...variantIds, ...bundleVariantIds]));
      if (allVariantIds.length === 0) {
        return Promise.resolve([] as Array<{
          variantId: string;
          attributeName: string;
          attributeSort: number;
          value: string;
        }>);
      }
      return db
        .select({
          variantId: productVariantAttributes.variantId,
          attributeName: productAttributes.name,
          attributeSort: productAttributes.sortOrder,
          value: productAttributeValues.value,
        })
        .from(productVariantAttributes)
        .innerJoin(productAttributes, eq(productAttributes.id, productVariantAttributes.attributeId))
        .innerJoin(productAttributeValues, eq(productAttributeValues.id, productVariantAttributes.valueId))
        .where(inArray(productVariantAttributes.variantId, allVariantIds));
    })(),
  ]);
  const attrsByVariant = new Map<string, { name: string; value: string }[]>();
  for (const r of attrRows) {
    let list = attrsByVariant.get(r.variantId);
    if (!list) {
      list = [];
      attrsByVariant.set(r.variantId, list);
    }
    list.push({ name: r.attributeName, value: r.value });
  }
  for (const list of attrsByVariant.values()) {
    list.sort((a, b) => a.name.localeCompare(b.name));
  }

  const productById = new Map(productRows.map((p) => [p.id, p]));
  const imageByProduct = new Map<string, string>();
  imageRows
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .forEach((i) => {
      if (!imageByProduct.has(i.productId))
        imageByProduct.set(i.productId, i.url);
    });
  const psByProduct = new Map(
    psRows
      .filter((r) => r.schoolId === schoolId)
      .map((r) => [r.productId, r])
  );

  // School-mismatch sweep (destructive). When the active student's school
  // doesn't link to a cart line's product via product_school, the line
  // came from a different school the parent was previously shopping at
  // (e.g. admin moved a student to a new school, or the parent switched
  // student). Those lines are unambiguously irrelevant to the current
  // student — delete them from Redis + Postgres so the cart is clean on
  // future reads. Skip when no school context is available.
  const schoolMismatchVariantIds = new Set<string>();
  // Compose the set of schools the parent legitimately shops for:
  // every sibling's school (allowedSchoolIds), unioned with the
  // currently-active student's school as a fallback. A line stays if
  // its product is linked to ANY of these.
  const allowedSchools = new Set<string>([
    ...(allowedSchoolIds ?? []),
    ...(schoolId ? [schoolId] : []),
  ]);
  if (allowedSchools.size > 0) {
    // Build a set of product ids linked to ANY school in the parent's
    // sibling set. Items at schools outside that set are dropped.
    const productsAtAnySchool = new Set(
      psRows
        .filter((r) => allowedSchools.has(r.schoolId))
        .map((r) => r.productId)
    );
    for (const v of variants) {
      if (!productsAtAnySchool.has(v.productId)) {
        schoolMismatchVariantIds.add(v.id);
        continue;
      }
      // Magic Box components are NOT checked against product_school here.
      // loadBundleTree() left-joins product_school, so components routinely
      // exist without a product_school row (a Magic Box shirt is sold only
      // *as* part of the box, not standalone, so it has no school-link of
      // its own). The configurator already restricts pickable sizes to the
      // active student's school at configure time. Requiring every
      // componentProductId to appear in product_school at cart-read time
      // dropped the entire box for everyone — see incident 2026-05-29.
      // The check on the parent Magic Box variant's productId above is
      // sufficient: only schools that legitimately sell the box can add
      // it, and the box's children inherit that scoping.
    }
    if (schoolMismatchVariantIds.size > 0) {
      const ids = Array.from(schoolMismatchVariantIds);
      // Per-variant breadcrumbs: when a parent reports "items dropped",
      // grep this log for their parentId — each hidden line will list its
      // productId + the schools it IS linked to. That tells you whether
      // the product is unlinked entirely (data gap) or linked to a school
      // the active sibling doesn't attend (admin-moved student).
      const hiddenDetails = ids.map((vid) => {
        const v = variants.find((x) => x.id === vid);
        const productId = v?.productId ?? null;
        const linkedSchools = psRows
          .filter((r) => r.productId === productId)
          .map((r) => r.schoolId);
        return { variantId: vid, productId, linkedSchools };
      });
      console.warn("[cart] school-mismatched lines hidden", {
        parentId,
        activeStudentId: activeStudentId ?? null,
        allowedSchoolIds: Array.from(allowedSchools),
        hidden: hiddenDetails,
      });
      // Non-destructive: items belonging to a sibling at another school
      // are filtered out of THIS response (the active student's cart view)
      // but stay in Redis + Postgres. Switching back to that sibling
      // re-exposes them. Earlier behaviour deleted these rows outright,
      // which silently wiped carts whenever a parent opened a page that
      // dropped the `?studentId=` URL param and the API fell back to the
      // first sibling at a different school.
    }
  }

  // Grade-mismatch sweep. Now destructive (per ops directive): if an item
  // was added for the active student AND the active student's grade no
  // longer matches the product's product_grades set, delete it from
  // Redis + Postgres. Items belonging to OTHER siblings are untouched —
  // they're tagged with their own studentId and the active student's
  // grade has nothing to say about them.
  const staleVariantIds = new Set<string>(schoolMismatchVariantIds);
  // Build variant → studentId lookup from the cart_items mirror.
  const dbCartRows = await db
    .select({
      cartId: cartItems.cartId,
      variantId: cartItems.variantId,
      studentId: cartItems.studentId,
    })
    .from(cartItems)
    .innerJoin(carts, eq(carts.id, cartItems.cartId))
    .where(eq(carts.parentId, parentId));
  const studentByVariant = new Map<string, string | null>(
    dbCartRows.map((r) => [r.variantId, r.studentId])
  );
  if (activeGrade) {
    const { normalizeGrade } = await import("@/lib/grade-filter");
    const target = normalizeGrade(activeGrade);
    if (target) {
      const allProductIds = new Set<string>(productIds);
      for (const list of selByVariant.values()) {
        for (const sel of list) allProductIds.add(sel.componentProductId);
      }
      const gradeRows = await db
        .select({
          productId: productGrades.productId,
          grade: productGrades.grade,
        })
        .from(productGrades)
        .where(inArray(productGrades.productId, Array.from(allProductIds)));
      const allowed = new Map<string, Set<string>>();
      for (const r of gradeRows) {
        const set = allowed.get(r.productId) ?? new Set<string>();
        set.add(normalizeGrade(r.grade) ?? r.grade);
        allowed.set(r.productId, set);
      }
      const mismatched = (productId: string): boolean => {
        const grades = allowed.get(productId);
        if (!grades) return false; // universal product
        return !grades.has(target);
      };
      for (const v of variants) {
        const itemStudent = studentByVariant.get(v.id) ?? null;
        // Sweep only items belonging to the active student (or untagged
        // legacy items, which we attribute to the active student). Other
        // siblings' items are NEVER touched by an active-student grade
        // change — they're swept on their own student's cart read.
        const belongsToActive =
          itemStudent === null ||
          (activeStudentId != null && itemStudent === activeStudentId);
        if (!belongsToActive) continue;
        if (mismatched(v.productId)) {
          staleVariantIds.add(v.id);
          continue;
        }
        // Magic Box components are NOT re-validated against product_grades
        // here, mirroring the school-mismatch sweep above. Components are
        // sold only inside the box and routinely have no product_grades
        // rows of their own (loadBundleTree() builds them via the bundle
        // walk, not via grade lookups). Requiring every componentProductId
        // to pass the grade filter at cart-read time silently wiped Magic
        // Boxes for parents whose component-grade metadata wasn't fully
        // backfilled — same incident as 2026-05-29. The parent variant's
        // own grade check above (`mismatched(v.productId)`) is sufficient;
        // its children inherit that scoping.
      }
      // Durable cleanup for the grade-mismatched IDs (school-mismatch
      // ones were already wiped above). "Always drop on any change."
      const onlyGradeMismatched = Array.from(staleVariantIds).filter(
        (id) => !schoolMismatchVariantIds.has(id)
      );
      if (onlyGradeMismatched.length > 0) {
        const hiddenDetails = onlyGradeMismatched.map((vid) => {
          const v = variants.find((x) => x.id === vid);
          const productId = v?.productId ?? null;
          const grades = productId ? Array.from(allowed.get(productId) ?? []) : [];
          return { variantId: vid, productId, allowedGrades: grades };
        });
        console.warn("[cart] grade-mismatched lines hidden", {
          parentId,
          activeStudentId: activeStudentId ?? null,
          activeGrade,
          hidden: hiddenDetails,
        });
        // Non-destructive (same reasoning as the school-mismatch sweep
        // above): hide from the current student's view, leave in storage.
        // Admin grade changes shouldn't permanently eat the parent's cart.
      }
    }
  }

  const lines: CartLine[] = [];
  let count = 0;
  let subtotal = 0;
  for (const v of variants) {
    if (staleVariantIds.has(v.id)) continue;
    const qty = parseInt(raw[v.id] ?? "0", 10);
    if (!qty) continue;
    const product = productById.get(v.productId);
    if (!product) continue;
    const ps = psByProduct.get(v.productId);
    const info = resolved.get(v.id);
    const pricePaise = info?.pricePaise ?? ps?.overridePrice ?? product.basePrice;
    const mrpPaise = info?.mrpPaise ?? ps?.overrideMrp ?? product.baseMrp;
    const stockLeft = info?.available ?? v.stockQty;
    const unitPrice = Math.round(pricePaise / 100);
    const unitMrp = mrpPaise != null ? Math.round(mrpPaise / 100) : null;
    count += qty;
    subtotal += unitPrice * qty;
    lines.push({
      variantId: v.id,
      productId: product.id,
      productSlug: product.slug,
      productName: product.name,
      studentId: studentByVariant.get(v.id) ?? null,
      // Strip single-letter ERPNext prefix marker (e.g. "VXL"→"XL") only on
      // short size codes without spaces. Long descriptive labels like
      // "SMS Grade 7 BookkitHindi…" must be left untouched.
      size: v.size.includes(" ") ? v.size : v.size.replace(/^[A-Z](?=[A-Z0-9-])/, ""),
      qty,
      unitPrice,
      unitMrp,
      imageUrl: safeImgUrl(ps?.customImageUrl ?? imageByProduct.get(product.id) ?? null),
      // Per ops directive (2026-05-26): never out-of-stock. Stock tracking
      // is decoupled from the storefront — bins are no longer synced from
      // ERP, so stockLeft is unreliable. Always treat cart lines as in
      // stock; keep stockLeft on the DTO for admin diagnostics.
      inStock: true,
      stockLeft,
      // Enrich each Magic Box pick with its variant's attribute breakdown
      // so downstream UI can render "Mandate · Commerce · Mathematics"
      // instead of the bare concatenated SKU. We keep `size` for the
      // legacy single-axis path.
      bundleSelections: (selByVariant.get(v.id) ?? null)?.map((sel) => ({
        ...sel,
        attributes: attrsByVariant.get(sel.variantId) ?? [],
      })) ?? null,
      attributes: attrsByVariant.get(v.id) ?? [],
    });
  }

  // Build per-student grouping. Each unique studentId on a cart_items row
  // becomes its own section in the cart UI and, at checkout, its own
  // `orders` row stamped with the shared order_group_id.
  const studentIds = Array.from(
    new Set(lines.map((l) => l.studentId).filter((sid): sid is string => !!sid))
  );
  const studentMeta = new Map<
    string,
    { name: string; schoolName: string | null; gradeLabel: string | null }
  >();
  if (studentIds.length > 0) {
    const studentRows = await db
      .select({
        id: students.id,
        name: students.name,
        grade: students.grade,
        schoolName: schools.name,
      })
      .from(students)
      .leftJoin(schools, eq(schools.id, students.schoolId))
      .where(inArray(students.id, studentIds));
    for (const r of studentRows) {
      studentMeta.set(r.id, {
        name: r.name,
        schoolName: r.schoolName ?? null,
        gradeLabel: r.grade ?? null,
      });
    }
  }
  // Preserve insertion order: first appearance of each studentId.
  const seenStudents: (string | null)[] = [];
  const linesByStudent = new Map<string | null, CartLine[]>();
  for (const l of lines) {
    if (!linesByStudent.has(l.studentId)) {
      linesByStudent.set(l.studentId, []);
      seenStudents.push(l.studentId);
    }
    linesByStudent.get(l.studentId)!.push(l);
  }
  const byStudent = seenStudents.map((sid) => {
    const sLines = linesByStudent.get(sid) ?? [];
    const meta = sid ? studentMeta.get(sid) : null;
    return {
      studentId: sid,
      studentName: meta?.name ?? null,
      schoolName: meta?.schoolName ?? null,
      gradeLabel: meta?.gradeLabel ?? null,
      lines: sLines,
      subtotal: sLines.reduce((s, l) => s + l.unitPrice * l.qty, 0),
      count: sLines.reduce((s, l) => s + l.qty, 0),
    };
  });

  return {
    lines,
    count,
    subtotal,
    byStudent,
    staleRemoved:
      staleVariantIds.size > 0
        ? {
            removed: staleVariantIds.size,
            reason: "grade_changed",
            activeGradeLabel: activeGradeLabel ?? activeGrade ?? null,
          }
        : undefined,
  };
}

/** Look up a variant's parent product to enforce minOrderQty. */
async function getProductMoq(variantId: string): Promise<number> {
  const [row] = await db
    .select({ minOrderQty: products.minOrderQty })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(eq(productVariants.id, variantId))
    .limit(1);
  return row?.minOrderQty ?? 1;
}

/**
 * Re-derive each bundleSelection's `size` field from the variant's actual
 * `pv.size` in DB at write time, so the stored JSON can never disagree
 * with the variant_id. Defensive against any client-side picker bug that
 * sends an inconsistent (variantId, size) pair — symptom was users picking
 * one size in the Magic Box configurator and seeing a different one in the
 * cart (2026-06-04). The variantId remains authoritative; only the display
 * string is corrected. Warn-logs every mismatch with enough context that
 * we can trace back to the configurator path.
 */
async function canonicalizeBundleSizes(
  bundleSelections: BundleSelection[]
): Promise<BundleSelection[]> {
  const ids = Array.from(new Set(bundleSelections.map((s) => s.variantId)));
  if (ids.length === 0) return bundleSelections;
  const rows = await db
    .select({ id: productVariants.id, size: productVariants.size })
    .from(productVariants)
    .where(inArray(productVariants.id, ids));
  const sizeById = new Map(rows.map((r) => [r.id, r.size]));
  return bundleSelections.map((s) => {
    const dbSize = sizeById.get(s.variantId);
    if (dbSize == null) return s;
    if (s.size && s.size !== dbSize) {
      console.warn(
        `[cart] bundleSelection size mismatch: variantId=${s.variantId} clientSize=${JSON.stringify(s.size)} dbSize=${JSON.stringify(dbSize)} product=${s.name}`
      );
    }
    return { ...s, size: dbSize };
  });
}

export async function addToCart(
  parentId: string,
  variantId: string,
  qty = 1,
  bundleSelections?: BundleSelection[],
  /** The sibling this line is for. Persists on cart_items.student_id so
   *  the cart UI can group by kid and checkout can split into per-student
   *  orders. Pass the active student from the storefront context. */
  studentId?: string | null
) {
  const k = cartKey(parentId);

  // Configurable Magic Box line: one fixed-price line. Set qty (don't
  // increment) and persist the component picks. Re-adding re-configures.
  if (bundleSelections !== undefined) {
    const canonical = await canonicalizeBundleSizes(bundleSelections);
    await redis.hset(k, variantId, qty);
    await redis.expire(k, CART_TTL);
    await mirrorWriteToDb(parentId, variantId, qty, canonical, studentId);
    return;
  }

  const newQty = await redis.hincrby(k, variantId, qty);
  // Enforce MOQ — if cart now sits below the minimum, bump up to it.
  const moq = await getProductMoq(variantId);
  let finalQty = newQty;
  if (finalQty < moq) {
    finalQty = moq;
    await redis.hset(k, variantId, finalQty);
  }
  await redis.expire(k, CART_TTL);
  await mirrorWriteToDb(parentId, variantId, finalQty, undefined, studentId);
}

export async function setCartQty(
  parentId: string,
  variantId: string,
  qty: number
) {
  const k = cartKey(parentId);
  if (qty <= 0) {
    await redis.hdel(k, variantId);
    await mirrorWriteToDb(parentId, variantId, 0);
    return;
  }
  // Enforce MOQ on direct-set as well.
  const moq = await getProductMoq(variantId);
  const finalQty = Math.max(qty, moq);
  await redis.hset(k, variantId, finalQty);
  await redis.expire(k, CART_TTL);
  await mirrorWriteToDb(parentId, variantId, finalQty);
}

export async function clearCart(parentId: string) {
  await redis.del(cartKey(parentId));
  await mirrorClearDb(parentId);
}
