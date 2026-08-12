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

## Decision-register verification (D165)

**D165** authorizes repository-local tooling that must prove green **before batch one** of the later [DECISIONS.md](DECISIONS.md) representation change. It runs through its **own command** and is deliberately **not** part of `pnpm verify`, CI, pre-commit hooks, or any deployment gate — D165 reserves those integrations for separate review.

```bash
pnpm docs:decisions:verify              # whole-register verification
pnpm docs:decisions:verify --verbose    # every human-review item, not just the first twenty per code
pnpm docs:decisions:test                # the harness's own tests
```

Implementation and layout: [scripts/docs-governance/README.md](../scripts/docs-governance/README.md). No new dependency: Node's standard library and `node:test` only.

### What the frozen baseline is

`scripts/docs-governance/baseline/decisions-baseline.json` is a normalized snapshot of **D001–D165** taken at the D165 checkpoint, before any representation change. Wording is **verbatim** — nothing is paraphrased, summarized, reconstructed, or dated. It is **evidence, not authority**: it originates no decision law and never overrides the register. Where the two disagree, [DECISIONS.md](DECISIONS.md) is rank 3 (D158) and the baseline is proof that something changed.

D165's verification precondition names baseline **D001–D164** completeness as a floor and requires live assigned-ID completeness thereafter. D165 is itself now live law, so the baseline covers **D001–D165**: a superset satisfies the floor, and freezing D165 protects the decision that authorized the rewrite.

Refreezing (`pnpm docs:decisions:baseline --force`) **destroys the evidence a failing check is comparing against**. It is a reviewed governance act — never a way to clear a red result. The command refuses to overwrite silently and reports what changed.

### Comparison tiers, and what normalization removes

Three tiers, applied identically to the baseline and the live register:

- **strict** — removes only what the table/heading choice forces: Unicode form (NFC), the table-only `\|` pipe escape, and whitespace runs. Emphasis, punctuation, links, code spans, and wording are all preserved, so a strict match is **byte-for-byte preservation of meaningful text**.
- **prose** — strict plus inline-syntax removal (emphasis markers, code-span backticks, link syntax reduced to visible text). Underscores are never touched, because `NEXT_PUBLIC_APP_URL` is content.
- **words** — words and numbers only. Used to locate a clause whose decoration necessarily changed, such as a bold lead-in becoming a heading title, and to prove no word was dropped or introduced.

Changing any rule requires bumping `NORMALIZER_VERSION`, which forces a reviewed refreeze instead of a silent reinterpretation.

### Ordering, and how the transition accommodation ends

D165's final representation is **one globally ascending `Dxxx` sequence regardless of status**. The register is not in that shape yet, so ordering is verified against the state the file is actually in, and the accommodation narrows by itself as the rewrite proceeds.

**Current legacy state.** Every record is still a wide-table row, split into an Active table and a Superseded table. That split is **grandfathered as representation evidence only** — it is the shape the baseline happens to have been frozen from, not a rule the register is entitled to keep. Global ascending order is arithmetically impossible in it, because the Superseded table sits at the end of the document while holding identifiers lower than the ones above it. While more than one of those legacy table sections still has rows, their **document-level relative order** must stay the wide-table representation order (Active table before Superseded table). That is a representation-layout invariant from the parser contract, not a status rule; moving the whole Superseded table above the remaining Active table is a hard failure. When conversion empties a legacy section, that section drops out of the constraint — an empty legacy heading is never required merely to keep the order — and when no legacy table row remains the layout contract is void.

**Mixed transition.** Between batches, heading records and leftover legacy tables legitimately coexist. This is a **controlled migration accommodation, not the final rule**, so it carries its own baseline-relative protections rather than a blanket exemption:

- every identifier still exists exactly once;
- remaining legacy table sections keep that document-level representation order while more than one still has rows;
- a record that is **still a legacy row** must still be in the structural section the baseline froze it in, so a row cannot be moved between the Active and Superseded tables under cover of a representation batch;
- each ordering group ascends — every leftover legacy section, and the converted heading records as one sequence;
- a single structural section ascends **across both representations**, so a converted record cannot be parked below a leftover row of a higher identifier beside it;
- records frozen in the same section keep their **frozen relative order** in the document wherever conversion has since placed them, so a converted block cannot be hoisted above records it was frozen behind while each local sequence still reads as ascending.

Placement is judged against the frozen baseline and the legacy representation layout, never against what Active or Superseded is taken to mean as status; the harness invents no status semantics. Identifiers assigned after the checkpoint have no frozen placement to compare against, so they are held to the ascending rules only.

**Final representation.** The moment **no legacy table row remains**, the accommodation is void automatically — there is no flag day and no switch to flip — and strict end-to-end ascending order across the whole document becomes mandatory.

### Hard failures

A hard failure is a mechanical, deterministic violation. It is never advisory, never suppressible, and always exits non-zero:

- a baseline identifier disappears; an assigned `Dxxx` appears twice; a gap exists between D001 and the **live** highest assigned identifier (never assumed to be D165); ordering breaks the rule for the state the register is in, an unconverted row changes structural section, or conversion reorders records relative to the frozen baseline (above); a record lacks a required field for its representation; a status falls outside **Approved / Proposed / Deferred / Open / Superseded / Superseded in part**; a status changes;
- **operative Decision text changes** — a word removed or added (paraphrase lands here), emphasis edited in place, or words rearranged inside a clause;
- a **boundary clause** disappears, or is demoted into inert history;
- text preserved as **inert history reappears as operative law**, inert history lacks the exact sentinel **“Inert history — not current law”**, or that sentinel appears unquoted inside an operative Decision field;
- a **Superseded in part** record stops identifying the amending decision, what was withdrawn, or what remains operative; a record's supersession assertion contradicts a status; a superseded record drops a counterpart it previously cited; a cited counterpart does not exist;
- a `Dxxx` citation anywhere in the tracked repository does not resolve, or a range citation has a missing endpoint, an interior gap, or endpoints that do not ascend.

### Human-review items

A review item is **work assigned to the reviewer of the batch in progress**, not a soft failure. It never changes the exit code. Items are reported here only when the underlying question is genuinely semantic — nothing is downgraded because it was awkward to implement:

- **operative-relocated** / **operative-decoration-changed** — every word and clause intact, only the field, clause order, or decoration changed. This is the relocation D165 authorizes; confirm the destination field is right.
- **supporting-text-changed** — Notes and other history changed. D165 authorizes classified reference-shift removals here, so every removal is surfaced for the per-removal destination and no-loss proof rather than blocked.
- **named-clause-citation** — citations such as `D081 idempotency intent`, `D099 ENE separation`, `D106 ceiling`, `D129 stop`. The identifier is proved to resolve; whether the _named clause_ still says what the citing document assumes cannot be decided mechanically and is not pretended otherwise.
- **superseded-without-successor** — a Superseded record that names no newer governing decision. Reciprocity that history did not assert is never fabricated; where repository history proves a pointer was asserted and later lost in reformatting, restoring it is lineage repair rather than invention — the restored D048–D054 pointers in D030 and D032 are that case.
- **supersession-one-sided** — X says it was superseded by Y while Y does not mention X. Normal in this register: D155 withdraws D113 clauses by describing the effect rather than claiming supersession.

### Using it during each rewrite batch

1. Run `pnpm docs:decisions:verify` **before** the batch and confirm it is green.
2. Convert about **20 IDs** — fewer for the dense ranges D095–D110 and D128–D136.
3. Run it again. **Zero hard failures is the gate.** Every review item is read, and every reference-shift removal is reported with its authoritative destination and a no-loss proof.
4. Semantic ambiguity, or any proposed rewording of operative law, **stops the batch** and returns to Owner review rather than being normalized away.
5. One reviewed commit per batch, with the whole-register result green after each.

The citation scan reads every **tracked** file — Markdown, TypeScript, Kotlin, YAML/OpenAPI, Prisma, SQL migrations, tests, and generated output — via `git ls-files`, which excludes `node_modules` and build output automatically. Known deliberate exclusions: the baseline artifact (it quotes the register verbatim, so its identifiers **are** the register, not citations), the harness's own tests and fixtures (synthetic register data carrying identifiers that intentionally do not resolve), lockfiles, and binary files.

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
