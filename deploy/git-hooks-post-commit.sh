#!/bin/bash
# Back up the code on every commit (F-11): bundle of all branches → /root/backups-archive/code,
# uploaded by the 5-minute sync; GitHub push when the deploy key is authorised. Runs detached.
nohup /root/Inventre/scripts/backup/code-bundle.sh >> /var/log/inventre/code-backup.log 2>&1 &
