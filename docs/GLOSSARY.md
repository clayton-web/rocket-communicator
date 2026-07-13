# Glossary

Canonical definitions for project terminology. Use these spellings and meanings in all docs and future code names where practical.

If a document uses a synonym, prefer linking back to these terms rather than inventing a parallel vocabulary.

---

## Roles and people

### Primary User

The main operator of the product. Uses the Android application as the primary interface. Approves task suggestions, administrator assignments, Gmail forwards, and workflow-rule activation.

### Administrator

The secondary operator in the same Google Workspace organization. Receives assignment emails, opens tasks via secure authenticated links, and uses a minimal web task view. Selected from an authorized Workspace user record—not hard-coded in source. Version one assumes one administrator; schema may allow more later.

**May (v1):** complete tasks; mark waiting; add notes; return task to primary; request clarification.

**May not (v1):** create standalone tasks; approve AI learning; change workflow rules; change reminder policies; create automations.

Administrator work requests become Task Suggestions for Primary User approval (D039).

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

An AI- or user-drafted candidate for work that is **not** yet an active task. Requires Primary User approval (or dismiss/merge/edit) before a Task is created. Version one must not auto-promote suggestions to tasks. All **voice**-originated new work and follow-ups begin as Task Suggestions (D038). Administrator work requests also become Task Suggestions (D039).

### Task

An approved unit of actionable work with status, summary, assignee, scheduling fields, and audit history. Created from an approved Task Suggestion (or Primary User typed creation flow). **Never** created directly by a voice interaction (D038).

### Summary Point

A single typed bullet in a structured summary (for example fact, inference, missing, request, commitment, amount, deadline, risk, next action). The atomic unit of summary quality.

### Assignment

The binding of a Task to an assignee (often the Administrator). For Gmail-origin administrator handoffs, assignment approval and Gmail forwarding are **one** business action with a **single** confirmation disclosing create task, forward original email, forward attachments, and schedule reminders (D037).

### Follow-up

A subsequent Task Suggestion (when voice-created) or Task (only after Primary approval) produced because completion or review of a prior Task created further work. Voice-created follow-ups always start as Task Suggestions (D038). Consequential administrator assignment still requires Primary User confirmation (D037 when Gmail-origin).

### Return to Primary

An Administrator action that hands an assigned Task back to the Primary User without creating a new standalone Task (D039).

### Clarification Request

An Administrator action asking the Primary User for more information on an assigned Task; does not create a standalone Task (D039).

### Task Outcome

Structured record of how a Task was completed (preset and/or notes/voice-derived fields), including optional extracted facts such as amounts or commitments stated by the user.

### Waiting State

A non-terminal task condition where work is paused until a waiting date/time; reminders are paused until that time elapses or the state changes.

### Snooze

An action that recalculates the next follow-up or reminder time without necessarily introducing a separate persisted status; reminders reschedule accordingly. Primary User only in version one (Administrators use Waiting, not Snooze—D039).

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

Durable, minimized knowledge about how the Primary User prefers to work (preferences, approved rules, anonymized patterns). Must not contain raw message bodies.

### Durable Learning

The retention class for Workflow Intelligence and related evaluation signals that may outlive temporary communication content.

### Learning Signal

An anonymized or minimized event derived from user corrections, dismissals, merges, reassignments, outcomes, or explicit instructions, used to Observe patterns and later Suggest/Recommend rules.

### Workflow Rule

A durable if/then style preference (assignment, priority, reminder timing, etc.) that begins as **proposed** and becomes active only after explicit Primary User approval. Version one does not auto-apply rules.

### Learning Ladder

The ordered autonomy stages: Observe → Suggest → Recommend → Approval → Trusted automation → Approved autonomous behaviour. Advancement requires explicit user approval at each stage. See [AI_CONSTITUTION.md](AI_CONSTITUTION.md).

---

## Security and access

### Secure Link

An authenticated URL to a task (or token-assisted deep link that still requires sign-in). Does not authorize unauthenticated mutation.

### Audit Event

An append-only record of a security- or workflow-relevant action (approvals, forwards, reminder attempts, retention runs, authz denials). Narrative payloads may be scrubbed when content purges; who/what/when and external ids should remain as required.

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

Minimum viable product as defined in PRODUCT_SCOPE: private sideload Android + backend + minimal admin web loop with approval-first Gmail/Messages/voice flows, reminders, and retention—without Play Store, multi-inbox, or Rocket PM.
