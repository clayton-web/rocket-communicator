# Data retention

Governed by [PROJECT_CONSTITUTION.md](PROJECT_CONSTITUTION.md). Terms: [GLOSSARY.md](GLOSSARY.md). Decisions: [DECISIONS.md](DECISIONS.md) (D020, D021, D028, D031, D078, D082, D100, D109, and the operational data taxonomy **D113–D114**).

## Purpose

This product must not become a permanent communication archive. Retention separates:

1. Temporary communication content stored by the application
2. Active operational task data
3. Completed-task visibility window
4. Durable workflow intelligence
5. Audit and security metadata
6. Copies that live outside the application (notably Gmail after forwarding)
7. Operational telemetry, which is measurement rather than record (D113)

**Retention rules apply separately to source content, audit records, operational telemetry, and structured learning signals (D113).** One class's timer never governs another, and no class is derived from another to escape its own retention rule.

## Data classification

| Class                                    | Examples                                                                                                                                                                                                          | Default fate                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Temporary communication excerpts         | Gmail body snippets, notification text stored for AI/task context                                                                                                                                                 | Concrete `purgeAt` always required (D082). Ingest: `syncedAt + 7 days` (D078). Workflow association replaces with safety ceiling or terminal + 7 days (D020, D082).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Active operational task data             | Title, structured summary points, assignee, due, status, notes                                                                                                                                                    | Kept while active; then enter completed/dismissed retention path                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Completed task visibility                | Operational summary and completion outcome                                                                                                                                                                        | Visible 30 days after completion                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Raw voice audio                          | Uploaded recordings                                                                                                                                                                                               | Delete immediately after successful transcription and validation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Transcripts                              | Text from speech                                                                                                                                                                                                  | Treated as task/suggestion content under task retention; not kept as a permanent archive                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Forwarded Gmail messages and attachments | Copies in Recipient (and Sent) mailboxes                                                                                                                                                                          | **Outside app deletion control** — Workspace/Gmail retention                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Durable workflow intelligence            | Approved preferences/rules, anonymized patterns, confidence signals                                                                                                                                               | May be retained longer; **no raw message bodies**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Audit metadata                           | Who approved what, when, message ids, reminder attempts (D100, D109)                                                                                                                                              | Minimal metadata retained as required; scrub free-text payloads when content purges; do not require complete email bodies                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Reminder scheduling metadata             | Reminder Schedules, generations, occurrence outcomes, skip and failure reasons, delivered counts (D109)                                                                                                           | **Operational metadata, not communication content.** No message bodies, no reminder body text, and **no capability token or capability URL**. Records are **superseded, never deleted or rewritten**; retained with audit metadata rather than on excerpt timers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Owner notification metadata (A8.5, D133) | Notification intent rows and provider attempt rows: event type, subject reference, occurrence key, delivery state, attempt counts, short normalized failure codes, and the truthful actor of the triggering event | **Operational metadata, not communication content.** No destination address (resolved at delivery time from the connected account, D134), no subject, no body, no MIME, **no capability token or capability URL**, no temporary excerpt, and no Recipient free text. Retained with audit metadata rather than on excerpt timers. An intent holds **no foreign key to its subject** on purpose, so purging a Task cannot delete or block a notification that is still owed; a purge therefore leaves the event record intact and the reference dangling by design. Since A8.5b a terminal outcome also appends a `system`-attributed audit event whose `note` carries a failure code from a **closed set defined in code** — never a provider response, an exception message, an address, or Recipient text |
| Operational telemetry (P1, D113)         | Route or operation timing, request failures, retry outcomes, connectivity changes, application and rendering errors, stale-data presentation                                                                      | **Measurement, not record.** Short-lived and disposable: retain only long enough to diagnose and to compare against the P1.1 baseline. **Never** promoted into audit history, business records, or learning input. **Never** contains the payloads prohibited by D114 — notably no capability token or `/c/{token}` path. Losing it must never lose business or audit truth                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Structured learning signals (A14, D113)  | Owner decisions with the alternatives that existed and what happened afterward                                                                                                                                    | May be retained longer as durable workflow intelligence, **minimized and without raw message bodies** (D054). Must never rewrite audit history and must never be inferred from click or usage tracking. **None are captured today** — P1 and A8 create no learning tables (D110)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

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
- **A7 (D088):** Do not send a knowingly incomplete Gmail-origin forward. Failed assembly records a privacy-safe failed delivery attempt in the application; no partial forward is left in the Recipient mailbox as a “success.”
- **A7 confirmation UI** must disclose that successful forwards leave copies outside application deletion control (D031, D037).

Application delivery-attempt / handoff-attempt records (D092) are operational metadata—not a permanent communication archive (D024). Do not store full MIME or attachment bytes in those records (D071–D072).

## Durable workflow intelligence

May be retained longer:

- approved workflow preferences
- approved assignment rules
- approved priority rules
- approved Follow-up Policy preferences (due-date selection patterns; never raw bodies). Phase 1 interval patterns are retired (D102)
- Owner corrections (structured, minimized)
- anonymized operational patterns
- non-content confidence and evaluation signals

Avoid retaining raw communication text inside durable learning records.

## Audit metadata

- Record approvals (especially assignment and Gmail forward), reminder lifecycle history — scheduling, recalculation, sends, skips with truthful reasons, failures, stops, and suspensions (D100, D109) — Event Notification outcomes, retention runs, authz denials, and token use.
- When content is purged, scrub narrative fields from audit payloads where feasible; keep who/what/when and external ids.
- **Audit history is never derived from operational telemetry, and never edited to match it** (D113). Audit records are superseded rather than rewritten.

## Operational telemetry (P1; not implemented)

Operational telemetry answers only **“is the application working properly?”** (D113). No telemetry, analytics, RUM, or vendor integration exists today; this records the retention posture before any is built.

- **Purpose-limited collection.** Collect what is needed to answer a stated operational question. Sensitive content must **not** be retained because it might be useful someday.
- **Short-lived and disposable.** Retain only long enough to diagnose failures and to compare against the P1.1 baseline. Telemetry is not a durable record and carries no evidentiary weight.
- **No promotion.** Telemetry must never be promoted into audit history, business records, training data, or a structured learning signal (D113). Passive behaviour, inactivity, and the absence of a correction are never approval or a decision.
- **Payload boundary.** The prohibitions in D114 apply in full — notably **no capability token and no raw `/c/{token}` path**, and no email bodies, Task notes, or communication excerpts. Details: [SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md).
- **No behavioural analytics, session replay, or commercial tracking vendor** is authorized (D115).

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
