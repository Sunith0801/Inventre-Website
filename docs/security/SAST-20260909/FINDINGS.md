# SAST Report — Inventre Platform

**Assessment ID:** SAST-20260909
**Date:** 2026-09-09
**Assessor:** sunith@inventre.in
**Target:** `/root/Inventre` @ branch `stop-writing-grade-snapshot`, HEAD `3b066b1`
**Type:** Static Application Security Testing — **read-only. No code, schema, data or configuration was modified.**

**Production impact: none.** Verified before, during and after the scan — `inventre.in` HTTP 200, `/api/health` `{db:true,redis:true}`, app container start time unchanged (`2026-09-04T11:26:21Z`, never restarted). SAST reads files from disk; it makes no connection to the application, database or containers.

---

## 1 · Scope and method

| | |
|---|---|
| Code scanned | `app/`, `lib/`, `db/`, `components/`, `middleware.ts`, `scripts/`, `next.config.mjs` |
| Volume | 1,084 files / ~165,000 lines TypeScript + TSX |
| Excluded | `node_modules`, `.next`, `.git`, `backups`, `docs`, `db/migrate.js` (77 KB generated bundle), files > 1 MB |
| Parse coverage | ~99.9% of lines |

### Tooling

| Tool | Version | Purpose |
|---|---|---|
| Semgrep | 1.176.1 | Static analysis — 728 community rules, 133 applicable after language filtering |
| Semgrep (custom) | — | 10 Inventre-specific rules written for this assessment |
| gitleaks | 8.30.1 | Secret detection across all 98 commits of history |
| npm audit | npm 10.x | Dependency vulnerability scan |

Semgrep was installed in an isolated Python venv outside the repository. Nothing was added to `package.json`.

---

## 2 · Results at a glance

| Source | Raw | Confirmed | False positive |
|---|---|---|---|
| Dependency scan (production deps) | 8 | **8** | 0 |
| Dependency scan (incl. dev deps) | 16 | 16 | 0 |
| Semgrep community rulesets | 3 | **3** | 0 |
| Semgrep custom rules | 507 | **482** | 25 |
| gitleaks (git history) | 2 | **2** | 0 |

### The headline result is what generic SAST *missed*

Eight rulesets and 728 community rules across 165,000 lines produced **three findings**. None of them is the OTP bypass, the spoofable rate limits, the unauthenticated student enumeration, or the 62 unguarded admin pages.

That is not a failure of the tool. Generic SAST finds injection and unsafe-API patterns; this system's real risks are **authorization and business-logic flaws**, which no off-the-shelf rule can recognise. The custom ruleset in `02-static-analysis/inventre-rules.yaml` exists to close that gap and is the durable output of this assessment — it makes the audit findings CI-enforceable so they cannot regrow.

---

## 3 · Confirmed findings

### SAST-01 · Next.js middleware-bypass CVE
**Severity: CRITICAL · CWE-693 Protection Mechanism Failure · Source: npm audit**

`next@15.5.15` falls inside the affected range (`9.3.4-canary.0` – `16.3.0-preview.10`) for *"Middleware / Proxy bypass in App Router applications via segment-prefetch routes"*, plus a DoS via Server Components and a cache-poisoning issue on middleware redirects.

This is more severe here than in a typical application. `middleware.ts` is the **first authentication gate** for `/admin/*`, `/shop/*` and the admin API. Audit finding F-04 established that 62 of 124 admin pages carry no guard of their own and rely on that middleware plus a layout that checks only `kind === "admin"`. A middleware bypass therefore does not degrade to a weaker check — it reaches server-rendered GST reports, receivables, payment settings and student records **with no session at all**.

- **Evidence:** `01-dependency/npm-audit-production.json`
- **Fix available:** yes — upgrade Next.js
- **Remediation:** Phase 1A
- **Re-test:** `npm audit` clean of this advisory + full manual regression (the upgrade is the highest-risk step in the programme because 30 type errors are currently suppressed by `ignoreBuildErrors`)

### SAST-02 · Vulnerable dependencies
**Severity: HIGH · CWE-1035 Vulnerable Third-Party Component · Source: npm audit**

7 high-severity advisories in production dependencies:

| Package | Installed | Issue | Fix |
|---|---|---|---|
| `drizzle-orm` | ^0.36.4 | SQL injection via improperly escaped SQL identifiers (fixed ≥0.45.2) | available |
| `nodemailer` | ^6.9.16 | SMTP command injection via CRLF; email to unintended domain | available |
| `postcss` | — | Arbitrary file read via attacker-controlled `sourceMappingURL`; XSS via unescaped `</style>` | available |
| `sharp` | ^0.34.5 | Inherited libvips CVE-2026-33327/33328/35590/35591 + libheif advisories | available (breaking) |
| `nanoid` | — | Integer overflow; infinite loop on zero/negative size | available |
| `fast-xml-builder` | — | Attribute-quote bypass; comment-regex bypass | available |
| **`xlsx`** | ^0.18.5 | **Prototype pollution + ReDoS** | **NO FIX AVAILABLE** |

`drizzle-orm` deserves attention alongside SAST-06: the codebase uses `sql.raw()` in 24 places.

**`xlsx` needs a decision.** No patch exists. Options: migrate to `exceljs`, or accept and document the risk with compensating controls (it is used for admin-only Excel export/import, so the attack surface is authenticated staff uploading files).

- **Evidence:** `01-dependency/npm-audit-production.{json,txt}`
- **Remediation:** Phase 1A

### SAST-03 · Hard-coded root SSH password
**Severity: HIGH · CWE-798 Hard-coded Credentials · Source: Semgrep community (`detected-ssh-password`)**

`scripts/push-catalogue-to-audit.sh` lines 25 and 79 embed a **root password for the audit ERP host** in `sshpass -p <password> ssh …`, combined with `StrictHostKeyChecking=no` (which also removes host-key verification, enabling machine-in-the-middle).

Exposure assessment:

| Question | Answer |
|---|---|
| In git history? | **No** — file is untracked; `git log -S'sshpass'` returns 0 commits |
| In the runtime Docker image? | **No** — verified by listing `/app/scripts/` inside `inventre-app:rollback-pre-refactor-20260909`; only `start.sh` and `sync-staging.sh` ship |
| In a Docker *builder* layer? | **Yes** — `Dockerfile:20` is `COPY . .`, so the whole repo including untracked files enters the build stage. Images are local-only (no registry push), so this is contained but should not persist |
| Gitignored? | **No** — one `git add -A` away from being pushed to a GitHub repository |

**Disclosure:** the Phase 0 working-tree snapshot (`backup/inventre-pre-refactor-20260909`, commit `d08747a`) used `git add -A` and therefore **captured this file**. That branch is local-only — `git branch -r --contains d08747a` returns 0 remote branches — so nothing has been published. It must not be pushed until the credential is rotated and the file scrubbed. I can rewrite that snapshot commit to exclude the file on request.

**Remediation:** replace `sshpass` with an SSH key, add the script to `.gitignore`, restore host-key checking, rotate the audit host root password, and add `scripts/` exclusions to `.dockerignore`.

### SAST-04 · Secrets in published git history
**Severity: MEDIUM · CWE-540 Information Exposure Through Source Code · Source: gitleaks**

Two API keys committed in the **initial import** `fb82b33`, and this repository has a GitHub remote (`github.com/ItInventre/Inventre`):

| File | Line | Rule |
|---|---|---|
| `INTEGRATION.md` | 196 | `generic-api-key` |
| `ITEMS_EXPORT_FEED.md` | 160 | `curl-auth-header` (`X-Feed-Key`) |

Both are in documentation `curl` examples. Because they are in history, deleting the lines does not remove them — anyone with repository access can recover them from the commit.

**Action required:** confirm whether the `X-Feed-Key` value is still accepted by the live items feed. If yes, **rotate immediately** — this is the only finding where the secret may be both live and published.

- **Evidence:** `03-secrets/gitleaks-history.json` (values redacted)

### SAST-05 · Client IP taken from untrusted header — 26 sites
**Severity: HIGH · CWE-348 Use of Less Trusted Source · Source: custom rule `inventre-client-ip-from-xff`**

Confirms and extends audit finding F-02. Semgrep found **26 sites** (manual grep found 23), each reading the leftmost `X-Forwarded-For` entry. nginx uses `$proxy_add_x_forwarded_for`, which **appends** the real address, so the leftmost hop is attacker-supplied. Every IP-keyed rate limit is bypassable by rotating a header — including OTP request (SMS spend), admin login, password reset, and the student-search endpoint.

nginx already sets a trustworthy `X-Real-IP $remote_addr`, which the application ignores in 26 of 28 sites.

- **Remediation:** one `clientIp()` helper, 26 call sites. Phase 1C.

### SAST-06 · Broken regex escaping in SQL — 109 sites
**Severity: MEDIUM (latent) · CWE-116 Improper Encoding · Source: custom rule `inventre-sql-regex-single-backslash`**

Confirms audit finding F-05 and finds **109 sites** (62 in `app/`+`lib/`, 47 in `scripts/`) versus 103 by manual grep. In a JavaScript template literal `\D` cooks to `D`, so Postgres receives `regexp_replace(x, 'D', '', 'g')` — stripping the letter D instead of non-digits.

Not currently firing: all 34,288 `student_guardian_links` rows hold bare digits. It fires the day any import writes `+91 98765 43210`. Affected paths are the family-phone graph, account recovery, phone change and guardian merge — where a wrong match means showing one family another family's children.

- **Remediation:** replace with the existing tested `last10Sql()` helper (31 sites already use the correct `'\\D'` form). Phase 3.

### SAST-07 · OTP bypass reachable without a production guard — 5 sites
**Severity: CRITICAL (latent) · CWE-798 Hard-coded Credentials · Source: custom rule**

Confirms audit finding F-01. `getBypassOtp()` is reachable from 5 call sites with no `NODE_ENV` guard. `OTP_BYPASS_CODE` is a 6-digit numeric value set in the production environment file. The gate is `OTP_TEST_BYPASS === "1" || !smsRealSend`, and `smsRealSend` is a `system_settings` row flippable from `/admin/settings/otp`.

Currently safe — both toggles are `true` and `OTP_TEST_BYPASS` is unset — but one admin click makes one fixed code a valid login for every parent account.

- **Remediation:** Phase 1C, first item.

### SAST-08 · Non-constant-time secret comparison — 8 sites
**Severity: LOW · CWE-208 Observable Timing Discrepancy · Source: custom rule**

8 confirmed (of 12 raw; 4 false positives listed in §4). Cron and sync endpoints compare shared secrets with `===`/`!==`, which short-circuits on the first differing byte:

`app/api/admin/sync-staging/route.ts:15` · `cron/auto-po:13` · `cron/ccavenue-reconcile:41` · `cron/ccavenue-settlement-reconcile:38` · `cron/cleanup-carts:26` · `cron/erp-webhook-drain:55` · `cron/retry-webhooks:11` · `cron/sync-items:23`

Practical exploitation over a network is difficult, but the fix is trivial and the ERP webhook routes already do it correctly (`timingSafeEqHex` with a length guard). This compounds with the cron-auth sprawl already noted: four different conventions (`CRON_SECRET` Bearer, `CRON_TOKEN` Bearer, `CRON_TOKEN` via `x-cron-token`, `x-cron-key`).

- **Remediation:** one helper using `crypto.timingSafeEqual`. Phase 2.

### SAST-09 · Unescaped SQL interpolation surface — 9 app sites
**Severity: LOW (no exploitable path found) · CWE-89 · Source: custom rule**

All 9 `sql.raw()` call sites in application code were read individually. **None is currently injectable:**

| Site | Argument | Why safe |
|---|---|---|
| `payments/ccavenue/page.tsx:201,235` | `String(STUCK_MINUTES)` | module constant |
| `lib/erp-backfill.ts:190` | `String(BACKFILL_COOLDOWN_HOURS)` | module constant |
| `settings/erp-bridge/page.tsx:36` | `erp.${t}` | `t` from a fixed in-file list |
| `guardians/merge-by-phone:157` | `sql.raw(k)` | `k` from an `as const` allowlist |
| `recover/search:70` | `sql.raw(col)` | called only with the literal `"p.phone"` |
| `lib/erp-bridge.ts:1384` | quoted UUID list | filtered through `isUuid()` |
| `lib/erp-customer-orders.ts:1130` | `shipmentIds.join(",")` | numeric ids from the database |
| `lib/erp-stranded.ts:82` | `orderIds.join(",")` | typed `number[]` |

Recorded as a **pattern risk, not a vulnerability**: string-building into `sql.raw()` is one refactor away from injection, and SAST-02 flags a drizzle identifier-escaping CVE in the same area. Prefer `sql.join()` with bound parameters.

### SAST-10 · TLS verification disabled — 1 site
**Severity: LOW · CWE-295 Improper Certificate Validation · Source: Semgrep community + custom rule**

`scripts/dump-erpnext-items.ts:29` sets `rejectUnauthorized: false` to reach a self-signed bare-IP host on `:8443`. **Zero occurrences in `app/` or `lib/`** — correctly contained to one script, with a comment saying so. Accepted risk; pin the certificate if the script is kept.

### SAST-11 · Architectural findings (not vulnerabilities)

Recorded for the refactor, not as security defects:

| Rule | Sites | Meaning |
|---|---|---|
| `db-access-in-page-component` | 240 | SQL inside page components — the reason almost nothing is testable without a live Postgres (audit F-08) |
| `silent-error-swallow` | 44 (app) | Empty `catch` blocks discarding errors |
| `hardcoded-postgres-dsn` | 43 (1 in app code) | 42 in `scripts/`; the one app instance is the staging DSN at `sync-staging/route.ts:38` |

---

## 4 · False positives — documented for evidence integrity

**25 of 507 custom-rule findings were false positives.** Recording them matters: an assessment that reports raw tool output is not an assessment.

### `inventre-sensitive-value-logged` — 22 raw, **0 real**

Every hit logged an error object or a message string that merely *named* a secret. Examples: `console.error("[otp/request resend] send failed:", err)`, `console.error("[fees-viewer] refusing a password shorter than 12 characters")`. No hit logged a secret value.

**Rule corrected** — the metavariable now must be an identifier/member path, not a string literal:

```
regex: ^(?=.*(?i:otp|password|passwd|secret|token|apikey|api_key|working_key|encresp|jwt))[A-Za-z_$][A-Za-z0-9_$.\[\]]*$
```

Re-run after the fix: **0 findings**, confirming all 22 were noise.

### `inventre-non-constant-time-secret-compare` — 12 raw, 8 real, 4 false

- `lib/portal-token.ts:55` — `if (sig.length !== expected.length) return null;` is the **correct** length guard *before* `timingSafeEqual`. Flagging it is exactly backwards.
- `scripts/audit-grade-by-school.ts:35`, `scripts/e2e.ts:646`, `scripts/reflag-new-students-2026.ts:107` — comparing data, not secrets.

### Tool defects found and fixed during the assessment

Two of my own rules were initially broken and would have silently reported zero:

1. **`[^)]*` stopped at the first `)`** — `regexp_replace(coalesce(phone_no,''), '\D', …)` contains a nested paren, so the pattern never reached the regex class.
2. **YAML `|` block scalars append a trailing newline**, which made the regex require a newline immediately after the closing quote. Changed to `|-`.

Both were caught by testing the rule against known-vulnerable source (`app/api/auth/recover/confirm/route.ts`, 4 known matches) rather than trusting a clean result. After the fix the rule found 109 sites. **A SAST rule that reports zero must be proven, not believed.**

---

## 5 · Summary by severity

| Severity | Count | Findings |
|---|---|---|
| **Critical** | 2 | SAST-01 (Next.js middleware bypass), SAST-07 (OTP bypass, latent) |
| **High** | 3 | SAST-02 (7 vulnerable deps), SAST-03 (root SSH password), SAST-05 (26 spoofable-IP sites) |
| **Medium** | 2 | SAST-04 (2 keys in published history), SAST-06 (109 broken regex sites, latent) |
| **Low** | 3 | SAST-08 (8 timing compares), SAST-09 (9 raw-SQL sites), SAST-10 (1 TLS bypass) |
| Architectural | 1 | SAST-11 (327 sites — refactor scope, not vulnerabilities) |

---

## 6 · Remediation and re-test plan

| ID | Phase | Re-test method |
|---|---|---|
| SAST-01 | 1A | `npm audit` clean of the advisory + full manual regression |
| SAST-02 | 1A | `npm audit` clean of high/critical except an accepted `xlsx` decision |
| SAST-03 | 1A | gitleaks clean; verify absent from image and build context; credential rotated |
| SAST-04 | 1A | Confirm the feed key is rejected after rotation |
| SAST-05 | 1C | Custom rule returns 0; test proving a spoofed XFF does not raise the limit |
| SAST-06 | 3 | Custom rule returns 0; unit tests on `last10Sql()` with `+91`-formatted input |
| SAST-07 | 1C | Custom rule returns 0; test asserting the bypass throws when `NODE_ENV=production` |
| SAST-08 | 2 | Custom rule returns 0 for app code |
| SAST-09 | 3 | Reviewed at each `sql.raw()` change |
| SAST-10 | accepted | Documented exception |

**Every remediation must re-run this exact ruleset.** The custom rules become a CI gate in Phase 1B, so a fixed finding cannot silently return.

```bash
semgrep scan --config docs/security/SAST-20260909/02-static-analysis/inventre-rules.yaml \
  --exclude=node_modules --exclude=.next --exclude=backups --exclude=docs \
  app lib db components middleware.ts scripts
```

---

## 7 · Evidence index

| Artefact | Path |
|---|---|
| Dependency scan (production) | `01-dependency/npm-audit-production.{json,txt}` |
| Dependency scan (incl. dev) | `01-dependency/npm-audit-all.json` |
| Community ruleset output | `02-static-analysis/semgrep-raw.json` |
| Custom ruleset | `02-static-analysis/inventre-rules.yaml` |
| Custom ruleset output | `02-static-analysis/semgrep-inventre.json` |
| Secret scan (redacted) | `03-secrets/gitleaks-history.json` |
| Pre-refactor baseline | `../../pre-refactor-baseline.md` |

---

## 8 · Limitations

This is **static** analysis only. It cannot find runtime authorization failures, session-handling flaws, business-logic abuse, or anything requiring a running application. The three most serious issues in the companion audit — the OTP toggle, the spoofable rate limits, and the 62 unguarded admin pages — were found by **manual review, not by any tool**.

Still outstanding from the QA programme:

- **DAST** — needs a running target; recommended against the Phase 0 restored copy, not production
- **Penetration testing** — not performed; requires explicit written authorisation
- **Infrastructure/network VAPT** — out of scope for application SAST; recommend an independent assessor for auditor-acceptable evidence
- **HLT / UAT** — deferred until after the backend restructure, per your instruction

---

## 9 · Sign-off

| Role | Name | Date | Signature |
|---|---|---|---|
| Assessor | | 2026-09-09 | |
| Reviewed by | | | |
| Remediation approved by | | | |
| Re-test verified by | | | |

**Status: OPEN — no remediation performed. This assessment made no changes to the codebase.**
