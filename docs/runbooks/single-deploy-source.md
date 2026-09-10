# Production is deployed from `/root/Inventre` and nowhere else

**Applied 2026-09-10.** This note records what was changed, why, and exactly how
to reverse it.

## What went wrong

Sixteen checkouts of this repository lived on this server. Every one of them
carried a `docker-compose.deploy.yml` naming the **production** containers —
`inventre-deploy-app`, `inventre-deploy-postgres`, `inventre-deploy-pgbouncer`,
`inventre-deploy-redis` — and its own copy of `scripts/deploy.sh`.

Only `/root/Inventre` held the September security work: the six security
headers, per-section admin authorization, and seven bug fixes. A deploy from
any of the other fifteen silently reverted all of it.

On 10 September that happened **twice within one hour**. Nobody was at fault
and no human had logged in since 26 June — five Claude Code sessions were
running concurrently in different checkouts, and two of them deployed.

Nothing noticed either time. The container reported healthy, the site returned
200, and the only symptom was six headers quietly missing from a response
nobody reads. The proof, each time, was the compiled `routes-manifest.json`:
this checkout builds **4 header rules including HSTS**; the image that replaced
it had **3, none of them security**.

## What was changed

Two layers, because one is not enough:

1. **`docker-compose.deploy.yml` renamed** in all fifteen to
   `docker-compose.deploy.yml.DISABLED-deploy-only-from-root-Inventre`.
   A direct `docker compose -f docker-compose.deploy.yml …` now fails on a
   missing file instead of recreating a production container.
   Each checkout's own `docker-compose.yml` (local Postgres, Redis, MinIO for
   development) is **untouched** — local work is unaffected.

2. **A guard block prepended to `scripts/deploy.sh`** in all fifteen. This is
   the layer that matters: `deploy.sh --fast` never reads the compose file at
   all — it `docker cp`s into the running container and restarts it — so
   renaming the compose file alone would not have closed that path.

`/root/Inventre/scripts/deploy.sh` is deliberately **not** guarded.

## Verified

- A guarded script run from any other path prints a refusal and exits 1.
- All fifteen guarded scripts parse cleanly (`bash -n`).
- `/root/Inventre` still deploys, and production verified clean afterwards.
- Exactly one checkout can name the production containers.

## To reverse it, for one checkout

```bash
cd /root/<checkout>
mv docker-compose.deploy.yml.DISABLED-deploy-only-from-root-Inventre \
   docker-compose.deploy.yml
# then delete the INVENTRE-DEPLOY-GUARD block at the top of scripts/deploy.sh
```

Please do not, without also making that checkout the one source of truth.

## What this does not fix

This stops an *accidental* deploy from the wrong directory. It does not stop a
determined one, and it does not address the reason so many checkouts exist:
**this server cannot reach GitHub.** No credential helper, no token, the SSH
key rejected, `origin/main` stale since 2026-06-20 and 60 local commits never
pushed. Branches live as directories because they cannot live as branches.

Fix the GitHub credential and most of these checkouts stop being necessary.

## Related

- `scripts/verify-deployment.sh` — asserts, after every deploy, that the live
  site serves the build we just made and carries all six headers.
- `scripts/monitor-production.sh` — cron, every 10 minutes; records the moment
  production loses its security posture, with the build id.
- `db_backups/production-monitor.log` — where that is recorded.
