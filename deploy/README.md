# Deploying Inventre to a Contabo VPS

There are two supported deploy paths. **Pick one — don't mix them.**

## Path A — Docker stack (recommended)

Everything (Postgres, PgBouncer, Redis, MinIO, app) runs in containers
defined by `docker-compose.deploy.yml`. Use the wrappers so all services
land on a single docker network and the secrets in `.env.deploy` are
loaded:

```bash
deploy/up.sh           # start / recreate the stack
deploy/up.sh --build app   # rebuild app image only
deploy/down.sh         # stop the stack (volumes preserved)
deploy/down.sh --volumes   # also drop pgdata / redisdata / miniodata
```

The wrappers always pass `-p inventre-deploy --env-file .env.deploy`.
Running `docker compose ... up` directly without those flags will
re-create the network split that broke login (app on one network,
redis/postgres on another) and fail with `EAI_AGAIN redis`.

App is exposed on `http://<host>:3010`. Make sure `.env.deploy` exists
at the repo root with `AUTH_SECRET` and `JWT_SECRET` set.

## Path B — PM2 + system services (legacy)

Three files do the work:

- `bootstrap.sh` — installs Node 20, Postgres 16, Redis, Nginx, certbot,
  PM2; creates the DB; clones the repo to `/opt/inventre`. Run **once** on
  a fresh VPS.
- `release.sh` — pulls latest code, applies schema, builds, restarts via
  PM2. Run on **every deploy**.
- `nginx.conf` — reverse-proxy config; copy to `/etc/nginx/sites-available/inventre`.

The rest of this document covers Path B.

---

## One-time setup

SSH to the VPS as root:

```bash
ssh root@your.vps.ip
curl -fsSL https://raw.githubusercontent.com/mahendrateja95/Inventre/main/deploy/bootstrap.sh \
  | DB_PASS='choose-a-strong-password' bash
```

Bootstrap will print the `DATABASE_URL` it generated.

### Move data over

On your **local** machine:

```bash
# from C:/Users/Hp/Downloads/inventre — assumes Docker stack is up
docker compose exec postgres pg_dump -U inventre -d inventre --no-owner --no-acl \
  | gzip > inventre-data.sql.gz

scp inventre-data.sql.gz root@your.vps.ip:/tmp/
```

On the **VPS**:

```bash
gunzip -c /tmp/inventre-data.sql.gz | sudo -u postgres psql -d inventre
```

This restores schools, products, parents, students, orders, content
blocks — everything you've been editing locally.

### Set environment variables

Copy `.env.local` from your laptop to `/opt/inventre/.env.local` on the
VPS. Edit it to match the new environment:

```env
# Database (from bootstrap output)
DATABASE_URL=postgres://inventre:STRONG_PASS@127.0.0.1:5432/inventre

# Redis (local on the VPS)
REDIS_URL=redis://127.0.0.1:6379

# App
NEXT_PUBLIC_BASE_URL=https://yourdomain.com
SESSION_SECRET=<run: openssl rand -hex 32>

# CCAvenue (production credentials)
CCAVENUE_MERCHANT_ID=...
CCAVENUE_ACCESS_CODE=...
CCAVENUE_WORKING_KEY=...
CCAVENUE_API_BASE=https://secure.ccavenue.com
CCAVENUE_REDIRECT_URL=https://yourdomain.com/api/checkout/ccavenue/callback
CCAVENUE_CANCEL_URL=https://yourdomain.com/checkout/cancel

# S3 / R2 for image uploads
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
S3_BUCKET=...
S3_REGION=...
S3_ENDPOINT=...
S3_PUBLIC_BASE_URL=...

# SMS (whichever provider you use)
SMS_API_KEY=...

# ERPNext (only if you still sync from ERP)
ERP_BASE_URL=https://erp.inventre.in
ERP_API_KEY=...
ERP_API_SECRET=...
```

### First deploy

```bash
cd /opt/inventre
bash deploy/release.sh
```

This applies any pending schema, builds, and starts under PM2 on
127.0.0.1:3000.

### Nginx + SSL

```bash
cp /opt/inventre/deploy/nginx.conf /etc/nginx/sites-available/inventre
# edit server_name to your real domain
nano /etc/nginx/sites-available/inventre

ln -s /etc/nginx/sites-available/inventre /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

certbot --nginx -d yourdomain.com -d www.yourdomain.com
```

certbot auto-rewrites the config to listen on 443 + sets up auto-renew.

---

## Subsequent deploys

```bash
ssh root@your.vps.ip
cd /opt/inventre
bash deploy/release.sh
```

Or wire it to GitHub Actions — push to main → SSH in → run `release.sh`.

---

## Health checks

```bash
pm2 status              # is the app up?
pm2 logs inventre --lines 100
systemctl status postgresql redis-server nginx
curl -I https://yourdomain.com    # 200 OK?
```

## Rollback

```bash
cd /opt/inventre
git log --oneline -5            # find the previous good commit
git reset --hard <sha>
bash deploy/release.sh
```

---

## What happens to your local data?

Nothing — `pg_dump` is read-only. Your laptop's Docker Postgres keeps
running. The VPS gets a snapshot. From here, the VPS is the source of
truth; treat your laptop as a dev mirror.
