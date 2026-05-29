# Items Export Feed — Integration & Operations

The single source of truth for the ERP → local ecommerce item catalog.
Replaces the removed storefront catalog projection: **no curation, no
publish gating** — the ecommerce app gets the full item master and
decides what to sell.

Deployed and verified on **https://audit.inventre.online** (2026-05-17).

---

## 1. Endpoint

```
GET https://audit.inventre.online/api/items/export
Header: X-Feed-Key: <secret key>
```

**Auth key (server-to-server, treat as a secret):**

```
6bd174e824ba5350b220cdb3ec09361193392e2579a655ad15cd81bff7915803
```

- No key / wrong key → `401`.
- Key not configured on the server → `503` (fails closed; the catalog is
  never served unauthenticated).

### Query parameters (all optional)

| Param | Default | Meaning |
|---|---|---|
| `limit` | none (ALL) | Page size. Omit to get all ~6107 in one response. |
| `start` | `0` | Offset for paging. |
| `item_group` | — | Filter to a single ERP item group. |
| `include_deleted` | `false` | Include soft-deleted items. |

### Response shape

```json
{
  "count": 6107, "total": 6107, "start": 0, "limit": null,
  "include_deleted": false, "generated_at": "2026-05-17T..Z",
  "items": [
    {
      "erp_name": "Boys Pant",
      "item_name": "Boys Pant",
      "item_group": "Full Pants",
      "custom_sub_category": "A",
      "custom_school_name": "TSUSC-TSUS Chennai",
      "custom_grade": "Grade 10, Grade 12, Grade 11",
      "custom_organization_mrp": 0.0,
      "variant_of": null, "has_variants": true,
      "gst_hsn_code": "...", "stock_uom": "...", "is_stock_item": true,
      "image": "/files/BOYS PANTY(FRONT).png",
      "image_url": "https://audit.inventre.online/item-media/<hash>.png",
      "raw": { "...entire ERPNext item document..." },
      "effective": {
        "image": "/files/BOYS PANTY(FRONT).png",
        "image_url": "https://audit.inventre.online/item-media/<hash>.png",
        "image_source_url": "https://erp.inventre.in/files/BOYS%20PANTY(FRONT).png",
        "image_is_local": true,
        "custom_school_name": "TSUSC-TSUS Chennai",
        "custom_grade": "Grade 10, Grade 12, Grade 11",
        "custom_gender": null,
        "inherited_from": null
      }
    }
  ]
}
```

---

## 2. What to read

- **Render from `effective.*`** — it resolves variant→parent-template
  inheritance (a variant inherits its template's image/school/grade/
  gender). The flat columns + `raw` are a literal ERP mirror; `raw`
  holds anything not mapped explicitly.
- **`erp_name`** is the unique product key (use it for upserts).
- **`effective.image_url`** is a stable, self-hosted HTTPS image on our
  domain (see §4). `image_source_url` is the original ERP URL (for
  debugging); `image_is_local` says whether it's been re-hosted yet.

### Field cheatsheet

| Field | Notes |
|---|---|
| `erp_name` | Unique ID / product key |
| `item_name`, `description`, `item_group`, `custom_sub_category` | Naming & categorisation |
| `effective.custom_school_name` | **Coded** label, e.g. `"TSUSC-TSUS Chennai"` |
| `effective.custom_grade` | ⚠️ **comma-separated multi-value** — split on `,` |
| `effective.custom_gender` | Usually empty in ERP — do not rely on it |
| `effective.image_url` | Self-hosted HTTPS image; `null` = no image in ERP |
| `custom_organization_mrp` | Often `0.0` — **the ecommerce app owns the real price** |
| `variant_of` / `has_variants` | `has_variants:true` = template; `variant_of:"X"` = sellable variant of X |
| `gst_hsn_code`, `stock_uom`, `is_stock_item` | Tax / unit |
| `raw` | Entire ERPNext doc — everything else lives here |

### Three integration must-knows

1. **Grade is a CSV string.** Always split `effective.custom_grade` on
   commas; one item maps to many grades.
2. **Price is yours.** `custom_organization_mrp` is frequently `0.0`;
   set the selling price in the ecommerce admin, don't trust the feed.
3. **Variants vs templates.** Decide whether you sell the template
   (`has_variants:true`) or each `variant_of` child as a product; the
   feed gives you both so you choose.

---

## 3. Data coverage (reality)

The feed delivers everything that exists in ERPNext — but the ERP data
itself is partially filled. Of 6107 live items:

| Field | Coverage |
|---|---|
| `item_name`, MRP, `raw` | 100% |
| Image (effective) | ~4116 (67%) |
| School name (effective) | ~5176 (84%) |
| Grade (effective) | ~4950 (81%) |
| `custom_school_code` | 0 (never used in this ERP) |

The ~33% with no image **genuinely have none in ERPNext** (no hidden
images in `raw`). The `/items` admin page only *looks* fully populated
because it renders a coloured first-letter placeholder tile (tooltip
"No image in ERP") for missing images. Closing the gap = adding
images/tags on the ERP item records; the feed reflects it automatically
on the next pull (no redeploy).

---

## 4. Local image hosting

ERP images are downloaded **once** into the backend's persistent uploads
volume and served from our domain, so the ecommerce site never hotlinks
`erp.inventre.in` and broken filenames (spaces/parens) stop mattering.

- Stored: `backend/uploads/item_media/<sha1>.<ext>` (Docker volume;
  survives redeploys; **not** in git).
- Served: `https://audit.inventre.online/item-media/<sha1>.<ext>`
  (unauthenticated static).
- Populated by a background job on **boot (+60s)** and every
  **`item_media_rebuild_hours`** (default 12h). Idempotent — cached
  files are skipped. ~332 distinct files cover all 4116 image-bearing
  items (variants share their template's image).
- The feed serves the local URL once cached and the ERP URL as a
  fallback until the first rehost completes.

---

## 5. How the ecommerce app should consume it

Run a **scheduled sync** (e.g. nightly) that pulls the feed and upserts
into the ecommerce DB keyed by `erp_name`.

```bash
curl -H "X-Feed-Key: 6bd174e824ba5350b220cdb3ec09361193392e2579a655ad15cd81bff7915803" \
  "https://audit.inventre.online/api/items/export" -o catalog.json
```

Node.js (paged):

```js
const KEY = process.env.ERP_FEED_KEY;
const BASE = "https://audit.inventre.online/api/items/export";

async function syncCatalog() {
  const limit = 1000;
  for (let start = 0; ; start += limit) {
    const res = await fetch(`${BASE}?start=${start}&limit=${limit}`,
      { headers: { "X-Feed-Key": KEY } });
    if (!res.ok) throw new Error(`feed ${res.status}`);
    const { items, count } = await res.json();
    for (const it of items) {
      await upsertProduct({
        sku:        it.erp_name,
        title:      it.item_name,
        category:   it.item_group,
        subCategory:it.custom_sub_category,
        school:     it.effective.custom_school_name,
        grades:     (it.effective.custom_grade || "")
                      .split(",").map(g => g.trim()).filter(Boolean),
        imageUrl:   it.effective.image_url,   // null => use your own placeholder
        isVariant:  !!it.variant_of,
        parentSku:  it.variant_of,
        hasVariants:it.has_variants,
        hsn:        it.gst_hsn_code,
        // price: SET IN YOUR OWN ADMIN — feed MRP is unreliable
        raw:        it.raw,
      });
    }
    if (count < limit) break;
  }
}
```

Python (paged):

```python
import os, requests
KEY = os.environ["ERP_FEED_KEY"]
BASE = "https://audit.inventre.online/api/items/export"
start, limit = 0, 1000
while True:
    r = requests.get(BASE, params={"start": start, "limit": limit},
                      headers={"X-Feed-Key": KEY}, timeout=120)
    r.raise_for_status()
    data = r.json()
    for it in data["items"]:
        grades = [g.strip() for g in (it["effective"]["custom_grade"] or "").split(",") if g.strip()]
        upsert_product(sku=it["erp_name"], title=it["item_name"],
                        school=it["effective"]["custom_school_name"],
                        grades=grades, image_url=it["effective"]["image_url"],
                        raw=it["raw"])
    if data["count"] < limit:
        break
    start += limit
```

---

## 6. Operations

**Code/config (all uncommitted working-tree, alongside the prod delta):**

- `backend/app/routers/items_feed.py` — the feed endpoint + key auth.
- `backend/app/services/item_media.py` — image re-hoster.
- `backend/app/main.py` — router include (no JWT/RBAC; own key gate),
  `/item-media` static mount, `item-media` in `_API_PREFIXES`,
  scheduled `_scheduled_item_media_rebuild` job.
- `backend/app/config.py` — `integration_api_key`,
  `item_media_rebuild_hours`, `public_base_url`.
- `frontend/nginx.conf` — `location ^~ /item-media/ { proxy_pass
  http://backend:8000; }` (the `^~` is **required** so the prefix beats
  the `\.png$` regex location, otherwise images 404 against the SPA).
- `docker-compose.yml` — `INTEGRATION_API_KEY` and `PUBLIC_BASE_URL`
  passthrough to the backend env.
- `.env` (prod, host only) — `INTEGRATION_API_KEY=<key>`,
  `PUBLIC_BASE_URL=https://audit.inventre.online`.

**Rotate the feed key:** change `INTEGRATION_API_KEY` in prod `.env`,
restart the backend, hand the new key to the ecommerce app.

**Redeploy** (per the standard workflow):

```bash
docker-compose -p erp-new build --no-cache frontend backend
docker-compose -p erp-new up -d --force-recreate backend frontend
```

No DB migration is involved (non-destructive). Cached images persist
across redeploys via the uploads volume.

**Why `PUBLIC_BASE_URL` is mandatory:** TLS terminates at the `caddy`
container, so the backend sees `http` internally; without an explicit
public base the feed would emit `http://` image URLs and clients would
hit a 308 redirect. The feed prefers `public_base_url`, then
`X-Forwarded-Proto/Host`, then the raw request.

---

## 7. History

This feed replaced the earlier curated **catalog feed**
(`/api/catalog/v1`), which was removed on 2026-05-17 at the product
owner's request (including dropping its prod tables — irreversible).
The prior design exists only in git history before 2026-05-17.
