#!/bin/bash
# Code backup: a git bundle of EVERY branch and tag (restorable with `git clone
# file.bundle`), plus a push to GitHub when the deploy key is authorised.
# Called after every production deploy and daily at 04:00.
set -uo pipefail; . "$(dirname "$0")/lib.sh"
cd "$ROOT"
SHA="$(git rev-parse --short HEAD)"; OUT="$ARCHIVE/code/inventre-$(date +%Y%m%d)-$SHA.bundle"
git bundle create "$OUT" --all >/dev/null 2>&1 && log "bundle $OUT ($(du -sh "$OUT" | cut -f1))" || log "bundle FAILED"
ls -1t "$ARCHIVE"/code/*.bundle 2>/dev/null | tail -n +15 | xargs -r rm -f
if [ -f /root/.ssh/inventre_github_deploy ]; then
  export GIT_SSH_COMMAND="ssh -i /root/.ssh/inventre_github_deploy -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new"
  if git push --quiet git@github.com:ItInventre/Inventre.git --all 2>>"$LOGDIR/code-backup.log" && git push --quiet git@github.com:ItInventre/Inventre.git --tags 2>>"$LOGDIR/code-backup.log"; then
    log "pushed all branches + tags to GitHub"
  else
    log "GitHub push not possible yet (deploy key not authorised?) — bundle is the backup"
  fi
fi
