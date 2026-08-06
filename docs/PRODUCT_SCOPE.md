# Product scope

Governed by [PROJECT_CONSTITUTION.md](PROJECT_CONSTITUTION.md). Terms: [GLOSSARY.md](GLOSSARY.md). AI law: [AI_CONSTITUTION.md](AI_CONSTITUTION.md). Binding A8 engines: **D102–D110 (A8.1)**, superseding parts of D095–D101, in [DECISIONS.md](DECISIONS.md).

## Objective

Private Android-first **AI Communication Action Assistant** and the Owner's **trusted external memory** (P2.0 / D138): it captures Owner communications, proposes Task Suggestions, requires Owner approval before Tasks and Recipient handoffs, delivers work via Capability Links, runs the **Follow-up Engine** and **Event Notification Engine**, records outcomes, and learns Owner preferences—without becoming a conventional task manager, calendar manager, general-purpose reminder application, inbox replacement, or permanent communication archive.

Under the narrow constitutional exception (D102), an **explicitly selected Task due date may drive deterministic follow-through on delegated communication work**. That exception does not make the product a calendar or reminder application: general-purpose personal reminders, arbitrary recurrence, escalation ladders, Owner CC ladders, silent AI-controlled scheduling, and general calendar management all remain excluded.

Rocket **replaces the Owner's follow-through habit**. It does **not** replace Gmail, Messages, or the Phone app. It **remembers what must happen next**. The product exists to ensure communications are followed through until conclusion. Product Constitution: [P2_0_OWNER_EXPERIENCE_FOUNDATION.md](P2_0_OWNER_EXPERIENCE_FOUNDATION.md).

## Roles

Roles and permissions: [GLOSSARY.md](GLOSSARY.md) (Owner, Recipient, Administrator label). Security matrix: [SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md).

**Android is the product** (P2.0 / D139): the Owner’s primary interface for capture, organize, assign, and follow-through is Android (**A9.0–A9.3**; capture **D149**, organize/assign/follow-through **D150**). Web serves Owner auth/APIs, administration, review, debugging, fallback, Owner handoff surfaces (A7.8), and the minimal Recipient capability view. **P1** made the web surface reliable (D111–D120) without displacing the Android plan. **P2.0** locks the Owner-experience constitution; next formal product gate is Owner Acceptance Week (D142). Details: [MILESTONES.md](MILESTONES.md), [P2_0_OWNER_EXPERIENCE_FOUNDATION.md](P2_0_OWNER_EXPERIENCE_FOUNDATION.md).

## Included communication sources (v1)

| Source                               | Notes                      |
| ------------------------------------ | -------------------------- |
| One Google Workspace Gmail inbox     | Gmail API                  |
| Google Messages notifications        | Best-effort                |
| Missed-call notifications            | Expected; device-dependent |
| Known Contact completed-call prompts | Best-effort                |
| Manual / spoken capture              | Always available           |

## Excluded (v1)

WhatsApp, Messenger, Signal; call recording / live-call transcription; historical SMS import; replacing Messages or Phone; automatic client replies; multiple Gmail accounts; Play Store; Rocket PM; Neon; FCM unless later justified (D017); permanent archive; full Recipient dashboard; second Authenticated User; general-purpose reminder application / escalation ladders / Owner CC ladders; arbitrary recurrence; general calendar management; Owner snooze as a Follow-up control (D101). Also excluded from the **initial A8 slice** (D110): preset reminder choices, Owner-created additional reminders and their routes/UI, recurrence editor, reminder-time picker, Recipient reminder preferences, Android reminder UI, AI-controlled scheduling.

Excluded as **architectural alternatives** through A8 and A9 (D131): Google Tasks, Microsoft To Do, Apple Reminders, Google Calendar as a task or reminder engine, and every other third-party task engine. None is a dependency, fallback system, or competing authority over the application's Task or reminder state, and none is planned. The application is the **sole source of truth**; a future productivity integration would need its own separately approved milestone and could not displace it.

Excluded from **P1** (D111): Android application implementation; offline database or local business-record cache; service-worker caching of authenticated business data; offline mutation queues; background synchronization; conflict resolution; new Task, suggestion, Recipient-management, or Gmail-settings features; A8 reminder scheduler, persistence, due-date control, or schedule-status functionality; OpenAPI reminder-debt and dormant reminder-calculator cleanup; schema or migration changes; a general component library; Kotlin design-token generation; arbitrary visual redesign; commercial analytics or behavioural tracking; **AI-controlled UX adaptation**; audit-model changes; reconciliation workers. Dark mode and a health or readiness endpoint are **not** P1 requirements (D115, D119).

## Product rules (cite decisions)

- Suggestions require Owner approve/edit/dismiss/merge before a Task exists (D008). No auto-create Tasks in v1.
- Recipient assignment requires Owner approval via the D037 handoff operation (`POST /api/v1/tasks/{taskId}/handoff`, D090). Gmail-origin assign + forward + attachments = one confirmation; non-Gmail tasks get assignment email with summary + Capability Link. Follow-up Engine and Event Notification Engine are A8 and **not implemented** (D089, D102–D110): reminders derive from the Owner-selected Task **due date** set on the Task, so handoff confirms no interval. A7 confirmation may disclose that follow-up belongs to the assignment workflow but must not claim a Reminder Schedule is active while A8 is not operational. Recipient email from Owner-managed Recipient records only (D087)—not hard-coded and not an env default.
- Capability Links required for Recipient actions; GET non-mutating; POST after confirm (D050). At most one active capability; re-forward revokes the prior (D086). Details: [SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md).
- Voice never creates Tasks directly (D038); audio retention D041.
- Summaries are structured typed points (facts vs inference vs missing), not prose. Handoff uses existing Task `summaryPoints`—no fresh LLM (D094).
- **Task due date** is optional and, when explicitly selected by the Owner, is the **authoritative deterministic scheduling input** for reminders (D102). It is an organization-local **calendar date** with no Owner-selected time (D103). This supersedes D098 (`dueAt` informational only).
- **Follow-up Engine / Event Notification Engine (A8, not implemented):** authoritative rules in [WORKFLOWS.md](WORKFLOWS.md) §10 and D102–D110. Reminders are **Task-scoped** (D104) and send at **09:00 organization-local**: one on the calendar day before the due date (D105), then one each calendar day after it while incomplete, bounded at **14 successful overdue deliveries per schedule generation** (D106). Recipient reminders vs Owner event notifications remain separate; no escalation CC ladder (D099). Owner Event Notifications are delivered by email via the Owner’s connected Gmail; FCM/push remains deferred (D017). Waiting suspends and is the only pause mechanism (D097, D107). AI recommends; deterministic rules send (D027). **Production reminder delivery is gated** on the Event Notification Engine plus the minimum Owner schedule-status UI (D108).
- Learning Owner-only (D054); propose rules, never silently apply. **Operational telemetry is not a learning signal**, and passive behaviour or inactivity is never approval (D113).
- **Interfaces state what is true (D112).** No optimistic mutation success: the Owner and Recipient interfaces must never render or imply that a business mutation succeeded before the server confirms it, and an ambiguous outcome stays ambiguous. Owner dates and timestamps display in the organization timezone, never silently the browser's (D117). P1 foundation only; adds no product feature.
- **Online-first, with graceful connectivity loss (D132).** The product is online-first on every platform, including the A9 Android Owner experience. A **temporary** connectivity loss must degrade safely — stable truthful interface, in-progress drafts preserved where appropriate, no duplicate actions, no failed write shown as successful, deliberate retry through the existing idempotency machinery, and no duplicate Task mutations on recovery. This is a reliability requirement, **not** an offline feature: offline business-record storage, mutation queues, background synchronization, and conflict resolution stay out of scope (D111), and no surface may claim the application works offline.

## Future-ready (not v1 features)

Schema/architecture may later support multiple Recipients, additional sources, trusted auto-rules after approval, and Play Store—without implementing them in v1. Hosting and infrastructure remain replaceable under Architecture Principles (D079).

## MVP complete when

Privately sideloaded Android + backend + Recipient capability web loop can: ingest Gmail/Messages into suggestions; require approval to create/assign/forward; forward Gmail with attachments after approval; support call prompts and voice proposals; run the Follow-up Engine and Event Notification Engine; enforce 7-day/30-day application retention; record learning signals without a permanent archive.

**Broader operational enablement readiness (D144):** the Owner can confidently manage an ordinary working day using the Android application without depending on memory or external notes, while using the web application only for administration or fallback — after Owner Acceptance Week explicit approval (D142), and still subject to Stage 12 / A8.7d / A8.7e authorization gates.
