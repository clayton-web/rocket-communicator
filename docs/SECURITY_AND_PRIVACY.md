# Security and privacy

Governed by [PROJECT_CONSTITUTION.md](PROJECT_CONSTITUTION.md). Definitions: [GLOSSARY.md](GLOSSARY.md). Decisions: D048–D094 in [DECISIONS.md](DECISIONS.md). Retention/forwarding boundary: [DATA_RETENTION.md](DATA_RETENTION.md).

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
- Public HTTP errors must not reveal whether a token is **unknown**, **expired**, or **malformed**—those cases collapse to **401 `UNAUTHORIZED`**. Insufficient scope → **403 `FORBIDDEN`**; wrong task binding → **404 `NOT_FOUND`**. See [API_CONTRACT.md](API_CONTRACT.md).
- **Re-forward / reassignment (D086):** At most one active Recipient capability per Assignment. Reassignment or explicit re-forward revokes the previous active capability and issues a new one; revoked records and audit history are preserved. When a token **matches** a capability with internal reason **superseded**, return **401** `CAPABILITY_NO_LONGER_ACTIVE` with a non-sensitive “This link is no longer active” message — without disclosing whether another active capability exists, the replacement capability, or Task/Assignment/Recipient details. All other unusable capability cases (manual revoke, assignment-ended, expired, unknown/unmatched) remain generic **401** `UNAUTHORIZED`.
- Ordinary retry of the same failed delivery reuses the same handoff attempt and capability unless the Recipient or security-sensitive assignment details changed (D086, D092).
- `pending` or `failed` delivery must not expose an actionable Recipient capability (D092).

## Permission matrix (v1)

| Action                                                        | Owner (Session)             | Recipient (Capability)   |
| ------------------------------------------------------------- | --------------------------- | ------------------------ |
| Connect Gmail                                                 | Yes                         | No                       |
| Approve/dismiss/merge suggestions                             | Yes                         | No                       |
| Approve assignment + Gmail forward / handoff (D037, D090)     | Yes                         | No                       |
| Manage Recipients (minimal list/create/update/inactive, D087) | Yes                         | No                       |
| Create standalone Task (typed)                                | Yes                         | No                       |
| Create Task via voice                                         | No (Suggestions only, D038) | No                       |
| Work request → Suggestion                                     | No (Owner review only)      | Yes                      |
| View assigned Task via link                                   | Via Owner APIs              | Yes (scoped)             |
| Complete / waiting / notes / return / clarification           | Yes                         | Yes (POST after confirm) |
| Snooze                                                        | Yes                         | No                       |
| Approve learning / policies / automations                     | Yes (D054)                  | No                       |

## Server enforcement

- Every mutating Owner request: authenticated Owner Session.
- Every mutating Recipient request: valid Capability (scope, expiry, status, task/assignment binding).
- Clients are not trusted to self-assert authorization.
- Prisma does **not** inherit end-user Supabase RLS; application checks are required (D006). RLS is defence in depth for designed direct-client/Realtime paths.

## Secrets and credentials

- Env secrets only; commit `.env.example` placeholders, never real values.
- Encrypt Gmail OAuth tokens server-side as ciphertext only (`GmailOAuthCredential`); never ship to Android; never expose on public Gmail DTOs. **A5.3 implemented** AES-256-GCM purpose-bound encryption for refresh tokens and PKCE verifiers (see below). Stale schema comments that imply “no encryption yet” refer only to early A5.1–A5.2 persistence scaffolding and must not be read as current behaviour.
- A5.3 uses AES-256-GCM with a random IV, authentication tag, explicit key version, and purpose-bound AAD (`gmail_refresh_token` / `gmail_pkce_verifier`) in a versioned envelope. The encryption key (`GMAIL_TOKEN_ENCRYPTION_KEY`) is server-only and must never enter browser bundles. OAuth stores only a SHA-256 `stateHash` plus an encrypted PKCE verifier; raw state and plaintext verifiers are never persisted.
- A5.4 decrypts the refresh token only during sync to obtain a memory-only access token; access tokens are never persisted. Manual sync audits use Owner attribution; system scheduled-poll attribution remains A5.5. Raw Gmail payloads, MIME, full HTML, attachment bytes, and base64 bodies are never persisted or logged.
- A5.5 authenticates `GET|POST /api/v1/internal/gmail/poll` with `Authorization: Bearer <CRON_SECRET>` (constant-time compare). Owner session cookies/JWTs do not authorize the poll route. External Scheduler invocations use `AuditActorKind.system` / `systemId=gmail_poll` (D074). The Application Polling Engine never initializes History cursors. Scheduler choice is external and replaceable (D079); security of the Bearer secret is mandatory regardless of which scheduler invokes the endpoint.
- A6.3 authenticates `POST /api/v1/internal/suggestions/process` with the same application `CRON_SECRET` / `InternalCronBearer` pattern (`systemId=suggestion_process`). Do not confuse application `CRON_SECRET` with any External Scheduler management credential (env name only: `CRON_JOB_ORG_API_KEY`) — the management credential never belongs in the repository or in application HTTP auth.
- **A7 (D093; A7.7 API + A7.8 UI):** OAuth retains `gmail.readonly` and adds `gmail.send`. Do not request `gmail.modify` without a new Decision. Existing readonly connections may continue polling; handoff returns `403 GMAIL_SEND_SCOPE_REQUIRED` when `gmail.send` is missing. Owner re-consent uses `POST /api/v1/gmail/oauth/start?returnPath=/tasks/{taskId}` (HTML form POST); connection DTO emits `canSend` / `requiresSendReconsent` without raw scope strings. Successful/pending idempotent replays do **not** re-resolve Gmail access. Handoff audits never store raw Recipient email or full Idempotency-Key values; raw capability tokens/URLs are never returned on the handoff route. A7.8 browser `sessionStorage` pending-operation records hold only Task/Recipient IDs, Idempotency-Key, original If-Match, and public outcome flags — never emails, summaries, Gmail content, or capability secrets.
- Owner Session tokens on Android use platform secure storage.
- Recipient emails come from Owner-managed Recipient records (D087)—not hard-coded and not an environment-variable default Recipient as the production model.

## Audit (A4 field set; A5 system actor)

Record capability ID, bound resource IDs, action, timestamp, request ID, outcome, state/version context, truthful attribution (D057). Raw IP and full user-agent deferred. Wording must not overstate identity (D052).

**A5 (D074):** External Scheduler invocations for Gmail polling use `AuditActorKind.system` with a `systemId` (for example `gmail_poll`). Do not fake Owner attribution for scheduler-triggered work. Owner and capability actor kinds remain unchanged.

**A6 (D084):** Suggestion processing invocations use the same truthful `system` actor pattern with a distinct `systemId` (for example `suggestion_process`). Generation must not share the Gmail sync transaction.

**A5.3 Owner Gmail OAuth audits** (Owner actor only): `gmail_oauth_started`, `gmail_connected`, `gmail_reconnected`, `gmail_disconnected`. Notes never contain tokens or raw OAuth errors.

Also audit: suggestion decisions, assignment/forward/handoff approvals and delivery attempts (privacy-safe), reminder attempts (A8), retention runs, authz denials, Gmail reauth / insufficient-scope, work-request Suggestions.

## Other controls

- No unauthenticated one-click mutations (prefetch risk; D014/D050).
- Notification access is user-granted; limit to approved packages; enforce exclusions server-side.
- Drop OTP/financial-alert patterns before model prompts when detected.
- Minimize prompt excerpts; no full attachment binaries to the model in v1.
- Forwarding after D037 copies attachments into the Recipient mailbox outside application retention (D031). Disclose this boundary in the A7.8 confirmation UI (implemented).
- A7 must not send knowingly incomplete Gmail-origin forwards (D088).
- Capability link base URL for A7: `NEXT_PUBLIC_APP_URL` (D094); custom domain does not block A7 (OPEN #13 remains for A15).
- Private sideload only in v1 (D019)—no Play Store assumptions.
