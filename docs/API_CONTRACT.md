# API contract

**Source of truth:** `packages/contracts/openapi/` → bundled `packages/contracts/dist/openapi.bundled.yaml`.

Related: [STATE_MACHINE.md](STATE_MACHINE.md) · [SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md) · [DECISIONS.md](DECISIONS.md) (D007, D044–D047, D045, D059) · [GLOSSARY.md](GLOSSARY.md)

## Ownership

| Layer                 | Owns                                               |
| --------------------- | -------------------------------------------------- |
| OpenAPI               | Wire paths, DTOs, enums, errors, pagination, ETags |
| `packages/domain`     | Transition and capability policy                   |
| Generated TS / Kotlin | Transport DTOs only                                |

Handlers map domain ↔ DTO explicitly (D046). Domain types are not generated DTOs.

## Tooling and generation

| Tool                                  | Version                   | Purpose            |
| ------------------------------------- | ------------------------- | ------------------ |
| `@redocly/cli`                        | 1.34.3                    | Lint and bundle    |
| `openapi-typescript`                  | 7.6.1                     | TypeScript DTOs    |
| `@openapitools/openapi-generator-cli` | 2.18.4 (generator 7.12.0) | Kotlin models only |

Committed outputs; `pnpm contracts:generate` / `contracts:check-drift` (D044).

Kotlin (D047): model-only (`apis=false`, `supportingFiles=false`); `library=jvm-okhttp4`; `serializationLibrary=moshi`; no HTTP client runtime. Android networking client deferred.

## Base path

`/api/v1`

## Authentication models

Owner Session vs Recipient Capability: [SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md).

- Owner routes: `bearerAuth` / Supabase SSR cookies. `organizationId` from `OWNER_ORGANIZATION_ID`; `OWNER_WORKSPACE_DOMAIN` gates sign-in only.
- Capability routes: path `{token}` (`CapabilityToken`). OpenAPI `security: []` because path apiKeys cannot be expressed. Browser `GET /c/[token]` is non-mutating; mutations are POST after confirm.

## Endpoints

### Owner session routes

| Method | Path                                              | Purpose                       |
| ------ | ------------------------------------------------- | ----------------------------- |
| GET    | `/api/v1/session`                                 | Current Owner session (A3)    |
| GET    | `/api/v1/task-suggestions`                        | List suggestions              |
| GET    | `/api/v1/task-suggestions/{suggestionId}`         | Get suggestion                |
| POST   | `/api/v1/task-suggestions/{suggestionId}/approve` | Approve (+ assignment intent) |
| POST   | `/api/v1/task-suggestions/{suggestionId}/edit`    | Edit pending                  |
| POST   | `/api/v1/task-suggestions/{suggestionId}/dismiss` | Dismiss                       |
| POST   | `/api/v1/task-suggestions/{suggestionId}/merge`   | Merge into task               |
| GET    | `/api/v1/tasks`                                   | List tasks                    |
| POST   | `/api/v1/tasks`                                   | Create typed task             |
| GET    | `/api/v1/tasks/{taskId}`                          | Get task                      |
| POST   | `/api/v1/tasks/{taskId}/start`                    | Start                         |
| POST   | `/api/v1/tasks/{taskId}/waiting`                  | Waiting                       |
| POST   | `/api/v1/tasks/{taskId}/resume`                   | Resume                        |
| POST   | `/api/v1/tasks/{taskId}/complete`                 | Complete                      |
| POST   | `/api/v1/tasks/{taskId}/notes`                    | Note                          |
| POST   | `/api/v1/tasks/{taskId}/snooze`                   | Snooze (D060)                 |
| POST   | `/api/v1/tasks/{taskId}/dismiss`                  | Dismiss (D064)                |
| POST   | `/api/v1/tasks/{taskId}/return-to-owner`          | Clear assignment to Owner     |
| POST   | `/api/v1/tasks/{taskId}/clarification-requests`   | Clarification                 |
| POST   | `/api/v1/tasks/{taskId}/capabilities`             | Issue capability (raw once)   |

### Recipient capability routes

| Method | Path                                                                 | Purpose                          |
| ------ | -------------------------------------------------------------------- | -------------------------------- |
| GET    | `/api/v1/capabilities/{token}/tasks/{taskId}`                        | Non-mutating view                |
| POST   | `/api/v1/capabilities/{token}/tasks/{taskId}/waiting`                | Waiting                          |
| POST   | `/api/v1/capabilities/{token}/tasks/{taskId}/resume`                 | Resume                           |
| POST   | `/api/v1/capabilities/{token}/tasks/{taskId}/complete`               | Complete                         |
| POST   | `/api/v1/capabilities/{token}/tasks/{taskId}/notes`                  | Note                             |
| POST   | `/api/v1/capabilities/{token}/tasks/{taskId}/return-to-owner`        | Return to Owner                  |
| POST   | `/api/v1/capabilities/{token}/tasks/{taskId}/clarification-requests` | Clarification                    |
| POST   | `/api/v1/capabilities/{token}/tasks/{taskId}/work-requests`          | Work request → Suggestion (D061) |

Return-to-Owner (either surface) clears assignment ownership; Task status unchanged.

## Assignment approval request semantics (D037)

`ApproveTaskSuggestionRequest` records Owner intent (summary, Recipient, priority/due, `acknowledgement: assignment_approved`). It does not expose internal side-effect toggles. Server derives task creation, assignment, reminders, capability issuance, and Gmail forward/email as applicable.

## Concurrency (D045)

Mutable Task / TaskSuggestion: integer `version` and strong `etag`. Mutations require `If-Match`.

| Condition          | HTTP | Code                    |
| ------------------ | ---- | ----------------------- |
| Missing `If-Match` | 428  | `PRECONDITION_REQUIRED` |
| Stale `If-Match`   | 412  | `PRECONDITION_FAILED`   |
| Domain conflict    | 409  | `DOMAIN_CONFLICT`       |

## Errors and pagination

Envelope: `{ "error": { "code", "message", "details?", "requestId", "correlationId?" } }`.

Codes: `VALIDATION_ERROR`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `INVALID_STATE_TRANSITION`, `PRECONDITION_REQUIRED`, `PRECONDITION_FAILED`, `DOMAIN_CONFLICT`, `RATE_LIMITED`, `CAPABILITY_EXPIRED`, `CAPABILITY_REVOKED`, `DEPENDENCY_UNAVAILABLE`, `INTERNAL_ERROR`.

Lists: cursor pagination (`cursor`, `limit` ≤ 100, `items`, `nextCursor`).

Summary points: OpenAPI `TaskSummaryPoint` discriminated union; max 20 per resource. `SourceReference` is origin metadata without secrets or full bodies.
