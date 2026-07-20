# State machine

Persisted states and transitions (`packages/domain`). Related: [API_CONTRACT.md](API_CONTRACT.md) · [GLOSSARY.md](GLOSSARY.md) · [SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md) · [DECISIONS.md](DECISIONS.md) (incl. A8.0 D095–D101)

**Mental model:** Task status is independent of Assignment. Assignment binds Recipient + allowed actions. Capability authorizes those actions via a Capability Link. Follow-up Schedules are Assignment-scoped (D096). See Glossary.

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

### Derived display labels (never persisted; never schedule)

- `due_soon` — actionable task with informational `dueAt` within 24 hours
- `overdue` — actionable task with informational `dueAt` in the past

These labels are **display-only** (D098). They must **not** trigger Follow-up Attempts, alter Follow-up cadence, escalate, CC the Owner, or create/modify an Assignment. Not computed while `waiting`, `completed`, or `dismissed`.

### `dueAt`

Optional informational field only (D098). Independent from the Follow-up Engine.

### Waiting and resume

Entering `waiting` stores `priorActionableStatus` (`open` or `in_progress`). `resume` restores that status.

**Follow-up interaction (D097):** Waiting **suspends** Follow-up eligibility. Do not preserve partial elapsed timers. On resume: fresh Phase 2 from resume time if the first Follow-up Attempt was already successfully delivered; otherwise fresh Phase 1 from resume time using the same Owner-confirmed Phase 1 preset.

### Assignment activity and Follow-up eligibility

See [GLOSSARY.md](GLOSSARY.md) (**Active Assignment**, **Follow-up eligible Assignment**).

A Follow-up Schedule exists only while its Assignment is active and follow-up eligible (D096). Eligibility ends at minimum when:

- Task is `completed` or `dismissed`
- Assignment is returned to Owner (cleared)
- Assignment is reassigned (prior schedule terminates; new Assignment needs new Phase 1)
- Capability or Assignment is otherwise terminated
- Delivery never reached `sent` (no active schedule created)

Authoritative Phase 1 / Phase 2 rules: [WORKFLOWS.md](WORKFLOWS.md) §10a (D095).

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

Owner snooze exists in A4 OpenAPI/domain surfaces but is **superseded for Follow-up product behaviour by D101**. Waiting is the approved suspension mechanism. Do not treat snooze as part of the Follow-up Engine model. At future A8 contract alignment, **prefer removing** the snooze endpoint (not a deprecated no-op), with contract-versioning / client migration. OpenAPI is unchanged in A8.0.

### Lifecycle deletion (D064)

Physical task deletion is out of scope. Abandoned work uses **dismiss** (`dismissed` terminal status).

### Recipient capability actions

Allowed/denied actions and identity rules: [GLOSSARY.md](GLOSSARY.md) · [SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md). Transitions above. Multi-use until invalidation (D056). Typed notes/clarification in A4 (D058). Work request → pending Suggestion (D061).

**Return to Owner** clears Assignment; Task status unchanged; prior Follow-up Schedule terminates (D096). **Request clarification** does not automatically change Task status; it is an Event Notification Engine input (D099).

## Completion (one-tap)

`CompleteTaskRequest` requires only `outcomeType`. Optional: `note`, structured outcome summary points, next-action proposal payload (OpenAPI may still name this `followUpProposal`).

Any next action remains a **Task Suggestion** / **Next-action Suggestion** requiring Owner approval (D038).

Recipient completion uses the same request shape but requires capability auth and explicit POST confirmation. Completion ends Follow-up eligibility and is an Event Notification Engine input (D096, D099).

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
