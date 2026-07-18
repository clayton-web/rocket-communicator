# Data retention

Governed by [PROJECT_CONSTITUTION.md](PROJECT_CONSTITUTION.md). Terms: [GLOSSARY.md](GLOSSARY.md). Decisions: [DECISIONS.md](DECISIONS.md) (D020, D021, D028, D031, D078, D082).

## Purpose

This product must not become a permanent communication archive. Retention separates:

1. Temporary communication content stored by the application
2. Active operational task data
3. Completed-task visibility window
4. Durable workflow intelligence
5. Audit and security metadata
6. Copies that live outside the application (notably Gmail after forwarding)

## Data classification

| Class                                    | Examples                                                            | Default fate                                                                                                                                                        |
| ---------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Temporary communication excerpts         | Gmail body snippets, notification text stored for AI/task context   | Concrete `purgeAt` always required (D082). Ingest: `syncedAt + 7 days` (D078). Workflow association replaces with safety ceiling or terminal + 7 days (D020, D082). |
| Active operational task data             | Title, structured summary points, assignee, due, status, notes      | Kept while active; then enter completed/dismissed retention path                                                                                                    |
| Completed task visibility                | Operational summary and completion outcome                          | Visible 30 days after completion                                                                                                                                    |
| Raw voice audio                          | Uploaded recordings                                                 | Delete immediately after successful transcription and validation                                                                                                    |
| Transcripts                              | Text from speech                                                    | Treated as task/suggestion content under task retention; not kept as a permanent archive                                                                            |
| Forwarded Gmail messages and attachments | Copies in Recipient (and Sent) mailboxes                            | **Outside app deletion control** — Workspace/Gmail retention                                                                                                        |
| Durable workflow intelligence            | Approved preferences/rules, anonymized patterns, confidence signals | May be retained longer; **no raw message bodies**                                                                                                                   |
| Audit metadata                           | Who approved what, when, message ids, reminder attempts             | Minimal metadata retained as required; scrub free-text payloads when content purges                                                                                 |

## Temporary communication excerpts

- Store the minimum text needed for suggestion quality and short-term Owner review.
- Do not store full attachment binaries in the application for version-one ingest.
- **A5 (D071–D072):** attachment **metadata only**; temporary capped plain-text excerpts only; no full MIME or full HTML archives. Gmail remains source of truth.
- **`purgeAt` is always a concrete deadline (D082).** Do not use nullable `purgeAt` as a hold signal — a forgotten null would risk immortal excerpts.
- **Ingest-time maximum (D078):** when an eligible Gmail message is ingested, create/update its `TemporaryCommunicationExcerpt` with `purgeAt = syncedAt + 7 days`.
- **Workflow retention (D020, D082):** when an excerpt is associated with a suggestion or task, replace the ingest deadline per the transition table below. If no later workflow retains the communication, the excerpt remains eligible for deletion at the ingest seven-day deadline.
- **Leave-Inbox:** if a previously ingested message no longer satisfies Inbox eligibility, update durable event label/status metadata, retain provider identity, and promptly purge its TemporaryCommunicationExcerpt content. Do not delete the CommunicationEvent.
- Retention workers that execute purges remain A13; A6 must still write correct `purgeAt` values.
- Disconnect wipes encrypted OAuth credential ciphertext; durable provider message ids on `CommunicationEvent` may remain for dedupe/threading after content scrub.
- During the completed-task 30-day visibility window, the **excerpt still follows the applicable seven-day or safety-ceiling rule** and should already be gone after its `purgeAt`.

### A6 excerpt retention transition table (D082)

| Transition                                    | Required excerpt `purgeAt` behaviour                                                       |
| --------------------------------------------- | ------------------------------------------------------------------------------------------ |
| A5 ingest                                     | `syncedAt + 7 days` (D078)                                                                 |
| Pending suggestion created (associated)       | **Bounded workflow hold:** `purgeAt = associatedAt + 30 days` (replaces ingest deadline)   |
| Suggestion dismissed                          | `dismissedAt + 7 days` (D020)                                                              |
| Suggestion merged                             | `mergedAt + 7 days` (D020)                                                                 |
| Suggestion approved (unassigned Task created) | `purgeAt = approvedAt + 30 days` **once** (not refreshed while Task remains active)        |
| Resulting Task still active past ceiling      | Excerpt **may be purged** at the existing ceiling; summary points + source metadata remain |
| Resulting Task completed or dismissed         | If excerpt still present: `purgeAt = taskTerminalAt + 7 days` (D020)                       |
| Excerpt already purged before processing      | Metadata-only AI input allowed; never invent or silently restore body content              |
| Excerpt content deleted / `purgedAt` set      | Derived suggestion/task `summaryPoints` and `sourceReference` metadata may remain (D024)   |

**Workflow hold representation:** always-required concrete `purgeAt` set to a **30-day safety ceiling** from association or approval time. This is a **bounded** retention deadline, **not** a guarantee the excerpt survives for the entire active Task lifetime (D024, D082). A13 deletes when `now >= purgeAt` and content is not already purged. Terminal suggestion dismiss/merge **must** replace the ceiling with `terminalAt + 7 days`. Task complete/dismiss replaces the ceiling only when the excerpt is still present. **There is no periodic refresh** of the ceiling while a Task remains active — prefer privacy over retaining temporary communication text for long-lived work.

**Atomicity:** suggestion create / dismiss / merge / approve and Task terminal transitions that affect an associated excerpt update `purgeAt` in the **same database transaction** as the suggestion/task mutation (implementation in A6+).

## Active task data

While a task is not completed or dismissed, operational fields remain available to authorized users.

## Completed task visibility (thirty-day rule)

- Keep completed tasks **visible for thirty days**.
- During this period, the operational task summary and completion outcome may remain visible.
- The original temporary communication excerpt should still be deleted after its concrete `purgeAt` (do not conflate the two timers).

## After thirty days

- Delete or scrub task content under the retention policy (summaries, notes, points, transcripts tied to the task).
- Preserve only minimal audit metadata where required (identifiers, timestamps, actors, action types, external Gmail ids).
- Durable learning records must not contain raw message bodies or unnecessary personally identifying narrative.

## Raw voice audio

- Delete raw audio **immediately** after successful transcription and validation.
- On failed transcription, audio may be retained **encrypted for up to 48 hours** for retry, then deleted (D041). No indefinite retention.

## Transcripts

- Retained as part of suggestion/task operational content.
- Subject to the same completed/dismissed scrub timeline as other task content after the visibility window, unless a narrower policy is later approved.
- Not a permanent archive.

## Forwarded Gmail messages and attachments

Forwarding an original email changes the practical retention boundary.

Temporary copies stored by the application are deleted according to the application retention policy. Emails deliberately forwarded through Google Workspace, including their attachments, remain subject to the organization’s Gmail retention and deletion practices.

Implications:

- The forwarded email remains in the Recipient’s Gmail mailbox.
- Forwarded attachments remain in the Recipient’s Gmail mailbox.
- Gmail copies are governed by Google Workspace retention and deletion settings.
- Deleting application task content does **not** automatically delete the forwarded Gmail message.
- **Do not claim that all communication content disappears after seven days.**

## Durable workflow intelligence

May be retained longer:

- approved workflow preferences
- approved assignment rules
- approved priority rules
- approved reminder rules
- Owner corrections (structured, minimized)
- anonymized operational patterns
- non-content confidence and evaluation signals

Avoid retaining raw communication text inside durable learning records.

## Audit metadata

- Record approvals (especially assignment and Gmail forward), reminder attempts, retention runs, authz denials, and token use.
- When content is purged, scrub narrative fields from audit payloads where feasible; keep who/what/when and external ids.

## Seven-day rule (summary)

`purge_excerpts_at ≈ completed_at|dismissed_at|merged_at + 7 days` after a terminal workflow event (D020).

Ingest path uses `syncedAt + 7 days` until replaced (D078).

Workflow-held excerpts use `associatedAt|approvedAt + 30 days` as a **bounded** safety ceiling (D082). The ceiling is **not** refreshed while a Task remains active. If the Task outlives the ceiling, the excerpt may purge while operational summary points and source metadata remain. A terminal transition that occurs while the excerpt is still present writes `terminalAt + 7 days` (D020).

## Thirty-day rule (summary)

`visible_until ≈ completed_at + 30 days`, then scrub task content.

Independent of the excerpt timer. The same thirty-day span is reused as the **workflow hold safety ceiling** for associated excerpts (D082).

## Deletion scheduling

- Compute and persist purge timestamps when tasks complete/dismiss, suggestions dismiss/merge/associate, and when audio succeeds.
- The application-owned retention engine processes due purges. An External Scheduler invokes an authenticated retention endpoint on the approved cadence; the scheduler must not contain retention policy or purge logic (D079).
- The scheduler implementation is replaceable. Current or future deployment adapters may use the lowest-cost suitable mechanism, provided security, auditability, and data integrity are not weakened.
- Prefer hard deletion or irreversible scrub of content fields over soft-delete that accumulates forever.

## Failed deletion handling

- Log each retention run and per-item failure.
- Retry with backoff.
- Alert operators / Owner on sustained backlog.
- Do not silently skip items indefinitely.

## User-initiated deletion

- Allow user-initiated deletion of task/suggestion content where product settings require it.
- Immediate content wipe in the application; update audit; still does not remove Gmail forwards already sent.

## Gmail retention boundary

Application deletion ≠ mailbox deletion. Document this in user-facing settings/help when the product ships.
