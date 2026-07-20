# Product scope

Governed by [PROJECT_CONSTITUTION.md](PROJECT_CONSTITUTION.md). Terms: [GLOSSARY.md](GLOSSARY.md). AI law: [AI_CONSTITUTION.md](AI_CONSTITUTION.md). Binding A8.0 engines: D095–D101 in [DECISIONS.md](DECISIONS.md).

## Objective

Private Android-first **AI Communication Action Assistant** that captures Owner communications, proposes Task Suggestions, requires Owner approval before Tasks and Recipient handoffs, delivers work via Capability Links, runs the **Follow-up Engine** and **Event Notification Engine**, records outcomes, and learns Owner preferences—without becoming a conventional task manager, calendar, due-date reminder app, or permanent communication archive.

The product exists to ensure communications are followed through until conclusion.

## Roles

Roles and permissions: [GLOSSARY.md](GLOSSARY.md) (Owner, Recipient, Administrator label). Security matrix: [SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md).

Android is the Owner’s primary interface (capture, review, voice). Web serves Owner auth/APIs, thin Owner handoff surfaces (A7.8), and the minimal Recipient capability view.

## Included communication sources (v1)

| Source                               | Notes                      |
| ------------------------------------ | -------------------------- |
| One Google Workspace Gmail inbox     | Gmail API                  |
| Google Messages notifications        | Best-effort                |
| Missed-call notifications            | Expected; device-dependent |
| Known Contact completed-call prompts | Best-effort                |
| Manual / spoken capture              | Always available           |

## Excluded (v1)

WhatsApp, Messenger, Signal; call recording / live-call transcription; historical SMS import; replacing Messages or Phone; automatic client replies; multiple Gmail accounts; Play Store; Rocket PM; Neon; FCM unless later justified (D017); permanent archive; full Recipient dashboard; second Authenticated User; conventional due-date reminder / escalation ladders; Owner snooze as a Follow-up control (D101).

## Product rules (cite decisions)

- Suggestions require Owner approve/edit/dismiss/merge before a Task exists (D008). No auto-create Tasks in v1.
- Recipient assignment requires Owner approval via the D037 handoff operation (`POST /api/v1/tasks/{taskId}/handoff`, D090). Gmail-origin assign + forward + attachments = one confirmation; non-Gmail tasks get assignment email with summary + Capability Link. Follow-up Engine and Event Notification Engine are A8 (D089, D095–D101): when the Follow-up Engine is operational, handoff includes Owner confirmation of the Phase 1 interval (D095). A7 confirmation may disclose follow-up belongs to the assignment workflow but must not claim a Follow-up Schedule is active while A8 is not operational, and Phase 1 capture is not an A7 acceptance criterion. Recipient email from Owner-managed Recipient records only (D087)—not hard-coded and not an env default.
- Capability Links required for Recipient actions; GET non-mutating; POST after confirm (D050). At most one active capability; re-forward revokes the prior (D086). Details: [SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md).
- Voice never creates Tasks directly (D038); audio retention D041.
- Summaries are structured typed points (facts vs inference vs missing), not prose. Handoff uses existing Task `summaryPoints`—no fresh LLM (D094).
- **`dueAt`** is optional and informational only; never schedules the Follow-up Engine (D098).
- **Follow-up Engine / Event Notification Engine (A8):** authoritative rules in [WORKFLOWS.md](WORKFLOWS.md) §10 and D095–D101. Recipient follow-ups vs Owner event notifications are separate; no escalation CC ladder (D099). A8 Owner Event Notifications are delivered by email via the Owner’s connected Gmail; FCM/push remains deferred (D017). Waiting suspends follow-up (D097). AI recommends; deterministic rules send (D027).
- Learning Owner-only (D054); propose rules, never silently apply.

## Future-ready (not v1 features)

Schema/architecture may later support multiple Recipients, additional sources, trusted auto-rules after approval, and Play Store—without implementing them in v1. Hosting and infrastructure remain replaceable under Architecture Principles (D079).

## MVP complete when

Privately sideloaded Android + backend + Recipient capability web loop can: ingest Gmail/Messages into suggestions; require approval to create/assign/forward; forward Gmail with attachments after approval; support call prompts and voice proposals; run the Follow-up Engine and Event Notification Engine; enforce 7-day/30-day application retention; record learning signals without a permanent archive.
