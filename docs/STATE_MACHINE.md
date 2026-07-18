# State machine

Persisted states and transitions (`packages/domain`). Related: [API_CONTRACT.md](API_CONTRACT.md) · [GLOSSARY.md](GLOSSARY.md) · [SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md) · [DECISIONS.md](DECISIONS.md)

**Mental model:** Task status is independent of Assignment. Assignment binds Recipient + allowed actions. Capability authorizes those actions via a Capability Link. See Glossary.

---

## Task suggestion

### Persisted states

`pending` · `approved` · `dismissed` · `merged`

Terminal states do not transition again.

### Actors

Only the **Owner** may approve, edit, dismiss, or merge.

AI and voice create suggestions, never tasks (D038).

### Transitions

| From                          | To        | Actor | Notes                                                                  |
| ----------------------------- | --------- | ----- | ---------------------------------------------------------------------- |
| pending                       | approved  | Owner | Creates **unassigned** Task (D080); excerpt safety ceiling (D082)      |
| pending                       | dismissed | Owner | Excerpt `purgeAt = dismissedAt + 7 days` (D020, D082)                  |
| pending                       | merged    | Owner | Requires suggestion If-Match + `targetTaskIfMatch` (D083); excerpt +7d |
| approved / dismissed / merged | —         | —     | terminal                                                               |

## Task

### Persisted states

`open` · `in_progress` · `waiting` · `completed` · `dismissed`

**Assignment is an attribute**, not a Task status (`TaskAssignment`). At most one Assignment is active; historical rows may exist. Capability grants attach to a specific Assignment—not to “whoever is assigned” generically.

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

### Recipient capability actions

Allowed/denied actions and identity rules: [GLOSSARY.md](GLOSSARY.md) · [SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md). Transitions above. Multi-use until invalidation (D056). Typed notes/clarification in A4 (D058). Work request → pending Suggestion (D061).

**Return to Owner** clears Assignment; Task status unchanged. **Request clarification** does not automatically change Task status.

## Completion (one-tap)

`CompleteTaskRequest` requires only `outcomeType`. Optional: `note`, structured outcome summary points, `followUpProposal`.

Any follow-up remains a **Task Suggestion** requiring Owner approval (D038).

Recipient completion uses the same request shape but requires capability auth and explicit POST confirmation.

## Voice

Voice cannot create tasks directly. Follow-up proposals always become task suggestions.

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

Waiting and snooze do not alter retention clocks. Long-lived active Tasks do **not** refresh the excerpt safety ceiling (D082).

Tombstone duration after scrub remains open (OPEN #12).

## Concurrency

All mutating transitions require matching strong ETag / `If-Match` against current `version`.

Applies to both Owner session mutations and Recipient capability mutations when the view exposes task version.

**Suggestion merge (D083):** also requires body `targetTaskIfMatch` for the target Task. Missing either precondition → 428; stale suggestion or target Task → 412.
