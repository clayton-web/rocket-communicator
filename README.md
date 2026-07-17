# AI Communication Action Assistant

Private, Android-first assistant that turns personal business communications into temporary, actionable work for one authenticated **Owner** and delegated **Recipients** who act through task-specific **capability links**—no Recipient application accounts.

**Governing document:** [docs/PROJECT_CONSTITUTION.md](docs/PROJECT_CONSTITUTION.md)

## Purpose

Answer: what needs action, what matters, who should handle it, when to follow up, whether it completed, how it completed, and whether completion created further work.

Not a permanent communication archive.

## Current status

| Area                            | Status                                                                                                                         |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| A3 Owner authentication         | Complete; production-verified (`GET /api/v1/session` → 200, `organizationId` = `axford`)                                       |
| A4 task + capability            | Complete — **`A4_FULL_E2E_PASS`**: migration applied; full production Owner↔Recipient E2E passed                               |
| Production baseline             | Healthy; Prisma/Supabase connectivity confirmed; capability links via production app URL                                       |
| A5 Gmail connection and polling | Implemented in repository through A5.5; production migration, live Gmail credentials, and scheduler secrets are not configured |
| Next                            | Remaining A5 production enablement / settings UI, then A6 AI suggestions ([MILESTONES](docs/MILESTONES.md))                    |
| Later                           | Gmail forward (A7), Android task UI, notifications, voice, workers                                                             |

Operations: [DEPLOYMENT](docs/DEPLOYMENT.md). Terms: [GLOSSARY](docs/GLOSSARY.md). Plan: [MILESTONES](docs/MILESTONES.md).

## Repository layout

```text
apps/android/           Kotlin + Jetpack Compose shell (minSdk 31)
apps/web/               Next.js App Router (Owner auth + capability runtime)
packages/contracts/     OpenAPI 3.1 source + generated TS/Kotlin DTOs
packages/domain/        Pure TypeScript state machines and policies
packages/db/            Prisma schema, migrations, repositories (server-only)
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
