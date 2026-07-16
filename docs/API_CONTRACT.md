# API contract

**Source of truth:** `packages/contracts/openapi/` → bundled `packages/contracts/dist/openapi.bundled.yaml`.

Related: [STATE_MACHINE.md](STATE_MACHINE.md) · [SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md) · [DECISIONS.md](DECISIONS.md) (D007, D044–D047, D045, D059) · [GLOSSARY.md](GLOSSARY.md) · [MILESTONES.md](MILESTONES.md) · [DEPLOYMENT.md](DEPLOYMENT.md)

## Ownership

| Layer                 | Owns                                               |
| --------------------- | -------------------------------------------------- |
| OpenAPI               | Wire paths, DTOs, enums, errors, pagination, ETags |
| `packages/domain`     | Transition and capability policy                   |
| Generated TS / Kotlin | Transport DTOs only                                |

Handlers map domain ↔ DTO explicitly (D046). Domain types are not generated DTOs.

## Implementation status (HTTP)

Use this table with [MILESTONES.md](MILESTONES.md). OpenAPI may describe future routes before handlers ship.

| Status                                              | Meaning                                                                                   |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| **Implemented and production-verified**             | Handler exists in `apps/web`; included in **`A4_FULL_E2E_PASS`** production verification. |
| **Implemented, not separately production-verified** | Handler exists; not individually called out in the A4 E2E report.                         |
| **Contract-only / planned**                         | OpenAPI + domain types exist; **no** `apps/web` route yet. Target milestone noted.        |
| **Future milestone**                                | Product behaviour defined; not in current codebase.                                       |

## Tooling and generation

| Tool                                  | Version                   | Purpose            |
| ------------------------------------- | ------------------------- | ------------------ |
| `@redocly/cli`                        | 1.34.3                    | Lint and bundle    |
| `openapi-typescript`                  | 7.6.1                     | TypeScript DTOs    |
| `@openapitools/openapi-generator-cli` | 2.18.4 (generator 7.12.0) | Kotlin models only |

Committed outputs; `pnpm contracts:generate` / `contracts:check-drift` (D044). Kotlin generation removes stale orphans via `cleanup-kotlin-orphans.mjs`.

Kotlin (D047): model-only (`apis=false`, `supportingFiles=false`); `library=jvm-okhttp4`; `serializationLibrary=moshi`; no HTTP client runtime. Android networking client deferred.

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

**Status: contract-only / planned for A6** (OpenAPI + domain; no `apps/web` handlers yet). See [MILESTONES.md](MILESTONES.md) A6.

| Method | Path                                              | Purpose                       |
| ------ | ------------------------------------------------- | ----------------------------- |
| GET    | `/api/v1/task-suggestions`                        | List suggestions              |
| GET    | `/api/v1/task-suggestions/{suggestionId}`         | Get suggestion                |
| POST   | `/api/v1/task-suggestions/{suggestionId}/approve` | Approve (+ assignment intent) |
| POST   | `/api/v1/task-suggestions/{suggestionId}/edit`    | Edit pending                  |
| POST   | `/api/v1/task-suggestions/{suggestionId}/dismiss` | Dismiss                       |
| POST   | `/api/v1/task-suggestions/{suggestionId}/merge`   | Merge into task               |

Recipient **work requests** in A4 create pending suggestions in persistence without these Owner review routes.

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

OAuth connection routes are implemented in A5.3. Sync, poll, and ingestion remain pending. Production migration and live Gmail credentials are not configured in this chunk.

| Method | Path                           | Purpose                                        | Status                                                                  |
| ------ | ------------------------------ | ---------------------------------------------- | ----------------------------------------------------------------------- |
| GET    | `/api/v1/gmail/connection`     | Safe connection status                         | Implemented (A5.3)                                                      |
| POST   | `/api/v1/gmail/oauth/start`    | Start OAuth redirect (`gmail.readonly`)        | Implemented (A5.3)                                                      |
| GET    | `/api/v1/gmail/oauth/callback` | OAuth callback redirect (no tokens in query)   | Implemented (A5.3)                                                      |
| POST   | `/api/v1/gmail/disconnect`     | Disconnect and wipe credential ciphertext      | Implemented (A5.3)                                                      |
| POST   | `/api/v1/gmail/sync`           | Owner manual sync                              | Contract defined; persistence foundation implemented; HTTP pending      |
| GET    | `/api/v1/gmail/sync-runs`      | Recent safe sync-run summaries                 | Contract defined; persistence foundation implemented; HTTP pending      |
| POST   | `/api/v1/internal/gmail/poll`  | Cron poll (`InternalCronBearer`; system audit) | Contract defined; persistence foundation implemented; HTTP/cron pending |

Public Gmail DTOs never include refresh/access tokens, ciphertext, encryption key versions, OAuth codes, or PKCE secrets. Internal poll uses `InternalCronBearer` (configured CRON_SECRET), not Owner session and not public unauthenticated access. A5 does **not** expose communication-event list/browser endpoints (D073).

## Assignment approval request semantics (D037)

`ApproveTaskSuggestionRequest` records Owner intent (summary, Recipient, priority/due, `acknowledgement: assignment_approved`). It does not expose internal side-effect toggles. Server derives task creation, assignment, reminders, capability issuance, and Gmail forward/email as applicable. **Future milestone:** A6/A7 handlers.

## Concurrency (D045)

Mutable Task / TaskSuggestion: integer `version` and strong `etag`. Mutations require `If-Match`.

| Condition          | HTTP | Code                    |
| ------------------ | ---- | ----------------------- |
| Missing `If-Match` | 428  | `PRECONDITION_REQUIRED` |
| Stale `If-Match`   | 412  | `PRECONDITION_FAILED`   |
| Domain conflict    | 409  | `DOMAIN_CONFLICT`       |

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
