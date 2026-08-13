# Glossary

Canonical vocabulary. Other documents use these meanings; they do not redefine them. Below authority: definitions describe the rules, they do not create them.

---

## Roles and access

### Authenticated User

In version one: the **Owner** only. There is no second application login.

### Owner

The single authenticated application user. Signs in with Google Workspace via Supabase Auth. Mobile is the primary product experience; Android is the first native client (D153). Approves suggestions, assignments/forwards, Task due dates that drive reminders (D102), and durable learning (D054). Receives **Event Notifications** (D099).

### Recipient

A delegated person identified by email in an Owner-managed Recipient record (D087). Receives assignment emails and **reminders**, and acts through capability links. Has **no** reminder preferences (D110). **No** application account or Session (D049). A7 may expose minimal list/create/update/inactive management—not a CRM.

**May (via capability):** view assigned task; complete; waiting/resume; notes; return to Owner; request clarification; submit work request → Task Suggestion.

**May not:** create standalone tasks; approve learning; change rules/policies; create automations; own Follow-up Policy.

### Administrator (relationship label)

Optional Recipient label (D053). Not an application role, permission set, or authentication identity.

### Actor

The party responsible for a transition or audit record: Owner (session), capability (link holder), or system. Does not imply personal identity for capability actions.

### Session

Owner authentication state after Google Workspace sign-in. Recipients have no Session.

### Authentication

Verifying the Owner’s identity (Supabase Auth). Recipients are not authenticated.

### Authorization

What an Actor is allowed to do. Owner: session + server checks. Recipient: Capability possession and scope (D051).

### Known Contact

Phone number treated as recognized for completed-call prompts (contact match, Owner-selected, or tracked). Unknown completed calls do not always prompt.

---

## Work objects

### Task Suggestion

Candidate work that is **not** yet a Task. Rocket’s **single shared proposal domain** (D157, D161) — do not introduce a parallel CandidateTask store. Requires Owner approve/edit/dismiss/merge. Voice-originated work starts here (D038). Recipient work requests become Suggestions. One interpretation occurrence may produce **0..N** TaskSuggestions (D161). A6 approve creates an **unassigned Task** only (D080); Recipient handoff is A7 via `POST /api/v1/tasks/{taskId}/handoff` (D037, D090). Optional AI `proposedRecipientHint` may map to `proposedRecipientId` only via deterministic match to an active Recipient—never auto-assign (D094). The suggestion row is the mutable operational proposal head; append-only revisions preserve revision 0 as presented to the Owner (D155).

### Interpretation occurrence

Persisted grouping/provenance for one interpretation act. Current carrier: `InterpretationRun` / `interpretation_runs` in `@aicaa/db` (not constitutional table naming). Stores completed successful outcomes only (`proposals_created` / `no_proposals`). The persistence foundation was established inert under D161; **D169** authorizes the shared application producer wiring, and **S3.1 is implemented as backend infrastructure** — an interpretation application service writes occurrences and their proposals atomically, with no Production activation. **D170** authorizes S3.2 Owner `POST /api/v1/manual-captures` as the first HTTP adapter, and **it is implemented**; the public response exposes no `interpretationRunId`, and a contract test holds that boundary. **D171** authorizes S3.3 Android capture-to-proposal client reachability for that route, and **it is implemented**, including read-only display of returned proposals. S3 for Owner manual capture is **complete** at that locked capture-to-proposal boundary; full proposal-lifecycle UI remains unauthorized and unimplemented. Not canonical Task truth. One occurrence may yield zero, one, or multiple TaskSuggestions. Multiple legitimate occurrences may reference the same source; there is no one-interpretation-forever-per-source invariant. Owner-initiated idempotency uses `(organizationId, idempotencyKey)` plus request fingerprint (D161). Zero proposals is truthful success for Owner-initiated interpretation. `interpretationRunId` is internal provenance and is not part of the public TaskSuggestion contract (D169, D170, D171).

### Task

Approved actionable work with status, summary, assignment attribute, optional **due date** (an Owner-selected local calendar date that is the deadline and the D106 overdue input when present — D102; the D105 advance reminder is independently Owner-optional — D178), and audit. Never created directly by voice (D038). A6 suggestion approval yields an unassigned Task (D080). Owner/self work remains unassigned (D094) — an operational representation, never evidence that the Owner affirmatively chose to be responsible (see **Responsibility selection**).

### Responsibility selection

The single question Owner acceptance of a proposal asks — **“Who is responsible for this Task?”** — answered by the **Owner (Me)** or an external **Recipient** (D164). There is no separate Owner-facing Keep action. It is **affirmative**: it exists because the Owner made the choice, and is never inferred from the presence or absence of an Assignment (D155). Choosing **Me** requires no Assignment to the Owner. **D168** has settled and authorized a bounded implementation slice for a dedicated **append-only responsibility-selection evidence record** in the D155 evidence family: the Owner's **initial** affirmative decision at proposal acceptance. It is not canonical Task state, current custody, TaskAssignment, delivery, a current-responsibility projection, or a responsibility-history state machine. Absence of the evidence record, TaskAssignment, Recipient, or handoff never means **Me**. The D168 carrier is **implemented** in `@aicaa/db` as `task_suggestion_responsibility_selections` and remains **dormant**: it is not a public read API, current-responsibility projection, or follow-through authorization.

### Assignment

Persisted binding of a Task to an external Recipient (and intended email), including allowed Recipient actions for that handoff. Assignment is an **attribute of the Task**, not a Task status ([ARCHITECTURE.md](ARCHITECTURE.md) § Domain state model). A Task may have historical assignment rows over time; at most one assignment is active. Delivery outcomes: `pending` / `sent` / `failed` (D092). Activate only after Gmail accepts send.

For Gmail-origin and non-Gmail handoffs, approval of assignment and outbound mail is one confirmation (D037). A6 does not create Assignments (D080). **Reminder Schedules** are Task-scoped and owned by A8 (D089, D104).

Assignment ≠ Capability: assignment records who should receive work and which actions are allowed; a Capability is the issued authorization grant for an active assignment. At most one **active** capability per Assignment; re-forward/reassignment revokes the prior (D086).

### Active Assignment

An Assignment that is the current binding for the Task (`cleared_at` unset / not returned) and has not been superseded by reassignment. See [ARCHITECTURE.md](ARCHITECTURE.md) § Domain state model.

### Follow-up eligible Assignment

An **active** Assignment whose delivery status is **`sent`**, whose Task is not terminal (`completed` / `dismissed`), that is not suspended by **waiting**, and whose capability/Assignment has not been terminated. Under D104 the Reminder Schedule is Task-scoped and may exist without one, but **Recipient reminder delivery requires** these conditions; otherwise the occurrence is recorded as skipped without consuming the local calendar day (D107).

### Capability

Server-side authorization grant bound to a Task and Assignment: scope (Capability Scope), status, issue/expiry times, and lookup hash of the secret. Multi-use until invalidation (D056). Possession of the matching secret authorizes actions; it does not prove who clicked the link (D051). Revoked capability records and audit history are preserved. A positively matched capability with internal supersession reason (re-forward/reassignment) may fail with `CAPABILITY_NO_LONGER_ACTIVE` (D086); all other unusable or unmatched capability cases remain generic `UNAUTHORIZED`.

### Capability Scope

The set of Recipient actions a Capability permits. Derived from (and never broader than) the active Assignment’s allowed actions.

### Capability Link

Task-specific URL carrying the capability secret (`/c/{token}`). GET is non-mutating; POST mutations require explicit confirmation (D050, D059). A7 base URL: `NEXT_PUBLIC_APP_URL` (D094).

### Capability Auth

Authorization model for Recipient actions via a valid Capability—not a sign-in mechanism.

### Summary Point

Typed bullet in a structured summary (fact, inference, missing, request, etc.).

### Next-action Suggestion

New work proposed because prior work produced further action (for example after completion). Always begins as a **Task Suggestion** requiring Owner approval (D038). Voice-originated next actions start here.

**Terminology note:** Canonical product/docs term is **Next-action Suggestion**. OpenAPI retains the wire/schema name `FollowUpProposal` during A8 as **temporary contract naming debt** (do not rename in A8.0; breaking rename only under a later contract-versioning plan). Must not be confused with the **Follow-up Engine** (D102).

### Return to Owner / Clarification Request

Recipient capability actions that hand work back or ask the Owner for information without creating a standalone Task. These are Event Notification Engine inputs (D099). They do not change reminder cadence, which derives from the due date (D102–D106) and the D178 advance preference, beyond the delivery-eligibility and suspension rules in D107.

### Task Outcome

Structured completion record (presets and/or notes).

### Waiting

Recipient or Owner suspension of actionable work until `waiting_until`. **Waiting suspends** the Reminder Schedule and is the **only** pause mechanism (D097, D101, D107); no partial elapsed time is preserved. On resume, the next **future** 09:00 organization-local occurrence is computed with no backlog. Recipients use Waiting; they do not own Follow-up Policy.

### Due date

Optional Owner-selected **organization-local calendar date** on a Task. When present it is the **authoritative Task deadline** and the deterministic scheduling input for D106 overdue follow-through (D102). The D105 automatic advance reminder is independently Owner-optional (D178) and is **not** implied by the mere presence of a due date. The Owner selects **no** due time; reminder occurrences are fixed at 09:00 organization-local (D103). AI may recommend a due date; only an explicit Owner selection has effect (D027, D102).

**`dueAt`** is the existing instant-typed field retained temporarily for contract compatibility. Under D109 the authoritative representation is a local **calendar date**, persisted since A8.3a as `tasks.due_local_date` (D128) and never backfilled from `dueAt`. Task reads additionally expose canonical `dueLocalDate`; current due-date read semantics and derived `due_soon` / `overdue` use that local date, not `dueAt` (D177). `dueAt` is not removed, migrated, or reconstructed.

### Reminder Schedule

The **Task-scoped** scheduling state derived from a Task's due date: at most one per Task, surviving reassignment, carrying the current **generation**, status, advance-occurrence disposition, next overdue occurrence, per-generation overdue delivered count, and `requiresOwnerAttention` (D104, D109). D178 additionally authorizes an Owner preference controlling whether the existing D105 advance occurrence is enabled. Supersedes the Assignment-scoped Follow-up Schedule (D096). **Maintained and processable, but never delivered:** Owner reminder APIs, lifecycle wiring, occurrence processing, and the overdue Gmail transport exist; A8 migrations are applied. Delivery and enablement remain controlled separately — with the flag unset no transport is constructed, no cron job invokes the worker, and nothing has been sent.

### Reminder occurrence

A single scheduled reminder moment: **09:00 organization-local** on a specific local calendar date, resolved individually to an absolute instant for execution and audit (D103). Either the one **advance** occurrence on the day before the due date when that reminder is enabled (D105, D178) or an **overdue** occurrence on a calendar day after it (D106). The two differ in how much lateness they tolerate. An overdue occurrence stays owed however late a worker reaches it, because the Task is still late. The advance occurrence may be delivered only during its own local calendar day and is recorded as `advance_window_elapsed` afterwards, because its content is that the Task is due tomorrow and that stops being true at midnight (A8.4b.3).

### Schedule generation

A monotonically increasing marker opened by a **material due-date change** — the Owner selecting a different local calendar date. Prior generations' attempts, counts, and audit are preserved; the new generation's overdue delivered count starts at zero; and in-flight work is invalidated by a generation check immediately before send (D104). Saving the same due date opens no generation.

**Not** the A7 handoff **send generation** ([ARCHITECTURE.md](ARCHITECTURE.md)), which is an internal per-attempt counter used to reject stale Gmail send results. The two are unrelated.

### Reminder delivery attempt

One processed reminder occurrence with its outcome (`sent` / `failed` / `skipped`), truthful skip or failure reason (for example `advance_window_elapsed`), generation identity, and a server-derived idempotency identity enforced by a database constraint (D109). Durable and privacy-safe (D100); superseded rather than deleted or rewritten. Contains **no** capability token or capability URL. Since A8.4a the row also carries its processing lifecycle — see **Occurrence claim** — and a retry reuses this same row rather than creating a second one, because the occurrence, not the attempt, is the identity.

### Occurrence claim

The bounded lease a worker takes on a single reminder occurrence before processing it (A8.4a): a claim owner, an acquisition time, an expiry, and a monotonic **fencing token** (`claim_sequence`) that every subsequent state change must present. It is the **duplicate-prevention authority** — the schedule-level claim is only a scan hint, and losing that hint costs duplicated work but never a duplicated send. An expired claim is recovered by one of two rules, decided entirely by whether `provider_call_started_at` was written **before** the transport was invoked: without it nothing left the building and the occurrence is reclaimed; with it a provider may hold the message and nobody can prove otherwise, so the occurrence is finalized **ambiguous**, consumes its local calendar day, and is never retried.

### Ambiguous outcome

A terminal reminder occurrence outcome meaning the provider may or may not have delivered and the truth is not recoverable — typically a worker that died between starting a provider call and recording its result. It is terminal by design: retrying would risk a second real email about the same morning, which is worse than a missed one. It consumes the local calendar day, is never counted toward the overdue ceiling, and never carries provider acceptance metadata, because the whole content of the outcome is that acceptance is unknown. A8.4b.1 widened how one arises: besides a worker dying mid-call, a provider timeout, an unparseable response, or a `2xx` carrying no message id is ambiguous rather than sent. **D129** stops a schedule after **three consecutive** terminal ambiguous **overdue** outcomes within one generation, with reason `repeated_ambiguous_outcomes` and `requiresOwnerAttention`, counted by **deriving** from history rather than storing a counter. **Enforced as of A8.4b.2**, at the moment the third occurrence's outcome is applied to its schedule. "Consecutive" is measured over **finished delivery attempts**, so a confirmed send or a permanent failure breaks the run while a **skip does not** — a skip contacted no provider and is therefore evidence of nothing — and one occurrence counts once however many times it was retried. The third occurrence stays recorded as ambiguous; the stop is a fact about the schedule, not a revision of what happened to the message.

### Reminder email

The message an overdue reminder sends (A8.4b.1, governed by D130). It states that it is an automated reminder, carries the approved Task summary, the organization-local due date and the organization timezone, tells the Recipient to use the **original assignment email** to open or act on the Task, and explains that reminders stop when the Task is completed, dismissed, removed, or placed into Waiting. It contains **no capability link** — no capability URL, token, encrypted URL, `/c/` path, redirect, or Task URL — and no communication excerpts, reminder counts, escalation or "final reminder" wording, internal identifiers, threading headers, CC, or BCC. Because its only instruction is to use the original assignment email, the health of that email's capability is checked before any send: a missing, expired, revoked, never-activated, or already-consumed capability skips the occurrence as `no_actionable_capability` and contacts no provider. A reminder never mints a capability, rotates one, changes an expiry or revocation, or resends the assignment email.

### Overdue ceiling

The bound on daily overdue reminders: **14 successfully delivered overdue reminders per schedule generation**. Retryable failures, permanent failures, skipped occurrences, scheduler claims, and advance reminders do **not** count. On reaching it, Recipient reminders stop, the schedule enters `requiresOwnerAttention`, the Owner is notified, and nothing restarts automatically (D106).

### requiresOwnerAttention

Reminder Schedule state meaning automated follow-through has stopped or been suspended and the Owner must act — for example the overdue ceiling was reached, delivery failed permanently, or there is no active external assignment. It must be surfaced by an Owner notification, not only by a Task page (D106, D108).

---

## Communication

### Communication Event / Temporary Communication / Source Type

Minimized inbound signal record; temporary stored content under retention; origin class (Gmail, Messages, call, voice, manual).

### Application Polling Engine

Application-owned Gmail sync logic: account eligibility, locking, Gmail History ingestion, message minimization, persistence, audit, and error handling. It is invoked by Owner manual sync or by an authenticated endpoint called by an External Scheduler. The scheduler does not own polling logic (D079).

### Application Suggestion Engine

Preserved A6 compatibility/legacy automatic Gmail processing (**D163**): claim-lease eligible CommunicationEvents, heuristic relevance filtering, and LLM extraction via `packages/ai` using the A6 `SuggestionExtractionResult` contract (D085, D161). Invoked by `POST /api/v1/internal/suggestions/process` from an External Scheduler (D084). CommunicationEvent claim/lease/process-state remains the automated-processing authority for this path (D081 idempotency intent; cardinality superseded by D161). Must not run inside Gmail History sync transactions (D075, D084). Distinct from Owner/shared interpretation (`InterpretationResult`), which is the future product AI job. **Not** a dependency target for new Rocket capabilities; future automatic Gmail intelligence should preferentially use the shared interpretation/proposal architecture rather than extend this engine (**D163**).

### External Scheduler

Infrastructure that invokes an authenticated application endpoint on a schedule. The recommended initial adapter while on Vercel Hobby is **cron-job.org**; Vercel Cron, GitHub Actions, Google Cloud Scheduler, AWS EventBridge, and other compatible schedulers are interchangeable. The scheduler remains replaceable and must not contain business logic or access the database directly (D079).

### Authenticated Endpoint

Application HTTP entrypoint protected by Owner session, Capability, or internal Bearer authentication. External infrastructure may invoke it, but authorization and business rules remain in the application.

### Infrastructure Adapter

Replaceable integration layer for hosting, scheduling, storage, messaging, or cloud services. Adapters connect infrastructure to application-owned behaviour without moving business logic into the vendor platform (D079).

---

## Follow-up and Event Notification

### Follow-up Engine

**Due-date-driven, Task-scoped** engine that sends **Recipient** reminders derived from the Owner-selected Task due date (D102). The D105 advance occurrence is independently Owner-optional (D178); D106 overdue follow-through continues when that preference is OFF. This is the **current A8 implementation** of due-date-driven follow-through — one reminder/follow-through mechanism, not an escalation engine, and **not** a product-law bar on Owner-controlled Task reminders (D152). Its delivery paths are Recipient-oriented throughout, so an Owner-responsible Task receives nothing from it today — an open D164 seam. Authoritative engine rules and the seam: [WORKFLOWS.md](WORKFLOWS.md) §10a.

### Follow-up Policy

Deterministic rules governing occurrence computation, the independent D178 advance-enablement preference, the advance-reminder skip rule, daily overdue recurrence, the overdue ceiling, eligibility, suspension, and stopping (D102–D107, D178). Owned by the application; never by the LLM. The A8.0 Phase 1 preset / Phase 2 interval policy is retired (D095 superseded in part).

### Event Notification Engine

Event-driven engine that notifies the **Owner** about meaningful domain events (D099). Separate from the Follow-up Engine. Push/FCM delivery remains deferred (D017); A9 concern for Android push. **Product law locked at A8.5.0 (D133–D136); A8.5a implements the intent store and one producer, A8.5b the delivery state machine and its worker, A8.5c the email renderer, destination resolution, real Gmail adapter, and self-ingestion marker, A8.5d the producers for all ten event types plus the durable capability-expiry observation, and A8.5e the two-phase worker that wires capability-expiry capture behind its own flag. Complete and wholly inert: both flags are unset everywhere, so the worker endpoint opens no database connection and constructs no transport, no cron job invokes it, and no Owner notification has been sent. A8.6 and A8.7 remain required.** Its scope is exactly ten canonical event types, its intent is written in the triggering mutation's own transaction rather than derived from the audit log, its destination is resolved at delivery time from the connected `CommunicationAccount`, its delivery policy is one-shot and deliberately declines D129 and D106, and both of its feature flags are unset everywhere. Authoritative rules: [WORKFLOWS.md](WORKFLOWS.md) §10b.

### Owner Notification Intent

The durable record that a notifiable Owner event occurred and has not yet been delivered (D133). Written in the **same database transaction** as the triggering mutation, so a mutation cannot commit without it and a rolled-back mutation cannot leave one. Its identity is server-derived — `(organizationId, eventType, subjectKind, subjectId, occurrenceKey)`, unique in the database, with no caller-supplied idempotency key — which is what makes a legitimate repeat representable while a retry cannot duplicate. Distinct from an **Audit Event**, which records what happened but cannot say what is still owed, and distinct from an **Owner Notification Attempt**, which is the append-only provider history for one intent. Stored in `owner_notification_intents` since A8.5a and written only when `ENABLE_OWNER_EVENT_CAPTURE` is exactly `"true"`. Since A8.5b the worker can claim and settle one; since A8.5c it can render and address a real message from one; since A8.5d **all ten ratified event types produce one**, each from the transaction that durably establishes its event — the A4 Task unit of work, the A7 terminal handoff failure, the Gmail channel-unavailable transition, A8.4b reminder settlement, and the shared capability-expiry transaction. Since A8.5e the worker also **creates** one without a Recipient's involvement, through the capability-expiry capture phase. All still behind unset flags, and an intent older than twenty-four hours is suppressed rather than delivered, so no backlog accumulated while delivery is off can ever flush.

### Owner Notification Attempt

One row of append-only provider history for a single **Owner Notification Intent**, in `owner_notification_attempts`. Created **before** the transport is invoked, with outcome `in_flight`, and settled afterwards to `sent`, `failed_retryable`, `failed_permanent`, or `ambiguous`. Writing it first is what makes a crashed worker recoverable truthfully: an attempt still `in_flight` past its intent's lease is durable evidence that a provider was contacted and the answer is unknown, which is terminal as ambiguous rather than retried. An attempt exists only where a transport was genuinely invoked — stale suppression, disabled delivery, a lost claim, and an already-terminal intent all create none, because a row asserting a provider call that never happened would be the one thing this history must not say.

### Owner Notification Claim

The lease a worker takes on an intent before processing it, with a `claimSequence` fencing token, a claim owner, and an expiry. Taken by compare-and-set (the A8.4a pattern) rather than by row locking, and carried into every subsequent write, so a worker whose lease was superseded while it was calling a provider cannot settle. An expired claim is recovered by a later invocation: released back to pending work when no attempt began, terminalized as ambiguous when one did.

### Owner Notification Destination

The mailbox an Owner Event Notification is sent to: `CommunicationAccount.emailAddress` for the organization named on the intent, resolved fresh at delivery time and **never persisted** on an intent row, an attempt row, an audit event, a log line, or a worker response (D134). It is also the sender, since Owner notifications are sent from the connected account to itself. Not a parameter: the A8.5c transport exposes no destination input, so nothing on a request, a session, an environment variable, a Task, a Recipient, or event metadata can select one. `OWNER_ORGANIZATION_ID`, where configured, only asserts agreement with the intent's organization and fails closed on mismatch rather than redirecting.

### Capability Expiry Observation

The single durable transition that records an active capability's time having run out (A8.5d, D133). A compare-and-set on `status = 'active' AND expiresAt <= at`, followed in the same transaction by the truthful `system`-attributed audit event and the `capability.expired` notification intent, all written only by the caller whose update won. It exists because `expiresAt` passing is not a write: before A8.5d an untouched capability stayed `active` in the database indefinitely while every reader treated it as expired, and an event nobody recorded is an event nobody can be told about. Both observers converge on it — a Recipient presenting a lapsed token and a sweep scanning for them — so a race produces one transition, one audit event, and one intent rather than two of each. Its instant is an argument rather than a clock read, as everywhere in `packages/db` (D103). Since A8.5e `runCapabilityExpirySweep` is the Owner notification worker's **capture phase**, gated on `ENABLE_OWNER_EVENT_CAPTURE` alone and bounded to fifty capabilities per invocation, earliest expiry first — because whether a lapse becomes durable must not depend on whether mail can be sent. **The flag is unset everywhere and no cron job invokes the endpoint**, so expiry is still observed only on the Recipient path and is not swept on any schedule. Authorization never depended on any of this: an expired capability is unusable whether or not the sweep ran, capture is enabled, or a notification was delivered.

### Rocket-Generated Marker

The fixed header `X-Rocket-Generated: owner-event-notification` that Rocket stamps on its own Owner Event Notification mail so Gmail ingestion can skip it (D136). Emitted only by the controlled MIME builder, which owns the header name and accepts only the ratified value, so callers cannot supply arbitrary headers or a duplicate. Recognized on ingestion only as **exactly one exact marker among the top-level headers** — nested-part headers are ignored, since a forwarded copy of a Rocket notification would otherwise claim the exclusion. Duplicate, empty, and near-miss values fail closed and stay ingestible. Distinct from the `SENT` label and from sender identity, neither of which the exclusion consults: ordinary self-sent Owner mail remains ingestible under the unchanged D068 rules.

### Event Notification

A single Owner-facing notification produced by the Event Notification Engine for a domain event (for example completion, clarification, return, delivery failure, Gmail disconnect, capability expiry). In A8, delivered by **email via the Owner’s connected Gmail** (D099). Push/FCM remains deferred (D017).

### Retention / Tombstone

Scheduled delete/scrub of application data; minimal metadata after scrub. Duration after purge: OPEN #12. Does not delete Gmail forwarded copies.

---

## AI and learning

### AI Confidence / Workflow Intelligence / Durable Learning / Learning Signal / Workflow Rule / Learning Ladder

Model certainty metadata; Owner durable preferences without raw bodies (D054); retention class for that knowledge; minimized learning events; proposed if/then rules needing Owner approval; Observe→… ladder in [AI_CONSTITUTION.md](AI_CONSTITUTION.md).

---

## Operational data classes (D113)

Four distinct classes. They are never conflated, and one is never derived from another except as stated. Retention: [DATA_RETENTION.md](DATA_RETENTION.md). Privacy boundary: D114.

### Business record

The current operational state of communications, Tasks, Assignments, notes, statuses, Recipients, capabilities, and outcomes. Authority: the application system of record. **May** drive product behaviour.

### Audit history

The truth-preserving record of what actually happened: which **Actor** performed each action, under what authority, and whether it succeeded (D057, D074, D100, D109). Append-only in effect; records are **superseded, never deleted or silently rewritten**. Must never be altered to suit analysis, and must never be derived from operational telemetry.

### Operational telemetry

Health, performance, and reliability measurement that answers only **“is the application working properly?”** — route or operation timing, request failures, retry outcomes, connectivity changes, application and rendering errors, and stale-data presentation.

It is **not** a business record, **not** audit history, and **not** an AI-learning source. It must **never** drive product behaviour, alter business state, or be promoted into learning input (D113). Payload prohibitions and the capability-route exclusion: D114.

### Structured learning signal

A purposefully retained representation of a meaningful Owner decision and its outcome, answering **“what decision was made, what alternatives existed, and what happened afterward?”**

Must never rewrite audit history, and must never be inferred from low-level click or usage tracking. **Passive behaviour, inactivity, and the absence of a correction are not approval and are not decisions** (D113). Human corrections outrank passive usage tracking. **An Owner responsibility selection must never be inferred from the absence of a TaskAssignment** (D155, **D164**). **Recording learning evidence is authorized now** and is dormant — it must not personalize, auto-assign, mutate prompts, train online, or otherwise become autonomous without later authorization (D155). Personalization remains deferred. Manual raw capture input retained for review is not learning evidence (D162). TaskSuggestion revision-evidence storage exists; new A6 AI suggestions prospectively record revision 0 only — Owner-edit capture and accepted-content-revision persistence remain unauthorized (D110, D155, D164). The responsibility-selection evidence record is **implemented** under D168 as `task_suggestion_responsibility_selections` and remains **dormant**.

### Recommendation

An AI-proposed value or option (for example a proposed assignee, priority, or due date). A recommendation is **never** an authoritative business fact and must remain distinguishable from a human-approved decision (D027, D102, D113).

### Automated action

An action performed by the application without a contemporaneous human act, attributed to a **`system`** actor and never to the Owner as though performed manually (D074, D107). Must be reversible, observable, and explicitly authorized.

### Human correction

An explicit Owner act that changes, overrides, or rejects a recommendation or prior value. The highest-value future learning evidence (D113), and the only kind that may be read as a decision.

### Deterministic fallback

The requirement that the core Task lifecycle remains fully operational without AI. AI may assist with identification, suggestion, classification, summarization, prioritization, and recommendation, but is never required for the deterministic workflow (D027, D085, D113).

---

## Owner web experience (P1)

P1 is **complete** ([MILESTONES.md](MILESTONES.md)). Scope and authority: D111–D126. Terms below name shipped presentation concepts.

### Owner Application Shell

The minimum persistent chrome for authenticated Owner routes: consistent navigation, Owner identity context, sign-out access, a `<main>` landmark, and mobile-first layout (D111). It is not a dashboard and adds no business behaviour. Shipped as `apps/web/app/(owner)/layout.tsx` (Next.js route group wrapping `/tasks`, `/tasks/{taskId}`, `/attention`). `/`, `/login`, `/auth/**`, and `/c/{token}` stay outside it. Navigation: Tasks, Attention, sign-out.

### Owner Attention Surface

The Owner-level attention destination in the shell at **`/attention`** (D118, D121). Surfaces schedules needing Owner action and recent failed/suppressed Owner notifications when those records exist ([WORKFLOWS.md](WORKFLOWS.md) §16). With A8 delivery flags unset, both sections are typically empty — emptiness must not be misread as "the surface does not exist."

### Truthful experience state

One of the seven interface states P1 governs — loading, empty, retryable error, ambiguous mutation outcome, offline or lost connectivity, stale data, and mutation in progress (D112). Loading affordances are permitted for **reads only**; **no optimistic mutation success** is permitted; an ambiguous outcome is presented as genuinely uncertain rather than smoothed into success or failure.

### Correlation reference

The single identifier shared across the user-visible API error reference, structured server diagnostics, and the audit row where one exists (D115). Operatively this is the request-scoped **`requestId`** (UUID). `correlationId` remains a separate optional parent/trace field and is not collapsed into `requestId`. RSC `error.digest` is a Next.js framework digest and is not this reference.

### Semantic token

A named design value (colour, type scale, spacing, radius, motion) held in the tokens-only `packages/ui` layer (D116, D124). `packages/ui` is **not** a component library. Shipped as `packages/ui/tokens.css` (no build step).

### Organization-local display

Rendering of dates and timestamps in the configured Owner organization timezone (`America/Vancouver`, D034), never silently using the browser, device, or machine-local timezone (D117). **Presentation only** — D103 remains the sole authority for reminder calendar arithmetic. Owner and Recipient surfaces use the same deterministic organization-timezone presentation (`OWNER_DISPLAY_TIME_ZONE`).

---

## Contracts and audit

### Canonical Contract / OpenAPI

OpenAPI is the sole HTTP contract source of truth (D007). TypeScript/Kotlin are generated from OpenAPI.

### State Machine

Persisted statuses and transitions; derived display labels. See [ARCHITECTURE.md](ARCHITECTURE.md) § Domain state model.

### Audit Event

Append-only security/workflow record. For capability actions: truthful capability attribution without claiming verified personal identity (D052, D057). Reminder scheduling changes, sends, skips, failures, and stop/suspension events require durable privacy-safe history (D100, D109); automated sends are attributed to a **`system`** actor and Owner scheduling changes to the **`owner`** actor (D107).

### Version One / MVP

Ship boundaries in [MILESTONES.md](MILESTONES.md).
