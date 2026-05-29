# Inventre Monitoring Stack

Prometheus + Grafana + node/postgres/redis/pgbouncer/cadvisor exporters.

## First-time setup

```bash
cd /root/Inventre

# Ensure Grafana admin password is set (in .env.deploy):
#   GRAFANA_ADMIN_PASSWORD=...
grep GRAFANA_ADMIN_PASSWORD .env.deploy || echo "GRAFANA_ADMIN_PASSWORD=$(openssl rand -base64 24)" >> .env.deploy

# Start the stack
docker compose -f deploy/monitoring/docker-compose.monitoring.yml \
  --env-file .env.deploy up -d

# Wait ~20s, then verify exporters are responding
curl -sS http://127.0.0.1:9090/-/healthy   # prometheus
docker exec inventre-prometheus wget -qO- http://postgres-exporter:9187/metrics | head -3
docker exec inventre-prometheus wget -qO- http://redis-exporter:9121/metrics | head -3
```

## Access

| URL | What |
|---|---|
| `http://<host>:3030` | **Grafana UI**, login `admin` / `$GRAFANA_ADMIN_PASSWORD` |
| `http://127.0.0.1:9090` | Prometheus (localhost-only — SSH-tunnel to access) |

To expose Grafana publicly, add to `/etc/nginx/sites-available/inventre`:

```nginx
server {
  listen 443 ssl http2;
  server_name grafana.inventre.in;
  ssl_certificate     /etc/letsencrypt/live/grafana.inventre.in/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/grafana.inventre.in/privkey.pem;

  location / {
    proxy_pass http://127.0.0.1:3030;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
  }
}
```
(certbot the new subdomain first.)

## Dashboards to import

After login, **Dashboards → Import** these IDs (built by the community):

| ID | Name | Source |
|---|---|---|
| **1860** | Node Exporter Full | host CPU/RAM/disk/network |
| **9628** | PostgreSQL Database | postgres-exporter metrics |
| **11835** | Redis Dashboard | redis-exporter |
| **893**  | Docker / cAdvisor | per-container CPU + mem |
| **18674** | PgBouncer Exporter | pgbouncer-exporter |

The provisioning files auto-wire Prometheus as the datasource so all
dashboards work as soon as you import them.

## What to alert on (Phase 2)

Configure these alerts in Grafana once the stack is settled:

1. **Redis `connected_clients > 50`** — leak detector (current healthy = 2-10)
2. **Postgres `active_connections > 25`** — pool exhaustion warning
3. **Host `cpu_idle < 20%` for 5 min** — sustained saturation
4. **Disk usage > 80%** — capacity warning
5. **Inventre app `/api/health` 5xx** — synthetic uptime check
6. **`pg_stat_statements` rows where mean_exec_time > 500ms** — slow query alert
