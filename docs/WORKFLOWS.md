# Workflows

End-to-end flows. Terms: [GLOSSARY.md](GLOSSARY.md). Transitions: [STATE_MACHINE.md](STATE_MACHINE.md). AuthZ: [SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md). AI: [AI_CONSTITUTION.md](AI_CONSTITUTION.md).

Owner approval is required to create Tasks, Assignments, forwards, and Follow-up Assignments. Recipient capability actions on an already assigned Task use POST after confirm ([STATE_MACHINE.md](STATE_MACHINE.md)).

## Implemented through A4

| Workflow                                                  | Section                                   | Status                                                         |
| --------------------------------------------------------- | ----------------------------------------- | -------------------------------------------------------------- |
| Owner typed task creation and lifecycle                   | (via Owner APIs; partial overlap with §7) | **Production-verified**                                        |
| Recipient actions via Capability Link                     | §8                                        | **Production-verified**                                        |
| Waiting and snooze (Owner; Recipient waiting only)        | §9                                        | **Production-verified** (reminder side effects deferred to A8) |
| Dismissal (Task)                                          | §13                                       | **Production-verified**                                        |
| Recipient work request → pending Suggestion (persistence) | §8                                        | **Production-verified** (Owner review HTTP is A6)              |

## Implemented and planned workflow map

Workflow §1 has A5 repository implementation for Gmail connection, the Application Polling Engine, and the Authenticated Endpoint invoked by External Schedulers (events only; D077). Production migration, live Gmail credentials, and scheduler secrets remain unconfigured. Workflows §1 suggestion generation, §2–§7, §10–§12, and §14–§15 still depend on AI, Android capture, reminders, forwarding, or retention workers not yet implemented. Sections below retain target behaviour; milestone labels note when each ships.

---

## 1. Gmail → Communication Event → Task Suggestion _(A5 events; A6 suggestions)_

1. Owner connects Gmail (`gmail.readonly`, Workspace domain). The **application** runs the Application Polling Engine; an **External Scheduler** invokes the Authenticated Endpoint every five minutes (D065, D079)—recommended initial adapter **cron-job.org** while on Vercel Hobby; Vercel Cron and other compatible schedulers remain interchangeable. No historical backfill (D067); Inbox-only (D068).
2. **A5:** store minimized `CommunicationEvent` (+ optional temporary capped excerpt). No Task Suggestions in A5 (D077).
3. **A6:** heuristic (+ optional cheap AI) filter → structured `TaskSuggestion`; notify Owner on Android when available.

No Task created; no email sent in this workflow.

## 2. Gmail-origin Assignment + forward (D037) _(planned — A7)_

1. Owner confirms one dialog disclosing: create/activate Task, Assignment, forward original + all attachments, Capability Link, reminders.
2. On confirm: create Task/Assignment; issue Capability; forward via Gmail API with AI summary **above** original (D042); schedule reminders; record forwarded message id (idempotent).

One confirmation only. Recipient email from Owner-managed records—not hard-coded. Partial forward failure must not be reported as complete success (D042; OPEN #9).

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

Owner approves (after edits if any) → create `Task`; schedule retention. Self-assignment needs no Recipient email. Recipient handoff for Gmail-origin uses workflow 2’s single bundled confirmation—not a second forward step. Non-Gmail Recipient assignment: one confirmation without Gmail forward.

## 8. Recipient actions via Capability Link _(implemented — A4 production-verified)_

GET Capability Link: non-mutating view. POST after confirm: complete, waiting/resume, notes, return to Owner, clarification, work request → Suggestion. Forbidden actions and attribution: [SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md). Audit fields: D057.

## 9. Waiting and snooze _(implemented — A4; reminder scheduling A8)_

Waiting (Owner or Recipient capability): pause reminders until `waiting_until`. Snooze (Owner only): recalculate next reminder; does not change Task status ([STATE_MACHINE.md](STATE_MACHINE.md)).

## 10. Reminder and escalation _(planned — A8)_

The application reminder engine selects actionable, non-waiting tasks due for reminder and records idempotent attempt rows. An External Scheduler invokes the authenticated reminder endpoint; the scheduler does not own reminder policy or selection logic. First overdue → Recipient; later stages may CC Owner. Deterministic policy sends; AI does not. Delivery via Gmail API.

## 11. Voice completion + follow-up proposal _(planned — A12)_

Structure multi-intent utterance. On Owner confirm: complete **current** Task; create follow-up only as `Task Suggestion` (D038). Hold Recipient assignment/email/forward until D037 confirmation when applicable.

## 12. Merge duplicate suggestion _(planned — A6)_

Owner merges into existing Task; mark suggestion `merged`; optional summary append; learning signal. No extra assignment email by default.

## 13. Dismissal _(implemented — A4 for Tasks)_

Owner dismisses suggestion or Task → terminal dismiss; excerpt purge +7 days; learning signal if provided. No assignment email.

## 14. Retention cleanup _(planned — A13)_

Policy-driven: excerpt purge; completed content scrub; audio already deleted on success path; extract Owner learning before scrub (D054); **do not** delete Gmail mailbox forwards (D031). Details: [DATA_RETENTION.md](DATA_RETENTION.md). Tombstone duration: OPEN #12.

## 15. Learning / rule proposal _(planned — A14)_

Record `LearningSignal`; optionally propose `WorkflowRule`. Apply only on Owner approval (D054). Recipients do not participate. No silent activation in v1.
