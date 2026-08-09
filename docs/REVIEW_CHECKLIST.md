# Review checklist

Use this checklist before completing any implementation milestone or merging behaviour-changing work. Answer every section. "N/A" is allowed only with a one-line reason.

**This checklist enforces higher-authority rules; it does not create product law.** Where a gate below disagrees with [PROJECT_CONSTITUTION.md](PROJECT_CONSTITUTION.md), [AI_CONSTITUTION.md](AI_CONSTITUTION.md), [DECISIONS.md](DECISIONS.md), or a domain contract, those control and the gate is wrong. Process: [ENGINEERING_WORKFLOW.md](ENGINEERING_WORKFLOW.md).

**This is a current gate, not an evidence archive.** Completed work is not recorded here. Per-slice execution evidence belongs in the completion report for that slice.

---

## Scope

- [ ] Change maps to exactly one authorized milestone in [MILESTONES.md](MILESTONES.md)
- [ ] Acceptance criteria for that milestone are listed and met
- [ ] Explicit out-of-scope items were not implemented
- [ ] No unrelated refactoring or drive-by feature work
- [ ] New discoveries parked in [OPEN_QUESTIONS.md](OPEN_QUESTIONS.md) or a future milestone
- [ ] Nothing outside the authorized scope was built, whether or not any document lists it as excluded — **an absent authorization is the gate, not an enumeration**
- [ ] Plan or prompt classified Docker as 🟢 not required, 🟡 recommended, or 🔴 required

## Environment and verification

Governing process: [ENGINEERING_WORKFLOW.md](ENGINEERING_WORKFLOW.md).

- [ ] **Environment Guard** ran before application-code changes (Node, pnpm, `JAVA_HOME` → Java 17, Gradle on JDK 17, slice tools, green `pnpm verify` baseline unless waived)
- [ ] Environment failures were classified as environment issues — application code was not modified to compensate
- [ ] Healthy toolchains were not reinstalled or reconfigured
- [ ] **`pnpm verify` is green** as the default exit criterion, or the authorization explicitly permitted a narrower scope
- [ ] If verification was partial: the report says **partial**, lists every blocked step exactly, and does not claim full verification
- [ ] An environment failure is not treated as proof of application correctness
- [ ] Genuine repository defects from verification were reported, not silently bypassed
- [ ] Completion report includes the **Environment Status** block

## Architecture

- [ ] Matches [ARCHITECTURE.md](ARCHITECTURE.md) and Approved [DECISIONS.md](DECISIONS.md)
- [ ] Honours the Architecture Principles (D079)
- [ ] No new vendor or datastore without a decision entry; Neon still not introduced alongside Supabase
- [ ] Native clients still do not write core business records directly to Supabase; Prisma is used only through authorized server APIs

### Reuse before creation

Verified against [ARCHITECTURE.md § Ownership and reuse map](ARCHITECTURE.md#ownership-and-reuse-map). A "yes" to any question below requires an approved architecture decision, not a slice authorization.

- [ ] Does this introduce a **second Task model** or a client-local Task truth?
- [ ] Does this introduce a **second proposal or candidate store** without first establishing that the existing proposal carrier cannot evolve to carry the need?
- [ ] Does this implement **"what constitutes a task"** anywhere other than the one shared interpretation capability? Source-specific adapters are fine; source-specific semantics are not
- [ ] Does this create a **second reminder or follow-through engine** rather than evolving or exposing the existing domain?
- [ ] Does this create **client-specific Recipient, People, or assignment truth**?
- [ ] Does this establish a **client-specific identity or session model** instead of reusing the shared Owner credential pipeline?
- [ ] Does this place **shared business intelligence inside a native client** because that client happened to need it first?
- [ ] Before replacing existing Android capture or networking infrastructure, was that substrate **inspected** for whether it can support or evolve into the authorized Owner UX rather than being casually discarded?
- [ ] Is `tasks: []` (zero proposals) handled as a **successful** interpretation outcome rather than an error or a fallback to direct creation?

### Boundaries

- [ ] **Ownership boundaries hold (D131):** the application stays the sole source of truth for Tasks, reminder state, policy, history, delivery outcomes, and Owner-attention state; an External Scheduler only **wakes** it and decides nothing; Gmail only **transports**; no third-party task engine is introduced or described as a planned dependency
- [ ] **Online-first with graceful connectivity loss (D132):** no offline business-record store, service-worker cache of authenticated business data, mutation queue, background sync, or conflict-resolution layer; a write that did not reach the server is never presented as successful; retry runs through the existing idempotency and concurrency machinery; no copy claims the application works offline
- [ ] Canonical contract approach preserved: OpenAPI is the source of truth, TS and Kotlin clients are generated, JSON Schema is derived only
- [ ] Scheduled work remains app-owned engines invoked by External Schedulers — never business logic inside the scheduler platform
- [ ] Reminder, notification, and retention behaviour remains **deterministic**, never model-driven (D027, D102–D110)
- [ ] **No runtime value is imported from a package listed in `serverExternalPackages`.** `import type` from `@aicaa/db` is safe; importing a constant, class, or function from it is not, because Next leaves the package a runtime external and the binding can be emitted as an undeclared free variable. Reach persistence through `loadDbRuntime()`, or own the value locally with a guard tying it to the persistence authority. **A green unit suite is not evidence** — Vitest resolves the workspace package directly, so the binding exists in every test and is missing only in the shipped artifact
- [ ] Waiting remains the **only** suspension mechanism; no separate pause control was added (D097, D101, D107)

## Reminder and notification work (apply when in scope)

Gates for D102–D110 and D128–D136. These record expected behaviour and required proof; no specific implementation is pre-approved.

### Scheduling correctness

- [ ] Occurrences computed by **local-calendar arithmetic** — increment the calendar date, then resolve 09:00 local — never by a fixed 24-hour millisecond recurrence (D103)
- [ ] **09:00 organization-local preserved across daylight-saving transitions**, proven by test across a real DST boundary (23 or 25 hours on the transition day)
- [ ] No dependence on browser, device, or machine-local timezone; the organization timezone is the only authority (D034, D103)
- [ ] Deterministic IANA resolution with defined behaviour for DST **gap** and **ambiguity**, proven identically under Node, Vitest, and the deployed runtime
- [ ] **No retroactive sends and no backlog:** a past due date, a resume from Waiting, and a reassignment each schedule only the next future occurrence; an elapsed advance occurrence is recorded as skipped with a truthful, distinguishable reason
- [ ] Overdue ceiling stops at **14 successful overdue deliveries per generation**; failures, skips, claims, and advance occurrences are excluded from the count (D106)
- [ ] A material due-date change opens a new generation, preserves all prior history, resets only the per-generation count, and discloses the restart; a same-value save does neither (D104)
- [ ] Reassignment preserves the **Task-scoped** schedule (D104)
- [ ] Historical due-date data did **not** auto-activate reminders; Owner opt-in or re-save is required (D109)
- [ ] **No production enablement** before both the Event Notification Engine and the minimum Owner schedule-status UI are operational (D108)

### Worker and delivery safety

- [ ] Idempotency is **enforced by a database constraint**, not application code; identity is server-derived and encodes the local calendar day — no caller-supplied key (D109, D133)
- [ ] The **occurrence or intent row** is the only duplicate-prevention authority; a claim lease is a scan hint and no correctness decision consults it
- [ ] The in-flight marker is written **before** the transport call, never after — an expired claim without it is reclaimed, with it is finalized `ambiguous` and never retried
- [ ] Every state change is fenced on the claim sequence the caller observed; a stale claimant cannot finalize, release, or mark in-flight over a successor
- [ ] Beginning an attempt is a compare-and-set on the **attempt count as well as the claim sequence**
- [ ] **No database transaction is open across a transport call**
- [ ] A provider-accepted delivery is recorded durably and **cannot be rolled back** by a schedule that suspended, stopped, or changed generation mid-call; the schedule effect is an expected no-op, never an abort
- [ ] A retry reuses the **same** occurrence row; an exhausted budget terminalizes rather than leaving an unclaimable retryable row
- [ ] Only a **terminal** outcome settles a disposition; a claim is not a processed occurrence
- [ ] The safe finalization transaction is the **only** public success path; no raw outcome writer is exported from any barrel
- [ ] **Pre-send re-validation** happens immediately before the transport call and reads every dependent fact in **one snapshot** — a claim proves exclusivity, not eligibility
- [ ] Provider authorization is resolved **once per invocation, before the first claim**; a failure claims nothing, writes nothing, calls no provider, and is not charged to an individual schedule
- [ ] Provider outcomes stay four-valued — confirmed, retryable, permanent, terminal ambiguous — and an **ambiguous outcome is never reported as sent** or counted as a delivery
- [ ] A failure carrying **no HTTP status from the provider is ambiguous, never retryable** — a connection failure does not prove the message was not accepted
- [ ] A **stale item past its ratified horizon** is suppressed with a durable reason, makes zero transport calls, creates no attempt row, and is never eligible again — enabling delivery must not flush a backlog (D135)
- [ ] A global scan is still an organization-scoped write: every mutation derives its organization from the row, never from a caller argument
- [ ] Structural fixes carry a **structural guard that fails with no database**; race suites are supporting evidence, not the regression mechanism
- [ ] Concurrency claims are proven on **real PostgreSQL with simultaneous connections**; PGlite proves deterministic transitions and is not concurrency evidence
- [ ] Additive migrations are tested **from the existing migration state with live rows present**, not only from empty
- [ ] Processing modules import **no** provider client; the transport is injected, gated by exact-string flag match in the composition root, and there is **no default**
- [ ] Internal endpoint responses and logs carry **aggregates only** — no Recipient identity, address, provider payload, failure detail, lease, or row identifier

### Content and destination

- [ ] **No capability token or capability URL** in reminder metadata, audit, logs, or telemetry (D109)
- [ ] A reminder carries **no link** and mints, rotates, or re-sends no capability; both MIME bodies are asserted link-free before emission, with database-sourced content redacted rather than trusted (D130)
- [ ] A non-actionable capability produces a truthful **skip** with zero provider calls, distinguishable from "nobody is assigned"
- [ ] Forbidden email content is absent from text **and** HTML: capability URL, token, `/c/` path, communication excerpts, reminder counts, escalation or "final reminder" wording, internal identifiers, threading headers, CC, BCC
- [ ] The Owner notification destination is resolved server-side from the connected account for the **intent's** organization; the transport exposes **no destination parameter** (D134)
- [ ] Owner mail quotes **no Recipient-authored text** — note bodies, clarification text, and excerpts have no parameter to arrive through, and escaping does not satisfy the prohibition because it is semantic (D134)
- [ ] Attribution is the **historical actor from the intent**, never reconstructed from current state, and terminal outcome audits are **`system`**-attributed
- [ ] Rendering is keyed by the ratified event enum with **exhaustive compile-time coverage** and **fails closed** when required data is absent rather than fabricating detail
- [ ] The self-ingestion marker is emitted only by the controlled MIME builder, exactly once, and ingestion excludes **exactly one exact marker among top-level headers** — duplicate, empty, near-miss, and body-text markers fail closed and stay ingestible
- [ ] Only privacy-safe provider metadata is stored: no raw response, access token, MIME body, message content, or recipient address
- [ ] The real transport is **unreachable from tests**: it refuses construction under a test runner, and no token is decrypted or exchanged when the flag is off

### Owner-facing reminder surfaces

- [ ] Reads are **bounded** by a limit validated inside `packages/db` and ordered **totally**, and the clock stays outside persistence (D103)
- [ ] Organization scoping is applied **in application code**, on both sides of any join — deny-by-default RLS with no policies is not tenant isolation for a Prisma read whose connection role owns the tables
- [ ] Round-trip count is **constant in the number of rows**, measured at the driver, with no database call inside a loop
- [ ] The **reminder ETag** is sent on every reminder mutation and the Task ETag is never substituted; a `412` is a resolution path that re-reads authoritative state and is **never silently retried**
- [ ] An unknown transport outcome is reported as **unknown** and resolved by re-reading, never assumed in either direction
- [ ] Confirmed success, validation failure, domain conflict, stale precondition, unknown outcome, and a failed re-read are **distinct messages**; none collapses into "failed"
- [ ] Editability is **derived from the domain rule**, not restated in the UI
- [ ] **No resend control in any state** — no "send now", "retry", "restart", "force", or "reset". A gap is reported, not papered over with a button
- [ ] A material due-date change discloses the **cycle restart and recalculation before submission** (D104), and stays silent on a first set and a same-date re-save
- [ ] Owner-facing copy avoids implementation vocabulary: generation, occurrence kinds, raw stop-reason labels, claim, lease, fencing, retry counters, scheduler, and Prisma terms appear nowhere
- [ ] A calendar date is carried as the exact `YYYY-MM-DD` string end to end, and no time picker exists
- [ ] Updating a schedule is **never described as sending anything**
- [ ] Empty, loading, and error states are distinguishable, and an error state **cannot be read as an all-clear**; a missing migration or database failure reaches the error boundary rather than degrading to empty
- [ ] Stop-reason copy is truthful and exhaustive over the contracted enum; repeated ambiguity says delivery **could not be confirmed**, never that the Recipient did not receive it (D129)
- [ ] A **new index is measured, not assumed** — any claim that a query needs one, or does not, carries `EXPLAIN (ANALYZE, BUFFERS)` from real PostgreSQL at a realistic row count, including the empty case

## Production changes (apply to any slice that touches Production)

Procedures: [DEPLOYMENT.md](DEPLOYMENT.md).

- [ ] **This slice has its own explicit Owner authorization.** A previous gate's authorization does not carry into it
- [ ] The worktree is at the authorized commit and `git status --short` is **empty**
- [ ] A **preview-target deployment was not promoted** — the Preview environment lacks Production-only variables, so promoting one is an outage
- [ ] `git push origin main` was not used as a deployment mechanism; a push builds and promotes automatically with no inspection step
- [ ] The deployment is **production-target**, created so it can be inspected before the public domain moves to it, and the alias move is treated as an explicit step rather than assumed
- [ ] Before promotion: commit SHA, target, build state, route set **by name**, environment-variable names, flag values, Node version, and build command were all recorded
- [ ] **No migration ran during the build** — only `prisma generate` appears in the build log
- [ ] A migration ran from a worktree containing **no `.env`**, with the URL supplied **process-scoped** to that one command, against an endpoint that can hold a session-scoped advisory lock
- [ ] **No connection string, password, project reference, or token appears anywhere in evidence**, including in redacted-looking form
- [ ] Scheduler state was verified read-only and recorded **as found**; any enabled job was paused before a migration
- [ ] An Owner **no-use window** was established and its bounds recorded
- [ ] Flags are exact lowercase `true` where enabled and **absent** where not — never `false`, `1`, `TRUE`, or `yes`
- [ ] Post-change verification is **authenticated and read-only** unless a mutation was separately approved
- [ ] The rollback target is identified **and its condition stated**, including whether it is defective or carries a stale environment binding; rollback does not unapply a migration, pause a scheduler, or unsend a message
- [ ] Every deviation from the approved procedure is recorded honestly rather than omitted
- [ ] A later gate was **not** begun inside this authorization

## Owner experience (apply to any Owner-facing surface)

- [ ] **No optimistic mutation success** — nothing renders, animates, or implies a business mutation succeeded before the server confirmed it (D112)
- [ ] **Ambiguous outcomes stay ambiguous**
- [ ] An ambiguous or transport retry reuses the **same `Idempotency-Key`** and the **original `If-Match`**; no new-key "start over" after a durable attempt (D112)
- [ ] A confirmed `412` refreshes authoritative state and re-presents it before a new attempt; no silent loop on a known-stale precondition
- [ ] Loading affordances are used for **reads only**; empty states distinguish "none yet" from "none matched" from "failed to load"
- [ ] **One correlation reference** joins the user-visible error reference, server diagnostics, and the audit row — proven by forcing a real failure and tracing a single value (D115)
- [ ] **No capability token and no raw `/c/{token}` path** in any telemetry, log, metric, or error payload — proven by automated assertion, not review alone (D114)
- [ ] Capability routes remain **excluded from client telemetry**; server diagnostics identify them by static template only (D114)
- [ ] No prohibited telemetry payload: OAuth tokens, email bodies or subjects, Task notes, summary text, excerpts, MIME, plaintext Recipient email, or raw provider errors
- [ ] **Operational telemetry is not treated as audit history, a business record, or a learning signal**, and drives no product behaviour (D113)
- [ ] The observability seam is vendor-neutral and application-owned; no commercial telemetry vendor, session replay, or behavioural analytics (D115)
- [ ] Owner dates and timestamps use the **organization** timezone, proven not to depend on browser, device, or machine-local timezone (D117), and the display formatter is never used as a scheduling resolver
- [ ] `packages/ui` remains a **semantic-token layer only** — no component library, no Kotlin token generation (D116)
- [ ] Every route has a loading state, error boundary coverage, a global error fallback, and a not-found state (D119)
- [ ] Confirmation dialogs are validated for keyboard, focus trap, Escape, and focus restoration (D119)
- [ ] Accessibility gate met: **zero serious or critical** automated findings; contrast passes in the shipped theme
- [ ] The browser test layer covers the critical Owner and Recipient journeys and runs as a **separate job**, not inside `pnpm verify`
- [ ] Structural gates pass: **one** Owner authentication call per Owner page request, and a documented and asserted maximum database round-trip count per route
- [ ] Copy does not claim a capability the milestone has not shipped

## Documentation

- [ ] Docs updated **before** or as part of completion (Engineering Rule #1)
- [ ] [GLOSSARY.md](GLOSSARY.md) terms used consistently
- [ ] [WORKFLOWS.md](WORKFLOWS.md) updated if a user-visible flow changed
- [ ] No contradiction with [PROJECT_CONSTITUTION.md](PROJECT_CONSTITUTION.md), and no lower-rank document was made to originate product law
- [ ] [../README.md](../README.md) read order still accurate if documents were added or removed
- [ ] No completed-slice narrative was added to an active document that will have to be deleted later

## AI behaviour

- [ ] No invented facts, deadlines, contacts, commitments, properties, money, follow-up dates, or due dates as facts ([AI_CONSTITUTION.md](AI_CONSTITUTION.md))
- [ ] Facts, inference, missing data, and low confidence are distinguished in outputs
- [ ] Recommendations include rationale and confidence where applicable
- [ ] No silent advance of the learning ladder
- [ ] Task creation, assignment email or forward, and any due date that drives reminders still require an explicit Owner act (D102)
- [ ] AI never creates, activates, alters, or suppresses a Reminder Schedule (D027, D152)
- [ ] Durable learning does not store raw message bodies
- [ ] Invalid model output is quarantined rather than guessed

## Security

- [ ] Server-side Owner session checks on Owner mutating APIs
- [ ] Capability token validation (scope, expiry, task binding) on Recipient mutating APIs
- [ ] GET on capability routes is non-mutating; POST requires explicit confirmation (D050)
- [ ] Capability possession treated as authorization, not verified identity (D051); Recipient audit events do not overstate identity (D052)
- [ ] No unauthenticated one-click mutations
- [ ] Capability links use expiring tokens; hashes stored server-side, never raw tokens
- [ ] Capability rotation and invalidation applied on reassignment or re-forward (D086)
- [ ] Gmail tokens remain server-side and encrypted at rest
- [ ] Secrets not committed; `.env` patterns respected
- [ ] **No real credential is pasted into documentation.** Scan changed documents for a populated connection string (`postgresql://user:password@host`) and for a token-shaped `Bearer` payload — `Bearer` followed by eight or more `[A-Za-z0-9._-]` characters including at least one digit, `.`, or `_`. Angle-bracket placeholders and the loopback Docker credential are fine; `Bearer eyJhbGci…` and a real host with a real password are not
- [ ] Recipient identity not hard-coded in source; no env-default Recipient as a production model (D087)
- [ ] Audit events recorded for approvals, handoffs, delivery attempts, reminder scheduling and attempts, Event Notifications, capability use, and authorization failures
- [ ] Knowingly incomplete Gmail-origin forwards are not sent (D088)

## Privacy

- [ ] Prompt-data minimization applied
- [ ] OTP and financial-alert exclusions respected where detected
- [ ] Contact and source exclusions enforced
- [ ] Notification-access consent and revocation handled honestly
- [ ] The forwarding privacy boundary is disclosed (Gmail copies outside application deletion)

## Retention

- [ ] The seven-day excerpt rule is not conflated with thirty-day completed visibility
- [ ] Raw audio deleted after successful transcription and validation
- [ ] Failed-transcription policy not silently invented while still Open
- [ ] The retention worker does not attempt to delete Gmail mailbox forwards
- [ ] Learning extraction does not keep raw bodies
- [ ] Failed-deletion retry and alert behaviour considered

## Cost

- [ ] Heuristic or cheap filter before expensive AI where appropriate
- [ ] No unnecessary new paid service; free tiers are first-class (D079), paid only for measurable benefit
- [ ] FCM not added without documented justification
- [ ] Polling and AI frequency within acceptable cost and quota assumptions
- [ ] Security, authorization, and audit not weakened to save cost (D079)

## Testing

- [ ] Unit tests for the domain rules touched
- [ ] Contract or schema validation for API and AI payloads touched
- [ ] Regression coverage for approval gates — no email without recorded Owner approval
- [ ] Idempotency tested if a send path was touched
- [ ] Partial or incomplete forward paths never report full success (D088)
- [ ] Native-client fixtures updated if parsers changed
- [ ] Failure paths (reauth, missing body, provider down) considered
- [ ] Default full-`pnpm verify` gate satisfied unless a narrower scope was explicitly authorized

## UX

- [ ] Mobile-first flows remain usable; the Recipient capability path stays minimal
- [ ] Approval boundaries visible before consequential sends
- [ ] Manual and voice fallbacks available when capture fails
- [ ] Best-effort call and notification limitations not over-promised in copy
- [ ] Cognitive load: point-form, clear next action, no dashboard creep
- [ ] The interface states what is true: no optimistic success, ambiguous stays ambiguous, stale data labelled as of a stated time (D112)

## Technical debt

- [ ] New debt listed explicitly (comment plus [OPEN_QUESTIONS.md](OPEN_QUESTIONS.md) or a milestone note)
- [ ] No "temporary" hardcoded Recipient emails or domains
- [ ] No skipped authorization "to unblock a demo"
- [ ] Generated clients not hand-edited without regenerating from the contract

## Documentation drift

- [ ] Implementation does not disagree with docs; if it did, docs were intentionally updated first
- [ ] DECISIONS statuses still accurate (Approved / Deferred / Open)
- [ ] OPEN_QUESTIONS not treated as resolved without recording answers
- [ ] [MILESTONES.md](MILESTONES.md) still reflects reality after this work
