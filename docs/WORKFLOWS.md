# Workflows

End-to-end flows. Terms: [GLOSSARY.md](GLOSSARY.md). Transitions: [STATE_MACHINE.md](STATE_MACHINE.md). AuthZ: [SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md). AI: [AI_CONSTITUTION.md](AI_CONSTITUTION.md). Binding A8 product law: **D102–D110 (A8.1)**, which supersede parts of the A8.0 lock (D095–D101). §10a is authoritative for reminder behaviour.

Owner approval is required to create Tasks, Assignments, forwards, and Next-action Suggestions that become Tasks. Recipient capability actions on an already assigned Task use POST after confirm ([STATE_MACHINE.md](STATE_MACHINE.md)).

## Implemented through A7

| Workflow                                                  | Section                                   | Status                                                     |
| --------------------------------------------------------- | ----------------------------------------- | ---------------------------------------------------------- |
| Recipient handoff (forward or assignment email)           | §2                                        | **Production-operational** (A7 closed)                     |
| Owner typed task creation and lifecycle                   | (via Owner APIs; partial overlap with §7) | **Production-verified**                                    |
| Recipient actions via Capability Link                     | §8                                        | **Production-verified**                                    |
| Waiting (Owner; Recipient waiting)                        | §9                                        | **Production-verified** (Follow-up Engine side effects A8) |
| Dismissal (Task)                                          | §13                                       | **Production-verified**                                    |
| Recipient work request → pending Suggestion (persistence) | §8                                        | **Production-verified**                                    |
| Gmail → Communication Event (no suggestions)              | §1 A5 portion                             | **Production-operational** (A5 closed)                     |
| Suggestion generation + Owner suggestion HTTP             | §1 A6 / §7 / §12                          | **Production-operational** (A6 closed)                     |

## Implemented and planned workflow map

Workflow §1 (A5 events + A6 suggestions) and §7 / §12 (approve / merge) are **production-operational**. Workflow §2 (Recipient handoff) is **production-operational** as of A7 close: both delivery paths, Recipient capability completion, and Owner-visible notes are production-verified. Reassignment and explicit re-forward within §2 remain deferred ([MILESTONES.md](MILESTONES.md) A7 deferred backlog). §10 Follow-up Engine and Event Notification Engine are **A8** and **not implemented**: the due-date-driven reminder model is documentation-locked in **A8.1 (D102–D110)** and awaits implementation authorization. §14–§15 and Android capture remain later milestones. §16 Owner web experience states is **P1**, documentation-locked in **P1.0 (D111–D120)** and not implemented; it changes no workflow behaviour and governs presentation and observation only. Sections below retain target behaviour; milestone labels note when each ships.

---

## 1. Gmail → Communication Event → Task Suggestion _(A5 events; A6 suggestions — production-operational)_

1. Owner connects Gmail (`gmail.readonly` for ingest; A7 adds `gmail.send` for outbound — D093). The **application** runs the Application Polling Engine; an **External Scheduler** invokes the Authenticated Endpoint every five minutes (D065, D079)—recommended initial adapter **cron-job.org** while on Vercel Hobby; Vercel Cron and other compatible schedulers remain interchangeable. No historical backfill (D067); Inbox-only (D068).
2. **A5:** store minimized `CommunicationEvent` (+ optional temporary capped excerpt). No Task Suggestions in A5 (D077). History commit is independent of suggestion processing (D075, D084).
3. **A6:** a separate External Scheduler job invokes `POST /api/v1/internal/suggestions/process` (D084). Deterministic heuristic relevance filter first, then LLM extraction via `packages/ai` for events that pass (D085). At most one pending `TaskSuggestion` per event (D081). AI failure creates no fallback suggestion. Retryable provider/schema failures use `failed_retryable` until the claim max-attempt ceiling; permanent only for stable event-specific conditions (for example policy refusal). Global AI misconfiguration must not permanently poison events. Android notify is **not** an A6 acceptance requirement (A9 / D017).

No Task created; no email sent in this workflow.

## 2. Recipient handoff — Gmail-origin forward or assignment email (D037) _(A7 — production-operational)_

Applies to an **existing** Owner-owned Task (typically an **unassigned** Task from A6 suggestion approval, D080). Handoff does **not** recreate the Task.

1. Owner opens `/tasks/[taskId]`, selects an active Recipient, and confirms one dialog (**A7.8**) disclosing: activate Assignment on the existing Task, issue Capability Link, forward original + all attachments **or** send assignment email (server chooses from Task source), Gmail retention boundary when forwarding (D031), and that follow-up behaviour belongs to the assignment workflow (**A8** Follow-up Engine — D089, D102). Do **not** claim a Reminder Schedule is active or that reminders are being sent while A8 is not operational. Handoff collects **no** follow-up interval: preset intervals are retired (D095 superseded in part by D102). Under the A8.1 model, reminders derive from the Owner-selected **Task due date** (D102–D106), which is set on the Task rather than confirmed at handoff.
2. The UI invokes `POST /api/v1/tasks/{taskId}/handoff` with the original If-Match and a stable Idempotency-Key retained in `sessionStorage` for the logical operation (D090). **A7.7** classifies successful/pending/failed same-key replay and new initial handoff. Missing `gmail.send` → re-consent via OAuth start with `returnPath=/tasks/{taskId}`, then **manual** Retry handoff (no auto-send on OAuth return).
3. On confirm (D092): validate Task, Recipient (D087), Gmail authorization (D093), and (for Gmail-origin) source message + attachment availability. Persist a durable handoff/delivery attempt and one capability. Attempt delivery via Owner’s connected Gmail. **Activate** the Assignment only after Gmail accepts the send. Record provider message id for idempotency. Outbound summary uses existing Task `summaryPoints` (no fresh LLM — D094). Ambiguous provider outcomes leave the attempt `pending` for a later reconciliation slice (not auto-resent).
4. Gmail-origin: forward full original + all attachments with summary **above** original (D010, D042). If anything required cannot be fetched or assembled, **do not send**; record privacy-safe failed attempt; Owner gets a clear error (D088). Never report partial delivery as success. Never silently downgrade to assignment email.
5. Non-Gmail: assignment email with summary + Capability Link (no attachments / no Gmail forward), still via Owner Gmail (D094).
6. One active capability only. Ordinary same-key retry of a failed delivery reuses the same attempt/capability and historical address snapshot (A7.7). Reassignment or explicit re-forward (revoke prior active capability) remains **deferred**.
7. **Follow-up Engine (A8):** Reminder Schedules are **Task-scoped** and driven by the Owner-selected due date (D102, D104); handoff neither creates nor activates one. Reminder delivery additionally requires an **active assignment** (D107). A7 must not run reminder jobs or sends (D089).

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

Owner approves (after edits if any) with `acknowledgement: suggestion_approved` → create **unassigned** `Task` (D080); apply excerpt retention per D082. Self/Owner work needs no Recipient and remains unassigned (D094). **Do not** create TaskAssignment, capability, assignment email, Gmail forward, or send any reminder in A6. If `recipientId` is present → HTTP 400 `RECIPIENT_HANDOFF_NOT_AVAILABLE`. Recipient handoff uses workflow 2 (`POST …/handoff`, A7 / D090). Optional `proposedRecipientHint` may map to `proposedRecipientId` only via deterministic match to an active Recipient—never auto-assign (D094). An optional due date on approve is an **explicit Owner selection** and, once A8 is implemented, becomes the authoritative reminder scheduling input (D102, §10a); an AI-proposed due date has no scheduling effect unless the Owner selects it (D027, D102).

Typed Task create (`POST /api/v1/tasks`) creates an unassigned Task for Owner work. Create-with-`recipientId` is **deprecated** and is **rejected** (A7.6): any body owning a top-level `recipientId` (any value) returns `400 RECIPIENT_HANDOFF_NOT_AVAILABLE` before side effects, and `createOwnerTask` only ever creates an unassigned Task (D091)—handoff is the only production Recipient assignment path.

## 8. Recipient actions via Capability Link _(implemented — A4 production-verified)_

GET Capability Link: non-mutating view. POST after confirm: complete, waiting/resume, notes, return to Owner, clarification, work request → Suggestion. Forbidden actions and attribution: [SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md). Audit fields: D057. Matched superseded capabilities may fail with `CAPABILITY_NO_LONGER_ACTIVE` (D086); other unusable/unmatched cases remain generic `UNAUTHORIZED`.

Meaningful Recipient outcomes feed the **Event Notification Engine** in A8 (D099). They do **not** change reminder timing, which derives only from the due date (D102–D106); they affect reminders only through the stop, suspension, and delivery-eligibility rules in §10a (D107).

## 9. Waiting _(implemented — A4; Follow-up Engine interaction A8)_

Waiting (Owner or Recipient capability): suspends Follow-up eligibility until waiting ends (D097). Waiting is the **only** pause mechanism (D101, D107)—no separate pause control exists. On resume, the next **future** 09:00 organization-local occurrence is computed with **no backlog** (D107, §10a). Waiting does not change retention clocks. **Snooze is not an A8 Follow-up control** (D101). Reminder sends remain A8 and unimplemented.

## 10. Follow-up Engine and Event Notification Engine _(planned — A8; product law locked A8.0)_

Authoritative A8 product rules (D095–D101). Do not duplicate this specification elsewhere—cite this section.

### 10a. Follow-up Engine (due-date-driven, Task-scoped)

**Nothing in this section is implemented.** A8 implementation has not started. This section is product law that implementation must satisfy.

**Purpose:** follow through on **delegated** communication work using the Owner-selected Task due date, so communications reach conclusion. Authorized by the narrow constitutional exception in D102: an explicitly selected Task due date may drive deterministic follow-through on delegated work. This is **not** calendar management, not a general-purpose reminder application, and not an escalation ladder.

**Superseded model:** the A8.0 Phase 1 preset / Phase 2 standard-interval model (D095) and `dueAt` scheduling independence (D098) are **no longer product law**. Preset intervals (24h / 48h / 72h / 1 week) are retired. See [DECISIONS.md](DECISIONS.md) D095, D096, D098, D099 for truthful supersession history.

#### Due date (D102, D103)

1. A Task may carry an **optional** due date, selected from a calendar.
2. The due date is an Owner-**organization-local calendar date** — not an instant. The Owner selects **no** due time, and there is **no** reminder-time picker.
3. If **no** due date exists: no advance reminder, no overdue follow-up, no schedule.
4. The schedule is **established when the Owner sets a due date** — on Task creation, on suggestion approval, or on a later Task update. Nothing about handoff creates, activates, or advances it (D104, §2).
5. AI may **recommend** a due date. Only an explicit Owner selection has effect. AI may never create, activate, alter, or suppress a schedule (D027, D102).

#### Occurrence computation (D103)

1. The **Owner organization timezone** is the sole scheduling authority (D034: `America/Vancouver`).
2. Every occurrence is **09:00 organization-local** on a specific local calendar date, resolved individually to an absolute instant used for execution and audit.
3. Occurrences **must** be computed with timezone-aware **local-calendar arithmetic**: increment the calendar date, then resolve 09:00 local.
4. Computing occurrences by adding or subtracting fixed 24-hour millisecond intervals (for example `MS_PER_DAY`) is **prohibited**. The delivery time must remain **09:00 local across daylight-saving transitions**.
5. Resolution uses deterministic IANA timezone data and must **never** depend on browser, device, or server machine-local timezone.
6. 09:00 is a documented constant, not Owner-configurable data.

#### Automatic advance reminder (D105)

1. Exactly **one** system-generated advance reminder, at 09:00 organization-local on the calendar day **immediately before** the due date.
2. If that instant is already past when the schedule is established, record the occurrence as **skipped** with reason **`advance_window_elapsed`**.
3. The skip decision is made **once, at schedule establishment, and persisted**. A later scheduler run must never retroactively reclassify a legitimately scheduled occurrence.
4. A schedule established **before** 09:00 on the day before the due date may still send that morning.
5. **No** immediate or retroactive advance reminder is ever sent.
6. A Task created **on** its due date gets no advance reminder.
7. A Task created with a due date **already in the past** gets **no backlog**: schedule only the next future 09:00 overdue occurrence, and record the omitted interval once as a truthful audit entry — never as sends.

#### Overdue follow-up (D106)

1. While the Task remains incomplete and eligible, one overdue reminder at 09:00 organization-local on **every calendar day strictly after** the due date.
2. First overdue morning is the local calendar day **immediately after** the due date.
3. **At most one delivery per local calendar day.**
4. **Ceiling:** stop permanently after **14 successfully delivered overdue reminders in the current schedule generation**.
5. The ceiling counts **only successful overdue deliveries** — never retryable failures, permanent failures, skipped occurrences, scheduler claims, or advance reminders.
6. On the 14th successful overdue delivery in the generation: stop future Recipient overdue reminders; set **`requiresOwnerAttention`**; notify the Owner via the Event Notification Engine (§10b); **never restart automatically**.

**Worked example.** Task due **Friday**: advance reminder **Thursday 09:00**; first overdue **Saturday 09:00**; then each following morning at 09:00 while the Task remains incomplete and eligible.

#### Schedule scope and generations (D104)

1. A Reminder Schedule is **Task-scoped** — at most one per Task. It is **not** Assignment-scoped.
2. It **survives reassignment** and never sends a backlog of missed occurrences.
3. A **material due-date change** (a _different_ local calendar date) closes the current **generation** truthfully and opens a new one: prior attempts, delivery counts, and audit are preserved and never deleted or rewritten; advance and overdue occurrences are recalculated; the new generation starts with an overdue delivered count of **zero**; in-flight work is invalidated by a **generation check** immediately before send; and the Owner surface must **disclose that the reminder cycle restarted**.
4. Saving the **same** due date is **not** material: no new generation, no count reset.
5. Removing the due date **stops** the schedule.
6. The ceiling therefore applies **per explicit Owner-authorized generation**, not across the Task's whole lifetime.

#### Stop and suspension (D107)

| Condition                  | Effect                                                                                          |
| -------------------------- | ----------------------------------------------------------------------------------------------- |
| Task completed             | **Stops** future reminders                                                                      |
| Task dismissed             | **Stops** future reminders                                                                      |
| Waiting                    | **Suspends** reminders — the **only** pause mechanism (D097, D101)                              |
| Resume                     | Computes the **next future** 09:00 local occurrence; **no backlog**, no elapsed-time accounting |
| Due date removed           | **Stops** the schedule                                                                          |
| Reassignment               | Schedule **preserved** (Task-scoped); **no backlog** sent                                       |
| No active assignment       | **Prevents** Recipient delivery; occurrence recorded as skipped; the local day is not consumed  |
| Permanent delivery failure | **Suspends** further sends for that assignment; raises Owner attention (§10b)                   |
| Overdue ceiling reached    | **Stops** Recipient reminders; `requiresOwnerAttention`; Owner notified; no automatic restart   |

No separate pause, snooze, delay, or alternate-cadence control is introduced (D101, D107). `completed` and `dismissed` remain terminal; A8 introduces **no** reopening behaviour.

#### Attribution, audience, and history (D107, D109)

1. **Audience:** reminders go to the **Recipient** only, via the Owner's connected Gmail (same outbound family as A7). Owner notifications belong to §10b — never CC or escalation (D099).
2. **Attribution:** automated reminder sends use a **`system`** actor. Owner scheduling changes (setting, changing, or removing the due date) use the **`owner`** actor. An automated send must **never** be attributed to the Owner as though sent manually.
3. **History:** every processed occurrence leaves a durable privacy-safe record with its outcome (`sent` / `failed` / `skipped`), truthful skip and failure reason, and generation identity (D100, D109). Reminder history is **superseded, never deleted or silently rewritten**.
4. **Secrets:** no capability token or capability URL may appear in reminder metadata, audit, logs, or telemetry (D109).

#### Operations (D079, D109)

The application owns the engine: it claims eligible schedules, **rechecks Task, assignment, and schedule state immediately before delivery**, validates the **generation**, and records idempotent attempts whose identity is **server-derived and enforced by a database constraint**. An External Scheduler invokes an authenticated processing endpoint and owns no policy. Duplicate or overlapping scheduler invocations must not produce duplicate delivery.

#### Production-enablement gate (D108)

Scheduler and delivery code **may** merge behind a **disabled** production feature flag before the Event Notification Engine is finished. **Production reminder delivery must not be enabled until both the Event Notification Engine and the minimum Owner schedule-status UI are operational.** A Task-page status alone is not sufficient: the Owner must not have to inspect Tasks continually to discover that an automation stopped.

#### Out of scope for the initial slice (D110)

Preset reminder choices; Owner-created additional reminders and their routes and UI; recurrence editor; reminder-time picker; arbitrary rules or cron expressions; general calendar manager; separate pause mechanism; Recipient reminder preferences; Android reminder UI; AI-controlled scheduling. Owner-created additional **dated** reminders are **deferred to a separately authorized future slice** and are **not** part of A8's first implementation.

### 10b. Event Notification Engine (event-driven)

**Purpose:** notify the **Owner** about meaningful domain events (D099). Separate from the Follow-up Engine—do not mix via CC/escalation.

**Core A8 event list (minimum):**

- Recipient completed the Task
- Clarification requested
- Assignment returned to Owner
- Assignment delivery failed
- Gmail disconnected
- Capability expired

**Reminder-related Owner notifications (D106, D108) — required before production reminder delivery may be enabled:**

- Overdue reminder ceiling reached
- Permanent reminder-delivery failure
- No active assignment where Owner action is required
- Reminder Schedule entered `requiresOwnerAttention`

**Channel (D099):** A8 delivers approved Owner Event Notifications by **email via the Owner’s connected Gmail account** (event lists above). Keep this engine separate from Recipient reminders — no CC, no escalation. **FCM/push remains deferred (D017)** and is an A9 concern.

**Retired A8 models:** escalating reminder stages, Owner CC ladders, and any escalation ladder remain retired. **Note:** due-date-anchored Recipient overdue reminders are **restored** under D102 and D106; only the escalation-style overdue models remain prohibited (D099 superseded in part).

**Separate deliverable:** the Event Notification Engine remains its own A8 deliverable and is a **production-enablement dependency** for reminder delivery (D108). It is not part of the reminder scheduler slice.

## 11. Voice completion + Next-action Suggestion _(planned — A12)_

Structure multi-intent utterance. On Owner confirm: complete **current** Task; create further work only as a **Next-action Suggestion** / Task Suggestion (D038). Hold Recipient assignment/email/forward until D037 confirmation when applicable. (OpenAPI wire name remains `FollowUpProposal` during A8—temporary contract naming debt; see Glossary.)

## 12. Merge duplicate suggestion _(implemented — A6 production-operational)_

Owner merges into existing Task; requires suggestion `If-Match` and `targetTaskIfMatch` (D083); mark suggestion `merged`; optional summary append; no assignment email by default. Excerpt `purgeAt = mergedAt + 7 days` (D082).

## 13. Dismissal _(implemented — A4 for Tasks; A6 for Suggestions)_

Owner dismisses suggestion or Task → terminal dismiss; excerpt purge deadline `terminalAt + 7 days` (D020, D082); learning signal if provided (durable learning A14). No assignment email. Dismissal **stops** future reminders and preserves reminder history (D107); terminal Task states end Follow-up eligibility.

## 14. Retention cleanup _(planned — A13)_

Policy-driven: excerpt purge; completed content scrub; audio already deleted on success path; extract Owner learning before scrub (D054); **do not** delete Gmail mailbox forwards (D031). Details: [DATA_RETENTION.md](DATA_RETENTION.md). Tombstone duration: OPEN #12.

## 15. Learning / rule proposal _(planned — A14)_

Record `LearningSignal`; optionally propose `WorkflowRule`. Apply only on Owner approval (D054). Recipients do not participate. No silent activation in v1. Owner due-date selections and edits—including a recommended due date compared with the Owner-selected due date, and the outcome that followed—are eligible **future** learning signals without storing raw message bodies (D100, D022, D109). A8 creates **no** learning tables and captures no passive usage.

A **structured learning signal** is a purposefully retained Owner decision with the alternatives that existed and what followed (D113). It must never be inferred from operational telemetry, page views, clicks, dwell time, or inactivity, and the **absence of a correction is not approval**. Human corrections outrank passive usage tracking. Neither **P1** nor A8 captures learning signals or creates learning tables (D110, D113). Class definitions: [GLOSSARY.md](GLOSSARY.md); AI boundary: [AI_CONSTITUTION.md](AI_CONSTITUTION.md).

## 16. Owner web experience states _(P1; partially implemented — P1.5 remaining)_

P1 changes **no** workflow above: no new transition, permission, audit semantic, or business behaviour (D111). It governs how the workflows already implemented are **presented and observed**. P1.1–P1.4 are implemented (P1.2–P1.4 pending architectural review; local evidence only); comprehensive boundary and connectivity states remain P1.5. Scope and criteria: [MILESTONES.md](MILESTONES.md).

Seven truthful states apply to every current Owner and Recipient surface (D112):

| State                  | Required behaviour                                                                                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Loading**            | Permitted for **reads only**. Skeletons and route loading states may improve perceived responsiveness; they must never stand in for an unconfirmed mutation              |
| **Empty**              | Distinguish "nothing exists yet" from "nothing matched" from "we could not load it". Never present a failed load as an empty list                                        |
| **Retryable error**    | Offer retry **through** the existing concurrency and idempotency machinery, never around it. Which context is reused depends on the case — see the retry rule below (§2) |
| **Ambiguous outcome**  | Present as genuinely uncertain. A `pending` or ambiguous handoff may or may not have sent; it must never be smoothed into success or failure (§2, D092)                  |
| **Offline**            | Explicit truthful state. No false success, no permanently stuck in-progress control, and no queued mutation — offline mutation queues are out of P1 scope (D111)         |
| **Stale data**         | Label as of a stated time rather than presenting it as current                                                                                                           |
| **Mutation in flight** | Show that the request is in flight and that the outcome is not yet known. **No optimistic success**                                                                      |

**Retry rule — two distinct cases (D112).** Conflating them is a truthfulness defect in either direction.

| Case                                    | What the client knows                                                 | Required behaviour                                                                                                                                                                                                                                                                                                                                           |
| --------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Ambiguous or transport retry**        | Nothing trustworthy — the result never arrived, or arrived unresolved | Retry the **same logical mutation** with the **same `Idempotency-Key`** and the **original `If-Match`**. The server classifies idempotency **before** re-checking preconditions, so a literal replay deliberately carries a now-stale `If-Match` and is replayed rather than rejected. **No "start over with a new key" after a durable attempt** (§2, A7.8) |
| **Confirmed `412 PRECONDITION_FAILED`** | A definite server answer: the supplied version is stale               | **Refresh authoritative state and re-present it** before the Owner makes or confirms a new attempt. Never silently loop on a known-stale `If-Match`; never show a confirmed stale conflict as success or as merely transient. A fresh attempt is a **new Owner decision**, not a transport retry                                                             |

The Owner shell provides one **generic** attention and operational-status destination (D118). It is not reminder-specific, and while A8 is unimplemented it must not claim or imply that any schedule, automation, or notification capability exists (D089). The future **D108** Owner schedule-status surface populates it during **A8.6** — it does **not** exist now.

Owner dates and timestamps render in the organization timezone (`America/Vancouver`, D034), never silently the browser's (D117). This is **presentation only**: §10a and **D103** remain the sole authority for reminder occurrence arithmetic.
