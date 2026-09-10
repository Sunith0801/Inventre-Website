#!/bin/bash
#
# Keep Docker's published database, cache and object-store ports off the
# public internet.
#
# WHY THIS IS NEEDED AT ALL. ufw on this host is default-deny and allows only
# 22, 80, 443 and 3020. That is not enough, because Docker publishes ports by
# writing its own iptables rules, and the FORWARD chain is ordered:
#
#     -A FORWARD -j DOCKER-USER      <- this file's rules
#     -A FORWARD -j DOCKER-FORWARD   <- Docker's ACCEPT
#     -A FORWARD -j ufw-before-forward   <- never reached
#
# Docker's decision is made before ufw is consulted, so a container published
# on 0.0.0.0 is reachable from the internet no matter what ufw says. On
# 2026-09-10 that meant, live:
#
#   * PostgreSQL on 55433 and pgbouncer on 6433, guarded by a password that
#     has been in the git history since the first commit;
#   * Redis on 6390 with NO requirepass at all — `redis-cli ping` answered
#     PONG. Unauthenticated Redis is a standard route to root: CONFIG SET dir
#     plus SAVE writes an authorized_keys or a cron entry. This host had
#     already been compromised twice in 2026;
#   * MinIO on 9000/9001 and 9010/9011, legacy — storage moved to Cloudflare
#     R2 (S3_ENDPOINT points at r2.cloudflarestorage.com).
#
# WHAT THE RULES DO NOT AFFECT. They match on `-i eth0` only, so:
#   * the app reaching pgbouncer and redis over the docker bridge by hostname
#     (postgres://…@pgbouncer:5432, redis://redis:6379) is untouched;
#   * host-side access to localhost:6433 and localhost:55433 — which
#     scripts/deploy.sh uses for the build — is untouched. Both were verified
#     working after the rules were applied.
#
# Ports are the CONTAINER-side ports (5432, 6379, 9000, 9001), not the
# published ones, because DNAT has already rewritten the destination by the
# time DOCKER-USER sees the packet. That is why one rule covers every
# Postgres on this box: prod, dev and staging all map to 5432 internally.
#
# Idempotent: safe to run repeatedly, and run at boot by
# inventre-firewall.service because iptables rules do not survive a reboot and
# iptables-persistent is not installed.
#
set -uo pipefail

IFACE="${PUBLIC_IFACE:-eth0}"

block() {
  local port="$1" why="$2"
  # -C tests for an identical rule; only insert when absent.
  if ! iptables -C DOCKER-USER -i "$IFACE" -p tcp --dport "$port" -j DROP \
       -m comment --comment "$why" 2>/dev/null; then
    iptables -I DOCKER-USER -i "$IFACE" -p tcp --dport "$port" -j DROP \
      -m comment --comment "$why"
    echo "blocked $IFACE:$port — $why"
  fi
}

block 5432 "inventre: no public access to container Postgres/pgbouncer"
block 6379 "inventre: no public access to container Redis (no requirepass)"
block 9000 "inventre: no public access to container MinIO (app uses Cloudflare R2)"
block 9001 "inventre: no public access to container MinIO (app uses Cloudflare R2)"

echo "DOCKER-USER: $(iptables -S DOCKER-USER | grep -c '^-A') rule(s) active"
