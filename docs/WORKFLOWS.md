# Workflows

End-to-end flows. Terms: [GLOSSARY.md](GLOSSARY.md). Transitions: [STATE_MACHINE.md](STATE_MACHINE.md). AuthZ: [SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md). AI: [AI_CONSTITUTION.md](AI_CONSTITUTION.md).

Owner approval is required to create Tasks, Assignments, forwards, and Follow-up Assignments. Recipient capability actions on an already assigned Task use POST after confirm ([STATE_MACHINE.md](STATE_MACHINE.md)).

## Implemented through A6

| Workflow                                                  | Section                                   | Status                                                         |
| --------------------------------------------------------- | ----------------------------------------- | -------------------------------------------------------------- |
| Owner typed task creation and lifecycle                   | (via Owner APIs; partial overlap with §7) | **Production-verified**                                        |
| Recipient actions via Capability Link                     | §8                                        | **Production-verified**                                        |
| Waiting and snooze (Owner; Recipient waiting only)        | §9                                        | **Production-verified** (reminder side effects deferred to A8) |
| Dismissal (Task)                                          | §13                                       | **Production-verified**                                        |
| Recipient work request → pending Suggestion (persistence) | §8                                        | **Production-verified**                                        |
| Gmail → Communication Event (no suggestions)              | §1 A5 portion                             | **Production-operational** (A5 closed)                         |
| Suggestion generation + Owner suggestion HTTP             | §1 A6 / §7 / §12                          | **Production-operational** (A6 closed)                         |

## Implemented and planned workflow map

Workflow §1 (A5 events + A6 suggestions) and §7 / §12 (approve / merge) are **production-operational**. Workflow §2 (Recipient handoff) has its **API route (A7.7) and Owner confirmation / re-consent UI (A7.8) implemented and validated**; production E2E remains open (parent A7 open). §10 reminders are **A8**. §14–§15 and Android capture remain later milestones. Sections below retain target behaviour; milestone labels note when each ships.

---

## 1. Gmail → Communication Event → Task Suggestion _(A5 events; A6 suggestions — production-operational)_

1. Owner connects Gmail (`gmail.readonly` for ingest; A7 adds `gmail.send` for outbound — D093). The **application** runs the Application Polling Engine; an **External Scheduler** invokes the Authenticated Endpoint every five minutes (D065, D079)—recommended initial adapter **cron-job.org** while on Vercel Hobby; Vercel Cron and other compatible schedulers remain interchangeable. No historical backfill (D067); Inbox-only (D068).
2. **A5:** store minimized `CommunicationEvent` (+ optional temporary capped excerpt). No Task Suggestions in A5 (D077). History commit is independent of suggestion processing (D075, D084).
3. **A6:** a separate External Scheduler job invokes `POST /api/v1/internal/suggestions/process` (D084). Deterministic heuristic relevance filter first, then LLM extraction via `packages/ai` for events that pass (D085). At most one pending `TaskSuggestion` per event (D081). AI failure creates no fallback suggestion. Retryable provider/schema failures use `failed_retryable` until the claim max-attempt ceiling; permanent only for stable event-specific conditions (for example policy refusal). Global AI misconfiguration must not permanently poison events. Android notify is **not** an A6 acceptance requirement (A9 / D017).

No Task created; no email sent in this workflow.

## 2. Recipient handoff — Gmail-origin forward or assignment email (D037) _(A7.7 API + A7.8 Owner UI)_

Applies to an **existing** Owner-owned Task (typically an **unassigned** Task from A6 suggestion approval, D080). Handoff does **not** recreate the Task.

1. Owner opens `/tasks/[taskId]`, selects an active Recipient, and confirms one dialog (**A7.8**) disclosing: activate Assignment on the existing Task, issue Capability Link, forward original + all attachments **or** send assignment email (server chooses from Task source), Gmail retention boundary when forwarding (D031), and that follow-up/reminder behaviour belongs to the assignment workflow (**A8** implements reminders — D089). Do **not** claim reminders are currently scheduled.
2. The UI invokes `POST /api/v1/tasks/{taskId}/handoff` with the original If-Match and a stable Idempotency-Key retained in `sessionStorage` for the logical operation (D090). **A7.7** classifies successful/pending/failed same-key replay and new initial handoff. Missing `gmail.send` → re-consent via OAuth start with `returnPath=/tasks/{taskId}`, then **manual** Retry handoff (no auto-send on OAuth return).
3. On confirm (D092): validate Task, Recipient (D087), Gmail authorization (D093), and (for Gmail-origin) source message + attachment availability. Persist a durable handoff/delivery attempt and one capability. Attempt delivery via Owner’s connected Gmail. **Activate** the Assignment only after Gmail accepts the send. Record provider message id for idempotency. Outbound summary uses existing Task `summaryPoints` (no fresh LLM — D094). Ambiguous provider outcomes leave the attempt `pending` for a later reconciliation slice (not auto-resent).
4. Gmail-origin: forward full original + all attachments with summary **above** original (D010, D042). If anything required cannot be fetched or assembled, **do not send**; record privacy-safe failed attempt; Owner gets a clear error (D088). Never report partial delivery as success. Never silently downgrade to assignment email.
5. Non-Gmail: assignment email with summary + Capability Link (no attachments / no Gmail forward), still via Owner Gmail (D094).
6. One active capability only. Ordinary same-key retry of a failed delivery reuses the same attempt/capability and historical address snapshot (A7.7). Reassignment or explicit re-forward (revoke prior active capability) remains **deferred**.

Recipient email from Owner-managed Recipient records only (D087)—not hard-coded and not an env default. Reminder schedules/sends are **out of scope for A7** (D089). Proposed-Recipient hint resolution is **not** in the current handoff request schema and remains deferred.

## 3. Google Messages → Task Suggestion _(planned — A10)_

1. NotificationListener captures content (dedupe); respect exclusions.
2. After Owner enables Messages as a source (D043): backend may analyze → `TaskSuggestion`.
3. Optional SMS draft opened in Google Messages for Owner send (no direct SMS send).

Task creation still requires Owner approval.

## 4. Missed call → voice proposal _(planned — A11/A12)_

When detected: prompt Owner. Voice → transcript → **Task Suggestion** or note proposal—never a Task (D038). Assignment uses workflow 2. Audio: D041 / [DATA_RETENTION.md](DATA_RETENTION.md).

## 5. Known Contact completed call _(planned — A11)_

Optional prompt only for Known Contacts. Unknown completed calls do not always prompt. Best-effort detection; manual/voice fallback always available.

## 6. Manual voice proposal _(planned — A12)_

Record → transcribe → structure → `Task Suggestion` until workflow 7. Voice never creates a Task (D038). Assignment still needs Owner confirmation via workflow 2.

## 7. Suggestion approval → unassigned Task _(implemented — A6 production-operational)_

Owner approves (after edits if any) with `acknowledgement: suggestion_approved` → create **unassigned** `Task` (D080); apply excerpt retention per D082. Self/Owner work needs no Recipient and remains unassigned (D094). **Do not** create TaskAssignment, capability, assignment email, Gmail forward, or reminders in A6. If `recipientId` is present → HTTP 400 `RECIPIENT_HANDOFF_NOT_AVAILABLE`. Recipient handoff uses workflow 2 (`POST …/handoff`, A7 / D090). Optional `proposedRecipientHint` may map to `proposedRecipientId` only via deterministic match to an active Recipient—never auto-assign (D094).

Typed Task create (`POST /api/v1/tasks`) creates an unassigned Task for Owner work. Create-with-`recipientId` is **deprecated** and is **rejected** (A7.6): any body owning a top-level `recipientId` (any value) returns `400 RECIPIENT_HANDOFF_NOT_AVAILABLE` before side effects, and `createOwnerTask` only ever creates an unassigned Task (D091)—handoff is the only production Recipient assignment path.

## 8. Recipient actions via Capability Link _(implemented — A4 production-verified)_

GET Capability Link: non-mutating view. POST after confirm: complete, waiting/resume, notes, return to Owner, clarification, work request → Suggestion. Forbidden actions and attribution: [SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md). Audit fields: D057. Matched superseded capabilities may fail with `CAPABILITY_NO_LONGER_ACTIVE` (D086); other unusable/unmatched cases remain generic `UNAUTHORIZED`.

## 9. Waiting and snooze _(implemented — A4; reminder scheduling A8)_

Waiting (Owner or Recipient capability): pause reminders until `waiting_until`. Snooze (Owner only): recalculate next reminder; does not change Task status ([STATE_MACHINE.md](STATE_MACHINE.md)). Reminder **sends** remain A8.

## 10. Reminder and escalation _(planned — A8)_

The application reminder engine selects actionable, non-waiting tasks with an active **delivered** Assignment (from A7) due for reminder and records idempotent attempt rows. An External Scheduler invokes the authenticated reminder endpoint; the scheduler does not own reminder policy or selection logic. First overdue → Recipient; later stages may CC Owner. Deterministic policy sends; AI does not. Delivery via Gmail API. A7 does not implement this workflow (D089).

## 11. Voice completion + follow-up proposal _(planned — A12)_

Structure multi-intent utterance. On Owner confirm: complete **current** Task; create follow-up only as `Task Suggestion` (D038). Hold Recipient assignment/email/forward until D037 confirmation when applicable.

## 12. Merge duplicate suggestion _(implemented — A6 production-operational)_

Owner merges into existing Task; requires suggestion `If-Match` and `targetTaskIfMatch` (D083); mark suggestion `merged`; optional summary append; no assignment email by default. Excerpt `purgeAt = mergedAt + 7 days` (D082).

## 13. Dismissal _(implemented — A4 for Tasks; A6 for Suggestions)_

Owner dismisses suggestion or Task → terminal dismiss; excerpt purge deadline `terminalAt + 7 days` (D020, D082); learning signal if provided (durable learning A14). No assignment email.

## 14. Retention cleanup _(planned — A13)_

Policy-driven: excerpt purge; completed content scrub; audio already deleted on success path; extract Owner learning before scrub (D054); **do not** delete Gmail mailbox forwards (D031). Details: [DATA_RETENTION.md](DATA_RETENTION.md). Tombstone duration: OPEN #12.

## 15. Learning / rule proposal _(planned — A14)_

Record `LearningSignal`; optionally propose `WorkflowRule`. Apply only on Owner approval (D054). Recipients do not participate. No silent activation in v1.
