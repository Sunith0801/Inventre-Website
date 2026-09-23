# Rebuilding the production host from nothing

Single host, no failover (HLD finding F-10). This is the measured path back.
Target: storefront serving again within ~2 hours of a fresh Ubuntu box.

## What you need off the dead host
- Latest snapshot tarball `inventre-snapshot-<stamp>.tar.gz` (6-hourly, `scripts/snapshot-and-rotate.sh`):
  `db/inventre.dump` (pg_dump custom), `env/env.deploy.gpg` (AES-256, passphrase = `SNAPSHOT_PASSPHRASE`), `data.tar.gz` (MinIO volume).
  Off-host copy: Cloudflare R2 bucket `inventre-backups` **once the bucket + write token exist** (today the upload fails — see F-11).
- Nightly `db_backups/daily/inventre_<stamp>.dump` as a fallback.
- The repository (`/root/Inventre`, branch that is live: see `/api/version` → gitBranch/gitSha).
- The `SNAPSHOT_PASSPHRASE` (password manager).

## Steps
1. **Base**: Ubuntu LTS, `apt install docker.io docker-compose-plugin nginx certbot python3-certbot-nginx msmtp fail2ban`, key-only SSH, firewall: 22, 80, 443 only (`scripts/firewall-docker-ports.sh` closes Docker-published ports).
2. **Code**: clone the repo to `/root/Inventre`, check out the live commit. `npm ci`.
3. **Secrets**: `gpg -d env/env.deploy.gpg > .env.deploy`; `chmod 640 .env.deploy`.
4. **Data stores**: `docker compose -p inventre-deploy --env-file .env.deploy -f docker-compose.deploy.yml up -d postgres pgbouncer redis minio`.
   Restore: `docker exec -i inventre-deploy-postgres pg_restore -U inventre -d inventre --no-owner --no-acl < db/inventre.dump`.
   MinIO volume (optional, prod media is on R2): untar `data.tar.gz` into the `inventre-deploy_miniodata` volume.
5. **App**: `./scripts/deploy.sh` (full). It builds, recreates the app, runs migrations on boot, verifies build id + commit + headers.
6. **Edge**: copy `deploy/nginx.conf` to `/etc/nginx/sites-available/inventre`, set `server_name inventre.in www.inventre.in`, `proxy_pass http://127.0.0.1:3010`, enable, `certbot --nginx -d inventre.in -d www.inventre.in`.
7. **Cron**: `cp deploy/erp-cron.example /etc/cron.d/inventre-erp`, `cp deploy/cron.d/inventre-ground-stock /etc/cron.d/`, MCB imports (`scripts/cron-import-mcb*.sh` at 01:30 / 02:30), `scripts/backup-db.sh` 02:15, `scripts/snapshot-and-rotate.sh` 0,6,12,18, `scripts/monitor-production.sh` */10.
8. **Mail relay**: `/etc/msmtprc` (Office 365, Support@inventre.in) for monitor alerts.
9. **Partners**: DNS A record → new IP; CCAvenue redirect/cancel URLs unchanged; Audit ERP outbound IP allow-list if any; CCAvenue SFTP user `ccavenue-sftp` recreated with the chroot dir `/home/ccavenue-sftp/settlements` (bind-mounted into the app).
10. **Verify**: `./scripts/verify-deployment.sh`, `/api/health`, place a test order to the CCAvenue test page, confirm `erp-drain` log shows `sent`.

## Time budget (measured 2026-09-23 on the live host, extrapolated)
| Step | Minutes |
|---|---|
| Base packages + Docker | 15 |
| Clone + npm ci | 5 |
| Restore dump (≈ 1.4 GB DB) | 15–25 |
| deploy.sh full (cold cache) | 5 |
| nginx + certificate | 5 |
| Cron, mail, partners, verification | 20 |
| **Total** | **≈ 65–75, plan for 2 h** |
