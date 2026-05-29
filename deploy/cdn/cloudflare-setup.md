# Cloudflare CDN setup for inventre.in

**Goal:** offload the static-asset traffic (~30-40 % of nginx load)
to Cloudflare's edge, get free DDoS protection, and free TLS for
inventre.in + www.inventre.in.

## Step 1 — Add the zone

1. Sign up / log in at https://dash.cloudflare.com.
2. Add Site → enter `inventre.in`.
3. Pick the Free plan.
4. Cloudflare scans your DNS — you should see the existing A record
   pointing at `147.93.152.216`.

## Step 2 — Switch nameservers

Cloudflare gives you two NS hostnames (e.g.
`alex.ns.cloudflare.com`, `kate.ns.cloudflare.com`). Update them at
your domain registrar.

Propagation: 1–24 h. Cloudflare emails you when it's active.

## Step 3 — Configure DNS records inside Cloudflare

| Type | Name | Content | Proxy |
|---|---|---|---|
| A | `inventre.in` | `147.93.152.216` | **Proxied (orange cloud)** |
| A | `www.inventre.in` | `147.93.152.216` | **Proxied** |
| A | `test.inventre.in` | `147.93.152.216` | DNS-only (grey cloud) — keep direct for staging |
| A | `grafana.inventre.in` | `147.93.152.216` | DNS-only — admin only |

## Step 4 — TLS configuration

Cloudflare Dashboard → SSL/TLS:

- **Encryption mode**: `Full (strict)` — Cloudflare → origin uses
  HTTPS with your cert verified. We already have Let's Encrypt on
  the origin, so this works out of the box.
- **Edge Certificates**: Cloudflare issues a free Universal cert. Don't
  remove your origin Let's Encrypt — both are needed for end-to-end TLS.
- **Always Use HTTPS**: ON
- **HSTS**: enable with `max-age=31536000; includeSubDomains; preload`
  once you're sure all subdomains are HTTPS-ready.

## Step 5 — Caching rules

Dashboard → Caching → Configuration → Cache Rules. Add these rules in
order:

1. **Cache /\_next/static aggressively**
   - Match: `URI Path starts with "/_next/static/"`
   - Eligible for cache: YES
   - Edge TTL: 1 year
   - Browser TTL: 1 year
   - Respect `Cache-Control: immutable`

2. **Cache product images (R2 redirects)**
   - Match: `URI Path starts with "/images/"` OR `"/erp-media/"`
   - Edge TTL: 7 days
   - These are 307 redirects to R2; Cloudflare follows + caches.

3. **Do NOT cache `/api/*` or `/admin/*`**
   - Match: `URI Path starts with "/api/"` or `"/admin/"`
   - Cache: BYPASS

4. **Cache shop catalog pages briefly**
   - Match: `URI Path starts with "/shop"` and Cookie does NOT contain `inv_p`
   - Edge TTL: 5 minutes
   - Browser TTL: 0
   - (Only for unauthenticated visitors — `inv_p` cookie skips cache)

## Step 6 — Page Rules (legacy interface, alternative to above)

If you prefer Page Rules over Cache Rules:

```
inventre.in/_next/static/*    → Cache Level: Cache Everything; Edge Cache TTL: 1 month
inventre.in/api/*             → Cache Level: Bypass
inventre.in/admin/*           → Cache Level: Bypass; Security Level: High
```

## Step 7 — Origin verification

Once Cloudflare is proxying, lock down the origin to only accept
Cloudflare's IPs. Update `/etc/ufw/before.rules` OR a separate ufw rule:

```bash
# Allow only Cloudflare's IPv4 ranges on 443
# https://www.cloudflare.com/ips-v4
for ip in $(curl -s https://www.cloudflare.com/ips-v4); do
  ufw allow from $ip to any port 443 proto tcp
done
ufw delete allow 443/tcp  # remove the open-to-world 443 rule
ufw reload
```

Also configure `nginx` to log the real client IP (Cloudflare sends it
via `CF-Connecting-IP`):

```nginx
# /etc/nginx/conf.d/cloudflare.conf
set_real_ip_from 173.245.48.0/20;
set_real_ip_from 103.21.244.0/22;
# ... (full list at https://www.cloudflare.com/ips-v4)
real_ip_header CF-Connecting-IP;
```

## Step 8 — Verify

```bash
# Hit a static asset twice; second hit should be a HIT
curl -sI "https://inventre.in/_next/static/chunks/main-app-xyz.js" | grep -i 'cf-cache-status'
# CF-Cache-Status: HIT   ← good

# Hit /api/health — should be DYNAMIC / BYPASS
curl -sI "https://inventre.in/api/health" | grep -i 'cf-cache-status'
# CF-Cache-Status: DYNAMIC   ← good
```

## Expected impact

| Metric | Before | After |
|---|---|---|
| Origin requests/min | 100% | 40-60% (static moves to edge) |
| Origin bandwidth | 100% | 30-40% |
| TTFB India (Mumbai PoP) | ~70 ms | ~15 ms |
| TLS handshake CPU | full | 0 (terminated at edge) |
| DDoS protection | none | Cloudflare WAF + Anti-bot |
