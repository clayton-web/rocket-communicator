# A8.7 production rollout — evidence record

Governed by [PROJECT_CONSTITUTION.md](PROJECT_CONSTITUTION.md). Procedure: [DEPLOYMENT.md § A8.7 production rollout](DEPLOYMENT.md#a87-production-rollout). Milestone status: [MILESTONES.md](MILESTONES.md).

**This file is part record and part template.** Sections **1a** through **1d** are completed records: 1c and 1d were performed against Production on 2026-08-04 and 2026-08-05. **Gate 4 and everything after it is unfilled template**, and no part of it has been performed. A8.7a created this file; A8.7b-INCIDENT-1b restructured it around the incident.

> **A8.7b is retired.** Its section is replaced by the incident sections below — the local rehearsal (**1a**), the runbook correction (**1b**), the Production schema repair (**1c**, five migrations, no deployment), and the reminder endpoint hotfix (**1d**). The remaining four migrations are **not** part of any of them: they are [Gate 4](#gate-4--production-migrations-69), which is pending and separately authorized. Context: [MILESTONES.md](MILESTONES.md) incident notice.

## How to use this record

Copy this file to a dated working record for each slice — `A8_7B_EVIDENCE_<YYYY-MM-DD>.md` and so on — and fill it in **as each stage completes**, not afterwards from memory. An evidence record written after the fact is a summary, and a summary is exactly what is missing when a rollout has to be reconstructed.

Every stage uses the same seven headings as the runbook, in the same order. **Do not omit a heading.** Where nothing applies, write "Not applicable" and why.

### What must never appear here

- Connection strings, in whole or in part, including the password field of a redacted string
- Raw OAuth tokens, refresh tokens, or `CRON_SECRET`
- Capability tokens, capability URLs, or token hashes
- Message bodies, subject lines carrying customer content, or any personal message content
- Recipient names or email addresses — record identifiers instead
- Row contents from any table; record counts, booleans, and identifiers

The migration endpoint is recorded as a **redacted form plus its port**, for example `aws-<region>.pooler.supabase.com:5432`. Recording the port is the point of the field; recording anything left of the `@` defeats it.

---

## Session header

Fill once per slice.

| Field                                              | Value |
| -------------------------------------------------- | ----- |
| Slice (A8.7b-INCIDENT-1c / Gate 4 / A8.7c / d / e) |       |
| Date (ISO, with timezone)                          |       |
| Operator                                           |       |
| Authorization reference                            |       |
| Source commit (`git rev-parse HEAD`)               |       |
| Working tree clean at start (y/n)                  |       |
| `pnpm verify` green on this commit, and when       |       |
| Production deployment ID at start                  |       |
| Production commit at start                         |       |
| `ENABLE_OWNER_EVENT_CAPTURE` at start              |       |
| `ENABLE_OWNER_EVENT_DELIVERY` at start             |       |
| `ENABLE_REMINDER_DELIVERY` at start                |       |
| Gmail-poll job state at start                      |       |
| Suggestion-processing job state at start           |       |
| Notification job state at start                    |       |
| Reminder job state at start                        |       |
| Docker required for this slice (y/n)               |       |

**Migration endpoint** (A8.7b-INCIDENT-1c and [Gate 4](#gate-4--production-migrations-69) — the only two slices that connect to the Production database):

| Field                                      | Value |
| ------------------------------------------ | ----- |
| Redacted hostname form                     |       |
| Port                                       |       |
| Session mode confirmed (y/n, how)          |       |
| `pgbouncer=true` absent (y/n)              |       |
| Advisory-lock test result                  |       |
| **Credential not recorded anywhere (y/n)** |       |

---

## A8.7b-INCIDENT-1a — Local PostgreSQL 17 migration rehearsal

**Complete.** Recorded in full in [A8_7B_INCIDENT_1A_EVIDENCE.md](A8_7B_INCIDENT_1A_EVIDENCE.md); not duplicated here.

| Field              | Value                                                                      |
| ------------------ | -------------------------------------------------------------------------- |
| Slice commit       | `192e30381f0e7846d6bf27f9394649d3a8588837`                                 |
| Engine             | `postgres:17`, PostgreSQL 17.10, local Docker, loopback only               |
| Prisma             | 6.19.3                                                                     |
| Phase 1            | Five pre-A8 migrations from `932a9f0` — reproduced the Production baseline |
| Phase 2            | Five deployed A8 migrations from `ee5e82a` in one `migrate deploy`, 853 ms |
| Phase 2 end state  | Ten rows, all finished, none rolled back, every `applied_steps_count = 1`  |
| Phase 3            | Migrations 6–9 proved separately — **authorizes nothing in Production**    |
| Suites             | All nine real-PostgreSQL suites passed; full `pnpm verify` passed          |
| Production contact | **None**                                                                   |

---

## A8.7b-INCIDENT-1b — Incident runbook correction

**Complete.** A local documentation-and-safety slice. It corrected the Production baseline across the runbook, replaced the retired A8.7b rollout material with the incident sequence, defined the D0–D4 matrix, repointed local database credentials at loopback, removed the unguarded migration package scripts, and added guards proving the five-migration boundary.

| Field              | Value                       |
| ------------------ | --------------------------- |
| Slice commit       | _(recorded at commit time)_ |
| Production contact | **None**                    |
| Migrations applied | **None**                    |
| Deployments        | **None**                    |
| Flags changed      | **None**                    |
| Schedulers touched | **None**                    |
| Pushed             | **No**                      |

---

## A8.7b-INCIDENT-1c — Production schema compatibility repair

**Performed 2026-08-04. The schema repair succeeded; five deviations from the approved procedure are recorded below.** Procedure: [DEPLOYMENT.md § A8.7b-INCIDENT-1c](DEPLOYMENT.md#a87b-incident-1c--production-schema-compatibility-repair).

> **Closed by A8.7b-INCIDENT-1d on 2026-08-05.** The two outstanding steps — the authenticated read-only Task-list and Task-detail smoke tests — were performed there and passed. Attempting them is also what exposed the reminder endpoint defect, which was a **pre-existing packaging fault, not a consequence of this repair**. Deviation **D-d** (the skipped lock probe) cannot be satisfied retrospectively and is recorded as an accepted deviation. See [§ A8.7b-INCIDENT-1d](#a87b-incident-1d--production-reminder-endpoint-hotfix).

**This slice applies exactly five migrations and deploys nothing.** Its target state is **D1**.

**Provenance of the rows below.** Rows marked _verified_ were observed directly from this repository or from read-only Vercel control-plane queries. Rows marked _reported_ were supplied by the operator from the Production session and are recorded as stated; no credential was seen, and the database output was not independently re-read.

### Deviations from the approved procedure

| #       | Deviation                                                                              | Approved plan said                                                                                         | Status                                                                                                                                                                 |
| ------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **D-a** | The Supabase database password was **rotated**                                         | No rotation was planned, and no runbook in this repository instructs or describes one                      | Done. No procedure existed, so none was followed                                                                                                                       |
| **D-b** | Vercel Production `DATABASE_URL` was **updated**                                       | [DEPLOYMENT.md](DEPLOYMENT.md#migration-connection-strategy) states it is "**Unchanged by any A8.7 step**" | Done                                                                                                                                                                   |
| **D-c** | A **redeploy** of `ee5e82a` was performed                                              | Step 29: "**Do not push and do not deploy**"                                                               | Attempted. **No deployment was created** — see the anomaly note below                                                                                                  |
| **D-d** | The Stage 4 lock probe (step 17) and the immediate re-check (step 19) were **not run** | Both are required in the same session immediately before `migrate deploy`                                  | **Accepted deviation.** Not performable retrospectively. Preflight activity and lock checks were clean minutes earlier, and the migration completed without contention |
| **D-e** | The authenticated read-only smoke tests (steps 24–25) were **not run**                 | Both are required before the slice closes                                                                  | **Closed by 1d on 2026-08-05.** Both passed                                                                                                                            |

**Anomaly, still unexplained but no longer operationally live.** Read-only `vercel ls` and `vercel inspect` on 2026-08-04 show **no deployment created that day**; the alias holder remained `dpl_AnUKqdGj3gBw7N56yUT4pMBAVbac`, created 2026-08-01. Vercel binds environment variables to a deployment when that deployment is created, so a build predating the rotation would be expected to carry the pre-rotation credential and fail to authenticate — yet a database-backed Owner page rendered normally.

**What 1d settled and what it did not.** The 2026-08-05 hotfix deployment was created **after** the rotation, binds the current `DATABASE_URL`, and serves database-backed pages correctly, so **the Vercel Production `DATABASE_URL` is confirmed valid** and the build that produced the anomaly no longer serves traffic. **Why the pre-rotation build kept working was never determined.** The two candidate explanations — that the old credential was not actually invalidated, or that a pooled connection outlived the rotation — have different consequences for rollback, which is why [Rollback principles](DEPLOYMENT.md#rollback-principles) now treats one-step rollback as unavailable rather than merely degraded.

### 1c capture record

Fill every row. A blank row is an incomplete record, not an implied "nothing to report".

| Field                                                                                                              | Value                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Operator                                                                                                           | Repository owner (single-operator project)                                                                                                                                                                                                                        |
| Verification window (start / end, ISO with timezone)                                                               | 2026-08-04, approx. 21:25–22:04 PDT (America/Vancouver) — _reported_                                                                                                                                                                                              |
| Authorization reference                                                                                            | A8.7b-INCIDENT-1c, approved in session after the preflight checkpoint                                                                                                                                                                                             |
| Local `git rev-parse HEAD`                                                                                         | `fee526d` — _verified_                                                                                                                                                                                                                                            |
| Local `git rev-parse origin/main`                                                                                  | `ee5e82a` — _verified_                                                                                                                                                                                                                                            |
| Worktree commit used for the migration                                                                             | `ee5e82a`, detached — _verified_                                                                                                                                                                                                                                  |
| Worktree migration-directory count (**expect 10**)                                                                 | **10** — _verified_                                                                                                                                                                                                                                               |
| `packages/db/.env` absent from worktree (y/n)                                                                      | **y** — _verified_; no `.env` anywhere in the tree                                                                                                                                                                                                                |
| Production deployment ID at start                                                                                  | `dpl_AnUKqdGj3gBw7N56yUT4pMBAVbac` — _verified_                                                                                                                                                                                                                   |
| Production commit at start (**expect `ee5e82a`**)                                                                  | `ee5e82a` — consistent with `origin/main` and the deployment timestamp                                                                                                                                                                                            |
| Containment deployment `8588c5d` available and redeployable (y/n, how confirmed)                                   | **y** — `dpl_7vmnL71Lck7JLeftgsJkYVJ4uw82`, ● Ready via read-only `vercel ls` — _verified_. Thirteen deployments back, so **not** one-step reachable                                                                                                              |
| Scheduler dashboard state as found (each job, enabled or paused)                                                   | Gmail Poll **disabled**; Suggestion Processing **disabled** — _reported_                                                                                                                                                                                          |
| Scheduler actions taken (paused which, at what time)                                                               | None required; both already disabled — _reported_                                                                                                                                                                                                                 |
| Owner no-use window confirmed (y/n, by whom, duration)                                                             | **y**, by the operator, open across the window — _reported_                                                                                                                                                                                                       |
| Endpoint classification (redacted host form, port, session mode, `pgbouncer=true` absent)                          | `aws-<region>.pooler.supabase.com`, port **5432**, session mode, no `pgbouncer=true` — _reported_                                                                                                                                                                 |
| **Credential not recorded anywhere (y/n)**                                                                         | **y** — never transmitted to or seen by the assistant; not written to any file                                                                                                                                                                                    |
| PostgreSQL version                                                                                                 | **17.6** — _reported_                                                                                                                                                                                                                                             |
| Pre-migration history: row count (**expect 5**), all finished                                                      | **5**, all finished — _reported_                                                                                                                                                                                                                                  |
| Pre-migration physical state: `tasks.due_local_date` absent, all four A8 tables absent                             | Column absent; all four tables absent; no A8 enum types — _reported_                                                                                                                                                                                              |
| Failed or unfinished migration rows before (**expect none**)                                                       | **None** — _reported_                                                                                                                                                                                                                                             |
| Activity check result (Q4, against the allowlist)                                                                  | No active transactions, no idle-in-transaction sessions — _reported_                                                                                                                                                                                              |
| Lock probe result (Stage 4)                                                                                        | **Not performed** — deviation **D-d**. Preflight showed no locks on `tasks` and no advisory locks                                                                                                                                                                 |
| Activity and lock checks repeated immediately before migrating                                                     | **Not performed** — deviation **D-d**                                                                                                                                                                                                                             |
| Migration start time                                                                                               | Not recorded                                                                                                                                                                                                                                                      |
| Migration end time                                                                                                 | Not recorded                                                                                                                                                                                                                                                      |
| Wall-clock duration                                                                                                | Not recorded. Rehearsal reference: 853 ms                                                                                                                                                                                                                         |
| Prisma output (**connection string redacted**)                                                                     | Five migrations applied in one `migrate deploy`; subsequent `migrate status`: "Database schema is up to date." — _reported_                                                                                                                                       |
| Post-migration history: row count (**expect 10**), all finished, none rolled back, every `applied_steps_count = 1` | **10**, all finished, none rolled back — _reported_. `applied_steps_count` not separately confirmed                                                                                                                                                               |
| Post-migration physical schema (column, two tables, constraints, indexes, enums, RLS)                              | `tasks.due_local_date` present and nullable, backfill count **0**; both reminder tables present with **0** rows; RLS enabled on both; **6** `Reminder*` enum types; `reminder_delivery_attempts_settlement_only_when_terminal` present and validated — _reported_ |
| **Migrations 6–9 absent from history (y/n)**                                                                       | **y** — _reported_                                                                                                                                                                                                                                                |
| **`owner_notification_intents` and `owner_notification_attempts` absent (y/n)**                                    | **y**, with all `OwnerNotification*` enum types and both future enum labels (`no_actionable_capability`, `repeated_ambiguous_outcomes`) absent — _reported_                                                                                                       |
| Authenticated Task-list smoke result (read-only)                                                                   | **Passed 2026-08-05** under 1d — _reported_. Deferred from this slice as deviation **D-e**                                                                                                                                                                        |
| Authenticated Task-detail smoke result (read-only)                                                                 | **Passed 2026-08-05** under 1d — _reported_                                                                                                                                                                                                                       |
| **No mutation performed (y/n)**                                                                                    | **y** — _reported_                                                                                                                                                                                                                                                |
| **No reminder created or modified (y/n)**                                                                          | **y** — _reported_                                                                                                                                                                                                                                                |
| Scheduler state after repair (left as found, y/n)                                                                  | **y** — both remain disabled — _reported_                                                                                                                                                                                                                         |
| Flags after repair (**expect all three absent**)                                                                   | All three absent — _verified_ by read-only `vercel env ls production` on 2026-08-04                                                                                                                                                                               |
| **Nothing pushed (y/n)**                                                                                           | **y** — `origin/main` still `ee5e82a`; local commits unpushed — _verified_                                                                                                                                                                                        |
| **Nothing deployed; deployment ID unchanged (y/n)**                                                                | Deployment ID **unchanged** — _verified_. But a redeploy **was attempted** (deviation **D-c**) and produced no deployment; see the anomaly note                                                                                                                   |
| Incident classification after repair                                                                               | Schema incompatibility **resolved**. The incident stayed open past this slice and was **closed on 2026-08-05** by 1d                                                                                                                                              |
| Final state (**expect D1**)                                                                                        | **D1 reached.** It proved defective on the reminder path for reasons unrelated to the migration, so D1 was never validated; Production moved to **D1′** the next day                                                                                              |
| Task row count preserved (**expect unchanged**)                                                                    | **7** before and after — _reported_                                                                                                                                                                                                                               |

### Per-stage records

Stages 1 through 10 below are the per-stage detail behind that table. **Stage 9 is retired — no deployment occurs in this slice.**

### Stage 1 — Production preflight

**Preconditions.** Met / not met, with detail:

**Execution.** Queries run and when:

**Verification.** `tasks.count.before` = · `migrations.status.before` = · `migrations.failed_rows` = · flags read as:

**Stop/go criteria.** Decision (**go** / **stop**) and the reason:

**Immediate containment.** Not applicable unless something was changed — state which:

**Recovery or rollback.** Not applicable unless invoked — state which:

**Evidence to record.** Attach or transcribe: Q1, Q2, Q3 output; deployment ID; commit; three flag values.

### Stage 2 — Migration connection verification

**Preconditions.**

**Execution.**

**Verification.** Hostname form · port · `pgbouncer` absent · advisory-lock result · nine pending migrations listed:

**Stop/go criteria.**

**Immediate containment.** `MIGRATE_URL` unset (y/n):

**Recovery or rollback.**

**Evidence to record.** Redacted endpoint form, port, session-mode confirmation, advisory-lock result, the nine pending names, **explicit confirmation the credential was not recorded**.

### Stage 3 — Long-running transaction inspection

**Preconditions.** Run immediately before migration, at (timestamp):

**Execution.** Q4 run at:

**Verification.** `preflight.transactions` — sessions not idle: · oldest transaction age: · any `idle in transaction`: · all sources identified (y/n):

**Stop/go criteria.**

**Immediate containment.** No backend was terminated (confirm y/n):

**Recovery or rollback.**

**Evidence to record.** Q4 output with queries truncated to 80 characters and no PII.

### Stage 4 — Out-of-band `tasks` lock probe

**Preconditions.**

**Execution.** Probe run at:

**Verification.** `lock_probe.result` — acquired promptly / timed out after:

**Stop/go criteria.**

**Immediate containment.** Transaction rolled back (y/n) · session ended if interrupted (y/n):

**Recovery or rollback.**

**Evidence to record.** Probe output and elapsed time.

### Stage 5 — Scheduler pause

**Preconditions.**

**Execution.** Gmail-poll paused at: · suggestion-processing paused at:

**Verification.** `schedulers.paused` — both confirmed paused (y/n) · no execution after the pause time (y/n):

**Stop/go criteria.**

**Immediate containment.**

**Recovery or rollback.** Resume performed in Stage 10 at:

**Evidence to record.** Job names, pause timestamps, post-pause execution log check.

### Stage 6 — Migration application

**Preconditions.** Stages 1–5 all passed in this window (y/n), with times:

**Execution.** Command sequence run at: · wall-clock duration:

**Verification.** `migrations.status.after` = · nine applied names: · Q2 = · Q3 = :

**Stop/go criteria.** Exit code · advisory-lock timeout encountered (y/n):

**Immediate containment.** No deployment performed while unresolved (y/n):

**Recovery or rollback.** Forward-only; state whether Stage 7 was entered:

**Evidence to record.** Full console output **with the connection string redacted**, `migrate status` before and after, duration.

### Stage 7 — Failed-migration classification and recovery

**Skipped entirely if Stage 6 succeeded.** State "skipped — Stage 6 succeeded" and move on.

**Preconditions.** Failing migration file:

**Execution.** Detection queries run, per that migration's recovery-tree entry:

**Verification.** Physical state classification (**none present** / **all present** / **some present**) and the query output supporting it:

**Stop/go criteria.** Escalated (y/n) · second reviewer · decision:

**Immediate containment.** Schedulers still paused (y/n) · no deployment (y/n) · no hand cleanup (y/n):

**Recovery or rollback.** Action taken, the recovery-tree entry authorizing it, and the post-action `migrate status`:

**Evidence to record.** Failing migration name, full error, every detection query result, classification, action, authorization, post-action status.

### Stage 8 — Post-migration schema verification

**Preconditions.**

**Execution.** Q5–Q14 and Q1 re-run at:

**Verification.** **Five-migration expectations, not nine.** Two tables, six enums, no notification objects. See [five-migration expectations](DEPLOYMENT.md#five-migration-expectations-a87b-incident-1c).

| Assertion                                            | Expected              | Observed |
| ---------------------------------------------------- | --------------------- | -------- |
| `schema.due_local_date` exists and nullable          | yes                   |          |
| `schema.due_local_date.nonnull` (Q6)                 | **0**                 |          |
| `schema.tables` (Q7)                                 | **2** reminder only   |          |
| `schema.rowcounts.after` (Q8, two-table variant)     | **0, 0**              |          |
| `schema.rls` (Q9)                                    | **2 rows**, both true |          |
| `schema.columns` (Q10)                               | all 7                 |          |
| `schema.constraints` (Q11)                           | repair set only       |          |
| `schema.enums` (Q12)                                 | **6** `Reminder*`     |          |
| `schema.indexes` (Q13), all `indisvalid`             | true                  |          |
| `schema.settlement_constraint` (Q14) `convalidated`  | true                  |          |
| `tasks.count.after` (Q1) equals `tasks.count.before` | yes                   |          |
| **Boundary (QB)** — notification tables              | **absent**            |          |
| **Boundary (QB)** — `OwnerNotification*` enum types  | **absent**            |          |
| **Boundary (QB)** — `no_actionable_capability`       | **absent**            |          |
| **Boundary (QB)** — `repeated_ambiguous_outcomes`    | **absent**            |          |

**Stop/go criteria.**

**Immediate containment.**

**Recovery or rollback.**

**Evidence to record.** The table above, complete.

### Stage 9 — Retired. No deployment occurs in the repair

**Preconditions.** None — the stage is retired.

**Execution.** None. **Do not deploy.**

**Verification.** Production deployment ID unchanged from Stage 1 (y/n) · still serving `ee5e82a` (y/n):

**Stop/go criteria.** Deployment ID changed during the window (y/n — any "y" is a hard stop):

**Immediate containment.** Not applicable — nothing is deployed by this stage.

**Recovery or rollback.** Not applicable — nothing is deployed by this stage.

**Evidence to record.** Explicit statement that no deployment was performed, and the unchanged deployment ID.

### Stage 10 — Read-only application smoke verification

**Deferred out of 1c as deviation D-e and performed under 1d on 2026-08-05.** The results below were observed against `534959d`, not `ee5e82a`, because the first attempt at this stage is what revealed the reminder defect.

**Preconditions.** Stage 8 passed: **y** · no deployment occurred **during 1c**: **y**

**Execution.** Smoke checks run 2026-08-05 after the hotfix promotion · **schedulers left as found, not resumed**: **y**

**Verification.**

| Check                                  | Expected                                            | Observed                                                  |
| -------------------------------------- | --------------------------------------------------- | --------------------------------------------------------- |
| `GET /api/v1/session`                  | 200, owner, `axford`                                | 200 — _reported_                                          |
| `GET /api/v1/tasks`                    | 200, cursor page — proves `due_local_date` resolves | 200, expected task JSON — _reported_                      |
| Owner `/tasks`                         | renders                                             | Renders — _reported_                                      |
| Task detail                            | renders                                             | Renders — _reported_                                      |
| `GET /api/v1/tasks/{taskId}/reminder`  | 200, `no_due_date`, ETag ending `v0`                | **200**, `state=no_due_date`, ETag ends `v0` — _reported_ |
| `GET /api/v1/tasks/task_doesnotexist…` | typed `NOT_FOUND`                                   | Typed `NOT_FOUND` — _reported_                            |
| **No mutation performed**              | **y**                                               | **y** — _reported_                                        |
| **No reminder created or modified**    | **y**                                               | **y** — _reported_                                        |
| **No scheduler resumed**               | **y**                                               | **y** — _verified_; no scheduler was contacted at all     |

**The Task-detail reminder panel is not checked, and the original row asking for it was wrong.** The panel is an **A8.6b** surface and A8.6 is not deployed, so the deployed Task detail page issues no reminder request. Refreshing it produces no `/reminder` call, which is correct behaviour and not a symptom. The reminder resource must therefore be probed **directly**, as the two rows above do.

**`/attention` is not checked.** The route has existed since the P1.4 Owner shell and **is** served, but the A8.6a reminder-derived content that would make it meaningful is not deployed.

**Stop/go criteria.** Go. Every check passed.

**Immediate containment.** Not required.

**Recovery or rollback.** Not required.

**Evidence to record.** The table above, plus confirmation that no mutation, reminder action, or scheduler change occurred.

**Final observed state after 1c and 1d.** Deployment `dpl_3oder2T3PuDYdmp8pezy6u7RwPRm` · commit `534959d` · all three flags **absent** · schedulers as found · migration row count **10** · reminder table row counts **0, 0** · notification tables **absent** · state **D1′**.

---

## A8.7b-INCIDENT-1d — Production reminder endpoint hotfix

**Performed 2026-08-05. Complete, validated, and closing the incident.** One source file changed, one guard test added, one deployment created and promoted. No migration, schema, flag, scheduler, provider, dependency, or environment-variable change.

### Why the slice existed

With the schema repaired, `GET /api/v1/tasks/{taskId}/reminder` still answered `INTERNAL_ERROR` for every real Task, while an unknown Task correctly answered `NOT_FOUND` and the sibling `GET /api/v1/tasks/{taskId}` returned 200. That pattern ruled out authentication, the route wrapper, `getDb()`, the runtime bridge, and the deployed Prisma client, and isolated the fault to reminder-specific code reached only after a real Task loads.

The cause was **not** a database fault. `apps/web/lib/reminders/etag.ts` at `ee5e82a` imported `NO_SCHEDULE_REMINDER_VERSION` as a runtime value from `@aicaa/db`, which is listed in `serverExternalPackages`. The compiled server chunk carried the identifier as an **undeclared free variable**, so the first Task without a reminder schedule threw `ReferenceError: NO_SCHEDULE_REMINDER_VERSION is not defined`. The route reported that as `INTERNAL_ERROR` under `UNKNOWN_FAILURE`, and because a `ReferenceError` is neither a Prisma error nor a `PersistenceError`, **no `database_runtime_failure` event was emitted to contradict the appearance of a database problem.** Full statement: [DEPLOYMENT.md § the runtime-value import hazard](DEPLOYMENT.md#the-runtime-value-import-hazard).

**The defect predated the repair.** It shipped with the routes and would have surfaced at whatever moment the schema first allowed a real Task to reach that code.

### 1d capture record

| Field                                               | Value                                                                                                                                        |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Operator                                            | Repository owner (single-operator project)                                                                                                   |
| Authorization reference                             | A8.7b-INCIDENT-1d, architecture approval granted in session for commit `534959d`                                                             |
| Base commit                                         | `ee5e82a0466fa08086fbd007d4b68342f2c8a6db` — the deployed commit, **not** `main` — _verified_                                                |
| Hotfix commit                                       | `534959d07715ed1cc14e7ee3468706034f5922fe` on `hotfix/a8-7b-incident-1d-reminder-etag` — _verified_                                          |
| Files changed                                       | `apps/web/lib/reminders/etag.ts`; `apps/web/__tests__/a8-7b-incident-1d-reminder-etag.test.ts` (new) — _verified_                            |
| Migration directories on the branch (**expect 10**) | **10**, matching Production — _verified_                                                                                                     |
| Build verification                                  | Built via the effective Vercel production path; `NO_SCHEDULE_REMINDER_VERSION` absent from `.next/server`, value inlined as `0` — _verified_ |
| `pnpm verify`                                       | Green — _verified_                                                                                                                           |
| Deployment method                                   | `vercel deploy --prod --skip-domain`, inspect, then `vercel promote` — see below                                                             |
| Deployment ID                                       | `dpl_3oder2T3PuDYdmp8pezy6u7RwPRm` — _verified_                                                                                              |
| Deployment target / state                           | `production` / READY, created 2026-08-05T06:37Z — _verified_                                                                                 |
| Commit SHA bound to the deployment                  | `534959d07715ed1cc14e7ee3468706034f5922fe` — _verified_ from deployment metadata                                                             |
| Node version / build command                        | **24.x** / `cd ../.. && pnpm build:domain && pnpm build:db && pnpm --filter @aicaa/web build` — _verified_ from project settings             |
| **Migration during build (expect none)**            | **None.** Only `prisma generate` (Client v6.19.3) appears in the build log — _verified_                                                      |
| Route set                                           | 51 routes including `/api/v1/tasks/[taskId]/reminder`; **no notification routes** — _verified_ from the build log                            |
| Environment binding                                 | All five Production-only variables present in the build environment, `DATABASE_URL` among them — _verified_                                  |
| Flags in the deployment environment                 | `ENABLE_OWNER_EVENT_CAPTURE`, `ENABLE_OWNER_EVENT_DELIVERY`, `ENABLE_REMINDER_DELIVERY` — **all absent** — _verified_                        |
| Previous deployment                                 | `dpl_AnUKqdGj3gBw7N56yUT4pMBAVbac` (`ee5e82a`) — retained, and **known-defective**                                                           |
| Production domain after promotion                   | `rocket-communicator-web.vercel.app`, the project's only production domain, resolves to the new deployment — _verified_                      |
| Unauthenticated routing probe                       | Reminder and tasks endpoints both return typed **401 `UNAUTHORIZED`** — _verified_                                                           |
| Authenticated Task list                             | Loads — _reported_                                                                                                                           |
| Authenticated Task detail                           | Loads — _reported_                                                                                                                           |
| Reminder `GET`, existing Task                       | **200**, `state=no_due_date`, ETag ends **`v0`** — _reported_                                                                                |
| Reminder `GET`, unknown Task                        | Typed **`NOT_FOUND`** — _reported_                                                                                                           |
| **No reminder created or modified (y/n)**           | **y** — _reported_                                                                                                                           |
| **Database unchanged (y/n)**                        | **y** — no migration, no schema change, no data change                                                                                       |
| **Schedulers and Gmail untouched (y/n)**            | **y** — cron-job.org not contacted; Gmail not contacted                                                                                      |
| **`main` unpushed (y/n)**                           | **y** — `origin/main` remains `ee5e82a`; only the hotfix branch was pushed — _verified_                                                      |
| Final state                                         | **D1′** — schema and application both validated                                                                                              |

### Deployment method, and why Preview promotion was rejected

**The approved plan assumed the pushed branch's Git-integration deployment could be promoted. It could not, safely.** Vercel built the pushed branch as a **preview-target** deployment, and `vercel promote` moves an alias without rebuilding, so a preview build keeps the Preview environment permanently. Read-only comparison of the two environments showed **five variables present only in Production** — `DATABASE_URL`, `CRON_SECRET`, `GMAIL_TOKEN_ENCRYPTION_KEY`, `GMAIL_TOKEN_ENCRYPTION_KEY_VERSION`, and `ENABLE_DB_RUNTIME_DIAGNOSTICS`.

**Promoting that build would have put Production on a server with no database connection string** — a full Owner outage, and the same failure class as the A7 incident. The preview deployment `dpl_3ZwfVbGSiwswih2YY4KSTj3UPJog` was therefore left unpromoted.

The substitute, chosen with architecture approval mid-slice, was a **production-target build from the clean worktree** with `--skip-domain`, so the artifact existed with Production environment variables while serving no traffic; then inspection of its commit SHA, target, state, route set, environment, build command, Node version, and the absence of any migration; then an explicit `promote`. **This preserved the inspect-before-promote gate** that the original plan intended and that push-to-`main` does not provide. The procedure is now documented at [DEPLOYMENT.md § deploying a commit that is not on `main`](DEPLOYMENT.md#deploying-a-commit-that-is-not-on-main).

### What this slice deliberately did not do

- **It did not deploy `main`.** `main` carries A8.5 and A8.6 code that requires migrations 6–9, which are not applied. Deploying it would have recreated the original incident in a worse form.
- **It did not fix the second runtime-value import.** `PersistenceError` in `apps/web/lib/suggestions/process-service.ts` is the same defect class and is still latent in Production. It was analysed and recorded, and no repository evidence tied it to the reminder failure, so including it would have widened a hotfix built on a commit that had already reached Production.
- **It did not merge or push to `main`, change any environment variable, touch Supabase, touch cron-job.org, enable any flag, or invoke any scheduler or provider route.**

---

## Gate 4 — Production migrations 6–9

**Pending. Not authorized, not begun, and no row below has been filled.** Procedure: [DEPLOYMENT.md § Gate 4](DEPLOYMENT.md#gate-4--production-migrations-69). Gate 4 applies A8 migrations 6 through 9 to the Production database and does nothing else — no deployment, no environment variable, no feature flag, no scheduler job, no Gmail action, no mutation. It moves Production from **`D1′`** to **`D2`**.

> **⚠ Do not record Gate 4 in the [1c capture record](#a87b-incident-1c--production-schema-compatibility-repair).** That record belongs to the five-migration repair, and two of its rows require migrations 6–9 and the notification tables to be **absent**. A correct Gate 4 makes both present, so filling it in there would record a successful gate as a boundary violation — and would overwrite the evidence that the repair boundary held. Use the table below.

**What a correct Gate 4 records is the inversion of what 1c recorded.** Ten history rows become **fourteen**. "Notification objects absent" becomes **present**. The lock probe covers **`task_reminder_schedules`**, not `tasks`, because no Gate 4 migration touches `tasks` at all. A Gate 4 record that reads like the 1c record is evidence that the wrong procedure was followed.

### Gate 4 capture record

Fill every row. A blank row is an incomplete record, not an implied "nothing to report". Names in parentheses are the evidence fields the runbook uses.

| Field                                                                                                                                                | Value |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| Operator                                                                                                                                             |       |
| **Authorization reference** — Gate 4 requires its own; no earlier authorization carries into it                                                      |       |
| Verification window (start / end, ISO with timezone)                                                                                                 |       |
| Owner no-use window (opened, closed, by whom)                                                                                                        |       |
| Local `git rev-parse HEAD`                                                                                                                           |       |
| Local `git rev-parse origin/main`                                                                                                                    |       |
| Gate 4 worktree commit, detached (**`68bedff` or the recorded later documentation commit**)                                                          |       |
| Worktree migration-directory count (**expect 14**)                                                                                                   |       |
| `packages/db/.env` absent from the Gate 4 worktree (y/n)                                                                                             |       |
| Prisma CLI version in the worktree (**expect 6.19.3**)                                                                                               |       |
| Production deployment ID at start (**expect `dpl_3oder2T3PuDYdmp8pezy6u7RwPRm`**)                                                                    |       |
| Production commit at start (**expect `534959d`**)                                                                                                    |       |
| Flags at start (**expect all three absent**)                                                                                                         |       |
| Scheduler baseline as found (both jobs inactive; **no** reminder job; **no** notification job)                                                       |       |
| Containment `8588c5d` confirmed redeployable, read-only (y/n, how confirmed)                                                                         |       |
| Endpoint classification (redacted host form, port **5432**, session mode, `pgbouncer=true` absent)                                                   |       |
| Connection string taken **after** the 2026-08-04 rotation (y/n)                                                                                      |       |
| **Credential not recorded anywhere (y/n)**                                                                                                           |       |
| PostgreSQL major version, confirmed in this window (**expect 17**)                                                                                   |       |
| Pre-migration history: row count (**expect 10**) and the ten names matching exactly (`migrations.status.before`)                                     |       |
| `applied_steps_count = 1` on all ten — **never confirmed during 1c; Gate 4 confirms it**                                                             |       |
| Failed or unfinished migration rows before (Q3, **expect none**)                                                                                     |       |
| `migrate status` pending set (**expect exactly the four Gate 4 names**; exit code 1 is correct)                                                      |       |
| Session activity before (Q4, judged against the allowlist)                                                                                           |       |
| `tasks` row count before (Q1) (`tasks.count.before`)                                                                                                 |       |
| `task_reminder_schedules` count and active count before (QR) (`gate4.schedules.before`)                                                              |       |
| Populated-table branch taken (y/n) — **if y, the separate authorization reference**                                                                  |       |
| Lock probe on `task_reminder_schedules` — acquired promptly, or timed out with the wait duration (`gate4.lock_probe`)                                |       |
| Activity check and lock probe **repeated immediately before** `migrate deploy` (y/n)                                                                 |       |
| Migration start time / end time / wall-clock duration                                                                                                |       |
| Prisma output (**connection string redacted**)                                                                                                       |       |
| Post-migration history: row count (**expect 14**), all finished, none rolled back, every `applied_steps_count = 1` (`migrations.status.after`)       |       |
| **Migrations 6–9 present by exact name (y/n)**                                                                                                       |       |
| **QG result (expect `2, 5, 1, 1, 2, 0, 0`)** (`gate4.objects_present`)                                                                               |       |
| Q7 (**four** tables) · Q8 (`0, 0, 0, 0`) · Q9 (**four** rows, `relrowsecurity = true` on all four)                                                   |       |
| Q11 — the **fifteen** named constraints from [recovery-tree entry 9](DEPLOYMENT.md#per-migration-recovery-decision-tree), each `convalidated = true` |       |
| Q12 — all **eleven** enum types and all **three** new labels                                                                                         |       |
| Q13 — every named index `indisvalid = true`, including **eight** rows on the two notification tables                                                 |       |
| RLS **policies** on the two new tables (**expect zero** — deny-by-default, approved)                                                                 |       |
| Q6 still **0**, and no row rewritten or backfilled                                                                                                   |       |
| `tasks` row count after (**expect unchanged from Q1**)                                                                                               |       |
| `task_reminder_schedules` count after (**expect unchanged from QR**) (`gate4.schedules.after`)                                                       |       |
| Q15 through Q21 **not run** (y/n)                                                                                                                    |       |
| Scheduler state after (**expect left inactive, none created or resumed**)                                                                            |       |
| Flags after (**expect all three still absent**)                                                                                                      |       |
| **Nothing deployed; deployment ID unchanged (y/n)**                                                                                                  |       |
| **Nothing pushed (y/n)**                                                                                                                             |       |
| Final state (**expect D2**)                                                                                                                          |       |
| **Gate 5 not begun (y/n)**                                                                                                                           |       |

### Deviations from the approved procedure

Record every departure, including any that seemed harmless at the time. The 1c record exists in the form it does because five were recorded honestly.

| #   | Deviation | Approved plan said | Status |
| --- | --------- | ------------------ | ------ |
|     |           |                    |        |

### Stop conditions encountered

Each hard stop in [G4.12](DEPLOYMENT.md#g412-stop-conditions) that fired, the physical state recorded at the time, and the decision taken. **A stop that was worked around rather than decided is itself the finding.**

| Condition | Physical state recorded | Decision, and who authorized it |
| --------- | ----------------------- | ------------------------------- |
|           |                         |                                 |

### What this gate must not do

Confirm each explicitly; none is authorized by Gate 4:

- No deployment, promotion, or rollback — the deployment ID is unchanged from before the gate to after it.
- No push to `main`. **A push deploys automatically** and would replace the deployment serving `534959d`.
- No environment variable or feature flag set, unset, or edited.
- No scheduler job created, resumed, edited, or invoked, and no worker endpoint called manually.
- No Owner or Recipient email, and no Gmail API call.
- No `INSERT`, `UPDATE`, `DELETE`, or `migrate resolve` beyond one explicitly authorized in a stop.
- **Gate 5 and Gate 6 are not begun**, and completing Gate 4 does not make either of them due.

---

## A8.7c — Owner-event capture

### Stage 11 — Owner-event capture enablement

**Preconditions.** Q8 all zero (y/n) · Q21 recorded:

**Execution.** `ENABLE_OWNER_EVENT_CAPTURE` set to the exact string: · redeployed at: · new deployment ID:

**Verification.** Ready (y/n) · other two flags absent (y/n) · `/attention` loads (y/n) · no notification job exists (y/n):

**Stop/go criteria.**

**Immediate containment.**

**Recovery or rollback.**

**Evidence to record.** Deployment ID, exact flag value, other two flags, four row counts immediately before enabling.

### Stage 12 — Capture-only observation

**Preconditions.** No notification scheduler job exists and none was created (y/n):

**Execution.** Window from: to: · observation times:

**Verification.**

| Time | `notifications.pending.buckets` (Q15) | `owner_notification_attempts` (expect 0) | Event types observed |
| ---- | ------------------------------------- | ---------------------------------------- | -------------------- |
|      |                                       |                                          |                      |

Endpoint never invoked manually (y/n):

**Stop/go criteria.**

**Immediate containment.**

**Recovery or rollback.**

**Evidence to record.** The table above, window duration, attempts count at every observation.

**A8.7c final observed state.** Deployment ID · three flag values · scheduler states · pending intents · attempts (expect 0):

---

## A8.7d — Notification delivery and the Gmail-loop gate

### Stage 13 — Zero-send Owner-notification rehearsal

**Preconditions.** Capture off since: · Q15 before: `under_1h` = , `h1_to_24` = , `over_24h` = (require the first two to be **0**):

**Execution.** Delivery set `true`, capture absent · redeployed at: · deployment ID: · Q15 re-checked (queue frozen): · single manual invocation at:

**Verification.** Worker response verbatim: · attempts before / after: **0 / 0** · every intent suppressed (y/n) · Q15 after: `pending` = **0** · **zero emails sent** (y/n, and how confirmed):

**Stop/go criteria.**

**Immediate containment.** Delivery unset and redeployed (y/n) · quarantine invoked (y/n):

**Recovery or rollback.**

**Evidence to record.** Q15 before and after, worker response, attempts before and after, suppression reasons, **explicit statement that no email was sent**.

### Stage 14 — Single-notification canary

**Preconditions.** Q15 `pending` = **0** · **Q21 = 0** · no notification scheduler job:

**Execution.** Both flags set · redeployed at: · deployment ID: · **chosen event and producer:** · **real Task change it caused (state truthfully):** · Q15 = **1** and Q21 = **0** re-checked at: · single invocation at:

No batch-limit bypass, production-only parameter, or test-only query string was added (**confirm y/n**):

**Verification.** Claims: **1** · attempt rows: **1** · sends: **1** · intent state `sent` (y/n) · Q18 duplicates: **0** · Q15 after: **0** · exactly one message in the mailbox (y/n):

**Stop/go criteria.**

**Immediate containment.**

**Recovery or rollback.**

**Evidence to record.** `canary.notification.intent_id` · `canary.notification.attempt_id` · `canary.notification.provider_message_ref` · Q15 and Q21 before and after · Q18 · the event and producer · the real Task change.

### Stage 15 — Gmail custom-header round-trip proof (hard gate)

**Preconditions.** Provider message reference from Stage 14:

**Execution.** `messages.get` with **`format=full`** called at: (**visual Gmail inspection is not acceptable evidence**)

**Verification.** All eight must be **yes**:

| #   | Assertion                                                     | Observed |
| --- | ------------------------------------------------------------- | -------- |
| 1   | Exactly one message exists                                    |          |
| 2   | Message identifier matches the stored provider reference      |          |
| 3   | Exactly **one** case-insensitive `X-Rocket-Generated` header  |          |
| 4   | Normalized value is exactly `owner-event-notification`        |          |
| 5   | Next Gmail poll counts it as **skipped**                      |          |
| 6   | **No** communication event created                            |          |
| 7   | **No** excerpt persisted                                      |          |
| 8   | **No** suggestion created, and **no** second intent (Q15 = 0) |          |

**Stop/go criteria.** Any "no" is a hard stop and blocks A8.7d. Decision:

**Immediate containment.** Flags unset and redeployed (y/n) · **Gmail-poll job paused** (y/n) · message quarantined out of polled scope (y/n) · quarantined message identifier: · identifiers of any communication event, excerpt, or suggestion created before cleanup:

**Recovery or rollback.**

**Evidence to record.** `gmail.headers` — the header block **only**, no message body and no personal content · matched identifier · header count · normalized value · poll skipped count · four explicit zero confirmations.

### Stage 16 — Notification scheduler creation

**Preconditions.** **Stage 15 passed in full (y/n)**:

**Execution.** Job created at: · name · URL · interval · auth method:

**Verification.** First execution result: · worker response: · Q16 = :

**Stop/go criteria.**

**Immediate containment.** Note: pausing the job does not disable delivery — unsetting the flag and redeploying does.

**Recovery or rollback.**

**Evidence to record.** Job name, URL, interval, first execution result, worker response, Q16.

### Stage 17 — Notification steady-state observation

**Preconditions.**

**Execution.** Window from: to: · observations at:

**Verification.**

| Time | Q15 pending | Q16 stale claims (expect 0) | Q18 duplicates (expect 0) | Scheduler failures | Rocket-generated message ingested? |
| ---- | ----------- | --------------------------- | ------------------------- | ------------------ | ---------------------------------- |
|      |             |                             |                           |                    |                                    |

**Stop/go criteria.**

**Immediate containment.**

**Recovery or rollback.**

**Evidence to record.** The table above, scheduler success rate, notifications sent, ingestion confirmation.

**A8.7d final observed state.** Deployment ID · three flag values · four scheduler states · queue counts:

---

## A8.7e — Reminder delivery

### Stage 18 — Reminder-schedule count and burst preview

**Preconditions.** D108 gate satisfied — Event Notification Engine operational (Stages 11–17) and A8.6a/A8.6b deployed and architecture-approved (y/n, with references):

**Execution.** Q19, Q20, Q6 run at:

**Verification.** `reminders.active_schedules` = **0** · `reminders.due_occurrences` = **0** · `schema.due_local_date.nonnull` = **0**:

**Stop/go criteria.**

**Immediate containment.** Not applicable — read-only.

**Recovery or rollback.** Not applicable — read-only.

**Evidence to record.** The three counts.

### Stage 19 — Single-reminder canary

**Preconditions.** Zero schedules and zero attempts (y/n) · reviewed Task identifier: · reviewed Recipient identifier (**identifier only**): · reminder flag absent (y/n) · no reminder scheduler job (y/n):

**Execution.** Due date set through the Owner UI at: · Q19 = **1** and Q20 = **1** at: · flag set and redeployed at: · deployment ID: · Q19 and Q20 re-confirmed **1** and **1** at: · single invocation at:

**Verification.**

| Assertion                                  | Expected | Observed |
| ------------------------------------------ | -------- | -------- |
| Success attempt rows                       | **1**    |          |
| Emails delivered to the reviewed Recipient | **1**    |          |
| `overdue_delivered_count` before → after   | n → n+1  |          |
| Owner-attention condition raised           | **no**   |          |
| Duplicate success for the local day (Q18)  | **0**    |          |
| Email contains a capability link           | **no**   |          |
| Q17 stale claims                           | **0**    |          |

**Stop/go criteria.**

**Immediate containment.** Flag unset and redeployed (y/n) · due date removed (y/n) · no scheduler job created (y/n):

**Recovery or rollback.** A delivered reminder cannot be unsent — record any direct follow-up with the Recipient as a communication, not a rollback:

**Evidence to record.** `canary.reminder.task_id` · `canary.reminder.recipient_id` · `canary.reminder.schedule_id` · `canary.reminder.attempt_id` and outcome · delivered count before and after · Q17 · Q18 · attention-flag state · link-absence confirmation.

### Stage 20 — Reminder scheduler creation

**Preconditions.** Stage 19 passed (y/n) · Q17 = 0:

**Execution.** Job created at: · name · URL · interval · auth method:

**Verification.** First execution result (expect zero work): · Q17 = · Q19 = :

**Stop/go criteria.**

**Immediate containment.**

**Recovery or rollback.**

**Evidence to record.** Job name, URL, interval, first execution result, Q17, Q19.

### Stage 21 — Final steady-state monitoring

**Preconditions.** All four scheduler jobs running (y/n):

**Execution.** Window from: to: · observations at:

**Verification.**

| Time | Q15 | Q16 | Q17 | Q18 | Q19 | Q20 | Scheduler failures |
| ---- | --- | --- | --- | --- | --- | --- | ------------------ |
|      |     |     |     |     |     |     |                    |

| Assertion                                                         | Expected                      | Observed |
| ----------------------------------------------------------------- | ----------------------------- | -------- |
| Reminder delivery hour, organization-local                        | **09:00 `America/Vancouver`** |          |
| Any pre-existing Task fired a reminder (D109)                     | **no**                        |          |
| Capability token or URL in any log, telemetry, audit, or metadata | **none**                      |          |
| Backlogs drain within a cycle or two                              | yes                           |          |

**Stop/go criteria.**

**Immediate containment.**

**Recovery or rollback.**

**Evidence to record.** Both tables, all four schedulers' success rates, the delivery-hour confirmation **with the timezone stated**, the D109 confirmation, the token-absence confirmation.

**A8.7e final observed state.** Deployment ID · commit · three flag values · four scheduler states · all queue counts · schedules active:

---

## Closing record

| Field                                                           | Value |
| --------------------------------------------------------------- | ----- |
| Slices completed                                                |       |
| Final production deployment ID                                  |       |
| Final production commit                                         |       |
| Final flag values (all three)                                   |       |
| Final scheduler states (all four)                               |       |
| Migrations applied (expect all nine)                            |       |
| Any containment action taken, and its stage                     |       |
| Any stop decision taken, and its stage                          |       |
| Deviations from the runbook, and their authorization            |       |
| Caveats requiring architecture review                           |       |
| **Confirmation no secret or personal content is recorded here** |       |
