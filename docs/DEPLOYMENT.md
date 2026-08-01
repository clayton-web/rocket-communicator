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

Production uses a **Supabase transaction pooler** connection for `DATABASE_URL` (serverless-friendly). Use the pooler URL Vercel expects for Prisma—not the direct session URL—for API routes and migrations unless your operator checklist specifies otherwise.

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

| Variable       | Purpose                                                                                                                                                                                                                             |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL` | Server-only Postgres URL for Prisma (`@aicaa/db`). Use the Supabase **Shared Pooler transaction** URI in production (host and port must come from the same Connect string — see Platform assumptions). Never expose to the browser. |

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

`CRON_SECRET` / `InternalCronBearer` authenticate internal scheduler endpoints: `GET|POST /api/v1/internal/gmail/poll` (A5.5), `POST /api/v1/internal/suggestions/process` (D084), and, since A8.4a, `POST /api/v1/internal/reminders/process` — which exists but has **no scheduler job and no enabling flag set**. **The same Production `CRON_SECRET` may authenticate all three endpoints**; no separate secret is required by current decisions. Recommend ≥32 random bytes. Configure in **Production** only; do not place the production secret on Preview. Any External Scheduler that securely issues an authenticated request every five minutes is acceptable (D079). The recommended initial adapter while the project remains on the Vercel Hobby plan is **cron-job.org** (HTTP POST with Bearer auth). Other compatible schedulers—including Vercel Cron, GitHub Actions, Google Cloud Scheduler, and AWS EventBridge—may replace it without application logic changes.

### Diagnostics (normally off)

| Variable                        | Purpose                                                                                                                                                                                                                                                                                                                      |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ENABLE_DB_RUNTIME_DIAGNOSTICS` | When exactly `true`, enables structured **server-side** database runtime diagnostics for Owner routes. **Disabled in Production** by default. Does not add public `X-AICAA-DB-*` response headers.                                                                                                                           |
| `ENABLE_REMINDER_DELIVERY`      | When exactly `true`, allows reminder occurrence processing to claim and write. **Set nowhere, including Production**, and gated by [Reminder engine operations](#reminder-engine-operations-a8--not-operational). Even when on, A8.4a does nothing: processing also requires an injected transport, and nothing injects one. |

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

A8.3b audit remediation migration: `packages/db/prisma/migrations/20260731170000_a8_3b_reminder_concurrency/` (**not yet applied in production**). Additive and forward-only: it adds `task_reminder_schedules.reminder_version` with a `DEFAULT 1` and three CHECK constraints. It creates no table, drops nothing, and changes no existing column type. Because the table itself does not exist in Production yet, this migration has no production rows to touch and will be applied in the same first run as the A8.3a migration whenever that intentional operator action is taken.

Why it exists: reminder writes deliberately do not bump `Task.version`, so the Task ETag cannot protect a reminder mutation, and a real-PostgreSQL audit demonstrated two concurrent Owners each holding a valid token and one of them losing a write silently. `reminder_version` is the reminder resource's own concurrency token, and correctness could not be expressed without persisting it. The CHECK constraints assert what the application already guarantees — a positive version, and a `suspended_waiting` schedule holding no next occurrence — so a paused Task cannot sit in the worker's due-scan index.

A8 lifecycle remediation migration: `packages/db/prisma/migrations/20260731230000_a8_advance_waiting_skip/` (**not yet applied in production**). One additive `ALTER TYPE "ReminderAdvanceDisposition" ADD VALUE 'skipped_waiting_elapsed'`. It rewrites no row and invalidates no existing value.

A8.4a worker-safety migration: `packages/db/prisma/migrations/20260801120000_a8_4a_worker_safety/` (**not yet applied in production**). Additive and forward-only. It adds four terminal values to `ReminderAdvanceDisposition`; adds `claim_expires_at`, `claim_sequence`, `provider_call_started_at`, `provider_accepted_at`, and `provider_message_ref` to `reminder_delivery_attempts`; adds CHECK constraints for claim coherence, provider-metadata ordering, and the rule that a non-active schedule holds no live lease; and creates two partial indexes — one for the expired-claim recovery sweep, one for the global due scan. It drops nothing and changes no existing column type.

**It carries one backfill, and that backfill is the reason this migration was tested from the existing state rather than only from empty.** A8.3b's occurrence claim was an indefinite marker with no sequence, so every row already holding a claim would have violated the new fencing constraint the moment it was added — the constraint is validated against existing rows and the new column defaults to zero. `UPDATE "reminder_delivery_attempts" SET "claim_sequence" = 1 WHERE "claimed_by" IS NOT NULL` gives those rows the sequence they would have been granted under the new lifecycle. Their `claim_expires_at` deliberately stays `NULL`: a lease that never had a deadline is not one to invent retroactively, and a null expiry reads as "not a live lease", so the next worker reclaims at sequence 2 and the fence works from there. Production has no rows to touch — the tables do not exist there yet — but the correctness of the migration must not depend on that, and `packages/db/__tests__/a8-4a-migration-from-a8.test.ts` applies it over the prior state with live data present.

A8.4a audit-remediation migration: `packages/db/prisma/migrations/20260802094500_a8_4a_settlement_marker/` (**not yet applied in production**). Additive and forward-only. It adds one nullable column, `schedule_settled_at`, to `reminder_delivery_attempts`; backfills it on every existing non-`claimed` row; adds a CHECK that only a terminal row may carry it, `NOT VALID` first and then validated; and creates two partial indexes for the settlement-debt and retry-budget recovery sweeps. It drops nothing and rewrites no column anything already reads.

**Its backfill is a statement of fact rather than an assumption.** Every terminal row predating it was written under the single-transaction design, so its schedule was settled in the same commit by construction; marking those rows settled is what stops the new sweep waking up to a backlog of history it would try to re-count. The migration was tested from empty, from the predecessor state with representative rows of every terminal shape, and against every legacy half-written claim shape the predecessor schema permitted — including the sequence-1, null-expiry rows the previous migration's own backfill produced.

**A correction carried in that migration's header.** `20260801120000_a8_4a_worker_safety` opens by saying it "backfills nothing beyond column defaults", which is false: it runs the `claim_sequence = 1` update described above, and the body of that same file explains it at length. The correction is recorded in the newer migration and here rather than by editing the applied file, because Prisma records a checksum per applied migration and editing one makes `migrate deploy` fail on every database that already has it.

Applying either A8.4a migration still sends nothing. They make occurrence processing _representable_; the processing endpoint remains disabled by default, requires an injected transport it is never given, and is invoked by no cron job.

**Apply to production** (with production `DATABASE_URL` configured for the target — do this only as an intentional operator action):

```bash
pnpm --filter @aicaa/db migrate:deploy
```

**Local Docker** (loopback Postgres 16 on port 5433; never production):

```bash
pnpm db:docker:up
pnpm db:migrate:local
pnpm db:migrate:status:local
```

**Verify status (uses `packages/db/.env` — production if that file holds a remote URL):**

```bash
pnpm --filter @aicaa/db migrate:status
```

Ordinary package tests use in-process **PGlite** and do not require production `DATABASE_URL`. Production always uses Supabase Postgres. Local Docker setup: [packages/db/README.md](../packages/db/README.md).

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

**A8.0 documentation Decision Lock** recorded (D095–D101) and partly superseded. **A8.1 documentation Decision Lock** recorded (**D102–D110**): A8 is a **due-date-driven** reminder model. Do not implement any further part of the Follow-up Engine or Event Notification Engine until the specific slice is authorized. **P1.0 documentation Decision Lock** recorded (**D111–D120**): the Owner web experience foundation is scoped; **P1.1 through P1.5 are implemented**; **P1 is COMPLETE** — implemented, deployed, and production-validated with one documented evidence limitation ([P1_5_EVIDENCE.md](P1_5_EVIDENCE.md)). Roadmap: **A7 → A8 → A9** (no early separate A9.0); **P1** was sequenced before the remaining A8 implementation slices and is now closed. **A8 is the current milestone: A8.1, A8.2, A8.3a, A8.3b, the Task-lifecycle wiring, and A8.4a are complete; A8.4b onward are not started.** Nothing in A8 is operational in Production — no A8 migration is **applied**, so the Owner reminder APIs, lifecycle wiring, and occurrence-processing endpoint that exist in the repository cannot function against Production; delivery is flag-disabled, the only transport is a fake one, and no cron job, real delivery path, or UI exists.

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

**Nothing in this subsection is operational, and no reminder has ever been sent.** Since A8.4a a worker endpoint and a delivery flag **do** exist in the repository: `POST /api/v1/internal/reminders/process` and `ENABLE_REMINDER_DELIVERY`. Neither is live. **No scheduler job invokes the endpoint, the flag is set in no environment, and the only transport the processing service can reach is a fake one** — no processing module may import Gmail, and a source guard fails the build if one does. The A8.3b Owner reminder routes configure a schedule, the Task-lifecycle wiring keeps it truthful as the Task moves, and A8.4a can claim, guard, and finalize an occurrence against that fake transport. The A8 persistence tables (`task_reminder_schedules`, `reminder_delivery_attempts`, and `tasks.due_local_date`) **exist in the repository migrations but are not applied in Production** — see the migration history above. This records the approved enablement gate so it cannot be missed later; it is not a runbook for existing infrastructure.

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

## Capability links in production

Capability URLs are derived from `NEXT_PUBLIC_APP_URL` and the issued path token. **A7 (D094):** `NEXT_PUBLIC_APP_URL` is sufficient; a custom domain does not block A7. Production capability links must use the configured production app URL. Do not log or commit raw tokens or hashes (D063). After re-forward/reassignment, prior active capabilities are revoked (D086).

## Safe database row-count checks

For operator sanity checks (read-only), use Supabase SQL editor or `psql` against production with least privilege:

- `recipients`, `tasks`, `task_assignments`, `task_capabilities`, `audit_events`, `task_suggestions`
- `handoff_attempts` (A7; authoritative delivery lifecycle per D092), `task_notes`
- After the A8.3a migration is applied: `task_reminder_schedules`, `reminder_delivery_attempts`. Until then these tables do not exist in Production and a count against them will error.

Compare counts before/after E2E or deploy; do not paste row contents containing PII into tickets.

## Rollback principles

1. **Application:** Redeploy the previous known-good Vercel deployment via the Vercel dashboard.
2. **Schema:** Prisma migrations are forward-only in production; roll back application code before attempting destructive schema changes. Never drop production tables without an explicit operator decision.
3. **Secrets:** Rotate `CAPABILITY_TOKEN_PEPPER` only with a documented invalidation plan (all outstanding links become unusable).
4. **Capabilities:** Reassignment or re-forward revokes the prior active capability and issues a new one (D086). Revoked records are preserved for audit.

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
