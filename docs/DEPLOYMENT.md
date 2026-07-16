# Deployment and operations

Governed by [PROJECT_CONSTITUTION.md](PROJECT_CONSTITUTION.md). Architecture: [ARCHITECTURE.md](ARCHITECTURE.md). Package setup: [../packages/db/README.md](../packages/db/README.md).

This runbook documents **names and procedures only**. Never commit connection strings, passwords, capability tokens, token hashes, or other secrets.

## Platform assumptions

| Component    | Role                                                                                                                                  |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| **Vercel**   | Hosts `apps/web` (Next.js App Router). Monorepo root is the Vercel project root; `outputFileTracingRoot` includes workspace packages. |
| **Supabase** | PostgreSQL system of record and Owner Auth (Google Workspace).                                                                        |
| **Prisma**   | Server-only data access via `@aicaa/db`; invoked through the web runtime bridge.                                                      |

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
pnpm build:db          # includes prisma generate
pnpm build:web         # next build for apps/web
```

`pnpm build` runs domain → db → web in that order. Vercel production builds should succeed only when `@aicaa/db` and `@aicaa/domain` are built before the Next.js bundle so Prisma engines and traced runtime files are present.

Repository verification also includes:

- `node apps/web/scripts/verify-db-runtime-resolution.mjs`
- `node apps/web/scripts/verify-prisma-client-construction.mjs`

These are durable safeguards for Linux/Vercel Prisma packaging—not temporary incident probes.

## Database migrations

A4 foundation migration: `packages/db/prisma/migrations/20260713190000_a4_persistence_foundation/` (**applied in production** as part of A4).

A5 Gmail persistence migration: `packages/db/prisma/migrations/20260716140000_a5_gmail_persistence/` (**forward-only; not applied to production in A5.1–A5.2** — apply only after Owner approval).

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

## Capability links in production

Capability URLs are derived from `NEXT_PUBLIC_APP_URL` and the issued path token. Production capability links must use the configured production app URL. Do not log or commit raw tokens or hashes (D063).

## Safe database row-count checks

For operator sanity checks (read-only), use Supabase SQL editor or `psql` against production with least privilege:

- `recipients`, `tasks`, `task_assignments`, `task_capabilities`, `audit_events`, `task_suggestions`

Compare counts before/after E2E or deploy; do not paste row contents containing PII into tickets.

## Rollback principles

1. **Application:** Redeploy the previous known-good Vercel deployment via the Vercel dashboard.
2. **Schema:** Prisma migrations are forward-only in production; roll back application code before attempting destructive schema changes. Never drop production tables without an explicit operator decision.
3. **Secrets:** Rotate `CAPABILITY_TOKEN_PEPPER` only with a documented invalidation plan (all outstanding links become unusable).
4. **Capabilities:** Re-issued links supersede prior grants per assignment policy (OPEN #21 resolved in A7).

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
