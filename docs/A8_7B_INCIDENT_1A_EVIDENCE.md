# A8.7b-INCIDENT-1a — Local PostgreSQL 17 Migration Rehearsal Evidence

**Status:** all three phases green. Production was never contacted.

This records a local-only rehearsal of the Prisma migration path required to repair Production, which
is running A8 runtime code from `ee5e82a` against a database holding only the five pre-A8 migrations.
The rehearsal proves the repair operation on the same PostgreSQL major version Production runs, using
the real `prisma migrate deploy` code path, without any production credential.

Phase 2 is the decisive artifact: it is the exact operation the production repair would perform.
Phase 3 exercises the later rollout path and **authorizes nothing** about it.

---

## 1. Date and verification window

| Item         | Value                                               |
| ------------ | --------------------------------------------------- |
| Date         | 2026-08-04                                          |
| Window start | 2026-08-04T07:11:31Z (safety baseline recorded)     |
| Window end   | 2026-08-04T07:33Z (approximate, final verification) |
| Scope        | Local only. No production contact of any kind.      |

## 2. Initial repository state

| Item                           | Value                                      |
| ------------------------------ | ------------------------------------------ |
| `git rev-parse HEAD`           | `4d04a2e2bfb14a8618f86bc312fbd45362d84332` |
| `git rev-parse origin/main`    | `ee5e82a0466fa08086fbd007d4b68342f2c8a6db` |
| `git status --short`           | empty                                      |
| `git status --porcelain -uall` | empty (0 entries)                          |
| Working tree                   | **clean** — precondition satisfied         |

No fetch, pull, merge, rebase, tag, push, or history rewrite occurred at any point.

## 3. Docker image and PostgreSQL version

| Item                      | Value                                                                                                      |
| ------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Compose image (was)       | `postgres:16`                                                                                              |
| Compose image (now)       | `postgres:17`                                                                                              |
| Reported `server_version` | `17.10 (Debian 17.10-1.pgdg13+1)`                                                                          |
| Major version             | **17** — gate satisfied                                                                                    |
| Production major version  | 17 (Production reports 17.6)                                                                               |
| Match policy              | Major-version match. Exact minor match not required, and the repository has no exact-patch pinning policy. |

The image change across a major version makes the previous `aicaa_pgdata` volume unreadable, so the
volume was destroyed and recreated using the repository's own `pnpm db:docker:reset`, which exists for
exactly this purpose. The volume holds local development data only, reproducible by re-running
migrations.

## 4. Connection

| Item        | Value                                                       |
| ----------- | ----------------------------------------------------------- |
| Host        | `127.0.0.1` (loopback, compose binds `127.0.0.1:5433:5432`) |
| Port        | `5433`                                                      |
| Database    | `a87b_rehearsal` (disposable, created empty for this task)  |
| Credentials | **redacted** (disposable local development credentials)     |

Asserted before use: hostname resolves to loopback; the URL contains no Supabase hostname, no pooler
hostname, no project reference, and no `pgbouncer=true`. `packages/db/.env` was **not present in any
worktree used by the rehearsal** and therefore could not be loaded by any Prisma invocation.

### Clean-start proof

Recorded against `a87b_rehearsal` before Phase 1:

| Check                       | Result |
| --------------------------- | ------ |
| `public` tables             | 0      |
| `public._prisma_migrations` | absent |
| `public` enum types         | 0      |

## 5. Worktrees

Created outside the main repository directory, detached, under `/Users/claytonbeckler/rc-a87b-rehearsal/`.

| Worktree | Commit    | Migrations in tree | `packages/db/.env` |
| -------- | --------- | ------------------ | ------------------ |
| A        | `932a9f0` | 5                  | absent             |
| B        | `ee5e82a` | 10                 | absent             |
| C        | `4d04a2e` | 14                 | absent             |

No migration file was copied between worktrees. Each phase executed Prisma against the schema and
migrations directory belonging to its own commit.

**Recorded deviation.** The task described Phase 3 as running from the current HEAD worktree. It was
instead run from worktree C, a detached checkout of the identical commit `4d04a2e`. The main worktree
contains `packages/db/.env`, which points at Production; worktree C cannot contain it because the file
is gitignored. This makes the safety requirement structural rather than procedural, and the executed
content is byte-identical to HEAD.

## 6. Prisma version

`6.19.3` confirmed in all three worktrees before any migration ran, matching the version the
Production build uses for `prisma generate`.

## 7. Phase 1 — pre-A8 baseline

**Command:** `prisma migrate deploy` from worktree A (`932a9f0`), `packages/db`, with `DATABASE_URL`
supplied process-scoped as the loopback rehearsal URL.

**Duration:** 0.854 s. **Exit:** success.

**Result:** 5 migrations applied.

| #   | Migration                                         | finished | not rolled back | steps | ms  |
| --- | ------------------------------------------------- | -------- | --------------- | ----- | --- |
| 1   | `20260713190000_a4_persistence_foundation`        | yes      | yes             | 1     | 10  |
| 2   | `20260716140000_a5_gmail_persistence`             | yes      | yes             | 1     | 9   |
| 3   | `20260717180000_a6_suggestion_persistence`        | yes      | yes             | 1     | 3   |
| 4   | `20260718210000_a7_handoff_persistence`           | yes      | yes             | 1     | 5   |
| 5   | `20260718223000_a7_handoff_concurrency_hardening` | yes      | yes             | 1     | 2   |

Invariants: 5 rows, 5 finished, 0 rolled back, 5 with `applied_steps_count = 1`, 0 with logs.

`prisma migrate status` from worktree A: **Database schema is up to date!**

**A8 absence confirmed:** `task_reminder_schedules`, `reminder_delivery_attempts`,
`owner_notification_intents`, `owner_notification_attempts` all absent; `tasks.due_local_date` absent.

**Inventory:** 15 `public` tables, 19 enums, 67 indexes.

> The 15 tables reproduce Production's current table list exactly, so the rehearsal baseline is a
> faithful stand-in for Production's present state.

## 8. Phase 2 — the exact Production repair rehearsal

**Pre-gate:** 5 migration rows; 0 A8 tables present.

**Command:** a single `prisma migrate deploy` from worktree B (`ee5e82a`), `packages/db`. Migrations
were not applied individually.

**Duration:** 0.853 s total. **Exit:** success — _All migrations have been successfully applied._

**Result:** 5 A8 migrations applied, 10 rows total.

| #   | Migration                                   | finished | not rolled back | steps | ms  |
| --- | ------------------------------------------- | -------- | --------------- | ----- | --- |
| 6   | `20260731040000_a8_reminder_persistence`    | yes      | yes             | 1     | 11  |
| 7   | `20260731170000_a8_3b_reminder_concurrency` | yes      | yes             | 1     | 2   |
| 8   | `20260731230000_a8_advance_waiting_skip`    | yes      | yes             | 1     | 1   |
| 9   | `20260801120000_a8_4a_worker_safety`        | yes      | yes             | 1     | 3   |
| 10  | `20260802094500_a8_4a_settlement_marker`    | yes      | yes             | 1     | 2   |

Invariants: 10 rows, 10 finished, 0 rolled back, 10 with `applied_steps_count = 1`, 0 with logs.

**A8 DDL total: 19 ms.** The migration that takes `ACCESS EXCLUSIVE` on `tasks` completed in 11 ms
against a table with zero rows; Production's `tasks` holds 7 rows, which does not change the order of
magnitude because the added column is nullable with no default and therefore a catalog-only change.

### Physical schema verification

| Check                                        | Result                                                                                                     |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `public.tasks.due_local_date`                | present — `character varying(10)`, nullable, no default                                                    |
| `public.task_reminder_schedules`             | present                                                                                                    |
| `public.reminder_delivery_attempts`          | present                                                                                                    |
| `public.owner_notification_intents`          | **absent** (as required)                                                                                   |
| `public.owner_notification_attempts`         | **absent** (as required)                                                                                   |
| Migrations 6–9 in `_prisma_migrations`       | **0 rows** (as required)                                                                                   |
| Constraints on the two A8 tables             | 34, **all `convalidated = true`**                                                                          |
| Unvalidated constraints anywhere in `public` | 0                                                                                                          |
| Indexes on the two A8 tables                 | 16                                                                                                         |
| RLS on the two A8 tables                     | `relrowsecurity = true`, `relforcerowsecurity = false`, 0 policies — matching the existing `tasks` pattern |
| `public` enums                               | 25                                                                                                         |

The `reminder_delivery_attempts_settlement_only_when_terminal` check, created `NOT VALID` and then
validated within the same migration file, is recorded as validated.

`ReminderAdvanceDisposition` resolved to seven values in this order: `scheduled`,
`skipped_window_elapsed`, `skipped_waiting_elapsed`, `delivered`, `skipped_not_eligible`,
`failed_permanent`, `ambiguous`. This confirms both `ALTER TYPE ... ADD VALUE` migrations applied
correctly inside a transaction block on PostgreSQL 17.

`prisma migrate status` from worktree B: **Database schema is up to date!**, exit code 0.

## 9. Phase 3 — later rollout path, recorded separately

**Pre-gate:** 10 migration rows.

**Command:** a single `prisma migrate deploy` from worktree C (`4d04a2e`), `packages/db`.

**Duration:** 0.836 s. **Exit:** success.

| #   | Migration                                              | finished | not rolled back | steps | ms  |
| --- | ------------------------------------------------------ | -------- | --------------- | ----- | --- |
| 11  | `20260802173000_a8_4b1_capability_skip_reason`         | yes      | yes             | 1     | 3   |
| 12  | `20260802210000_a8_4b2_repeated_ambiguous_stop_reason` | yes      | yes             | 1     | 2   |
| 13  | `20260803090000_a8_4b3_advance_due_scan_index`         | yes      | yes             | 1     | 2   |
| 14  | `20260803120000_a8_5a_owner_notification_intents`      | yes      | yes             | 1     | 5   |

Invariants: 14 rows, 14 finished, 0 rolled back, 14 with `applied_steps_count = 1`.

| Check                                | Result                                      |
| ------------------------------------ | ------------------------------------------- |
| `public.owner_notification_intents`  | present, RLS enabled, force off, 0 policies |
| `public.owner_notification_attempts` | present, RLS enabled, force off, 0 policies |
| `public` tables / enums              | 19 / 30                                     |
| Unvalidated constraints              | 0                                           |
| `prisma migrate status` at HEAD      | **Database schema is up to date!**          |

> **A green Phase 3 authorizes nothing.** Migrations 6 through 9 support code that is not deployed and
> has not completed architecture review. Applying them to Production remains a separate, separately
> authorized decision.

## 10. Migration-history snapshots

| After   | Rows | Finished | Rolled back | `applied_steps_count = 1` |
| ------- | ---- | -------- | ----------- | ------------------------- |
| Phase 1 | 5    | 5        | 0           | 5                         |
| Phase 2 | 10   | 10       | 0           | 10                        |
| Phase 3 | 14   | 14       | 0           | 14                        |

## 11. Physical-schema snapshots

| After   | `public` tables | Enums | Unvalidated constraints | `tasks.due_local_date` | Reminder tables | Notification tables |
| ------- | --------------- | ----- | ----------------------- | ---------------------- | --------------- | ------------------- |
| Phase 1 | 15              | 19    | 0                       | absent                 | absent          | absent              |
| Phase 2 | 17              | 25    | 0                       | present                | present         | **absent**          |
| Phase 3 | 19              | 30    | 0                       | present                | present         | present             |

## 12. Timings and warnings

Total migration wall time across all fourteen migrations: under 2.6 s, of which the five-migration
repair operation is **0.853 s**.

Warnings observed, none migration-related:

- Prisma printed an advisory update notice (`6.19.3 -> 7.9.1`). No action taken; the pinned version is
  deliberate and matches Production's build.
- pnpm printed an advisory update notice (`9.15.9 -> 11.20.0`). No action taken.
- `CREATE DATABASE` emitted a `NOTICE` that `a87b_rehearsal` did not already exist, from the
  idempotent `DROP DATABASE IF EXISTS` guard.

No Prisma warning, no PostgreSQL warning, and no deprecation notice was emitted by any migration.

## 13. Failures

**No rehearsal phase failed.** No migration was retried, no migration was rolled back, and
`prisma migrate resolve` was never run.

One genuine finding surfaced afterwards, from the test run rather than from the rehearsal. The first
execution of the real-PostgreSQL suites failed three assertions of the form
`expect(version).toMatch(/PostgreSQL 16\./)`. These are deliberate guards that pin the engine the
concurrency evidence runs on, and the approved image pin invalidated the version they name. A
text search for the image tag had not found them, because they assert the engine's reported version
string rather than the Compose tag; only running the suites exposed them.

The guards were updated to name PostgreSQL 17. This is not a weakening: the assertion remains exactly
as strict, and still fails if the suite is pointed at any engine other than the pinned one.

### Real-PostgreSQL suite results on PostgreSQL 17

| Package      | Suites | Tests   | Result |
| ------------ | ------ | ------- | ------ |
| `@aicaa/db`  | 5      | 85      | pass   |
| `@aicaa/web` | 4      | 63      | pass   |
| **Total**    | **9**  | **148** | pass   |

Every concurrency, fencing, recovery, collation-ordering, and planner property previously proven on
PostgreSQL 16 holds unchanged on PostgreSQL 17. The image pin is therefore verified, not merely
applied.

## 14. Final repository state

Changed files are limited to the approved rehearsal scope:

1. `docker-compose.yml` — image pinned to `postgres:17`, with the accompanying comment corrected so it
   no longer states that PostgreSQL 16 is deliberate. The original rationale about the A8.3b
   concurrency suite needing two real connections is preserved and the Production major-version match
   is added.
2. `packages/db/README.md` — two statements describing the local Docker service as Postgres 16
   corrected to 17 with the version-match rationale, plus a note that a major-version image change
   requires `pnpm db:docker:reset`.
3. `docs/DEPLOYMENT.md` — the one sentence describing the local Docker service as "loopback Postgres
   16 on port 5433" corrected to 17.
4. `docs/REVIEW_CHECKLIST.md` — two review requirements demanding proof on "real PostgreSQL 16" made
   version-neutral ("the repository's real Docker PostgreSQL"), because after the pin a reviewer
   following them literally could not comply with the repository's own tooling. Version-neutral
   wording also stops them going stale on the next upgrade.
5. Eight `*.pg.test.ts` suites — the engine version they require, assert, and name in their titles
   updated from 16 to 17, as described in section 13. Four contained a live version assertion
   (`a8-6c-missed-notification-read`, `a8-5d-producer-concurrency`, `a8-5a-owner-notification` in
   `packages/db`, and `a8-5e-worker-concurrency` in `apps/web`); the other four named the required
   engine in a docstring or `describe` title. No test logic, expectation, or round count was altered.
6. `docs/A8_7B_INCIDENT_1A_EVIDENCE.md` — this document.

### Verification gate

`pnpm verify` completed successfully end to end: format check, lint, contract validation, contract
generation, contract drift check, the full test suite, the web and domain builds, and the Android
ktlint, test, API-contract, and assemble tasks. `contracts:generate` produced **no drift** — no
generated artifact changed.

Statements recording what was **historically measured** on PostgreSQL 16 were deliberately left
unchanged, in `docs/MILESTONES.md`, `docs/DEPLOYMENT.md`, and `packages/db/README.md`. They describe
evidence that was in fact gathered on PostgreSQL 16 and remain true; rewriting them would falsify the
record.

No migration SQL was changed. No test was weakened or rewritten. No unrelated file was touched.

## 15. Production contact statement

**Production was never contacted during this task.** No production credential was read, printed,
copied, or used. No production database connection was opened. No Vercel deployment, environment
variable, alias, scheduler, capability link, or Gmail resource was inspected or modified. Every
database operation in this rehearsal targeted `127.0.0.1:5433/a87b_rehearsal`, a disposable local
container database created empty for this purpose.
