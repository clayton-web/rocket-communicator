# A8.7 production rollout — evidence record

Governed by [PROJECT_CONSTITUTION.md](PROJECT_CONSTITUTION.md). Procedure: [DEPLOYMENT.md § A8.7 production rollout](DEPLOYMENT.md#a87-production-rollout). Milestone status: [MILESTONES.md](MILESTONES.md).

**This file is a template. Nothing in it has been performed.** A8.7a created it and contacted no production system, no database, no scheduler, and no provider.

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

| Field                                        | Value |
| -------------------------------------------- | ----- |
| Slice (A8.7b / c / d / e)                    |       |
| Date (ISO, with timezone)                    |       |
| Operator                                     |       |
| Authorization reference                      |       |
| Source commit (`git rev-parse HEAD`)         |       |
| Working tree clean at start (y/n)            |       |
| `pnpm verify` green on this commit, and when |       |
| Production deployment ID at start            |       |
| Production commit at start                   |       |
| `ENABLE_OWNER_EVENT_CAPTURE` at start        |       |
| `ENABLE_OWNER_EVENT_DELIVERY` at start       |       |
| `ENABLE_REMINDER_DELIVERY` at start          |       |
| Gmail-poll job state at start                |       |
| Suggestion-processing job state at start     |       |
| Notification job state at start              |       |
| Reminder job state at start                  |       |
| Docker required for this slice (y/n)         |       |

**Migration endpoint** (A8.7b only):

| Field                                      | Value |
| ------------------------------------------ | ----- |
| Redacted hostname form                     |       |
| Port                                       |       |
| Session mode confirmed (y/n, how)          |       |
| `pgbouncer=true` absent (y/n)              |       |
| Advisory-lock test result                  |       |
| **Credential not recorded anywhere (y/n)** |       |

---

## A8.7b — Migration and disabled-feature deployment

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

**Evidence to record.** Full console output **with the connection string redacted**, `migrate:status` before and after, duration.

### Stage 7 — Failed-migration classification and recovery

**Skipped entirely if Stage 6 succeeded.** State "skipped — Stage 6 succeeded" and move on.

**Preconditions.** Failing migration file:

**Execution.** Detection queries run, per that migration's recovery-tree entry:

**Verification.** Physical state classification (**none present** / **all present** / **some present**) and the query output supporting it:

**Stop/go criteria.** Escalated (y/n) · second reviewer · decision:

**Immediate containment.** Schedulers still paused (y/n) · no deployment (y/n) · no hand cleanup (y/n):

**Recovery or rollback.** Action taken, the recovery-tree entry authorizing it, and the post-action `migrate:status`:

**Evidence to record.** Failing migration name, full error, every detection query result, classification, action, authorization, post-action status.

### Stage 8 — Post-migration schema verification

**Preconditions.**

**Execution.** Q5–Q14 and Q1 re-run at:

**Verification.**

| Assertion                                            | Expected | Observed |
| ---------------------------------------------------- | -------- | -------- |
| `schema.due_local_date` exists and nullable          | yes      |          |
| `schema.due_local_date.nonnull` (Q6)                 | **0**    |          |
| `schema.tables` (Q7)                                 | 4        |          |
| `schema.rowcounts.after` (Q8)                        | 0,0,0,0  |          |
| `schema.rls` (Q9)                                    | all true |          |
| `schema.columns` (Q10)                               | all 7    |          |
| `schema.constraints` (Q11)                           | all      |          |
| `schema.enums` (Q12)                                 | all 11   |          |
| `schema.indexes` (Q13), all `indisvalid`             | true     |          |
| `schema.settlement_constraint` (Q14) `convalidated`  | true     |          |
| `tasks.count.after` (Q1) equals `tasks.count.before` | yes      |          |

**Stop/go criteria.**

**Immediate containment.**

**Recovery or rollback.**

**Evidence to record.** The table above, complete.

### Stage 9 — Deployment with all A8 flags absent

**Preconditions.** Three flags confirmed absent in Vercel **before** deploying (y/n) · `pnpm verify` green on this commit (when):

**Execution.** Deployment created at: · new deployment ID: · commit:

**Verification.** Build Ready (y/n) · three flags read after deployment:

**Stop/go criteria.**

**Immediate containment.** Rollback target available (`dpl_7vmnL71Lck7JLeftgsJkYVJ4uw82`, state **D0**):

**Recovery or rollback.**

**Evidence to record.** New deployment ID, commit, build result, three flag values read after deployment.

### Stage 10 — Application smoke verification

**Preconditions.**

**Execution.** Smoke checks run at: · schedulers resumed at:

**Verification.**

| Check                               | Expected                        | Observed |
| ----------------------------------- | ------------------------------- | -------- |
| `GET /api/v1/session`               | 200, owner, `axford`            |          |
| `GET /api/v1/tasks`                 | 200, cursor page                |          |
| Owner `/tasks`                      | renders                         |          |
| Task detail reminder panel          | "no schedule"                   |          |
| **`/attention`**                    | **renders, two empty sections** |          |
| Gmail-poll job resumed and executed | success, `GmailSyncRun` `cron`  |          |
| Suggestion job resumed and executed | success                         |          |

**Stop/go criteria.**

**Immediate containment.**

**Recovery or rollback.**

**Evidence to record.** The table above, plus the resume timestamps.

**A8.7b final observed state.** Deployment ID · commit · three flag values · four scheduler states · four A8 table row counts:

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
