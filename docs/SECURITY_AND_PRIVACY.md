# Security and privacy

Governed by [PROJECT_CONSTITUTION.md](PROJECT_CONSTITUTION.md). Terms: [GLOSSARY.md](GLOSSARY.md). Related: [DATA_RETENTION.md](DATA_RETENTION.md) (forwarding boundary). Permissions: [DECISIONS.md](DECISIONS.md) D039.

## Google Workspace authentication

- Users sign in with Google accounts via Supabase Auth (intended).
- Version one assumes the primary user and administrator are in the **same** Google Workspace organization.
- Restrict sign-in to an approved Workspace domain allowlist (exact domain recorded via secure configuration—see [OPEN_QUESTIONS.md](OPEN_QUESTIONS.md)).

## Same-organization administrator access

- Administrator identity is an authorized Workspace user record in the application database.
- Do **not** hard-code administrator email addresses in source code.
- Schema should allow additional administrators later without implementing multi-admin UX in version one.

## Role permissions (version one)

| Capability                                                       | Primary                                        | Administrator                        |
| ---------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------ |
| Connect Gmail account                                            | Yes                                            | No                                   |
| Review/approve/dismiss/merge suggestions                         | Yes                                            | No                                   |
| Approve assignment and Gmail forward (single confirmation, D037) | Yes                                            | No                                   |
| Create standalone tasks (typed)                                  | Yes                                            | No                                   |
| Create tasks via voice                                           | No — voice yields Task Suggestions only (D038) | No                                   |
| Submit work request → Task Suggestion                            | Yes                                            | Yes (becomes suggestion for Primary) |
| View assigned tasks via secure link                              | Yes                                            | Yes (assigned)                       |
| Complete assigned tasks                                          | Yes                                            | Yes                                  |
| Mark waiting                                                     | Yes                                            | Yes                                  |
| Add notes                                                        | Yes                                            | Yes                                  |
| Return task to primary                                           | Yes                                            | Yes                                  |
| Request clarification                                            | Yes                                            | Yes                                  |
| Snooze                                                           | Yes                                            | No                                   |
| Approve AI learning / activate workflow rules                    | Yes                                            | No                                   |
| Change reminder policies                                         | Yes                                            | No                                   |
| Create automations                                               | Yes (future, after approval ladder)            | No                                   |

Administrator-generated work requests become Task Suggestions for Primary User approval (D039).

## Server-side authorization

- All mutating business operations go through authenticated server APIs.
- APIs must enforce organization membership and role checks on every request.
- Android and web clients are not trusted to self-assert authorization.

## Supabase RLS boundary

- Prisma server operations **do not** automatically inherit the signed-in user’s Supabase RLS context.
- Application authorization must be explicit in server code.
- RLS should be used as **defence in depth** and for explicitly designed direct-client or Realtime access paths.
- Do not delegate authorization vaguely to RLS alone.

## Gmail OAuth token protection

- Store refresh/access tokens encrypted at rest on the server.
- Limit scopes to what is required for readonly ingest, send, and forward.
- Provide reauth detection and user-visible recovery.
- Never ship tokens to the Android client.

## Android credential storage

- Store session tokens in platform secure storage (Keystore-backed).
- Android should call APIs; it should **not** directly write core business records to Supabase tables.

## Secure authenticated task links

- Task links require Google Workspace authentication and authorization checks.
- Tokens may assist deep-linking (bind action intent) but must not allow unauthenticated mutation.
- Use expiring, auditable tokens when used; store hashes, not raw tokens.

## Why unauthenticated one-click completion is excluded

Email clients and intermediaries may prefetch links. Unauthenticated GET/POST completion would be unsafe and unauditable. All completions and state changes require an authenticated session and server-side authorization.

## Notification-source consent

- Notification access is sensitive and user-granted.
- Explain why access is needed; handle revocation gracefully.
- Limit processed packages to approved sources (e.g., Google Messages, Phone/Dialer).

## Contact exclusions

- Users can exclude contacts and notification sources from capture/AI.
- Exclusions must be enforced server-side as well as on device.

## OTP and financial-alert exclusions

- Heuristic and policy filters should exclude authentication codes and sensitive financial alerts from AI prompts and storage where detected.
- Prefer drop-before-model over “summarize then delete.”

## Prompt-data minimization

- Send the minimum excerpt required for structured extraction.
- Truncate threads; strip unnecessary quoted history and signatures when feasible.
- Do not upload full attachment binaries to the model in version one.

## Attachment forwarding implications

- After Primary User single confirmation of a Gmail-origin administrator assignment (D037), **all original attachments** are forwarded automatically—no separate attachment approval.
- This intentionally copies potentially sensitive files into the administrator’s mailbox.
- Users must understand that forwarding expands the retention and exposure boundary beyond the application database (see [DATA_RETENTION.md](DATA_RETENTION.md)).

## Audit logging

Log at least:

- suggestion approvals/dismissals/merges
- assignment and forward approvals (actor, time)—single bundled confirmation
- Gmail forwarded message identifiers
- reminder attempts and escalation
- retention purges and failures
- authz failures and secure-link use
- Gmail reauth events
- administrator return-to-primary and clarification requests
- administrator work requests that create Task Suggestions

## Secret management

- Use environment configuration for secrets (never commit `.env`, keystores, service accounts).
- Preserve `.env.example` without real values.
- Administrator address and Workspace domain allowlist come from secure configuration, not source hard-coding.

## Privacy limitations created by forwarding emails

Temporary copies stored by the application are deleted according to the application retention policy. Emails deliberately forwarded through Google Workspace, including their attachments, remain subject to the organization’s Gmail retention and deletion practices.

The application cannot promise that forwarded content disappears after seven days.

## Private sideload distribution assumptions

- Version one is privately sideloaded or distributed through internal testing.
- No Google Play Store distribution assumptions (listing, Play review, Play App Signing) in v1.
- Device trust is limited to the primary user’s phone; protect local caches and clear temp audio promptly.
