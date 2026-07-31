# API contract

**Source of truth:** `packages/contracts/openapi/` → bundled `packages/contracts/dist/openapi.bundled.yaml`.

Related: [STATE_MACHINE.md](STATE_MACHINE.md) · [SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md) · [DECISIONS.md](DECISIONS.md) (D007, D044–D047, D045, D059, D065–D101) · [GLOSSARY.md](GLOSSARY.md) · [MILESTONES.md](MILESTONES.md) · [DEPLOYMENT.md](DEPLOYMENT.md)

**A8 product law** (due-date-driven Follow-up Engine / Event Notification Engine, **D102–D110**, superseding parts of D095–D101) is documentation-locked. **A8.3b contracted the Owner reminder surface only** — see [Owner reminder schedule (A8.3b)](#owner-reminder-schedule-a83b) below. Everything else in A8 remains uncontracted: there is no reminder worker or processing endpoint, no attempt-history route, no Event Notification resource, and no Recipient-facing reminder surface. OpenAPI still contains historical reminder/snooze stubs—see **Future A8 contract alignment inventory** below. Do **not** treat those stubs as A8 product law.

**P1 makes no contract change (D111, D119).** The P1.0 lock (D111–D120) adds no path, DTO, enum, error code, header, or generated client, and does **not** authorize the OpenAPI reminder-debt cleanup below. Two consequences for P1 implementers:

- **No health or readiness endpoint is added.** It is not authorized and not a P1 acceptance requirement (D115); a contract test currently asserts `/health` is absent from the bundled spec. Adding one needs its own decision.
- **The correlation reference reuses the existing envelope.** `ErrorResponse` already carries `requestId` and `correlationId`, and `AuditEvent` already has both columns. P1.1 fixes how they are **populated** — the envelope currently discards the route-context `requestId` and emits a fresh UUID with `correlationId: null` — with no contract or schema change (D115).
- Renaming the product would change OpenAPI `info.title` and is therefore outside P1 scope; the current official name stands (**D120**, Open).

## Ownership

| Layer                 | Owns                                               |
| --------------------- | -------------------------------------------------- |
| OpenAPI               | Wire paths, DTOs, enums, errors, pagination, ETags |
| `packages/domain`     | Transition and capability policy                   |
| Generated TS / Kotlin | Transport DTOs only                                |

Handlers map domain ↔ DTO explicitly (D046). Domain types are not generated DTOs.

## Implementation status (HTTP)

Use this table with [MILESTONES.md](MILESTONES.md). OpenAPI may describe future routes before handlers ship.

| Status                                              | Meaning                                                                                                      |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| **Implemented and production-verified**             | Handler exists in `apps/web`; included in **`A4_FULL_E2E_PASS`** production verification.                    |
| **Implemented, not separately production-verified** | Handler exists; not individually called out in the A4 E2E report.                                            |
| **Implemented, not production-operational**         | Handler exists in the repository; required production migration, credentials, or secrets are not configured. |
| **Contract-only / planned**                         | OpenAPI + domain types exist; **no** `apps/web` route yet. Target milestone noted.                           |
| **Future milestone**                                | Product behaviour defined; not in current codebase.                                                          |

## Tooling and generation

| Tool                                  | Version                                                                         | Purpose            |
| ------------------------------------- | ------------------------------------------------------------------------------- | ------------------ |
| `@redocly/cli`                        | 1.34.3                                                                          | Lint and bundle    |
| `openapi-typescript`                  | 7.6.1                                                                           | TypeScript DTOs    |
| `@openapitools/openapi-generator-cli` | 2.18.4 (generator per `packages/contracts/openapitools.json`, currently 7.14.0) | Kotlin models only |

Committed outputs; `pnpm contracts:generate` / `contracts:check-drift` (D044). Kotlin generation removes stale orphans via `cleanup-kotlin-orphans.mjs`.

Kotlin (D047): model-only (`apis=false`, `supportingFiles=false`); `library=jvm-okhttp4`; `serializationLibrary=moshi`; no HTTP client runtime. Android networking client deferred.

### Generating clients locally

| Command                          | When to use                                                                                                                                                                           |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm contracts:generate`        | Default. Requires a local **JDK 17** (same major as CI Temurin 17) for Kotlin generation.                                                                                             |
| `pnpm contracts:generate:docker` | Optional. When host `java` is unavailable; Docker Desktop must be running. Supplies a pinned Temurin JDK 17 image for Kotlin only; bundle and TypeScript still run on host Node/pnpm. |

Docker is **optional** tooling for Kotlin generation. It is **not** required for ordinary tests (PGlite), application development, or production (Vercel + Supabase + cron-job.org). Do not treat Docker as a general monorepo runtime.

After either generate path, `pnpm contracts:check-drift` must pass — committed TypeScript and Kotlin outputs stay the source of CI truth (D044).

## Base path

`/api/v1`

## Authentication models

Owner Session vs Recipient Capability: [SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md).

- Owner routes: `bearerAuth` / Supabase SSR cookies. `organizationId` from `OWNER_ORGANIZATION_ID`; `OWNER_WORKSPACE_DOMAIN` gates sign-in only.
- Capability routes: path `{token}` (`CapabilityToken`). OpenAPI `security: []` because path apiKeys cannot be expressed. Browser `GET /c/[token]` is non-mutating; mutations are POST after confirm.
- Recipients do **not** have application accounts (D049).

## Recipient capability authorization (summary)

Full rules: [SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md).

- **Default issued scope** (when Owner omits a custom subset): `view_assigned_task`, `complete_task`, `mark_task_waiting`, `add_task_note`, `return_task_to_owner`, `request_clarification`, `submit_work_request` (`DEFAULT_RECIPIENT_CAPABILITY_SCOPE` in `@aicaa/domain`).
- **`record_completion_outcome`** is a valid `CapabilityAction` but is **not** in the default issued scope unless explicitly granted at issuance.
- **Resume** (`POST …/resume`) is authorized when the capability includes **`mark_task_waiting`**; resume is a UI/route alias, not a separate scope action.
- **GET** capability views (`/api/v1/capabilities/{token}/tasks/{taskId}`, `GET /c/[token]`) are strictly non-mutating.
- **POST** mutations require `confirmation: "confirmed"` in the JSON body (D050).
- Unknown, expired, and malformed/**unmatched** tokens intentionally collapse to **401 `UNAUTHORIZED`**; wrong task binding → **404 `NOT_FOUND`**; insufficient scope → **403 `FORBIDDEN`**.
- **A7.1 (D086):** When a token **matches** a stored capability that was **superseded** (re-forward/reassignment), respond **401** with **`CAPABILITY_NO_LONGER_ACTIVE`** (message like “This link is no longer active”) without disclosing replacement capability or Task/Assignment/Recipient details. All other unusable capability cases (manual revoke, assignment-ended, expired, unknown/unmatched/malformed) remain generic **401 `UNAUTHORIZED`**. Do not weaken the generic unmatched-token response.

## Endpoints

### Owner session routes

**Status: implemented and production-verified (A3 + A4 baseline).**

| Method | Path              | Purpose               | Status              |
| ------ | ----------------- | --------------------- | ------------------- |
| GET    | `/api/v1/session` | Current Owner session | Production-verified |

### Owner task routes

**Status: implemented and production-verified (A4 — `A4_FULL_E2E_PASS`).**

| Method | Path                                            | Purpose                                                                                                              |
| ------ | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/v1/tasks`                                 | List tasks (`updatedAt` DESC, `id` DESC; includes dismissed)                                                         |
| POST   | `/api/v1/tasks`                                 | Create **unassigned** task (any supplied top-level `recipientId` → `400 RECIPIENT_HANDOFF_NOT_AVAILABLE`, A7.6/D091) |
| GET    | `/api/v1/tasks/{taskId}`                        | Get task                                                                                                             |
| POST   | `/api/v1/tasks/{taskId}/start`                  | Start                                                                                                                |
| POST   | `/api/v1/tasks/{taskId}/waiting`                | Waiting                                                                                                              |
| POST   | `/api/v1/tasks/{taskId}/resume`                 | Resume                                                                                                               |
| POST   | `/api/v1/tasks/{taskId}/complete`               | Complete                                                                                                             |
| POST   | `/api/v1/tasks/{taskId}/notes`                  | Note                                                                                                                 |
| POST   | `/api/v1/tasks/{taskId}/snooze`                 | Historical snooze surface (D060 superseded by D101 for Follow-up product law; contract debt)                         |
| POST   | `/api/v1/tasks/{taskId}/dismiss`                | Dismiss (D064)                                                                                                       |
| POST   | `/api/v1/tasks/{taskId}/return-to-owner`        | Clear assignment to Owner                                                                                            |
| POST   | `/api/v1/tasks/{taskId}/clarification-requests` | Clarification                                                                                                        |
| POST   | `/api/v1/tasks/{taskId}/capabilities`           | Administrative capability issue (raw once); **not** D037 handoff (D086)                                              |
| POST   | `/api/v1/tasks/{taskId}/handoff`                | D037 Recipient handoff (implemented A7.7)                                                                            |

Reminder schedule management lives on a sub-resource of the same Task and is documented separately below: `GET`/`PUT`/`DELETE /api/v1/tasks/{taskId}/reminder` (A8.3b).

### Owner reminder schedule (A8.3b)

**Status: implemented, not production-operational.** Handlers exist in `apps/web`; the A8.3a migration is **not applied in Production**, so these three routes cannot function there until it is. Binding: D102–D107, D109, D128. `operationId`s: `getTaskReminder`, `setTaskReminder`, `removeTaskReminder`.

| Method | Path                              | Purpose                                                                  |
| ------ | --------------------------------- | ------------------------------------------------------------------------ |
| GET    | `/api/v1/tasks/{taskId}/reminder` | Read reminder state (no `If-Match`; `Cache-Control: no-store`)           |
| PUT    | `/api/v1/tasks/{taskId}/reminder` | Establish or materially change the canonical local due date (`If-Match`) |
| DELETE | `/api/v1/tasks/{taskId}/reminder` | Remove the due date and stop the schedule (`If-Match`)                   |

**Request surface is one field.** `SetTaskReminderRequest` carries only `dueLocalDate` as a canonical `YYYY-MM-DD` organization-local calendar date. There is no reminder-time field (09:00 is a constant, D103), no preset interval (retired, D102), no recurrence, and no timezone field — the scheduling timezone is derived from organization configuration, not chosen by the Owner. Occurrence dates and instants, the generation, the advance disposition, the schedule status, the delivered count, the stop reason, and the organization are **all server-derived**, and a request supplying any of them is rejected with `400 VALIDATION_ERROR` rather than having the field ignored.

**Response is a read-only projection.** `TaskReminderState` returns `taskId`, `dueLocalDate`, `schedulingTimeZone`, `state`, `generation`, `advance`, `nextOverdueOccurrence`, `overdueDeliveredCount`, `requiresOwnerAttention`, and `stopReason`. `state` distinguishes `no_due_date`, `not_scheduled`, `active`, `suspended_waiting`, and `stopped`, and is authoritative for whether anything will be sent; `advance` and `nextOverdueOccurrence` are the generation's recorded decisions and become history once `state` is `stopped`. Local calendar dates are canonical `YYYY-MM-DD` text and instants are ISO-8601 UTC; the local date is never reconstructed from `dueAt`.

**Worker internals are deliberately absent** from the response: no claim lease, worker identifier, provider message identifier, raw delivery-failure detail, delivery-attempt row, or database row identifier. Those stay free to change without a contract break, and a contract test asserts their absence.

**Idempotency and generations (D104, D106, D109).** Re-sending the same effective due date against a live schedule returns the current state, opens no generation, and emits no audit event — re-saving must not reset the delivered count, or repeated saves would defeat the D106 ceiling. A material change opens exactly one new generation and preserves every prior delivery attempt. Re-sending a date onto a **stopped** schedule opens a new generation even when the date is unchanged, because a stopped schedule is not the same effective schedule and D109 requires an explicit Owner re-save to reactivate reminders. Removal is idempotent and deletes no reminder row.

**Errors.** `401 UNAUTHORIZED` unauthenticated; `404 NOT_FOUND` for a missing Task and, per the established convention, for a Task in another organization; `400 VALIDATION_ERROR` for an impossible or noncanonical date or a server-derived field; `412 PRECONDITION_FAILED` for a stale `If-Match` or a losing concurrent generation change; `428 PRECONDITION_REQUIRED` for a missing `If-Match` on a mutation; `409 DOMAIN_CONFLICT` for an illegal schedule transition. Prisma and PostgreSQL detail is never surfaced.

**Not contracted by A8.3b:** no reminder processing or worker endpoint, no attempt-history route, no Recipient-facing reminder surface, no Event Notification resource, and no reminder suspend/resume control — Waiting remains the only pause mechanism (D107) and its reminder coupling is deferred ([MILESTONES.md](MILESTONES.md)).

### Owner Recipient handoff (A7.1 contracted; A7.7 implemented)

**Status: OpenAPI contracted (A7.1); handlers implemented (A7.7) and production-verified at A7 close** (both delivery paths sent; Recipient capability completion observed). Binding: D037, D086–D094. `operationId`: `handoffTask`.

| Method | Path                             | Purpose                                                                                          | Status             |
| ------ | -------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------ |
| POST   | `/api/v1/tasks/{taskId}/handoff` | D037 handoff on an existing unassigned Task (assignment + capability + email/forward + delivery) | Implemented — A7.7 |

**Contracted / runtime semantics:**

- Owner session; Task `If-Match` (D045); required header `Idempotency-Key` (8–128, `[A-Za-z0-9._~-]+`). Missing either → `428 PRECONDITION_REQUIRED`. Malformed Idempotency-Key → `400 VALIDATION_ERROR`. Malformed / wrong-Task ETag → `412 PRECONDITION_FAILED`.
- Body: `recipientId` + `acknowledgement: handoff_confirmed_v1` only (`additionalProperties: false`). No raw email, no client capability token, no delivery-mode spoof, no `proposedRecipientId` / `proposedRecipientHint` (unknown fields → `400 VALIDATION_ERROR`; hint resolution is **deferred**, not part of this contract).
- Server selects `gmail_forward` vs `assignment_email` from Task source. Gmail forwards include persisted Task `summaryPoints` + all required attachments; assignment emails carry no attachments.
- Success **200** with `HandoffTaskResponse`: Task (+ version/ETag), delivery path/status (`sent`), Recipient summary, `capabilityId` (**no** raw token), `requiresSendReconsent: false`, `idempotentReplay`. All responses `Cache-Control: no-store`.
- **Idempotency-first:** organization-scoped lookup on `(organizationId, Idempotency-Key)` before current-state / Gmail checks. Matching **sent** → 200 replay (`idempotentReplay: true`) even with the original (pre-bump) If-Match and even after Recipient deactivation or Gmail disconnect. Matching **pending** → `409 HANDOFF_IN_PROGRESS`. Matching **failed** → same-key retry via A7.5 (historical address snapshot). Fingerprint mismatch → `409 IDEMPOTENCY_KEY_CONFLICT`. Only a **new** handoff compares If-Match to the current Task version and requires an unassigned Task.
- Delivery failure / incomplete forward / missing send scope → **non-2xx** (retryable provider → `503 HANDOFF_DELIVERY_FAILED`; permanent provider → `400 HANDOFF_DELIVERY_FAILED`; ambiguous → `503 DEPENDENCY_UNAVAILABLE` with attempt left pending; send scope → `403 GMAIL_SEND_SCOPE_REQUIRED`). Do not treat pending rows as success.
- Reminder Schedules / reminder sends / Event Notification Engine processing are **not** part of this operation (D089). Handoff confirms **no** follow-up interval; presets are retired and reminders derive from the Task due date (D102). Reassignment and explicit re-forward remain deferred.

**Administrative capability issue** (`POST …/capabilities`) remains for A4 recovery: returns raw token once; obeys D086 one-active rule; does **not** send mail/forward.

### Owner Recipient management (A7.1 contracted; A7.6 implemented)

**Status: OpenAPI contracted (A7.1); handlers implemented and validated (A7.6).** Minimal D087 surface — not a CRM. Contract, generated clients, and Prisma schema unchanged.

| Method | Path                                          | Purpose                         | Status             |
| ------ | --------------------------------------------- | ------------------------------- | ------------------ |
| GET    | `/api/v1/recipients`                          | List **active** Recipients only | Implemented — A7.6 |
| POST   | `/api/v1/recipients`                          | Create Recipient                | Implemented — A7.6 |
| PATCH  | `/api/v1/recipients/{recipientId}`            | Update display/email/label      | Implemented — A7.6 |
| POST   | `/api/v1/recipients/{recipientId}/deactivate` | Mark inactive (not delete)      | Implemented — A7.6 |

Create and update are **separate** (not upsert). Deactivation is a dedicated action. List defaults to active-only (no status filter).

**A7.6 runtime behavior:** authenticated Owner only (session-derived org/identity; capability links never authorize); all responses `Cache-Control: no-store` and exclude `organizationId`/`emailNormalized`/DB metadata. List is ordered by normalized display name (NFC → trim → lowercase → collapse whitespace) then Recipient id, with an opaque base64url compound cursor (default limit 25, min 1, max 100; malformed cursor → `400 VALIDATION_ERROR`; `nextCursor: null` when exhausted). Create/update/deactivate are org-scoped conditional writes requiring `active = true`; `404 NOT_FOUND` (missing/cross-org, no existence leak) vs `409 DOMAIN_CONFLICT` (same-org inactive); duplicate active normalized email → `409` via the partial unique index. No reactivation, no deletion. Email is mutable, but historical Assignment/Capability `intended_recipient_email` snapshots are never rewritten (retries use the snapshot; new handoffs use the current email). Deactivation blocks new handoffs but does not revoke live capabilities. Create/update/deactivate write a durable Owner-attributed `AuditEvent` atomically (updates record changed field **names** only — never raw email values). Bodies require `Content-Type: application/json` (else `415`).

### Owner task suggestion routes

**Status: implemented and production-operational (A6 closed).** Binding: D080–D085. See [MILESTONES.md](MILESTONES.md) A6.

| Method | Path                                              | Purpose                                   |
| ------ | ------------------------------------------------- | ----------------------------------------- |
| GET    | `/api/v1/task-suggestions`                        | List suggestions                          |
| GET    | `/api/v1/task-suggestions/{suggestionId}`         | Get suggestion                            |
| POST   | `/api/v1/task-suggestions/{suggestionId}/approve` | Approve → **unassigned Task** only (D080) |
| POST   | `/api/v1/task-suggestions/{suggestionId}/edit`    | Edit pending                              |
| POST   | `/api/v1/task-suggestions/{suggestionId}/dismiss` | Dismiss                                   |
| POST   | `/api/v1/task-suggestions/{suggestionId}/merge`   | Merge into task (dual If-Match, D083)     |

Recipient **work requests** in A4 create pending suggestions in persistence without these Owner review routes.

### Internal suggestion processing (A6)

**Status: implemented and production-operational (A6 closed).** External Scheduler (cron-job.org) invokes this endpoint every five minutes, separate from Gmail poll.

| Method | Path                                   | Purpose                                                              |
| ------ | -------------------------------------- | -------------------------------------------------------------------- |
| POST   | `/api/v1/internal/suggestions/process` | External Scheduler invocation (`InternalCronBearer` / `CRON_SECRET`) |

**POST only.** Empty body. Bounded batch with Hobby-safe soft time budget. Returns aggregate counts (`claimed`, `skippedIrrelevant`, `suggestionsCreated`, `failedRetryable`, `failedPermanent`, `requestId`). Lifecycle: claim/lease → deterministic heuristic → LLM extraction via `packages/ai` only for heuristic-pass events → at most one pending suggestion per event (D081, D085). Claim ordering prefers `unprocessed` over `failed_retryable` (then fewer attempts, then older `internalDate`) so retries cannot starve fresh events. No raw communication bodies, excerpts, prompts, or model payloads in responses. Failure audits may store privacy-safe diagnostic fingerprints (status, finish reason, top-level keys, schema issue codes) — never prompts, bodies, or model output text. Independent of Gmail History ingestion (D075, D084). Safe to invoke repeatedly. Global AI misconfiguration fails the invocation (or releases claims without permanently poisoning events).

**AI operational error codes (names only; stored on events/audits, not in HTTP aggregate body beyond counts):** `AI_MISSING_CREDENTIALS`, `AI_INVALID_CREDENTIALS`, `AI_DISABLED`, `AI_TIMEOUT`, `AI_RATE_LIMIT`, `AI_INSUFFICIENT_QUOTA`, `AI_PROVIDER_5XX`, `AI_NETWORK`, `AI_EMPTY_OUTPUT`, `AI_MALFORMED_JSON`, `AI_SCHEMA_INVALID`, `AI_INVALID_OUTPUT` (legacy umbrella), `AI_POLICY_REFUSAL`, `AI_UNSUPPORTED_RESPONSE`.

**Credentials (names only):** application auth uses `CRON_SECRET`. The External Scheduler management credential (for example cron-job.org’s API key env name `CRON_JOB_ORG_API_KEY`) is never stored in the repository and is not used by the application endpoint.

### Recipient capability routes and pages

**Status: implemented and production-verified (A4 — `A4_FULL_E2E_PASS`).** A7.1 contracts matched-superseded behaviour (D086).

| Method | Path                                                                 | Purpose                                     |
| ------ | -------------------------------------------------------------------- | ------------------------------------------- |
| GET    | `/api/v1/capabilities/{token}/tasks/{taskId}`                        | Non-mutating view                           |
| GET    | `/c/[token]`                                                         | Non-mutating browser capability page        |
| POST   | `/api/v1/capabilities/{token}/tasks/{taskId}/waiting`                | Waiting                                     |
| POST   | `/api/v1/capabilities/{token}/tasks/{taskId}/resume`                 | Resume (requires `mark_task_waiting` scope) |
| POST   | `/api/v1/capabilities/{token}/tasks/{taskId}/complete`               | Complete                                    |
| POST   | `/api/v1/capabilities/{token}/tasks/{taskId}/notes`                  | Note                                        |
| POST   | `/api/v1/capabilities/{token}/tasks/{taskId}/return-to-owner`        | Return to Owner                             |
| POST   | `/api/v1/capabilities/{token}/tasks/{taskId}/clarification-requests` | Clarification                               |
| POST   | `/api/v1/capabilities/{token}/tasks/{taskId}/work-requests`          | Work request → pending Suggestion (D061)    |

Return-to-Owner (either surface) clears assignment ownership; Task status unchanged.

**Capability auth errors (A7.1):** Unknown/malformed/expired/**unmatched** tokens, and matched capabilities that are unusable for any reason **other than supersession**, → `401` `UNAUTHORIZED` (generic, probing-safe). Token that **matches** a stored capability with internal revocation reason **`superseded`** → `401` `CAPABILITY_NO_LONGER_ACTIVE` (“This link is no longer active”) without disclosing replacement capability or Task/Assignment/Recipient state. Public page may show a friendly inactive message for that matched-superseded case only.

### Owner Gmail routes (A5)

OAuth, History sync, and internal poll are **implemented and production-operational**. A5 is closed. Gmail settings UI and History recovery are deferred and do not block A7.

| Method | Path                           | Purpose                                                                      | Status                        |
| ------ | ------------------------------ | ---------------------------------------------------------------------------- | ----------------------------- |
| GET    | `/api/v1/gmail/connection`     | Safe connection status (+ optional A7.1 send flags)                          | Production-operational (A5.3) |
| POST   | `/api/v1/gmail/oauth/start`    | Start OAuth redirect (`gmail.readonly` today; A7 adds `gmail.send` per D093) | Production-operational (A5.3) |
| GET    | `/api/v1/gmail/oauth/callback` | OAuth callback redirect (no tokens in query)                                 | Production-operational (A5.3) |
| POST   | `/api/v1/gmail/disconnect`     | Disconnect and wipe credential ciphertext                                    | Production-operational (A5.3) |
| POST   | `/api/v1/gmail/sync`           | Owner manual sync (initial + incremental)                                    | Production-operational (A5.4) |
| GET    | `/api/v1/gmail/sync-runs`      | Recent safe sync-run summaries                                               | Production-operational (A5.4) |
| GET    | `/api/v1/internal/gmail/poll`  | External Scheduler invocation (`InternalCronBearer`)                         | Production-operational (A5.5) |
| POST   | `/api/v1/internal/gmail/poll`  | Operator / scheduler invocation (`InternalCronBearer`)                       | Production-operational (A5.5) |

`GmailConnection` retains `readonlyScope` and adds optional `canRead`, `canSend`, `requiresSendReconsent` (booleans — no raw Google scope strings). Runtime OAuth requests `gmail.readonly` + `gmail.send` (A7.4). **A7.8:** `GET /api/v1/gmail/connection` emits `canSend` / `requiresSendReconsent` from the persisted grant string (never raw scope strings). Owner UI pages `/tasks` and `/tasks/[taskId]` consume Task, Recipient, handoff, and Gmail connection APIs; OAuth start uses `returnPath=/tasks/{taskId}`.

Public Gmail DTOs never include refresh/access tokens, ciphertext, encryption key versions, OAuth codes, or PKCE secrets. Internal poll uses `InternalCronBearer` (configured `CRON_SECRET`), not Owner session and not public unauthenticated access. The application owns the Application Polling Engine; the scheduler is external (D079). GET on the internal Gmail poll route is a **secret-authenticated scheduler exception** for hosts whose schedulers prefer GET (e.g. Vercel Cron)—do not copy this pattern to public Recipient routes (D050). Preferred initial production adapter is HTTP **POST** from **cron-job.org** (or any compatible External Scheduler) every five minutes. External Scheduler invocations never initialize History cursors; Owner manual sync must seed first. A5 does **not** expose communication-event list/browser endpoints (D073).

## Suggestion approval semantics (D080)

`ApproveTaskSuggestionRequest` requires `acknowledgement: suggestion_approved`. Optional `summaryPoints`, `priority`, and `dueAt` may refine the created **unassigned Task**. A due date supplied here is an **explicit Owner selection** and, once A8 is implemented, will establish the Task-scoped Reminder Schedule (D102, D104); an AI-proposed `proposedDueAt` has no scheduling effect unless the Owner selects it.

**A6 server behaviour:**

- Create unassigned Task from the suggestion.
- Do **not** create TaskAssignment, issue Capability, send assignment email, Gmail-forward, or send any reminder.
- If `recipientId` is present → HTTP **400** with error code **`RECIPIENT_HANDOFF_NOT_AVAILABLE`**.
- Recipient handoff remains **A7** via `POST /api/v1/tasks/{taskId}/handoff` (D037, D090).

`assignment_approved` is **removed** from the contract (never relied upon by shipped handlers).

### Assignment delivery status (D092)

`AssignmentDeliveryStatus` (`pending` | `sent` | `failed`) is the contracted delivery outcome model for A7 handoff. It is **not** a permanent OpenAPI placeholder.

- `pending` / `failed` — not an actionable Recipient handoff.
- `sent` — Gmail accepted the outbound send (not that the human opened/read it).
- Attempt history may use a dedicated resource in later A7 phases without overloading Assignment.

### Handoff concurrency and idempotency (A7.1)

| Header            | Required      | Missing                     | Notes                                             |
| ----------------- | ------------- | --------------------------- | ------------------------------------------------- |
| `If-Match`        | Yes           | 428 `PRECONDITION_REQUIRED` | Task strong ETag (D045)                           |
| `Idempotency-Key` | Yes (handoff) | 428 `PRECONDITION_REQUIRED` | New A7 convention; 8–128 chars `[A-Za-z0-9._~-]+` |

Idempotent replay of a **completed success** → 200 with `idempotentReplay: true`. Same key + conflicting payload → 409 `IDEMPOTENCY_KEY_CONFLICT`. In-progress attempt → 409 `HANDOFF_IN_PROGRESS`.

### A7.2 domain policy notes (handoff)

Pure domain module `@aicaa/domain` handoff policies (no persistence/HTTP/Gmail I/O):

- **Idempotency fingerprint** (canonical, then injectable hash): `organizationId`, `taskId`, `recipientId`, `acknowledgement`. **Not** included: `If-Match` / Task version (concurrency separate), timestamps, capability token, provider message id, delivery status.
- **Retry** = same failed attempt + same capability when security-sensitive fingerprint inputs unchanged and no provider message id. **Explicit re-forward** = intentional new attempt/capability after prior `sent`; prior capability `revocationReason=superseded`. **Reassignment** = Recipient change; prior capability superseded; new attempt/capability.
- **Capability revocation reason** (internal; persistence/audit): `superseded` | `manual` | `assignment_ended` | `expired`. **Public mapping:** only a **matched** capability with internal reason `superseded` may return `CAPABILITY_NO_LONGER_ACTIVE`. All other unusable cases (manual, assignment-ended, expired, unknown/unmatched/malformed/missing token, inactive without positively identified supersession) remain generic `UNAUTHORIZED` — do not use `FORBIDDEN` or expose the internal reason.
- Create-with-`recipientId` rejection is implemented (A7.6): the `POST /api/v1/tasks` parser rejects any body that owns a top-level `recipientId` (any value) with `400 RECIPIENT_HANDOFF_NOT_AVAILABLE` before side effects, and `createOwnerTask` has removed its create-with-assignment branch (defensive invariant only). Domain `assertCreateTaskRejectsRecipientId` remains (D091).

### A7.3 persistence notes (handoff)

Durable foundation in `@aicaa/db` (no Gmail send / no HTTP handlers):

- **`HandoffAttempt`** is the authoritative delivery lifecycle (`pending` | `sent` | `failed`). `TaskAssignment.deliveryStatus` is denormalized and kept in sync inside handoff transactions. If they ever diverge, application code must trust **`HandoffAttempt.status`**.
- **Atomic lifecycle transitions:** pending→sent and pending→failed use conditional `UPDATE … WHERE status = 'pending'` (and null provider message id). Exactly one incompatible transition wins under ordinary READ COMMITTED row locking. Failed in-place retry uses `SELECT … FOR UPDATE` plus conditional update on `status = 'failed'`. Explicit re-forward / reassignment lock the prior attempt row before superseding.
- **Idempotency uniqueness:** `(organizationId, idempotencyKey)` unique. Fingerprint digest stored for replay/conflict detection. `If-Match` is not part of the fingerprint. Concurrent same-key creates resolve to one durable attempt: the winner replays; a loser whose winner is not yet visible receives the typed `HANDOFF_IN_PROGRESS` retry/conflict (never a raw `UNIQUE_VIOLATION`), and a later call deterministically replays the single attempt.
- **Provider message id:** org-scoped partial unique `(organizationId, providerMessageId)` WHERE not null. Immutable once recorded; conflicting replacement → `INVALID_STATE`; duplicate association across attempts → `UNIQUE_VIOLATION`.
- **Capability `revocationReason`:** typed enum aligned with A7.2.
- **Active vs actionable:** `status = active` does **not** mean Recipient-usable. A7 pending/failed handoff capabilities keep `actionableAt = null`. Recipient validation requires `actionableAt` (and Assignment delivery not `pending`/`failed` as defense in depth). A4 admin issuance sets `actionableAt = issuedAt` immediately. Pending non-actionable rows still count as the one `status = active` capability under the partial unique index (desirable so failed retry reuses the same row).
- **A4 administrative issuance vs UNRESOLVED A7 handoff:** Owner `POST …/capabilities` issue/replace (including `replaceExisting`) is rejected with the existing `ISSUANCE_CONFLICT` code while the **latest** handoff attempt for the Assignment is unresolved — `pending` **or** `failed` (retryable or not). "Latest relevant attempt" = newest by `created_at DESC, id DESC` scoped to `(organizationId, assignmentId)`. The gate is enforced inside the authoritative issuance transaction (`assertAdminIssuanceNotBlockedByHandoff`, which locks that row `FOR UPDATE`); a preflight check is friendly-only. Rationale: a failed A7 attempt deliberately reuses the same `HandoffAttempt`, Assignment, capability, idempotency key, and fingerprint, so administrative replacement would supersede that capability and orphan a later retry. There is **no implicit abandon/cancel** yet — unresolved failed lineage is resolved only through the A7 workflow (retry / explicit re-forward / reassignment). No new public error code is introduced.
- **One active capability per Assignment:** partial unique index `task_capabilities_one_active_per_assignment_idx` WHERE `status = 'active'` (Prisma cannot express partial uniques; migration SQL is source of truth).
- **Active Recipient email uniqueness:** partial unique on `(organizationId, email_normalized)` WHERE `active` — inactive historical rows may share a normalized email with a later active Recipient.
- **Distributed boundary:** (1) DB txn creates pending → commit (2) application calls Gmail (later) (3) DB txn records sent/failed. Uncertain windows (accepted-but-unrecorded, pending-never-sent, timeout) remain discoverable as stale `pending`; no separate `unknown` status. Reconciliation of stale/uncertain pending attempts is **later, explicitly-authorized worker** work — not A7.4.
- **Roadmap boundary (status hygiene):**
  - **A7.4:** Gmail OAuth send-scope preparation and transport/MIME utilities only.
  - **A7.5–A7.7:** application orchestration + authenticated handoff HTTP — **implemented**.
  - **A7.8:** Owner confirmation UI + Gmail send re-consent UI — **implemented**.
  - **Later reconciliation/worker:** stale or uncertain pending attempts, only when explicitly authorized.
- **Remaining (descoped from A7 at close; deferred to a future authorized slice):** reassignment / explicit re-forward orchestration, proposed-Recipient hint resolution, reconciliation worker. Recipient management HTTP and create-with-`recipientId` rejection shipped in A7.6; handoff HTTP in A7.7; Owner confirmation / re-consent UI in A7.8. A7 closed after a production E2E covering both delivery paths — see [MILESTONES.md](MILESTONES.md).

### CreateTaskRequest.recipientId deprecation (D091)

Field retained with OpenAPI `deprecated: true` for A4 compatibility. Server rejection **shipped in A7.6**: any body that owns a top-level `recipientId` (any value — UUID, unknown id, malformed string, empty string, `null`, number, boolean, object, array) is rejected `400 RECIPIENT_HANDOFF_NOT_AVAILABLE`; only complete omission permits creation. A differently cased or nested `recipientId` is not the legacy field and never creates an Assignment. New clients create unassigned Tasks then call handoff.

## Concurrency (D045, D083)

Mutable Task / TaskSuggestion: integer `version` and strong `etag`. Mutations require `If-Match` on the primary resource.

| Condition                                     | HTTP | Code                              |
| --------------------------------------------- | ---- | --------------------------------- |
| Missing suggestion `If-Match`                 | 428  | `PRECONDITION_REQUIRED`           |
| Stale suggestion `If-Match`                   | 412  | `PRECONDITION_FAILED`             |
| Merge missing `targetTaskIfMatch`             | 428  | `PRECONDITION_REQUIRED`           |
| Merge stale `targetTaskIfMatch` (target Task) | 412  | `PRECONDITION_FAILED`             |
| Domain conflict                               | 409  | `DOMAIN_CONFLICT`                 |
| Approve with `recipientId` (A6)               | 400  | `RECIPIENT_HANDOFF_NOT_AVAILABLE` |

Merge must not append to a stale Task (D083).

## Recipient capability errors

Public mapping for `/api/v1/capabilities/{token}/…`:

| Condition                                                                | HTTP | Public `ErrorCode`            |
| ------------------------------------------------------------------------ | ---- | ----------------------------- |
| Unknown, malformed, expired, unmatched, or non-superseded revoked token  | 401  | `UNAUTHORIZED`                |
| Token matches stored capability superseded by re-forward/reassign (D086) | 401  | `CAPABILITY_NO_LONGER_ACTIVE` |
| Valid token lacking required action scope                                | 403  | `FORBIDDEN`                   |
| Valid token used against the wrong task/resource                         | 404  | `NOT_FOUND`                   |
| Valid token; mutation conflicts with task state / domain rules           | 409  | `DOMAIN_CONFLICT`             |
| Invalid body or missing/invalid confirmation                             | 400  | `VALIDATION_ERROR`            |
| Missing `If-Match`                                                       | 428  | `PRECONDITION_REQUIRED`       |
| Malformed, task-mismatched, or stale `If-Match`                          | 412  | `PRECONDITION_FAILED`         |

A4 handlers may still collapse revoked tokens to **401 `UNAUTHORIZED`** until A7 capability runtime implements matched-**superseded** → `CAPABILITY_NO_LONGER_ACTIVE`. Unknown-token probing and non-superseded unusable matched tokens must remain generic `UNAUTHORIZED`.

## Handoff error mapping (A7.1 contract)

| Condition                                                                                | HTTP | Code                                                                                                                                     |
| ---------------------------------------------------------------------------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Missing `If-Match` or `Idempotency-Key`                                                  | 428  | `PRECONDITION_REQUIRED`                                                                                                                  |
| Stale Task `If-Match`                                                                    | 412  | `PRECONDITION_FAILED`                                                                                                                    |
| Validation / inactive Recipient / incomplete forward / source unavailable / not eligible | 400  | `VALIDATION_ERROR`, `RECIPIENT_INACTIVE`, `HANDOFF_INCOMPLETE_FORWARD_PROHIBITED`, `GMAIL_SOURCE_UNAVAILABLE`, `HANDOFF_NOT_ELIGIBLE`, … |
| Task/Recipient not found                                                                 | 404  | `NOT_FOUND`                                                                                                                              |
| Already assigned / key conflict / in progress                                            | 409  | `DOMAIN_CONFLICT`, `IDEMPOTENCY_KEY_CONFLICT`, `HANDOFF_IN_PROGRESS`                                                                     |
| `gmail.send` missing                                                                     | 403  | `GMAIL_SEND_SCOPE_REQUIRED`                                                                                                              |
| Gmail not connected / delivery failed (retryable)                                        | 503  | `GMAIL_NOT_CONNECTED`, `HANDOFF_DELIVERY_FAILED`, or `DEPENDENCY_UNAVAILABLE`                                                            |
| Safe internal failure                                                                    | 500  | `INTERNAL_ERROR`                                                                                                                         |

## Errors and pagination

Envelope: `{ "error": { "code", "message", "details?", "requestId", "correlationId?" } }`.

Public codes include prior codes plus A7: `CAPABILITY_NO_LONGER_ACTIVE`, `IDEMPOTENCY_KEY_CONFLICT`, `HANDOFF_NOT_ELIGIBLE`, `RECIPIENT_INACTIVE`, `GMAIL_NOT_CONNECTED`, `GMAIL_SEND_SCOPE_REQUIRED`, `GMAIL_SOURCE_UNAVAILABLE`, `HANDOFF_INCOMPLETE_FORWARD_PROHIBITED`, `HANDOFF_DELIVERY_FAILED`, `HANDOFF_IN_PROGRESS` (and existing `RECIPIENT_HANDOFF_NOT_AVAILABLE`).

Lists: cursor pagination (`cursor`, `limit` ≤ 100, `items`, `nextCursor`).

**`GET /api/v1/tasks`:** Ordered by `updatedAt` descending, then `id` descending. The opaque cursor encodes that composite order. All statuses are returned, including `dismissed`; excluding dismissed (or filtering by status) requires a future contracted query parameter—none exists today.

Summary points: OpenAPI `TaskSummaryPoint` discriminated union; max 20 per resource. `SourceReference` is origin metadata without secrets or full bodies.

## Future A8 contract alignment inventory

**A8.3b contracted the Owner reminder schedule surface; every other row below is still unimplemented.** Product law is **D102–D110** (superseding parts of D095–D101) and [WORKFLOWS.md](WORKFLOWS.md) §10a. Dispositions marked as remaining describe the approved **direction** for a later contract stage and must not be read as shipped. The **database** schema exists as of A8.3a (D128); as of A8.3b the Owner reminder routes expose the schedule, and nothing else does.

**Contract semantics to preserve when this is contracted (D103, D109):**

- **Due date** is an Owner-selected organization-**local calendar date**; the Owner selects **no** due time.
- A **reminder occurrence** is **09:00 in the configured organization timezone** on a local calendar date.
- **Absolute occurrence timestamps** are used for execution and audit, derived from the local date plus the fixed local time — never the reverse.
- There is **no** fixed-millisecond daily recurrence in the contract; recurrence is expressed as successive local calendar days.
- The authoritative representation is the local calendar date, with the existing instant-typed `dueAt` retained temporarily for compatibility. Exact **contract** field names are **not** locked here; the **database** column and table names were locked by D128 (`tasks.due_local_date`, `task_reminder_schedules`, `reminder_delivery_attempts`).
- **Existing historical due-date data must not automatically activate reminders.** Explicit Owner opt-in or re-save is required after implementation.

**Resolved by A8.3b:** the **Task Reminder Schedule read shape** now exists as `TaskReminderState` on `GET /api/v1/tasks/{taskId}/reminder`, with no preset field and no reminder-time field, as directed. **Owner due-date mutation** is now served by `PUT`/`DELETE` on the same path under existing `If-Match` concurrency, and a same-value save does not open a generation. Both rows are retained below with their disposition updated rather than deleted, so the direction and its resolution stay traceable.

The following existing contract/domain shapes are **debt** relative to that law and must be aligned at the appropriate contract stage—not treated as current product authority:

| Concept                                       | Current contract/domain presence                    | Alignment disposition                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ReminderMetadata` / `nextReminderAt`         | Task reminder stub                                  | **Replace** with Reminder Schedule / reminder attempt shapes (D104, D109). The `Task.reminder` JSON stub is not queryable and is not the schedule model                                                                                                                                                                                                                       |
| `RecipientReminderPreferences`                | Recipient stub (`emailEnabled`)                     | **Remove.** Recipient reminder preferences are explicitly excluded (D110); Follow-up Policy is Task-scoped and application-owned (D104)                                                                                                                                                                                                                                       |
| `FollowUpProposal` / `followUpProposal`       | Completion next-action payload                      | **Retain** wire/schema name during A8 as temporary contract naming debt. Canonical docs/product term: **Next-action Suggestion**. Do **not** rename OpenAPI in A8.0; breaking rename only under a later contract-versioning plan                                                                                                                                              |
| `proposedDueAt` on suggestions / proposals    | Present                                             | **Retain** as an **AI proposal** with no scheduling effect. It becomes authoritative only when the Owner explicitly selects it as the Task due date (D027, D102). Preserving proposal-versus-decision remains useful future learning provenance (D109)                                                                                                                        |
| Task / approve `dueAt`                        | Present                                             | **Retain** as the optional due date, with **changed semantics**: when Owner-selected it is the authoritative reminder scheduling input (D102). Align toward a local **calendar date** representation; `dueAt` stays temporarily for compatibility (D109). Not implemented                                                                                                     |
| `DerivedTaskUrgency` (`due_soon` / `overdue`) | Present                                             | **Retain** as derived labels, but **no longer display-only** (D098 superseded by D102). Labels must not themselves be the scheduling mechanism: occurrences are computed from the due date (D103)                                                                                                                                                                             |
| `POST …/snooze` / `SnoozeTaskRequest`         | Present                                             | Product law removed (D101). At A8 contract alignment **prefer remove** the endpoint (not a deprecated no-op), with contract-versioning / client migration. OpenAPI unchanged in A8.0                                                                                                                                                                                          |
| Task Reminder Schedule read shape             | **Implemented (A8.3b)** — `TaskReminderState`       | **Done.** Read-only schedule status on `GET /api/v1/tasks/{taskId}/reminder`: due date, timezone, generation, status, advance disposition, next overdue occurrence, per-generation delivered count, `requiresOwnerAttention`, stop reason (D104, D106). No preset field and no reminder-time field, as directed (D102, D103)                                                  |
| Reminder attempt history (read)               | Absent                                              | **Add** read-only processed-occurrence history with outcome and truthful skip/failure reason for the Owner surface and operator diagnosis (D100, D109). No capability token or URL may appear                                                                                                                                                                                 |
| Reminder processing endpoint (internal)       | Absent                                              | **Add** one authenticated internal endpoint following the existing `CRON_SECRET` bearer pattern (D079). Server-derived idempotency, so no request idempotency header. Aggregate counts only — no payloads or secrets in the response                                                                                                                                          |
| Event Notification resources                  | Absent                                              | **Add** as A8 event architecture is contracted (D099)                                                                                                                                                                                                                                                                                                                         |
| Event Notification processing / delivery      | Absent                                              | **Add** for A8 Owner email via connected Gmail (D099); push remains D017/A9                                                                                                                                                                                                                                                                                                   |
| Handoff body Phase 1 interval                 | Absent                                              | **Do not add.** Preset intervals are retired (D102); handoff confirms no interval. Reminders derive from the Task due date                                                                                                                                                                                                                                                    |
| Owner due-date mutation                       | **Implemented (A8.3b)** — `PUT`/`DELETE …/reminder` | **Done.** Setting or changing the canonical local due date creates or re-generates the Task-scoped schedule and removing it stops the schedule, both under existing `If-Match` concurrency (D045, D104). A same-value save against a live schedule opens no generation. Note the instant-typed `dueAt` on task update / approve is **unchanged** and still drives no reminder |
| Custom reminder create / edit / delete routes | Absent                                              | **Do not add in the first A8 slice** (D110). Deferred to a separately authorized future slice                                                                                                                                                                                                                                                                                 |

Owner-approved A8.1 dispositions (docs only): retain `FollowUpProposal` wire name during A8; prefer snooze **removal** at contract alignment; Owner Event Notifications by Gmail email (D099); **no** custom-reminder routes, **no** reminder-time field, **no** preset interval field in the first A8 slice (D110).
