# Open questions

Unresolved implementation decisions. **Do not fabricate answers.** Resolve before the milestone that depends on each item. When resolved, record an Approved entry in [DECISIONS.md](DECISIONS.md) and update dependent docs.

| #   | Question                                                                                                                                            | Blocks / affects            | Notes                                                         |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | ------------------------------------------------------------- |
| 1   | Exact primary Android dialer application (device model for optimization is Samsung Galaxy S24+ per D040)                                            | A10–A11 reliability testing | Completed-call and missed-call behaviour varies by OEM/dialer |
| 3   | Capability-link domain or initial Vercel domain                                                                                                     | A4, A7, A15                 | Needed for email link targets                                 |
| 4   | Gmail polling interval; is a five-minute maximum delay acceptable?                                                                                  | A5                          | Tradeoff between freshness and API quota/cost                 |
| 5   | Should Gmail Pub/Sub remain deferred?                                                                                                               | A5 / later                  | Polling-first is approved as acceptable initially             |
| 7   | Default Recipient email supplied through secure environment configuration or Owner-managed contact records                                          | A3, A7                      | Not hard-coded; value not recorded in this repo               |
| 8   | Exact Workspace domain allowlist for Owner sign-in                                                                                                  | A3                          | Auth restriction                                              |
| 9   | If Gmail rejects one attachment for size or policy, should forwarding preserve all other attachments, and how is partial-forward failure presented? | A7                          | Affects user trust and audit                                  |
| 12  | Completed-task tombstone and audit retention duration after content purge                                                                           | A13                         | How long minimal metadata remains                             |
| 13  | Is a custom domain needed before private deployment?                                                                                                | A15                         | Related to #3                                                 |
| 18  | Default capability link expiry duration                                                                                                             | A4, A7                      | Balance security vs Recipient convenience                     |
| 19  | One capability link for multiple actions vs rotate/invalidate after each action                                                                     | A4, A7                      | Affects misuse recovery and UX                                |
| 20  | Recipient notes via voice input in version one                                                                                                      | A4, A12                     | Owner has voice; Recipient web may be typed-only initially    |
| 21  | Does a re-forwarded assignment email invalidate earlier capability links?                                                                           | A7                          | Forwarding may expose links to unintended parties             |
| 22  | Minimal technical metadata to retain for capability misuse investigation (IP, user-agent, etc.)                                                     | A4, A15                     | Must align with D052 audit wording                            |

## Closed in this documentation phase (do not reopen without a new decision)

| Former # | Resolution                                                                                                                                                                                                                                                                                                                                      | Decision ID                 |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| 2        | Minimum Android version Android 12 / `minSdk` 31; primary validation device Samsung Galaxy S24+; private sideload                                                                                                                                                                                                                               | D040                        |
| 14       | OpenAPI is the canonical API contract; TS/Kotlin generated from OpenAPI; JSON Schema may be derived, not source of truth                                                                                                                                                                                                                        | D007                        |
| 15       | Assignment + Gmail forward = one business action; single confirmation disclosing create task, forward email, forward attachments, schedule reminders                                                                                                                                                                                            | D037                        |
| 16       | Voice never creates a Task directly; voice follow-ups begin as Task Suggestions; voice always yields a proposed action requiring approval                                                                                                                                                                                                       | D038                        |
| 17       | Recipient (formerly administrator) may complete, waiting, notes, return to Owner, request clarification via capability link; may not create standalone tasks or change learning/rules/policies/automations; Recipient work requests → Task Suggestions. No Recipient application accounts; capability possession is authorization not identity. | D048–D054 (supersedes D039) |
| 6        | Failed transcription audio: encrypted retry up to 48 hours, then delete; immediate delete after successful transcription and validation                                                                                                                                                                                                         | D041                        |
| 10       | Gmail-origin Recipient assignment forwards full email context/thread available to the application with all attachments; partial forward failure must not report complete success                                                                                                                                                                | D042                        |
| 11       | After Owner enables Google Messages as approved source, notification content may be sent for AI analysis; SMS response drafts open in Google Messages for user send; app does not send SMS in v1                                                                                                                                                | D043                        |

## Explicitly not open (already decided)

- WhatsApp and other non-Messages messengers are excluded.
- Approval before task creation and before assignment/forward.
- All attachments forward automatically after assignment approval (no separate attachment approval).
- Application 7-day excerpt vs 30-day completed visibility are distinct.
- Forwarded Gmail copies are outside application deletion control.
- Neon is excluded from version one.
- FCM is deferred.
- Play Store is excluded from version one.
- AI must not invent facts, deadlines, contacts, commitments, properties, money, or follow-up dates ([AI_CONSTITUTION.md](AI_CONSTITUTION.md)).
- Learning ladder advances only with explicit Owner approval; trusted automation not enabled in v1; learning belongs to Owner only (D054).
- OpenAPI is the Canonical Contract (D007).
- Single confirmation for assign + Gmail forward package (D037).
- Voice creates proposals/suggestions, not Tasks directly (D038).
- Single authenticated Owner; Recipients have no accounts; capability links with GET non-mutating and POST after confirm (D048–D050).
- “Administrator” is an optional Recipient relationship label, not an application role (D053).
- Minimum Android version API 31 / Android 12; Galaxy S24+ validation target (D040).
