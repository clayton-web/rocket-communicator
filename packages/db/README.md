# @aicaa/db

Server-side Prisma persistence for A4–A7.3 (D062, D006, D086–D094). Domain rules live in `@aicaa/domain`; this package stores and retrieves records.

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
- **Distributed txn boundary:** pending commit → Gmail call (application, later) → sent/failed commit. Stale/uncertain pending rows remain queryable; a reconciliation worker is **later, explicitly-authorized** work (not A7.4). No `unknown` status.
- **Roadmap boundary:** **A7.4 = Gmail OAuth send-scope preparation + transport/MIME utilities only.** Later application orchestration wires pending → Gmail call → accepted/failed persistence. Later reconciliation/worker handling of stale pending attempts ships only when explicitly authorized.
- **Concurrency tests:** Vitest + PGlite (`a7-handoff-concurrency-hardening.test.ts`) and web `capability-issue-handoff-gate.test.ts`. PGlite is single-process; races use concurrent Prisma transactions. Conditional UPDATE row-counts and `FOR UPDATE` are the portable proof; a separate multi-connection Postgres suite is not required for A7.3.
- **Does not** send Gmail mail or implement HTTP handlers.
