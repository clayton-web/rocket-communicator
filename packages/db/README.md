# @aicaa/db

Server-side Prisma persistence for A4–A7.3 and the A8.3a reminder foundation (D062, D006, D086–D094, D128). Domain rules live in `@aicaa/domain`; this package stores and retrieves records.

Operations: [../../docs/DEPLOYMENT.md](../../docs/DEPLOYMENT.md)

## Setup

1. Provide a Postgres `DATABASE_URL` (Supabase **transaction pooler** URL is typical for production/serverless).
2. Copy `.env.example` → `.env` (gitignored) for Prisma CLI.
3. Apply migrations: `pnpm --filter @aicaa/db migrate:deploy`
4. Generate client: `pnpm --filter @aicaa/db generate`

## Tests vs production

| Environment              | Database                                                                                                                                                               |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Ordinary Vitest**      | In-process **PGlite** (embedded Postgres) with migration SQL applied — no Docker or production database required. Use `createTestDatabase()` from `@aicaa/db/testing`. |
| **Production / staging** | Current deployment uses Supabase Postgres via `DATABASE_URL` on Vercel (see [DEPLOYMENT.md](../../docs/DEPLOYMENT.md)); hosting remains replaceable under D079.        |

Optional live DB: set `DATABASE_URL` and run Prisma CLI commands against your instance.

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

| Constraint                                                | Rule it enforces                                                               |
| --------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `task_reminder_schedules_overdue_delivered_count_bounded` | The D106 ceiling of 14 successful overdue deliveries per generation (backstop) |
| `task_reminder_schedules_stopped_has_no_next_occurrence`  | A stopped schedule cannot reappear in a worker's due-scan                      |
| `task_reminder_schedules_stop_reason_matches_status`      | A stopped schedule always records **why**                                      |
| `task_reminder_schedules_claim_fields_coherent`           | A half-written lease cannot look like a free schedule                          |
| `reminder_delivery_attempts_skip_reason_matches_outcome`  | A skip always carries a truthful reason (D105, D107)                           |
| `reminder_delivery_attempts_failure_code_only_on_failure` | A success cannot carry a failure code, so ceiling counting reads unambiguously |

A test asserts the SQL ceiling bound equals the domain `OVERDUE_SUCCESSFUL_DELIVERY_CEILING`, so the two cannot drift apart.

### Persistence stores facts; the domain computes them

Repositories take the current instant and every occurrence as **arguments**. Nothing here derives "tomorrow", "overdue", an advance date, a 09:00 local instant, or any daylight-saving behaviour — D103 places that arithmetic exclusively in `packages/domain/src/reminders/`. `a8-reminder-persistence-boundary.test.ts` fails the build if a reminder persistence module reads a clock, resolves a timezone, performs day arithmetic, or restates the ceiling.

**Not implemented by A8.3a:** no worker, scheduler, cron, delivery, Gmail, Event Notification, HTTP route, contract, feature flag, or UI. The claim-lease columns and worker indexes exist so A8.4 adds no migration.
