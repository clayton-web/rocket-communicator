# @aicaa/db

Server-side Prisma persistence: schema, migrations, repositories, and transaction primitives. Domain rules live in `@aicaa/domain`; this package stores and retrieves records.

This is a **package reference**. It originates no product law — decisions live in [DECISIONS.md](../../docs/DECISIONS.md) and current architecture in [ARCHITECTURE.md](../../docs/ARCHITECTURE.md). Operations: [DEPLOYMENT.md](../../docs/DEPLOYMENT.md).

## Setup

1. Provide a Postgres `DATABASE_URL`.
   - **Local Docker (recommended for migrations / concurrency work):** `pnpm db:docker:up`, then use the `:local` scripts below. URL is `postgresql://prisma:prisma@127.0.0.1:5433/prisma?schema=public`.
   - **Production / staging:** Supabase **transaction pooler** URL on the operator machine only (see [DEPLOYMENT.md](../../docs/DEPLOYMENT.md)).
2. Copy `.env.example` → `.env` (gitignored) only if you need bare Prisma CLI. Prefer `:local` scripts so a leftover production URL in `.env` cannot be used by accident.
3. Apply migrations locally: `pnpm db:migrate:local` (never use this against production).
4. Generate client: `pnpm --filter @aicaa/db generate`

### Local Docker Postgres

Minimal Compose service at the repo root (`docker-compose.yml`). Postgres **17**, matching the Production major version so migration rehearsals run on the same engine. Loopback-only port **5433**, databases `prisma` (dev) and `prisma_test` (contention suites). Named volume `aicaa_pgdata`.

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

**There are no unguarded migration scripts.** `migrate:deploy`, `migrate:dev`, and `migrate:status` used to exist here and inherited whatever `DATABASE_URL` was in scope — including one loaded silently from the untracked `packages/db/.env`. They were removed. An authorized production migration invokes Prisma directly, from a detached worktree containing no `.env`, with the URL supplied process-scoped to that one command:

```bash
cd <worktree>/packages/db
DATABASE_URL="$MIGRATE_URL" pnpm exec prisma migrate deploy
```

That form is deliberately inconvenient: the target is written at the call site, so it cannot be inherited by accident.

### Migration authoring rules

- **Additive and forward-only.** New tables carry deny-by-default RLS.
- **Introduce an enum value in its own migration**, using it nowhere. PostgreSQL restricts _using_ a freshly added enum value in the same transaction that added it, so a file that adds a value and then references it in an index predicate, CHECK, or backfill can pass a from-empty test and still fail on apply.
- **Never edit an applied migration.** Prisma checksums applied migrations; editing one breaks `migrate deploy` on every database that already has it. Corrections belong in this README or in a later migration's header.

## Tests vs production

| Environment              | Database                                                                                                                                                                                                           |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Ordinary Vitest**      | In-process **PGlite** (embedded Postgres) with migration SQL applied — no Docker or production database required. Use `createTestDatabase()` from `@aicaa/db/testing`.                                             |
| **Local Docker**         | Real PostgreSQL 17 via `docker compose` (loopback 5433; `prisma` for development, `prisma_test` for contention). Use for Prisma migrate verification, multi-connection concurrency suites, and worker integration. |
| **Production / staging** | Supabase Postgres via `DATABASE_URL` on Vercel (see [DEPLOYMENT.md](../../docs/DEPLOYMENT.md)); hosting remains replaceable under D079.                                                                            |

**PGlite cannot prove a race.** It is a single in-process connection, so two transactions never actually contend; a lock order or compare-and-set "verified" there is reasoned rather than tested — a green PGlite suite has previously hidden both a lost update and a deadlock. Suites that must contend are named `*.pg.test.ts`, live in the package that owns the behaviour, and skip themselves unless handed a database URL, so `pnpm verify` needs no Docker. See [ENGINEERING_WORKFLOW.md](../../docs/ENGINEERING_WORKFLOW.md) for the commands.

## Security posture

- Raw capability secrets are **never** stored (`token_hash` only — D063).
- Token generation, hashing, and validation live in **`apps/web/lib/capability`** (server-only). This package stores `token_hash` and provides lookup by hash.
- RLS is enabled without policies (deny-by-default for PostgREST roles — D166). Authorization remains application-level Owner session + capability checks.
- **Historical migration citations.** Some applied migrations attribute deny-by-default RLS to D006 or to the Superseded D032. Those files are checksummed applied history and are never edited in place, so read those comments as provenance: D166 is the current Approved authority for the RLS defence-in-depth principle, and D006 remains the authority for reaching Prisma only through authorized server APIs.
- Physical task DELETE is not offered; use `dismissed` status (D064).

## Structural invariants

Invariants below are enforced by migration SQL or by a build-failing guard. Prisma schema metadata does not model partial indexes or CHECK constraints; **the migration is the source of truth**.

### Interpretation occurrence foundation

- **`InterpretationRun` / `interpretation_runs`** is the completed-occurrence store for D161 (grouping/provenance, not Task truth). Rows represent successful completed outcomes only: `proposals_created` or `no_proposals`. A failed provider call does not create a row.
- **The only producer** is `persistInterpretationOccurrence` (D169 S3.1), which writes one occurrence and its 0..N proposals in one transaction and derives the outcome from the proposal set. The AI call happens before the transaction opens, so no database transaction is held across a provider call. The application service that calls it is reached only by the Owner-authenticated S3.2 route `POST /api/v1/manual-captures` (**D170**, implemented). **D171** authorizes the Android Owner client to call that route for S3.3 capture-to-proposal, and that client is **implemented**. S3 for this Owner manual-capture producer path is complete at the locked capture-to-proposal boundary; no worker or cron reaches the service, and proposal lifecycle remains later work.
- **Idempotency** matches HandoffAttempt: unique `(organization_id, idempotency_key)`; `idempotency_key`, `request_fingerprint`, and durable-traceability `request_id` are NOT NULL; same key + same fingerprint is replay; same key + different fingerprint is `IDEMPOTENCY_KEY_CONFLICT`. `resolveInterpretationOccurrence` answers a replay from committed state before the provider is called again, and a same-key race surfaces as `UNIQUE_VIOLATION` after rolling the losing occurrence back whole — the caller re-resolves to tell replay from conflict.
- **Out of this foundation:** trigger/source enums, raw-input retention, CommunicationEvent linkage, TaskSuggestion FKs, revisions, acceptance outcomes, claim/lease, and failure/pending states.

### TaskSuggestion revision-evidence foundation

- **`TaskSuggestionRevision` / `task_suggestion_revisions`** is the append-only carrier for D155 proposal-revision evidence. `TaskSuggestion` remains the mutable operational/current proposal head. Revision rows are dormant evidence only and must not personalize, mutate prompts, auto-assign, train online, or otherwise influence AI behaviour.
- **Create/read only** in `@aicaa/db`: `createTaskSuggestionRevision`, `listTaskSuggestionRevisions`, `getLatestTaskSuggestionRevision`. No update/delete/upsert surface. A source guard forbids non-test Prisma rewrite/delete/upsert calls on `taskSuggestionRevision`. Unique `(suggestion_id, revision_number)` is numbering protection, **not** immutability protection.
- **`authorKind`** is `ai | owner` only. No `authoredByOwnerId` in this foundation.
- **Revision 0** means the first revision Rocket actually recorded for a suggestion — not inherently AI. Existing suggestions receive no fabricated history; absence of revisions means “no revision evidence has been recorded,” not absence of a proposal.
- **Prospective A6 producer:** `persistSuggestionFromClaimedEvent` records revision 0 (`authorKind = ai`) atomically with each newly created Gmail-extraction TaskSuggestion, copying the persisted suggestion’s `summaryPoints` / `proposedDueAt` / `proposedPriority` / `proposedRecipientId`. Duplicate/reclaim resolution (`persistClaimResolvedForExistingSuggestion`) writes no revision and does not backfill historical suggestions. Work-request and other TaskSuggestion creators remain revision-free.
- **Still out of scope:** Owner-edit revision capture, accepted-revision persistence / `acceptedRevisionId`, interpretation-produced revisions, public OpenAPI/Android exposure, and any learning/personalization behaviour.

### Responsibility-selection evidence

- **`TaskSuggestionResponsibilitySelection` / `task_suggestion_responsibility_selections`** is the settled D168 carrier for the Owner's affirmative acceptance-time responsibility choice. It sits beside `task_suggestion_revisions` as an **independent** D155 evidence axis: responsibility selection and accepted content revision never reference each other.
- **It answers one question:** who did the Owner affirmatively choose as the initially responsible party when accepting this proposal? `party_kind` (`owner | recipient`) is the entire affirmative signal, with `recipient_id` set when and only when the kind is `recipient` — enforced by a table CHECK constraint. A missing row, a null `recipient_id`, a missing `TaskAssignment`, or a failed handoff is **never** evidence that the Owner chose Me (D155, D164).
- **It is not current state.** No responsibility, assignee, or custody column exists on `Task`, no Owner `TaskAssignment` row is created, and this table is not a current-responsibility projection or a responsibility-history stream. Current external assignment truth stays in `task_assignments`; reassignment, clearing, and return-to-Owner stay with TaskAssignment/handoff/audit. `AuditEvent` is not this evidence store.
- **Required, and atomic with acceptance:** `persistApproveTaskSuggestion` requires a selection and writes it inside its existing transaction, alongside the canonical Task create, the suggestion approval, and the `approvedTaskId` linkage. There is no later best-effort write path and no approve path that omits it, so every successful acceptance carries selection evidence and evidence never survives a rolled-back approval. An omitted selection is rejected (`VALIDATION`) before the transaction opens rather than defaulted to Owner. Organization-scoped Recipient validation happens in that same transaction.
- **Create/read only** in `@aicaa/db`: `createResponsibilitySelection`, `getResponsibilitySelectionBySuggestionId`, `getResponsibilitySelectionByTaskId`. No update/delete/upsert surface, and a source guard forbids non-test Prisma rewrite/delete/upsert calls on `taskSuggestionResponsibilitySelection`. Unique `suggestion_id` / `task_id` are one-initial-decision cardinality protection, **not** immutability protection.
- **Recipient selection is not delivery.** Recording a Recipient creates no `TaskAssignment`, no `TaskCapability`, and no `HandoffAttempt`, and sends nothing; the existing handoff mutation still owns all of that. Recipient activity/delivery-readiness is deliberately not validated here — that remains a handoff concern.
- **Attribution:** `selected_by_owner_id` follows the `audit_events.owner_id` / `task_assignments.assigned_by_owner_id` convention, and `selected_at` is the approval-action instant distinct from the `created_at` insert stamp.
- **Still out of scope:** public read API for the selection evidence, Android/web responsibility UX, approve idempotency, responsibility history or reassignment rows, return-to-Owner evidence, current-responsibility projections, and any learning/personalization use. Owner TaskSuggestion list/detail already expose the existing nullable `approvedTaskId` linkage for lost-response recovery; that field is approval linkage, not responsibility state.

### Assignment and handoff

- **At most one active assignment per task** (`cleared_at IS NULL`) — `task_assignments_one_active_per_task_idx`. Reassignment always inserts a new row via `createActiveAssignment`; cleared rows stay persisted and are never overwritten or reused. Capabilities remain FK-bound to the exact historical assignment under which they were issued.
- **At most one active capability per assignment** — `task_capabilities_one_active_per_assignment_idx` WHERE `status = 'active'`.
- **Active is not actionable.** `isPersistedCapabilityActionable` additionally requires `actionable_at` set and unexpired. Administrative issuance defaults `actionable_at = issued_at`; the Gmail handoff path leaves it null until send acceptance.
- **`HandoffAttempt` is the authoritative delivery status** (`pending`/`sent`/`failed`). If `TaskAssignment.deliveryStatus` ever diverges, trust `HandoffAttempt`. Idempotency scope is unique `(organization_id, idempotency_key)`; provider acceptance is unique `(organization_id, provider_message_id)` WHERE not null, so one Gmail acceptance cannot finalize two attempts in an org.
- **Administrative issuance is blocked while the latest handoff attempt is unresolved** (`pending` or `failed`), enforced inside the issuance transaction by `assertAdminIssuanceNotBlockedByHandoff` with a `FOR UPDATE` lock. A failed attempt deliberately reuses its row, so administrative replacement would supersede a capability a later retry still references. There is no implicit abandon state: an unresolved lineage is resolved through retry, explicit re-forward, or reassignment.
- **Transaction boundary:** pending commit → Gmail call → sent/failed commit. Stale pending rows remain queryable; a reconciliation worker is deferred, explicitly-authorized work. There is no `unknown` status.

### Reminder persistence

- **One schedule per Task** (unique `task_id`, D104). The schedule is Task-scoped and survives reassignment; a second row would silently double every reminder.
- **`ReminderDeliveryAttempt` is append-only** — one row per processed occurrence, superseded but never deleted or rewritten (D107, D109).
- **Occurrence identity is server-derived, never caller-supplied** (D109): unique `(schedule_id, generation, occurrence_kind, occurrence_local_date)`. Overlapping scheduler invocations collide on the index instead of racing through a check-then-insert window. The index prevents duplication, not fabrication — a future API must derive the occurrence fields rather than let a client choose them.
- **One successful delivery per local calendar day** (D106): partial unique `(schedule_id, occurrence_local_date)` WHERE `outcome = 'success'`. Deliberately not generation-scoped, so a due-date change cannot license a second send on a morning already delivered. A skip or failure does not consume the day.
- **`tasks.due_local_date`** is the canonical organization-local due calendar date. `due_at` is retained for contract compatibility and is not the scheduling authority. The column is nullable and deliberately not backfilled — D109 forbids historical due dates from activating reminders.
- **No ambiguity counter column exists, and none should be added.** A stored count must be incremented on ambiguity and reset on success, permanent failure, and new generation; any missed path stops a schedule early or never. Derived from generation-scoped history, a new generation resets it by definition. A guard asserts no such column appears.

#### Local dates are text, not `DATE`

Stored as canonical `VARCHAR(10)`. A Postgres `DATE` column surfaces through Prisma as a `DateTime`, reintroducing the instant-versus-calendar-date confusion D103 exists to remove. A column CHECK enforces canonical `YYYY-MM-DD` shape and month/day range; full Gregorian validity is enforced one layer up by the domain `parseLocalDate`, because Postgres requires CHECK expressions to be IMMUTABLE and the text-to-date cast is not.

Validation runs in **both directions**: every write parses before it stores and every read parses before it brands, so a value like `2026-02-30` — which satisfies the CHECK — is refused at the write rather than accepted and later found unreadable. The `LocalDate` brand is erased at build time, so the runtime parse is the only real guard.

#### Organization coherence

`organization_id` and `task_id` are independent columns with independent foreign keys, so the database will accept a schedule declaring one organization while pointing at a Task owned by another. Reminder writes resolve the owning organization from the referenced Task or schedule and refuse a caller claiming a different one (`ORGANIZATION_MISMATCH`); see `reminder-scope-guard.ts`. This is application enforcement — the stronger fix is a composite foreign key to `tasks(id, organization_id)`, which needs its own migration.

Cross-organization **reads** exist for worker scans (`listDueReminderSchedulesGlobally`, `listDueAdvanceReminderSchedulesGlobally`). They return bounded batches, and every row carries its own `organizationId` read from the database rather than supplied. Nothing **writes** across organizations, and Owner-facing reads remain organization-scoped.

#### Constraints and the rule each enforces

| Constraint                                                 | Rule                                                                           |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `task_reminder_schedules_overdue_delivered_count_bounded`  | Backstop for the D106 ceiling of 14 successful overdue deliveries/generation   |
| `task_reminder_schedules_stopped_has_no_next_occurrence`   | A stopped schedule cannot reappear in a worker's due-scan                      |
| `task_reminder_schedules_stop_reason_matches_status`       | A stopped schedule always records why                                          |
| `task_reminder_schedules_claim_fields_coherent`            | A half-written lease cannot look like a free schedule                          |
| `task_reminder_schedules_claim_requires_active`            | A non-active schedule holds no live scan lease                                 |
| `reminder_delivery_attempts_skip_reason_matches_outcome`   | A skip always carries a truthful reason (D105, D107)                           |
| `reminder_delivery_attempts_failure_code_only_on_failure`  | A success cannot carry a failure code, so ceiling counting reads unambiguously |
| `reminder_delivery_attempts_claim_fields_coherent`         | A claim's owner and acquisition time move together                             |
| `reminder_delivery_attempts_lease_requires_owner`          | An expiry with no owner would be a countdown nobody is running                 |
| `reminder_delivery_attempts_terminal_holds_no_lease`       | A settled occurrence never advertises a lease the recovery sweep could see     |
| `reminder_delivery_attempts_claim_sequence_matches_claim`  | Every claim carries a fencing token; an unclaimed row carries none             |
| `reminder_delivery_attempts_provider_start_requires_claim` | A provider call cannot be attributed to nobody                                 |
| `reminder_delivery_attempts_acceptance_implies_started`    | Acceptance without a start marker would break the ambiguity recovery rule      |
| `reminder_delivery_attempts_acceptance_only_for_success`   | Only a success may claim the provider accepted it                              |
| `reminder_delivery_attempts_settlement_only_when_terminal` | A lease is not a result, so a `claimed` row cannot be settled                  |

A test asserts the SQL ceiling bound equals the domain `OVERDUE_SUCCESSFUL_DELIVERY_CEILING`, so the two cannot drift apart.

## Rules a caller must not work around

**Persistence stores facts; the domain computes them.** Repositories take the current instant and every occurrence as **arguments**. Nothing here derives "tomorrow", "overdue", an advance date, a 09:00 local instant, or any daylight-saving behaviour — D103 places that arithmetic exclusively in `packages/domain/src/reminders/`. `a8-reminder-persistence-boundary.test.ts` fails the build if a reminder persistence module reads a clock, resolves a timezone, performs day arithmetic, or restates the ceiling.

**Reminder writes serialize on the Task row.** Every Owner reminder mutation begins with `lockTaskScopeForReminderMutation`, a single-row `SELECT … FOR UPDATE` on `tasks`, and only then writes the schedule and the Task's due date. One lock order avoids the deadlock a mixed order produced on real PostgreSQL, and makes the compare-and-set reads that follow trustworthy: a loser blocks until the winner commits, reads the bumped `reminder_version`, and reports a truthful precondition failure.

**`reminder_version` is separate from `Task.version`** because a reminder write deliberately does not bump the Task. It increments on opening a generation, reactivating, suspending, resuming, and stopping — and deliberately not on recording a delivery, raising `requiresOwnerAttention`, or acquiring a lease, so a worker doing its job cannot invalidate an Owner's in-flight edit. Owner-initiated changes pass the version they observed and are refused if it moved; worker and lifecycle callers omit it and keep unconditional idempotent behaviour.

**`finalizeReminderOccurrence` is the only public way to record a delivery outcome**, and it runs in **two transactions**. Phase A terminalizes the occurrence unconditionally, fenced on the caller's claim sequence, and commits alone so nothing downstream can un-send what was sent. Phase B applies the schedule effect and marks `schedule_settled_at` in the same transaction. A crash between them leaves representable settlement debt: a terminal row with a null `schedule_settled_at`, found by `listUnsettledTerminalOccurrences` and discharged idempotently under the Task lock.

**`recordTerminalOccurrenceOutcomeUnsafe` and `terminalizeExhaustedOccurrenceUnsafe` are exported from no barrel**, and a source guard fails the build if either reappears. A success written through one would skip the kind check, the generation check, the counter, and the ceiling.

**`markProviderCallStarted` must be called before the transport, never after.** That ordering is the entire recovery rule. `listExpiredOccurrenceClaims` splits expired leases on it: without the marker nothing left the building, so the occurrence is released and reclaimed; with it a provider may hold the message and nobody can prove otherwise, so recovery records `ambiguous`, consumes the local day, and never retries.

**Claims are bounded leases with fencing tokens.** `claimReminderOccurrence` takes an unclaimed occurrence or reclaims an expired pre-provider one, and otherwise refuses with an actionable reason (`lease_held`, `in_flight_unknown`, `already_terminal`, `retry_budget_exhausted`). Every takeover is one conditional update on `claim_sequence`, and clears `provider_call_started_at`, the acceptance fields, the message reference, and `schedule_settled_at`, so the new attempt's provider boundary starts empty.

**Three recovery sweeps, each independently bounded:** `listUnsettledTerminalOccurrences` (settlement debt), `listExpiredOccurrenceClaims` (abandoned leases), and `listRetryBudgetExhaustedOccurrences` (non-terminal, at the attempt ceiling, no live lease, no in-flight marker). Each refuses an unbounded limit.

**Overdue and advance are two scans, not one widened scan.** Overdue follows `next_overdue_occurrence_at`, a nullable pointer re-armed after every occurrence. Advance reads `advance_occurrence_at`, one immutable instant per generation, gated on `advance_disposition = 'scheduled'`, a value that settles exactly once and never returns. A merged query could not report which occurrence it found, and a merged index would serve neither ordering. The disposition is the whole "not yet handled" test, so no anti-join against history is needed.

**Ordering is by `occurrence_at`, then `id`, never by `completed_at`.** `occurrence_at` is the instant an occurrence belongs to, fixed when armed; `completed_at` is whenever a worker finished it. Those diverge whenever settlement is late, and ordering by the latter would let the repair of an old occurrence appear as the newest event in a sequence.

**A Waiting Task's schedule is born suspended.** `createReminderSchedule` and `openNextReminderGeneration` accept `status: 'suspended_waiting'`, which requires a `suspendedAt` and discards the next occurrence, so a suspended row cannot sit in the due-scan index holding a date that will be in the past by the time the Task resumes (D107).

**`no_actionable_capability` is deliberately not `no_active_assignment`.** D130 gives a reminder no capability link, which creates a state the worker must record: the assignment is alive and the schedule armed, but the capability the assignment email carried is revoked, expired, never activated, or already consumed. The two reasons imply different Owner remedies — assign somebody, versus re-send the assignment — so collapsing them would leave the history unable to say which.

**Concurrency evidence** lives in `__tests__/a8-4a-occurrence-concurrency.pg.test.ts` (real PostgreSQL, independent connections) plus direct SQL invariant queries. PGlite is one connection and cannot express any of it.

## Out of scope for this package

Does not send Gmail mail, implement HTTP handlers, run workers or schedulers, or own feature flags.
