# @aicaa/db

Server-side Prisma persistence for A4–A7.3, the A8.3a reminder foundation, the A8.4a occurrence lifecycle, the A8.4b.1 capability pre-send snapshot, the A8.4b.2 D129 repeated-ambiguity stop, and the A8.4b.3 advance due scan (D062, D006, D086–D094, D128, D129, D130). Domain rules live in `@aicaa/domain`; this package stores and retrieves records.

Operations: [../../docs/DEPLOYMENT.md](../../docs/DEPLOYMENT.md)

## Setup

1. Provide a Postgres `DATABASE_URL`.
   - **Local Docker (recommended for migrations / concurrency work):** `pnpm db:docker:up`, then use the `:local` scripts below. URL is `postgresql://prisma:prisma@127.0.0.1:5433/prisma?schema=public`.
   - **Production / staging:** Supabase **transaction pooler** URL on the operator machine only (see [DEPLOYMENT.md](../../docs/DEPLOYMENT.md)).
2. Copy `.env.example` → `.env` (gitignored) only if you need bare Prisma CLI. Prefer `:local` scripts so a leftover production URL in `.env` cannot be used by accident.
3. Apply migrations locally: `pnpm db:migrate:local` (never use this against production).
4. Generate client: `pnpm --filter @aicaa/db generate`

### Local Docker Postgres

Minimal Compose service at the repo root (`docker-compose.yml`). Postgres **17**, matching the Production major version so migration rehearsals run on the same engine. Loopback-only port **5433**, databases `prisma` (dev) and `prisma_test` (future suites). Named volume `aicaa_pgdata`.

Upgrading the pinned image across a major version makes the existing `aicaa_pgdata` volume unreadable, so the first start after such a change requires `pnpm db:docker:reset`.

| Command                        | Purpose                                     |
| ------------------------------ | ------------------------------------------- |
| `pnpm db:docker:up`            | Start and wait until healthy                |
| `pnpm db:docker:down`          | Stop containers (keeps volume)              |
| `pnpm db:docker:reset`         | Destroy volume and recreate empty databases |
| `pnpm db:migrate:local`        | `prisma migrate deploy` against Docker only |
| `pnpm db:migrate:status:local` | Migration status against Docker only        |
| `pnpm db:studio:local`         | Prisma Studio against Docker only           |

The `:local` helpers always set `DATABASE_URL` to the loopback Docker URL and refuse non-loopback hosts.

**There are no unguarded migration scripts.** `migrate:deploy`, `migrate:dev`, and `migrate:status` used to exist here and inherited whatever `DATABASE_URL` was in scope — including one loaded silently from `packages/db/.env`, which is untracked and unreviewable. **They have been removed.** An authorized production migration invokes Prisma directly, from a detached worktree that contains no `.env`, with the URL supplied process-scoped to that one command:

```bash
cd <worktree>/packages/db
DATABASE_URL="$MIGRATE_URL" pnpm exec prisma migrate deploy
```

That form is deliberately inconvenient: the target is written at the call site, so it cannot be inherited by accident. See [DEPLOYMENT.md § Local credential safety](../../docs/DEPLOYMENT.md#local-credential-safety-for-the-repair).

Ordinary Vitest remains on **PGlite** and does not need Docker.

**PGlite cannot prove a race.** It is a single in-process connection, so two transactions never actually contend; a lock order or compare-and-set "verified" there is reasoned rather than tested. The A8.3b audit demonstrated the gap by finding a lost update and a deadlock that the green PGlite suite had not detected. Suites that must contend are named `*.pg.test.ts`, live in the package that owns the behaviour, and skip themselves unless handed a database URL, so `pnpm verify` needs no Docker — see [ENGINEERING_WORKFLOW.md](../../docs/ENGINEERING_WORKFLOW.md) for the commands.

## Tests vs production

| Environment              | Database                                                                                                                                                                                                                                                  |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Ordinary Vitest**      | In-process **PGlite** (embedded Postgres) with migration SQL applied — no Docker or production database required. Use `createTestDatabase()` from `@aicaa/db/testing`.                                                                                    |
| **Local Docker**         | Real PostgreSQL 17 via `docker compose`, matching the Production major version (loopback 5433; `prisma` for development, `prisma_test` for contention). Use for Prisma migrate verification, multi-connection concurrency suites, and worker integration. |
| **Production / staging** | Current deployment uses Supabase Postgres via `DATABASE_URL` on Vercel (see [DEPLOYMENT.md](../../docs/DEPLOYMENT.md)); hosting remains replaceable under D079.                                                                                           |

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

**The advance-occurrence APIs were foundations before they were a live path.** Nothing in A8.4a scanned for or claimed an advance occurrence: the due scan read `next_overdue_occurrence_at` only. These functions handled `advance` correctly and tests exercised them directly; A8.4b.3 added the scan and index that finally reach them.

### A8.4b.1 additions

Migration: `20260802173000_a8_4b1_capability_skip_reason` — one additive `ALTER TYPE "ReminderSkipReason" ADD VALUE IF NOT EXISTS 'no_actionable_capability'`, **unapplied in Production**. It rewrites no row, and `reminder_delivery_attempts_skip_reason_matches_outcome` tests only that a reason is present exactly when the outcome is `skipped`, so it enumerates no value and needs no revalidation. The file contains **one statement and uses the new value nowhere**, deliberately: keeping enum introduction separate from any schema or data operation that consumes the new value avoids PostgreSQL enum-visibility and deployment-order hazards, because PostgreSQL restricts _using_ a freshly added enum value in the same transaction that added it — so a file that added the value and then referenced it in an index predicate, a CHECK, or a backfill can pass a from-empty test and still fail on apply. Evidence: `__tests__/a8-4b1-capability-skip-migration.test.ts`.

**`no_actionable_capability` is deliberately not `no_active_assignment`.** D130 gives a reminder no capability link and directs the Recipient to the original assignment email, which creates a state the worker must be able to record: the assignment is alive, the Task is eligible, the schedule is armed — and the capability that email carried is revoked, expired, never activated, or already consumed. The two reasons must stay distinguishable because they imply different Owner remedies: one says nobody is assigned, so assign somebody; the other says somebody is assigned and cannot act, so re-send the assignment. Collapsing them would leave the history unable to say which.

**`readReminderPreSendSnapshot` now reads five facts in the one `RepeatableRead` transaction, not four.** It gained the canonical capability row and, only when that capability is actionable, the recipient address and authorized summary points the transport needs. Adding a second query after the snapshot would have reintroduced the incoherent-read defect the A8.4a audit raised against the three-statement version of this function — the capability could be revoked between the two reads and the send would proceed on a fact that was true of a different moment. The delivery target is deliberately a **discriminated** field: it is `null` unless the capability is actionable, so a caller cannot reach a recipient address on a path that is not permitted to send. Persistence still derives no schedule and reads no clock; `now` is an argument, as the boundary guard requires.

**`listDueReminderSchedulesGlobally` scans across organizations; nothing writes across them.** It returns a bounded batch ordered by occurrence instant then id, against a partial index on active schedules. Every row carries its own `organizationId`, read from the database rather than supplied, and every subsequent claim and finalization scopes by it. Owner-facing reads remain organization-scoped and take no such path.

### A8.4b.2 additions

Migration: `20260802210000_a8_4b2_repeated_ambiguous_stop_reason` — one additive `ALTER TYPE "ReminderScheduleStopReason" ADD VALUE IF NOT EXISTS 'repeated_ambiguous_outcomes'`, **unapplied in Production**. Same shape and same reasoning as the A8.4b.1 migration: deliberately additive, one statement, using the new value nowhere, so enum introduction stays separate from anything that consumes it and the migration remains independently testable. `task_reminder_schedules_stop_reason_matches_status` constrains only that a reason is present exactly when the status is `stopped`, so it enumerates no value and needs no rebuild. Evidence: `__tests__/a8-4b2-ambiguous-stop-reason-migration.test.ts`.

**D129 is enforced inside `settleReminderOccurrenceSchedule`, in `applyScheduleEffect`'s ambiguous branch.** That function is already the one place holding the Task lock, already applies the schedule effect exactly once, and already evaluates the D106 ceiling from occurrence history rather than from the denormalized counter. Putting the threshold anywhere else would mean reading history outside the lock and mutating from a conclusion that could already be stale. The occurrence being settled is durably `ambiguous` before this runs — phase A committed it — so it counts as itself, and nothing rewrites it: D129 changes the schedule, never the occurrence.

**`listRecentAmbiguitySequenceOutcomes` is the derivation, and it is bounded.** Three rows — the threshold — filtered in SQL to overdue occurrences whose outcome is in `AMBIGUITY_SEQUENCE_OUTCOMES`, scoped to schedule and current generation. The filter list is imported from the domain rather than retyped here, because a second hand-written copy of "which outcomes participate" is precisely what drifts. This is deliberately unlike `listReminderDeliveryAttemptsForGeneration`, which the D106 ceiling needs unbounded because it must count every success; D129 asks only whether the newest few are all ambiguous, and no older row can change that answer.

**Ordering is by `occurrence_at`, then `id`, never by `completed_at`.** `occurrence_at` is the 09:00-local instant an occurrence belongs to, fixed when it was armed and immutable afterwards; `completed_at` is whenever a worker finished it. Those diverge whenever settlement is late — a crashed occurrence swept hours afterwards, or recovery collecting debt out of order — and ordering by the latter would let the repair of an old occurrence appear as the newest event in the sequence. `id` makes the order total even if two rows shared an instant, which the one-occurrence-per-local-day identity already prevents.

**No ambiguity counter column exists, and none should be added.** A stored count has to be incremented on ambiguity and reset on success, on permanent failure, and on a new generation; any path that misses one leaves a schedule that stops early or never stops. Derived from generation-scoped history, a new generation resets it by definition rather than by an operation. A guard asserts no such column appears on `TaskReminderSchedule` and that `ReminderScheduleStatus` still has exactly its three values.

### A8.4b.3 additions

Migration: `20260803090000_a8_4b3_advance_due_scan_index` — one additive `CREATE INDEX IF NOT EXISTS`, **unapplied in Production**. It creates no column, no constraint, and no enum value, touches no row, and would leave the scan correct if dropped.

**`listDueAdvanceReminderSchedulesGlobally` is a second scan, not a widened first one.** Overdue follows `next_overdue_occurrence_at`, a nullable pointer re-armed after every occurrence, so a schedule reappears daily. Advance reads `advance_occurrence_at`, one immutable non-null instant per generation, gated on `advance_disposition = 'scheduled'` — a value that settles exactly once and never returns to `scheduled`. A merged query could not report which occurrence it had found, and a merged index would serve neither ordering. Both scans span organizations, bound their batch, and order by occurrence instant then id, for the same reasons.

**The disposition is the whole of the "not yet handled" test, which is why there is no anti-join.** Every terminal outcome settles the disposition in the same transaction that marks the occurrence settled, and the two skips that happen without a worker — the establishment window having elapsed, and a Waiting period having spanned the morning — settle the same field. So a handled advance occurrence has already left the scan before the next invocation runs, and history never needs to be consulted to find out.

**The index is partial on the disposition as well as on `active`.** Every generation leaves exactly one advance row behind forever; without the disposition predicate the index would grow with history rather than with work outstanding. Both predicate columns are `NOT NULL`, so no row is silently excluded by a null.

**No lateness predicate in SQL.** How late is too late is a calendar-day question in the organization's zone, which the domain answers (`isAdvanceDeliveryWindowOpen`) and the worker asks. Filtering elapsed mornings out of the scan would leave them in the table saying `scheduled` forever, so they are claimed and settled as `skipped_window_elapsed` instead.

**`applyScheduleEffect`'s advance branch now reads the skip reason.** `skipped` covers two facts with different remedies — the Task stopped needing a reminder, or the morning went by unsent — so `advance_window_elapsed` settles to `skipped_window_elapsed` and every other skip to `skipped_not_eligible`. The reason is read from the immutable occurrence row rather than passed in, so it cannot disagree with what the occurrence records. The branch still returns before the ceiling, the stop reasons, and D129, none of which apply to an advance occurrence.

**Concurrency evidence:** `__tests__/a8-4a-occurrence-concurrency.pg.test.ts` on real PostgreSQL 16 with independent connections, plus direct SQL invariant queries. PGlite is one connection and cannot express any of it. Its D129 block proves two connections settling the third ambiguity produce exactly one stop transition, that no scanner finds the schedule afterwards, and that an Owner completion racing the third ambiguity leaves one reason recorded rather than two.
