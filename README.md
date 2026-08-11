# Rocket Communicator

Private repository for **Rocket Communicator** — a mobile-first trusted external memory and follow-through system. Product identity: [docs/PROJECT_CONSTITUTION.md § What Rocket is](docs/PROJECT_CONSTITUTION.md#what-rocket-is). This file is orientation only and defines no product law.

Historical `@aicaa/*` package names, Android application id / `app_name`, and OpenAPI `info.title` are **repository provenance**, not product identity (D120, D153).

## Documentation

- Product law: [docs/PROJECT_CONSTITUTION.md](docs/PROJECT_CONSTITUTION.md)
- AI law: [docs/AI_CONSTITUTION.md](docs/AI_CONSTITUTION.md)
- Architecture (including package responsibilities): [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Domain behaviour as needed: [docs/WORKFLOWS.md](docs/WORKFLOWS.md)
- Complete authority ranking: [PROJECT_CONSTITUTION.md § Authority model](docs/PROJECT_CONSTITUTION.md#authority-model-d158)

Contributor process: [docs/ENGINEERING_WORKFLOW.md](docs/ENGINEERING_WORKFLOW.md). Production operations: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Repository layout

```text
apps/android/                 Owner Android app
apps/web/                     Next.js Owner + capability runtime
packages/contracts/           OpenAPI source + generated clients
packages/domain/              Pure TypeScript domain logic
packages/db/                  Prisma schema, migrations, repositories
packages/ai/                  Shared interpretation adapters
packages/ui/                  Semantic design tokens only
packages/eslint-config/       Shared ESLint config
packages/typescript-config/   Shared TypeScript config
docs/                         Authoritative project documentation
```

Details: [docs/ARCHITECTURE.md § Package layout](docs/ARCHITECTURE.md#package-layout). Android notes: [apps/android/README.md](apps/android/README.md).

## Local setup

Satisfy the Environment Guard in [docs/ENGINEERING_WORKFLOW.md](docs/ENGINEERING_WORKFLOW.md) **before** application-code changes or repository verification (Node, pnpm, JDK 17 via `JAVA_HOME`, Gradle on that JDK, green baseline). Ordinary local work does **not** require Docker; when a slice needs containers, classify there.

```bash
pnpm install
pnpm verify
```

Environment placeholders (no secrets in the repository):

- `apps/web/.env.example` → `apps/web/.env.local` for Owner auth and app config (Supabase Google OAuth redirect `{NEXT_PUBLIC_APP_URL}/auth/callback`)
- `packages/db/.env.example` for database placeholders

Local Postgres for migrate rehearsal and opt-in `*.pg.test.ts` concurrency: `pnpm db:docker:up` then `pnpm db:migrate:local` — [packages/db/README.md](packages/db/README.md). Ordinary Vitest uses PGlite.

Contracts: `pnpm contracts:generate` (host JDK 17) or optional `pnpm contracts:generate:docker` — [docs/API_CONTRACT.md](docs/API_CONTRACT.md).

Web development server:

```bash
pnpm --filter @aicaa/web dev
```

## Remote and deployment hazard

Local work does not require pushing. Remote `origin` exists. **Pushing `main` is not a harmless repository operation** — the ordinary path builds and promotes to Production automatically with no inspection gate ([docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)). Commit and push remain out of band unless explicitly requested ([docs/ENGINEERING_WORKFLOW.md](docs/ENGINEERING_WORKFLOW.md)).
