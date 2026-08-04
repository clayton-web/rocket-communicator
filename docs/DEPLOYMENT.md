# Deployment and operations

Governed by [PROJECT_CONSTITUTION.md](PROJECT_CONSTITUTION.md). Architecture: [ARCHITECTURE.md](ARCHITECTURE.md). Package setup: [../packages/db/README.md](../packages/db/README.md).

This runbook documents **names and procedures only**. Never commit connection strings, passwords, capability tokens, token hashes, or other secrets.

Platform assumptions below describe the **current** deployment. Per Architecture Principles (D079), hosting and schedulers are replaceable; application logic must not depend on a specific vendor beyond documented adapters.

## Platform assumptions

| Component              | Role                                                                                                                                                                                                                                                               |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Vercel**             | Current host for `apps/web` (Next.js App Router). Monorepo root is the Vercel project root; `outputFileTracingRoot` includes workspace packages. Replaceable per D079.                                                                                             |
| **Supabase**           | Current PostgreSQL system of record and Owner Auth (Google Workspace).                                                                                                                                                                                             |
| **Prisma**             | Server-only data access via `@aicaa/db`; invoked through the web runtime bridge.                                                                                                                                                                                   |
| **External Scheduler** | Invokes authenticated app endpoints on a schedule (Gmail poll and suggestion process, each every five minutes on **separate** jobs). Recommended initial adapter while on Vercel Hobby: **cron-job.org**. Interchangeable; not an architectural dependency (D079). |

Production uses a **Supabase Shared Pooler transaction-mode** connection for the application runtime `DATABASE_URL` (serverless-friendly, port `6543`). That is correct for API routes and must not be changed.

**It is the wrong endpoint for Prisma Migrate, and earlier revisions of this document said otherwise.** Transaction-mode pooling does not preserve a session across statements and does not support prepared statements, while `prisma migrate deploy` holds a **session-scoped PostgreSQL advisory lock** for the whole invocation. Supabase's own connection guidance directs migrations away from transaction mode. Migrations are therefore run from the **operator workstation** against the **Shared Pooler session-mode** endpoint on port `5432`, supplied as a process-scoped override for that one command. See [Migration connection strategy](#migration-connection-strategy). **No Vercel environment variable changes, no `directUrl` is added to `schema.prisma`, and no new runtime database variable is introduced.**

**Host and port must match (A7 production incident).** Copy the connection string from the Supabase **Connect** dialog and do not recombine parts of two different strings. The pooler port only answers on the **Shared Pooler (Supavisor)** host form `aws-<region>.pooler.supabase.com`; the direct database host form `db.<project-ref>.supabase.co` serves the direct port only. Pairing the direct host with the pooler port produces an endpoint no server answers, and every Prisma call then fails at connection time (`PrismaClientInitializationError`) while non-database pages keep rendering — which looks like an application bug rather than configuration. The Shared Pooler host also resolves over IPv4, which Vercel requires without the dedicated IPv4 add-on. Local Prisma CLI work uses the session port on the same Shared Pooler host.

## Required environment variables (names only)

Configure in Vercel **Production** (and matching Preview/Development as needed). See `apps/web/.env.example` for placeholders.

### Owner authentication (A3)

| Variable                        | Purpose                                                                                     |
| ------------------------------- | ------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | Supabase project URL (browser + server).                                                    |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key (browser + server).                                                       |
| `NEXT_PUBLIC_APP_URL`           | Canonical app URL for OAuth redirects and capability link construction (no trailing slash). |
| `OWNER_WORKSPACE_DOMAIN`        | Google Workspace domain allowlist for Owner sign-in.                                        |
| `OWNER_ORGANIZATION_ID`         | Stable application organization id (production: `axford`).                                  |

### Database (A4)

| Variable       | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL` | Server-only Postgres URL for Prisma (`@aicaa/db`) at **application runtime**. Use the Supabase **Shared Pooler transaction** URI (port `6543`) in production (host and port must come from the same Connect string — see Platform assumptions). Never expose to the browser. **Prisma Migrate does not use this value**: migrations run from the operator workstation with a process-scoped override against the session-mode endpoint on port `5432` — see [Migration connection strategy](#migration-connection-strategy). |

### Capability tokens (A4)

| Variable                  | Purpose                                                                   |
| ------------------------- | ------------------------------------------------------------------------- |
| `CAPABILITY_TOKEN_PEPPER` | Server-only HMAC pepper for capability hash lookup (min 32 characters).   |
| `CAPABILITY_TTL_MS`       | Issued link TTL in milliseconds (D055 default: seven days = `604800000`). |

### Gmail OAuth (A5.3; names only)

Distinct from Supabase Owner authentication. Server-only; never `NEXT_PUBLIC_*`. Scope is `gmail.readonly` only.

| Variable                             | Purpose                                                                                               |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `GOOGLE_GMAIL_CLIENT_ID`             | Google OAuth client id for the Gmail connection app.                                                  |
| `GOOGLE_GMAIL_CLIENT_SECRET`         | Google OAuth client secret (server-only).                                                             |
| `GMAIL_OAUTH_REDIRECT_URL`           | Optional. Defaults to `${NEXT_PUBLIC_APP_URL}/api/v1/gmail/oauth/callback` when unset.                |
| `GMAIL_TOKEN_ENCRYPTION_KEY`         | AES-256-GCM key: 32 raw bytes as 64 hex chars or standard/base64url base64. Never commit real values. |
| `GMAIL_TOKEN_ENCRYPTION_KEY_VERSION` | Explicit key version stored with each ciphertext envelope (for example `1`).                          |

`CRON_SECRET` / `InternalCronBearer` authenticate internal scheduler endpoints: `GET|POST /api/v1/internal/gmail/poll` (A5.5), `POST /api/v1/internal/suggestions/process` (D084), and — since A8.4a and A8.5b respectively — `POST /api/v1/internal/reminders/process` and `POST /api/v1/internal/notifications/process`, both of which exist but have **no scheduler job and no enabling flag set**. Only the first two have scheduler jobs today. **The same Production `CRON_SECRET` may authenticate all four endpoints**; no separate secret is required by current decisions. Recommend ≥32 random bytes. Configure in **Production** only; do not place the production secret on Preview. Any External Scheduler that securely issues an authenticated request every five minutes is acceptable (D079). The recommended initial adapter while the project remains on the Vercel Hobby plan is **cron-job.org** (HTTP POST with Bearer auth). Other compatible schedulers—including Vercel Cron, GitHub Actions, Google Cloud Scheduler, and AWS EventBridge—may replace it without application logic changes.

### Diagnostics (normally off)

| Variable                        | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ENABLE_DB_RUNTIME_DIAGNOSTICS` | When exactly `true`, enables structured **server-side** database runtime diagnostics for Owner routes. **Disabled in Production** by default. Does not add public `X-AICAA-DB-*` response headers.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `ENABLE_OWNER_EVENT_CAPTURE`    | When exactly `true`, allows a Task mutation to record Owner Event Notification intent (D135). **Absent everywhere, including Production, and must stay that way** until the A8.5 migration has been applied there — the capture site runs inside `persistCapabilityAction`, which Production executes on every Task mutation. With the flag absent the decision is made before the transaction opens, so no statement reaches an A8.5 table and an unapplied migration is harmless. Since A8.5d it governs all ten producers rather than one: a clarification request, a return to Owner, a terminal handoff failure, a Gmail channel transition, three reminder stops, an unassigned reminder skip, and a capability expiry are each gated by it, and each decides before its transaction opens. Since A8.5e it also gates the Owner notification worker's capability-expiry capture phase, which is the only thing that observes expiry without a Recipient presenting a lapsed link. Capture records intent only; it delivers nothing, and `ENABLE_OWNER_EVENT_DELIVERY` is a separate flag |
| `ENABLE_OWNER_EVENT_DELIVERY`   | When exactly `true`, allows the Owner notification worker to claim and process intents (D135). **Absent everywhere, including Production, and must stay that way.** With it unset `POST /api/v1/internal/notifications/process` performs no delivery work at all: no scan, no claim, no attempt row, no transport, and no Gmail configuration read. Since A8.5e that endpoint also has a capture phase under the separate flag above, so "both flags unset" rather than this flag alone is what means the invocation opens no database connection. **Since A8.5c a real Gmail adapter exists behind this flag**, so it is now the only thing preventing Owner notification mail: enabling it where intents exist and the migration is applied would send from the organization's connected Gmail account to itself. Entirely separate from `ENABLE_OWNER_EVENT_CAPTURE`: capture writes intents, delivery processes them, and neither implies the other. `"1"`, `"TRUE"`, `"yes"`, and whitespace variants all leave it **off**                                                                |
| `ENABLE_REMINDER_DELIVERY`      | When exactly `true`, allows reminder occurrence processing to claim and write **and** is the sole condition under which a real Gmail reminder transport is constructed at all (A8.4b.1). **Set nowhere, including Production**, and gated by [Reminder engine operations](#reminder-engine-operations-a8--not-operational). With it unset the route builds no transport, so no access resolver exists, no refresh token is decrypted, and no token exchange is attempted; processing returns a zero-work response. Turning it on additionally requires `OWNER_ORGANIZATION_ID`, a connected Gmail account, and an External Scheduler job — none of which exist. **Unlike the notification worker, a disabled reminder invocation still opens a database connection**: `getDb()` is awaited before the flag is consulted, so the route connects and then issues no scan, claim, or write. Do not cite it as an example of "disabled implies no database contact".                                                                                                                               |

Local Prisma CLI may additionally use `packages/db/.env` with `DATABASE_URL` only (see package README).

## Build and deploy order

From repository root:

```bash
pnpm install
pnpm build:domain
pnpm build:ai          # packages/ai dist (required by @aicaa/web suggestion process)
pnpm build:db          # includes prisma generate
pnpm build:web         # builds @aicaa/ai if needed, then next build for apps/web
```

`pnpm build` and `pnpm build:vercel` run **domain → ai → db → web** in that order. `@aicaa/ai` exports compiled `dist/` only (not source) and depends on `@aicaa/domain`. `@aicaa/db` does not import `@aicaa/ai`. Vercel production builds must build `@aicaa/domain`, `@aicaa/ai`, and `@aicaa/db` before the Next.js bundle so workspace `dist` outputs, Prisma engines, and traced runtime files are present. Prefer `pnpm build:vercel` as the Production build command when the app root is `apps/web` (`cd ../.. && pnpm build:vercel`).

Repository verification also includes:

- `node apps/web/scripts/verify-db-runtime-resolution.mjs`
- `node apps/web/scripts/verify-prisma-client-construction.mjs`

These are durable safeguards for Linux/Vercel Prisma packaging—not temporary incident probes.

## Database migrations

A4 foundation migration: `packages/db/prisma/migrations/20260713190000_a4_persistence_foundation/` (**applied in production** as part of A4).

A5 Gmail persistence migration: `packages/db/prisma/migrations/20260716140000_a5_gmail_persistence/` (**applied in production** as part of closed A5). Forward-only; do not rewrite history.

A6 suggestion persistence migration: `packages/db/prisma/migrations/20260717180000_a6_suggestion_persistence/` (**applied in production** as part of closed A6).

A7 handoff migrations: `packages/db/prisma/migrations/20260718210000_a7_handoff_persistence/` and `packages/db/prisma/migrations/20260718223000_a7_handoff_concurrency_hardening/` (**applied and verified in production** as part of closed A7).

A8.3a reminder persistence migration: `packages/db/prisma/migrations/20260731040000_a8_reminder_persistence/` (**not yet applied in production**). Additive and forward-only: it creates `task_reminder_schedules` and `reminder_delivery_attempts`, adds the nullable `tasks.due_local_date`, and enables deny-by-default RLS on both new tables. It changes no existing column and performs **no backfill** — `due_local_date` stays null on every historical Task so that existing due-date data cannot activate reminders (D109).

**This migration is now a prerequisite for the A8.3b Owner reminder routes, and applying it still schedules nothing.** As of A8.3b, `GET`/`PUT`/`DELETE /api/v1/tasks/{taskId}/reminder` read and write these tables, so until the migration is applied those three routes will fail against Production while every other route is unaffected. Applying it makes reminder configuration possible, not reminder delivery: there is no scheduler, worker, cron job, or email path, so the most a schedule can do is sit in the table waiting for a later, separately authorized slice.

**As of A8.6a the `/attention` page depends on it too, and that changes the blast radius from an API route to a navigable page.** `/attention` reads `task_reminder_schedules` on every load, so until this migration is applied it will fail to its error boundary in Production — visibly, by design. It must not be made to degrade quietly: an empty attention list reads as "nothing needs your attention", which is precisely the wrong thing to tell an Owner on the strength of a missing table. Applying the migration makes the page load and show an empty list, which is truthful, because no reminder has ever been delivered and nothing can have raised the attention flag.

**A8.6b widens that page dependency to the Task detail page.** Its server component loads reminder state on every Task view, so an unapplied migration takes out `/tasks/{taskId}` — the most-used Owner page in the product — rather than one panel within it. This is the same deliberate loudness, and the same reason applies: a Task page that silently rendered "no reminders are scheduled" against a missing table would tell an Owner their automation is idle when the truth is that Rocket cannot see it. Applying the migration restores the page and every panel truthfully reports no schedule, because none has ever been created in Production. **A8.6b still adds no migration of its own**; it is a consumer of the A8.3a chain.

**A8.6c adds a second unapplied migration to the same page.** `/attention` now also reads `owner_notification_intents`, so the page depends on the **A8.5a migration** as well as the A8.3a chain, and either one being absent takes the page to its error boundary. That is again deliberate: a section headed "things Rocket could not tell you about" rendering empty against a missing table would assure the Owner that nothing went undelivered on the strength of a table that does not exist. Applying both migrations makes the page load with two truthfully empty sections, because Production has never created a reminder schedule or captured a notification intent — `ENABLE_OWNER_EVENT_CAPTURE` has never been set. **A8.6c adds no migration and no index of its own**; like A8.6a and A8.6b it is a consumer.

A8.3b audit remediation migration: `packages/db/prisma/migrations/20260731170000_a8_3b_reminder_concurrency/` (**not yet applied in production**). Additive and forward-only: it adds `task_reminder_schedules.reminder_version` with a `DEFAULT 1` and two CHECK constraints (`task_reminder_schedules_reminder_version_positive` and `task_reminder_schedules_suspended_has_no_next_occurrence`) — three statements in total. It creates no table, drops nothing, and changes no existing column type. Because the table itself does not exist in Production yet, this migration has no production rows to touch and will be applied in the same first run as the A8.3a migration whenever that intentional operator action is taken.

Why it exists: reminder writes deliberately do not bump `Task.version`, so the Task ETag cannot protect a reminder mutation, and a real-PostgreSQL audit demonstrated two concurrent Owners each holding a valid token and one of them losing a write silently. `reminder_version` is the reminder resource's own concurrency token, and correctness could not be expressed without persisting it. The CHECK constraints assert what the application already guarantees — a positive version, and a `suspended_waiting` schedule holding no next occurrence — so a paused Task cannot sit in the worker's due-scan index.

A8 lifecycle remediation migration: `packages/db/prisma/migrations/20260731230000_a8_advance_waiting_skip/` (**not yet applied in production**). One additive `ALTER TYPE "ReminderAdvanceDisposition" ADD VALUE 'skipped_waiting_elapsed'`. It rewrites no row and invalidates no existing value.

A8.4a worker-safety migration: `packages/db/prisma/migrations/20260801120000_a8_4a_worker_safety/` (**not yet applied in production**). Additive and forward-only. It adds four terminal values to `ReminderAdvanceDisposition`; adds `claim_expires_at`, `claim_sequence`, `provider_call_started_at`, `provider_accepted_at`, and `provider_message_ref` to `reminder_delivery_attempts`; adds CHECK constraints for claim coherence, provider-metadata ordering, and the rule that a non-active schedule holds no live lease; and creates two partial indexes — one for the expired-claim recovery sweep, one for the global due scan. It drops nothing and changes no existing column type.

**It carries one backfill, and that backfill is the reason this migration was tested from the existing state rather than only from empty.** A8.3b's occurrence claim was an indefinite marker with no sequence, so every row already holding a claim would have violated the new fencing constraint the moment it was added — the constraint is validated against existing rows and the new column defaults to zero. `UPDATE "reminder_delivery_attempts" SET "claim_sequence" = 1 WHERE "claimed_by" IS NOT NULL` gives those rows the sequence they would have been granted under the new lifecycle. Their `claim_expires_at` deliberately stays `NULL`: a lease that never had a deadline is not one to invent retroactively, and a null expiry reads as "not a live lease", so the next worker reclaims at sequence 2 and the fence works from there. Production has no rows to touch — the tables do not exist there yet — but the correctness of the migration must not depend on that, and `packages/db/__tests__/a8-4a-migration-from-a8.test.ts` applies it over the prior state with live data present.

A8.4a audit-remediation migration: `packages/db/prisma/migrations/20260802094500_a8_4a_settlement_marker/` (**not yet applied in production**). Additive and forward-only. It adds one nullable column, `schedule_settled_at`, to `reminder_delivery_attempts`; backfills it on every existing non-`claimed` row; adds a CHECK that only a terminal row may carry it, `NOT VALID` first and then validated; and creates two partial indexes for the settlement-debt and retry-budget recovery sweeps. It drops nothing and rewrites no column anything already reads.

**Its backfill is a statement of fact rather than an assumption.** Every terminal row predating it was written under the single-transaction design, so its schedule was settled in the same commit by construction; marking those rows settled is what stops the new sweep waking up to a backlog of history it would try to re-count. The migration was tested from empty, from the predecessor state with representative rows of every terminal shape, and against every legacy half-written claim shape the predecessor schema permitted — including the sequence-1, null-expiry rows the previous migration's own backfill produced. `packages/db/__tests__/a8-4a-settlement-marker-migration.test.ts` is that test; the remediation re-audit found this migration had none and this is the guard added in response.

**One limit on how far "statement of fact" reaches, stated because an operator would have to know it.** The backfill is a fact for rows written by code that settled in the same commit. It is an **assumption** for a terminal row whose schedule effect the pre-fix code skipped — a `permanent_failure` or `ambiguous` row whose schedule was left un-advanced. Marking such a row settled makes it permanently invisible to the settlement sweep, so a schedule effect that never happened would never be collected. This is inert as written: Production holds none of these tables, so the affected population is empty and cannot become non-empty without applying the A8 migrations first. It stops being inert if these migrations are ever applied to a database that has already run pre-fix worker code, and in that case the backfill must be narrowed to `outcome = 'success'` — or the un-advanced schedules reconciled — **before** this migration is applied, because afterwards the evidence is gone.

**A correction carried in that migration's header.** `20260801120000_a8_4a_worker_safety` opens by saying it "backfills nothing beyond column defaults", which is false: it runs the `claim_sequence = 1` update described above, and the body of that same file explains it at length. The correction is recorded in the newer migration and here rather than by editing the applied file, because Prisma records a checksum per applied migration and editing one makes `migrate deploy` fail on every database that already has it.

A8.4b.1 capability-skip migration: `packages/db/prisma/migrations/20260802173000_a8_4b1_capability_skip_reason/` (**not yet applied in production**). One additive `ALTER TYPE "ReminderSkipReason" ADD VALUE IF NOT EXISTS 'no_actionable_capability'`. It rewrites no row and invalidates no existing value, and the reminder skip-reason CHECK tests only that a reason is present exactly when the outcome is `skipped`, so it enumerates no value and needs no revalidation.

A8.4b.2 repeated-ambiguity stop-reason migration: `packages/db/prisma/migrations/20260802210000_a8_4b2_repeated_ambiguous_stop_reason/` (**not yet applied in production**). One additive `ALTER TYPE "ReminderScheduleStopReason" ADD VALUE IF NOT EXISTS 'repeated_ambiguous_outcomes'`, adding the stop reason D129 uses. Same properties as the one above: it rewrites no row, invalidates no existing value, and `task_reminder_schedules_stop_reason_matches_status` constrains only that a reason is present exactly when the status is `stopped`, so it enumerates no value and needs no rebuild or revalidation. Both files are deliberately additive and contain only the enum alteration. Keeping enum introduction separate from any schema or data operation that consumes the new value avoids PostgreSQL enum-visibility and deployment-order hazards, and keeps each migration independently testable and safely additive.

A8.4b.3 advance due-scan index migration: `packages/db/prisma/migrations/20260803090000_a8_4b3_advance_due_scan_index/` (**not yet applied in production**). One additive `CREATE INDEX IF NOT EXISTS "task_reminder_schedules_advance_due_scan_idx" ON "task_reminder_schedules"("advance_occurrence_at", "id") WHERE "status" = 'active' AND "advance_disposition" = 'scheduled'`, which the A8.4b.3 advance scan reads. It creates no column, no constraint, and no enum value, rewrites no row, and dropping it would leave the scan correct and merely slower. It is a plain `CREATE INDEX` rather than `CREATE INDEX CONCURRENTLY`: migrations are applied through the repository's standard path (`pnpm --filter @aicaa/db migrate:deploy`, that is `prisma migrate deploy`), and a concurrent build would need its own separately designed procedure rather than being introduced implicitly here. The table is empty in production, so the lock is instantaneous. Should that stop being true before this is applied, build it manually with `CREATE INDEX CONCURRENTLY` and let the `IF NOT EXISTS` make the migration a no-op.

A8.5a Owner notification migration: `packages/db/prisma/migrations/20260803120000_a8_5a_owner_notification_intents/` (**not yet applied in production**). Creates five enum types and two new tables — `owner_notification_intents` and `owner_notification_attempts` — with their CHECK constraints, indexes, and deny-by-default RLS. It alters no existing table, drops nothing, and backfills nothing. **Ordering note for the operator: the application does not require this migration to be applied.** `ENABLE_OWNER_EVENT_CAPTURE` is evaluated before the mutation transaction opens, so with the flag absent — which it is everywhere — Production's Task mutations issue no statement against either table and are unaffected by its absence. Applying it enables nothing; enabling the flag before applying it is the ordering that would break, and the flag must therefore stay absent until after the migration lands.

A8.5b adds **no migration**. It makes the states and claim-lease columns that migration already declared reachable, behind `ENABLE_OWNER_EVENT_DELIVERY`. The same ordering note applies for the same reason: with the flag absent the worker opens no database connection at all, so Production running A8.5b code against a schema without the A8.5 tables is unaffected.

A8.5c adds **no migration** either — no column, no table, no index, no enum value. It adds email rendering, destination resolution, a real Gmail adapter, and the self-ingestion marker, all behind the same unset flag, and stores nothing new: the destination is resolved at send time and deliberately never persisted.

A8.5d adds **no migration** as well — no column, no table, no index, no enum value. It adds producers for the nine remaining ratified events and a durable capability-expiry transaction, all governed by the same unset `ENABLE_OWNER_EVENT_CAPTURE`, and the A8.5a schema turned out to be the specification for the whole taxonomy rather than for the first event alone. The ordering note is unchanged and now covers nine more mutation paths: with capture absent, a clarification request, a return to Owner, a terminal handoff failure, a Gmail channel transition, a reminder settlement, and a capability expiry each issue no statement against either A8.5 table, so Production running A8.5d code against a schema without them behaves exactly as it does today.

A8.5e adds **no migration** — no column, no table, no index, no enum value. It wires the capability-expiry sweep into the notification worker's capture phase and finalizes the worker's response contract. The expiry scan is deliberately global across organizations, so the existing `(organization_id, status, expires_at)` index cannot serve it and PostgreSQL 16 plans a sequential scan with a top-N heapsort. That was measured rather than assumed: **0.74 ms over 9,109 rows, 362 shared buffer hits**, against a bounded fifty-row batch on a table that grows once per handoff. **No index was added on speculation.** If the table ever grows enough for that to matter, the remedy is a partial `(expires_at, id) WHERE status = 'active'` index, and the planner test in `apps/web/__tests__/a8-5e-worker-concurrency.pg.test.ts` is where the change in cost would first become visible. The ordering note is unchanged: with capture absent the sweep never runs, so Production running A8.5e code against a schema without the A8.5 tables behaves exactly as it does today.

**Each enum migration contains one statement and uses the new value nowhere, deliberately.** Keeping enum introduction separate from any schema or data operation that consumes the new value avoids PostgreSQL enum-visibility and deployment-order hazards: PostgreSQL restricts _using_ a freshly added enum value in the same transaction that added it, so depending on how statements are grouped when applied, a file that added the value and then referenced it — in an index predicate, a CHECK, or a backfill — can pass a from-empty test and still fail on apply. Separating them keeps the migration independently testable and safely additive. `packages/db/__tests__/a8-4b1-capability-skip-migration.test.ts` asserts that shape as well as the behaviour.

**A known inaccuracy is retained inside three migration files, and this paragraph is its authoritative correction.** The header comments of `20260802094500_a8_4a_settlement_marker`, `20260802173000_a8_4b1_capability_skip_reason`, and `20260802210000_a8_4b2_repeated_ambiguous_stop_reason` each make a claim about how Prisma groups a migration file's statements into transactions. The repository establishes only that migrations are applied through `pnpm --filter @aicaa/db migrate:deploy`, that is `prisma migrate deploy`. It establishes nothing about transaction grouping, that claim should not be relied on or repeated, and no reasoning in this document depends on it. The comments are left in place because editing an applied migration file changes its recorded checksum and would break `migrate deploy` against every local database that already applied it, while the SQL statements themselves are correct and unaffected.

The A8.4a comment also draws a substantive conclusion from that claim — that its `NOT VALID` / `VALIDATE` split cannot yet reduce lock duration. Read it instead as follows: the migration applies the constraint change through the repository's standard deployment path as one migration step, and a lower-lock rollout would require a separately designed operational procedure that creates the constraint as `NOT VALID` and validates it in a later step, rather than merely changing that file's wording. The split is still the right shape to have written, because it is the form such a procedure would adopt and because the backfill guarantees the validation finds nothing to reject.

Applying any of these reminder migrations still sends nothing. They make occurrence processing _representable_; the processing endpoint remains disabled by default, constructs no transport at all while `ENABLE_REMINDER_DELIVERY` is unset, and is invoked by no cron job.

**Local Docker** (loopback Postgres 16 on port 5433; never production):

```bash
pnpm db:docker:up
pnpm db:migrate:local
pnpm db:migrate:status:local
```

Ordinary package tests use in-process **PGlite** and do not require production `DATABASE_URL`. Production always uses Supabase Postgres. Local Docker setup: [packages/db/README.md](../packages/db/README.md).

### Migration connection strategy

**The application runtime and Prisma Migrate use different endpoints on purpose, and only one of them is configured in Vercel.**

| Consumer                   | Endpoint                                     | Port   | Where the value lives                                             |
| -------------------------- | -------------------------------------------- | ------ | ----------------------------------------------------------------- |
| Vercel application runtime | Supabase Shared Pooler, **transaction** mode | `6543` | Vercel Production `DATABASE_URL`. **Unchanged by any A8.7 step**  |
| `prisma migrate deploy`    | Supabase Shared Pooler, **session** mode     | `5432` | Process-scoped override on the operator workstation. Never stored |

Why the split: `prisma migrate deploy` takes a **session-scoped PostgreSQL advisory lock** and holds it for the whole invocation, and transaction-mode pooling gives no stable session to hold it in. Session mode does. This is the same Shared Pooler host in both cases; only the port and mode differ, and the A7 host/port incident above applies exactly as written — copy one whole string from the Supabase **Connect** dialog and do not recombine parts of two.

Placeholder form of the migration URL (**no real project reference, region, username, or password may ever be written down**):

```text
postgresql://postgres.<PROJECT_REF>:<PASSWORD>@aws-<REGION>.pooler.supabase.com:5432/postgres
```

**`DIRECT_URL` has no automatic effect in this repository.** Prisma only consults a second connection when the datasource block declares `directUrl`, and `packages/db/prisma/schema.prisma` declares `url = env("DATABASE_URL")` alone. Setting `DIRECT_URL` anywhere therefore changes nothing; a migration run with a transaction-mode `DATABASE_URL` would still use transaction-mode pooling. **A8.7 does not add `directUrl`**, because doing so would put a second production connection string into the deployed configuration to serve a command that is never run from the deployment.

#### Secure migration-command handling

Read the credential into the environment without it entering shell history, run the three commands, then discard it:

```bash
read -rs -p "Migration DATABASE_URL (session pooler, port 5432): " MIGRATE_URL
export MIGRATE_URL
```

```bash
DATABASE_URL="$MIGRATE_URL" pnpm --filter @aicaa/db migrate:status
DATABASE_URL="$MIGRATE_URL" pnpm --filter @aicaa/db migrate:deploy
DATABASE_URL="$MIGRATE_URL" pnpm --filter @aicaa/db migrate:status
unset MIGRATE_URL
```

Rules that make that pattern load-bearing rather than cosmetic:

- **The local-only helpers must never be pointed at production.** `pnpm db:migrate:local`, `db:migrate:status:local`, and anything else routed through `packages/db/scripts/run-local-prisma.mjs` assert a loopback host and exist for the Docker cluster. They are not "the same command with a different URL".
- **A bare migration command is prohibited during a production operation.** `pnpm --filter @aicaa/db migrate:deploy` with no inline `DATABASE_URL` falls back to `packages/db/.env`, whose contents are operator-local, untracked, and unverifiable from the repository. The explicit prefix is what makes the target auditable.
- **Inspect the local `.env` target before migrating anyway.** Confirm what `packages/db/.env` currently points at, so that a mistyped prefix fails rather than silently reaching something unintended.
- **No credential may be committed, pasted into documentation, quoted in a ticket, or recorded in evidence.** Evidence records the redacted host form and the port, never the string.
- **An advisory-lock timeout is not a retry-immediately condition.** If `migrate deploy` fails to acquire the advisory lock, another migration process may still be running or may have died holding state. Re-run only after confirming there is no failed migration row **and** no partial physical schema — see [Migration failure model](#migration-failure-model-a87).

#### Migration endpoint verification

Run these three checks before the first `migrate deploy` of a session, and record the results.

1. **Hostname form** is the Shared Pooler form `aws-<region>.pooler.supabase.com`, not `db.<project-ref>.supabase.co`.
2. **Port is exactly `5432`**, not `6543`. This is the single most consequential character in the string.
3. **`pgbouncer=true` is absent** from the query parameters. Its presence indicates a string copied from the transaction-mode panel.

As supporting evidence, a session-scoped advisory lock taken and re-read in one `psql` session should observe itself:

```sql
SELECT pg_try_advisory_lock(72707707);
SELECT count(*) FROM pg_locks WHERE locktype = 'advisory';
SELECT pg_advisory_unlock(72707707);
```

**Do not treat that test as proof on its own.** A transaction pool can coincidentally hand the same backend to both statements of a short test, so a pass is consistent with — but does not establish — session mode. **The authoritative controls are the endpoint's documented Supabase mode and the exact host/port pairing above**; the lock test only catches a gross mismatch.

Evidence fields for this step: redacted hostname form, port, session-mode confirmation, advisory-lock test result, and an explicit confirmation that the credential itself was not recorded.

## Production smoke checks

After deploy, confirm (authenticated Owner session required for protected routes):

| Check                       | Expected                                                     |
| --------------------------- | ------------------------------------------------------------ |
| `GET /api/v1/session`       | `200`; `role` = `owner`; `organizationId` = `axford`         |
| `GET /api/v1/tasks`         | `200`; cursor page shape                                     |
| `GET /c/{token}`            | Non-mutating capability page for a valid issued link         |
| Recipient capability `POST` | Mutations require `confirmation: "confirmed"` and `If-Match` |
| Owner `/tasks` (browser)    | Task list renders; Task detail renders notes and outcome     |

Full Owner↔Recipient production E2E is classified **`A4_FULL_E2E_PASS`**. The A7 handoff E2E (both delivery paths + Recipient capability completion + Owner-visible notes) passed at closure; see [MILESTONES.md](MILESTONES.md). Retained operator E2E artifacts are intentional runbook data—not repository secrets.

## Gmail polling operations (A5.5)

The **Application Polling Engine** is part of the AI Communication Action Assistant (eligibility, sequential sync, History ingestion, locks, audit). Scheduling is **intentionally external** and vendor-neutral (D065, D079): any External Scheduler capable of securely invoking the Authenticated Endpoint every five minutes is acceptable. The scheduler never contains polling logic, business rules, or direct database access.

**Recommended initial scheduler:** **cron-job.org**, while the project remains on the Vercel Hobby plan. It supports five-minute HTTP scheduling, works with Hobby hosting, has a free tier suitable for current requirements, and keeps the application architecture vendor-neutral. cron-job.org is an **implementation choice / Infrastructure Adapter**, not an architectural requirement.

**Vercel Hobby note:** Vercel Hobby does not support cron schedules more frequent than daily. Root `vercel.json` therefore must **not** declare a five-minute Vercel Cron for Gmail poll. Five-minute cadence remains an External Scheduler responsibility (D065, D079). No scheduler is configured or active until Production enablement intentionally turns one on.

**Interchangeable alternatives** (no application logic changes required):

- Vercel Cron
- GitHub Actions
- Google Cloud Scheduler
- AWS EventBridge
- another compatible scheduler that can securely invoke the Authenticated Endpoint

### External Scheduler configuration (cron-job.org initial adapter)

Configure the External Scheduler to:

| Setting        | Guidance                                                                                                   |
| -------------- | ---------------------------------------------------------------------------------------------------------- |
| Method         | **HTTP POST**                                                                                              |
| URL            | `{NEXT_PUBLIC_APP_URL}/api/v1/internal/gmail/poll` (Production app URL; no trailing slash on the base URL) |
| Interval       | Every **five minutes** (D065)                                                                              |
| Authentication | `Authorization: Bearer <CRON_SECRET>` (never commit or paste the secret into docs)                         |
| Request body   | Empty / none required                                                                                      |

Do **not** enable the Gmail poll scheduler until all of the following are true (A5 checklist — now satisfied in Production):

1. A5 Prisma migration applied in production.
2. Gmail OAuth configured (`GOOGLE_GMAIL_CLIENT_ID`, `GOOGLE_GMAIL_CLIENT_SECRET`, redirect URL as needed).
3. Token encryption configured (`GMAIL_TOKEN_ENCRYPTION_KEY`, `GMAIL_TOKEN_ENCRYPTION_KEY_VERSION`).
4. `CRON_SECRET` configured in Production only (not Preview).
5. Application deployed.
6. Owner has connected Gmail.
7. Owner has run **manual** `POST /api/v1/gmail/sync` once (initial no-backfill History seed).

After enablement, confirm invocations via the scheduler’s execution logs and `GmailSyncRun` rows with `trigger=cron`.

**Disable External Scheduler invocation safely:** pause or delete the cron-job.org job (or equivalent on another adapter), or unset/rotate `CRON_SECRET` (auth fails closed). Overlapping invocations are safe via per-account sync locks. Replacing cron-job.org with another adapter does not require Application Polling Engine changes.

**Eligibility:** `connected` + `historyState=valid` + non-null `historyId` + credential present. The Application Polling Engine never seeds unset History during External Scheduler invocation. At most three accounts per invocation, sequential, `maxDuration=60`, stop starting accounts with &lt;15s remaining. Per-account A5.4 bounds (5 pages / 50 messages) unchanged. Gmail 429 stops remaining accounts for that invocation.

**A5 closed.** History recovery and Gmail settings UI remain deferred and do **not** block A6. A6 suggestion processing uses a **separate** authenticated endpoint (`POST /api/v1/internal/suggestions/process`, D084) and must not run inside Gmail History sync transactions.

### Suggestion processing operations (A6 — Production-enabled)

A6 is **closed**. A **separate** External Scheduler job (cron-job.org initial adapter) invokes suggestion processing every five minutes, independent of the Gmail poll job:

| Setting        | Guidance                                                                    |
| -------------- | --------------------------------------------------------------------------- |
| Method         | **HTTP POST**                                                               |
| URL            | `{NEXT_PUBLIC_APP_URL}/api/v1/internal/suggestions/process`                 |
| Interval       | Same cadence family as Gmail poll (every five minutes); **independent** job |
| Authentication | `Authorization: Bearer <CRON_SECRET>`                                       |
| Request body   | Empty / none required                                                       |

**Credential distinction (names only):** `CRON_SECRET` authenticates the application process endpoint (same secret family as Gmail poll). `CRON_JOB_ORG_API_KEY` (or equivalent scheduler management credential) is used only outside the app to administer the scheduler account — never committed, never logged, never sent to application routes.

Response is aggregate counts only — never raw bodies (D084, D085). Overlapping or repeated invocations are **safe** (claim leases + relational 0..1 suggestion uniqueness, D081). Heuristic relevance runs before AI; AI failure does not create heuristic-only fallback suggestions (D085). Claim batches prefer fresh `unprocessed` events before reclaiming `failed_retryable` so a retryable AI failure cohort cannot monopolize every invocation.

**`AI_INVALID_OUTPUT` / `AI_EMPTY_OUTPUT` / `AI_SCHEMA_INVALID` runbook:** Prefer reading `suggestion_last_error_code` plus the audit `note` fingerprint (`code|status=…|keys=…|issues=…`) — never re-enable content logging. Typical causes: model emitted non-contract fields (`details` instead of `value`, numeric `id`), or empty `summaryPoints`. Confirm via scheduler/automatic runs or a single controlled `POST` that aggregate counts move and audits stay privacy-safe. Distinguish `AI_INSUFFICIENT_QUOTA` (billing) from `AI_RATE_LIMIT` (true 429 throttle).

**D082 retention (Production-confirmed):** dismissed suggestion excerpts → `updatedAt + 7 days`; approved suggestion excerpts → `updatedAt + 30 days` (workflow safety ceiling).

### Handoff operations (A7 — Production-operational)

**A7 is CLOSED** (tag `v0.7.0-a7-complete`; A7.0 decisions D086–D094). Production SHA at closure: `8da353692c39484467f8f4651acf101fa172f4e8`. Handoff has **no scheduler job**: delivery runs inside the authenticated Owner request (D094(3)), so there is nothing to enable or pause. Production evidence and the deferred-item list live in [MILESTONES.md](MILESTONES.md).

Operator notes:

- Both delivery paths are production-verified: `gmail_forward` for Gmail-origin Tasks and `assignment_email` otherwise. The server chooses; operators do not.
- The Owner grant must carry `gmail.readonly` **and** `gmail.send` (D093). If send scope is missing, the Owner Task page offers re-consent and then a **manual** retry — no automatic send on OAuth return.
- Handoff idempotency is durable. A repeated same-key call replays the single attempt; it does not send a second message.
- Recipients are currently managed through the A7.6 Owner Recipient endpoints; there is no Recipient management UI yet (A7 deferred backlog).

**A8.0 documentation Decision Lock** recorded (D095–D101) and partly superseded. **A8.1 documentation Decision Lock** recorded (**D102–D110**): A8 is a **due-date-driven** reminder model. Do not implement any further part of the Follow-up Engine or Event Notification Engine until the specific slice is authorized. **P1.0 documentation Decision Lock** recorded (**D111–D120**): the Owner web experience foundation is scoped; **P1.1 through P1.5 are implemented**; **P1 is COMPLETE** — implemented, deployed, and production-validated with one documented evidence limitation ([P1_5_EVIDENCE.md](P1_5_EVIDENCE.md)). Roadmap: **A7 → A8 → A9** (no early separate A9.0); **P1** was sequenced before the remaining A8 implementation slices and is now closed. **A8 is the current milestone: A8.1, A8.2, A8.3a, A8.3b, the Task-lifecycle wiring, A8.4a, A8.4b.1, and A8.4b.2 are complete, with A8.4a approved; A8.4b.3, A8.5a through A8.5e, and A8.6a through A8.6c are implemented and awaiting architecture review; A8.7a is this rollout documentation and A8.7b through A8.7e are not started.** Nothing in A8 is operational in Production — **none of the nine A8 migrations is applied**, so the Owner reminder APIs, lifecycle wiring, occurrence-processing endpoint, notification worker, and the `/attention` and Task-detail surfaces that exist in the repository cannot function against Production; all three A8 flags are set nowhere, so neither the real Gmail reminder transport nor the Owner notification transport is ever constructed; and no cron job exists for either worker. The full rollout procedure is [A8.7 production rollout](#a87-production-rollout), and **none of it has been performed**.

### Owner web experience foundation operations (P1)

**P1.1 through P1.5 are implemented. P1 is COMPLETE** — implementation complete, deployed, and production-validated. The P1.1 baseline comparison against production was completed in P1.5 (D119).

Production currently serves commit `8588c5d260176b24c8ecf6fb16e026c5c6034359` via the automatic Vercel production deployment `dpl_7vmnL71Lck7JLeftgsJkYVJ4uw82` (Ready; stable alias `https://rocket-communicator-web.vercel.app`; immutable URL `https://rocket-communicator-fokub6tw4-claytons-projects-37065b04.vercel.app`). Deployed and production-validated 2026-07-30. No manual deployment action was required for P1.5. Evidence: [P1_5_EVIDENCE.md](P1_5_EVIDENCE.md).

**Rollback deployment retained:** `dpl_3sp18eqYRQH6bjKdXC72Tue263V1` (commit `243895f`, the P1.4 closeout documentation; application code identical to the P1.4 validated build). The earlier P1.4 deployment `dpl_F5zjNcc4zwiwbr25CSdMGA3zDy8c` (commit `a38c8574`) also remains available. No rollback condition was triggered and no rollback was performed.

**Operator note — production validation coverage.** Signed-out routes, authenticated Owner routes, redirects, sign-in, sign-out, shell persistence, one authenticated Owner span per request, invalid capability behaviour, accessibility, and capability security in the invalid-link scope were all validated in production. The **valid Recipient capability workflow was not**, because the application intentionally provides no safe production path for creating a synthetic Recipient capability — issuing one requires an A7 Gmail handoff that forwards a real customer email. This is an intentional production-safety property and an **evidence limitation**, not a defect or a failed validation; the workflow is covered by local evidence. Detail: [P1_5_EVIDENCE.md](P1_5_EVIDENCE.md) §6.

**Operator note — capability URLs in platform access logs.** Platform access logs naturally record request paths, so capability URLs appear in them because the capability identifier is embedded in the path. This is **not** introduced by P1.5, **not** a regression, and **rollback would not change it**. The D114 application-side prohibition is intact: no raw `/c/{token}` path appears in any application diagnostic, which was verified in production. Recorded as a future architectural and security consideration, **not** a release blocker. Detail: [P1_5_EVIDENCE.md](P1_5_EVIDENCE.md) §7.

**No new environment variable was introduced by P1.1.** The existing `ENABLE_DB_RUNTIME_DIAGNOSTICS` remains an **incident-only** gated DB probe (disabled in Production by default). Always-on operational diagnostics use the application-owned seam in `apps/web/lib/observability/` and emit privacy-safe JSON on standard output (`operation_timing`, `operational_failure`).

**Vendor-neutral by requirement (D115).** Structured diagnostics are read through the host's existing log surface. A hosted backend or OpenTelemetry exporter must remain an **adapter** (D079); no commercial telemetry vendor, session replay, or behavioural analytics is authorized.

**No health or readiness endpoint is authorized, and none is required for P1 closure (D115).** Existing operator smoke checks — `GET /api/v1/session` returning 200 or 401 and an authenticated `GET /api/v1/tasks` — plus P1.1 structured diagnostics and silent-failure detection are sufficient. A contract test asserts `/health` is absent from the bundled OpenAPI.

**Capability routes are excluded from client telemetry (D114).** Server-side diagnostics identify capability routes only by static templates (`/c/[token]`, `/api/v1/capabilities/[token]/…`). Full prohibition list: [SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md).

**Baseline before change (D119).** Captured in [P1_1_BASELINE.md](P1_1_BASELINE.md). Numeric thresholds are ratified from evidence afterward, not asserted in advance.

**Browser verification runs as a separate job (D119)** rather than inside `pnpm verify` — **P1.2 is implemented, pending review**: `pnpm --filter @aicaa/web e2e`. It targets a **controlled local environment only** (disposable local Postgres plus a local Supabase Auth double) and refuses any non-loopback database. It is never run against production, and it produces **no** preview or production evidence. It has been executed on **macOS only** and is **not part of any CI workflow**; running it elsewhere needs PostgreSQL binaries on `PATH` plus a Chromium install step. Stop the disposable cluster with `pnpm --filter @aicaa/web e2e:db:stop` when finished. Prerequisites, commands, coverage, and known gaps: [P1_2_BROWSER_HARNESS.md](P1_2_BROWSER_HARNESS.md).

### Reminder engine operations (A8 — not operational)

**Nothing in this subsection is operational, and no reminder has ever been sent.** Since A8.4a a worker endpoint and a delivery flag **do** exist in the repository: `POST /api/v1/internal/reminders/process` and `ENABLE_REMINDER_DELIVERY`. Neither is live. **No scheduler job invokes the endpoint and the flag is set in no environment.** The A8.3b Owner reminder routes configure a schedule, the Task-lifecycle wiring keeps it truthful as the Task moves, and A8.4a can claim, guard, and finalize an occurrence. The A8 persistence tables (`task_reminder_schedules`, `reminder_delivery_attempts`, and `tasks.due_local_date`) **exist in the repository migrations but are not applied in Production** — see the migration history above. This records the approved enablement gate so it cannot be missed later; it is not a runbook for existing infrastructure.

**A8.4b.1 added a real Gmail transport for overdue reminders, and the flag is what holds it shut.** The processing service itself still imports no provider — a source guard scans `lib/reminders` and fails the build if one appears — and the route is the single composition point. That composition is **conditional on `ENABLE_REMINDER_DELIVERY === 'true'`**, so in every environment as configured today no Gmail transport object is constructed, **no access resolver exists, no stored refresh token is decrypted, and no token exchange is attempted**; the endpoint returns a zero-work response reporting `transportConfigured: false`. Enabling the flag additionally requires `OWNER_ORGANIZATION_ID` to be set and a Gmail account to be connected for that organization: without either, the route builds no transport and the response reports the same zero work rather than proceeding on a guess. Automated tests cannot reach real Gmail even with the flag forced on, because the adapter throws at construction when it detects a test runner.

**Two operational properties of the send path an operator should know before enabling it.** Gmail authorization is resolved **once per invocation, before any schedule is claimed**: if the Gmail connection is missing, revoked, or unrefreshable, the invocation claims nothing, writes nothing, calls no provider, and reports `transportAuthorized: false` — it does not consume any Recipient's reminder day or mark any schedule as failed, so the fault is visible without being charged to a Task. And a reminder email **contains no link** (D130): it directs the Recipient to the original assignment email, and if that email's capability is expired, revoked, or otherwise unusable, the occurrence is skipped as `no_actionable_capability` with no provider call rather than sending an instruction that cannot be followed.

**Production-enablement dependency and closure gate (D108).** Scheduler and delivery code **may** be developed and merged behind a **disabled** production feature flag before the Event Notification Engine is finished. However:

> **Production reminder delivery must not be enabled until both the Event Notification Engine and the minimum Owner schedule-status UI are operational.**

Before enablement, the Event Notification Engine must be able to notify the Owner about at least: overdue reminder ceiling reached; permanent reminder-delivery failure; no active assignment where Owner action is required; and a schedule entering `requiresOwnerAttention`. A Task-page status alone is **not** sufficient — the Owner must not have to inspect Tasks continually to discover that an automation stopped. The same gate applies to any claim that A8 is closed.

**Additional pre-enablement conditions.**

- Existing historical due-date data must **not** auto-activate reminders on deploy. Explicit Owner opt-in or re-save is required (D109), and the first production observation must confirm no pre-existing Task fired a reminder.
- Delivery must be observed at **09:00 organization-local**, not UTC (D103).
- No capability token or capability URL may appear in reminder logs, telemetry, audit, or metadata (D109).

**Organization timezone configuration (future, not implemented).** The Owner organization timezone is the sole scheduling authority and is `America/Vancouver` (D034, D103). It is currently a documented product constant with **no** environment variable, configuration record, or database column. If A8 implementation introduces configuration for it, that configuration and its validation must be documented **when it exists** — do not treat any variable name as configured in advance.

**Scheduler adapter — endpoint exists, job does not (A8.4a).** Reminder processing follows the existing pattern: an application-owned engine behind one authenticated internal endpoint, `POST /api/v1/internal/reminders/process`, authenticated with the existing `CRON_SECRET` bearer family and intended for an interchangeable External Scheduler (D079) on the same approximately five-minute cadence as the Gmail poll and suggestion jobs. **No cron-job.org job — or any other scheduler job — has been created for it, and none may be created before the gate above is satisfied.**

The five-minute cadence is a wake-up interval, not a reminder interval. Nothing repeats every five minutes: persisted occurrence instants are the scheduling authority and each invocation asks which have arrived. A missed invocation is recovered by a later one, overlapping invocations are safe because occurrence identity is unique in the database rather than because they are prevented from overlapping, and a backlog drains a bounded batch per cycle. No in-memory timer is load-bearing.

| Variable                   | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ENABLE_REMINDER_DELIVERY` | Gates all reminder occurrence processing. **Absent everywhere, including Production**, and must stay that way until the gate above is satisfied. When absent or anything other than the exact string `true`, the endpoint claims nothing, writes nothing, invokes no transport, and returns zero aggregates with `deliveryEnabled: false`. `"1"`, `"TRUE"`, and `"yes"` all leave delivery **off** — the match is exact because the cost of guessing wrong is mail nobody approved. |

Even with the flag on, A8.4a sends no email, and it does not even pretend to. Processing requires an **injected** transport and refuses to run without one, returning a zero-work response with `transportConfigured: false`; nothing in the application injects one, because the only implementation is a deterministic fake used by tests, and an unscripted fake returns a permanent `transport_not_configured` failure rather than acceptance. No processing module can reach a Gmail client — a source guard fails the build if one is imported. Real delivery is A8.4b.

### Owner notification worker (A8.5b–A8.5e — not operational)

**A second internal worker exists and is separate from the reminder worker in every respect.** `POST /api/v1/internal/notifications/process`, same `CRON_SECRET` bearer family, same Node.js runtime and sixty-second budget, same twenty-five-item delivery batch and fifteen-second deadline reserve. **No scheduler job invokes it and none may be created**; `vercel.json` is unchanged. The two workers are deliberately not merged: reminder occurrence policy and one-shot Owner event delivery have different retry rules, different terminal states, and different tables, and one endpoint doing both would make a single deadline and a single batch serve two unrelated backlogs.

**Since A8.5e the endpoint has two independently gated phases.** A **capture** phase observes capability expiry under `ENABLE_OWNER_EVENT_CAPTURE`, and a **delivery** phase claims and sends intents under `ENABLE_OWNER_EVENT_DELIVERY`. They run in that order in one invocation, share the deadline, and share no transaction.

| `ENABLE_OWNER_EVENT_CAPTURE` | `ENABLE_OWNER_EVENT_DELIVERY` | What one invocation does                                                                                                            |
| ---------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| absent                       | absent                        | **Today's state.** Authenticates, reads two strings, returns zero aggregates. No database connection, no transport, no credential   |
| `true`                       | absent                        | Observes up to fifty expired capabilities. Composes no transport, reads no Gmail configuration, claims no intent, writes no attempt |
| absent                       | `true`                        | Delivery exactly as A8.5c. No expiry scan, and no new `capability.expired` intent can be created                                    |
| `true`                       | `true`                        | Expiry observation first, then the delivery batch within whatever budget remains                                                    |

Each flag is matched as the exact string `true`, independently. `"1"`, `"TRUE"`, `"yes"`, and whitespace variants leave **that** flag off and do not affect the other. `ENABLE_REMINDER_DELIVERY` is a third, unrelated flag and this endpoint does not read it.

**The invariant an operator should rely on: with both flags absent, this endpoint touches nothing.** Both are read before the database runtime is loaded, before any configuration is read, and before any credential is touched. This is stronger than the guarantee A8.5b documented, which covered only the delivery service and left the route constructing a database client on every invocation.

**Since A8.5c a real Gmail adapter exists, and the delivery flag is the only thing holding it shut.** A8.5b had two independent reasons the worker could not send; there is now one, so `ENABLE_OWNER_EVENT_DELIVERY` must be treated as live ammunition rather than as a formality. It is **absent everywhere, including Production, and must stay that way**; the response reports `deliveryEnabled` and `transportConfigured` separately so an operator can see which condition applies. Under a test runner, constructing the real sender without an injected fake throws a dedicated safety error rather than returning something that could reach Gmail. A source guard fails the build if the processing service or the capture phase imports a provider, a MIME builder, or reminder delivery policy — the adapter composes at the route, not inside either phase.

**Enabling delivery would send mail from the connected Gmail account to itself.** The destination is resolved server-side from the intent organization's `CommunicationAccount.emailAddress`; there is no configuration setting that redirects it, and `OWNER_ORGANIZATION_ID`, if set, only asserts agreement and fails closed on mismatch. `NEXT_PUBLIC_APP_URL` must be a valid application origin, since Owner notification links are built from it; if it is missing or invalid the route constructs no transport rather than sending mail with a broken or foreign link. An invalid value cannot prevent the capture phase from running, because no transport is composed until delivery is due to start.

**Enabling capture alone is safe and is the intended first step.** It observes expiry, writes audit rows and notification intents, and can contact nothing. Any backlog it accumulates cannot later flush: an intent older than twenty-four hours is terminalized as suppressed without contacting anything, so turning delivery on weeks later mails nothing about the interval. **Capture still requires the A8.5a migration to have been applied first** — see the ordering note above.

**Nothing schedules the capture phase.** The sweep is invoked by this endpoint and by nothing else, and no cron job invokes this endpoint. **Do not describe capability expiry as scheduled.** With capture absent — which it is everywhere — expiry is still observed only on the Recipient path, exactly as before A8.5d.

**Counts against `owner_notification_intents` and `owner_notification_attempts` will error in Production** until the A8.5a migration is applied there; none of A8.5b, A8.5c, A8.5d, or A8.5e adds a migration of its own.

## A8.7 production rollout

**Nothing in this section has been performed.** Every command, query, and dashboard action below is an instruction to a future operator working under a separate authorization. A8.7a — the slice that wrote this section — contacted no production system, no database, no scheduler, and no provider, and changed no environment variable.

Read this section as the whole rollout at once before starting any part of it. It is deliberately written so that the decision points are settled while nobody is under pressure.

### A8.7 slice structure

| Slice     | Scope                                                                                                                 | Production contact                       |
| --------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| **A8.7a** | Rollout preparation, recovery procedures, verification classification. **This documentation.**                        | **None**                                 |
| **A8.7b** | Production preflight, all pending A8 migrations, schema verification, disabled-feature deployment, smoke verification | Database and deployment                  |
| **A8.7c** | Owner-event capture enablement and observation                                                                        | One environment variable, one deployment |
| **A8.7d** | Zero-send notification rehearsal, single-notification canary, Gmail-loop proof, notification scheduler creation       | Gmail send, scheduler creation           |
| **A8.7e** | Reminder preflight, single-reminder canary, reminder scheduler creation                                               | Recipient email, scheduler creation      |

**Each slice requires its own authorization.** A8.7d is the first slice in the project's history that can send mail on Rocket's initiative, and A8.7e is the first that can send mail to somebody who is not the Owner. Those are different thresholds and are deliberately not crossed in one slice.

### Current production state — the rollout's starting point

| Property                      | Value                                                                                          |
| ----------------------------- | ---------------------------------------------------------------------------------------------- |
| Deployment                    | `dpl_7vmnL71Lck7JLeftgsJkYVJ4uw82` (Ready; alias `https://rocket-communicator-web.vercel.app`) |
| Commit                        | `8588c5d260176b24c8ecf6fb16e026c5c6034359` (P1.5)                                              |
| A8 migrations applied         | **None of the nine**                                                                           |
| `ENABLE_OWNER_EVENT_CAPTURE`  | Absent                                                                                         |
| `ENABLE_OWNER_EVENT_DELIVERY` | Absent                                                                                         |
| `ENABLE_REMINDER_DELIVERY`    | Absent                                                                                         |
| Scheduler jobs                | Gmail poll and suggestion process only                                                         |

**The deployed commit predates every A8 slice.** That is what makes migrate-before-deploy safe here: the code currently running issues no statement against any A8 table or column, so applying all nine migrations changes nothing it can observe. Prisma Client selects columns explicitly rather than with `SELECT *`, so a new nullable column on `tasks` is invisible to it. The compatibility question that normally makes migrate-before-deploy delicate — old code meeting new schema — has the trivial answer in this direction, and the dangerous ordering is the reverse one: A8.6 code meeting a schema without the tables, which takes `/attention` and `/tasks/{taskId}` to their error boundaries.

### Verification gate classification

Three categories, kept separate because conflating them is how a "quick check" regenerates a tracked artifact in the middle of a production operation.

#### 1. Repository-non-mutating preflight

Suitable immediately before and after a production operation. **"Non-mutating" here means "does not alter tracked source"** — several of these write cache, `dist`, or `node_modules` output, and the table says which.

| Command                               | Alters tracked files | Untracked / cache output                    | Regenerates artifacts                   | Writes local DB           | Docker | Starts services | Network | Production | Gmail |
| ------------------------------------- | -------------------- | ------------------------------------------- | --------------------------------------- | ------------------------- | ------ | --------------- | ------- | ---------- | ----- |
| `git rev-parse HEAD`                  | No                   | No                                          | No                                      | No                        | No     | No              | No      | No         | No    |
| `git status --short`                  | No                   | No                                          | No                                      | No                        | No     | No              | No      | No         | No    |
| `git diff --stat`                     | No                   | No                                          | No                                      | No                        | No     | No              | No      | No         | No    |
| `pnpm format:check`                   | No                   | No                                          | No                                      | No                        | No     | No              | No      | No         | No    |
| `pnpm lint`                           | No                   | Yes — ESLint/tool cache                     | No                                      | No                        | No     | No              | No      | No         | No    |
| `pnpm --filter @aicaa/contracts lint` | No                   | No                                          | No                                      | No                        | No     | No              | No      | No         | No    |
| `pnpm contracts:validate`             | No                   | Yes — `packages/contracts/dist` (untracked) | No                                      | No                        | No     | No              | No      | No         | No    |
| `pnpm --filter @aicaa/domain test`    | No                   | Yes — Vitest cache                          | No                                      | No                        | No     | No              | No      | No         | No    |
| `pnpm --filter @aicaa/web test`       | No                   | Yes — workspace `dist`, Vitest cache        | Yes — Prisma Client into `node_modules` | No (PGlite is in-process) | No     | No              | No      | No         | No    |

**Excluded from this category, deliberately:**

- **`pnpm contracts:check-drift`** runs `pnpm generate` first, which writes into the **tracked** `packages/contracts/generated` tree before asserting the diff is clean. It is a development gate, not a preflight.
- **`pnpm build:web`** produces a full `.next` build. Correct before a deploy, pointless as a between-steps check.
- **Anything under `pnpm db:migrate:*:local`**, which asserts a loopback host and exists for the Docker cluster.

#### 2. Full development verification

`pnpm verify` is **unchanged and must stay unchanged**. It runs `contracts:generate` and `contracts:check-drift`, so it **may rewrite committed generated artifacts**, and it builds Android as well as web.

Run it as the **normal slice exit gate**. Do **not** run it during a live production operation: a rollout window is not the moment to discover that a generator produced a different byte sequence.

#### 3. Production database preflight

Read-only production SQL from [Production preflight and verification SQL](#production-preflight-and-verification-sql), plus `prisma migrate status`. **Executed only in A8.7b or later, and only with explicit authorization for that slice.** No part of A8.7a runs any of it.

#### Docker

`.pg.test.ts` suites skip themselves unless `AICAA_PG_CONCURRENCY_URL` is set, so the ordinary suites need no container. **Start Docker before running a local PostgreSQL migration rehearsal or an opted-in PostgreSQL integration suite.** Docker is not required for any other step, and there is no reason to leave it running afterwards.

### Deployment and flag matrix

**Environment-variable changes affect only deployments created after the change.** A running deployment holds the values it was built and bound with; editing a variable in the Vercel dashboard does nothing until something redeploys. Correspondingly, **Instant Rollback restores the target deployment together with its original environment variables** — it does not re-bind current values onto an old build. This cuts both ways and is the single most important operational fact in this section: rolling back to a deployment that was built with a flag set restores that flag.

| State                         | Deployment                         | Commit     | Capture | Delivery | Reminder | Scheduler jobs                            | Valid rollback target                                                                                                                         |
| ----------------------------- | ---------------------------------- | ---------- | ------- | -------- | -------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **D0** Current production     | `dpl_7vmnL71Lck7JLeftgsJkYVJ4uw82` | `8588c5d`  | absent  | absent   | absent   | Gmail poll, suggestions                   | Yes, until A8 migrations are applied — after that it serves pre-A8 code against a migrated schema, which is harmless but has no A8.6 surfaces |
| **D1** Disabled-feature A8.6c | new                                | A8.6c HEAD | absent  | absent   | absent   | Gmail poll, suggestions                   | **Yes — the designated safe harbour**                                                                                                         |
| **D2** Capture-only           | new                                | A8.6c HEAD | `true`  | absent   | absent   | Gmail poll, suggestions                   | Yes                                                                                                                                           |
| **D3** Delivery rehearsal     | new                                | A8.6c HEAD | absent  | `true`   | absent   | Gmail poll, suggestions                   | No — exists only for the zero-send rehearsal                                                                                                  |
| **D4** Capture + delivery     | new                                | A8.6c HEAD | `true`  | `true`   | absent   | + notification job (after the Gmail gate) | Yes                                                                                                                                           |
| **D5** All three flags        | new                                | A8.6c HEAD | `true`  | `true`   | `true`   | + reminder job                            | Yes                                                                                                                                           |

Rules that follow from the binding model:

- **D1 is the safe-harbour configuration**: the current code with every A8 feature inert. Returning to it is the containment action for almost everything below.
- **Reaching D1 later may require a fresh deployment rather than Instant Rollback.** On the **Hobby** plan, rollback may only reach the **immediately previous** deployment. Once D2 and D3 exist, D1 is two or three steps back and is no longer reachable by rollback at all. Plan on unsetting the variables and redeploying.
- **Rollback does not disable external scheduler jobs.** cron-job.org keeps calling the endpoints; the endpoints simply become inert again because the rolled-back build has no flags. If the intent is to stop invocation, **pause the job** — that is a separate action in a separate system.
- **Rolling back does not undo a migration.** Schema is forward-only.
- **Rolling back does not unsend an email.**

### Migration failure model (A8.7)

Stated precisely, because the wrong mental model here produces exactly the wrong recovery action.

- **No A8 migration contains an explicit `BEGIN` or `COMMIT`.** This was verified across all nine files.
- `prisma migrate deploy` applies **pending files sequentially**, recording each in `_prisma_migrations` as it completes.
- **No transaction spans migration files.** A failure in file 5 leaves files 1–4 applied and committed.
- PostgreSQL **may** treat a multi-statement query message as an implicit transaction block, so a multi-statement file **might** roll back as a unit. **The runbook does not rely on that.** It is emergent behaviour of statement grouping in a driver, not a property this repository establishes or tests, and three migration file headers make a claim about transaction grouping that is [explicitly corrected above](#database-migrations).
- **After any failure, inspect the physical schema.** What is actually present is the only authority.
- **Never call `migrate resolve` on the strength of the `_prisma_migrations` row alone.** That row records what Prisma believes, and the whole reason you are reading this is that Prisma's belief and the database disagree.

The accurate description of the operation is:

> One ordered `prisma migrate deploy` invocation, applying pending migration files sequentially with per-file recording and no guaranteed cross-file or per-file atomicity.

**Do not describe the nine migrations as an atomic unit**, in evidence, in a ticket, or to yourself at 2 a.m.

### Per-migration recovery decision tree

The nine pending migrations, in application order. All nine are additive; none drops anything.

**The three physical-state classifications**, which every entry below uses:

| Classification   | Meaning                                       | Standing rule                                                                                                 |
| ---------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **None present** | No object the failed migration creates exists | Resolving as **rolled back** may be appropriate **after the cause is corrected**                              |
| **All present**  | Every object exists and is correct            | Resolving as **applied** may be considered **only after proving the end state exactly matches the migration** |
| **Some present** | A partial application                         | **Stop and escalate**, unless an entry below describes an explicitly reviewed recovery for that exact state   |

`migrate resolve --applied` is the dangerous one throughout: it tells Prisma to stop trying, permanently, and every later migration then runs against a schema nobody re-verified.

**Escalation condition, common to all nine:** any state not exactly matching a case below, any doubt about which case applies, or any temptation to "just drop it and re-run" — stop, record the physical state, and get a second reviewer. Production holds no A8 rows, so **waiting costs nothing**. There is no partial state below whose remedy is urgent.

---

**1. `20260731040000_a8_reminder_persistence` — 25 statements. ⚠ Strongest warning: this is the only migration that touches the live `tasks` table.**

Creates six enum types, adds `tasks.due_local_date VARCHAR(10)` (nullable) with a canonical-format CHECK, creates `task_reminder_schedules` and `reminder_delivery_attempts` with their constraints and nine indexes, and enables RLS on both.

- **Idempotency:** **Not idempotent.** The `CREATE TYPE` and `CREATE TABLE` statements carry no `IF NOT EXISTS`; re-running against a partial state fails on the first object that already exists.
- **Likely failure points:** the `ALTER TABLE "tasks"` statements, which take an `ACCESS EXCLUSIVE` lock on the busiest table in the system. A lock wait, a statement timeout, or a pooler disconnect mid-file is the realistic failure. Everything after that point is new-table work that cannot block on anything.
- **Detection:** run Q5, Q6, Q7, and Q8. Specifically: does `tasks.due_local_date` exist and is it nullable; do the two tables exist; do all six enum types exist.
- **Clean re-execution safe?** Only from **none present**.
- **None present:** correct the cause (usually: retry outside the lock contention window after re-running the [long-running transaction check](#stage-3--long-running-transaction-inspection-a87b) and the [lock probe](#stage-4--out-of-band-tasks-lock-probe-a87b)), `migrate resolve --rolled-back`, re-run `migrate deploy`.
- **All present:** prove it — six enum types, the column with its CHECK, both tables, all nine indexes, RLS on both — then `migrate resolve --applied` may be considered. Given 25 statements, "all present" after a failure is unlikely; suspect **some present** first.
- **Some present:** **stop and escalate.** The plausible partial here is enum types created and `tasks` altered but one or both tables missing. **Do not hand-create the tables.** A table built by hand will differ from the migration in some constraint nobody notices until a worker violates it.
- **Corrective migration required when:** the partial state is deliberately kept — which for this migration it should not be, because nothing depends on it yet.

---

**2. `20260731170000_a8_3b_reminder_concurrency` — 3 statements.**

Adds `task_reminder_schedules.reminder_version INTEGER NOT NULL DEFAULT 1` and two CHECK constraints: `task_reminder_schedules_reminder_version_positive` and `task_reminder_schedules_suspended_has_no_next_occurrence`.

- **Idempotency:** **Not idempotent** — no `IF NOT EXISTS` on the column, no guard on the constraints.
- **Likely failure points:** essentially none in Production, where the table is empty and freshly created. The constraint validation scans zero rows.
- **Detection:** Q10 for the column; Q11 for the two constraint names.
- **Clean re-execution safe?** From **none present**, yes.
- **None present:** `migrate resolve --rolled-back`, re-run.
- **All present:** `migrate resolve --applied` is defensible here, because the end state is three easily-enumerated objects.
- **Some present:** the realistic partial is column-present-constraints-absent. **Escalate**; the reviewed remedy is a corrective migration adding only the missing constraints, not hand-executed DDL.

---

**3. `20260731230000_a8_advance_waiting_skip` — 1 statement.**

`ALTER TYPE "ReminderAdvanceDisposition" ADD VALUE IF NOT EXISTS 'skipped_waiting_elapsed'`.

- **Idempotency:** **Fully idempotent** (`IF NOT EXISTS`).
- **Likely failure points:** only a connection loss. A single-statement file cannot be partially applied.
- **Detection:** Q12 with the value name.
- **Clean re-execution safe?** **Yes, unconditionally.** Re-running is a no-op if the value is present.
- **None present:** `migrate resolve --rolled-back`, re-run.
- **All present:** re-running is a safer choice than `migrate resolve --applied`, and costs nothing.
- **Some present:** **not reachable** — one statement, one object.

---

**4. `20260801120000_a8_4a_worker_safety` — 18 statements, and one of them is a backfill.**

Adds four enum values to `ReminderAdvanceDisposition`; adds five columns to `reminder_delivery_attempts`; runs `UPDATE "reminder_delivery_attempts" SET "claim_sequence" = 1 WHERE "claimed_by" IS NOT NULL`; adds nine CHECK constraints on `reminder_delivery_attempts` and one on `task_reminder_schedules`; creates `reminder_delivery_attempts_expired_claim_idx` and `task_reminder_schedules_due_scan_idx`.

- **Idempotency:** **Mixed.** The four `ALTER TYPE` statements are `IF NOT EXISTS`; nothing else is. The backfill is idempotent by construction (setting 1 where it is already 1 changes nothing).
- **Likely failure points:** constraint addition, because each constraint is validated against existing rows as it is added. In Production the table is empty, so this is a theoretical risk here and a real one anywhere with data.
- **Detection:** Q10 for the five columns; Q11 for the ten constraint names; Q12 for the four enum values; Q13 for the two indexes.
- **Clean re-execution safe?** From **none present**, yes.
- **None present:** `migrate resolve --rolled-back`, re-run.
- **All present:** twenty-plus objects to enumerate. Prove every one before considering `migrate resolve --applied`; if the enumeration is tedious, that is the point.
- **Some present:** **stop and escalate.** The likely partial is columns present with some constraints missing, which leaves the fencing invariant unenforced while looking healthy.

---

**5. `20260802094500_a8_4a_settlement_marker` — 6 statements, and the one migration with an unvalidated-constraint state.**

Adds `reminder_delivery_attempts.schedule_settled_at`; backfills it on non-`claimed` rows; adds `reminder_delivery_attempts_settlement_only_when_terminal` as **`NOT VALID`** and then **validates it in a separate statement**; creates `reminder_delivery_attempts_unsettled_idx` and `reminder_delivery_attempts_retry_budget_idx`.

- **Idempotency:** **Not idempotent.** The backfill is (it is a `WHERE`-scoped assignment of a constant), but the DDL is not.
- **Likely failure points:** the split between `ADD CONSTRAINT ... NOT VALID` and `VALIDATE CONSTRAINT` — a failure between the two leaves a constraint that **exists but is not validated**, which every naive existence check reports as present.
- **Detection:** **Q11 is not sufficient for this migration. Use Q14**, which reads `pg_constraint.convalidated`. A row with `convalidated = false` means the constraint is enforced for new writes but was never checked against existing rows.
- **Clean re-execution safe?** From **none present**, yes.
- **None present:** `migrate resolve --rolled-back`, re-run.
- **All present** — and for this migration "all present" **requires `convalidated = true`** — `migrate resolve --applied` may be considered.
- **Some present, specifically the constraint present with `convalidated = false`:** this is the one state with a reviewed manual completion. `ALTER TABLE "reminder_delivery_attempts" VALIDATE CONSTRAINT "reminder_delivery_attempts_settlement_only_when_terminal";` finishes exactly what the migration would have done, takes only `SHARE UPDATE EXCLUSIVE`, and is why the migration was written as a split in the first place. Re-verify with Q14, then treat the state as **all present**. **Any other partial: escalate.**
- **One standing caveat, carried from the migration's own header:** the backfill is a statement of fact only for a database whose rows were written by post-fix code. Production has no such rows and cannot acquire any before this migration is applied. **If these migrations are ever applied to a database that has already run pre-fix worker code, narrow the backfill to `outcome = 'success'` before applying** — afterwards the evidence is gone.

---

**6. `20260802173000_a8_4b1_capability_skip_reason` — 1 statement.**

`ALTER TYPE "ReminderSkipReason" ADD VALUE IF NOT EXISTS 'no_actionable_capability'`.

- **Idempotency:** **Fully idempotent.** Detection Q12. Re-run rather than resolve. **Some present** is not reachable.

---

**7. `20260802210000_a8_4b2_repeated_ambiguous_stop_reason` — 1 statement.**

`ALTER TYPE "ReminderScheduleStopReason" ADD VALUE IF NOT EXISTS 'repeated_ambiguous_outcomes'`.

- **Idempotency:** **Fully idempotent.** Detection Q12. Re-run rather than resolve. **Some present** is not reachable.

---

**8. `20260803090000_a8_4b3_advance_due_scan_index` — 1 statement.**

`CREATE INDEX IF NOT EXISTS "task_reminder_schedules_advance_due_scan_idx"` — a partial index on `("advance_occurrence_at", "id")`.

- **Idempotency:** **Fully idempotent.**
- **Likely failure points:** the index build takes a write lock on `task_reminder_schedules`. Empty in Production, so instantaneous.
- **Detection:** Q13.
- **Clean re-execution safe?** Yes. **If this ever runs against a populated table**, build it manually with `CREATE INDEX CONCURRENTLY` and let the `IF NOT EXISTS` turn the migration into a no-op.
- **Some present:** a failed index build can leave an **invalid** index. Q13 reports `indisvalid`; an invalid index must be dropped before rebuilding.

---

**9. `20260803120000_a8_5a_owner_notification_intents` — 28 statements.**

Creates five enum types and two tables — `owner_notification_intents` and `owner_notification_attempts` — with one foreign key, all CHECK constraints, five indexes, and RLS on both.

- **Idempotency:** **Not idempotent.** No `IF NOT EXISTS` anywhere.
- **Likely failure points:** none involving existing data — it alters no existing table and backfills nothing. A failure here is a connection loss or a name collision.
- **Detection:** Q7 for the tables, Q9 for RLS, Q11 for constraints, Q12 for the five enum types, Q13 for the indexes.
- **Clean re-execution safe?** From **none present**, yes.
- **None present:** `migrate resolve --rolled-back`, re-run.
- **All present:** enumerate everything, including **RLS on both tables**, before considering `migrate resolve --applied`. RLS is the assertion most likely to be quietly missing, and the one whose absence is least visible.
- **Some present:** **stop and escalate.** The dangerous partial is tables present with RLS **not** enabled: deny-by-default is the only thing standing between these tables and the anon key.

### Production preflight and verification SQL

**Read-only. None of it is executed in A8.7a.** Run from the Supabase SQL editor or `psql` with least privilege. Do not paste row contents containing PII into evidence — record counts and booleans.

| ID      | Query                                                                                                                                                                                                                                                                                                                                                                                                                                                         | When                                                         | Expected                                                                                                             | Stop/go                                                                                                                                                 | Evidence field                        |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| **Q1**  | `SELECT count(*) FROM tasks;`                                                                                                                                                                                                                                                                                                                                                                                                                                 | Preflight, before migration                                  | A small number consistent with production usage                                                                      | Go on any value; a wildly unexpected count means stop and understand why before taking an `ACCESS EXCLUSIVE` lock on it                                 | `tasks.count.before`                  |
| **Q2**  | `SELECT migration_name, started_at, finished_at, rolled_back_at, applied_steps_count FROM _prisma_migrations ORDER BY started_at;`                                                                                                                                                                                                                                                                                                                            | Preflight, and after every migration attempt                 | Pre-A8 migrations finished; **no A8 rows** before, all nine finished after                                           | Stop if any pre-existing row is unfinished                                                                                                              | `migrations.status.before` / `.after` |
| **Q3**  | `SELECT migration_name, started_at, finished_at, rolled_back_at, logs FROM _prisma_migrations WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL;`                                                                                                                                                                                                                                                                                                       | Preflight, and immediately after any failure                 | **Zero rows**                                                                                                        | **Any row is a hard stop.** Go to the recovery tree                                                                                                     | `migrations.failed_rows`              |
| **Q4**  | `SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND state <> 'idle' AND pid <> pg_backend_pid();` plus `SELECT pid, state, now() - xact_start AS xact_age, left(query, 80) FROM pg_stat_activity WHERE datname = current_database() AND xact_start IS NOT NULL AND pid <> pg_backend_pid() ORDER BY xact_start;`                                                                                                                    | Immediately before migration                                 | No `idle in transaction`; no transaction older than 30 s                                                             | **Stop** on any `idle in transaction`, any transaction older than 30 s, or any session whose source is unclear                                          | `preflight.transactions`              |
| **Q5**  | `SELECT column_name, is_nullable, data_type FROM information_schema.columns WHERE table_name = 'tasks' AND column_name = 'due_local_date';`                                                                                                                                                                                                                                                                                                                   | Before and after migration                                   | Before: zero rows. After: one row, `is_nullable = 'YES'`                                                             | Stop if it is `NO` after — that would mean a different migration ran                                                                                    | `schema.due_local_date`               |
| **Q6**  | `SELECT count(*) FROM tasks WHERE due_local_date IS NOT NULL;`                                                                                                                                                                                                                                                                                                                                                                                                | After migration                                              | **Exactly 0**                                                                                                        | **Any non-zero value is a hard stop**: D109 requires that no historical Task auto-activates a reminder, and a non-zero count means something backfilled | `schema.due_local_date.nonnull`       |
| **Q7**  | `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('task_reminder_schedules','reminder_delivery_attempts','owner_notification_intents','owner_notification_attempts') ORDER BY table_name;`                                                                                                                                                                                                                   | Before and after migration                                   | Before: zero rows. After: **all four**                                                                               | Stop on any count other than 0 or 4                                                                                                                     | `schema.tables`                       |
| **Q8**  | `SELECT count(*) FROM task_reminder_schedules; SELECT count(*) FROM reminder_delivery_attempts; SELECT count(*) FROM owner_notification_intents; SELECT count(*) FROM owner_notification_attempts;`                                                                                                                                                                                                                                                           | After migration                                              | **0, 0, 0, 0**                                                                                                       | **Any non-zero is a hard stop** — the tables are new and nothing has written to them                                                                    | `schema.rowcounts.after`              |
| **Q9**  | `SELECT relname, relrowsecurity FROM pg_class WHERE relname IN ('task_reminder_schedules','reminder_delivery_attempts','owner_notification_intents','owner_notification_attempts');`                                                                                                                                                                                                                                                                          | After migration                                              | Four rows, `relrowsecurity = true` on every one                                                                      | **Any `false` is a hard stop** — deny-by-default RLS is the boundary                                                                                    | `schema.rls`                          |
| **Q10** | `SELECT table_name, column_name FROM information_schema.columns WHERE table_name IN ('task_reminder_schedules','reminder_delivery_attempts') AND column_name IN ('reminder_version','claim_expires_at','claim_sequence','provider_call_started_at','provider_accepted_at','provider_message_ref','schedule_settled_at') ORDER BY 1, 2;`                                                                                                                       | After migration, or on failure                               | All seven present on their respective tables                                                                         | Stop on any absence                                                                                                                                     | `schema.columns`                      |
| **Q11** | `SELECT conname, convalidated FROM pg_constraint WHERE conrelid::regclass::text IN ('task_reminder_schedules','reminder_delivery_attempts','owner_notification_intents','owner_notification_attempts') ORDER BY 1;`                                                                                                                                                                                                                                           | After migration, or on failure                               | Every named constraint from the recovery tree present                                                                | Stop on any absence                                                                                                                                     | `schema.constraints`                  |
| **Q12** | `SELECT t.typname, e.enumlabel FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid WHERE t.typname IN ('ReminderScheduleStatus','ReminderScheduleStopReason','ReminderAdvanceDisposition','ReminderOccurrenceKind','ReminderDeliveryOutcome','ReminderSkipReason','OwnerNotificationEventType','OwnerNotificationSubjectKind','OwnerNotificationState','OwnerNotificationSuppressionReason','OwnerNotificationAttemptOutcome') ORDER BY 1, e.enumsortorder;` | After migration, or on failure                               | All eleven types, including `skipped_waiting_elapsed`, `no_actionable_capability`, and `repeated_ambiguous_outcomes` | Stop on any missing value                                                                                                                               | `schema.enums`                        |
| **Q13** | `SELECT i.relname, x.indisvalid FROM pg_index x JOIN pg_class i ON i.oid = x.indexrelid JOIN pg_class t ON t.oid = x.indrelid WHERE t.relname IN ('task_reminder_schedules','reminder_delivery_attempts','owner_notification_intents','owner_notification_attempts') ORDER BY 1;`                                                                                                                                                                             | After migration, or on failure                               | Every named index present with `indisvalid = true`                                                                   | **Stop on `indisvalid = false`** — an invalid index must be dropped before rebuilding                                                                   | `schema.indexes`                      |
| **Q14** | `SELECT conname, convalidated FROM pg_constraint WHERE conname = 'reminder_delivery_attempts_settlement_only_when_terminal';`                                                                                                                                                                                                                                                                                                                                 | After migration 5, or on its failure                         | One row, `convalidated = true`                                                                                       | `convalidated = false` is the reviewed manual-completion case in the recovery tree, **not** a resolve-as-applied case                                   | `schema.settlement_constraint`        |
| **Q15** | `SELECT count(*) FILTER (WHERE occurred_at > now() - interval '1 hour') AS under_1h, count(*) FILTER (WHERE occurred_at <= now() - interval '1 hour' AND occurred_at > now() - interval '24 hours') AS h1_to_24, count(*) FILTER (WHERE occurred_at <= now() - interval '24 hours') AS over_24h FROM owner_notification_intents WHERE state = 'pending';`                                                                                                     | Capture observation; before every notification invocation    | Whatever capture produced; **exactly the expected value before a canary**                                            | See the individual canary stages — the thresholds differ                                                                                                | `notifications.pending.buckets`       |
| **Q16** | `SELECT count(*) FROM owner_notification_intents WHERE state = 'claimed' AND claim_expires_at < now();`                                                                                                                                                                                                                                                                                                                                                       | Notification steady state                                    | **0**                                                                                                                | Non-zero over consecutive observations means claims are being abandoned — stop and investigate before widening                                          | `notifications.stale_claims`          |
| **Q17** | `SELECT count(*) FROM reminder_delivery_attempts WHERE outcome = 'claimed' AND claim_expires_at < now();`                                                                                                                                                                                                                                                                                                                                                     | Reminder steady state                                        | **0**                                                                                                                | Same rule as Q16                                                                                                                                        | `reminders.stale_claims`              |
| **Q18** | `SELECT count(*) FROM (SELECT organization_id, event_type, subject_kind, subject_id, occurrence_key, count(*) FROM owner_notification_intents GROUP BY 1,2,3,4,5 HAVING count(*) > 1) d;` and `SELECT count(*) FROM (SELECT schedule_id, generation, occurrence_kind, occurrence_local_date, count(*) FROM reminder_delivery_attempts GROUP BY 1,2,3,4 HAVING count(*) > 1) d;`                                                                               | After each canary; steady state                              | **0 and 0**                                                                                                          | **Any duplicate is a hard stop.** Unique indexes should make this impossible, so a non-zero result means an assumption is wrong                         | `idempotency.duplicates`              |
| **Q19** | `SELECT count(*) FROM task_reminder_schedules WHERE status = 'active';`                                                                                                                                                                                                                                                                                                                                                                                       | Reminder preflight; before the reminder canary               | Reminder preflight: **0**. Before the canary: **exactly 1**                                                          | **Any other value before the canary is a hard stop**                                                                                                    | `reminders.active_schedules`          |
| **Q20** | `SELECT count(*) FROM task_reminder_schedules WHERE status = 'active' AND ((next_overdue_occurrence_at IS NOT NULL AND next_overdue_occurrence_at <= now()) OR (advance_disposition = 'scheduled' AND advance_occurrence_at <= now()));`                                                                                                                                                                                                                      | Burst preview, immediately before enabling reminder delivery | **Exactly 1** for the canary                                                                                         | **Any value above 1 is a hard stop** — that is the burst this canary exists to prevent                                                                  | `reminders.due_occurrences`           |
| **Q21** | `SELECT count(*) FROM task_capabilities WHERE status = 'active' AND expires_at <= now();`                                                                                                                                                                                                                                                                                                                                                                     | Before enabling capture; before the notification canary      | Before capture: informational. **Before the canary: 0**                                                              | **Non-zero before the canary is a hard stop** — the expiry sweep would create up to fifty additional intents in the same invocation                     | `capabilities.expiry_due`             |

### Stage runbook

Twenty-one stages. Each uses the same seven headings, and no heading is omitted — where a heading does not apply, it says so.

---

#### Stage 1 — Production preflight (A8.7b)

**Preconditions.** A8.7a is architecture-approved and committed. A8.7b is separately authorized. Repository HEAD matches the reviewed commit. The [repository-non-mutating preflight](#1-repository-non-mutating-preflight) is green. Nobody else is operating on production.

**Execution.** Run Q1, Q2, Q3 read-only. Record the current deployment ID, commit, and the effective value of all three flags from the Vercel dashboard.

**Verification.** Q1 returns a plausible count. Q2 shows the pre-A8 migrations finished and **no A8 rows**. Q3 returns zero rows. All three flags read as absent.

**Stop/go criteria.** **Stop** if Q3 returns any row; if any A8 migration is already recorded; or if any A8 flag is set. Go otherwise.

**Immediate containment.** Not applicable — nothing has been changed.

**Recovery or rollback.** Not applicable — nothing has been changed.

**Evidence to record.** `tasks.count.before`, `migrations.status.before`, `migrations.failed_rows`, deployment ID, commit, three flag values.

---

#### Stage 2 — Migration connection verification (A8.7b)

**Preconditions.** Stage 1 passed. The operator has the session-mode connection string from the Supabase Connect dialog, copied whole.

**Execution.** Apply the three checks in [Migration endpoint verification](#migration-endpoint-verification): hostname form, port `5432`, no `pgbouncer=true`. Then run the advisory-lock session test. Load the credential with the `read -rs` pattern from [Secure migration-command handling](#secure-migration-command-handling). Inspect what `packages/db/.env` currently points at.

**Verification.** Host is `aws-<region>.pooler.supabase.com`. Port is `5432`. No `pgbouncer=true`. The advisory-lock test observes its own lock. `DATABASE_URL="$MIGRATE_URL" pnpm --filter @aicaa/db migrate:status` connects and lists the nine as pending.

**Stop/go criteria.** **Stop** if the port is `6543`; if the host is the `db.<project-ref>.supabase.co` form; if `pgbouncer=true` appears; or if `migrate:status` reports anything other than exactly nine pending migrations.

**Immediate containment.** `unset MIGRATE_URL`. No schema change has occurred; `migrate status` is read-only.

**Recovery or rollback.** Not applicable — nothing has been changed.

**Evidence to record.** Redacted hostname form, port, session-mode confirmation, advisory-lock test result, the nine pending migration names, and **an explicit confirmation that the credential itself was not recorded**.

---

#### Stage 3 — Long-running transaction inspection (A8.7b)

**Preconditions.** Stage 2 passed. This runs **immediately** before the migration — a check from ten minutes ago is not evidence about now.

**Execution.** Run Q4.

**Verification.** No session in `idle in transaction`. No transaction with `xact_age` over 30 seconds. Every remaining session's source is identifiable.

**Stop/go criteria.** **Stop** on any `idle in transaction`, any transaction older than 30 s, or any session you cannot account for. Migration 1 takes an `ACCESS EXCLUSIVE` lock on `tasks`; a lock request queues **behind** existing holders and **blocks everything arriving after it**, so a single forgotten open transaction converts a fast migration into a production-wide stall on the busiest table.

**Immediate containment.** **Do not terminate an unknown backend.** Wait for it to clear, or postpone.

**Recovery or rollback.** Not applicable — nothing has been changed.

**Evidence to record.** `preflight.transactions` — the count and, for anything notable, the age and the truncated query.

---

#### Stage 4 — Out-of-band `tasks` lock probe (A8.7b)

**Preconditions.** Stage 3 passed. A `psql` session on the same database.

**Execution.**

```sql
SET lock_timeout = '5s';
BEGIN;
LOCK TABLE tasks IN ACCESS EXCLUSIVE MODE;
ROLLBACK;
```

**This probe acquires the same lock class the migration needs, changes no schema and no data, and is rolled back immediately.** It answers one question: can that lock be taken right now, quickly?

**Why this instead of a `lock_timeout` on the migration.** Every direct route is unavailable or unsound: `SET lock_timeout` in a **separate** `psql` session governs only that session and cannot reach Prisma's; `PGOPTIONS` is not read by the Node driver Prisma uses; a Shared Pooler is not guaranteed to preserve arbitrary startup `options` through to the backend; **editing the existing migration** changes its checksum and breaks `migrate deploy` on every database that already applied it; and a **later** migration cannot protect an earlier one, since it runs after the lock has already been taken. The probe plus Stage 3 plus Stage 5 achieve operationally what the timeout would have achieved declaratively.

**Verification.** The `LOCK` returns promptly and the `ROLLBACK` completes.

**Stop/go criteria.** **A timeout means postpone the migration.** Do not retry in a loop; return to Stage 3 and find out what is holding the table.

**Immediate containment.** The `ROLLBACK` is the containment; it is part of the procedure rather than a response to failure. If the session is interrupted between `BEGIN` and `ROLLBACK`, end the session — disconnecting releases the lock.

**Recovery or rollback.** Not applicable — the transaction is rolled back by design.

**Evidence to record.** `lock_probe.result` — acquired promptly, or timed out with the wait duration.

---

#### Stage 5 — Scheduler pause (A8.7b)

**Preconditions.** Stage 4 passed. Access to the cron-job.org account.

**Execution.** **Pause** the Gmail-poll job and the suggestion-processing job. Confirm both show as paused. Note the pause time.

**Do not rotate `CRON_SECRET`.** Rotation would fail the jobs closed, which sounds equivalent and is not: it changes a shared credential four endpoints depend on, in the middle of a schema change, and creates a second recovery obligation.

**Verification.** Both jobs paused in the scheduler UI. No execution appears after the pause time.

**Stop/go criteria.** **Stop** if either job cannot be paused. Go once both are confirmed paused.

**Immediate containment.** Not applicable — pausing is itself the containment posture.

**Recovery or rollback.** Resume both jobs. They are resumed in Stage 10, after smoke verification.

**Evidence to record.** `schedulers.paused` — both job names, the pause timestamp, and confirmation of no execution afterwards.

---

#### Stage 6 — Migration application (A8.7b)

**Preconditions.** Stages 1–5 passed, **all of them, in this window**. `MIGRATE_URL` is loaded. The recovery tree has been read, not skimmed.

**Execution.**

```bash
DATABASE_URL="$MIGRATE_URL" pnpm --filter @aicaa/db migrate:status
DATABASE_URL="$MIGRATE_URL" pnpm --filter @aicaa/db migrate:deploy
DATABASE_URL="$MIGRATE_URL" pnpm --filter @aicaa/db migrate:status
```

Keep the full console output. It is the primary evidence of which file failed, if one does.

**Verification.** The final `migrate:status` reports the database schema up to date with **all nine** applied. Q2 shows nine finished rows. Q3 returns zero rows.

**Stop/go criteria.** **Stop on any non-zero exit.** Do not re-run. Go to Stage 7. **An advisory-lock acquisition timeout is also a stop** — see the rule in [Secure migration-command handling](#secure-migration-command-handling): confirm no failed migration row and no partial physical state before retrying.

**Immediate containment.** The scheduler jobs are already paused and no deployment has changed, so the application continues serving pre-A8 code that cannot observe any of this. **Do not deploy anything while a migration failure is unresolved.**

**Recovery or rollback.** **There is no rollback.** Migrations are forward-only. Go to Stage 7 and classify.

**Evidence to record.** `migrations.status.after`, the nine applied names, the full command output with the connection string redacted, and the wall-clock duration.

---

#### Stage 7 — Failed-migration classification and recovery (A8.7b, only on failure)

**Preconditions.** Stage 6 failed. **This stage is skipped entirely on success.**

**Execution.** Identify the failing file from the console output and from Q3. Look it up in the [per-migration recovery decision tree](#per-migration-recovery-decision-tree). Run that entry's detection queries. Classify the physical state as **none present**, **all present**, or **some present**. Apply only the action that entry authorizes for that state.

**Verification.** The classification is supported by query output, not by inference from `_prisma_migrations`. If a `migrate resolve` was used, the following `migrate:status` reflects the intended state and a subsequent `migrate deploy` proceeds cleanly.

**Stop/go criteria.** **Stop and escalate** on **some present**, unless that migration's entry describes a reviewed recovery for that exact state — which, across all nine, is only migration 5's unvalidated constraint. **Stop** if the classification is uncertain. Production holds no A8 rows and nothing depends on these tables, so **there is no cost to waiting for a second reviewer**.

**Immediate containment.** Schedulers stay paused. No deployment. No flag changes. Do not clean up by hand.

**Recovery or rollback.** As authorized by the specific entry: `migrate resolve --rolled-back` after correcting the cause for **none present**; `migrate resolve --applied` only after proving the end state matches, for **all present**; the single reviewed `VALIDATE CONSTRAINT` for migration 5's unvalidated case; a corrective migration where the entry calls for one.

**Evidence to record.** The failing migration name, the full error, every detection query result, the classification, the action taken and its authorization, and the post-action `migrate:status`.

---

#### Stage 8 — Post-migration schema verification (A8.7b)

**Preconditions.** Stage 6 succeeded, or Stage 7 completed with an authorized recovery and a clean `migrate deploy`.

**Execution.** Run Q5, Q6, Q7, Q8, Q9, Q10, Q11, Q12, Q13, Q14. Re-run Q1.

**Verification.** `tasks.due_local_date` exists and is nullable. **Q6 returns exactly 0.** All four tables exist. All four row counts are 0. RLS is `true` on all four. Every named column, constraint, index, and enum value is present. Q13 shows every index `indisvalid`. Q14 shows `convalidated = true`. Q1 is unchanged from Stage 1.

**Stop/go criteria.** **Q6 non-zero is a hard stop** — D109 requires that no historical Task auto-activates a reminder, and a non-null `due_local_date` on a historical Task is exactly that failure. **Any RLS `false` is a hard stop.** **Any non-zero row count in Q8 is a hard stop.** **Any `indisvalid = false` is a hard stop.** **Any change in Q1 is a hard stop** — the migration must not have touched a row.

**Immediate containment.** Schedulers stay paused; do not deploy.

**Recovery or rollback.** Forward-only. A missing object is a corrective-migration decision, not a hand-patch. A non-zero Q6 requires understanding the source before any correction — do not simply null the column.

**Evidence to record.** `schema.*` for every query above, and `tasks.count.after` alongside `tasks.count.before`.

---

#### Stage 9 — Deployment with all A8 flags absent (A8.7b)

**Preconditions.** Stage 8 passed. **Verified in the Vercel dashboard: `ENABLE_OWNER_EVENT_CAPTURE`, `ENABLE_OWNER_EVENT_DELIVERY`, and `ENABLE_REMINDER_DELIVERY` are all absent from Production.** `pnpm verify` is green on the commit being deployed — run before the window, not during it.

**Execution.** Deploy the A8.6c commit to Production by the project's normal path. Record the new deployment ID. This produces state **D1**, the safe harbour.

**Verification.** The deployment reports Ready. The new deployment ID and commit are recorded. All three flags still read as absent.

**Stop/go criteria.** **Stop** if any flag is set — a deployment built with a flag set carries it permanently and becomes an unsafe rollback target. **Stop** if the build fails. Go on Ready with all three absent.

**Immediate containment.** Roll back to `dpl_7vmnL71Lck7JLeftgsJkYVJ4uw82` (**D0**). It is one step back and therefore reachable on Hobby. It serves pre-A8 code against a migrated schema, which is inert but has no A8.6 surfaces.

**Recovery or rollback.** As above. Note that rollback does **not** unapply migrations, and does **not** resume the paused schedulers.

**Evidence to record.** New deployment ID, commit, build result, three flag values read after deployment.

---

#### Stage 10 — Application smoke verification (A8.7b)

**Preconditions.** Stage 9 deployed successfully.

**Execution.** With an authenticated Owner session, exercise `GET /api/v1/session`, `GET /api/v1/tasks`, the Owner `/tasks` list, one Task detail page, and **`/attention`** — the page that has been failing to its error boundary and is the reason the migrations were applied. Then **resume the Gmail-poll and suggestion-processing scheduler jobs** and confirm one execution of each succeeds.

**Verification.** `/api/v1/session` returns `200` with `role = owner` and `organizationId = axford`. `/api/v1/tasks` returns a cursor page. Task detail renders, and its reminder panel truthfully reports no schedule. **`/attention` renders with two empty sections rather than reaching its error boundary.** Both scheduler jobs execute successfully. A `GmailSyncRun` row appears with `trigger = cron`.

**Stop/go criteria.** **Stop** if `/attention` still errors — that means a migration did not take effect despite Stage 8. **Stop** if either scheduler job fails after resuming. **Stop** if the Task detail reminder panel shows anything other than "no schedule".

**Immediate containment.** Re-pause the schedulers and roll back to **D0**.

**Recovery or rollback.** Roll back to **D0**; investigate; re-deploy when understood. The schema stays.

**Evidence to record.** Each smoke result, both scheduler resume confirmations, the `GmailSyncRun` trigger value, and the observation that both `/attention` sections are empty.

**A8.7b ends here.** A8.7c requires separate authorization.

---

#### Stage 11 — Owner-event capture enablement (A8.7c)

**Preconditions.** A8.7b complete and reviewed. A8.7c authorized. Q8 confirms all four A8 tables still hold zero rows. Q21 recorded for reference.

**Execution.** Set `ENABLE_OWNER_EVENT_CAPTURE=true` in Vercel **Production only** — the exact lowercase string. Redeploy so the value binds. This produces state **D2**.

**Verification.** The new deployment is Ready. `ENABLE_OWNER_EVENT_DELIVERY` and `ENABLE_REMINDER_DELIVERY` remain absent. The `/attention` page still loads. No notification scheduler job exists.

**Stop/go criteria.** **Stop** if the value is anything other than exactly `true` — `"1"`, `"TRUE"`, and `"yes"` all leave the flag off, and discovering that after an hour of "observation" wastes the window. **Stop** if either other flag became set.

**Immediate containment.** Unset the variable and redeploy. Capture writes intents and audit rows; it contacts nothing, so there is no urgency, but a runaway capture is stopped by unsetting.

**Recovery or rollback.** **D1** is one deployment back and reachable by Instant Rollback at this point. Intents already captured remain, and are harmless: an intent older than 24 hours terminalizes as suppressed without contacting anything.

**Evidence to record.** New deployment ID, the exact flag value set, the other two flags confirmed absent, and the four row counts immediately before enabling.

---

#### Stage 12 — Capture-only observation (A8.7c)

**Preconditions.** Stage 11 complete. **No notification scheduler job exists and none may be created during this stage.**

**Execution.** Observe for the authorized window while normal Owner and Recipient activity proceeds. Run Q15 and Q8 at the start, at intervals, and at the end. Do **not** invoke `POST /api/v1/internal/notifications/process`. Do not enable delivery.

**Verification.** `owner_notification_intents` accumulates rows whose `event_type` matches events that genuinely occurred. `owner_notification_attempts` stays at **0**. No email is sent — confirm by the attempts count, not by inspecting a mailbox. Intents older than the window begin appearing in Q15's `over_24h` bucket, which is expected and is what the zero-send rehearsal will exercise.

**Stop/go criteria.** **Stop** if `owner_notification_attempts` becomes non-zero — nothing should be delivering. **Stop** if an intent appears whose event did not occur. **Stop** if intent growth is wildly out of proportion to activity. Go when the window closes with attempts at zero.

**Immediate containment.** Unset `ENABLE_OWNER_EVENT_CAPTURE` and redeploy.

**Recovery or rollback.** Return to **D1** by unsetting and redeploying. Captured intents stay and expire into suppression on their own.

**Evidence to record.** `notifications.pending.buckets` at each observation, `owner_notification_attempts` at each observation (expected 0 throughout), the observed event types, and the window duration.

**A8.7c ends here.** A8.7d requires separate authorization, and it is the slice that can send mail.

---

#### Stage 13 — Zero-send Owner-notification rehearsal (A8.7d)

**The point of this stage is to invoke the delivery path in production, for real, and prove it sends nothing.**

**Preconditions.** A8.7c complete and reviewed. A8.7d authorized. **Every pending intent has aged beyond the 24-hour staleness horizon** — confirm with Q15: `under_1h = 0`, `h1_to_24 = 0`, `over_24h` equal to the full pending count. Reaching that state requires capture to have been **off** for over 24 hours, so this stage begins by unsetting capture and waiting.

**Execution.** Set `ENABLE_OWNER_EVENT_DELIVERY=true` and ensure `ENABLE_OWNER_EVENT_CAPTURE` is **absent**. Redeploy — state **D3**. Re-run Q15 to confirm the queue is frozen and entirely stale. Then invoke `POST /api/v1/internal/notifications/process` **exactly once**, manually, with the `CRON_SECRET` bearer.

Capture is off precisely so the queue cannot grow between the check and the invocation. That is what "the queue is frozen" means, and it is why capture and delivery being independent flags matters operationally rather than only architecturally.

**Verification.** The response reports `deliveryEnabled: true`. Every intent transitions from `pending` to a **suppressed** terminal state. `owner_notification_attempts` remains **exactly 0**. **Zero email sends** — confirmed by the attempts count of 0 and by the Gmail mailbox showing no new Rocket-generated message. Q15 afterwards shows `pending = 0`.

**Stop/go criteria.** **Any attempt row is a hard stop.** **Any email is a hard stop** — it means the staleness horizon did not apply and the assumption behind the rehearsal is wrong. **Stop** if any intent remains `pending` or `claimed` after the invocation.

**Immediate containment.** Unset `ENABLE_OWNER_EVENT_DELIVERY` and redeploy immediately. If a message was sent, treat it as the quarantine case in [Stage 15](#stage-15--gmail-custom-header-round-trip-proof-a87d) — an unexpected Rocket-generated message in the Gmail mailbox is an ingestion risk regardless of why it was sent.

**Recovery or rollback.** **D3 is not a valid rollback target and exists only for this stage.** Move forward to Stage 14 or back to **D1** by unsetting both flags and redeploying.

**Evidence to record.** Q15 before and after, the worker response verbatim, the attempts count before and after (0 and 0), the suppression reasons observed, and an explicit statement that no email was sent.

---

#### Stage 14 — Single-notification canary (A8.7d)

**Preconditions.** Stage 13 passed. **Q15 shows `pending = 0` — every intent is terminal.** **Q21 returns 0** — no capability is due for expiry observation, because the capture phase would create up to fifty additional intents in the same invocation and the canary would stop being single-item. Both flags currently absent or being set together in this stage. **No notification scheduler job exists.**

**Execution.** Set `ENABLE_OWNER_EVENT_CAPTURE=true` and `ENABLE_OWNER_EVENT_DELIVERY=true`; redeploy — state **D4**. Perform **exactly one** reviewed, real event that a producer captures — choose the least consequential producer available and record which one, and record any real Task change it causes truthfully. Re-run **Q15 (expect `pending = 1`)** and **Q21 (expect 0)**. Then invoke `POST /api/v1/internal/notifications/process` **exactly once**.

**This canary is single-item by state preparation, not by a batch limit.** The worker's batch is 25. It processes one item because there is exactly one item to process. **Do not add a batch-limit parameter, a production-only bypass, or a test-only query string.**

**Verification.** Exactly **one** claim, **one** attempt row, and **one** send. Q18 returns 0 duplicates. The intent reaches `sent`. Exactly one message appears in the connected Gmail mailbox. Q15 returns to `pending = 0`.

**Stop/go criteria.** **Stop** if Q15 is anything other than 1 before the invocation. **Stop** if Q21 is non-zero before the invocation. **Stop** if more than one attempt row appears. **Stop** if the attempt outcome is ambiguous rather than a clean success. Go to Stage 15 only on exactly one clean send.

**Immediate containment.** Unset **both** flags and redeploy. Do not create a scheduler job.

**Recovery or rollback.** Return to **D1** by unsetting both and redeploying — likely a fresh deployment rather than Instant Rollback, since D1 is now several steps back.

**Evidence to record.** The chosen event and producer, the real Task change it caused, Q15 and Q21 before and after, the intent identifier, the attempt identifier, the provider message reference, and Q18.

---

#### Stage 15 — Gmail custom-header round-trip proof (A8.7d)

**This is a hard gate. The notification scheduler must not be created until it passes.** The self-ingestion loop it guards against is the one failure mode that compounds: a notification about an event becomes an email, which becomes an ingested message, which becomes a suggestion, which becomes another notification.

**Preconditions.** Stage 14 produced exactly one sent message with a recorded provider message reference. The Gmail poll scheduler is running normally.

**Execution.** Call the **Gmail API** `messages.get` with **`format=full`** for the recorded message identifier. **Visual inspection of the Gmail web interface is not acceptable evidence** — the interface does not show custom headers, normalizes what it does show, and cannot demonstrate the absence of a duplicate header. Then let the next Gmail poll run and inspect its outcome, then let suggestion processing run.

**Verification.** All eight must hold:

1. **Exactly one** message exists matching the canary.
2. Its message identifier **matches the stored provider reference** from Stage 14.
3. `payload.headers` contains **exactly one** header whose name matches `X-Rocket-Generated` case-insensitively — one, not "at least one", because `isRocketGeneratedOwnerNotification` reads the first value and a second header would make the marker forgeable.
4. Its normalized value — trimmed and lowercased — is **exactly** `owner-event-notification`.
5. The next Gmail poll counts the message as **skipped**.
6. **No communication event is created** for it.
7. **No excerpt is persisted** for it.
8. **No suggestion is created** after suggestion processing, and **no second notification intent appears** (Q15 stays at `pending = 0`).

**Stop/go criteria.** **Any failure of any of the eight is a hard stop and blocks A8.7d.** Do not create the notification scheduler. Do not "try one more".

**Immediate containment.** Unset both notification flags and redeploy. **Pause the Gmail-poll scheduler job** so the message cannot be ingested by the next cycle. Quarantine the message: move it out of the polled scope so no future poll can reach it, and record the message identifier. If a communication event, excerpt, or suggestion was created from it, record their identifiers before any cleanup and treat their removal as a separate reviewed decision.

**Recovery or rollback.** Return to **D1**. The loop-suppression defect must be fixed and re-proven in a new slice before A8.7d can resume; this is not something to work around operationally.

**Evidence to record.** The `messages.get` header block (headers only — **no message body, no personal content**), the message identifier matched against the stored reference, the header count, the normalized value, the poll's skipped count, and explicit zero confirmations for communication event, excerpt, suggestion, and second intent.

---

#### Stage 16 — Notification scheduler creation (A8.7d)

**Preconditions.** **Stage 15 passed in full.** State **D4** with both notification flags set. `CRON_SECRET` is configured in Production only.

**Execution.** Create **one** cron-job.org job: HTTP **POST** to `{NEXT_PUBLIC_APP_URL}/api/v1/internal/notifications/process`, every five minutes, `Authorization: Bearer <CRON_SECRET>`, empty body. This is a **third, independent** job alongside Gmail poll and suggestion processing.

**Verification.** The job's first execution returns success. The worker response shows zero or few items, as the queue is empty after Stage 14. Q16 returns 0.

**Stop/go criteria.** **Stop** if the job authenticates incorrectly — a 401 loop every five minutes is noise that will mask a real failure. **Stop** if the first execution reports unexpected work.

**Immediate containment.** **Pause the job.** Note that pausing the scheduler does **not** disable delivery: an intent can still be delivered by a manual invocation, and the flag is what governs delivery. To stop delivery, unset the flag and redeploy.

**Recovery or rollback.** Pause the job and return to **D1**. A rollback alone would leave the job calling an inert endpoint every five minutes, which is safe but should not be left in place unexamined.

**Evidence to record.** Job name, URL, interval, first execution result, worker response, Q16.

---

#### Stage 17 — Notification steady-state observation (A8.7d)

**Preconditions.** Stage 16 complete. The notification job is running on its five-minute cadence.

**Execution.** Observe for the authorized window. Run Q15, Q16, and Q18 at intervals. Watch the scheduler execution log for failures.

**Verification.** Pending intents are created by real events and drain within a cycle or two. Q16 stays at **0** across consecutive observations. Q18 stays at **0**. Every sent notification corresponds to a real event. No message loops back into ingestion — the `/attention` missed-notification section is a useful cross-check, since a notification that failed to reach the Owner appears there.

**Stop/go criteria.** **Stop** if Q16 is non-zero across consecutive observations — claims are being abandoned, which means the worker is dying mid-invocation. **Stop** on any Q18 duplicate. **Stop** if an ingested message turns out to be Rocket-generated. Go to A8.7e only after a clean window.

**Immediate containment.** Pause the notification job; unset `ENABLE_OWNER_EVENT_DELIVERY` and redeploy if sends must stop immediately.

**Recovery or rollback.** Return to **D1** by unsetting both flags and redeploying, and pause the notification job — both actions, because they are in different systems.

**Evidence to record.** Q15, Q16, Q18 at each observation; scheduler success rate; the count of notifications sent; and confirmation that no Rocket-generated message was ingested.

**A8.7d ends here.** A8.7e requires separate authorization, and it is the slice that can send mail to a Recipient.

---

#### Stage 18 — Reminder-schedule count and burst preview (A8.7e)

**Preconditions.** A8.7d complete and reviewed. A8.7e authorized. **D108's gate is satisfied**: the Event Notification Engine is operational — which Stages 11–17 have just established — and the minimum Owner schedule-status UI (A8.6a and A8.6b) is deployed and architecture-approved. `ENABLE_REMINDER_DELIVERY` is absent.

**Execution.** Run Q19 and Q20, and re-run Q6.

**Verification.** **Q19 returns 0** — no reminder schedule exists in Production, because none has ever been created there. **Q20 returns 0.** **Q6 returns 0** — no historical Task carries a `due_local_date`.

**Stop/go criteria.** **Any non-zero Q19 before the canary is a hard stop**: it means a schedule was created outside this procedure and the canary would no longer be single-item. **Any non-zero Q6 is a hard stop** under D109. **Operational constraint: no reminder schedule may be created before the canary** — one is created _as part of_ Stage 19, deliberately, as the only schedule in existence.

**Immediate containment.** Not applicable — read-only.

**Recovery or rollback.** Not applicable — read-only.

**Evidence to record.** `reminders.active_schedules` (expect 0), `reminders.due_occurrences` (expect 0), `schema.due_local_date.nonnull` (expect 0).

---

#### Stage 19 — Single-reminder canary (A8.7e)

**Preconditions.** Stage 18 passed with all three zeros. **Zero reminder schedules and zero reminder delivery attempts** in Production. One reviewed Task with one reviewed Recipient, chosen deliberately — **a real Recipient will receive a real email**. `ENABLE_REMINDER_DELIVERY` still absent. **No reminder scheduler job exists.**

**Execution.** Through the ordinary Owner UI, set a due date on the one reviewed Task so that **exactly one** occurrence becomes eligible. Confirm **Q19 = 1** and **Q20 = 1**. Set `ENABLE_REMINDER_DELIVERY=true` and redeploy — state **D5**. Re-confirm Q19 and Q20 are still 1. Then invoke `POST /api/v1/internal/reminders/process` **exactly once**.

**A larger burst is not acceptable here.** The worker's batch is 25 schedules. If Q20 exceeds 1, this is no longer a canary and requires separate authorization before proceeding.

**Verification.** Exactly **one** success attempt row. **One** email delivered to the reviewed Recipient. The schedule's `overdue_delivered_count` incremented **exactly once**. **No Owner-attention condition raised** — `requires_owner_attention` stays false and `/attention` shows nothing new. **No duplicate success for the local day** — Q18's second query returns 0, which the `reminder_delivery_attempts_one_success_per_local_day_idx` unique index should make impossible. The email **contains no capability link** (D130) and directs the Recipient to the original assignment email. Q17 returns 0.

**Stop/go criteria.** **Stop** if Q19 or Q20 is anything other than 1 at either check. **Stop** on more than one attempt row. **Stop** if the outcome is ambiguous rather than a clean success. **Stop** if any capability link appears in the email. **Stop** if an Owner-attention condition is raised.

**Immediate containment.** Unset `ENABLE_REMINDER_DELIVERY` and redeploy. Remove the due date from the canary Task to stop the schedule. Do **not** create a scheduler job.

**Recovery or rollback.** Return to **D4** (notifications operational, reminders off) by unsetting the reminder flag and redeploying. **A delivered reminder cannot be unsent** — if the wrong Recipient was contacted, that is a communication to handle directly, not an operational rollback.

**Evidence to record.** The Task and Recipient identifiers (identifiers, **not** names or addresses), the schedule identifier, the attempt identifier and outcome, `overdue_delivered_count` before and after, Q17, Q18, the attention-flag state, and confirmation that the email carried no link.

---

#### Stage 20 — Reminder scheduler creation (A8.7e)

**Preconditions.** **Stage 19 passed.** State **D5**. Q17 is 0.

**Execution.** Create **one** cron-job.org job: HTTP **POST** to `{NEXT_PUBLIC_APP_URL}/api/v1/internal/reminders/process`, every five minutes, `Authorization: Bearer <CRON_SECRET>`, empty body. This is a **fourth, independent** job.

**Verification.** First execution succeeds and reports zero work, the canary occurrence having already been delivered. Q17 returns 0. Q19 reflects only the intended schedules.

**Stop/go criteria.** **Stop** if the first execution reports unexpected delivery — nothing should be due. **Stop** on an authentication failure.

**Immediate containment.** **Pause the job.** As with notifications, pausing the scheduler does not disable delivery; unsetting the flag and redeploying does.

**Recovery or rollback.** Pause the job and return to **D4**.

**Evidence to record.** Job name, URL, interval, first execution result, Q17, Q19.

---

#### Stage 21 — Final steady-state monitoring (A8.7e)

**Preconditions.** Stage 20 complete. All four scheduler jobs running: Gmail poll, suggestions, notifications, reminders.

**Execution.** Observe for the authorized window. Run Q15, Q16, Q17, Q18, Q19, Q20 at intervals. Watch all four scheduler execution logs. Check `/attention` as the Owner-facing view of the same facts.

**Verification.** No stale claims on either worker across consecutive observations. No duplicates. Reminders deliver at **09:00 organization-local** (`America/Vancouver`), **not** UTC — D103, and the single most likely thing to be quietly wrong. No pre-existing Task fires a reminder, confirming D109 held through enablement. No capability token or URL appears in any reminder log, telemetry, audit, or metadata (D109). Notification and reminder backlogs both drain.

**Stop/go criteria.** **Stop** on persistent stale claims, any duplicate, any delivery at the wrong local hour, any reminder for a Task the Owner did not opt in, or **any capability token or URL appearing anywhere in logs**. Otherwise A8.7 is complete and A8 closure may be assessed against D108.

**Immediate containment.** Pause the affected job; unset the corresponding flag and redeploy if delivery must stop.

**Recovery or rollback.** Return to **D4** (reminders off) or **D1** (everything off), in both cases by unsetting variables and redeploying, plus pausing the relevant jobs.

**Evidence to record.** Every query at every observation, all four schedulers' success rates, the delivery-hour confirmation with timezone, the D109 confirmation, and the token-absence confirmation.

## Capability links in production

Capability URLs are derived from `NEXT_PUBLIC_APP_URL` and the issued path token. **A7 (D094):** `NEXT_PUBLIC_APP_URL` is sufficient; a custom domain does not block A7. Production capability links must use the configured production app URL. Do not log or commit raw tokens or hashes (D063). After re-forward/reassignment, prior active capabilities are revoked (D086).

## Safe database row-count checks

For operator sanity checks (read-only), use Supabase SQL editor or `psql` against production with least privilege:

- `recipients`, `tasks`, `task_assignments`, `task_capabilities`, `audit_events`, `task_suggestions`
- `handoff_attempts` (A7; authoritative delivery lifecycle per D092), `task_notes`
- After the A8.3a migration is applied: `task_reminder_schedules`, `reminder_delivery_attempts`. After the A8.5a migration is applied: `owner_notification_intents`, `owner_notification_attempts`. Until then these tables do not exist in Production and a count against them will error.

Compare counts before/after E2E or deploy; do not paste row contents containing PII into tickets.

## Rollback principles

1. **Application:** Redeploy the previous known-good Vercel deployment via the Vercel dashboard. **A deployment carries the environment variables it was built with**, so Instant Rollback restores the target's original flag values rather than today's, and on the Hobby plan it may reach only the immediately previous deployment. During A8.7, use the [deployment and flag matrix](#deployment-and-flag-matrix) rather than reasoning about rollback ad hoc.
2. **Schema:** Prisma migrations are forward-only in production; roll back application code before attempting destructive schema changes. Never drop production tables without an explicit operator decision. **Rolling back application code does not unapply a migration**, and no A8 migration has a down path.
3. **Schedulers:** Rolling back a deployment does **not** pause an External Scheduler job. Pausing the job is a separate action in a separate system, and stopping delivery additionally requires unsetting the governing flag and redeploying.
4. **Secrets:** Rotate `CAPABILITY_TOKEN_PEPPER` only with a documented invalidation plan (all outstanding links become unusable). Do **not** rotate `CRON_SECRET` as a containment action during a schema change — pause the scheduler jobs instead.
5. **Capabilities:** Reassignment or re-forward revokes the prior active capability and issues a new one (D086). Revoked records are preserved for audit.

## Untracked Supabase CLI artifacts

These directories are **local CLI state** and must remain **untracked**:

- `apps/web/supabase/`
- `packages/db/supabase/`
- `supabase/`

Do not commit `.temp/` linkage files. Link projects locally; configure production via Vercel env vars.

## Re-enabling internal diagnostics

If Owner task routes return `500` and logs are insufficient:

1. Set `ENABLE_DB_RUNTIME_DIAGNOSTICS=true` on a **non-production** preview deployment first.
2. Reproduce the failing Owner route; inspect **server logs** only (structured categories—no connection strings).
3. Disable diagnostics before promoting to Production.

Production normally runs with diagnostics **disabled**. No temporary `X-AICAA-DB-*` headers should be present.

## Related documentation

- HTTP implementation status: [API_CONTRACT.md](API_CONTRACT.md)
- Capability authorization: [SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md)
- Milestone status: [MILESTONES.md](MILESTONES.md)
