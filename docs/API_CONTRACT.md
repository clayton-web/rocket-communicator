# API contract

Canonical HTTP contract for the AI Communication Action Assistant (Milestone A2).

**Source of truth:** `packages/contracts/openapi/` (multi-file OpenAPI 3.1) bundled to `packages/contracts/dist/openapi.bundled.yaml`.

Related: [STATE_MACHINE.md](STATE_MACHINE.md) · [DECISIONS.md](DECISIONS.md) (D007, D044–D064) · [ARCHITECTURE.md](ARCHITECTURE.md)

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

- `library=jvm-okhttp4` (OpenAPI Generator default JVM template)
- `serializationLibrary=moshi`
- `dateLibrary=string`, `serializableModel=true`

**Not generated:** API interfaces, Retrofit/OkHttp/Ktor clients, interceptors, or other networking runtime code.

**Runtime dependencies:** `:api-contract` compiles generated DTOs with `kotlin-stdlib` and `moshi-kotlin` (annotation/reflection support for generated `@JsonClass` models). **No** Retrofit, OkHttp client, or other HTTP stack is added.

**Deferred:** Android HTTP client choice remains undecided until a later networking milestone.

**Alternatives considered:** `jvm-retrofit2` produces identical model output in model-only mode but names a specific HTTP client; `multiplatform` adds `kotlinx-serialization` and `commonMain` layout complexity; `jvm-volley` fails on summary-point `oneOf` schemas in this contract.

## Base path

`/api/v1`

No health endpoint in A2.

## Authentication models

### Owner session (`bearerAuth` / Supabase SSR cookies)

- **Owner-only** authenticated routes (D048, D059).
- `GET /api/v1/session` returns the current Owner session shape when a valid Owner session exists (implemented in A3).
- `organizationId` comes from configured `OWNER_ORGANIZATION_ID`, not from the Google Workspace domain.
- `OWNER_WORKSPACE_DOMAIN` is used only to reject sign-in for non-permitted Google accounts.
- Owner task and suggestion mutations require a valid Owner session (handlers deferred to A4 runtime).
- Owner task routes **do not** accept capability tokens (separate surfaces — D059).
- No second application user role exists.

### Recipient capability (path `{token}` / `CapabilityToken`)

- Recipients have **no** application accounts (D049).
- Task-specific capability tokens authorize scoped Recipient actions (D050, D051).
- Capability routes are **separate** from Owner session routes (D059). Authorization is the capability path `{token}` (OpenAPI `CapabilityToken` parameter; routes set `security: []` because OpenAPI cannot model path-based apiKey schemes).
- Browser surface: `GET /c/[token]` is **strictly non-mutating** (safe for email prefetch) (D050, D059).
- **POST** mutations require explicit confirmation acknowledging the action (D050).
- Default expiry is seven days after issuance with required server TTL config and persisted `expiresAt` (D055).
- Tokens remain **multi-use** for permitted actions until expiry, revocation, assignment replacement/removal, or other terminal invalidation (D056). `CapabilityStatus.used` has **no A4 transition semantics**.
- Raw capability secret may be returned **once** to the authenticated Owner for manual verification; store only a hash; never log the raw secret (D063).
- Audit responses and records must not imply verified Recipient identity (D051, D052, D057).

## Endpoints

### Owner session routes

| Method | Path                                              | Purpose                                                   |
| ------ | ------------------------------------------------- | --------------------------------------------------------- |
| GET    | `/api/v1/session`                                 | Current Owner session shape (A3: Supabase Owner session)  |
| GET    | `/api/v1/task-suggestions`                        | List suggestions (cursor pagination)                      |
| GET    | `/api/v1/task-suggestions/{suggestionId}`         | Get suggestion                                            |
| POST   | `/api/v1/task-suggestions/{suggestionId}/approve` | Approve suggestion and assignment intent                  |
| POST   | `/api/v1/task-suggestions/{suggestionId}/edit`    | Edit pending suggestion                                   |
| POST   | `/api/v1/task-suggestions/{suggestionId}/dismiss` | Dismiss suggestion                                        |
| POST   | `/api/v1/task-suggestions/{suggestionId}/merge`   | Merge into existing task                                  |
| GET    | `/api/v1/tasks`                                   | List tasks                                                |
| POST   | `/api/v1/tasks`                                   | Owner typed task creation                                 |
| GET    | `/api/v1/tasks/{taskId}`                          | Get task                                                  |
| POST   | `/api/v1/tasks/{taskId}/start`                    | Start task                                                |
| POST   | `/api/v1/tasks/{taskId}/waiting`                  | Mark waiting (Owner session only)                         |
| POST   | `/api/v1/tasks/{taskId}/resume`                   | Resume from waiting (Owner session only)                  |
| POST   | `/api/v1/tasks/{taskId}/complete`                 | Complete task (Owner session only)                        |
| POST   | `/api/v1/tasks/{taskId}/notes`                    | Add note (Owner session only; typed)                      |
| POST   | `/api/v1/tasks/{taskId}/snooze`                   | Snooze reminders (Owner only — D060)                      |
| POST   | `/api/v1/tasks/{taskId}/dismiss`                  | Dismiss task (Owner only — D064; no physical delete)      |
| POST   | `/api/v1/tasks/{taskId}/return-to-owner`          | Return assignment to Owner (Owner session)                |
| POST   | `/api/v1/tasks/{taskId}/clarification-requests`   | Request clarification (Owner session; typed)              |
| POST   | `/api/v1/tasks/{taskId}/capabilities`             | Issue capability for current assignment (raw secret once) |

### Recipient capability routes (OpenAPI; A4 contracted)

| Method | Path                                                                 | Purpose                                              |
| ------ | -------------------------------------------------------------------- | ---------------------------------------------------- |
| GET    | `/api/v1/capabilities/{token}/tasks/{taskId}`                        | Non-mutating task view for Recipient                 |
| POST   | `/api/v1/capabilities/{token}/tasks/{taskId}/waiting`                | Mark waiting after explicit confirmation             |
| POST   | `/api/v1/capabilities/{token}/tasks/{taskId}/resume`                 | Resume waiting after explicit confirmation           |
| POST   | `/api/v1/capabilities/{token}/tasks/{taskId}/complete`               | Complete after explicit confirmation                 |
| POST   | `/api/v1/capabilities/{token}/tasks/{taskId}/notes`                  | Add typed note after explicit confirmation           |
| POST   | `/api/v1/capabilities/{token}/tasks/{taskId}/return-to-owner`        | Return to Owner after confirm                        |
| POST   | `/api/v1/capabilities/{token}/tasks/{taskId}/clarification-requests` | Request typed clarification after confirm            |
| POST   | `/api/v1/capabilities/{token}/tasks/{taskId}/work-requests`          | Submit work request → pending Task Suggestion (D061) |

Browser page `GET /c/[token]` is the human-facing non-mutating view; it must not change task, assignment, or capability state. Mutations are explicit POSTs under `/api/v1/capabilities/{token}/…` (or form posts targeting those APIs) after confirmation (D059).

Excluded from A4 runtime so far: Gmail, forwarding, voice upload, ingestion, workers, learning rules, health. Physical task deletion is forbidden (D064).

## Return-to-Owner path

- Owner route: `POST /api/v1/tasks/{taskId}/return-to-owner` (session auth).
- Recipient route: `POST /api/v1/capabilities/{token}/tasks/{taskId}/return-to-owner` (capability auth, POST after confirm).
- Both reassign the task to the Owner without creating a new Task.
- Task status is unchanged; only assignment ownership changes.

## Assignment approval semantics (D037)

`ApproveTaskSuggestionRequest` expresses **user intent** only:

- edited summary points (optional)
- selected assignee (Recipient)
- priority and due date
- `acknowledgement: assignment_approved`

It does **not** expose internal side-effect toggles. Future server logic derives task creation, assignment, reminder scheduling, capability link issuance, Gmail forwarding (Gmail sources), and standard assignment email (non-Gmail sources).

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

Capability mutations should also enforce `If-Match` where the Recipient view exposes current task version.

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

Codes: `VALIDATION_ERROR`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `INVALID_STATE_TRANSITION`, `PRECONDITION_REQUIRED`, `PRECONDITION_FAILED`, `DOMAIN_CONFLICT`, `RATE_LIMITED`, `CAPABILITY_EXPIRED`, `CAPABILITY_REVOKED`, `DEPENDENCY_UNAVAILABLE`, `INTERNAL_ERROR`.

## Pagination

Cursor pagination for list endpoints: `cursor`, `limit` (max 100), `items`, `nextCursor`.

## Summary points

Discriminated union on `kind` with structured variants. Maximum **20** points per task or suggestion. See OpenAPI `TaskSummaryPoint` schema.

## Source references

Neutral `SourceReference` schema supports future Gmail, Google Messages, call, manual, and voice origins without embedding secrets or full message bodies.
