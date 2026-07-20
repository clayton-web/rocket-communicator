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

| Variable       | Purpose                                                                                                                            |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL` | Server-only Postgres URL for Prisma (`@aicaa/db`). Use Supabase **transaction pooler** in production. Never expose to the browser. |

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

`CRON_SECRET` / `InternalCronBearer` authenticate internal scheduler endpoints: `GET|POST /api/v1/internal/gmail/poll` (A5.5) and, after A6 implementation, `POST /api/v1/internal/suggestions/process` (D084). **The same Production `CRON_SECRET` may authenticate both endpoints**; no separate secret is required by current decisions. Recommend ≥32 random bytes. Configure in **Production** only; do not place the production secret on Preview. Any External Scheduler that securely issues an authenticated request every five minutes is acceptable (D079). The recommended initial adapter while the project remains on the Vercel Hobby plan is **cron-job.org** (HTTP POST with Bearer auth). Other compatible schedulers—including Vercel Cron, GitHub Actions, Google Cloud Scheduler, and AWS EventBridge—may replace it without application logic changes.

### Diagnostics (normally off)

| Variable                        | Purpose                                                                                                                                                                                            |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ENABLE_DB_RUNTIME_DIAGNOSTICS` | When exactly `true`, enables structured **server-side** database runtime diagnostics for Owner routes. **Disabled in Production** by default. Does not add public `X-AICAA-DB-*` response headers. |

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

**Apply to production** (with production `DATABASE_URL` configured for the target):

```bash
pnpm --filter @aicaa/db migrate:deploy
```

**Verify status:**

```bash
pnpm --filter @aicaa/db migrate:status
```

Ordinary package tests use in-process **PGlite** and do not require production `DATABASE_URL`. Production always uses Supabase Postgres.

## Production smoke checks

After deploy, confirm (authenticated Owner session required for protected routes):

| Check                       | Expected                                                     |
| --------------------------- | ------------------------------------------------------------ |
| `GET /api/v1/session`       | `200`; `role` = `owner`; `organizationId` = `axford`         |
| `GET /api/v1/tasks`         | `200`; cursor page shape                                     |
| `GET /c/{token}`            | Non-mutating capability page for a valid issued link         |
| Recipient capability `POST` | Mutations require `confirmation: "confirmed"` and `If-Match` |

Full Owner↔Recipient production E2E is classified **`A4_FULL_E2E_PASS`**. Retained operator E2E artifacts are intentional runbook data—not repository secrets.

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

**A7 status:** A7.0 decisions locked (D086–D094). **A7.1–A7.8 implemented and validated** in the repository; **parent A7 remains OPEN** pending production E2E. **A8.0 documentation Decision Lock** recorded (D095–D101); do not implement Follow-up Engine or Event Notification Engine until A8 implementation is authorized. Roadmap: **A7 → A8 → A9** (no early separate A9.0).

## Capability links in production

Capability URLs are derived from `NEXT_PUBLIC_APP_URL` and the issued path token. **A7 (D094):** `NEXT_PUBLIC_APP_URL` is sufficient; a custom domain does not block A7. Production capability links must use the configured production app URL. Do not log or commit raw tokens or hashes (D063). After re-forward/reassignment, prior active capabilities are revoked (D086).

## Safe database row-count checks

For operator sanity checks (read-only), use Supabase SQL editor or `psql` against production with least privilege:

- `recipients`, `tasks`, `task_assignments`, `task_capabilities`, `audit_events`, `task_suggestions`

Compare counts before/after E2E or deploy; do not paste row contents containing PII into tickets. A7 may add handoff/delivery-attempt tables (D092)—include them in checks when they exist.

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
