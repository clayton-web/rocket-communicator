# Engineering workflow

How future development proceeds on this repository. Subordinate to [PROJECT_CONSTITUTION.md](PROJECT_CONSTITUTION.md) and [AI_CONSTITUTION.md](AI_CONSTITUTION.md). Milestone sequence: [MILESTONES.md](MILESTONES.md). Review gate: [REVIEW_CHECKLIST.md](REVIEW_CHECKLIST.md).

---

## Milestone lifecycle

Every milestone follows this sequence. Do not skip stages.

```text
Architecture
    ↓
Planning
    ↓
Review
    ↓
Implementation
    ↓
Testing
    ↓
Documentation verification
    ↓
Commit
    ↓
Next milestone
```

| Stage                          | Required work                                                                                                                                                                                                                                                       |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Architecture**               | Confirm the milestone still matches [ARCHITECTURE.md](ARCHITECTURE.md), Architecture Principles (D079), and Approved [DECISIONS.md](DECISIONS.md). If behaviour must change, update docs **first** (Engineering Rule #1).                                           |
| **Planning**                   | Define scope, acceptance criteria, out-of-scope, risks, and files likely touched. Resolve blocking items in [OPEN_QUESTIONS.md](OPEN_QUESTIONS.md) or explicitly defer with documented impact.                                                                      |
| **Review**                     | Human review of the plan against [REVIEW_CHECKLIST.md](REVIEW_CHECKLIST.md) (scope through documentation drift).                                                                                                                                                    |
| **Implementation**             | Build only what the milestone allows.                                                                                                                                                                                                                               |
| **Testing**                    | Prove acceptance criteria; include contract, domain, and regression tests appropriate to the change. Default exit gate: full **`pnpm verify`** unless the authorization permits a narrower scope (see [Verification exit criterion](#verification-exit-criterion)). |
| **Documentation verification** | Docs match behaviour; glossary terms used correctly; no silent new behaviour.                                                                                                                                                                                       |
| **Commit**                     | One coherent checkpoint (message aligned with [MILESTONES.md](MILESTONES.md) recommendation unless a clearer message is needed).                                                                                                                                    |
| **Next milestone**             | Only after the current milestone’s acceptance criteria and doc verification pass.                                                                                                                                                                                   |

## Implementation rules

1. **One milestone at a time** — do not start the next milestone’s scope early.
2. **No unrelated refactoring** — drive-by cleanups belong in their own planned work.
3. **No silent architecture changes** — stack, boundaries, and data classes change only via documented decisions.
4. **No undocumented behaviour** — if users can observe it, docs must describe it.
5. **Documentation updated before completion** — milestone is incomplete until docs are verified.
6. **Stop when scope is exceeded** — park discoveries in OPEN_QUESTIONS or a future milestone; do not absorb them quietly.
7. **Feature filter (P2.0 / D139)** — prefer work that makes it easier for the Owner to capture, organize, assign, or follow through on real work during an ordinary day; otherwise it likely belongs later.
8. **Do not resume paused A8 operational enablement early** — each enablement step remains unauthorized until its own gates after Owner Acceptance Week and P2.2 (D140, D142).

## Environment Guard

Before changing application code for an implementation slice, confirm the development environment is healthy. Do this **before** coding, not after the first failure.

At minimum, verify:

1. **Node** and **pnpm** resolve correctly (`node -v`, `pnpm -v`).
2. **Java 17** is available through **`JAVA_HOME`** (not merely incidental `PATH` presence). CI pins Temurin 17; Android modules and Kotlin contract generation target JDK 17 — see [API_CONTRACT.md](API_CONTRACT.md) and [README.md](../README.md).
3. **Gradle** is running on that JDK 17 (`./apps/android/gradlew --version` reports Launcher/Daemon JVM 17).
4. Any **slice-specific** toolchain the authorized work actually needs is available (for example Docker when the slice is classified 🔴 below).
5. The **current HEAD** passes **`pnpm verify`**, unless the applicable authorization explicitly permits changing code before establishing a green baseline.

When a check fails because of **environment drift** (missing JDK, wrong `JAVA_HOME`, Docker Desktop stopped, stale machine PATH, and similar):

- classify the failure as an **environment issue**, not an application defect;
- **do not** modify application code, tests, package scripts, or CI to compensate;
- identify the **smallest machine-level correction**;
- distinguish environmental failures from genuine repository defects discovered by verification.

Do **not** repeatedly reinstall or reconfigure toolchains that are already healthy. A durable, correct configuration (for example a stable `JAVA_HOME` for JDK 17) should persist across sessions; one-off workarounds that evaporate recreate the same gap.

Local JDK setup and the optional Docker fallback for Kotlin generation: [API_CONTRACT.md](API_CONTRACT.md). Operations and production: [DEPLOYMENT.md](DEPLOYMENT.md).

## Docker requirement indicator

Every implementation plan and Cursor prompt must classify Docker explicitly as one of:

```text
🟢 Docker not required.

🟡 Docker recommended.

🔴 Docker required.
Start Docker Desktop before continuing.
```

Mark Docker **required** (🔴) only when the authorized work **actually depends on containers**, such as:

- local Supabase;
- local PostgreSQL;
- Docker-based integration tests;
- containerized development or verification tooling (including `pnpm contracts:generate:docker` when that path is the chosen Kotlin-generation method).

Do **not** mark Docker required merely for:

- documentation or planning;
- ordinary Next.js development;
- Supabase **cloud** access;
- Vercel deployment;
- Gmail logic;
- pure domain logic;
- Gradle or JDK use performed **directly on the host machine**.

This is contributor guidance, not application behaviour. Host JDK 17 remains the default for `pnpm contracts:generate` and Android Gradle; Docker is an optional fallback for Kotlin generation when host Java is unavailable ([API_CONTRACT.md](API_CONTRACT.md)).

## Concurrency suites need real PostgreSQL, and `pnpm verify` must not need Docker

Most persistence tests run on **PGlite**, which is fast and needs nothing installed. It is one in-process connection, so it cannot express two transactions contending for the same row: a concurrency guarantee "verified" on PGlite is reasoned, not tested. The A8.3b audit made that concrete — a lost update and a deadlock that a full green PGlite suite had not detected.

Suites that must contend therefore carry a `.pg.test.ts` suffix and **skip themselves** unless given a database URL, so `pnpm verify` stays Docker-free and deterministic. A skipped concurrency suite is not evidence; run it explicitly and report it separately from the PGlite results.

```bash
pnpm db:docker:up                                     # PostgreSQL 17, loopback 5433
AICAA_LOCAL_DATABASE_URL="postgresql://prisma:prisma@127.0.0.1:5433/prisma_test?schema=public" \
  pnpm db:migrate:local                               # apply migrations to the test database
AICAA_PG_CONCURRENCY_URL="postgresql://prisma:prisma@127.0.0.1:5433/prisma_test?schema=public" \
  pnpm --filter @aicaa/web exec vitest run owner-reminder-concurrency
```

**Engineering invariants (compress the incident narrative; keep the rule):**

- A **race test is evidence of behaviour, not a regression guard.** Timing-dependent suites can pass on broken code. When a fix is structural (decision moved inside a lock, unsafe export removed, forbidden import), add a deterministic source/architecture guard; keep the race test only to show the fixed design holds under contention.
- Suites whose subject is a **global** query must actively quiesce shared state and use per-run id prefixes. A global quiesce that retires every active schedule makes a later unscoped "every active schedule is armed" assertion vacuous — assert organization-scoped invariants where the suite does not quiesce.
- Serialize `.pg.test.ts` files when the concurrency URL is set (`vitest.config.ts`).
- **Always route Prisma through the `:local` helpers for local work.** `packages/db/.env` can hold a production URL; bare `prisma migrate deploy` would target it. `pnpm db:migrate:local` overrides `DATABASE_URL` and refuses non-loopback hosts. Production migrate remains a deliberate operator action ([DEPLOYMENT.md](DEPLOYMENT.md)).

## Verification exit criterion

**`pnpm verify` is the default required exit criterion for implementation slices unless the applicable authorization explicitly permits a narrower validation scope.**

Clarifications that bind report honesty:

- A **partial** verification result must be described as **partial**.
- **Blocked** steps must be listed **exactly** (command and failure class).
- An unrelated **environment** failure is **not** proof of application correctness.
- Implementation reports must **not** describe a slice as fully verified while required verification stages remain unexecuted.
- Genuine **repository defects** discovered by verification must be **reported** rather than silently bypassed; do not weaken or reorder `pnpm verify` to hide them without a separately authorized process change.

Browser e2e remains a **separate** job and is not inside `pnpm verify` (D119). Narrower scope is valid only when the authorizing task says so in writing.

## Implementation completion reports

Future implementation completion reports should include an **Environment Status** section with at least:

```markdown
## Environment Status

Node:
pnpm:
JAVA_HOME:
Java:
Gradle:
Docker required for this slice:
pnpm verify:
```

For each value, state whether it reflects a **healthy environment** or an **environment issue**. Confirm whether any **machine** configuration changed. Confirm whether any **repository** configuration changed. Minor formatting may match repository style; preserve all meanings above.

## Documentation-first change protocol

When product behaviour must change:

1. Update [PROJECT_CONSTITUTION.md](PROJECT_CONSTITUTION.md) / [AI_CONSTITUTION.md](AI_CONSTITUTION.md) if principles are affected.
2. Update [DECISIONS.md](DECISIONS.md) (new or revised ID and status).
3. Update [WORKFLOWS.md](WORKFLOWS.md), [DATA_RETENTION.md](DATA_RETENTION.md), [SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md), [API_CONTRACT.md](API_CONTRACT.md), and/or [ARCHITECTURE.md](ARCHITECTURE.md) as applicable.
4. Update [GLOSSARY.md](GLOSSARY.md) if terms change.
5. Then implement.
6. Re-run [REVIEW_CHECKLIST.md](REVIEW_CHECKLIST.md).

**Documentation wins over implementation** ([PROJECT_CONSTITUTION.md](PROJECT_CONSTITUTION.md) Engineering Rule #2).

## Ownership

| Concern                     | Primary document owner (logical)                                                                                               |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Mission and principles      | PROJECT_CONSTITUTION                                                                                                           |
| Architecture Principles     | PROJECT_CONSTITUTION (complete source); ARCHITECTURE (summary/examples)                                                        |
| Ownership / reuse carriers  | ARCHITECTURE § [Ownership and reuse map](ARCHITECTURE.md#ownership-and-reuse-map) — inspect before creating a parallel carrier |
| AI behaviour                | AI_CONSTITUTION                                                                                                                |
| What ships in v1            | MILESTONES                                                                                                                     |
| How it is built             | ARCHITECTURE (including the domain state model)                                                                                |
| Step-by-step behaviour      | WORKFLOWS                                                                                                                      |
| Deletion and Gmail boundary | DATA_RETENTION                                                                                                                 |
| AuthZ and privacy           | SECURITY_AND_PRIVACY                                                                                                           |
| Binding choices             | DECISIONS                                                                                                                      |
| Sequence of work            | MILESTONES                                                                                                                     |
| Contributor process         | ENGINEERING_WORKFLOW (Environment Guard, Docker, verify, reports)                                                              |
| Unresolved                  | OPEN_QUESTIONS                                                                                                                 |
| Terms                       | GLOSSARY                                                                                                                       |

## Definition of done (milestone)

- Acceptance criteria in MILESTONES met
- Environment Guard satisfied before coding (or authorization documented a deliberate exception)
- REVIEW_CHECKLIST answered for the change
- Default verification exit: full **`pnpm verify`** green, or a narrower scope the authorization explicitly allowed — with partial/blocked stages reported honestly
- Completion report includes the [Environment Status](#implementation-completion-reports) block
- No new OPEN_QUESTIONS left implicit in code comments only
- Docs cross-links still valid
- Commit created only when the user requests it (this workflow describes the intended process; commit policy remains human-gated)

## Explicitly out of band

- Committing or pushing without an explicit user request in the session that asks for it
- Connecting cloud resources “while we are here”
- Resolving OPEN_QUESTIONS by inventing answers in code
