# Open questions

Unresolved implementation decisions. **Do not fabricate answers.** Resolve before the milestone that depends on each item.

| # | Question | Blocks / affects | Notes |
|---|----------|------------------|-------|
| 1 | Exact primary Android device model and dialer application | A10–A11 reliability testing | Completed-call and missed-call behaviour varies by OEM/dialer |
| 2 | Minimum supported Android version | A1/A9 scaffolding | Affects NotificationListener and security APIs |
| 3 | Secure task-link domain or initial Vercel domain | A4, A7, A15 | Needed for email link targets |
| 4 | Gmail polling interval; is a five-minute maximum delay acceptable? | A5 | Tradeoff between freshness and API quota/cost |
| 5 | Should Gmail Pub/Sub remain deferred? | A5 / later | Polling-first is approved as acceptable initially |
| 6 | Failed transcription audio retention: encrypted retry up to 24 hours vs immediate deletion | A12, A13, retention docs | Must not be silently assumed |
| 7 | Administrator Workspace address supplied through secure environment configuration | A3, A7 | Not hard-coded; value not recorded in this repo |
| 8 | Exact Workspace domain allowlist | A3 | Auth restriction |
| 9 | If Gmail rejects one attachment for size or policy, should forwarding preserve all other attachments, and how is partial-forward failure presented? | A7 | Affects user trust and audit |
| 10 | Should forwarding include the entire thread or only the triggering email? | A7 | Product and privacy impact |
| 11 | May the application automatically submit approved-source Google Messages content for AI analysis before task approval? | A6, A10 | Capture vs analyze consent nuance |
| 12 | Completed-task tombstone and audit retention duration after content purge | A13 | How long minimal metadata remains |
| 13 | Is a custom domain needed before private deployment? | A15 | Related to #3 |

## Explicitly not open (already decided)

- WhatsApp and other non-Messages messengers are excluded.
- Approval before task creation and before assignment/forward.
- All attachments forward automatically after assignment approval (no separate attachment approval).
- Application 7-day excerpt vs 30-day completed visibility are distinct.
- Forwarded Gmail copies are outside application deletion control.
- Neon is excluded from version one.
- FCM is deferred.
- Play Store is excluded from version one.
