# State machine

Persisted states, transitions, and capability rules codified in `packages/domain` (Milestone A2).

Related: [API_CONTRACT.md](API_CONTRACT.md) · [WORKFLOWS.md](WORKFLOWS.md) · [SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md) · [DECISIONS.md](DECISIONS.md) D048–D054

---

## Task suggestion

### Persisted states

`pending` · `approved` · `dismissed` · `merged`

Terminal states do not transition again.

### Actors

Only the **Owner** may approve, edit, dismiss, or merge.

AI and voice create suggestions, never tasks (D038).

### Transitions

| From                          | To        | Actor | Notes                                                 |
| ----------------------------- | --------- | ----- | ----------------------------------------------------- |
| pending                       | approved  | Owner | Creates task in future API layer; schedules retention |
| pending                       | dismissed | Owner | Excerpt purge +7 days                                 |
| pending                       | merged    | Owner | Links to `targetTaskId`                               |
| approved / dismissed / merged | —         | —     | terminal                                              |

## Task

### Persisted states

`open` · `in_progress` · `waiting` · `completed` · `dismissed`

**Assignment is an attribute**, not a state (`TaskAssignment` on the task).

### Derived (never persisted)

- `due_soon` — actionable task with `dueAt` within 24 hours
- `overdue` — actionable task with `dueAt` in the past

Not computed while `waiting`, `completed`, or `dismissed`.

### Waiting and resume

Entering `waiting` stores `priorActionableStatus` (`open` or `in_progress`). `resume` restores that status.

### Transitions

| From                         | To                 | Owner (session) | Recipient (capability, POST after confirm) |
| ---------------------------- | ------------------ | --------------- | ------------------------------------------ |
| open                         | in_progress        | yes             | no                                         |
| open / in_progress           | waiting            | yes             | yes                                        |
| waiting                      | open / in_progress | yes             | yes (resume)                               |
| open / in_progress / waiting | completed          | yes             | yes                                        |
| open / in_progress / waiting | dismissed          | yes             | no                                         |
| completed / dismissed        | —                  | terminal        | terminal                                   |

### Owner snooze (D060)

Snooze does **not** change persisted `TaskStatus`. It recalculates reminder timing for actionable Owner-managed tasks (`open` / `in_progress` only; not while `waiting`, `completed`, or `dismissed`). Recipients cannot snooze.

### Lifecycle deletion (D064)

Physical task deletion is out of scope. Abandoned work uses **dismiss** (`dismissed` terminal status).

### Recipient capability constraints (D050, D051, D056, D058, D061)

May on assigned tasks (valid capability token, multi-use until invalidation): complete, waiting, resume, notes (typed), return to Owner, request clarification (typed), submit work request → pending Task Suggestion.

May not: approve suggestions, create standalone tasks, dismiss tasks, snooze, change policies, influence learning.

Capability possession is authorization, not verified identity. Audit must not overstate who acted (D052, D057).

**Return to Owner** changes assignment to the Owner; task status is unchanged.

**Request clarification** does not automatically change task status.

## Completion (one-tap)

`CompleteTaskRequest` requires only `outcomeType`. Optional: `note`, structured outcome summary points, `followUpProposal`.

Any follow-up remains a **Task Suggestion** requiring Owner approval (D038).

Recipient completion uses the same request shape but requires capability auth and explicit POST confirmation.

## Voice

Voice cannot create tasks directly. Follow-up proposals always become task suggestions.

## Retention side effects

| Event                        | Retention                                                 |
| ---------------------------- | --------------------------------------------------------- |
| complete                     | excerpt purge +7d; visible until +30d; content scrub +30d |
| dismiss (task or suggestion) | excerpt purge +7d                                         |
| successful transcription     | audio delete immediately                                  |
| failed transcription         | audio delete no later than +48h (D041)                    |

Waiting and snooze do not alter retention clocks.

Tombstone duration after scrub remains open (OPEN #12).

## Concurrency

All mutating transitions require matching strong ETag / `If-Match` against current `version`.

Applies to both Owner session mutations and Recipient capability mutations when the view exposes task version.
