# Workflows

End-to-end flows. Terms: [GLOSSARY.md](GLOSSARY.md). Transitions: [STATE_MACHINE.md](STATE_MACHINE.md). AuthZ: [SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md). AI: [AI_CONSTITUTION.md](AI_CONSTITUTION.md). Binding A8.0: D095–D101.

Owner approval is required to create Tasks, Assignments, forwards, and Next-action Suggestions that become Tasks. Recipient capability actions on an already assigned Task use POST after confirm ([STATE_MACHINE.md](STATE_MACHINE.md)).

## Implemented through A6

| Workflow                                                  | Section                                   | Status                                                     |
| --------------------------------------------------------- | ----------------------------------------- | ---------------------------------------------------------- |
| Owner typed task creation and lifecycle                   | (via Owner APIs; partial overlap with §7) | **Production-verified**                                    |
| Recipient actions via Capability Link                     | §8                                        | **Production-verified**                                    |
| Waiting (Owner; Recipient waiting)                        | §9                                        | **Production-verified** (Follow-up Engine side effects A8) |
| Dismissal (Task)                                          | §13                                       | **Production-verified**                                    |
| Recipient work request → pending Suggestion (persistence) | §8                                        | **Production-verified**                                    |
| Gmail → Communication Event (no suggestions)              | §1 A5 portion                             | **Production-operational** (A5 closed)                     |
| Suggestion generation + Owner suggestion HTTP             | §1 A6 / §7 / §12                          | **Production-operational** (A6 closed)                     |

## Implemented and planned workflow map

Workflow §1 (A5 events + A6 suggestions) and §7 / §12 (approve / merge) are **production-operational**. Workflow §2 (Recipient handoff) has its **API route (A7.7) and Owner confirmation / re-consent UI (A7.8) implemented and validated**; production E2E remains open (parent A7 open). §10 Follow-up Engine and Event Notification Engine are **A8** (D095–D101; documentation locked in A8.0). §14–§15 and Android capture remain later milestones. Sections below retain target behaviour; milestone labels note when each ships.

---

## 1. Gmail → Communication Event → Task Suggestion _(A5 events; A6 suggestions — production-operational)_

1. Owner connects Gmail (`gmail.readonly` for ingest; A7 adds `gmail.send` for outbound — D093). The **application** runs the Application Polling Engine; an **External Scheduler** invokes the Authenticated Endpoint every five minutes (D065, D079)—recommended initial adapter **cron-job.org** while on Vercel Hobby; Vercel Cron and other compatible schedulers remain interchangeable. No historical backfill (D067); Inbox-only (D068).
2. **A5:** store minimized `CommunicationEvent` (+ optional temporary capped excerpt). No Task Suggestions in A5 (D077). History commit is independent of suggestion processing (D075, D084).
3. **A6:** a separate External Scheduler job invokes `POST /api/v1/internal/suggestions/process` (D084). Deterministic heuristic relevance filter first, then LLM extraction via `packages/ai` for events that pass (D085). At most one pending `TaskSuggestion` per event (D081). AI failure creates no fallback suggestion. Retryable provider/schema failures use `failed_retryable` until the claim max-attempt ceiling; permanent only for stable event-specific conditions (for example policy refusal). Global AI misconfiguration must not permanently poison events. Android notify is **not** an A6 acceptance requirement (A9 / D017).

No Task created; no email sent in this workflow.

## 2. Recipient handoff — Gmail-origin forward or assignment email (D037) _(A7.7 API + A7.8 Owner UI)_

Applies to an **existing** Owner-owned Task (typically an **unassigned** Task from A6 suggestion approval, D080). Handoff does **not** recreate the Task.

1. Owner opens `/tasks/[taskId]`, selects an active Recipient, and confirms one dialog (**A7.8**) disclosing: activate Assignment on the existing Task, issue Capability Link, forward original + all attachments **or** send assignment email (server chooses from Task source), Gmail retention boundary when forwarding (D031), and that follow-up behaviour belongs to the assignment workflow (**A8** Follow-up Engine — D089, D095). Do **not** claim a Follow-up Schedule is active or that follow-ups are being sent while A8 is not operational. **Owner confirmation of the Phase 1 follow-up interval preset is A8 product law (D095)**—not an A7 acceptance criterion; A7.8 need not collect the interval until A8 contract/UI alignment.
2. The UI invokes `POST /api/v1/tasks/{taskId}/handoff` with the original If-Match and a stable Idempotency-Key retained in `sessionStorage` for the logical operation (D090). **A7.7** classifies successful/pending/failed same-key replay and new initial handoff. Missing `gmail.send` → re-consent via OAuth start with `returnPath=/tasks/{taskId}`, then **manual** Retry handoff (no auto-send on OAuth return).
3. On confirm (D092): validate Task, Recipient (D087), Gmail authorization (D093), and (for Gmail-origin) source message + attachment availability. Persist a durable handoff/delivery attempt and one capability. Attempt delivery via Owner’s connected Gmail. **Activate** the Assignment only after Gmail accepts the send. Record provider message id for idempotency. Outbound summary uses existing Task `summaryPoints` (no fresh LLM — D094). Ambiguous provider outcomes leave the attempt `pending` for a later reconciliation slice (not auto-resent).
4. Gmail-origin: forward full original + all attachments with summary **above** original (D010, D042). If anything required cannot be fetched or assembled, **do not send**; record privacy-safe failed attempt; Owner gets a clear error (D088). Never report partial delivery as success. Never silently downgrade to assignment email.
5. Non-Gmail: assignment email with summary + Capability Link (no attachments / no Gmail forward), still via Owner Gmail (D094).
6. One active capability only. Ordinary same-key retry of a failed delivery reuses the same attempt/capability and historical address snapshot (A7.7). Reassignment or explicit re-forward (revoke prior active capability) remains **deferred**.
7. **Follow-up Engine (A8):** no Follow-up Schedule becomes active until Assignment delivery is **`sent`** (D095). A7 must not run Follow-up Engine jobs or sends (D089). Phase 1 interval confirmation and schedule activation are A8.

Recipient email from Owner-managed Recipient records only (D087)—not hard-coded and not an env default. Proposed-Recipient hint resolution is **not** in the current handoff request schema and remains deferred.

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

Owner approves (after edits if any) with `acknowledgement: suggestion_approved` → create **unassigned** `Task` (D080); apply excerpt retention per D082. Self/Owner work needs no Recipient and remains unassigned (D094). **Do not** create TaskAssignment, capability, assignment email, Gmail forward, or a Follow-up Schedule in A6. If `recipientId` is present → HTTP 400 `RECIPIENT_HANDOFF_NOT_AVAILABLE`. Recipient handoff uses workflow 2 (`POST …/handoff`, A7 / D090). Optional `proposedRecipientHint` may map to `proposedRecipientId` only via deterministic match to an active Recipient—never auto-assign (D094). Optional `dueAt` on approve is informational only (D098).

Typed Task create (`POST /api/v1/tasks`) creates an unassigned Task for Owner work. Create-with-`recipientId` is **deprecated** and is **rejected** (A7.6): any body owning a top-level `recipientId` (any value) returns `400 RECIPIENT_HANDOFF_NOT_AVAILABLE` before side effects, and `createOwnerTask` only ever creates an unassigned Task (D091)—handoff is the only production Recipient assignment path.

## 8. Recipient actions via Capability Link _(implemented — A4 production-verified)_

GET Capability Link: non-mutating view. POST after confirm: complete, waiting/resume, notes, return to Owner, clarification, work request → Suggestion. Forbidden actions and attribution: [SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md). Audit fields: D057. Matched superseded capabilities may fail with `CAPABILITY_NO_LONGER_ACTIVE` (D086); other unusable/unmatched cases remain generic `UNAUTHORIZED`.

Meaningful Recipient outcomes feed the **Event Notification Engine** in A8 (D099)—not the Follow-up Engine’s cadence model beyond eligibility rules.

## 9. Waiting _(implemented — A4; Follow-up Engine interaction A8)_

Waiting (Owner or Recipient capability): suspends Follow-up eligibility until waiting ends (D097). Waiting does not change retention clocks. **Snooze is not an A8 Follow-up control** (D101). Follow-up Engine sends remain A8.

## 10. Follow-up Engine and Event Notification Engine _(planned — A8; product law locked A8.0)_

Authoritative A8 product rules (D095–D101). Do not duplicate this specification elsewhere—cite this section.

### 10a. Follow-up Engine (time-driven, Assignment-scoped)

**Purpose:** send Recipient follow-ups after an Assignment has been successfully delivered, so communications are followed through until conclusion—not calendar/due-date management.

**Invariants (D096):** A Follow-up Schedule belongs to one Assignment; at most one active schedule per Assignment; schedules never transfer; reassignment terminates the old schedule and requires a new Owner-confirmed Phase 1 interval; delayed/stale scheduler work must not advance a terminated schedule; deterministic application rules control sends (D027).

**General rule:** A Follow-up Schedule exists only while its Assignment is **active** and **follow-up eligible** ([GLOSSARY.md](GLOSSARY.md)).

**Phase 1 — Initial Follow-up Delay (D095):**

1. At handoff, Owner confirms one preset: **24 hours**, **48 hours**, **72 hours**, or **1 week**.
2. AI may recommend the interval; AI must not create, activate, or send without Owner confirmation.
3. Clock starts only when Assignment delivery is **`sent`**. No schedule while `pending`, `failed`, ambiguous, or awaiting reconciliation.
4. Initial interval is used **once** (not repeating).

**Phase 2 — Standard Follow-up Interval (D095):**

1. After the first Follow-up Attempt is successfully delivered, enter Phase 2.
2. Phase 2 uses the system standard interval (internal configuration; **default 24 hours**; not Owner-configurable in v1).
3. Continues while the Assignment remains active and follow-up eligible.

**Waiting (D097):** suspends the schedule; do not preserve partial elapsed time. On resume: fresh Phase 2 from resume if the first Attempt was already successfully delivered; otherwise fresh Phase 1 from resume using the same Owner-confirmed Phase 1 preset.

**Audience:** Follow-up Attempts → **Recipient** only (D099). Delivery via Owner’s connected Gmail (same outbound family as A7).

**Operations:** application Follow-up Engine selects eligible Assignments and records idempotent Follow-up Attempts (D100). An External Scheduler invokes an authenticated processing endpoint; the scheduler does not own policy (D079). A7 does not implement this workflow (D089).

### 10b. Event Notification Engine (event-driven)

**Purpose:** notify the **Owner** about meaningful domain events (D099). Separate from the Follow-up Engine—do not mix via CC/escalation.

**Core A8 event list (minimum):**

- Recipient completed the Task
- Clarification requested
- Assignment returned to Owner
- Assignment delivery failed
- Gmail disconnected
- Capability expired

**Channel (D099):** A8 delivers approved Owner Event Notifications by **email via the Owner’s connected Gmail account** (core event list above). Keep this engine separate from Recipient Follow-up Attempts. **FCM/push remains deferred (D017)** and is an A9 concern.

**Retired A8 models:** first-overdue triggers, escalating reminder stages, Owner CC ladders, overdue-threshold-driven sends.

## 11. Voice completion + Next-action Suggestion _(planned — A12)_

Structure multi-intent utterance. On Owner confirm: complete **current** Task; create further work only as a **Next-action Suggestion** / Task Suggestion (D038). Hold Recipient assignment/email/forward until D037 confirmation when applicable. (OpenAPI wire name remains `FollowUpProposal` during A8—temporary contract naming debt; see Glossary.)

## 12. Merge duplicate suggestion _(implemented — A6 production-operational)_

Owner merges into existing Task; requires suggestion `If-Match` and `targetTaskIfMatch` (D083); mark suggestion `merged`; optional summary append; no assignment email by default. Excerpt `purgeAt = mergedAt + 7 days` (D082).

## 13. Dismissal _(implemented — A4 for Tasks; A6 for Suggestions)_

Owner dismisses suggestion or Task → terminal dismiss; excerpt purge deadline `terminalAt + 7 days` (D020, D082); learning signal if provided (durable learning A14). No assignment email. Terminal Task/Assignment states end Follow-up eligibility (D096).

## 14. Retention cleanup _(planned — A13)_

Policy-driven: excerpt purge; completed content scrub; audio already deleted on success path; extract Owner learning before scrub (D054); **do not** delete Gmail mailbox forwards (D031). Details: [DATA_RETENTION.md](DATA_RETENTION.md). Tombstone duration: OPEN #12.

## 15. Learning / rule proposal _(planned — A14)_

Record `LearningSignal`; optionally propose `WorkflowRule`. Apply only on Owner approval (D054). Recipients do not participate. No silent activation in v1. Owner-confirmed Follow-up interval choices and edits are eligible future learning signals without storing raw message bodies (D100, D022).
