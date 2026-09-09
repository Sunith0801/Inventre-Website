# Inventre — Production Architecture & Admin Plan

## Part 1 — Constraints

- **Production target:** Hetzner bare metal (already provisioned)
- **Concurrency target:** 20,000 active users at peak
- **Local dev must mirror prod** so we don't ship surprises
- **Two distinct user populations:** Parents (consumer) + Inventre/School staff (admin)
- **Indian-first:** ₹ pricing, +91 OTP, GST, Razorpay payments

---

## Part 2 — Stack (final, opinionated)

| Layer | Choice | Why |
|---|---|---|
| **Frontend + API** | Next.js 15 App Router | Already built. Server Components + Route Handlers cover all backend needs. No separate Express. |
| **Database** | **Postgres 16** | Same DB Supabase uses. Mature, free, scales horizontally. |
| **Connection pooling** | **PgBouncer** | Critical for 20K concurrent. Postgres alone caps at ~100 connections; PgBouncer multiplexes to 10K+. |
| **ORM** | **Drizzle** | Type-safe, transparent SQL, lightweight. Better than Prisma for high-throughput. |
| **Auth** | **Better Auth** + **MSG91 OTP** | Modern, owned, phone-OTP first. JWT + httpOnly cookies. |
| **Cache + sessions + queues** | **Redis 7** | Cache hot data, rate-limit OTP, session blacklist, BullMQ jobs. |
| **File storage** | **MinIO** (S3-compatible) on Hetzner | Same SDK as AWS S3 — easy to swap later if needed. |
| **CDN** | **Cloudflare** (free tier) | Edge caching of images/videos. WAF + DDoS + rate-limit at the edge. |
| **Reverse proxy** | **Caddy** | Auto SSL, simpler than nginx, great for Docker. |
| **Container orchestration** | **Docker Compose** locally → **Coolify** on prod | Same Compose definitions both places. Coolify gives Vercel-like UX without lock-in. |
| **Background jobs** | **BullMQ** (Redis-backed) | Send OTP, send order SMS, image resize, daily reports. |
| **Search** (later) | **Postgres `pg_trgm`** initially → Meilisearch if needed | Don't reach for Elasticsearch until you have to. |
| **Email** | **Resend** | Free tier covers transactional volume. |
| **SMS** | **MSG91** | Indian, ₹0.18/SMS, OTP templates pre-approved. |
| **Payments** | **Razorpay** | Indian, supports UPI/cards/netbanking, 2% per txn. |
| **Monitoring** | **Uptime Kuma** + **Plausible** + **Sentry** | All self-hostable except Sentry (use free tier). |
| **Backups** | `pg_dump` cron → Hetzner Storage Box | €3/month for 1TB cold storage of DB dumps. |

---

## Part 3 — Architecture for 20K Concurrent

### Single bare-metal Hetzner box can do this **if we cache aggressively**. Designed for that with room to scale horizontally later.

```
                                     INTERNET
                                         │
                                         ▼
                          ┌──────────────────────────────┐
                          │   CLOUDFLARE                 │
                          │  - Edge caching (img/video)  │
                          │  - WAF + DDoS                │
                          │  - Rate limit per IP/phone   │
                          │  - HTTP/3, Brotli            │
                          └──────────────┬───────────────┘
                                         │
                                         ▼
                          ┌──────────────────────────────┐
                          │   CADDY (reverse proxy)      │
                          │  - SSL via Let's Encrypt     │
                          │  - Health checks             │
                          │  - Round-robin to N replicas │
                          └──────────────┬───────────────┘
                ┌────────────────────────┼────────────────────────┐
                │                        │                        │
                ▼                        ▼                        ▼
       ┌────────────────┐       ┌────────────────┐       ┌────────────────┐
       │  Next.js #1    │       │  Next.js #2    │       │  Next.js #3    │
       │  (Docker)      │       │  (Docker)      │       │  (Docker)      │
       │  Server Comp.  │       │                │       │                │
       │  Route Handlrs │       │                │       │                │
       │  Server Actions│       │                │       │                │
       └────────┬───────┘       └────────┬───────┘       └────────┬───────┘
                │                        │                        │
                └────────────────────────┼────────────────────────┘
                                         │
                            ┌────────────┴────────────┐
                            ▼                         ▼
                  ┌───────────────────┐     ┌───────────────────┐
                  │  REDIS            │     │  PGBOUNCER        │
                  │  - hot cache      │     │  (transaction     │
                  │  - sessions       │     │   pooling)        │
                  │  - rate limit     │     │                   │
                  │  - BullMQ queue   │     │                   │
                  └─────────┬─────────┘     └─────────┬─────────┘
                            │                         │
                            ▼                         ▼
                  ┌───────────────────┐     ┌───────────────────┐
                  │  WORKER (Bull)    │     │  POSTGRES 16      │
                  │  - SMS dispatch   │◄────│  primary          │
                  │  - email          │     │  + read replica   │
                  │  - image resize   │     └───────────────────┘
                  │  - order webhook  │
                  └───────────────────┘
                                         ┌───────────────────┐
                                         │  MINIO            │
                                         │  - product images │
                                         │  - school assets  │
                                         │  - hero videos    │
                                         └───────────────────┘
```

### The 20K concurrent math

Assume peak = term-start day (1st June). Worst-case mix:

- **80% browsing** (homepage + shop) — fully cached at Cloudflare/Redis. **Near-zero DB load.**
- **15% interacting with cart/PDP** — light DB reads. Cache product detail aggressively.
- **5% checkout** — real DB writes. Critical path.

That means real backend pressure is **~1,000 concurrent writes**, not 20K. Postgres handles that easily with pgbouncer.

### Specific scaling tactics

1. **Cache layers (most important)**
   - **Cloudflare edge:** all `/`, `/login`, product images, hero videos — `Cache-Control: public, max-age=600, s-maxage=86400, stale-while-revalidate=31536000`
   - **Next.js ISR/PPR:** product detail pages pre-rendered, revalidate every 5 min on update
   - **Redis hot cache:** product list per school (TTL 5 min), category tree (TTL 1 hr), homepage content (TTL 10 min). Invalidate on admin write.
   - **Browser cache:** hashed assets `immutable`

2. **Database**
   - PgBouncer transaction pool, ~100 backends serving 10K+ clients
   - Indexes: `(parent_phone)`, `(school_id, status)` on orders, `(school_id)` on students, GIN on `category_path`, B-tree on `product.slug`
   - Read replica for analytics queries (admin dashboards)
   - `EXPLAIN ANALYZE` discipline — every query under 50ms or it gets fixed
   - Partitioned tables for `orders` and `audit_log` by month after they pass 1M rows

3. **Server-side**
   - Next.js `output: 'standalone'` Docker build — minimal images
   - 3 replicas behind Caddy LB (auto-failover)
   - BullMQ workers in separate containers (don't block API)

4. **Authentication**
   - JWT (httpOnly cookie, 7-day) — **stateless**, no DB lookup per request
   - Refresh tokens in Redis with sliding expiry
   - Rate-limit OTP: 3/10min/phone, 10/day/phone, 100/IP/hour

5. **Static assets**
   - All images go through `next/image` → WebP/AVIF, multiple sizes, Cloudflare-cached
   - Hero videos pre-encoded into 480p/720p/1080p HLS variants
   - One `<video>` tag does adaptive bitrate

6. **Real-time updates**
   - SSE (`/api/admin/orders/stream`) for order list live updates — much lighter than WebSocket
   - Pub/sub via Redis when order state changes

7. **Backpressure / graceful degradation**
   - If Redis goes down: fall through to Postgres (slower but works)
   - If MSG91 fails: queue OTP retries with exponential backoff
   - If Razorpay fails: order saved as `payment_pending`, parent sees retry CTA

---

## Part 4 — Local Dev = Production Parity

One `docker-compose.yml` runs locally that exactly mirrors prod. Same images, same network, same env structure.

```yaml
# docker-compose.yml (illustrative)
services:
  postgres:
    image: postgres:16-alpine
    volumes: [pgdata:/var/lib/postgresql/data]
  pgbouncer:
    image: edoburu/pgbouncer
    depends_on: [postgres]
  redis:
    image: redis:7-alpine
    volumes: [redisdata:/data]
  minio:
    image: minio/minio
    command: server /data --console-address ":9001"
    volumes: [miniodata:/data]
  app:
    build: .
    depends_on: [pgbouncer, redis, minio]
    environment:
      DATABASE_URL: postgres://user:pass@pgbouncer:6432/inventre
      REDIS_URL: redis://redis:6379
      S3_ENDPOINT: http://minio:9000
  worker:
    build: .
    command: node dist/worker.js
    depends_on: [redis, postgres]
  caddy:
    image: caddy:alpine
    ports: ["80:80", "443:443"]
    volumes: [./Caddyfile:/etc/caddy/Caddyfile]
```

You run `docker-compose up` locally → identical containers run on Hetzner via Coolify. **Zero "works on my machine" bugs.**

---

## Part 5 — Data Model

Tables grouped by concern. All `id` are UUIDs unless noted.

### Identity

```
users                  ← admins only (Inventre staff + school admins)
  id, email, password_hash, role (super|ops|school_admin), school_id (nullable),
  status, last_login_at, created_at

parents                ← consumers
  id, phone (unique), name, email, password_hash (nullable),
  status (active|blocked), created_at

students
  id, parent_id, school_id, name, class, section, enrollment_number,
  size_overrides (jsonb), avatar_url, status, created_at
  -- one parent → many students (siblings)

sessions               ← refresh tokens, can be revoked
  id, subject_id (parent or user), kind, expires_at, ip, ua, created_at
```

### Catalog

```
schools
  id, slug, name, logo_url, banner_url, city, state, status,
  house_colors (jsonb), contact_email, contact_phone,
  approved_at, created_at

categories             ← hierarchical tree, materialized path
  id, parent_id, slug, name, sort_order, path (ltree)

products               ← master catalog
  id, slug, name, description (jsonb), tagline,
  category_id, base_price, base_mrp, status,
  specs (jsonb), size_table (jsonb), created_at

product_school         ← which schools sell which products + overrides
  id, product_id, school_id, override_price, is_required,
  custom_image_url (with school crest applied), unique(product_id, school_id)

product_variants       ← per-size SKUs
  id, product_id, size, sku, stock_qty, low_stock_threshold

product_images
  id, product_id, url, alt, sort_order

product_badges
  id, product_id, badge (NEW|BESTSELLER|LOW_STOCK), expires_at
```

### Commerce

```
carts                  ← Redis-backed for hot, Postgres mirror for persistence
  id, parent_id, student_id, expires_at, updated_at

cart_items
  id, cart_id, variant_id, qty, added_at

orders
  id, order_number (human, e.g. INV-2026-0042),
  parent_id, student_id, school_id,
  status, payment_status,
  subtotal, tax, shipping, discount, total,
  shipping_address (jsonb), notes,
  placed_at, confirmed_at, packed_at, shipped_at, delivered_at,
  created_at

order_items
  id, order_id, variant_id, name_snapshot, qty,
  unit_price, total

shipments
  id, order_id, courier, tracking_number, status, shipped_at, delivered_at

returns
  id, order_id, item_ids (array), reason, photos (array),
  status (requested|approved|received|refunded|rejected),
  refund_amount, created_at

payments
  id, order_id, provider (razorpay), provider_payment_id,
  amount, status, method, created_at

coupons
  id, code, type (percent|flat), value, min_order,
  valid_from, valid_to, max_uses, used_count, school_id (nullable)

coupon_redemptions
  id, coupon_id, order_id, parent_id, redeemed_at
```

### Engagement

```
reviews
  id, product_id, parent_id, student_id, order_id,
  rating, body, status (pending|approved|rejected),
  verified_purchase, created_at

wishlists
  id, parent_id, student_id, variant_id, created_at

testimonials
  id, school_id, principal_name, role, quote,
  photo_url, is_featured, sort_order

faqs
  id, question, answer, category, sort_order, is_active
```

### CMS / Content

```
content_blocks         ← editable homepage sections
  id, key (e.g. 'home.hero', 'home.in_the_wild'),
  data (jsonb — full section payload),
  updated_by, updated_at

media
  id, url, alt, kind (image|video|pdf), size, mime,
  uploaded_by, created_at
```

### Ops

```
audit_log              ← every admin action
  id, user_id, action (e.g. 'product.update'),
  entity_type, entity_id, before (jsonb), after (jsonb),
  ip, ua, created_at

webhooks_outbound
  id, event, payload (jsonb), target_url, status, retry_count, last_at

system_settings
  key, value (jsonb)   -- e.g. shipping rules, tax %, free-shipping threshold
```

### Multi-tenancy enforcement

Every query that touches school-scoped data goes through a **TenantScope** middleware. School admins are auto-filtered to `school_id = user.school_id`. Inventre superadmin sees everything. Parents see only their own data via JWT subject.

### Indexes

```
parents(phone)                 unique, btree
students(parent_id)            btree
students(school_id, status)    btree
products(slug)                 unique, btree
products(category_id)          btree
product_school(school_id)      btree
product_variants(product_id)   btree
orders(parent_id)              btree
orders(school_id, status)      btree
orders(created_at desc)        brin
reviews(product_id, status)    btree
audit_log(created_at desc)     brin
```

---

## Part 6 — Complete Admin Panel Plan

Full inventory of every editable thing, mapped to the public pages we built.

### Auth & access

`/admin/login` — separate from parent login. Email + password only (admins are Inventre staff or school principals, not phone-OTP users).

Three roles:

- **super** (Inventre superadmin) — everything
- **ops** (Inventre ops team) — orders, returns, fulfillment, no settings/billing
- **school_admin** (principal/coordinator at a partner school) — only their school's students, orders, can request product additions

### `/admin` page tree

```
/admin
├── /login
├── /dashboard                    ← KPIs, recent orders, low-stock alerts
│
├── /schools/                     [super only]
│   ├── (list)                    filters: status, city
│   ├── /new
│   ├── /[id]/overview            stats, contact, branding
│   ├── /[id]/edit                logo, banner, colors, status
│   ├── /[id]/products            catalog assignment + price overrides
│   ├── /[id]/students            roster
│   └── /[id]/admins              add school_admin user accounts
│
├── /catalog/                     [super]
│   ├── /products
│   │   ├── (list)                filters: category, school, status, stock
│   │   ├── /new
│   │   ├── /[id]/details         name, copy, specs, size table, badges
│   │   ├── /[id]/images          upload, reorder, set primary
│   │   ├── /[id]/inventory       stock per size variant
│   │   ├── /[id]/schools         which schools sell it + overrides
│   │   └── /[id]/reviews         reviews moderation for this product
│   ├── /categories               tree CRUD with drag-to-reorder
│   ├── /coupons
│   └── /bulk-import              CSV upload for products
│
├── /students/                    [super, school_admin]
│   ├── (list)                    filters: school, class, parent
│   ├── /new
│   ├── /[id]/edit
│   ├── /[id]/orders              their order history
│   └── /import                   CSV upload (school_admin uploads their roster)
│
├── /parents/                     [super]
│   ├── (list)                    filters: school, status
│   ├── /[id]                     children, orders, login activity
│   └── /[id]/notes               internal notes (CSAT, escalations)
│
├── /orders/                      [super, ops, school_admin scoped]
│   ├── (list)                    filters: school, status, date
│   ├── /[id]                     full detail: items, payment, shipment, timeline
│   ├── /[id]/print-invoice
│   ├── /[id]/print-shipping-label
│   ├── /returns                  returns queue
│   └── /export                   CSV
│
├── /reviews                      [super, ops]
│   moderation queue with approve/reject
│
├── /content/                     [super]    ← CMS for homepage
│   ├── /homepage
│   │   ├── /sale-strip           marquee messages
│   │   ├── /hero                 headline, sub, CTA, video
│   │   ├── /trust-strip          school logos to feature
│   │   ├── /categories-feature   pick 4 categories to show
│   │   ├── /how-it-works         3 step text + icons
│   │   ├── /the-box              copy + included items list
│   │   ├── /in-the-wild          3 video URLs + captions
│   │   ├── /for-schools          B2B section copy
│   │   ├── /stats                4 numbers
│   │   ├── /principals           testimonials (link to school + manual override)
│   │   └── /final-cta            dark CTA copy
│   ├── /faqs                     CRUD with sort
│   ├── /pages                    About, Contact, Experience Store body
│   └── /media                    library — all uploaded images, videos
│
├── /experience-store             [super]    locations, hours, photos
├── /coupons                      [super]
│
├── /analytics/                   [super, school_admin scoped]
│   ├── /overview                 GMV, orders, AOV, conversion
│   ├── /by-school                per-school revenue, top SKUs
│   ├── /by-product               unit sales, return rate
│   ├── /cart-abandonment
│   └── /stock-alerts
│
└── /settings/                    [super]
    ├── /general                  brand name, contact, logo
    ├── /shipping                 zones, rates, free-shipping threshold
    ├── /tax                      GST rules
    ├── /payments                 Razorpay keys, COD on/off
    ├── /sms                      MSG91 keys, OTP templates
    ├── /email                    Resend keys, transactional templates
    ├── /users                    add/remove admin users, roles
    ├── /audit-log                immutable activity log
    └── /backups                  trigger manual backup, list past
```

### Map: every admin page back to a public page

| Public page section | Where it's edited in admin | Storage |
|---|---|---|
| Sale strip marquee | `/admin/content/homepage/sale-strip` | `content_blocks` `home.sale_strip` |
| Nav links | `/admin/settings/general` | `system_settings` |
| Hero (text + video) | `/admin/content/homepage/hero` | `content_blocks` `home.hero` |
| School logos in trust strip | `/admin/content/homepage/trust-strip` (picks featured) | `schools.is_featured` flag |
| Categories grid (4 featured) | `/admin/content/homepage/categories-feature` | `content_blocks` `home.categories` |
| How it works steps | `/admin/content/homepage/how-it-works` | `content_blocks` `home.how_it_works` |
| The Inventre Box | `/admin/content/homepage/the-box` | `content_blocks` `home.the_box` |
| In the Wild (3 videos) | `/admin/content/homepage/in-the-wild` | `content_blocks` `home.in_the_wild` |
| For Schools section | `/admin/content/homepage/for-schools` | `content_blocks` `home.for_schools` |
| Stats numbers | `/admin/content/homepage/stats` | `content_blocks` `home.stats` |
| Principal testimonials | `/admin/content/homepage/principals` | `testimonials` table, `is_featured` |
| FAQ entries | `/admin/content/faqs` | `faqs` |
| Final CTA strip | `/admin/content/homepage/final-cta` | `content_blocks` `home.final_cta` |
| Footer columns | `/admin/settings/general` (sitemap, social) | `system_settings` |
| Login page brand panel | `/admin/content/pages` (`pages.login_brand`) | `content_blocks` |
| Shop student bar (logo) | from logged-in `students` + `schools` | DB |
| Shop categories tree | `/admin/catalog/categories` | `categories` |
| Shop product grid | `/admin/catalog/products` (filtered to logged-in student's school) | `products` × `product_school` |
| PDP gallery | `/admin/catalog/products/[id]/images` | `product_images` |
| PDP description, specs, size table | `/admin/catalog/products/[id]/details` | `products.description` jsonb, `specs` jsonb, `size_table` jsonb |
| PDP size pills + stock | `/admin/catalog/products/[id]/inventory` | `product_variants` |
| PDP reviews | `/admin/reviews` (moderation) | `reviews` (status='approved') |
| PDP "Often added with" | derived from co-purchase analytics OR manual override per product | `product_related` (optional table) |
| PDP final CTA | `/admin/content/pages` | `content_blocks` |
| Shop "Complete the kit" | derived: `product_school.is_required = true` AND not in cart | DB |
| Mini cart, cart, checkout | parent-side cart in DB + Redis | `carts`, `cart_items` |

**Nothing in the public site is hard-coded after this is wired up.**

---

## Part 7 — Build Plan (8 Weeks to Production)

Phase-by-phase. Each phase ends with something deployable.

### Phase 0 — Local infra (3 days)

- Add `docker-compose.yml` with Postgres, PgBouncer, Redis, MinIO, Caddy, app, worker
- Drizzle config + initial migration
- Seed script that loads current hard-coded data (products, categories, testimonials, FAQs, schools) into DB
- `pnpm db:reset && pnpm db:seed` working
- ✅ Ship: identical to prod, runs locally

### Phase 1 — Auth (4 days)

- Better Auth + Drizzle adapter
- Phone OTP via MSG91 (with Redis rate limit)
- Sessions in Redis with JWT
- Replace fake `lib/auth.ts` with real flow
- Parent login → real student lookup from DB
- ✅ Ship: working login that creates real session

### Phase 2 — Catalog read path (4 days)

- Wire homepage content from `content_blocks`
- Wire categories from `categories`
- Wire products + variants + images from DB
- Cache layer: Redis with proper invalidation hooks
- Add `revalidateTag` on Next.js routes
- ✅ Ship: fully data-driven public site, no hard-coded products

### Phase 3 — Cart + Orders + Payments (8 days)

- Cart in Redis (TTL 7d) with Postgres mirror on writes
- Checkout flow: address → review → Razorpay
- Order creation on payment success (webhook + reconciliation)
- Order detail page for parents
- Order status SMS via BullMQ worker
- ✅ Ship: parents can actually buy

### Phase 4 — Admin foundation (8 days)

- `/admin/login` (email/password, separate from parent auth)
- Layout shell (nav + table component + form components — build a small DX kit)
- Dashboard page (5 KPI tiles + recent orders feed)
- Schools CRUD
- Products CRUD (incl. images upload to MinIO, variants, school assignment)
- Categories tree editor (drag to reorder)
- ✅ Ship: Inventre team can manage catalog without code changes

### Phase 5 — Admin orders + students + reviews (5 days)

- Orders list + detail + status transitions
- Returns queue
- Students CRUD + CSV import (school admins use this)
- Parents list (read-only, support tooling)
- Reviews moderation
- ✅ Ship: ops can run the business

### Phase 6 — CMS for homepage (4 days)

- `content_blocks` editor: each block has its own form (no generic CMS — keep it tight)
- FAQs CRUD with sort
- Testimonials CRUD with school link
- Sale strip messages
- Media library (uploaded once, reusable)
- ✅ Ship: Inventre marketing edits homepage without engineering

### Phase 7 — Performance + observability (4 days)

- Cloudflare in front of Caddy
- Cache headers audit
- ISR/PPR on PDPs
- Database EXPLAIN audit, add missing indexes
- pgbouncer + read replica setup
- Sentry for client + server errors
- Plausible analytics
- Uptime Kuma for synthetic checks
- Load test with `k6`: target 20K concurrent, find bottlenecks, fix
- ✅ Ship: handles peak term-start traffic

### Phase 8 — Deploy to Hetzner (3 days)

- Provision Coolify on Hetzner box
- Add Postgres/Redis/MinIO services in Coolify
- Connect Git repo, set env vars
- Point `staging.inventre.in` first → smoke test
- Cutover `inventre.in` DNS to Hetzner
- Run pg_dump cron → Hetzner Storage Box
- Set up alerts: high CPU, low disk, queue backlog, payment failures
- ✅ Ship: live with real schools

**Total: ~8 weeks for one engineer working full-time. Two engineers can compress to 5 weeks.**

---

## TL;DR

- **Stack:** Next.js + Postgres + Redis + MinIO + BullMQ + Caddy on Hetzner via Coolify. ~₹1,200/mo recurring on top of the Hetzner box.
- **20K concurrent:** achievable on one Hetzner machine with Cloudflare CDN + Redis cache + pgbouncer. Real DB pressure is much lower than 20K once caching is right.
- **Local = prod:** one `docker-compose.yml` runs both.
- **Admin panel:** ~10 top-level sections, ~40 sub-pages, every public element editable. Maps 1:1 to the public site.
- **Build order:** infra → auth → catalog → orders → admin → CMS → perf → deploy. 8 weeks solo, 5 weeks with a partner.
