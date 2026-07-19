# Open questions

Unresolved decisions only. Do not invent answers. When resolved, record an **Approved** entry in [DECISIONS.md](DECISIONS.md) and update dependent docs.

Workspace domain allowlist for Owner sign-in is environment-local configuration (`OWNER_WORKSPACE_DOMAIN`); it is not tracked as an open architecture question.

| #   | Question                                                                       | Blocks  | Notes                                                                                            |
| --- | ------------------------------------------------------------------------------ | ------- | ------------------------------------------------------------------------------------------------ |
| 1   | Exact primary Android dialer application (device target: Galaxy S24+ per D040) | A10–A11 | OEM dialer behaviour varies                                                                      |
| 3   | Capability-link domain / production hostname                                   | A15     | A7 uses `NEXT_PUBLIC_APP_URL` (D094). Custom domain still open for private deployment (OPEN #13) |
| 12  | Tombstone / audit retention after content purge                                | A13     |                                                                                                  |
| 13  | Custom domain required before private deployment?                              | A15     | Related to #3                                                                                    |

## Closed in A7 decisions

| #   | Former question                                                           | Resolution                                                                          |
| --- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 7   | Default Recipient email: secure env vs Owner-managed contacts             | **D087** — Owner-managed Recipient records only; minimal Recipient management in A7 |
| 9   | Partial Gmail attachment forward failure: preserve other attachments? UX? | **D088** — do not send knowingly incomplete forwards; retryable failure to Owner    |
| 21  | Does re-forward invalidate earlier capability links?                      | **D086** — yes; revoke prior active capability; issue new; preserve history         |

## Closed in A5 decisions

| #   | Former question                    | Resolution                               |
| --- | ---------------------------------- | ---------------------------------------- |
| 4   | Gmail polling interval ≤5 minutes? | **D065** — every five minutes            |
| 5   | Keep Gmail Pub/Sub deferred?       | **D066** — deferred for A5; polling only |

Closed former questions map to decisions in [DECISIONS.md](DECISIONS.md) (including D007, D037–D043, D040–D041, D048–D094). Do not reopen without a new Decision.
