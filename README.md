# AI Communication Action Assistant

Private, Android-first assistant that turns personal business communications into temporary, actionable work for one authenticated **Owner** and delegated **Recipients** who act through task-specific **capability links**—no Recipient application accounts.

**Governing document:** [docs/PROJECT_CONSTITUTION.md](docs/PROJECT_CONSTITUTION.md)

## Purpose

Answer: what needs action, what matters, who should handle it, when to follow up, whether it completed, how it completed, and whether completion created further work.

Not a permanent communication archive.

## Current status

| Area                             | Status                                                                                                                            |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| A3 Owner authentication          | Complete; production-verified (`GET /api/v1/session` → 200, `organizationId` = `axford`)                                          |
| A4 task + capability             | Complete — **`A4_FULL_E2E_PASS`**: migration applied; full production Owner↔Recipient E2E passed                                  |
| A5 Gmail connection and polling  | **Complete and Production-operational** (OAuth, encrypted tokens, History seed + incremental poll, locks, dedupe, audit, cron 5m) |
| A6 Application Suggestion Engine | **Complete and Production-operational** (tag `v0.6.0-a6-complete`)                                                                |
| Production baseline              | Healthy; A4, A5, and A6 operational                                                                                               |
| Next                             | **A7** — A7.1 OpenAPI contracted; next handlers/persistence (A7.2+) ([MILESTONES](docs/MILESTONES.md))                            |
| Deferred (non-blocking)          | Gmail settings UI; History recovery                                                                                               |
| Later                            | Reminders (A8), Android task UI (A9), notifications, voice, workers                                                               |

Operations: [DEPLOYMENT](docs/DEPLOYMENT.md). Terms: [GLOSSARY](docs/GLOSSARY.md). Plan: [MILESTONES](docs/MILESTONES.md).

## Repository layout

```text
apps/android/           Kotlin + Jetpack Compose shell (minSdk 31)
apps/web/               Next.js App Router (Owner auth + capability runtime)
packages/contracts/     OpenAPI 3.1 source + generated TS/Kotlin DTOs
packages/domain/        Pure TypeScript state machines and policies
packages/db/            Prisma schema, migrations, repositories (server-only)
packages/ai/            LLM extraction adapters (introduced in A6; D085)
packages/eslint-config/
packages/typescript-config/
docs/
```

Package responsibilities: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## How to run

```bash
pnpm install
pnpm verify
```

Owner auth local setup: copy `apps/web/.env.example` → `apps/web/.env.local`, configure Supabase Google OAuth redirect `{NEXT_PUBLIC_APP_URL}/auth/callback`, then:

```bash
pnpm --filter @aicaa/web dev
```

Capability / DB env placeholders: `apps/web/.env.example`, `packages/db/.env.example` (no secrets in repo).

Contract generation: `pnpm contracts:generate` (needs local JDK 17 for Kotlin). If Java is not installed, use optional `pnpm contracts:generate:docker` (Docker Desktop + pinned Temurin 17; host Node/pnpm still run the rest). Docker is not required for tests or day-to-day app work — details in [docs/API_CONTRACT.md](docs/API_CONTRACT.md).

## Documentation map

Authority: [docs/DOCUMENTATION_INDEX.md](docs/DOCUMENTATION_INDEX.md)

| Need                                   | Document                                                                                           |
| -------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Definitions                            | [GLOSSARY](docs/GLOSSARY.md)                                                                       |
| Binding choices                        | [DECISIONS](docs/DECISIONS.md)                                                                     |
| System shape / Architecture Principles | [ARCHITECTURE](docs/ARCHITECTURE.md)                                                               |
| AuthZ / capability security            | [SECURITY_AND_PRIVACY](docs/SECURITY_AND_PRIVACY.md)                                               |
| Task states                            | [STATE_MACHINE](docs/STATE_MACHINE.md)                                                             |
| HTTP surface                           | [API_CONTRACT](docs/API_CONTRACT.md)                                                               |
| Flows                                  | [WORKFLOWS](docs/WORKFLOWS.md)                                                                     |
| Scope / MVP                            | [PRODUCT_SCOPE](docs/PRODUCT_SCOPE.md)                                                             |
| Retention                              | [DATA_RETENTION](docs/DATA_RETENTION.md)                                                           |
| AI behaviour                           | [AI_CONSTITUTION](docs/AI_CONSTITUTION.md)                                                         |
| Plan                                   | [MILESTONES](docs/MILESTONES.md)                                                                   |
| Engineering process / review           | [ENGINEERING_WORKFLOW](docs/ENGINEERING_WORKFLOW.md), [REVIEW_CHECKLIST](docs/REVIEW_CHECKLIST.md) |
| Deployment / operations                | [DEPLOYMENT](docs/DEPLOYMENT.md)                                                                   |
| Open unknowns                          | [OPEN_QUESTIONS](docs/OPEN_QUESTIONS.md)                                                           |

## Local repository

Branch `main`. No remote required for local work.
