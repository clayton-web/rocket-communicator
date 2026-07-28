# State machine

Persisted states and transitions (`packages/domain`). Related: [API_CONTRACT.md](API_CONTRACT.md) · [GLOSSARY.md](GLOSSARY.md) · [SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md) · [DECISIONS.md](DECISIONS.md) (incl. A8.1 D102–D110, which supersede parts of A8.0 D095–D101)

**Mental model:** Task status is independent of Assignment. Assignment binds Recipient + allowed actions. Capability authorizes those actions via a Capability Link. **Reminder Schedules are Task-scoped** and driven by the Owner-selected due date (D102, D104; supersedes the Assignment-scoped rule in D096). See Glossary.

**P1 introduces no state change.** The P1.0 lock (D111–D120) adds no persisted state, transition, actor, permission, concurrency rule, or audit semantic. It governs how existing states are **presented** — truthful loading, error, ambiguous, offline, and stale affordances (D112) and organization-local date display (D117) — and must never present a transition as having occurred before the server confirms it.

---

## Task suggestion

### Persisted states

`pending` · `approved` · `dismissed` · `merged`

Terminal states do not transition again.

### Actors

Only the **Owner** may approve, edit, dismiss, or merge.

AI and voice create suggestions, never tasks (D038).

### Transitions

| From                          | To        | Actor | Notes                                                                                                                 |
| ----------------------------- | --------- | ----- | --------------------------------------------------------------------------------------------------------------------- |
| pending                       | approved  | Owner | Creates **unassigned** Task (D080); excerpt safety ceiling (D082); Recipient handoff is a separate A7 mutation (D090) |
| pending                       | dismissed | Owner | Excerpt `purgeAt = dismissedAt + 7 days` (D020, D082)                                                                 |
| pending                       | merged    | Owner | Requires suggestion If-Match + `targetTaskIfMatch` (D083); excerpt +7d                                                |
| approved / dismissed / merged | —         | —     | terminal                                                                                                              |

## Task

### Persisted states

`open` · `in_progress` · `waiting` · `completed` · `dismissed`

**Assignment is an attribute**, not a Task status (`TaskAssignment`). At most one Assignment is active; historical rows may exist. Capability grants attach to a specific Assignment—not to “whoever is assigned” generically. At most one **active** Recipient capability per Assignment; reassignment or re-forward revokes the prior active capability (D086). Delivery outcomes `pending` / `sent` / `failed` (D092); actionable capability only after successful send. Handoff is Owner `POST /api/v1/tasks/{taskId}/handoff` (D090)—not part of suggestion approve.

### Derived display labels (never persisted)

- `due_soon` — actionable task whose due date is approaching but not yet passed
- `overdue` — actionable task whose due date has passed

**Current derivation (implemented, contract debt):** both labels are computed from the instant-typed `dueAt` field, with `due_soon` using a 24-hour window before that instant. That threshold is an artefact of the pre-A8.1 instant representation. When the due date aligns to a local calendar date (D109), the derivation must be restated in local-calendar terms; until then, do not cite the 24-hour window as reminder law — reminder occurrences never use it (D103).

These labels remain **derived and never persisted**, and are not computed while `waiting`, `completed`, or `dismissed`. They are **no longer display-only**: D098 is superseded by D102, so the due date they derive from is now the authoritative reminder scheduling input. The labels themselves still **must not** be the scheduling mechanism — reminder occurrences are computed from the due **date** by the rules in [WORKFLOWS.md](WORKFLOWS.md) §10a (D103), not from a label. Escalation, Owner CC ladders, and label-triggered sends remain prohibited (D099).

**Display rendering (P1, D117; not implemented).** When these labels and their dates are rendered on the Owner web surface, they must be formatted in the configured Owner **organization** timezone (`America/Vancouver`, D034) and must **never** silently use the browser, device, or machine-local timezone. That formatter is **presentation infrastructure only** and must not be used as, or grow into, the scheduling resolver — **D103** remains the sole authority for occurrence arithmetic.

### Due date

**Optional** and, when present, the **authoritative deterministic scheduling input** for reminders (D102). It is an Owner-**organization-local calendar date**; the Owner selects **no** due time (D103). AI may recommend a due date; only explicit Owner selection has effect (D027, D102).

Reminders derived from it: one advance reminder at 09:00 organization-local on the day **before** the due date (D105), then one reminder at 09:00 organization-local on **each** calendar day after it while the Task remains incomplete and eligible, bounded by the ceiling in D106. Authoritative rules: [WORKFLOWS.md](WORKFLOWS.md) §10a. **Not implemented** — A8 has not started.

**Semantic direction (not yet implemented, D109):** the authoritative representation is a local calendar date; the existing instant-typed `dueAt` field is retained temporarily for contract compatibility. Existing historical due-date data must **not** automatically activate reminders; explicit Owner opt-in or re-save is required after implementation.

### Waiting and resume

Entering `waiting` stores `priorActionableStatus` (`open` or `in_progress`). `resume` restores that status.

**Reminder interaction (D097, D107):** Waiting **suspends** reminders and is the **only** pause mechanism—no separate pause control exists. Do not preserve partial elapsed timers. On resume, compute the **next future** 09:00 organization-local occurrence from the due date, with **no backlog**. Because occurrences are anchored to a calendar date rather than an elapsed interval, no elapsed-time accounting is needed; the Phase 1 / Phase 2 restart mechanics in D097 no longer apply.

### Reminder Schedule scope and delivery eligibility

See [GLOSSARY.md](GLOSSARY.md) (**Active Assignment**, **Reminder Schedule**).

A Reminder Schedule is **Task-scoped**: at most one per Task, it survives reassignment, and it never sends a backlog of missed occurrences (D104). This supersedes the Assignment-scoped rule in D096.

**Schedule stops** when the Task is `completed` or `dismissed`, when the due date is removed, or when the overdue ceiling is reached (D106, D107).

**Schedule is suspended** by Waiting, and by a permanent delivery failure for the affected assignment (D107).

**Delivery is prevented** — without consuming the local calendar day — when there is no active assignment; the occurrence is recorded as skipped (D107). Assignment return to Owner and capability termination therefore stop delivery while the Task-scoped schedule itself persists until a stop condition applies.

A **material due-date change** opens a new schedule generation, preserving all prior history and resetting only the per-generation overdue delivered count (D104).

Authoritative rules: [WORKFLOWS.md](WORKFLOWS.md) §10a (D102–D110).

### Transitions

| From                         | To                 | Owner (session) | Recipient (capability, POST after confirm) |
| ---------------------------- | ------------------ | --------------- | ------------------------------------------ |
| open                         | in_progress        | yes             | no                                         |
| open / in_progress           | waiting            | yes             | yes                                        |
| waiting                      | open / in_progress | yes             | yes (resume)                               |
| open / in_progress / waiting | completed          | yes             | yes                                        |
| open / in_progress / waiting | dismissed          | yes             | no                                         |
| completed / dismissed        | —                  | terminal        | terminal                                   |

### Snooze (historical; not A8 product law)

Owner snooze exists in A4 OpenAPI/domain surfaces but is **superseded for Follow-up product behaviour by D101**, and Waiting remains the **only** pause mechanism under D107. Do not treat snooze as part of the reminder model or as a second pause control. At future A8 contract alignment, **prefer removing** the snooze endpoint (not a deprecated no-op), with contract-versioning / client migration. OpenAPI and the generated clients are **unchanged by both the A8.0 and A8.1 documentation locks**; the endpoint remains contract debt ([API_CONTRACT.md](API_CONTRACT.md)).

### Lifecycle deletion (D064)

Physical task deletion is out of scope. Abandoned work uses **dismiss** (`dismissed` terminal status).

### Recipient capability actions

Allowed/denied actions and identity rules: [GLOSSARY.md](GLOSSARY.md) · [SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md). Transitions above. Multi-use until invalidation (D056). Typed notes/clarification in A4 (D058). Work request → pending Suggestion (D061).

**Return to Owner** clears Assignment; Task status unchanged. The Task-scoped Reminder Schedule is **not** terminated, but with no active assignment Recipient delivery is **prevented** and occurrences are recorded as skipped without consuming the local day (D104, D107); where Owner action is required this is an Owner notification event (D108). **Request clarification** does not automatically change Task status; it is an Event Notification Engine input (D099).

## Completion (one-tap)

`CompleteTaskRequest` requires only `outcomeType`. Optional: `note`, structured outcome summary points, next-action proposal payload (OpenAPI may still name this `followUpProposal`).

Any next action remains a **Task Suggestion** / **Next-action Suggestion** requiring Owner approval (D038).

Recipient completion uses the same request shape but requires capability auth and explicit POST confirmation. Completion **stops** future reminders and is an Event Notification Engine input (D099, D107). A claimed but undelivered reminder must not become a misleading post-completion send: the engine rechecks Task state immediately before delivery (§10a).

## Voice

Voice cannot create tasks directly. Next-action proposals always become task suggestions.

## Retention side effects

| Event                        | Retention                                                                   |
| ---------------------------- | --------------------------------------------------------------------------- |
| suggestion associated        | excerpt `purgeAt = associatedAt + 30 days` bounded ceiling (D082)           |
| suggestion approved          | excerpt `purgeAt = approvedAt + 30 days` once; Task unassigned (D080, D082) |
| complete (task)              | if excerpt still present: purge +7d; visible until +30d; content scrub +30d |
| dismiss (task or suggestion) | excerpt purge +7d                                                           |
| merge (suggestion)           | excerpt purge +7d                                                           |
| successful transcription     | audio delete immediately                                                    |
| failed transcription         | audio delete no later than +48h (D041)                                      |

Waiting does not alter retention clocks. Long-lived active Tasks do **not** refresh the excerpt safety ceiling (D082).

Tombstone duration after scrub remains open (OPEN #12).

## Concurrency

All mutating transitions require matching strong ETag / `If-Match` against current `version`.

Applies to both Owner session mutations and Recipient capability mutations when the view exposes task version.

**Suggestion merge (D083):** also requires body `targetTaskIfMatch` for the target Task. Missing either precondition → 428; stale suggestion or target Task → 412.
