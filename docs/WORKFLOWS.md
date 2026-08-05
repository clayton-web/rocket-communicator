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

Workflow §1 (A5 events + A6 suggestions) and §7 / §12 (approve / merge) are **production-operational**. Workflow §2 (Recipient handoff) is **production-operational** as of A7 close: both delivery paths, Recipient capability completion, and Owner-visible notes are production-verified. Reassignment and explicit re-forward within §2 remain deferred ([MILESTONES.md](MILESTONES.md) A7 deferred backlog). §10 Follow-up Engine and Event Notification Engine are **A8** and **not operational**: the due-date-driven reminder model is documentation-locked in **A8.1 (D102–D110)**, its scheduling logic exists (**A8.2**), its persistence schema exists (**A8.3a**), the Owner can now configure a due date and schedule over HTTP (**A8.3b**), Task lifecycle transitions suspend, resume, and stop a schedule in the Task's own transaction, the occurrence-processing foundation exists and is approved (**A8.4a**), a real Gmail transport for **overdue** reminders exists (**A8.4b.1**, complete), and D129's repeated-ambiguity stop is enforced (**A8.4b.2**, awaiting architecture review) — but nothing **sends**: delivery is flag-disabled everywhere, so no transport is constructed at all, no cron job exists, and only A8 migrations 1–5 are applied in Production, with the A8.4b and A8.5 code that needs migrations 6–9 still undeployed. Each remaining slice awaits its own authorization. §14–§15 and Android capture remain later milestones. §16 Owner web experience states is **P1**, documentation-locked in **P1.0 (D111–D120)** and not implemented; it changes no workflow behaviour and governs presentation and observation only. Sections below retain target behaviour; milestone labels note when each ships.

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

Waiting (Owner or Recipient capability): suspends Follow-up eligibility until waiting ends (D097). Waiting is the **only** pause mechanism (D101, D107)—no separate pause control exists. On resume, the next **future** 09:00 organization-local occurrence is computed with **no backlog** (D107, §10a); since the A8 lifecycle wiring, both the suspension and the resume happen in the same transaction that commits the Task status, for the Owner and Recipient capability paths alike. Waiting does not change retention clocks. **Snooze is not an A8 Follow-up control** (D101). Reminder sends remain A8 and unimplemented.

## 10. Follow-up Engine and Event Notification Engine _(planned — A8; product law locked A8.0)_

Authoritative A8 product rules (D095–D101). Do not duplicate this specification elsewhere—cite this section.

### 10a. Follow-up Engine (due-date-driven, Task-scoped)

**Nothing in this section sends.** The scheduling logic (A8.2), the persistence schema (A8.3a), the Owner reminder APIs (A8.3b), the Task-lifecycle wiring, the A8.4a occurrence-processing foundation, the A8.4b.1 real Gmail overdue transport, the A8.4b.2 D129 repeated-ambiguity stop, and the A8.4b.3 advance delivery scan exist, so a due date and a schedule are recorded, the schedule follows the Task's status, an occurrence of either kind can be claimed, guarded, sent, and finalized, and a series that cannot confirm three sends in a row stops itself. **No reminder has ever been sent.** `ENABLE_REMINDER_DELIVERY` defaults disabled and is set nowhere, and it is the sole condition under which a Gmail transport is constructed at all — so in every environment as configured today no access resolver exists, no refresh token is decrypted, and no token exchange is attempted. No cron job invokes the endpoint, and as of 2026-08-04 **A8 migrations 1–5 are applied in Production** — the repair for the incident recorded in [MILESTONES.md](MILESTONES.md), where A8.3b, lifecycle, and A8.4a code had been deployed against an unmigrated database. Migrations 6–9 remain unapplied, and there is no UI. This section is product law that implementation must satisfy.

**D130: a reminder carries no link.** It states that it is an automated reminder, gives the approved Task summary, the organization-local due date and timezone, tells the Recipient to use the **original assignment email** to act, and explains that reminders stop when the Task is completed, dismissed, removed, or placed into Waiting. It contains no capability URL, token, `/c/` path, or Task URL — and no reminder count, no escalation or "final reminder" wording, no communication excerpts, and no internal identifiers. Because that instruction is only truthful while the original email still works, **capability state is evaluated before any provider call**: a missing, expired, revoked, never-activated, or already-consumed capability skips the occurrence as `no_actionable_capability` with no send, rather than spending one of D106's fourteen local calendar days telling somebody to follow a link that cannot work.

**D129: three consecutive terminal ambiguous overdue outcomes in one generation stop the schedule** with reason `repeated_ambiguous_outcomes` and `requiresOwnerAttention`, derived from reminder history and never from a stored counter. There is no new suspended state — Waiting remains the only pause mechanism (D107) — and no automatic resume; only a material Owner due-date change opens a new generation, and because the derivation is generation-scoped that new generation begins with no ambiguity history of its own. **Enforced as of A8.4b.2**, at the point an occurrence's outcome is applied to its schedule. What is counted is the **final outcome of an occurrence**, not a provider attempt: an occurrence retried three times is one outcome. A confirmed send or a permanent failure **breaks** the run, retry-budget exhaustion included, because it is recorded as a permanent failure and counted as the one it was recorded as. A **skipped occurrence neither counts nor breaks** the run — no provider was contacted, so it is not evidence either way, and a schedule that skips a fortnight between two ambiguous mornings has still seen two consecutive ambiguous deliveries. An occurrence still being retried is invisible until it finishes. The third ambiguous occurrence remains recorded as ambiguous: D129 stops the schedule, it never rewrites what happened to a message. **Advance occurrences do not participate** (A8.4b.3): the run is scoped to overdue outcomes, and a generation holds exactly one advance occurrence, so it could never form a run of three.

**D107's lifecycle rules are enforced.** A Task's status decides whether a due date may carry _active_ scheduling — a completed or dismissed Task refuses a reminder outright, and a Waiting Task's schedule is created directly in `suspended_waiting` with no claimable occurrence ([STATE_MACHINE.md](STATE_MACHINE.md) §Due date) — and, since the A8 lifecycle wiring, a status **transition** moves an existing schedule in the same transaction that commits the status: entering Waiting suspends, leaving Waiting resumes from the next occurrence strictly after the resume instant with no backlog and no new generation, and completion or dismissal stops with a truthful reason. A terminal or Waiting Task therefore cannot hold a claimable occurrence at any committed point, and the A8.4a processing service re-checks the same eligibility immediately before invoking its transport, because a claim proves exclusivity and not eligibility — the Owner may have completed the Task in between. Real delivery is no longer gated on an undecided question — D130 and D129 answered the capability-link envelope and the non-success limit — but it remains **switched off**: A8.4b.1 implements the overdue send, and nothing enables it anywhere.

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
3. The **establishment** skip decision is made once and persisted. A later scheduler run must never retroactively reclassify an occurrence that is still deliverable, and must never re-derive the establishment decision from the clock.
4. **Two later events may change it, and only two.** The first: a Waiting period that spanned the occurrence. If the Task is still Waiting when the advance instant arrives, resume records the occurrence as **skipped** with a Waiting-specific reason (`skipped_waiting_elapsed`) rather than sending it late — a suspended reminder is not a deferred one (D107). This is not the scheduler reclassifying from the clock; it is the no-backlog rule applied to the advance occurrence, decided by the lifecycle transition that ends the pause. The occurrence's own local date and instant are preserved as history, and the reason stays distinct from `advance_window_elapsed` so the audit trail can say whether the Owner chose the date too late or Waiting covered the reminder. An advance occurrence already delivered, or already skipped at establishment, keeps its existing reason.

   The second (A8.4b.3): **occurrence processing**, which settles the disposition from the outcome it recorded — `delivered`, `skipped_not_eligible`, `failed_permanent`, or `ambiguous` — exactly as it does for an overdue occurrence. This is not the scheduler reclassifying from the clock either; it is the occurrence being processed, which is what a scheduled occurrence is for.

5. A schedule established **before** 09:00 on the day before the due date may still send that morning.
6. **The advance reminder may be delivered only during its own organization-local calendar day** — the day before the due date — and never once that day has ended (A8.4b.3). A worker reaching it late on that day still sends: "due tomorrow" is true at 23:55. A worker reaching it the next morning does not, because the statement has become false and the due date has arrived. The boundary is a **calendar-day comparison in the organization's zone**, never a fixed number of hours: the advance day is 23 or 25 hours long in the weeks the clocks shift, so an hour budget would cut into that day or spill past midnight into the due date.
7. **A morning that passed unsent is recorded, not left pending.** The worker claims the occurrence, makes no provider call, and records it as **skipped** with reason **`advance_window_elapsed`** — the same fact as item 2, reached a different way. Leaving it untouched would leave the schedule reporting `scheduled` for a morning that can never happen. The reason stays distinct from `skipped_not_eligible`, which means the Task stopped needing a reminder; this one means the reminder was owed and the system did not deliver it.
8. **No** immediate or retroactive advance reminder is ever sent.
9. A Task created **on** its due date gets no advance reminder.
10. A Task created with a due date **already in the past** gets **no backlog**: schedule only the next future 09:00 overdue occurrence, and record the omitted interval once as a truthful audit entry — never as sends.

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
| Task completed             | **Stops** future reminders, reason `task_completed`; history preserved, row not deleted         |
| Task dismissed             | **Stops** future reminders, reason `task_dismissed`; history preserved, row not deleted         |
| Waiting                    | **Suspends** reminders — the **only** pause mechanism (D097, D101); generation preserved        |
| Resume                     | Computes the **next future** 09:00 local occurrence; **no backlog**, no elapsed-time accounting |
| Due date removed           | **Stops** the schedule                                                                          |
| Reassignment               | Schedule **preserved** (Task-scoped); **no backlog** sent                                       |
| No active assignment       | **Prevents** Recipient delivery; occurrence recorded as skipped; the local day is not consumed  |
| Permanent delivery failure | **Suspends** further sends for that assignment; raises Owner attention (§10b)                   |
| Overdue ceiling reached    | **Stops** Recipient reminders; `requiresOwnerAttention`; Owner notified; no automatic restart   |

No separate pause, snooze, delay, or alternate-cadence control is introduced (D101, D107). `completed` and `dismissed` remain terminal; A8 introduces **no** reopening behaviour. Should a reopen path ever be added, it does **not** reactivate a terminally stopped schedule — an explicit Owner re-save is required (D109; decided in [STATE_MACHINE.md](STATE_MACHINE.md)), so a Task reopened long after its due date cannot immediately deliver a backlog for a date already past.

Every one of these transitions is applied in the **same transaction** that commits the Task status, so no committed state pairs a terminal or Waiting Task with a claimable occurrence.

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

**Nothing in this section sends.** The taxonomy, destination, delivery policy, and gating below are ratified product law (D133–D136); the engine that implements them is built across A8.5a–A8.5e, and each slice states what is still absent in [MILESTONES.md](MILESTONES.md). **After A8.5e the engine is complete and wholly inert:** all ten producers, the delivery state machine, the real Gmail adapter, the self-ingestion marker, and the wired capability-expiry capture phase exist, and both flags are unset in every environment — so the worker endpoint opens no database connection and constructs no transport, no cron job invokes it, no Owner notification has been sent, and no A8.5 migration is applied in Production.

**Purpose:** notify the **Owner** about meaningful domain events (D099). Separate from the Follow-up Engine—do not mix via CC/escalation.

#### Ratified event taxonomy (D133)

Exactly **ten** canonical event types, each triggered by a committed state transition. There is no broad category such as “task updated”, and an audit row is not a reason to send mail.

| Canonical event type                           | Triggering transition                                                                        | Owner-facing meaning                                              |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `task.completed_by_recipient`                  | Capability-attributed completion                                                             | The person you delegated to says the work is done                 |
| `task.clarification_requested`                 | Capability-attributed clarification request                                                  | The Recipient is blocked and needs an answer                      |
| `task.returned_to_owner`                       | Capability-attributed return; Assignment cleared                                             | The work is back with you and nobody is assigned                  |
| `handoff.delivery_failed`                      | Non-retryable handoff failure, or exhausted handoff retry budget                             | The assignment message did not reach the Recipient                |
| `gmail.disconnected`                           | Connected account leaves the connected state                                                 | Ingestion and outbound mail have stopped                          |
| `capability.expired`                           | Observed expiry of an active capability                                                      | A Recipient's link has lapsed                                     |
| `reminder.schedule.stopped.ceiling_reached`    | D106 stop                                                                                    | The schedule finished its fourteen deliveries and will not resume |
| `reminder.schedule.stopped.permanent_failure`  | Permanent reminder-delivery failure stop                                                     | A provider refused something nameable                             |
| `reminder.schedule.stopped.repeated_ambiguous` | D129 stop                                                                                    | Three mornings running, the sends could not be confirmed          |
| `reminder.no_active_assignment`                | Occurrence skipped for no active assignment, schedule still active — **once per generation** | A reminder has nobody to reach and needs your action              |

**Excluded from A8.5 (D133):** Task creation; ordinary assignment and reassignment; handoff prepared; handoff sent; standalone Recipient notes; Waiting entered; Waiting resumed; Task dismissed; Recipient deactivation; suggestion lifecycle events; digests; notification preferences; push. Owner-initiated actions are not notified back to the Owner, and operational detail belongs to the D118 attention destination rather than to email.

**How the taxonomy covers D099, D106, and D108.** D099's six core events map one-to-one onto the first six rows. D108 additionally requires overdue ceiling reached, permanent reminder-delivery failure, no active assignment where Owner action is required, and **schedule entering `requiresOwnerAttention`**. The first three are named rows. The fourth is not a separate row because `requiresOwnerAttention` is raised at exactly three call sites — the D106 ceiling stop, the permanent-failure stop, and the D129 ambiguity stop — so the three `reminder.schedule.stopped.*` events cover every way a schedule can enter that state. A future path that raised the flag anywhere else would need its own event, and the A8.5d coverage test is what makes that impossible to add silently.

**Repetition is legitimate but bounded by identity.** A Recipient may request clarification twice, and a Task may be returned across successive assignment cycles. Identity is server-derived — `(organizationId, eventType, subjectKind, subjectId, occurrenceKey)` — and enforced by a database unique constraint rather than by application care (D133, following D109). `reminder.no_active_assignment` is limited to one notification per schedule generation by that identity, not by a counter anybody has to maintain.

**Capability expiry needed a sweep (D133), and A8.5d built its transaction.** Expiry was observed only when somebody presented the token, so an untouched capability stayed active past `expiresAt` indefinitely. A single shared transaction now transitions the capability by compare-and-set, appends the audit event, and creates the intent together; the lazy validator path and the sweep both call it, so a Recipient's click racing a scan produces one transition, one audit event, and one intent, and the loser writes nothing. `runCapabilityExpirySweep` performs it in a bounded batch of fifty, earliest `expiresAt` first. **A8.5e made that sweep the notification worker's capture phase, gated on `ENABLE_OWNER_EVENT_CAPTURE` alone** — whether a lapse becomes durable must not depend on whether mail can be sent. The A8.5b promise it appeared to contradict was replaced rather than dropped: the endpoint's invariant is now that **both** flags off means zero database access and no transport. With capture unset everywhere, expiry is still observed only on the Recipient path, and **nothing schedules the sweep**: no cron job invokes the endpoint.

**Producers (A8.5d, implemented and inert).** All ten events now have one. Each intent is written from the transaction that durably establishes its event: the A4 unit of work for the three Task-lifecycle events, the A7 transaction that records a terminal handoff failure, A8.4b settlement for the three stops and the unassigned skip, the Gmail channel-unavailable transaction, and the shared expiry transaction. A retryable handoff failure Rocket still intends to retry produces nothing. `gmail.disconnected` fires on the transition only — its status write is compare-and-set on `connected`, so a poll re-observing the same outage writes no status, no audit row, and no intent. `reminder.no_active_assignment` requires the skip reason to be exactly `no_active_assignment`, the schedule to be active at this generation, and nobody to be assigned at settlement; a gap that closed in between produces nothing. **No reminder decision changed** — capture is a row written beside the settlement, never an input to it.

**Attribution follows the event, not the request (D133).** Six of the ten are system-attributed. The A7 audit for a handoff _request_ stays Owner-attributed and truthfully so, but a provider refusing the message is not something the Owner did, and an Owner pressing "sync now" is how a lapsed Google grant gets noticed rather than how it lapsed.

#### Capture, destination, and content (D133, D134)

**Capture:** notification intent is a distinct durable record written in the **same database transaction** as the triggering mutation. It is never derived from the audit log, and the audit log is not overloaded with delivery workflow state.

**Destination:** the organization's connected Gmail account address (`CommunicationAccount.emailAddress`), provider `gmail`, connected, passing the existing mailbox-domain validation. Resolved from the account **at delivery time** and never persisted on the intent row. No Owner email column, no notification-address column, no destination environment variable, and no Task-derived or Recipient-derived destination (D134).

**Links:** D130 governs Recipient reminder emails and their capability-link risk; it does **not** forbid links to authenticated Owner surfaces in Owner mail, because an Owner authenticates with a session rather than a bearer capability (D134).

**Never in an Owner event email (D109, D114, D134):** capability tokens, capability URLs, `/c/` paths, token hashes, encrypted capability URLs, temporary Gmail excerpts, Recipient-controlled free-text note bodies, quoted clarification text, or assignment bearer credentials. An Owner notification states the event and identifies the Task; it does not quote untrusted Recipient input.

**Attribution:** the intent carries the **triggering event's** truthful actor. A Recipient action stays capability-attributed and is never represented as an Owner action merely because the Owner is the audience. Delivery itself is a `system` action, recorded separately.

#### Delivery policy (D135)

One-shot per event, not a series. Retryable transport failures are retried to a maximum of **three total attempts**, then terminal and requiring Owner attention. An **ambiguous outcome is terminal on first occurrence and never retried**, because the provider may already have accepted it. **D129's ambiguity stop and D106's fourteen-delivery ceiling do not apply**, and neither do reminder generations as delivery policy, Waiting suspension, the one-per-local-calendar-day rule, nor the no-backlog rule — all of them govern a repeating Recipient series that does not exist here.

**Staleness horizon:** an otherwise deliverable intent older than **24 hours** at processing time is terminalized as suppressed for staleness with a truthful reason and **no provider call**, so enabling delivery can never flush a backlog of stale mail.

**Processing (A8.5b, implemented and inert).** One worker invocation recovers what a dead worker abandoned, then delivers what is owed, bounded by twenty-five intents and a soft deadline. Each notification is claimed by compare-and-set under a two-minute lease, its provider call is recorded durably **before** the transport is invoked, the transport is invoked with no database transaction open, and the outcome is settled under the claim's fencing token. Both terminal outcomes that a crash can produce stay truthful: a lease that lapsed before the provider call is reclaimed and retried, and one that lapsed after it is terminal as **ambiguous** and never resent. A retryable failure returns the intent to pending work and records the failure on its attempt row; three attempts exhausts the budget and requires Owner attention. Stale suppression, a lost claim, an already-terminal intent, and disabled delivery all invoke no transport and create no attempt row.

**Message and transport (A8.5c, implemented and inert).** The destination is resolved at delivery time from the connected `CommunicationAccount` of the organization named on the intent, and the message is addressed to that same mailbox. The transport takes no destination parameter, so nothing on a Task, a Recipient, an event, or a request can select one; `OWNER_ORGANIZATION_ID`, where configured, is a fail-closed assertion and never a substitute for the intent's organization. Rendering is keyed by the ratified event enum and covers all ten; each message carries fixed Rocket copy, the URL-redacted Task summary, the historical actor from the intent, the occurrence instant, and one link to an authenticated Owner surface. Since A8.5d the subject is resolved to its Task first, so a schedule stop, a capability expiry, and a terminal handoff failure all name the work they are about; `gmail.disconnected` is the one event legitimately about no Task, and its copy says so.

**Provider outcomes (A8.5c).** A confirmed provider message reference is `accepted` and only the short reference is retained. A 2xx without one is `ambiguous`, never `sent`. Timeouts, unparseable responses, and thrown errors are `ambiguous`, matching what a crash at the same instant would leave. `401`/`403` are `retryable`, since the provider proved non-acceptance and the next invocation resolves fresh authorization. A **disconnected, unscoped, or missing account is `permanent`**, decided before any provider contact: a durably unavailable channel is terminal and requires Owner attention rather than being retried three times.

**Terminal outcomes are audited (D133).** `sent`, `failed_permanent`, `ambiguous`, `retry_exhausted`, and `suppressed_stale` append a concise `system`-attributed audit event in the same transaction that settles the intent. Delivery is never attributed to the Owner or the Recipient; the intent keeps the triggering actor and the audit event records the worker. Stale suppression is recorded as `denied`, since nothing failed and nothing succeeded — the horizon refused it.

#### Self-ingestion protection (D136)

The notification is sent from the connected mailbox to itself, so Gmail labels it both `SENT` and `INBOX` and D068 ingestion would otherwise admit it, excerpt it, and offer it to A6 as a Task Suggestion. Rocket marks its own generated mail with a fixed custom header — `X-Rocket-Generated: owner-event-notification` — emitted by the controlled MIME builder, and ingestion excludes marked messages. Excluding all `SENT` mail, or all mail whose sender equals the connected account, was rejected: both silently narrow D068 for genuine Owner mail.

**Implemented in A8.5c.** The marker is a single optional field on the outbound message model, drawn from a closed union; the MIME builder owns the header name, validates the value, and emits it exactly once, so callers still cannot supply arbitrary headers and a duplicate marker is not something Rocket can produce. Only Owner Event Notifications carry it — assignment emails, Gmail forwards, and Recipient reminders are unchanged and structurally unable to set it.

Ingestion reads the header from the **top-level message headers only**, since honouring a nested `message/rfc822` part's headers would let anyone claim the exclusion by attaching a forwarded copy of one of Rocket's. The exclusion requires **exactly one header carrying exactly the ratified token**, compared case-insensitively after trimming and with no substring matching; two markers, an empty value, or a near-miss token all fail closed and leave the message eligible. The skip happens before the ingest fixture is built, so a marked message creates no `TemporaryCommunicationExcerpt` and no `CommunicationEvent`, and A6 therefore has no suggestion candidate to claim later. No Gmail API projection change was required: the poll already retrieves `format=full` with `payload(headers(name,value))`. Ordinary self-sent mail, `SENT`+`INBOX` mail, and mail from the connected address all remain ingestible under the unchanged D068 rules.

#### Gating (D135, D108)

Two independent exact-string `true` flags, **both unset everywhere**: `ENABLE_OWNER_EVENT_CAPTURE` (evaluated **before** any mutation transaction opens, governing all ten producers since A8.5d and the worker's capability-expiry capture phase since A8.5e) and `ENABLE_OWNER_EVENT_DELIVERY` (gates intent claiming, transport construction, and every provider call). Since A8.5e the notification endpoint runs the two as separate phases, capture first, sharing a deadline and no transaction:

| Capture | Delivery | One invocation                                                                                         |
| ------- | -------- | ------------------------------------------------------------------------------------------------------ |
| off     | off      | **Today, everywhere.** No database access, no transport, no work                                       |
| on      | off      | Bounded expiry observation only. No transport composed, no intent claimed, no Gmail configuration read |
| off     | on       | Delivery only. No expiry scan, and no new `capability.expired` intent                                  |
| on      | on       | Expiry observation, then the delivery batch within the remaining budget                                |

A near-miss value disables its own flag and does not affect the other. `ENABLE_REMINDER_DELIVERY` is a third, unrelated flag that this endpoint does not read. Since A8.5c a real Gmail adapter exists behind the delivery flag, which changes what _would_ happen if it were set and authorizes nothing. Completing A8.5 authorizes no production delivery: D108 requires both this engine **and** the minimum Owner schedule-status UI.

**Channel (D099):** A8 delivers approved Owner Event Notifications by **email via the Owner’s connected Gmail account** (event taxonomy above). Keep this engine separate from Recipient reminders — no CC, no escalation. **FCM/push remains deferred (D017)** and is an A9 concern.

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

P1 changes **no** workflow above: no new transition, permission, audit semantic, or business behaviour (D111). It governs how the workflows already implemented are **presented and observed**. P1.1–P1.3 are implemented (P1.2–P1.3 pending architectural review; local evidence only); **P1.4 is complete and production-validated**; comprehensive boundary and connectivity states remain P1.5. Scope and criteria: [MILESTONES.md](MILESTONES.md).

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

The Owner shell provides one attention and operational-status destination (D118). P1.4 built it generic and truthfully empty, so the **D108** Owner schedule-status work could populate it without a second shell redesign.

**A8.6a populated its first half.** `/attention` now lists Reminder Schedules flagged `requiresOwnerAttention` — the **cross-Task discovery** step of §10a, and the reason a Task page alone could not satisfy D108. A schedule stops for one of three reasons an Owner must act on:

| Stop reason                   | What the Owner is told                                                                                                |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `overdue_ceiling_reached`     | Reminders have finished for this Task and will not start again on their own (D106)                                    |
| `permanent_delivery_failure`  | Reminders stopped after a delivery failure; nothing further will be sent                                              |
| `repeated_ambiguous_outcomes` | Reminders stopped because delivery **could not be confirmed**; the Recipient may or may not have received them (D129) |

The third row is the one worth reading twice. Rocket does not know the reminder was missed — it knows it could not confirm otherwise — and the copy must not collapse that into "not delivered", which would send an Owner to re-send something that may already have arrived.

The page is a **read**: one bounded, organization-scoped query per navigation, no endpoint, no mutation, and no control. It states its own limits — it covers reminder automation only, and it does not monitor, queue, alert, or refresh itself. Acting on what it surfaces means opening the Task.

**A8.6b built the other half: the Task page the Attention item links to.** The reminder panel states the schedule's condition in the same words the list used, and offers the only three actions that are authorized — set a due date, change it, or remove it.

| Reminder state      | What the Owner is told                                                                                                           | Controls                                         |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `no_due_date`       | No reminders are scheduled; they begin only once a due date is set                                                               | Set a due date                                   |
| `active`            | Due date and organization zone, advance reminder timing and disposition, next overdue occurrence, deliveries against the ceiling | Change or remove the due date                    |
| `suspended_waiting` | Reminders are paused because the Task is Waiting; **no backlog** will be sent, and they resume when the Task leaves Waiting      | Change or remove the due date; no resume control |
| `stopped`           | The specific reason, in the same words `/attention` used, plus what repair is available                                          | Set a new due date to start a new cycle          |
| `not_scheduled`     | Handled safely; the current write path does not produce it                                                                       | As eligibility allows                            |

There is **no resume control** for a Waiting Task: suspension follows Task state, and a separate control would imply reminders can be un-paused without the Task leaving Waiting. There is **no resend control** anywhere: D129 stopped the schedule deliberately, no resend policy is ratified, and the repair for a stopped schedule is a new due date — which the panel discloses will start a new cycle, reset the overdue count, and recalculate every date before the Owner submits (D104).

Changing a schedule is **not** sending anything, and the panel never conflates the two. A saved due date is a configuration fact; whether an email left the building is a separate one, and no wording in the panel claims the latter on the strength of the former.

**A8.6c added a second section to the same page, answering a different question: what happened recently that Rocket could not tell you about?** A8.5 sends the Owner one email per notable event, so an email that never leaves means an event the Owner may never hear about. This section lists those, and only those — the recent notifications that ended `suppressed`, `failed_permanent`, `ambiguous`, or `requires_owner_attention`.

| Badge            | Why it says so                                                                                                                                                         |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Not sent         | Rocket chose not to send (too old to be useful, or no connected mailbox), the attempt was refused permanently, or Rocket gave up after repeated failures — each stated |
| Delivery unknown | Rocket could not confirm the email was sent; the Owner may have received it, or it may never have arrived                                                              |

Two badges, not four, because two is how many outcomes the Owner can act on differently. "Not sent" is safe to act on; "Delivery unknown" means a duplicate may already be sitting in the Owner's inbox, and flattening the two would make one of those sentences untrue. Why a message was not sent is still shown beneath the badge, because "Rocket decided not to" and "the attempt was refused" are not the same problem and the first two are conditions the Owner can fix.

Each item names the event, when it happened, who caused it — **you**, **the Recipient**, or **Rocket**, never a Recipient's name or address — and links to the Task when there is one to link to. An event whose subject has since been purged still appears, without a link, because a thing Rocket failed to tell the Owner must not also be a thing this page withholds.

**It is not an inbox and offers nothing to do.** There is no resend, no acknowledgement, no dismissal, and no mark-as-read; an item leaves after **30 days** and by no other means, and the section shows at most **50**. Reminder stops appear in the first section and never here, because that section clears when the Owner repairs the schedule while a notification record never does — showing both would keep announcing a stop that was fixed weeks ago. `reminder.no_active_assignment` does appear here, being the one notification no other surface shows.

**D108's minimum Owner UI is implemented across A8.6a and A8.6b, and is satisfied only once that work is architecture-approved.** A8.6c is **not** part of that gate.

Nothing here changes §10a. No reminder and no Owner notification has been sent in any environment, `ENABLE_REMINDER_DELIVERY`, `ENABLE_OWNER_EVENT_CAPTURE`, and `ENABLE_OWNER_EVENT_DELIVERY` are unset, and no cron job exists — so in every current environment both sections of `/attention` are empty and every panel reports a schedule no worker has ever touched.

Owner dates and timestamps render in the organization timezone (`America/Vancouver`, D034), never silently the browser's (D117). This is **presentation only**: §10a and **D103** remain the sole authority for reminder occurrence arithmetic.
