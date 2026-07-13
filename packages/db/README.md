# @aicaa/db

Server-side Prisma persistence for A4 (D062, D006). Domain rules live in `@aicaa/domain`; this package stores and retrieves records.

## Setup

1. Provide a Postgres `DATABASE_URL` (Supabase connection string for server/service role is typical).
2. Copy `.env.example` → `.env` (gitignored) for Prisma CLI.
3. Apply migrations: `pnpm --filter @aicaa/db migrate:deploy`
4. Generate client: `pnpm --filter @aicaa/db generate`

Ordinary Vitest tests use in-process **PGlite** (embedded Postgres) and apply migration SQL — no Docker or production database required.

Optional live DB: set `DATABASE_URL` and run Prisma CLI commands against your instance.

## Security posture

- Raw capability secrets are **never** stored (`token_hash` only — D063).
- Token generation/hashing/validation is **Phase 3**, not this package.
- RLS is enabled without policies (deny-by-default for PostgREST roles). Authorization remains application-level Owner session + capability checks.
- Physical task DELETE is not offered; use `dismissed` status (D064).

## Assignment history invariant

A task may have many `TaskAssignment` rows over time. Cleared rows stay persisted (`cleared_at` set) and are never overwritten or reused for another recipient. Capabilities remain FK-bound to the exact historical assignment under which they were issued.

**At most one active assignment per task** (`cleared_at IS NULL`) is enforced by a partial unique index in migration SQL:

`task_assignments_one_active_per_task_idx` — Prisma schema metadata does not model this partial index; the migration is the source of truth. Reassignment always inserts a new row via `createActiveAssignment`.
