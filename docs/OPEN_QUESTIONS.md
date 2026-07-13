# Open questions

Unresolved implementation decisions. **Do not fabricate answers.** Resolve before the milestone that depends on each item. When resolved, record an Approved entry in [DECISIONS.md](DECISIONS.md) and update dependent docs.

| #   | Question                                                                                                                                            | Blocks / affects            | Notes                                                         |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | ------------------------------------------------------------- |
| 1   | Exact primary Android dialer application (device model for optimization is Samsung Galaxy S24+ per D040)                                            | A10–A11 reliability testing | Completed-call and missed-call behaviour varies by OEM/dialer |
| 3   | Secure task-link domain or initial Vercel domain                                                                                                    | A4, A7, A15                 | Needed for email link targets                                 |
| 4   | Gmail polling interval; is a five-minute maximum delay acceptable?                                                                                  | A5                          | Tradeoff between freshness and API quota/cost                 |
| 5   | Should Gmail Pub/Sub remain deferred?                                                                                                               | A5 / later                  | Polling-first is approved as acceptable initially             |
| 7   | Administrator Workspace address supplied through secure environment configuration                                                                   | A3, A7                      | Not hard-coded; value not recorded in this repo               |
| 8   | Exact Workspace domain allowlist                                                                                                                    | A3                          | Auth restriction                                              |
| 9   | If Gmail rejects one attachment for size or policy, should forwarding preserve all other attachments, and how is partial-forward failure presented? | A7                          | Affects user trust and audit                                  |
| 12  | Completed-task tombstone and audit retention duration after content purge                                                                           | A13                         | How long minimal metadata remains                             |
| 13  | Is a custom domain needed before private deployment?                                                                                                | A15                         | Related to #3                                                 |

## Closed in this documentation phase (do not reopen without a new decision)

| Former # | Resolution                                                                                                                                                                                                  | Decision ID |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| 2        | Minimum Android version Android 12 / `minSdk` 31; primary validation device Samsung Galaxy S24+; private sideload                                                                                           | D040        |
| 14       | OpenAPI is the canonical API contract; TS/Kotlin generated from OpenAPI; JSON Schema may be derived, not source of truth                                                                                    | D007        |
| 15       | Assignment + Gmail forward = one business action; single confirmation disclosing create task, forward email, forward attachments, schedule reminders                                                        | D037        |
| 16       | Voice never creates a Task directly; voice follow-ups begin as Task Suggestions; voice always yields a proposed action requiring approval                                                                   | D038        |
| 17       | Administrator may complete, waiting, notes, return to primary, request clarification; may not create standalone tasks or change learning/rules/policies/automations; admin work requests → Task Suggestions | D039        |
| 6        | Failed transcription audio: encrypted retry up to 48 hours, then delete; immediate delete after successful transcription and validation                                                                     | D041        |
| 10       | Gmail-origin admin assignment forwards full email context/thread available to the application with all attachments; partial forward failure must not report complete success                                | D042        |
| 11       | After Primary enables Google Messages as approved source, notification content may be sent for AI analysis; SMS response drafts open in Google Messages for user send; app does not send SMS in v1          | D043        |

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
- Learning ladder advances only with explicit approval; trusted automation not enabled in v1.
- OpenAPI is the Canonical Contract (D007).
- Single confirmation for assign + Gmail forward package (D037).
- Voice creates proposals/suggestions, not Tasks directly (D038).
- Administrator permission set for v1 (D039).
- Minimum Android version API 31 / Android 12; Galaxy S24+ validation target (D040).
