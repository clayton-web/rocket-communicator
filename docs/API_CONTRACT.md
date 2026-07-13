# API contract

Canonical HTTP contract for the AI Communication Action Assistant (Milestone A2).

**Source of truth:** `packages/contracts/openapi/` (multi-file OpenAPI 3.1) bundled to `packages/contracts/dist/openapi.bundled.yaml`.

Related: [STATE_MACHINE.md](STATE_MACHINE.md) · [DECISIONS.md](DECISIONS.md) (D007, D044–D047) · [ARCHITECTURE.md](ARCHITECTURE.md)

---

## Ownership

| Layer                                                    | Owns                                                                                                  |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| OpenAPI                                                  | Wire paths, request/response DTOs, enums exposed to clients, error envelope, pagination, ETag headers |
| `packages/domain`                                        | State transition rules, capability policy, retention/reminder calculations                            |
| Generated TS (`packages/contracts/generated/typescript`) | Transport DTO types for web and tests                                                                 |
| Generated Kotlin (`packages/contracts/generated/kotlin`) | Transport DTO models for Android (`:api-contract`)                                                    |

Domain types are **not** generated DTOs. Future API handlers map between them explicitly (D046).

## Generated code policy (D044)

- TypeScript and Kotlin DTO outputs are **committed**.
- `pnpm contracts:generate` must reproduce committed output.
- `pnpm contracts:check-drift` fails CI on mismatch.

## Tooling

| Tool                                  | Version                   | Purpose                      |
| ------------------------------------- | ------------------------- | ---------------------------- |
| `@redocly/cli`                        | 1.34.3                    | Lint and bundle              |
| `openapi-typescript`                  | 7.6.1                     | TypeScript DTO generation    |
| `@openapitools/openapi-generator-cli` | 2.18.4 (generator 7.12.0) | Kotlin model generation only |

## Kotlin model generation (D047)

OpenAPI Generator 7.12.0 does not expose a separate transport-neutral Kotlin generator target. With model-only flags (`apis=false`, `apiTests=false`, `supportingFiles=false`), the `library` option selects JVM model templates only.

**Configuration:**

- `library=jvm-okhttp4` (OpenAPI Generator default JVM Kotlin template)
- `serializationLibrary=moshi`
- `dateLibrary=string`, `serializableModel=true`

**Not generated:** API interfaces, Retrofit/OkHttp/Ktor clients, interceptors, or other networking runtime code.

**Runtime dependencies:** `:api-contract` compiles generated DTOs with `kotlin-stdlib` and `moshi-kotlin` (annotation/reflection support for generated `@JsonClass` models). **No** Retrofit, OkHttp client, or other HTTP stack is added.

**Deferred:** Android HTTP client choice remains undecided until a later networking milestone.

**Alternatives considered:** `jvm-retrofit2` produces identical model output in model-only mode but names a specific HTTP client; `multiplatform` adds `kotlinx-serialization` and `commonMain` layout complexity; `jvm-volley` fails on summary-point `oneOf` schemas in this contract.

## Base path

`/api/v1`

No health endpoint in A2.

## Endpoints

| Method | Path                                              | Purpose                                                    |
| ------ | ------------------------------------------------- | ---------------------------------------------------------- |
| GET    | `/api/v1/session`                                 | Current actor session shape (no auth implementation in A2) |
| GET    | `/api/v1/task-suggestions`                        | List suggestions (cursor pagination)                       |
| GET    | `/api/v1/task-suggestions/{suggestionId}`         | Get suggestion                                             |
| POST   | `/api/v1/task-suggestions/{suggestionId}/approve` | Approve suggestion and assignment intent                   |
| POST   | `/api/v1/task-suggestions/{suggestionId}/edit`    | Edit pending suggestion                                    |
| POST   | `/api/v1/task-suggestions/{suggestionId}/dismiss` | Dismiss suggestion                                         |
| POST   | `/api/v1/task-suggestions/{suggestionId}/merge`   | Merge into existing task                                   |
| GET    | `/api/v1/tasks`                                   | List tasks                                                 |
| POST   | `/api/v1/tasks`                                   | Primary typed task creation                                |
| GET    | `/api/v1/tasks/{taskId}`                          | Get task                                                   |
| POST   | `/api/v1/tasks/{taskId}/start`                    | Start task                                                 |
| POST   | `/api/v1/tasks/{taskId}/waiting`                  | Mark waiting                                               |
| POST   | `/api/v1/tasks/{taskId}/resume`                   | Resume from waiting                                        |
| POST   | `/api/v1/tasks/{taskId}/complete`                 | Complete task (one-tap supported)                          |
| POST   | `/api/v1/tasks/{taskId}/notes`                    | Add note                                                   |
| POST   | `/api/v1/tasks/{taskId}/return-to-primary`        | Return assignment to primary                               |
| POST   | `/api/v1/tasks/{taskId}/clarification-requests`   | Request clarification                                      |

Excluded from A2: Gmail, forwarding, voice upload, ingestion, workers, learning rules, health.

## Assignment approval semantics (D037)

`ApproveTaskSuggestionRequest` expresses **user intent** only:

- edited summary points (optional)
- selected assignee
- priority and due date
- `acknowledgement: assignment_approved`

It does **not** expose internal side-effect toggles. Future server logic derives task creation, assignment, reminder scheduling, Gmail forwarding (Gmail sources), and standard assignment email (non-Gmail sources).

## Concurrency (D045)

Mutable `Task` and `TaskSuggestion` resources include:

- monotonic integer `version` (initial `1`)
- strong `etag` such as `"task-task_01JEXAMPLE-v3"`

Mutations require `If-Match` with the strong ETag.

| Condition          | HTTP | Code                    |
| ------------------ | ---- | ----------------------- |
| Missing `If-Match` | 428  | `PRECONDITION_REQUIRED` |
| Stale `If-Match`   | 412  | `PRECONDITION_FAILED`   |
| Domain conflict    | 409  | `DOMAIN_CONFLICT`       |

## Error envelope

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "User-safe message",
    "details": [{ "field": "summaryPoints", "message": "..." }],
    "requestId": "uuid",
    "correlationId": null
  }
}
```

Codes: `VALIDATION_ERROR`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `INVALID_STATE_TRANSITION`, `PRECONDITION_REQUIRED`, `PRECONDITION_FAILED`, `DOMAIN_CONFLICT`, `RATE_LIMITED`, `DEPENDENCY_UNAVAILABLE`, `INTERNAL_ERROR`.

## Pagination

Cursor pagination for list endpoints: `cursor`, `limit` (max 100), `items`, `nextCursor`.

## Summary points

Discriminated union on `kind` with structured variants. Maximum **20** points per task or suggestion. See OpenAPI `TaskSummaryPoint` schema.

## Source references

Neutral `SourceReference` schema supports future Gmail, Google Messages, call, manual, and voice origins without embedding secrets or full message bodies.
