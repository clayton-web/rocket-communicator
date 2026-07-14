# AI Communication Action Assistant

Private, Android-first assistant that turns personal business communications into temporary, actionable work for one authenticated **Owner** and delegated **Recipients** who act through task-specific **capability links**—no Recipient application accounts.

**Governing document:** [docs/PROJECT_CONSTITUTION.md](docs/PROJECT_CONSTITUTION.md)

## Purpose

Answer: what needs action, what matters, who should handle it, when to follow up, whether it completed, how it completed, and whether completion created further work.

Not a permanent communication archive.

## Current status

| Area                    | Status                                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------------ |
| A3 Owner authentication | Complete (`apps/web` Google Workspace + Supabase)                                                |
| A4 task + capability    | Complete (automated): Owner/Recipient task + capability HTTP, `/c/[token]` UI                    |
| Live DB / E2E           | Operator follow-up: migrate Supabase + run live Owner↔Recipient checklist (not yet claimed here) |
| Later                   | Gmail, AI, Android auth, notifications, voice, workers                                           |

Terms: [docs/GLOSSARY.md](docs/GLOSSARY.md). Plan: [docs/MILESTONES.md](docs/MILESTONES.md).

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

| Need                        | Document                                             |
| --------------------------- | ---------------------------------------------------- |
| Definitions                 | [GLOSSARY](docs/GLOSSARY.md)                         |
| Binding choices             | [DECISIONS](docs/DECISIONS.md)                       |
| System shape                | [ARCHITECTURE](docs/ARCHITECTURE.md)                 |
| AuthZ / capability security | [SECURITY_AND_PRIVACY](docs/SECURITY_AND_PRIVACY.md) |
| Task states                 | [STATE_MACHINE](docs/STATE_MACHINE.md)               |
| HTTP surface                | [API_CONTRACT](docs/API_CONTRACT.md)                 |
| Flows                       | [WORKFLOWS](docs/WORKFLOWS.md)                       |
| Scope / MVP                 | [PRODUCT_SCOPE](docs/PRODUCT_SCOPE.md)               |
| Plan                        | [MILESTONES](docs/MILESTONES.md)                     |
| Open unknowns               | [OPEN_QUESTIONS](docs/OPEN_QUESTIONS.md)             |

## Local repository

Branch `main`. No remote required for local work.
