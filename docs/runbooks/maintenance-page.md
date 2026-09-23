# Maintenance page: one command

**Owner:** Engineering · **Related:** DR & BCP v1.0 action D-08 · **Script:** `scripts/maintenance.sh`

The storefront's maintenance page is an nginx gate: `map $host $maint_on { default 0; }` in
`/etc/nginx/sites-available/inventre`. `1` sends every storefront request to the 503 page;
`/admin` and `/api` stay live either way. Until now flipping it meant hand-editing that line and
running `nginx -t && nginx -s reload`.

```bash
sudo /root/Inventre/scripts/maintenance.sh status   # prints ON / OFF
sudo /root/Inventre/scripts/maintenance.sh on       # storefront -> 503 page
sudo /root/Inventre/scripts/maintenance.sh off      # storefront live
```

What `on`/`off` do, in order:

1. Refuse unless run as root, and unless the `default 0;`/`default 1;` line is found **inside** the
   `map $host $maint_on { … }` block (nothing else in the file is ever touched).
2. Copy the site file to `/root/backups/nginx-inventre.<YYYYmmdd-HHMMSS>`.
3. `sed` that one line, then `nginx -t`. On success `nginx -s reload`; on failure the backup is
   restored and nginx is left untouched.
4. Print the new status and a reminder that staff can bypass the page with `?maint=<token>`
   (the token is never printed).

Notes:

- The page HTML itself is published separately by `/root/maintenance/sync.sh` (nginx cannot
  read `/root`); the switch only opens or closes the gate.
- Open tabs refresh themselves on deploy via `/api/version`, so parents do not need to reload.
- Design history and rejected iterations of the page live in the project memory notes
  (`maintenance-page-design.md`), not here.
