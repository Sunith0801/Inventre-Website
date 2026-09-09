import "server-only";
/**
 * Customer-facing "My Orders" backed by the ERP sales-order mirror
 * (`erp` schema). The logged-in parent is matched to ERP orders by phone:
 *
 *   parents.phone  ==(last 10 digits)==  erp.sales_orders.contact_mobile
 *
 * Order id used by the UI is the ERP docname (erp_name, e.g.
 * SAL-ORD-2026-27054). These tables are not in db/schema.ts (external
 * mirror) so we use raw SQL via db.execute().
 */
import { and, eq, inArray } from "drizzle-orm";
import { sql, type SQL } from "drizzle-orm";
import { db } from "@/db/client";
import {
  orderItems,
  orders,
  parents,
  payments,
  productAttributes,
  productAttributeValues,
  productVariantAttributes,
  students,
} from "@/db/schema";
import {
  categoryIdBySku,
  dispatchQtysByItemCode,
  erpItemsForCategoryGrouping,
  groupItemsByAuditCategory,
  groupItemsByRootCategory,
  type CategoryGroup,
} from "@/lib/order-category-tracking";
import { erpAuthedGet } from "@/lib/erp-jwt";
import { upsertShipmentMirror, type ErpShipmentResp } from "@/lib/erp-poll";

// Per-shipment last-refresh timestamp keyed by audit id. In-memory only —
// when audit's own cron refreshes a shipment, the next page render after
// REFRESH_THROTTLE_MS will pull the new events into our mirror. Multiple
// node processes throttle independently (slightly more audit calls, all
// idempotent), but storefront traffic is well under audit's rate limit.
const REFRESH_THROTTLE_MS = 30_000;
const lastShipmentRefresh = new Map<number, number>();
function backgroundRefreshShipment(shipmentId: number): void {
  const now = Date.now();
  const last = lastShipmentRefresh.get(shipmentId) ?? 0;
  if (now - last < REFRESH_THROTTLE_MS) return;
  lastShipmentRefresh.set(shipmentId, now);
  // Fire and forget. Page renders return immediately; the next render
  // sees the upserted rows. Failures are logged but never bubble up —
  // a stale page is better than a 500.
  void (async () => {
    try {
      const sh = await erpAuthedGet<ErpShipmentResp>(
        `/api/outward/shipments/${shipmentId}`,
      );
      if (sh && (sh as Record<string, unknown>).id === shipmentId) {
        await upsertShipmentMirror(sh);
      }
    } catch (e) {
      console.warn(
        `[order-detail] background shipment refresh ${shipmentId} failed:`,
        e instanceof Error ? e.message.slice(0, 200) : e,
      );
    }
  })();
}

/**
 * Build a Map<variantId, [{name, value}]> for the given variant ids.
 * Mirrors lib/repos/cart.ts so order-detail can render multi-axis picks
 * (Uniform Colour · Size, Bookkit 2nd Language) instead of falling back
 * to the bare concatenated SKU. Empty list for variants with no attribute
 * rows (plain size-only items).
 */
async function attrsByVariantId(
  variantIds: string[]
): Promise<Map<string, { name: string; value: string }[]>> {
  const out = new Map<string, { name: string; value: string }[]>();
  if (variantIds.length === 0) return out;
  // Legacy bundle_selections sometimes store a SKU / product name in
  // `variantId` (e.g. "SAS KS Primary Bag") instead of a UUID. The
  // variantId column is uuid-typed, so feeding those into the IN-list
  // crashes the whole query with 22P02 (invalid input syntax for type
  // uuid) — taking the entire order-detail API down with a 500. Drop the
  // non-UUID ids: they have no product_variant_attributes rows anyway, so
  // the line just falls back to its concatenated-SKU display.
  const uuids = variantIds.filter((v) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v),
  );
  if (uuids.length === 0) return out;
  const rows = await db
    .select({
      variantId: productVariantAttributes.variantId,
      name: productAttributes.name,
      value: productAttributeValues.value,
    })
    .from(productVariantAttributes)
    .innerJoin(productAttributes, eq(productAttributes.id, productVariantAttributes.attributeId))
    .innerJoin(productAttributeValues, eq(productAttributeValues.id, productVariantAttributes.valueId))
    .where(inArray(productVariantAttributes.variantId, uuids));
  for (const r of rows) {
    const list = out.get(r.variantId) ?? [];
    list.push({ name: r.name, value: r.value });
    out.set(r.variantId, list);
  }
  for (const list of out.values()) list.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

function rows<T>(r: unknown): T[] {
  return r as unknown as T[];
}
function inList(values: string[]): SQL {
  return sql.join(values.map((v) => sql`${v}`), sql`, `);
}

// ERPNext stores item images as relative paths like "/files/Bag.png".
const ERP_IMG_BASE = (
  process.env.ERPNEXT_BASE || "https://erp.inventre.in"
).replace(/\/+$/, "");
function imgUrl(p: string | null | undefined): string {
  if (!p) return "";
  if (/^https?:\/\//i.test(p)) return p;
  return ERP_IMG_BASE + encodeURI(p.startsWith("/") ? p : "/" + p);
}

/**
 * Map an ERP order to the UI's 5-stage pipeline.
 *
 * Shipments are the strongest signal of real fulfilment progress, so they
 * win over the (often-lagging) ERP order-level display status:
 *   - has shipments, ALL delivered  → delivered
 *   - has shipments, some delivered → shipped (partial)
 *   - has shipments, none delivered → shipped
 * We require ALL shipments delivered (not "any") so a single stray
 * delivered line on a multi-parcel order doesn't mark it delivered.
 * With no shipments, fall back to custom_display_status. NB: "Not Yet
 * Delivered" contains "delivered" — guard the "not".
 */
function uiStatus(
  displayStatus: string | null,
  shipN: number,
  shipDelivered: number,
  sealedPackingUnits: number,
  dispatchedPackingUnits = 0,
  shipOfd = 0,
  auditCatAllDelivered = false,
  shipInTransit = 0
): string {
  const d = (displayStatus ?? "").toLowerCase();
  if (d.includes("cancel")) return "cancelled";
  if (d.includes("return")) return "returned";

  // Audit's per-category map is the most authoritative source for "all
  // ordered categories have arrived". When every category in
  // `derived_delivery_categories_present` is in a delivered state per
  // `derived_delivery_by_category`, the order IS delivered even if
  // audit's order-level `custom_display_status` still says "Not Yet
  // Delivered" (residual category state in by_cat sometimes drags the
  // header rollup, e.g. SAL-ORD-2026-28120 where by_cat reports a
  // stale "bookkit:Pending" though the order only contains uniform).
  if (auditCatAllDelivered) return "delivered";

  // Audit is the source of truth at the order level. Its derivation
  // already considers every category / shipment, so we let it act as
  // BOTH ceiling and floor against our local shipment mirror:
  //
  //   - "Fully Delivered" → we say "delivered" even if our outward
  //     shipments mirror is behind (audit's carrier poll often
  //     catches delivery flips before our cron does).
  //   - "Not Yet Delivered" → we cap below "delivered" even if every
  //     mirrored shipment for the order is in `delivered` state
  //     (common on Magic Box orders where one category's parcel has
  //     wrapped but another's hasn't even shipped).
  const auditFullyDelivered =
    d.includes("complete") || (d.includes("delivered") && !d.includes("not"));
  if (auditFullyDelivered) return "delivered";
  const auditNotYet = d.includes("not") && d.includes("deliver");

  if (shipN > 0) {
    if (shipDelivered >= shipN && !auditNotYet) return "delivered";
    // "Out for Delivery" is a meaningful, exciting beat between shipped
    // and delivered — surface it on the list card the same way the
    // category badge on the detail page does.
    if (shipOfd > 0) return "out for delivery";
    // "In transit" sits between shipped (parcel handed to carrier) and
    // OFD (last hop). Any carrier-confirmed in-transit scan lifts the
    // order off "shipped" so the stepper shows real movement.
    if (shipInTransit > 0) return "in transit";
    return "shipped";
  }
  // No shipment row yet, but packing units carry truth: any
  // `dispatched` unit means the parcel has left the warehouse → shipped.
  // Otherwise any `sealed` unit means it's physically packed.
  if (dispatchedPackingUnits > 0) return "shipped";
  if (sealedPackingUnits > 0) return "packed";
  if (d.includes("partial")) return "shipped"; // "Partially Delivered" = in transit
  if (d.includes("complete") || (d.includes("delivered") && !d.includes("not")))
    return "delivered";
  if (d.includes("packed")) return "packed";
  if (
    d.includes("shipped") ||
    d.includes("shipment") ||
    d.includes("dispatch") ||
    d.includes("transit")
  )
    return "shipped";
  return "confirmed";
}

async function parentPhone10(parentId: string): Promise<string | null> {
  const [p] = await db
    .select({ phone: parents.phone })
    .from(parents)
    .where(eq(parents.id, parentId))
    .limit(1);
  if (!p?.phone) return null;
  const digits = p.phone.replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : null;
}

/**
 * Identity set for the My-Orders + order-detail queries. Tightened scope
 * (no recursive family walk — that fanned out across unrelated families
 * via shared guardian phones, e.g. a class teacher listed as guardian on
 * many students). All sets are derived from "students this parent has
 * a direct link to":
 *
 *   - `myPhone`         : the parent's own 10-digit phone. Used as the
 *                         sole basis for `contact_mobile` phone matching
 *                         on the ERP-mirror path.
 *   - `studentIds`      : students where I am primary parent OR where I
 *                         appear as a direct guardian (no recursion).
 *   - `studentErpNames` : ERP customer name corresponding to each student
 *                         (for `sales_orders.customer = student.erp_name`).
 *   - `enrollKeys`      : composite enrollment keys for each student,
 *                         shaped as `lowercase-alpha:digits`. Audit's
 *                         MCB stores `KS240005` while we store
 *                         `24KS0005`; both normalise to `ks:240005`.
 *                         Digits alone are too loose (every school
 *                         issues `0005` in some year), so the alpha
 *                         component is required for disambiguation.
 *   - `parentIds`       : my own parent row + any other parent record
 *                         whose phone matches my phone OR a *direct
 *                         guardian* phone of one of MY students (covers
 *                         the storefront-account variant where a co-
 *                         guardian created their own account to place
 *                         orders for the same child).
 *   - `phones`          : my phone + direct guardian phones of MY
 *                         students. Used to widen the parent-id lookup,
 *                         NOT the ERP `contact_mobile` match (which would
 *                         leak co-guardians' orders for unrelated kids).
 *
 * Returns null when the parent has no resolvable phone.
 */
type FamilyIdentity = {
  myPhone: string;
  phones: string[];
  parentIds: string[];
  studentIds: string[];
  studentErpNames: string[];
  /** Composite enrollment keys (lowercase alpha + ':' + digits) for
   *  every student this parent has direct access to. The alpha part
   *  keeps school codes from colliding across kids who share the same
   *  year/serial digits (e.g. "AW240005" vs "WF240005" vs "24KS0005"
   *  all share digits "240005"). */
  enrollKeys: string[];
  /** ERP customer names explicitly bound to my students via
   *  students.customer_link. This is the same bridge the admin student
   *  page uses (resolveErpCustomerNames) — it matches orders placed under
   *  a guest-style ERP customer (e.g. "VARUNTEJ SILIVERI") that shares no
   *  phone / erp_name / enrollment with the student record. Student-scoped,
   *  so it can't leak a co-guardian's unrelated orders. */
  customerLinks: string[];
};

async function getFamilyIdentity(parentId: string): Promise<FamilyIdentity | null> {
  const phone = await parentPhone10(parentId);
  if (!phone) return null;
  const r: any = await db.execute(sql`
    WITH my_students AS (
      SELECT s.id::text  AS id,
             s.erp_name  AS erp_name,
             NULLIF(s.customer_link, '') AS customer_link,
             -- Composite enrollment key: lowercase alpha component + ':' +
             -- digit component. Audit and our local rows sometimes carry
             -- different orderings ("KS240005" vs "24KS0005") but the
             -- alpha+digit pair is stable. Digits-only normalisation is
             -- NOT enough — many schools share the same year/serial,
             -- so 240005 alone collapses unrelated kids (AW240005,
             -- WF240005, BP240005 all map to the same digits).
             lower(regexp_replace(coalesce(s.enrollment_number,''), '[^a-zA-Z]', '', 'g'))
               || ':' ||
             regexp_replace(coalesce(s.enrollment_number,''), '\\D', '', 'g') AS enroll_key
        FROM students s
       WHERE s.enabled = true
         AND s.status  = 'active'
         AND (
           s.parent_id = ${parentId}
           OR EXISTS (
             SELECT 1 FROM student_guardian_links gl
              WHERE gl.student_id = s.id
                AND right(regexp_replace(coalesce(gl.phone_no,''), '\\D', '', 'g'), 10) = ${phone}
           )
         )
    ),
    student_guardian_phones AS (
      -- Direct guardian phones for MY students only. NO recursion: we do
      -- NOT walk these phones outward to discover more students.
      SELECT DISTINCT right(regexp_replace(coalesce(gl.phone_no,''), '\\D', '', 'g'), 10) AS p10
        FROM student_guardian_links gl
       WHERE gl.student_id::text IN (SELECT id FROM my_students)
    ),
    all_phones AS (
      SELECT ${phone}::text AS p10
      UNION
      SELECT p10 FROM student_guardian_phones WHERE p10 <> ''
    ),
    all_parents AS (
      SELECT p.id::text AS id FROM parents p
       WHERE p.id = ${parentId}
          OR right(regexp_replace(coalesce(p.phone,''), '\\D', '', 'g'), 10)
             IN (SELECT p10 FROM all_phones WHERE p10 <> '')
    )
    SELECT
      ARRAY(SELECT p10 FROM all_phones WHERE p10 <> '')                                   AS phones,
      ARRAY(SELECT id  FROM all_parents)                                                  AS parent_ids,
      ARRAY(SELECT id  FROM my_students)                                                  AS student_ids,
      ARRAY(SELECT erp_name FROM my_students WHERE erp_name IS NOT NULL AND erp_name<>'') AS student_erp_names,
      ARRAY(SELECT enroll_key FROM my_students WHERE enroll_key <> ':')                   AS enroll_keys,
      ARRAY(SELECT DISTINCT customer_link FROM my_students WHERE customer_link IS NOT NULL) AS customer_links
  `);
  const row = ((r?.rows ?? r ?? [])[0] ?? {}) as {
    phones?: string[];
    parent_ids?: string[];
    student_ids?: string[];
    student_erp_names?: string[];
    enroll_keys?: string[];
    customer_links?: string[];
  };
  return {
    myPhone: phone,
    phones: row.phones ?? [phone],
    parentIds: row.parent_ids ?? [parentId],
    studentIds: row.student_ids ?? [],
    studentErpNames: row.student_erp_names ?? [],
    enrollKeys: row.enroll_keys ?? [],
    customerLinks: row.customer_links ?? [],
  };
}

/** Emit a SQL `(a,b,c)` IN-list, or `(NULL)` for an empty list so the
 *  parent `IN` clause evaluates to false instead of being a syntax error. */
function sqlInOrNull(values: string[]): SQL {
  if (values.length === 0) return sql`(NULL)`;
  return sql`(${sql.join(values.map((v) => sql`${v}`), sql`, `)})`;
}

export type ParentOrderListItem = {
  id: string;
  orderNumber: string;
  status: string;
  paymentStatus: string;
  total: number;
  createdAt: string;
  itemCount: number;
  thumbUrl: string | null;
  // For parents with multiple students, the UI shows which child this
  // order belongs to. ERPNext keeps the student's name in
  // sales_orders.customer_name; enrollment comes from erp.customers.
  studentName: string | null;
  enrollment: string | null;
};

export async function listParentOrdersFromErp(
  parentId: string
): Promise<ParentOrderListItem[]> {
  const fam = await getFamilyIdentity(parentId);
  if (!fam) return [];
  const studentIds = sqlInOrNull(fam.studentIds);
  const studentErpNames = sqlInOrNull(fam.studentErpNames);
  const enrollKeys = sqlInOrNull(fam.enrollKeys);
  const customerLinks = sqlInOrNull(fam.customerLinks);

  // Source of truth = LOCAL `orders` table for any parent_id / student_id
  // in this family UNION mirror rows matched by family phone, the
  // student's ERP customer name, or the student's normalised enrollment
  // number (digits-only — audit and our local rows sometimes carry
  // different orderings, e.g. "KS240005" vs "24KS0005"). Dedup by
  // order_number. Without this fan-out, an order placed under a
  // co-guardian's phone never appears on the primary parent's My Orders.
  const orders = rows<{
    order_no: string;
    txn: string | null;
    display_status: string | null;
    payment_status: string | null;
    grand_total: number | null;
    item_count: number;
    ship_n: number;
    ship_delivered: number;
    ship_ofd: number;
    ship_in_transit: number;
    audit_cat_all_delivered: boolean;
    sealed_pu: number;
    dispatched_pu: number;
    thumb: string | null;
    student_name: string | null;
    enrollment: string | null;
    local_status: string | null;
  }>(
    await db.execute(sql`
      WITH parent_orders AS (
        -- Dedup by order_no, preferring the local row when present
        -- (carries local_status + accurate receiverName). Mirror-only
        -- rows fill in legacy orders placed before parent linking.
        SELECT DISTINCT ON (order_no)
               order_no, txn, local_status
          FROM (
            SELECT o.order_number              AS order_no,
                   o.created_at::date::text    AS txn,
                   o.status::text              AS local_status,
                   1                           AS pri
              FROM orders o
              -- Local inclusion: my own parent record OR an order whose
              -- student is in my direct-student set. We don't widen the
              -- parent_id list by phone — a co-guardian's separate parent
              -- record could carry orders for unrelated kids.
             WHERE o.parent_id = ${parentId}
                OR (o.student_id IS NOT NULL AND o.student_id::text IN ${studentIds})
            UNION ALL
            SELECT so.erp_name                 AS order_no,
                   so.transaction_date::text   AS txn,
                   NULL                        AS local_status,
                   2                           AS pri
              FROM erp.sales_orders so
              LEFT JOIN erp.customers cu ON cu.erp_name = so.customer
              -- ERP-mirror inclusion: only via student-identity (customer
              -- = student.erp_name OR composite enrollment key match) OR
              -- a contact_mobile equal to MY own phone. We do NOT match
              -- against guardian phones here, since that surfaces co-
              -- guardians' orders for unrelated children. The enrollment
              -- key joins on (alpha-prefix, digits) so "KS240005" matches
              -- "24KS0005" without colliding with "AW240005" / "WF240005"
              -- which share the same trailing digits across schools.
             WHERE right(regexp_replace(coalesce(so.contact_mobile,''), '\\D', '', 'g'), 10) = ${fam.myPhone}
                OR so.customer IN ${studentErpNames}
                -- Guest-style orders placed under a separate ERP customer
                -- that is explicitly bound to my student via
                -- students.customer_link (same bridge the admin student page
                -- uses). Student-scoped — only my own students' links — so
                -- it surfaces stranded orders without leaking co-guardians'
                -- unrelated orders. Fixes accounts where the order's
                -- customer (e.g. "VARUNTEJ SILIVERI") shares no phone /
                -- erp_name / enrollment with the linked student record.
                OR so.customer IN ${customerLinks}
                OR (
                  cu.custom_enrollment_number IS NOT NULL
                  AND lower(regexp_replace(cu.custom_enrollment_number, '[^a-zA-Z]', '', 'g'))
                      || ':' ||
                      regexp_replace(cu.custom_enrollment_number, '\\D', '', 'g')
                    IN ${enrollKeys}
                )
                -- Also match against the enrollment carried on audit's raw
                -- order JSON. CCAvenue-stub orders never produce a real
                -- erp.customers row, but audit usually back-fills the SO's
                -- enrollment_number once the student is identified, and
                -- that is the only signal we have for those orders.
                OR (
                  COALESCE(so.raw->>'enrollment_number','') <> ''
                  AND lower(regexp_replace(so.raw->>'enrollment_number', '[^a-zA-Z]', '', 'g'))
                      || ':' ||
                      regexp_replace(so.raw->>'enrollment_number', '\\D', '', 'g')
                    IN ${enrollKeys}
                )
          ) src
         ORDER BY order_no, pri
      )
      SELECT po.order_no,
             COALESCE(so.transaction_date::text, po.txn) AS txn,
             so.custom_display_status AS display_status,
             so.custom_payment_status AS payment_status,
             -- ERP grand_total is in rupees; local orders.total is in PAISE.
             -- Divide the local fallback so the UI gets rupees either way.
             round(COALESCE(so.grand_total, lo.total / 100.0)::numeric, 0)::int AS grand_total,
             COALESCE(NULLIF(i.cnt, 0), li.cnt, 0)::int AS item_count,
             COALESCE(sh.n, 0)::int AS ship_n,
             COALESCE(sh.delivered, 0)::int AS ship_delivered,
             COALESCE(sh.ofd, 0)::int AS ship_ofd,
             COALESCE(sh.in_transit, 0)::int AS ship_in_transit,
             COALESCE(
               (SELECT bool_and(
                  lower(coalesce(so.raw->'derived_delivery_by_category'->>k, ''))
                  IN ('delivered','fully delivered','completed')
                )
                FROM jsonb_array_elements_text(
                  CASE
                    WHEN jsonb_typeof((so.raw::jsonb)->'derived_delivery_categories_present') = 'array'
                    THEN (so.raw::jsonb)->'derived_delivery_categories_present'
                    ELSE '[]'::jsonb
                  END
                ) AS k),
               false
             ) AS audit_cat_all_delivered,
             COALESCE(pu.sealed, 0)::int AS sealed_pu,
             COALESCE(pu.dispatched, 0)::int AS dispatched_pu,
             thumb.image AS thumb,
             -- Identify the child this order was placed for, so a parent
             -- with multiple students sees one group per child. Source of
             -- truth priority:
             --   1. local orders.student_id (set at checkout)
             --   2. audit raw enrollment_number matched to a local student
             --      (covers CCAvenue-stub orders that never got a real
             --      erp.customers row but audit later back-filled the SO)
             --   3. shipping receiverName (legacy mirror-only orders)
             --   4. ERP customer_name as final fallback
             COALESCE(s.name, s_raw.name, lo.shipping_address->>'receiverName', so.customer_name) AS student_name,
             COALESCE(
               s.enrollment_number,
               s_raw.enrollment_number,
               so.raw->>'enrollment_number',
               c.custom_enrollment_number
             ) AS enrollment,
             po.local_status
        FROM parent_orders po
        LEFT JOIN erp.sales_orders so ON so.erp_name = po.order_no
        LEFT JOIN orders lo
               ON lo.order_number = po.order_no OR lo.erp_so_name = po.order_no
        LEFT JOIN students s ON s.id = lo.student_id
        -- Same-family student lookup by raw enrollment match. Scoped to
        -- students this parent has access to so we never pull in someone
        -- else's kid via an accidental enrollment collision.
        LEFT JOIN LATERAL (
          SELECT s2.id, s2.name, s2.enrollment_number
            FROM students s2
           WHERE s2.id::text IN ${studentIds}
             AND so.raw->>'enrollment_number' IS NOT NULL
             AND so.raw->>'enrollment_number' <> ''
             AND lower(regexp_replace(coalesce(s2.enrollment_number,''), '[^a-zA-Z]', '', 'g'))
                 || ':' ||
                 regexp_replace(coalesce(s2.enrollment_number,''), '\\D', '', 'g')
                 =
                 lower(regexp_replace(so.raw->>'enrollment_number', '[^a-zA-Z]', '', 'g'))
                 || ':' ||
                 regexp_replace(so.raw->>'enrollment_number', '\\D', '', 'g')
           LIMIT 1
        ) s_raw ON true
        LEFT JOIN erp.customers c ON c.erp_name = so.customer
        LEFT JOIN LATERAL (
          SELECT count(*) AS cnt FROM erp.sales_order_items x
           WHERE x.order_erp_name = po.order_no
        ) i ON true
        LEFT JOIN LATERAL (
          SELECT count(*) AS cnt FROM order_items oi
           WHERE oi.order_id = lo.id
        ) li ON true
        LEFT JOIN LATERAL (
          SELECT count(*) AS n,
                 count(*) FILTER (WHERE x.status = 'delivered')        AS delivered,
                 count(*) FILTER (WHERE x.status = 'out_for_delivery') AS ofd,
                 count(*) FILTER (WHERE x.status = 'in_transit')       AS in_transit
            FROM erp.outward_shipments x
           WHERE x.order_erp_name = po.order_no
             -- Mirror the detail-page filters: hide soft-deleted rows
             -- and synthetic 'shipped_to_school' / pre-AWB stubs whose
             -- tracking number starts 'syn:'. Counting those as a
             -- delivered shipment makes the listing claim "delivered"
             -- on orders that audit still flags "Not Yet Delivered".
             AND x.is_deleted = false
             AND COALESCE(x.tracking_number, '') NOT LIKE 'syn:%'
        ) sh ON true
        LEFT JOIN LATERAL (
          SELECT count(*) FILTER (WHERE pu.status = 'sealed')     AS sealed,
                 count(*) FILTER (WHERE pu.status = 'dispatched') AS dispatched
            FROM erp.packing_units pu WHERE pu.order_erp_name = po.order_no
        ) pu ON true
        LEFT JOIN LATERAL (
          -- Prefer the R2 URL captured at checkout (order_items.image_snapshot).
          -- Fall back to ERP items.image (relative path; resolved by imgUrl()).
          -- ERP-mirror-only orders (no local row) take the fallback only.
          SELECT COALESCE(
                   NULLIF(oi_local.image_snapshot, ''),
                   NULLIF(it.image, '')
                 ) AS image
            FROM erp.sales_order_items soi
            LEFT JOIN erp.items it ON it.erp_name = soi.item_code
            LEFT JOIN order_items oi_local
                   ON oi_local.order_id = lo.id
                  AND oi_local.name_snapshot = soi.item_name
           WHERE soi.order_erp_name = po.order_no
             AND (oi_local.image_snapshot IS NOT NULL AND oi_local.image_snapshot <> ''
                  OR (it.image IS NOT NULL AND it.image <> ''))
           ORDER BY soi.id
           LIMIT 1
        ) thumb ON true
       ORDER BY COALESCE(so.transaction_date::text, po.txn) DESC NULLS LAST,
                po.order_no DESC
    `)
  );

  return orders.map((o) => ({
    id: o.order_no,
    orderNumber: o.order_no,
    // Prefer ERP-derived status. The local `orders.status` is only used
    // as a fallback when audit hasn't mirrored the order header yet
    // (display_status is null) — i.e. a just-placed order still in the
    // drain buffer. Once audit has spoken we trust audit, because the
    // local status can be inflated by webhooks fired off synthetic
    // 'shipped_to_school' / 'syn:' shipments that don't represent a
    // real customer delivery.
    status: (() => {
      const erp = uiStatus(
        o.display_status,
        o.ship_n,
        o.ship_delivered,
        o.sealed_pu,
        o.dispatched_pu,
        o.ship_ofd,
        o.audit_cat_all_delivered,
        o.ship_in_transit
      );
      const auditQuiet = !o.display_status || o.display_status.trim() === "";
      return auditQuiet && o.local_status ? o.local_status : erp;
    })(),
    paymentStatus:
      (o.payment_status ?? "").toUpperCase() === "SUCCESS"
        ? "paid"
        : (o.payment_status ?? "pending").toLowerCase(),
    total: o.grand_total ?? 0,
    createdAt: o.txn ? new Date(o.txn).toISOString() : new Date().toISOString(),
    itemCount: o.item_count,
    thumbUrl: imgUrl(o.thumb),
    studentName: o.student_name,
    enrollment: o.enrollment,
  }));
}

export type ParentOrderDetail = {
  id: string;
  orderNumber: string;
  status: string;
  paymentStatus: string;
  subtotal: number;
  tax: number;
  shipping: number;
  discount: number;
  total: number;
  shippingAddress: {
    receiverName: string;
    receiverPhone: string;
    line1: string;
    line2?: string;
    city: string;
    state: string;
    pincode: string;
  };
  placedAt: string | null;
  confirmedAt: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
  items: {
    id: string;
    name: string;
    size: string;
    qty: number;
    unitPrice: number;
    total: number;
    imageUrl: string;
    /** Magic Box / bundle picks captured at checkout. null for plain lines.
     *  ERP-synced orders are best-effort enriched from the local
     *  `order_items` mirror by orderNumber — if the local row has been
     *  garbage-collected, this will be null on ERP rows.
     *  `attributes` is enriched at read time from product_variant_attributes
     *  so multi-axis picks (Uniform Colour × Size, bookkit 2nd Language)
     *  render their values instead of the unreadable concatenated SKU. */
    bundleSelections: {
      componentProductId: string;
      name: string;
      qty: number;
      variantId: string;
      size: string;
      attributes: { name: string; value: string }[];
    }[] | null;
  }[];
  payment: { provider: string; status: string; method: string | null } | null;
  tracking: {
    partner: string;
    trackingNumber: string | null;
    status: string;
    dispatchedAt: string | null;
    deliveredAt: string | null;
  }[];
  /** Rich per-shipment view used by the storefront order page. Each entry
   *  has a merged chronological timeline that intermixes system status
   *  transitions (Auto-poll) with raw carrier scans (location + label).
   *  Empty when the order has no shipments yet. */
  shipmentHistory: {
    /** Stable shipment id (mirror PK). Only set for rows from
     *  erp.outward_shipments. Packing-unit fallback rows leave this null. */
    shipmentId: number | null;
    partner: string;
    /** "auto" if the first system event's actor matches a known auto-poll
     *  worker (`auto-track`, `srocket-sync`, etc.); "manual" otherwise. */
    mode: "auto" | "manual" | null;
    trackingNumber: string | null;
    status: string;
    itemCategory: string | null;
    description: string | null;
    dispatchedAt: string | null;
    deliveredAt: string | null;
    /** Count of raw carrier scans (carrier_events JSONB length). */
    carrierEventCount: number;
    /** Sorted ascending by `at`. */
    events: {
      kind: "system" | "carrier";
      /** ISO timestamp. */
      at: string;
      /** Carrier-side label ("Picked Up") or system-side transition
       *  ("Pickup Pending"). For system events when both from/to are
       *  present, formatted as "From → To". */
      label: string;
      /** Free-text descriptor — location for carrier scans, actor for
       *  system events ("auto-track (dtdc)"). */
      source: string | null;
      /** Small badge text — "Auto-poll" / "Carrier scan" / "Manual". */
      badge: string;
    }[];
  }[];
  // Which student this order is for. Parents with multiple kids share one
  // phone-keyed login, so the UI labels each order with the child's name +
  // enrollment number to disambiguate.
  studentName: string | null;
  enrollment: string | null;
  /** Per-root-category dispatch roll-up for the "Tracking by category"
   *  section on the My Orders detail page. Empty array if the order
   *  has no items (shouldn't happen) or category resolution failed
   *  entirely. Items with no resolvable category bucket into a single
   *  synthetic "Other" group. */
  categoryGroups: CategoryGroup[];
  /** True when the ERP poll hasn't run for this order yet — the UI
   *  shows a "Tracking will appear within a few minutes" banner. */
  pollPending: boolean;
};

export async function getParentOrderDetailFromErp(
  parentId: string,
  orderNo: string
): Promise<ParentOrderDetail | null> {
  const fam = await getFamilyIdentity(parentId);
  if (!fam) return null;
  const studentErpNames = sqlInOrNull(fam.studentErpNames);
  const enrollKeys = sqlInOrNull(fam.enrollKeys);
  const customerLinks = sqlInOrNull(fam.customerLinks);

  const [o] = rows<{
    order_no: string;
    customer_name: string | null;
    contact_mobile: string | null;
    txn: string | null;
    display_status: string | null;
    payment_status: string | null;
    payment_mode: string | null;
    payment_flow: string | null;
    grand_total: number | null;
    net_total: number | null;
    tax_total: number | null;
    address_display: string | null;
    shipping_address: string | null;
    pincode: string | null;
    sealed_pu: number;
    dispatched_pu: number;
    enrollment: string | null;
    local_ship: Record<string, unknown> | null;
    derived_by_category: Record<string, string> | null;
    derived_categories_present: string[] | null;
  }>(
    await db.execute(sql`
      SELECT so.erp_name AS order_no, so.customer_name, so.contact_mobile,
             so.transaction_date::text AS txn,
             so.custom_display_status AS display_status,
             so.custom_payment_status AS payment_status,
             so.custom_payment_mode AS payment_mode,
             so.custom_payment_flow AS payment_flow,
             round(so.grand_total::numeric,0)::int AS grand_total,
             round(coalesce(so.net_total,so.grand_total)::numeric,0)::int AS net_total,
             round(coalesce(so.total_taxes_and_charges,0)::numeric,0)::int AS tax_total,
             so.address_display, so.shipping_address,
             so.custom_pin_code AS pincode,
             (SELECT count(*) FROM erp.packing_units pu
                WHERE pu.order_erp_name = so.erp_name AND pu.status = 'sealed')::int
               AS sealed_pu,
             (SELECT count(*) FROM erp.packing_units pu
                WHERE pu.order_erp_name = so.erp_name AND pu.status = 'dispatched')::int
               AS dispatched_pu,
             c.custom_enrollment_number AS enrollment,
             lo.shipping_address AS local_ship,
             so.raw->'derived_delivery_by_category' AS derived_by_category,
             -- Guard against the value being a jsonb scalar (incl. jsonb
             -- null), which COALESCE does NOT replace — only SQL NULL
             -- does. Without the type check, jsonb_array_elements_text
             -- crashes with "cannot extract elements from a scalar" (seen
             -- on SAL-ORD-2026-31886 after audit-side delivery flip).
             ARRAY(SELECT jsonb_array_elements_text(
                            CASE
                              WHEN jsonb_typeof((so.raw::jsonb)->'derived_delivery_categories_present') = 'array'
                              THEN (so.raw::jsonb)->'derived_delivery_categories_present'
                              ELSE '[]'::jsonb
                            END))
               AS derived_categories_present
      FROM erp.sales_orders so
      LEFT JOIN erp.customers c ON c.erp_name = so.customer
      LEFT JOIN orders lo ON lo.erp_so_name = so.erp_name
      WHERE so.erp_name = ${orderNo}
        AND (
          right(regexp_replace(coalesce(so.contact_mobile,''), '\\D', '', 'g'), 10) = ${fam.myPhone}
          OR so.customer IN ${studentErpNames}
          -- Guest-style order bound to my student via customer_link (mirrors
          -- the list query in listParentOrdersFromErp; keeps the detail page
          -- reachable for the same orders the list now surfaces).
          OR so.customer IN ${customerLinks}
          OR (
            c.custom_enrollment_number IS NOT NULL
            AND lower(regexp_replace(c.custom_enrollment_number, '[^a-zA-Z]', '', 'g'))
                || ':' ||
                regexp_replace(c.custom_enrollment_number, '\\D', '', 'g')
              IN ${enrollKeys}
          )
          OR (
            COALESCE(so.raw->>'enrollment_number','') <> ''
            AND lower(regexp_replace(so.raw->>'enrollment_number', '[^a-zA-Z]', '', 'g'))
                || ':' ||
                regexp_replace(so.raw->>'enrollment_number', '\\D', '', 'g')
              IN ${enrollKeys}
          )
        )
      LIMIT 1
    `)
  );
  if (!o) return null;

  const items = rows<{
    id: number;
    item_name: string | null;
    qty: number | null;
    rate: number | null;
    amount: number | null;
    image: string | null;
    bundle_selections: unknown;
    sku: string | null;
  }>(
    await db.execute(sql`
      -- Items source: prefer the LOCAL order_items (captured at checkout,
      -- the source of truth for what the customer ordered). Fall back to
      -- the ERP mirror only when local has no rows (legacy mirror-only
      -- orders that were placed before the storefront started writing
      -- local rows). Image: local image_snapshot (R2) wins; falls back
      -- to erp.items.image (now also R2 after the rehost migration).
      -- NB: local order_items stores prices in PAISE (integer);
      -- divide by 100 so the downstream Math.round produces rupees.
      -- bundle_selections only exists on local rows; ERP mirror has
      -- no concept of Magic Box picks, so we project NULL there.
      -- sku is surfaced so the category-tracking enricher can join to
      -- erp.sales_order_items.item_code (the dispatch counters).
      WITH local_items AS (
        SELECT oi.id::text AS id, oi.name_snapshot AS item_name,
               oi.qty::float8 AS qty,
               (oi.unit_price / 100.0)::float8 AS rate,
               (oi.total      / 100.0)::float8 AS amount,
               -- Image: prefer the R2 snapshot captured at checkout; fall
               -- back to the ERP item image (resolved by SKU → erp.items,
               -- then its variant parent). ~7k delivered line items have a
               -- null/empty image_snapshot but a perfectly good
               -- erp.items.image — without this fallback they rendered an
               -- empty grey box on the order page even though the SAME
               -- thumbnail shows on the My-Orders list (whose query already
               -- has this fallback). Magic Box parents stay blank (no item
               -- image exists) but list their contents below regardless.
               COALESCE(NULLIF(oi.image_snapshot,''), NULLIF(li.image,''), NULLIF(lvt.image,'')) AS image,
               oi.bundle_selections AS bundle_selections,
               pv.sku AS sku,
               row_number() OVER (ORDER BY oi.id) AS rn
          FROM order_items oi
          JOIN orders lo ON lo.id = oi.order_id
          LEFT JOIN product_variants pv ON pv.id = oi.variant_id
          LEFT JOIN erp.items li  ON li.erp_name  = pv.sku
          LEFT JOIN erp.items lvt ON lvt.erp_name = li.variant_of
         WHERE lo.erp_so_name = ${orderNo}
      ),
      erp_items AS (
        SELECT soi.id::text AS id, soi.item_name,
               soi.qty::float8 AS qty,
               soi.rate::float8 AS rate,
               soi.amount::float8 AS amount,
               COALESCE(NULLIF(it.image,''), NULLIF(vt.image,'')) AS image,
               NULL::jsonb AS bundle_selections,
               soi.item_code AS sku
          FROM erp.sales_order_items soi
          LEFT JOIN erp.items it ON it.erp_name = soi.item_code
          LEFT JOIN erp.items vt ON vt.erp_name = it.variant_of
         WHERE soi.order_erp_name = ${orderNo}
         ORDER BY soi.id
      )
      SELECT id, item_name, qty, rate, amount, image, bundle_selections, sku
        FROM local_items
       WHERE (SELECT count(*) FROM local_items) > 0
      UNION ALL
      SELECT id, item_name, qty, rate, amount, image, bundle_selections, sku
        FROM erp_items
       WHERE (SELECT count(*) FROM local_items) = 0
    `)
  );

  // Shipments come from TWO sources on the new ERP:
  //   1. erp.outward_shipments — populated when the order uses ERP's
  //      outward shipment workflow (legacy path).
  //   2. erp.packing_units — populated when warehouse uses pack →
  //      seal → dispatch in /warehouse-packing (current default flow).
  // Without #2 the customer sees "shipped" status but no tracking
  // number / carrier, because the row that has them is in packing_units.
  const shipments = rows<{
    shipment_id: number | null;
    partner: string | null;
    tracking_number: string | null;
    status: string | null;
    dispatched_at: string | null;
    delivered_at: string | null;
    item_category: string | null;
    description: string | null;
    carrier_events: unknown;
  }>(
    await db.execute(sql`
      (
        -- Audit's mirror frequently holds DUPLICATE outward_shipments rows
        -- for ONE physical parcel — the same AWB synced many times (e.g.
        -- a single srocket AWB mirrored 12×; 5,110 orders carry >1 row,
        -- 3,067 share an AWB). Each duplicate rendered as its own identical
        -- "Shipment history" card with the same carrier timeline. Collapse
        -- to one row per (category, AWB), keeping the most-progressed copy.
        SELECT DISTINCT ON (item_category, COALESCE(tracking_number, ''))
               id::int        AS shipment_id,
               partner, tracking_number, status,
               dispatched_at::text AS dispatched_at,
               delivered_at::text  AS delivered_at,
               item_category, description, carrier_events
          FROM erp.outward_shipments
         WHERE order_erp_name = ${orderNo}
           AND is_deleted = false
           -- Hide legacy synthetic rows. These were written before the
           -- carrier-side AWB came back from srocket/dtdc; once the real
           -- shipment row arrives (with a partner-issued tracking number),
           -- the synthetic acts as a stub that double-counts the parcel.
           AND COALESCE(tracking_number, '') NOT LIKE 'syn:%'
         ORDER BY item_category, COALESCE(tracking_number, ''),
                  (status = 'delivered') DESC,
                  delivered_at DESC NULLS LAST,
                  dispatched_at DESC NULLS LAST,
                  id DESC
      )
      UNION ALL
      (
        SELECT NULL::int      AS shipment_id,
               partner, tracking_number,
               CASE
                 WHEN status = 'dispatched' THEN 'shipped'
                 WHEN status = 'sealed'     THEN 'packed'
                 ELSE status
               END AS status,
               dispatched_at::text AS dispatched_at,
               NULL::text          AS delivered_at,
               NULL::text          AS item_category,
               NULL::text          AS description,
               NULL::jsonb         AS carrier_events
          FROM erp.packing_units pu
         WHERE pu.order_erp_name = ${orderNo}
           AND pu.status IN ('sealed','dispatched')
           -- Once an outward_shipments row exists for this order, it owns
           -- the lifecycle (it's the only place that flips to "delivered").
           -- Keeping packing_units in the union double-counts and pegs the
           -- timeline at "shipped" forever, because packing_units never
           -- progresses past "dispatched".
           AND NOT EXISTS (
             SELECT 1 FROM erp.outward_shipments os
              WHERE os.order_erp_name = pu.order_erp_name
           )
      )
      ORDER BY dispatched_at DESC NULLS LAST
    `)
  );

  // System-side status transitions for the outward_shipments rows in this
  // order — one round-trip for all shipments rather than N. Packing-unit
  // fallback rows have no system events (shipment_id is null on those).
  const shipmentIds = shipments
    .map((s) => s.shipment_id)
    .filter((id): id is number => typeof id === "number");
  const systemEvents = shipmentIds.length
    ? rows<{
        shipment_id: number;
        from_status: string | null;
        to_status: string;
        note: string | null;
        actor: string | null;
        created_at: string;
      }>(
        await db.execute(sql`
          SELECT shipment_id, from_status, to_status, note, actor,
                 created_at::text AS created_at
            FROM erp.outward_status_events
           WHERE shipment_id IN ${sql.raw(`(${shipmentIds.join(",")})`)}
             -- Drop NO-OP transitions (from_status = to_status). Audit's
             -- 'onedrive-consolidate' reconcile job re-stamps the terminal
             -- state on every run, writing hundreds of identical
             -- 'delivered → delivered' rows per shipment (397,986 of
             -- 567,476 rows = 70% are no-ops; one shipment had 773). They
             -- carry no information and flooded the customer timeline,
             -- burying the real carrier scans. Keep genuine transitions
             -- (incl. the initial one where from_status IS NULL).
             AND from_status IS DISTINCT FROM to_status
           ORDER BY shipment_id, created_at
        `)
      )
    : [];
  const systemByShipment = new Map<number, typeof systemEvents>();
  for (const ev of systemEvents) {
    const list = systemByShipment.get(ev.shipment_id) ?? [];
    list.push(ev);
    systemByShipment.set(ev.shipment_id, list);
  }

  const created = o.txn ? new Date(o.txn).toISOString() : new Date().toISOString();
  const addrBlob = (o.address_display || o.shipping_address || "").trim();
  // Prefer the structured jsonb captured at checkout on the local
  // orders table — ERP's /api/orders/{name} doesn't return the
  // shipping address, so the mirror columns are NULL. The local jsonb
  // has receiverName/Phone/line1/city/state/pincode straight from the
  // checkout form, which is the source of truth for parents.
  const ls = (o.local_ship ?? {}) as Record<string, string | undefined>;
  const shipDelivered = shipments.filter(
    (s) => s.status === "delivered"
  ).length;

  // Collect variantIds from every Magic Box pick so we can attach the
  // per-axis attribute breakdown alongside the legacy `size` field.
  // Without this enrichment, multi-axis components (Uniform Colour ×
  // Size, bookkit 2nd Language) would render the raw concatenated SKU.
  const erpBundleVariantIds: string[] = [];
  for (const it of items) {
    const bs = it.bundle_selections as
      | { variantId?: string }[]
      | null
      | undefined;
    if (Array.isArray(bs)) {
      for (const s of bs) if (s.variantId) erpBundleVariantIds.push(s.variantId);
    }
  }
  const erpAttrsByVariant = await attrsByVariantId(
    Array.from(new Set(erpBundleVariantIds))
  );

  // Category-wise tracking roll-up. Resolve each item's root category
  // via product_variants.sku → products.category_id, and its dispatch
  // counters via erp.sales_order_items keyed by item_code (== sku).
  const skus = Array.from(
    new Set(items.map((it) => it.sku).filter((s): s is string => !!s))
  );
  const [catBySku, qtysByCode, erpLines, pollMeta] = await Promise.all([
    categoryIdBySku(skus),
    dispatchQtysByItemCode(orderNo),
    erpItemsForCategoryGrouping(orderNo),
    db
      .execute(sql`
        SELECT erp_last_polled_at, created_at
          FROM orders
         WHERE erp_so_name = ${orderNo}
         LIMIT 1
      `)
      .then((r: any) => (r?.rows ?? r ?? [])[0] as {
        erp_last_polled_at: string | null;
        created_at: string;
      } | undefined),
  ]);
  // Audit is the source of truth for per-category tracking. Its
  // /api/orders/{name} header gives a `derived_delivery_by_category`
  // map (e.g. {"bookkit":"In Transit","uniform":"Pending"}) which is
  // exactly what the customer's card should show. We mirror that
  // verbatim and only fall back to the older per-shipment derivation
  // when the audit field is missing (very old polled orders).
  //
  // Items source for grouping: prefer audit's per-line mirror
  // (`erp.sales_order_items`) when present. For Magic Box / bundle
  // orders, that's the only way to see the bookkit and uniform
  // components split correctly — the local `order_items` row is the
  // bundle parent SKU, which audit never tags with a category. For
  // non-bundle orders, the ERP rows match local 1:1, so the breakdown
  // is identical.
  const localItemsForGrouping = items.map((it) => {
    const qtys = (it.sku && qtysByCode.get(it.sku)) || {
      deliveredQty: 0,
      pickedQty: 0,
      returnedQty: 0,
      erpCategory: null as string | null,
    };
    return {
      id: String(it.id),
      name: it.item_name ?? "Item",
      qty: it.qty ?? 0,
      categoryId: it.sku ? catBySku.get(it.sku) ?? null : null,
      deliveredQty: qtys.deliveredQty,
      pickedQty: qtys.pickedQty,
      returnedQty: qtys.returnedQty,
      erpCategory: qtys.erpCategory,
    };
  });
  const itemsForGrouping =
    erpLines.length > 0 ? erpLines : localItemsForGrouping;

  let categoryGroups: Awaited<ReturnType<typeof groupItemsByRootCategory>>;
  const auditCat = o.derived_by_category ?? null;
  if (auditCat && Object.keys(auditCat).length > 0) {
    categoryGroups = groupItemsByAuditCategory(
      itemsForGrouping,
      auditCat,
      o.derived_categories_present ?? null
    );
  } else {
    // Pre-mirror orders (no derived_delivery_by_category on audit yet).
    // Fall back to the per-shipment derivation so the card isn't blank.
    const fallbackByErpCategory = new Map<
      string,
      "delivered" | "in_transit"
    >();
    for (const s of shipments) {
      const cat = (s.item_category ?? "").toLowerCase().trim();
      if (!cat) continue;
      const status = (s.status ?? "").toLowerCase();
      const isDelivered = status === "delivered";
      const isInTransit =
        !!s.dispatched_at ||
        ["shipped", "in_transit", "dispatched", "packed"].includes(status);
      const prev = fallbackByErpCategory.get(cat);
      if (isDelivered) fallbackByErpCategory.set(cat, "delivered");
      else if (isInTransit && prev !== "delivered")
        fallbackByErpCategory.set(cat, "in_transit");
    }
    categoryGroups = await groupItemsByRootCategory(
      itemsForGrouping,
      fallbackByErpCategory
    );
  }

  // Audit's `derived_delivery_by_category` is sometimes stale — its
  // backend recomputes on a schedule, so a freshly-progressed parcel can
  // sit at "Pending" for minutes while the shipment row already says
  // "out_for_delivery". When that happens, the customer sees a Confirmed
  // stepper above a sRocket card whose timeline is screaming OFD. Use
  // the shipments we have as a FLOOR — never downgrade what audit says,
  // but bump the category card up if any matching shipment is more
  // progressed.
  const rankOf = (s: string): number => {
    if (s === "delivered" || s === "returned") return 3;
    if (s === "out for delivery") return 2;
    if (s === "in transit") return 1;
    return 0;
  };
  const shipmentStatusToCategory = (s: string | null | undefined): string => {
    const v = (s ?? "").toLowerCase().trim();
    if (v === "delivered") return "delivered";
    if (
      v === "out_for_delivery" ||
      v === "out for delivery" ||
      v === "ofd"
    )
      return "out for delivery";
    if (
      [
        "dispatched",
        "shipped",
        "in_transit",
        "in transit",
        "packed",
        "manifested",
        "ready_for_dispatch",
      ].includes(v)
    )
      return "in transit";
    return "pending";
  };
  for (const g of categoryGroups) {
    const catKey = g.rootCategoryName.toLowerCase();
    let bestFromShipments = "pending";
    for (const s of shipments) {
      const sCat = (s.item_category ?? "").toLowerCase().trim();
      if (sCat !== catKey) continue;
      const mapped = shipmentStatusToCategory(s.status);
      if (rankOf(mapped) > rankOf(bestFromShipments)) bestFromShipments = mapped;
    }
    if (rankOf(bestFromShipments) > rankOf(g.status)) {
      // Bump the badge AND realign the quantity counters so the subtitle
      // matches ("4 / 4 out for delivery" rather than "4 awaiting dispatch").
      // We don't have per-line shipment visibility, so we assume the bump
      // applies to the whole category — a single shipment per category is
      // the common case, and a partial bump from a single line would
      // misrepresent the parcel-level reality anyway.
      g.status = bestFromShipments as typeof g.status;
      if (bestFromShipments === "delivered") {
        g.deliveredQty = g.totalQty;
        g.pickedQty = 0;
      } else {
        g.pickedQty = g.totalQty;
        g.deliveredQty = 0;
      }
      for (const it of g.items) {
        if (bestFromShipments === "delivered") {
          it.deliveredQty = it.qty;
          it.pickedQty = 0;
        } else {
          it.pickedQty = it.qty;
          it.deliveredQty = 0;
        }
      }
    }
  }

  const pollPending =
    !pollMeta?.erp_last_polled_at &&
    !!pollMeta?.created_at &&
    Date.now() - new Date(pollMeta.created_at).getTime() < 10 * 60_000;

  return {
    id: o.order_no,
    orderNumber: o.order_no,
    status: uiStatus(
      o.display_status,
      shipments.length,
      shipDelivered,
      o.sealed_pu,
      o.dispatched_pu,
      shipments.filter((s) => s.status === "out_for_delivery").length,
      // audit_cat_all_delivered: compute from the per-category fields
      // we already pulled. true when every category in `present` is in
      // a delivered state per `by_cat` — keeps the order-level header
      // in sync with the per-category cards below.
      (() => {
        const present = o.derived_categories_present ?? [];
        const byCat = o.derived_by_category ?? {};
        if (present.length === 0) return false;
        const byCatLc: Record<string, string> = {};
        for (const [k, v] of Object.entries(byCat))
          byCatLc[k.toLowerCase()] = String(v ?? "").toLowerCase();
        return present.every((p) => {
          const v = byCatLc[(p ?? "").toLowerCase()] ?? "";
          return v === "delivered" || v === "fully delivered" || v === "completed";
        });
      })(),
      // in-transit shipment count — lifts the order header off "shipped"
      // onto "in transit" the moment the carrier scans a line-haul leg.
      shipments.filter((s) => s.status === "in_transit").length
    ),
    paymentStatus:
      (o.payment_status ?? "").toUpperCase() === "SUCCESS"
        ? "paid"
        : (o.payment_status ?? "pending").toLowerCase(),
    subtotal: o.net_total ?? o.grand_total ?? 0,
    tax: o.tax_total ?? 0,
    shipping: 0,
    discount: 0,
    total: o.grand_total ?? 0,
    shippingAddress: {
      receiverName: ls.receiverName || o.customer_name || "",
      receiverPhone:
        (ls.receiverPhone || o.contact_mobile || "")
          .replace(/\D/g, "")
          .slice(-10),
      line1: ls.line1 || addrBlob || "—",
      line2: ls.line2 || "",
      city: ls.city || "",
      state: ls.state || "",
      pincode: ls.pincode || o.pincode || "",
    },
    placedAt: created,
    confirmedAt:
      (o.payment_status ?? "").toUpperCase() === "SUCCESS" ? created : null,
    shippedAt:
      shipments.find((s) => s.dispatched_at)?.dispatched_at ?? null,
    deliveredAt:
      shipments.find((s) => s.delivered_at)?.delivered_at ?? null,
    createdAt: created,
    items: items.map((it) => ({
      id: String(it.id),
      name: it.item_name ?? "Item",
      size: "",
      qty: it.qty ?? 0,
      unitPrice: Math.round(it.rate ?? 0),
      total: Math.round(it.amount ?? 0),
      imageUrl: imgUrl(it.image),
      bundleSelections: ((it.bundle_selections as
        | {
            componentProductId: string;
            name: string;
            qty: number;
            variantId: string;
            size: string;
          }[]
        | null
        | undefined) ?? null)?.map((s) => ({
        ...s,
        attributes: erpAttrsByVariant.get(s.variantId) ?? [],
      })) ?? null,
    })),
    payment: o.payment_status
      ? {
          provider: o.payment_flow ?? "ERP",
          status: o.payment_status,
          method: o.payment_mode,
        }
      : null,
    tracking: shipments.map((s) => ({
      partner: s.partner ?? "—",
      trackingNumber: s.tracking_number,
      status: s.status ?? "—",
      dispatchedAt: s.dispatched_at,
      deliveredAt: s.delivered_at,
    })),
    shipmentHistory: shipments.map((s) => {
      // Kick a background refresh — idempotent + throttled to once
      // per 30 s per shipment id. Audit's own carrier-poll cadence is
      // the ground truth; we just make sure our mirror catches up
      // whenever the parent is on this page.
      if (s.shipment_id != null) backgroundRefreshShipment(s.shipment_id);
      const sys = s.shipment_id != null ? systemByShipment.get(s.shipment_id) ?? [] : [];
      const carrier = Array.isArray(s.carrier_events)
        ? (s.carrier_events as { at?: string; label?: string; location?: string; code?: string }[])
        : [];
      // Classify an event by its actor. Carrier scan apps tag their
      // writes with a `-scan` suffix; auto-track / -sync / -api / -poller
      // are the system-side pollers; everything else (named user,
      // "admin", "onedrive-…") is a manual action.
      const classifyActor = (a: string | null | undefined):
        | "Auto-poll"
        | "Carrier scan"
        | "Manual" => {
        if (!a) return "Manual";
        if (/-scan$/i.test(a)) return "Carrier scan";
        if (/auto-track|-(sync|api|poller)\b|^auto-/i.test(a)) return "Auto-poll";
        return "Manual";
      };
      const firstActor = sys[0]?.actor ?? null;
      const mode: "auto" | "manual" | null = firstActor
        ? classifyActor(firstActor) === "Auto-poll"
          ? "auto"
          : "manual"
        : null;
      const events: {
        kind: "system" | "carrier";
        at: string;
        label: string;
        source: string | null;
        badge: string;
      }[] = [];
      for (const ev of sys) {
        events.push({
          kind: "system",
          at: new Date(ev.created_at + "Z").toISOString(),
          label: ev.from_status
            ? `${ev.from_status} → ${ev.to_status}`
            : ev.to_status,
          source: ev.actor,
          badge: classifyActor(ev.actor),
        });
      }
      for (const ev of carrier) {
        if (!ev?.at) continue;
        events.push({
          kind: "carrier",
          at: ev.at,
          label: ev.label ?? ev.code ?? "Scan",
          source: ev.location ?? null,
          badge: "Carrier scan",
        });
      }
      // Newest event first — customers care about "what's happening
      // right now" and don't want to scroll past the entire history to
      // find the latest scan. Carrier app convention is also
      // descending-by-time on a parcel page, so this matches the
      // mental model people already have.
      events.sort((a, b) => (a.at > b.at ? -1 : a.at < b.at ? 1 : 0));
      // Collapse exact-duplicate events (same kind/label/timestamp/source).
      // Repeated auto-polls and carrier re-scans can emit identical rows;
      // after the no-op filter above this is a final safety net so the
      // timeline never shows the same beat twice in a row.
      const seenEv = new Set<string>();
      const dedupedEvents = events.filter((e) => {
        const k = `${e.kind}|${e.label}|${e.at}|${e.source ?? ""}`;
        if (seenEv.has(k)) return false;
        seenEv.add(k);
        return true;
      });
      return {
        shipmentId: s.shipment_id,
        partner: s.partner ?? "—",
        mode,
        trackingNumber: s.tracking_number,
        status: s.status ?? "—",
        itemCategory: s.item_category,
        description: s.description,
        dispatchedAt: s.dispatched_at,
        deliveredAt: s.delivered_at,
        carrierEventCount: carrier.length,
        events: dedupedEvents,
      };
    }),
    studentName: o.customer_name,
    enrollment: o.enrollment,
    categoryGroups,
    pollPending,
  };
}

/**
 * Local-DB fallback for the order detail page. Used when the order was
 * placed via shop checkout but hasn't been mirrored into the `erp.*`
 * tables yet (e.g. a fresh CCAvenue payment on a stack with no live ERP
 * sync). Looks up by either UUID or order_number, always scoped to the
 * current parent so cross-parent access is impossible.
 */
export async function getParentOrderDetailLocal(
  parentId: string,
  idOrOrderNumber: string
): Promise<ParentOrderDetail | null> {
  const isUuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      idOrOrderNumber
    );
  const matcher = isUuid
    ? eq(orders.id, idOrOrderNumber)
    : eq(orders.orderNumber, idOrOrderNumber);

  const [o] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.parentId, parentId), matcher))
    .limit(1);
  if (!o) return null;

  const lines = await db
    .select()
    .from(orderItems)
    .where(eq(orderItems.orderId, o.id));

  const [pay] = await db
    .select()
    .from(payments)
    .where(eq(payments.orderId, o.id))
    .limit(1);

  let studentName: string | null = null;
  let enrollment: string | null = null;
  if (o.studentId) {
    const [s] = await db
      .select({
        name: students.name,
        enrollmentNumber: students.enrollmentNumber,
      })
      .from(students)
      .where(eq(students.id, o.studentId))
      .limit(1);
    if (s) {
      studentName = s.name ?? null;
      enrollment = s.enrollmentNumber ?? null;
    }
  }

  const addr = (o.shippingAddress ?? {}) as Record<string, string | undefined>;

  // Multi-axis attribute enrichment, same as the ERP-path branch above.
  const localBundleVariantIds: string[] = [];
  for (const l of lines) {
    const bs = l.bundleSelections as
      | { variantId?: string }[]
      | null
      | undefined;
    if (Array.isArray(bs)) {
      for (const s of bs) if (s.variantId) localBundleVariantIds.push(s.variantId);
    }
  }
  const localAttrsByVariant = await attrsByVariantId(
    Array.from(new Set(localBundleVariantIds))
  );

  // Category-wise tracking for the local fallback. order_items here has
  // variant_id directly, so we can resolve sku → category in one shot
  // via product_variants → products.
  const variantIds = Array.from(
    new Set(
      lines.map((l) => l.variantId).filter((v): v is string => !!v)
    )
  );
  const variantMeta = await (async () => {
    const map = new Map<string, { sku: string | null; categoryId: string | null }>();
    if (variantIds.length === 0) return map;
    const r: any = await db.execute(sql`
      SELECT pv.id::text AS id, pv.sku, p.category_id::text AS category_id
        FROM product_variants pv
        LEFT JOIN products p ON p.id = pv.product_id
       WHERE pv.id IN (${sql.join(
         variantIds.map((v) => sql`${v}`),
         sql`, `
       )})
    `);
    const rs = (r?.rows ?? r ?? []) as Array<{
      id: string;
      sku: string | null;
      category_id: string | null;
    }>;
    for (const row of rs) {
      map.set(row.id, { sku: row.sku ?? null, categoryId: row.category_id ?? null });
    }
    return map;
  })();
  const qtysByCode = o.erpSoName
    ? await dispatchQtysByItemCode(o.erpSoName)
    : new Map<
        string,
        {
          deliveredQty: number;
          pickedQty: number;
          returnedQty: number;
          erpCategory: string | null;
        }
      >();
  // Local-only branch: no ERP shipment rows to map by category, so we
  // keep the order-level enum. (When ERP catches up, the call switches
  // to getParentOrderDetailFromErpMirror with per-category data.)
  const fallback: "delivered" | "in_transit" | "none" = o.deliveredAt
    ? "delivered"
    : o.shippedAt
      ? "in_transit"
      : "none";
  const categoryGroups = await groupItemsByRootCategory(
    lines.map((l) => {
      const meta = l.variantId ? variantMeta.get(l.variantId) : undefined;
      const qtys = (meta?.sku && qtysByCode.get(meta.sku)) || {
        deliveredQty: 0,
        pickedQty: 0,
        returnedQty: 0,
        erpCategory: null as string | null,
      };
      return {
        id: l.id,
        name: l.nameSnapshot ?? "Item",
        qty: l.qty ?? 0,
        categoryId: meta?.categoryId ?? null,
        deliveredQty: qtys.deliveredQty,
        pickedQty: qtys.pickedQty,
        returnedQty: qtys.returnedQty,
        erpCategory: qtys.erpCategory,
      };
    }),
    fallback
  );
  const pollPending =
    !o.erpLastPolledAt &&
    !!o.createdAt &&
    Date.now() - new Date(o.createdAt).getTime() < 10 * 60_000;

  return {
    id: o.id,
    orderNumber: o.orderNumber,
    status: o.status,
    paymentStatus: o.paymentStatus,
    // Local rows store paise (×100) — convert to rupees for the UI.
    subtotal: Math.round((o.subtotal ?? 0) / 100),
    tax: Math.round((o.tax ?? 0) / 100),
    shipping: Math.round((o.shipping ?? 0) / 100),
    discount: Math.round((o.discount ?? 0) / 100),
    total: Math.round((o.total ?? 0) / 100),
    shippingAddress: {
      receiverName: addr.receiverName ?? "",
      receiverPhone: addr.receiverPhone ?? "",
      line1: addr.line1 ?? "",
      line2: addr.line2,
      city: addr.city ?? "",
      state: addr.state ?? "",
      pincode: addr.pincode ?? "",
    },
    placedAt: o.placedAt ? o.placedAt.toISOString() : null,
    confirmedAt: o.confirmedAt ? o.confirmedAt.toISOString() : null,
    shippedAt: o.shippedAt ? o.shippedAt.toISOString() : null,
    deliveredAt: o.deliveredAt ? o.deliveredAt.toISOString() : null,
    createdAt: o.createdAt.toISOString(),
    items: lines.map((l) => ({
      id: l.id,
      name: l.nameSnapshot,
      size: l.size,
      qty: l.qty,
      unitPrice: Math.round((l.unitPrice ?? 0) / 100),
      total: Math.round((l.total ?? 0) / 100),
      imageUrl: l.imageSnapshot ?? "",
      // bundle_selections is JSONB; we accept whatever was written at
      // checkout. The TS cast narrows it to the shape our UI expects;
      // the persisted shape is enforced by app/api/cart Zod schema.
      bundleSelections: ((l.bundleSelections as
        | {
            componentProductId: string;
            name: string;
            qty: number;
            variantId: string;
            size: string;
          }[]
        | null
        | undefined) ?? null)?.map((s) => ({
        ...s,
        attributes: localAttrsByVariant.get(s.variantId) ?? [],
      })) ?? null,
    })),
    payment: pay
      ? {
          provider: pay.provider,
          status: pay.status,
          method: pay.method ?? pay.paymentMode ?? null,
        }
      : null,
    tracking: [],
    shipmentHistory: [],
    studentName,
    enrollment,
    categoryGroups,
    pollPending,
  };
}
