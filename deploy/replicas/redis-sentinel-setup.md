# Redis Sentinel + replica — setup guide

**Goal:** turn the single Redis instance (`inventre-deploy-redis`) into an
HA pair with automatic failover via Sentinel. The 2026-05-26 connection
leak showed Redis is currently a single point of failure — when it gets
wedged, the entire app goes down.

This guide does NOT bring the replica up unilaterally (needs DNS +
network coordination). Apply each step in order.

## Topology

```
          ┌────────┐                  ┌────────┐
          │ Redis  │ ←── replication ─│ Redis  │
          │ master │  (port 6379)     │replica │
          └────────┘                  └────────┘
              ▲                          ▲
              │                          │
      ┌───────┴───────┐         ┌────────┴───────┐
      │   Sentinel    │ ←─────→ │   Sentinel     │
      │   (quorum 2)  │         │   (quorum 2)   │
      └───────────────┘         └────────────────┘
              ↑
              │ MONITOR + auto-promote on master failure
              │
         ┌────┴────┐
         │   App   │  (ioredis with sentinel discovery)
         └─────────┘
```

For a true quorum we need at LEAST 3 Sentinel processes; common patterns:
- **3 hosts**: each runs Sentinel + one runs Redis master, another runs
  the replica. Cleanest for prod.
- **2 hosts + arbiter**: master + replica on real VPSes, 3rd Sentinel on
  a tiny "arbiter" VPS (€3/mo). Cheaper, equally safe.

## Step 1 — Provision the second VPS

Specs to match: 4 cores, 4 GB RAM. Redis itself is RAM-light but Sentinel
needs uninterrupted network.

## Step 2 — Master config

Edit `docker-compose.deploy.yml` Redis service:

```yaml
  redis:
    command: >
      redis-server
        --appendonly yes
        --maxmemory 512mb
        --maxmemory-policy allkeys-lru
        --replica-read-only no
        --requirepass ${REDIS_PASSWORD}
        --masterauth ${REDIS_PASSWORD}
```

Add to `.env.deploy`:
```
REDIS_PASSWORD=<openssl rand -base64 24>
```

Restart Redis container.

## Step 3 — Replica VPS

```yaml
# docker-compose.redis-replica.yml on the replica VPS
services:
  redis:
    image: redis:7-alpine
    container_name: redis-replica
    restart: unless-stopped
    command: >
      redis-server
        --appendonly yes
        --replicaof <MASTER_IP> 6379
        --replica-read-only yes
        --masterauth ${REDIS_PASSWORD}
        --requirepass ${REDIS_PASSWORD}
    ports: ["6379:6379"]
```

## Step 4 — Sentinel config (3 instances)

Each sentinel host runs:

```
# sentinel.conf
port 26379
sentinel monitor inventre <MASTER_IP> 6379 2
sentinel down-after-milliseconds inventre 5000
sentinel failover-timeout inventre 60000
sentinel parallel-syncs inventre 1
sentinel auth-pass inventre <REDIS_PASSWORD>
```

The `2` quorum means 2 Sentinels must agree the master is down before
promoting a replica.

## Step 5 — App uses Sentinel discovery

Update `lib/redis.ts`:

```ts
const sentinels = (process.env.REDIS_SENTINELS ?? "")
  .split(",").filter(Boolean)
  .map((s) => { const [host, port] = s.split(":"); return { host, port: Number(port) }; });

const client = sentinels.length > 0
  ? new Redis({
      sentinels,
      name: "inventre",
      password: process.env.REDIS_PASSWORD,
      sentinelPassword: process.env.REDIS_SENTINEL_PASSWORD,
      retryStrategy: ...,
      reconnectOnError: ...,
    })
  : new Redis(url, { ... });   // current single-instance fallback
```

Add to `.env.deploy`:
```
REDIS_SENTINELS=sentinel1.internal:26379,sentinel2.internal:26379,sentinel3.internal:26379
```

## Step 6 — Verify failover

```bash
# Force failover:
docker exec sentinel-1 redis-cli -p 26379 sentinel failover inventre

# Watch app log — it should reconnect to the new master within ~10s
# (ioredis sentinel discovery is automatic).
```

## Operational considerations

- **Persistence:** keep `--appendonly yes` on both master and replica. AOF
  + RDB combo on the master, AOF on the replica.
- **Network:** put master/replica/sentinels on a private VLAN if your
  provider supports it. Otherwise UFW-block 6379 to only the known IPs.
- **Backups:** master's AOF gets backed up by your regular VPS snapshots.
  Don't rely on the replica for backups — it's an HA tool, not a backup.
