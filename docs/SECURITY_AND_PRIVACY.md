# Security and privacy

Governed by [PROJECT_CONSTITUTION.md](PROJECT_CONSTITUTION.md). Terms: [GLOSSARY.md](GLOSSARY.md). Related: [DATA_RETENTION.md](DATA_RETENTION.md) (forwarding boundary). Capability model: [DECISIONS.md](DECISIONS.md) D048–D054.

## Google Workspace authentication (Owner only)

- The **Owner** signs in with a Google account via Supabase Auth (intended).
- Version one has **one** authenticated application user (D048).
- Restrict Owner sign-in to an approved Workspace domain allowlist (exact domain recorded via secure configuration—see [OPEN_QUESTIONS.md](OPEN_QUESTIONS.md)).
- Recipients do **not** sign in (D049).

## Recipient access (capability links)

- Recipients are delegated people identified by email; no application account.
- Recipients act through **task-specific capability links** embedded in assignment emails (D050).
- Do **not** hard-code Recipient email addresses in source code.
- Schema should allow additional Recipients later without implementing multi-Recipient UX in version one.
- “Administrator” is an optional relationship label, not an application role (D053).

## Role and capability permissions (version one)

| Capability                                                       | Owner (session)                                | Recipient (capability link)        |
| ---------------------------------------------------------------- | ---------------------------------------------- | ---------------------------------- |
| Connect Gmail account                                            | Yes                                            | No                                 |
| Review/approve/dismiss/merge suggestions                         | Yes                                            | No                                 |
| Approve assignment and Gmail forward (single confirmation, D037) | Yes                                            | No                                 |
| Create standalone tasks (typed)                                  | Yes                                            | No                                 |
| Create tasks via voice                                           | No — voice yields Task Suggestions only (D038) | No                                 |
| Submit work request → Task Suggestion                            | Yes                                            | Yes (becomes suggestion for Owner) |
| View assigned task via capability link                           | Yes                                            | Yes (scoped to link)               |
| Complete assigned tasks                                          | Yes                                            | Yes (POST after confirm)           |
| Mark waiting                                                     | Yes                                            | Yes (POST after confirm)           |
| Add notes                                                        | Yes                                            | Yes (POST after confirm)           |
| Return task to Owner                                             | Yes                                            | Yes (POST after confirm)           |
| Request clarification                                            | Yes                                            | Yes (POST after confirm)           |
| Snooze                                                           | Yes                                            | No                                 |
| Approve AI learning / activate workflow rules                    | Yes (Owner only — D054)                        | No                                 |
| Change reminder policies                                         | Yes                                            | No                                 |
| Create automations                                               | Yes (future, after approval ladder)            | No                                 |

Recipient-generated work requests become Task Suggestions for Owner approval.

## Server-side authorization

- Owner mutating operations require an authenticated Owner session.
- Recipient mutating operations require a valid capability token with appropriate scope.
- APIs must enforce authorization on every request; capability possession is authorization, not verified identity (D051).
- Android and web clients are not trusted to self-assert authorization.

## Supabase RLS boundary

- Prisma server operations **do not** automatically inherit the signed-in user’s Supabase RLS context.
- Application authorization must be explicit in server code (Owner session checks and capability validation).
- RLS should be used as **defence in depth** and for explicitly designed direct-client or Realtime access paths.
- Do not delegate authorization vaguely to RLS alone.

## Gmail OAuth token protection

- Store refresh/access tokens encrypted at rest on the server.
- Limit scopes to what is required for readonly ingest, send, and forward.
- Provide reauth detection and user-visible recovery.
- Never ship tokens to the Android client.

## Android credential storage

- Store Owner session tokens in platform secure storage (Keystore-backed).
- Android should call Owner session APIs; it should **not** directly write core business records to Supabase tables.

## Capability links

- Task-specific URLs embed secret capability tokens.
- **GET** is non-mutating (view only)—safe for email prefetchers (D050).
- **POST** mutations require explicit confirmation in the Recipient web UI.
- Tokens are expiring and auditable; store hashes, not raw tokens.
- Capability possession authorizes actions; audit must not overstate identity (D051, D052).
- Rotate or invalidate tokens when assignment is re-forwarded or misuse is suspected (policy TBD—see open questions).

## Why unauthenticated one-click completion is excluded

Email clients and intermediaries may prefetch links. Unauthenticated GET/POST completion would be unsafe and unauditable. Recipient state changes require a valid capability token, explicit POST confirmation, and server-side authorization—not bare link visits.

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

- After Owner single confirmation of a Gmail-origin Recipient assignment (D037), **all original attachments** are forwarded automatically—no separate attachment approval.
- This intentionally copies potentially sensitive files into the Recipient’s mailbox.
- Users must understand that forwarding expands the retention and exposure boundary beyond the application database (see [DATA_RETENTION.md](DATA_RETENTION.md)).

## Audit logging

Log at least:

- suggestion approvals/dismissals/merges
- assignment and forward approvals (Owner actor, time)—single bundled confirmation
- Gmail forwarded message identifiers
- reminder attempts and escalation
- retention purges and failures
- authz failures and capability-link use (with D052-compliant wording)
- Gmail reauth events
- Recipient return-to-Owner and clarification requests (capability id / technical metadata—not overstated identity)
- Recipient work requests that create Task Suggestions

## Secret management

- Use environment configuration for secrets (never commit `.env`, keystores, service accounts).
- Preserve `.env.example` without real values.
- Recipient addresses and Workspace domain allowlist come from secure configuration, not source hard-coding.

## Privacy limitations created by forwarding emails

Temporary copies stored by the application are deleted according to the application retention policy. Emails deliberately forwarded through Google Workspace, including their attachments, remain subject to the Recipient’s Gmail retention and deletion practices.

The application cannot promise that forwarded content disappears after seven days.

## Private sideload distribution assumptions

- Version one is privately sideloaded or distributed through internal testing.
- No Google Play Store distribution assumptions (listing, Play review, Play App Signing) in v1.
- Device trust is limited to the Owner’s phone; protect local caches and clear temp audio promptly.
