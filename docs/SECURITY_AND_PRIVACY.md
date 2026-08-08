# Security and privacy

Governed by [PROJECT_CONSTITUTION.md](PROJECT_CONSTITUTION.md). Definitions: [GLOSSARY.md](GLOSSARY.md). Decisions: D048–D101 plus the telemetry boundary in **D113–D115** in [DECISIONS.md](DECISIONS.md). Retention/forwarding boundary: [DATA_RETENTION.md](DATA_RETENTION.md).

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
- **A9.0 / D145–D147:** One shared Owner authentication pipeline on the server. Web continues to present the Supabase session as SSR cookies; Android presents the Supabase access JWT as `Authorization: Bearer`. Both are verified with `auth.getUser()` and the same allowlist/org binding — never trusted as raw credentials. `GET /api/v1/session` is the canonical authenticated API probe. Android stores session tokens in platform secure storage, restores on launch, refreshes only when required at startup or when authentication fails naturally (no background refresh scheduler), and signs out with Supabase **`SignOutScope.LOCAL`** — revoking only that device's session and clearing local credentials (D147). Android sign-out does **not** end web sessions. Browser `POST /auth/sign-out` remains web-only (D123).

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

| Action                                                                 | Owner (Session)                                                                                   | Recipient (Capability)   |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------ |
| Connect Gmail                                                          | Yes                                                                                               | No                       |
| Approve/dismiss/merge suggestions                                      | Yes                                                                                               | No                       |
| Approve assignment + Gmail forward / handoff (D037, D090)              | Yes                                                                                               | No                       |
| Manage Recipients (minimal list/create/update/inactive, D087)          | Yes                                                                                               | No                       |
| Create standalone Task (typed)                                         | Yes                                                                                               | No                       |
| Create Task via voice                                                  | No (Suggestions only, D038)                                                                       | No                       |
| Work request → Suggestion                                              | No (Owner review only)                                                                            | Yes                      |
| View assigned Task via link                                            | Via Owner APIs                                                                                    | Yes (scoped)             |
| Complete / waiting / notes / return / clarification                    | Yes                                                                                               | Yes (POST after confirm) |
| Set / change / remove the Task due date driving A8 Recipient reminders | Yes (D102, D104)                                                                                  | No                       |
| Pause reminders other than via Waiting                                 | No (D101, D107)                                                                                   | No                       |
| Configure Owner-created Task reminder dates/times                      | Product-authorized (D152); **not implemented** (A8 APIs expose due-date engine only — D103, D110) | No                       |
| Approve learning / policies / automations                              | Yes (D054)                                                                                        | No                       |

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
- Owner Session tokens on Android use platform secure storage (EncryptedSharedPreferences / Keystore-backed; A9.0 / D146). Tokens must not be logged, written to ordinary SharedPreferences, or included in backups (`android:allowBackup="false"`).
- Recipient emails come from Owner-managed Recipient records (D087)—not hard-coded and not an environment-variable default Recipient as the production model.

## Audit (A4 field set; A5 system actor)

Record capability ID, bound resource IDs, action, timestamp, request ID, outcome, state/version context, truthful attribution (D057). Raw IP and full user-agent deferred. Wording must not overstate identity (D052).

**A5 (D074):** External Scheduler invocations for Gmail polling use `AuditActorKind.system` with a `systemId` (for example `gmail_poll`). Do not fake Owner attribution for scheduler-triggered work. Owner and capability actor kinds remain unchanged.

**A6 (D084):** Suggestion processing invocations use the same truthful `system` actor pattern with a distinct `systemId` (for example `suggestion_process`). Generation must not share the Gmail sync transaction.

**A5.3 Owner Gmail OAuth audits** (Owner actor only): `gmail_oauth_started`, `gmail_connected`, `gmail_reconnected`, `gmail_disconnected`. Notes never contain tokens or raw OAuth errors.

Also audit: suggestion decisions, assignment/forward/handoff approvals and delivery attempts (privacy-safe), **reminder scheduling changes and delivery attempts** with durable privacy-safe lifecycle history, including truthful skip and failure reasons and generation identity (A8, D100, D109), Event Notification Engine outcomes (A8, D099), retention runs, authz denials, Gmail reauth / insufficient-scope, work-request Suggestions. Do not require retention of complete email bodies for reminder history, and never record a capability token or capability URL in it (D109).

## Telemetry and diagnostics boundary (P1; D113–D115)

**Not implemented** — no telemetry, analytics, RUM, or vendor integration exists today. This records the approved boundary before any of it is built.

**Capability URLs are credentials.** The Capability Link carries the raw authorization secret **in the URL path** (`/c/{token}`). Any system that records URLs therefore records credentials.

- **Client telemetry, analytics, performance reporting, error reporting, and logging must never transmit, store, or forward a raw `/c/{token}` path, a capability token, or a capability token hash** (D114).
- **Chosen default: capability routes are excluded from client telemetry entirely.** Route-template scrubbing was considered and **rejected as the default**, because it places the secret inside the reporting path at least momentarily and depends on a scrubbing implementation remaining correct indefinitely. Full exclusion fails safe.
- **Server-side** privacy-safe diagnostics for capability routes are permitted **only** with the route identified as a static template that never carries the token value.
- This is enforced by an **automated assertion**, not review alone (D119).

**Never permitted in any telemetry, log, metric, or error payload** (D114): capability tokens and URLs; OAuth access, refresh, or state tokens; PKCE verifiers; email bodies and subjects; Task notes and summary text; communication excerpts; attachment content; MIME; plaintext Recipient email addresses; full `Idempotency-Key` values; raw provider error bodies; connection strings.

**Permitted:** stable non-secret identifiers, non-reversible fingerprints, categories, enum outcomes, counters, and durations — the existing A7.5 privacy-safe pattern, generalized.

**Telemetry is not authority (D113).** Operational telemetry answers only whether the application is working properly. It is **not** a business record, **not** audit history, and **not** an AI-learning source; it must never drive product behaviour, alter business state, or be promoted into learning input. Audit history must never be derived from telemetry, and telemetry must never be edited to make audit history look consistent.

**No behavioural tracking.** P1 authorizes no commercial analytics vendor, session replay, or behavioural tracking (D115). Passive behaviour, inactivity, and the absence of a correction are never treated as approval or as a decision (D113).

## Owner Event Notification mail (A8.5c–A8.5e; D133, D134, D136)

**Implemented and unreachable.** The renderer and the real Gmail adapter exist; `ENABLE_OWNER_EVENT_DELIVERY` is unset in every environment, and **no Gmail message has been sent by this engine in implementation or in any test**. Since A8.5e the worker endpoint also has a capability-expiry capture phase under the separate `ENABLE_OWNER_EVENT_CAPTURE` flag; that phase composes no transport, resolves no Gmail configuration, and touches no credential, so enabling capture cannot cause a message to be sent.

**The destination cannot be influenced.** It is resolved server-side at delivery time from `CommunicationAccount.emailAddress` for the organization named on the notification intent, and the message is addressed to that same mailbox. The transport exposes **no destination parameter**, so no request, session, environment variable, Task field, Recipient row, event metadata, or audit metadata can select a recipient. The worker is cron-authenticated and has no Owner session; trusted persisted account state is the only input. Where `OWNER_ORGANIZATION_ID` is configured it is a fail-closed assertion — a disagreeing intent is refused, never redirected to another organization.

**No address is persisted or logged.** The destination appears in no intent row, attempt row, audit event, log line, worker response, or failure code. Failure codes come from a closed set defined in code, so a provider error body or exception string cannot become one; only a short normalized provider message reference is retained on success.

**Owner mail states the event; it never quotes untrusted input.** Permitted content is fixed Rocket copy, the canonical event meaning, the URL-redacted persisted Task summary, the historical actor kind, the occurrence instant, and one link to an authenticated Owner surface. Capability tokens, token hashes, capability URLs, `/c/` paths, temporary excerpts, raw incoming mail, Recipient note bodies, clarification text, OAuth data, provider error bodies, raw exception strings, tracking pixels, and remote images are all prohibited. **Escaping does not satisfy the prohibition on Recipient text** — the rule is semantic: a Recipient's words delivered to the Owner's inbox under Rocket's own `From` address are laundered regardless of encoding. Structurally, such text has no parameter through which to reach the renderer, and the renderer additionally refuses any rendered body containing a `/c/` path or any URL other than the single link it constructed.

**An Owner link is not a credential (D134).** D130 governs the capability bearer secret in Recipient mail. Owner links point only to authenticated application surfaces on the canonical base URL, with identifiers path-encoded; an unauthenticated reader reaches sign-in rather than Task data.

**Nine more producers store nothing new (A8.5d).** All ten ratified events now write intents, and the A8.5a columns were sufficient for every one of them. No clarification text, note body, Gmail excerpt, provider response body, exception message, email address, capability token, or capability URL reaches an intent row, and a source guard reads the producer transactions to keep that true. The four events whose copy is intentionally generic — a terminal handoff failure, a clarification request, a Gmail disconnection, a reminder stop — say what happened and point at the authenticated surface where the detail lives, rather than carrying the detail into the Owner's inbox. A subject-to-Task lookup at render time selects an identifier and nothing else.

**Capability expiry observation reveals nothing to a Recipient.** The shared expiry transaction changes only the capability's status, and only from `active` and only once its instant has passed. It cannot make an expired token usable, it does not overwrite a newer revoked or consumed state, and a failure to record a notification cannot affect authorization truth — the notification is written after the transition and inside the same transaction, so either both facts hold or neither does.

**Authorization does not depend on the sweep, the flags, or a notification (A8.5e).** Wiring the sweep to the worker changed when expiry becomes durable and changed nothing about when a capability is usable: the validator's own rule is unchanged, and an expired capability is refused whether the sweep ran, whether capture is enabled, whether an intent was created, and whether any notification was ever delivered. A sweep that fails extends no token's life; a notification insert that is refused cannot make an expired capability usable, because notification-intent uniqueness is not an authorization condition. The worker response reports counts only and names no capability, no address, and no individual expiry instant, so an operator reading it learns how much happened and nothing about whom it happened to.

**Self-ingestion protection is narrow (D136).** Rocket's own Owner notifications carry a fixed `X-Rocket-Generated: owner-event-notification` header emitted by the controlled MIME builder, which owns the name and validates the value so callers still cannot supply arbitrary headers. Ingestion skips a message carrying exactly one exact marker in its **top-level** headers, before any excerpt or event is created; nested-part headers are ignored, since honouring them would let an attacker claim the exclusion by attaching a forwarded copy. Duplicate, empty, and near-miss markers fail closed and remain ingestible, and ordinary self-sent mail is untouched.

## Other controls

- No unauthenticated one-click mutations (prefetch risk; D014/D050).
- Notification access is user-granted; limit to approved packages; enforce exclusions server-side.
- Drop OTP/financial-alert patterns before model prompts when detected.
- Minimize prompt excerpts; no full attachment binaries to the model in v1.
- Forwarding after D037 copies attachments into the Recipient mailbox outside application retention (D031). Disclose this boundary in the A7.8 confirmation UI (implemented).
- A7 must not send knowingly incomplete Gmail-origin forwards (D088).
- Capability link base URL for A7: `NEXT_PUBLIC_APP_URL` (D094); custom domain does not block A7 (OPEN #13 remains for A15).
- Private sideload only in v1 (D019)—no Play Store assumptions.
