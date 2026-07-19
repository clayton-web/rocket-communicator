# Product scope

Governed by [PROJECT_CONSTITUTION.md](PROJECT_CONSTITUTION.md). Terms: [GLOSSARY.md](GLOSSARY.md). AI law: [AI_CONSTITUTION.md](AI_CONSTITUTION.md).

## Objective

Private Android-first assistant that captures Owner communications, proposes Task Suggestions, requires Owner approval before Tasks and Recipient handoffs, delivers work via Capability Links, runs deterministic reminders, records outcomes, and learns Owner preferences—without a permanent communication archive.

## Roles

Roles and permissions: [GLOSSARY.md](GLOSSARY.md) (Owner, Recipient, Administrator label). Security matrix: [SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md).

Android is the Owner’s primary interface (capture, review, voice). Web serves Owner auth/APIs and the minimal Recipient capability view.

## Included communication sources (v1)

| Source                               | Notes                      |
| ------------------------------------ | -------------------------- |
| One Google Workspace Gmail inbox     | Gmail API                  |
| Google Messages notifications        | Best-effort                |
| Missed-call notifications            | Expected; device-dependent |
| Known Contact completed-call prompts | Best-effort                |
| Manual / spoken capture              | Always available           |

## Excluded (v1)

WhatsApp, Messenger, Signal; call recording / live-call transcription; historical SMS import; replacing Messages or Phone; automatic client replies; multiple Gmail accounts; Play Store; Rocket PM; Neon; FCM unless later justified; permanent archive; full Recipient dashboard; second Authenticated User.

## Product rules (cite decisions)

- Suggestions require Owner approve/edit/dismiss/merge before a Task exists (D008). No auto-create Tasks in v1.
- Recipient assignment requires Owner approval via the D037 handoff operation (`POST /api/v1/tasks/{taskId}/handoff`, D090). Gmail-origin assign + forward + attachments = one confirmation; non-Gmail tasks get assignment email with summary + Capability Link. Reminder **engine** is A8 (D089)—confirmation may disclose follow-up belongs to the assignment workflow but must not claim reminders are scheduled. Recipient email from Owner-managed Recipient records only (D087)—not hard-coded and not an env default.
- Capability Links required for Recipient actions; GET non-mutating; POST after confirm (D050). At most one active capability; re-forward revokes the prior (D086). Details: [SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md).
- Voice never creates Tasks directly (D038); audio retention D041.
- Summaries are structured typed points (facts vs inference vs missing), not prose. Handoff uses existing Task `summaryPoints`—no fresh LLM (D094).
- Reminders (A8): first overdue → Recipient; later may CC Owner; waiting pauses; snooze Owner-only; AI recommends timing, rules send.
- Learning Owner-only (D054); propose rules, never silently apply.

## Future-ready (not v1 features)

Schema/architecture may later support multiple Recipients, additional sources, trusted auto-rules after approval, and Play Store—without implementing them in v1. Hosting and infrastructure remain replaceable under Architecture Principles (D079).

## MVP complete when

Privately sideloaded Android + backend + Recipient capability web loop can: ingest Gmail/Messages into suggestions; require approval to create/assign/forward; forward Gmail with attachments after approval; support call prompts and voice proposals; run deterministic reminders; enforce 7-day/30-day application retention; record learning signals without a permanent archive.
