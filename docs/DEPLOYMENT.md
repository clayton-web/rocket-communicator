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

| Variable                        | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ENABLE_DB_RUNTIME_DIAGNOSTICS` | When exactly `true`, enables structured **server-side** database runtime diagnostics for Owner routes. **Disabled in Production** by default. Does not add public `X-AICAA-DB-*` response headers.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `ENABLE_OWNER_EVENT_CAPTURE`    | When exactly `true`, allows a Task mutation to record Owner Event Notification intent (D135). **Absent from the Vercel Production environment, and absent from the deployment the public custom domain serves** — the A8.5 migration is already applied (Gate 4), and the capture code is already deployed (Gate 5). [Gate 6](#gate-6--first-controlled-production-enablement-a87c-capture--f0--f1) temporarily created this variable in Vercel Production and built a READY production-target deployment carrying it, but that deployment never received the public custom domain, so the value never became live; the variable was subsequently removed under separate authorization. The capture site runs inside `persistCapabilityAction`, which Production executes on every Task mutation. With the flag absent the decision is made before the transaction opens, so no statement reaches an A8.5 table. Since A8.5d it governs all ten producers rather than one: a clarification request, a return to Owner, a terminal handoff failure, a Gmail channel transition, three reminder stops, an unassigned reminder skip, and a capability expiry are each gated by it, and each decides before its transaction opens. Since A8.5e it also gates the Owner notification worker's capability-expiry capture phase, which is the only thing that observes expiry without a Recipient presenting a lapsed link. Capture records intent only; it delivers nothing, and `ENABLE_OWNER_EVENT_DELIVERY` is a separate flag |
| `ENABLE_OWNER_EVENT_DELIVERY`   | When exactly `true`, allows the Owner notification worker to claim and process intents (D135). **Absent everywhere, including Production, and must stay that way.** With it unset `POST /api/v1/internal/notifications/process` performs no delivery work at all: no scan, no claim, no attempt row, no transport, and no Gmail configuration read. Since A8.5e that endpoint also has a capture phase under the separate flag above, so "both flags unset" rather than this flag alone is what means the invocation opens no database connection. **Since A8.5c a real Gmail adapter exists behind this flag**, so it is now the only thing preventing Owner notification mail: enabling it where intents exist and the migration is applied would send from the organization's connected Gmail account to itself. Entirely separate from `ENABLE_OWNER_EVENT_CAPTURE`: capture writes intents, delivery processes them, and neither implies the other. `"1"`, `"TRUE"`, `"yes"`, and whitespace variants all leave it **off**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `ENABLE_REMINDER_DELIVERY`      | When exactly `true`, allows reminder occurrence processing to claim and write **and** is the sole condition under which a real Gmail reminder transport is constructed at all (A8.4b.1). **Set nowhere, including Production**, and gated by [Reminder engine operations](#reminder-engine-operations-a8--not-operational). With it unset the route builds no transport, so no access resolver exists, no refresh token is decrypted, and no token exchange is attempted; processing returns a zero-work response. Turning it on additionally requires `OWNER_ORGANIZATION_ID`, a connected Gmail account, and an External Scheduler job — none of which exist. **Unlike the notification worker, a disabled reminder invocation still opens a database connection**: `getDb()` is awaited before the flag is consulted, so the route connects and then issues no scan, claim, or write. Do not cite it as an example of "disabled implies no database contact".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

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

### Deploying a commit that is not on `main`

**The ordinary path is a push to `main`**, which Vercel builds and promotes automatically with no inspection gate. That is how the A8 schema incident reached Production, and it is why A8.7 deployments should not use it.

**Promoting a Preview deployment is not a substitute, and must not be used.** The Git integration builds a pushed non-`main` branch as a **preview-target** deployment, and `vercel promote` moves the alias without rebuilding. A preview build therefore carries the **Preview** environment for the rest of its life. Five variables exist only in Production and are **absent from Preview**:

| Variable                             | Consequence if a Preview build is promoted        |
| ------------------------------------ | ------------------------------------------------- |
| `DATABASE_URL`                       | **Every database route fails.** Full Owner outage |
| `CRON_SECRET`                        | Scheduler authentication fails                    |
| `GMAIL_TOKEN_ENCRYPTION_KEY`         | Stored Gmail tokens cannot be decrypted           |
| `GMAIL_TOKEN_ENCRYPTION_KEY_VERSION` | As above                                          |
| `ENABLE_DB_RUNTIME_DIAGNOSTICS`      | Diagnostics silently unavailable                  |

**Use a production-target build, inspect it, then promote it.** This is the method A8.7b-INCIDENT-1d used, and it keeps the inspection gate that push-to-`main` removes:

```bash
# from a clean worktree at the exact commit to deploy
vercel deploy --prod --skip-domain --yes    # production env, production target, no alias yet
vercel inspect <url> --logs                 # confirm before anything is live
vercel promote <deploymentId> --yes         # assign the production domain
```

**`--skip-domain` creates an inspection window; it does not make the artifact unreachable.** The build exists, holds Production environment variables including the live `DATABASE_URL`, and **is addressable at its own immutable deployment URL**, which Vercel assigns unconditionally at creation. What `--skip-domain` withholds is the **production domain**, so the alias stays on the current deployment until an explicit `vercel promote`. That is zero **aliased** traffic, not zero exposure, and the distinction matters when reasoning about what an un-inspected build can reach. Residual exposure is bounded by Vercel deployment protection on immutable URLs; confirm it read-only rather than assuming it.

**The control that actually prevents accidental traffic movement is not `--skip-domain`.** In descending order of strength: **not pushing to `main`**, which stops an automatic build-and-promote from ever starting; then the **alias staying bound** to the current deployment until an explicit promote; then **deployment protection** bounding the un-aliased build. `--skip-domain`'s real contribution is making the promote a separate command with an inspection between the two.

**Before promoting, confirm** the commit SHA in the deployment metadata, the target is `production`, the build state is ready, the route set is what you expect **by name and not merely by count**, **no migration ran during the build** — only `prisma generate` should appear — and that the build used the configured Node version and build command. For a Gate 5 deployment the full checklist is [G5.11](#g511-pre-promotion-inspection).

**The deploying worktree needs `.vercel/project.json`** to be linked. It contains a project and organization identifier, no secret, and `.vercel/` is gitignored.

### The runtime-value import hazard

**`@aicaa/db` is listed in `serverExternalPackages`, so Next leaves it a runtime external.** A statically imported **value** from it does not reliably survive the build: in the deployed `ee5e82a` bundle, `NO_SCHEDULE_REMINDER_VERSION` was emitted into the server chunk as an **undeclared free variable** while every neighbouring binding was minified. The first real Task without a reminder schedule threw `ReferenceError: NO_SCHEDULE_REMINDER_VERSION is not defined`, and the route answered `INTERNAL_ERROR`.

The rules, which apply to any package in `serverExternalPackages`:

- **Type-only imports are always safe.** `import type { PersistedReminderSchedule } from '@aicaa/db'` is erased at compile time and cannot fail at runtime.
- **Value imports are the hazard** — constants, classes, functions. Either reach persistence through `loadDbRuntime()`, or own the value locally with a guard asserting it matches the persistence authority.
- **Unit tests structurally cannot detect this.** Vitest resolves `@aicaa/db` directly, so the binding is present in every test and absent only in the artifact that ships. A green suite is not evidence.
- **Production bundle verification is the only guard.** Build with the effective Vercel production path and assert the identifier does not appear as a free variable in `.next/server`.
- **The diagnostic signature is misleading.** A `ReferenceError` is neither a Prisma error nor a `PersistenceError`, so **no `database_runtime_failure` event is emitted** to contradict it. Category `UNKNOWN_FAILURE` **with no accompanying database diagnostic** points at code or packaging, not at the database — that inference would have saved most of the 1d investigation.

**Both known instances are now resolved.** The reminder ETag constant was fixed by A8.7b-INCIDENT-1d. The second — `import { PersistenceError } from '@aicaa/db'` in `apps/web/lib/suggestions/process-service.ts`, used via `instanceof` — was resolved by **A8.7b-INCIDENT-1j** in the Gate 5 preparation slice. `packages/db` now owns an `isPersistenceError` predicate, exported through both entry points and carried across the runtime bridge, and the processor calls `runtime.isPersistenceError` instead of holding the class.

**That fix closed a second gap `instanceof` could not have survived anyway**, and it is worth recording because it generalizes. Persistence errors are thrown by the traced `dist/runtime.js`; the static import resolved `dist/index.js`. Those are different entry files, and the deployed Lambda layout does not guarantee they share one module graph. If they do not, `error instanceof PersistenceError` is **silently false** for an error this repository threw — no crash, no diagnostic, just a `UNIQUE_VIOLATION` that stops being recognised as one. **A class carried across the externalized-package boundary for `instanceof` is unsound even when the binding survives**; move the comparison to the module that owns the class.

**Note the failure mode of the instance that was fixed, because it is the worst shape this defect can take.** Both call sites sat inside `catch` blocks. A `ReferenceError` raised while handling a persistence failure replaces the error being handled with a meaningless one, and the branch it guarded was the idempotent `UNIQUE_VIOLATION` re-claim — so a benign duplicate would have become a retryable failure burning an attempt against the D084 ceiling. Guards: `apps/web/__tests__/a8-7b-incident-1j-persistence-error-import.test.ts`, which covers the import pattern across `lib` and `app`, the bridge wiring, the preserved classification behaviour, and the built server chunks.

## Database migrations

A4 foundation migration: `packages/db/prisma/migrations/20260713190000_a4_persistence_foundation/` (**applied in production** as part of A4).

A5 Gmail persistence migration: `packages/db/prisma/migrations/20260716140000_a5_gmail_persistence/` (**applied in production** as part of closed A5). Forward-only; do not rewrite history.

A6 suggestion persistence migration: `packages/db/prisma/migrations/20260717180000_a6_suggestion_persistence/` (**applied in production** as part of closed A6).

A7 handoff migrations: `packages/db/prisma/migrations/20260718210000_a7_handoff_persistence/` and `packages/db/prisma/migrations/20260718223000_a7_handoff_concurrency_hardening/` (**applied and verified in production** as part of closed A7).

A8.3a reminder persistence migration: `packages/db/prisma/migrations/20260731040000_a8_reminder_persistence/` (**applied in production 2026-08-04** as part of A8.7b-INCIDENT-1c). Additive and forward-only: it creates `task_reminder_schedules` and `reminder_delivery_attempts`, adds the nullable `tasks.due_local_date`, and enables deny-by-default RLS on both new tables. It changes no existing column and performs **no backfill** — `due_local_date` stays null on every historical Task so that existing due-date data cannot activate reminders (D109).

**This migration is a prerequisite for the A8.3b Owner reminder routes, and applying it still schedules nothing.** As of A8.3b, `GET`/`PUT`/`DELETE /api/v1/tasks/{taskId}/reminder` read and write these tables; before it was applied those three routes failed against Production while every other route was unaffected. **They are now expected to work, and `GET` is the smoke test that proves the repair reached the application** — it is the one surface whose behaviour changed observably. Applying the migration makes reminder configuration possible, not reminder delivery: there is no scheduler, worker, cron job, or email path, so the most a schedule can do is sit in the table waiting for a later, separately authorized slice. **The Owner must not create or modify a reminder until the later A8 rollout is authorized.**

**As of A8.6a the `/attention` page depends on it too, and that changes the blast radius from an API route to a navigable page.** A8.6a is **not deployed** — it sits in unpushed local commits and ships in [Gate 5](#gate-5--deploying-the-queued-a84ba86-code) — so this describes what happens when it ships, not current Production. `/attention` reads `task_reminder_schedules` on every load, so without this migration it would fail to its error boundary — visibly, by design. **That risk is retired: the migration has been applied since 2026-08-04.** It must not be made to degrade quietly: an empty attention list reads as "nothing needs your attention", which is precisely the wrong thing to tell an Owner on the strength of a missing table. With the migration applied the page loads and shows an empty list, which is truthful, because no reminder has ever been delivered and nothing can have raised the attention flag.

**A8.6b widens that page dependency to the Task detail page.** Its server component loads reminder state on every Task view, so an unapplied migration takes out `/tasks/{taskId}` — the most-used Owner page in the product — rather than one panel within it. This is the same deliberate loudness, and the same reason applies: a Task page that silently rendered "no reminders are scheduled" against a missing table would tell an Owner their automation is idle when the truth is that Rocket cannot see it. Applying the migration restores the page and every panel truthfully reports no schedule, because none has ever been created in Production. **A8.6b still adds no migration of its own**; it is a consumer of the A8.3a chain.

**A8.6c adds a second migration dependency to the same page, and that dependency is now satisfied.** `/attention` also reads `owner_notification_intents`, so the page depends on the **A8.5a migration** — migration 9, deliberately not applied by the repair — as well as the A8.3a chain, and either one being absent takes the page to its error boundary. **[Gate 4](#gate-4--production-migrations-69) applied migration 9 on 2026-08-05, so the blocker is cleared and A8.6c can ship in [Gate 5](#gate-5--deploying-the-queued-a84ba86-code).** The loudness is again deliberate: a section headed "things Rocket could not tell you about" rendering empty against a missing table would assure the Owner that nothing went undelivered on the strength of a table that does not exist. With both migrations applied the page loads with two truthfully empty sections, because Production has never created a reminder schedule or captured a notification intent — `ENABLE_OWNER_EVENT_CAPTURE` has never been live on the public custom domain. **A8.6c adds no migration and no index of its own**; like A8.6a and A8.6b it is a consumer.

> **This is the ordering argument for the whole rollout, stated once.** Gate 4 had to precede Gate 5 because `/attention` reads `owner_notification_intents` on every load and **consults no flag before doing so** — gating a read of durable state on a flag would hide rows that genuinely exist. There was therefore no flag that could have made the page safe against a missing table, and no deployment order other than migrate-then-deploy. That is why `D2` exists as its own state rather than being collapsed into the deployment.

A8.3b audit remediation migration: `packages/db/prisma/migrations/20260731170000_a8_3b_reminder_concurrency/` (**applied in production 2026-08-04** as part of A8.7b-INCIDENT-1c). Additive and forward-only: it adds `task_reminder_schedules.reminder_version` with a `DEFAULT 1` and two CHECK constraints (`task_reminder_schedules_reminder_version_positive` and `task_reminder_schedules_suspended_has_no_next_occurrence`) — three statements in total. It creates no table, drops nothing, and changes no existing column type. It was applied in the same `migrate deploy` run as the A8.3a migration, against a table that had just been created and therefore held no rows to touch.

Why it exists: reminder writes deliberately do not bump `Task.version`, so the Task ETag cannot protect a reminder mutation, and a real-PostgreSQL audit demonstrated two concurrent Owners each holding a valid token and one of them losing a write silently. `reminder_version` is the reminder resource's own concurrency token, and correctness could not be expressed without persisting it. The CHECK constraints assert what the application already guarantees — a positive version, and a `suspended_waiting` schedule holding no next occurrence — so a paused Task cannot sit in the worker's due-scan index.

A8 lifecycle remediation migration: `packages/db/prisma/migrations/20260731230000_a8_advance_waiting_skip/` (**applied in production 2026-08-04** as part of A8.7b-INCIDENT-1c). One additive `ALTER TYPE "ReminderAdvanceDisposition" ADD VALUE 'skipped_waiting_elapsed'`. It rewrites no row and invalidates no existing value.

A8.4a worker-safety migration: `packages/db/prisma/migrations/20260801120000_a8_4a_worker_safety/` (**applied in production 2026-08-04** as part of A8.7b-INCIDENT-1c). Additive and forward-only. It adds four terminal values to `ReminderAdvanceDisposition`; adds `claim_expires_at`, `claim_sequence`, `provider_call_started_at`, `provider_accepted_at`, and `provider_message_ref` to `reminder_delivery_attempts`; adds CHECK constraints for claim coherence, provider-metadata ordering, and the rule that a non-active schedule holds no live lease; and creates two partial indexes — one for the expired-claim recovery sweep, one for the global due scan. It drops nothing and changes no existing column type.

**It carries one backfill, and that backfill is the reason this migration was tested from the existing state rather than only from empty.** A8.3b's occurrence claim was an indefinite marker with no sequence, so every row already holding a claim would have violated the new fencing constraint the moment it was added — the constraint is validated against existing rows and the new column defaults to zero. `UPDATE "reminder_delivery_attempts" SET "claim_sequence" = 1 WHERE "claimed_by" IS NOT NULL` gives those rows the sequence they would have been granted under the new lifecycle. Their `claim_expires_at` deliberately stays `NULL`: a lease that never had a deadline is not one to invent retroactively, and a null expiry reads as "not a live lease", so the next worker reclaims at sequence 2 and the fence works from there. Production has no rows to touch — the tables do not exist there yet — but the correctness of the migration must not depend on that, and `packages/db/__tests__/a8-4a-migration-from-a8.test.ts` applies it over the prior state with live data present.

A8.4a audit-remediation migration: `packages/db/prisma/migrations/20260802094500_a8_4a_settlement_marker/` (**applied in production 2026-08-04** as part of A8.7b-INCIDENT-1c). Additive and forward-only. It adds one nullable column, `schedule_settled_at`, to `reminder_delivery_attempts`; backfills it on every existing non-`claimed` row; adds a CHECK that only a terminal row may carry it, `NOT VALID` first and then validated; and creates two partial indexes for the settlement-debt and retry-budget recovery sweeps. It drops nothing and rewrites no column anything already reads.

**Its backfill is a statement of fact rather than an assumption.** Every terminal row predating it was written under the single-transaction design, so its schedule was settled in the same commit by construction; marking those rows settled is what stops the new sweep waking up to a backlog of history it would try to re-count. The migration was tested from empty, from the predecessor state with representative rows of every terminal shape, and against every legacy half-written claim shape the predecessor schema permitted — including the sequence-1, null-expiry rows the previous migration's own backfill produced. `packages/db/__tests__/a8-4a-settlement-marker-migration.test.ts` is that test; the remediation re-audit found this migration had none and this is the guard added in response.

**One limit on how far "statement of fact" reaches, stated because an operator would have to know it.** The backfill is a fact for rows written by code that settled in the same commit. It is an **assumption** for a terminal row whose schedule effect the pre-fix code skipped — a `permanent_failure` or `ambiguous` row whose schedule was left un-advanced. Marking such a row settled makes it permanently invisible to the settlement sweep, so a schedule effect that never happened would never be collected. This is inert as written: Production holds none of these tables, so the affected population is empty and cannot become non-empty without applying the A8 migrations first. It stops being inert if these migrations are ever applied to a database that has already run pre-fix worker code, and in that case the backfill must be narrowed to `outcome = 'success'` — or the un-advanced schedules reconciled — **before** this migration is applied, because afterwards the evidence is gone.

**A correction carried in that migration's header.** `20260801120000_a8_4a_worker_safety` opens by saying it "backfills nothing beyond column defaults", which is false: it runs the `claim_sequence = 1` update described above, and the body of that same file explains it at length. The correction is recorded in the newer migration and here rather than by editing the applied file, because Prisma records a checksum per applied migration and editing one makes `migrate deploy` fail on every database that already has it.

A8.4b.1 capability-skip migration: `packages/db/prisma/migrations/20260802173000_a8_4b1_capability_skip_reason/` (**applied in production 2026-08-05** as Gate 4 migration 1 of 4). One additive `ALTER TYPE "ReminderSkipReason" ADD VALUE IF NOT EXISTS 'no_actionable_capability'`. It rewrites no row and invalidates no existing value, and the reminder skip-reason CHECK tests only that a reason is present exactly when the outcome is `skipped`, so it enumerates no value and needs no revalidation.

A8.4b.2 repeated-ambiguity stop-reason migration: `packages/db/prisma/migrations/20260802210000_a8_4b2_repeated_ambiguous_stop_reason/` (**applied in production 2026-08-05** as Gate 4 migration 2 of 4). One additive `ALTER TYPE "ReminderScheduleStopReason" ADD VALUE IF NOT EXISTS 'repeated_ambiguous_outcomes'`, adding the stop reason D129 uses. Same properties as the one above: it rewrites no row, invalidates no existing value, and `task_reminder_schedules_stop_reason_matches_status` constrains only that a reason is present exactly when the status is `stopped`, so it enumerates no value and needs no rebuild or revalidation. Both files are deliberately additive and contain only the enum alteration. Keeping enum introduction separate from any schema or data operation that consumes the new value avoids PostgreSQL enum-visibility and deployment-order hazards, and keeps each migration independently testable and safely additive.

A8.4b.3 advance due-scan index migration: `packages/db/prisma/migrations/20260803090000_a8_4b3_advance_due_scan_index/` (**applied in production 2026-08-05** as Gate 4 migration 3 of 4). One additive `CREATE INDEX IF NOT EXISTS "task_reminder_schedules_advance_due_scan_idx" ON "task_reminder_schedules"("advance_occurrence_at", "id") WHERE "status" = 'active' AND "advance_disposition" = 'scheduled'`, which the A8.4b.3 advance scan reads. It creates no column, no constraint, and no enum value, rewrites no row, and dropping it would leave the scan correct and merely slower. It is a plain `CREATE INDEX` rather than `CREATE INDEX CONCURRENTLY`: migrations are applied through `prisma migrate deploy`, and a concurrent build would need its own separately designed procedure rather than being introduced implicitly here. **Historical note, now settled:** the concern before Gate 4 was that a populated `task_reminder_schedules` would make the lock non-instantaneous, and [G4.9](#g49-the-populated-table-branch) specified a `CREATE INDEX CONCURRENTLY` forward fix for that branch. Gate 4 applied this migration on 2026-08-05 without the branch firing.

A8.5a Owner notification migration: `packages/db/prisma/migrations/20260803120000_a8_5a_owner_notification_intents/` (**applied in production 2026-08-05** as Gate 4 migration 4 of 4). Creates five enum types and two new tables — `owner_notification_intents` and `owner_notification_attempts` — with their CHECK constraints, indexes, and deny-by-default RLS. It alters no existing table, drops nothing, and backfills nothing. **The ordering it required is now satisfied: the migration landed in Gate 4, and `ENABLE_OWNER_EVENT_CAPTURE` is still absent.** `ENABLE_OWNER_EVENT_CAPTURE` is evaluated before the mutation transaction opens, so with the flag absent — which it is everywhere — Production's Task mutations issue no statement against either table. Applying the migration enabled nothing, which is why Gate 4 could precede the deployment safely; **enabling the flag before applying it was the ordering that would have broken**, and that hazard is now retired. The flag remains a Gate 6 decision.

A8.5b adds **no migration**. It makes the states and claim-lease columns that migration already declared reachable, behind `ENABLE_OWNER_EVENT_DELIVERY`. The same ordering note applies for the same reason: with the flag absent the worker opens no database connection at all, so Production running A8.5b code against a schema without the A8.5 tables is unaffected.

A8.5c adds **no migration** either — no column, no table, no index, no enum value. It adds email rendering, destination resolution, a real Gmail adapter, and the self-ingestion marker, all behind the same unset flag, and stores nothing new: the destination is resolved at send time and deliberately never persisted.

A8.5d adds **no migration** as well — no column, no table, no index, no enum value. It adds producers for the nine remaining ratified events and a durable capability-expiry transaction, all governed by the same unset `ENABLE_OWNER_EVENT_CAPTURE`, and the A8.5a schema turned out to be the specification for the whole taxonomy rather than for the first event alone. The ordering note is unchanged and now covers nine more mutation paths: with capture absent, a clarification request, a return to Owner, a terminal handoff failure, a Gmail channel transition, a reminder settlement, and a capability expiry each issue no statement against either A8.5 table, so Production running A8.5d code against a schema without them behaves exactly as it does today.

A8.5e adds **no migration** — no column, no table, no index, no enum value. It wires the capability-expiry sweep into the notification worker's capture phase and finalizes the worker's response contract. The expiry scan is deliberately global across organizations, so the existing `(organization_id, status, expires_at)` index cannot serve it and PostgreSQL 16 plans a sequential scan with a top-N heapsort. That was measured rather than assumed: **0.74 ms over 9,109 rows, 362 shared buffer hits**, against a bounded fifty-row batch on a table that grows once per handoff. **No index was added on speculation.** If the table ever grows enough for that to matter, the remedy is a partial `(expires_at, id) WHERE status = 'active'` index, and the planner test in `apps/web/__tests__/a8-5e-worker-concurrency.pg.test.ts` is where the change in cost would first become visible. The ordering note is unchanged: with capture absent the sweep never runs, so Production running A8.5e code against a schema without the A8.5 tables behaves exactly as it does today.

**Each enum migration contains one statement and uses the new value nowhere, deliberately.** Keeping enum introduction separate from any schema or data operation that consumes the new value avoids PostgreSQL enum-visibility and deployment-order hazards: PostgreSQL restricts _using_ a freshly added enum value in the same transaction that added it, so depending on how statements are grouped when applied, a file that added the value and then referenced it — in an index predicate, a CHECK, or a backfill — can pass a from-empty test and still fail on apply. Separating them keeps the migration independently testable and safely additive. `packages/db/__tests__/a8-4b1-capability-skip-migration.test.ts` asserts that shape as well as the behaviour.

**A known inaccuracy is retained inside three migration files, and this paragraph is its authoritative correction.** The header comments of `20260802094500_a8_4a_settlement_marker`, `20260802173000_a8_4b1_capability_skip_reason`, and `20260802210000_a8_4b2_repeated_ambiguous_stop_reason` each make a claim about how Prisma groups a migration file's statements into transactions. The repository establishes only that migrations are applied through `prisma migrate deploy`. It establishes nothing about transaction grouping, that claim should not be relied on or repeated, and no reasoning in this document depends on it. The comments are left in place because editing an applied migration file changes its recorded checksum and would break `migrate deploy` against every local database that already applied it, while the SQL statements themselves are correct and unaffected.

The A8.4a comment also draws a substantive conclusion from that claim — that its `NOT VALID` / `VALIDATE` split cannot yet reduce lock duration. Read it instead as follows: the migration applies the constraint change through the repository's standard deployment path as one migration step, and a lower-lock rollout would require a separately designed operational procedure that creates the constraint as `NOT VALID` and validates it in a later step, rather than merely changing that file's wording. The split is still the right shape to have written, because it is the form such a procedure would adopt and because the backfill guarantees the validation finds nothing to reject.

Applying any of these reminder migrations still sends nothing. They make occurrence processing _representable_; the processing endpoint remains disabled by default, constructs no transport at all while `ENABLE_REMINDER_DELIVERY` is unset, and is invoked by no cron job.

**Local Docker** (loopback Postgres 17 on port 5433, matching the Production major version; never production):

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

Read the credential into the environment without it entering shell history, run the three commands **from the detached worktree that bounds the migration set**, then discard it:

```bash
read -rs -p "Migration DATABASE_URL (session pooler, port 5432): " MIGRATE_URL
export MIGRATE_URL
```

```bash
cd <worktree>/packages/db
DATABASE_URL="$MIGRATE_URL" pnpm exec prisma migrate status
DATABASE_URL="$MIGRATE_URL" pnpm exec prisma migrate deploy
DATABASE_URL="$MIGRATE_URL" pnpm exec prisma migrate status
unset MIGRATE_URL
```

Rules that make that pattern load-bearing rather than cosmetic:

- **The local-only helpers must never be pointed at production.** `pnpm db:migrate:local`, `db:migrate:status:local`, and anything else routed through `packages/db/scripts/run-local-prisma.mjs` assert a loopback host and exist for the Docker cluster. They are not "the same command with a different URL", and they will refuse a production host by design.
- **No unguarded migration package script exists any more.** `packages/db` previously exposed bare `migrate:deploy`, `migrate:dev`, and `migrate:status` scripts that inherited whatever `DATABASE_URL` was in scope, including one loaded silently from `packages/db/.env`. **They have been removed.** Prisma is invoked directly for the one authorized production operation, so the target is always written at the call site.
- **Run from a worktree that has no `.env`.** Prisma reads `.env` from the schema's directory, so the surest way to prevent an unintended target is to execute where no `.env` exists. Verify its absence rather than assuming it.
- **The commit you run from determines which migrations apply.** `prisma migrate deploy` applies everything pending in _its own_ migrations directory and offers no way to select a subset. Bounding the set therefore means choosing the worktree, not choosing a flag.
- **No credential may be committed, pasted into documentation, quoted in a ticket, or recorded in evidence.** Evidence records the redacted host form and the port, never the string.
- **`migrate status` exits non-zero when migrations are pending.** Expect exit 1 before the migration and exit 0 after. Do not run the sequence under `set -e` without allowing for it, and do not read that exit code as a failure.
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

**Bearer candidate (immutable URL) auth smoke.** A read-only Bearer / missing-Authorization probe against unaliased Production-target candidate `dpl_HpAZDkgUS6zj2fRES91YUqp3pUBb` (commit `eb8cabe`) is recorded in [BEARER_CANDIDATE_AUTH_SMOKE_EVIDENCE.md](BEARER_CANDIDATE_AUTH_SMOKE_EVIDENCE.md). Cookie auth on that protected candidate is **deferred**. **That smoke record itself did not authorize promotion.** A later authorized promotion placed public Production on Bearer deployment `dpl_Cs2TrnDsy1KSB3wipCCUt82Hpf8D` at the same commit — see [Current production state](#current-production-state).

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

**A8.0 documentation Decision Lock** recorded (D095–D101) and partly superseded. **A8.1 documentation Decision Lock** recorded (**D102–D110**): A8 is a **due-date-driven** reminder model. Do not enable any A8 feature until the specific gate or slice is authorized. **P1.0 documentation Decision Lock** recorded (**D111–D120**): the Owner web experience foundation is scoped; **P1.1 through P1.5 are implemented**; **P1 is COMPLETE** — implemented, deployed, and production-validated with one documented evidence limitation ([P1_5_EVIDENCE.md](P1_5_EVIDENCE.md)). **P2.0 documentation Decision Lock** recorded (**D137–D144**): Owner Experience Foundation / Product Constitution — [P2_0_OWNER_EXPERIENCE_FOUNDATION.md](P2_0_OWNER_EXPERIENCE_FOUNDATION.md). **Roadmap sequencing supersession (D140):** next-work order is **P2.0 → A9.0 → A9.1 → A9.2 → A9.3 → Owner Acceptance Week → P2.2 → Stage 12 → A8.7d → A8.7e → A10+**. This supersedes the prior next-work shorthand **A7 → A8 → A9** (no early separate A9.0) for sequencing only — milestone identifiers unchanged; architecture unchanged; **this section does not change Gate 6 / Stage 12 procedures or authorize any flag change**. **P1** was sequenced before the remaining A8 implementation slices and is now closed. **A8 engines are in Production at `D3` / `F0`** after Gate 4 and Gate 5; **[Gate 6](#gate-6--first-controlled-production-enablement-a87c-capture--f0--f1) (first capture enablement) was authorized and partially executed but is incomplete and never became live** — the capture flag is absent from Vercel Production and from the deployment the public custom domain serves; Stage 12, A8.7d, and A8.7e remain unauthorized and unbegun (paused under D140). **Nothing in A8 is operational:** all three A8 flags are absent, so neither the real Gmail reminder transport nor the Owner notification transport is ever constructed, and no cron job exists for either worker. Current state: [Current production state](#current-production-state).

### Owner web experience foundation operations (P1)

**P1.1 through P1.5 are implemented. P1 is COMPLETE** — implementation complete, deployed, and production-validated. The P1.1 baseline comparison against production was completed in P1.5 (D119).

P1.5 was deployed and production-validated on 2026-07-30 as commit `8588c5d260176b24c8ecf6fb16e026c5c6034359`, via the automatic Vercel production deployment `dpl_7vmnL71Lck7JLeftgsJkYVJ4uw82` (stable alias `https://rocket-communicator-web.vercel.app`). No manual deployment action was required. Evidence: [P1_5_EVIDENCE.md](P1_5_EVIDENCE.md).

> **Production has since advanced past `8588c5d`.** It now serves the promoted Bearer F0 deployment `dpl_Cs2TrnDsy1KSB3wipCCUt82Hpf8D` at commit `eb8cabe` (Gate 5 baseline `d369c6d` + Bearer Owner access) at **`D3` / `F0`** — see [Current production state](#current-production-state). The paragraph above is the P1.5 historical record, not a statement about what is running today.

**Rollback deployment retained:** `dpl_3sp18eqYRQH6bjKdXC72Tue263V1` (commit `243895f`, the P1.4 closeout documentation; application code identical to the P1.4 validated build). The earlier P1.4 deployment `dpl_F5zjNcc4zwiwbr25CSdMGA3zDy8c` (commit `a38c8574`) also remains available. No rollback condition was triggered and no rollback was performed.

**Operator note — production validation coverage.** Signed-out routes, authenticated Owner routes, redirects, sign-in, sign-out, shell persistence, one authenticated Owner span per request, invalid capability behaviour, accessibility, and capability security in the invalid-link scope were all validated in production. The **valid Recipient capability workflow was not**, because the application intentionally provides no safe production path for creating a synthetic Recipient capability — issuing one requires an A7 Gmail handoff that forwards a real customer email. This is an intentional production-safety property and an **evidence limitation**, not a defect or a failed validation; the workflow is covered by local evidence. Detail: [P1_5_EVIDENCE.md](P1_5_EVIDENCE.md) §6.

**Operator note — capability URLs in platform access logs.** Platform access logs naturally record request paths, so capability URLs appear in them because the capability identifier is embedded in the path. This is **not** introduced by P1.5, **not** a regression, and **rollback would not change it**. The D114 application-side prohibition is intact: no raw `/c/{token}` path appears in any application diagnostic, which was verified in production. Recorded as a future architectural and security consideration, **not** a release blocker. Detail: [P1_5_EVIDENCE.md](P1_5_EVIDENCE.md) §7.

**No new environment variable was introduced by P1.1.** The existing `ENABLE_DB_RUNTIME_DIAGNOSTICS` remains an **incident-only** gated DB probe (disabled in Production by default). Always-on operational diagnostics use the application-owned seam in `apps/web/lib/observability/` and emit privacy-safe JSON on standard output (`operation_timing`, `operational_failure`).

**Vendor-neutral by requirement (D115).** Structured diagnostics are read through the host's existing log surface. A hosted backend or OpenTelemetry exporter must remain an **adapter** (D079); no commercial telemetry vendor, session replay, or behavioural analytics is authorized.

**No health or readiness endpoint is authorized, and none is required for P1 closure (D115).** Existing operator smoke checks — `GET /api/v1/session` returning 200 or 401 and an authenticated `GET /api/v1/tasks` — plus P1.1 structured diagnostics and silent-failure detection are sufficient. A contract test asserts `/health` is absent from the bundled OpenAPI.

**Capability routes are excluded from client telemetry (D114).** Server-side diagnostics identify capability routes only by static templates (`/c/[token]`, `/api/v1/capabilities/[token]/…`). Full prohibition list: [SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md).

**Baseline before change (D119).** Captured in [P1_1_BASELINE.md](P1_1_BASELINE.md). Numeric thresholds are ratified from evidence afterward, not asserted in advance.

**Browser verification runs as a separate job (D119)** rather than inside `pnpm verify` — **P1.2 is implemented, pending review**: `pnpm --filter @aicaa/web e2e`. It targets a **controlled local environment only** (disposable local Postgres plus a local Supabase Auth double) and refuses any non-loopback database. It is never run against production, and it produces **no** preview or production evidence. It has been executed on **macOS only** and is **not part of any CI workflow**; running it elsewhere needs PostgreSQL binaries on `PATH` plus a Chromium install step. Stop the disposable cluster with `pnpm --filter @aicaa/web e2e:db:stop` when finished. Prerequisites, commands, coverage, and known gaps: [P1_2_BROWSER_HARNESS.md](P1_2_BROWSER_HARNESS.md).

### Reminder engine operations (A8 — deployed through Gate 5, not operational)

**No reminder has ever been sent, and no worker in this subsection is operational.** The distinction that matters after the incident is between _deployed_, _functional_, and _operational_: **A8 reminder code through A8.4b is deployed in Production** at `d369c6d` (Gate 5), including `POST /api/v1/internal/reminders/process`, the A8.3b Owner reminder routes, the Task-lifecycle reminder wiring, and the real overdue/advance Gmail transport behind the flag. Since the 1c schema repair and the 1d hotfix, **the A8.3b Owner reminder routes are functional**: `GET`, `PUT`, and `DELETE` all work against a real Task. Nothing else is live — **no scheduler job invokes the worker endpoint and `ENABLE_REMINDER_DELIVERY` is set in no environment.**

**The A8 persistence tables (`task_reminder_schedules`, `reminder_delivery_attempts`, and `tasks.due_local_date`) were applied to Production on 2026-08-04** by [A8.7b-INCIDENT-1c](#a87b-incident-1c--production-schema-compatibility-repair). Their absence was the incident, not a benign pending step, because the deployed code expected them and no flag guarded the Task path that reaches them. **The four remaining migrations were applied on 2026-08-05 by [Gate 4](#gate-4--production-migrations-69), so Production holds all fourteen.** Current state: [Current production state](#current-production-state). **Deploying the code that consumes them was [Gate 5](#gate-5--deploying-the-queued-a84ba86-code), which completed on 2026-08-05 and left Production at `D3` / `F0`.** [Gate 6](#gate-6--first-controlled-production-enablement-a87c-capture--f0--f1) did not complete, so Production remains at `F0`. Reminder delivery remains flag-disabled.

With that repair and the 1d hotfix in place, the A8.3b routes and the lifecycle wiring **are** functional, so the enablement gate below is not theoretical: **the Owner must not create or modify a reminder until the later rollout is authorized.**

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

### Owner notification worker (A8.5b–A8.5e — deployed, not operational)

**A8.5 and A8.6 code is deployed in Production as of Gate 5 (`d369c6d` / `dpl_6cVssNpaZeKPBEVGDynd61AoS9nS`) and remains inert.** All three A8 flags are absent, no notification scheduler job exists, and the endpoint has been invoked by nothing. The subsection below describes that deployed code.

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

**Counts against `owner_notification_intents` and `owner_notification_attempts` are valid in Production** — the A8.5a migration was applied by Gate 4. None of A8.5b, A8.5c, A8.5d, or A8.5e adds a migration of its own. After Gate 5 the tables exist and remain empty while capture stays absent from live Production.

## A8.7 production rollout

> **A8.7b as originally written is retired.** It was designed for a Production that served pre-A8 code against an unmigrated database. That premise was false. Production is serving **A8 code** against an unmigrated database, which is an incident rather than a starting point. The migrate-then-deploy rollout it described cannot be run, because the deploy already happened. Everything A8.7b covered is superseded by [A8.7b-INCIDENT-1c](#a87b-incident-1c--production-schema-compatibility-repair), which repairs the schema and deploys nothing.
>
> A8.7c, A8.7d, and A8.7e remain as written but now sit behind the repair, behind [Gate 4](#gate-4--production-migrations-69) — which applied the remaining migrations on 2026-08-05 and is complete — and behind [Gate 5](#gate-5--deploying-the-queued-a84ba86-code), which deployed the queued code on 2026-08-05 and is complete. **The first activation inside that path is [Gate 6](#gate-6--first-controlled-production-enablement-a87c-capture--f0--f1), which was authorized and partially executed on 2026-08-05 but did not complete: capture never became live. Stage 12, A8.7d, and A8.7e have not begun.**

**A8.7a contacted no production system.** Later authorized slices (1c, 1d, Gate 4, Gate 5, and the partial Gate 6 attempt) did, under their own authorizations, and their evidence is recorded. **No A8 feature flag is enabled in live Production** — the capture variable Gate 6 created was subsequently removed, and the deployment that carried it never held the public custom domain. Every flag-staging command below is an instruction to a future operator working under a separate authorization.

Read this section as a whole before starting any part of it. It is deliberately written so that the decision points are settled while nobody is under pressure.

### A8.7 slice structure

| Slice                 | Scope                                                                                                                                                                                                                                                   | Production contact                       |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| **A8.7a**             | Rollout preparation, recovery procedures, verification classification                                                                                                                                                                                   | **None**                                 |
| **A8.7b**             | **Retired.** Superseded by the incident slices below                                                                                                                                                                                                    | —                                        |
| **A8.7b-INCIDENT-1a** | Local PostgreSQL 17 rehearsal of the repair migration path. **Complete** ([evidence](A8_7B_INCIDENT_1A_EVIDENCE.md))                                                                                                                                    | **None**                                 |
| **A8.7b-INCIDENT-1b** | Incident runbook correction. **Complete**                                                                                                                                                                                                               | **None**                                 |
| **A8.7b-INCIDENT-1c** | Production schema compatibility repair — five migrations, no deployment. **Complete 2026-08-04**                                                                                                                                                        | Database only                            |
| **A8.7b-INCIDENT-1d** | Reminder endpoint hotfix on `ee5e82a`, deployed and validated. **Complete 2026-08-05**                                                                                                                                                                  | Deployment only                          |
| **A8.7b-INCIDENT-1e** | Documentation reconciliation after the hotfix. **This documentation**                                                                                                                                                                                   | **None**                                 |
| **Gate 4**            | Remaining four migrations — 6 through 9 — and nothing else. **Complete 2026-08-05** ([runbook](#gate-4--production-migrations-69))                                                                                                                      | Database only                            |
| **Gate 5**            | Deployment of the queued A8.4b–A8.6 code, reaching `D3` / `F0`. **Complete 2026-08-05** ([runbook](#gate-5--deploying-the-queued-a84ba86-code))                                                                                                         | Deployment only                          |
| **Gate 6**            | First controlled production enablement — `ENABLE_OWNER_EVENT_CAPTURE` only (`F0` → `F1`). **Authorized and partially executed 2026-08-05; incomplete and never live** ([runbook](#gate-6--first-controlled-production-enablement-a87c-capture--f0--f1)) | One environment variable, one deployment |
| **A8.7c**             | Owner-event capture enablement and observation (Stage 11 = Gate 6, **incomplete**; Stage 12 observation **prepared, unauthorized, unbegun** — [G12](#stage-12--capture-only-observation-a87c--f1))                                                      | One environment variable, one deployment |
| **A8.7d**             | Zero-send notification rehearsal, single-notification canary, Gmail-loop proof, notification scheduler creation                                                                                                                                         | Gmail send, scheduler creation           |
| **A8.7e**             | Reminder preflight, single-reminder canary, reminder scheduler creation                                                                                                                                                                                 | Recipient email, scheduler creation      |

**Each slice requires its own authorization.** A8.7d is the first slice in the project's history that can send mail on Rocket's initiative, and A8.7e is the first that can send mail to somebody who is not the Owner. Those are different thresholds and are deliberately not crossed in one slice.

### Current production state

**The incident is closed, and Production is at `D3` (`F0`).** The schema was repaired on 2026-08-04 by applying the five A8 migrations from `ee5e82a` in one `prisma migrate deploy` from the bounded worktree. The repair exposed a separate, pre-existing packaging defect in the reminder endpoint, which was fixed and validated on 2026-08-05. [Gate 4](#gate-4--production-migrations-69) then applied the remaining four migrations on 2026-08-05, moving Production from `D1′` to **`D2`**. [Gate 5](#gate-5--deploying-the-queued-a84ba86-code) deployed the queued A8.4b–A8.6 code on 2026-08-05, moving Production from `D2` to **`D3` / `F0`**. [Gate 6](#gate-6--first-controlled-production-enablement-a87c-capture--f0--f1) was authorized and partially executed the same day but **did not complete**, so capture never became live and Production never left `F0` via that path. **A later authorized Bearer promotion** placed the public Production alias on commit `eb8cabe` (Bearer Owner access on the Gate 5 F0 baseline) while leaving all three A8 flags **absent** and changing **no** cron — still **`F0`**. Bearer authentication was verified successfully before that promotion. Evidence: [A8_7_EVIDENCE.md § A8.7b-INCIDENT-1c](A8_7_EVIDENCE.md#a87b-incident-1c--production-schema-compatibility-repair), [§ A8.7b-INCIDENT-1d](A8_7_EVIDENCE.md#a87b-incident-1d--production-reminder-endpoint-hotfix), [§ Gate 4](A8_7_EVIDENCE.md#gate-4--production-migrations-69), [§ Gate 5](A8_7_EVIDENCE.md#gate-5--deploying-the-queued-a84ba86-code), [§ Gate 6](A8_7_EVIDENCE.md#gate-6--first-controlled-production-enablement-a87c-capture--f0--f1), and [BEARER_CANDIDATE_AUTH_SMOKE_EVIDENCE.md](BEARER_CANDIDATE_AUTH_SMOKE_EVIDENCE.md).

| Property                                           | Value                                                                                                                                                                                                                                                                                                                             |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Production commit                                  | `eb8cabe0619146087850802d4217dd8c3ce55119` — Bearer Owner access on the Gate 5 F0 baseline (`d369c6d` parent); tree `2e244a832b5715592e3aa46919deda5b9ea185de`                                                                                                                                                                    |
| Commit reachability                                | On `release/bearer-on-d369c6d`. **`d369c6d` is an ancestor**; **`534959d` is an ancestor** of that baseline through merge `68bedff`. **Not** an ancestor of local `main` or of `origin/main` (still `ee5e82a`) — see [commit ancestry](#commit-ancestry-of-the-deployed-hotfix)                                                   |
| Production deployment                              | `dpl_Cs2TrnDsy1KSB3wipCCUt82Hpf8D`, target `production`, state **READY**, provenance `rcGate=bearer-stage6`, **holds the public alias** `rocket-communicator-web.vercel.app`                                                                                                                                                      |
| Previous / Gate 5 F0 deployment                    | `dpl_6cVssNpaZeKPBEVGDynd61AoS9nS` (`d369c6d567c595ac0fb91b36744a2afb58717ecb`) — Gate 5 artifact; **no longer** holds the public alias after the Bearer promotion                                                                                                                                                                |
| Pre-Gate-5 deployment                              | `dpl_3oder2T3PuDYdmp8pezy6u7RwPRm` (`534959d`) — retained behind the Gate 5 artifact                                                                                                                                                                                                                                              |
| Gate 6 production-target deployment (**not live**) | `dpl_7X5r5ypWbq6ipmWMpver6p99p5Xz` — built successfully and **READY**, target `production`, carrying `ENABLE_OWNER_EVENT_CAPTURE` in its immutable environment snapshot. It received **only the two default `.vercel.app` aliases** and **never** the public custom domain, so nothing it contains has ever served public traffic |
| Production schema                                  | **All fourteen migrations — five pre-A8 plus all nine A8 — fourteen rows in `_prisma_migrations`.** Unchanged by Gate 5, by the partial Gate 6, and by the Bearer promotion                                                                                                                                                       |
| `ENABLE_OWNER_EVENT_CAPTURE`                       | Absent                                                                                                                                                                                                                                                                                                                            |
| `ENABLE_OWNER_EVENT_DELIVERY`                      | Absent                                                                                                                                                                                                                                                                                                                            |
| `ENABLE_REMINDER_DELIVERY`                         | Absent                                                                                                                                                                                                                                                                                                                            |
| Gmail                                              | **Connected.** No recorded sync run since 2026-07-20                                                                                                                                                                                                                                                                              |
| Scheduler jobs                                     | External, at cron-job.org. Gmail-poll and suggestion-processing both **disabled** as found; **no** notification job; **no** reminder job. **No cron changes** with the Bearer promotion                                                                                                                                           |
| Database credential                                | **Rotated 2026-08-04**, outside the approved plan. Vercel Production `DATABASE_URL` updated                                                                                                                                                                                                                                       |
| State                                              | **D3 / F0** — see the [state matrix](#approved-repair-state-matrix) and [flag-staging states](#flag-staging-states-a87ca87e). Code and schema aligned; every A8 feature inert; Bearer auth live on the public alias                                                                                                               |

> **Why Gate 6 is incomplete even though its deployment succeeded.** Gate 6 was explicitly authorized, `ENABLE_OWNER_EVENT_CAPTURE` was temporarily created in the Vercel Production environment, and the production-target deployment `dpl_7X5r5ypWbq6ipmWMpver6p99p5Xz` built and reached **READY** with that value baked into its immutable environment snapshot. A production-target build is not by itself the live site. The project has **`autoAssignCustomDomains=false`**, so a new deployment receives only the two default `.vercel.app` aliases and the public custom domain moves only by an **explicit alias assignment**. That assignment never occurred during Gate 6. The public custom domain therefore stayed on Gate 5's `dpl_6cVssNpaZeKPBEVGDynd61AoS9nS` through the Gate 6 window, whose own environment snapshot predates the capture flag, and **capture never became live on the public production site**. The capture variable was subsequently removed from the Vercel Production environment under separate authorization. **Gate 6 remains incomplete.** **Live Production later moved to the Bearer F0 successor** `dpl_Cs2TrnDsy1KSB3wipCCUt82Hpf8D` / `eb8cabe` and is still **`D3` / `F0`** — all three A8 flags absent. This record authorizes no production action.

**`D3` / `F0` is the designated safe harbour for flag staging, and that is structural rather than merely observed.** The queued A8 code (plus Bearer Owner access) is deployed against all fourteen migrations, and all three A8 flags remain absent, so capture writes nothing, the notification worker opens no database connection when both of its flags are absent, and reminder delivery constructs no transport. **Nothing about `F0` creates time pressure on [Gate 6](#gate-6--first-controlled-production-enablement-a87c-capture--f0--f1), Stage 12, A8.7d, or A8.7e.** **Owner Acceptance Week** remains the next formal product gate; **P2.2a** remains planning only and is not authorized for implementation.

##### Commit ancestry of the deployed hotfix

**This is the most misread fact in the record, so it is stated as four separate claims.** Every one has been verified mechanically.

- **`534959d` is an ancestor of local `main`.** Merge commit **`68bedff`** — "Merge remote-tracking branch `origin/hotfix/a8-7b-incident-1d-reminder-etag`" — brought the hotfix branch into `main`.
- **`534959d` is not an ancestor of `origin/main`.** The remote is still `ee5e82a`, which predates the hotfix, and nothing has been pushed.
- **Deploying current local `main` carries the reminder ETag fix forward.** It does not regress it, and the deployed reminder behaviour is preserved.
- **No cherry-pick and no rebase is required** to include the hotfix in a Gate 5 deployment.

> **⚠ An earlier revision of this document said the production commit was "not an ancestor of `main`".** That was true of `origin/main` only, and reading it as a statement about the local branch leads directly to a cherry-pick nobody needs — onto a branch that already contains the commit, producing a duplicate. Verify with `git merge-base --is-ancestor 534959d HEAD` rather than from memory.

**The original defect, for the record.** Production ran A8 code against a database holding only the five pre-A8 migrations. Task reads selected `tasks.due_local_date`, which did not exist; Task mutations called `reconcileReminderScheduleForTaskStatus`, which reads `task_reminder_schedules`, which did not exist; and no feature flag protected either path, because both sit on the ordinary Task path. Applying the five migrations removed all three conditions.

**The second defect, which the repair revealed rather than caused.** With the schema correct, `GET /api/v1/tasks/{taskId}/reminder` still answered `INTERNAL_ERROR` for every real Task while a nonexistent Task correctly answered `NOT_FOUND`. The cause was a build-time packaging fault, not a database fault: see [the runtime-value import hazard](#the-runtime-value-import-hazard). It had been latent since the routes were first deployed and would have been attributed to the migration by anyone reading the timeline, which is why it is recorded here rather than only in the evidence file.

**Validated in Production on 2026-08-05**, authenticated and read-only: the Task list loads, Task detail loads, `GET /api/v1/tasks/{taskId}/reminder` returns **200** with `state=no_due_date` and an ETag ending **`v0`**, and `GET /api/v1/tasks/task_doesnotexist000000/reminder` returns a typed **`NOT_FOUND`**. No reminder was created or modified.

**Items carried forward as follow-ups.** None is an open incident condition, and none blocks [Gate 6](#gate-6--first-controlled-production-enablement-a87c-capture--f0--f1):

- **Gate 4 deviation 3 was closed for Gate 5 purposes.** `Q1` was not run during the Gate 4 preflight; [G5.6](#g56-production-d2-baseline) required it and Gate 5 recorded `tasks.count.before = 7`. **[G6.4](#g64-production-f0-baseline) still requires a fresh baseline in the Gate 6 window.**
- **Gate 4 deviation 4 remains a standing evidence discipline.** Several capture fields were performed but never transcribed. **[G6.7](#g67-operator-notes--mistakes-already-paid-for) and [G6.13](#g613-evidence-recording) restate why a blank row is an incomplete record.**
- **No documented credential-rotation procedure exists.** The 2026-08-04 rotation followed none, because none is written. The [redeploy anomaly](A8_7_EVIDENCE.md#a87b-incident-1d--production-reminder-endpoint-hotfix) that the rotation produced is now moot operationally — the build in question no longer serves Production — but it was never explained.
- **`applied_steps_count` was never confirmed** on the ten migration rows at the time. **Closed by Gate 4**, which confirmed `applied_steps_count = 1` on all fourteen rows, the original ten included.
- **The second runtime-value import is fixed and deployed.** `PersistenceError` in `apps/web/lib/suggestions/process-service.ts` was resolved by A8.7b-INCIDENT-1j — see [the runtime-value import hazard](#the-runtime-value-import-hazard) — and shipped with [Gate 5](#gate-5--deploying-the-queued-a84ba86-code).
- **Gate 5 recorded five deviations** (alias assignment despite `--skip-domain`, cron-job.org unread, Smoke 12 skipped, CLI metadata without commit SHA, deploy-from-`apps/web` failure). None stopped the gate. **[G6.7](#g67-operator-notes--mistakes-already-paid-for) carries the operator-facing rules forward.**

### Approved repair state matrix

**Environment-variable changes affect only deployments created after the change.** A running deployment holds the values it was built and bound with; editing a variable in the Vercel dashboard does nothing until something redeploys. Correspondingly, **Instant Rollback restores the target deployment together with its original environment variables** — it does not re-bind current values onto an old build. Rolling back to a deployment built with a flag set restores that flag.

| State   | Code                                                        | Schema                     | Flags  | Meaning                                                                                                                                                                                                   |
| ------- | ----------------------------------------------------------- | -------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **D0**  | `ee5e82a`                                                   | five pre-A8 migrations     | none   | The incident state. **Left on 2026-08-04**                                                                                                                                                                |
| **D1**  | `ee5e82a`                                                   | pre-A8 + A8 migrations 1–5 | none   | **Schema-repaired but defective.** Held 2026-08-04 to 08-05. **Never a validated baseline**                                                                                                               |
| **D1′** | `534959d`                                                   | pre-A8 + A8 migrations 1–5 | none   | Reached 2026-08-05 by A8.7b-INCIDENT-1d. Schema and application validated. **Left the same day**                                                                                                          |
| **D2**  | `534959d`                                                   | all nine A8 migrations     | none   | Reached 2026-08-05 by [Gate 4](#gate-4--production-migrations-69). Schema ahead of code. **Left the same day** by Gate 5                                                                                  |
| **D3**  | queued A8 code (`d369c6d` family; live successor `eb8cabe`) | all nine A8 migrations     | none   | **Current state.** Reached 2026-08-05 by [Gate 5](#gate-5--deploying-the-queued-a84ba86-code); public alias now on Bearer F0 successor `eb8cabe` / `dpl_Cs2TrnDsy1KSB3wipCCUt82Hpf8D`. Equals `F0`        |
| **D4+** | later code and schema                                       | as required                | staged | Capture and delivery rollout (A8.7c, A8.7d, A8.7e) — not complete; [Gate 6](#gate-6--first-controlled-production-enablement-a87c-capture--f0--f1) / Stage 11 was partially executed and never became live |

**D1 and D1′ are deliberately separate rows.** `D1` was the state the repair was designed to reach, and Production genuinely occupied it for about a day — but the reminder endpoint answered `INTERNAL_ERROR` throughout, so `D1` was never a state anyone validated or would want to return to. Collapsing the two would let a future operator read a validated baseline into a commit that never had one.

Rules that follow from the binding model:

- **`D3` / `F0` is the flag-staging safe harbour** once the queued code is deployed: that code with every A8 feature inert. **It is also where live Production sits today**, on the Bearer F0 successor `dpl_Cs2TrnDsy1KSB3wipCCUt82Hpf8D` (`eb8cabe`), after an authorized promotion off Gate 5's `dpl_6cVssNpaZeKPBEVGDynd61AoS9nS`. [Gate 6](#gate-6--first-controlled-production-enablement-a87c-capture--f0--f1) never made capture live. **`534959d` remains the validated pre-`D3` code harbour** for a heavier code rollback, and sits behind Gate 5's `dpl_6cVssNpaZeKPBEVGDynd61AoS9nS`.
- **`D1′` is history, not a destination.** Production passed through it on 2026-08-05 and left it the same day when Gate 4 advanced the schema. **`D1′` is no longer reachable at all**, because reaching it would require unapplying migrations 6–9, and schema is forward-only.
- **`D2` is history, not the current state.** Production left it when Gate 5 deployed. Rolling Instant Rollback one step from current `D3` lands on `534959d` (`D2`-shaped code) — usable as containment, but it re-opens the `/attention` consumer gap Gate 5 closed.
- **No `D` state is reachable backwards by rollback.** Schema is reached only by forward migration, and a rollback moves code alone.
- **Rolling back one step from the pre-Gate-5 `D2` deployment landed on `ee5e82a`**, which reinstates the reminder defect and may do worse — see [Rollback principles](#rollback-principles). That path remains unavailable as a routine action.
- **Rolling back does not undo a migration.** Schema is forward-only, so the fourteen applied migrations survive anything done to the code.
- **Rollback does not disable external scheduler jobs.** cron-job.org keeps calling the endpoints. If the intent is to stop invocation, **pause the job** — a separate action in a separate system.
- **Rolling back does not unsend an email.**

### Repair boundary

The boundary is the single most important operational fact in the repair, so it is stated as rules rather than prose:

- **A8.7b-INCIDENT-1c applies exactly the five A8 migrations that exist at `ee5e82a`**, and no others:
  1. `20260731040000_a8_reminder_persistence`
  2. `20260731170000_a8_3b_reminder_concurrency`
  3. `20260731230000_a8_advance_waiting_skip`
  4. `20260801120000_a8_4a_worker_safety`
  5. `20260802094500_a8_4a_settlement_marker`
- **The operation must run from a detached worktree at `ee5e82a`.** That worktree contains exactly ten migration directories — the five pre-A8 plus the five above — so the boundary is enforced by construction rather than by operator discipline.
- **Running the migration from current HEAD is prohibited.** HEAD contains fourteen migration directories, and `prisma migrate deploy` has no way to apply a subset. Running it from HEAD would apply nine A8 migrations, not five.
- **Applying migrations 6 through 9 during the repair is prohibited.** They are: 6. `20260802173000_a8_4b1_capability_skip_reason` 7. `20260802210000_a8_4b2_repeated_ambiguous_stop_reason` 8. `20260803090000_a8_4b3_advance_due_scan_index` 9. `20260803120000_a8_5a_owner_notification_intents`
- **Phase-3 rehearsal evidence does not authorize Production application.** [A8.7b-INCIDENT-1a](A8_7B_INCIDENT_1A_EVIDENCE.md) proved migrations 6 through 9 apply cleanly on PostgreSQL 17. That is a statement about the migrations, not an authorization to run them. They support code that is not deployed and has not completed review.

### Containment

**Redeploying `8588c5d` is the universal code-containment option.** It is the last commit known to predate every A8 slice, so it cannot reference an A8 column or table regardless of what the schema contains.

Three qualifications, all of which matter:

- **It is not assumed to be reachable through one-step Instant Rollback.** The Hobby plan restricts rollback to the immediately previous deployment, and `8588c5d` is no longer that. Treat it as a **redeployment**, which is a different operation with a different failure mode.
- **Availability and redeployability must be confirmed read-only before execution**, not discovered during an incident. Confirm the deployment still exists and that the commit is still redeployable before relying on it.
- **No rollback or redeployment is authorized merely by documenting this option.** Recording a containment path is not the same as approving its use.

Containment is a code action. It does not repair the schema and it is not the preferred repair; **forward repair is**.

### Product-surface consequence of the repair

Applying the five migrations made real product surfaces functional that had never run in Production. This is a consequence of the repair, not a side effect to discover later:

- **The A8.3b Owner reminder APIs are operational.** An authenticated Owner can set a due date, create a reminder schedule, and modify or delete one.
- **Task-lifecycle reminder reconciliation is operational.** Completing, dismissing, or reassigning a Task will suspend, resume, or stop a schedule inside the Task's own transaction.

Both are bounded by one fact: **with zero reminder schedules, reconciliation is inert.** It looks up a schedule by Task, finds none, and returns without writing. A schedule can only come into existence through a deliberate, authenticated Owner reminder action — nothing creates one automatically, and D109 forbids historical due dates from auto-activating anything.

> **The Owner must not create or modify a reminder until the later A8 rollout is authorized.** This is the one behavioural restriction the repair imposes. It is a discipline, not a control: no flag enforces it, because the A8.3b surfaces carry no flag.

**Between 1c and 1d that discipline was redundant, and it no longer is.** The packaging defect made `currentReminderVersion(null)` throw, and every reminder verb reaches it for a Task with no schedule — `GET` through `noDueDateState`, `PUT` and `DELETE` through the pre-write projection. So all three failed, and the surface was accidentally protected by being broken. **The 1d hotfix removed that accidental protection along with the defect.** An authenticated Owner can now create a reminder in Production by clicking through the ordinary UI, and nothing in the system will stop them.

### Gmail and schedulers during the repair

- **Production Gmail is connected**, and it must **remain** connected. Disconnecting it is not part of the repair.
- **The repository cannot prove the external scheduler state.** cron-job.org is a separate system with no representation in this repository, so any statement here about which jobs exist or whether they are enabled would be a guess.
- **Read-only scheduler verification is required before the repair.** Inspect the dashboard and record what is actually there.
- **Any enabled Gmail-poll or suggestion-processing job must be paused before the migration**, because both reach the Task path that the missing schema breaks, and because a job firing mid-migration contends for the lock the migration needs.
- **No scheduler may be created, resumed, or invoked during the repair.** Leave the jobs exactly as found unless a later architecture decision explicitly authorizes restoring them.
- **The Gmail loop-proof procedure must be re-derived before A8.7d.** It was written against assumptions about the deployed code that the incident invalidated.

### Local credential safety for the repair

- **The normal main worktree contains a `packages/db/.env` that has pointed at Production.** It is gitignored, so it is invisible in review and survives branch changes.
- **The Production migration must not run from that worktree.** Prisma reads `.env` from the schema directory, so a bare command there can reach Production without the operator naming a host.
- **The detached `ee5e82a` worktree must contain no `.env`.** Because the file is gitignored it cannot be created by the checkout, which makes the safety structural. **Verify its absence anyway** before running anything.
- **The migration URL must be supplied process-scoped**, read into a shell variable that is not exported into history and passed to the single command that needs it.
- **Bare migration commands are prohibited.** `packages/db` exposes guarded `:local` scripts that refuse a non-loopback host; the unguarded `migrate:deploy`, `migrate:dev`, and `migrate:status` scripts have been removed so that no script can silently inherit a production `DATABASE_URL`.
- **Secrets must never appear in evidence.** Record the endpoint's classification — host form, port, session mode, absence of `pgbouncer=true` — never its value.

### A8.7b-INCIDENT-1c — Production schema compatibility repair

The operator-ready sequence. It replaces retired Stages 1 through 10. Every step is procedural; no step contains a credential.

**A note on worktree dependencies before you start.** A freshly created worktree has **no `node_modules`**, so `pnpm exec prisma` in it fails with `Command "prisma" not found`. Install the one workspace the repair needs, and do it **before** the Owner no-use window opens rather than inside it:

```bash
cd <worktree>
pnpm install --filter @aicaa/db --ignore-scripts
cd packages/db && pnpm exec prisma --version   # must report 6.19.3
```

This takes about a second against a warm pnpm store. It creates only ignored `node_modules`, so the worktree stays clean and stays `.env`-free — Prisma will print no `Environment variables loaded from .env` line, which is the visible confirmation that no file-borne credential is in play.

**Do not substitute `--schema <worktree>/packages/db/prisma/schema.prisma` run from the main repository.** It resolves the right migrations, but it executes inside a directory that **does** contain `packages/db/.env` and Prisma loads that file. Process-scoped variables still win on precedence, so it would work — and it would quietly reinstate the inherited-credential exposure the `.env`-free worktree exists to eliminate.

**A note on exit codes before you start.** `prisma migrate status` **exits non-zero when migrations are pending**. Before the repair it will exit 1 and list five pending migrations, and that is the expected, correct result — not a failure. Do not run these steps under `set -e` without accounting for it, and do not treat that exit code as a reason to stop. After the repair the same command exits 0.

| #   | Step                                                                                                                                                                                                                                                                                                                 |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Record the repository and deployment baseline: local HEAD, `origin/main`, `git status`, and the current Production deployment ID and commit                                                                                                                                                                          |
| 2   | Confirm the retained `8588c5d` containment deployment exists and is redeployable, read-only                                                                                                                                                                                                                          |
| 3   | Verify cron-job.org scheduler state, read-only, and record exactly what is there                                                                                                                                                                                                                                     |
| 4   | Pause any enabled Gmail-poll or suggestion-processing job                                                                                                                                                                                                                                                            |
| 5   | Establish an Owner no-use window — no Task creation, mutation, or reminder action for the duration                                                                                                                                                                                                                   |
| 6   | Create or verify a detached worktree at `ee5e82a`, outside the main repository directory                                                                                                                                                                                                                             |
| 7   | Verify the worktree holds **exactly ten** migration directories: the five pre-A8 and the five deployed A8                                                                                                                                                                                                            |
| 8   | Confirm the worktree contains **no** `packages/db/.env`, install its dependencies, and confirm the Prisma CLI resolves at `6.19.3`                                                                                                                                                                                   |
| 9   | Supply the Production migration URL as a process-scoped secret only                                                                                                                                                                                                                                                  |
| 10  | Verify the endpoint is the Supabase Shared Pooler in **session mode on port 5432**                                                                                                                                                                                                                                   |
| 11  | Verify the URL carries no `pgbouncer=true`                                                                                                                                                                                                                                                                           |
| 12  | Record the PostgreSQL version                                                                                                                                                                                                                                                                                        |
| 13  | Confirm **exactly five** rows in `_prisma_migrations` (Q2)                                                                                                                                                                                                                                                           |
| 14  | Confirm all five A8 physical objects remain absent: `tasks.due_local_date`, `task_reminder_schedules`, `reminder_delivery_attempts`, and both notification tables (Q5, Q7)                                                                                                                                           |
| 15  | Confirm no failed or unfinished migration row exists (Q3)                                                                                                                                                                                                                                                            |
| 16  | Review active database sessions using the [approved allowlist](#q4-allowlist) (Q4)                                                                                                                                                                                                                                   |
| 17  | Perform the out-of-band `tasks` lock probe (Stage 4)                                                                                                                                                                                                                                                                 |
| 18  | Reconfirm the schedulers are still paused                                                                                                                                                                                                                                                                            |
| 19  | **Immediately** repeat the activity and lock checks — steps 16 and 17 — so the window between checking and migrating is as small as possible                                                                                                                                                                         |
| 20  | Run **one** `prisma migrate deploy` invocation from the `ee5e82a` worktree, with the URL supplied process-scoped                                                                                                                                                                                                     |
| 21  | Verify **exactly ten** rows in `_prisma_migrations`, all finished, none rolled back, each with `applied_steps_count = 1`                                                                                                                                                                                             |
| 22  | Verify migrations 6 through 9 remain **absent** from `_prisma_migrations`, and run **QB** to prove no prohibited table, enum type, or enum label exists                                                                                                                                                              |
| 23  | Verify the required column, tables, constraints, indexes, enums, and RLS (Q5, Q6, Q7, Q9, Q10, Q11, Q12, Q13, Q14) against the [five-migration expectations](#five-migration-expectations-a87b-incident-1c) — **two** tables and **six** enums, not four and eleven — using the **two-table variant** in place of Q8 |
| 24  | Perform an authenticated **read-only** Task-list smoke test                                                                                                                                                                                                                                                          |
| 25  | Perform an authenticated **read-only** Task-detail smoke test                                                                                                                                                                                                                                                        |
| 26  | **Do not** perform a mutation smoke test unless separately authorized                                                                                                                                                                                                                                                |
| 27  | Leave the schedulers exactly as found unless architecture explicitly authorizes restoration                                                                                                                                                                                                                          |
| 28  | Record evidence in [A8_7_EVIDENCE.md](A8_7_EVIDENCE.md) §A8.7b-INCIDENT-1c                                                                                                                                                                                                                                           |
| 29  | **Do not push and do not deploy**                                                                                                                                                                                                                                                                                    |

Expected post-repair state is **D1**: `ee5e82a` code, pre-A8 plus A8 migrations 1–5, all flags absent, notification tables absent.

> **Executed 2026-08-04, and the whole of this subsection is now the historical procedure rather than pending work.** The five migrations were applied and verified. `D1` was reached and then found defective on the reminder path, so Production was moved to **`D1′`** the following day by A8.7b-INCIDENT-1d. Current state: [Current production state](#current-production-state).

**Expected duration.** The rehearsal applied the same five migrations in 853 ms against an empty database, with the `ACCESS EXCLUSIVE` migration taking 11 ms. Production's `tasks` table holds a single-digit row count and the added column is nullable with no default, so the operation is a catalog change rather than a rewrite. **If it has not completed within a few seconds, something is contending for the lock** — go to Stage 4's probe rather than waiting.

**On failure, stop.** Do not re-run, do not `migrate resolve` on the strength of `_prisma_migrations` alone, and do not hand-patch. Classify the physical state using the [per-migration recovery decision tree](#per-migration-recovery-decision-tree), which covers each of these five migrations individually.

### Gate 4 — Production migrations 6–9

> **✅ Executed 2026-08-05 under explicit Owner authorization. Gate 4 is complete and Production is at `D2`.** No stop condition fired. Evidence, including four recorded deviations: [A8_7_EVIDENCE.md § Gate 4](A8_7_EVIDENCE.md#gate-4--production-migrations-69). **The whole of this subsection is now the historical procedure rather than pending work**, retained unedited as the reference for what was executed and for any later dispute about it. **It is not a template for [Gate 5](#gate-5--deploying-the-queued-a84ba86-code)**, which is a deployment and runs no migration.

**Gate 4 applies A8 migrations 6 through 9 to the Production database and does nothing else.** No deployment, no environment variable, no feature flag, no scheduler job, no Gmail action, no application mutation. It is written out in full here so that an operator can execute it from this repository alone, with no reference to any conversation.

> **⚠ Gate 4 is not the five-migration repair.** The repair was [A8.7b-INCIDENT-1c](#a87b-incident-1c--production-schema-compatibility-repair): migrations **1 through 5**, from a detached **`ee5e82a`** worktree, executed **2026-08-04**, and it is history. Gate 4 is migrations **6 through 9**, from a detached worktree at **`68bedff`** or later, and it has **not been executed**. Every parameter differs — the worktree commit, the migration count, the number of history rows expected before and after, the lock that is taken, and which objects must exist afterwards. **Anything labelled A8.7b-INCIDENT-1c, and every `Stage 1` through `Stage 10`, describes the repair and must not be followed for Gate 4.**

**Where Gate 4 sits.** It moved Production from **`D1′`** to **`D2`** in the [state matrix](#approved-repair-state-matrix): the schema advanced to all nine A8 migrations while the code stayed on `534959d`. **[Gate 5](#gate-5--deploying-the-queued-a84ba86-code) — deploying the queued A8.4b–A8.6 code to reach `D3` — was a separate gate under separate authorization and is now complete.** [Gate 6](#gate-6--first-controlled-production-enablement-a87c-capture--f0--f1) (first flag activation) sits behind Gate 5. **Gate 4 authorized neither Gate 5 nor Gate 6.**

#### G4.1 Scope

| In scope                                                                                             | Out of scope                                                                               |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| One `prisma migrate deploy` applying exactly migrations 6, 7, 8, and 9                               | Applying any other migration, or re-applying migrations 1–5                                |
| Read-only Production preflight and post-migration verification SQL                                   | Any `INSERT`, `UPDATE`, `DELETE`, or `migrate resolve` not explicitly authorized in a stop |
| Recording evidence in [A8_7_EVIDENCE.md § Gate 4](A8_7_EVIDENCE.md#gate-4--production-migrations-69) | Deploying, promoting, or rolling back any Vercel deployment                                |
| Confirming the cron-job.org baseline read-only                                                       | Creating, resuming, or invoking any scheduler job                                          |
|                                                                                                      | Setting, unsetting, or editing any environment variable or feature flag                    |
|                                                                                                      | Any Owner or Recipient email, and any Gmail API call                                       |

**The four migrations, in application order.** This is the complete Gate 4 set:

1. `20260802173000_a8_4b1_capability_skip_reason`
2. `20260802210000_a8_4b2_repeated_ambiguous_stop_reason`
3. `20260803090000_a8_4b3_advance_due_scan_index`
4. `20260803120000_a8_5a_owner_notification_intents`

**All four are additive.** Migrations 6 and 7 add one enum label each, both `IF NOT EXISTS`. Migration 8 creates one partial index, `IF NOT EXISTS`. Migration 9 creates five enum types and two new tables with their constraints, indexes, and RLS. None drops anything, none alters an existing column, and **none has a down migration** — see the [per-migration recovery decision tree](#per-migration-recovery-decision-tree), entries 6 through 9, which are the authoritative recovery reference for this gate.

#### G4.2 Prerequisites

Every one of these must hold, and each must be confirmed rather than assumed:

- **A8.7b-INCIDENT-1c is complete and verified** — Production holds A8 migrations 1–5.
- **A8.7b-INCIDENT-1d is complete and validated** — Production serves `534959d`, and the reminder endpoint answers correctly.
- **Production PostgreSQL is major version 17**, confirmed in this window, not carried from an earlier record.
- **The Gate 4 migration SQL is byte-identical to the rehearsed files.** [A8.7b-INCIDENT-1a](A8_7B_INCIDENT_1A_EVIDENCE.md) rehearsed migrations 6–9 on local PostgreSQL 17. **That rehearsal is evidence about the migrations, not an authorization to run them.**
- **cron-job.org matches the recorded baseline**: a Gmail-poll job that exists and is inactive, a suggestion-processing job that exists and is inactive, **no** reminder-processing job, and **no** notification-processing job. Verify read-only and record what is actually there.
- **The three A8 flags are absent** in Vercel Production: `ENABLE_OWNER_EVENT_CAPTURE`, `ENABLE_OWNER_EVENT_DELIVERY`, `ENABLE_REMINDER_DELIVERY`.
- **The repository-non-mutating preflight is green** — see [verification gate classification](#1-repository-non-mutating-preflight).
- **The `8588c5d` containment deployment is confirmed redeployable, read-only**, before anything is applied.

#### G4.3 Owner authorization boundary

- **Gate 4 requires its own explicit Owner authorization.** Authorization for the repair, for the hotfix, or for this documentation does not carry into it.
- **Authorization is for one `migrate deploy` invocation against the four migrations named above.** It is not authorization to deploy, to promote, to change a flag, to create a scheduler job, or to write a row.
- **The [populated-table branch](#g49-the-populated-table-branch) requires a second, separate authorization** before any write, including a concurrent index build.
- **A stop is not a licence to improvise.** Recovery actions in the decision tree that mutate anything — `migrate resolve`, a corrective migration, dropping an invalid index — each require the Owner's authorization at the time, on the evidence of the physical state.
- **Gate 4 does not authorize Gate 5 or Gate 6.**

#### G4.4 Required worktree

**Create a new detached worktree, outside the main repository directory, at `68bedff`** — or at the exact later commit that carries this section, which is the commit this documentation slice produced. Both hold the same fourteen migration directories and the same migration SQL; use one of them and record which.

**The ten-migration worktrees must not be used.** Any existing `ee5e82a` worktree from the repair holds ten migration directories and cannot apply migrations 6–9 at all; a stale worktree is the single most likely way to run the wrong set. **Do not reuse, do not update, and do not `git checkout` inside one.** Create a fresh worktree for this gate.

Verify before anything else:

| Check                     | Requirement                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------------ |
| Worktree commit           | Exactly `68bedff` or the recorded later documentation commit, detached                           |
| Migration directory count | **Exactly fourteen** — the five pre-A8, the five applied A8, and the four Gate 4 migrations      |
| `packages/db/.env`        | **Absent.** It is gitignored, so a checkout cannot create it. Verify anyway rather than assuming |
| Dependencies              | `pnpm install --filter @aicaa/db --ignore-scripts` has been run in this worktree                 |
| Prisma CLI                | `pnpm exec prisma --version` reports **`6.19.3`**                                                |

```bash
cd <gate4-worktree>
git rev-parse HEAD
ls packages/db/prisma/migrations | grep -c '^2026'   # must be 14
test -e packages/db/.env && echo 'STOP: .env present' || echo 'ok: no .env'
pnpm install --filter @aicaa/db --ignore-scripts
cd packages/db && pnpm exec prisma --version         # must report 6.19.3
```

**Install dependencies before the [no-use window](#g46-owner-no-use-window) opens**, not inside it. A fresh worktree has no `node_modules`, so `pnpm exec prisma` fails with `Command "prisma" not found` until it does. The install creates only ignored output, so the worktree stays clean and stays `.env`-free — Prisma printing no `Environment variables loaded from .env` line is the visible confirmation that no file-borne credential is in play.

**Do not substitute `--schema <worktree>/packages/db/prisma/schema.prisma` run from the main repository.** It resolves the right migrations and executes inside a directory that **does** contain `packages/db/.env`, which Prisma loads — reinstating exactly the inherited-credential exposure the `.env`-free worktree exists to eliminate.

#### G4.5 Connection strategy

Unchanged from [Migration connection strategy](#migration-connection-strategy), and restated because Gate 4 must not be executed by reading a summary:

- **Supabase Shared Pooler**, **session** mode, port **`5432`**. Not the transaction-mode `6543` endpoint the application runtime uses.
- **No `pgbouncer=true`** in the query parameters. Its presence means the string came from the transaction-mode panel.
- **A fresh connection string taken after the 2026-08-04 credential rotation.** Any string predating the rotation is stale.
- **Copy one whole string from the Supabase Connect dialog.** **Never recombine a host from one string with a port from another** — that is the A7 incident, and it is how the wrong endpoint gets used while every check appears to pass.
- **Supply it process-scoped** with the `read -rs` pattern in [Secure migration-command handling](#secure-migration-command-handling), passed to the single command that needs it, and `unset` afterwards.
- **Never run from the main worktree's gitignored `packages/db/.env`.** It has pointed at Production, it survives branch changes, and it is invisible in review.
- **Record the endpoint's classification only** — host form, port, session mode, absence of `pgbouncer=true`. Never the value.

Apply the three checks in [Migration endpoint verification](#migration-endpoint-verification) — hostname form, port, `pgbouncer=true` — and the advisory-lock session test, remembering that the lock test is supporting evidence and not proof of session mode.

#### G4.6 Owner no-use window

**Open the window before the preflight and hold it until post-migration verification is complete.** For its whole duration:

- **The Owner performs no reminder creation, modification, or deletion** — no `PUT` or `DELETE /api/v1/tasks/{taskId}/reminder`, and no use of the reminder panel on a Task page.
- **The Owner performs no Task mutation**, because Task lifecycle transitions call reminder reconciliation inside the Task's own transaction.
- **Every Rocket Communicator cron job stays inactive** at cron-job.org. None is created, resumed, or edited.
- **No scheduler endpoint is invoked manually** — not the Gmail poll, not suggestion processing, not reminder processing, not notification processing.
- **No Production reminder write occurs**, from any surface, by anyone.

> **The reminder write path is functional in Production, so emptiness must not be assumed.** Between 1c and 1d the packaging defect made every reminder verb fail, and the surface was accidentally protected by being broken. **The 1d hotfix removed that protection along with the defect.** An authenticated Owner can now create a reminder schedule by clicking through the ordinary UI, and no flag stands in the way. This is why Gate 4 measures `task_reminder_schedules` rather than asserting it is empty.

**Confirm the window held.** Re-run the row count in [G4.8](#g48-lock-risk-checks) immediately before the migration, and confirm it is unchanged after.

#### G4.7 Preflight and the exact pending set

Read-only. Run in this order and record every result.

**1. Migration-history baseline.** Run **Q2**. Before Gate 4 the history must hold **exactly ten** rows, every one with a non-null `finished_at`, a null `rolled_back_at`, and `applied_steps_count = 1`, and **the ten names must be exactly these**:

| #   | Migration name                                    |
| --- | ------------------------------------------------- |
| 1   | `20260713190000_a4_persistence_foundation`        |
| 2   | `20260716140000_a5_gmail_persistence`             |
| 3   | `20260717180000_a6_suggestion_persistence`        |
| 4   | `20260718210000_a7_handoff_persistence`           |
| 5   | `20260718223000_a7_handoff_concurrency_hardening` |
| 6   | `20260731040000_a8_reminder_persistence`          |
| 7   | `20260731170000_a8_3b_reminder_concurrency`       |
| 8   | `20260731230000_a8_advance_waiting_skip`          |
| 9   | `20260801120000_a8_4a_worker_safety`              |
| 10  | `20260802094500_a8_4a_settlement_marker`          |

**A matching count with a non-matching name set is a hard stop.** Ten rows is a weaker statement than the right ten rows, and only the second one bounds what `migrate deploy` will do.

**2. Failed-row check.** Run **Q3**. **Zero rows.** Any row is a hard stop into the [recovery tree](#per-migration-recovery-decision-tree).

**3. `applied_steps_count`.** Confirm it is `1` on all ten rows. It was never confirmed during 1c and is carried forward as an open item, so Gate 4 confirms it rather than inheriting it.

**4. PostgreSQL version.** Confirm major version **17** in this window.

**5. The exact pending set.** From the Gate 4 worktree:

```bash
cd <gate4-worktree>/packages/db
DATABASE_URL="$MIGRATE_URL" pnpm exec prisma migrate status
```

It must report **exactly four** pending migrations, and they must be the four named in [G4.1](#g41-scope) — no more, no fewer, no others. **`migrate status` exits 1 when migrations are pending**, which is the expected result here and not a failure. **Anything other than exactly those four is a hard stop**: fewer means something applied part of the set, more means the worktree is not the one this gate specifies.

**6. Session activity.** Run **Q4** and judge every session against the [Q4 allowlist](#q4-allowlist).

**7. Row counts that must not change.** Run **Q1** (`tasks`) and **QR** (below), and keep both for the after-comparison.

#### G4.8 Lock-risk checks

**The table at risk in Gate 4 is `task_reminder_schedules`, not `tasks`.** No Gate 4 migration touches `tasks` at all. This is the single most important difference between Gate 4's preflight and the repair's, and reading the repair's `tasks` probe as if it applied here would probe a table no Gate 4 statement locks while leaving the one that matters unchecked.

**Migration 8 uses a non-concurrent `CREATE INDEX`.** `CREATE INDEX IF NOT EXISTS "task_reminder_schedules_advance_due_scan_idx"` takes a **`SHARE`** lock on `task_reminder_schedules` and holds it for the whole build, which **blocks every write to that table for the duration** while allowing reads. It is deliberately not `CREATE INDEX CONCURRENTLY`: a concurrent build cannot run inside `prisma migrate deploy` and would need its own separately designed procedure. Migration 9 creates only new tables, so it can block nothing that already exists.

**QR — pre-migration row count for `task_reminder_schedules`.** Run this before the migration, and again afterwards:

```sql
SELECT
  count(*) AS schedules,
  count(*) FILTER (WHERE status = 'active') AS active_schedules
FROM task_reminder_schedules;
```

Evidence field `gate4.schedules.before` / `.after`. **Zero is the expected value and is what makes migration 8 instantaneous.** A non-zero value routes to the [populated-table branch](#g49-the-populated-table-branch) — it is not, by itself, evidence of a fault, because the reminder write path is functional.

**The Gate 4 lock probe.** Out of band, in a separate `psql` session, immediately before the migration:

```sql
SET lock_timeout = '5s';
BEGIN;
LOCK TABLE task_reminder_schedules IN SHARE MODE;
ROLLBACK;
```

It acquires the same lock class migration 8 needs, changes no schema and no data, and is rolled back immediately. It answers one question: can that lock be taken right now, quickly?

- **Verification.** The `LOCK` returns promptly and the `ROLLBACK` completes.
- **A timeout means postpone Gate 4.** Do not retry in a loop. Return to **Q4** and find out what is holding the table, remembering that a lock request queues behind existing holders and blocks everything arriving after it.
- **Containment.** The `ROLLBACK` is part of the procedure rather than a response to failure. If the session is interrupted between `BEGIN` and `ROLLBACK`, end the session — disconnecting releases the lock.
- Evidence field `gate4.lock_probe` — acquired promptly, or timed out with the wait duration.

**Repeat the activity check and the lock probe immediately before running `migrate deploy`**, so the window between checking and migrating is as small as possible. A check from ten minutes ago is not evidence about now.

#### G4.9 The populated-table branch

**Decision, taken in advance so nobody has to take it under pressure:**

| `task_reminder_schedules` | Action                                                                                                                            |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **Empty** (QR = 0)        | **Proceed** with migration 8 exactly as committed. The `SHARE` lock is instantaneous on an empty table                            |
| **Any rows** (QR > 0)     | **Stop the normal path.** Do not run `migrate deploy`. The forward-fix path below requires **separate Owner authorization** first |

**The committed migration is not modified in either case.** Editing an applied-or-pending migration file changes its recorded checksum and breaks `migrate deploy` on every database that already applied it, so the forward fix works _around_ migration 8 rather than changing it.

**The approved recovery/forward-fix path, once separately authorized:**

1. **Build the intended index out of band, concurrently**, so no write is blocked:

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS "task_reminder_schedules_advance_due_scan_idx"
  ON "task_reminder_schedules"("advance_occurrence_at", "id")
  WHERE "status" = 'active' AND "advance_disposition" = 'scheduled';
```

2. **Verify the index definition matches the migration exactly** — same name, same table, same column order, same partial predicate, and `indisvalid = true`:

```sql
SELECT indexdef FROM pg_indexes
 WHERE tablename = 'task_reminder_schedules'
   AND indexname = 'task_reminder_schedules_advance_due_scan_idx';
SELECT x.indisvalid FROM pg_index x JOIN pg_class i ON i.oid = x.indexrelid
 WHERE i.relname = 'task_reminder_schedules_advance_due_scan_idx';
```

3. **Then run `migrate deploy`**, letting migration 8's `CREATE INDEX IF NOT EXISTS` no-op over the index that already exists.

**Constraints on that path:**

- **`CREATE INDEX CONCURRENTLY` cannot run inside a transaction block**, and a failed concurrent build leaves an **invalid** index that must be dropped — `DROP INDEX CONCURRENTLY` — before rebuilding. An invalid index left in place would satisfy `IF NOT EXISTS` while serving nothing.
- **A definition that differs in any respect is a hard stop.** `IF NOT EXISTS` matches on name alone, so a wrongly-defined index would silently become the permanent one.
- **Nothing in this branch is performed or rehearsed by the documentation slice that wrote it.** It is a documented, pre-approved shape awaiting an authorization that does not yet exist.

#### G4.10 Migration command

**One invocation. From `packages/db` inside the Gate 4 worktree. Never from the main worktree.**

```bash
cd <gate4-worktree>/packages/db
DATABASE_URL="$MIGRATE_URL" pnpm exec prisma migrate status
DATABASE_URL="$MIGRATE_URL" pnpm exec prisma migrate deploy
DATABASE_URL="$MIGRATE_URL" pnpm exec prisma migrate status
```

- `prisma` is invoked directly because the unguarded package scripts have been removed and the remaining `:local` scripts refuse a non-loopback host by design.
- **Expected exit codes.** The first `migrate status` exits **1** (four pending). `migrate deploy` exits **0**. The final `migrate status` exits **0** and reports the schema up to date.
- **Expected duration.** Sub-second to a few seconds. The rehearsal applied these four cleanly on PostgreSQL 17, and against an empty `task_reminder_schedules` the index build is a catalog change rather than a scan. **If it has not completed within a few seconds, something is contending for the lock** — stop and investigate rather than waiting.
- **Keep the full console output.** It is the primary evidence of which file failed, if one does.
- **Do not re-run on failure.** Go to [G4.12](#g412-stop-conditions).

#### G4.11 Post-migration verification

**This is the authoritative post-Gate-4 expectation. It replaces the [five-migration expectations](#five-migration-expectations-a87b-incident-1c) for everything after Gate 4, and the sense of every notification-object check is inverted.**

**Migration history, after Gate 4:**

- **Exactly fourteen rows** in `_prisma_migrations`.
- **All fourteen have a non-null `finished_at`.**
- **All fourteen have a null `rolled_back_at`.**
- **All fourteen have `applied_steps_count = 1`.**
- **Migrations 6–9 are present**, by exact name, and the ten baseline names from [G4.7](#g47-preflight-and-the-exact-pending-set) are still present and unchanged.
- **Q3 returns zero rows.**

**Fourteen-migration expectations (Gate 4).** Every object below must be **present** after Gate 4. This is the exact inversion of the repair's boundary assertion, which required these same objects to be absent:

| Object                                                                                                                                                                        | After Gate 4                         |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `owner_notification_intents` (migration 9)                                                                                                                                    | **present**                          |
| `owner_notification_attempts` (migration 9)                                                                                                                                   | **present**                          |
| `OwnerNotificationEventType`, `OwnerNotificationSubjectKind`, `OwnerNotificationState`, `OwnerNotificationSuppressionReason`, `OwnerNotificationAttemptOutcome` (migration 9) | **present** — all five               |
| `ReminderSkipReason` label `no_actionable_capability` (migration 6)                                                                                                           | **present**                          |
| `ReminderScheduleStopReason` label `repeated_ambiguous_outcomes` (migration 7)                                                                                                | **present**                          |
| `task_reminder_schedules_advance_due_scan_idx` (migration 8)                                                                                                                  | **present**, `indisvalid = true`     |
| RLS on `owner_notification_intents` and `owner_notification_attempts`                                                                                                         | **enabled on both**                  |
| RLS **policies** on the two new tables                                                                                                                                        | **zero** — deny-by-default, approved |
| Unvalidated constraints **in the `public` schema**                                                                                                                            | **zero**                             |
| Rows in either new table                                                                                                                                                      | **zero**                             |
| `tasks`, `task_reminder_schedules` row counts                                                                                                                                 | **unchanged** from Q1 and QR before  |

**Zero RLS policies is the approved expected state, not an omission.** Migration 9 enables row-level security on both tables and creates no policy, which denies all access through the anon and authenticated keys; the application reaches these tables only through the service role. **A policy that nobody authorized is a hard stop**, and so is RLS not being enabled.

**QG — the Gate 4 positive assertion.** Run it and record it. It is the mirror image of [QB](#five-migration-expectations-a87b-incident-1c), which asserted the same objects were absent:

```sql
SELECT
  (SELECT count(*) FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name IN ('owner_notification_intents','owner_notification_attempts')) AS notification_tables,
  (SELECT count(*) FROM pg_type WHERE typname LIKE 'OwnerNotification%') AS notification_enums,
  (SELECT count(*) FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
     WHERE t.typname = 'ReminderSkipReason' AND e.enumlabel = 'no_actionable_capability') AS m6_label,
  (SELECT count(*) FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
     WHERE t.typname = 'ReminderScheduleStopReason' AND e.enumlabel = 'repeated_ambiguous_outcomes') AS m7_label,
  (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relname IN ('owner_notification_intents','owner_notification_attempts')
       AND c.relrowsecurity) AS rls_enabled,
  (SELECT count(*) FROM pg_policies WHERE schemaname = 'public'
     AND tablename IN ('owner_notification_intents','owner_notification_attempts')) AS notification_policies,
  (SELECT count(*) FROM pg_constraint c
     JOIN pg_class r ON r.oid = c.conrelid
     JOIN pg_namespace n ON n.oid = r.relnamespace
     WHERE NOT c.convalidated AND n.nspname = 'public') AS unvalidated_constraints;
```

Expected **`2, 5, 1, 1, 2, 0, 0`**. Evidence field `gate4.objects_present`. **Any other result is a hard stop.**

**The unvalidated-constraint term is scoped to `public` deliberately.** `pg_constraint` is cluster-wide, and a Supabase-managed database carries an unvalidated constraint in the managed `realtime` schema that no migration in this repository creates, controls, or may validate. An unscoped count therefore returns **1 on a perfectly healthy Production database**, which under a literal reading is a hard stop on a correct gate. **Gate 4 hit exactly that on 2026-08-05** and recorded both readings rather than halting — see [A8_7_EVIDENCE.md § Gate 4](A8_7_EVIDENCE.md#gate-4--production-migrations-69), deviation 2. Scoping narrows the check without weakening it: an unvalidated constraint on an application table is still a hard stop, and it is the only kind this gate can cause. **Do not widen this back to every schema** — doing so reintroduces a guaranteed false stop inside a live Owner no-use window.

**Also run, with their after-Gate-4 readings:** **Q2**, **Q3**, **Q7** (all four tables), **Q8** (`0, 0, 0, 0` — the full four-statement form is runnable for the first time), **Q9** (four rows, `relrowsecurity = true` on all four), **Q11** (every named constraint from the recovery tree, each `convalidated = true`), **Q12** (all eleven enum types, plus the **two** labels this gate adds — `no_actionable_capability` from migration 6 and `repeated_ambiguous_outcomes` from migration 7; `skipped_waiting_elapsed` is already present from the repair), **Q13** (every named index, each `indisvalid = true`), **Q1** and **QR** for the unchanged-count comparison.

**Q11 and Q13 are name checks, and the names are published.** The two new tables contribute **fifteen named constraints** and **eight index rows** — six created explicitly plus two primary-key indexes — all listed in [recovery-tree entry 9](#per-migration-recovery-decision-tree). Check them by name against that inventory. **A count alone does not distinguish a complete migration 9 from a partial one that stopped part-way through its constraints.**

**Do not run Q15 through Q21.** They describe capture and canary states that presuppose flags Gate 4 does not set. They will now execute rather than error, and they will report zeroes that mean nothing yet.

**No unexpected data writes.** `Q1` and `QR` unchanged, `Q8` all zero, and `Q6` still exactly `0`. **Any change is a hard stop** — Gate 4's migrations backfill nothing and rewrite no row.

#### G4.12 Stop conditions

**Each of these is a hard stop. Stop means: stop, record the physical state, and obtain a decision — not proceed carefully.**

| #   | Condition                                                                                                                                        |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | The working tree or the Gate 4 worktree is not at the expected commit, or is not clean                                                           |
| 2   | The worktree's migration directory count is not **fourteen**                                                                                     |
| 3   | `packages/db/.env` exists in the Gate 4 worktree                                                                                                 |
| 4   | `pnpm exec prisma --version` reports anything other than **`6.19.3`**                                                                            |
| 5   | The baseline migration **names** do not match the expected ten exactly                                                                           |
| 6   | The baseline row count in `_prisma_migrations` is not **ten**                                                                                    |
| 7   | Any baseline row is unfinished, rolled back, or has `applied_steps_count != 1`                                                                   |
| 8   | `migrate status` reports anything other than **exactly the four expected pending migrations**                                                    |
| 9   | Production PostgreSQL major version is not **17**, or is not confirmed in this window                                                            |
| 10  | cron-job.org state differs from the recorded baseline — both jobs inactive, no reminder job, no notification job                                 |
| 11  | `task_reminder_schedules` is populated **and** the [concurrent-index branch](#g49-the-populated-table-branch) has not been separately authorized |
| 12  | The lock probe on `task_reminder_schedules` does not return promptly                                                                             |
| 13  | `prisma migrate deploy` exits non-zero                                                                                                           |
| 14  | An advisory-lock acquisition timeout occurs                                                                                                      |
| 15  | The post-migration row count in `_prisma_migrations` is not **fourteen**                                                                         |
| 16  | Any post-migration verification differs from the expected object set in [G4.11](#g411-post-migration-verification)                               |
| 17  | Any unexpected write, or any scheduler activity, occurs during the window                                                                        |

**After any stop:**

- **Do not rerun blindly.** A second `migrate deploy` against an unclassified physical state is how a partial application becomes a permanent one.
- **Do not call `migrate resolve` on the strength of `_prisma_migrations` alone.** That row records what Prisma believes, and a stop means Prisma's belief and the database may disagree. **Inspect the physical schema; what is actually present is the only authority.**
- **Do not hand-patch.** An object created by hand differs from the migration in some constraint nobody notices until a worker violates it.
- **Follow the [per-migration recovery decision tree](#per-migration-recovery-decision-tree)**, entries 6 through 9, using its three physical-state classifications. Escalate anything that does not match a documented case exactly.
- **Waiting costs nothing.** No Gate 4 migration is required by the deployed code, and Production is validated in `D1′` without them.

#### G4.13 Containment and rollback posture

- **Gate 4 leaves Production code on `534959d`.** Nothing is deployed, promoted, or rolled back, and the deployment ID must be unchanged from before the gate to after it.
- **`D2` is a safe resting state.** Schema ahead of code is safe here because all four migrations are additive: migrations 6 and 7 add enum labels the deployed code never names, migration 8 adds an index that changes no result, and migration 9 creates two tables the deployed code never queries — `ENABLE_OWNER_EVENT_CAPTURE` is evaluated before the mutation transaction opens, and it is absent. **Production may remain in `D2` indefinitely.**
- **There is no down migration, and rolling back code does not unapply a migration.** Schema is forward-only.
- **The correct response to a problem is to stop before deployment, not to roll back the schema.** Nothing in Gate 4 is made better by a schema reversal, and a hand-written reversal is a new, unreviewed migration written under pressure.
- **One-step Vercel rollback is not a safe containment option.** The one-step target, `dpl_AnUKqdGj3gBw7N56yUT4pMBAVbac` (`ee5e82a`), reinstates the reminder defect **and** restores a pre-rotation `DATABASE_URL` binding, which may be a total database outage rather than a reminder regression — see [Rollback principles](#rollback-principles). **Treat one-step rollback as unavailable.**
- **Preserving the validated hotfix matters.** `534959d` lives only on `hotfix/a8-7b-incident-1d-reminder-etag` and is **not an ancestor of `main`**. Do not delete that branch, prefer tagging the commit, and keep the ability to rebuild and redeploy it — it is the only validated pre-`D3` application state.
- **Universal code containment remains a redeployment of `8588c5d`**, confirmed redeployable read-only first, and never assumed to be one step back.
- **Schedulers stay inactive.** Rollback does not pause a cron job, and Gate 4 resumes none.

#### G4.14 Stop before Gate 5

**Gate 4 ends at verified `D2` plus recorded evidence.** When the post-migration checks pass:

1. Record the evidence in [A8_7_EVIDENCE.md § Gate 4](A8_7_EVIDENCE.md#gate-4--production-migrations-69), which has its own capture record, including the worktree commit, the four applied names, the fourteen-row history, `QG`, and the unchanged counts. **Do not record Gate 4 in the 1c capture record** — its rows require the notification objects to be absent, so a correct Gate 4 filled into it reads as a boundary violation.
2. Close the Owner no-use window.
3. **Stop.**

**Explicitly not authorized by Gate 4, and not to be started on its completion:**

- **Gate 5** — deploying the queued A8.4b–A8.6 code, or pushing local commits to `main`. **A push to `main` deploys automatically and would replace the deployment serving `534959d`**, so pushing is a deployment decision, not a repository one.
- **Gate 6 and later** — A8.7c capture enablement, A8.7d notification delivery and the Gmail gate, A8.7e reminder delivery.
- Setting any A8 flag, creating any scheduler job, or invoking any worker endpoint.

### Gate 5 — Deploying the queued A8.4b–A8.6 code

> **✅ Executed 2026-08-05 under explicit Owner authorization. Gate 5 is complete and Production is at `D3` (`F0`).** No stop condition fired. Evidence, including five recorded deviations: [A8_7_EVIDENCE.md § Gate 5](A8_7_EVIDENCE.md#gate-5--deploying-the-queued-a84ba86-code). **The whole of this subsection is now the historical procedure rather than pending work**, retained as the reference for what was executed. **It does not authorize [Gate 6](#gate-6--first-controlled-production-enablement-a87c-capture--f0--f1).**

**Gate 5 deploys the queued A8.4b–A8.6 code to Production and does nothing else.** No migration, no environment variable, no feature flag, no scheduler job, no Gmail action, no database write. It moves Production from **`D2`** to **`D3`** in the [state matrix](#approved-repair-state-matrix): the code catches up to a schema that is already ahead of it, and every A8 feature stays inert because all three flags remain absent.

> **⚠ Gate 5 is a deployment, not a migration.** Gate 4 was database-only and applied migrations 6–9; it is complete and it is history. Gate 5 touches **no database object at all** — every SQL statement in it is read-only, and **no migration runs at any point, including during the build**. An operator who reaches for `prisma migrate deploy` during Gate 5 is following the wrong gate. Everything labelled `G4.x`, `Stage 1` through `Stage 10`, and `A8.7b-INCIDENT-1c` describes database work and must not be followed here.

**Why the ordering is this way round.** The queued code reads objects that only migrations 6–9 create — most visibly `/attention`, whose second section queries `owner_notification_intents` on every load. Deploying it before Gate 4 would have recreated the original incident in a worse form: a navigable Owner page failing to its error boundary rather than one API route returning `INTERNAL_ERROR`. Gate 4 is what made Gate 5 safe, and **completing Gate 4 did not make Gate 5 due.**

#### G5.1 Scope

| In scope                                                                                                      | Out of scope                                                                         |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| One production-target `vercel deploy --prod --skip-domain --yes` from a clean worktree at the selected commit | Any migration, `migrate deploy`, `migrate resolve`, or schema change whatsoever      |
| Inspecting that deployment before it serves any aliased traffic                                               | Promoting a **preview-target** deployment, under any circumstances                   |
| One `vercel promote` assigning the production domain                                                          | `git push origin main`, which deploys automatically and removes the inspection gate  |
| Read-only post-deploy smoke checks and read-only row counts                                                   | Any `INSERT`, `UPDATE`, or `DELETE`, and any Owner reminder creation or modification |
| Recording evidence in [A8_7_EVIDENCE.md § Gate 5](A8_7_EVIDENCE.md#gate-5--deploying-the-queued-a84ba86-code) | Setting, unsetting, or editing any environment variable or feature flag              |
| Confirming the cron-job.org baseline read-only                                                                | Creating, resuming, or invoking any scheduler job, or calling any worker endpoint    |
|                                                                                                               | Any Owner or Recipient email, and any Gmail API call                                 |
|                                                                                                               | Gate 6 — A8.7c capture, A8.7d notification delivery, A8.7e reminder delivery         |

#### G5.2 Prerequisites

Every one of these must hold, and each must be confirmed rather than assumed:

- **Gate 4 is complete and verified** — Production is at **`D2`**: fourteen rows in `_prisma_migrations`, all four notification and reminder objects present. Evidence: [A8_7_EVIDENCE.md § Gate 4](A8_7_EVIDENCE.md#gate-4--production-migrations-69).
- **Production serves `534959d`** and the reminder endpoint answers correctly. This is the rollback baseline, and it must be the starting deployment.
- **The three A8 flags are absent** in Vercel Production: `ENABLE_OWNER_EVENT_CAPTURE`, `ENABLE_OWNER_EVENT_DELIVERY`, `ENABLE_REMINDER_DELIVERY`. **Gate 5 does not change this, and a flag found present is a hard stop** — it would mean the deployed code activates a subsystem in the same step that first ships it.
- **cron-job.org matches the recorded baseline**: a Gmail-poll job that exists and is inactive, a suggestion-processing job that exists and is inactive, **no** reminder-processing job, and **no** notification-processing job. Verify read-only and record what is actually there. The queued code adds `/api/v1/internal/notifications/process`, and **nothing may invoke it.**
- **`pnpm verify` is green at the selected commit**, run **before** the deployment window opens. It runs `contracts:generate` and `contracts:check-drift`, so it may rewrite tracked generated artifacts — a rollout window is not the moment to discover a generator produced a different byte sequence. See [full development verification](#2-full-development-verification).
- **The production bundle guards pass against a real local production build.** Build with the effective Vercel production path and assert that no externalized-package value appears in `.next/server` as an undeclared free variable. **Unit tests structurally cannot detect this** — Vitest resolves `@aicaa/db` directly, so the binding is present in every test and absent only in the artifact that ships. See [the runtime-value import hazard](#the-runtime-value-import-hazard).
- **The nine PostgreSQL concurrency suites pass at the selected commit** — see [G5.3](#g53-the-nine-postgresql-suites).
- **The `8588c5d` containment deployment is confirmed redeployable, read-only**, before anything is deployed.
- **The repository-non-mutating preflight is green** — see [verification gate classification](#1-repository-non-mutating-preflight).

#### G5.3 The nine PostgreSQL suites

**Run all nine at the selected commit before Gate 5 is authorized.** They are opt-in, they skip themselves without `AICAA_PG_CONCURRENCY_URL`, and `pnpm verify` therefore never runs them — so a green `pnpm verify` says nothing about any of them.

| Suite                                                             |
| ----------------------------------------------------------------- |
| `apps/web/__tests__/a8-5e-worker-concurrency.pg.test.ts`          |
| `apps/web/__tests__/owner-reminder-concurrency.pg.test.ts`        |
| `apps/web/__tests__/reminder-advance-waiting-skip.pg.test.ts`     |
| `apps/web/__tests__/reminder-worker-concurrency.pg.test.ts`       |
| `packages/db/__tests__/a8-4a-occurrence-concurrency.pg.test.ts`   |
| `packages/db/__tests__/a8-5a-owner-notification.pg.test.ts`       |
| `packages/db/__tests__/a8-5b-notification-concurrency.pg.test.ts` |
| `packages/db/__tests__/a8-5d-producer-concurrency.pg.test.ts`     |
| `packages/db/__tests__/a8-6c-missed-notification-read.pg.test.ts` |

Three reasons this is a Gate 5 prerequisite rather than a nicety:

- **They have never been run together at the deployment commit.** Each was written and recorded at its own slice, and nine slices of A8 work have landed since the earliest of them.
- **Every recorded result was obtained on PostgreSQL 16.** `docker-compose.yml` now pins `postgres:17`, which matches the Production major version, so running them here is the first time this evidence exists on the version Production actually runs.
- **`a8-6c-missed-notification-read.pg.test.ts` covers the surface with the least Production evidence** — the query behind `/attention` section two, against tables Gate 4 created days earlier.

```bash
pnpm db:docker:up
# Both variables take the local loopback container URL. Its shape is documented in
# `docker-compose.yml` and `.env.example`; it is not reproduced here, because this file
# records no connection string of any kind. The host must be loopback and the port 5433.
export AICAA_LOCAL_DATABASE_URL='<local loopback container URL>'
export AICAA_PG_CONCURRENCY_URL="$AICAA_LOCAL_DATABASE_URL"
pnpm db:migrate:local
pnpm --filter @aicaa/web exec vitest run pg.test
pnpm --filter @aicaa/db exec vitest run pg.test
pnpm db:docker:down
```

**Confirm before running that the target is the local container and not Production.** The guard in `packages/db` refuses a non-loopback host for `migrate:local`, but the Vitest suites take whatever URL they are given.

**One honest limit.** A race test is evidence of behaviour, not a regression guard — A8.4a's suite passed 240 consecutive rounds against restored pre-fix code. Green here is meaningful and is not proof that no race exists. Report it as what it is.

**Docker is required for these suites and for nothing else in Gate 5.** No step of the deployment — build, inspect, promote, smoke, evidence — needs a container. Start Docker for this prerequisite, then stop it; there is no reason to leave it running during a production window. See [Docker](#docker).

#### G5.4 Owner authorization boundary

- **Gate 5 requires its own explicit Owner authorization.** Authorization for the repair, for the hotfix, for Gate 4, or for this documentation does not carry into it. **Gate 4's completion authorizes nothing here.**
- **Authorization is for one production-target build of one named commit, one inspection, and one promotion.** It is not authorization to migrate, to change a flag, to create a scheduler job, to push, or to write a row.
- **A second build requires a fresh decision.** If inspection fails and the build is discarded, deploying a corrected commit is a new deployment of a new artifact, not a retry of the authorized one.
- **A stop is not a licence to improvise.** Containment actions are enumerated in [G5.18](#g518-containment-and-rollback-posture); anything outside them requires the Owner's authorization at the time, on the evidence of the physical state.
- **Gate 5 does not authorize Gate 6.** Completing it does not make capture enablement due.

#### G5.5 Commit selection and the required worktree

**The commit to deploy is local `main` at the exact HEAD recorded in the authorization.** Confirm it rather than assuming, because the deployment binds whatever the worktree holds.

**`534959d` is an ancestor of local `main`, and this is the single most misread fact in the record.** State it precisely:

- **`534959d` is reachable from local `main`**, brought in by merge commit **`68bedff`** ("Merge remote-tracking branch `origin/hotfix/a8-7b-incident-1d-reminder-etag`").
- **`534959d` is not an ancestor of `origin/main`.** `origin/main` is still `ee5e82a`, which predates the hotfix.
- **Deploying current local `main` therefore carries the reminder ETag fix forward.** It does not regress it.
- **No cherry-pick, and no rebase, is required.** Anyone planning one has read the `origin/main` fact and applied it to the local branch.

Verify all four mechanically before building:

```bash
cd <gate5-worktree>
git rev-parse HEAD                                   # must equal the authorized commit
git status --short                                   # must be empty
git merge-base --is-ancestor 534959d HEAD && echo 'ok: hotfix carried forward'
git merge-base --is-ancestor 534959d origin/main || echo 'ok: not on origin/main, as recorded'
git log --oneline --merges 68bedff -1                # the merge that carried it in
ls packages/db/prisma/migrations | grep -c '^2026'   # must be 14, matching Production
```

| Check                     | Requirement                                                                                                       |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Worktree commit           | Exactly the authorized commit                                                                                     |
| Working tree              | **Clean.** `vercel deploy` uploads the working tree, so an uncommitted edit ships without appearing in any commit |
| `534959d` ancestry        | **Is** an ancestor of HEAD; **is not** an ancestor of `origin/main`                                               |
| Migration directory count | **Exactly fourteen**, matching the fourteen rows Production holds. A mismatch means code and schema disagree      |
| `.vercel/project.json`    | Present and linked. It holds a project and organization identifier, no secret, and `.vercel/` is gitignored       |
| `packages/db/.env`        | Irrelevant to safety here, because **Gate 5 runs no migration** — but a build must not depend on it either        |

**A separate clean worktree is preferred but not mandatory**, and this is the one place Gate 5 is looser than Gate 4. Gate 4 required an `.env`-free detached worktree because a bare Prisma command there could reach Production without an operator naming a host. Gate 5 issues no database command at all, so that hazard does not exist. What does matter is that the tree is **clean** and at the **right commit**, because those are what the uploaded artifact is made of.

#### G5.6 Production D2 baseline

Confirm read-only, in this window, before building. These are the facts Gate 5 assumes and must not merely inherit from the Gate 4 record:

Each query is defined once, in [verification queries](#verification-queries); this table states only what Gate 5 requires it to return.

| Query                                 | Expected at `D2`                                                                                                                            |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Q2 — migration history                | **Exactly fourteen** rows, every one finished, none rolled back, `applied_steps_count = 1`                                                  |
| Q7 — notification and reminder tables | **All four present** — `task_reminder_schedules`, `reminder_delivery_attempts`, `owner_notification_intents`, `owner_notification_attempts` |
| QG — positive object assertion        | Passes, with the unvalidated-constraint term scoped to `public`                                                                             |
| Q1 — `tasks` row count                | Recorded as the before-baseline. **Gate 4 deviation 3 exists because this was skipped there — do not repeat it**                            |
| `owner_notification_intents` count    | **0**                                                                                                                                       |
| `owner_notification_attempts` count   | **0**                                                                                                                                       |
| `task_reminder_schedules` count       | Recorded. Measured, never assumed — the reminder write path is functional in Production                                                     |
| `reminder_delivery_attempts` count    | **0**                                                                                                                                       |

**Do not widen QG's unvalidated-constraint term back to every schema.** `pg_constraint` is cluster-wide and Supabase's managed `realtime` schema carries one unvalidated constraint that no migration here controls, so an unscoped count returns `1` on a perfectly healthy Production database. Gate 4 hit exactly that on 2026-08-05. See [G4.11](#g411-post-migration-verification).

#### G5.7 Required feature-flag absence

**All three flags must be absent before the build, absent in the built deployment's environment, and absent after promotion.** Confirm at all three points, because they are three different facts.

| Flag                          | Required state | What it would activate if present                            |
| ----------------------------- | -------------- | ------------------------------------------------------------ |
| `ENABLE_OWNER_EVENT_CAPTURE`  | **Absent**     | Owner-event capture writing intents on every Task mutation   |
| `ENABLE_OWNER_EVENT_DELIVERY` | **Absent**     | The A8.5b delivery state machine, which can send Owner email |
| `ENABLE_REMINDER_DELIVERY`    | **Absent**     | Reminder delivery, which can send Recipient email            |

**Absence is the whole safety argument for Gate 5.** Each flag is an exact-string `=== 'true'` opt-in read **before** any database connection is opened, so with all three unset the notification worker never calls `openDb` and the reminder processor constructs no transport. The queued code is therefore inert on arrival, and Gate 5 is a deployment whose observable effect is limited to what pages render.

**Environment-variable changes affect only deployments created after the change.** A running deployment holds the values it was built and bound with. This cuts both ways and matters at F0: rolling back to a deployment built with a flag set restores that flag.

**One read is deliberately not flag-gated**, and an operator must know it before smoke-testing. `/attention` section two reads `owner_notification_intents` regardless of flag state, because gating a read of durable state on a flag would hide rows that genuinely exist. It is empty in Production because nothing has ever written an intent — not because a flag suppresses it.

#### G5.8 Scheduler inactivity

**Every cron-job.org job must be inactive before Gate 5 and must remain inactive through it.** Confirm read-only and record what is actually there; the repository cannot prove external scheduler state, so any claim made here without looking is a guess.

- Gmail-poll job: exists, **inactive**.
- Suggestion-processing job: exists, **inactive**.
- Reminder-processing job: **does not exist**.
- Notification-processing job: **does not exist**. Gate 5 ships the endpoint it would call; **creating the job is an A8.7d / Stage 16 decision**. [Gate 6](#gate-6--first-controlled-production-enablement-a87c-capture--f0--f1) forbids creating it.

**No job may be created, resumed, edited, or invoked**, and no worker endpoint may be called by hand. **Rollback does not pause a scheduler job** — pausing is a separate action in a separate system, so a job left active is not something a deployment decision can undo later.

#### G5.9 Owner no-use window

**Open a no-use window before the build and hold it through the smoke checks.** During it the Owner must not create or modify a reminder, approve a suggestion, or perform any Task mutation.

Two reasons, and the second is the one that is easy to miss:

- **A promotion swaps the serving build underneath an in-flight request.** A mutation crossing that boundary is not a scenario anyone has designed for.
- **The reminder surfaces carry no flag.** Since the 1d hotfix an authenticated Owner can create a reminder schedule by clicking through the ordinary UI, and nothing in the system will stop them. **This is a discipline, not a control** — no flag enforces it. A schedule created during the window would make the post-deploy row counts move for a reason unrelated to the deployment, which is precisely the signal Gate 5 relies on.

Record the window bounds. Close it only after the smoke sequence and the inertness checks are complete.

#### G5.10 The deployment method

**Use a production-target build, inspect it, then promote it.** This is the method A8.7b-INCIDENT-1d used and validated, and it is the only approved method for Gate 5. Full statement: [deploying a commit that is not on `main`](#deploying-a-commit-that-is-not-on-main).

```bash
# from the clean worktree at the authorized commit
vercel deploy --prod --skip-domain --yes    # production env, production target, no alias yet
vercel inspect <url> --logs                 # confirm before anything is aliased
# ... only after every G5.11 check passes ...
vercel promote <deploymentId> --yes         # assign the production domain
```

**`git push origin main` is prohibited as the Gate 5 deployment method, and prohibited before Gate 5 is validated.** The Git integration builds and promotes a pushed `main` automatically, with **no inspection step**. That is how the A8 schema incident reached Production. A push is therefore a deployment decision, not a repository one, and it removes the single control this gate is built around. `origin/main` stays at `ee5e82a` until Gate 5 has been validated; when to reconcile the remote afterwards is an Owner decision recorded separately.

**Promoting a preview-target deployment is prohibited, absolutely and without exception.** The Git integration builds a pushed non-`main` branch as a **preview-target** deployment, and `vercel promote` moves an alias **without rebuilding**, so a preview build carries the Preview environment for the rest of its life. Five variables exist only in Production and are absent from Preview:

| Variable                             | Consequence if a Preview build is promoted        |
| ------------------------------------ | ------------------------------------------------- |
| `DATABASE_URL`                       | **Every database route fails.** Full Owner outage |
| `CRON_SECRET`                        | Scheduler authentication fails                    |
| `GMAIL_TOKEN_ENCRYPTION_KEY`         | Stored Gmail tokens cannot be decrypted           |
| `GMAIL_TOKEN_ENCRYPTION_KEY_VERSION` | As above                                          |
| `ENABLE_DB_RUNTIME_DIAGNOSTICS`      | Diagnostics silently unavailable                  |

1d rejected exactly this: preview `dpl_3ZwfVbGSiwswih2YY4KSTj3UPJog` was left unpromoted after a read-only comparison showed the five missing variables. **A deployment whose target is anything other than `production` must not be promoted, regardless of how convenient it is.**

##### What `--skip-domain` actually does, and what it does not

**`--skip-domain` creates an inspection window. It does not make the artifact unreachable, and describing it that way is wrong in a way that matters.**

- **What it does:** it suppresses assignment of the **production domain**. `rocket-communicator-web.vercel.app` — the project's only production domain — stays bound to the deployment that currently holds it until an explicit `vercel promote` names a different deployment ID. That separation is what turns promotion into a second, deliberate command with an inspection between the two.
- **What it does not do:** it does not prevent the deployment from existing at its own **immutable deployment URL**. Vercel assigns that URL unconditionally, at creation. The artifact is built, holds **Production environment variables including the live `DATABASE_URL`**, and is addressable before anyone has inspected it. It is zero **aliased** traffic, not zero exposure.
- **What bounds the residual exposure:** Vercel deployment protection on immutable URLs. `P1_4_EVIDENCE.md` records that immutable URLs sit behind it, which is why P1.5 validation used the stable alias. **Confirm read-only that deployment protection is still enabled before creating the build**, rather than inheriting an observation from a different slice.

**So the control that actually prevents accidental traffic movement is not `--skip-domain`.** In descending order of strength it is: **not pushing to `main`**, which prevents an automatic build-and-promote from happening at all; then the **alias staying bound** to the current deployment until an explicit promote; then **deployment protection** bounding what the un-aliased build exposes. `--skip-domain`'s contribution is to make the promote a separate command — real and load-bearing, but narrower than "serves no traffic" suggests.

#### G5.11 Pre-promotion inspection

**Every row must pass. A single mismatch stops the gate before promotion, and a stopped Gate 5 has changed nothing.**

| Check                      | Requirement                                                                                 |
| -------------------------- | ------------------------------------------------------------------------------------------- |
| Deployment target          | **`production`.** Anything else is a hard stop, and must not be promoted                    |
| Build state                | **READY**                                                                                   |
| Commit SHA in metadata     | Exactly the authorized commit                                                               |
| **Migration during build** | **None.** Only `prisma generate` may appear in the build log                                |
| Route set                  | Matches [G5.12](#g512-the-expected-route-set) exactly                                       |
| Environment binding        | All five Production-only variables present, `DATABASE_URL` among them                       |
| Feature flags              | All three **absent** from the deployment environment                                        |
| Node version               | Matches the configured project setting                                                      |
| Build command              | Matches the configured project setting — see [G5.13](#g513-the-build-command-question)      |
| Previous deployment        | Recorded, and retained. It is the starting point Gate 5 must be able to describe afterwards |

**No migration can run during the build, and this is structural rather than a hope.** Confirm it in the log anyway, but the reasons it cannot are worth stating so the check is understood rather than performed:

- **No lifecycle hooks exist.** No `postinstall`, `prepare`, `preinstall`, `prebuild`, or `vercel-build` script exists in any workspace `package.json`.
- **Root `vercel.json` is `{}`** — no build override, no crons, no functions configuration.
- **The build chain contains only `prisma generate`.** `@aicaa/db`'s `build` is `pnpm generate && tsc -p tsconfig.build.json && node ./scripts/copy-generated.mjs`.
- **The unguarded migration scripts were deliberately removed.** `packages/db` exposes only `migrate:local`, `migrate:status:local`, and `migrate:dev:local`, each routed through a script that refuses any non-loopback host. `packages/db/__tests__/a8-7b-incident-migration-safety.test.ts` asserts the unguarded ones stay absent.

#### G5.12 The expected route set

**Verify the delta, not the absolute.** This is the specific trap in Gate 5's inspection, and reading it wrong produces a false pass.

The queued code adds **exactly one route**: `/api/v1/internal/notifications/process`. Nothing else appears, nothing disappears. `/attention` already existed as a placeholder and is now a real two-section read; `apps/web/app/(owner)/attention/error.tsx` is a segment error boundary and adds **no** route entry.

| Property                                   | Expected at the Gate 5 commit                                      |
| ------------------------------------------ | ------------------------------------------------------------------ |
| Entries in `.next/routes-manifest.json`    | **52** — the authoritative count, and the one to verify            |
| Route lines printed by the build log       | **51**, plus a separate `ƒ Proxy (Middleware)` line                |
| New relative to the deployed `534959d`     | `/api/v1/internal/notifications/process`, and nothing else         |
| Removed relative to the deployed `534959d` | **None**                                                           |
| Must be present                            | `/attention`, `/tasks/[taskId]`, `/api/v1/tasks/[taskId]/reminder` |

**The two numbers differ by one, for a reason worth knowing before the log is read.** The manifest holds 52 page entries, which includes both `/_global-error` and `/_not-found`; Next 16 prints `/_not-found` in the build summary but not `/_global-error`. So **52 in the manifest and 51 in the log describe the same build.** Neither number is wrong and neither should be corrected into the other. Derive the manifest count locally rather than trusting this table:

```bash
node -e "const m=require('./apps/web/.next/routes-manifest.json');
const s=new Set();for(const k of ['staticRoutes','dynamicRoutes'])
for(const r of (m[k]||[])) s.add(r.page); console.log(s.size); "
```

> **⚠ Do not compare against the 1d figure of "51 routes".** The [1d capture record](A8_7_EVIDENCE.md#a87b-incident-1d--production-reminder-endpoint-hotfix) records 51 routes for a build that had **no** notification route, and the Gate 5 build also prints 51 route lines — **with** it. The route sets differ by one while the totals match, so the two were **counted on different bases**; the record does not preserve 1d's log verbatim, so exactly which entries it included cannot be recovered and should not be guessed. **The totals being equal is not evidence that nothing changed**, and a naive match against 51 would conclude the new route is absent when it is present. **Verify by name**: `/api/v1/internal/notifications/process` must appear in the Gate 5 build log and does not appear in 1d's.

**Verification is by name first and by count second.** A missing `/api/v1/internal/notifications/process` means the notification worker route did not build. A name in the log that this diff does not explain means something arrived that nobody queued. Both are hard stops, and either can occur while the count still reads 51.

#### G5.13 The build command question

**An open discrepancy exists between the documented preference and the configured setting, and Gate 5 must resolve it rather than discover it.**

| Source                                                                    | Value                                                                              |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Documented preference ([build and deploy order](#build-and-deploy-order)) | `cd ../.. && pnpm build:vercel` — domain → **ai** → db → web                       |
| Configured in Vercel, per the 1d record                                   | `cd ../.. && pnpm build:domain && pnpm build:db && pnpm --filter @aicaa/web build` |

**The configured command omits `pnpm build:ai`.** It works today only because `apps/web`'s own `build` script begins with `pnpm --filter @aicaa/ai build`, so `@aicaa/ai` is built as a side effect of the web build rather than by design. The output is equivalent; the guarantee is not. If that script's first clause is ever removed as redundant, the configured command silently stops building `@aicaa/ai`, and the suggestion processing path loses the `dist` it depends on.

**Recommendation: change the Vercel project setting to `cd ../.. && pnpm build:vercel` before Gate 5.** It is a one-field change, it makes the ordering explicit rather than incidental, and it aligns the setting with the document that describes it.

**This is an Owner decision and it is not made here.** The alternative — formally accepting the current command on the grounds that the web build invokes the AI build transitively — is defensible, costs nothing today, and requires a guard so the transitive dependency cannot be removed unnoticed. **Whichever is chosen, record it**, and confirm during [G5.11](#g511-pre-promotion-inspection) that the build log matches the setting the Owner decided on. **No Vercel setting may be changed during Gate 5 itself**; if the setting is to change, it changes before the gate opens, under its own authorization.

#### G5.14 Promotion

Only after every [G5.11](#g511-pre-promotion-inspection) row passes:

```bash
vercel promote <deploymentId> --yes
```

Then confirm, before moving on:

- The production domain `rocket-communicator-web.vercel.app` resolves to the new deployment.
- The new deployment ID differs from the previous one, and both are recorded.
- The previous deployment `dpl_3oder2T3PuDYdmp8pezy6u7RwPRm` (`534959d`) is **retained**, not deleted.

#### G5.15 Post-deploy smoke sequence

**Run in this order.** The unauthenticated probes come first because they prove routing without needing a session, so a total failure is identified before anyone spends time signing in.

| #   | Check                                                           | Expected                                                                |
| --- | --------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 1   | `GET /api/v1/tasks` unauthenticated                             | Typed **401 `UNAUTHORIZED`**                                            |
| 2   | `GET /api/v1/tasks/{taskId}/reminder` unauthenticated           | Typed **401 `UNAUTHORIZED`**                                            |
| 3   | `GET /api/v1/session`                                           | **200**; `role` = `owner`; `organizationId` = `axford`                  |
| 4   | `GET /api/v1/tasks`                                             | **200**; cursor page shape                                              |
| 5   | Owner `/tasks` in a browser                                     | Task list renders                                                       |
| 6   | Owner `/tasks/{taskId}` in a browser                            | Task detail renders, including notes, outcome, and reminder state       |
| 7   | **`GET /api/v1/tasks/{taskId}/reminder` on a real Task**        | **200**, `state=no_due_date`, **ETag ending `v0`**                      |
| 8   | `GET /api/v1/tasks/task_doesnotexist000000/reminder`            | Typed **`NOT_FOUND`**                                                   |
| 9   | **Owner `/attention` in a browser**                             | Loads; **both** sections render; **neither reaches the error boundary** |
| 10  | `/attention` section one — reminder schedules needing attention | Renders, empty                                                          |
| 11  | `/attention` section two — events Rocket could not email about  | Renders, empty                                                          |
| 12  | `GET /c/{token}` for a valid issued link                        | Non-mutating capability page renders                                    |

**Check 7 is the 1d regression check.** A `500` there means the runtime-value import hazard has recurred. The diagnostic signature is misleading by design: a `ReferenceError` is neither a Prisma error nor a `PersistenceError`, so **no `database_runtime_failure` event is emitted to contradict it**. Category `UNKNOWN_FAILURE` **with no accompanying database diagnostic** points at packaging, not at the database.

**Check 9 is the check Gate 5 exists to satisfy, and it is the one that must not be waved through.** `/attention` is `force-dynamic` and runs two reads in parallel on every load: `listReminderSchedulesRequiringOwnerAttention` against `task_reminder_schedules`, and `listUndeliveredOwnerNotifications` against `owner_notification_intents` — the table **migration 9** created in Gate 4. The page deliberately has **no error catch**; a database failure propagates to the segment error boundary untouched, because rendering an empty state instead would turn a missing table into the sentence "nothing needs your attention", which is the single worst thing this page could say while wrong.

**Two empty sections are the correct result, and the reason each is empty is different.** Section one is empty because no reminder schedule has ever been created in Production. Section two is empty because no notification intent has ever been captured — `ENABLE_OWNER_EVENT_CAPTURE` has never been live. **An error boundary on this page is a hard stop**, and it means the deployed code cannot see something Gate 4 created.

#### G5.16 Inertness verification

**Gate 5 deploys a subsystem and activates none of it. Prove that rather than asserting it.** Confirm after the smoke sequence:

| Check                                                                                   | Expected                                                                              |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `ENABLE_OWNER_EVENT_CAPTURE`, `ENABLE_OWNER_EVENT_DELIVERY`, `ENABLE_REMINDER_DELIVERY` | All three still **absent** in Vercel Production                                       |
| `owner_notification_intents` count                                                      | **0**, unchanged                                                                      |
| `owner_notification_attempts` count                                                     | **0**, unchanged                                                                      |
| `task_reminder_schedules` count                                                         | **Unchanged** from the G5.6 baseline                                                  |
| `reminder_delivery_attempts` count                                                      | **0**, unchanged                                                                      |
| `tasks` count (Q1)                                                                      | **Unchanged** from the G5.6 baseline                                                  |
| Migration history (Q2)                                                                  | **Still exactly fourteen rows.** Gate 5 applies none                                  |
| Scheduler jobs                                                                          | Unchanged from [G5.8](#g58-scheduler-inactivity); no job created, resumed, or invoked |
| `/api/v1/internal/notifications/process`                                                | Exists in the route set and **has been invoked by nothing**                           |
| Gmail                                                                                   | Connected, untouched, no API call made                                                |

**Any non-zero notification count is a hard stop**, and it means capture ran — which with the flag absent should be impossible. **Any movement in `task_reminder_schedules` is a hard stop** unless the Owner created one during the window, which the no-use window exists to prevent.

#### G5.17 Stop conditions

| #   | Condition                                                                                               | When it applies  |
| --- | ------------------------------------------------------------------------------------------------------- | ---------------- |
| 1   | The worktree is not at the authorized commit, or `git status --short` is not empty                      | Before build     |
| 2   | `534959d` is **not** an ancestor of the deployment commit                                               | Before build     |
| 3   | The worktree does not hold exactly fourteen migration directories                                       | Before build     |
| 4   | Production migration history is not exactly fourteen finished, non-rolled-back rows                     | Before build     |
| 5   | Any of the four notification or reminder tables is absent, or `QG` fails on the `public`-scoped reading | Before build     |
| 6   | Any of the three A8 flags is **present** in Vercel Production                                           | Before build     |
| 7   | Any scheduler job is active, or a notification or reminder job exists                                   | Before build     |
| 8   | `pnpm verify`, the nine PostgreSQL suites, or the production bundle guards are not green                | Before build     |
| 9   | `8588c5d` cannot be confirmed redeployable read-only                                                    | Before build     |
| 10  | Deployment target is not `production`                                                                   | Before promotion |
| 11  | Build state is not READY                                                                                | Before promotion |
| 12  | The commit SHA in the deployment metadata does not match the authorized commit                          | Before promotion |
| 13  | **Anything other than `prisma generate` appears in the build log**                                      | Before promotion |
| 14  | The route set does not match [G5.12](#g512-the-expected-route-set), by name and not merely by count     | Before promotion |
| 15  | Any of the five Production-only variables is absent from the build environment                          | Before promotion |
| 16  | Any of the three A8 flags is present in the deployment environment                                      | Before promotion |
| 17  | Node version or build command differs from the configured project setting                               | Before promotion |
| 18  | **`/attention` reaches its error boundary**                                                             | After promotion  |
| 19  | `/tasks` or `/tasks/{taskId}` fails to render                                                           | After promotion  |
| 20  | `GET /api/v1/tasks/{taskId}/reminder` returns `500`, or an ETag not ending `v0` for a no-due-date Task  | After promotion  |
| 21  | An unauthenticated probe returns anything other than a typed `401`                                      | After promotion  |
| 22  | Any non-zero count in `owner_notification_intents` or `owner_notification_attempts`                     | After promotion  |
| 23  | Any unexplained movement in `task_reminder_schedules`, `reminder_delivery_attempts`, or `tasks`         | After promotion  |
| 24  | Migration history is no longer exactly fourteen rows                                                    | After promotion  |

**Conditions 1 through 17 stop the gate having changed nothing.** No deployment serves traffic, `534959d` is still promoted, and the correct action is to close the no-use window and record why. **Conditions 18 through 24 require containment**, per [G5.18](#g518-containment-and-rollback-posture).

**The correct response to a Gate 5 problem is to contain the code, never to reverse the schema.** Nothing in Gate 5 is made better by a schema change: migrations are forward-only, no A8 migration has a down path, and a hand-written reversal is a new, unreviewed migration authored under pressure. The schema is not what changed.

#### G5.18 Containment and rollback posture

**Primary containment is a fresh production-target build of `534959d`**, created and promoted by the same `--skip-domain` → inspect → promote method. `534959d` is the only validated pre-`D3` code state, and `D2` supports it: the schema is ahead of that code, which is the safe direction. The commit lives on `hotfix/a8-7b-incident-1d-reminder-etag` and is reachable from local `main` through `68bedff`; **do not delete that branch**, and prefer tagging `534959d` before any branch cleanup.

**One-step Instant Rollback is unavailable, and must not be treated as the containment path.** Once Gate 5 has promoted, one step back reaches the `534959d` deployment — but the qualification recorded in [Rollback principles](#rollback-principles) still governs, and rollback restores a target's **original environment binding** rather than today's values. Confirm what one step back actually is before relying on it; do not assume.

**`8588c5d` remains the universal fallback.** It is the last commit predating every A8 slice, so it cannot reference an A8 column or table regardless of what the schema holds. It is a **redeployment**, not a rollback: the Hobby plan restricts Instant Rollback to the immediately previous deployment, and `8588c5d` is not that. **Its redeployability must be confirmed read-only before Gate 5 begins**, not discovered during an incident.

Five properties hold regardless of which path is taken:

- **Rolling back does not undo a migration.** Schema is forward-only, so Production stays at `D2` through any code action. There is no code state Gate 5 can return to that makes the schema move.
- **A deployment carries the environment variables it was built with.** Rolling back to a build made with a flag set restores that flag. All three flags were absent everywhere during Gate 5, so this was harmless then. **It is no longer universally true:** the partial Gate 6 attempt left one READY production-target deployment, `dpl_7X5r5ypWbq6ipmWMpver6p99p5Xz`, whose immutable snapshot still contains `ENABLE_OWNER_EVENT_CAPTURE`, even though the variable has since been removed from the Vercel Production environment. Aliasing the public custom domain to that deployment would make capture live — see [Current production state](#current-production-state).
- **Rollback does not disable an external scheduler job.** cron-job.org keeps calling whatever it was calling. Pausing a job is a separate action in a separate system.
- **Rolling back does not unsend an email.** Not reachable in Gate 5, since all three flags stay absent — which is exactly why they stay absent.
- **Environment bindings and scheduler state are separate concerns from the deployment**, and each needs its own action, its own confirmation, and its own record.

#### G5.19 Evidence recording

**Record the evidence in [A8_7_EVIDENCE.md § Gate 5](A8_7_EVIDENCE.md#gate-5--deploying-the-queued-a84ba86-code), which has its own capture record.** Do not reuse the Gate 4 record — it is a database record whose rows describe migrations, and a deployment filled into it would read as a gate that migrated something.

**Fill every row. A blank row is an incomplete record, and this is not a formality.** Gate 4 recorded four deviations, two of which exist only because a field went unfilled: `Q1` was never run, so no before-baseline exists for `tasks`, and several fields were performed but never transcribed. Both are open today. Gate 5's counts are only meaningful against a baseline that was actually captured.

**Record deviations honestly, including any that seemed harmless at the time.** A stop that was worked around rather than decided is itself the finding.

**Secrets never appear in evidence.** Record an endpoint's classification — host form, port, session mode — never its value.

#### G5.20 Stop before Gate 6

**Gate 5 ends at verified `D3` plus recorded evidence.** When the smoke sequence and the inertness checks pass:

1. Record the evidence in [A8_7_EVIDENCE.md § Gate 5](A8_7_EVIDENCE.md#gate-5--deploying-the-queued-a84ba86-code).
2. Close the Owner no-use window.
3. **Stop.**

**Production is then at `D3` and at `F0`** — the queued A8 code deployed against all fourteen migrations, with every A8 feature inert. `F0` is the [designated safe harbour](#flag-staging-states-a87ca87e) and the containment target for almost everything in Gate 6.

**Explicitly not authorized by Gate 5, and not to be started on its completion:**

- **Gate 6 in every part** — A8.7c capture enablement, A8.7d zero-send rehearsal, the single-notification canary, the Gmail custom-header round-trip proof, notification scheduler creation, and A8.7e reminder delivery.
- **Setting any of the three A8 flags.** Each is its own decision under its own authorization.
- **Creating, resuming, or invoking any scheduler job**, including the notification job whose endpoint Gate 5 ships.
- **Any Owner or Recipient email.** A8.7d is the first slice in the project's history that can send mail on Rocket's initiative, and A8.7e the first that can send to somebody who is not the Owner. Those are different thresholds and are deliberately not crossed in one slice.
- **Reconciling `origin/main`.** Whether and when to push is an Owner decision recorded separately; a push is a deployment decision because the Git integration builds and promotes `main` automatically.

### Gate 6 — First controlled production enablement (A8.7c capture / F0 → F1)

> **⚠ Gate 6 was authorized and partially executed on 2026-08-05, and it did not complete. Capture never became live, and Production remains at flag posture `D3` / `F0`.** `ENABLE_OWNER_EVENT_CAPTURE` was temporarily created in Vercel Production and the production-target deployment `dpl_7X5r5ypWbq6ipmWMpver6p99p5Xz` built and reached READY carrying it, but that deployment received only the two default `.vercel.app` aliases. Because the project has `autoAssignCustomDomains=false`, the public custom domain moves only by an explicit alias assignment, and that assignment did not occur — during the Gate 6 window the domain stayed on `dpl_6cVssNpaZeKPBEVGDynd61AoS9nS`, whose snapshot predates the flag. The capture variable was subsequently removed from Vercel Production under separate authorization. **The public alias has since moved to the Bearer F0 successor** `dpl_Cs2TrnDsy1KSB3wipCCUt82Hpf8D` / `eb8cabe` — still `F0`, all three A8 flags absent. Evidence and the recorded gap: [A8_7_EVIDENCE.md § Gate 6](A8_7_EVIDENCE.md#gate-6--first-controlled-production-enablement-a87c-capture--f0--f1); state summary: [Current production state](#current-production-state). **Nothing here authorizes resuming, completing, or re-running Gate 6, and nothing here authorizes Stage 12, A8.7d, or A8.7e.**

**Gate 6 enables exactly one feature flag — `ENABLE_OWNER_EVENT_CAPTURE` — in Production, redeploys so the value binds, verifies the result, and does nothing else.** No migration, no second flag, no scheduler job, no Gmail action, no Owner or Recipient email, no push to `main`. It moves Production from **`F0`** to **`F1`** in the [flag-staging states](#flag-staging-states-a87ca87e): capture writes notification intents and audit rows; delivery and reminder remain inert.

**Gate 6 has not been completed, and this section does not authorize it.** It is written out in full so that an operator can execute it from this repository alone, with no reference to any conversation. Completing [Gate 5](#gate-5--deploying-the-queued-a84ba86-code) did not make it due, and the partial 2026-08-05 attempt did not make its remainder due either.

> **⚠ A production-target deployment is not the live site.** The partial Gate 6 attempt is the reason this is now stated here rather than assumed: a build that reaches READY with a flag in its environment snapshot serves nothing until the **public custom domain** points at it. With `autoAssignCustomDomains=false`, a new production-target deployment holds only its two default `.vercel.app` aliases. **Verify the live custom domain's deployment ID, not merely the newest READY deployment**, before recording any flag as live.

> **⚠ Gate 6 is a flag-binding deployment, not a code deploy and not a migration.** The Production code at `D3` already contains the capture path. What changes is one environment variable and the deployment that carries it. An operator who reaches for `prisma migrate deploy`, who sets a second A8 flag, who creates a notification cron job, or who pushes to `main` is following the wrong procedure. Everything labelled `G5.x` describes the inert code deploy and must not be re-run here to "be safe."

**Where this sits relative to the informal "Gate 6" name in [G5.20](#g520-stop-before-gate-6).** G5.20 withheld the whole flag-staging path — A8.7c, A8.7d, and A8.7e — under that name. **This section is only the first activation event inside that path: Stage 11 / F0 → F1.** Stage 12 (capture-only observation), A8.7d, and A8.7e each remain separately bounded and are **not** authorized by executing this section.

#### G6.1 Scope

| In scope                                                                                                                                | Out of scope                                                                               |
| --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Setting `ENABLE_OWNER_EVENT_CAPTURE` to the exact lowercase string `true` in Vercel **Production only**                                 | Setting, unsetting, or editing `ENABLE_OWNER_EVENT_DELIVERY` or `ENABLE_REMINDER_DELIVERY` |
| One production-target redeploy that binds the new value (inspect before aliased traffic when using `--skip-domain`)                     | `git push origin main`, which deploys automatically and removes the inspection gate        |
| Read-only preflight counts (Q8, Q21) and read-only post-activation verification                                                         | Any migration, `migrate deploy`, `migrate resolve`, or schema change                       |
| Recording evidence in [A8_7_EVIDENCE.md § Gate 6](A8_7_EVIDENCE.md#gate-6--first-controlled-production-enablement-a87c-capture--f0--f1) | Promoting a **preview-target** deployment, under any circumstances                         |
| Confirming scheduler inactivity read-only                                                                                               | Creating, resuming, editing, or invoking any scheduler job, including the notification job |
|                                                                                                                                         | Invoking `POST /api/v1/internal/notifications/process` (manual or scheduled)               |
|                                                                                                                                         | Stage 12 observation window close-out as a separate decision beyond immediate verification |
|                                                                                                                                         | A8.7d (delivery, Gmail canary, notification scheduler) and A8.7e (reminder delivery)       |

#### G6.2 Prerequisites

Every one of these must hold, and each must be confirmed rather than assumed:

- **Gate 5 is complete and verified** — Production is at **`D3` / `F0`**: queued A8.4b–A8.6 code deployed, fourteen migration rows unchanged, all three A8 flags **absent**. Evidence: [A8_7_EVIDENCE.md § Gate 5](A8_7_EVIDENCE.md#gate-5--deploying-the-queued-a84ba86-code).
- **Production serves a documented F0 deployment** (Gate 5's `dpl_6cVssNpaZeKPBEVGDynd61AoS9nS` at `d369c6d`, or a later inert F0 successor such as the promoted Bearer deployment `dpl_Cs2TrnDsy1KSB3wipCCUt82Hpf8D` at `eb8cabe` that still has all three flags absent). If Production no longer matches Gate 5 evidence and has no recorded F0 successor, **stop** and reconcile before enabling anything.
- **`ENABLE_OWNER_EVENT_DELIVERY` and `ENABLE_REMINDER_DELIVERY` are absent** in Vercel Production. A second flag found present is a hard stop.
- **No notification-processing job exists** at cron-job.org (or any other scheduler). Creating one is an A8.7d decision, not a Gate 6 step.
- **Q8** shows all four A8 tables at **0** rows (or an Owner-accepted non-zero that is understood before enablement — the default expectation after Gate 5 inertness is still `0, 0, 0, 0`).
- **Q21** is recorded for reference (expired-capability count). It is informational before capture; it becomes a hard stop before the A8.7d canary, not here.
- **`/attention` loads** with both sections rendering (empty is correct while no intents and no schedules exist).
- Repository HEAD used for any redeploy is the authorized Gate 5 commit family (or an Owner-authorized later commit that does not change flag semantics). `git status --short` is empty in the deploy worktree.

#### G6.3 Owner authorization boundary

- **Gate 6 requires its own explicit Owner authorization.** Gate 5's completion authorizes nothing here.
- **Setting `ENABLE_OWNER_EVENT_CAPTURE` is the entire authorized mutation.** Redeploy is required only so the value binds; it is not a second authorization to ship unrelated code.
- **Gate 6 does not authorize Stage 12's extended observation close-out as a separate product decision**, A8.7d, A8.7e, any scheduler creation, or reconciling `origin/main`.

#### G6.4 Production F0 baseline

Record these read-only before touching any environment variable:

| Check                                   | Expectation                                               |
| --------------------------------------- | --------------------------------------------------------- |
| Current deployment ID and commit        | Gate 5 artifact (or documented successor at F0)           |
| All three A8 flags                      | **Absent**                                                |
| Q2 migration history                    | Still exactly **fourteen** finished rows                  |
| Q8 four table counts                    | **`0, 0, 0, 0`** unless an accepted exception is recorded |
| Q21 expired capabilities                | Recorded (informational)                                  |
| Notification job                        | **Does not exist**                                        |
| Reminder / Gmail-poll / suggestion jobs | Inactive as found; none created or resumed                |
| `/attention`                            | Loads; neither section reaches the error boundary         |

**Do not skip the baseline because Gate 5 already recorded zeros.** Gate 4 deviation 3 and Gate 5 evidence discipline both exist because a prior window's numbers are not evidence about this window.

#### G6.5 Required other-flag absence

| Flag                          | Required state      | Why                                                    |
| ----------------------------- | ------------------- | ------------------------------------------------------ |
| `ENABLE_OWNER_EVENT_CAPTURE`  | **Absent → `true`** | The only flag this gate sets                           |
| `ENABLE_OWNER_EVENT_DELIVERY` | **Absent**          | Delivery is live ammunition; A8.5c can send Owner mail |
| `ENABLE_REMINDER_DELIVERY`    | **Absent**          | Reminder send path; not part of A8.7c                  |

**Exact-string rule.** Only the lowercase string `true` enables an A8 flag. `"1"`, `"TRUE"`, `"yes"`, and whitespace leave the flag **off**. Discovering a wrong spelling after an hour of "observation" wastes the window and is a stop under [G6.11](#g611-stop-conditions).

#### G6.6 Scheduler inactivity

- Gmail-poll and suggestion-processing jobs: **inactive as found**. Do not resume them for this gate.
- Reminder-processing job: **must not exist** (or remain inactive if one was ever created outside this runbook — creating one is still out of scope).
- Notification-processing job: **must not exist**. Gate 5 shipped the endpoint; **creating the job is an A8.7d decision**.

**No job may be created, resumed, edited, or invoked during Gate 6.** Capture does not need a worker invocation: intents are written on the Task mutation path and on the worker's capture phase only when that endpoint is called. With no job and no manual invoke, capture still occurs on ordinary Owner/Recipient mutations once the flag is bound.

#### G6.7 Operator notes — mistakes already paid for

These are standing rules for this gate, drawn from the incident and from Gate 4 / Gate 5 deviations. They are not optional colour.

1. **Do not push to `main` to "pick up the flag."** Push builds and promotes automatically with no inspection step — that is how the A8 schema incident was created.
2. **Do not promote a preview-target deployment.** Preview lacks Production `DATABASE_URL` bindings; the 1d near-miss exists because this looked convenient.
3. **`--skip-domain` is an inspection window, not invisibility.** Gate 5 deviation 1: Production team aliases were assigned at creation anyway. Confirm what actually holds the production alias before and after promote.
4. **Deploy from the repo root (or the documented worktree root), not from `apps/web` alone.** Gate 5 deviation 5: the first attempt from `apps/web` failed with a doubled path.
5. **Fill every evidence row in the same window.** Gate 4 deviation 4: fields performed but never transcribed. A blank row is an incomplete record.
6. **Environment variables bind at deploy time.** Editing the Vercel dashboard without a new deployment changes nothing about the running build. Rolling back to a build made with a flag set restores that flag.
7. **At the first F0 → F1 transition, Instant Rollback can still reach F0** because F0 is the immediately previous deployment. After any later F1 redeploy, Hobby one-step rollback may no longer reach F0 — plan on unsetting and redeploying.
8. **Capture alone contacts nothing.** That is why it is the first activation. Do not "helpfully" enable delivery in the same change to "see a full path."
9. **Do not invoke the notification worker to "test capture."** Invocation is an A8.7d/zero-send concern. Capture on mutations does not require it.
10. **cron-job.org may be unreadable without an API key** (Gate 5 deviation 2). If the dashboard cannot be read, record the corroborating evidence used and do not invent a job that was not observed.

#### G6.8 Execution sequence

Perform in this order. Do not reorder. The operator-facing expansion with exact commands, expected results, evidence rows, stop conditions, and Owner authorization checkpoints is [G6.15](#g615-operator-execution-checklist).

1. Confirm [G6.2](#g62-prerequisites) and record the [G6.4](#g64-production-f0-baseline).
2. Open the Owner no-use window and record its bounds (discipline, not a control — same class as Gate 5).
3. In the Vercel dashboard, Production environment, set **`ENABLE_OWNER_EVENT_CAPTURE`** to exactly `true`. Leave the other two A8 flags **unset** (absent), not set to `false`.
4. Create a **production-target** deployment that will bind the new value:
   - Preferred, matching Gate 5 discipline: from a clean worktree at the authorized commit, `vercel deploy --prod --skip-domain --yes`, then inspect per [G6.9](#g69-pre-promotion-inspection), then `vercel promote <deployment-id> --yes` if the production alias is not already on that deployment.
   - Alternative only if Owner-authorized for this window: a Vercel Production redeploy of the current Production commit after the variable is set. Still record deployment ID, target `production`, READY, and bound flag values.
5. **Do not push to `main`. Do not promote a preview-target deployment.**
6. Proceed immediately to [G6.10](#g610-post-activation-verification).

#### G6.9 Pre-promotion inspection

Before relying on the new deployment (and before `vercel promote` when using `--skip-domain`):

| Check                        | Expectation                                                              |
| ---------------------------- | ------------------------------------------------------------------------ |
| Deployment target            | **`production`**                                                         |
| Deployment state             | **READY**                                                                |
| Commit SHA                   | Authorized commit (worktree / metadata)                                  |
| `ENABLE_OWNER_EVENT_CAPTURE` | **`true`** in the deployment's Production env binding                    |
| Other two A8 flags           | **Absent**                                                               |
| Migration during build       | **None** — only `prisma generate`, as in Gate 5                          |
| Route set                    | Still includes `/api/v1/internal/notifications/process` and `/attention` |

If any row fails, **do not promote / do not continue**. Unset the capture flag if it was set, and leave Production on the previous F0 deployment.

#### G6.10 Post-activation verification

Run immediately after the new deployment is the alias-holding Production deployment:

1. Vercel Production env: `ENABLE_OWNER_EVENT_CAPTURE` is exactly `true`; the other two A8 flags remain **absent**.
2. Deployment Ready; production alias points at the intended deployment ID.
3. Unauthenticated `GET /api/v1/tasks` still returns typed `401 UNAUTHORIZED`.
4. Owner `/attention` still loads; neither section reaches the error boundary.
5. Q2 still shows **fourteen** migration rows (Gate 6 applies none).
6. Q8: `owner_notification_attempts` is still **0**. Intent count may remain 0 until a capturing mutation occurs; that is acceptable. **Attempts becoming non-zero is a hard stop.**
7. Confirm **no** notification scheduler job exists and **no** manual invoke of `/api/v1/internal/notifications/process` was performed.
8. Confirm Gmail was not contacted for Owner-notification or reminder send.

**State after success:** **`F1`** — capture-only. Code remains `D3`. Delivery and reminder flags absent.

#### G6.11 Stop conditions

| Condition                                         | Action                                                                     |
| ------------------------------------------------- | -------------------------------------------------------------------------- |
| Either other A8 flag is present or became set     | **Hard stop.** Unset capture if set; do not continue                       |
| Capture value is anything other than exact `true` | **Hard stop.** Fix spelling only under re-authorization                    |
| Preview-target deployment created or promoted     | **Hard stop.** Do not promote; discard                                     |
| Push to `main` performed                          | **Hard stop.** Treat as unauthorized deploy; follow containment            |
| `/attention` error boundary                       | **Hard stop.** Contain per [G6.12](#g612-containment-and-rollback-posture) |
| `owner_notification_attempts` non-zero            | **Hard stop.** Something delivered; contain immediately                    |
| Notification job created or endpoint invoked      | **Hard stop.** Pause/remove job if created; unset delivery if set          |
| Migration history changed                         | **Hard stop.** Wrong procedure was followed                                |
| Production alias on an unexpected deployment      | **Hard stop.** Resolve alias before any further change                     |

#### G6.12 Containment and rollback posture

**Primary containment for a bad F1:** unset `ENABLE_OWNER_EVENT_CAPTURE` and redeploy, **or** — while F0 is still the immediately previous deployment — Instant Rollback to that F0 deployment.

- **Returning to F0 is the designated safe harbour** for capture problems. Captured intents remain and are harmless: an intent older than 24 hours terminalizes as suppressed without contacting anything.
- **One-step Instant Rollback is available only while F0 is the immediately previous deployment.** After further F1 redeploys, Hobby rollback may not reach F0; unset and redeploy instead.
- **Do not treat F2 as a rollback target** — F2 is delivery-rehearsal-only and is not created by this gate.
- **Rollback does not unapply migrations, pause external scheduler jobs, or unsend mail.** Schema stays at fourteen rows. No mail should have been sent in Gate 6; if any was, that is already a hard stop under G6.11.
- **Code containment to `534959d` is a separate, heavier action** (leaves `D2`-shaped code against a `D3` schema consumer gap for `/attention`). It is not the first response to a capture-flag mistake; unsetting the flag is.

#### G6.13 Evidence recording

Fill [A8_7_EVIDENCE.md § Gate 6](A8_7_EVIDENCE.md#gate-6--first-controlled-production-enablement-a87c-capture--f0--f1) in the same window. Required categories:

- Authorization reference (Gate 6's own)
- F0 baseline (deployment ID, commit, three flags, Q8, Q21, scheduler state)
- Exact capture flag value set
- Other two flags confirmed absent after
- New deployment ID, target, READY, promote/alias result
- Post-activation verification results
- Attempts count (expect 0)
- Deviations, stop conditions, containment
- Explicit confirmation that Stage 12 / A8.7d / A8.7e were not begun beyond what this gate authorizes

**Secrets never appear in evidence.**

#### G6.14 Stop before Stage 12 close-out and before A8.7d

**Gate 6 ends at verified `F1` plus recorded evidence.** When post-activation verification passes:

1. Record the evidence.
2. Close the Owner no-use window (or keep it open only if Stage 12 is separately authorized to continue immediately).
3. **Stop.**

**Explicitly not authorized by Gate 6:**

- Treating Stage 12's observation window as already closed without recording Stage 12 evidence
- **A8.7d** — zero-send rehearsal, notification canary, Gmail round-trip proof, notification scheduler creation
- **A8.7e** — reminder delivery
- Setting `ENABLE_OWNER_EVENT_DELIVERY` or `ENABLE_REMINDER_DELIVERY`
- Creating or invoking any notification or reminder scheduler job
- Reconciling `origin/main`

**Stage 11 in the [stage runbook](#stage-11--owner-event-capture-enablement-a87c) is the same activation.** Prefer this `G6.x` section when the two differ in specificity; do not run both as separate enablements.

#### G6.15 Operator execution checklist

> **⚠ Documentation only. This checklist does not authorize Gate 6 and must not be executed until the Owner has given Gate 6 its own explicit authorization.** Every step below is a restatement of [G6.1](#g61-scope)–[G6.14](#g614-stop-before-stage-12-close-out-and-before-a87d). If any step appears to conflict with those sections, **stop and follow G6.1–G6.14**; do not invent a third procedure.

**Purpose.** Give a live operator a single ordered path from `F0` to verified `F1` without interpreting policy. The only mutation this checklist ever performs is setting `ENABLE_OWNER_EVENT_CAPTURE` to the exact lowercase string `true` and binding it with one production-target redeploy. Nothing else.

**How to use.** Complete steps in order. At each step: run the command or perform the dashboard action as written; confirm the expected result; capture the named evidence into [A8_7_EVIDENCE.md § Gate 6](A8_7_EVIDENCE.md#gate-6--first-controlled-production-enablement-a87c-capture--f0--f1); if a stop condition fires, execute the rollback trigger and follow [G6.12](#g612-containment-and-rollback-posture). Do not skip evidence rows ([G6.7](#g67-operator-notes--mistakes-already-paid-for) item 5 / Gate 4 deviation 4).

**Owner authorization checkpoints** (must each be recorded before the named action):

| Checkpoint                                                                                                                               | Must hold before                     | Trace                                                         |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------- |
| **A0** — Explicit Gate 6 authorization exists (Gate 5's does not carry)                                                                  | Any production contact for this gate | [G6.3](#g63-owner-authorization-boundary)                     |
| **A1** — Authorization covers setting **only** `ENABLE_OWNER_EVENT_CAPTURE=true` and one binding redeploy                                | Step EC-7 (flag set)                 | [G6.1](#g61-scope), [G6.3](#g63-owner-authorization-boundary) |
| **A2** — If using the alternative redeploy method, Owner authorized that method for this window                                          | Step EC-9 alternative                | [G6.8](#g68-execution-sequence) item 4                        |
| **A3** — Any action outside this checklist (second flag, scheduler, push, Stage 12 close-out, A8.7d/e) requires a **new** Owner decision | Never during Gate 6                  | [G6.14](#g614-stop-before-stage-12-close-out-and-before-a87d) |

**Rollback procedure reference (standing).** Primary containment: unset `ENABLE_OWNER_EVENT_CAPTURE` and redeploy, **or** — while F0 is still the immediately previous deployment — Instant Rollback to that F0 deployment. Full posture: [G6.12](#g612-containment-and-rollback-posture). Rollback does not unapply migrations, pause external scheduler jobs, or unsend mail.

---

##### Preconditions (must all pass before EC-1)

Trace: [G6.2](#g62-prerequisites), [G6.4](#g64-production-f0-baseline), [G6.5](#g65-required-other-flag-absence), [G6.6](#g66-scheduler-inactivity).

| #   | Precondition                                                               | How confirmed                                                                                                                     | Expected                                                                                                                                                                                 | Evidence field                                    | Stop if                                                                                                    |
| --- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| P1  | Checkpoint **A0** recorded                                                 | Owner authorization reference written into the evidence table                                                                     | Non-blank authorization reference naming Gate 6                                                                                                                                          | `Authorization reference`                         | Missing, or only Gate 5 authorization cited                                                                |
| P2  | Gate 5 complete at `D3` / `F0`                                             | Read [A8_7_EVIDENCE.md § Gate 5](A8_7_EVIDENCE.md#gate-5--deploying-the-queued-a84ba86-code)                                      | Gate 5 record shows complete; flags were absent                                                                                                                                          | (reference only)                                  | Gate 5 incomplete or flags were set                                                                        |
| P3  | Live Production still matches Gate 5 F0 (or documented inert F0 successor) | Vercel Production deployment ID + commit                                                                                          | Gate 5 artifact `dpl_6cVssNpaZeKPBEVGDynd61AoS9nS` / `d369c6d`, or documented F0 successor (currently Bearer `dpl_Cs2TrnDsy1KSB3wipCCUt82Hpf8D` / `eb8cabe`) with all three flags absent | `F0 baseline — previous deployment ID and commit` | Production commit/flags diverge without a recorded F0 successor                                            |
| P4  | Worktree clean at authorized commit family                                 | See EC-1 commands                                                                                                                 | Clean tree; HEAD is authorized Gate 5 commit family (or Owner-authorized later commit that does not change flag semantics)                                                               | Operator notes / deviations                       | Dirty tree, or unauthorized commit                                                                         |
| P5  | Other two A8 flags absent                                                  | Vercel Production env (dashboard)                                                                                                 | `ENABLE_OWNER_EVENT_DELIVERY` and `ENABLE_REMINDER_DELIVERY` **absent** (not `false`)                                                                                                    | `F0 baseline — all three A8 flags`                | Either present                                                                                             |
| P6  | Capture flag currently absent                                              | Vercel Production env                                                                                                             | `ENABLE_OWNER_EVENT_CAPTURE` **absent** before enablement                                                                                                                                | same row                                          | Already `true` or any other value — do not "fix" without re-authorization ([G6.11](#g611-stop-conditions)) |
| P7  | No notification-processing job                                             | cron-job.org (or corroborating evidence if dashboard unreadable — [G6.7](#g67-operator-notes--mistakes-already-paid-for) item 10) | Job **does not exist**                                                                                                                                                                   | `F0 baseline — notification job absent`           | Job exists                                                                                                 |
| P8  | Reminder / Gmail-poll / suggestion jobs inactive as found                  | Same scheduler source                                                                                                             | None created or resumed for this gate                                                                                                                                                    | Scheduler notes in evidence / deviations          | Any job created or resumed for Gate 6                                                                      |

**Do not begin EC-1 until every precondition row passes.**

---

##### Execution steps

###### EC-1 — Confirm authorized worktree

|                             |                                                                                                                                                 |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **Trace**                   | [G6.2](#g62-prerequisites), [G6.7](#g67-operator-notes--mistakes-already-paid-for) items 1 and 4                                                |
| **Checkpoint**              | **A0** already recorded (P1)                                                                                                                    |
| **Expected result**         | `HEAD` equals the authorized commit (Gate 5 family or Owner-authorized successor). `git status --short` is empty.                               |
| **Evidence**                | Commit SHA; confirmation worktree was clean; note of worktree path                                                                              |
| **Stop / rollback trigger** | Dirty tree, wrong commit, or deploy attempted from `apps/web` alone → **stop**. Do not set any flag. No rollback needed if nothing was changed. |

Commands (documentation only):

```bash
cd <gate6-worktree-root>   # repo root or documented worktree root — not apps/web alone
git rev-parse HEAD
git status --short
```

###### EC-2 — Record Production F0 baseline (read-only)

|                                   |                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Trace**                         | [G6.4](#g64-production-f0-baseline)                                                                                                                                                                                                                                                                                                             |
| **Commands** (documentation only) | In Supabase SQL editor or least-privilege `psql`, run **Q2**, **Q8**, and **Q21** exactly as defined in [verification queries](#verification-queries). Separately, record from the Vercel dashboard: current Production deployment ID, commit, and all three A8 flag states. Confirm `/attention` loads. Confirm notification job absence (P7). |
| **Expected result**               | Q2 → exactly **fourteen** finished rows. Q8 → **`0, 0, 0, 0`** unless an Owner-accepted exception is already recorded. Q21 → recorded (informational). All three A8 flags **absent**. `/attention` loads with neither section on the error boundary. Notification job absent.                                                                   |
| **Evidence**                      | All `F0 baseline — *` rows in the Gate 6 capture record                                                                                                                                                                                                                                                                                         |
| **Stop / rollback trigger**       | Any [G6.11](#g611-stop-conditions) baseline failure (wrong migration count, other flag present, `/attention` error boundary, notification job present) → **hard stop**. Do not set capture.                                                                                                                                                     |

###### EC-3 — Open Owner no-use window

|                             |                                                                                                   |
| --------------------------- | ------------------------------------------------------------------------------------------------- |
| **Trace**                   | [G6.8](#g68-execution-sequence) item 2; same discipline class as [G5.9](#g59-owner-no-use-window) |
| **Action**                  | Open the Owner no-use window; record start time, timezone, and who opened it.                     |
| **Expected result**         | Window bounds recorded before any environment-variable change.                                    |
| **Evidence**                | `Owner no-use window (opened, closed, by whom)` — opened portion                                  |
| **Stop / rollback trigger** | Window not opened or bounds not recorded → **stop** before EC-7.                                  |

###### EC-4 — Reconfirm other-flag absence immediately before mutation

|                             |                                                                                                     |
| --------------------------- | --------------------------------------------------------------------------------------------------- |
| **Trace**                   | [G6.5](#g65-required-other-flag-absence)                                                            |
| **Action**                  | Re-read Vercel Production environment variables for all three A8 flags.                             |
| **Expected result**         | Capture still **absent**; delivery and reminder still **absent**.                                   |
| **Evidence**                | Note in deviations if anything changed since EC-2; otherwise confirm in flag rows                   |
| **Stop / rollback trigger** | Either other flag present, or capture already set → **hard stop** ([G6.11](#g611-stop-conditions)). |

###### EC-5 — Scheduler inactivity final check

|                             |                                                                                                            |
| --------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **Trace**                   | [G6.6](#g66-scheduler-inactivity)                                                                          |
| **Action**                  | Read-only check: no notification job; no job created/resumed/edited/invoked for this gate.                 |
| **Expected result**         | Notification-processing job **does not exist**. Gmail-poll / suggestion / reminder jobs inactive as found. |
| **Evidence**                | `F0 baseline — notification job absent` confirmed; scheduler notes                                         |
| **Stop / rollback trigger** | Notification job exists or any job was created/resumed for Gate 6 → **hard stop**.                         |

###### EC-6 — Owner authorization checkpoint before flag set

|                             |                                                                                                                                   |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **Trace**                   | [G6.3](#g63-owner-authorization-boundary)                                                                                         |
| **Checkpoint**              | **A1** — confirm aloud/on-record that the only authorized mutation is `ENABLE_OWNER_EVENT_CAPTURE=true` plus one binding redeploy |
| **Expected result**         | A1 recorded; operator proceeds only on that scope                                                                                 |
| **Evidence**                | Authorization reference row already filled; optional operator note that A1 was reconfirmed                                        |
| **Stop / rollback trigger** | Scope creep requested (second flag, scheduler, push, worker invoke) → **stop**; requires checkpoint **A3** / new Owner decision   |

###### EC-7 — Set capture flag (the only feature-flag mutation)

|                             |                                                                                                                                                                                                                                                                                         |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Trace**                   | [G6.8](#g68-execution-sequence) item 3; [G6.5](#g65-required-other-flag-absence)                                                                                                                                                                                                        |
| **Checkpoint**              | **A1**                                                                                                                                                                                                                                                                                  |
| **Action**                  | In the **Vercel dashboard → Production environment**, set `ENABLE_OWNER_EVENT_CAPTURE` to exactly the lowercase string `true`. Leave `ENABLE_OWNER_EVENT_DELIVERY` and `ENABLE_REMINDER_DELIVERY` **unset** (absent) — do **not** set them to `false`.                                  |
| **Ambiguity**               | The canonical runbook specifies the **dashboard** for this set ([G6.8](#g68-execution-sequence) item 3). It does not authorize a CLI `vercel env` write as a substitute. If dashboard access is unavailable, **stop** and obtain Owner direction rather than inventing a CLI procedure. |
| **Expected result**         | Production env shows capture = `true` (exact). Other two flags remain absent. **Running Production traffic is unchanged until a new deployment binds the value** ([G6.7](#g67-operator-notes--mistakes-already-paid-for) item 6).                                                       |
| **Evidence**                | `ENABLE_OWNER_EVENT_CAPTURE` set to exact string; both other-flag-after rows                                                                                                                                                                                                            |
| **Stop / rollback trigger** | Value is not exact `true`, or either other flag was touched → **hard stop**. Unset capture if it was set incorrectly; do not redeploy a bad binding. Containment: [G6.12](#g612-containment-and-rollback-posture).                                                                      |

###### EC-8 — Create production-target deployment (preferred method)

|                             |                                                                                                                                                                                                                                                              |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Trace**                   | [G6.8](#g68-execution-sequence) item 4 preferred path; [G6.7](#g67-operator-notes--mistakes-already-paid-for) items 1–4                                                                                                                                      |
| **Expected result**         | A new deployment is created with target **`production`**, state progressing to **READY**. Production domain alias remains on the previous F0 deployment until promote. Immutable deployment URL exists (inspection window, not invisibility).                |
| **Evidence**                | `Redeploy method`; `New deployment ID`; preliminary target/state notes                                                                                                                                                                                       |
| **Stop / rollback trigger** | Preview target created → **hard stop**; do not promote; discard ([G6.11](#g611-stop-conditions)). Push to `main` performed → **hard stop**; unauthorized deploy containment. Deploy from `apps/web` alone fails or is attempted → **stop** and correct path. |
| **Prohibited**              | `git push origin main`. Promoting a preview-target deployment.                                                                                                                                                                                               |

Commands (documentation only):

```bash
# from the clean worktree at the authorized commit (repo root)
vercel deploy --prod --skip-domain --yes
vercel inspect <deployment-url> --logs
```

###### EC-9 — Alternative redeploy method (only if Owner-authorized)

|                             |                                                                                                                                          |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **Trace**                   | [G6.8](#g68-execution-sequence) item 4 alternative                                                                                       |
| **Checkpoint**              | **A2**                                                                                                                                   |
| **Action**                  | Only if A2 is recorded for this window: perform a Vercel Production redeploy of the current Production commit after the variable is set. |
| **Expected result**         | New deployment ID; target `production`; READY; bound flag values recorded.                                                               |
| **Evidence**                | Same deployment rows; method named as Production redeploy                                                                                |
| **Stop / rollback trigger** | Alternative used without A2 → **hard stop**. Treat as unauthorized method.                                                               |
| **Skip**                    | If EC-8 preferred path is used, record "N/A — preferred path" and continue to EC-10.                                                     |

###### EC-10 — Pre-promotion / pre-reliance inspection

|                             |                                                                                                                                                                                                                                                                                                              |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Trace**                   | [G6.9](#g69-pre-promotion-inspection)                                                                                                                                                                                                                                                                        |
| **Action**                  | Before `vercel promote` (preferred path) or before relying on the new deployment, confirm every G6.9 row.                                                                                                                                                                                                    |
| **Expected result**         | Target `production`; state READY; commit authorized; `ENABLE_OWNER_EVENT_CAPTURE=true` in the deployment's Production env binding; other two A8 flags **absent**; build log shows **no** migration (only `prisma generate`); routes still include `/api/v1/internal/notifications/process` and `/attention`. |
| **Evidence**                | Deployment target, state, commit bound, flag bindings, promote readiness notes                                                                                                                                                                                                                               |
| **Stop / rollback trigger** | Any G6.9 row fails → **do not promote / do not continue**. Unset the capture flag if it was set; leave Production on the previous F0 deployment ([G6.9](#g69-pre-promotion-inspection), [G6.12](#g612-containment-and-rollback-posture)).                                                                    |

###### EC-11 — Promote only if alias not already on the new deployment

|                             |                                                                                                                                                                                                                                                                                   |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Trace**                   | [G6.8](#g68-execution-sequence) item 4; [G6.7](#g67-operator-notes--mistakes-already-paid-for) item 3                                                                                                                                                                             |
| **Expected result**         | Production alias points at the intended new deployment ID. **Confirm what actually holds the production alias** before and after — Gate 5 deviation 1: aliases may assign at creation despite `--skip-domain`.                                                                    |
| **Evidence**                | `Promotion / production alias result`                                                                                                                                                                                                                                             |
| **Stop / rollback trigger** | Alias on unexpected deployment → **hard stop** ([G6.11](#g611-stop-conditions)). Resolve alias before any further change. Rollback trigger: Instant Rollback to F0 while it remains one step back, or unset capture + redeploy ([G6.12](#g612-containment-and-rollback-posture)). |
| **Skip note**               | If the production alias is already on the inspected deployment, record that fact and do not issue a redundant promote.                                                                                                                                                            |

Command (documentation only):

```bash
vercel promote <deployment-id> --yes
```

###### EC-12 — Post-activation verification

|                                            |                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Trace**                                  | [G6.10](#g610-post-activation-verification)                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **Commands / checks** (documentation only) | 1. Vercel Production env: capture exactly `true`; other two **absent**. 2. Deployment Ready; alias on intended ID. 3. Unauthenticated `GET /api/v1/tasks` → typed `401 UNAUTHORIZED`. 4. Owner `/attention` loads; no error boundary. 5. Q2 → still fourteen rows. 6. Q8: `owner_notification_attempts` is **0** (intent count may still be 0 — acceptable). 7. No notification job; endpoint not invoked. 8. No Gmail contact for Owner-notification or reminder send. |
| **Expected result**                        | All eight G6.10 checks pass. State is **`F1`** — capture-only; code remains `D3`; delivery and reminder flags absent.                                                                                                                                                                                                                                                                                                                                                   |
| **Evidence**                               | Every `Verification — *` row; `Final state` = `F1` / code still `D3`; attempts count **0**                                                                                                                                                                                                                                                                                                                                                                              |
| **Stop / rollback trigger**                | Any [G6.11](#g611-stop-conditions) row — especially attempts non-zero, other flag present, `/attention` error boundary, migration history changed, endpoint invoked, or notification job created → **hard stop** and contain per [G6.12](#g612-containment-and-rollback-posture).                                                                                                                                                                                       |

---

##### Explicit stop conditions (standing table)

Trace: [G6.11](#g611-stop-conditions). Any row is a hard stop; do not continue the checklist.

| Condition                                         | Immediate action                                            |
| ------------------------------------------------- | ----------------------------------------------------------- |
| Either other A8 flag is present or became set     | Unset capture if set; do not continue                       |
| Capture value is anything other than exact `true` | Fix spelling only under re-authorization                    |
| Preview-target deployment created or promoted     | Do not promote; discard                                     |
| Push to `main` performed                          | Treat as unauthorized deploy; follow containment            |
| `/attention` error boundary                       | Contain per [G6.12](#g612-containment-and-rollback-posture) |
| `owner_notification_attempts` non-zero            | Something delivered; contain immediately                    |
| Notification job created or endpoint invoked      | Pause/remove job if created; unset delivery if set          |
| Migration history changed                         | Wrong procedure was followed                                |
| Production alias on an unexpected deployment      | Resolve alias before any further change                     |

##### Explicit rollback trigger points

| After step  | Trigger                                                            | Rollback action                                                                                                               |
| ----------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| EC-7        | Bad or non-exact capture value; other flag touched                 | Unset capture; do not redeploy a bad binding                                                                                  |
| EC-8 / EC-9 | Preview target; wrong commit; inspection failure before alias move | Do not promote; discard build; unset capture if set; leave alias on F0                                                        |
| EC-11       | Alias on unexpected deployment; post-promote verification failing  | Instant Rollback to F0 while one step back, **or** unset capture + redeploy ([G6.12](#g612-containment-and-rollback-posture)) |
| EC-12       | Any G6.11 condition after F1 binding                               | Same as G6.12 primary containment                                                                                             |

**Do not** treat F2 as a rollback target. **Do not** use code containment to `534959d` as the first response to a capture-flag mistake.

---

##### Final verification checklist

Re-confirm every item after EC-12. Trace: [G6.10](#g610-post-activation-verification), [G6.13](#g613-evidence-recording).

- [ ] `ENABLE_OWNER_EVENT_CAPTURE` is exactly `true` in Production
- [ ] `ENABLE_OWNER_EVENT_DELIVERY` is **absent**
- [ ] `ENABLE_REMINDER_DELIVERY` is **absent**
- [ ] New deployment is READY and holds the production alias as intended
- [ ] Unauthenticated `GET /api/v1/tasks` returns typed `401 UNAUTHORIZED`
- [ ] `/attention` loads; neither section on the error boundary
- [ ] Q2 still exactly **fourteen** migration rows
- [ ] `owner_notification_attempts` is **0**
- [ ] Notification job still absent; `/api/v1/internal/notifications/process` was **not** invoked
- [ ] No Owner/Recipient notification or reminder email; no Gmail API call for those paths
- [ ] Final state recorded as **`F1`**, code still **`D3`**
- [ ] Gate 6 capture record has **no blank rows**
- [ ] `Stage 12 / A8.7d / A8.7e not begun beyond this gate` = **y**

##### Gate completion criteria

Trace: [G6.14](#g614-stop-before-stage-12-close-out-and-before-a87d).

Gate 6 is complete **only** when all of the following are true:

1. Post-activation verification ([G6.10](#g610-post-activation-verification) / EC-12) passed with no unresolved stop condition.
2. Evidence in [A8_7_EVIDENCE.md § Gate 6](A8_7_EVIDENCE.md#gate-6--first-controlled-production-enablement-a87c-capture--f0--f1) is filled in the same window with no blank rows ([G6.13](#g613-evidence-recording)).
3. Production is at verified **`F1`** (capture-only); code remains **`D3`**.
4. Owner no-use window is closed, **or** kept open only because Stage 12 was **separately** authorized to continue immediately (that continuation is not Gate 6).
5. Operator **stops**. No Stage 12 close-out, A8.7d, A8.7e, second flag, scheduler creation, worker invoke, or `origin/main` reconciliation is performed under this checklist.

**Explicitly out of this checklist (never mark complete by doing these):** setting `ENABLE_OWNER_EVENT_DELIVERY` or `ENABLE_REMINDER_DELIVERY`; creating or invoking any notification/reminder scheduler job; Stage 12 observation close-out as a product decision; A8.7d; A8.7e; `git push origin main`.

### Stage 12 — Capture-only observation (A8.7c / F1)

**Stage 12 would observe capture-only behaviour at Production `D3` / `F1` and do nothing else.** No second flag, no scheduler job, no worker invocation, no Gmail send, no migration, no push to `main`. Capture remains the only enabled A8 feature. Delivery and reminder stay absent.

**Stage 12 has not been executed, and this section does not authorize it.** It is the single normative operator procedure for the observation window. Prefer this `G12.x` section when it and the [stage-runbook Stage 12 body](#stage-12--capture-only-observation-a87c) differ in specificity; do not run both as separate procedures.

> **⚠ Stage 12 is not currently reachable, and this section does not make it so.** Live Production is **`D3` / `F0`** — [Gate 6](#gate-6--first-controlled-production-enablement-a87c-capture--f0--f1) was authorized and partially executed but never became live, and the capture flag has since been removed from Vercel Production. Every `F1` statement below is therefore a **precondition of a hypothetical authorized window**, not a description of Production today. See [Current production state](#current-production-state).

> **⚠ Stage 12 does not enable delivery.** Setting `ENABLE_OWNER_EVENT_DELIVERY` or `ENABLE_REMINDER_DELIVERY`, creating or invoking any notification or reminder scheduler job, or calling `POST /api/v1/internal/notifications/process` is an A8.7d (or later) decision and is a hard stop here.

#### G12.1 Objective

Confirm, over an Owner-authorized observation window at **`D3` / `F1`**, that:

1. Capture may write `owner_notification_intents` when genuine notifiable events occur.
2. **`owner_notification_attempts` remains exactly 0** for the whole window (hard invariant — zero delivery attempts).
3. No Owner-notification or reminder email is sent (confirmed by attempts = 0, not by mailbox inspection alone).
4. No notification-processing job exists or is created; the notification endpoint is never invoked.
5. `ENABLE_OWNER_EVENT_DELIVERY` and `ENABLE_REMINDER_DELIVERY` remain **absent**.

#### G12.2 Scope

| In scope                                                                                                 | Out of scope                                                                                      |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Read-only verification (Q15, Q8; flags; deployment; scheduler inactivity; `/attention`)                  | Setting, unsetting, or editing `ENABLE_OWNER_EVENT_DELIVERY` or `ENABLE_REMINDER_DELIVERY`        |
| Passive observation of ordinary Owner and Recipient activity already occurring in Production             | Creating or invoking any scheduler job, including the notification job                            |
| Recording evidence in [A8_7_EVIDENCE.md § Stage 12](A8_7_EVIDENCE.md#stage-12--capture-only-observation) | Invoking `POST /api/v1/internal/notifications/process` (manual or scheduled)                      |
| Closing the observation window with attempts still at 0                                                  | Any migration, deploy, promote, or `git push origin main`                                         |
|                                                                                                          | A deliberate single-event canary (that is [Stage 14](#stage-14--single-notification-canary-a87d)) |
|                                                                                                          | Zero-send rehearsal, Gmail round-trip proof, A8.7d, A8.7e                                         |

#### G12.3 Prerequisites

Every one of these must hold and be confirmed rather than assumed:

- **Gate 6 is complete and verified** at **`D3` / `F1`**. Evidence: [A8_7_EVIDENCE.md § Gate 6](A8_7_EVIDENCE.md#gate-6--first-controlled-production-enablement-a87c-capture--f0--f1). **This prerequisite is currently unmet:** Gate 6 is incomplete and the recorded evidence says so.
- **The deployment holding the public custom domain is an `F1` deployment** whose own environment snapshot has capture = `true` and the other two flags absent. **Currently unmet:** the public alias `rocket-communicator-web.vercel.app` is on the `F0` Bearer deployment `dpl_Cs2TrnDsy1KSB3wipCCUt82Hpf8D` (`eb8cabe`). `dpl_7X5r5ypWbq6ipmWMpver6p99p5Xz` is READY but holds only default `.vercel.app` aliases, so it is **not** the live site and does not satisfy this check.
- **`ENABLE_OWNER_EVENT_CAPTURE` is exactly `true`**; **`ENABLE_OWNER_EVENT_DELIVERY` and `ENABLE_REMINDER_DELIVERY` are absent**.
- **No notification-processing job exists.** Creating one is an A8.7d decision.
- Gmail Poll and Suggestion Processing remain **inactive as found**. Do not resume them for Stage 12.
- Q8 was **`0, 0, 0, 0`** at the last recorded Production reading. Stage 12 starts from a freshly taken baseline, not from a remembered one.

#### G12.4 Owner authorization boundary

- **Stage 12 requires its own explicit Owner authorization.** Gate 6's completion authorizes nothing here.
- Authorization must cover at least: (1) opening and closing an observation window of a **stated duration or completion trigger**, (2) read-only SQL and dashboard checks listed below, and (3) recording Stage 12 evidence.
- **Stage 12 does not authorize A8.7d, A8.7e, any second flag, any scheduler creation, any worker invoke, any deploy, or reconciling `origin/main`.**

#### G12.5 Permitted observation mode

**Traced to the existing Stage 12 execution text:** observe while **normal Owner and Recipient activity proceeds**. Capture on ordinary mutations does not require a worker invocation ([G6.6](#g66-scheduler-inactivity)).

| Mode                                                                                           | Stage 12 status                                                                                                                                                                |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Passive observation** of ordinary Owner/Recipient activity that already occurs in Production | **Permitted and sufficient**                                                                                                                                                   |
| **Deliberate capturing mutation** / forced single producer event                               | **Not required. Not defined here.** Choosing and performing a single reviewed canary event is [Stage 14](#stage-14--single-notification-canary-a87d) under A8.7d authorization |
| Invoking the notification worker "to exercise capture"                                         | **Prohibited** — hard stop                                                                                                                                                     |

**Intent count may remain 0** for the whole window if no capturing activity occurs. That is acceptable for Stage 12 completion provided **`owner_notification_attempts` stays 0** and no stop condition fires. When intents do appear, each observed `event_type` must correspond to a genuine event that occurred (existing Stage 12 verification text).

#### G12.6 Observation-window open and close

**Open (in order):**

1. Confirm [G12.3](#g123-prerequisites) and record the [G12.7](#g127-baseline-at-window-open) baseline.
2. Record the Owner-authorized **window duration or completion trigger** (ISO bounds when known). Stage 12 does **not** invent a fixed duration; the Owner states it. A window long enough for pending intents to age into Q15's `over_24h` bucket is useful later for A8.7d Stage 13, but **is not a Stage 12 completion requirement**.
3. Record that the window is **open**.

**During the window:**

4. At Owner-authorized intervals, run [G12.8](#g128-sql-order-and-expected-results) and record each observation into the evidence table.
5. Do not change flags, schedulers, or deployments.

**Close (in order):**

6. Run the final [G12.8](#g128-sql-order-and-expected-results) observation.
7. Confirm [G12.10](#g1210-final-verification) and fill [A8_7_EVIDENCE.md § Stage 12](A8_7_EVIDENCE.md#stage-12--capture-only-observation).
8. Record that the window is **closed**.
9. **Stop** before A8.7d ([G12.12](#g1212-stop-before-a87d)).

#### G12.7 Baseline at window open

| Check                                           | Expectation                                                                                               |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Deployment holding the **public custom domain** | An `F1` deployment. Record the ID the custom domain actually resolves to, not the newest READY deployment |
| `ENABLE_OWNER_EVENT_CAPTURE`                    | Exact `true`                                                                                              |
| `ENABLE_OWNER_EVENT_DELIVERY`                   | **Absent**                                                                                                |
| `ENABLE_REMINDER_DELIVERY`                      | **Absent**                                                                                                |
| Notification-processing job                     | **Does not exist**                                                                                        |
| Gmail Poll / Suggestion Processing              | Inactive as found                                                                                         |
| Q8                                              | Record all four counts; **`owner_notification_attempts` = 0**; **`reminder_delivery_attempts` = 0**       |
| Q15                                             | Record `under_1h`, `h1_to_24`, `over_24h` (may all be 0)                                                  |
| `/attention`                                    | Loads; neither section reaches the error boundary                                                         |

#### G12.8 SQL order and expected results

Run from the Supabase SQL editor or least-privilege `psql`. **Copy each query exactly** from [verification queries](#verification-queries). Do not invent SQL.

**Order at every observation (open, each interval, close):**

1. **Q15** — exact SQL from the verification-queries table (`notifications.pending.buckets`).
2. **Q8** — exact SQL from the verification-queries table (four `count(*)` statements).

| Query (canonical IDs only)         | Stage 12 expected result                                                                                                                                                                                                                            | Hard stop                                                                 |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Q15 pending buckets                | Recorded buckets. May be `0, 0, 0`. Growth in `under_1h` / `h1_to_24` is acceptable when genuine events occurred. `over_24h` may become non-zero if the window is long enough — expected for later Stage 13 prep, not required to complete Stage 12 | Intent growth **wildly out of proportion** to known activity              |
| Q8 → `task_reminder_schedules`     | Recorded (often 0)                                                                                                                                                                                                                                  | Not a Stage 12 hard stop by itself                                        |
| Q8 → `reminder_delivery_attempts`  | **0**                                                                                                                                                                                                                                               | **Any non-zero — hard stop** (reminder delivery must not occur)           |
| Q8 → `owner_notification_intents`  | Recorded (may be 0 or growing)                                                                                                                                                                                                                      | An intent whose `event_type` does not match a genuine event that occurred |
| Q8 → `owner_notification_attempts` | **0**                                                                                                                                                                                                                                               | **Any non-zero — hard stop** (nothing should be delivering)               |

**Do not run** delivery-path or canary-prep queries as Stage 12 steps: no Q16/Q17/Q18/Q19/Q20 requirement here, and **Q21 is not a Stage 12 stop** (it becomes a hard stop before the A8.7d canary, not during capture-only observation).

#### G12.9 Operator execution checklist

> **⚠ Documentation only. This checklist does not authorize Stage 12 and must not be executed until the Owner has given Stage 12 its own explicit authorization.**

##### Owner authorization checkpoints

| Checkpoint                                                                                                                            | Before                          | Trace                                            |
| ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | ------------------------------------------------ |
| **A0** — Explicit Stage 12 authorization exists (Gate 6's does not carry)                                                             | Any Stage 12 production contact | [G12.4](#g124-owner-authorization-boundary)      |
| **A1** — Authorization states the window duration or completion trigger                                                               | Window open                     | [G12.6](#g126-observation-window-open-and-close) |
| **A2** — Any action outside this checklist (second flag, scheduler, worker invoke, deploy, A8.7d/e) requires a **new** Owner decision | Never during Stage 12           | [G12.12](#g1212-stop-before-a87d)                |

##### Preconditions (P1–P8)

| #   | Check                                                       | Expected                                                                                                                                                                  |
| --- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | Gate 6 evidence complete at `F1`                            | [A8_7_EVIDENCE.md § Gate 6](A8_7_EVIDENCE.md#gate-6--first-controlled-production-enablement-a87c-capture--f0--f1) shows complete. **Currently shows incomplete**          |
| P2  | The **public custom domain** resolves to an `F1` deployment | Capture `true` in that deployment's snapshot; other two flags absent. **Currently unmet — the alias is on the `F0` Bearer deployment `dpl_Cs2TrnDsy1KSB3wipCCUt82Hpf8D`** |
| P3  | Notification job absent                                     | Job does not exist                                                                                                                                                        |
| P4  | Gmail Poll / Suggestion Processing inactive as found        | Inactive; not resumed                                                                                                                                                     |
| P5  | Q8 attempts = 0                                             | `owner_notification_attempts` = 0; `reminder_delivery_attempts` = 0                                                                                                       |
| P6  | `/attention` loads                                          | No error boundary                                                                                                                                                         |
| P7  | Owner duration / completion trigger recorded                | Explicit                                                                                                                                                                  |
| P8  | Checkpoint **A0** recorded                                  | Stage 12's own authorization                                                                                                                                              |

##### Execution steps (S1–S8)

| Step | Action                                                                                                                  | Expected result                            | Evidence                           | Stop / rollback trigger                                                          |
| ---- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ---------------------------------- | -------------------------------------------------------------------------------- |
| S1   | Confirm P1–P8; record [G12.7](#g127-baseline-at-window-open)                                                            | Baseline matches F1 capture-only           | Baseline rows in Stage 12 evidence | Any prerequisite fails → **hard stop**; do not open the window                   |
| S2   | Record window open + authorized duration/trigger (checkpoint **A1**)                                                    | Window open recorded                       | Window from/to                     | Missing authorization → **hard stop**                                            |
| S3   | Run **Q15**, then **Q8** (open observation)                                                                             | Attempts = 0; buckets recorded             | Evidence table row                 | Attempts non-zero → [G12.11](#g1211-containment-and-rollback)                    |
| S4   | At each authorized interval: Q15, then Q8; note event types if intents grew                                             | Attempts = 0 throughout                    | One evidence row per interval      | Attempts non-zero; unmatched event_type; disproportionate growth → **hard stop** |
| S5   | Confirm still: capture `true`; delivery absent; reminder absent; no notification job; endpoint not invoked              | Unchanged                                  | Flag/scheduler confirmation rows   | Any second flag set or job created → **hard stop**                               |
| S6   | Final Q15, then Q8 (close observation)                                                                                  | Attempts = 0                               | Final evidence row                 | Attempts non-zero → **hard stop**                                                |
| S7   | Fill [A8_7_EVIDENCE.md § Stage 12](A8_7_EVIDENCE.md#stage-12--capture-only-observation) with no blank load-bearing rows | Evidence complete                          | Evidence file                      | Blank attempts/bucket rows → incomplete; do not mark complete                    |
| S8   | Record window closed; stop before A8.7d                                                                                 | Stage 12 complete at `F1`; A8.7d not begun | Final state row                    | —                                                                                |

##### Explicit stop conditions

| Condition                                                                         | Action                                                               |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `owner_notification_attempts` non-zero                                            | **Hard stop.** Contain per [G12.11](#g1211-containment-and-rollback) |
| `reminder_delivery_attempts` non-zero                                             | **Hard stop.** Contain per G12.11                                    |
| `ENABLE_OWNER_EVENT_DELIVERY` or `ENABLE_REMINDER_DELIVERY` present               | **Hard stop.** Unset if set under this window; do not continue       |
| Notification job created or `POST /api/v1/internal/notifications/process` invoked | **Hard stop.** Pause/remove job if created; contain                  |
| Intent whose event did not occur                                                  | **Hard stop.** Investigate; do not proceed to A8.7d                  |
| Intent growth wildly out of proportion to activity                                | **Hard stop.** Investigate                                           |
| Deploy / promote / push performed during the window                               | **Hard stop.** Unauthorized change                                   |

##### Explicit rollback trigger points

| Step  | Trigger                     | Action                                                                               |
| ----- | --------------------------- | ------------------------------------------------------------------------------------ |
| S3–S6 | Attempts non-zero           | [G12.11](#g1211-containment-and-rollback) primary containment                        |
| S5    | Second flag or job appeared | Unset delivery/reminder if set; remove/pause job; unset capture + redeploy if needed |
| Any   | G12.10 stop condition       | Contain; do not close Stage 12 as successful                                         |

#### G12.10 Final verification

Re-confirm after S6–S7:

- [ ] Capture flag still exact `true`; other two A8 flags **absent**
- [ ] Production still on the intended F1 deployment (or documented successor)
- [ ] `owner_notification_attempts` = **0** at every observation including final
- [ ] `reminder_delivery_attempts` = **0** at every observation including final
- [ ] Notification job still absent; endpoint never invoked
- [ ] No Owner-notification or reminder email sent (attempts invariant)
- [ ] Evidence table filled; window duration recorded
- [ ] A8.7d and A8.7e **not begun**

**Required final state:** **`D3` / `F1`** — capture only; delivery and reminder absent; no notification scheduler; attempts = 0.

#### G12.11 Containment and rollback

**Primary containment:** unset `ENABLE_OWNER_EVENT_CAPTURE` and redeploy, returning toward **F0** (existing Stage 12 immediate containment / Gate 6 rollback posture).

- Captured intents remain and are harmless: an intent older than 24 hours terminalizes as suppressed without contacting anything when delivery is later rehearsed (Stage 13).
- Instant Rollback toward F0: from the current Bearer alias-holder `dpl_Cs2TrnDsy1KSB3wipCCUt82Hpf8D`, one-step Instant Rollback lands on the immediately previous deployment (Gate 5's `dpl_6cVssNpaZeKPBEVGDynd61AoS9nS` while that remains one step back).
- **Rollback does not unapply migrations, pause external scheduler jobs by itself, or unsend mail.** Schema stays at fourteen rows. No mail should have been sent in Stage 12; if any was, that is already a hard stop.

#### G12.12 Stop before A8.7d

**Stage 12 ends at a closed observation window with attempts = 0 and recorded evidence.** When final verification passes:

1. Record the evidence.
2. Close the window.
3. **Stop.**

**Explicitly not authorized by Stage 12:**

- **A8.7d** — zero-send rehearsal, notification canary, Gmail round-trip proof, notification scheduler creation
- **A8.7e** — reminder delivery
- Setting `ENABLE_OWNER_EVENT_DELIVERY` or `ENABLE_REMINDER_DELIVERY`
- Creating or invoking any notification or reminder scheduler job
- Unsetting capture to age the queue for Stage 13 (that is an A8.7d precondition action under A8.7d authorization)
- Reconciling `origin/main`

**A8.7c ends here.** A8.7d requires separate authorization, and it is the first slice that can send mail on Rocket's initiative.

#### G12.13 Evidence recording

Fill [A8_7_EVIDENCE.md § Stage 12](A8_7_EVIDENCE.md#stage-12--capture-only-observation) in the same window. Required categories:

- Authorization reference (Stage 12's own)
- Window open/close (duration or completion trigger)
- F1 baseline (deployment, flags, Q8, Q15, scheduler state)
- Every observation row: time, Q15 buckets, Q8 four counts (attempts expect 0), event types observed
- Explicit confirmation endpoint never invoked; no notification job created
- Deviations, stop conditions, containment
- Final state: still `D3` / `F1`; A8.7d not begun

**Secrets never appear in evidence.**

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

**Gate 5 classification, stated explicitly so it is not inferred.** Docker is required for exactly one Gate 5 item — the [nine PostgreSQL suites](#g53-the-nine-postgresql-suites) in the prerequisites — and for nothing else in the gate:

| Activity                                                                  | Docker                                                                         |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| The nine `.pg.test.ts` suites at the Gate 5 commit                        | **Required** — `postgres:17`, loopback 5433, `AICAA_PG_CONCURRENCY_URL` set    |
| `pnpm verify`                                                             | **Not required** — deliberately, so verify stays Docker-free and deterministic |
| Local production build and the built-bundle guards                        | **Not required**                                                               |
| Gate 5 build, inspection, promotion, smoke sequence, and inertness checks | **Not required**                                                               |
| Any read-only Production database query                                   | **Not required**                                                               |

Start the container for the suites, then stop it. **A container left running through a production window is a loose end, not a convenience.**

### Flag-staging states (A8.7c–A8.7e)

**These states all sit inside `D4+` of the [approved repair state matrix](#approved-repair-state-matrix), and they use their own `F` namespace deliberately.** The `D` states describe how far the _code and schema_ have advanced; the `F` states describe which _flags_ are set once both are in place. They were a single sequence before the incident, and merging them again would reintroduce the ambiguity that let a deployment be described as a migration prerequisite.

**Every `F` state presupposes `D3`**: the queued A8 code deployed against all nine migrations. **Gate 5 completed on 2026-08-05, so Production is at `F0`.** None of `F1`–`F4` is reachable until [Gate 6](#gate-6--first-controlled-production-enablement-a87c-capture--f0--f1) (and later A8.7 slices) are separately authorized and actually completed. `F0` and `D3` describe the same Production today: the code deployed, every flag absent. **A flag set on a production-target deployment that does not hold the public custom domain does not advance the `F` state** — that is what the partial Gate 6 attempt demonstrated.

| State                          | Commit         | Capture | Delivery | Reminder | Scheduler jobs                            | Valid rollback target                        |
| ------------------------------ | -------------- | ------- | -------- | -------- | ----------------------------------------- | -------------------------------------------- |
| **F0** Deployed, all flags off | queued A8 code | absent  | absent   | absent   | as found                                  | **Yes — the designated safe harbour**        |
| **F1** Capture-only            | queued A8 code | `true`  | absent   | absent   | as found                                  | Yes                                          |
| **F2** Delivery rehearsal      | queued A8 code | absent  | `true`   | absent   | as found                                  | No — exists only for the zero-send rehearsal |
| **F3** Capture + delivery      | queued A8 code | `true`  | `true`   | absent   | + notification job (after the Gmail gate) | Yes                                          |
| **F4** All three flags         | queued A8 code | `true`  | `true`   | `true`   | + reminder job                            | Yes                                          |

The [environment-variable binding model](#approved-repair-state-matrix) governs every transition below: a deployment carries the values it was built with, and rolling back to a deployment built with a flag set restores that flag.

Rules that follow from it:

- **F0 is the safe-harbour configuration** once the queued code is deployed: that code with every A8 feature inert. Returning to it is the containment action for almost everything in A8.7c–A8.7e.
- **Reaching F0 later may require a fresh deployment rather than Instant Rollback.** On the **Hobby** plan, rollback may only reach the **immediately previous** deployment. Once F1 and F2 exist, F0 is two or three steps back and is no longer reachable by rollback at all. Plan on unsetting the variables and redeploying.
- **Rollback does not disable external scheduler jobs.** cron-job.org keeps calling the endpoints; the endpoints simply become inert again because the rolled-back build has no flags. If the intent is to stop invocation, **pause the job** — that is a separate action in a separate system.
- **Rolling back does not undo a migration.** Schema is forward-only, so no `F` transition can return the database to `D1` or `D2`.
- **Rolling back does not unsend an email.**

### Migration failure model (A8.7)

Stated precisely, because the wrong mental model here produces exactly the wrong recovery action.

- **No A8 migration contains an explicit `BEGIN` or `COMMIT`.** This was verified across all nine files, and re-confirmed by the [local rehearsal](A8_7B_INCIDENT_1A_EVIDENCE.md).
- `prisma migrate deploy` applies **pending files sequentially**, recording each in `_prisma_migrations` as it completes.
- **No transaction spans migration files.** A failure in file 5 leaves files 1–4 applied and committed.
- PostgreSQL **may** treat a multi-statement query message as an implicit transaction block, so a multi-statement file **might** roll back as a unit. **The runbook does not rely on that.** It is emergent behaviour of statement grouping in a driver, not a property this repository establishes or tests, and three migration file headers make a claim about transaction grouping that is [explicitly corrected above](#database-migrations).
- **After any failure, inspect the physical schema.** What is actually present is the only authority.
- **Never call `migrate resolve` on the strength of the `_prisma_migrations` row alone.** That row records what Prisma believes, and the whole reason you are reading this is that Prisma's belief and the database disagree.

The accurate description of the operation is:

> One ordered `prisma migrate deploy` invocation, applying pending migration files sequentially with per-file recording and no guaranteed cross-file or per-file atomicity.

**Do not describe the repair's five migrations — or the full nine — as an atomic unit**, in evidence, in a ticket, or to yourself at 2 a.m. The rehearsal applying all five cleanly is evidence that they _can_ apply cleanly, not that they apply as one transaction.

### Per-migration recovery decision tree

All nine A8 migrations, in application order. All nine are additive; none drops anything.

> **All nine entries are now history, and the whole tree is a reference rather than a live procedure.** Migrations 1–5 are the [A8.7b-INCIDENT-1c repair set](#repair-boundary), applied and verified on 2026-08-04. Migrations 6–9 are the [Gate 4](#gate-4--production-migrations-69) set, applied and verified on 2026-08-05 with no stop condition fired. Every entry is retained unedited as the reference for any later dispute about what was applied and how a failure would have been recovered. **No migration in this repository is pending against Production.** [Gate 5](#gate-5--deploying-the-queued-a84ba86-code) applies none, so nothing in this tree is reachable from it.

**The three physical-state classifications**, which every entry below uses:

| Classification   | Meaning                                       | Standing rule                                                                                                 |
| ---------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **None present** | No object the failed migration creates exists | Resolving as **rolled back** may be appropriate **after the cause is corrected**                              |
| **All present**  | Every object exists and is correct            | Resolving as **applied** may be considered **only after proving the end state exactly matches the migration** |
| **Some present** | A partial application                         | **Stop and escalate**, unless an entry below describes an explicitly reviewed recovery for that exact state   |

`migrate resolve --applied` is the dangerous one throughout: it tells Prisma to stop trying, permanently, and every later migration then runs against a schema nobody re-verified.

**Escalation condition, common to all nine:** any state not exactly matching a case below, any doubt about which case applies, or any temptation to "just drop it and re-run" — stop, record the physical state, and get a second reviewer.

**Waiting still costs nothing, but not for the reason it originally did.** The first version of this rule reasoned that Production held no A8 rows and that its deployed code was already incompatible, so nothing could be made worse. **Both halves of that expired with the repair.** The conclusion survived on different grounds: **no deployed code reads anything migrations 6–9 create.** `ENABLE_OWNER_EVENT_CAPTURE` is absent, the notification tables are queried only by code that is not deployed, and an index changes no result. A stop during Gate 4 would therefore have left Production either in the validated `D1′` or in a partial state that nothing running touches.

**That reasoning is why `D2` was a safe resting place after Gate 4, and it did not expire when Gate 4 completed.** Gate 5 has since moved Production to `D3` / `F0`. **Nothing creates urgency around [Gate 6](#gate-6--first-controlled-production-enablement-a87c-capture--f0--f1), Stage 12, A8.7d, or A8.7e.**

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

**6. `20260802173000_a8_4b1_capability_skip_reason` — 1 statement. Gate 4 migration 1 of 4.**

`ALTER TYPE "ReminderSkipReason" ADD VALUE IF NOT EXISTS 'no_actionable_capability'`.

- **Idempotency:** **Fully idempotent** (`IF NOT EXISTS`).
- **Likely failure points:** only a connection loss. A single-statement file cannot be partially applied.
- **Detection:** Q12 with the label name, or the `m6_label` column of [QG](#g411-post-migration-verification).
- **Clean re-execution safe?** **Yes, unconditionally.** Re-running is a no-op if the label is present.
- **None present:** `migrate resolve --rolled-back`, re-run.
- **All present:** re-running is a safer choice than `migrate resolve --applied`, and costs nothing.
- **Some present:** **not reachable** — one statement, one label.

---

**7. `20260802210000_a8_4b2_repeated_ambiguous_stop_reason` — 1 statement. Gate 4 migration 2 of 4.**

`ALTER TYPE "ReminderScheduleStopReason" ADD VALUE IF NOT EXISTS 'repeated_ambiguous_outcomes'`.

- **Idempotency:** **Fully idempotent** (`IF NOT EXISTS`).
- **Likely failure points:** only a connection loss. A single-statement file cannot be partially applied.
- **Detection:** Q12 with the label name, or the `m7_label` column of [QG](#g411-post-migration-verification).
- **Clean re-execution safe?** **Yes, unconditionally.** Re-running is a no-op if the label is present.
- **None present:** `migrate resolve --rolled-back`, re-run.
- **All present:** re-running is a safer choice than `migrate resolve --applied`, and costs nothing.
- **Some present:** **not reachable** — one statement, one label.

---

**8. `20260803090000_a8_4b3_advance_due_scan_index` — 1 statement. Gate 4 migration 3 of 4, and the only migration in the gate that touches a table that already exists.**

`CREATE INDEX IF NOT EXISTS "task_reminder_schedules_advance_due_scan_idx"` — a partial index on `("advance_occurrence_at", "id")` where `"status" = 'active' AND "advance_disposition" = 'scheduled'`.

- **Idempotency:** **Fully idempotent**, with one trap: `IF NOT EXISTS` matches on the **name alone**, so an index carrying the right name and a wrong definition would satisfy it permanently and silently.
- **Likely failure points:** the build takes a **`SHARE`** lock on `task_reminder_schedules` and holds it for the whole build, blocking every write to that table. Run the row count and the lock probe in [G4.8](#g48-lock-risk-checks) first; against an empty table the build is instantaneous.
- **Detection:** Q13, reading **`indisvalid`** as well as existence.
- **Clean re-execution safe?** Yes, from **none present** and from **all present** alike.
- **None present:** the index does not exist under any name. `migrate resolve --rolled-back`, re-run. One statement means there is nothing else to undo first.
- **All present:** the index exists **and** `indisvalid = true` **and** its definition matches the migration — same table, same column order, same partial predicate. Prove the definition, not the name.
- **Some present:** a failed build leaves an **invalid** index, which satisfies `IF NOT EXISTS` while serving nothing. It must be removed with **`DROP INDEX CONCURRENTLY`** before any rebuild.
- **If the table is populated:** this is **not** a free-hand manual build. The out-of-band `CREATE INDEX CONCURRENTLY` forward fix is specified, with its verification and its constraints, in [G4.9](#g49-the-populated-table-branch), and it **requires a second, separate Owner authorization before any write**. Gate 4's own authorization does not reach it.

---

**9. `20260803120000_a8_5a_owner_notification_intents` — 28 statements. Gate 4 migration 4 of 4, and the largest migration in the gate.**

Creates five enum types and two tables — `owner_notification_intents` and `owner_notification_attempts` — with fifteen named constraints, six indexes, and RLS on both. It alters no existing table.

**The exact object inventory.** [G4.11](#g411-post-migration-verification) verifies Q11 and Q13 against "every named object from the recovery tree", and a partial application is caught by name rather than by count, so the names are written out here:

| Kind                                                   | Names                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Enum types (5)                                         | `OwnerNotificationEventType`, `OwnerNotificationSubjectKind`, `OwnerNotificationState`, `OwnerNotificationSuppressionReason`, `OwnerNotificationAttemptOutcome`                                                                                                                                                                                                                                                                             |
| Tables (2)                                             | `owner_notification_intents`, `owner_notification_attempts`                                                                                                                                                                                                                                                                                                                                                                                 |
| Primary keys (2)                                       | `owner_notification_intents_pkey`, `owner_notification_attempts_pkey`                                                                                                                                                                                                                                                                                                                                                                       |
| Foreign key (1)                                        | `owner_notification_attempts_intent_id_fkey` — `ON DELETE RESTRICT`, `ON UPDATE CASCADE`                                                                                                                                                                                                                                                                                                                                                    |
| CHECK constraints on `owner_notification_intents` (8)  | `owner_notification_intents_settled_at_matches_state`, `owner_notification_intents_suppression_reason_matches_state`, `owner_notification_intents_failure_code_matches_state`, `owner_notification_intents_claim_fields_coherent`, `owner_notification_intents_claim_only_when_claimed`, `owner_notification_intents_claim_sequence_valid`, `owner_notification_intents_attempt_count_valid`, `owner_notification_intents_identity_present` |
| CHECK constraints on `owner_notification_attempts` (4) | `owner_notification_attempts_attempt_number_valid`, `owner_notification_attempts_acceptance_matches_outcome`, `owner_notification_attempts_provider_call_recorded`, `owner_notification_attempts_failure_code_matches_outcome`                                                                                                                                                                                                              |
| Indexes (6)                                            | `owner_notification_intents_identity_key` (unique), `owner_notification_intents_pending_idx` (partial on `state = 'pending'`), `owner_notification_intents_occurred_at_idx`, `owner_notification_intents_subject_idx`, `owner_notification_attempts_intent_attempt_key` (unique), `owner_notification_attempts_org_intent_idx`                                                                                                              |
| RLS                                                    | enabled on both tables, with **zero policies** — deny-by-default                                                                                                                                                                                                                                                                                                                                                                            |

**Q13 returns eight rows for these two tables, not six**, because the two primary-key indexes appear alongside the six created explicitly. Every one must report `indisvalid = true`.

- **Idempotency:** **Not idempotent.** No `IF NOT EXISTS` anywhere, so re-running against a partial state fails on the first object that already exists.
- **Likely failure points:** none involving existing data — it alters no existing table and backfills nothing. A failure here is a connection loss or a name collision.
- **Detection:** Q7 for the tables, Q9 for RLS, Q11 for constraints, Q12 for the five enum types, Q13 for the indexes; [QG](#g411-post-migration-verification) summarises the load-bearing subset in one row but **does not replace the per-name enumeration** for a recovery decision.
- **Clean re-execution safe?** From **none present**, yes.
- **None present:** `migrate resolve --rolled-back`, re-run.
- **All present:** "all" means every row of the inventory above — all fifteen constraint names, all six indexes plus the two primary-key indexes valid, and **RLS on both tables** — before `migrate resolve --applied` may be considered. RLS is the assertion most likely to be quietly missing, and the one whose absence is least visible.
- **Some present:** **stop and escalate.** The dangerous partial is tables present with RLS **not** enabled: deny-by-default is the only thing standing between these tables and the anon key.

### Production preflight and verification SQL

**Read-only. None of it is executed in A8.7a.** Run from the Supabase SQL editor or `psql` with least privilege. Do not paste row contents containing PII into evidence — record counts and booleans.

**Scope warning — read before using the `Expected` column.** This table was written for the **nine-migration** end state. **A8.7b-INCIDENT-1c applied only five migrations**, so the expectations recorded here as _after 1c_ describe the **pre-Gate-4 baseline**, in which the notification objects that migrations 6–9 create are **required to be absent**. The rows below distinguish _after 1c_ from _after 6–9_. Two sections are authoritative where they disagree with the `Expected` column:

- **Before Gate 4** — [five-migration expectations](#five-migration-expectations-a87b-incident-1c). **Q8 as written cannot be run in this state at all**; two of its four counts reference tables that do not yet exist.
- **After Gate 4** — [G4.11 post-migration verification](#g411-post-migration-verification). Every _after 1c_ absence requirement **inverts to a presence requirement**, and the history holds **fourteen** rows rather than ten.

| ID      | Query                                                                                                                                                                                                                                                                                                                                                                                                                                                         | When                                                                                                     | Expected                                                                                                                                                                                                                                                                                                  | Stop/go                                                                                                                                                                                                                                         | Evidence field                        |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| **Q1**  | `SELECT count(*) FROM tasks;`                                                                                                                                                                                                                                                                                                                                                                                                                                 | Preflight, before migration                                                                              | A small number consistent with production usage                                                                                                                                                                                                                                                           | Go on any value; a wildly unexpected count means stop and understand why before taking an `ACCESS EXCLUSIVE` lock on it                                                                                                                         | `tasks.count.before`                  |
| **Q2**  | `SELECT migration_name, started_at, finished_at, rolled_back_at, applied_steps_count FROM _prisma_migrations ORDER BY started_at;`                                                                                                                                                                                                                                                                                                                            | Preflight, and after every migration attempt                                                             | **Exactly five** rows before 1c, all finished, no A8 rows. **Exactly ten** after 1c, migrations 6–9 absent — which is also the **pre-Gate-4 baseline**. **Exactly fourteen after Gate 4**, migrations 6–9 present                                                                                         | Stop if any row is unfinished, rolled back, or carries `applied_steps_count != 1`; if the count is anything other than five before 1c, **ten before Gate 4, or fourteen after Gate 4**; or if the migration names do not match the expected set | `migrations.status.before` / `.after` |
| **Q3**  | `SELECT migration_name, started_at, finished_at, rolled_back_at, logs FROM _prisma_migrations WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL;`                                                                                                                                                                                                                                                                                                       | Preflight, and immediately after any failure                                                             | **Zero rows**                                                                                                                                                                                                                                                                                             | **Any row is a hard stop.** Go to the recovery tree                                                                                                                                                                                             | `migrations.failed_rows`              |
| **Q4**  | `SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND state <> 'idle' AND pid <> pg_backend_pid();` plus `SELECT pid, state, now() - xact_start AS xact_age, left(query, 80) FROM pg_stat_activity WHERE datname = current_database() AND xact_start IS NOT NULL AND pid <> pg_backend_pid() ORDER BY xact_start;`                                                                                                                    | Immediately before migration                                                                             | No `idle in transaction`; no transaction older than 30 s                                                                                                                                                                                                                                                  | **Stop** on any `idle in transaction`, any transaction older than 30 s, or any session whose source is unclear                                                                                                                                  | `preflight.transactions`              |
| **Q5**  | `SELECT column_name, is_nullable, data_type FROM information_schema.columns WHERE table_name = 'tasks' AND column_name = 'due_local_date';`                                                                                                                                                                                                                                                                                                                   | Before and after migration                                                                               | Before: zero rows. After: one row, `is_nullable = 'YES'`                                                                                                                                                                                                                                                  | Stop if it is `NO` after — that would mean a different migration ran                                                                                                                                                                            | `schema.due_local_date`               |
| **Q6**  | `SELECT count(*) FROM tasks WHERE due_local_date IS NOT NULL;`                                                                                                                                                                                                                                                                                                                                                                                                | After migration                                                                                          | **Exactly 0**                                                                                                                                                                                                                                                                                             | **Any non-zero value is a hard stop**: D109 requires that no historical Task auto-activates a reminder, and a non-zero count means something backfilled                                                                                         | `schema.due_local_date.nonnull`       |
| **Q7**  | `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('task_reminder_schedules','reminder_delivery_attempts','owner_notification_intents','owner_notification_attempts') ORDER BY table_name;`                                                                                                                                                                                                                   | Before and after migration                                                                               | Before: zero rows. **After 1c: exactly two** — `reminder_delivery_attempts` and `task_reminder_schedules`. After Gate 4 (6–9): all four                                                                                                                                                                   | Stop on any count other than 0 before, **2 after 1c**, or 4 after 6–9. **A count of 4 after 1c is a hard stop** — it means a prohibited migration ran                                                                                           | `schema.tables`                       |
| **Q8**  | `SELECT count(*) FROM task_reminder_schedules; SELECT count(*) FROM reminder_delivery_attempts; SELECT count(*) FROM owner_notification_intents; SELECT count(*) FROM owner_notification_attempts;`                                                                                                                                                                                                                                                           | After migration. **After 1c use the [two-table variant](#five-migration-expectations-a87b-incident-1c)** | **After 1c: `0, 0`** for the two reminder tables; the last two statements **error** until 6–9. After Gate 4 (6–9): `0, 0, 0, 0`                                                                                                                                                                           | **Any non-zero is a hard stop** — the tables are new and nothing has written to them                                                                                                                                                            | `schema.rowcounts.after`              |
| **Q9**  | `SELECT relname, relrowsecurity FROM pg_class WHERE relname IN ('task_reminder_schedules','reminder_delivery_attempts','owner_notification_intents','owner_notification_attempts');`                                                                                                                                                                                                                                                                          | After migration                                                                                          | **After 1c: two rows** — the reminder tables — `relrowsecurity = true` on both. After Gate 4 (6–9): four rows                                                                                                                                                                                             | **Any `false` is a hard stop** — deny-by-default RLS is the boundary                                                                                                                                                                            | `schema.rls`                          |
| **Q10** | `SELECT table_name, column_name FROM information_schema.columns WHERE table_name IN ('task_reminder_schedules','reminder_delivery_attempts') AND column_name IN ('reminder_version','claim_expires_at','claim_sequence','provider_call_started_at','provider_accepted_at','provider_message_ref','schedule_settled_at') ORDER BY 1, 2;`                                                                                                                       | After migration, or on failure                                                                           | All seven present on their respective tables                                                                                                                                                                                                                                                              | Stop on any absence                                                                                                                                                                                                                             | `schema.columns`                      |
| **Q11** | `SELECT conname, convalidated FROM pg_constraint WHERE conrelid::regclass::text IN ('task_reminder_schedules','reminder_delivery_attempts','owner_notification_intents','owner_notification_attempts') ORDER BY 1;`                                                                                                                                                                                                                                           | After migration, or on failure                                                                           | **After 1c: only the constraints from the five repair migrations**, on the two reminder tables — the notification tables contribute none. After Gate 4 (6–9): every named constraint from the recovery tree                                                                                               | Stop on any absence                                                                                                                                                                                                                             | `schema.constraints`                  |
| **Q12** | `SELECT t.typname, e.enumlabel FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid WHERE t.typname IN ('ReminderScheduleStatus','ReminderScheduleStopReason','ReminderAdvanceDisposition','ReminderOccurrenceKind','ReminderDeliveryOutcome','ReminderSkipReason','OwnerNotificationEventType','OwnerNotificationSubjectKind','OwnerNotificationState','OwnerNotificationSuppressionReason','OwnerNotificationAttemptOutcome') ORDER BY 1, e.enumsortorder;` | After migration, or on failure                                                                           | **After 1c: exactly the six `Reminder*` types**, including `skipped_waiting_elapsed`. **`no_actionable_capability` (migration 6) and `repeated_ambiguous_outcomes` (migration 7) must be ABSENT**, as must all five `OwnerNotification*` types. After Gate 4 (6–9): all eleven types and all three values | **After 1c, a missing `Reminder*` value is a stop; a _present_ `OwnerNotification*` type or either prohibited value is also a stop.** After Gate 4 (6–9), stop on any missing value                                                             | `schema.enums`                        |
| **Q13** | `SELECT i.relname, x.indisvalid FROM pg_index x JOIN pg_class i ON i.oid = x.indexrelid JOIN pg_class t ON t.oid = x.indrelid WHERE t.relname IN ('task_reminder_schedules','reminder_delivery_attempts','owner_notification_intents','owner_notification_attempts') ORDER BY 1;`                                                                                                                                                                             | After migration, or on failure                                                                           | **After 1c: only the indexes of the two reminder tables**, each `indisvalid = true`. After Gate 4 (6–9): every named index                                                                                                                                                                                | **Stop on `indisvalid = false`** — an invalid index must be dropped before rebuilding                                                                                                                                                           | `schema.indexes`                      |
| **Q14** | `SELECT conname, convalidated FROM pg_constraint WHERE conname = 'reminder_delivery_attempts_settlement_only_when_terminal';`                                                                                                                                                                                                                                                                                                                                 | After migration 5, or on its failure                                                                     | One row, `convalidated = true`                                                                                                                                                                                                                                                                            | `convalidated = false` is the reviewed manual-completion case in the recovery tree, **not** a resolve-as-applied case                                                                                                                           | `schema.settlement_constraint`        |
| **Q15** | `SELECT count(*) FILTER (WHERE occurred_at > now() - interval '1 hour') AS under_1h, count(*) FILTER (WHERE occurred_at <= now() - interval '1 hour' AND occurred_at > now() - interval '24 hours') AS h1_to_24, count(*) FILTER (WHERE occurred_at <= now() - interval '24 hours') AS over_24h FROM owner_notification_intents WHERE state = 'pending';`                                                                                                     | Capture observation; before every notification invocation                                                | Whatever capture produced; **exactly the expected value before a canary**                                                                                                                                                                                                                                 | See the individual canary stages — the thresholds differ                                                                                                                                                                                        | `notifications.pending.buckets`       |
| **Q16** | `SELECT count(*) FROM owner_notification_intents WHERE state = 'claimed' AND claim_expires_at < now();`                                                                                                                                                                                                                                                                                                                                                       | Notification steady state                                                                                | **0**                                                                                                                                                                                                                                                                                                     | Non-zero over consecutive observations means claims are being abandoned — stop and investigate before widening                                                                                                                                  | `notifications.stale_claims`          |
| **Q17** | `SELECT count(*) FROM reminder_delivery_attempts WHERE outcome = 'claimed' AND claim_expires_at < now();`                                                                                                                                                                                                                                                                                                                                                     | Reminder steady state                                                                                    | **0**                                                                                                                                                                                                                                                                                                     | Same rule as Q16                                                                                                                                                                                                                                | `reminders.stale_claims`              |
| **Q18** | `SELECT count(*) FROM (SELECT organization_id, event_type, subject_kind, subject_id, occurrence_key, count(*) FROM owner_notification_intents GROUP BY 1,2,3,4,5 HAVING count(*) > 1) d;` and `SELECT count(*) FROM (SELECT schedule_id, generation, occurrence_kind, occurrence_local_date, count(*) FROM reminder_delivery_attempts GROUP BY 1,2,3,4 HAVING count(*) > 1) d;`                                                                               | After each canary; steady state                                                                          | **0 and 0**                                                                                                                                                                                                                                                                                               | **Any duplicate is a hard stop.** Unique indexes should make this impossible, so a non-zero result means an assumption is wrong                                                                                                                 | `idempotency.duplicates`              |
| **Q19** | `SELECT count(*) FROM task_reminder_schedules WHERE status = 'active';`                                                                                                                                                                                                                                                                                                                                                                                       | Reminder preflight; before the reminder canary                                                           | Reminder preflight: **0**. Before the canary: **exactly 1**                                                                                                                                                                                                                                               | **Any other value before the canary is a hard stop**                                                                                                                                                                                            | `reminders.active_schedules`          |
| **Q20** | `SELECT count(*) FROM task_reminder_schedules WHERE status = 'active' AND ((next_overdue_occurrence_at IS NOT NULL AND next_overdue_occurrence_at <= now()) OR (advance_disposition = 'scheduled' AND advance_occurrence_at <= now()));`                                                                                                                                                                                                                      | Burst preview, immediately before enabling reminder delivery                                             | **Exactly 1** for the canary                                                                                                                                                                                                                                                                              | **Any value above 1 is a hard stop** — that is the burst this canary exists to prevent                                                                                                                                                          | `reminders.due_occurrences`           |
| **Q21** | `SELECT count(*) FROM task_capabilities WHERE status = 'active' AND expires_at <= now();`                                                                                                                                                                                                                                                                                                                                                                     | Before enabling capture; before the notification canary                                                  | Before capture: informational. **Before the canary: 0**                                                                                                                                                                                                                                                   | **Non-zero before the canary is a hard stop** — the expiry sweep would create up to fifty additional intents in the same invocation                                                                                                             | `capabilities.expiry_due`             |

### Five-migration expectations (A8.7b-INCIDENT-1c)

> **⚠ Historical. This section describes the pre-Gate-4 baseline and no longer describes Production.** [Gate 4](#gate-4--production-migrations-69) ran on 2026-08-05, so **[G4.11](#g411-post-migration-verification) is now authoritative** and every absence requirement below has inverted to a presence requirement: fourteen migration rows rather than ten, and all four notification and reminder objects present rather than absent. It is retained unedited as the reference for what the repair asserted. **Do not verify Production against this section** — for [Gate 5](#gate-5--deploying-the-queued-a84ba86-code) the baseline is [G5.6](#g56-production-d2-baseline).

**Authoritative for the repair, and for the pre-Gate-4 baseline only.** Where this section and the `Expected` column above disagree, this section won for the repair.

The five migrations in `ee5e82a` create **two** tables and **six** enum types. Everything the notification slice adds arrives in migrations 6–9 and **must be absent** when the repair completes, and must still be absent immediately before Gate 4. Confirming absence is not optional bookkeeping: it is the evidence that the boundary held.

| Object                                                                                                                                                          | After 1c, and before Gate 4 |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| `tasks.due_local_date`, nullable                                                                                                                                | present                     |
| `task_reminder_schedules`, `reminder_delivery_attempts`                                                                                                         | present                     |
| `ReminderScheduleStatus`, `ReminderScheduleStopReason`, `ReminderAdvanceDisposition`, `ReminderOccurrenceKind`, `ReminderDeliveryOutcome`, `ReminderSkipReason` | present                     |
| `ReminderAdvanceDisposition` label `skipped_waiting_elapsed` (migration 3)                                                                                      | present                     |
| `owner_notification_intents`, `owner_notification_attempts` (migration 9)                                                                                       | **absent**                  |
| Five `OwnerNotification*` enum types (migration 9)                                                                                                              | **absent**                  |
| `ReminderSkipReason` label `no_actionable_capability` (migration 6)                                                                                             | **absent**                  |
| `ReminderScheduleStopReason` label `repeated_ambiguous_outcomes` (migration 7)                                                                                  | **absent**                  |

**Q8, two-table variant.** Run this instead of Q8. The published form's last two statements reference tables that do not exist after the repair and will abort with `relation does not exist`.

```sql
SELECT count(*) FROM task_reminder_schedules;
SELECT count(*) FROM reminder_delivery_attempts;
```

Expected `0` and `0`. Any non-zero value is a hard stop.

**QB, the boundary assertion.** Q7 through Q13 confirm what the repair built; none of them asserts what it must _not_ have built. Run this as well, and record it.

```sql
SELECT
  (SELECT count(*) FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name IN ('owner_notification_intents','owner_notification_attempts')) AS notification_tables,
  (SELECT count(*) FROM pg_type WHERE typname LIKE 'OwnerNotification%') AS notification_enums,
  (SELECT count(*) FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
     WHERE t.typname = 'ReminderSkipReason' AND e.enumlabel = 'no_actionable_capability') AS m6_label,
  (SELECT count(*) FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
     WHERE t.typname = 'ReminderScheduleStopReason' AND e.enumlabel = 'repeated_ambiguous_outcomes') AS m7_label;
```

Expected `0, 0, 0, 0`. **Any non-zero value means a prohibited migration ran and is a hard stop** — evidence field `boundary.prohibited_absent`.

> **QB is a pre-Gate-4 assertion, and it must not be run as a pass/fail check after Gate 4.** Gate 4 applies migrations 6–9 deliberately, so every one of QB's four counts becomes non-zero and correctly so. The post-Gate-4 form is **QG** in [G4.11](#g411-post-migration-verification), which asserts the same four objects are **present**.

**Out of scope for 1c: Q15 through Q21.** Q15, Q16, Q18, and Q21 read `owner_notification_intents`; Q17, Q19, and Q20 describe reminder canary states that presuppose flags this slice does not set. All seven belong to A8.7c and later. **Do not run them during the repair** — the notification ones will error, and the reminder ones will report a correct `0` that means nothing yet.

### Stage runbook

Twenty-one stages. Each uses the same seven headings, and no heading is omitted — where a heading does not apply, it says so.

**Stages 1 through 10 are the detailed expansion of the [A8.7b-INCIDENT-1c sequence](#a87b-incident-1c--production-schema-compatibility-repair)** and are labelled for that slice. Where the two differ in wording they do not differ in effect; where a stage was written for the retired A8.7b and no longer applies, it says so in place rather than being deleted, so that a reader comparing against an older review finds the correction rather than a gap.

> **Stages 1 through 10 were executed on 2026-08-04 and are retained as the historical procedure.** Their preconditions describe the pre-repair world — five migration rows, no A8 objects, a deployment serving `ee5e82a` — and every one of those statements is now deliberately out of date. Do not read them as a description of Production. **Gate 4 and Gate 5 are complete; Gate 6 (Stage 11) was partially executed and is incomplete.** **Stages 11 onward remain pending** — Stage 11's canonical procedure is [Gate 6](#gate-6--first-controlled-production-enablement-a87c-capture--f0--f1) — and their preconditions remain live against Production at `D3` / `F0`.

---

#### Stage 1 — Production preflight (A8.7b-INCIDENT-1c)

**Preconditions.** A8.7a, A8.7b-INCIDENT-1a, and A8.7b-INCIDENT-1b are complete and committed. A8.7b-INCIDENT-1c is separately authorized. Repository HEAD matches the reviewed commit. The [repository-non-mutating preflight](#1-repository-non-mutating-preflight) is green. Nobody else is operating on production.

**Execution.** Run Q1, Q2, Q3 read-only. Record the current deployment ID, commit, and the effective value of all three flags from the Vercel dashboard. Confirm the deployed commit is `ee5e82a`.

**Verification.** Q1 returns a plausible count. Q2 shows **exactly five** pre-A8 migrations finished and **no A8 rows**. Q3 returns zero rows. All three flags read as absent. The deployment serves `ee5e82a`.

**Stop/go criteria.** **Stop** if Q3 returns any row; if any A8 migration is already recorded; if any A8 flag is set; or if the deployed commit is not `ee5e82a` — a different commit means the incident baseline this runbook was written against has changed and the whole assessment needs redoing. Go otherwise.

**Immediate containment.** Not applicable — nothing has been changed.

**Recovery or rollback.** Not applicable — nothing has been changed.

**Evidence to record.** `tasks.count.before`, `migrations.status.before`, `migrations.failed_rows`, deployment ID, commit, three flag values.

---

#### Stage 2 — Worktree and migration connection verification (A8.7b-INCIDENT-1c)

**Preconditions.** Stage 1 passed. The operator has the session-mode connection string from the Supabase Connect dialog, copied whole.

**Execution.** Create or verify a detached worktree at `ee5e82a` outside the main repository directory. Count its migration directories and confirm `packages/db/.env` is absent from it. Then apply the three checks in [Migration endpoint verification](#migration-endpoint-verification): hostname form, port `5432`, no `pgbouncer=true`. Run the advisory-lock session test. Load the credential with the `read -rs` pattern from [Secure migration-command handling](#secure-migration-command-handling).

**Verification.** The worktree is at `ee5e82a`, holds **exactly ten** migration directories, and contains **no** `packages/db/.env`. Host is `aws-<region>.pooler.supabase.com`. Port is `5432`. No `pgbouncer=true`. The advisory-lock test observes its own lock. Run from the worktree, `migrate status` connects and lists **exactly five** pending migrations — the five named in the [repair boundary](#repair-boundary).

**Stop/go criteria.** **Stop** if the worktree is at any other commit; if it holds any number of migration directories other than ten; if it contains a `packages/db/.env`; if the port is `6543`; if the host is the `db.<project-ref>.supabase.co` form; if `pgbouncer=true` appears; or if `migrate status` reports anything other than exactly those five pending migrations. **A report of nine pending migrations means the command ran from the wrong worktree — stop immediately.**

**Expected exit code.** `migrate status` **exits 1 here**, because migrations are pending. That is the correct result at this stage and is not a failure.

**Immediate containment.** `unset MIGRATE_URL`. No schema change has occurred; `migrate status` is read-only.

**Recovery or rollback.** Not applicable — nothing has been changed.

**Evidence to record.** Worktree commit, migration-directory count, confirmation that no `.env` is present, redacted hostname form, port, session-mode confirmation, advisory-lock test result, the five pending migration names, and **an explicit confirmation that the credential itself was not recorded**.

---

#### Stage 3 — Long-running transaction inspection (A8.7b-INCIDENT-1c)

**Preconditions.** Stage 2 passed. This runs **immediately** before the migration — a check from ten minutes ago is not evidence about now.

**Execution.** Run Q4.

**Verification.** No session in `idle in transaction`. No transaction with `xact_age` over 30 seconds. Every remaining session is either on the allowlist below or individually identifiable.

<a id="q4-allowlist"></a>

**Q4 allowlist.** The original rule — stop on _any_ session you cannot account for — is unusable against a managed Postgres, because the platform maintains its own backends that no operator authorized and none of which hold a transaction open on `tasks`. Applying it literally would stop every window forever, and a rule that always fires teaches an operator to ignore it. Judge each session against this list instead:

| Session                                                                                                                                                                    | Treatment                                                                                   |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| The operator's own `psql` and the migration connection                                                                                                                     | Expected. Excluded by `pid <> pg_backend_pid()` for the former                              |
| Supabase platform backends — `supabase_admin`, `supabase_auth_admin`, `supabase_storage_admin`, `pg_cron`, `postgres` running `autovacuum`, `WalSender`, or an empty query | **Allowed**, provided `xact_start` is null or under 30 s. These are not application traffic |
| Any session on the application role with `xact_start` older than 30 s                                                                                                      | **Hard stop**, whatever it appears to be doing                                              |
| Any session in `idle in transaction` on the application role                                                                                                               | **Hard stop.** This is the exact condition that converts a fast migration into a stall      |
| Any session you cannot place in one of the rows above                                                                                                                      | **Hard stop**, and do not guess                                                             |

**Stop/go criteria.** Stop on any hard-stop row above. Migration 1 takes an `ACCESS EXCLUSIVE` lock on `tasks`; a lock request queues **behind** existing holders and **blocks everything arriving after it**, so a single forgotten open transaction converts a fast migration into a production-wide stall on the busiest table.

**Immediate containment.** **Do not terminate an unknown backend.** Wait for it to clear, or postpone.

**Recovery or rollback.** Not applicable — nothing has been changed.

**Evidence to record.** `preflight.transactions` — the count and, for anything notable, the age and the truncated query.

---

#### Stage 4 — Out-of-band `tasks` lock probe (A8.7b-INCIDENT-1c)

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

#### Stage 5 — Scheduler pause (A8.7b-INCIDENT-1c)

**Preconditions.** Stage 4 passed. Access to the cron-job.org account.

**Execution.** First **record what is actually there**, read-only — the repository cannot prove which jobs exist or whether they are enabled, so the dashboard is the only authority. Then **pause** whichever of the Gmail-poll and suggestion-processing jobs are enabled. Confirm each shows as paused. Note the pause time.

**A job that is already paused, or absent, is recorded as found and left alone.** Do not create a job, and do not resume one to "check that it works".

**Do not rotate `CRON_SECRET`.** Rotation would fail the jobs closed, which sounds equivalent and is not: it changes a shared credential four endpoints depend on, in the middle of a schema change, and creates a second recovery obligation.

**Verification.** Both jobs paused in the scheduler UI. No execution appears after the pause time.

**Stop/go criteria.** **Stop** if either job cannot be paused. Go once both are confirmed paused.

**Immediate containment.** Not applicable — pausing is itself the containment posture.

**Recovery or rollback.** **The jobs are not resumed by this slice.** They are left exactly as found unless a later architecture decision explicitly authorizes restoration.

**Evidence to record.** `schedulers.before` — every job, its enabled state as found, and whether the repair paused it; `schedulers.paused` — the pause timestamp and confirmation of no execution afterwards.

---

#### Stage 6 — Migration application (A8.7b-INCIDENT-1c)

**Preconditions.** Stages 1–5 passed, **all of them, in this window**. Steps 16 and 17 of the sequence have just been repeated. `MIGRATE_URL` is loaded process-scoped. The recovery tree has been read, not skimmed.

**Execution.** Run from **`packages/db` inside the detached `ee5e82a` worktree**, never from the main worktree:

```bash
cd <ee5e82a-worktree>/packages/db
DATABASE_URL="$MIGRATE_URL" pnpm exec prisma migrate status
DATABASE_URL="$MIGRATE_URL" pnpm exec prisma migrate deploy
DATABASE_URL="$MIGRATE_URL" pnpm exec prisma migrate status
```

`prisma` is invoked directly because the unguarded `migrate:deploy` package script has been removed — the remaining `:local` scripts refuse a non-loopback host by design, which is correct for development and wrong for this one authorized operation. Supplying `DATABASE_URL` inline scopes it to the single command.

Keep the full console output. It is the primary evidence of which file failed, if one does.

**Verification.** The first `migrate status` lists **exactly five** pending migrations. `migrate deploy` reports applying those five and nothing else. The final `migrate status` reports the schema up to date. Q2 shows **ten** finished rows. Q3 returns zero rows.

**Expected exit codes.** The **first** `migrate status` exits **1**, because five migrations are pending — expected, not a failure. `migrate deploy` exits **0** on success. The **final** `migrate status` exits **0**.

**Stop/go criteria.** **Stop on any non-zero exit from `migrate deploy`.** Do not re-run. Go to Stage 7. **Stop before running `deploy` if the first `migrate status` lists anything other than exactly the five migrations in the [repair boundary](#repair-boundary)** — nine pending means the wrong worktree. **An advisory-lock acquisition timeout is also a stop**: confirm no failed migration row and no partial physical state before retrying.

**Expected duration.** Sub-second. The rehearsal applied the same five in 853 ms. **Stop and investigate contention rather than waiting if it exceeds a few seconds.**

**Immediate containment.** The scheduler jobs are paused and no deployment has changed. Note that unlike the retired A8.7b, the deployed code here **is** A8 code, so a partial schema leaves it in the same incompatible state it was already in — no worse, but not repaired. **Do not deploy anything while a migration failure is unresolved.**

**Recovery or rollback.** **There is no rollback.** Migrations are forward-only. Go to Stage 7 and classify.

**Evidence to record.** `migrations.status.after`, the five applied names, the full command output with the connection string redacted, and the wall-clock duration.

---

#### Stage 7 — Failed-migration classification and recovery (A8.7b-INCIDENT-1c, only on failure)

**Preconditions.** Stage 6 failed. **This stage is skipped entirely on success.**

**Execution.** Identify the failing file from the console output and from Q3. Look it up in the [per-migration recovery decision tree](#per-migration-recovery-decision-tree). Run that entry's detection queries. Classify the physical state as **none present**, **all present**, or **some present**. Apply only the action that entry authorizes for that state.

**Verification.** The classification is supported by query output, not by inference from `_prisma_migrations`. If a `migrate resolve` was used, the following `migrate status` reflects the intended state and a subsequent `migrate deploy` proceeds cleanly.

**Stop/go criteria.** **Stop and escalate** on **some present**, unless that migration's entry describes a reviewed recovery for that exact state — which, across the five in the repair set, is only migration 5's unvalidated constraint. **Stop** if the classification is uncertain. Production holds no A8 rows and nothing writes to these tables, so **there is no cost to waiting for a second reviewer**. The deployed code was already incompatible before the attempt, so pausing does not make anything worse.

**Immediate containment.** Schedulers stay paused. No deployment. No flag changes. Do not clean up by hand.

**Recovery or rollback.** As authorized by the specific entry: `migrate resolve --rolled-back` after correcting the cause for **none present**; `migrate resolve --applied` only after proving the end state matches, for **all present**; the single reviewed `VALIDATE CONSTRAINT` for migration 5's unvalidated case; a corrective migration where the entry calls for one.

**Evidence to record.** The failing migration name, the full error, every detection query result, the classification, the action taken and its authorization, and the post-action `migrate status`.

---

#### Stage 8 — Post-migration schema verification (A8.7b-INCIDENT-1c)

**Preconditions.** Stage 6 succeeded, or Stage 7 completed with an authorized recovery and a clean `migrate deploy`.

**Execution.** Run Q5, Q6, Q7, Q8, Q9, Q10, Q11, Q12, Q13, Q14. Re-run Q1 and Q2.

**The repair applies five migrations, not nine, so several queries have a different expected answer than the retired A8.7b assumed.** Where a query names all four A8 tables or all eleven enum types, only the reminder half is expected to exist:

| Query   | Expected after the five-migration repair                                                                                                                                |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Q2**  | **Exactly ten rows**, all finished, none rolled back, each `applied_steps_count = 1`. **Migrations 6–9 absent**                                                         |
| **Q7**  | **Exactly two** tables: `task_reminder_schedules` and `reminder_delivery_attempts`. **`owner_notification_intents` and `owner_notification_attempts` must be absent**   |
| **Q8**  | The two reminder tables return **0, 0**. The two notification counts **will error**, because those tables do not exist — that error is the expected result, not a fault |
| **Q9**  | Two rows, `relrowsecurity = true` on both                                                                                                                               |
| **Q12** | The **six reminder enum types** only. The five `OwnerNotification*` types must be absent                                                                                |
| **Q13** | Every index on the two reminder tables present with `indisvalid = true`                                                                                                 |

**Verification.** `tasks.due_local_date` exists and is nullable. **Q6 returns exactly 0.** The two reminder tables exist with zero rows and RLS `true`. Every named column, constraint, index, and reminder enum value is present. Q13 shows every index `indisvalid`. Q14 shows `convalidated = true`. Q1 is unchanged from Stage 1.

**Stop/go criteria.** **Q6 non-zero is a hard stop** — D109 requires that no historical Task auto-activates a reminder, and a non-null `due_local_date` on a historical Task is exactly that failure. **Any RLS `false` is a hard stop.** **Any non-zero reminder row count in Q8 is a hard stop.** **Any `indisvalid = false` is a hard stop.** **Any change in Q1 is a hard stop** — the migration must not have touched a row. **The presence of either notification table is a hard stop**: it means migrations beyond the repair boundary were applied, which is the specific failure this slice is designed to prevent.

**Immediate containment.** Schedulers stay paused; do not deploy.

**Recovery or rollback.** Forward-only. A missing object is a corrective-migration decision, not a hand-patch. A non-zero Q6 requires understanding the source before any correction — do not simply null the column.

**Evidence to record.** `schema.*` for every query above, and `tasks.count.after` alongside `tasks.count.before`.

---

#### Stage 9 — Retired. No deployment occurs in the repair (A8.7b-INCIDENT-1c)

**This stage described deploying the A8.6c commit to reach a safe harbour. It does not apply and must not be performed.**

The retired A8.7b assumed Production served pre-A8 code, so a deployment was needed to bring A8 code and A8 schema into agreement. Production already serves A8 code. **The disagreement is repaired entirely by the migration in Stage 6**, and D1 is reached without deploying anything.

**Deploying the queued A8.4b–A8.6 code during the repair is prohibited.** That code needs migrations 6 through 9, which the repair deliberately does not apply, so deploying it would create a second, worse incident of exactly the kind being repaired.

**Preconditions.** None. The stage is retired and is not performed.

**Execution.** None. **Do not deploy.**

**Verification.** Confirm the Production deployment ID is unchanged from Stage 1 and still serves `ee5e82a`.

**Stop/go criteria.** **Stop** if the deployment ID has changed during the window — something deployed that nobody in this runbook authorized.

**Immediate containment.** Not applicable — nothing is deployed by this stage.

**Recovery or rollback.** Not applicable — nothing is deployed by this stage.

**Evidence to record.** An explicit statement that no deployment was performed, and the deployment ID confirmed unchanged from Stage 1.

---

#### Stage 10 — Read-only application smoke verification (A8.7b-INCIDENT-1c)

**Preconditions.** Stage 8 passed. No deployment has occurred.

**Execution.** With an authenticated Owner session, exercise **read-only paths only**: `GET /api/v1/session`, `GET /api/v1/tasks`, the Owner `/tasks` list, and one Task detail page.

**`/attention` is not part of this smoke test.** The route itself has existed since the P1.4 Owner shell (`a38c857`) and **is** served by the deployed commit — the 1d deployment's route set confirms it. What is not deployed is the A8.6a reminder-derived content that gives it meaning, so exercising it proves nothing about the repair either way.

> **Do not perform a mutation smoke test unless separately authorized.** A Task mutation is the path that exercises reminder reconciliation, and while the repair makes it structurally sound, proving that is a deliberate decision with its own approval, not a step to slip into a repair window. **Do not create or modify a reminder.**

**Do not resume the schedulers.** They are left exactly as found.

**Verification.** `/api/v1/session` returns `200` with `role = owner` and `organizationId = axford`. `/api/v1/tasks` returns a cursor page — this is the direct proof the repair worked, because that query selects `tasks.due_local_date`, the column whose absence was the incident. The Owner `/tasks` list renders. Task detail renders, and its reminder panel truthfully reports no schedule.

**Stop/go criteria.** **Stop** if `GET /api/v1/tasks` still errors — that means a migration did not take effect despite Stage 8. **Stop** if Task detail fails to render. **Stop** if the reminder panel shows anything other than "no schedule": with zero rows in `task_reminder_schedules`, anything else means something wrote to a table nothing should be writing to.

**Immediate containment.** The schema is correct and forward-only; there is nothing to contain at the database level. If the application misbehaves in a way the schema does not explain, the containment option is redeploying `8588c5d`, subject to the [containment qualifications](#containment).

**Recovery or rollback.** Forward-only. The schema stays.

**Evidence to record.** Each smoke result, an explicit statement that no mutation was performed, an explicit statement that no scheduler was resumed, and the unchanged deployment ID.

**A8.7b-INCIDENT-1c ends here.** Applying migrations 6 through 9, deploying the queued code, and A8.7c each require separate authorization.

---

#### Stage 11 — Owner-event capture enablement (A8.7c)

> **Canonical procedure:** [Gate 6 — First controlled production enablement](#gate-6--first-controlled-production-enablement-a87c-capture--f0--f1) (`G6.1`–`G6.15`). Stage 11 is the same activation event under the stage-runbook numbering. **It was authorized and partially executed on 2026-08-05 and did not complete — capture never became live.** Evidence: [A8_7_EVIDENCE.md § Gate 6](A8_7_EVIDENCE.md#gate-6--first-controlled-production-enablement-a87c-capture--f0--f1). **Do not execute enablement from this stage body.**

**Preconditions.** See [G6.2](#g62-prerequisites) and [G6.4](#g64-production-f0-baseline).

**Execution.** See [G6.8](#g68-execution-sequence) and the operator checklist [G6.15](#g615-operator-execution-checklist).

**Verification.** See [G6.10](#g610-post-activation-verification). The partial attempt never reached verified `F1` on the public custom domain.

**Stop/go criteria.** See [G6.11](#g611-stop-conditions).

**Immediate containment.** See [G6.12](#g612-containment-and-rollback-posture).

**Recovery or rollback.** See [G6.12](#g612-containment-and-rollback-posture).

**Evidence to record.** See [G6.13](#g613-evidence-recording) and [A8_7_EVIDENCE.md § Gate 6](A8_7_EVIDENCE.md#gate-6--first-controlled-production-enablement-a87c-capture--f0--f1), which records the partial attempt and the omitted completion step.

---

#### Stage 12 — Capture-only observation (A8.7c)

> **Canonical procedure:** [Stage 12 — Capture-only observation](#stage-12--capture-only-observation-a87c--f1) (`G12.1`–`G12.13`). This stage body is the same observation under the stage-runbook numbering. **Do not execute observation from this stage body.** Stage 12 is prepared, unauthorized, and unbegun.

**Preconditions.** See [G12.3](#g123-prerequisites).

**Execution.** See [G12.6](#g126-observation-window-open-and-close) and the operator checklist [G12.9](#g129-operator-execution-checklist).

**Verification.** See [G12.8](#g128-sql-order-and-expected-results) and [G12.10](#g1210-final-verification).

**Stop/go criteria.** See [G12.9](#g129-operator-execution-checklist) explicit stop conditions.

**Immediate containment.** See [G12.11](#g1211-containment-and-rollback).

**Recovery or rollback.** See [G12.11](#g1211-containment-and-rollback).

**Evidence to record.** See [G12.13](#g1213-evidence-recording) and [A8_7_EVIDENCE.md § Stage 12](A8_7_EVIDENCE.md#stage-12--capture-only-observation).

**A8.7c ends at Stage 12 close.** A8.7d requires separate authorization, and it is the slice that can send mail.

---

#### Stage 13 — Zero-send Owner-notification rehearsal (A8.7d)

**The point of this stage is to invoke the delivery path in production, for real, and prove it sends nothing.**

**Preconditions.** A8.7c complete and reviewed. A8.7d authorized. **Every pending intent has aged beyond the 24-hour staleness horizon** — confirm with Q15: `under_1h = 0`, `h1_to_24 = 0`, `over_24h` equal to the full pending count. Reaching that state requires capture to have been **off** for over 24 hours, so this stage begins by unsetting capture and waiting.

**Execution.** Set `ENABLE_OWNER_EVENT_DELIVERY=true` and ensure `ENABLE_OWNER_EVENT_CAPTURE` is **absent**. Redeploy — state **F2**. Re-run Q15 to confirm the queue is frozen and entirely stale. Then invoke `POST /api/v1/internal/notifications/process` **exactly once**, manually, with the `CRON_SECRET` bearer.

Capture is off precisely so the queue cannot grow between the check and the invocation. That is what "the queue is frozen" means, and it is why capture and delivery being independent flags matters operationally rather than only architecturally.

**Verification.** The response reports `deliveryEnabled: true`. Every intent transitions from `pending` to a **suppressed** terminal state. `owner_notification_attempts` remains **exactly 0**. **Zero email sends** — confirmed by the attempts count of 0 and by the Gmail mailbox showing no new Rocket-generated message. Q15 afterwards shows `pending = 0`.

**Stop/go criteria.** **Any attempt row is a hard stop.** **Any email is a hard stop** — it means the staleness horizon did not apply and the assumption behind the rehearsal is wrong. **Stop** if any intent remains `pending` or `claimed` after the invocation.

**Immediate containment.** Unset `ENABLE_OWNER_EVENT_DELIVERY` and redeploy immediately. If a message was sent, treat it as the quarantine case in [Stage 15](#stage-15--gmail-custom-header-round-trip-proof-a87d) — an unexpected Rocket-generated message in the Gmail mailbox is an ingestion risk regardless of why it was sent.

**Recovery or rollback.** **F2 is not a valid rollback target and exists only for this stage.** Move forward to Stage 14 or back to **F0** by unsetting both flags and redeploying.

**Evidence to record.** Q15 before and after, the worker response verbatim, the attempts count before and after (0 and 0), the suppression reasons observed, and an explicit statement that no email was sent.

---

#### Stage 14 — Single-notification canary (A8.7d)

**Preconditions.** Stage 13 passed. **Q15 shows `pending = 0` — every intent is terminal.** **Q21 returns 0** — no capability is due for expiry observation, because the capture phase would create up to fifty additional intents in the same invocation and the canary would stop being single-item. Both flags currently absent or being set together in this stage. **No notification scheduler job exists.**

**Execution.** Set `ENABLE_OWNER_EVENT_CAPTURE=true` and `ENABLE_OWNER_EVENT_DELIVERY=true`; redeploy — state **F3**. Perform **exactly one** reviewed, real event that a producer captures — choose the least consequential producer available and record which one, and record any real Task change it causes truthfully. Re-run **Q15 (expect `pending = 1`)** and **Q21 (expect 0)**. Then invoke `POST /api/v1/internal/notifications/process` **exactly once**.

**This canary is single-item by state preparation, not by a batch limit.** The worker's batch is 25. It processes one item because there is exactly one item to process. **Do not add a batch-limit parameter, a production-only bypass, or a test-only query string.**

**Verification.** Exactly **one** claim, **one** attempt row, and **one** send. Q18 returns 0 duplicates. The intent reaches `sent`. Exactly one message appears in the connected Gmail mailbox. Q15 returns to `pending = 0`.

**Stop/go criteria.** **Stop** if Q15 is anything other than 1 before the invocation. **Stop** if Q21 is non-zero before the invocation. **Stop** if more than one attempt row appears. **Stop** if the attempt outcome is ambiguous rather than a clean success. Go to Stage 15 only on exactly one clean send.

**Immediate containment.** Unset **both** flags and redeploy. Do not create a scheduler job.

**Recovery or rollback.** Return to **F0** by unsetting both and redeploying — likely a fresh deployment rather than Instant Rollback, since F0 is now several steps back.

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

**Recovery or rollback.** Return to **F0**. The loop-suppression defect must be fixed and re-proven in a new slice before A8.7d can resume; this is not something to work around operationally.

**Evidence to record.** The `messages.get` header block (headers only — **no message body, no personal content**), the message identifier matched against the stored reference, the header count, the normalized value, the poll's skipped count, and explicit zero confirmations for communication event, excerpt, suggestion, and second intent.

---

#### Stage 16 — Notification scheduler creation (A8.7d)

**Preconditions.** **Stage 15 passed in full.** State **F3** with both notification flags set. `CRON_SECRET` is configured in Production only.

**Execution.** Create **one** cron-job.org job: HTTP **POST** to `{NEXT_PUBLIC_APP_URL}/api/v1/internal/notifications/process`, every five minutes, `Authorization: Bearer <CRON_SECRET>`, empty body. This is a **third, independent** job alongside Gmail poll and suggestion processing.

**Verification.** The job's first execution returns success. The worker response shows zero or few items, as the queue is empty after Stage 14. Q16 returns 0.

**Stop/go criteria.** **Stop** if the job authenticates incorrectly — a 401 loop every five minutes is noise that will mask a real failure. **Stop** if the first execution reports unexpected work.

**Immediate containment.** **Pause the job.** Note that pausing the scheduler does **not** disable delivery: an intent can still be delivered by a manual invocation, and the flag is what governs delivery. To stop delivery, unset the flag and redeploy.

**Recovery or rollback.** Pause the job and return to **F0**. A rollback alone would leave the job calling an inert endpoint every five minutes, which is safe but should not be left in place unexamined.

**Evidence to record.** Job name, URL, interval, first execution result, worker response, Q16.

---

#### Stage 17 — Notification steady-state observation (A8.7d)

**Preconditions.** Stage 16 complete. The notification job is running on its five-minute cadence.

**Execution.** Observe for the authorized window. Run Q15, Q16, and Q18 at intervals. Watch the scheduler execution log for failures.

**Verification.** Pending intents are created by real events and drain within a cycle or two. Q16 stays at **0** across consecutive observations. Q18 stays at **0**. Every sent notification corresponds to a real event. No message loops back into ingestion — the `/attention` missed-notification section is a useful cross-check, since a notification that failed to reach the Owner appears there.

**Stop/go criteria.** **Stop** if Q16 is non-zero across consecutive observations — claims are being abandoned, which means the worker is dying mid-invocation. **Stop** on any Q18 duplicate. **Stop** if an ingested message turns out to be Rocket-generated. Go to A8.7e only after a clean window.

**Immediate containment.** Pause the notification job; unset `ENABLE_OWNER_EVENT_DELIVERY` and redeploy if sends must stop immediately.

**Recovery or rollback.** Return to **F0** by unsetting both flags and redeploying, and pause the notification job — both actions, because they are in different systems.

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

**Execution.** Through the ordinary Owner UI, set a due date on the one reviewed Task so that **exactly one** occurrence becomes eligible. Confirm **Q19 = 1** and **Q20 = 1**. Set `ENABLE_REMINDER_DELIVERY=true` and redeploy — state **F4**. Re-confirm Q19 and Q20 are still 1. Then invoke `POST /api/v1/internal/reminders/process` **exactly once**.

**A larger burst is not acceptable here.** The worker's batch is 25 schedules. If Q20 exceeds 1, this is no longer a canary and requires separate authorization before proceeding.

**Verification.** Exactly **one** success attempt row. **One** email delivered to the reviewed Recipient. The schedule's `overdue_delivered_count` incremented **exactly once**. **No Owner-attention condition raised** — `requires_owner_attention` stays false and `/attention` shows nothing new. **No duplicate success for the local day** — Q18's second query returns 0, which the `reminder_delivery_attempts_one_success_per_local_day_idx` unique index should make impossible. The email **contains no capability link** (D130) and directs the Recipient to the original assignment email. Q17 returns 0.

**Stop/go criteria.** **Stop** if Q19 or Q20 is anything other than 1 at either check. **Stop** on more than one attempt row. **Stop** if the outcome is ambiguous rather than a clean success. **Stop** if any capability link appears in the email. **Stop** if an Owner-attention condition is raised.

**Immediate containment.** Unset `ENABLE_REMINDER_DELIVERY` and redeploy. Remove the due date from the canary Task to stop the schedule. Do **not** create a scheduler job.

**Recovery or rollback.** Return to **F3** (notifications operational, reminders off) by unsetting the reminder flag and redeploying. **A delivered reminder cannot be unsent** — if the wrong Recipient was contacted, that is a communication to handle directly, not an operational rollback.

**Evidence to record.** The Task and Recipient identifiers (identifiers, **not** names or addresses), the schedule identifier, the attempt identifier and outcome, `overdue_delivered_count` before and after, Q17, Q18, the attention-flag state, and confirmation that the email carried no link.

---

#### Stage 20 — Reminder scheduler creation (A8.7e)

**Preconditions.** **Stage 19 passed.** State **F4**. Q17 is 0.

**Execution.** Create **one** cron-job.org job: HTTP **POST** to `{NEXT_PUBLIC_APP_URL}/api/v1/internal/reminders/process`, every five minutes, `Authorization: Bearer <CRON_SECRET>`, empty body. This is a **fourth, independent** job.

**Verification.** First execution succeeds and reports zero work, the canary occurrence having already been delivered. Q17 returns 0. Q19 reflects only the intended schedules.

**Stop/go criteria.** **Stop** if the first execution reports unexpected delivery — nothing should be due. **Stop** on an authentication failure.

**Immediate containment.** **Pause the job.** As with notifications, pausing the scheduler does not disable delivery; unsetting the flag and redeploying does.

**Recovery or rollback.** Pause the job and return to **F3**.

**Evidence to record.** Job name, URL, interval, first execution result, Q17, Q19.

---

#### Stage 21 — Final steady-state monitoring (A8.7e)

**Preconditions.** Stage 20 complete. All four scheduler jobs running: Gmail poll, suggestions, notifications, reminders.

**Execution.** Observe for the authorized window. Run Q15, Q16, Q17, Q18, Q19, Q20 at intervals. Watch all four scheduler execution logs. Check `/attention` as the Owner-facing view of the same facts.

**Verification.** No stale claims on either worker across consecutive observations. No duplicates. Reminders deliver at **09:00 organization-local** (`America/Vancouver`), **not** UTC — D103, and the single most likely thing to be quietly wrong. No pre-existing Task fires a reminder, confirming D109 held through enablement. No capability token or URL appears in any reminder log, telemetry, audit, or metadata (D109). Notification and reminder backlogs both drain.

**Stop/go criteria.** **Stop** on persistent stale claims, any duplicate, any delivery at the wrong local hour, any reminder for a Task the Owner did not opt in, or **any capability token or URL appearing anywhere in logs**. Otherwise A8.7 is complete and A8 closure may be assessed against D108.

**Immediate containment.** Pause the affected job; unset the corresponding flag and redeploy if delivery must stop.

**Recovery or rollback.** Return to **F3** (reminders off) or **F0** (everything off), in both cases by unsetting variables and redeploying, plus pausing the relevant jobs.

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

1. **Application:** Redeploy the previous known-good Vercel deployment via the Vercel dashboard. **A deployment carries the environment variables it was built with**, so Instant Rollback restores the target's original flag values rather than today's, and on the Hobby plan it may reach only the immediately previous deployment. **Do not assume a specific older deployment is one step back** — confirm it before relying on it. During A8.7, use the [approved repair state matrix](#approved-repair-state-matrix) and the [flag-staging states](#flag-staging-states-a87ca87e) rather than reasoning about rollback ad hoc.

> **⚠ A one-step rollback from the pre-Gate-5 `D2` deployment was not a safe harbour.** When Production served `dpl_3oder2T3PuDYdmp8pezy6u7RwPRm` (`534959d`) against the `D2` schema, one step back was `dpl_AnUKqdGj3gBw7N56yUT4pMBAVbac` (`ee5e82a`), and rolling back to it had two consequences:
>
> - **It reinstates the reminder defect** on `GET`, `PUT`, and `DELETE` — the `D1` state the [matrix](#approved-repair-state-matrix) marks as never validated.
> - **It may be worse than that.** The hotfix build was created **after** the 2026-08-04 credential rotation; `ee5e82a` was built **before** it. Because rollback restores the target's original environment binding, a rollback restores the **pre-rotation `DATABASE_URL`**. If the old credential was genuinely invalidated, that is a **total database outage**, not a reminder regression. The [unexplained anomaly](A8_7_EVIDENCE.md#a87b-incident-1d--production-reminder-endpoint-hotfix) — a pre-rotation build that kept serving database-backed pages — is exactly why this cannot be settled from the record.
>
> **Treat one-step rollback as unavailable.** The containment path is a fresh production-target build of a known-good commit, using [the method above](#deploying-a-commit-that-is-not-on-main). `8588c5d` remains the universal pre-A8 option and still requires read-only confirmation that it is redeployable before anyone relies on it.
>
> **The deployed commit was created on `hotfix/a8-7b-incident-1d-reminder-etag`, and it is an ancestor of local `main` through merge `68bedff` — but not of `origin/main`.** Do not delete that branch, and prefer tagging `534959d` before any branch cleanup, because today the only durable references to it are a branch and an unpushed merge. Full statement: [commit ancestry](#commit-ancestry-of-the-deployed-hotfix).

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

> **⚠ This procedure cannot be followed as written today.** The **Preview environment has no `DATABASE_URL`** — see [Deploying a commit that is not on `main`](#deploying-a-commit-that-is-not-on-main) — so a preview deployment cannot reach the database and cannot reproduce a database-backed Owner route at all. Reproducing such a route on a preview deployment first requires adding `DATABASE_URL` to Preview, which is an environment change needing its own authorization and its own decision about **which** database it should point at. Until that decision is made, treat this section as unavailable rather than as guidance.
>
> Note also that the diagnostics this section produces are **database** diagnostics. A failure in packaging or application code emits none, and their absence alongside an `UNKNOWN_FAILURE` is itself a signal — see [the runtime-value import hazard](#the-runtime-value-import-hazard).

Production normally runs with diagnostics **disabled**. No temporary `X-AICAA-DB-*` headers should be present.

## Related documentation

- HTTP implementation status: [API_CONTRACT.md](API_CONTRACT.md)
- Capability authorization: [SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md)
- Milestone status: [MILESTONES.md](MILESTONES.md)
