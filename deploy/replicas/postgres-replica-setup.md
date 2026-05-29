# Postgres streaming replica — setup guide

**Goal:** add one warm standby to the existing Postgres primary
(`inventre-deploy-postgres`). Read-only failover target + offload heavy
read queries (Drizzle Studio, admin reports) without touching the
primary.

This guide does NOT bring up the replica unilaterally — it requires:
- a second VPS (recommended specs at the bottom), OR
- a second Docker host on the same network
- DNS / firewall coordination

## Step 1 — Primary configuration (current host)

Apply on the EXISTING `inventre-deploy-postgres` container:

```sql
-- WAL settings for streaming replication
ALTER SYSTEM SET wal_level = 'replica';
ALTER SYSTEM SET max_wal_senders = 5;
ALTER SYSTEM SET max_replication_slots = 5;
ALTER SYSTEM SET wal_keep_size = '1GB';
ALTER SYSTEM SET hot_standby = on;

-- Replication user
CREATE ROLE replicator WITH REPLICATION LOGIN PASSWORD 'CHANGE_ME_RANDOM_32_CHARS';

-- Create a replication slot the replica will use
SELECT pg_create_physical_replication_slot('inventre_replica_1');
```

Edit `pg_hba.conf` inside the container to allow the replica's IP:
```
host  replication  replicator  <REPLICA_IP>/32  scram-sha-256
```

Restart primary postgres for `wal_level` to take effect.

## Step 2 — Replica VPS

Spin up a VPS with **at least matching specs** (8c/16GB RAM/200GB NVMe).
Install Docker + docker-compose.

On the replica VPS:
```bash
# Base backup from primary
docker run --rm -v pgdata_replica:/var/lib/postgresql/data postgres:16-alpine \
  bash -c "pg_basebackup -h <PRIMARY_HOST> -U replicator -p 55433 \
           -D /var/lib/postgresql/data -P -X stream -R \
           -S inventre_replica_1"
```

`pg_basebackup -R` creates `standby.signal` and `postgresql.auto.conf`
with `primary_conninfo` pre-configured.

## Step 3 — Replica compose

Use `deploy/replicas/docker-compose.postgres-replica.yml` (template
included in this dir).

## Step 4 — Wire app to read from replica

Two read-path options:

**Option A — Single REPLICA_URL env, app routes reads explicitly:**
```env
DATABASE_URL=postgres://...primary...
DATABASE_REPLICA_URL=postgres://...replica...
```

Then in `db/client.ts`, add a parallel `dbReplica` proxy and use it from:
- `/admin/reports/*` (heavy reads)
- `/admin/orders` listing
- Anywhere admin-facing reads aggregate stats

**Option B — Use Pgpool-II in front:**
- Pgpool routes SELECTs to replica, writes to primary
- Transparent to the app
- Requires extra container + connection tuning

Recommend **Option A** for now — explicit is safer than transparent.

## Step 5 — Monitor lag

```sql
-- On replica:
SELECT now() - pg_last_xact_replay_timestamp() AS replication_lag;
-- Should be < 5 seconds under normal load.
```

Add a Grafana alert: lag > 30s → page someone.

## Failover

To promote replica to primary:
```sql
SELECT pg_promote();
```
Then re-point the app's `DATABASE_URL` and rebuild a new replica from
the new primary. (No automatic failover — that needs Patroni.)
