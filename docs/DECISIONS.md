# Decision register

Statuses: **Approved** · **Proposed** · **Deferred** · **Open**

| ID | Decision | Status | Notes |
|----|----------|--------|-------|
| D001 | New repository separate from Rocket PM | Approved | Greenfield; no Rocket PM integration in v1 |
| D002 | Android application included in MVP | Approved | Primary interface |
| D003 | Monorepo planned for future scaffolding | Approved | Android + web + packages; not scaffolded in A0 |
| D004 | Supabase chosen as primary Postgres/auth/realtime platform | Approved | |
| D005 | Neon excluded from version one | Approved | Avoid duplicate database vendors |
| D006 | Prisma used only through authorized server APIs | Approved | Does not inherit end-user RLS context automatically |
| D007 | Canonical OpenAPI or JSON Schema contract; generate TS and Kotlin clients | Approved | Do not share Zod types directly with Kotlin |
| D008 | Approval required before AI suggestion becomes an active task | Approved | |
| D009 | Approval required before administrator assignment email | Approved | |
| D010 | For Gmail-origin admin assignments: forward original email with AI summary above, including all attachments, after assignment approval | Approved | Via primary user’s Gmail API connection |
| D011 | No separate attachment-approval step | Approved | Entire forward still requires assignment approval |
| D012 | Administrator in same Google Workspace organization | Approved | |
| D013 | Authenticated task links required | Approved | |
| D014 | Unauthenticated one-click mutations excluded | Approved | |
| D015 | Gmail polling-first acceptable initially; Pub/Sub deferred pending confirmation | Approved | See open questions for interval and Pub/Sub revisit |
| D016 | Gmail API used for outbound assignment mail and forwarding | Approved | |
| D017 | FCM deferred unless core workflow proves necessary | Deferred | |
| D018 | WhatsApp excluded from version one | Approved | Also Messenger and Signal |
| D019 | Google Play Store distribution excluded from version one | Approved | Private sideload / internal testing |
| D020 | Temporary communication excerpts deleted 7 days after complete or dismiss | Approved | |
| D021 | Completed tasks visible 30 days, then content scrubbed | Approved | Independent from 7-day excerpt rule |
| D022 | Durable anonymized learning allowed without raw message bodies | Approved | Rules require approval to apply |
| D023 | Completed-call detection classified as best-effort | Approved | Unknown completed calls do not always prompt |
| D024 | No permanent communication archive | Approved | |
| D025 | Missed calls always prompt when detected | Approved | Detection still device-dependent |
| D026 | First overdue reminder to administrator only; later may CC primary; threshold configurable | Approved | |
| D027 | AI recommends; deterministic rules send reminders | Approved | |
| D028 | Raw audio deleted immediately after successful transcription and validation | Approved | Failed-transcription retention Open |
| D029 | Administrator email not hard-coded; from authorized user records / secure config | Approved | |
| D030 | Schema allows future additional administrators; v1 implements one | Approved | |
| D031 | Application retention does not delete forwarded Gmail mailbox copies | Approved | Document Gmail retention boundary |
| D032 | Server-side org/role authorization required; RLS defence in depth | Approved | |
| D033 | Android does not directly write core business records to Supabase tables | Approved | |

## Notes

- **Proposed** items should be promoted to Approved before implementation milestones that depend on them.
- **Open** items are tracked in [OPEN_QUESTIONS.md](OPEN_QUESTIONS.md).
- **Deferred** items are intentionally out of the early delivery path.
