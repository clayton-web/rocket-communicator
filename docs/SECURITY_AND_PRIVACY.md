# Security and privacy

Governed by [PROJECT_CONSTITUTION.md](PROJECT_CONSTITUTION.md). Definitions: [GLOSSARY.md](GLOSSARY.md). Decisions: D048–D064 in [DECISIONS.md](DECISIONS.md). Retention/forwarding boundary: [DATA_RETENTION.md](DATA_RETENTION.md).

## Distinctions

| Concept              | Meaning here                                                                                              |
| -------------------- | --------------------------------------------------------------------------------------------------------- |
| Authentication       | Proving the Owner’s identity (Supabase Google Workspace sign-in)                                          |
| Authorization        | Allowing an action after checks (Owner session rules, or Capability scope/status/expiry/binding)          |
| Identity             | Verified Owner person via Session. A Capability Link holder is **not** treated as verified identity       |
| Capability           | Authorization grant persisted server-side (hash, scope, binding)                                          |
| Bearer credential    | The raw capability secret in the Capability Link; possession authorizes within scope                      |
| Truthful attribution | Audit describes capability use for the intended Recipient email; does not claim “verified person X acted” |

## Owner authentication

- One Authenticated User: the Owner (D048).
- Workspace domain allowlist via secure env (`OWNER_WORKSPACE_DOMAIN`); not hard-coded.
- Recipients do not authenticate (D049).

## Recipient authorization

- Recipients act only through Capability Links (D050). **Recipients do not have application accounts** (D049).
- Separate Owner session surfaces vs capability surfaces (D059).
- GET view is non-mutating; POST requires explicit confirmation (`confirmation: "confirmed"`) (D050, D059).
- **Default issued scope** (when Owner does not specify a subset at issuance): `view_assigned_task`, `complete_task`, `mark_task_waiting`, `add_task_note`, `return_task_to_owner`, `request_clarification`, `submit_work_request` (`DEFAULT_RECIPIENT_CAPABILITY_SCOPE` in `@aicaa/domain`).
- **`record_completion_outcome`** may appear in OpenAPI but is **not** included in the default issued scope unless explicitly granted.
- **Resume** (`POST …/resume`) is permitted when the capability includes **`mark_task_waiting`**; resume shares that scope action.
- Default expiry seven days; required TTL config; persisted `expiresAt` (D055).
- Multi-use until invalidation; no A4 `used` transitions (D056).
- Store hash only; raw secret may return once to Owner; never log raw secret (D063).
- Public HTTP errors must not reveal whether a token is unknown, expired, revoked, or malformed—those cases collapse to **401 `UNAUTHORIZED`**. Insufficient scope → **403 `FORBIDDEN`**; wrong task binding → **404 `NOT_FOUND`**. See [API_CONTRACT.md](API_CONTRACT.md).
- Re-forward invalidation: OPEN #21 (A7).

## Permission matrix (v1)

| Action                                              | Owner (Session)             | Recipient (Capability)   |
| --------------------------------------------------- | --------------------------- | ------------------------ |
| Connect Gmail                                       | Yes                         | No                       |
| Approve/dismiss/merge suggestions                   | Yes                         | No                       |
| Approve assignment + Gmail forward (D037)           | Yes                         | No                       |
| Create standalone Task (typed)                      | Yes                         | No                       |
| Create Task via voice                               | No (Suggestions only, D038) | No                       |
| Work request → Suggestion                           | No (Owner review only)      | Yes                      |
| View assigned Task via link                         | Via Owner APIs              | Yes (scoped)             |
| Complete / waiting / notes / return / clarification | Yes                         | Yes (POST after confirm) |
| Snooze                                              | Yes                         | No                       |
| Approve learning / policies / automations           | Yes (D054)                  | No                       |

## Server enforcement

- Every mutating Owner request: authenticated Owner Session.
- Every mutating Recipient request: valid Capability (scope, expiry, status, task/assignment binding).
- Clients are not trusted to self-assert authorization.
- Prisma does **not** inherit end-user Supabase RLS; application checks are required (D006). RLS is defence in depth for designed direct-client/Realtime paths.

## Secrets and credentials

- Env secrets only; commit `.env.example` placeholders, never real values.
- Encrypt Gmail OAuth tokens server-side; never ship to Android.
- Owner Session tokens on Android use platform secure storage.
- Recipient emails and allowlists from secure configuration, not source hard-coding.

## Audit (A4 field set)

Record capability ID, bound resource IDs, action, timestamp, request ID, outcome, state/version context, truthful attribution (D057). Raw IP and full user-agent deferred. Wording must not overstate identity (D052).

Also audit: suggestion decisions, assignment/forward approvals, reminder attempts, retention runs, authz denials, Gmail reauth, work-request Suggestions.

## Other controls

- No unauthenticated one-click mutations (prefetch risk; D014/D050).
- Notification access is user-granted; limit to approved packages; enforce exclusions server-side.
- Drop OTP/financial-alert patterns before model prompts when detected.
- Minimize prompt excerpts; no full attachment binaries to the model in v1.
- Forwarding after D037 copies attachments into the Recipient mailbox outside application retention.
- Private sideload only in v1 (D019)—no Play Store assumptions.
