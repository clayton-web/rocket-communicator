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

**Display rendering (P1.4, D117 and D122; complete and production-validated).** These labels and their dates are rendered on the Owner web surface as **Due soon** and **Overdue** through `apps/web/lib/presentation/task-status.ts`, and their dates are formatted by `apps/web/lib/presentation/datetime.ts` in the configured Owner **organization** timezone (`America/Vancouver`, D034) — **never** the browser, device, or machine-local timezone, and never fixed-offset arithmetic. Proven under `TZ=UTC`, `TZ=Asia/Tokyo`, and an `Asia/Tokyo` **browser**, and confirmed in production ([P1_4_EVIDENCE.md](P1_4_EVIDENCE.md) §§6 and 13).

That formatter is **presentation infrastructure only** and must not be used as, or grow into, the scheduling resolver — **D103** remains the sole authority for occurrence arithmetic. P1.4 accordingly renders the labels as **due-date facts only**: the presentation layer reads the existing `derivedUrgency` field and derives no state of its own, adds no threshold, and must never describe either label as reminder automation while A8 is unimplemented (D089, D126).

### Due date

**Optional** and, when present, the **authoritative deterministic scheduling input** for reminders (D102). It is an Owner-**organization-local calendar date**; the Owner selects **no** due time (D103). AI may recommend a due date; only explicit Owner selection has effect (D027, D102).

Reminders derived from it: one advance reminder at 09:00 organization-local on the day **before** the due date (D105), then one reminder at 09:00 organization-local on **each** calendar day after it while the Task remains incomplete and eligible, bounded by the ceiling in D106. Authoritative rules: [WORKFLOWS.md](WORKFLOWS.md) §10a. **Nothing sends** — the scheduling logic (A8.2), persistence schema (A8.3a), Owner reminder APIs (A8.3b), and lifecycle wiring (A8) exist, so a due date reaches a schedule and Task status now moves that schedule correctly, but no worker scans, claims, or delivers. Delivery remains gated on A8.4a passing audit.

**Semantic direction (D109; persisted by A8.3a, contracted for the Owner reminder surface by A8.3b):** the authoritative representation is a local calendar date, stored as `tasks.due_local_date` since A8.3a (D128) and exposed as `dueLocalDate` on `/api/v1/tasks/{taskId}/reminder` since A8.3b. The instant-typed `dueAt` on the Task remains for contract compatibility, is unchanged, and drives no reminder — the local date is never reconstructed from it. Existing historical due-date data does **not** activate reminders: `due_local_date` was not backfilled, so an explicit Owner save through the reminder route is required, and re-saving a date onto a stopped schedule is treated as that explicit reactivation.

#### Which Task states may carry reminder scheduling (D107; enforced since the A8.3b audit remediation)

Setting a due date and _scheduling reminders from it_ are separable, and the Task's status decides the second. The rule below is derived from D107 rather than invented, lives in `packages/domain/src/reminders/eligibility.ts` so the Owner API and the future worker cannot disagree, and is exhaustive over `TaskStatus`.

| Task status   | `PUT` (establish / change)                                  | Resulting schedule                     | `GET` | `DELETE` |
| ------------- | ----------------------------------------------------------- | -------------------------------------- | ----- | -------- |
| `open`        | Allowed                                                     | `active`, with a claimable occurrence  | Yes   | Yes      |
| `in_progress` | Allowed                                                     | `active`, with a claimable occurrence  | Yes   | Yes      |
| `waiting`     | Allowed                                                     | `suspended_waiting`, **no** occurrence | Yes   | Yes      |
| `completed`   | Refused — `409 DOMAIN_CONFLICT`, nothing written or audited | Unchanged                              | Yes   | Yes      |
| `dismissed`   | Refused — `409 DOMAIN_CONFLICT`, nothing written or audited | Unchanged                              | Yes   | Yes      |

A **Waiting** Task accepts a due-date change because the Owner is planning, not activating: generation follows the ordinary materiality rules, but the schedule is created or re-generated directly in `suspended_waiting` with its next-occurrence fields cleared, so no occurrence is ever claimable while the Task is paused and no backlog accrues. Since the A8 lifecycle wiring, leaving Waiting resumes such a schedule by the rules below.

A **completed or dismissed** Task refuses establishment, material change, and reactivation alike: D107 stops reminders on completion and dismissal, and re-establishing one would contradict that within a single request. Whether a terminal Task may ever return to an actionable status remains undecided and no path implements it, but what such a path would mean for reminders **is** decided — it would not reactivate them; see [Reopen and restore](#reopen-and-restore-decided-a8) below.

**`GET` and `DELETE` are allowed for every status.** Reading is truthful history and is not scheduling. Removal can only ever reduce reminder activity, so refusing it on a terminal Task would strand an already-active schedule with no way to switch it off — the opposite of the safety the gate exists for. An **immaterial repeat** writes nothing and so has nothing to refuse; it is decided inside the authoritative transaction under the Task lock, and a terminal Task never reaches it, because a terminal Task's schedule is already stopped and re-saving its date is a reactivation attempt that the gate does refuse.

A status the policy has no decision for fails **closed**: scheduling is refused and the unresolved state is surfaced rather than defaulted to active. The enum currently holds exactly the five statuses above.

The gate is evaluated **twice**: once against the status the request read, and again against the Task row **under the transaction's lock**. Only the second is authoritative. A `PUT` whose Task became terminal or Waiting mid-flight is refused with `409 DOMAIN_CONFLICT` rather than committing a schedule its current status forbids, which is what keeps a dismissal from racing a reactivation into an active schedule on a dismissed Task.

### Waiting and resume

Entering `waiting` stores `priorActionableStatus` (`open` or `in_progress`). `resume` restores that status.

**Reminder interaction (D097, D107):** Waiting **suspends** reminders and is the **only** pause mechanism—no separate pause control exists. Do not preserve partial elapsed timers. On resume, compute the **next future** 09:00 organization-local occurrence from the due date, with **no backlog**. Because occurrences are anchored to a calendar date rather than an elapsed interval, no elapsed-time accounting is needed; the Phase 1 / Phase 2 restart mechanics in D097 no longer apply.

#### Lifecycle wiring: how a status transition moves the schedule (implemented, A8)

Reminder state is **not** a route-level side effect. Every authoritative Task status transition — Owner and Recipient capability alike — runs through one persistence transaction, and that transaction reconciles the reminder schedule **before it commits**. There is no second transaction and no window in which a committed status disagrees with the schedule, which is what makes "a terminal Task never holds a claimable occurrence" an invariant rather than an eventual property.

What a status _requires_ of an existing schedule is derived from the same domain policy as the table above (`decideReminderLifecycleIntent`), so a status cannot be schedulable one way and reconciled another.

| Transition                   | Effect on an `active` schedule                 | On a `suspended_waiting` schedule      | On a `stopped` schedule                  | With no schedule |
| ---------------------------- | ---------------------------------------------- | -------------------------------------- | ---------------------------------------- | ---------------- |
| Entering `waiting`           | → `suspended_waiting`, next occurrence cleared | Unchanged (idempotent)                 | Unchanged — never revived or re-labelled | Nothing          |
| Leaving `waiting` (`resume`) | Unchanged (idempotent)                         | → `active`, next occurrence recomputed | Unchanged                                | Nothing          |
| `completed`                  | → `stopped`, reason `task_completed`           | → `stopped`, reason `task_completed`   | Unchanged — original reason preserved    | Nothing          |
| `dismissed`                  | → `stopped`, reason `task_dismissed`           | → `stopped`, reason `task_dismissed`   | Unchanged — original reason preserved    | Nothing          |

**Suspension** clears the claimable next occurrence and preserves generation, advance disposition, and the delivered-overdue count. It is idempotent, and it never converts a `stopped` schedule into `suspended_waiting` — a schedule stopped because the due date was removed or the Task was completed has ended, and re-labelling it as merely paused would misrepresent history and make it eligible for a later resume.

**Resume** applies only to a schedule suspended _because of_ Waiting. It preserves generation — a Waiting round trip is not a new Owner decision, so it opens no new generation and does not reset the D106 ceiling — and preserves the delivered-overdue count. The next occurrence is computed **strictly after the resume instant**, so occurrences that would have fallen during Waiting are not replayed and nothing is sent merely because time passed. The Task due date is untouched.

The same rule reaches the **advance** occurrence, which suspension preserves as `scheduled` rather than clearing — correctly, since a Task that waits an hour and resumes before its advance morning must still get that reminder. If the advance instant is at or before the resume instant, resume records the occurrence as permanently skipped for that generation with the reason `skipped_waiting_elapsed`, keeps its original local date and instant as history, and arms only the next future overdue occurrence. It is never sent late, never recreated, and never relabelled `advance_window_elapsed`, which means something different: that the advance morning had already passed when the Owner chose the date. An advance occurrence already delivered, or already skipped at establishment, keeps the reason it has — resume does not rewrite history it did not make. If the preserved delivered count has already reached the D106 ceiling, resume records the schedule as requiring Owner attention instead of manufacturing a fresh occurrence — waiting is not a way to earn more reminders. Any stale claim state is cleared as part of the resume so no worker lease survives the pause.

**Terminal stops** clear all claimable next-occurrence fields, record a stop reason that distinguishes completion from dismissal from due-date removal, preserve generation and every delivery attempt, and **do not delete the schedule row** — the history of what was sent must outlive the Task becoming terminal.

#### Reopen and restore (decided, A8)

The status enum admits no reopen transition today: `completed` and `dismissed` are terminal in the state machine, no route or capability action moves a terminal Task to a nonterminal status, and there is no undo or restore path. Terminal → `waiting` is likewise unreachable. The only implemented "un-pause" is `waiting` → `priorActionableStatus` via `resume`, which the table above covers.

The decision, recorded now so that adding a reopen path later cannot quietly resurrect reminders: **reopening or restoring a Task does not reactivate a terminally stopped reminder schedule.** The Owner must explicitly re-save the due date through the reminder route, which is already the established meaning of a save onto a stopped schedule (D109). An existing due date may remain visible, but no claimable schedule appears without an Owner decision. This follows the direction of D109 — reminders resume only on explicit Owner action, never implicitly — and avoids the failure where a Task reopened months later immediately delivers an overdue backlog for a date long past.

### Reminder Schedule scope and delivery eligibility

See [GLOSSARY.md](GLOSSARY.md) (**Active Assignment**, **Reminder Schedule**).

A Reminder Schedule is **Task-scoped**: at most one per Task, it survives reassignment, and it never sends a backlog of missed occurrences (D104). This supersedes the Assignment-scoped rule in D096.

**Schedule stops** when the Task is `completed` or `dismissed`, when the due date is removed, or when the overdue ceiling is reached (D106, D107). The stop reason distinguishes these causes rather than overloading one value, so the history says _why_ reminders ended; a schedule already stopped keeps its original reason.

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
