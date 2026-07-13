# Glossary

Canonical definitions for project terminology. Use these spellings and meanings in all docs and future code names where practical.

If a document uses a synonym, prefer linking back to these terms rather than inventing a parallel vocabulary.

---

## Roles and people

### Owner

The **single authenticated application user** in version one. Signs in with Google Workspace via Supabase Auth. Uses the Android application as the primary interface. Approves task suggestions, Recipient delegations, Gmail forwards, and workflow-rule activation. All durable learning belongs to the Owner (D054).

There is no separate “administrator” application role—only this one authenticated user account.

### Recipient

A delegated person who receives assignment emails and acts on assigned tasks through **task-specific capability links**. Recipients have **no** application account and do not sign in (D049).

Capability possession authorizes Recipient actions; it is **not** verified identity (D051). Audit records must not overstate who acted (D052).

**May (v1, via capability link):** complete tasks; mark waiting; add notes; return task to Owner; request clarification.

**May not (v1):** create standalone tasks; approve AI learning; change workflow rules; change reminder policies; create automations.

Recipient work requests become Task Suggestions for Owner approval.

### Administrator (relationship label)

An **optional label** for a Recipient relationship (for example, a trusted office manager or assistant). It is **not** an application role, permission set, or authentication identity (D053). Documentation and UI may show “Administrator” as a Recipient type when the Owner designates someone in that capacity.

Do not conflate “Administrator” with a second signed-in user or a role guard in the application.

### Known Contact

A phone number or contact the application treats as recognized for completed-call prompting: an on-device contact match, a user-selected contact, and/or a number previously marked for follow-up tracking. Unknown completed calls must not always prompt.

---

## Communication and capture

### Communication Event

A minimized application record of an inbound communication signal (for example Gmail message metadata and truncated excerpt, or a Google Messages / call notification payload). Temporary. Used to drive relevance filtering and task suggestions. Not a permanent archive entry.

### Temporary Communication

Application-stored communication content (excerpts, short-lived capture payloads) subject to deletion under the retention policy (notably the seven-day rule after complete or dismiss). Distinct from copies that remain in Gmail after forwarding.

### Source Type

The origin class of a communication or task (for example Gmail, Google Messages notification, missed call, completed call, voice, manual).

---

## Tasks and suggestions

### Task Suggestion

An AI- or user-drafted candidate for work that is **not** yet an active task. Requires Owner approval (or dismiss/merge/edit) before a Task is created. Version one must not auto-promote suggestions to tasks. All **voice**-originated new work and follow-ups begin as Task Suggestions (D038). Recipient work requests also become Task Suggestions.

### Task

An approved unit of actionable work with status, summary, assignee, scheduling fields, and audit history. Created from an approved Task Suggestion (or Owner typed creation flow). **Never** created directly by a voice interaction (D038).

### Summary Point

A single typed bullet in a structured summary (for example fact, inference, missing, request, commitment, amount, deadline, risk, next action). The atomic unit of summary quality.

### Assignment

The binding of a Task to an assignee (often a Recipient). For Gmail-origin Recipient handoffs, assignment approval and Gmail forwarding are **one** business action with a **single** confirmation disclosing create task, forward original email, forward attachments, and schedule reminders (D037).

### Follow-up

A subsequent Task Suggestion (when voice-created) or Task (only after Owner approval) produced because completion or review of a prior Task created further work. Voice-created follow-ups always start as Task Suggestions (D038). Consequential Recipient assignment still requires Owner confirmation (D037 when Gmail-origin).

### Return to Owner

A Recipient action (via capability link) that hands an assigned Task back to the Owner without creating a new standalone Task.

### Clarification Request

A Recipient action asking the Owner for more information on an assigned Task; does not create a standalone Task.

### Task Outcome

Structured record of how a Task was completed (preset and/or notes/voice-derived fields), including optional extracted facts such as amounts or commitments stated by the user.

### Waiting State

A non-terminal task condition where work is paused until a waiting date/time; reminders are paused until that time elapses or the state changes.

### Snooze

An action that recalculates the next follow-up or reminder time without necessarily introducing a separate persisted status; reminders reschedule accordingly. Owner only in version one (Recipients use Waiting, not Snooze).

---

## Reminders

### Reminder

A scheduled notification (version one: email) that an assignment still needs attention, produced by deterministic policy—not by ad-hoc AI sends.

### Reminder Policy

Configurable rules that determine initial and overdue reminder timing by task type/urgency, escalation behaviour, and business-hours/timezone handling (`America/Vancouver` for version-one planning).

### Reminder Attempt

An auditable, idempotent record of a single reminder send effort (stage, recipients, success/failure, provider identifiers).

---

## AI and learning

### AI Confidence

Structured metadata expressing how certain the model is about an extraction or recommendation. Low confidence should surface uncertainty or request clarification—not invent values.

### Workflow Intelligence

Durable, minimized knowledge about how the Owner prefers to work (preferences, approved rules, anonymized patterns). Must not contain raw message bodies. Belongs to the Owner only (D054).

### Durable Learning

The retention class for Workflow Intelligence and related evaluation signals that may outlive temporary communication content. Owner-scoped only.

### Learning Signal

An anonymized or minimized event derived from Owner corrections, dismissals, merges, reassignments, outcomes, or explicit instructions, used to Observe patterns and later Suggest/Recommend rules.

### Workflow Rule

A durable if/then style preference (assignment, priority, reminder timing, etc.) that begins as **proposed** and becomes active only after explicit Owner approval. Version one does not auto-apply rules.

### Learning Ladder

The ordered autonomy stages: Observe → Suggest → Recommend → Approval → Trusted automation → Approved autonomous behaviour. Advancement requires explicit Owner approval at each stage. See [AI_CONSTITUTION.md](AI_CONSTITUTION.md).

---

## Security and access

### Capability Link

A task-specific URL embedding a secret capability token. **GET** requests are non-mutating (view only). **POST** mutations require explicit confirmation in the Recipient web view (D050). Capability possession is authorization—not verified identity (D051).

Tokens are expiring and auditable; store hashes, not raw tokens. Email prefetchers must not trigger state changes.

### Capability Auth

The authorization model for Recipient actions: possession of a valid, unexpired capability token for a specific task grants the scoped permissions encoded in that capability. No Recipient sign-in session exists.

### Secure Link (legacy term)

Deprecated synonym for capability link in older documentation. Prefer **Capability Link**.

### Audit Event

An append-only record of a security- or workflow-relevant action (approvals, forwards, reminder attempts, retention runs, authz denials). For Recipient actions, record capability use and technical metadata without overstating identity (D052). Narrative payloads may be scrubbed when content purges; what/when and external ids should remain as required.

### Canonical Contract

The single source-of-truth API description: **OpenAPI**. TypeScript and Kotlin models/clients are generated from OpenAPI. JSON Schema may be generated from OpenAPI where useful but is **not** the source of truth (D007). Kotlin does not share Zod/TypeScript types directly.

### OpenAPI

The Canonical Contract format for this project’s HTTP APIs and shared models.

### State Machine

The documented set of persisted task/suggestion statuses and allowed transitions, plus derived UI labels (such as overdue) computed from timestamps and status.

---

## Retention

### Retention

Policy and machinery that delete or scrub application data on schedule (seven-day excerpts, thirty-day completed visibility, immediate successful-audio deletion), without deleting forwarded Gmail mailbox copies.

### Tombstone

Minimal metadata retained after task content scrub (identifiers, timestamps, actors, action types, external Gmail ids) so audit and integrity survive content deletion. Exact duration after purge remains an open question.

---

## Product shorthand

### Version One / v1

The first shippable private system bounded by [PRODUCT_SCOPE.md](PRODUCT_SCOPE.md) inclusions/exclusions and MVP completion definition.

### MVP

Minimum viable product as defined in PRODUCT_SCOPE: private sideload Android + backend + minimal Recipient capability web loop with approval-first Gmail/Messages/voice flows, reminders, and retention—without Play Store, multi-inbox, or Rocket PM.
