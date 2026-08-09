# Rocket Communicator

Private, mobile-first system that turns personal business communications into temporary, actionable work for one authenticated **Owner** and delegated **Recipients** who act through task-specific **capability links** — no Recipient application accounts.

Rocket is the Owner's **trusted external memory**: capture, organize, assign, and follow through on real work from a phone throughout an ordinary day. It remembers what must happen next. It does not replace Gmail, Messages, or Phone, and it is not a permanent communication archive.

This file is **orientation only** and defines no product law. Product law is [docs/PROJECT_CONSTITUTION.md](docs/PROJECT_CONSTITUTION.md).

The repository name, the `@aicaa/*` package namespace, the Android application id and `app_name`, and the OpenAPI `info.title` still carry the original working name. That is **repository provenance**, not product identity (D120, D153); renaming those artifacts is separately authorized implementation work.

## Documentation read order

1. [PROJECT_CONSTITUTION.md](docs/PROJECT_CONSTITUTION.md) — product law, and the authority model that says which document wins
2. [AI_CONSTITUTION.md](docs/AI_CONSTITUTION.md) — AI law
3. [DECISIONS.md](docs/DECISIONS.md) — binding discrete decisions
4. Domain contracts: [ARCHITECTURE.md](docs/ARCHITECTURE.md) · [API_CONTRACT.md](docs/API_CONTRACT.md) · [SECURITY_AND_PRIVACY.md](docs/SECURITY_AND_PRIVACY.md) · [WORKFLOWS.md](docs/WORKFLOWS.md) · [DATA_RETENTION.md](docs/DATA_RETENTION.md)
5. Below authority — describe, sequence, or record only: [MILESTONES.md](docs/MILESTONES.md) · [GLOSSARY.md](docs/GLOSSARY.md) · [ENGINEERING_WORKFLOW.md](docs/ENGINEERING_WORKFLOW.md) · [REVIEW_CHECKLIST.md](docs/REVIEW_CHECKLIST.md) · [DEPLOYMENT.md](docs/DEPLOYMENT.md) · [OPEN_QUESTIONS.md](docs/OPEN_QUESTIONS.md)

Current delivery status and what is or is not operational live in [MILESTONES.md](docs/MILESTONES.md); production state lives in [DEPLOYMENT.md](docs/DEPLOYMENT.md#current-production-state).

## Repository layout

```text
apps/android/           Kotlin + Jetpack Compose Owner app (minSdk 31); see apps/android/README.md
apps/web/               Next.js App Router (Owner auth + capability runtime)
packages/contracts/     OpenAPI 3.1 source + generated TS/Kotlin DTOs
packages/domain/        Pure TypeScript state machines and policies
packages/db/            Prisma schema, migrations, repositories (server-only)
packages/ai/            LLM extraction adapters
packages/ui/            Semantic design tokens only — one tokens.css, no components
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

**Environment Guard and verification:** before implementation work, confirm Node, pnpm, JDK 17 via `JAVA_HOME`, Gradle on that JDK, and a green `pnpm verify` baseline — see [ENGINEERING_WORKFLOW.md](docs/ENGINEERING_WORKFLOW.md). **`pnpm verify` is the default exit criterion** for implementation slices unless an authorization explicitly narrows scope.

**Docker for this repository's ordinary path:** 🟢 not required. Host JDK 17 covers contract generation and Android Gradle. Mark Docker 🟡/🔴 only when a slice truly needs containers.

**Local Postgres via Docker** (Prisma migrate verification and the opt-in `*.pg.test.ts` concurrency suites): `pnpm db:docker:up` then `pnpm db:migrate:local`. Loopback-only on port **5433**; details in [packages/db/README.md](packages/db/README.md). Ordinary Vitest uses PGlite and does not need Docker.

Owner auth local setup: copy `apps/web/.env.example` → `apps/web/.env.local`, configure the Supabase Google OAuth redirect `{NEXT_PUBLIC_APP_URL}/auth/callback`, then:

```bash
pnpm --filter @aicaa/web dev
```

Capability and database environment placeholders live in `apps/web/.env.example` and `packages/db/.env.example` (no secrets in the repository).

Contract generation: `pnpm contracts:generate` (needs local JDK 17 for Kotlin), or the optional `pnpm contracts:generate:docker`. Details: [docs/API_CONTRACT.md](docs/API_CONTRACT.md).

## Local repository

Branch `main`. No remote required for local work.
