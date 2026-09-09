# Inventre × ERP Staging Integration

End-to-end deploy + integration notes from the 2026-05-24 session.

---

## 1. What got built

A bidirectional bridge between the **Inventre storefront** and the **ERP backend** so that:

- A parent checks out on `https://test.inventre.in`
- The order pushes to the ERP at `https://erp-test.inventre.in`
- ERP packs / seals / dispatches the order
- Status flows back to the storefront within ~15 seconds

```
┌──────────────────────────┐                            ┌──────────────────────────┐
│ Inventre (Server A)      │                            │ ERP (Server B)           │
│ 147.93.152.216           │  ┌─────────────────────┐   │ 217.216.58.218           │
│ test.inventre.in         │  │ HTTPS + HMAC sig    │   │ erp-test.inventre.in     │
│                          │──▶│ /api/ecom/ingest    │──▶│ FastAPI backend          │
│ Next.js 15 + Postgres    │  └─────────────────────┘   │ Postgres + dashboard UI  │
│                          │                            │                          │
│                          │  ┌─────────────────────┐   │                          │
│                          │◀─│ JWT auth + GETs     │◀──│                          │
│                          │  │ /api/orders/{name}  │   │                          │
│                          │  │ /api/outward/...    │   │                          │
│                          │  │ /api/warehouse/...  │   │                          │
│                          │  └─────────────────────┘   │                          │
└──────────────────────────┘                            └──────────────────────────┘
```

Two cron loops on Server A keep the systems in sync:

| Cron | Cadence | Purpose |
|---|---|---|
| `erp-drain` | 30 s | Push new local orders to ERP `/api/ecom/ingest` |
| `erp-poll`  | 15 s | Pull status updates from ERP, refresh mirror tables |

---

## 2. Architecture: deploy model

### 2.1 Inventre (Server A)

**Image-baked Docker deploy.** No more `npm run build + docker cp` shuffles.

- `Dockerfile` (multi-stage alpine, BuildKit cache mounts): cold build ~6 min, warm ~90 s
- `docker-compose.deploy.yml`: `build: .` + `image: inventre-app:latest`
- Every build tags the image as `inventre-app:<git-sha>` AND `inventre-app:latest`
- Rollback = `docker tag inventre-app:<old-sha> inventre-app:latest && docker compose up -d --no-deps app`

Deploy script: **`/tmp/docker_build_deploy.sh`** on Server A:

```bash
cd /root/Inventre
GIT_SHA=$(git rev-parse --short=10 HEAD)
DOCKER_BUILDKIT=1 docker build \
  --build-arg NEXT_PUBLIC_APP_URL=https://test.inventre.in \
  -t inventre-app:${GIT_SHA} -t inventre-app:latest .
docker compose -p inventre-deploy -f docker-compose.deploy.yml up -d --no-deps app
```

Compose services on Server A (`inventre-deploy` project):
- `inventre-deploy-postgres` (16-alpine, port `:55433`)
- `inventre-deploy-pgbouncer` (port `:6433`)
- `inventre-deploy-redis` (port `:6390`)
- `inventre-deploy-app` (built image, port `:3010` → nginx → `https://test.inventre.in`)

### 2.2 ERP (Server B)

Pre-existing FastAPI + Postgres stack. Added one new module + appended one router:

- `app/ecom_integration/` — HMAC-signed ingest router (already grafted)
- `app/routers/warehouse_packing.py` — restored from `.bak` after I had appended a duplicate `/packing-units` endpoint (the proper one already exists in `warehouse_dispatch.py`)

Public hostname: `erp-test.inventre.in` (Let's Encrypt cert, nginx vhost). Frontend dashboard + API both served from this host (nginx routes `/api/*`, `/docs*`, `/healthz` → FastAPI on `:8011`; everything else → Vite dashboard on `:3011`).

---

## 3. Data flow

### 3.1 Outbound: storefront → ERP

```
┌─────────────┐  ┌──────────────────┐  ┌─────────────────┐  ┌──────────────┐
│ /shop/      │  │ ccavenue         │  │ orders +        │  │ erp_outbound │
│ checkout    │─▶│ callback         │─▶│ payments tables │─▶│ _queue       │
│             │  │ (HMAC verified)  │  │                 │  │ (180s buffer)│
└─────────────┘  └──────────────────┘  └─────────────────┘  └──────────────┘
                                                                    │
                              ┌──────────────────────────────────────┘
                              ▼
                       ┌──────────────────┐  HTTPS + HMAC   ┌───────────────────┐
                       │ erp-drain cron   │────────────────▶│ ERP               │
                       │ (every 30s)      │                 │ /api/ecom/ingest  │
                       │ postErpEvent()   │                 │ → sales_orders    │
                       └──────────────────┘                 └───────────────────┘
                                                                    │
                                                                    ▼
                                                            { erp_name: "SAL-ORD-..." }
                                                                    │
                       ┌──────────────────┐                         │
                       │ drainOutbound    │◀────────────────────────┘
                       │ Queue() pins     │
                       │ erp_so_name +    │
                       │ order_number     │
                       └──────────────────┘
```

Key files:
- `lib/erp-bridge.ts` — `postErpEvent()`: signs envelope, POSTs, parses `{erp_name}` response
- `lib/erp-drain.ts` — `drainOutboundQueue()`: pulls queue rows, calls `postErpEvent`, pins `erp_so_name` AND `order_number` to ERP's response (so the two numbers never drift)
- `app/api/cron/erp-drain/route.ts` — bearer-token-protected cron entry point

### 3.2 Inbound: ERP → storefront

```
┌──────────────────┐  JWT auth   ┌────────────────────────────────────────┐
│ erp-poll cron    │────────────▶│ GET /api/orders/{name}                 │
│ (every 15s)      │            │   → { header, items, sub_items, ... }   │
│                  │             │ GET /api/outward/shipments?order=...   │
│ pollOpenOrders() │             │ GET /api/warehouse/packing-units?...   │
└──────────────────┘             └────────────────────────────────────────┘
        │                                              │
        ▼                                              ▼
┌────────────────────────────────────────────────────────────┐
│ Mirror tables on Inventre's Postgres (erp.* schema):       │
│   • erp.sales_orders          ← upsertOrderMirror(header)  │
│   • erp.sales_order_items     ← upsertItemsMirror(items)   │
│   • erp.packing_units         ← upsertPackingUnitsMirror() │
│   • erp.outward_shipments     ← upsertShipmentMirror()     │
└────────────────────────────────────────────────────────────┘
        │
        ▼
┌────────────────────────────────────────────────────────────┐
│ deriveLocalOrderStatus():                                  │
│   shipments.delivered → "delivered"                        │
│   shipments.shipped   → "shipped"                          │
│   packing_units.dispatched → "shipped"                     │
│   packing_units.sealed     → "packed"                      │
│   → UPDATE orders.status / shipped_at / delivered_at       │
└────────────────────────────────────────────────────────────┘
```

Key files:
- `lib/erp-poll.ts` — `pollOpenOrders()` + upsert helpers + `deriveLocalOrderStatus()`
- `lib/erp-jwt.ts` — caches bearer token from `POST /api/auth/login` (form-urlencoded)
- `app/api/cron/erp-poll/route.ts` — bearer-token-protected cron entry point

### 3.3 Customer "My Orders"

`/api/orders` → `listParentOrdersFromErp(parentId)` reads from a CTE that **UNIONs**:
1. **Local `orders`** for `parent_id = me` (shows brand-new orders instantly, no drain wait)
2. **Mirror `erp.sales_orders`** matched by `right(contact_mobile, 10) = parent.phone` (legacy + safety net)

Dedup by `order_no` (DISTINCT ON, local takes precedence). Status falls back to `orders.status` when ERP has no signal yet. Student name comes from `orders.shipping_address->>'receiverName'` (the ERP-side `customer_name` is the customer code, e.g. `CUST-CUST-2026-00001`, not the student).

Order **detail** page (`/api/orders/[id]`) already has the right fallback chain: `getParentOrderDetailFromErp ?? getParentOrderDetailLocal`. Shipping address always reads from local `orders.shipping_address` jsonb (ERP doesn't expose it via `/api/orders/{name}`).

---

## 4. The 8 fixes that landed today

| # | File | Why |
|---|---|---|
| 1 | `app/api/checkout/ccavenue/callback/route.ts` | After CCAvenue postback, redirect was going to `http://localhost:3000/...` because `NEXT_PUBLIC_APP_URL` was build-time-baked. Now reads `APP_PUBLIC_URL` env at runtime + falls back to `X-Forwarded-Host`. |
| 2 | `lib/erp-bridge.ts` | `postErpEvent()` now extracts `erp_name` from the ingest response so the drainer can pin it. |
| 3 | `lib/erp-drain.ts` | On successful drain: `UPDATE orders SET erp_so_name = X, order_number = X` (ERP is canonical, both fields converge within ~30s). |
| 4 | `lib/erp-poll.ts` (mirror upsert) | Original upsert wrote `updated_at` (column doesn't exist; it's `synced_at`) AND missed NOT-NULL columns + `contact_mobile`. Rewritten to match the real `erp.sales_orders` schema with all required columns. |
| 5 | `lib/erp-poll.ts` (response shape) | ERP returns `{ header, items, sub_items, ... }`, not flat. Now reads `order.header.name` instead of `order.erp_name`. |
| 6 | `lib/erp-poll.ts` (items + packing) | Added `upsertItemsMirror()` and `upsertPackingUnitsMirror()`. Items come from `order.items`; packing units from `GET /api/warehouse/packing-units?order_erp_name=X` (existing ERP endpoint, returns `{ items: [...] }`). |
| 7 | `lib/erp-poll.ts` + `lib/erp-customer-orders.ts` (status derivation) | A `dispatched` packing unit → "shipped" (not just sealed → "packed"). Both list query and detail query updated. |
| 8 | `lib/erp-customer-orders.ts` (instant listing) | List now UNIONs local `orders WHERE parent_id` with the mirror, deduped by order_no. New orders appear in /shop/orders the moment they're paid — no 3-4 min drain+poll wait. |
| 9 | `Dockerfile` deploy switchover | Compose was running `image: node:20-slim` with manual `docker cp` of build artifacts. Switched to baked `inventre-app:<sha>` image. The Dockerfile was already there — just wasn't being used. |

Also touched on ERP side (one-time, restored):
- Appended `/api/warehouse/packing-units` endpoint then restored from `.bak` once I realized `warehouse_dispatch.py` already had the proper one with `order_erp_name=` + `status=` + `limit=` query params.

---

## 5. Environment configuration

### 5.1 Server A (`/root/Inventre/.env.deploy`)

```env
ERP_TARGET=staging
APP_PUBLIC_URL=https://test.inventre.in

CRON_TOKEN=<long random>          # protects /api/cron/* endpoints
ECOM_WEBHOOK_SECRET=<shared with ERP's ECOM_WEBHOOK_SECRET>

# CCAvenue (test merchant 4314398, callback whitelisted)
CCAVENUE_MERCHANT_ID=4314398
CCAVENUE_ACCESS_CODE=ATWI06NE99BY49IWYB
CCAVENUE_WORKING_KEY=60C997D2485E9DC821AE9CEADCAABA74
CCAVENUE_API_BASE=https://test.ccavenue.com
CCAVENUE_REDIRECT_URL=https://test.inventre.in/api/checkout/ccavenue/callback
CCAVENUE_CANCEL_URL=https://test.inventre.in/shop/checkout?status=cancelled

# Staging ERP bridge target
STAGING_ERP_API_BASE_URL=https://erp-test.inventre.in
STAGING_ERP_INGEST_URL=https://erp-test.inventre.in/api/ecom/ingest
STAGING_ERP_WEBHOOK_SECRET=<must equal ERP's ECOM_WEBHOOK_SECRET>
STAGING_ERP_POLL_USER=admin
STAGING_ERP_POLL_PASS=Admin#123

# Prod ERP target (unused until ERP_TARGET=prod)
PROD_ERP_INGEST_URL=https://audit.inventre.in/api/ecom/ingest
PROD_ERP_API_BASE_URL=https://audit.inventre.in
PROD_ERP_WEBHOOK_SECRET=
PROD_ERP_POLL_USER=
PROD_ERP_POLL_PASS=
```

**Cutover to prod:** edit four `PROD_ERP_*` lines + flip `ERP_TARGET=prod` + `docker compose ... up -d app`. No code change required.

### 5.2 Server B (`docker-compose.yml`)

Forwards `ECOM_*` env vars into the FastAPI container:

```yaml
backend:
  environment:
    ECOM_WEBHOOK_SECRET: <must equal STAGING_ERP_WEBHOOK_SECRET>
    ECOM_INTEGRATION_ENABLED: "1"
```

### 5.3 Cron (`/etc/cron.d/inventre-erp`)

```cron
CRON_TOKEN=<same as .env.deploy>

# Drain — every 30s
*/1 * * * * root  curl -fsS -m 30 -X POST -H "Authorization: Bearer $CRON_TOKEN" http://127.0.0.1:3010/api/cron/erp-drain >> /var/log/inventre-erp-drain.log 2>&1
*/1 * * * * root  sleep 30; curl ... erp-drain ...

# Poll — every 15s (4× per minute)
*/1 * * * * root             curl ... erp-poll ...
*/1 * * * * root  sleep 15;  curl ... erp-poll ...
*/1 * * * * root  sleep 30;  curl ... erp-poll ...
*/1 * * * * root  sleep 45;  curl ... erp-poll ...
```

---

## 6. Operating notes

### 6.1 Force a drain / poll right now

```bash
TOKEN=$(grep ^CRON_TOKEN= /root/Inventre/.env.deploy | cut -d= -f2)
curl -X POST -H "Authorization: Bearer $TOKEN" http://127.0.0.1:3010/api/cron/erp-drain
curl -X POST -H "Authorization: Bearer $TOKEN" http://127.0.0.1:3010/api/cron/erp-poll
```

To re-poll a single order:

```sql
UPDATE orders SET erp_last_polled_at = NULL WHERE erp_so_name = 'SAL-ORD-2026-XXXXX';
-- then force the poll above
```

### 6.2 Inspect mirror state for an order

```sql
-- on Server A's inventre-deploy-postgres
SELECT * FROM orders WHERE order_number = 'SAL-ORD-2026-XXXXX';
SELECT * FROM erp.sales_orders WHERE erp_name = 'SAL-ORD-2026-XXXXX';
SELECT * FROM erp.sales_order_items WHERE order_erp_name = 'SAL-ORD-2026-XXXXX';
SELECT * FROM erp.packing_units WHERE order_erp_name = 'SAL-ORD-2026-XXXXX';
SELECT * FROM erp_outbound_queue WHERE order_id = (SELECT id FROM orders WHERE order_number = 'SAL-ORD-2026-XXXXX');
```

### 6.3 Delete a test order from both DBs

Inventre:
```sql
BEGIN;
DELETE FROM erp_outbound_queue WHERE order_id = '<uuid>';
DELETE FROM order_items        WHERE order_id = '<uuid>';
DELETE FROM payments           WHERE order_id = '<uuid>';
DELETE FROM orders             WHERE id       = '<uuid>';
COMMIT;
```

ERP:
```sql
BEGIN;
DELETE FROM sales_order_items WHERE order_erp_name = 'SAL-ORD-2026-XXXXX';
DELETE FROM sales_order_sub_items WHERE order_erp_name = 'SAL-ORD-2026-XXXXX';
DELETE FROM sales_order_payment_schedule WHERE order_erp_name = 'SAL-ORD-2026-XXXXX';
DELETE FROM ecom_ingest_log WHERE erp_name = 'SAL-ORD-2026-XXXXX';
DELETE FROM sales_orders WHERE erp_name = 'SAL-ORD-2026-XXXXX';
COMMIT;
```

### 6.4 Mirror sequence sanity

If the publisher ever wrote rows with explicit `id`, the `nextval` on the sequence can lag behind `max(id)`. If you see `duplicate key value violates unique constraint "..._pkey"` in the poll logs:

```sql
SELECT setval('erp.sales_order_items_id_seq', 200000),
       setval('erp.outward_shipments_id_seq', 200000),
       setval('erp.packing_units_id_seq',     200000);
```

---

## 7. End-to-end timing today

| Event | Latency to customer-visible |
|---|---|
| Order placed + payment succeeds | **instant** (local UNION serves it) |
| Order pushed to ERP | ~30 s (drain cron) |
| Order number unified across systems | within the drain (~30 s) |
| ERP packed → /shop/orders shows "Packed" | ~15 s (poll cron) |
| ERP dispatched → "Shipped" | ~15 s |
| ERP delivered → "Delivered" | ~15 s |

---

## 8. Known issues left

1. **`customer_name` ingest bug** — Inventre pushes `customer_name` = customer code (`CUST-CUST-2026-00001`) instead of the actual student name. Bypassed in the listing query (we read `shipping_address->>'receiverName'` locally) but should be fixed in `lib/erp-bridge.ts` ingest payload so the ERP dashboard also shows a human name.
2. **`outward_shipments` qty defaults to 1** — ERP's response doesn't surface line counts; we default to 1 to satisfy NOT NULL. Cosmetic — the dashboard won't show accurate per-shipment quantity until ERP fixes its payload.
3. **`erp.customers.custom_enrollment_number`** — never populated for ecom customers (the poll doesn't currently mirror customer master). UI shows blank enrollment for storefront-placed orders.
4. **`shipping_address` not pushed to ERP** — Inventre captures it in `orders.shipping_address`, but the ingest envelope doesn't include it, so ERP can't print shipping labels with the parent's chosen address. Should be added to the ingest payload + accepted by `ecom_ingest.py`.

---

## 9. Quick-reference: who lives where

| Thing | Server A (147.93.152.216) | Server B (217.216.58.218) | This dev box |
|---|---|---|---|
| Inventre storefront | ✓ test.inventre.in | | |
| Inventre Postgres | ✓ port 55433 | | |
| ERP backend | | ✓ erp-test.inventre.in /api | |
| ERP frontend | | ✓ erp-test.inventre.in / | |
| ERP Postgres | | ✓ `erp-new-with-api-db-1` | |
| Source of truth code | ✓ /root/Inventre | | ✓ /root/Inventre |
| Docker image registry | local only (no registry) | local only | — |

When you cut over to real prod, the only additions are:
- Push images to a registry (GHCR / ECR / etc.) instead of building on the prod box
- Set `ERP_TARGET=prod` + the four `PROD_ERP_*` env values
- Point DNS for the customer-facing hostname at the prod box
