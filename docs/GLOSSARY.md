# Glossary

Canonical definitions. Other documents use these meanings; they do not redefine them.

---

## Roles and access

### Authenticated User

In version one: the **Owner** only. There is no second application login.

### Owner

The single authenticated application user. Signs in with Google Workspace via Supabase Auth. Primary interface: Android. Approves suggestions, assignments/forwards, and durable learning (D054).

### Recipient

A delegated person identified by email. Receives assignment emails and acts through capability links. **No** application account or Session (D049).

**May (via capability):** view assigned task; complete; waiting/resume; notes; return to Owner; request clarification; submit work request → Task Suggestion.

**May not:** create standalone tasks; approve learning; change rules/policies; create automations; snooze.

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

Candidate work that is **not** yet a Task. Requires Owner approve/edit/dismiss/merge. Voice-originated work starts here (D038). Recipient work requests become Suggestions.

### Task

Approved actionable work with status, summary, assignment attribute, scheduling, and audit. Never created directly by voice (D038).

### Assignment

Persisted binding of a Task to a Recipient (and intended email), including allowed Recipient actions for that handoff. Assignment is an **attribute of the Task**, not a Task status ([STATE_MACHINE.md](STATE_MACHINE.md)). A Task may have historical assignment rows over time; at most one assignment is active.

For Gmail-origin handoffs, approval of assignment and Gmail forward is one confirmation (D037).

Assignment ≠ Capability: assignment records who should receive work and which actions are allowed; a Capability is the issued authorization grant for an active assignment.

### Capability

Server-side authorization grant bound to a Task and Assignment: scope (Capability Scope), status, issue/expiry times, and lookup hash of the secret. Multi-use until invalidation (D056). Possession of the matching secret authorizes actions; it does not prove who clicked the link (D051).

### Capability Scope

The set of Recipient actions a Capability permits. Derived from (and never broader than) the active Assignment’s allowed actions.

### Capability Link

Task-specific URL carrying the capability secret (`/c/{token}`). GET is non-mutating; POST mutations require explicit confirmation (D050, D059).

### Capability Auth

Authorization model for Recipient actions via a valid Capability—not a sign-in mechanism.

### Summary Point

Typed bullet in a structured summary (fact, inference, missing, request, etc.).

### Follow-up

Later Suggestion or Task created because prior work produced further action. Voice follow-ups start as Suggestions (D038).

### Return to Owner / Clarification Request

Recipient capability actions that hand work back or ask the Owner for information without creating a standalone Task.

### Task Outcome

Structured completion record (presets and/or notes).

### Waiting / Snooze

Waiting: pauses reminders until a time. Snooze: Owner-only recalculation of next reminder (Recipients use Waiting).

---

## Communication

### Communication Event / Temporary Communication / Source Type

Minimized inbound signal record; temporary stored content under retention; origin class (Gmail, Messages, call, voice, manual).

---

## Reminders and retention

### Reminder / Reminder Policy / Reminder Attempt

Scheduled email attention (v1); deterministic policy; idempotent send record.

### Retention / Tombstone

Scheduled delete/scrub of application data; minimal metadata after scrub. Duration after purge: OPEN #12. Does not delete Gmail forwarded copies.

---

## AI and learning

### AI Confidence / Workflow Intelligence / Durable Learning / Learning Signal / Workflow Rule / Learning Ladder

Model certainty metadata; Owner durable preferences without raw bodies (D054); retention class for that knowledge; minimized learning events; proposed if/then rules needing Owner approval; Observe→… ladder in [AI_CONSTITUTION.md](AI_CONSTITUTION.md).

---

## Contracts and audit

### Canonical Contract / OpenAPI

OpenAPI is the sole HTTP contract source of truth (D007). TypeScript/Kotlin are generated from it.

### State Machine

Persisted statuses and transitions; derived urgency labels. See [STATE_MACHINE.md](STATE_MACHINE.md).

### Audit Event

Append-only security/workflow record. For capability actions: truthful capability attribution without claiming verified personal identity (D052, D057).

### Version One / MVP

Ship boundaries in [PRODUCT_SCOPE.md](PRODUCT_SCOPE.md).
