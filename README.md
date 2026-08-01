# AI Communication Action Assistant

Private, Android-first assistant that turns personal business communications into temporary, actionable work for one authenticated **Owner** and delegated **Recipients** who act through task-specific **capability links**—no Recipient application accounts.

The product exists to ensure communications are followed through until conclusion. It is not a conventional task manager, calendar manager, or general-purpose reminder application. Under one narrow exception (D102), an explicitly selected Task due date may drive deterministic follow-through on delegated work.

**Governing document:** [docs/PROJECT_CONSTITUTION.md](docs/PROJECT_CONSTITUTION.md)

## Purpose

Answer: what needs action, what matters, who should handle it, when to follow up, whether it completed, how it completed, and whether completion created further work.

Not a permanent communication archive.

## Current status

| Area                             | Status                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A3 Owner authentication          | Complete; production-verified (`GET /api/v1/session` → 200, `organizationId` = `axford`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| A4 task + capability             | Complete — **`A4_FULL_E2E_PASS`**: migration applied; full production Owner↔Recipient E2E passed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| A5 Gmail connection and polling  | **Complete and Production-operational** (OAuth, encrypted tokens, History seed + incremental poll, locks, dedupe, audit, cron 5m)                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| A6 Application Suggestion Engine | **Complete and Production-operational** (tag `v0.6.0-a6-complete`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| A7 Gmail forward / handoff       | **Complete and Production-operational** (tag `v0.7.0-a7-complete`) — production E2E passed: both delivery paths, Recipient capability completion, Owner notes visibility                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| A8.0 documentation lock          | **Complete (docs-only)** — D095–D101; **partly superseded by A8.1**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| A8.1 documentation lock          | **Complete (docs-only)** — due-date-driven reminder model (D102–D110); constitution amended under a narrow exception                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| A8.2 reminder domain logic       | **Complete** (D127) — local-calendar, timezone, and pure scheduling functions in `packages/domain/src/reminders/`; called by the Owner reminder APIs, the Task-lifecycle wiring, and — since A8.4a — the occurrence-processing service                                                                                                                                                                                                                                                                                                                                                                    |
| A8.3a reminder persistence       | **Complete and audited** (D128) — schedule and delivery-attempt tables, `tasks.due_local_date`, database-enforced occurrence idempotency; **migration not applied in Production**; no contract, route, worker, scheduler, cron, flag, email path, or UI                                                                                                                                                                                                                                                                                                                                                   |
| P1.0 documentation lock          | **Complete (docs-only)** — Owner **web** experience foundation scoped (D111–D120)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| P1.1 observability               | **Implemented** — unified `requestId`, structured diagnostics, timing, capability-path scrubbing; baseline [P1_1_BASELINE](docs/P1_1_BASELINE.md); production validation is P1.5                                                                                                                                                                                                                                                                                                                                                                                                                          |
| P1.2 browser harness             | **Implemented, pending review** — Playwright coverage of the current Owner and Recipient journeys on two Chromium viewports, local environment only, not in CI ([P1_2_BROWSER_HARNESS](docs/P1_2_BROWSER_HARNESS.md))                                                                                                                                                                                                                                                                                                                                                                                     |
| P1.3 request/render reliability  | **Implemented, pending review** — auth deduplication, route loading states, bounded list queries, client timeouts; local evidence only ([P1_3_EVIDENCE](docs/P1_3_EVIDENCE.md))                                                                                                                                                                                                                                                                                                                                                                                                                           |
| P1.4 Owner shell / presentation  | **Complete and production-validated** — Owner shell, `/attention`, Vancouver display, tokens-only `packages/ui` ([P1_4_EVIDENCE](docs/P1_4_EVIDENCE.md))                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Production baseline              | Healthy; A4, A5, A6, and A7 operational; P1.4 production commit `a38c857`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| A8.3b Owner reminder APIs        | **Complete, audited, remediated** — `GET`/`PUT`/`DELETE /api/v1/tasks/{taskId}/reminder` with Task-status eligibility, a reminder-resource ETag, and PostgreSQL-proven write concurrency; **migrations not applied in Production**; no worker, scheduler, cron, flag, email path, or UI                                                                                                                                                                                                                                                                                                                   |
| A8 lifecycle wiring              | **Complete, audited, remediated** — Waiting suspends reminders and resume arms only the next future occurrence, completion and dismissal stop them, all in the Task's own transaction; an advance occurrence a Waiting period spanned is permanently skipped; reopening does not reactivate anything                                                                                                                                                                                                                                                                                                      |
| A8.4a worker-safety foundation   | **Complete, audited, remediated, re-audited, APPROVED** — durable occurrence claims with expiry and fencing, expired-claim recovery, deliveries that survive lifecycle races, a coherent Owner `GET`, a global bounded due scan, and `POST /api/v1/internal/reminders/process` **built, disabled, and never deployed** — no cron job, no production flag, no applied migration, no UI                                                                                                                                                                                                                     |
| A8.4b.1 real Gmail overdue send  | **Implemented — awaiting architecture review** — real Gmail transport for **overdue** reminders: authorization resolved **once per invocation before any claim** (failure ⇒ zero claims, zero writes, zero provider calls), the D130 capability gate skipping truthfully when the original assignment email's capability is unusable, a link-free reminder email, and four-valued outcome classification in which ambiguity is never reported as a send. **Delivery disabled everywhere**; with the flag unset no Gmail transport is constructed at all. No cron job, no applied migration, no deployment |
| Next                             | **A8.4b.2** — D129 runtime enforcement (three consecutive terminal ambiguous outcomes in one generation stop the schedule, derived from history), then **A8.4b.3** advance reminder delivery ([MILESTONES](docs/MILESTONES.md))                                                                                                                                                                                                                                                                                                                                                                           |
| Deferred (non-blocking)          | A7 deferred backlog (reassignment / re-forward, proposed-Recipient hints, reconciliation worker, Recipient management UI); Gmail settings UI; History recovery                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Later                            | Follow-up Engine / Event Notification Engine (A8), Android Owner UI (A9), notifications, voice, workers; Owner-created additional reminders (deferred slice, D110)                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Open product decision            | **D120** — product name. The official name is “AI Communication Action Assistant”; “Rocket Communicator” has no repository authority. P1 keeps the current name ([OPEN_QUESTIONS](docs/OPEN_QUESTIONS.md) #22)                                                                                                                                                                                                                                                                                                                                                                                            |

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

`packages/ui/` is a **semantic-token layer only** (D116, D124), created in P1.4. It is a single `tokens.css` with no build step, no dependency, and no `.ts`/`.tsx` file — it is not a component library, and all React components stay in `apps/web`.

Package responsibilities: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## How to run

```bash
pnpm install
pnpm verify
```

**Environment Guard and verification:** before implementation work, confirm Node, pnpm, JDK 17 via `JAVA_HOME`, Gradle on that JDK, and a green `pnpm verify` baseline — see [ENGINEERING_WORKFLOW.md](docs/ENGINEERING_WORKFLOW.md). **`pnpm verify` is the default exit criterion** for implementation slices unless an authorization explicitly narrows scope.

**Docker for this repository’s ordinary path:** 🟢 Docker not required. Host JDK 17 covers contract generation and Android Gradle. Mark Docker 🟡/🔴 only when a slice truly needs containers (local Supabase/Postgres, Docker-based tests, or `contracts:generate:docker`).

**Local Postgres via Docker** (Prisma migrate verification, and the opt-in `*.pg.test.ts` concurrency suites that PGlite's single connection cannot express): `pnpm db:docker:up` then `pnpm db:migrate:local`. Loopback-only on port **5433**; details in [packages/db/README.md](packages/db/README.md). Ordinary Vitest still uses PGlite and does not need Docker.

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
