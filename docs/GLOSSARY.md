# Glossary

Canonical definitions. Other documents use these meanings; they do not redefine them.

---

## Roles and access

### Authenticated User

In version one: the **Owner** only. There is no second application login.

### Owner

The single authenticated application user. Signs in with Google Workspace via Supabase Auth. Primary interface: Android. Approves suggestions, assignments/forwards, Follow-up Phase 1 intervals, and durable learning (D054). Receives **Event Notifications** (D099).

### Recipient

A delegated person identified by email in an Owner-managed Recipient record (D087). Receives assignment emails and **Follow-up Attempts**, and acts through capability links. **No** application account or Session (D049). A7 may expose minimal list/create/update/inactive management—not a CRM.

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

Candidate work that is **not** yet a Task. Requires Owner approve/edit/dismiss/merge. Voice-originated work starts here (D038). Recipient work requests become Suggestions. A6 approve creates an **unassigned Task** only (D080); Recipient handoff is A7 via `POST /api/v1/tasks/{taskId}/handoff` (D037, D090). Optional AI `proposedRecipientHint` may map to `proposedRecipientId` only via deterministic match to an active Recipient—never auto-assign (D094).

### Task

Approved actionable work with status, summary, assignment attribute, optional informational `dueAt`, and audit. Never created directly by voice (D038). A6 suggestion approval yields an unassigned Task (D080). Owner/self work remains unassigned (D094).

### Assignment

Persisted binding of a Task to a Recipient (and intended email), including allowed Recipient actions for that handoff. Assignment is an **attribute of the Task**, not a Task status ([STATE_MACHINE.md](STATE_MACHINE.md)). A Task may have historical assignment rows over time; at most one assignment is active. Delivery outcomes: `pending` / `sent` / `failed` (D092). Activate only after Gmail accepts send.

For Gmail-origin and non-Gmail handoffs, approval of assignment and outbound mail is one confirmation (D037). A6 does not create Assignments (D080). **Follow-up Schedules** are Assignment-scoped and owned by A8 (D089, D095–D096).

Assignment ≠ Capability: assignment records who should receive work and which actions are allowed; a Capability is the issued authorization grant for an active assignment. At most one **active** capability per Assignment; re-forward/reassignment revokes the prior (D086).

### Active Assignment

An Assignment that is the current binding for the Task (`cleared_at` unset / not returned) and has not been superseded by reassignment. See [STATE_MACHINE.md](STATE_MACHINE.md).

### Follow-up eligible Assignment

An **active** Assignment whose delivery status is **`sent`**, whose Task is not terminal (`completed` / `dismissed`), that is not suspended by **waiting**, and whose capability/Assignment has not been terminated. Only then may a Follow-up Schedule be active (D096).

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

**Terminology note:** Canonical product/docs term is **Next-action Suggestion**. OpenAPI retains the wire/schema name `FollowUpProposal` during A8 as **temporary contract naming debt** (do not rename in A8.0; breaking rename only under a later contract-versioning plan). Must not be confused with the **Follow-up Engine** (D095).

### Return to Owner / Clarification Request

Recipient capability actions that hand work back or ask the Owner for information without creating a standalone Task. These are Event Notification Engine inputs (D099), not Follow-up Engine cadence changes beyond eligibility termination/suspension rules.

### Task Outcome

Structured completion record (presets and/or notes).

### Waiting

Recipient or Owner suspension of actionable work until `waiting_until`. **Waiting suspends** any active Follow-up Schedule; timers do not preserve partial elapsed time (D097). Recipients use Waiting; they do not own Follow-up Policy.

### dueAt

Optional informational timestamp on a Task (or suggestion refine field). AI-extracted when clearly present; Owner-editable; for display and summary context only. **Never** an input to the Follow-up Engine (D098).

---

## Communication

### Communication Event / Temporary Communication / Source Type

Minimized inbound signal record; temporary stored content under retention; origin class (Gmail, Messages, call, voice, manual).

### Application Polling Engine

Application-owned Gmail sync logic: account eligibility, locking, Gmail History ingestion, message minimization, persistence, audit, and error handling. It is invoked by Owner manual sync or by an authenticated endpoint called by an External Scheduler. The scheduler does not own polling logic (D079).

### Application Suggestion Engine

Application-owned A6 logic: claim-lease eligible CommunicationEvents, heuristic relevance filtering, LLM extraction via `packages/ai`, and persistence of at most one pending TaskSuggestion per event (D081, D085). Invoked by `POST /api/v1/internal/suggestions/process` from an External Scheduler (D084). Must not run inside Gmail History sync transactions (D075, D084).

### External Scheduler

Infrastructure that invokes an authenticated application endpoint on a schedule. The recommended initial adapter while on Vercel Hobby is **cron-job.org**; Vercel Cron, GitHub Actions, Google Cloud Scheduler, AWS EventBridge, and other compatible schedulers are interchangeable. The scheduler remains replaceable and must not contain business logic or access the database directly (D079).

### Authenticated Endpoint

Application HTTP entrypoint protected by Owner session, Capability, or internal Bearer authentication. External infrastructure may invoke it, but authorization and business rules remain in the application.

### Infrastructure Adapter

Replaceable integration layer for hosting, scheduling, storage, messaging, or cloud services. Adapters connect infrastructure to application-owned behaviour without moving business logic into the vendor platform (D079).

---

## Follow-up and Event Notification

### Follow-up Engine

Time-driven, Assignment-scoped engine that sends **Recipient** follow-ups after assignment delivery is `sent` (D095). Not a due-date or escalation engine. Authoritative rules: [WORKFLOWS.md](WORKFLOWS.md) §10.

### Follow-up Policy

Deterministic rules governing Phase 1 presets, Phase 2 standard interval, eligibility, suspension, and termination (D095–D097). Owned by the application; not by the LLM.

### Follow-up Schedule

The active scheduling state for **one Assignment** (Phase 1 or Phase 2). At most one active schedule per Assignment; never transfers between Assignments (D096).

### Follow-up Attempt

One outbound follow-up send (or suppressed/cancelled attempt) under a Follow-up Schedule, with durable privacy-safe history (D100).

### Event Notification Engine

Event-driven engine that notifies the **Owner** about meaningful domain events (D099). Separate from the Follow-up Engine. Push/FCM delivery remains deferred (D017); A9 concern for Android push.

### Event Notification

A single Owner-facing notification produced by the Event Notification Engine for a domain event (for example completion, clarification, return, delivery failure, Gmail disconnect, capability expiry). In A8, delivered by **email via the Owner’s connected Gmail** (D099). Push/FCM remains deferred (D017).

### Retention / Tombstone

Scheduled delete/scrub of application data; minimal metadata after scrub. Duration after purge: OPEN #12. Does not delete Gmail forwarded copies.

---

## AI and learning

### AI Confidence / Workflow Intelligence / Durable Learning / Learning Signal / Workflow Rule / Learning Ladder

Model certainty metadata; Owner durable preferences without raw bodies (D054); retention class for that knowledge; minimized learning events; proposed if/then rules needing Owner approval; Observe→… ladder in [AI_CONSTITUTION.md](AI_CONSTITUTION.md).

---

## Contracts and audit

### Canonical Contract / OpenAPI

OpenAPI is the sole HTTP contract source of truth (D007). TypeScript/Kotlin are generated from OpenAPI.

### State Machine

Persisted statuses and transitions; derived display labels. See [STATE_MACHINE.md](STATE_MACHINE.md).

### Audit Event

Append-only security/workflow record. For capability actions: truthful capability attribution without claiming verified personal identity (D052, D057). Follow-up Attempts require durable privacy-safe history (D100).

### Version One / MVP

Ship boundaries in [PRODUCT_SCOPE.md](PRODUCT_SCOPE.md).
