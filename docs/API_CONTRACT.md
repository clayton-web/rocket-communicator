# API contract

**Source of truth:** `packages/contracts/openapi/` → bundled `packages/contracts/dist/openapi.bundled.yaml`.

Related: [STATE_MACHINE.md](STATE_MACHINE.md) · [SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md) · [DECISIONS.md](DECISIONS.md) (D007, D044–D047, D045, D059, D065–D085) · [GLOSSARY.md](GLOSSARY.md) · [MILESTONES.md](MILESTONES.md) · [DEPLOYMENT.md](DEPLOYMENT.md)

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
- Unknown, expired, revoked, and malformed tokens intentionally collapse to **401 `UNAUTHORIZED`**; wrong task binding → **404 `NOT_FOUND`**; insufficient scope → **403 `FORBIDDEN`**.

## Endpoints

### Owner session routes

**Status: implemented and production-verified (A3 + A4 baseline).**

| Method | Path              | Purpose               | Status              |
| ------ | ----------------- | --------------------- | ------------------- |
| GET    | `/api/v1/session` | Current Owner session | Production-verified |

### Owner task routes

**Status: implemented and production-verified (A4 — `A4_FULL_E2E_PASS`).**

| Method | Path                                            | Purpose                                                                       |
| ------ | ----------------------------------------------- | ----------------------------------------------------------------------------- |
| GET    | `/api/v1/tasks`                                 | List tasks (`updatedAt` DESC, `id` DESC; includes dismissed)                  |
| POST   | `/api/v1/tasks`                                 | Create typed task                                                             |
| GET    | `/api/v1/tasks/{taskId}`                        | Get task                                                                      |
| POST   | `/api/v1/tasks/{taskId}/start`                  | Start                                                                         |
| POST   | `/api/v1/tasks/{taskId}/waiting`                | Waiting                                                                       |
| POST   | `/api/v1/tasks/{taskId}/resume`                 | Resume                                                                        |
| POST   | `/api/v1/tasks/{taskId}/complete`               | Complete                                                                      |
| POST   | `/api/v1/tasks/{taskId}/notes`                  | Note                                                                          |
| POST   | `/api/v1/tasks/{taskId}/snooze`                 | Snooze (D060)                                                                 |
| POST   | `/api/v1/tasks/{taskId}/dismiss`                | Dismiss (D064)                                                                |
| POST   | `/api/v1/tasks/{taskId}/return-to-owner`        | Clear assignment to Owner                                                     |
| POST   | `/api/v1/tasks/{taskId}/clarification-requests` | Clarification                                                                 |
| POST   | `/api/v1/tasks/{taskId}/capabilities`           | Issue capability (raw once); active-link / scope / assignment conflicts → 409 |

### Owner task suggestion routes

**Status: contract-only / planned for A6** (OpenAPI aligned in A6.0; no `apps/web` handlers yet). Binding: D080–D085. See [MILESTONES.md](MILESTONES.md) A6.

| Method | Path                                              | Purpose                                   |
| ------ | ------------------------------------------------- | ----------------------------------------- |
| GET    | `/api/v1/task-suggestions`                        | List suggestions                          |
| GET    | `/api/v1/task-suggestions/{suggestionId}`         | Get suggestion                            |
| POST   | `/api/v1/task-suggestions/{suggestionId}/approve` | Approve → **unassigned Task** only (D080) |
| POST   | `/api/v1/task-suggestions/{suggestionId}/edit`    | Edit pending                              |
| POST   | `/api/v1/task-suggestions/{suggestionId}/dismiss` | Dismiss                                   |
| POST   | `/api/v1/task-suggestions/{suggestionId}/merge`   | Merge into task (dual If-Match, D083)     |

Recipient **work requests** in A4 create pending suggestions in persistence without these Owner review routes.

### Internal suggestion processing (A6.3)

**Status: implemented locally (A6.3); Production rollout and scheduler enablement deferred until after commit + verification.**

| Method | Path                                   | Purpose                                                              |
| ------ | -------------------------------------- | -------------------------------------------------------------------- |
| POST   | `/api/v1/internal/suggestions/process` | External Scheduler invocation (`InternalCronBearer` / `CRON_SECRET`) |

**POST only.** Empty body. Bounded batch with Hobby-safe soft time budget. Returns aggregate counts (`claimed`, `skippedIrrelevant`, `suggestionsCreated`, `failedRetryable`, `failedPermanent`, `requestId`). Lifecycle: claim/lease → deterministic heuristic → LLM extraction via `packages/ai` only for heuristic-pass events → at most one pending suggestion per event (D081, D085). Claim ordering prefers `unprocessed` over `failed_retryable` (then fewer attempts, then older `internalDate`) so retries cannot starve fresh events. No raw communication bodies, excerpts, prompts, or model payloads in responses. Failure audits may store privacy-safe diagnostic fingerprints (status, finish reason, top-level keys, schema issue codes) — never prompts, bodies, or model output text. Independent of Gmail History ingestion (D075, D084). Safe to invoke repeatedly. Global AI misconfiguration fails the invocation (or releases claims without permanently poisoning events).

**AI operational error codes (names only; stored on events/audits, not in HTTP aggregate body beyond counts):** `AI_MISSING_CREDENTIALS`, `AI_INVALID_CREDENTIALS`, `AI_DISABLED`, `AI_TIMEOUT`, `AI_RATE_LIMIT`, `AI_INSUFFICIENT_QUOTA`, `AI_PROVIDER_5XX`, `AI_NETWORK`, `AI_EMPTY_OUTPUT`, `AI_MALFORMED_JSON`, `AI_SCHEMA_INVALID`, `AI_INVALID_OUTPUT` (legacy umbrella), `AI_POLICY_REFUSAL`, `AI_UNSUPPORTED_RESPONSE`.

**Credentials (names only):** application auth uses `CRON_SECRET`. The External Scheduler management credential (for example cron-job.org’s API key env name `CRON_JOB_ORG_API_KEY`) is never stored in the repository and is not used by the application endpoint.

### Recipient capability routes and pages

**Status: implemented and production-verified (A4 — `A4_FULL_E2E_PASS`).**

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

### Owner Gmail routes (A5)

OAuth, History sync, and internal poll are **implemented and production-operational**. A5 is closed. Gmail settings UI and History recovery are deferred and do not block A6.

| Method | Path                           | Purpose                                                | Status                        |
| ------ | ------------------------------ | ------------------------------------------------------ | ----------------------------- |
| GET    | `/api/v1/gmail/connection`     | Safe connection status                                 | Production-operational (A5.3) |
| POST   | `/api/v1/gmail/oauth/start`    | Start OAuth redirect (`gmail.readonly`)                | Production-operational (A5.3) |
| GET    | `/api/v1/gmail/oauth/callback` | OAuth callback redirect (no tokens in query)           | Production-operational (A5.3) |
| POST   | `/api/v1/gmail/disconnect`     | Disconnect and wipe credential ciphertext              | Production-operational (A5.3) |
| POST   | `/api/v1/gmail/sync`           | Owner manual sync (initial + incremental)              | Production-operational (A5.4) |
| GET    | `/api/v1/gmail/sync-runs`      | Recent safe sync-run summaries                         | Production-operational (A5.4) |
| GET    | `/api/v1/internal/gmail/poll`  | External Scheduler invocation (`InternalCronBearer`)   | Production-operational (A5.5) |
| POST   | `/api/v1/internal/gmail/poll`  | Operator / scheduler invocation (`InternalCronBearer`) | Production-operational (A5.5) |

Public Gmail DTOs never include refresh/access tokens, ciphertext, encryption key versions, OAuth codes, or PKCE secrets. Internal poll uses `InternalCronBearer` (configured `CRON_SECRET`), not Owner session and not public unauthenticated access. The application owns the Application Polling Engine; the scheduler is external (D079). GET on the internal Gmail poll route is a **secret-authenticated scheduler exception** for hosts whose schedulers prefer GET (e.g. Vercel Cron)—do not copy this pattern to public Recipient routes (D050). Preferred initial production adapter is HTTP **POST** from **cron-job.org** (or any compatible External Scheduler) every five minutes. External Scheduler invocations never initialize History cursors; Owner manual sync must seed first. A5 does **not** expose communication-event list/browser endpoints (D073).

## Suggestion approval semantics (D080)

`ApproveTaskSuggestionRequest` requires `acknowledgement: suggestion_approved`. Optional `summaryPoints`, `priority`, and `dueAt` may refine the created **unassigned Task**.

**A6 server behaviour:**

- Create unassigned Task from the suggestion.
- Do **not** create TaskAssignment, issue Capability, send assignment email, Gmail-forward, or schedule reminders.
- If `recipientId` is present → HTTP **400** with error code **`RECIPIENT_HANDOFF_NOT_AVAILABLE`**.
- Recipient handoff remains **A7** under D037.

`assignment_approved` is **removed** from the contract (never relied upon by shipped handlers).

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

Public mapping for `/api/v1/capabilities/{token}/…` (internal expiry/revocation categories are never public ErrorCodes):

| Condition                                                      | HTTP | Public `ErrorCode`      |
| -------------------------------------------------------------- | ---- | ----------------------- |
| Unknown, malformed, expired, or revoked token                  | 401  | `UNAUTHORIZED`          |
| Valid token lacking required action scope                      | 403  | `FORBIDDEN`             |
| Valid token used against the wrong task/resource               | 404  | `NOT_FOUND`             |
| Valid token; mutation conflicts with task state / domain rules | 409  | `DOMAIN_CONFLICT`       |
| Invalid body or missing/invalid confirmation                   | 400  | `VALIDATION_ERROR`      |
| Missing `If-Match`                                             | 428  | `PRECONDITION_REQUIRED` |
| Malformed, task-mismatched, or stale `If-Match`                | 412  | `PRECONDITION_FAILED`   |

Unknown / revoked / expired / malformed tokens intentionally collapse to **401 `UNAUTHORIZED`** so clients cannot distinguish token existence or lifecycle state.

## Errors and pagination

Envelope: `{ "error": { "code", "message", "details?", "requestId", "correlationId?" } }`.

Public codes: `VALIDATION_ERROR`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `INVALID_STATE_TRANSITION`, `PRECONDITION_REQUIRED`, `PRECONDITION_FAILED`, `DOMAIN_CONFLICT`, `RATE_LIMITED`, `DEPENDENCY_UNAVAILABLE`, `INTERNAL_ERROR`.

Lists: cursor pagination (`cursor`, `limit` ≤ 100, `items`, `nextCursor`).

**`GET /api/v1/tasks`:** Ordered by `updatedAt` descending, then `id` descending. The opaque cursor encodes that composite order. All statuses are returned, including `dismissed`; excluding dismissed (or filtering by status) requires a future contracted query parameter—none exists today.

Summary points: OpenAPI `TaskSummaryPoint` discriminated union; max 20 per resource. `SourceReference` is origin metadata without secrets or full bodies.
