# Production Migration Playbook

End-to-end runbook for bringing Inventre up on a fresh server — whether
that's a new prod VPS (e.g., moving from Contabo to Hetzner / AWS /
DigitalOcean) or a beefy local box. Every step that we hardened during
the 2026-05 perf incident is included so the new host inherits the
exact same operational posture.

> **For local-laptop dev**, you don't need most of this — go to the
> [main README](../README.md) for the 5-step quick-start. This document
> is for **deploying a production server**.

---

## 0. Recommended VPS specs

| Resource | Minimum (current load) | Comfortable (5–10× growth) |
|---|---|---|
| vCPU | 8 cores | **12–16 cores** |
| RAM | 16 GB | **32–64 GB** |
| Disk | 200 GB NVMe | **500 GB – 1 TB NVMe** |
| Bandwidth | 10 TB/mo | 30 TB/mo |
| Network | 1 Gbps | 1 Gbps |
| Region | India (Mumbai/Delhi) for low latency | same |

**Current prod (Contabo) — 12 vCPU / 47 GB RAM / 484 GB / 1 Gbps** sits comfortably under load; CPU ~10–25% in steady state, RAM ~25%. Same class works for the next ~5× of traffic if the code-level perf fixes below are in place.

Notable: **needs `libseccomp ≥ 2.5.0`** (Ubuntu 24.04 has it; Ubuntu 22.04 needs a backport) and **Docker 25+** (we run 29.1.3).

---

## 1. Base OS preparation (Ubuntu 24.04 LTS)

```bash
# Update + essential packages
apt update && apt -y upgrade
apt -y install \
  curl wget git unzip jq htop iotop sysstat \
  ufw fail2ban logrotate \
  postgresql-client-16 \
  apache2-utils \
  certbot python3-certbot-nginx \
  build-essential

# Time sync — critical for HMAC verification on ERP webhooks
timedatectl set-timezone Asia/Kolkata
systemctl enable --now systemd-timesyncd

# Create swap (8 GB) — kernel safety net under burst load
fallocate -l 8G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo "/swapfile none swap sw 0 0" >> /etc/fstab
sysctl -w vm.swappiness=10
echo "vm.swappiness=10" >> /etc/sysctl.conf
```

---

## 2. Firewall (UFW)

```bash
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp comment "SSH"
ufw allow 80/tcp comment "HTTP (Let's Encrypt + redirect)"
ufw allow 443/tcp comment "HTTPS"
ufw --force enable

# Optional — if you want to expose the app's container port directly
# (we don't; nginx fronts everything):
# ufw allow 3010/tcp
```

Verify:
```bash
ufw status numbered
```

---

## 3. Docker + docker-compose

```bash
# Official Docker install — DO NOT use distro docker.io (too old).
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" \
  > /etc/apt/sources.list.d/docker.list
apt update
apt -y install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker

# Sanity check
docker version
docker compose version    # v2 plugin — DO NOT use `docker-compose` (v1, broken in some modern setups)
```

---

## 4. Node.js 20 LTS (for `next build` on host)

The deploy script builds on the host then syncs into the container, so the host needs a matching Node version.

```bash
# NodeSource — official binaries
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt -y install nodejs
node -v          # → v20.x
npm -v
```

---

## 5. Repository + secrets

```bash
mkdir -p /root && cd /root
git clone https://github.com/mahendrateja95/Inventre.git
cd Inventre
git checkout wip/tc-fees-payment-logs    # or main, whichever is canonical

# GitHub HTTPS auth — for future pulls/pushes
git config --global credential.helper store
printf 'https://YOUR_GH_USER:YOUR_GH_TOKEN@github.com\n' > ~/.git-credentials
chmod 600 ~/.git-credentials
```

### `.env.deploy` — production secrets (gitignored)

Copy the existing `.env.deploy` from the current production server, OR populate from `.env.example` and fill in:

```bash
# Required — generate random values:
AUTH_SECRET=$(openssl rand -base64 32)
JWT_SECRET=$(openssl rand -base64 32)
CRON_SECRET=$(openssl rand -hex 32)
CRON_TOKEN=$(openssl rand -hex 32)
CRON_KEY=$(openssl rand -hex 32)

# Cookies under plain HTTP (only if you serve over HTTP — we don't, TLS via nginx)
COOKIE_INSECURE=1                         # or 0 if pure HTTPS
ALLOW_INSECURE_COOKIES_IN_PROD=1

# App-public URL — what customers see
APP_PUBLIC_URL=https://inventre.in
NEXT_PUBLIC_APP_URL=https://inventre.in   # also set in docker-compose env

# CCAvenue (prod values from your merchant dashboard)
CCAVENUE_MERCHANT_ID=4314398
CCAVENUE_ACCESS_CODE=...
CCAVENUE_WORKING_KEY=...
CCAVENUE_API_BASE=https://secure.ccavenue.com
CCAVENUE_REDIRECT_URL=https://inventre.in/api/checkout/ccavenue/callback
CCAVENUE_CANCEL_URL=https://inventre.in/shop/checkout?status=cancelled

# OTP fixed code (used when /admin/settings/otp toggles real send OFF)
OTP_BYPASS_CODE=123456

# SMS — Arihant Global trans
SMS_API_URL=https://control.arihantglobal.in/fe/api/v1/send
SMS_API_USERNAME=...
SMS_API_PASSWORD=...

# SMTP — Office 365 with SMTP AUTH enabled on mailbox (see §11)
SMTP_HOST=smtp.office365.com
SMTP_PORT=587
SMTP_USER=Support@inventre.in
SMTP_PASS=...
EMAIL_FROM=Inventre <Support@inventre.in>

# Object storage (Cloudflare R2)
S3_ENDPOINT=https://<acct-id>.r2.cloudflarestorage.com
S3_REGION=auto
S3_BUCKET=inventre-media
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
S3_PUBLIC_URL=https://pub-<hash>.r2.dev

# ERP bridge
ERP_TARGET=staging                        # or "prod" when ready
STAGING_ERP_INGEST_URL=https://audit.inventre.in/api/ecom/ingest
STAGING_ERP_API_BASE_URL=https://audit.inventre.in
STAGING_ERP_WEBHOOK_SECRET=...
STAGING_ERP_POLL_USER=admin
STAGING_ERP_POLL_PASS=...

# Tuning (defaults are fine)
ERP_BUFFER_DELAY_SECONDS=180
ERP_DRAIN_INTERVAL_SECONDS=30
ERP_DRAIN_CHUNK_SIZE=50
ERP_DRAIN_MAX_ATTEMPTS=5
ERP_POLL_INTERVAL_SECONDS=60

# Grafana admin (only if running the monitoring stack — §10)
GRAFANA_ADMIN_PASSWORD=$(openssl rand -base64 24)
```

Make sure `chmod 600 .env.deploy`.

---

## 6. Install host-level dependencies for the deploy script

```bash
cd /root/Inventre
npm install                       # produces node_modules for the build step on host

# Native-binding workaround for @node-rs/bcrypt: the Alpine container
# needs the musl variant which npm filters out on glibc hosts.
# Fetch it explicitly so deploy.sh can ship it.
mkdir -p node_modules/@node-rs && cd node_modules/@node-rs
npm pack @node-rs/bcrypt-linux-x64-musl@1.10.7
tar -xzf node-rs-bcrypt-linux-x64-musl-1.10.7.tgz
mv package bcrypt-linux-x64-musl
rm node-rs-bcrypt-linux-x64-musl-1.10.7.tgz
cd /root/Inventre
ls node_modules/@node-rs/         # should show bcrypt + bcrypt-linux-x64-gnu + bcrypt-linux-x64-musl
```

---

## 7. Database — restore from prod dump

The cleanest migration path is a `pg_dump --format=custom` from the old server, restored on the new one.

### 7a. On the OLD server — take a fresh dump

```bash
TS=$(date +%Y%m%d-%H%M%S)
PGPASSWORD=inventre_prod pg_dump \
  -h localhost -p 55433 -U inventre -d inventre \
  -Fc --no-owner --no-privileges \
  -f /root/Inventre/backups/inventre_${TS}.dump
# Roughly ~100 MB at current scale; transfer via scp/rsync.
scp /root/Inventre/backups/inventre_${TS}.dump newuser@new-server:/tmp/
```

### 7b. On the NEW server — bring up postgres + restore

```bash
cd /root/Inventre

# Start ONLY postgres + pgbouncer first (no app yet)
docker compose -p inventre-deploy --env-file .env.deploy \
  -f docker-compose.deploy.yml up -d postgres pgbouncer redis minio

# Wait for postgres healthcheck
docker compose -p inventre-deploy -f docker-compose.deploy.yml ps

# Restore the dump (use direct postgres port 55433, not pgbouncer)
PGPASSWORD=inventre_prod pg_restore \
  -h localhost -p 55433 -U inventre -d inventre \
  --no-owner --no-privileges --jobs=4 \
  /tmp/inventre_20260526-XXXXXX.dump
```

### 7c. Critical post-restore DBA tasks ★

These are what we added during the 2026-05 perf work. Skip none of them.

```bash
PGPASSWORD=inventre_prod psql -h localhost -p 55433 -U inventre -d inventre <<'SQL'

-- 1. pg_stat_statements extension (Postgres restart required after this)
ALTER SYSTEM SET shared_preload_libraries = 'pg_stat_statements';
ALTER SYSTEM SET pg_stat_statements.track = 'top';
ALTER SYSTEM SET pg_stat_statements.max = 5000;
SELECT pg_reload_conf();

-- 2. The 7 missing indexes (cuts checkout + listing query times)
CREATE INDEX CONCURRENTLY IF NOT EXISTS invoice_items_invoice_id_idx ON invoice_items (invoice_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS payments_order_id_idx        ON payments (order_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS payments_gateway_order_id_idx ON payments (gateway_order_id) WHERE gateway_order_id IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS orders_parent_id_idx          ON orders (parent_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS orders_student_id_idx         ON orders (student_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS order_items_order_id_idx      ON order_items (order_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS parents_phone_last10_idx
  ON parents (right(regexp_replace(coalesce(phone,''), '\D', '', 'g'), 10));

-- 3. Drop the erp_src duplicate schema (272 MB of dead weight)
DROP SCHEMA IF EXISTS erp_src CASCADE;

-- 4. Apply the partial drain index migration
\i db/migrations/0033_delivery_fee_rules.sql
\i db/migrations/0034_erp_webhook_events_drain_index.sql

-- 5. Verify
\dt erp_src.*
SELECT count(*) FROM pg_indexes WHERE indexname IN (
  'invoice_items_invoice_id_idx','payments_order_id_idx','payments_gateway_order_id_idx',
  'orders_parent_id_idx','orders_student_id_idx','order_items_order_id_idx','parents_phone_last10_idx',
  'erp_webhook_events_drain_idx'
);
SQL

# Restart postgres for shared_preload_libraries to take effect
docker compose -p inventre-deploy -f docker-compose.deploy.yml restart postgres
sleep 6

# Now activate the extension
PGPASSWORD=inventre_prod psql -h localhost -p 55433 -U inventre -d inventre \
  -c "CREATE EXTENSION IF NOT EXISTS pg_stat_statements;"
```

> **Note on PgBouncer pool size**: the compose file ships with
> `DEFAULT_POOL_SIZE=50` (bumped from 25 during the 2026-05 incident).
> Don't lower it — webhook bursts saturate the smaller pool. The app's
> client-side pool is 30 connections (`db/client.ts`), and the cron
> isolated pool is another 8 (`dbCron` proxy in the same file).

---

## 8. Nginx + Let's Encrypt

The current prod nginx config lives at `/etc/nginx/sites-available/inventre`. Reproduce on the new host:

```bash
apt -y install nginx
ufw allow 'Nginx Full'

# Bring up the HTTP-only blocks first so certbot can do ACME challenges
cat > /etc/nginx/sites-available/inventre <<'NGINX'
# ─── inventre.in + www (prod) ─────────────────────────────────────
server {
  listen 80;
  listen [::]:80;
  server_name inventre.in www.inventre.in;
  client_max_body_size 512M;
  location /_next/static/ {
    proxy_pass http://127.0.0.1:3010;
    proxy_set_header Host $host;
    proxy_cache_valid 200 365d;
    expires 365d;
    add_header Cache-Control "public, immutable";
  }
  location / {
    proxy_pass http://127.0.0.1:3010;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;
    proxy_read_timeout 300s;
  }
}

# ─── test.inventre.in (staging, optional) ──────────────────────────
# Same as above with `server_name test.inventre.in;`

# ─── Default :80 sink — drop stray Host headers ───────────────────
server {
  listen 80 default_server;
  listen [::]:80 default_server;
  server_name _;
  return 444;
}
NGINX

ln -sf /etc/nginx/sites-available/inventre /etc/nginx/sites-enabled/
nginx -t && systemctl restart nginx

# Issue + install TLS for each domain
certbot --nginx -d inventre.in -d www.inventre.in \
  --non-interactive --agree-tos --email support@inventre.in --redirect

# (optional) staging subdomain
# certbot --nginx -d test.inventre.in --non-interactive --agree-tos --email support@inventre.in --redirect
```

### nginx auto-restart on SIGSEGV ★

Kernel 6.8.x on Ubuntu 24.04 has a bug producing segfaults at `ip=0x20a6` across cron / sh / sleep / nginx. Until you reboot into a newer kernel, configure nginx to auto-recover:

```bash
mkdir -p /etc/systemd/system/nginx.service.d
cat > /etc/systemd/system/nginx.service.d/restart-on-failure.conf <<'EOF'
[Service]
Restart=on-failure
RestartSec=2s
StartLimitIntervalSec=60
StartLimitBurst=10
EOF
systemctl daemon-reload
systemctl restart nginx
```

---

## 9. Cron jobs

Production has 5 cron-driven backend tasks. Reproduce the file:

```bash
cat > /etc/cron.d/inventre-erp <<'CRON'
# Inventre ERP bridge crons.
CRON_SECRET=<paste value of CRON_SECRET from .env.deploy>
CRON_TOKEN=<paste value of CRON_TOKEN from .env.deploy>
CRON_KEY=<paste value of CRON_KEY from .env.deploy>

# ERP drainer (storefront → ERP buffered events): every 30s
*/1 * * * * root  curl -fsS -m 30 -X POST -H "Authorization: Bearer $CRON_TOKEN" http://127.0.0.1:3010/api/cron/erp-drain >> /var/log/inventre-erp-drain.log 2>&1
*/1 * * * * root  sleep 30; curl -fsS -m 30 -X POST -H "Authorization: Bearer $CRON_TOKEN" http://127.0.0.1:3010/api/cron/erp-drain >> /var/log/inventre-erp-drain.log 2>&1

# ERP poll (ERP → storefront delta sync): every 60s
*/1 * * * * root  curl -fsS -m 60 -X POST -H "Authorization: Bearer $CRON_TOKEN" http://127.0.0.1:3010/api/cron/erp-poll >> /var/log/inventre-erp-poll.log 2>&1

# Webhook drain (queue-async receiver pattern): every 30s
*/1 * * * * root  curl -fsS -m 30 -X GET -H "Authorization: Bearer $CRON_TOKEN" http://127.0.0.1:3010/api/cron/erp-webhook-drain >> /var/log/inventre-erp-webhook-drain.log 2>&1
*/1 * * * * root  sleep 30; curl -fsS -m 30 -X GET -H "Authorization: Bearer $CRON_TOKEN" http://127.0.0.1:3010/api/cron/erp-webhook-drain >> /var/log/inventre-erp-webhook-drain.log 2>&1

# CCAvenue reconcile (catches stuck-pending payments): every 5min
*/5 * * * * root  curl -fsS -m 30 -X GET -H "Authorization: Bearer $CRON_SECRET" http://127.0.0.1:3010/api/cron/ccavenue-reconcile >> /var/log/inventre-ccavenue-reconcile.log 2>&1

# Retry failed outbound webhook deliveries: every 2min
*/2 * * * * root  curl -fsS -m 30 -X GET -H "Authorization: Bearer $CRON_SECRET" http://127.0.0.1:3010/api/cron/retry-webhooks >> /var/log/inventre-retry-webhooks.log 2>&1

# Item catalog sync from ERP: every 30min
*/30 * * * * root  curl -fsS -m 60 -X GET -H "X-Cron-Key: $CRON_KEY" http://127.0.0.1:3010/api/cron/sync-items >> /var/log/inventre-sync-items.log 2>&1
CRON
chmod 644 /etc/cron.d/inventre-erp
```

### Redis connection-count monitor cron ★

Alerts via syslog if connected_clients exceeds 100 (catches a regression of the 2026-05 leak).

```bash
cat > /etc/cron.d/inventre-redis-monitor <<'CRON'
SHELL=/bin/bash
PATH=/usr/local/bin:/usr/bin:/bin
*/5 * * * * root  n=$(docker exec inventre-deploy-redis redis-cli info clients 2>/dev/null | awk -F: '/^connected_clients/ {gsub(/\r/,""); print $2}'); [ -z "$n" ] && exit 0; if [ "$n" -gt 100 ]; then logger -t inventre-redis-monitor -p user.err "Redis leak: connected_clients=$n"; echo "$(date -Iseconds) connected_clients=$n" >> /var/log/inventre-redis-monitor.log; fi
CRON
chmod 644 /etc/cron.d/inventre-redis-monitor
```

### Logrotate config ★

```bash
cat > /etc/logrotate.d/inventre <<'CONF'
/var/log/inventre-*.log {
  daily
  rotate 7
  compress
  delaycompress
  notifempty
  missingok
  copytruncate
  size 100M
}
CONF
logrotate -d /etc/logrotate.d/inventre   # dry-run check
```

---

## 10. Build + start the app

```bash
cd /root/Inventre
./scripts/deploy.sh                        # full mode — recreates compose + builds + starts
# (~5–10 min total on first run; 2–3 min for code-only --fast updates)
```

The deploy script:
1. Runs `npm run build` on the host (Node 20)
2. `docker compose up --no-deps --force-recreate app` to apply compose changes
3. **Reconnects** the app container to `inventre-deploy_default` network (compose `--no-deps` sometimes drops it)
4. Copies the build artifact into the container
5. Ships the @node-rs/bcrypt musl binding (Alpine needs it)
6. Restarts the container, waits for ready signal

Verify the site is up:
```bash
curl -sI http://127.0.0.1:3010/api/health        # local
curl -sI https://inventre.in/api/health          # public
docker ps                                         # all green
docker exec inventre-deploy-app sh -c 'wget -qO- http://127.0.0.1:3000/api/health'
```

---

## 11. Office 365 SMTP setup ★

Required for the mobile-recovery email flow.

1. **Enable SMTP AUTH on the mailbox** — Microsoft 365 Admin → Active Users → Support@inventre.in → Mail → Manage email apps → **Authenticated SMTP** = ON. Defaults to OFF since 2022.
2. If MFA is on the account, **generate an App Password** at https://mysignins.microsoft.com/security-info and use it as `SMTP_PASS` (not the regular password).
3. `EMAIL_FROM` must match the authenticated mailbox — Office 365 rejects "send as" by default. `EMAIL_FROM=Inventre <Support@inventre.in>` works because the mailbox is `Support@inventre.in`.
4. Smoke test from the new host:
   ```bash
   npx tsx scripts/test-smtp.ts you@example.com
   # → ok: <message-id>
   ```

---

## 12. CCAvenue setup ★

1. In your CCAvenue prod merchant dashboard → **Settings → URL Settings**:
   - Whitelist `https://inventre.in/api/checkout/ccavenue/callback`
   - Whitelist `https://inventre.in/shop/checkout?status=cancelled`
2. Confirm IP whitelisting (if your merchant has it enabled) — add the new server's outbound IP for the Status API.
3. Test mode uses `CCAVENUE_API_BASE=https://test.ccavenue.com`. Prod is `secure.ccavenue.com` and is auto-mapped to `api.ccavenue.com` for the Status API by `lib/ccavenue.ts:resolveStatusApiBase()`.

---

## 13. DNS cutover

Final step before flipping users to the new server:

```
A     inventre.in            → <new-server-ip>
A     www.inventre.in        → <new-server-ip>
A     test.inventre.in       → <new-server-ip>   (staging, optional)
A     grafana.inventre.in    → <new-server-ip>   (if you're running monitoring)
```

Set TTL low (60 s) on these records 24h BEFORE cutover so propagation is fast. Switch the A records after the new server passes the §10 health checks.

---

## 14. (Optional) Observability stack

Adds Prometheus + Grafana + 6 exporters running on the same host. The provisioning files auto-wire Prometheus as Grafana's data source so community dashboards work after one click.

```bash
cd /root/Inventre
docker compose -f deploy/monitoring/docker-compose.monitoring.yml \
  --env-file .env.deploy up -d
```

Then add an nginx vhost + Let's Encrypt for `grafana.inventre.in` (covered in `deploy/monitoring/README.md`) so the UI is HTTPS.

Dashboards to import (UI → Dashboards → New → Import):
- **1860** Node Exporter Full
- **9628 / 39** PostgreSQL Database
- **11835** Redis Dashboard
- **VI-m_RzVk** Blackbox exporter — multiple locations (auto-imported via grafana.com)

The Grafana service has `GF_INSTALL_PLUGINS=grafana-polystat-panel` so the polystat plugin (used by the Blackbox dashboard) is auto-installed.

---

## 15. Kernel update (real fix for the segfaults)

Ubuntu 24.04 with kernel `6.8.0-106-generic` produces `ip=0x20a6` segfaults in cron, sh, sleep, and nginx. The systemd auto-restart in §8 is a stopgap; the proper fix is a kernel update.

Schedule a 5-minute maintenance window:
```bash
apt update
apt list --upgradable | grep linux-image
apt -y install linux-image-generic     # picks up the latest 6.8.x or 6.9.x
reboot
```
Containers come back automatically (`restart: unless-stopped`). After the reboot you can `dmesg | grep segfault | tail` to confirm the bug is gone.

---

## 16. Post-deploy verification checklist ★

Walk through these — they are the symptoms we hardened against during the 2026-05 incident. All should be GREEN.

```bash
# A. Redis singleton fix — connected_clients should be ≤10, stable
for i in 1 2 3; do
  docker exec inventre-deploy-redis redis-cli info clients | grep connected_clients
  sleep 5
done

# B. DB pool sizes (app → pgbouncer → postgres)
PGPASSWORD=inventre_prod psql -h localhost -p 6433 -U inventre -d pgbouncer -c "SHOW pools" | head -5  # pgbouncer
docker inspect inventre-deploy-pgbouncer --format '{{json .Config.Env}}' | grep -o 'DEFAULT_POOL_SIZE=[0-9]*'  # should be 50
grep -E "max:\s*30" db/client.ts                                  # app pool

# C. Indexes present
PGPASSWORD=inventre_prod psql -h localhost -p 55433 -U inventre -d inventre -c "
SELECT count(*) FROM pg_indexes WHERE indexname IN
  ('invoice_items_invoice_id_idx','payments_order_id_idx',
   'payments_gateway_order_id_idx','orders_parent_id_idx',
   'orders_student_id_idx','order_items_order_id_idx',
   'parents_phone_last10_idx','erp_webhook_events_drain_idx');"   # should be 8

# D. pg_stat_statements live
PGPASSWORD=inventre_prod psql -h localhost -p 55433 -U inventre -d inventre -c \
  "SELECT count(*) FROM pg_stat_statements"

# E. Response times
for p in / /api/health /shop /login; do
  echo -n "$p  "
  curl -sS -o /dev/null -w "%{http_code} %{time_total}s\n" https://inventre.in$p
done

# F. App healthcheck
docker inspect inventre-deploy-app --format '{{.State.Health.Status}}'  # should be "healthy"

# G. Webhook drain endpoint works fast
CRON_TOKEN=$(grep -oP '(?<=^CRON_TOKEN=).+' .env.deploy)
curl -sS -H "Authorization: Bearer $CRON_TOKEN" \
  http://127.0.0.1:3010/api/cron/erp-webhook-drain
# → {"ok":true,"claimed":0,"processed":0,"errored":0,"durationMs":<200}

# H. Swap + swappiness
swapon --show
sysctl vm.swappiness        # should be 10

# I. nginx auto-restart configured
systemctl show nginx -p Restart    # should be "on-failure"

# J. Cron entries present
ls /etc/cron.d/inventre-*
```

---

## 17. What we hardened — full inventory

The code in this branch contains every performance fix from the 2026-05 production audit:

### In source code (already in the repo — nothing extra to do)
- `lib/redis.ts` — globalThis singleton ALWAYS cached (was prod-only-broken); `retryStrategy`, `reconnectOnError` (drops on EPIPE/ETIMEDOUT/ECONNRESET), `keepAlive: 30 s`, `connectTimeout: 10 s`
- `db/client.ts` — same singleton fix; `max: 30` client pool (was 10); `dbCron` isolated pool (max: 8) for cron workloads
- `lib/erp/client.ts` — 8 s `AbortSignal.timeout` per attempt (was unbounded; previously caused 2-minute coupon-create hangs on the dead ERP host)
- `lib/erp/delivery-fee-rules.ts` — fully local DB, no more ERPNext calls
- `lib/numbering.ts` — `allocOrderNumber` skips the expensive `latestSalOrd` re-seed when counter is < 60 s fresh
- `lib/ccavenue.ts` — mapper accepts both `Success`/`Successful` enums
- `lib/ccavenue-finalize.ts` — stock-decrement failure does NOT downgrade order status (paid = confirmed, period)
- `lib/erp-webhook-dispatch.ts` — batched dispatcher; `deriveStatusForErpOrderName` deduped per chunk
- `app/api/erp/webhooks/route.ts` — insert-only receiver (returns 200 in ms)
- `app/api/cron/erp-webhook-drain/route.ts` — async drain with `FOR UPDATE SKIP LOCKED` using `dbCron` pool
- `next.config.mjs` — `serverExternalPackages: ['@node-rs/bcrypt']` so build doesn't hang on native module trace
- `package.json` — `@node-rs/bcrypt` (native Rust) replaces `bcryptjs` (pure JS); worker-thread bcrypt unblocks the event loop under concurrent login
- `docker-compose.deploy.yml` — pgbouncer `DEFAULT_POOL_SIZE=50` (was 25); app `stop_grace_period: 25 s`; app healthcheck on `127.0.0.1:3000` (IPv4 explicit — Alpine resolves `localhost` to IPv6 first but Next binds IPv4); MinIO healthcheck disabled (seccomp incompatibility)
- `scripts/deploy.sh` — auto-reconnects app to default network after compose recreate; ships musl bcrypt binding explicitly; cleaner success banner

### In server-side config (apply per §1-§9 above)
- 8 GB swap + `vm.swappiness=10`
- UFW (22 / 80 / 443 only)
- nginx `Restart=on-failure` systemd override
- `/etc/cron.d/inventre-erp` with 7 scheduled jobs
- `/etc/cron.d/inventre-redis-monitor` (alerts on connection-leak regression)
- `/etc/logrotate.d/inventre`

### In the database (apply per §7c above)
- 8 indexes added: `invoice_items_invoice_id_idx`, `payments_order_id_idx`, `payments_gateway_order_id_idx`, `orders_parent_id_idx`, `orders_student_id_idx`, `order_items_order_id_idx`, `parents_phone_last10_idx`, `erp_webhook_events_drain_idx`
- `pg_stat_statements` extension installed (query-level perf visibility)
- `erp_src` schema dropped (272 MB / 52 dead tables removed)
- Migration `0033` adds `delivery_fee_rules` local table
- Migration `0034` adds partial index for the webhook drain queue

---

## 18. Where to read deeper

- [`deploy/replicas/postgres-replica-setup.md`](./replicas/postgres-replica-setup.md) — adding a streaming read replica
- [`deploy/replicas/redis-sentinel-setup.md`](./replicas/redis-sentinel-setup.md) — Redis HA pair with Sentinel
- [`deploy/cdn/cloudflare-setup.md`](./cdn/cloudflare-setup.md) — putting Cloudflare in front (cuts ~30–40 % nginx load)
- [`deploy/monitoring/README.md`](./monitoring/README.md) — running the Prometheus + Grafana stack
