# Inventre — full audit and refactor plan

**Date:** 2026-09-10 · **Branch:** `refactor/server-client-split` · **HEAD:** `922137c`
**Rollback checkpoint:** `/root/inventre-checkpoints/20260910-refactor-baseline` (verified by restore — see `RESTORE.md` there)
**Nothing in the application, schema or data was changed to produce this document.**

---

## 0. The checkpoint, first

Taken before any analysis, and **proved** rather than assumed.

| | |
|---|---|
| Production DB | `pg_dump` custom format (210 MB), plain SQL (210 MB), schema-only, globals |
| Dev DB (`:6533`) and third local DB (`:55432`) | 184 MB, 98 MB |
| Source | `git bundle --all` (20 MB, `bundle verify` passes) + working-tree tar incl. untracked and `.env*` (222 MB) |
| Config | `.env.deploy`, `.env.local`, both compose files, whole `deploy/`, root crontab, nginx, `docker inspect` |
| Integrity | `SHA256SUMS.txt` over all 45 files |

**Restore test, run today at 16:51:** the production dump restored into a scratch Postgres 16 with `pg_restore` exit 0, **zero errors**, 128 tables, and exact row-count matches on every table checked — orders 31,410 · order_items 80,899 · students 24,200 · parents 24,335 · payments 31,093 · returns 2,474 · mcb_fee_transactions 309,101. Whole-database estimate 2,840,155 rows in production vs 2,840,649 restored; the difference is live traffic written after the dump.

A backup nobody has restored is a rumour. This one is not.

---

## 1. Where the codebase actually stands

~213,000 lines of TypeScript across 1,373 files. Next.js 15 App Router, Drizzle + `postgres.js`, Postgres 16, Redis, MinIO, deployed by `scripts/deploy.sh` into `inventre-deploy-app`.

| Area | Files | Lines |
|---|---|---|
| `app/` (236 API routes, 151 pages) | 467 | 66,447 |
| `components/` | 174 | 40,775 |
| `server/` (backend modules, 22 repos) | 120 | 30,696 |
| `db/` (schema + 85 migrations) | 123 | 28,849 |
| `scripts/` (one-off and operational) | 184 | 30,905 |
| `lib/` | 35 | 4,918 |
| `features/` (the one domain module) | 2 | 389 |
| `tests/` | 7 | 424 |

**Health signals, all green as of today:** `npm run typecheck` passes with 0 errors · `npm test` 50 tests in 8 files pass · `npm run lint` 0 errors (33 warnings) · `/api/health` reports `db:true, redis:true` · only 8 `as any` in the entire shipping tree · 45 `db.transaction` call sites · zod validation in 141 of 231 API routes.

This is not a rotting codebase. Twenty-one commits landed today alone — a linter that passes, security headers, per-section admin authorization, a nightly verified backup, a CI gate, and the first extracted domain module. The refactor below continues that line of work; it does not restart it.

---

## 2. Findings

Ordered by what blocks the refactor, not by how alarming they sound.

### A. The schema can now be rebuilt from source — and that change is still uncommitted 🟢→🔴

`drizzle-kit push` had put **one schema, eleven tables, an enum and 110 columns** onto the live databases that no migration ever wrote down. On an empty database the chain died at migration 0015 after 73 of 116 tables. Consequences: disaster recovery depended entirely on the nightly dump, and CI could not gate on `npm run build` because static generation reads the database for 173 pages.

The working tree fixes this — `0014_missing_pushed_tables.sql`, three guarded migrations, a historical-seed skip, and `scripts/assert-schema-complete.ts`.

**I verified it end to end today** against a throwaway Postgres 16: all 85 migrations applied in order to an empty database, 108 tables built, and `assert-schema-complete` reported *all 94 tables and 1,100 columns declared in `db/schema.ts` exist*.

It works, and it is **8 uncommitted files** on a machine where `scripts/deploy.sh` builds the working tree. This is the single highest-value thing in the tree and it is the least protected. Commit it first.

### B. There is no repository boundary 🔴

**146 files under `app/` query the database directly** — 101 API route handlers and 43 pages/components — alongside 22 repository modules in `server/repos/` (5,742 lines) that already do it properly. Both patterns are live; neither wins.

The consequence is stated in the project's own `vitest.config.ts`: *"this codebase reaches the database from 282 route and page files, so a test that needs one would need most of the app standing up, and nobody would run it."* That is exactly right, and it is why 213k lines have 50 tests.

The database client compounds it: `db` is a module-level singleton behind a `Proxy` (`db/client.ts`). There is no way to hand a route a different connection — not a transaction, not a fixture, not a scratch database. Testability is blocked at the client, not at the call sites.

### C. Test coverage is close to zero where the money is 🔴

Eight test files. Six are pure-function unit tests (phone, grade, tax, return-qty, exchange-shared, bookkit eligibility), one is an excellent executable-architecture suite, one is a regression test.

Nothing tests: checkout, CCAvenue capture and settlement reconciliation, the ERP outbound bridge, ERP polling, exchange/missing eligibility, the bundle engine, magic-box rules, pricing, MCB fee ingestion. Every one of those has caused a production incident this year — the git history and the memory notes are a list of them.

### D. The same business rule is decided in many places 🟠

Grade handling appears in 98 `app/` files, 28 components, 26 `server/` files and 89 scripts. Delivered/packing state in 28 + 15 + 22. Money in paise in 43 `app/` files and 8 components, with 50 places outside the server doing currency arithmetic in the UI.

There is no single answer to "what grade is this student", "is this line delivered", "what does this school pay" — there are dozens of nearly-identical answers, which is precisely how the grade-offset, packing-state and price-override incidents happened.

### E. Four modules carry too much 🟠

`server/erp-customer-orders.ts` 2,495 lines · `erp-poll.ts` 1,643 · `erp-bridge.ts` 1,543 · `return-line-eligibility.ts` 1,047. On the UI side `_wizard.tsx` 2,346 and `ExchangeForm.tsx` 1,928 mix presentation with rules.

Fan-in makes them load-bearing: `admin-guard` is imported by 204 files, `session` by 49, `erp-bridge` by 17, `exchange-gate` by 12. Each mixes transport, mapping and decision-making in one file, so none of the three can be tested separately.

### F. 108 environment variables, read inline, validated nowhere 🟠

`process.env.X` is dereferenced across `app/`, `server/`, `lib/`, `components/` and `db/` for 108 distinct names — payment keys, ERP credentials, SMS, MCB, S3, JWT secrets, feature flags. There is no config module and no validation at boot. A missing or misspelled variable becomes a runtime failure on the one code path that reads it, in production, at the worst moment. `NEXT_PUBLIC_APP_URL` being baked in at build time has already bitten this project.

### G. 28 tracked scripts contain live connection strings 🔴 (security)

The architecture test already forbids this in shipping code and explicitly excludes `scripts/` pending rotation. Those credentials are in the git history and in every clone and bundle — including the checkpoint I just made. Deleting the lines does not help; the credentials must be rotated.

Related, and confirmed today: `main` is **66 commits ahead of `origin/main`**. Three months of work exists on this disk and nowhere else. The checkpoint is on the same NVMe as production.

### H. A third of the schema has never been used 🟡

33 of the ~94 public tables hold zero rows: purchase orders, purchase invoices, purchase receipts, suppliers, gift cards, loyalty ledger, coupons, discount rules, wishlists, shipments, companies, payment schedules, product badges/barcodes/UOMs, and more — an ERP-shaped ambition the business never switched on. Repository modules, admin pages and API routes exist for several of them.

**Do not delete any of it.** It is inert, it costs nothing at runtime, and deleting it is the one action in this document that could destroy something someone is quietly relying on. Label it, exclude it from the refactor's scope, and revisit it as a separate decision with the business.

### I. Deploy provenance is thin, and improving 🟡

`deploy.sh` builds the **working tree**, not a revision — the preflight added today requires a clean tree, which closes most of the gap. But `--fast` copies `.next` into the live container without rebuilding the image, so the image tag no longer identifies what is running. Today's live `BUILD_ID` (`3hX5MpolYANnqOF6Lh-j6`) matches this checkout's `.next`, and the image behind it was built 62 minutes earlier. Provenance is currently "whatever this directory was when someone ran deploy".

### J. What is genuinely good, and should be built on 🟢

- `tests/architecture/invariants.test.ts` — executable architecture rules, each tied to a real incident. This is the correct mechanism and it already runs in CI and in the deploy preflight.
- `features/bookkit/domain/eligibility.ts` — the reference pattern: rules as pure functions, the route keeps gathering facts, 16 tests run in microseconds.
- `server/api-handler.ts` — zod parsing and error shaping, used by 31 routes. It should be used by all of them.
- `scripts/backup-db.sh` — deletes a dump that cannot be listed rather than keeping it. Correct instinct, rare in practice.
- Comment quality throughout is unusually high: the *why*, with dates and incident references.

---

## 3. Target architecture

Four layers, one direction of dependency. Nothing exotic — the codebase already contains a working example of every layer.

```
app/            route handlers and pages — HTTP, auth, serialization. No SQL.
  ↓
server/repos/   repositories — the ONLY place SQL is written. Take a Db, return domain types.
  ↓
features/*/domain/   pure rules. No db, no network, no Next. Fully tested.
  ↓
db/             schema, migrations, the client factory.
```

Four rules, each enforceable by a test in `tests/architecture/invariants.test.ts`:

1. **SQL lives in `server/repos/` only.** A route that needs data calls a repository.
2. **A repository takes its connection as an argument** (`db: Db = defaultDb`), so a test, a transaction or a scratch database can be handed in.
3. **Decisions are pure functions** in `features/<domain>/domain/`. Routes gather facts; domain functions decide. (Precisely the bookkit split.)
4. **Configuration is read once**, in one validated module. `process.env` appears nowhere else.

---

## 4. The plan

Every phase is behaviour-preserving, individually revertible, and has an exit criterion that a machine can check. Nothing is deleted. No rule is rewritten — rules are *moved*, and a test is written that proves the move changed nothing.

### Phase 1 — Seal the baseline (½ day)

1. **Commit the 8 uncommitted files.** Verified working today; unprotected on disk.
2. **Push to a real remote.** 66 commits exist only here.
3. **Get the checkpoint off this disk**, and add a MinIO/media backup — the only production data with no copy at all.
4. **Rotate the credentials in the 28 tracked scripts**, then strip the literals.

*Exit:* `git status` clean · `origin/main` current · a copy of the checkpoint on other hardware · the `scripts/` exclusion removed from the secrets invariant.

### Phase 2 — Make the database testable (1–2 days, no behaviour change)

5. **A test database built from migrations.** Now possible for the first time — Phase A proved the chain builds an empty database. A vitest global-setup that runs `db/migrate.ts` against a throwaway Postgres, plus a small deterministic seed.
6. **Injectable connection.** `export type Db` in `db/client.ts`; give every `server/repos/*` function a `db: Db = defaultDb` parameter. Call sites are untouched — a default parameter changes no behaviour and no signature at any existing call.

*Exit:* a repository function can be called in a test against a real schema, with no application standing up. `npm test` still green.

### Phase 3 — Move SQL into repositories, one domain at a time (2–3 weeks)

Risk order, lowest first. **One domain in flight at a time.**

| # | Domain | Files touched | Risk |
|---|---|---|---|
| 3.1 | Catalog / products / variants (read paths) | ~25 | low |
| 3.2 | Students, parents, guardians | ~20 | low |
| 3.3 | Orders — read paths | ~25 | medium |
| 3.4 | Exchange / missing / returns | ~20 | medium |
| 3.5 | Cart / checkout | ~15 | high |
| 3.6 | Payments / CCAvenue | ~12 | high |
| 3.7 | ERP sync (bridge, poll, drain) | ~20 | highest |

For each domain, the same five steps:

- **a. Characterize first.** Run the existing queries against the *restored* copy of production, capture the results as golden fixtures. This is the zero-regression guarantee, and it is only possible because the restore works.
- **b. Move the query verbatim.** Cut and paste into `server/repos/<domain>.ts`. No "while I'm here" improvements — a behaviour change hidden in a move is the one thing that breaks this plan.
- **c. Point the route at the repository.**
- **d. Re-run the golden fixtures.** Byte-identical output, or it does not land.
- **e. One commit per domain**, deployed and watched before the next begins.

*Exit per domain:* zero `db.` calls left in that domain's routes; golden tests green; deployed; a week of production with no related incident before the next high-risk domain starts.

### Phase 4 — Extract the rules that are decided in many places (1–2 weeks)

Following `features/bookkit/domain/eligibility.ts` exactly. In order of how often each has caused an incident:

- `features/grade/domain/` — grade resolution, the ERP +3 offset trap, snapshot-vs-`students.grade`.
- `features/fulfilment/domain/` — delivered / `packing_state` / category-floor badging.
- `features/pricing/domain/` — paise arithmetic, per-school override, `??` not `||`.
- `features/magicbox/domain/` — one-per-student, payment-aware, bundle-selection rules.
- `features/exchange/domain/` — eligibility, window, duplicate guard, quantity cap.

Method: write tests for the *current* behaviour first, including the odd cases the incidents produced; then move the logic; then delete the duplicates one call site at a time. The UI keeps rendering; it stops deciding.

*Exit:* each rule has one implementation and a test file that names the incident it prevents.

### Phase 5 — Split the four large modules (1 week)

`erp-customer-orders`, `erp-poll`, `erp-bridge`, `return-line-eligibility` each split three ways — transport (HTTP/queue), mapping (payload ↔ domain type), decision (pure). Mapping gets tested against real ERP payloads recorded from the restored database, which is where the sub-items and 409-sequence bugs would have been caught.

### Phase 6 — Finish the edges (3–4 days)

- Zod schemas for the 90 routes without one; `apiHandler` for all 231 (31 today).
- One validated config module; an invariant test that forbids `process.env` elsewhere.
- Mark the 33 dormant tables and their modules as inactive in `db/schema.ts` and in this document. **Not deleted.**
- Structured logging in place of the 100 bare `console.*` calls.

### Phase 7 — Make it stay (ongoing)

Extend `tests/architecture/invariants.test.ts` with: no `db.` outside `server/repos/`; no `process.env` outside config; every `features/*/domain/` file has a sibling test. The rules that already exist prove this mechanism works on this team.

---

## 5. How zero regression is actually guaranteed

Five independent nets, four of which already exist:

1. **Golden fixtures from restored production data** — the query's output before and after the move must be identical.
2. **The CI build gate** — 173 pages statically generated against a schema built from migrations. A bad query or a missing column fails on the branch.
3. **`assert-schema-complete`** — catches a chain that applies cleanly but builds the wrong schema.
4. **Executable architecture rules** — in CI *and* in the deploy preflight.
5. **The checkpoint** — restore-verified today, with a written rollback for code, working tree, single file, and database.

And the process rule that matters more than any of them: **one domain in flight, deployed and observed before the next one starts.** This project's incidents are overwhelmingly integration-shaped, not compile-shaped; they show up in production traffic, not in a test run.

---

## 6. What I did not do

- No application code, schema, migration or data was modified.
- Nothing was deleted — not the 33 empty tables, not the dormant modules, not the one-off scripts.
- Production was read (health, row counts, `pg_dump`) and never written.
- The scratch containers used for the migration and restore tests are throwaway and hold no production role.
