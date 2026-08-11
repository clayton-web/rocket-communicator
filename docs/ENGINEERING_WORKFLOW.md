# Engineering workflow

Procedure before and during implementation work, plus repository-operation safety. Authority for who owns what: [PROJECT_CONSTITUTION.md § Authority model](PROJECT_CONSTITUTION.md#authority-model-d158). Sequencing: [MILESTONES.md](MILESTONES.md). Completion gate: [REVIEW_CHECKLIST.md](REVIEW_CHECKLIST.md).

---

## Environment Guard

Run this **before** changing application code for a slice, not after the first failure.

1. **Node** and **pnpm** resolve (`node -v`, `pnpm -v`).
2. **Java 17** resolves through **`JAVA_HOME`** — not merely incidental `PATH` presence. CI pins Temurin 17; Android modules and Kotlin contract generation target JDK 17 ([API_CONTRACT.md](API_CONTRACT.md)).
3. **Gradle** runs on that JDK (`./apps/android/gradlew --version` reports Launcher and Daemon JVM 17).
4. Any **slice-specific** tool the authorized work actually needs (Docker when the slice is 🔴 below).
5. **Current HEAD passes `pnpm verify`**, unless the authorization explicitly permits changing code before a green baseline exists.

A failure caused by **environment drift** — missing JDK, wrong `JAVA_HOME`, Docker Desktop stopped, stale machine PATH — is an **environment issue, not an application defect**:

- **do not** modify application code, tests, package scripts, or CI to compensate for the local environment;
- apply the **smallest machine-level correction** and make it durable — a stable `JAVA_HOME` for JDK 17 should survive across sessions, because a workaround that evaporates recreates the same gap — but do **not** reinstall or reconfigure toolchains that are already healthy;
- keep environment failures distinct from genuine repository defects that verification found.

Local JDK setup and the optional Docker fallback for Kotlin generation: [API_CONTRACT.md](API_CONTRACT.md).

## Docker requirement indicator

Every implementation plan and Cursor prompt must classify Docker explicitly:

```text
🟢 Docker not required.
🟡 Docker recommended.
🔴 Docker required. Start Docker Desktop before continuing.
```

Mark 🔴 only when the authorized work **actually depends on containers**: local Supabase, local PostgreSQL, Docker-based integration tests, or containerized development and verification tooling — including `pnpm contracts:generate:docker` when that is the chosen Kotlin-generation path.

Do **not** mark 🔴 for documentation or planning, ordinary Next.js development, Supabase **cloud** access, Vercel deployment, Gmail logic, pure domain logic, or Gradle and JDK work performed **directly on the host**. Host JDK 17 remains the default for `pnpm contracts:generate` and Android Gradle. This is contributor guidance, not application behaviour.

## Concurrency claims need real PostgreSQL

PGlite is one in-process connection, so a concurrency or race guarantee "verified" there is reasoned, not tested. Suites that must contend carry a `.pg.test.ts` suffix and **skip themselves** unless given a database URL, which keeps `pnpm verify` Docker-free and deterministic. **A skipped concurrency suite is not evidence** — run it explicitly against real PostgreSQL and report it separately from the PGlite results.

```bash
pnpm db:docker:up                                     # PostgreSQL 17, loopback 5433
AICAA_LOCAL_DATABASE_URL="postgresql://prisma:prisma@127.0.0.1:5433/prisma_test?schema=public" \
  pnpm db:migrate:local                               # apply migrations to the test database
AICAA_PG_CONCURRENCY_URL="postgresql://prisma:prisma@127.0.0.1:5433/prisma_test?schema=public" \
  pnpm --filter @aicaa/web exec vitest run owner-reminder-concurrency
```

- Serialize `.pg.test.ts` files when the concurrency URL is set (`vitest.config.ts`).
- A race test shows a design holds under contention; it is **not** a regression guard, because a timing-dependent suite can pass on broken code. When the fix is structural — a decision moved inside a lock, an unsafe export removed, a forbidden import — also add a deterministic source or architecture guard.
- A suite whose subject is a **global** query must actively quiesce shared state and use per-run id prefixes; a global quiesce that retires every active schedule makes a later unscoped "every active schedule is armed" assertion vacuous. Where a suite does not quiesce, assert organization-scoped invariants.
- Route local Prisma work through the **`:local` helpers**, which force a loopback host so a leftover production URL in `packages/db/.env` cannot be used by accident ([packages/db/README.md](../packages/db/README.md)). Production migrate stays a deliberate operator action ([DEPLOYMENT.md](DEPLOYMENT.md)).

## Verification and honest reporting

**`pnpm verify` is the default exit criterion** for an implementation slice unless the authorization explicitly permits a narrower scope in writing. Browser e2e is a separate job and is not inside `pnpm verify` (D119).

A completion report must let a reader distinguish, without interpretation:

- tests actually run, and their results;
- tests **not** run, and why (skipped, blocked, out of scope);
- **pre-existing** failures;
- **environment** failures;
- **regressions this work introduced**.

Partial verification must be described as **partial**, listing every blocked step exactly (command and failure class); a slice with unexecuted required stages is never reported as fully verified. An environment failure is not proof of application correctness. Genuine repository defects found by verification must be reported, never hidden by weakening or reordering `pnpm verify`.

### Environment Status

Every completion report includes this block:

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

For each value, state whether it reflects a **healthy environment** or an **environment issue**, and confirm whether any **machine** configuration and whether any **repository** configuration changed. Minor formatting may match repository style; preserve all of these meanings.

## Design and documentation sequencing

Before designing a new carrier, domain, or subsystem, inspect [ARCHITECTURE.md § Ownership and reuse map](ARCHITECTURE.md#ownership-and-reuse-map) and evolve the existing carrier where applicable.

Documentation changes before behaviour, and documentation wins over implementation ([PROJECT_CONSTITUTION.md](PROJECT_CONSTITUTION.md) Engineering Rules #1 and #2). Operational order when product behaviour must change:

1. [PROJECT_CONSTITUTION.md](PROJECT_CONSTITUTION.md) / [AI_CONSTITUTION.md](AI_CONSTITUTION.md), if a principle is affected.
2. [DECISIONS.md](DECISIONS.md) — new or revised ID and status.
3. The affected domain documents: [WORKFLOWS.md](WORKFLOWS.md), [DATA_RETENTION.md](DATA_RETENTION.md), [SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md), [API_CONTRACT.md](API_CONTRACT.md), [ARCHITECTURE.md](ARCHITECTURE.md).
4. [GLOSSARY.md](GLOSSARY.md), if terms change.
5. Then implement.
6. Then answer [REVIEW_CHECKLIST.md](REVIEW_CHECKLIST.md).

## Out of band

- **Committing and pushing happen only when the user explicitly asks for them in the session.** A push to `main` is a Production action: Vercel builds and promotes it automatically with no inspection gate, so a push is never a deployment mechanism ([DEPLOYMENT.md](DEPLOYMENT.md)). When a commit is requested, make one coherent checkpoint whose message names the authorized milestone from [MILESTONES.md](MILESTONES.md).
- **A8 operational enablement remains separately gated and unauthorized**, step by step. Owner Acceptance Week is deferred (D159) and is not the active next gate; [MILESTONES.md § Forward sequence](MILESTONES.md#forward-sequence) owns current sequencing.
- Work outside the authorized scope — including drive-by refactoring — **stops** and is parked in [OPEN_QUESTIONS.md](OPEN_QUESTIONS.md) or a future milestone rather than absorbed quietly.
- Do not connect cloud resources "while we are here".
- Do not resolve OPEN_QUESTIONS by inventing answers in code.
