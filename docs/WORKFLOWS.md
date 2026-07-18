# Workflows

End-to-end flows. Terms: [GLOSSARY.md](GLOSSARY.md). Transitions: [STATE_MACHINE.md](STATE_MACHINE.md). AuthZ: [SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md). AI: [AI_CONSTITUTION.md](AI_CONSTITUTION.md).

Owner approval is required to create Tasks, Assignments, forwards, and Follow-up Assignments. Recipient capability actions on an already assigned Task use POST after confirm ([STATE_MACHINE.md](STATE_MACHINE.md)).

## Implemented through A5

| Workflow                                                  | Section                                   | Status                                                         |
| --------------------------------------------------------- | ----------------------------------------- | -------------------------------------------------------------- |
| Owner typed task creation and lifecycle                   | (via Owner APIs; partial overlap with §7) | **Production-verified**                                        |
| Recipient actions via Capability Link                     | §8                                        | **Production-verified**                                        |
| Waiting and snooze (Owner; Recipient waiting only)        | §9                                        | **Production-verified** (reminder side effects deferred to A8) |
| Dismissal (Task)                                          | §13                                       | **Production-verified**                                        |
| Recipient work request → pending Suggestion (persistence) | §8                                        | **Production-verified** (Owner review HTTP is A6)              |
| Gmail → Communication Event (no suggestions)              | §1 A5 portion                             | **Production-operational** (A5 closed)                         |

## Implemented and planned workflow map

Workflow §1 A5 portion (Gmail connection, Application Polling Engine, Authenticated Endpoint, events only; D077) is **production-operational**. A6 owns suggestion generation and Owner suggestion HTTP (D080–D085). Workflows §2–§7 (Recipient handoff aspects), §10–§12 (beyond A6 merge), and §14–§15 still depend on forwarding, reminders, Android capture, or retention workers not yet implemented. Sections below retain target behaviour; milestone labels note when each ships.

---

## 1. Gmail → Communication Event → Task Suggestion _(A5 events; A6 suggestions)_

1. Owner connects Gmail (`gmail.readonly`, Workspace domain). The **application** runs the Application Polling Engine; an **External Scheduler** invokes the Authenticated Endpoint every five minutes (D065, D079)—recommended initial adapter **cron-job.org** while on Vercel Hobby; Vercel Cron and other compatible schedulers remain interchangeable. No historical backfill (D067); Inbox-only (D068).
2. **A5:** store minimized `CommunicationEvent` (+ optional temporary capped excerpt). No Task Suggestions in A5 (D077). History commit is independent of suggestion processing (D075, D084).
3. **A6:** a separate External Scheduler job invokes `POST /api/v1/internal/suggestions/process` (D084). Heuristic relevance filter, then LLM extraction via `packages/ai` for events that pass (D085). At most one pending `TaskSuggestion` per event (D081). AI failure creates no fallback suggestion. Android notify is **not** an A6 acceptance requirement (A9 / D017).

No Task created; no email sent in this workflow.

## 2. Gmail-origin Assignment + forward (D037) _(planned — A7)_

1. Owner confirms one dialog disclosing: create/activate Task, Assignment, forward original + all attachments, Capability Link, reminders.
2. On confirm: create Task/Assignment; issue Capability; forward via Gmail API with AI summary **above** original (D042); schedule reminders; record forwarded message id (idempotent).

One confirmation only. Recipient email from Owner-managed records—not hard-coded. Partial forward failure must not be reported as complete success (D042; OPEN #9). A6 may have already created an **unassigned** Task from a suggestion (D080); A7 performs the Recipient handoff on that Task (or equivalent Owner-owned Task).

## 3. Google Messages → Task Suggestion _(planned — A10)_

1. NotificationListener captures content (dedupe); respect exclusions.
2. After Owner enables Messages as a source (D043): backend may analyze → `TaskSuggestion`.
3. Optional SMS draft opened in Google Messages for Owner send (no direct SMS send).

Task creation still requires Owner approval.

## 4. Missed call → voice proposal _(planned — A11/A12)_

When detected: prompt Owner. Voice → transcript → **Task Suggestion** or note proposal—never a Task (D038). Assignment uses workflow 2 or non-Gmail assignment path. Audio: D041 / [DATA_RETENTION.md](DATA_RETENTION.md).

## 5. Known Contact completed call _(planned — A11)_

Optional prompt only for Known Contacts. Unknown completed calls do not always prompt. Best-effort detection; manual/voice fallback always available.

## 6. Manual voice proposal _(planned — A12)_

Record → transcribe → structure → `Task Suggestion` until workflow 7. Voice never creates a Task (D038). Assignment still needs Owner confirmation.

## 7. Suggestion approval → Task _(planned — A6; partial today via Owner typed task create)_

Owner approves (after edits if any) with `acknowledgement: suggestion_approved` → create **unassigned** `Task` (D080); apply excerpt retention per D082. Self/Owner work needs no Recipient. **Do not** create TaskAssignment, capability, assignment email, Gmail forward, or reminders in A6. If `recipientId` is present → HTTP 400 `RECIPIENT_HANDOFF_NOT_AVAILABLE`. Recipient handoff for Gmail-origin uses workflow 2 (A7). Non-Gmail Recipient assignment email remains A7.

## 8. Recipient actions via Capability Link _(implemented — A4 production-verified)_

GET Capability Link: non-mutating view. POST after confirm: complete, waiting/resume, notes, return to Owner, clarification, work request → Suggestion. Forbidden actions and attribution: [SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md). Audit fields: D057.

## 9. Waiting and snooze _(implemented — A4; reminder scheduling A8)_

Waiting (Owner or Recipient capability): pause reminders until `waiting_until`. Snooze (Owner only): recalculate next reminder; does not change Task status ([STATE_MACHINE.md](STATE_MACHINE.md)).

## 10. Reminder and escalation _(planned — A8)_

The application reminder engine selects actionable, non-waiting tasks due for reminder and records idempotent attempt rows. An External Scheduler invokes the authenticated reminder endpoint; the scheduler does not own reminder policy or selection logic. First overdue → Recipient; later stages may CC Owner. Deterministic policy sends; AI does not. Delivery via Gmail API.

## 11. Voice completion + follow-up proposal _(planned — A12)_

Structure multi-intent utterance. On Owner confirm: complete **current** Task; create follow-up only as `Task Suggestion` (D038). Hold Recipient assignment/email/forward until D037 confirmation when applicable.

## 12. Merge duplicate suggestion _(planned — A6)_

Owner merges into existing Task; requires suggestion `If-Match` and `targetTaskIfMatch` (D083); mark suggestion `merged`; optional summary append; no assignment email by default. Excerpt `purgeAt = mergedAt + 7 days` (D082).

## 13. Dismissal _(implemented — A4 for Tasks; A6 for Suggestions)_

Owner dismisses suggestion or Task → terminal dismiss; excerpt purge deadline `terminalAt + 7 days` (D020, D082); learning signal if provided (durable learning A14). No assignment email.

## 14. Retention cleanup _(planned — A13)_

Policy-driven: excerpt purge; completed content scrub; audio already deleted on success path; extract Owner learning before scrub (D054); **do not** delete Gmail mailbox forwards (D031). Details: [DATA_RETENTION.md](DATA_RETENTION.md). Tombstone duration: OPEN #12.

## 15. Learning / rule proposal _(planned — A14)_

Record `LearningSignal`; optionally propose `WorkflowRule`. Apply only on Owner approval (D054). Recipients do not participate. No silent activation in v1.
