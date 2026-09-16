# Ground Stock bridge — storefront availability from the audit ERP

**Added 2026-09-16 · branch `feat/ground-stock-availability`**

The audit ERP's **Ground Stock** page (per-school physical counts, netted
against packing-seal deductions) is the source of truth for whether a size can
be bought on inventre.in. Every 5 minutes the bridge copies its figures into the
admin **Stock module** (`bins`), and every storefront surface reads those bins
through one rule.

```
audit /api/ground-stock/dashboard  ──(poll login, every 5 min)──▶  server/ground-stock-sync.ts
        3,704 rows, 12 scopes                                        │ match item_code → product_variants.sku / erp_name
                                                                     ▼
                                              bins (admin Stock module) + stock_ledger "adjustment" rows
                                                                     │
                                              server/repos/variant-resolver.ts → features/stock/domain/availability.ts
                                                                     ▼
                       catalog cards · PDP size pills · Magic Box configurator · cart · CCAvenue create-order gate
```

## The rule (features/stock/domain/availability.ts)

| Product kind | Audit row matched | No audit row |
|---|---|---|
| uniform, accessory, consumable | sells exactly `available` (≤ 0 ⇒ sold out) | **sold out** (admin can switch to "sellable") |
| book | sells exactly `available` | available (the book sheet is partial by design) |
| kit, sub_bundle, magic_box | never gated | never gated |

Gate off (admin switch) ⇒ everything available, the pre-bridge behaviour.
The legacy `product_variants.stock_qty` column is no longer read anywhere.

## Coverage measured 2026-09-16 (dev clone vs live audit)

| | |
|---|---|
| Audit item codes | 3,520 (from 3,704 scope rows) |
| Matched to a storefront variant | 3,358 (3,354 exact SKU, 4 normalised) |
| Written to bins (counted kinds only) | 3,327 |
| Of which in stock / sold out | 2,155 / 1,172 |
| Audit codes with no storefront SKU | 162 (size-encoding differences, un-sized templates such as `SAS BP Belt`) |
| Active garments with no audit row at all | 516 (Keesara 145, Winmore Whitefield 78, St Michaels 37 …) — sold out under the default policy |

1,104 audit codes read **below zero** on the dashboard (deductions past the last
count). The audit's own page shows them as "out"; the storefront agrees.

## Operating it

* **Admin** → Reports → Stock: the *Ground Stock bridge* card shows the last
  runs, tracked/in-stock/sold-out counts, unmatched codes, a **Sync now**
  button, and the two switches (gate on/off; uncounted garments sold out / sellable).
* **API**: `GET/POST /api/admin/stock/ground-sync` (catalog.read / catalog.write).
* **Cron**: `POST /api/cron/ground-stock-sync` with `Authorization: Bearer $CRON_TOKEN`.
  Install `deploy/cron.d/inventre-ground-stock` as `/etc/cron.d/inventre-ground-stock`
  once the build is live. Log: `/var/log/inventre-ground-stock.log`.
* **Credentials**: the audit login the ERP status poller already uses
  (`STAGING_ERP_API_BASE_URL` / `STAGING_ERP_POLL_USER` / `STAGING_ERP_POLL_PASS`
  in `.env.deploy`, selected by `ERP_TARGET`). That account must hold the
  audit's `ground_stock` module; verified 2026-09-16.
* **Failure mode**: if the audit is unreachable or returns 0 rows, nothing is
  written — the last figures stand and the run is recorded with its error.
  Overlapping ticks are prevented by a 4-minute Redis lock.
* **Latency**: a change on the audit reaches the storefront within one tick
  (≤ 5 min); the product caches are busted whenever a bin moves.

## Deploy checklist

1. Merge / check out the branch; `deploy.sh` (migration 0076 runs at boot).
2. Trigger one sync (admin card or curl the cron route) and read the card.
3. Install the cron.d file. Watch the log for two ticks.
4. If the storefront must be reverted in a hurry: untick *Ground Stock decides
   availability* on the card — live within 30 s, no deploy.

## Rollback

Code: previous image tag. Data: bins/ledger rows written by the bridge carry
`ref_type = 'ground_stock'`; with the gate off they are inert.
