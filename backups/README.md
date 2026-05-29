# Database Backups

This folder holds Postgres dumps of the local Inventre database.

## Files

- `inventre-YYYYMMDD-HHMMSS.sql` — plain SQL dump (run `--clean --if-exists`
  flags so it drops + recreates objects on restore). Includes schema and
  every row across 63 `COPY` blocks (schools, parents, students,
  products, variants, orders, content blocks, everything you've been
  editing).
- `inventre-YYYYMMDD-HHMMSS.sql.gz` — same file, gzipped (~4× smaller —
  use this for `scp` to the VPS).

## Restore on the VPS (after `bootstrap.sh` ran)

```bash
# 1) copy from your laptop to the VPS
scp backups/inventre-20260502-220613.sql.gz root@your.vps.ip:/tmp/

# 2) on the VPS — restore into the inventre database
gunzip -c /tmp/inventre-20260502-220613.sql.gz \
  | sudo -u postgres psql -d inventre

# (or if not gzipped)
sudo -u postgres psql -d inventre < /tmp/inventre-20260502-220613.sql
```

The dump uses `--no-owner --no-acl` so it restores cleanly under
whichever role owns the destination DB (e.g. the `inventre` role created
by bootstrap).

## Make a fresh dump

```bash
docker exec inventre-postgres pg_dump \
  -U inventre -d inventre \
  --no-owner --no-acl --clean --if-exists \
  > backups/inventre-$(date +%Y%m%d-%H%M%S).sql
gzip -k backups/inventre-*.sql
```

## Don't commit raw dumps

`backups/*.sql` and `backups/*.sql.gz` are in `.gitignore`. They contain
real customer data — keep them off GitHub.
