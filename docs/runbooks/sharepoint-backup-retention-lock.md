# SharePoint backup library: retention lock against permanent deletion

**Owner:** Microsoft 365 admin · **Related:** DR & BCP v1.2 action D-06 (High), Section 3 ("What the targets do not cover"), Section 5 (backup system) · **Library:** Vendor Management Files AUDIT › Documents › Inventre Backups

## Why

Every backup Inventre has (transaction-log segments, daily base backups, dumps, code bundles,
encrypted configuration, and the RESTORE recovery kit) is mirrored every 5 minutes into one
SharePoint folder, `Inventre Backups`, in the *Vendor Management Files AUDIT* site's Documents
library. Today the only protection against deletion is the site recycle bin (93 days, then the
second-stage bin) — and a user or a compromised account with site permissions can empty both.
A retention policy makes every version of every file in that site recoverable for the retention
period **even if it is deleted and the recycle bins are emptied**, because SharePoint copies
deleted or changed items into a hidden *Preservation Hold Library* that ordinary users cannot
purge.

The backup agent keeps working unchanged: retention policies preserve copies; they never block a
write, an overwrite or a delete. Section 6 says this explicitly.

## What to configure (choose A; B is the alternative)

You need a Microsoft 365 admin role that can manage Purview retention (Global admin, Compliance
admin or Compliance data admin). Both options are in Microsoft Purview.

### Option A — Retention policy scoped to the site (recommended)

1. Open **https://purview.microsoft.com** → **Solutions** → **Data Lifecycle Management** →
   **Microsoft 365** → **Retention policies** (older tenants: compliance.microsoft.com →
   Data lifecycle management → Retention policies).
2. **+ New retention policy**. Name: `Inventre backups - keep 30 days`. Description: "DR-BCP D-06.
   Keeps every version of the Inventre Backups mirror recoverable for 30 days even if deleted."
3. Policy type: **Static** (not adaptive), so the scope is exactly one site.
4. Locations: turn **on** only **SharePoint classic and communication sites** (in some tenants
   this reads "SharePoint sites"). Under *Included*, **Choose sites** and add the URL of the
   **Vendor Management Files AUDIT** site (the whole site — retention policies cannot be scoped to
   one folder; the library holds the backups, and the rest of the site is small). Leave Exchange,
   OneDrive, Teams and Groups **off**.
5. Retention settings:
   - **Retain items for a specific period**: **30 days** (longer is fine; 90 days costs little
     because the deleted-item copies live in the Preservation Hold Library, which does not count
     against the site's visible storage in the same way, but does count against tenant storage).
   - Start the retention period based on: **when items were created** is acceptable; **when items
     were last modified** is better for rolling files because it keeps the newest version of a
     file that is rewritten every 5 minutes, plus 30 days of its prior versions.
   - **At the end of the retention period**: **Do nothing** (do **not** choose "delete items
     automatically": the backup scripts already prune, and Purview must not delete backups).
   - This combination is the policy that behaves as "retain even if deleted": any item deleted or
     changed inside the period is preserved in the Preservation Hold Library until it expires.
6. Review and **Submit**. The policy can take up to 24 hours (sometimes longer for a large tenant)
   to apply; the status column shows *On (Success)* once distributed.
7. Optional but recommended: **Preservation Lock** ("Regulatory record" style locking of the
   policy itself). On the policy's review page choose **Turn on Preservation Lock** only if the
   owner accepts that after locking the policy can be extended or have sites added but can never
   be shortened, removed or narrowed, even by a Global admin. This is the strongest protection
   against a compromised admin account; it is also irreversible. Decision belongs to the owner.

### Option B — Retention label auto-applied to the library

Use this if the tenant prefers labels or the site must not carry a site-wide policy.

1. Purview → **Data Lifecycle Management** → **Microsoft 365** → **Labels** → **+ Create a label**.
   Name `Inventre backup - retain 30 days`; retention period 30 days (or longer) from when the
   item was **last modified**; at the end **Do nothing**. Do **not** tick "Mark items as a
   regulatory record" or "record" — a record label blocks edits and deletes, which would break
   the agent's overwrites (Section 6).
2. Publish the label with a **label policy** scoped to the same site (Choose sites → the Vendor
   Management Files AUDIT site).
3. After publishing (allow up to 24 hours), open the site in SharePoint → **Documents** →
   navigate to the `Inventre Backups` folder → **⋯ → Details** (or Library settings → *Apply label
   to items in this list or library*) and set the **default label** for the folder/library to the
   new label, ticking **Apply label to existing items**. New files inherit it; existing files pick
   it up on the next crawl.
4. Alternatively, an **auto-apply** label policy on the site with a KQL condition (`Path:` of the
   folder) does the same without touching library settings; it takes up to 7 days to run.

A retention **label** applied to the folder only protects items inside it; the site-wide
**policy** in Option A also protects the RESTORE kit folder and anything moved beside it, which
is why A is recommended.

## How to verify

Do this once the policy status shows *On (Success)*; do not test on a real backup file.

1. In SharePoint open **Vendor Management Files AUDIT › Documents › Inventre Backups**. Upload a
   small text file named `retention-test-<yyyymmdd>.txt` in the folder root (not inside `prod/`
   or `RESTORE/`; the agent syncs those and would remove an unknown file on the next run).
2. Wait about 15 minutes (the file needs to be indexed), then **delete** it, open the site
   **Recycle bin** and delete it there too, then open the **Second-stage recycle bin** (site
   settings → Recycle bin → second-stage) and delete it there as well.
3. Open the **Preservation Hold Library**: `https://<tenant>.sharepoint.com/sites/<site>/PreservationHoldLibrary`
   (site contents → *Preservation Hold Library*; visible only to site collection admins). The
   test file must be listed there with its original name. If the library does not exist or the
   file is missing, the policy is not yet applied to this site; wait and re-check, then recheck
   the site URL in the policy scope.
4. Also confirm versions are kept: edit any harmless file's name or contents in the folder root,
   then look in the Preservation Hold Library for the prior version. This is the behaviour the
   rolling backups rely on.
5. Record the result (date, who, screenshot of the Preservation Hold Library entry) in the DR-BCP
   drill record so D-06 can be closed.
6. Recovery, if ever needed: a site collection admin opens the Preservation Hold Library, finds
   the item, and copies it back into `Inventre Backups`. eDiscovery (Purview → eDiscovery) can
   also search and export it.

## The backup agent needs no change

The mirror is written by the Entra app registration **`inventre-backup-agent`** using
application permission **`Sites.Selected`** granted on this one site (rclone, client-credentials).
Nothing about a retention policy or label changes that grant, its secret, its permission level,
or the rclone remote (`m365:Inventre Backups/prod` and `…/RESTORE`). Do not create a new app, do
not widen the permission to `Sites.ReadWrite.All`, and do not add Delete restrictions to the
agent's role: it must keep overwriting and pruning its own files.

## What NOT to do

- **Do not** turn on anything that blocks writes. Retention policies and retention labels
  **keep copies of versions; they do not block writes, overwrites or deletes.** The rolling files
  (`code/`, `config/`, `wal/`, `base/`, `dumps/`, and the whole `RESTORE/` kit) are rewritten by
  the agent every 5 minutes; that must continue. The only Purview settings that *do* block
  changes are **record** and **regulatory record** labels and **legal holds / eDiscovery holds on
  the site** — do not apply any of those to this library.
- **Do not** pick "Delete items automatically at the end of the retention period". The backup
  scripts already prune to their own schedule (WAL 31 days, base 30 days, dumps 14 daily plus
  12 monthly, snapshots 30 days remote, 14 code bundles). Purview deleting on top of that would
  remove monthly dumps.
- **Do not** enable the site's or library's *Require check-out* or *Content approval* settings,
  and do not shorten the library's *Versioning* limit below the default: the agent does not
  check files out, and version history is what makes the rolling files recoverable.
- **Do not** apply a **sensitivity label** with encryption to the site. The files are already
  encrypted client-side by rclone; an M365 encryption label on top would stop the agent reading
  its own files back.
- **Do not** move the library or rename the site. The mirror target is fixed in the agent's
  configuration (`Vendor Management Files AUDIT › Documents › Inventre Backups`) and Scenario A
  step A5 assumes that path.
- **Do not** test by deleting real files under `prod/` or `RESTORE/`. Use the test file above.
- **Do not** enable Preservation Lock without the owner's explicit sign-off; it cannot be undone.

## Storage note

With "last modified" retention on files rewritten every 5 minutes, the Preservation Hold Library
will hold many versions of the small rolling files (config, code bundles) and one 30-day tail of
the larger ones. Expect the site's total footprint to be a few times the size of the live
`Inventre Backups` folder. Check *Site usage* a week after enabling; if the tenant's storage
quota is tight, keep the policy and shorten only if the owner accepts a shorter recovery window
(never below 30 days, which is what D-06 asks for).
