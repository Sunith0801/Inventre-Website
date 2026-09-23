# DR decisions: warm standby recommendation (D-07) and partner escalation checklist (D-10)

**Owner:** Company owner · **Related:** DR & BCP v1.2 Sections 1, 3, 4, 6 (Scenarios A and B), 9 (drill record), 10 (D-01, D-07, D-10) · **Password manager entry:** *Inventre recovery kit*

---

## Part A — Should Inventre run a warm standby? (D-07)

### The numbers we have

| Recovery path | Measured / estimated | Source |
|---|---|---|
| Point-in-time database restore on the **same host** (Scenario B) | **45 s** for the database (base backup + 12 WAL segments → promoted database, 118 tables, 31,683 orders, 24,213 students); the app restart comes on top | Drilled 2026-09-24, `scripts/backup/pitr-drill.sh` (DR-BCP Section 9) |
| Full rebuild on a **new server** (Scenario A) | **30–60 min** technical time estimated by the recovery kit (`bootstrap-new-server.sh`); DR-BCP Section 1 budgets 60–90 min technical, about 3 h end to end with people, DNS and partner steps | **Unmeasured** — D-01 (Now) is the drill that turns this into a number |
| Recovery point (data loss) | about 5 min (continuous WAL streaming + 5-minute encrypted mirror) | Verified live (Section 1) |
| Committed targets (proposed, D-05) | RPO 5 min; RTO 4 h business hours / next morning overnight; max tolerable outage 2 business days | Section 1 |

What the 45 s tells us: the *data* side of recovery is already fast, and the thing that costs time
in a real loss is everything that is not the database — ordering a machine, copying the kit,
DNS propagation, certificate, nginx, cron, mail relay, the CCAvenue SFTP user, and telling
partners a new IP. A warm standby removes most of that list; it does not make the database part
faster, because that part is already under a minute.

### The two options

**Option 1 — Stay single-host with the current kit (status quo).**
Cost: nothing new (the backup pipeline, mirror and kit already exist). RTO: the Section 1
figure, 60–90 min technical / about 3 h total, pending measurement. Risk: one hosting-provider
or hardware failure takes the store down for the whole rebuild time; during the ordering season
(May–August) that is visible to schools. Mitigation already in place: maintenance page, offline
order SOP (`offline-orders-sop.md`), 5-minute RPO.

**Option 2 — A second small host with a streaming replica (warm standby).**
What it is: a second Ubuntu VM (2 vCPU / 8 GB / 100 GB is enough; the database is small) at a
different provider or at least a different region, running Postgres as a streaming replica of
production, with the app image, nginx and certificate pre-staged but idle. On loss of the primary:
promote the replica, start the app, point DNS at the standby. RTO: roughly **10–15 min**, of which
DNS TTL is most (keep the A-record TTL at 300 s). RPO: seconds (replication lag), which is better
than the 5-minute mirror.

Costs and burdens of Option 2:

- Money: a second VM at the small size is typically in the region of ₹1,500–3,500 per month
  (provider-dependent; the owner should price it from the hosting console), plus a second
  outbound IP that CCAvenue and the Audit ERP may need on their allow-lists.
- Engineering: 1–2 days to build (replication user, `pg_hba`, replication slot, app image pull,
  env decrypted onto the standby, nginx + certificate via DNS challenge, health check), then it
  becomes a permanent second production machine: patched, monitored, secrets rotated in two
  places, a replica-lag alert, and a **quarterly failover drill** in addition to the existing
  restore drills. An unmaintained standby is worse than none, because it fails at the moment it
  is trusted.
- Security: a second copy of production data and secrets to protect (Data Protection register);
  the June 2026 compromise doubles its surface.
- Failure modes it does not cover: a bad deploy or wrong import replicates to the standby within
  seconds (that is Scenario B, and the 45 s point-in-time restore is the right tool there, not a
  replica); a compromised credential works on both hosts; a provider-wide outage still takes both
  if they share a provider and region.

### Recommendation

**Stay single-host with the current kit, and revisit after the D-01 rebuild drill** — unless the
owner decides the business needs an RTO under 15 minutes.

Reasoning:

1. The targets the business is being asked to approve (D-05) are RTO 4 h in business hours and
   next morning overnight. The current design is expected to meet them with margin, but the
   rebuild time is an **estimate**; buying a standby before measuring would be spending to fix a
   number we have not yet observed.
2. The one measurement we do have (45 s point-in-time) shows the data path is not the bottleneck.
   A drill of Scenario A (D-01, effort M, needs a throwaway server for a few hours) will show
   whether the people-and-DNS steps land inside 90 minutes. If they do, a standby buys the
   difference between ~90 min and ~15 min for a failure that has not happened since the service
   went live; if they do not, the drill will also show *which* steps are slow, and pre-staging just
   those (an image already pulled, DNS TTL at 300 s, a pre-created account at a second provider)
   may close most of the gap at near-zero cost.
3. The season matters. If the drill is done before May, the decision can be made with real
   numbers before the period when downtime actually costs orders.

**Decision rule to record:**

- Measured Scenario A RTO ≤ 90 min technical and the owner accepts the 4 h target → stay
  single-host; repeat the rebuild drill quarterly; re-ask this question annually or when order
  volume doubles.
- Measured RTO > 90 min, or the owner wants RTO ≤ 15 min in season → build Option 2 as a
  seasonal standby (run it May–August, tear it down or downsize it the rest of the year), with a
  failover drill before the season opens.
- In every case: keep the DNS A-record TTL at 300 s now (free, and it shortens both paths), and
  keep the recovery kit passphrase and the hosting console reachable by the deputy (D-03).

Owner decision: ______________________ Date: __________ Revisit after D-01 drill on: __________

---

## Part B — Partner escalation checklist for the password-manager entry (D-10)

Purpose: when the server is down, the people running the playbook need every partner's
identifiers and support route **without** the server, e-mail archive or a laptop. Store the
following in the password manager entry **"Inventre recovery kit"** (the same entry that holds
the kit passphrase and the snapshot/encryption keys), as a table or as attached secure notes.
Fill the blanks there, never in this file or in git. Review at the quarterly contact-tree check
(DR-BCP Section 9); each row has a "last verified" date.

Legend: **ID** = the identifier the partner asks for on a call; **Login** = console credentials
(store as a separate password item and link it); **Support** = the phone/e-mail/ticket URL and
hours; **Our owner** = who at Inventre holds the relationship and whose e-mail the account is
registered to.

### 1. CCAvenue (payments)

| Field | Value |
|---|---|
| Merchant ID | ______ |
| Merchant panel login (link to item) | ______ |
| Support line (phone) and hours | ______ |
| Support e-mail / ticket portal | ______ |
| Account owner e-mail at Inventre (the registered contact) | ______ |
| Relationship manager name and phone (if assigned) | ______ |
| Outbound IP(s) they have allow-listed for us; SFTP user for settlement files | ______ |
| Last verified | ______ |

### 2. Audit ERP team (fulfilment, separate host)

| Field | Value |
|---|---|
| Team lead name, phone, e-mail | ______ |
| Deputy / on-call contact | ______ |
| ERP host (IP / hostname) and environment (prod) | ______ |
| Group chat used for incidents | ______ |
| Ingest endpoint and where the shared HMAC / service token is stored (link to item) | ______ |
| Our outbound IP they allow-list (if any) | ______ |
| Last verified | ______ |

### 3. Hosting provider (production server)

| Field | Value |
|---|---|
| Provider name and account / customer number | ______ |
| Console login URL and credentials (link to item; note if 2FA and who holds the device) | ______ |
| Support ticket URL | ______ |
| Support phone and hours | ______ |
| Server identifier (name / ID / IP) and datacentre / region | ______ |
| Account owner e-mail at Inventre | ______ |
| Billing method on file (so a new server can be ordered on the spot) | ______ |
| Last verified | ______ |

### 4. Domain registrar (inventre.in)

| Field | Value |
|---|---|
| Registrar name and account ID | ______ |
| Login URL and credentials (link to item; 2FA holder) | ______ |
| Where DNS is hosted (registrar / Cloudflare / other) and current nameservers | ______ |
| Domain expiry date and auto-renew status | ______ |
| Registrant / admin contact e-mail on the WHOIS record | ______ |
| Support route | ______ |
| Last verified | ______ |

### 5. Cloudflare (R2 product images; DNS if hosted there)

| Field | Value |
|---|---|
| Account e-mail and account ID | ______ |
| Login credentials (link to item; 2FA holder) | ______ |
| R2 bucket name(s) and where the API token is stored (link to item) | ______ |
| Zone(s) managed and whether the proxy is on/off for inventre.in | ______ |
| Support plan / ticket URL | ______ |
| Last verified | ______ |

### 6. Microsoft 365 (backups mirror, alert mail, Exchange)

| Field | Value |
|---|---|
| Tenant name / tenant ID | ______ |
| Global admin account (link to item; 2FA holder) and a second admin | ______ |
| Backup site and library (Vendor Management Files AUDIT › Documents › Inventre Backups) | ______ |
| Entra app registration `inventre-backup-agent`: app (client) ID; where its secret is stored; secret expiry date | ______ |
| Alert mailbox (it@inventre.in) — who has phone notifications on | ______ |
| Microsoft support route (admin centre → Support) and partner / CSP contact if licences are via a reseller | ______ |
| Last verified | ______ |

### 7. SMS vendor (OTP gateway)

| Field | Value |
|---|---|
| Vendor name and account ID / sender ID | ______ |
| Account manager name, phone, e-mail | ______ |
| Portal login (link to item) | ______ |
| Recharge method and who can authorise it (the June 2026 outage was "insufficient balance") | ______ |
| DLT entity / template IDs (needed if templates must be re-registered) | ______ |
| Last verified | ______ |

### 8. MyClassBoard (fee ledger source)

| Field | Value |
|---|---|
| Support contact (name, phone, e-mail) and hours | ______ |
| Our account / institution ID and the API user (where the token is stored — link to item) | ______ |
| Branch list we import and who at the schools owns the MCB relationship | ______ |
| Last verified | ______ |

### 9. Also in the same entry (cross-check)

- Recovery kit passphrase; snapshot passphrase; rclone crypt keys (already there per DR-BCP §4).
- GitHub organisation/repo (`Sunith0801/Inventre-Website`), the deploy key holder, and a second
  account with admin rights.
- The Section 4 role table (owner, technical lead, communications lead, deputies) with phone
  numbers.
- Mail relay account used for outbound alerts.
- A copy of this checklist's headings, so a deputy can see what is missing.

### Rules for the entry

- Values live **only** in the password manager (and, for contacts, in the incident owner's
  phone). This file and the DR-BCP document stay blank.
- Every credential is a **linked item**, not pasted into the note, so rotation updates one place.
- At least two people (owner + deputy) can open the entry; test it at the quarterly contact-tree
  check and write the date on each "Last verified" line.
- When any partner credential or IP changes (Scenario A step A6, Scenario C step C5), update the
  entry the same day.
