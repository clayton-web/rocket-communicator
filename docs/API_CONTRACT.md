# API contract

**Source of truth:** `packages/contracts/openapi/` → bundled `packages/contracts/dist/openapi.bundled.yaml`.

Related: [ARCHITECTURE.md](ARCHITECTURE.md) · [SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md) · [DECISIONS.md](DECISIONS.md) (D007, D044–D047, D045, D059, D065–D101) · [GLOSSARY.md](GLOSSARY.md) · [MILESTONES.md](MILESTONES.md) · [DEPLOYMENT.md](DEPLOYMENT.md)

**A8 product law** (due-date-driven Follow-up Engine / Event Notification Engine, **D102–D110**, superseding parts of D095–D101) is documentation-locked. **A8.3b contracted the Owner reminder surface only** — see [Owner reminder schedule (A8.3b)](#owner-reminder-schedule-a83b) below. Everything else in A8 remains uncontracted: there is no reminder worker or processing endpoint, no attempt-history route, no Event Notification resource, and no Recipient-facing reminder surface. OpenAPI still contains historical reminder/snooze stubs—see **Future A8 contract alignment inventory** below. Do **not** treat those stubs as A8 product law.

The official product name is **Rocket Communicator** (**D120** closed; product law **D153**). OpenAPI `info.title` and other shipped artifact strings may still carry the original working name as **repository provenance** until a separately authorized rename.

**No health or readiness endpoint** is in the contract (D115); a contract test asserts `/health` is absent. Correlation uses the existing `ErrorResponse` / `AuditEvent` `requestId` / `correlationId` envelope — no separate health contract.

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

Kotlin (D047): model-only (`apis=false`, `supportingFiles=false`); `library=jvm-okhttp4`; `serializationLibrary=moshi`; no HTTP client runtime. **A9.1 (D148):** Android uses a hand-written OkHttp networking foundation in `apps/android` (`OwnerApiExecutor` / `OwnerApiRepository`) that consumes generated models only — still no generated HTTP client.

**Known Kotlin generator anomaly (openapi-generator 7.14.0, non-blocking):** after the S3.2 schema additions, generated `Recipient` extends `HashMap<String, Any>` rather than remaining a plain data class. Authored OpenAPI remains semantically correct (`additionalProperties: false`). Canonical verification including Android `api-contract` compilation is green; Android does not consume generated `Recipient` at runtime. Do not upgrade the generator, reorder schemas, weaken `additionalProperties: false`, or hand-edit generated artifacts to hide it. Future contract work should remain alert because the positional defect may move to another model. Recorded in D171; not an S3 completion blocker.

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
- **A9.0 / D145:** One shared Owner authentication pipeline. Credential extraction prefers `Authorization: Bearer <supabase_access_jwt>` when present; otherwise the existing SSR cookie session is used. Both paths call the same server-verified Supabase `getUser()` + workspace allowlist + org binding. Owner JWTs never authorize internal cron routes (`InternalCronBearer` / `CRON_SECRET`).
- **Canonical API probe:** `GET /api/v1/session` confirms authenticated API access, workspace validation, organization resolution, and role resolution after Supabase has established identity. Native Android clients use Bearer JWT (D146); the browser continues to use SSR cookies.
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

**Status: implemented and production-verified (A3 + A4 baseline).** **A9.0:** Bearer JWT accepted through the shared Owner pipeline (D145); remains the canonical authenticated API probe for Android.

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

**`POST /api/v1/tasks` still exists** as the direct-create Task endpoint (D154). Web still uses it. The Android A9.2 direct-create implementation remains in source but is **unused from Owner Capture** after S3.3. The product target is AI-first interpretation → proposal review → Owner decision → canonical Task. **D169** authorizes controlled S3 backend machinery for that target (S3.1 first) but does **not** authorize changing, removing, or replacing this endpoint. **D170** authorizes a separate Owner manual-capture route `POST /api/v1/manual-captures` (S3.2), **now implemented**, without replacing this direct-create endpoint. **D171** authorized Android to stop calling this endpoint for manual Owner capture, and S3.3 has switched that flow; the endpoint itself is unchanged, and D171 does **not** authorize removing or modifying it. Creating an unassigned Task through this endpoint records no responsibility selection and is not evidence of one (**D164**, D155).

### Owner manual capture (S3.2 / D170; Android client authorized by D171)

**Status: implemented in `apps/web` and reached by Android Capture (S3.3); not activated in Production.** S3 for Owner manual capture is **complete** at this locked capture-to-proposal boundary. Handlers exist and are contract-tested, but interpretation stays default closed: without `INTERPRETATION_AI_ENABLED` the route answers `503 DEPENDENCY_UNAVAILABLE`, and enabling that flag is a separate authorization. `operationId`: `createManualCapture`. **D171** authorizes the Android Owner client to call this route for S3.3 capture-to-proposal, and that client is **implemented**: Android manual capture posts here and renders the returned proposals read-only. Full proposal-lifecycle UI remains unauthorized and unimplemented.

| Method | Path                      | Purpose                                                                   |
| ------ | ------------------------- | ------------------------------------------------------------------------- |
| POST   | `/api/v1/manual-captures` | Interpret Owner capture text into 0..N proposals (S3.2; D169, D170, D171) |

This is the sole Owner-initiated interpretation HTTP surface. It is **not** a generic `/interpretations` endpoint: the server fixes provenance to `owner_manual_capture`; clients do not choose Gmail/SMS source, and no such field is accepted. Organization scope comes from trusted Owner authentication — never from the body. Capability/Recipient auth is invalid for this route. Required `Idempotency-Key` reuses the existing parameter contract.

Request body (`CreateManualCaptureRequest`, `additionalProperties: false`) is only `rawInput` (non-empty, max **4000** characters, rejected at the HTTP boundary rather than truncated), required `capturedAt` (ISO-8601 with explicit offset; client-owned; never the server clock; no recency window), and optional nullable `timezone`.

Success is HTTP **200** with `{ idempotentReplay, interpretedAt, taskSuggestions }` reusing the canonical public `TaskSuggestion` schema — covering first success, exact replay, and truthful zero-proposal `taskSuggestions: []` alike. Neither 201 nor 204 is used. Exact S3.1 replay semantics apply at the HTTP boundary: a replay is answered from committed canonical state with `idempotentReplay: true`, the original proposal set, and the original `interpretedAt`, without calling the provider again.

Errors reuse the existing `ErrorResponse` / `ErrorCode` contract with fixed, non-sensitive messages: **400** `VALIDATION_ERROR` (malformed JSON, unsupported body fields, missing/empty/oversized `rawInput`, missing or zone-less `capturedAt`, malformed or oversized key), **401** `UNAUTHORIZED`, **409** `IDEMPOTENCY_KEY_CONFLICT` (same organization and key, different request) or `DOMAIN_CONFLICT` (persistence conflict unrelated to this occurrence's idempotency), **415** `VALIDATION_ERROR`, **428** `PRECONDITION_REQUIRED` (missing `Idempotency-Key`), **503** `DEPENDENCY_UNAVAILABLE` (disabled or missing provider configuration, network/timeout/provider 5xx, quota, and retryable invalid provider output — all reported alike so the response reveals nothing about deployment configuration), and **500** `INTERNAL_ERROR` (permanent provider or unmapped failure).

Public responses expose no `interpretationRunId`, InterpretationRun row id, request fingerprint, persisted idempotency key, model or policy version, or raw-input echo. Raw capture text is transient on the server: it is not persisted, creates no CommunicationEvent or TemporaryCommunicationExcerpt, is not returned in validation details, and is not logged. **D171** separately authorizes encrypted Owner-device pending-capture retry state (maximum 24 hours) for exact Android retry/recovery, now implemented; that device record is not server retention, and the Android client persists no proposal payload. The route creates no canonical Task, approves nothing, records no responsibility selection, and writes no TaskAssignment. Full Android proposal-lifecycle UI remains unauthorized and unimplemented; S3.3 authorizes only read-only display of proposals returned by this route.

Reminder schedule management lives on a sub-resource of the same Task and is documented separately below: `GET`/`PUT`/`DELETE /api/v1/tasks/{taskId}/reminder` (A8.3b). It uses its own `task-reminder` ETag rather than the Task's, because reminder writes do not bump `Task.version`.

### Owner reminder schedule (A8.3b)

**Status: implemented and functional in Production.** Handlers exist in `apps/web`; the A8.3a migration was applied on 2026-08-04 and the reminder ETag packaging defect was fixed on 2026-08-05, so all three routes now work against a real Task. **The Owner must not create or modify a reminder until the later A8 rollout is authorized** — no flag enforces that restraint, because these surfaces carry none. Binding: D102–D107, D109, D128. `operationId`s: `getTaskReminder`, `setTaskReminder`, `removeTaskReminder`.

| Method | Path                              | Purpose                                                                           |
| ------ | --------------------------------- | --------------------------------------------------------------------------------- |
| GET    | `/api/v1/tasks/{taskId}/reminder` | Read reminder state and obtain the reminder `ETag` (no `If-Match`)                |
| PUT    | `/api/v1/tasks/{taskId}/reminder` | Establish or materially change the canonical local due date (reminder `If-Match`) |
| DELETE | `/api/v1/tasks/{taskId}/reminder` | Remove the due date and stop the schedule (reminder `If-Match`)                   |

**Every response is `Cache-Control: no-store`**, including 400, 401, 404, 409, 412, 428, and 500. Reminder state has its own ETag but changes without bumping `Task.version`, so a cached reminder response could outlive the schedule it describes.

**Request surface is exactly one field.** `SetTaskReminderRequest` carries only `dueLocalDate`, a canonical `YYYY-MM-DD` organization-local calendar date. There is no reminder-time field (09:00 is a constant, D103), no preset interval (retired, D102), no recurrence, and no timezone field — the scheduling timezone is derived from organization configuration, not chosen by the Owner. The validator is an **allowlist**: any other top-level property, any nested object, and every server-derived field is rejected with `400 VALIDATION_ERROR`. Unknown fields are **not** ignored, matching the schema's `additionalProperties: false`. Duplicate JSON keys follow standard last-wins parsing and need no special handling.

**Response is a read-only projection.** `TaskReminderState` returns `taskId`, `etag`, `dueLocalDate`, `schedulingTimeZone`, `state`, `generation`, `advance`, `nextOverdueOccurrence`, `overdueDeliveredCount`, `requiresOwnerAttention`, and `stopReason`. `state` distinguishes `no_due_date`, `not_scheduled`, `active`, `suspended_waiting`, and `stopped`, and is authoritative for whether anything will be sent; `advance` and `nextOverdueOccurrence` are the generation's recorded decisions and become history once `state` is `stopped`. Local calendar dates are canonical `YYYY-MM-DD` text and instants are ISO-8601 UTC; the local date is never reconstructed from `dueAt`.

**Worker internals are deliberately absent** from the response: no claim lease, worker identifier, provider message identifier, raw delivery-failure detail, delivery-attempt row, database row identifier, or raw reminder version. Those stay free to change without a contract break, and a contract test asserts their absence.

**`overdueDeliveredCount` is 0 in every deployed environment because delivery is disabled, not because nothing can increment it.** The `GET` description said the latter through A8.3b, when it was true: the API existed and nothing scheduled, claimed, sent, or retried a reminder. A8.4b added the worker that does all four and counts each delivery, so the field now reports real deliveries wherever delivery is enabled. Nowhere is: `ENABLE_REMINDER_DELIVERY` is unset in every environment and no scheduler invokes the worker (D108). A8.6a corrected the description; **no schema or behaviour changed**.

**Concurrency uses a reminder ETag, not the Task's.** `GET` returns a strong `task-reminder` ETag in both the `ETag` header and the body's `etag` field; `PUT` and `DELETE` require it as `If-Match`, and a _Task_ ETag presented there is rejected with 412. The reason is that a reminder write deliberately does not bump `Task.version` — the due date is not part of the Task contract — so a Task ETag stays valid across a reminder change it cannot describe, and two Owners could each hold a "current" token for a schedule only one of them had read. A Task with no schedule has the stable token `"task-reminder-{taskId}-v0"`; a schedule's first version is `1`.

**The reminder ETag is a mutation precondition for Owner-controlled configuration and lifecycle state — not a validator for the whole representation.** It covers the Task identity, the canonical due date or its absence, schedule existence, generation, and schedule status, together with the persisted reminder version that distinguishes removal, reactivation, suspension, resume, and stop from one another. It deliberately does **not** move when `nextOverdueOccurrence` advances or `overdueDeliveredCount` changes, even though both appear in the `GET` body. Those are the fields a delivery worker owns and updates without any Owner involvement, so making them bump the version would invalidate every outstanding Owner ETag on each delivery: an Owner editing a due date would lose a race to a `412` caused by nothing they did and nothing they can see, on a configuration that had not changed. Nothing is lost by the narrower scope, because every reminder response is `Cache-Control: no-store` and the token was never usable as a cache validator. Practically: use the ETag to guard `PUT` and `DELETE`; re-read `GET` for current delivery progress, which may have advanced under a token that is still valid.

Token rules: a mutation that changes state returns the **new** token; an idempotent no-op returns the **same** token; a stale token is `412`; a missing token is `428`; weak (`W/`), wildcard (`*`), multiple, malformed, and wrong-kind tokens are `412`. **Replaying a successful mutation with its pre-mutation token is `412`**, not a stable success — one rule, applied to both methods.

**Task eligibility (D107).** `PUT` refuses a `completed` or `dismissed` Task with `409 DOMAIN_CONFLICT`, writing no due date, no schedule, and no audit event; reminders stop permanently for a terminal Task, and nothing here reopens one. `PUT` on a `waiting` Task succeeds and produces a `suspended_waiting` schedule with no claimable occurrence, since Waiting suspends reminder scheduling and is the only pause mechanism. `GET` and `DELETE` are allowed for **every** Task status: reading history is not scheduling, and removal can only reduce reminder activity, so refusing it would strand an active schedule with no way to switch it off. An immaterial repeat is not refused for a `waiting` Task either, since a request that writes nothing has nothing to refuse; a terminal Task's schedule is always already stopped, so re-saving its date is a reactivation attempt rather than a repeat and meets the gate.

Eligibility is re-checked against the Task row **under the transaction's lock**, not only against the state the request read first. A `PUT` whose Task became terminal, or became Waiting, while the request was in flight is refused with `409 DOMAIN_CONFLICT` rather than committing a schedule the Task's current status forbids — including the case where the new status would merely require a _different_ schedule state, since an Owner who asked for an active schedule did not ask for a suspended one.

**Lifecycle transitions move reminder state (A8, D107).** Task status changes reconcile the reminder schedule in the **same transaction** that commits the status, so no interleaving can leave a terminal or Waiting Task holding a claimable occurrence. Entering `waiting` suspends an active schedule and clears its next occurrence; leaving `waiting` resumes it to the next occurrence strictly after the resume instant, with no backlog and no elapsed-time accounting; completion stops it with reason `task_completed`; dismissal stops it with reason `task_dismissed`. Generation is preserved across a Waiting round trip, as is the delivered-overdue count.

**An advance occurrence a Waiting period spanned is reported as skipped, not pending.** If the advance instant is at or before the resume instant, `advance.disposition` becomes `skipped_waiting_elapsed` and `advance.occurrence` keeps the morning it named, so a client can still say which reminder was missed. That value is deliberately distinct from `skipped_window_elapsed`, which means the advance morning had already passed when the Owner chose the date. An advance occurrence still ahead of the resume keeps `scheduled`, and one already delivered or already skipped keeps the disposition it had. A terminally stopped schedule is never revived and never reinterpreted, so a stop reason such as `due_date_removed` is not overwritten by a later completion. These transitions change the reminder ETag, so an Owner token minted before a lifecycle transition is genuinely stale and answers `412`.

**Idempotency and generations (D104, D106, D109).** Re-sending the same effective due date against a live schedule returns the current state, opens no generation, changes no token, and emits no audit event — re-saving must not reset the delivered count, or repeated saves would defeat the D106 ceiling. **Whether the save is an immaterial repeat is decided inside the transaction, under the Task lock**, after the `If-Match` version is verified — not from the caller's pre-request reads. The schedule and the canonical due date are two statements and not one snapshot, so deciding above the transaction let a `PUT` racing a `DELETE` answer `200` describing an `active` schedule with a `NULL` due date and a superseded ETag: a representation that had never existed. Under the lock, a no-op additionally requires that the canonical due date agrees with the schedule's own, which is what makes the returned representation coherent by construction; a caller whose token is stale gets `412` rather than a successful-looking no-op. A material change opens exactly one new generation and preserves every prior delivery attempt. Re-sending a date onto a **stopped** schedule opens a new generation even when the date is unchanged, because a stopped schedule is not the same effective schedule and D109 requires an explicit Owner re-save to reactivate reminders; that is audited as `reminder.schedule.reactivated`, distinct from `reminder.schedule.changed`. Removal is idempotent and deletes no reminder row. Whether there is anything left to remove is decided **inside the transaction, under the Task lock**, not from the caller's pre-request read: those are two statements and not one snapshot, so a caller can otherwise observe a due date already cleared by a winning removal alongside a schedule version from before it, and answer `200` with a superseded ETag. A `DELETE` whose token is current and whose work is already done returns `200` with the same token and writes nothing; a `DELETE` whose token is stale returns `412` even when the state it asked for happens to hold.

**Errors.** `401 UNAUTHORIZED` unauthenticated; `404 NOT_FOUND` for a missing or malformed Task id and, per the established convention, for a Task in another organization; `400 VALIDATION_ERROR` for malformed JSON, a non-object body, an impossible or noncanonical date, or any property other than `dueLocalDate`; `409 DOMAIN_CONFLICT` for a terminal-Task `PUT` or an illegal schedule transition; `412 PRECONDITION_FAILED` for a stale, weak, wildcard, multiple, malformed, or wrong-kind `If-Match`, and for losing a concurrent reminder write — including when PostgreSQL refuses to serialize the two transactions; `428 PRECONDITION_REQUIRED` for a missing `If-Match` on a mutation; `500` only for genuine faults. A normal write race never surfaces as a 500. Prisma and PostgreSQL detail is never surfaced.

**The `GET` projection comes from one database snapshot (A8.4a).** It previously read the schedule and the canonical Task due date as two independent unlocked statements, so racing a `DELETE` could return `active` behind a null `dueLocalDate` — each half true, of different moments. Both reads now happen inside one `RepeatableRead` transaction. No write lock is taken for an ordinary read, and `Cache-Control: no-store` is unchanged.

**`advance.disposition` gained four terminal values in A8.4a**: `delivered`, `skipped_not_eligible`, `failed_permanent`, and `ambiguous`. They are additive — no existing value changed meaning — and they exist because an advance occurrence can now reach a terminal outcome. A schedule whose advance occurrence is merely claimed still reports `scheduled`: a lease is not a processed occurrence, and reporting otherwise would tell an Owner a reminder had been resolved when a worker had only picked it up.

**Not contracted:** no attempt-history route, no Recipient-facing reminder surface, no Event Notification resource, and no reminder suspend/resume control — Waiting remains the only pause mechanism (D107), and its reminder coupling is wired to the existing lifecycle routes rather than exposed as a control of its own ([MILESTONES.md](MILESTONES.md)). The reminder processing endpoint added in A8.4a is **internal**, not an Owner surface; see below.

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

**POST only.** Empty body. Bounded batch with Hobby-safe soft time budget. Returns aggregate counts (`claimed`, `skippedIrrelevant`, `suggestionsCreated`, `failedRetryable`, `failedPermanent`, `requestId`). Lifecycle: CommunicationEvent claim/lease → deterministic heuristic → LLM extraction via `packages/ai` (`SuggestionExtractionResult`) only for heuristic-pass events (D084, D085). This automated path’s process authority remains CommunicationEvent claim/lease/process-state (D081 idempotency intent). Product proposal cardinality is one interpretation occurrence → 0..N TaskSuggestions (D161); this endpoint does not implement Owner-initiated interpretation. Claim ordering prefers `unprocessed` over `failed_retryable` (then fewer attempts, then older `internalDate`) so retries cannot starve fresh events. No raw communication bodies, excerpts, prompts, or model payloads in responses. Failure audits may store privacy-safe diagnostic fingerprints (status, finish reason, top-level keys, schema issue codes) — never prompts, bodies, or model output text. Independent of Gmail History ingestion (D075, D084). Safe to invoke repeatedly. Global AI misconfiguration fails the invocation (or releases claims without permanently poisoning events).

**AI operational error codes (names only; stored on events/audits, not in HTTP aggregate body beyond counts):** `AI_MISSING_CREDENTIALS`, `AI_INVALID_CREDENTIALS`, `AI_DISABLED`, `AI_TIMEOUT`, `AI_RATE_LIMIT`, `AI_INSUFFICIENT_QUOTA`, `AI_PROVIDER_5XX`, `AI_NETWORK`, `AI_EMPTY_OUTPUT`, `AI_MALFORMED_JSON`, `AI_SCHEMA_INVALID`, `AI_INVALID_OUTPUT` (legacy umbrella), `AI_POLICY_REFUSAL`, `AI_UNSUPPORTED_RESPONSE`.

**Credentials (names only):** application auth uses `CRON_SECRET`. The External Scheduler management credential (for example cron-job.org’s API key env name `CRON_JOB_ORG_API_KEY`) is never stored in the repository and is not used by the application endpoint.

### Internal reminder processing (A8.4a foundation, A8.4b.1 real overdue transport, A8.4b.2 D129 stop — contracted, disabled, deployed)

**Status: implemented and contracted, deliberately inert.** `operationId`: `processRemindersInternal`. No External Scheduler job invokes it and `ENABLE_REMINDER_DELIVERY` is set in no environment, so it does nothing anywhere. It **is** deployed, against a fully migrated schema. Inertness rests entirely on the absent flag and the absent scheduler.

| Method | Path                                 | Purpose                                                              |
| ------ | ------------------------------------ | -------------------------------------------------------------------- |
| POST   | `/api/v1/internal/reminders/process` | External Scheduler invocation (`InternalCronBearer` / `CRON_SECRET`) |

**POST only, and deliberately no `GET` handler** — unlike the Gmail poll, which accepts both. Empty body, Node runtime, 60-second maximum, bounded batch with a soft time budget. `Cache-Control: no-store` is applied by a single response finalizer, so it is present on `200`, `401`, and both `500` shapes rather than on whichever branches remembered it. Not an Owner session; a valid Owner cookie is not authorization here.

**Disabled behaviour is a contract, not an implementation detail.** With `ENABLE_REMINDER_DELIVERY` absent or anything other than the exact string `"true"`, the endpoint returns `200` with `deliveryEnabled: false` and every count zero, having scanned nothing, claimed nothing, written nothing, and called no transport. The match is exact — `"1"`, `"TRUE"`, `"yes"`, `"false"`, `"0"`, and `"true "` with a trailing space all leave delivery off, because the cost of a lenient parse is mail nobody approved.

**An unconfigured transport is reported separately from a disabled flag (A8.4a audit H3).** `transportConfigured: false` means processing fell closed because no transport was injected. Since A8.4b.1 a real transport exists, so this is the state of a build whose flag is on but whose `OWNER_ORGANIZATION_ID` is unset — and of any caller that injects nothing. The two zero-work responses are distinguishable because an operator who turned the flag on and got nothing deserves to know which of the reasons applied.

**A third zero-work reason was added by A8.4b.1: `transportAuthorized: false`.** It means a transport was configured and Gmail authorization could not be resolved — no connected account, revoked grant, insufficient scope, or an unrefreshable token. The invocation claimed nothing, wrote nothing, and called no provider. This is reported as a `200` aggregate rather than a `5xx` because it is a **statement about the deployment, not a failure of the run**: the run correctly declined to start. It is deliberately **not** recorded against any Task — charging a missing Gmail connection to whichever schedule the scan reached first would stop a reminder series that did nothing wrong and consume a Recipient's local calendar day for a message that never had a chance of being sent. `transportAuthorized` is `true` on any invocation that got far enough to have working credentials, including one that then found no work to do. The flag is only **meaningful** when `deliveryEnabled` and `transportConfigured` are both true: in the other two states authorization was never attempted, and it reads `false` by default rather than because anything was refused. The three are therefore a triple — `(false, false, false)` disabled, `(true, false, false)` nothing to send through, `(true, true, false)` authorization unusable, `(true, true, true)` scanned — and no one of them carries the whole story alone.

**Response is aggregate counts only:** `deliveryEnabled`, `transportConfigured`, `transportAuthorized`, `schedulesScanned`, `occurrencesClaimed`, `claimRefusals`, `delivered`, `skipped`, `failedRetryable`, `failedPermanent`, `ambiguous`, `recoveredClaims`, `retryBudgetTerminalizations`, `unsettledOccurrencesSettled`, `settlementsDeferred`, `ceilingStops`, `ambiguityStops`, `deadlineStopped`, `requestId`. No Task summary, Recipient identity, email address, provider payload, failure detail, claim owner, lease, or row identifier appears in the body or in the structured logs, which carry the same aggregates plus operation timing. This is unchanged by A8.4b.1: a real provider now runs behind these counts and adds no field describing what it sent or to whom. A caller learns how much work happened, never whose.

**`delivered` means Gmail confirmed acceptance, and `ambiguous` is never folded into it.** A timeout, an unparseable response, or a `2xx` carrying no message id counts as `ambiguous`: the occurrence consumes its local calendar day (D106) and is never retried, because a provider may hold the message and nobody can prove otherwise. Reporting such an outcome as delivered would be the one lie this response must not tell.

**Safe to invoke repeatedly and safe to overlap.** Two concurrent invocations cannot both process the same occurrence, because occurrence identity is unique in the database and every state change is fenced on a claim sequence — not because the invocations are prevented from overlapping. A missed invocation is recovered by a later one: persisted occurrence instants are the scheduling authority, so an approximately five-minute wake-up asks which have arrived rather than causing anything to happen every five minutes.

**Since A8.4b.1 this endpoint can send a real Gmail message, and only in one configuration.** The processing service imports no provider — a source guard scans `lib/reminders` and fails the build if one appears — and the route is the single composition point, permitted exactly two Gmail seams. Composition happens only when `ENABLE_REMINDER_DELIVERY` is exactly `"true"` **and** `OWNER_ORGANIZATION_ID` is set, which is no environment: with the flag unset nothing constructs an access resolver, decrypts a refresh token, or attempts a token exchange. Automated tests cannot reach real Gmail even with the flag forced on, because the adapter throws at construction under a test runner. Tests inject a fake, and an unscripted fake returns a permanent configuration failure rather than acceptance.

**A reminder email carries no link (D130), and capability state gates the send.** Before any provider call, the same `RepeatableRead` snapshot that reads the Task, assignment, due date, and schedule also reads the canonical capability row. When no actionable original capability exists — missing, expired, revoked, never activated, or already consumed — the occurrence is counted in `skipped` with reason `no_actionable_capability`, and **no provider call is made**. It is not a transport failure and does not consume a retry. The email itself contains no capability URL, token, `/c/` path, or Task URL, and instructs the Recipient to use the original assignment email; both MIME bodies are asserted link-free before the message is emitted.

**A8.4b.3 makes advance occurrences reachable, through two scans and one pipeline.** Each invocation runs a bounded scan per occurrence kind — overdue on `next_overdue_occurrence_at`, advance on `advance_occurrence_at` gated on `advance_disposition = 'scheduled'` — and both feed the same claim, guard, send, and settle path. Advance is processed first, being the older instant whenever both are due. `schedulesScanned` therefore counts due **occurrences**, not distinct schedules: a schedule owing both kinds after a long outage contributes two.

The one advance reminder a generation holds may be delivered only during its own organization-local calendar day, the day before the due date (D105). A worker reaching it after that day records a `skipped` outcome with reason `advance_window_elapsed` and makes **no provider call**, and the schedule's `advance.disposition` settles to `skipped_window_elapsed` — the same value establishment writes when the Owner chose the date too late, and deliberately not `skipped_not_eligible`, which means the Task stopped needing a reminder rather than that the system missed one. The message is byte-identical to an overdue reminder: D105 is a difference in timing, and the body states the due date rather than asserting lateness. Advance occurrences do not count toward D106's fourteen, and D129 counts overdue occurrences only — one advance occurrence per generation can never form a consecutive run.

**A8.4b.2 enforces D129 and adds one enum value and one counter.** `TaskReminderStopReason` gains `repeated_ambiguous_outcomes`: three consecutive terminal ambiguous overdue occurrences within one schedule generation stop the schedule, with `requiresOwnerAttention` set. It is deliberately distinct from `permanent_delivery_failure` — that one says a provider refused something and names what to fix, this one says the provider gave no answer three mornings running and the Recipient may or may not have been reminded, which is a different question for the Owner to answer. Consumers must treat the enum as open to additions rather than exhaustively matched. The aggregate gains `ambiguityStops`, reported apart from `ceilingStops` because a ceiling stop is a schedule finishing its work while an ambiguity stop is the system reporting it cannot confirm its own sends; it remains a count, and which Tasks were stopped is deliberately not reportable here. Nothing else about the endpoint changed: the sequence is derived from occurrence history inside the settlement transaction, no counter is stored, no new schedule status exists, and nothing auto-resumes.

### Internal Owner notification processing (A8.5b–A8.5e — contracted, disabled, deployed inert)

**Status: implemented and contracted, deliberately inert.** `operationId`: `processOwnerNotificationsInternal`. No scheduler job invokes it, neither `ENABLE_OWNER_EVENT_CAPTURE` nor `ENABLE_OWNER_EVENT_DELIVERY` is set in any environment, and the migration and code are both deployed. No Owner notification has been sent. A real Gmail adapter and Owner email renderer exist, so the flags are the only thing holding delivery shut. See [Current production state](DEPLOYMENT.md#current-production-state).

| Method | Path                                     | Purpose                                                  |
| ------ | ---------------------------------------- | -------------------------------------------------------- |
| POST   | `/api/v1/internal/notifications/process` | Worker invocation (`InternalCronBearer` / `CRON_SECRET`) |

**Contracted rather than route-local, because the repository already contracts the reminder worker's aggregate.** The two internal workers are peers, and one of them having a schema while the other did not would make the contract a record of which slice remembered rather than of what the system exposes.

**POST only, empty body, Node runtime, 60-second maximum, bounded batch with a soft deadline reserve.** `Cache-Control: no-store` from a single response finalizer, so it is present on every status rather than on whichever branches remembered it. Cron bearer, never an Owner session. **This is a separate endpoint from the reminder worker and is not a second verb on it.**

**Two independently gated phases (A8.5e).** A **capture** phase observes capability expiry under `ENABLE_OWNER_EVENT_CAPTURE`; a **delivery** phase claims and settles intents under `ENABLE_OWNER_EVENT_DELIVERY`. Capture runs first, both honour one deadline, and no transaction spans them. Each flag is matched as the exact string `"true"` independently — `"1"`, `"TRUE"`, `"yes"`, `"false"`, and `"true "` leave **that** flag off without affecting the other. `ENABLE_REMINDER_DELIVERY` is unrelated and is not read here.

| Capture | Delivery | Contracted behaviour                                                                    |
| ------- | -------- | --------------------------------------------------------------------------------------- |
| off     | off      | `200`, every count zero, **no database connection opened and no transport constructed** |
| on      | off      | Expiry observation only; `transportConfigured: false`, delivery counts zero             |
| off     | on       | Delivery only; every `expiry*` count zero                                               |
| on      | on       | Expiry observation, then delivery within the remaining budget                           |

**Disabled behaviour is a contract, and A8.5e restated it.** A8.5b contracted that delivery disabled meant no database access. That described an endpoint whose only work was delivery; the endpoint now also captures, and the guarantee an operator can rely on is that **both** flags off means no connection is opened and no transport is constructed. Capture alone opens the database and still composes no transport, reads no Gmail configuration, and claims nothing. `transportConfigured` is reported separately from `deliveryEnabled` so an operator who enables delivery and sees no work can tell which condition applied.

**Response is aggregate counts and flags only:** `captureEnabled`, `deliveryEnabled`, `transportConfigured`, `expiryScanned`, `expiryObserved`, `expiryLostRaces`, `expiryBatchFilled`, `expiryDeadlineStopped`, `scanned`, `claimed`, `sent`, `failedRetryable`, `failedPermanent`, `ambiguous`, `retryExhausted`, `staleSuppressed`, `recoveredClaims`, `lostClaims`, `batchFilled`, `deadlineStopped`, `requestId`. No Owner or Recipient address, Task summary, actor label, event type, subject identifier, capability identifier, individual expiry instant, provider payload, failure detail, claim owner, or lease appears in the body or in the structured logs. `batchFilled` and `expiryBatchFilled` report that a scan filled its batch rather than counting what remains, because an exact remainder needs an unbounded `COUNT`.

**The six A8.5e fields are additive and every prior field kept its name and meaning.** `deadlineStopped` was already invocation-level and is now true if either phase stopped, with `expiryDeadlineStopped` distinguishing which — a stop during capture means delivery never began, so `transportConfigured` is false because nothing was composed rather than because composition failed. `expiryScanned = expiryObserved + expiryLostRaces` always holds; a lost race means another observer, or a Recipient presenting the lapsed token, transitioned it first, and the loser wrote nothing.

**`sent` means the transport confirmed acceptance, and `ambiguous` is never folded into it.** An ambiguous outcome is terminal on first occurrence, requires Owner attention, and is never retried, because the provider may hold the message and nobody can prove otherwise (D135). A lease that lapsed after a provider call began settles the same way. `failedRetryable` counts failures that returned the intent to pending work with budget remaining; `retryExhausted` counts the third one, which is terminal.

**Safe to invoke repeatedly and safe to overlap.** Two concurrent invocations cannot process the same intent: every state change is a compare-and-set fenced on a claim sequence, and a refused change is counted in `lostClaims` rather than retried blindly. `lostClaims` above zero under overlapping invocations is expected and is not an error.

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

### Responsibility selection on approve (D168)

**Required** `responsibility` carries the Owner's affirmative acceptance-time responsibility choice as a **distinct concept**; the legacy top-level `recipientId` is never repurposed for it and keeps its `RECIPIENT_HANDOFF_NOT_AVAILABLE` rejection above.

`ResponsibilitySelection` requires `responsibleParty`, either `owner` or `recipient`, so an Owner selection is always affirmatively stated rather than inferred from a missing Recipient. `recipientId` is required when `responsibleParty` is `recipient` and must be **omitted** when it is `owner`; either violation is HTTP **400** `VALIDATION_ERROR`. A Recipient outside the Owner's organization is HTTP **404** `NOT_FOUND`.

**Server behaviour:**

- The selection is persisted as dedicated append-only evidence **atomically** with the canonical Task, the suggestion approval, and the `approvedTaskId` linkage. Existing If-Match/version semantics are unchanged, and there is no approve idempotency.
- Selecting a Recipient records the selection **only**: still no TaskAssignment, no Capability, no HandoffAttempt, no email, and no Recipient access. Handoff remains the separate A7 mutation, and a later failed or absent handoff never falsifies the selection.
- Omitting `responsibility` is HTTP **400** `VALIDATION_ERROR` and approves **nothing**: no Task is created and the proposal stays pending. It is never defaulted or inferred to `owner`, because an omitted field is not evidence that the Owner selected Me (D155, D164). Every successful acceptance therefore carries its selection evidence.
- The evidence is persistence-only: it is not exposed on the `TaskSuggestion` or `Task` read contracts, and there is no public read endpoint for it.
- `TaskSuggestion.approvedTaskId` is the existing approval linkage (not responsibility state). Pending suggestions return `null`; after successful approval, Owner list and detail reads return the canonical Task ID created by that approval so a client that lost the approve success response can recover via read-after-write. The value is never synthesized from assignment, handoff, or responsibility-selection evidence.

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

| Condition                                          | HTTP | Code                              |
| -------------------------------------------------- | ---- | --------------------------------- |
| Missing suggestion `If-Match`                      | 428  | `PRECONDITION_REQUIRED`           |
| Stale suggestion `If-Match`                        | 412  | `PRECONDITION_FAILED`             |
| Merge missing `targetTaskIfMatch`                  | 428  | `PRECONDITION_REQUIRED`           |
| Merge stale `targetTaskIfMatch` (target Task)      | 412  | `PRECONDITION_FAILED`             |
| Domain conflict                                    | 409  | `DOMAIN_CONFLICT`                 |
| Approve with `recipientId` (A6)                    | 400  | `RECIPIENT_HANDOFF_NOT_AVAILABLE` |
| Approve with missing/inconsistent `responsibility` | 400  | `VALIDATION_ERROR`                |
| Approve with foreign/unknown selected Recipient    | 404  | `NOT_FOUND`                       |

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

**Resolved by A8.3b (current contract obligation, not history):** `TaskReminderState` on `GET /api/v1/tasks/{taskId}/reminder`, and `PUT`/`DELETE` on the same path under reminder-resource `If-Match`. Same-value save opens no generation. See [Owner reminder schedule (A8.3b)](#owner-reminder-schedule-a83b).

The following existing contract/domain shapes are **debt** relative to that law and must be aligned at the appropriate contract stage—not treated as current product authority:

| Concept                                       | Current contract/domain presence | Alignment disposition                                                                                                                                                                                                                                                                                                                       |
| --------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ReminderMetadata` / `nextReminderAt`         | Task reminder stub               | **Replace** with Reminder Schedule / reminder attempt shapes (D104, D109). The `Task.reminder` JSON stub is not queryable and is not the schedule model                                                                                                                                                                                     |
| `RecipientReminderPreferences`                | Recipient stub (`emailEnabled`)  | **Remove.** Recipient reminder preferences are explicitly excluded (D110); Follow-up Policy is Task-scoped and application-owned (D104)                                                                                                                                                                                                     |
| `FollowUpProposal` / `followUpProposal`       | Completion next-action payload   | **Retain** wire/schema name during A8 as temporary contract naming debt. Canonical docs/product term: **Next-action Suggestion**. Do **not** rename OpenAPI in A8.0; breaking rename only under a later contract-versioning plan                                                                                                            |
| `proposedDueAt` on suggestions / proposals    | Present                          | **Retain** as an **AI proposal** with no scheduling effect. It becomes authoritative only when the Owner explicitly selects it as the Task due date (D027, D102). Preserving proposal-versus-decision remains useful future learning provenance (D109)                                                                                      |
| Task / approve `dueAt`                        | Present                          | **Retain** as the optional due date, with **changed semantics**: when Owner-selected it is the authoritative reminder scheduling input (D102). Align toward a local **calendar date** representation; `dueAt` stays temporarily for compatibility (D109). Instant-typed `dueAt` on task update / approve still drives no reminder by itself |
| `DerivedTaskUrgency` (`due_soon` / `overdue`) | Present                          | **Retain** as derived labels, but **no longer display-only** (D098 superseded by D102). Labels must not themselves be the scheduling mechanism: occurrences are computed from the due date (D103)                                                                                                                                           |
| `POST …/snooze` / `SnoozeTaskRequest`         | Present                          | Product law removed (D101). At A8 contract alignment **prefer remove** the endpoint (not a deprecated no-op), with contract-versioning / client migration. OpenAPI unchanged in A8.0                                                                                                                                                        |
| Reminder attempt history (read)               | Absent                           | **Add** read-only processed-occurrence history with outcome and truthful skip/failure reason for the Owner surface and operator diagnosis (D100, D109). No capability token or URL may appear                                                                                                                                               |
| Reminder processing endpoint (internal)       | Absent                           | **Add** one authenticated internal endpoint following the existing `CRON_SECRET` bearer pattern (D079). Server-derived idempotency, so no request idempotency header. Aggregate counts only — no payloads or secrets in the response                                                                                                        |
| Event Notification resources                  | Absent                           | **Add** as A8 event architecture is contracted (D099)                                                                                                                                                                                                                                                                                       |
| Event Notification processing / delivery      | Absent                           | **Add** for A8 Owner email via connected Gmail (D099); push remains D017/A9                                                                                                                                                                                                                                                                 |
| Handoff body Phase 1 interval                 | Absent                           | **Do not add.** Preset intervals are retired (D102); handoff confirms no interval. Reminders derive from the Task due date                                                                                                                                                                                                                  |
| Custom reminder create / edit / delete routes | Absent                           | **Do not add in the first A8 slice** (D110). Deferred to a separately authorized future slice                                                                                                                                                                                                                                               |

Owner-approved A8.1 dispositions (docs only): retain `FollowUpProposal` wire name during A8; prefer snooze **removal** at contract alignment; Owner Event Notifications by Gmail email (D099); **no** custom-reminder routes, **no** reminder-time field, **no** preset interval field in the first A8 slice (D110).
