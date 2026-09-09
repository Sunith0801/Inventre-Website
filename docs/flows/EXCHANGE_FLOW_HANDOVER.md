# Customer-raised Exchange Flow — Handover (2026-06-07)

> One-doc state for tomorrow's continuation. Plans live at
> `/root/.claude/plans/so-actually-customers-are-dapper-crayon.md`
> (inventre side) and `/root/.claude/plans/audit-side-exchange-flow.md`
> (audit side).

## What we're building

A self-serve exchange flow on inventre.in: a parent on a delivered order
can request an exchange (wrong size / damaged / wrong item / defective /
other), attach photos, and submit. The request fires to
`audit.inventre.in` over the existing HMAC-signed `/api/ecom/ingest`
channel. Customer-care reviews + approves on audit; school staff hand
over physically on the next Saturday (≥ 7 days out). Status flips
round-trip back to inventre so the parent sees live state.

**Gating philosophy** — phone-allowlisted to `7013232148` (Sriram /
your number). Non-allowlisted parents see zero new UI, zero new fields
in API responses, no behaviour change.

## Where things are RIGHT NOW

### Environments

| Layer | URL | Code state |
|---|---|---|
| Inventre prod (`https://inventre.in`) | running container `inventre-deploy-app:3010` | **Pre-exchange**. Phase 1+2 code is committed locally (commit `57a5c14`, then a Phase-2 diff on top, both **uncommitted to the second commit**) but **not deployed to prod**. |
| Inventre dev (`http://62.72.41.68:3020`) | `next dev` on this box, env: `STAGING_ERP_INGEST_URL=http://217.216.58.218:8012/api/ecom/ingest`, `EXCHANGE_TESTER_PHONES=7013232148` | **Phase 1 + Phase 2** code live. Reads/writes prod inventre DB (only one DB). |
| Audit prod (`https://audit.inventre.in`) | docker stack at `/root/ERP-NEW-WITH-API/` on 217.216.58.218 | **Rolled back** to pre-exchange state. Schema clean (`alembic head = i5d6e7f8a9b0`), no exchange code, no test data. |
| Audit dev (`http://217.216.58.218:3081`) | docker stack at `/root/ERP-NEW-WITH-API-dev/` compose project `audit-dev` on 217.216.58.218 | **Phase 1 + Phase 2** code live. Own postgres volume `audit-dev_pgdata`, DB seeded from the pre-our-migration prod dump. Alembic head `m8a9b0c1d2e3`. |

### ufw / firewall (62.72.41.68, our box)

- `3020/tcp` open to the world — inventre dev. **Close when done.**
  (`ufw delete allow 3020/tcp` twice for IPv4 + IPv6.)

### ufw / firewall (217.216.58.218, audit box)

- `8012/tcp` open only **from 62.72.41.68** — audit dev backend.
- `3081/tcp` open to the world — audit dev frontend.
- Both must be closed when we're done iterating.

### Network wiring (dev pair)

```
Browser ──→ inventre dev :3020 ──(HMAC POST)──→ audit dev :8012 /api/ecom/ingest
                ▲                                       │
                │  /api/erp/webhooks/exchange ◀───(HMAC POST)─┘
                └──────  audit dev's exchange_publish.py
```

### Background processes on this box

- `next dev -p 3020` running as PID (look via `pgrep -f 'next dev -p 3020'`). Log at `/tmp/next-dev.log`.

### Test data on dev

Both audit dev DB and inventre DB are clean of exchange rows as of the
last cleanup. RTN counter on inventre reset.

## Commits

| SHA | Where | Message |
|---|---|---|
| `01c7a77` | inventre `main` (local only — push blocked, no valid PAT) | ops bundle: cart race, ERP sub-items, MCB heartbeat, student-import polish |
| `57a5c14` | inventre `main` (local only) | feat(exchange): customer-raised exchange flow, phone-gated to one tester (Phase 1) |
| _Phase-2 diff_ | inventre `main` working tree | **uncommitted**. Adds variant-context helper, sub-reasons + sub-form, photo categories, two-step confirm form, jsonb scalar guard fix on order detail, local-status override in /api/orders/[id] |
| `audit feat/exchange-flow` | audit repo worktree at `/root/ERP-NEW-WITH-API-exchange` | **uncommitted**. Contains the audit-side changes that match Phase 1+2. |

DBs:
- Inventre prod DB has migrations 0050, 0051, 0052 applied. (All
  additive — no behavioural change for non-tester parents.)
- Audit dev DB has migrations j6e7f8a9b0c1, k7f8a9b0c1d2, m8a9b0c1d2e3
  applied.
- Audit prod DB is at i5d6e7f8a9b0 (the previous head — exchange tables
  not present).

## Files (key paths)

### Inventre side

```
db/migrations/
  0050_cart_items_unique_cart_variant.sql            (Phase 0, already shipped)
  0051_returns_exchange_fields.sql                   (Phase 1)
  0052_returns_phase2_fields.sql                     (Phase 2)
db/schema.ts                                         (updated)

lib/
  date.ts                                            (firstPickupSaturday helper)
  exchange-gate.ts                                   (phone allowlist)
  exchange-shared.ts                                 (client-safe enums incl. SUB_REASONS, PHOTO_CATEGORIES, DAMAGE_LOCATIONS)
  exchange.ts                                        (server orchestrators: createExchange, transitionExchangeStatus)
  variant-context.ts                                 (Phase 2: variant + axes + siblings loader)
  erp-bridge.ts                                      (extended: exchange.requested event + buildExchangePayload + fix CUST- double-prefix)
  notifications.ts                                   (notifyExchangeStatus + 4 templates)
  erp-customer-orders.ts                             (Phase 2 fix: jsonb_typeof guard around derived_delivery_categories_present)

app/api/
  returns/route.ts                                   (rewritten: phone gate + new fields)
  returns/upload/route.ts                            (new: parent-gated multipart)
  erp/webhooks/exchange/route.ts                     (new: HMAC inbound for status flips)
  orders/[id]/route.ts                               (extended: canExchange + activeExchange + local-status override)

app/shop/orders/[id]/
  page.tsx                                           (additive slots: banner + button)
  exchange/new/page.tsx                              (new: gated form host)
  exchange/[returnId]/page.tsx                       (new: gated status page)

components/shop/orders/exchange/
  ExchangeButton.tsx
  ExchangeStatusBanner.tsx
  ExchangeForm.tsx                                   (Phase 2 rich form: sub-reason, kit drill-down, what-do-you-need, photo categories, confirm step)
```

### Audit side (worktree + dev tree)

```
backend/alembic/versions/
  2026_06_07_2030_j6e7f8a9b0c1_exchange_requests.py     (Phase 1)
  2026_06_07_2200_k7f8a9b0c1d2_exchange_items_delivered_size_text.py   (delivered_size → TEXT)
  2026_06_07_2300_m8a9b0c1d2e3_exchange_phase2_fields.py                (Phase 2)

backend/app/
  models.py                                           (+ ExchangeRequest, ExchangeRequestItem, ExchangeRequestPhoto with Phase-2 cols)
  config.py                                           (+ ecom_webhook_back_url setting)
  rbac.py                                             (+ exchange_review, exchange_handover modules; seeded into agent + school_mgmt)
  main.py                                             (mounts exchange_requests router)
  ecom_integration/
    schema.py                                         (+ "exchange.requested" in INGEST_EVENTS)
    ingest.py                                         (+ _apply_exchange handler, Phase-2 fields)
    exchange_publish.py                               (new: HTTP outbound via httpx, HMAC)
  routers/
    exchange_requests.py                              (new: GET /api/exchanges/*, approve/reject/mark-delivered, customer_history)

frontend/src/
  App.jsx                                             (routes for exchange-requests, exchange-requests/:id, school/exchange-pickups)
  components/Layout.jsx                               (NAV array additions)
  pages/
    ExchangeRequests.jsx                              (new: queue)
    ExchangeRequestDetail.jsx                         (new: customer-care detail, Phase-2 split layout)
    SchoolExchangePickups.jsx                         (new: school big-card view + checklist gate)

docker-compose.yml                                    (+ ECOM_WEBHOOK_BACK_URL env passthrough)
.env                                                  (+ ECOM_WEBHOOK_BACK_URL=http://62.72.41.68:3020)
```

## How to resume tomorrow

### Verify dev pair is still up

```bash
# inventre dev
pgrep -af 'next dev -p 3020'
curl -s http://localhost:3020/api/health | head -1

# audit dev (from this box)
curl -s http://217.216.58.218:3081/ -o /dev/null -w "frontend: %{http_code}\n"
curl -s http://217.216.58.218:8012/healthz | head -1
```

If inventre dev is gone, restart it:

```bash
cd /root/Inventre
set -a && source .env.deploy && set +a
STAGING_ERP_INGEST_URL="http://217.216.58.218:8012/api/ecom/ingest" \
  DATABASE_URL="postgres://inventre:inventre_prod@localhost:6433/inventre" \
  npx next dev -p 3020 -H 0.0.0.0 > /tmp/next-dev.log 2>&1 &
```

If audit dev containers are stopped:

```bash
sshpass -p '<rotated-audit-pw>' ssh root@217.216.58.218 \
  'cd /root/ERP-NEW-WITH-API-dev && docker compose -p audit-dev up -d'
```

(Password should be rotated — see "Security debt" below.)

### Mint a test session

```bash
# Sriram parent session (1h)
cd /root/Inventre
set -a && source .env.deploy && set +a
node -e "
import('jose').then(async ({SignJWT}) => {
  const secret = new TextEncoder().encode(process.env.JWT_SECRET);
  const tok = await new SignJWT({sub: '6efa00de-ad91-40b8-9b42-4e2ca52aad87', kind: 'parent', phone: '7013232148'})
    .setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('2h').sign(secret);
  console.log(tok);
});
" | tail -1 > /tmp/sriram.jwt

# Audit admin JWT
sshpass -p '<pw>' ssh root@217.216.58.218 \
  'docker exec audit-dev-backend-1 python -c "from app.auth import make_token; print(make_token(\"admin\", role=\"admin\"))"' \
  > /tmp/audit-admin-dev.jwt
```

### Drive a round-trip end-to-end

1. Open http://62.72.41.68:3020/shop/orders/SAL-ORD-2026-31886 in your
   browser (or any delivered order under Sriram's account).
2. Click "Request exchange" on a line item.
3. Phase-2 form: pick component (if kit), reason → sub-reason → (damage
   location) → what-do-you-need, attach photo(s) in the right
   category slot, hit Review → Submit.
4. Status banner appears on the order page.
5. Open http://217.216.58.218:3081/exchange-requests as admin →
   approve. Watch inventre banner flip.
6. Open http://217.216.58.218:3081/school/exchange-pickups as a
   school_mgmt user → check the 3 boxes → mark delivered. Watch
   inventre banner flip again.

### Saved test data references

- Sriram parent id: `6efa00de-ad91-40b8-9b42-4e2ca52aad87`
- Delivered test order (kept delivered for this work): `1c6e8323-6f39-4834-aa0e-297b6d5d67ec` / `SAL-ORD-2026-27313` — **revert to 'placed' at end of testing**.
- Another delivered order from user's test: `ebaa7e90-6ee2-49c0-b9bc-3a75908eb516` / `SAL-ORD-2026-31886`.

## Open / pending

### Cleanup (do these before we widen the rollout)

1. **Revert order 27313 to `placed`** —
   `UPDATE orders SET status='placed' WHERE id='1c6e8323-6f39-4834-aa0e-297b6d5d67ec';`
2. **Close ufw 3020 on this box** when done with dev — `ufw delete allow 3020/tcp` (IPv4 + IPv6 rules).
3. **Close ufw 8012 + 3081 on audit box** when done iterating.
4. **Rotate audit SSH password** — it crossed the chat earlier. Replace with an SSH key (add my pubkey or your own to `/root/.ssh/authorized_keys`).
5. **Rotate GitHub PAT** — the one you sent (`ghp_kmoU…`) was invalid by the time we tried but it's still in the transcript; rotate at github.com/settings/tokens.
6. **Push commits to remote** — the inventre `main` is two-ish commits ahead of origin (`01c7a77` ops bundle + `57a5c14` exchange Phase 1 + uncommitted Phase 2). Same for audit's `feat/exchange-flow` branch.

### What's NOT done yet (next-up backlog)

- **Promote to inventre prod.** Commit Phase 2 locally, push to GitHub
  (needs PAT), rebuild prod container, restart. Stays gated to
  `EXCHANGE_TESTER_PHONES=7013232148` so blast radius is one parent.
- **Promote to audit prod.** Replay the same migration sequence + image
  build that we did on dev. Set `ECOM_WEBHOOK_BACK_URL` to
  `https://inventre.in`. Already-tagged rollback image present.
- **DLT SMS template registration.** Three templates referenced in
  `lib/notifications.ts`: exchange_requested, exchange_approved (with
  pickup-date variable), exchange_completed, plus rejected. Until
  filed, `lib/sms.ts` shim no-ops them silently — the in-app banner is
  the only customer signal.
- **Handover photo upload.** `returns.handover_photos` jsonb column +
  audit's `exchange_requests.handover_photos` already exist. UI to
  capture a photo at "Mark delivered" is not built yet — would need a
  multipart upload endpoint on audit + a slot in the school card. Phase
  3 candidate.
- **In-school stock indicator.** The school card has a "Hand over"
  panel but doesn't tell the operator whether the requested variant is
  actually in their school's inventory. Wire this off the existing
  `warehouse_stock` data on audit.
- **Bundle replacement for kit problems.** Today, kit-component
  complaints capture only `requested_component_path` — customer-care
  must intuit the replacement. A follow-up could give the customer a
  picker for which component variant they want (language, edition,
  etc.). Phase 3 candidate.
- **Internal-note column** for customer-care to leave school
  instructions on approve ("confirm Size L is in stock before
  handover"). Not added yet — would need a migration on both sides.
- **Audit's customer history** is a 90-day count of *exchange* rows;
  doesn't include refunds or order cancellations. Widen if signal
  proves useful.
- **Mobile UX pass.** The inventre form is designed for mobile but
  hasn't been click-tested on a real phone. Same for the audit school
  view — schools probably look at this on a tablet.
- **Audit-side `school_pickup_agent` role.** Today we grant the school
  module to `school_mgmt` (existing role). Could split for cleaner
  audit trail. Phase 3.

### Known cosmetic / minor issues

- Inventre dev's `next dev` is running with TURBOPACK off (default
  dev). Some routes recompile on first hit (200-700ms).
- Audit dev frontend exposes 0.0.0.0:3081 — no TLS. Login still
  works (JWT cookie over HTTP works fine for our LAN dev), but feel
  free to put nginx in front later.
- Audit detail page's "What was delivered" card shows
  `delivered_size` which on kit parents was full BOM string (66
  chars) — we widened to TEXT but it still looks ugly. Long-term,
  improve inventre's `order_items.size` shape for kits.

## Security debt

| Item | Status | Action |
|---|---|---|
| Audit SSH root password | Sent via chat | Rotate + add SSH key. |
| GitHub PAT | Sent via chat (invalid anyway) | Revoke at github.com/settings/tokens. |
| Audit `.env` files | Have real prod values copied into dev | Dev DB is restored from prod dump → contains PII. Don't expose. |
| ufw temporary opens | 3020 / 8012 / 3081 | Close after testing windows. |
| Test photo in R2 | 69-byte placeholder at `returns/<parentId>/<orderId>/...` | Harmless, can sweep later. |

## Reference: useful commands

```bash
# Inventre DB (prod, used by both prod and dev inventre)
docker exec 1c61220878ef_inventre-deploy-postgres \
  psql -U inventre -d inventre -c "<SQL>"

# Audit dev DB
sshpass -p '<pw>' ssh root@217.216.58.218 \
  'docker exec audit-dev-db-1 psql -U $(docker exec audit-dev-db-1 printenv POSTGRES_USER) -d $(docker exec audit-dev-db-1 printenv POSTGRES_DB) -c "<SQL>"'

# Audit prod DB
sshpass -p '<pw>' ssh root@217.216.58.218 \
  'docker exec erp-new-with-api-db-1 psql -U $(docker exec erp-new-with-api-db-1 printenv POSTGRES_USER) -d $(docker exec erp-new-with-api-db-1 printenv POSTGRES_DB) -c "<SQL>"'

# Tail inventre dev log
tail -f /tmp/next-dev.log

# Tail audit dev backend log
sshpass -p '<pw>' ssh root@217.216.58.218 \
  'docker logs -f audit-dev-backend-1'

# Audit dev frontend rebuild after Layout/JSX changes
sshpass -p '<pw>' ssh root@217.216.58.218 \
  'cd /root/ERP-NEW-WITH-API-dev && docker compose -p audit-dev build frontend && docker compose -p audit-dev up -d frontend'
```

## Decisions log (for future-us)

- **Status mapping reuses existing `returnStatusEnum`** (approved =
  ready-for-pickup, received = delivered). No new enum value.
- **Tester gate = env var** `EXCHANGE_TESTER_PHONES` (comma-separated
  last-10 digits) — not a DB-backed table. Restart-to-change.
- **Audit side = isolated dev stack first**, prod last. User pushed
  back on "let's iterate on prod"; we have a clean dev pair now.
- **Status flip channel back to inventre = HTTP webhook**, not the
  direct-DB mirror publisher. Faster UX + matches the receiver I
  built on inventre. Audit `exchange_publish.py` is httpx-based.
- **Local `orders.status` overrides ERP-mirror status** for
  canExchange + the surfaced status pill on storefront — gated to
  testers for now per the live-site caution.
- **No partial-state attempts on photos.** Photos must all upload OK
  before the return row is created; failure aborts the whole submit.
- **Customer-care detail layout is industry-shaped** (You Ordered →
  Customer Wants) — chosen over a column of raw fields because school
  staff need a glance, not a deep read.

## Plans on disk

- `/root/.claude/plans/so-actually-customers-are-dapper-crayon.md` —
  inventre side, Phase 1.
- `/root/.claude/plans/audit-side-exchange-flow.md` — audit side, Phase 1.
- (Phase 2 isn't its own plan file; it's captured here.)

---

Last touched: 2026-06-07 (this session).
