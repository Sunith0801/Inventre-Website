# Ground Stock bridge — storefront availability from the audit ERP

**Added 2026-09-16 · branch `feat/ground-stock-availability`**

The audit ERP's **Ground Stock (New)** page (keeper-SKU shelf count, the
"Ground Stock (New)" tab under Warehouse → Inventory → Stock) is the source of
truth for whether a size can be bought on inventre.in. (The first cut, the
same morning, read the per-school Ground Stock dashboard; the user switched it
to Ground Stock (New) the same afternoon, and the sizes only the old page knew
were zeroed on the first tick.) Every 5 minutes the bridge copies its figures into the
admin **Stock module** (`bins`), and every storefront surface reads those bins
through one rule.

```
audit /api/keeper-stock/dashboard  ──(poll login, every 5 min)──▶  server/ground-stock-sync.ts
   4,292 keeper rows × old_skus[]                                    │ legacy item code → product_variants.sku / erp_name
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

## Coverage measured 2026-09-16 afternoon (dev clone vs live Ground Stock (New))

| | |
|---|---|
| Keeper rows (school × keeper SKU) | 4,292 |
| Legacy item codes listed on those rows | 4,638 |
| Matched to a storefront variant | 3,806 (3,799 counted kinds written to bins) |
| Of which in stock / sold out | 2,248 / 1,551 |
| Legacy codes with no storefront SKU | 832 (retired codes the keeper rows still list) |
| Active garments with no keeper row at all | 327, of which 125 are test/junk variants with no school |

A keeper SKU is one shelf; a "shared" SKU is sold by several schools, so two
legacy codes of one row read the same quantity on purpose.

The per-school Ground Stock dashboard is still available at
`/api/ground-stock/dashboard` (its aggregator `aggregateGroundStock` stays in
the domain module) but is not read by the bridge.

## Operating it

* **Admin** → Catalog → **Ground Stock** (left menu): per-size table with
  keeper SKU, school, shelf count and count date, searchable, filter in/out.
  The same *Ground Stock bridge* card also sits on Reports → Stock. It shows the last
  runs, tracked/in-stock/sold-out counts, unmatched codes, a **Sync now**
  button, and the two switches (gate on/off; uncounted garments sold out / sellable).
* **API**: `GET/POST /api/admin/stock/ground-sync` (catalog.read / catalog.write).
* **Cron**: `POST /api/cron/ground-stock-sync` with `Authorization: Bearer $CRON_TOKEN`.
  Install `deploy/cron.d/inventre-ground-stock` as `/etc/cron.d/inventre-ground-stock`
  once the build is live. Log: `/var/log/inventre-ground-stock.log`.
* **Credentials**: the audit login the ERP status poller already uses
  (`STAGING_ERP_API_BASE_URL` / `STAGING_ERP_POLL_USER` / `STAGING_ERP_POLL_PASS`
  in `.env.deploy`, selected by `ERP_TARGET`). That account must hold the
  audit's `ws_ground_stock_new` module; verified 2026-09-16.
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
