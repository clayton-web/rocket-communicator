# Review checklist

Use this checklist before completing any implementation milestone or merging behaviour-changing work. Answer every section. “N/A” is allowed only with a one-line reason.

Governing references: [PROJECT_CONSTITUTION.md](PROJECT_CONSTITUTION.md) · [AI_CONSTITUTION.md](AI_CONSTITUTION.md) · [ENGINEERING_WORKFLOW.md](ENGINEERING_WORKFLOW.md)

---

## Scope

- [ ] Change maps to exactly one current milestone in [MILESTONES.md](MILESTONES.md)
- [ ] Acceptance criteria for that milestone are listed and met
- [ ] Explicit out-of-scope items for the milestone were not implemented
- [ ] No unrelated refactoring or drive-by feature work
- [ ] New discoveries parked in [OPEN_QUESTIONS.md](OPEN_QUESTIONS.md) or a future milestone
- [ ] Version-one exclusions (WhatsApp, Play Store, Rocket PM, auto-create, etc.) untouched
- [ ] Plan or prompt classified Docker as 🟢 not required, 🟡 recommended, or 🔴 required ([ENGINEERING_WORKFLOW.md](ENGINEERING_WORKFLOW.md))

## Environment and verification

Governing process: [ENGINEERING_WORKFLOW.md](ENGINEERING_WORKFLOW.md) (Environment Guard, Docker indicator, verification exit criterion, Environment Status report block).

- [ ] **Environment Guard** ran before application-code changes (Node, pnpm, `JAVA_HOME` → Java 17, Gradle on JDK 17, slice-specific tools, and a green `pnpm verify` baseline unless authorization waived the baseline)
- [ ] Environment failures were classified as environment issues — application code was not modified to compensate
- [ ] Toolchains that were already healthy were not reinstalled or reconfigured
- [ ] **`pnpm verify` is green** as the default exit criterion, **or** the authorization explicitly permitted a narrower scope
- [ ] If verification was partial: the report says **partial**, lists every blocked step exactly, and does **not** claim full verification
- [ ] An environment failure is not treated as proof of application correctness
- [ ] Genuine repository defects from verification were reported, not silently bypassed
- [ ] Completion report includes the **Environment Status** block (Node, pnpm, `JAVA_HOME`, Java, Gradle, Docker required for this slice, `pnpm verify`)

## Architecture

- [ ] Matches [ARCHITECTURE.md](ARCHITECTURE.md) and Approved [DECISIONS.md](DECISIONS.md)
- [ ] Honours Architecture Principles (D079; complete source in [PROJECT_CONSTITUTION.md](PROJECT_CONSTITUTION.md)): logic independent of host/infra where practical; replaceable vendors; cost-aware without weakening security; free tiers preferred when sufficient; infrastructure triggers endpoints rather than embedding business logic; no unnecessary complexity/lock-in
- [ ] No new vendor or datastore without a decision entry
- [ ] Neon still not introduced alongside Supabase in v1
- [ ] Android still does not write core business records directly to Supabase tables
- [ ] Prisma used only through authorized server APIs
- [ ] Canonical contract approach preserved (OpenAPI source of truth → generated TS/Kotlin clients; JSON Schema only if derived)
- [ ] Follow-up Engine / Event Notification Engine / retention behaviour remains deterministic (not model-driven sends) (D027, D102–D110)
- [ ] Scheduled work (Gmail Application Polling Engine, reminder processing, retention) remains app-owned engines invoked by External Schedulers—not business logic inside the scheduler platform
- [ ] **Ownership boundaries hold (D131):** the application stays the **sole source of truth** for Tasks, Task state, reminder schedules, reminder state, reminder policy, reminder history, delivery outcomes, and Owner-attention state; the External Scheduler only **wakes** it and decides nothing (not due-ness, eligibility, whether to send, schedule status, counts, ceilings, generations, retry policy, or Owner attention); Gmail only **transports** and owns no scheduling, policy, retry rule, history, or capability state; and no third-party task engine (Google Tasks, Microsoft To Do, Apple Reminders, Google Calendar as an engine) is introduced or described as a planned dependency, and any projection, export, cache, or integration that holds Rocket data stays subordinate to it rather than becoming a competing authority
- [ ] **Online-first with graceful connectivity loss (D132):** no offline business-record store, service-worker cache of authenticated business data, mutation queue, background synchronization, or conflict-resolution layer is introduced; a write that did not reach the server is never presented as successful; a preserved local draft is never treated as a completed server write; retry runs **through** the existing idempotency and concurrency machinery; reconnecting cannot produce duplicate Task mutations; and no copy claims the application works offline
- [ ] Reminders derive only from an **explicitly Owner-selected** due date; no escalation stages and no Owner CC ladders (D099, D102)
- [ ] Snooze is not treated as A8 product law (D101); **Waiting is the only** suspension mechanism, and no separate pause control was added (D097, D107)

## Reminder engine (A8; apply when reminder work is in scope)

Gates for the due-date-driven Follow-up Engine (D102–D110). These record **expected behaviour and required proof**; no specific resolver implementation is pre-approved.

- [ ] Occurrences computed by **local-calendar arithmetic** (increment the calendar date, then resolve 09:00 local) — **not** by `MS_PER_DAY` or any fixed 24-hour millisecond recurrence (D103)
- [ ] **09:00 organization-local preserved across daylight-saving transitions**, proven by test across a real DST boundary (absolute gap between consecutive occurrences correctly 23 or 25 hours on the transition day)
- [ ] No dependency on browser, device, or server machine-local timezone; organization timezone is the only authority (D034, D103)
- [ ] Deterministic IANA timezone resolution, with defined behaviour for DST **gap** (non-existent local time) and **ambiguity** (repeated local time)
- [ ] **Adversarial timezone-resolver tests** pass identically under Node, Vitest, and the deployed runtime — including a zone where the reminder hour itself transitions
- [ ] Idempotency **enforced by a database constraint**, not application code; identity is server-derived and encodes the local calendar day (D109)
- [ ] **Generation validated immediately before send**; stale claims from a superseded generation cannot deliver (D104)
- [ ] **Pre-send recheck** of Task status, assignment state, and schedule state immediately before the provider call (D107)
- [ ] Automated sends attributed to a **`system`** actor; Owner scheduling changes to the **`owner`** actor; no automated send attributed to the Owner as if manual (D107)
- [ ] **No capability token or capability URL** in reminder metadata, audit, logs, or telemetry (D109)
- [ ] **No retroactive sends:** an advance occurrence already elapsed at establishment is recorded as skipped with `advance_window_elapsed`, and no scheduler run reclassifies a scheduled occurrence from the clock (D105)
- [ ] **An advance occurrence a Waiting period spanned** is recorded as skipped with the distinct reason `skipped_waiting_elapsed` on resume, never sent late and never conflated with `advance_window_elapsed`; its original local date and instant are preserved, and an already-delivered or already-skipped occurrence keeps its existing reason (D105, D107)
- [ ] **No backlog:** a past due date, a resume from Waiting, and a reassignment each schedule only the next future occurrence — for the advance occurrence as well as the overdue one (D105, D107)
- [ ] Reassignment preserves the **Task-scoped** schedule and sends no backlog (D104)
- [ ] Overdue ceiling stops at **14 successful overdue deliveries per generation**; failures, skips, claims, and advance reminders excluded from the count (D106)
- [ ] Material due-date change opens a new generation, preserves all prior history, resets only the per-generation count, and discloses the restart; a same-value save does neither (D104)
- [ ] Duplicate or overlapping scheduler invocations produce **at most one delivery per local calendar day**
- [ ] Completion, dismissal, and due-date removal stop future sends; reminder history is superseded, never deleted or rewritten (D107)
- [ ] Existing historical due-date data did **not** auto-activate reminders; Owner opt-in or re-save is required (D109)
- [ ] **No production enablement** before the Event Notification Engine **and** the minimum Owner schedule-status UI are operational (D108)
- [ ] Deferred scope absent: no preset reminder choices, Owner-created additional reminders, custom-reminder routes or UI, recurrence editor, reminder-time picker, Recipient reminder preferences, or AI-controlled scheduling (D110)
- [ ] No regression to A7 assignment delivery on either path

### Worker safety (A8.4a; apply to any occurrence-processing change)

- [ ] A provider-accepted delivery is recorded **durably** and cannot be rolled back by a schedule that suspended, stopped, or changed generation mid-call; the schedule effect is an expected no-op, never an abort
- [ ] The **occurrence row** is the only duplicate-prevention authority; the schedule lease is a scan hint and no correctness decision consults it
- [ ] `provider_call_started_at` is written **before** the transport call, never after — an expired claim without it is reclaimed, with it is finalized `ambiguous` and never retried
- [ ] Every occurrence state change is fenced on the claim sequence the caller observed; a stale claimant cannot finalize, release, or mark in-flight over a successor
- [ ] A retry reuses the **same** occurrence row; no second row is created for a retry, and an exhausted budget terminalizes rather than leaving an unclaimable retryable row
- [ ] Only a **terminal** occurrence outcome settles a schedule's advance disposition; a claim is not a processed occurrence
- [ ] The safe finalization transaction is the **only** public success path; no raw outcome writer is exported from `@aicaa/db` or `@aicaa/db/runtime`
- [ ] Pre-send re-validation happens **immediately before** the transport call, not only at claim time — a claim proves exclusivity, not eligibility
- [ ] A global scan is still an organization-scoped write: every mutation derives its organization from the row, never from a caller argument
- [ ] Structural fixes carry a **structural guard** that fails with no database; race suites are supporting evidence, not the regression mechanism ([ENGINEERING_WORKFLOW.md](ENGINEERING_WORKFLOW.md))
- [ ] Processing modules (`apps/web/lib/reminders/`) import **no** Gmail client or real provider transport; the transport is injected, and the delivery flag defaults disabled by exact-string match
- [ ] Internal endpoint responses and logs carry aggregates only — no Recipient identity, address, provider payload, failure detail, lease, or row identifier
- [ ] Additive migrations are tested **from the existing migration state with live rows present**, not only from empty; any new constraint over existing data carries a backfill

### Reminder delivery (A8.4b; apply to any change that can reach a provider)

- [ ] Provider authorization is resolved **once per invocation, before the first claim**; a failure claims nothing, writes nothing, calls no provider, and is **not** recorded as an occurrence-level reminder failure (D129/D130 slice law)
- [ ] Capability state is read from the **canonical row in the same snapshot** as the Task, assignment, due date, and schedule — not by a second query, and not reconstructed
- [ ] A non-actionable capability produces a truthful `no_actionable_capability` **skip** with zero provider calls, and is distinguishable from `no_active_assignment`
- [ ] No reminder mints, rotates, or re-sends a capability, and none modifies an expiry or revocation rule
- [ ] Both MIME bodies are **asserted link-free** before emission; content arriving from the database (summary points) is redacted rather than trusted (D130)
- [ ] Forbidden email content is absent from **text and HTML**: capability URL, token, `/c/`, Task URL, redirect, communication excerpts, reminder counts, escalation or "final reminder" wording, internal identifiers, threading headers, CC, BCC
- [ ] Provider outcomes stay four-valued — confirmed, retryable, permanent, terminal ambiguous — and an **ambiguous outcome is never reported as sent** or counted toward the overdue ceiling
- [ ] A send failure carrying **no HTTP status from the provider is ambiguous, never retryable** — a connection failure does not prove the message was not accepted, and an unattended retry of a message the provider may hold is a duplicate reminder to a real Recipient
- [ ] Only privacy-safe provider metadata is stored: no raw response, access token, MIME body, message content, or recipient address
- [ ] The real transport is **unreachable from tests**: it refuses construction under a test runner, and the flag gates construction in the composition root so no token is decrypted or exchanged when off
- [ ] Reminder transport changes touch **no** A7 handoff, assignment-email, forwarding, or capability-link behaviour, and add no threading, CC, or BCC
- [ ] The advance reminder is deliverable **only during its own organization-local calendar day** (D105); the boundary is a calendar-date comparison in the organization's zone, never a fixed number of hours, so the 23- and 25-hour days the clocks shift neither lose an hour nor spill into the due date
- [ ] A morning the worker reached too late is **claimed and settled**, not filtered out of the scan, so no schedule is left reporting `scheduled` for an occurrence that can never happen
- [ ] `advance_window_elapsed` stays distinct from `skipped_not_eligible`: the first means the reminder was owed and missed, the second means the Task stopped needing one, and their remedies differ
- [ ] Advance and overdue share **one** claim, guard, send, and settle path; a second pipeline is the failure mode, and the kind is read from the scanned candidate rather than written as a literal downstream
- [ ] The advance reminder reuses the approved email **verbatim** — no "due tomorrow", no escalation, no capability link (D130), no counts, no schedule identifiers — because D105 is a difference in timing, not in content
- [ ] Advance occurrences count toward **neither** D106's fourteen successful overdue deliveries nor D129's consecutive run; a generation holds one advance occurrence, so it can never form a sequence
- [ ] An ambiguous-outcome **counter is not stored**; D129's threshold is derived from history, and nothing auto-resumes a schedule stopped for repeated ambiguity
- [ ] D129's threshold is evaluated **inside the settlement transaction** that holds the Task lock and applies the schedule effect once — never in a provider adapter, never in the worker, and never from history read before the lock was taken
- [ ] The sequence counts **final occurrence outcomes, not provider attempts**: one occurrence retried three times is one outcome, and `attempt_count` is not an input
- [ ] A **skip neither counts toward nor breaks** the run (no provider was contacted), while a success or a permanent failure — retry-budget exhaustion included — breaks it
- [ ] History is scoped to the **current generation** and ordered by scheduled occurrence identity, not by `completed_at`, so a late or swept settlement cannot reorder the run
- [ ] The stop is conditional on the schedule still being `active`, so an **earlier authoritative stop reason is never overwritten**, and the third occurrence stays recorded as ambiguous rather than being rewritten
- [ ] A stop **disarms the next occurrence**, so no fourth reminder is reachable by the same invocation, a concurrent worker, or the next wake-up
- [ ] No new schedule status is introduced: Waiting remains the only suspension mechanism (D097, D107), and D129 stops rather than pauses

### Owner event notifications (A8.5; apply to any Event Notification Engine change)

- [ ] The change stays on the Owner-notification side of the boundary: **no** reminder counter, generation, D129 sequence, D106 ceiling, daily occurrence rule, Waiting suspension, or reminder schedule settlement is read, imported, or reimplemented (D135)
- [ ] Notification intent is written in the **triggering mutation's own transaction** and never derived from the audit log; the audit row and the intent row stay separate records answering separate questions (D133)
- [ ] Event identity is **server-derived** and unique in the database — no caller-supplied idempotency key, and a legitimate repeat is representable while a retry collides (D133, D109)
- [ ] `provider_call_started_at` and the `in_flight` attempt row are committed **before** the transport call; an expired claim without one is reclaimed, with one is terminal `ambiguous` and never retried
- [ ] **No database transaction is open across the transport call**, and every state change afterwards is fenced on the claim sequence the caller observed
- [ ] Beginning an attempt is a compare-and-set on the **attempt count as well as the claim sequence**, so two callers under one valid claim cannot both open a provider call or both take a number
- [ ] An **ambiguous outcome is terminal on first occurrence**, never retried, never counted as sent, and requires Owner attention; retry exhaustion is terminal and cannot return to pending (D135)
- [ ] A **stale intent** past the 24-hour horizon is suppressed with a durable reason, makes **zero** transport calls, creates **no** attempt row, and is never eligible again — enabling delivery must not flush a backlog (D135)
- [ ] No attempt row is created for stale suppression, disabled delivery, a lost claim, or an already-terminal intent; a row asserting a provider call that never happened is the one thing this history must not say
- [ ] `ENABLE_OWNER_EVENT_DELIVERY` is exact-string `"true"`, read **before** any database access, and an absent transport behaves identically; capture and delivery stay independent flags and neither implies the other
- [ ] The **processing service** imports no Gmail client, access-token resolver, MIME builder, or Owner email renderer, and no change adds cron configuration; a source guard fails the build if one appears. The adapter composes at the route, which is the only place allowed to name a provider
- [ ] Terminal outcome audit events are **`system`-attributed** — never the Owner and never the Recipient — and are written in the same transaction that settles the intent; `note` carries a code from a closed set, never a provider response or exception message (D133)
- [ ] Owner mail and worker responses carry **no** capability token, capability URL, `/c/` path, token hash, temporary excerpt, Recipient free text, quoted clarification, or address (D109, D114, D134)
- [ ] Internal worker responses and logs are aggregates only, and a count expensive enough to need an unbounded scan is not promised
- [ ] Concurrency claims are proven on **the repository's real Docker PostgreSQL with simultaneous connections**; PGlite proves deterministic transitions and is not concurrency evidence

### Owner notification mail and the Gmail adapter (A8.5c; apply to rendering, destination, transport, or ingestion changes)

- [ ] The destination is resolved server-side from `CommunicationAccount.emailAddress` for the **intent's** organization and addressed to that same mailbox; the transport still exposes **no destination parameter**, so no request, session, environment variable, Task field, Recipient row, or event metadata can select one (D134)
- [ ] `OWNER_ORGANIZATION_ID` remains a **fail-closed assertion** and never a source: a disagreeing intent is refused, never redirected to another organization
- [ ] Authorization and destination are resolved **per notification** with nothing cached between items, so one organization's intent cannot reach another's mailbox and a reconnected account changes the destination without mutating the intent
- [ ] The destination appears in **no** intent row, attempt row, audit event, log line, worker response, or failure code; only a short normalized provider message reference is retained on success
- [ ] Rendering is keyed by the ratified event enum with **exhaustive compile-time coverage**, uses only fields the intent schema and safe subject lookups guarantee, and **fails closed** when required data is absent rather than fabricating event detail
- [ ] Attribution is the **historical actor from the intent**, never reconstructed from current Task state; a Recipient action is never rendered as "you completed" or as Rocket completing, and only privacy-safe actor kinds appear
- [ ] Owner mail quotes **no** Recipient-authored text — note bodies, clarification text, and excerpts have no parameter to arrive through, and escaping does not satisfy the prohibition because it is semantic (D134)
- [ ] Any Owner link points to an **authenticated** application surface on the canonical base URL with identifiers encoded, and the rendered body is refused if it contains a `/c/` path or any URL other than the one constructed
- [ ] The D136 marker is emitted **only** by the controlled MIME builder, only for Owner Event Notifications, exactly once, with a fixed value; no arbitrary-header input, threading header, sender display name, tracking pixel, or remote image is introduced
- [ ] Ingestion excludes **exactly one exact marker among top-level headers** — never all `SENT` mail, self-addressed mail, mail from the connected address, assignment mail, or reminder mail — and duplicate, empty, near-miss, and body-text markers all fail closed and stay ingestible
- [ ] The ingestion skip happens **before** any temporary excerpt, `CommunicationEvent`, or suggestion candidate is created
- [ ] Provider classification stays truthful: a confirmed message reference is accepted, a 2xx without one is **ambiguous**, thrown errors remain ambiguous, retryable is used only where the provider proved non-acceptance, and a durably unavailable channel is decided **before** any provider contact rather than retried to exhaustion
- [ ] Real transport construction is behind exact delivery enablement, evaluated **before** any configuration read or credential access, and a test runner without an injected sender **throws** rather than returning something that could reach Gmail
- [ ] No Gmail message is sent by tests, no live OAuth occurs, and no production credential is read

### Owner event producers and capability expiry (A8.5d; apply to any new or changed producer)

- [ ] Every ratified event still has a **registered producer** and the taxonomy-coverage test passes; an event value outside the enum, a missing producer, or a renderer that lost exhaustive coverage fails the build
- [ ] The intent is written from the transaction that **durably establishes the event** — not from a post-commit hook, not from an audit-log scan, and not from a second transaction that could commit alone
- [ ] Capture is decided **before** the transaction opens for request-driven mutations, passed in explicitly, and a disabled decision issues **no statement** against either A8.5 table, so an unapplied migration stays harmless
- [ ] The event's actor is the actor of the **event**, not of the request that surfaced it: an observation gets a `system` identifier naming the subsystem, and an Owner-attributed request audit beside it stays Owner-attributed
- [ ] The occurrence key makes a **legitimate repeat representable and a retry impossible** — a post-mutation Task version, a durable attempt identity, a status transition and its instant, a schedule generation, or a one-time constant
- [ ] Renderer truthfulness was assessed before implementation, and any claim that an event needs new persisted data identifies the **exact misleading statement** rather than asking for richer prose
- [ ] No clarification text, note body, Gmail excerpt, provider response body, exception message, email address, capability token, or capability URL reaches an intent row
- [ ] A **transient** failure the system still intends to retry produces no notification; only a durably terminal outcome does
- [ ] A re-observation of an unchanged state produces nothing — the underlying write is compare-and-set on the state being left, so the loser writes no status change, no audit row, and no intent
- [ ] Reminder settlement is unchanged apart from the conditional intent insert: no ceiling, ambiguity, ordering, count, outcome, stop-semantics, or claim behaviour reads the capture argument
- [ ] Capability expiry goes through the **one shared transaction** that both the sweep and lazy validation call; a race produces one transition, one audit event, and one intent, and notification failure cannot affect authorization truth
- [ ] `packages/db` reads **no clock** for expiry — the observation instant is an argument (D103) — and expiry does not depend on a Recipient presenting a token
- [ ] Documentation does not describe the capability sweep as scheduled unless something actually invokes it
- [ ] Concurrency claims for every new producer are proven on **the repository's real Docker PostgreSQL with simultaneous connections**

### Owner notification worker phases (A8.5e; apply to any change to the notification endpoint)

- [ ] **Both flags off means zero database access and no transport** — proven by observing that the database and transport thunks were never called, not inferred from where a flag is read
- [ ] Capture and delivery are **independently gated**: expiry observation reads only `ENABLE_OWNER_EVENT_CAPTURE`, delivery reads only `ENABLE_OWNER_EVENT_DELIVERY`, and neither consults the other's flag
- [ ] `ENABLE_REMINDER_DELIVERY` is **not referenced** by this endpoint or anything it calls
- [ ] A capture-only invocation composes **no transport**, resolves no Gmail configuration, claims no intent, and writes no attempt row; invalid Gmail configuration cannot prevent it
- [ ] A delivery-only invocation performs **no expiry scan** and creates no new `capability.expired` intent
- [ ] Capture runs **before** delivery, and **no transaction spans the two phases**
- [ ] The expiry scan is **bounded** with a deterministic order, and the bound is enforced inside `packages/db` rather than trusted from the caller
- [ ] Phase failures are isolated: a lost per-item race is counted rather than raised, a systemic scan failure returns a truthful error, and committed capture work is not rolled back by any later delivery failure
- [ ] Budget exhausted during capture stops **before** transport composition and is reported as such rather than as an absent configuration
- [ ] The worker response is **counts and booleans only** — no capability identifier, address, Task summary, individual expiry instant, provider content, or raw database error
- [ ] Response fields are **additive**; no existing field was removed or silently repurposed, and OpenAPI plus the generated TypeScript and Kotlin artifacts were regenerated together
- [ ] **Capability authorization truth is independent of all of it**: an expired capability is unusable regardless of sweep outcome, flag state, intent uniqueness, or delivery
- [ ] No cron job and no `vercel.json` change was introduced

### Owner reminder visibility (A8.6; apply to any Owner surface that reads reminder state)

- [ ] The read is **bounded** by a limit validated inside `packages/db`, rejecting a non-integer, a non-positive, and an above-ceiling value, and ordered **totally** so two loads of an unchanged database agree
- [ ] Organization scoping is applied **in application code**, on the schedule **and** on any joined Task — deny-by-default RLS with no policies is not tenant isolation for a Prisma read whose connection role owns the tables
- [ ] An item can never link to a Task outside the authenticated Owner's organization; the fail-closed behaviour when one cannot be resolved is chosen deliberately, documented in code, and tested
- [ ] Round-trip count is **constant in the number of rows**, measured at the driver rather than assumed, with no database call inside `map`, `forEach`, `for`, `for…of`, or `Promise.all`
- [ ] The legacy `Task.reminder` metadata — `nextReminderAt`, `paused`, `pausedReason` — is **not read**. It is A2-era, nothing in A8 maintains it, and it reads plausibly enough to be displayed by mistake
- [ ] The reminder **ETag is not used** for reading, caching, or freshness: it deliberately does not move when a worker records a delivery, increments the overdue count, or raises the attention flag
- [ ] No `claimedBy`, `claimedAt`, `claimExpiresAt`, `reminderVersion`, `generation`, or schedule row id reaches the projection type — absent, not merely unrendered
- [ ] Stop-reason copy is **truthful and exhaustive** over the contracted enum, with no fourth attention reason invented; repeated ambiguity says delivery **could not be confirmed**, never that the Recipient did not receive it (D129)
- [ ] Local calendar dates render as the day they name, through a local-date formatter rather than the instant formatter, which would shift them a day in the organization's zone
- [ ] Empty, loading, and error states are **distinguishable**, and the error state cannot be read as an all-clear
- [ ] A missing migration or database failure reaches the **error boundary**; it is never degraded into an empty state
- [ ] Any claim about D108 is limited to what shipped: **A8.6a establishes the cross-Task discovery surface**, **A8.6b adds Task-level status and repair**, and the gate is discharged only by architecture approval of the complete minimum reminder UI — not by a passing test run. **A8.6c is not a D108 requirement** and must not be offered as evidence toward it
- [ ] An E2E assertion about the **whole** list — "nothing needs attention", "exactly one item" — clears the organization's schedules first. The harness migrates the local database but never truncates it, so a row seeded by an earlier run would otherwise make the empty state unprovable forever
- [ ] A loading-boundary scan holds the boundary open by **throttling the transport**, not by delaying a `page.route` handler. `page.route('**/x')` does not match the `/x?_rsc=<hash>` a client navigation actually requests, and blocking a response outright prevents the server from streaming the Suspense fallback at all — such a test passes only while the click keeps landing before hydration

### Owner reminder mutation (A8.6b; apply to any surface that changes reminder configuration)

- [ ] The **reminder** ETag is sent on every mutation and the **Task** ETag is never substituted — a reminder write does not bump `Task.version`, so a Task token cannot protect a reminder. A test proves the substitution is rejected
- [ ] A `412` is a **resolution path**, not a failure: authoritative state is re-read and re-presented, the Owner is told the reminder changed elsewhere or the request may already have applied, and the mutation is **never silently retried** with a fresh token
- [ ] `428 PRECONDITION_REQUIRED` is treated as an implementation defect and is **unreachable** from the UI
- [ ] An unknown transport outcome (D132) is reported as **unknown** and resolved by re-reading, never assumed in either direction, and never auto-resubmitted. No offline queue, background sync, service-worker mutation cache, or local authoritative state
- [ ] Confirmed success, validation failure, domain conflict, stale ETag, unknown outcome, and a failed re-read are **six distinct messages**; none collapses into "failed"
- [ ] Local state is replaced **only** by a server-returned projection. HTTP status alone never counts as success, and double submission is blocked in memory
- [ ] Editability is **derived from the domain rule**, not restated in the UI. A control that would predictably earn a `409 DOMAIN_CONFLICT` is disabled with the reason stated, and the reason is available to assistive technology rather than conveyed by the disabled state alone
- [ ] **No resend control in any state** — no "send now", "retry", "restart", "force", or "reset". D129 stopped the schedule deliberately and no resend policy is ratified. A gap is reported, not papered over with a button
- [ ] A material due-date change discloses the **cycle restart, count reset, and recalculation before submission** (D104), and stays silent on a first set and a same-date re-save so the disclosure keeps its meaning
- [ ] Owner-facing copy uses **"reminder cycle"**; `generation`, occurrence-kind enums, raw stop-reason labels, claim/lease/fencing, retry counters, scheduler terms, and Prisma vocabulary appear nowhere
- [ ] A calendar date is carried as the exact `YYYY-MM-DD` string end to end — no `Date` construction, no browser-local midnight, no timezone shift — and no time picker exists, because reminder timing is fixed by policy
- [ ] Updating a schedule is **never described as sending anything**; configuration and delivery are separate facts and no copy claims an email on the strength of a saved date
- [ ] A destructive removal is gated by the established confirmation pattern, states that sent email **cannot be recalled**, and moves focus in and restores it on close
- [ ] A **value** imported from a `serverExternalPackages` package is a runtime hazard: the binding can arrive `undefined` in the server with no error, no failing unit test, and a plausible-looking result. Reach those packages through the established dynamic runtime loader, or own the constant locally with a test asserting the **product** parses, not merely that the two values match

### Owner notification visibility (A8.6c; apply to any surface that shows notification delivery outcomes)

- [ ] The surface is **read-only and stays read-only**: no resend, acknowledgement, dismissal, mark-as-read, snooze, or attempt-history browser, and a source guard prohibits the vocabulary so none can appear later by accident
- [ ] Only states meaning **the Owner was never told** are shown. `sent` is excluded — repeating a delivered email makes this an inbox — and `pending`, `claimed`, and `failed_retryable` are excluded because reporting an unfinished decision invites the Owner to act on one the worker has not made
- [ ] Events already represented by another section are excluded **in the statement, not after projection**. Filtering after the fact lets a full batch render as an empty list while still reporting the batch as filled
- [ ] The exclusion is justified by **divergent clearing behaviour**, not tidiness: the reminder attention flag clears when the Owner repairs a schedule and a notification intent never does, so an unfiltered read re-announces a stop that was fixed weeks ago
- [ ] The visibility window is the **only** retirement mechanism, and that is stated rather than implied. If an item can never leave any other way, no copy may suggest the Owner can act on it
- [ ] A ratified bound is enforced where it cannot be widened — the ceiling inside `packages/db`, rejecting an above-ceiling limit rather than clamping it — and the clock stays outside persistence (D103)
- [ ] Subject resolution is **batched by kind**, never a single-item resolver in a loop, with the statement count asserted constant at the driver as rows are added
- [ ] Every subject lookup repeats `organizationId` independently. No foreign key binds an intent to its subject, so their agreement is a write-path invariant the read must not assume
- [ ] An **unresolvable subject still renders**, without a link. Purged, foreign, and Task-less subjects collapse to the same outcome, and none of them removes the item — a surface about things the Owner was not told cannot itself withhold one
- [ ] `occurrenceKey`, claim holder, lease expiry, fencing sequence, attempt count, provider references, failure codes, and request or correlation identifiers are **not selected**, so they are absent from memory rather than filtered out later
- [ ] Actor attribution uses the **closed category vocabulary** from the shared mapping module. Recipient identity is not resolved, `attributionLabel` is not displayed, and email-renderer wording is not reused where it would name a second actor for the same assistant
- [ ] Copy distinguishes **suppressed** from **failed** from **ambiguous**: Rocket choosing not to send, Rocket failing to send, and Rocket not knowing are three facts, and collapsing them into "failed" invents certainty
- [ ] A **new index is measured, not assumed**. Any claim that a query needs one — or does not — carries `EXPLAIN (ANALYZE, BUFFERS)` from real PostgreSQL at a realistic row count, including the **empty** case, which is the steady state for a delivery-backstop query and the one a filtered index usually fails to help
- [ ] A performance justification for a product bound is **checked before it is written down**. A window that turns out to cost the same as no window is a product decision, and saying otherwise leaves the next reader believing the surface cannot be widened without a rewrite
- [ ] Accessibility coverage includes the item shape with **no link**, not only the linked one; an item whose only interactive element is absent is the state most likely to have been built as an empty anchor

### Production rollout preparation (A8.7a; apply to rollout documentation and non-production tooling)

- [ ] The slice **contacted nothing**: no production or remote database, no production SQL of any kind including read-only, no deploy, no environment variable change, no Vercel or Supabase dashboard, no scheduler job, no provider, and no internal production route
- [ ] No migration file was created, edited, renamed, or deleted. **Prisma checksums are intact**, and any correction to an applied migration's wording lives in documentation rather than in the file
- [ ] `vercel.json` is unchanged and still declares no `crons`; `schema.prisma` is unchanged and gained no `directUrl`
- [ ] **No feature flag is enabled anywhere.** Every example-environment entry remains commented, and none is assigned `true`
- [ ] No A8.3, A8.4, A8.5, or A8.6 runtime semantics changed, and no production-only canary bypass, batch-limit parameter, or test-only query string was added
- [ ] Every production command and query appears as a **future operator instruction**, never as something the slice executed
- [ ] Migration connection guidance names an endpoint that can actually hold a **session-scoped advisory lock**. A pooled endpoint recommended for the application runtime is not automatically correct for Prisma Migrate, and the port is the difference
- [ ] A documented credential form is a **placeholder** — no project reference, region, username, or password — and the command pattern keeps the real value out of shell history and out of evidence
- [ ] A bare migration command is prohibited where it could fall back to an operator-local `.env`, and local-only helpers are not presented as the same command with a different URL
- [ ] Any claim that a control protects a migration is **checked against whether it reaches the migration's own connection**. A setting applied in a different session, or through an option a pooler need not forward, protects nothing
- [ ] The failure model does not assert transactional guarantees the repository does not establish. Per-file and cross-file atomicity are stated as **absent**, and recovery depends on **physical schema inspection** rather than the migration-history row
- [ ] Every migration in scope has a recovery entry covering objects, statement count, idempotency, likely failure points, detection queries, and the three physical-state classifications — **none present**, **all present**, **some present** — with `migrate resolve --applied` treated as the dangerous one
- [ ] A migration using `NOT VALID` then `VALIDATE` is detected by **`pg_constraint.convalidated`**, not by constraint existence, and its half-applied state has an explicitly reviewed completion
- [ ] A migration touching a **live** table carries a stronger warning than one creating empty tables, and the lock class it takes is named
- [ ] Every preflight query states **when it runs, the expected result, the stop/go threshold, and the evidence field** — a query with no threshold is an observation, not a gate
- [ ] Verification commands are classified honestly. A command that writes cache, `dist`, coverage, or `node_modules` output is **not** described as non-mutating; the accurate phrase is "does not alter tracked source"
- [ ] `pnpm verify` is **preserved unchanged** as the slice exit gate, and any command that regenerates tracked artifacts is excluded from the between-steps preflight category
- [ ] Docker is required **only** where a step genuinely needs it, and the documentation does not imply it must stay running
- [ ] The rollback model accounts for **environment-variable binding**: a deployment carries the values it was built with, rollback restores the target's original values, and plan limits may make an older state unreachable
- [ ] The documentation says plainly that rollback does **not** unapply a migration, does **not** pause a scheduler job, and does **not** unsend a message
- [ ] A canary is **genuinely single-item by state preparation** — verified counts immediately before invocation — rather than by a batch limit, a bypass, or a hope that the queue is empty
- [ ] Every condition that could make a canary multi-item is enumerated and checked, including secondary phases of the same endpoint that populate the same queue
- [ ] Provider round-trip evidence is **API-level**, with the exact call and fields named. Visual inspection of a mail client is not evidence, and "at least one marker header" is not the same assertion as "exactly one"
- [ ] A hard gate states what it **blocks**, and the blocked action is not described anywhere else as optional
- [ ] Containment for a failed provider gate includes **quarantine**, not only disablement, when the artifact could otherwise be re-ingested
- [ ] The evidence template prohibits connection strings, tokens, capability URLs, personal message content, and Recipient identities, and asks for identifiers and counts instead
- [ ] Each stage's seven headings are all present, and an inapplicable heading says so rather than being dropped

### Production schema compatibility repair (A8.7b-INCIDENT-1c; apply to the Production repair slice)

**Context.** Production serves A8 code against an unmigrated database. The repair applies **exactly five** migrations from a detached `ee5e82a` worktree and **deploys nothing**. Every gate below exists because a plausible-looking shortcut would violate it.

**Migration boundary**

- [ ] The migration executed from a **detached worktree at `ee5e82a`**, and the worktree commit is recorded
- [ ] The worktree held **exactly ten** migration directories — five pre-A8 and five A8 — verified before the migration, not inferred
- [ ] **Exactly five** A8 migrations were applied, named individually in evidence, and the history holds **exactly ten** rows afterwards
- [ ] **No migration 6 through 9 was applied.** `owner_notification_intents` and `owner_notification_attempts` are proven **absent** after the repair
- [ ] **Current HEAD was not used for the Production migration.** A `migrate status` reporting nine pending migrations is recorded as a stop, not as a surprise
- [ ] Phase-3 rehearsal evidence is **not** cited as authorization for applying migrations 6 through 9

**Credential and execution safety**

- [ ] The execution worktree contained **no `packages/db/.env`**, and its absence was verified rather than assumed
- [ ] The migration URL was supplied **process-scoped** to the single command; no bare migration command was run
- [ ] The endpoint was the Supabase Shared Pooler in **session mode on port 5432**, with **no `pgbouncer=true`** — recorded as a redacted host form plus port
- [ ] **No connection string, password, project reference, or token appears anywhere in evidence**, including in redacted-looking form

**Operational preconditions**

- [ ] Scheduler state was **verified read-only** at the dashboard and recorded **as found**, since the repository cannot prove it
- [ ] Any enabled Gmail-poll or suggestion-processing job was **paused before** the migration
- [ ] An **Owner no-use window** was established and confirmed for the duration
- [ ] The `8588c5d` containment deployment was confirmed available and redeployable **read-only**, and **not** assumed reachable by one-step Instant Rollback
- [ ] Activity and lock checks were run, judged against the **Q4 allowlist**, and **repeated immediately** before the migration

**Verification**

- [ ] **Five** migration-history rows before and **ten** after, all finished, none rolled back, every `applied_steps_count = 1`
- [ ] Physical schema verified directly: `tasks.due_local_date`, both reminder tables, constraints validated, indexes valid, reminder enums present, RLS deny-by-default on both tables
- [ ] An **authenticated read-only** Task-list and Task-detail smoke passed
- [ ] **No mutation smoke test was performed** unless separately approved and that approval is referenced
- [ ] **No reminder was created or modified.** The Owner-restraint obligation is acknowledged in evidence

**Prohibitions**

- [ ] **Nothing was pushed**
- [ ] **Nothing was deployed.** The Production deployment ID is unchanged and still serves `ee5e82a`
- [ ] **No feature flag changed.** All three remain absent
- [ ] **No Gmail action was taken.** Gmail remains connected, and no scheduler was created, resumed, or invoked

## Owner web experience foundation (P1; apply when P1 work is in scope)

Gates for D111–D126. Record **expected behaviour and required proof**; no specific implementation is pre-approved.

- [ ] Change stays inside the **nine authorized P1 areas** (D111); nothing from the P1 exclusion list in [MILESTONES.md](MILESTONES.md) was implemented
- [ ] **No optimistic mutation success** — nothing renders, animates, or implies a business mutation succeeded before the server confirmed it (D112)
- [ ] **Ambiguous outcomes stay ambiguous**; pending handoff copy still says the send may or may not have happened (D092, D112)
- [ ] **Ambiguous or transport retry** reuses the **same `Idempotency-Key`** and the **original `If-Match`** so the server can replay a durable attempt; no new-key "start over" after a durable attempt (D112, §2)
- [ ] **Confirmed `412 PRECONDITION_FAILED`** refreshes authoritative state and re-presents it before a new attempt; no silent loop on a known-stale `If-Match`, and a stale conflict is not shown as success or as merely transient (D112)
- [ ] Offline and lost-connectivity states are explicit and truthful; **no mutation queue, no service-worker caching of authenticated business data, no local business-record cache** (D111)
- [ ] Loading affordances used for **reads only**; empty states distinguish "none yet" from "none matched" from "failed to load" (D112)
- [ ] **One correlation reference** joins the user-visible error reference, server diagnostics, and the audit row where one exists — proven by forcing a real failure and tracing a single value (D115)
- [ ] **No capability token and no raw `/c/{token}` path** in any telemetry, log, metric, or error payload — proven by an automated assertion, not review alone (D114)
- [ ] Capability routes remain **excluded from client telemetry** (D114); server diagnostics identify them by static template only
- [ ] No prohibited telemetry payload: no OAuth tokens, email bodies or subjects, Task notes, summary text, communication excerpts, MIME, plaintext Recipient email, or raw provider errors (D114)
- [ ] **Operational telemetry is not treated as audit history, a business record, or a learning signal**; it drives no product behaviour (D113)
- [ ] Observability seam is **vendor-neutral** and application-owned; no commercial telemetry vendor, session replay, or behavioural analytics (D115)
- [ ] **No health or readiness endpoint** added, and none required for closure (D115)
- [ ] Owner dates and timestamps use the **organization** timezone, proven not to depend on browser, device, or machine-local timezone (D117)
- [ ] The display formatter is **not** used as a scheduling resolver; **D103** remains the authority for reminder arithmetic
- [ ] Shell provides one **generic** Owner attention / operational-status destination; **no reminder navigation, copy, or status**, and no claim that automation exists while A8 is unimplemented (D089, D118)
- [ ] `packages/ui` remains a **semantic-token layer only** — no general component library, no Kotlin token generation (D116)
- [ ] Tokens landed as a **no-op refactor first** (identical values, references swapped) before any value change (D116)
- [ ] Every current route has a **loading state, segment error boundary coverage, global error fallback, and not-found state** (D119)
- [ ] **Both** confirmation dialogs validated for keyboard, focus trap, Escape, and focus restoration (D119)
- [ ] Accessibility gate met: **zero serious or critical** automated findings; contrast passes in the shipped theme. Dark mode is **not** required (D119)
- [ ] Browser test layer covers the critical Owner and Recipient journeys and runs as a **separate job**, not inside `pnpm verify` (D119)
- [ ] Structural gates pass: **one** Owner authentication call per Owner page request; documented and asserted maximum database round trips per route (D119)
- [ ] **Baseline captured in P1.1 before any experience change**; numeric thresholds ratified from that evidence, not asserted (D119)
- [ ] **No A8 runtime implementation**; no schema, migration, OpenAPI, generated-client, or Android implementation change; audit and mutation-truthfulness semantics unchanged (D119)
- [ ] Product name unchanged — the current official name still appears in web metadata and shell copy; no implicit rename (**D120**, Open)

### Owner shell and presentation (P1.4; D121–D126)

- [x] Route group `(owner)` changes **no public URL**; `/`, `/login`, `/auth/**`, and `/c/{token}` remain outside Owner chrome; proxy pathname matching unchanged (D111)
- [x] `/` is **not** globally redirected to `/tasks`, and keeps its authenticated and unauthenticated behaviour
- [x] Build-output paths moved with the route group — **NFT manifest paths and any tooling that reads them were updated**, and Prisma engine tracing still resolves for both Task routes
- [x] Exactly **one verified `getUser()` per Owner page request** across layout **plus** page, measured at the real Auth HTTP layer — **not** by counting source call sites (D119)
- [x] Render-pass memoization introduces **no cross-request cache**: sequential and concurrent request counts scale with request count
- [x] Shell emits **no second `owner_authentication` timing event**, so the P1.3 duplicate-auth diagnostic stays meaningful
- [x] Shell adds **zero database queries** and **no client fetch**; no layout-induced sequential DB waterfall
- [x] Product name is **not** an `<h1>`; each page retains exactly **one page-owned `<h1>`**
- [x] Navigation is **only** Tasks, Attention, and Sign out — no Recipients, Gmail settings, suggestions, reminders, administration, or health entry, and no empty or future destination (D089)
- [x] Active navigation uses `aria-current="page"` **plus** a non-colour-only treatment; `/tasks/{taskId}` keeps Tasks current
- [x] Chrome persists across loading and error boundaries; neither declares its own container or navigation
- [x] Sign-out is **POST only** with no `GET` handler, revokes **server-side** at Supabase, redirects **303**, and is not reachable by `next/link` prefetch (D123)
- [x] Sign-out required **no OpenAPI or generated-client change** (D123)
- [x] `/attention` made no claim it could not keep: at P1.4 it was truthfully empty and read nothing; since **A8.6a** it reads one bounded query and still claims no queue, no monitoring, and no automatic updating (D118, D121 — see the A8.6a section)
- [x] Owner display timezone is a **documented constant**, not an environment variable or schema field; an invalid zone **fails loudly** rather than falling back to machine-local time (D122)
- [x] Every rendered date-**time** carries a zone indicator; Owner timestamps are formatted **server-side** so no hydration mismatch is possible
- [x] Timezone proven under `TZ=UTC`, `TZ=Asia/Tokyo`, **and** a non-Vancouver **browser** timezone, including both DST boundaries (D117)
- [x] Task presentation is **visual only** over existing DTO fields: no filter, section, grouping, sorting change, count, attention queue, new state, or new rule; **list order unchanged** (D126)
- [x] Status/urgency mappings are **exhaustive over the contract enum**, so a new contract value fails the build rather than rendering unlabelled
- [x] `due_soon`/`overdue` presented as **due-date facts**, never as reminder automation (D089, D103, D126)
- [x] Note-bound wording states what **was shown** and does not claim more notes exist; no truncation metadata added (D126)
- [x] Long titles, notes, summary points, emails, and identifiers wrap — proven by asserting **zero horizontal document overflow**, not by screenshot
- [x] `packages/ui` contains **no `.ts`/`.tsx`/`.js` file** and no React component; token values pinned equal to their pre-refactor literals (D124)
- [x] No `server-only` module, Prisma client, or observability import reached a client component or the client bundle
- [x] Task detail is server-rendered and A7 **handoff behaviour is unaffected** by removing `'use client'`
- [x] No P1.4 audit script or e2e tooling leaked into the production bundle
- [x] Production validation passed on commit `a38c857` / deployment `dpl_F5zjNcc4zwiwbr25CSdMGA3zDy8c` ([P1_4_EVIDENCE.md](P1_4_EVIDENCE.md) §13)

### P1 closure (P1.5; D112, D114, D119)

- [x] Application boundaries complete — global error fallback, segment error coverage, styled not-found, and the `/c/{token}` loading boundary
- [x] Unauthenticated Owner routes return a true **307** with the deep link preserved and **no** Owner chrome painted first (resolves OPEN #23)
- [x] Recipient presentation corrected — no title/summary duplication, deterministic organization-timezone timestamps, canonical `--aicaa-*` tokens
- [x] Recipient confirmation dialogs have keyboard, focus-containment, Escape, focus-restoration, and status-announcement behaviour (D119)
- [x] Automated accessibility gate met — **28 local scans, 0 serious, 0 critical**, no rule disabled; production scans 0 findings at every impact level (D119)
- [x] Production diagnostics show **exactly one** `owner_authentication` span per Owner document request and **zero** on capability routes; no raw `/c/{token}` path in any application diagnostic (D114, D119)
- [x] Production validation passed on commit `8588c5d` / deployment `dpl_7vmnL71Lck7JLeftgsJkYVJ4uw82` ([P1_5_EVIDENCE.md](P1_5_EVIDENCE.md))
- [x] **Evidence limitation recorded, not hidden** — the valid Recipient capability workflow is unvalidated in production because no safe synthetic-capability path exists; classified as an intentional production-safety limitation, **not** a defect ([P1_5_EVIDENCE.md](P1_5_EVIDENCE.md) §6)
- [x] **Handoff-confirmation critical journey covered at browser level** in the separate e2e job — identification, cancellation, Escape, confirmed submission, truthful failure, and duplicate-submission prevention; Gmail **delivery** deliberately still not browser-tested (D119) ([P1_5_EVIDENCE.md](P1_5_EVIDENCE.md) §11)
- [x] **Full `pnpm verify` green** — all twelve stages ran unmodified with local JDK 17, `contracts:check-drift` clean, confirming no contract or generated-client change (D119) ([P1_5_EVIDENCE.md](P1_5_EVIDENCE.md) §12)
- [x] **All 18 P1 acceptance criteria met** — the two that were unchecked at the first closeout attempt were closed on their merits, not reworded ([MILESTONES.md](MILESTONES.md))

## Documentation

- [ ] Docs updated **before** or as part of completion (Engineering Rule #1)
- [ ] [GLOSSARY.md](GLOSSARY.md) terms used consistently
- [ ] [WORKFLOWS.md](WORKFLOWS.md) updated if user-visible flow changed
- [ ] [DOCUMENTATION_INDEX.md](DOCUMENTATION_INDEX.md) still accurate if files added
- [ ] No contradiction with [PROJECT_CONSTITUTION.md](PROJECT_CONSTITUTION.md)
- [ ] README status/hierarchy still accurate

## AI behaviour

- [ ] No invented facts, deadlines, contacts, commitments, properties, money, follow-up dates, or due dates as facts ([AI_CONSTITUTION.md](AI_CONSTITUTION.md))
- [ ] Facts / inference / missing / low-confidence distinguished in outputs
- [ ] Recommendations include rationale and confidence where applicable
- [ ] No silent advance of the learning ladder
- [ ] Task creation, assignment email/forward, and any due date that drives reminders still require an explicit Owner act in v1 (D102)
- [ ] Durable learning does not store raw message bodies
- [ ] Invalid model output quarantined rather than guessed

## Security

- [ ] Server-side Owner session checks on Owner mutating APIs
- [ ] Capability token validation (scope, expiry, task binding) on Recipient mutating APIs
- [ ] GET on capability routes is non-mutating; POST requires explicit confirmation (D050)
- [ ] Capability possession treated as authorization, not verified identity (D051)
- [ ] Recipient audit events do not overstate identity (D052)
- [ ] No unauthenticated one-click mutations
- [ ] Capability links use expiring tokens; hashes stored server-side, not raw tokens
- [ ] Capability link rotation/invalidation applied on reassignment/re-forward (D086: revoke prior active capability; “no longer active” for revoked links)
- [ ] Gmail tokens remain server-side and encrypted at rest
- [ ] Secrets not committed; `.env` patterns respected
- [ ] Recipient identity not hard-coded in source; no env-default Recipient as production model (D087)
- [ ] Audit events recorded for approvals, forwards/handoffs, delivery attempts, reminder scheduling and attempts (D100, D109), Event Notifications, capability use, authz failures
- [ ] A7 handoff does not claim a Reminder Schedule is active; Follow-up Engine / Event Notification Engine remain A8 and unimplemented (D089, D102–D110)
- [ ] Knowingly incomplete Gmail-origin forwards are not sent (D088)

## Privacy

- [ ] Prompt-data minimization applied
- [ ] OTP / financial-alert exclusions respected where detected
- [ ] Contact and source exclusions enforced
- [ ] Notification-access consent and revocation handled honestly
- [ ] Forwarding privacy boundary disclosed (Gmail copies outside app deletion)
- [ ] A7 confirmation UI discloses retention boundary and does not over-promise reminder activation (D089, D094)

## Retention

- [ ] Seven-day excerpt rule not conflated with thirty-day completed visibility
- [ ] Raw audio deleted after successful transcription and validation
- [ ] Failed-transcription policy not silently invented if still Open
- [ ] Retention worker does not attempt to delete Gmail mailbox forwards
- [ ] Learning extraction does not keep raw bodies
- [ ] Failed deletion retry/alert behaviour considered

## Cost

- [ ] Heuristic / cheap filter before expensive AI where appropriate
- [ ] No unnecessary new paid service (free tiers first-class per D079; paid only for measurable benefit)
- [ ] FCM not added without documented justification
- [ ] Polling/AI frequency within acceptable cost/quota assumptions
- [ ] Security / AuthZ / audit not weakened to save cost (D079)

## Testing

- [ ] Unit tests for domain rules touched (state, retention dates, reminder occurrence computation and idempotency when A8 is in scope)
- [ ] Contract/schema validation for API or AI payloads touched
- [ ] Regression for approval gates (no email without D037 handoff approval)
- [ ] Forward idempotency tested if mailer touched (idempotency key + provider message id, D094)
- [ ] Partial/incomplete forward paths never report full success (D088)
- [ ] Android/notification fixtures updated if parsers changed
- [ ] Failure paths (reauth, missing SMS body, OpenAI down) considered
- [ ] Default full-`pnpm verify` gate satisfied unless a narrower scope was explicitly authorized (see Environment and verification)

## UX

- [ ] Android-first flows remain usable; Recipient capability path stays minimal
- [ ] Approval boundaries visible before consequential sends
- [ ] Manual and voice fallbacks available when capture fails
- [ ] Best-effort call/notification limitations not over-promised in UI copy
- [ ] Cognitive load: point-form, clear next action, no dashboard creep
- [ ] Interface states what is true: no optimistic success, ambiguous stays ambiguous, stale data labelled as of a stated time (D112)
- [ ] Copy does not claim a capability the milestone has not shipped — notably no implied reminder, schedule, or notification behaviour while A8 is unimplemented (D089)

## Technical debt

- [ ] New debt listed explicitly (comment + OPEN_QUESTIONS or milestone note)
- [ ] No “temporary” hardcoded Recipient emails or domains; no env-default Recipient as production model (D087)
- [ ] No skipped authorization “to unblock demo”
- [ ] Generated clients not hand-edited without regenerating from contract

## Documentation drift

- [ ] Implementation does not disagree with docs (Rule #2); if it did, docs were intentionally updated first
- [ ] DECISIONS statuses still accurate (Approved / Deferred / Open)
- [ ] OPEN_QUESTIONS not treated as resolved without recording answers
- [ ] Milestone checklist in MILESTONES still reflects reality after this work
