# Personal data breach response

Procedure under the Digital Personal Data Protection Act 2023 (DPDP) and the DPDP Rules.
Scope: every system that holds parents' or children's data — the storefront (`/root/Inventre`,
prod DB, MinIO/R2 media), the Audit ERP box, the SMS gateway account, Microsoft 365 backups.

Keep this page printable. When it is needed, the person using it is under pressure.

## 1. What counts as a breach

Any of these, confirmed **or reasonably suspected**:

- Personal data read, copied, changed or deleted by someone not authorised (outsider or insider).
- A secret that unlocks personal data exposed: `.env.deploy`, DB password, `SUPPORT_SERVICE_TOKEN`,
  SMS gateway key, R2/M365 backup credentials, a staff account or session.
- A DB dump, Excel export or backup left somewhere it should not be (public bucket, shared drive
  with wrong permissions, personal laptop that is lost).
- Data sent to the wrong person: another parent's order/OTP/child details shown or emailed.
- Loss of availability that stops parents accessing their data for a sustained period.
- Root compromise of any host (see `server-compromise-2026-06-incident.md` in memory — it has happened).

Not a breach on its own: a scan, a failed login burst, a bug that showed nothing. Log it anyway (section 7).

**A suspected breach is treated as a breach until it is ruled out.** The 72-hour clock (section 3)
starts at first awareness, not at confirmation.

## 2. Roles

| Role | Who | Does |
|---|---|---|
| **Incident owner** | Sunith (owner) — deputy: Vikas | Declares the incident, makes the notify / don't-notify call, signs the Board report, talks to schools |
| **Engineering lead** | on-call engineer | Contains, snapshots evidence **before** changing anything, rotates secrets, assesses scope (section 5) |
| **Communications lead** | support lead | Drafts and sends parent / school messages from the templates (section 6), staffs the support line |
| **Grievance officer** | as named on /privacy | Point of contact named in every notice; receives parent questions |

One person may hold two roles. The incident owner never holds engineering lead — someone must be
free to think.

## 3. Timeline

| When | Must be done |
|---|---|
| **Hour 0** — first awareness | Open the evidence log (section 7). Incident owner declares. Engineering lead starts containment (section 4). Nobody talks outside the team yet. |
| **Hour 4** | Containment done or blast radius known. First scope estimate: which tables, roughly how many people, children involved? Owner decides whether this is reportable (it is unless clearly ruled out). |
| **Hour 24** | Scope confirmed (section 5). Parents notified **without delay** once we know who is affected and what to tell them — do not wait for the full report. Schools told the same day. Preliminary intimation to the Data Protection Board of India if the full report will not be ready. |
| **Hour 72** | Detailed report to the Data Protection Board of India (template 6a). This is the hard legal deadline under the DPDP Rules. |
| **Day 14** | Post-incident review held and written up (section 8). |

Parents are notified as soon as we can tell them something useful and true. "We are investigating,
here is what you should do meanwhile" at hour 24 beats a complete account at hour 72.

## 4. Containment checklist

Order matters: **snapshot first, then change things.** Evidence destroyed by containment is gone.

- [ ] Note the time and who noticed, in the evidence log.
- [ ] **Snapshot before touching**: `scripts/snapshot-and-rotate.sh` (DB dump + env + media), plus
      `docker logs` of app/nginx/postgres to a dated folder, plus `last`, `auth.log`, `ps -ef`, listening ports.
      Copy the snapshot off the host (M365 backup path, `docs/runbooks/restore-from-m365.md`).
- [ ] Stop the bleeding, smallest step first: block the IP / disable the account / take the one
      route offline (nginx `return 503` on that path) / put the site in maintenance
      (`/root/maintenance/sync.sh`, `$maint_on 1`) — in that order of escalation.
- [ ] **Rotate secrets**: `scripts/rotate-db-password.sh` for the DB; then every key in `.env.deploy`
      that the attacker could have read (JWT_SECRET, AUTH_SECRET, SUPPORT_SERVICE_TOKEN, SMS gateway,
      CCAvenue working key, R2/M365 tokens, Audit ERP bridge token). Redeploy with `--env-file .env.deploy`.
- [ ] **Revoke sessions**: rotating `JWT_SECRET` invalidates every parent, fee-desk and admin session.
      Tell staff they will be logged out.
- [ ] **Block accounts**: disable any staff account involved (`/admin/settings/users`); reset its password.
- [ ] Check the Audit ERP box and the SMS gateway console — a storefront breach usually reaches them.
- [ ] Check for persistence: cron entries, new SSH keys, unknown processes masquerading as kernel
      threads (`/proc/<pid>/exe` on any `[bracketed]` process — the 2026-06 backdoor trick).
- [ ] If the host itself is compromised: rebuild, don't clean (`docs/runbooks/host-rebuild.md`).
- [ ] Take a second snapshot after containment. Both go in the evidence log.

## 5. Assessment

Answer in writing, in the evidence log. The Board report and the parent notice are built from this.

1. **What happened** — one paragraph, plain words, no speculation.
2. **Which data** — tables and columns. Typical map:
   - `parents` / `students` — names, phone, email, child's DOB, gender, grade, enrolment number
   - `orders`, `order_items`, `payments` — addresses, what was bought, payment references (no card data exists)
   - `exchange_requests` + attached photos (R2 links)
   - `otp_logs` — phone numbers and OTP timestamps
   - `mcb_*` — school fee ledgers (school is the fiduciary; tell the school, it notifies its parents)
   - `admin_users`, `activity_log` — staff
3. **How many principals** — count parents and children separately.
   ```sql
   -- example: everything the compromised account could read in the window
   SELECT count(DISTINCT parent_id), count(DISTINCT student_id) FROM ... WHERE ...
   ```
4. **Children involved?** — almost always yes on this platform. Say so explicitly; it raises the
   seriousness and the tone of the parent notice.
5. **Which schools** — list, with counts; each gets its own notice.
6. **Window** — earliest and latest time the access was possible.
7. **Was it read, copied, changed or deleted?** — if you cannot tell, say "cannot rule out copying".
8. **Likely harm** — spam/phishing to parents, address exposure, impersonation of the school, fraud
   against payments (no card data, so low), child safety (address + school + name combination is the
   sensitive one).
9. **What we did** — containment steps with times.
10. **What the parent should do** — concrete, e.g. "ignore calls claiming to be Inventre asking for
    an OTP", "we will never ask for your OTP".

## 6. Notification templates

Fill the `[brackets]`. Keep the plain-language version plain; a parent who reads one line must still
get the point.

### 6a. To the Data Protection Board of India (within 72 hours)

```
To: Data Protection Board of India
From: Inventre (JV Ventures), data fiduciary — [registered address]
Grievance / contact officer: [name], [email], [phone]
Subject: Personal data breach intimation — [short title] — [incident id]

1. Nature of the breach
   [what happened, one paragraph]
   First awareness: [date time IST]. Confirmed: [date time IST]. Window of exposure: [from] to [to].

2. Personal data affected
   Categories: [names / phone numbers / email / delivery addresses / child's name, school, grade,
   section, enrolment number, date of birth / order history / request photos / OTP records / fee ledger data]
   Data principals affected: [N] parents/guardians and [M] children across [K] schools.
   Children's data involved: [yes/no].

3. Likely consequences for data principals
   [phishing / impersonation / address exposure / other]

4. Measures taken and proposed
   Containment: [steps with times]
   Remediation: [secret rotation, patches, rebuild, access changes]
   Mitigation offered to principals: [what we told them to do]

5. Notification to data principals
   Sent [date time] by [SMS/email], text attached. Schools notified [date time].

6. Contact for follow-up
   [name, email, phone]

[Signature — incident owner]      [date]
```

### 6b. To affected parents

**SMS (≤160 characters, count them):**

```
Inventre: on [date] some account details ([what]) may have been seen by an unauthorised party. No card data. We NEVER ask for your OTP. See inventre.in/privacy
```

**Email:**

```
Subject: Important: a security incident affecting your Inventre account

Dear [parent name],

We are writing to tell you about a security incident that may have involved your information.

What happened
On [date], [one plain sentence — e.g. "an unauthorised person gained access to a part of our order system"].
We found it on [date], stopped it on [date], and have since [rotated all passwords and keys / rebuilt the server].

What information was involved
[list — e.g. your name, mobile number and delivery address, and your child's name, school and class].
No card or bank details were involved: Inventre never stores them.

What we are doing
[containment + remediation, two sentences]. We have reported the incident to the Data Protection Board of India.

What you can do
- Inventre will never call or message you asking for an OTP or password. Ignore anyone who does.
- Be cautious of calls or messages that mention your child's school or class as proof they are genuine.
- You can ask for a copy of everything we hold about you from Account → Download my data.

If you have any questions, write to our grievance officer, [name], at [email]. We will respond within 7 working days.

We are sorry this happened.

[Name], [role]
Inventre
```

### 6c. To the schools

```
Subject: Security incident affecting [school name] families — Inventre

Dear [principal / coordinator],

On [date] Inventre had a security incident that involved the information of [N] families at [school name].
[One-paragraph description.] It has been contained; we have reported it to the Data Protection Board of India.

Information involved: [list].
Not involved: [list — e.g. payment card data, fee ledger data].

We have notified the affected families directly today (copy attached) and asked them to be alert to anyone
claiming to be the school or Inventre and asking for OTPs.

[If fee ledger data is involved: "This includes fee ledger data that we process on the school's behalf.
As the school is the data fiduciary for that data, you may need to make your own notification; we will
give you every detail you need."]

Please pass any parent enquiries to [grievance officer email]. We will send a full written account within [date].

[Name], [role]
Inventre
```

## 7. Evidence log template

Start it at Hour 0 as `incidents/<yyyy-mm-dd>-<slug>.md` (outside the repo; keep it in the M365 incident folder). Append only; never rewrite earlier rows.

| Time (IST) | Who | What was observed / done | Source (log file, command, screenshot) | Snapshot / hash |
|---|---|---|---|---|
| 2026-__-__ __:__ | | First noticed: | | |
| | | Incident declared by: | | |
| | | Snapshot 1 taken (pre-containment) | `scripts/snapshot-and-rotate.sh` | `sha256:` |
| | | Containment step: | | |
| | | Secrets rotated: | | |
| | | Snapshot 2 taken (post-containment) | | `sha256:` |
| | | Scope confirmed (section 5 answers attached) | | |
| | | Parents notified: [N] SMS / [M] email | | |
| | | Schools notified: | | |
| | | Board report sent | | |

Also keep: raw log extracts, the exact queries used for counts, copies of every message sent, and
the Board's acknowledgement.

## 8. Post-incident review (within 14 days)

One meeting, one page, no blame. Answer:

1. Timeline — awareness to containment to notification, with actual hours against the section 3 targets.
2. Root cause — the technical one **and** the process one (why did the control that should have stopped it not exist / not work?).
3. What went well.
4. What did not — including anything in this runbook that was wrong or missing.
5. Actions — each with an owner and a date. Add them to the Data Protection register (`docs/governance`, P-xx items).
6. Update this runbook and the Data Protection & Privacy document; bump their versions.

## 9. Annual tabletop drill checklist

Once a year (put it next to the DR restore drill D-01). Pick a scenario, walk it on paper in 90 minutes.

Scenarios to rotate through:
- Staff laptop with a DB export is stolen.
- A support agent's admin session is hijacked and browses 500 orders.
- Backup credentials leak on a public repository.
- A parent reports seeing another child's details on their account.
- Root compromise of the prod host (rerun of 2026-06).

Checklist:
- [ ] Everyone in section 2 attended, or a deputy did.
- [ ] Contact details in section 2 and on /privacy are current.
- [ ] The evidence log template was opened and filled for the scenario.
- [ ] `scripts/snapshot-and-rotate.sh` and `scripts/rotate-db-password.sh` were run for real on the dev stack and worked.
- [ ] The scope queries in section 5 were run for real on dev and returned counts.
- [ ] Each template in section 6 was filled for the scenario; the SMS fitted in 160 characters.
- [ ] Time from "awareness" to "parent SMS drafted" was measured; target under 4 hours.
- [ ] Gaps found were written into section 8 actions with owners.
- [ ] Runbook version bumped and the drill date recorded below.

| Drill date | Scenario | Awareness → SMS drafted | Gaps found | Run by |
|---|---|---|---|---|
| | | | | |
