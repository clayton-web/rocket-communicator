# @aicaa/db

Server-side Prisma persistence for A4–A7.3, the A8.3a reminder foundation, and the A8.4a occurrence lifecycle (D062, D006, D086–D094, D128). Domain rules live in `@aicaa/domain`; this package stores and retrieves records.

Operations: [../../docs/DEPLOYMENT.md](../../docs/DEPLOYMENT.md)

## Setup

1. Provide a Postgres `DATABASE_URL`.
   - **Local Docker (recommended for migrations / concurrency work):** `pnpm db:docker:up`, then use the `:local` scripts below. URL is `postgresql://prisma:prisma@127.0.0.1:5433/prisma?schema=public`.
   - **Production / staging:** Supabase **transaction pooler** URL on the operator machine only (see [DEPLOYMENT.md](../../docs/DEPLOYMENT.md)).
2. Copy `.env.example` → `.env` (gitignored) only if you need bare Prisma CLI. Prefer `:local` scripts so a leftover production URL in `.env` cannot be used by accident.
3. Apply migrations locally: `pnpm db:migrate:local` (never use this against production).
4. Generate client: `pnpm --filter @aicaa/db generate`

### Local Docker Postgres

Minimal Compose service at the repo root (`docker-compose.yml`). Postgres **16**, loopback-only port **5433**, databases `prisma` (dev) and `prisma_test` (future suites). Named volume `aicaa_pgdata`.

| Command                        | Purpose                                     |
| ------------------------------ | ------------------------------------------- |
| `pnpm db:docker:up`            | Start and wait until healthy                |
| `pnpm db:docker:down`          | Stop containers (keeps volume)              |
| `pnpm db:docker:reset`         | Destroy volume and recreate empty databases |
| `pnpm db:migrate:local`        | `prisma migrate deploy` against Docker only |
| `pnpm db:migrate:status:local` | Migration status against Docker only        |
| `pnpm db:studio:local`         | Prisma Studio against Docker only           |

The `:local` helpers always set `DATABASE_URL` to the loopback Docker URL and refuse non-loopback hosts. Bare `migrate:deploy` / `migrate:status` still read `packages/db/.env` and can target production — that is intentional for operators, not for day-to-day local work.

Ordinary Vitest remains on **PGlite** and does not need Docker.

**PGlite cannot prove a race.** It is a single in-process connection, so two transactions never actually contend; a lock order or compare-and-set "verified" there is reasoned rather than tested. The A8.3b audit demonstrated the gap by finding a lost update and a deadlock that the green PGlite suite had not detected. Suites that must contend are named `*.pg.test.ts`, live in the package that owns the behaviour, and skip themselves unless handed a database URL, so `pnpm verify` needs no Docker — see [ENGINEERING_WORKFLOW.md](../../docs/ENGINEERING_WORKFLOW.md) for the commands.

## Tests vs production

| Environment              | Database                                                                                                                                                                                                           |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Ordinary Vitest**      | In-process **PGlite** (embedded Postgres) with migration SQL applied — no Docker or production database required. Use `createTestDatabase()` from `@aicaa/db/testing`.                                             |
| **Local Docker**         | Real PostgreSQL 16 via `docker compose` (loopback 5433; `prisma` for development, `prisma_test` for contention). Use for Prisma migrate verification, multi-connection concurrency suites, and worker integration. |
| **Production / staging** | Current deployment uses Supabase Postgres via `DATABASE_URL` on Vercel (see [DEPLOYMENT.md](../../docs/DEPLOYMENT.md)); hosting remains replaceable under D079.                                                    |

Optional live DB: set `DATABASE_URL` and run Prisma CLI commands against your instance — or use the `:local` scripts for Docker.

## Security posture

- Raw capability secrets are **never** stored (`token_hash` only — D063).
- Token generation, hashing, and validation live in **`apps/web/lib/capability`** (server-only). This package stores `token_hash` only and provides lookup by hash.
- RLS is enabled without policies (deny-by-default for PostgREST roles). Authorization remains application-level Owner session + capability checks.
- Physical task DELETE is not offered; use `dismissed` status (D064).

## Assignment history invariant

A task may have many `TaskAssignment` rows over time. Cleared rows stay persisted (`cleared_at` set) and are never overwritten or reused for another recipient. Capabilities remain FK-bound to the exact historical assignment under which they were issued.

**At most one active assignment per task** (`cleared_at IS NULL`) is enforced by a partial unique index in migration SQL:

`task_assignments_one_active_per_task_idx` — Prisma schema metadata does not model this partial index; the migration is the source of truth. Reassignment always inserts a new row via `createActiveAssignment`.

## A7.3 handoff persistence

- **`HandoffAttempt`:** authoritative delivery status (`pending`/`sent`/`failed`), idempotency key + fingerprint, provider message id after acceptance, privacy-safe failure fields, retry/re-forward/reassignment lineage.
- **Idempotency scope:** unique `(organization_id, idempotency_key)`.
- **Provider message id:** unique `(organization_id, provider_message_id)` WHERE not null — one Gmail acceptance cannot finalize two attempts in the same org. Not globally unique across orgs.
- **One active capability per Assignment:** `task_capabilities_one_active_per_assignment_idx` WHERE `status = 'active'`. Pending A7 capabilities still use `status = active` with `actionable_at = null`, so they occupy the one-active slot (retry reuses the row; re-forward/reassignment revoke then insert).
- **Active vs actionable:** `status = active` is not sufficient for Recipient use. `isPersistedCapabilityActionable` requires `actionable_at` set and not expired. A4 administrative issuance defaults `actionable_at = issued_at`. A7 sets null until send acceptance.
- **Atomic transitions (READ COMMITTED):** `UPDATE … WHERE status = 'pending' AND provider_message_id IS NULL` for pending→sent and pending→failed (row-count winner). Failed retry uses `SELECT … FOR UPDATE` then conditional `WHERE status = 'failed'`. Explicit re-forward/reassignment lock the prior attempt with `FOR UPDATE`.
- **Authoritative vs denormalized:** trust `HandoffAttempt.status` if `TaskAssignment.deliveryStatus` ever diverges; A7 transaction primitives keep them aligned via conditional Assignment CAS.
- **A4 administrative issuance vs UNRESOLVED A7 handoff:** Owner issue/replace (including `replaceExisting`) is rejected (`ISSUANCE_CONFLICT`) while the **latest** handoff attempt for the Assignment is unresolved — i.e. `pending` **or** `failed` (retryable or not). "Latest relevant attempt" = newest by `created_at DESC, id DESC`, scoped to `(organization_id, assignment_id)`. Enforced INSIDE the issuance transaction by `assertAdminIssuanceNotBlockedByHandoff`, which locks that row `FOR UPDATE` (a preflight check exists only for a friendly early failure). Rationale: a failed A7 attempt deliberately reuses the same `HandoffAttempt`, Assignment, capability, idempotency key, and fingerprint; administrative replacement would supersede that capability and make a later retry reference a superseded row. There is **no implicit abandon/cancel state** yet — an unresolved failed lineage must be resolved through the A7 workflow (retry, explicit re-forward, reassignment). A resolved (`sent`) latest attempt does not block; historical resolved attempts never win the "latest" selection.
- **Concurrency (admin issue vs A7 lifecycle):** the `FOR UPDATE` lock on the latest attempt serializes administrative issuance against retry preparation, re-forward, reassignment, and failure recording. Failure/retry wins; administrative issuance is blocked; the attempt is never orphaned and its capability is never superseded.
- **Idempotency concurrent loser:** `beginInitialHandoff` never lets a raw `UNIQUE_VIOLATION` escape. When a same-key winner is visible it replays the single durable attempt; when the winner is not yet visible (or a different-key slot loser), it surfaces the typed `HANDOFF_IN_PROGRESS` retry/conflict, and a later call deterministically replays or observes the conflict.
- **Distributed txn boundary:** pending commit → Gmail call → sent/failed commit. Stale/uncertain pending rows remain queryable; a reconciliation worker remains **deferred, explicitly-authorized** work. No `unknown` status.
- **Roadmap boundary (historical, as written during A7.3/A7.4):** **A7.4 = Gmail OAuth send-scope preparation + transport/MIME utilities only.** The application orchestration that wires pending → Gmail call → accepted/failed persistence **shipped in A7.5**, and **A7 is now closed and production-operational** (tag `v0.7.0-a7-complete`). Reconciliation/worker handling of stale pending attempts remains deferred and ships only when explicitly authorized ([MILESTONES.md](../../docs/MILESTONES.md) A7 deferred backlog).
- **Concurrency tests:** Vitest + PGlite (`a7-handoff-concurrency-hardening.test.ts`) and web `capability-issue-handoff-gate.test.ts`. PGlite is single-process; races use concurrent Prisma transactions. Conditional UPDATE row-counts and `FOR UPDATE` are the portable proof; a separate multi-connection Postgres suite is not required for A7.3.
- **Does not** send Gmail mail or implement HTTP handlers.

## A8.3a reminder persistence

Migration: `20260731040000_a8_reminder_persistence` (additive, forward-only, deny-by-default RLS on both new tables).

- **`TaskReminderSchedule` (`task_reminder_schedules`):** the durable scheduling state of one Task — canonical due date, IANA timezone snapshot, generation, status, stop reason, advance disposition, next overdue occurrence, per-generation overdue delivered count, `requires_owner_attention`, and claim-lease columns. **At most one per Task** via unique `task_id` (D104); the schedule is Task-scoped and survives reassignment, so a second row would silently double every reminder.
- **`ReminderDeliveryAttempt` (`reminder_delivery_attempts`):** append-only, one row per processed occurrence, with outcome, truthful skip reason, and a short normalized failure code. Rows are superseded, never deleted or rewritten (D107, D109).
- **`tasks.due_local_date`:** the canonical organization-local due **calendar date**. `due_at` is retained for contract compatibility and is not the scheduling authority. The column was added nullable and **deliberately not backfilled** — D109 forbids historical due dates from activating reminders.
- **Idempotency (D109):** **server-derived, no caller-supplied key.** Identity is the occurrence itself: unique `(schedule_id, generation, occurrence_kind, occurrence_local_date)` via `reminder_delivery_attempts_occurrence_identity_key`. Overlapping scheduler invocations collide on the index instead of racing through a check-then-insert window. The index prevents duplication, not fabrication: the occurrence fields are arguments, so a future API must derive them rather than let a client choose them.
- **One delivery per local calendar day (D106):** partial unique `(schedule_id, occurrence_local_date)` WHERE `outcome = 'success'` — `reminder_delivery_attempts_one_success_per_local_day_idx`. Deliberately **not** generation-scoped: a material due-date change must not license a second send on a morning already delivered. A skipped or failed occurrence does not consume the day.

### Local dates are text, not `DATE`

Stored as canonical `VARCHAR(10)`. A Postgres `DATE` column surfaces through Prisma as a `DateTime`, which would reintroduce the instant-versus-calendar-date confusion D103 exists to remove. A column CHECK enforces canonical `YYYY-MM-DD` shape and month/day range; full Gregorian validity (leap years, month lengths) is enforced one layer up by the domain `parseLocalDate`, because Postgres requires CHECK expressions to be IMMUTABLE and the text-to-date cast is not.

Validation runs in **both directions**. Every write parses before it stores and every read parses before it brands, so a value like `2026-02-30` — which satisfies the CHECK — is refused at the write rather than accepted and then found unreadable. The `LocalDate` brand is erased at build time, so the runtime parse is the only real guard.

### Organization coherence

`organization_id` and `task_id` are independent columns with independent foreign keys, so the database will accept a schedule declaring one organization while pointing at a Task owned by another. Reminder writes therefore resolve the owning organization from the referenced Task or schedule and refuse a caller that claims a different one (`ORGANIZATION_MISMATCH`); a delivery attempt's Task is derived from its schedule rather than supplied. See `reminder-scope-guard.ts`. This is application enforcement — the stronger fix is a composite foreign key to `tasks(id, organization_id)`, which needs its own migration.

### Constraints that carry product law

| Constraint                                                 | Rule it enforces                                                               |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `task_reminder_schedules_overdue_delivered_count_bounded`  | The D106 ceiling of 14 successful overdue deliveries per generation (backstop) |
| `task_reminder_schedules_stopped_has_no_next_occurrence`   | A stopped schedule cannot reappear in a worker's due-scan                      |
| `task_reminder_schedules_stop_reason_matches_status`       | A stopped schedule always records **why**                                      |
| `task_reminder_schedules_claim_fields_coherent`            | A half-written lease cannot look like a free schedule                          |
| `reminder_delivery_attempts_skip_reason_matches_outcome`   | A skip always carries a truthful reason (D105, D107)                           |
| `reminder_delivery_attempts_failure_code_only_on_failure`  | A success cannot carry a failure code, so ceiling counting reads unambiguously |
| `reminder_delivery_attempts_claim_fields_coherent`         | A claim's owner and acquisition time are one fact and move together (A8.4a)    |
| `reminder_delivery_attempts_lease_requires_owner`          | An expiry with no owner would be a countdown nobody is running                 |
| `reminder_delivery_attempts_terminal_holds_no_lease`       | A settled occurrence never advertises a lease the recovery sweep could see     |
| `reminder_delivery_attempts_claim_sequence_matches_claim`  | Every claim carries a fencing token; an unclaimed row carries none             |
| `reminder_delivery_attempts_provider_start_requires_claim` | A provider call cannot be attributed to nobody                                 |
| `reminder_delivery_attempts_acceptance_implies_started`    | Acceptance without a start marker would break the ambiguity recovery rule      |
| `reminder_delivery_attempts_acceptance_only_for_success`   | Only a success may claim the provider accepted it                              |
| `reminder_delivery_attempts_settlement_only_when_terminal` | A lease is not a result, so a `claimed` row cannot be settled (A8.4a audit H1) |
| `task_reminder_schedules_claim_requires_active`            | A non-active schedule holds no live scan lease (A8.4a)                         |

A test asserts the SQL ceiling bound equals the domain `OVERDUE_SUCCESSFUL_DELIVERY_CEILING`, so the two cannot drift apart.

### Persistence stores facts; the domain computes them

Repositories take the current instant and every occurrence as **arguments**. Nothing here derives "tomorrow", "overdue", an advance date, a 09:00 local instant, or any daylight-saving behaviour — D103 places that arithmetic exclusively in `packages/domain/src/reminders/`. `a8-reminder-persistence-boundary.test.ts` fails the build if a reminder persistence module reads a clock, resolves a timezone, performs day arithmetic, or restates the ceiling.

**Not implemented by A8.3a:** no worker, scheduler, cron, delivery, Gmail, Event Notification, HTTP route, contract, feature flag, or UI. The claim-lease columns and worker indexes were added early in the hope that A8.4 would need no migration; it needed one anyway, because a lease with no expiry and no fencing token turned out to be unrecoverable rather than merely incomplete. See [A8.4a occurrence lifecycle](#a84a-occurrence-lifecycle).

**A8.3b adds Owner-facing units of work, not worker behaviour.** `transactions/a8b-owner-reminder-transactions.ts` composes the A8.3a primitives above with an audit event in the same transaction, so a reminder state change and the record of it commit together or not at all.

**A8.4a widened `runtime.ts` deliberately**, because the processing service runs in the serverless runtime and needs the claim, recovery, scan, and finalization functions. What it does **not** export is `recordTerminalOccurrenceOutcomeUnsafe`, and that exclusion is now enforced by a test rather than by care. The A8.3b note here used to say the unexported primitives were nonetheless _present_ in the traced artifact because they shared modules with exported ones — that is still true and is still a weaker guarantee than absence, but the guarantee that matters has moved: the unsafe writer is unreachable by name from any barrel, and the safe transaction validates what the unsafe one would have skipped.

**Reminder writes serialize on the Task row, and carry their own version.** All three A8.3b mutation transactions begin with `lockTaskScopeForReminderMutation` — a single-row `SELECT … FOR UPDATE` on `tasks` — and only then write the schedule and the Task's due date. The audit found the original ordering (schedule-then-Task for establishment and change, Task-then-schedule for removal) deadlocking on real PostgreSQL, with the victim escaping as a 500. One lock order fixes that by construction and makes the compare-and-set reads that follow trustworthy: a loser blocks until the winner commits, then reads the winner's bumped `reminder_version` and reports a truthful precondition failure.

`task_reminder_schedules.reminder_version` is the optimistic-concurrency version for the reminder resource, separate from `Task.version` because a reminder write deliberately does not bump the Task. It increments on opening a generation, reactivating, suspending, resuming, and stopping — and deliberately **not** on recording a delivery, raising `requiresOwnerAttention`, or acquiring a lease, so a worker doing its job cannot invalidate an Owner's in-flight edit. Owner-initiated generation changes and removals pass the version they observed and are refused if it moved; worker and lifecycle callers omit it and keep the unconditional, idempotent behaviour, because "stop this, whatever it is now" is genuinely what completion means. `isSerializationFailure` translates a PostgreSQL `40001`/`40P01` refusal into the typed concurrency error as defence-in-depth.

**A Waiting Task's schedule is born suspended.** `createReminderSchedule` and `openNextReminderGeneration` accept `status: 'suspended_waiting'`, which requires a `suspendedAt` and discards the next occurrence. Two CHECK constraints enforce both halves, so a suspended row cannot sit in the worker's due-scan index holding a date that will be in the past by the time the Task resumes (D107).

## A8.4a occurrence lifecycle

Migrations: `20260801120000_a8_4a_worker_safety` and `20260802094500_a8_4a_settlement_marker` (both additive and forward-only, each with one backfill — see [DEPLOYMENT.md](../../docs/DEPLOYMENT.md)).

> **Correction.** The header of `20260801120000_a8_4a_worker_safety` says it "backfills nothing beyond column defaults". That is wrong — it runs `UPDATE "reminder_delivery_attempts" SET "claim_sequence" = 1 WHERE "claimed_by" IS NOT NULL`, which the body of that same file goes on to explain at length. The correction lives here and in the newer migration's header rather than in the applied file, because Prisma checksums applied migrations and editing one breaks `migrate deploy` on every database that already has it.

**`finalizeReminderOccurrence` in `transactions/a8-4a-occurrence-transactions.ts` is the only public way to record a delivery outcome.** It runs two phases in **two transactions**. Phase A terminalizes the occurrence **unconditionally**, fenced only on the caller's claim sequence. Phase B — `settleReminderOccurrenceSchedule` — applies the schedule effect through `updateMany` statements whose zero-row result is an expected no-op, and marks `schedule_settled_at` in the same transaction as the effect. A schedule that suspended, stopped, or moved generation costs the count, never the history.

**Why two transactions and not one (A8.4a audit H1).** They originally shared one, on the reasoning that phase two could not abort phase one because every phase-two write tolerated zero rows. That covers the expected failures and nothing else: the audit injected an unexpected error inside phase two and the whole transaction aborted, taking the record of a sent message with it — the original F1 defect, narrowed rather than closed. Phase A now commits alone, and nothing downstream can un-send what was sent.

The cost is a new divergence: a crash between the commits leaves the occurrence terminal and the schedule un-advanced. That is exactly what the single transaction was chosen to avoid, and the difference is that this divergence is **representable**. A terminal row whose `schedule_settled_at` is null is settlement debt; `listUnsettledTerminalOccurrences` finds it; phase B is idempotent under the Task lock, so discharging it late produces the same schedule as discharging it on time. A rolled-back delivery record left nothing behind to find.

Phase B is not exported on its own from either barrel under a name that could be mistaken for the whole operation, and **phase A is not exported at all**: a caller that ran it and stopped would leave debt only the sweep would notice. `recordTerminalOccurrenceOutcomeUnsafe` and `terminalizeExhaustedOccurrenceUnsafe` are the low-level writers beneath both, **module-private and exported from neither `index.ts` nor `runtime.ts`**; a source guard fails the build if either reappears. An export is an invitation, and a success written through one would skip the kind check, the generation check, the counter, and the ceiling.

**Claims are bounded leases with fencing tokens.** `claimReminderOccurrence` takes an unclaimed occurrence or reclaims an expired pre-provider one, and otherwise refuses with a reason the caller can act on (`lease_held`, `in_flight_unknown`, `already_terminal`, `retry_budget_exhausted`). Every takeover is one conditional update on `claim_sequence`, so two workers reclaiming the same abandoned lease produce a winner and a refusal rather than two claimants. A takeover also **clears** `provider_call_started_at`, the acceptance fields, the message reference, and `schedule_settled_at`, so the new attempt's provider boundary starts empty (A8.4a audit H2). Inheriting the previous attempt's marker made a crash before the new call indistinguishable from a crash during it, and recovery finalized as ambiguous a reminder that had provably never been sent.

**`markProviderCallStarted` must be called before the transport, never after**, and that ordering is the entire recovery rule. `listExpiredOccurrenceClaims` splits expired leases on it: without the marker nothing left the building, so the occurrence is released and reclaimed; with it a provider may hold the message and nobody can prove otherwise, so `finalizeAbandonedInFlightOccurrence` records `ambiguous`, consumes the local day, and never retries. Marking afterwards would make a crash mid-call indistinguishable from a crash before it, and the sweep would resend. That recovery also takes a next occurrence and arms it while the schedule is still active at the matching generation (A8.4a audit B1): consuming one morning is not ending the series, and passing nothing wrote a null onto an `active` schedule that then had no future and no record of having lost one.

**Three recovery sweeps, and each one is bounded on its own.** `listUnsettledTerminalOccurrences` finds settlement debt, `listExpiredOccurrenceClaims` finds abandoned leases, and `listRetryBudgetExhaustedOccurrences` finds the occurrence no worker can claim and none has finished — non-terminal, at the attempt ceiling, no live lease, no in-flight marker. `terminalizeExhaustedRetryOccurrence` closes that last one as a `permanent_failure` carrying `retry_budget_exhausted` and settles the schedule with the ordinary permanent-failure policy, which stops it and takes it out of the scan. Before that existed, the state was a permanent hot loop: scanned, refused, released, repeated on every invocation for as long as the deployment lived (A8.4a audit B2). Each list refuses an unbounded limit.

**`hasTerminalAdvanceOccurrence` replaces `hasProcessedAdvanceOccurrence`.** The old function counted a bare `claimed` lease as processed, so a worker that claimed an advance occurrence and died would have frozen that advance permanently — unreclaimable, because the unique occurrence identity refuses a second row. Only a terminal outcome settles the schedule's advance disposition, and settlement is the phase that writes both, so the attempt row and the schedule cannot describe different histories for longer than it takes to discharge the debt.

**The advance-occurrence APIs are foundations, not a live path.** Nothing in A8.4a scans for or claims an advance occurrence: the due scan reads `next_overdue_occurrence_at` only. These functions handle `advance` correctly and tests exercise them directly, but delivering advance reminders is A8.4b work and needs its own scan predicate and matching index first.

**`listDueReminderSchedulesGlobally` scans across organizations; nothing writes across them.** It returns a bounded batch ordered by occurrence instant then id, against a partial index on active schedules. Every row carries its own `organizationId`, read from the database rather than supplied, and every subsequent claim and finalization scopes by it. Owner-facing reads remain organization-scoped and take no such path.

**Concurrency evidence:** `__tests__/a8-4a-occurrence-concurrency.pg.test.ts` on real PostgreSQL 16 with independent connections, plus direct SQL invariant queries. PGlite is one connection and cannot express any of it.
