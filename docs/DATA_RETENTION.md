# Data retention

Governed by [PROJECT_CONSTITUTION.md](PROJECT_CONSTITUTION.md). Terms: [GLOSSARY.md](GLOSSARY.md). Decisions: [DECISIONS.md](DECISIONS.md) (D020, D021, D028, D031).

## Purpose

This product must not become a permanent communication archive. Retention separates:

1. Temporary communication content stored by the application
2. Active operational task data
3. Completed-task visibility window
4. Durable workflow intelligence
5. Audit and security metadata
6. Copies that live outside the application (notably Gmail after forwarding)

## Data classification

| Class                                    | Examples                                                            | Default fate                                                                             |
| ---------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Temporary communication excerpts         | Gmail body snippets, notification text stored for AI/task context   | Delete 7 days after related task completed or suggestion dismissed                       |
| Active operational task data             | Title, structured summary points, assignee, due, status, notes      | Kept while active; then enter completed/dismissed retention path                         |
| Completed task visibility                | Operational summary and completion outcome                          | Visible 30 days after completion                                                         |
| Raw voice audio                          | Uploaded recordings                                                 | Delete immediately after successful transcription and validation                         |
| Transcripts                              | Text from speech                                                    | Treated as task/suggestion content under task retention; not kept as a permanent archive |
| Forwarded Gmail messages and attachments | Copies in Recipient (and Sent) mailboxes                            | **Outside app deletion control** — Workspace/Gmail retention                             |
| Durable workflow intelligence            | Approved preferences/rules, anonymized patterns, confidence signals | May be retained longer; **no raw message bodies**                                        |
| Audit metadata                           | Who approved what, when, message ids, reminder attempts             | Minimal metadata retained as required; scrub free-text payloads when content purges      |

## Temporary communication excerpts

- Store the minimum text needed for suggestion quality and short-term Owner review.
- Do not store full attachment binaries in the application for version-one ingest.
- **A5 (D071–D072):** attachment **metadata only**; temporary capped plain-text excerpts only; no full MIME or full HTML archives. Gmail remains source of truth.
- **Delete seven days after** the related task is completed **or** the suggestion is dismissed. A5 persistence includes `purgeAt` / `purgedAt` on `TemporaryCommunicationExcerpt`; retention workers remain A13.
- Disconnect wipes encrypted OAuth credential ciphertext; durable provider message ids on `CommunicationEvent` may remain for dedupe/threading after content scrub.
- During the completed-task 30-day visibility window, the **excerpt still follows the seven-day rule** and should already be gone after day seven.

## Active task data

While a task is not completed or dismissed, operational fields remain available to authorized users.

## Completed task visibility (thirty-day rule)

- Keep completed tasks **visible for thirty days**.
- During this period, the operational task summary and completion outcome may remain visible.
- The original temporary communication excerpt should still be deleted after **seven** days (do not conflate the two timers).

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

`purge_excerpts_at ≈ completed_at|dismissed_at + 7 days`

Applies to application-stored communication excerpts.

## Thirty-day rule (summary)

`visible_until ≈ completed_at + 30 days`, then scrub task content.

Independent of the seven-day excerpt timer.

## Deletion scheduling

- Compute and persist purge timestamps when tasks complete/dismiss and when audio succeeds.
- Retention worker processes due purges on a schedule (Supabase-supported scheduling or equivalent low-cost mechanism—implementation later).
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
