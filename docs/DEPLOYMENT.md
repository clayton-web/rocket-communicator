# Deployment and operations

Governed by [PROJECT_CONSTITUTION.md](PROJECT_CONSTITUTION.md). Architecture: [ARCHITECTURE.md](ARCHITECTURE.md). Package setup: [../packages/db/README.md](../packages/db/README.md).

This runbook documents **names and procedures only**. Never commit connection strings, passwords, capability tokens, token hashes, or other secrets.

**This is a current operations runbook.** Executed and abandoned rollout narratives are not kept here. Every procedure below is either something an operator does today or something a future authorized slice will do; nothing in it is a record of past work.

Platform assumptions describe the **current** deployment. Per Architecture Principles (D079), hosting and schedulers are replaceable.

## Platform assumptions

| Component              | Role                                                                                                                                          |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **Vercel**             | Current host for `apps/web`. Monorepo root is the Vercel project root; `outputFileTracingRoot` includes workspace packages                    |
| **Supabase**           | Current PostgreSQL system of record and Owner Auth (Google Workspace)                                                                         |
| **Prisma**             | Server-only data access via `@aicaa/db`, invoked through the web runtime bridge                                                               |
| **External Scheduler** | Invokes authenticated app endpoints on a schedule. Current adapter: **cron-job.org**. Interchangeable; not an architectural dependency (D079) |

Production uses a **Supabase Shared Pooler transaction-mode** connection for the application runtime `DATABASE_URL` (serverless-friendly, port `6543`). That is correct for API routes and must not be changed.

**It is the wrong endpoint for Prisma Migrate.** Transaction-mode pooling does not preserve a session across statements, while `prisma migrate deploy` holds a **session-scoped PostgreSQL advisory lock** for the whole invocation. Migrations run from the **operator workstation** against the **Shared Pooler session-mode** endpoint on port `5432`, supplied as a process-scoped override for that one command. See [Migration connection strategy](#migration-connection-strategy). No Vercel variable changes, no `directUrl` in `schema.prisma`, and no new runtime database variable.

**Host and port must match.** Copy the connection string from the Supabase **Connect** dialog and do not recombine parts of two different strings. The pooler port only answers on the Shared Pooler host form `aws-<region>.pooler.supabase.com`; the direct host form `db.<project-ref>.supabase.co` serves the direct port only. Pairing the direct host with the pooler port produces an endpoint no server answers, and every Prisma call then fails at connection time while non-database pages keep rendering — which looks like an application bug rather than configuration. The Shared Pooler host also resolves over IPv4, which Vercel requires without the dedicated IPv4 add-on.

## Required environment variables (names only)

Configure in Vercel **Production** (and matching Preview/Development as needed). Placeholders: `apps/web/.env.example`.

### Owner authentication

| Variable                        | Purpose                                                                                    |
| ------------------------------- | ------------------------------------------------------------------------------------------ |
| `NEXT_PUBLIC_SUPABASE_URL`      | Supabase project URL (browser + server)                                                    |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key (browser + server)                                                       |
| `NEXT_PUBLIC_APP_URL`           | Canonical app URL for OAuth redirects and capability link construction (no trailing slash) |
| `OWNER_WORKSPACE_DOMAIN`        | Google Workspace domain allowlist for Owner sign-in                                        |
| `OWNER_ORGANIZATION_ID`         | Stable application organization id                                                         |

### Database

| Variable       | Purpose                                                                                                                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL` | Server-only Postgres URL for Prisma at **application runtime**. Supabase Shared Pooler **transaction** URI, port `6543`. Never exposed to the browser. **Prisma Migrate does not use this value** |

### Capability tokens

| Variable                  | Purpose                                                                  |
| ------------------------- | ------------------------------------------------------------------------ |
| `CAPABILITY_TOKEN_PEPPER` | Server-only HMAC pepper for capability hash lookup (min 32 characters)   |
| `CAPABILITY_TTL_MS`       | Issued link TTL in milliseconds (D055 default: seven days = `604800000`) |

### Gmail OAuth

Distinct from Supabase Owner authentication. Server-only; never `NEXT_PUBLIC_*`.

| Variable                             | Purpose                                                                    |
| ------------------------------------ | -------------------------------------------------------------------------- |
| `GOOGLE_GMAIL_CLIENT_ID`             | Google OAuth client id for the Gmail connection app                        |
| `GOOGLE_GMAIL_CLIENT_SECRET`         | Google OAuth client secret (server-only)                                   |
| `GMAIL_OAUTH_REDIRECT_URL`           | Optional. Defaults to `${NEXT_PUBLIC_APP_URL}/api/v1/gmail/oauth/callback` |
| `GMAIL_TOKEN_ENCRYPTION_KEY`         | AES-256-GCM key: 32 raw bytes as 64 hex chars or base64                    |
| `GMAIL_TOKEN_ENCRYPTION_KEY_VERSION` | Explicit key version stored with each ciphertext envelope                  |

### Internal scheduler authentication

`CRON_SECRET` authenticates all four internal endpoints: `GET|POST /api/v1/internal/gmail/poll`, `POST /api/v1/internal/suggestions/process`, `POST /api/v1/internal/reminders/process`, and `POST /api/v1/internal/notifications/process`. **The same Production secret may authenticate all four.** Recommend ≥32 random bytes. Configure in **Production only** — do not place the production secret on Preview.

`CRON_JOB_ORG_API_KEY` (or equivalent) administers the scheduler account from outside the application. Never committed, never logged, never sent to application routes.

### Feature flags (all absent in Production)

Each flag matches the **exact lowercase string `true`**. `"1"`, `"TRUE"`, `"yes"`, and whitespace variants all leave the flag **off**, because the cost of guessing wrong is mail nobody approved. Absent is the correct disabled state — do **not** set them to `false`.

| Variable                        | Effect when enabled                                                                                                                                                                                                                                                                                            |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ENABLE_OWNER_EVENT_CAPTURE`    | Allows a mutation to record Owner Event Notification intent, and allows the notification worker's capability-expiry capture phase to run. Records intent only; delivers nothing. Read **before** any transaction opens, so a disabled path issues no statement against the notification tables                 |
| `ENABLE_OWNER_EVENT_DELIVERY`   | Allows the Owner notification worker to claim, process, and **send**. A real Gmail adapter sits behind this flag, so it is live ammunition. Read before the database runtime loads                                                                                                                             |
| `ENABLE_REMINDER_DELIVERY`      | Allows reminder occurrence processing to claim and write, and is the sole condition under which a real Gmail reminder transport is constructed. **Note:** unlike the notification worker, a disabled reminder invocation still opens a database connection — `getDb()` is awaited before the flag is consulted |
| `ENABLE_DB_RUNTIME_DIAGNOSTICS` | Structured server-side database runtime diagnostics for Owner routes. Incident tool; disabled in Production. Adds no public response headers                                                                                                                                                                   |

## Build and deploy order

From repository root:

```bash
pnpm install
pnpm build:domain
pnpm build:ai          # packages/ai dist (required by the suggestion process)
pnpm build:db          # includes prisma generate
pnpm build:web
```

`pnpm build` and `pnpm build:vercel` run **domain → ai → db → web** in that order. `@aicaa/ai` exports compiled `dist/` only and depends on `@aicaa/domain`; `@aicaa/db` does not import `@aicaa/ai`. Vercel production builds must build all three workspace packages before the Next.js bundle so `dist` outputs, Prisma engines, and traced runtime files are present. Prefer `pnpm build:vercel` as the Production build command when the app root is `apps/web` (`cd ../.. && pnpm build:vercel`).

Repository verification also includes `node apps/web/scripts/verify-db-runtime-resolution.mjs` and `node apps/web/scripts/verify-prisma-client-construction.mjs`. These are durable safeguards for Linux/Vercel Prisma packaging, not temporary probes.

### Deploying a commit that is not on `main`

**The ordinary path is a push to `main`**, which Vercel builds and promotes automatically with **no inspection gate**. That is how a schema-ordering incident once reached Production, so any consequential deployment should use the inspected path instead.

**Promoting a Preview deployment is not a substitute and must not be used.** The Git integration builds a pushed non-`main` branch as a **preview-target** deployment, and `vercel promote` moves the alias without rebuilding, so a preview build carries the **Preview** environment for the rest of its life. These variables exist only in Production:

| Variable                             | Consequence if a Preview build is promoted        |
| ------------------------------------ | ------------------------------------------------- |
| `DATABASE_URL`                       | **Every database route fails.** Full Owner outage |
| `CRON_SECRET`                        | Scheduler authentication fails                    |
| `GMAIL_TOKEN_ENCRYPTION_KEY`         | Stored Gmail tokens cannot be decrypted           |
| `GMAIL_TOKEN_ENCRYPTION_KEY_VERSION` | As above                                          |
| `ENABLE_DB_RUNTIME_DIAGNOSTICS`      | Diagnostics silently unavailable                  |

**Use a production-target build, inspect it, then promote it:**

```bash
# from a clean worktree at the exact commit to deploy
vercel deploy --prod --skip-domain --yes    # production env, production target, no alias yet
vercel inspect <url> --logs                 # confirm before anything is live
vercel promote <deploymentId> --yes         # assign the production domain
```

**`--skip-domain` creates an inspection window; it does not make the artifact unreachable.** The build exists, holds Production environment variables including the live `DATABASE_URL`, and is addressable at its own immutable deployment URL, which Vercel assigns unconditionally. What it withholds is the **production domain**. That is zero _aliased_ traffic, not zero exposure; residual exposure is bounded by Vercel deployment protection, which should be confirmed read-only rather than assumed.

**The alias does not move by itself.** The project has `autoAssignCustomDomains=false`, so a new deployment receives only the two default `.vercel.app` aliases and the public custom domain moves **only** by an explicit `vercel promote` or alias assignment. A READY production-target build carrying a new environment value is **not** the live site until that step happens — an enablement that skips it changes nothing and can be mistaken for a completed change.

**In descending order of strength, the controls that prevent accidental traffic movement are:** not pushing to `main`; the alias staying bound to the current deployment until an explicit promote; and deployment protection bounding the un-aliased build. `--skip-domain`'s contribution is making the promote a separate command with an inspection between the two.

**Before promoting, confirm** the commit SHA in the deployment metadata, that the target is `production`, that the build state is ready, that the route set is what you expect **by name and not merely by count**, that **no migration ran during the build** — only `prisma generate` should appear — and that the build used the configured Node version and build command.

**The deploying worktree needs `.vercel/project.json`** to be linked. It contains a project and organization identifier, no secret, and `.vercel/` is gitignored.

### The runtime-value import hazard

**`@aicaa/db` is listed in `serverExternalPackages`, so Next leaves it a runtime external.** A statically imported **value** from it does not reliably survive the build. In one deployed bundle a constant was emitted into the server chunk as an **undeclared free variable** while every neighbouring binding was minified; the first request down that path threw `ReferenceError` and the route answered `INTERNAL_ERROR`.

The rules, which apply to any package in `serverExternalPackages`:

- **Type-only imports are always safe.** `import type { … } from '@aicaa/db'` is erased at compile time and cannot fail at runtime.
- **Value imports are the hazard** — constants, classes, functions. Either reach persistence through `loadDbRuntime()`, or own the value locally with a guard asserting it matches the persistence authority.
- **Unit tests structurally cannot detect this.** Vitest resolves `@aicaa/db` directly, so the binding is present in every test and absent only in the artifact that ships. A green suite is not evidence.
- **Production bundle verification is the only guard.** Build with the effective Vercel production path and assert the identifier does not appear as a free variable in `.next/server`.
- **The diagnostic signature is misleading.** A `ReferenceError` is neither a Prisma error nor a `PersistenceError`, so **no `database_runtime_failure` event is emitted** to contradict it. Category `UNKNOWN_FAILURE` **with no accompanying database diagnostic** points at code or packaging, not at the database.

**A class carried across this boundary for `instanceof` is unsound even when the binding survives.** Persistence errors are thrown by the traced `dist/runtime.js` while a static import resolves `dist/index.js`; those are different entry files and the deployed Lambda layout does not guarantee one module graph. If they diverge, `error instanceof PersistenceError` is **silently false** for an error this repository threw — no crash, no diagnostic, just a `UNIQUE_VIOLATION` that stops being recognised as one. Move the comparison into the module that owns the class; `packages/db` exposes an `isPersistenceError` predicate for exactly this reason.

**The worst shape this defect takes is inside a `catch` block.** A `ReferenceError` raised while handling a persistence failure replaces the error being handled with a meaningless one. Guard: `apps/web/__tests__/a8-7b-incident-1j-persistence-error-import.test.ts`, which covers the import pattern across `lib` and `app`, the bridge wiring, the preserved classification behaviour, and the built server chunks.

## Database migrations

All migrations in `packages/db/prisma/migrations/` are **applied in Production**. Nothing is pending. Each file's own header and [packages/db/README.md](../packages/db/README.md) describe what it does.

**Authoring rules** (also in the package README): additive and forward-only; deny-by-default RLS on new tables; introduce an enum value in its own migration using it nowhere; **never edit an applied migration**, because Prisma checksums it and editing one breaks `migrate deploy` on every database that already has it.

**Applying a migration still schedules and sends nothing.** Reminder and notification behaviour is gated by feature flags and by the absence of scheduler jobs, not by the schema.

**Ordering obligation.** A page or route that reads a table **before consulting any flag** cannot be made safe by a flag — gating a read of durable state on a flag would hide rows that genuinely exist. The rule is therefore **migrate before deploying code that depends on the migration**, and it is an obligation on the rollout rather than a property of any feature.

**Local Docker** (loopback Postgres 17 on port 5433, matching the Production major version; never production):

```bash
pnpm db:docker:up
pnpm db:migrate:local
pnpm db:migrate:status:local
```

Ordinary package tests use in-process **PGlite** and need no production `DATABASE_URL`.

### Migration connection strategy

**The application runtime and Prisma Migrate use different endpoints on purpose, and only one is configured in Vercel.**

| Consumer                   | Endpoint                                     | Port   | Where the value lives                                             |
| -------------------------- | -------------------------------------------- | ------ | ----------------------------------------------------------------- |
| Vercel application runtime | Supabase Shared Pooler, **transaction** mode | `6543` | Vercel Production `DATABASE_URL`                                  |
| `prisma migrate deploy`    | Supabase Shared Pooler, **session** mode     | `5432` | Process-scoped override on the operator workstation. Never stored |

`prisma migrate deploy` takes a **session-scoped advisory lock** and holds it for the whole invocation; transaction-mode pooling gives no stable session to hold it in. Same host in both cases — only the port and mode differ, and the host/port pairing rule above applies exactly as written.

Placeholder form (**no real project reference, region, username, or password may ever be written down**):

```text
postgresql://postgres.<PROJECT_REF>:<PASSWORD>@aws-<REGION>.pooler.supabase.com:5432/postgres
```

**`DIRECT_URL` has no automatic effect here.** Prisma consults a second connection only when the datasource declares `directUrl`, and `schema.prisma` declares `url = env("DATABASE_URL")` alone. Setting `DIRECT_URL` changes nothing. Adding `directUrl` is deliberately avoided, because it would put a second production connection string into deployed configuration to serve a command that is never run from the deployment.

### Secure migration-command handling

Read the credential into the environment without it entering shell history, run the commands **from a detached worktree at the commit that bounds the migration set**, then discard it:

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

- **The local-only helpers must never be pointed at production.** `pnpm db:migrate:local` and friends assert a loopback host and will refuse a production one. They are not "the same command with a different URL".
- **No unguarded migration package script exists.** Bare `migrate:deploy` / `migrate:dev` / `migrate:status` scripts were removed because they inherited whatever `DATABASE_URL` was in scope, including one loaded silently from `packages/db/.env`. Prisma is invoked directly so the target is always written at the call site.
- **Run from a worktree that has no `.env`.** Prisma reads `.env` from the schema's directory. Verify its absence rather than assuming it. Do not substitute `--schema` pointing back into the main checkout, which reloads that `.env`.
- **The commit you run from determines which migrations apply.** `migrate deploy` applies everything pending in _its own_ migrations directory and offers no way to select a subset. Bounding the set means choosing the worktree, not choosing a flag.
- **A fresh worktree has no `node_modules`** and cannot run Prisma. Install first (`pnpm install --filter @aicaa/db --ignore-scripts`), pinned to the rehearsed Prisma version, and do it **before** any Owner no-use window opens.
- **No credential may be committed, pasted into documentation, quoted in a ticket, or recorded in evidence.** Record the redacted host form and the port, never the string.
- **`prisma migrate status` exits non-zero when migrations are pending.** Expect exit 1 before and exit 0 after. Do not run the sequence under `set -e` without allowing for it, and do not read that exit code as a failure.
- **An advisory-lock timeout is not a retry-immediately condition.** Another migration process may still be running or may have died holding state. Re-run only after confirming there is no failed migration row **and** no partial physical schema.

### Migration endpoint verification

Run these three checks before the first `migrate deploy` of a session, and record the results.

1. **Hostname form** is `aws-<region>.pooler.supabase.com`, not `db.<project-ref>.supabase.co`.
2. **Port is exactly `5432`**, not `6543`. This is the single most consequential character in the string.
3. **`pgbouncer=true` is absent** from the query parameters. Its presence indicates a string copied from the transaction-mode panel.

As supporting evidence, a session-scoped advisory lock taken and re-read in one `psql` session should observe itself:

```sql
SELECT pg_try_advisory_lock(72707707);
SELECT count(*) FROM pg_locks WHERE locktype = 'advisory';
SELECT pg_advisory_unlock(72707707);
```

**Do not treat that test as proof on its own.** A transaction pool can coincidentally hand the same backend to both statements, so a pass is consistent with — but does not establish — session mode. The authoritative controls are the endpoint's documented Supabase mode and the exact host/port pairing.

### Migration failure model

Stated precisely, because the wrong mental model here produces exactly the wrong recovery action.

- `prisma migrate deploy` applies **pending files sequentially**, recording each in `_prisma_migrations` as it completes.
- **No transaction spans migration files.** A failure in file 5 leaves files 1–4 applied and committed.
- PostgreSQL **may** treat a multi-statement query message as an implicit transaction block, so a multi-statement file **might** roll back as a unit. **Do not rely on that.** It is emergent behaviour of statement grouping in a driver, not a property this repository establishes or tests. Some migration file headers make a claim about transaction grouping; that claim is not established and nothing here depends on it.
- **After any failure, inspect the physical schema.** What is actually present is the only authority.
- **Never call `migrate resolve` on the strength of the `_prisma_migrations` row alone.** That row records what Prisma believes, and the reason you are reading this is that Prisma's belief and the database disagree.

The accurate description of the operation is: _one ordered `prisma migrate deploy` invocation, applying pending migration files sequentially with per-file recording and no guaranteed cross-file or per-file atomicity._ Do not describe a migration set as an atomic unit — in evidence, in a ticket, or to yourself at 2 a.m.

**Recovery classification after a failure:**

| Physical state   | Meaning                                       | Standing rule                                                                                                 |
| ---------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **None present** | No object the failed migration creates exists | Resolving as **rolled back** may be appropriate **after the cause is corrected**                              |
| **All present**  | Every object exists and is correct            | Resolving as **applied** may be considered **only after proving the end state exactly matches the migration** |
| **Some present** | A partial application                         | **Stop and escalate**                                                                                         |

`migrate resolve --applied` is the dangerous one: it tells Prisma to stop trying, permanently, and every later migration then runs against a schema nobody re-verified. A constraint added `NOT VALID` and then validated is detected by **`pg_constraint.convalidated`**, not by constraint existence.

**Escalation condition:** any state not exactly matching a case above, any doubt about which applies, or any temptation to "just drop it and re-run" — stop, record the physical state, and get a second reviewer.

## Current production state

**Everything is deployed and every A8 feature is inert.** This is the designated safe harbour, and that is structural rather than merely observed: the code is deployed against the full migration set, and all three A8 flags are absent, so capture writes nothing, the notification worker opens no database connection, and reminder delivery constructs no transport.

| Property                      | Value                                                                                                                 |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Schema                        | **All migrations applied.** Confirm with Q2 below                                                                     |
| `ENABLE_OWNER_EVENT_CAPTURE`  | Absent                                                                                                                |
| `ENABLE_OWNER_EVENT_DELIVERY` | Absent                                                                                                                |
| `ENABLE_REMINDER_DELIVERY`    | Absent                                                                                                                |
| Gmail                         | Connected                                                                                                             |
| Scheduler jobs                | External, at cron-job.org. Gmail-poll and suggestion-processing present; **no** reminder job; **no** notification job |
| Owner authentication          | Cookie and Bearer both live                                                                                           |

**Nothing about this state creates time pressure to enable anything.** Confirm the deployed commit, deployment id, and alias in the Vercel dashboard rather than from this document, which does not track them.

**Standing restraint:** the Owner reminder routes are functional in Production. **The Owner must not create or modify a reminder** until a later rollout is authorized — no technical obstacle prevents doing so by accident.

**Known operational gap:** there is **no documented database credential-rotation procedure**. A rotation was performed on 2026-08-04 without one. Tracked on the [MILESTONES.md](MILESTONES.md) engineering / DX backlog.

## Production smoke checks

After deploy, confirm (authenticated Owner session required for protected routes):

| Check                                    | Expected                                                              |
| ---------------------------------------- | --------------------------------------------------------------------- |
| `GET /api/v1/session`                    | `200`; `role` = `owner`; correct `organizationId`                     |
| `GET /api/v1/tasks`                      | `200`; cursor page shape                                              |
| `GET /api/v1/tasks/{taskId}/reminder`    | `200`; `state=no_due_date`; ETag ending `v0` — never `vundefined`     |
| `GET /api/v1/tasks/{unknownId}/reminder` | Typed `NOT_FOUND`                                                     |
| `GET /c/{token}`                         | Non-mutating capability page for a valid issued link                  |
| Recipient capability `POST`              | Mutations require `confirmation: "confirmed"` and `If-Match`          |
| Owner `/tasks` (browser)                 | Task list renders; Task detail renders notes and outcome              |
| Owner `/attention` (browser)             | Loads and does **not** reach its error boundary; both sections render |

Probes must be **read-only**. Do not create or modify a reminder as a smoke test.

## Subsystem operations

### Gmail polling

The **Application Polling Engine** is part of the application (eligibility, sequential sync, History ingestion, locks, audit). Scheduling is **intentionally external** and vendor-neutral (D065, D079). The scheduler contains no polling logic, business rules, or database access.

**Vercel Hobby note:** Hobby does not support cron schedules more frequent than daily, so root `vercel.json` must **not** declare a five-minute Vercel Cron. Five-minute cadence is an External Scheduler responsibility.

| Setting        | Guidance                                           |
| -------------- | -------------------------------------------------- |
| Method         | **HTTP POST**                                      |
| URL            | `{NEXT_PUBLIC_APP_URL}/api/v1/internal/gmail/poll` |
| Interval       | Every **five minutes** (D065)                      |
| Authentication | `Authorization: Bearer <CRON_SECRET>`              |
| Request body   | Empty                                              |

Confirm invocations via the scheduler's execution logs and `GmailSyncRun` rows with `trigger=cron`.

**Disable safely:** pause or delete the scheduler job, or unset/rotate `CRON_SECRET` (auth fails closed). Overlapping invocations are safe via per-account sync locks.

**Eligibility:** `connected` + `historyState=valid` + non-null `historyId` + credential present. The engine never seeds unset History during a scheduler invocation. At most three accounts per invocation, sequential, `maxDuration=60`, stop starting accounts with under 15 s remaining. A Gmail 429 stops remaining accounts for that invocation.

Gmail settings UI and History recovery / `resync_required` operator UX remain deferred.

### Suggestion processing

**Product-target pointer.** Automatic Gmail suggestion processing below is **current implementation infrastructure**. The intended initial Owner commissioning UX is manual **"Review with Rocket"** after the Owner sees a message in an intake surface ([WORKFLOWS.md](WORKFLOWS.md) §1a; **D156**). **D179** authorizes **S7** as that implementation; a bounded server-side Gmail intake and Review adapter slice is implemented and S7 is not complete. Do not mistake this operational A6 section for that target. S7 does **not** authorize setting `INTERPRETATION_AI_ENABLED` in Production or changing any other Production flag.

A **separate** scheduler job, independent of the Gmail poll:

| Setting        | Guidance                                                    |
| -------------- | ----------------------------------------------------------- |
| Method         | **HTTP POST**                                               |
| URL            | `{NEXT_PUBLIC_APP_URL}/api/v1/internal/suggestions/process` |
| Interval       | Every five minutes; **independent** job                     |
| Authentication | `Authorization: Bearer <CRON_SECRET>`                       |

Responses are aggregate counts only — never raw bodies (D084, D085). Overlapping invocations are safe (CommunicationEvent claim leases, D081; preserved A6 relational suggestion uniqueness per event, D163). Heuristic relevance runs before AI, and an AI failure does not create heuristic-only fallback suggestions (D085). Claim batches prefer fresh `unprocessed` events before reclaiming `failed_retryable`, so a retryable failure cohort cannot monopolize every invocation.

**`AI_INVALID_OUTPUT` / `AI_EMPTY_OUTPUT` / `AI_SCHEMA_INVALID` runbook:** read `suggestion_last_error_code` plus the audit `note` fingerprint (`code|status=…|keys=…|issues=…`) — never re-enable content logging. Typical causes are a model emitting non-contract fields or empty `summaryPoints`. Distinguish `AI_INSUFFICIENT_QUOTA` (billing) from `AI_RATE_LIMIT` (throttle).

**Retention:** dismissed suggestion excerpts purge at `updatedAt + 7 days`; approved at `updatedAt + 30 days` (D082).

### Handoff

Handoff has **no scheduler job**: delivery runs inside the authenticated Owner request (D094), so there is nothing to enable or pause.

- Both delivery paths are production-verified: `gmail_forward` for Gmail-origin Tasks and `assignment_email` otherwise. **The server chooses; operators do not.**
- The Owner grant must carry `gmail.readonly` **and** `gmail.send` (D093). If send scope is missing, the Owner Task page offers re-consent and then a **manual** retry — never an automatic send on OAuth return.
- Handoff idempotency is durable. A repeated same-key call replays the single attempt; it does not send a second message.
- Recipients are managed through the Owner Recipient endpoints; there is no Recipient management UI.

### Owner web experience

**No environment variable gates it.** Always-on operational diagnostics use the application-owned seam in `apps/web/lib/observability/` and emit privacy-safe JSON on standard output (`operation_timing`, `operational_failure`). `ENABLE_DB_RUNTIME_DIAGNOSTICS` remains an incident-only gated probe.

**Vendor-neutral by requirement (D115).** Structured diagnostics are read through the host's existing log surface. A hosted backend or OpenTelemetry exporter must remain an adapter.

**No health or readiness endpoint is authorized.** The smoke checks above plus structured diagnostics are sufficient; a contract test asserts `/health` is absent from the bundled OpenAPI.

**Capability routes are excluded from client telemetry (D114).** Server diagnostics identify them only by static templates (`/c/[token]`, `/api/v1/capabilities/[token]/…`).

**Operator note — capability URLs in platform access logs.** Platform access logs record request paths, so capability URLs appear in them because the identifier is embedded in the path. The D114 application-side prohibition is intact and verified: no raw `/c/{token}` path appears in any application diagnostic. Recorded as a future architectural and security consideration, not a release blocker.

**Browser verification runs as a separate job**, not inside `pnpm verify`: `pnpm --filter @aicaa/web e2e`. It targets a **controlled local environment only** — a disposable local Postgres plus a local Supabase Auth double — and refuses any non-loopback database. It is never run against production and produces no production evidence. Stop the disposable cluster with `pnpm --filter @aicaa/web e2e:db:stop`. Prerequisites and known gaps: [P1_2_BROWSER_HARNESS.md](P1_2_BROWSER_HARNESS.md).

### Reminder engine (deployed, not operational)

**No reminder has ever been sent.** The distinction that matters is between _deployed_, _functional_, and _operational_. The reminder code is **deployed**, including `POST /api/v1/internal/reminders/process`, the Owner reminder routes, the Task-lifecycle reminder wiring, and the real Gmail transport behind the flag. The Owner reminder routes are **functional**. Nothing is **operational**: no scheduler job invokes the worker and `ENABLE_REMINDER_DELIVERY` is set nowhere.

With the flag unset the route builds no transport, so **no access resolver exists, no stored refresh token is decrypted, and no token exchange is attempted**; the endpoint returns a zero-work response reporting `transportConfigured: false`. Enabling the flag additionally requires `OWNER_ORGANIZATION_ID` and a connected Gmail account. Automated tests cannot reach real Gmail even with the flag forced on, because the adapter throws at construction when it detects a test runner.

**Two properties of the send path to know before enabling it.** Gmail authorization is resolved **once per invocation, before any schedule is claimed**: if the connection is missing, revoked, or unrefreshable, the invocation claims nothing, writes nothing, calls no provider, and reports `transportAuthorized: false` — the fault is visible without being charged to a Task. And a reminder email **contains no link** (D130): it directs the Recipient to the original assignment email, and if that email's capability is unusable the occurrence is skipped as `no_actionable_capability` with no provider call.

> **Production reminder delivery must not be enabled until both the Event Notification Engine and the minimum Owner schedule-status UI are operational (D108).**

Before enablement the Event Notification Engine must be able to notify the Owner about at least: the overdue reminder ceiling being reached; a permanent delivery failure; no active assignment where Owner action is required; and a schedule entering `requiresOwnerAttention`. **A Task-page status alone is not sufficient** — the Owner must not have to inspect Tasks continually to discover that an automation stopped.

Additional pre-enablement conditions: historical due-date data must not auto-activate reminders, and the first production observation must confirm no pre-existing Task fired one (D109); delivery must be observed at **09:00 organization-local**, not UTC (D103); and no capability token or URL may appear in reminder logs, telemetry, audit, or metadata (D109).

**Scheduler adapter — endpoint exists, job does not.** `POST /api/v1/internal/reminders/process` uses the existing `CRON_SECRET` bearer family and suits an approximately five-minute external wake-up. **No job has been created for it, and none may be created before the gate above is satisfied.** The five-minute cadence is a wake-up interval, not a reminder interval: persisted occurrence instants are the scheduling authority, each invocation asks which have arrived, a missed invocation is recovered by a later one, and overlapping invocations are safe because occurrence identity is unique in the database.

**Organization timezone** is the sole scheduling authority and is `America/Vancouver` (D034, D103). It is a documented product constant with **no** environment variable, configuration record, or database column. If configuration for it is ever introduced, document it _when it exists_ — do not treat any variable name as configured in advance.

### Owner notification worker (deployed, not operational)

`POST /api/v1/internal/notifications/process` — same `CRON_SECRET` bearer family, same Node.js runtime and sixty-second budget. **No scheduler job invokes it and none may be created**; `vercel.json` is unchanged. It is deliberately separate from the reminder worker: occurrence policy and one-shot Owner event delivery have different retry rules, terminal states, and tables, and one endpoint doing both would make a single deadline and batch serve two unrelated backlogs.

The endpoint has two independently gated phases: a **capture** phase observing capability expiry under `ENABLE_OWNER_EVENT_CAPTURE`, and a **delivery** phase under `ENABLE_OWNER_EVENT_DELIVERY`. They run in that order, share the deadline, and share no transaction.

| Capture | Delivery | What one invocation does                                                                                                              |
| ------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| absent  | absent   | **Today's state.** Authenticates, reads two strings, returns zero aggregates. **No database connection, no transport, no credential** |
| `true`  | absent   | Observes up to fifty expired capabilities. Composes no transport, reads no Gmail configuration, claims no intent                      |
| absent  | `true`   | Delivery only. No expiry scan, and no new `capability.expired` intent can be created                                                  |
| `true`  | `true`   | Expiry observation first, then the delivery batch within the remaining budget                                                         |

**The invariant to rely on: with both flags absent, this endpoint touches nothing.** Both are read before the database runtime loads, before any configuration is read, and before any credential is touched.

**Enabling delivery would send mail from the connected Gmail account to itself.** The destination is resolved server-side from the intent organization's `CommunicationAccount.emailAddress`; no configuration setting redirects it, and `OWNER_ORGANIZATION_ID` only asserts agreement and fails closed on mismatch. `NEXT_PUBLIC_APP_URL` must be a valid origin, since Owner notification links are built from it.

**Enabling capture alone is safe and is the intended first step.** It observes expiry, writes audit rows and notification intents, and can contact nothing. Any backlog it accumulates cannot later flush: an intent older than twenty-four hours is terminalized as suppressed without contacting anything, so turning delivery on weeks later mails nothing about the interval.

**Nothing schedules the capture phase.** The sweep is invoked by this endpoint and by nothing else, and no cron job invokes this endpoint. **Do not describe capability expiry as scheduled.** With capture absent, expiry is observed only when a Recipient presents a lapsed link.

## Enablement staging

Enablement is staged by flag, and each stage needs its own authorization. **Every stage presupposes that the code is deployed against the full migration set.**

| Stage                     | Capture | Delivery | Reminder | Scheduler jobs     | Safe rollback target                       |
| ------------------------- | ------- | -------- | -------- | ------------------ | ------------------------------------------ |
| **F0** All flags off      | absent  | absent   | absent   | as found           | **Yes — the designated safe harbour**      |
| **F1** Capture only       | `true`  | absent   | absent   | as found           | Yes                                        |
| **F2** Delivery rehearsal | absent  | `true`   | absent   | as found           | No — exists only for a zero-send rehearsal |
| **F3** Capture + delivery | `true`  | `true`   | absent   | + notification job | Yes                                        |
| **F4** All three          | `true`  | `true`   | `true`   | + reminder job     | Yes                                        |

**Environment-variable changes affect only deployments created after the change.** A running deployment holds the values it was built and bound with; editing a variable in the dashboard does nothing until something redeploys. Correspondingly, **rollback restores the target deployment together with its original environment variables** — it does not re-bind current values onto an old build, so rolling back to a deployment built with a flag set **restores that flag**.

Rules that follow:

- **F0 is the containment action for almost everything.** Returning to it is the default response to trouble at any later stage.
- **Reaching F0 later may require a fresh deployment rather than rollback.** On the Hobby plan, rollback may reach only the immediately previous deployment. Once F1 and F2 exist, F0 is several steps back. Plan on unsetting the variables and redeploying.
- **Rollback does not disable external scheduler jobs.** The scheduler keeps calling; the endpoints simply become inert again. To stop invocation, **pause the job** — a separate action in a separate system.
- **Rollback does not undo a migration.** Schema is forward-only.
- **Rollback does not unsend an email.**
- **A flag set on a production-target deployment that does not hold the public custom domain changes nothing.** The alias assignment is the step that makes an enablement real.

**Two thresholds are deliberately not crossed in one slice:** the first enablement that can send mail on Rocket's own initiative, and the first that can send mail to somebody who is not the Owner.

## Verification gate classification

Three categories, kept separate because conflating them is how a "quick check" regenerates a tracked artifact in the middle of a production operation.

### 1. Repository-non-mutating preflight

Suitable immediately before and after a production operation. **"Non-mutating" means "does not alter tracked source"** — several of these write cache, `dist`, or `node_modules` output.

| Command                                                       | Alters tracked files | Untracked / cache output                                          |
| ------------------------------------------------------------- | -------------------- | ----------------------------------------------------------------- |
| `git rev-parse HEAD`, `git status --short`, `git diff --stat` | No                   | No                                                                |
| `pnpm format:check`                                           | No                   | No                                                                |
| `pnpm lint`                                                   | No                   | ESLint cache                                                      |
| `pnpm contracts:validate`                                     | No                   | `packages/contracts/dist`                                         |
| `pnpm --filter @aicaa/domain test`                            | No                   | Vitest cache                                                      |
| `pnpm --filter @aicaa/web test`                               | No                   | Workspace `dist`, Vitest cache, Prisma Client into `node_modules` |

**Deliberately excluded:** `pnpm contracts:check-drift` runs `pnpm generate` first, which writes into the **tracked** generated tree before asserting the diff is clean — a development gate, not a preflight. `pnpm build:web` produces a full `.next` build: correct before a deploy, pointless as a between-steps check. Anything under `pnpm db:migrate:*:local`, which asserts a loopback host.

### 2. Full development verification

`pnpm verify` is the **normal slice exit gate** and must stay unchanged. It runs `contracts:generate` and `contracts:check-drift`, so it **may rewrite committed generated artifacts**, and it builds Android as well as web. **Do not run it during a live production operation** — a rollout window is not the moment to discover that a generator produced a different byte sequence.

### 3. Production database preflight

The read-only SQL below, plus `prisma migrate status`. Run only with explicit authorization for the slice in question.

### Docker

`.pg.test.ts` suites skip themselves unless `AICAA_PG_CONCURRENCY_URL` is set, so the ordinary suites need no container. Start Docker for a local migration rehearsal or an opted-in PostgreSQL suite, then stop it. **A container left running through a production window is a loose end, not a convenience.** `pnpm verify` deliberately requires no Docker, so it stays deterministic.

## Production preflight and verification SQL

**Read-only.** Run from the Supabase SQL editor or `psql` with least privilege. Do not paste row contents containing PII into evidence — record counts and booleans.

| ID      | Query                                                                                                                                                                                                                                                                                                                                                     | When                                                                            | Expected                                                                  | Stop condition                                                                                                                |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **Q1**  | `SELECT count(*) FROM tasks;`                                                                                                                                                                                                                                                                                                                             | Preflight                                                                       | A value consistent with usage                                             | A wildly unexpected count — understand it before taking a lock on the table                                                   |
| **Q2**  | `SELECT migration_name, started_at, finished_at, rolled_back_at, applied_steps_count FROM _prisma_migrations ORDER BY started_at;`                                                                                                                                                                                                                        | Preflight and after any migration attempt                                       | Every row finished, none rolled back, `applied_steps_count = 1`           | Any unfinished or rolled-back row, or any count other than 1                                                                  |
| **Q3**  | `SELECT migration_name, started_at, finished_at, rolled_back_at, logs FROM _prisma_migrations WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL;`                                                                                                                                                                                                   | Preflight and immediately after any failure                                     | **Zero rows**                                                             | **Any row is a hard stop.** Go to the recovery classification                                                                 |
| **Q4**  | `SELECT pid, state, now() - xact_start AS xact_age, left(query, 80) FROM pg_stat_activity WHERE datname = current_database() AND xact_start IS NOT NULL AND pid <> pg_backend_pid() ORDER BY xact_start;`                                                                                                                                                 | Immediately before a migration, and **repeated immediately before the command** | No `idle in transaction`; no transaction older than 30 s                  | Any `idle in transaction`, any transaction older than 30 s, or any session whose source is unclear                            |
| **Q5**  | `SELECT count(*) FROM tasks WHERE due_local_date IS NOT NULL;`                                                                                                                                                                                                                                                                                            | After any reminder-related migration                                            | **Exactly 0** until reminders are deliberately used                       | Any non-zero value is a hard stop — D109 forbids historical due dates activating reminders                                    |
| **Q6**  | `SELECT relname, relrowsecurity FROM pg_class WHERE relname IN ('task_reminder_schedules','reminder_delivery_attempts','owner_notification_intents','owner_notification_attempts');`                                                                                                                                                                      | After a migration                                                               | `relrowsecurity = true` on every row                                      | **Any `false` is a hard stop** — deny-by-default RLS is the boundary                                                          |
| **Q7**  | `SELECT i.relname, x.indisvalid FROM pg_index x JOIN pg_class i ON i.oid = x.indexrelid JOIN pg_class t ON t.oid = x.indrelid WHERE t.relname IN ('task_reminder_schedules','reminder_delivery_attempts','owner_notification_intents','owner_notification_attempts') ORDER BY 1;`                                                                         | After a migration                                                               | Every index `indisvalid = true`                                           | **`indisvalid = false`** — an invalid index must be dropped before rebuilding                                                 |
| **Q8**  | `SELECT count(*) FROM task_reminder_schedules; SELECT count(*) FROM reminder_delivery_attempts; SELECT count(*) FROM owner_notification_intents; SELECT count(*) FROM owner_notification_attempts;`                                                                                                                                                       | Any inertness check                                                             | `0, 0, 0, 0` while every flag is absent                                   | Any non-zero value while flags are absent                                                                                     |
| **Q9**  | `SELECT count(*) FILTER (WHERE occurred_at > now() - interval '1 hour') AS under_1h, count(*) FILTER (WHERE occurred_at <= now() - interval '1 hour' AND occurred_at > now() - interval '24 hours') AS h1_to_24, count(*) FILTER (WHERE occurred_at <= now() - interval '24 hours') AS over_24h FROM owner_notification_intents WHERE state = 'pending';` | Capture observation; before any notification invocation                         | Whatever capture produced; **exactly the expected value before a canary** | Set per canary                                                                                                                |
| **Q10** | `SELECT count(*) FROM owner_notification_intents WHERE state = 'claimed' AND claim_expires_at < now();`                                                                                                                                                                                                                                                   | Notification steady state                                                       | **0**                                                                     | Non-zero over consecutive observations means claims are being abandoned                                                       |
| **Q11** | `SELECT count(*) FROM reminder_delivery_attempts WHERE outcome = 'claimed' AND claim_expires_at < now();`                                                                                                                                                                                                                                                 | Reminder steady state                                                           | **0**                                                                     | Same rule as Q10                                                                                                              |
| **Q12** | `SELECT count(*) FROM (SELECT organization_id, event_type, subject_kind, subject_id, occurrence_key, count(*) FROM owner_notification_intents GROUP BY 1,2,3,4,5 HAVING count(*) > 1) d;` and the equivalent over `reminder_delivery_attempts` grouped by `schedule_id, generation, occurrence_kind, occurrence_local_date`                               | After any canary; steady state                                                  | **0 and 0**                                                               | **Any duplicate is a hard stop.** Unique indexes should make it impossible, so a non-zero result means an assumption is wrong |
| **Q13** | `SELECT count(*) FROM task_reminder_schedules WHERE status = 'active';`                                                                                                                                                                                                                                                                                   | Reminder preflight; before a reminder canary                                    | Preflight **0**; before a canary **exactly 1**                            | Any other value before a canary                                                                                               |
| **Q14** | `SELECT count(*) FROM task_reminder_schedules WHERE status = 'active' AND ((next_overdue_occurrence_at IS NOT NULL AND next_overdue_occurrence_at <= now()) OR (advance_disposition = 'scheduled' AND advance_occurrence_at <= now()));`                                                                                                                  | Burst preview, immediately before enabling reminder delivery                    | **Exactly 1** for a canary                                                | **Any value above 1** — that is the burst the canary exists to prevent                                                        |
| **Q15** | `SELECT count(*) FROM task_capabilities WHERE status = 'active' AND expires_at <= now();`                                                                                                                                                                                                                                                                 | Before enabling capture; before a notification canary                           | Before capture: informational. **Before a canary: 0**                     | **Non-zero before a canary** — the expiry sweep would create up to fifty additional intents in the same invocation            |

**A canary must be genuinely single-item by state preparation** — verified counts immediately before invocation — rather than by a batch limit, a bypass, or a hope that the queue is empty. Enumerate every condition that could make it multi-item, including secondary phases of the same endpoint that populate the same queue.

## Capability links in production

Capability URLs are derived from `NEXT_PUBLIC_APP_URL` and the issued path token (D094). Production links must use the configured production app URL. Do not log or commit raw tokens or hashes (D063). After re-forward or reassignment, prior active capabilities are revoked (D086).

## Safe database row-count checks

For read-only operator sanity checks: `recipients`, `tasks`, `task_assignments`, `task_capabilities`, `audit_events`, `task_suggestions`, `handoff_attempts`, `task_notes`, `task_reminder_schedules`, `reminder_delivery_attempts`, `owner_notification_intents`, `owner_notification_attempts`.

Compare counts before and after an E2E or deploy. Do not paste row contents containing PII into tickets.

## Rollback principles

1. **Application:** redeploy a previous known-good deployment. **A deployment carries the environment variables it was built with**, so rollback restores the target's original flag values rather than today's, and on the Hobby plan it may reach only the immediately previous deployment. **Do not assume a specific older deployment is one step back** — confirm it before relying on it. Prefer a **fresh production-target build of a known-good commit** using the inspected method above, which is predictable in a way one-step rollback is not.
2. **Schema:** migrations are forward-only in production. Roll back application code before attempting destructive schema changes, and never drop production tables without an explicit operator decision. **Rolling back application code does not unapply a migration**, and no migration has a down path.
3. **Schedulers:** rolling back a deployment does **not** pause an External Scheduler job. Pausing is a separate action in a separate system, and stopping delivery additionally requires unsetting the governing flag and redeploying.
4. **Secrets:** rotate `CAPABILITY_TOKEN_PEPPER` only with a documented invalidation plan — all outstanding links become unusable. Do **not** rotate `CRON_SECRET` as a containment action during a schema change; pause the scheduler jobs instead.
5. **Capabilities:** reassignment or re-forward revokes the prior active capability and issues a new one (D086). Revoked records are preserved for audit.

**A rollback target built before a credential rotation carries the pre-rotation `DATABASE_URL`.** If the old credential was invalidated, rolling back to that build is a **total database outage** rather than a feature regression. Check the build date against any rotation date before treating a deployment as a safe harbour.

## Untracked Supabase CLI artifacts

These directories are **local CLI state** and must remain **untracked**: `apps/web/supabase/`, `packages/db/supabase/`, `supabase/`. Do not commit `.temp/` linkage files. Link projects locally; configure production via Vercel environment variables.

## Re-enabling internal diagnostics

If Owner task routes return `500` and logs are insufficient:

1. Set `ENABLE_DB_RUNTIME_DIAGNOSTICS=true` on a **non-production** preview deployment first.
2. Reproduce the failing route; inspect **server logs** only.
3. Disable diagnostics before promoting to Production.

> **⚠ This procedure cannot be followed as written today.** The **Preview environment has no `DATABASE_URL`**, so a preview deployment cannot reach the database and cannot reproduce a database-backed Owner route at all. Doing so first requires adding `DATABASE_URL` to Preview, which is an environment change needing its own authorization and its own decision about **which** database it should point at. Until that decision is made, treat this section as unavailable rather than as guidance.
>
> Note also that these are **database** diagnostics. A failure in packaging or application code emits none, and their absence alongside an `UNKNOWN_FAILURE` is itself a signal — see [the runtime-value import hazard](#the-runtime-value-import-hazard).

Production normally runs with diagnostics **disabled**.

## Related documentation

- HTTP implementation status: [API_CONTRACT.md](API_CONTRACT.md)
- Capability authorization: [SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md)
- Delivery sequence: [MILESTONES.md](MILESTONES.md)
- Package setup and persistence invariants: [../packages/db/README.md](../packages/db/README.md)
