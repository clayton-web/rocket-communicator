# Open questions

Unresolved decisions only. Do not invent answers. When resolved, record an **Approved** entry in [DECISIONS.md](DECISIONS.md) and update dependent docs.

Workspace domain allowlist for Owner sign-in is environment-local configuration (`OWNER_WORKSPACE_DOMAIN`); it is not tracked as an open architecture question.

| #   | Question                                                                       | Blocks  | Notes                                                           |
| --- | ------------------------------------------------------------------------------ | ------- | --------------------------------------------------------------- |
| 1   | Exact primary Android dialer application (device target: Galaxy S24+ per D040) | A10–A11 | OEM dialer behaviour varies                                     |
| 3   | Capability-link domain / production Vercel hostname                            | A7, A15 | Production uses `NEXT_PUBLIC_APP_URL`; custom domain still open |
| 7   | Default Recipient email: secure env vs Owner-managed contacts                  | A7      | Not hard-coded in repo                                          |
| 9   | Partial Gmail attachment forward failure: preserve other attachments? UX?      | A7      | Must not report complete success (D042)                         |
| 12  | Tombstone / audit retention after content purge                                | A13     |                                                                 |
| 13  | Custom domain required before private deployment?                              | A15     | Related to #3                                                   |
| 21  | Does re-forward invalidate earlier capability links?                           | A7      | Deferred to forwarding/reassignment work                        |

## Closed in A5 decisions

| #   | Former question                    | Resolution                               |
| --- | ---------------------------------- | ---------------------------------------- |
| 4   | Gmail polling interval ≤5 minutes? | **D065** — every five minutes            |
| 5   | Keep Gmail Pub/Sub deferred?       | **D066** — deferred for A5; polling only |

Closed former questions map to decisions in [DECISIONS.md](DECISIONS.md) (including D007, D037–D043, D040–D041, D048–D077). Do not reopen without a new Decision.
