# Decision register

Statuses: **Approved** · **Proposed** · **Deferred** · **Open** · **Superseded** · **Superseded in part**

**Superseded in part** means the record remains operative except for clauses that have been **withdrawn**.

**A withdrawn clause is removed from the active decision text.** It is not left standing beside an explanation that it no longer applies, because an active Decision field must state only what currently binds. The record's Notes field records which decision withdrew it and what remains operative. Historical wording may later be retained in inert history where it genuinely aids understanding; inert history is never current law. Amendments that withdraw no clause keep status **Approved** and record the amendment in the record's Notes.

Governed by [PROJECT_CONSTITUTION.md](PROJECT_CONSTITUTION.md). This register's charter, representation, and rewrite governance: **D165**. Unresolved items: [OPEN_QUESTIONS.md](OPEN_QUESTIONS.md).

Do not renumber. Superseded records are retained for history; follow the newer Approved decision(s) cited in Notes.

---

## Decision records

Records rewritten into the per-decision representation authorized by **D165**.

### D001 — New repository separate from Rocket PM

**Status:** Approved

**Decision:** New repository separate from Rocket PM

**Notes:** Greenfield; no Rocket PM integration in v1

### D002 — Android application included in MVP

**Status:** Approved

**Decision:** Android application included in MVP

**Notes:** Owner primary interface

### D003 — Monorepo with Android + web shells and shared TypeScript tooling packages

**Status:** Approved

**Decision:** Monorepo with Android + web shells and shared TypeScript tooling packages

**Notes:** A1 scaffolded apps; A2–A4 added `contracts`, `domain`, `db`. A6 introduces `packages/ai` (D085). `packages/ui` remains deferred

### D004 — Supabase chosen as primary Postgres/auth/realtime platform

**Status:** Approved

**Decision:** Supabase chosen as primary Postgres/auth/realtime platform

### D005 — Neon excluded from version one

**Status:** Approved

**Decision:** Neon excluded from version one

**Notes:** Avoid duplicate database vendors

### D006 — Prisma used only through authorized server APIs

**Status:** Approved

**Decision:** Prisma used only through authorized server APIs

**Notes:** Does not inherit end-user RLS context automatically

### D007 — OpenAPI is the canonical API contract

**Status:** Approved

**Decision:** OpenAPI is the canonical API contract; TypeScript and Kotlin models are generated from OpenAPI

**Notes:** JSON Schema may be derived; not source of truth. Closes former OPEN #14

### D008 — Approval required before AI suggestion becomes an active task

**Status:** Approved

**Decision:** Approval required before AI suggestion becomes an active task

### D009 — Approval required before administrator assignment email

**Status:** Superseded

**Decision:** Approval required before administrator assignment email

**Notes:** Follow D048–D054: Owner approval before Recipient assignment email

### D010 — For Gmail-origin Recipient assignments

**Status:** Approved

**Decision:** For Gmail-origin Recipient assignments: forward original email with AI summary above, including all attachments, after assignment approval

**Notes:** Via Owner’s Gmail API connection

### D011 — No separate attachment-approval step

**Status:** Approved

**Decision:** No separate attachment-approval step

**Notes:** Entire forward still requires assignment approval

### D012 — Administrator in same Google Workspace organization

**Status:** Superseded

**Decision:** Administrator in same Google Workspace organization

**Notes:** Recipients have no accounts; no same-org sign-in requirement (D049)

### D013 — Authenticated task links required

**Status:** Superseded

**Decision:** Authenticated task links required

**Notes:** Task-specific capability links; GET non-mutating; POST after confirmation (D050)

### D014 — Unauthenticated one-click mutations excluded

**Status:** Approved

**Decision:** Unauthenticated one-click mutations excluded

**Notes:** Reinforced by D050 (GET never mutates)

### D015 — Gmail polling-first acceptable initially

**Status:** Approved

**Decision:** Gmail polling-first acceptable initially; Pub/Sub deferred pending confirmation

**Notes:** Refined by D065–D066; scheduler remains external per D079

### D016 — Gmail API used for outbound assignment mail and forwarding

**Status:** Approved

**Decision:** Gmail API used for outbound assignment mail and forwarding

### D017 — FCM deferred unless core workflow proves necessary

**Status:** Deferred

**Decision:** FCM deferred unless core workflow proves necessary

### D018 — WhatsApp excluded from version one

**Status:** Approved

**Decision:** WhatsApp excluded from version one

**Notes:** Also Messenger and Signal

### D019 — Google Play Store distribution excluded from version one

**Status:** Approved

**Decision:** Google Play Store distribution excluded from version one

**Notes:** Private sideload / internal testing

### D020 — Temporary communication excerpts deleted 7 days after complete or dismiss

**Status:** Approved

**Decision:** Temporary communication excerpts deleted 7 days after complete or dismiss

### D021 — Completed tasks visible 30 days, then content scrubbed

**Status:** Approved

**Decision:** Completed tasks visible 30 days, then content scrubbed

**Notes:** Independent from 7-day excerpt rule

### D022 — Durable anonymized learning allowed without raw message bodies

**Status:** Approved

**Decision:** Durable anonymized learning allowed without raw message bodies

**Notes:** Rules require approval to apply; Owner-only scope per D054

### D023 — Completed-call detection classified as best-effort

**Status:** Approved

**Decision:** Completed-call detection classified as best-effort

**Notes:** Unknown completed calls do not always prompt

### D024 — No permanent communication archive

**Status:** Approved

**Decision:** No permanent communication archive

### D025 — Missed calls always prompt when detected

**Status:** Approved

**Decision:** Missed calls always prompt when detected

**Notes:** Detection still device-dependent

### D026 — First overdue reminder to administrator only

**Status:** Superseded

**Decision:** First overdue reminder to administrator only; later may CC primary; threshold configurable

**Notes:** Historical only. Operative A8 model is Follow-up Engine + Event Notification Engine (D095, D099)—not overdue/CC escalation

### D027 — AI may recommend

**Status:** Approved

**Decision:** AI may recommend; deterministic application rules own Follow-up Engine and Event Notification Engine sends. AI never decides whether a Follow-up Attempt or Event Notification is sent

**Notes:** Amended in A8.0 (D095–D101) and A8.1 (D102–D110). Replaces “deterministic rules send reminders” framing. **A8.1:** AI may recommend a **due date**; it takes effect only when the Owner explicitly selects it, and AI may never create, activate, alter, or suppress a Reminder Schedule (D102, D110). See [AI_CONSTITUTION.md](AI_CONSTITUTION.md)

### D028 — Raw audio deleted immediately after successful transcription and validation

**Status:** Approved

**Decision:** Raw audio deleted immediately after successful transcription and validation; failed transcription audio retained encrypted up to 48 hours for retry then deleted

**Notes:** Aligns with D041

### D029 — Administrator email not hard-coded

**Status:** Superseded

**Decision:** Administrator email not hard-coded; from authorized user records / secure config

**Notes:** Follow D087: Owner-managed Recipient records only; no env-default Recipient as production model

### D030 — Schema allows future additional administrators

**Status:** Superseded

**Decision:** Schema allows future additional administrators; v1 implements one

**Notes:** **Superseded by D048–D054.** Schema may allow additional Recipients; v1 implements one Owner

### D031 — Application retention does not delete forwarded Gmail mailbox copies

**Status:** Approved

**Decision:** Application retention does not delete forwarded Gmail mailbox copies

**Notes:** Document Gmail retention boundary

### D032 — Server-side org/role authorization required

**Status:** Superseded

**Decision:** Server-side org/role authorization required; RLS defence in depth

**Notes:** **Superseded by D048–D054.** Owner session auth + capability authorization for Recipients; RLS defence in depth. The D048–D054 range replaced the org/role authorization framing only; the RLS defence-in-depth principle was neither inherited by that range nor withdrawn, and deny-by-default RLS as defence in depth is now current Approved law in D166

### D033 — Android does not directly write core business records to Supabase tables

**Status:** Approved

**Decision:** Android does not directly write core business records to Supabase tables

### D034 — Primary timezone for Follow-up Engine interval arithmetic is America/Vancouver

**Status:** Approved

**Decision:** Primary timezone for Follow-up Engine interval arithmetic is America/Vancouver

**Notes:** Amended in A8.0. **Preserved and clarified in A8.1 (D103):** `America/Vancouver` is the Owner **organization** timezone and the sole scheduling authority; reminder occurrences resolve to **09:00 organization-local** via local-calendar arithmetic. Quiet hours / business-hours windows are not v1 Follow-up Engine requirements

### D035 — Documentation is the source of truth

**Status:** Approved

**Decision:** Documentation is the source of truth; Engineering Rules #1–#2 in PROJECT_CONSTITUTION

**Notes:** Docs updated before behaviour changes; docs win over code

### D036 — AI learning ladder requires explicit approval before advancing stages

**Status:** Approved

**Decision:** AI learning ladder requires explicit approval before advancing stages; v1 stops at Approval for consequential actions

**Notes:** See AI_CONSTITUTION; Owner-only learning per D054

### D037 — Task assignment approval and Gmail forwarding are one business action with a single confirmation

**Status:** Approved

**Decision:** Task assignment approval and Gmail forwarding are one business action with a single confirmation

**Notes:** Dialog discloses handoff of an existing Task (D080), forward/email + attachments when applicable, and Capability issuance. **Amended in A8.1:** handoff confirms **no** follow-up interval — preset intervals are retired and reminders derive from the Owner-selected Task due date set on the Task (D102, D104). Follow-up Engine is A8 (D089)—A7 UI may disclose follow-up belongs to the assignment workflow but must not claim a Reminder Schedule is active while A8 is not operational. Closes former OPEN #15. Refined by D086–D094, D095–D101, D102–D110

### D038 — No voice interaction creates a Task directly

**Status:** Approved

**Decision:** No voice interaction creates a Task directly; voice always produces a proposed action; voice-created follow-ups begin as Task Suggestions

**Notes:** Closes former OPEN #16

### D039 — Administrator v1 permissions

**Status:** Superseded

**Decision:** Administrator v1 permissions: complete, waiting, notes, return to primary, request clarification; may not create standalone tasks, approve learning, change rules/policies, or create automations; admin work requests become Task Suggestions

**Notes:** Recipient capability permissions; “administrator” is relationship label only (D053)

### D040 — Minimum supported Android version is Android 12 (`minSdk` API 31)

**Status:** Approved

**Decision:** Minimum supported Android version is Android 12 (`minSdk` API 31); primary device optimization and validation target is Samsung Galaxy S24+; distribution remains private sideload/internal testing

**Notes:** Closes former OPEN #2. Dialer-specific behaviour remains OPEN #1

### D041 — Failed voice transcription audio may be retained encrypted for up to 48 hours for retry

**Status:** Approved

**Decision:** Failed voice transcription audio may be retained encrypted for up to 48 hours for retry; delete immediately after successful transcription and validation; delete when 48-hour window expires; no indefinite retention

**Notes:** Closes former OPEN #6

### D042 — Gmail-origin Recipient assignment forwards full email context/thread available to the application with all original attachments

**Status:** Approved

**Decision:** Gmail-origin Recipient assignment forwards full email context/thread available to the application with all original attachments; do not intentionally redact; Gmail/Workspace restrictions may cause partial or failed forward

**Notes:** Partial failure must never be reported as complete success. Closes former OPEN #10. Refined by D088 (do not send knowingly incomplete forwards)

### D043 — Google Messages is an approved communication source only after the Owner enables it on the device

**Status:** Superseded in part

**Decision:** Google Messages is an approved communication source only after the Owner enables it on the device; a Task Suggestion still requires Owner approval; the app may prepare an SMS draft opened in Google Messages; no direct SMS send

**Notes:** Closes former OPEN #11. **Superseded in part by D160**, which **withdraws** the clause permitting captured notification content to be sent to the backend for AI analysis once the source is enabled — initial Messages review is **manual and Owner-initiated**. Owner device enablement, the Messages source itself, approval before a Task exists, and the draft-only outbound boundary remain operative

### D044 — Generated TypeScript and Kotlin DTO outputs from OpenAPI are committed

**Status:** Approved

**Decision:** Generated TypeScript and Kotlin DTO outputs from OpenAPI are committed; CI enforces regeneration drift

**Notes:** A2

### D045 — Optimistic concurrency uses monotonic integer `version` with strong HTTP ETags and `If-Match`

**Status:** Approved

**Decision:** Optimistic concurrency uses monotonic integer `version` with strong HTTP ETags and `If-Match`; 428 precondition required, 412 stale match, 409 domain conflict

**Notes:** A2

### D046 — Domain package types are separate from generated API DTOs

**Status:** Approved

**Decision:** Domain package types are separate from generated API DTOs; mapping compatibility verified by tests

**Notes:** A2

### D047 — Kotlin DTO generation uses OpenAPI Generator model-only mode (`apis=false`, `supportingFiles=false`) with `library=jvm-okhttp4` and `serializationLibrary=moshi`

**Status:** Approved

**Decision:** Kotlin DTO generation uses OpenAPI Generator model-only mode (`apis=false`, `supportingFiles=false`) with `library=jvm-okhttp4` and `serializationLibrary=moshi`; no HTTP client runtime is generated or depended upon

**Notes:** Android networking client deferred

### D048 — Single authenticated Owner in version one

**Status:** Approved

**Decision:** Single authenticated Owner in version one

**Notes:** One Google Workspace sign-in; no second application user role

### D049 — Recipients have no application accounts

**Status:** Approved

**Decision:** Recipients have no application accounts

**Notes:** Delegated people identified by email; act only via capability links

### D050 — Recipient actions use task-specific capability links

**Status:** Approved

**Decision:** Recipient actions use task-specific capability links; GET is non-mutating; POST requires explicit confirmation

**Notes:** Supersedes D013

### D051 — Capability possession is authorization, not verified identity

**Status:** Approved

**Decision:** Capability possession is authorization, not verified identity

**Notes:** Audit must not treat link holder as cryptographically identified person

### D052 — Recipient audit wording must not overstate identity

**Status:** Approved

**Decision:** Recipient audit wording must not overstate identity

**Notes:** Log capability use and technical metadata; avoid “verified user X acted” unless Owner session

### D053 — “Administrator” is an optional Recipient relationship label, not an application role

**Status:** Approved

**Decision:** “Administrator” is an optional Recipient relationship label, not an application role

**Notes:** Supersedes administrator-as-role framing (D012, D039)

### D054 — Durable learning belongs to the Owner assistant only

**Status:** Approved

**Decision:** Durable learning belongs to the Owner assistant only

**Notes:** Recipients cannot approve or influence learning rules

### D055 — Capability links expire seven days after issuance by default

**Status:** Approved

**Decision:** Capability links expire seven days after issuance by default; TTL is required server-side configuration; each capability persists an explicit `expiresAt`

**Notes:** Closes OPEN #18 for A4 default; config may refine later without removing persisted expiry

### D056 — A capability remains usable for multiple permitted actions until expiry, revocation, assignment replacement/removal, or other applicable terminal invalidation

**Status:** Approved

**Decision:** A capability remains usable for multiple permitted actions until expiry, revocation, assignment replacement/removal, or other applicable terminal invalidation; do not assign A4 semantics to `CapabilityStatus.used` without a Decision

**Notes:** Closes OPEN #19; `used` reserved without A4 transition behaviour

### D057 — A4 audit records store capability ID, bound resource IDs, action, timestamp, request ID, outcome, state/version context, and truthful capability attribution

**Status:** Approved

**Decision:** A4 audit records store capability ID, bound resource IDs, action, timestamp, request ID, outcome, state/version context, and truthful capability attribution; raw IP and full user-agent retention are deferred

**Notes:** Interim closure of OPEN #22 for A4; IP/UA may be revisited for A15

### D058 — Recipient notes and clarification requests are typed-only in A4

**Status:** Approved

**Decision:** Recipient notes and clarification requests are typed-only in A4

**Notes:** Defers OPEN #20 Recipient voice to A12

### D059 — Owner APIs and Recipient capability APIs use separate authorization surfaces

**Status:** Approved

**Decision:** Owner APIs and Recipient capability APIs use separate authorization surfaces; `GET /c/[token]` is strictly non-mutating; Recipient actions require explicit POST

**Notes:** Dual-auth on shared Owner task paths is superseded for Recipient transport

### D060 — Owner snooze remains in A4 and must be fully specified in domain and OpenAPI before runtime implementation

**Status:** Superseded

**Decision:** Owner snooze remains in A4 and must be fully specified in domain and OpenAPI before runtime implementation

**Notes:** Superseded for product behaviour by **D101**. Waiting (D097) is the Follow-up suspension mechanism. Prefer snooze endpoint **removal** at A8 contract alignment (not deprecated no-op); OpenAPI unchanged in A8.0

### D061 — Recipient work requests becoming pending Task Suggestions remain in A4 and must be contracted (OpenAPI + domain) before runtime implementation

**Status:** Approved

**Decision:** Recipient work requests becoming pending Task Suggestions remain in A4 and must be contracted (OpenAPI + domain) before runtime implementation

**Notes:** Suggestion still requires Owner approval before a Task exists

### D062 — Introduce `packages/db` with Prisma after A4 Phase 0 decisions/contract alignment and domain alignment

**Status:** Approved

**Decision:** Introduce `packages/db` with Prisma after A4 Phase 0 decisions/contract alignment and domain alignment

**Notes:** Refines D003/D006 timing for A4

### D063 — Raw capability secret/link may be returned once to the authenticated Owner for manual A4 verification

**Status:** Approved

**Decision:** Raw capability secret/link may be returned once to the authenticated Owner for manual A4 verification; store only a secure hash server-side; never log the raw secret

**Notes:** Reinforces SECURITY hash-not-raw rule

### D064 — A4 does not include physical task deletion

**Status:** Approved

**Decision:** A4 does not include physical task deletion; dismissal is the supported terminal lifecycle operation for abandoned tasks

**Notes:** Aligns with `TaskStatus.dismissed`

### D065 — A5 Gmail polling interval is every five minutes

**Status:** Approved

**Decision:** A5 Gmail polling interval is every five minutes

**Notes:** Closes OPEN #4

### D066 — A5 uses scheduled polling only

**Status:** Approved

**Decision:** A5 uses scheduled polling only; Gmail Pub/Sub / push watch remains deferred

**Notes:** Closes OPEN #5 for A5; may reopen for A5+

### D067 — A5 does not perform historical mailbox backfill

**Status:** Approved

**Decision:** A5 does not perform historical mailbox backfill; sync starts from connection time

**Notes:** Privacy and cost; Owner may revisit later

### D068 — A5 ingests Inbox-labelled messages only

**Status:** Approved

**Decision:** A5 ingests Inbox-labelled messages only; drafts, spam, trash, and sent are excluded by default

### D069 — Connected Gmail mailbox email domain must match `OWNER_WORKSPACE_DOMAIN`

**Status:** Approved

**Decision:** Connected Gmail mailbox email domain must match `OWNER_WORKSPACE_DOMAIN`

**Notes:** Aligns with Owner session Workspace allowlist

### D070 — A5 Gmail OAuth grants `gmail.readonly` only

**Status:** Approved

**Decision:** A5 Gmail OAuth grants `gmail.readonly` only; send, modify, compose, and label-write scopes are forbidden

**Notes:** A5 ingest remains readonly. A7 outbound mail uses `gmail.send` in addition to `gmail.readonly` (D093); `gmail.modify` still forbidden unless a later Decision

### D071 — A5 stores attachment metadata only

**Status:** Approved

**Decision:** A5 stores attachment metadata only; attachment bytes are never persisted

### D072 — A5 may store temporary capped plain-text excerpts only

**Status:** Approved

**Decision:** A5 may store temporary capped plain-text excerpts only; full MIME and full HTML message archives are forbidden

**Notes:** Aligns with DATA_RETENTION temporary communication class

### D073 — A5 does not expose a communication-event browser or list API

**Status:** Approved

**Decision:** A5 does not expose a communication-event browser or list API

**Notes:** Events are persistence for A6; no Owner event UI in A5

### D074 — Scheduled Gmail polling audit attribution uses truthful `system` actor kind

**Status:** Approved

**Decision:** Scheduled Gmail polling audit attribution uses truthful `system` actor kind; Owner and capability attribution remain unchanged

**Notes:** Extends D057 actor model

### D075 — Gmail history cursor (`historyId`) advances only after the processed page of events is durably committed in the same database transaction

**Status:** Approved

**Decision:** Gmail history cursor (`historyId`) advances only after the processed page of events is durably committed in the same database transaction

**Notes:** Prevents silent gaps

### D076 — Invalid or expired Gmail history cursors set a visible `resync_required` account state

**Status:** Approved

**Decision:** Invalid or expired Gmail history cursors set a visible `resync_required` account state; silent cursor reset and silent skipped ingestion windows are forbidden

### D077 — A5 creates `CommunicationEvent` records only

**Status:** Approved

**Decision:** A5 creates `CommunicationEvent` records only; it must not create Task Suggestions or implement suggestion HTTP

**Notes:** A6 owns suggestion generation and Owner suggestion routes

### D078 — At Gmail ingest time, TemporaryCommunicationExcerpt `purgeAt` is `syncedAt + 7 days` (ingest-only maximum retention)

**Status:** Approved

**Decision:** At Gmail ingest time, TemporaryCommunicationExcerpt `purgeAt` is `syncedAt + 7 days` (ingest-only maximum retention). Later workflows may replace this deadline per D020 when an excerpt is associated with a suggestion or task; if no later workflow retains it, the excerpt remains eligible for deletion at the seven-day ingest deadline

**Notes:** Complements D020 (complete/dismiss +7); A5.4 ingest path

### D079 — Architecture Principles in [PROJECT_CONSTITUTION.md](PROJECT_CONSTITUTION.md) are binding

**Status:** Approved

**Decision:** Architecture Principles in [PROJECT_CONSTITUTION.md](PROJECT_CONSTITUTION.md) are binding. Gmail polling exemplifies them: the app owns the Application Polling Engine; any scheduler that securely invokes the authenticated poll endpoint every five minutes is acceptable; **cron-job.org** is the recommended initial Infrastructure Adapter (Vercel Hobby), not a required dependency

**Notes:** Applies to hosting, schedulers, storage, messaging, cloud services, and future infrastructure choices; see [DEPLOYMENT.md](DEPLOYMENT.md)

### D080 — A6 Owner approval of a Task Suggestion creates an **unassigned Task** only

**Status:** Approved

**Decision:** A6 Owner approval of a Task Suggestion creates an **unassigned Task** only. A6 must not create TaskAssignment, issue a Capability, send assignment email, Gmail-forward, or create a Follow-up Schedule. If `ApproveTaskSuggestionRequest` includes `recipientId`, reject with HTTP 400 and stable error code `RECIPIENT_HANDOFF_NOT_AVAILABLE`. Recipient handoff remains A7 via `POST /api/v1/tasks/{taskId}/handoff` (D037, D090). Acknowledgement enum value is `suggestion_approved` (not `assignment_approved`)

**Notes:** Complements D008, D037, D070, D077, D090; A8.0 follow-up wording aligned with D095. See [API_CONTRACT.md](API_CONTRACT.md)

### D081 — **Gmail-origin CommunicationEvent processing and suggestion linkage (partially superseded):**

**Status:** Superseded in part

**Decision:** **Gmail-origin CommunicationEvent processing and suggestion linkage (partially superseded):** Authoritative linkage for an automated A6 suggestion derived from a CommunicationEvent remains nullable `TaskSuggestion.sourceCommunicationEventId` (do **not** denormalize `CommunicationEvent.suggestionId`). Processing state, attempts, policy version, and claim leases live on CommunicationEvent. JSON `sourceReference` is not a uniqueness mechanism. **Idempotency intent preserved:** Owner-initiated interpretation uses unique `(organizationId, idempotencyKey)` plus request-fingerprint conflict detection (D161); automated A6 processing continues to use CommunicationEvent claim/lease/process-state infrastructure. Proposal cardinality must not be used as the interpretation-idempotency mechanism.

**Notes:** Amended 2026-08-09 (Stage 3 governance reconciliation, documentation only). **Superseded in part by D161** (cardinality). **Withdrawn clause:** the “zero or one TaskSuggestion per CommunicationEvent” product invariant; it is **removed from the active text above** rather than annotated in place (D158). Current cardinality law is **D161** — one interpretation occurrence → 0..N TaskSuggestions. Withdrawn **as product law only:** A6’s historical 0..1 suggestion linkage survives as **preserved compatibility/legacy** automatic Gmail processing (D163), and new shared or product infrastructure must not depend on 0..1 proposal assumptions as product law (D163). **Still operative:** every remaining clause above — relational `sourceCommunicationEventId` linkage without denormalization, CommunicationEvent-owned processing state/attempts/policy version/claim leases, `sourceReference` not a uniqueness mechanism, `(organizationId, idempotencyKey)` plus request-fingerprint idempotency, and the prohibition on using proposal cardinality as the interpretation-idempotency mechanism. Complements D073, D077; A6 claim/lease remains authoritative for automated processing. Schema/table names in this row are current-implementation carriers, not constitutional product naming (D158). **Inert history — not current law (withdrawn by D161; emphasis removed).** The cardinality clause formerly read: “Gmail-origin suggestion idempotency is relational: at most zero or one TaskSuggestion per CommunicationEvent.”

### D082 — TemporaryCommunicationExcerpt `purgeAt` remains a **required concrete deadline** (not null)

**Status:** Approved

**Decision:** TemporaryCommunicationExcerpt `purgeAt` remains a **required concrete deadline** (not null). Workflow association replaces the ingest deadline with a **bounded 30-day safety ceiling** (`associatedAt + 30 days`). Dismiss/merge set `purgeAt = terminalAt + 7 days` (D020). Approve sets `purgeAt = approvedAt + 30 days` once — **not** refreshed while the Task remains active. If the Task stays open beyond that ceiling, A13 may purge the excerpt; derived `summaryPoints` and `sourceReference` metadata remain (D024). Task complete/dismiss (when the excerpt is still present) sets `purgeAt = taskTerminalAt + 7 days`. Already-purged excerpts are never silently restored. There is **no** periodic ceiling-refresh worker in A6. **Multi-proposal sibling entitlement (D161):** when multiple sibling proposals (or resulting Tasks) derive from the same imported source excerpt, one sibling must not prematurely shorten another sibling’s still-valid retention entitlement. The excerpt survives for the **maximum still-valid entitlement** across those siblings, while preserving concrete `purgeAt`, permitted shortening when aggregate entitlement shrinks, and irreversible purge once purged. Do **not** create a second retention system. Owner-authored manual capture raw input is **not** TemporaryCommunicationExcerpt content (**D162**).

**Notes:** Amended 2026-08-09 (Stage 3 governance reconciliation, documentation only). Refines D020, D078; multi-proposal sibling rule aligns with D161. See [DATA_RETENTION.md](DATA_RETENTION.md).

### D083 — Merging a Task Suggestion into an existing Task requires dual-resource optimistic concurrency (D045)

**Status:** Approved

**Decision:** Merging a Task Suggestion into an existing Task requires dual-resource optimistic concurrency (D045): suggestion `If-Match` header **and** required body field `targetTaskIfMatch` (target Task strong ETag). Missing either precondition → 428; stale suggestion or target Task → 412. Merge must not append to a stale Task

**Notes:** Extends D045; OpenAPI `MergeTaskSuggestionRequest`

### D084 — A6 suggestion generation runs only via authenticated internal endpoint `POST /api/v1/internal/suggestions/process` (`InternalCronBearer` / `CRON_SECRET`), invoked by an External Scheduler (D079)

**Status:** Approved

**Decision:** A6 suggestion generation runs only via authenticated internal endpoint `POST /api/v1/internal/suggestions/process` (`InternalCronBearer` / `CRON_SECRET`), invoked by an External Scheduler (D079). Generation must not run inside the Gmail History sync/poll transaction and must not roll back or rewind successful A5 ingestion or History cursor advancement (D075). System audit attribution follows the D074 pattern (`systemId` for suggestion processing)

**Notes:** Complements D074, D075, D077, D079

### D085 — A6 requires deterministic heuristic relevance filtering **and** LLM extraction via `packages/ai` for events that pass the filter

**Status:** Approved

**Decision:** A6 requires deterministic heuristic relevance filtering **and** LLM extraction via `packages/ai` for events that pass the filter. Heuristic-only completion is insufficient to close A6. When AI is disabled or extraction fails, do **not** create a fallback TaskSuggestion; record `failed_retryable` or `failed_permanent` on the CommunicationEvent. Production verification of the LLM path is required before A6 closes

**Notes:** Complements D008, D036, D077; supersedes WORKFLOWS wording that treated AI as optional for A6

### D086 — A Task/Assignment may have only **one active Recipient capability** at a time

**Status:** Approved

**Decision:** A Task/Assignment may have only **one active Recipient capability** at a time. Reassignment or an explicit re-forward **revokes** the previous active capability and issues a new one. Revoked capability records and audit history are preserved. An old capability link must fail safely with a non-sensitive **“no longer active”** result (exact HTTP/ErrorCode in A7.1). Ordinary retry of the **same** failed delivery reuses the same handoff attempt and capability unless the Recipient or security-sensitive assignment details changed

**Notes:** Closes OPEN #21. Complements D055–D056, D063

### D087 — Recipient addresses for handoff come only from **Owner-managed Recipient records** in the database

**Status:** Approved

**Decision:** Recipient addresses for handoff come only from **Owner-managed Recipient records** in the database. A7 may add **minimal** Recipient management: list active Recipients, create/update a Recipient, and mark a Recipient inactive. No general contact-management/CRM feature. Do **not** use a hard-coded email or an environment-variable default Recipient as the production model

**Notes:** Closes OPEN #7. Refines former D029 “secure config” framing for production handoff

### D088 — A Gmail-origin handoff must **not** send a knowingly incomplete forward

**Status:** Approved

**Decision:** A Gmail-origin handoff must **not** send a knowingly incomplete forward. If the original message or any required attachment cannot be fetched or assembled, **do not send**. Record a privacy-safe failed delivery attempt and expose a clear **retryable** error to the Owner. Never report partial delivery as full success

**Notes:** Closes OPEN #9. Refines D042

### D089 — A7 does **not** create Follow-up Schedules, Follow-up Engine scheduler jobs, Follow-up Attempts, or Event Notification Engine processing

**Status:** Approved

**Decision:** A7 does **not** create Follow-up Schedules, Follow-up Engine scheduler jobs, Follow-up Attempts, or Event Notification Engine processing. A7 establishes an Assignment that reaches delivery `sent` for A8 to consume (D092, D095). The A7 confirmation UI may disclose that follow-up belongs to the assignment workflow, but must **not** claim a Follow-up Schedule is active or that follow-ups are being sent while A8 is not operational. Phase 1 interval confirmation is A8 product law (D095), not an A7 acceptance criterion. A8 owns the Follow-up Engine and Event Notification Engine (D095–D101)

**Notes:** Amended in A8.0 and A8.1. Retires “reminder and escalation” framing. Separates D037 disclosure from A8 engines. **A8.1:** the Phase 1 interval clause in this row is obsolete — presets are retired (D102) and schedules are Task-scoped (D104); the operative rule is that **A7 creates no Reminder Schedule and sends no reminder**, and must not claim one is active

### D090 — Recipient handoff is a **Task-level** Owner mutation planned as `POST /api/v1/tasks/{taskId}/handoff`

**Status:** Approved

**Decision:** Recipient handoff is a **Task-level** Owner mutation planned as `POST /api/v1/tasks/{taskId}/handoff`. Suggestion approval remains separate and continues producing an **unassigned** Task (D080). The server chooses Gmail-forward versus ordinary assignment-email behaviour from the Task source. The mutation requires concurrency protection (`If-Match` / D045) and a required **idempotency key**. Exact OpenAPI schemas are authored in A7.1, not A7.0

**Notes:** Complements D037, D080, D045

### D091 — Recipient handoff must pass through the D037-confirmed handoff operation (D090)

**Status:** Approved

**Decision:** Recipient handoff must pass through the D037-confirmed handoff operation (D090). `POST /api/v1/tasks` must **not** provide a second silent production assignment path. Existing create-with-`recipientId` behaviour is **deprecated** and must be **rejected** once A7 implementation lands. Preserve the distinction between Task creation and Recipient handoff

**Notes:** Complements D080, D090. A4 create-with-recipient remains until A7 implementation

### D092 — Assignment delivery outcomes are `pending`, `sent`, and `failed`

**Status:** Approved

**Decision:** Assignment delivery outcomes are `pending`, `sent`, and `failed`. A `pending` or `failed` delivery must **not** expose an actionable Recipient capability. Validate Task, Recipient, Gmail authorization, source message, and attachment availability **before** attempting delivery. Persist a durable handoff/delivery attempt and one capability, attempt delivery, then **activate** the Assignment only after Gmail accepts the send. On failure, preserve retryable state without claiming successful handoff. Retrying the same attempt must not send duplicates or issue unnecessary additional capabilities. Prefer a distinct **HandoffAttempt** / **AssignmentDeliveryAttempt** persistence concept rather than overloading `TaskAssignment` with all attempt history (exact schema in A7.3+)

**Notes:** Complements D086, D088, D090. `AssignmentDeliveryStatus` is a real delivery model, not a permanent placeholder

### D093 — A7 Gmail OAuth retains `gmail.readonly` and adds `gmail.send`

**Status:** Approved

**Decision:** A7 Gmail OAuth retains `gmail.readonly` and adds `gmail.send`. Do **not** request `gmail.modify` unless a later implementation spike proves it necessary and a new Decision is recorded. Existing readonly connections may continue polling. A7 handoff requires explicit Owner re-consent when `gmail.send` is missing and must return a clear **insufficient-scope** result

**Notes:** Refines D070 for A7 outbound mail (D016). Closes A5 “send deferred” note

### D094 — A7 supporting boundaries

**Status:** Approved

**Decision:** A7 supporting boundaries: (1) `NEXT_PUBLIC_APP_URL` is sufficient for A7 capability links—custom domain does not block A7 (OPEN #3 no longer blocks A7; OPEN #3 remains for A15 hostname / custom-domain questions). (2) Thin Owner confirmation UI only—no broad dashboard redesign. (3) Initial delivery may run synchronously with size/runtime safeguards and architecture that can later move to a worker. (4) Outbound summaries use existing Task `summaryPoints`—no fresh LLM during handoff. (5) Both Gmail-origin forwards and non-Gmail assignment emails use the Owner’s connected Gmail account. (6) `proposedRecipientHint` may map to `proposedRecipientId` only via **deterministic** match to an active Recipient—never auto-assign; fuzzy match is not authority. (7) Owner/self work remains unassigned—no Recipient capability or assignment email. (8) Handoff idempotency uses a required request idempotency key **plus** the persisted Gmail provider message ID

**Notes:** Complements D037, D086–D093. Does not close OPEN #3

### D095 — **Follow-up Engine (A8.0):**

**Status:** Superseded in part

**Decision:** **Follow-up Engine (A8.0):** AI may **recommend** follow-up behaviour; AI must **not** create, activate, or send a Follow-up Schedule without explicit Owner authority. Deterministic application rules own the sends

**Notes:** A8.0 Decision Lock. **Superseded in part by D102–D107 (A8.1).** Superseded clauses: the **trigger and cadence model** — Assignment-scoped scheduling, the Phase 1 preset intervals (24h / 48h / 72h / 1 week), the delivery-`sent` clock start, the Phase 2 standard interval, and the “retires due-date models” clause. Withdrawn clauses are **removed from the active text above**. **Still operative:** AI may recommend but must never create, activate, or send a schedule without explicit Owner authority; deterministic application rules own sends. Operative product rule is now [WORKFLOWS.md](WORKFLOWS.md) §10a (D102–D110). Complements D027, D037, D089, D092. Supersedes operative meaning of historical D026 overdue/CC model. **Inert history — not current law (withdrawn by D102–D107; emphasis removed).** Formerly read: “time-driven, Assignment-scoped Recipient follow-ups. Phase 1 — Initial Follow-up Delay: at handoff the Owner confirms one initial interval from the approved presets 24 hours, 48 hours, 72 hours, or 1 week. The Phase 1 clock starts only when Assignment delivery is `sent` (D092)—never while `pending`, `failed`, ambiguous, or awaiting reconciliation. The initial interval is used once (not a repeating cadence). Phase 2 — Standard Follow-up Interval: after the first Follow-up Attempt is successfully delivered, subsequent attempts use the system standard interval (internal configuration; default 24 hours; not Owner-configurable in v1). Phase 2 continues while the Assignment remains active and follow-up eligible (D096). Retires due-date / first-overdue / escalation A8 models.”

### D096 — **Follow-up Schedule invariants:**

**Status:** Superseded in part

**Decision:** **Follow-up Schedule invariants:** (6) Old scheduler invocations or delayed jobs must **not** reactivate or advance a terminated schedule. (7) Ending **delivery** eligibility includes at minimum: Task completed; Task dismissed; Assignment returned to Owner; capability or Assignment terminated; other terminal Assignment states (definitions: [GLOSSARY.md](GLOSSARY.md), [ARCHITECTURE.md](ARCHITECTURE.md)). Delivery failure before `sent` must not create an active delivery

**Notes:** A8.0. **Amended and superseded in part by D104 (A8.1): scheduling is now Task-scoped, not Assignment-scoped.** Superseded clauses: (1) schedule belongs to one Assignment; (2) at most one active schedule per Assignment; (3) schedules never transfer; (4) reassignment terminates the schedule; (5) a new Assignment requires a new Phase 1 interval. Withdrawn clauses are **removed from the active text above**. **Still operative:** stale/delayed scheduler work must not advance an invalidated schedule (now enforced by the generation check, D104); the eligibility-ending list (Task completed, Task dismissed, Assignment returned, capability/Assignment terminated) still ends **delivery** eligibility (D107); delivery failure before `sent` still creates no active delivery. Under D104 one **Task-scoped** schedule survives reassignment and sends no backlog. Complements D086, D092. **Inert history — not current law (withdrawn by D104, with D107; emphasis removed).** (1)–(5) formerly read: “(1) A Follow-up Schedule belongs to one Assignment, not generally to a Task or Recipient. (2) At most one active Follow-up Schedule per Assignment. (3) Schedules never transfer between Assignments. (4) Reassignment immediately terminates the prior Assignment’s schedule. (5) A new Assignment requires a new Owner-confirmed Phase 1 interval.” (7) formerly framed the schedule as existing “only while its Assignment is active and follow-up eligible” and listed “Assignment reassigned” among eligibility-ending events; both are withdrawn under D104, whose Task-scoped schedule survives reassignment.

### D097 — **Waiting and Follow-up Schedules:**

**Status:** Superseded in part

**Decision:** **Waiting and Follow-up Schedules:** Waiting **suspends** the active Follow-up Schedule. Do **not** preserve or resume a partially elapsed timer. No complex elapsed-time accounting

**Notes:** A8.0. **Preserved in A8.1 (D107).** Waiting remains the **only** suspension mechanism (D101); no separate pause control is introduced. The “no partial elapsed time” principle is preserved and simplified: because occurrences are anchored to the due **date** rather than to an elapsed interval, resume recomputes the **next future 09:00 organization-local occurrence** with no backlog. **Superseded in part by D102–D104:** the Phase 1 / Phase 2 restart mechanics are **withdrawn** and have been **removed from the active text above**. **Still operative:** Waiting suspends the active schedule, a partially elapsed timer is never preserved or resumed, and no complex elapsed-time accounting is performed. Complements D095–D096. **Inert history — not current law (withdrawn by D102–D104; emphasis removed).** The restart mechanics formerly read: “When waiting ends: if the first Follow-up Attempt was already successfully delivered, begin a fresh Phase 2 interval from resume time; if the first Follow-up Attempt has not yet been successfully delivered, begin a fresh Phase 1 interval from resume time using the same Owner-confirmed Phase 1 preset.”

### D098 — **`dueAt` independence:**

**Status:** Superseded

**Decision:** **`dueAt` independence:** Task `dueAt` is optional, informational, AI-extracted when clearly present, Owner-editable, and useful for display/summary context only. The Follow-up Engine must **never** use `dueAt` as a scheduling input. Retained derived labels such as `due_soon` / `overdue` are **display-only** and must never trigger follow-ups, alter cadence, escalate, CC the Owner, or create/modify an Assignment

**Notes:** **Superseded by D102 (A8.1).** An explicitly Owner-selected Task due date is now the authoritative deterministic scheduling input for the automatic advance reminder and daily overdue reminders (D102–D106). Derived `due_soon` / `overdue` labels are no longer display-only. Historical wording retained verbatim above; operative rule: [WORKFLOWS.md](WORKFLOWS.md) §10a

### D099 — **Event Notification Engine (A8.0):**

**Status:** Superseded in part

**Decision:** **Event Notification Engine (A8.0):** event-driven Owner notifications, **separate** from the Follow-up Engine. Follow-up Attempts go to the **Recipient**. Event Notifications go to the **Owner**. Do **not** mix engines via CC/escalation ladders. A8 defines the event architecture and core event list (at minimum: Recipient completed Task; clarification requested; Assignment returned to Owner; assignment delivery failed; Gmail disconnected; capability expired). **A8 Owner delivery channel:** email via the Owner’s connected Gmail account. **FCM/push remains deferred (D017)** and is an A9 concern. Retires first-overdue reminders, escalating stages, and Owner CC ladders as A8 target behaviour

**Notes:** A8.0; Owner Gmail email channel confirmed at A8.0 commit approval. **Superseded in part by D102 and D106 (A8.1)** — and **only** where overdue sends are restored: the closing-clause item retiring “overdue-threshold-driven sends” is **withdrawn** and has been **removed from the active text above**, because due-date-anchored Recipient overdue reminders are restored (D102, D106). **Still fully operative:** engine separation (Recipient follow-ups vs Owner notifications), the prohibition on CC/escalation ladders and escalating reminder stages, the core Owner event list, the Owner Gmail email channel, and FCM/push deferral. **Extended by D106 and D108:** the Owner event list must additionally cover overdue ceiling reached, permanent reminder-delivery failure, no active assignment requiring Owner action, and schedule entering `requiresOwnerAttention`. Complements D027. Corrects historical D026 Notes. Does not revise D017. **Inert history — not current law (withdrawn by D102 and D106; emphasis removed).** The closing clause formerly read: “Retires first-overdue reminders, escalating stages, Owner CC ladders, and overdue-threshold-driven sends as A8 target behaviour.”

### D100 — **Follow-up Attempt audit history:**

**Status:** Approved

**Decision:** **Follow-up Attempt audit history:** every Follow-up Attempt must leave durable, privacy-safe audit/history sufficient for operator diagnosis, duplicate-send investigation, reassignment safety, scheduler reconciliation, future analytics, and future confirmed learning signals. Distinguish lifecycle outcomes such as scheduled, claimed, attempted, sent/delivered, failed retryable, failed terminal, and cancelled/suppressed—without locking exact DB enum names in A8.0. Do not require retention of complete email bodies; honour existing privacy and retention principles

**Notes:** A8.0. **Preserved and extended in A8.1 (D109):** the same durable privacy-safe history requirements apply to **Reminder Schedules, reminder occurrences, and reminder delivery attempts**, including skip reasons (for example `advance_window_elapsed`), generation identity, and stop/suspension reasons. Reminder records are **superseded, never deleted or rewritten**. No capability token or capability URL may appear in reminder metadata, audit, logs, or telemetry (D109). Complements D057, D095–D096. See [SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md), [DATA_RETENTION.md](DATA_RETENTION.md)

### D101 — **Snooze disposition (A8.0):**

**Status:** Approved

**Decision:** **Snooze disposition (A8.0):** Owner snooze is **not** part of the Follow-up Engine product model. Waiting is the approved suspension mechanism (D097). Do not introduce a new pause/delay/alternate-cadence feature in A8.0. Historical D060 and existing OpenAPI/domain snooze surfaces remain as temporary contract debt until A8 contract alignment; they must not be treated as A8 product law. At contract alignment, **prefer removing** the snooze endpoint (not a deprecated no-op), with appropriate contract-versioning / client migration

**Notes:** A8.0. **Supersedes D060** for product behaviour. **Preserved in A8.1 (D107):** Waiting remains the only pause mechanism; A8.1 introduces no separate pause, snooze, delay, or alternate-cadence control. Snooze removal preference at contract alignment is unchanged. Complements D095–D097. OpenAPI unchanged in A8.0 and A8.1

### D102 — **Due-date-driven Follow-up Engine (A8.1):**

**Status:** Superseded in part

**Decision:** **Due-date-driven Follow-up Engine (A8.1):** **an explicitly selected Task due date may drive deterministic follow-through on delegated communication work.** A Task may carry an optional due date; when present it is the **authoritative deterministic scheduling input** for Recipient follow-up. Still prohibited: arbitrary recurrence, escalation ladders, Owner CC ladders, silent AI-controlled scheduling, and general calendar management as the product's purpose. AI may **recommend** a due date; only an explicit Owner selection has effect, and AI may never create, activate, alter, or suppress a Reminder Schedule

**Notes:** **A8.1 Decision Lock.** Amends [PROJECT_CONSTITUTION.md](PROJECT_CONSTITUTION.md) Product philosophy. **Supersedes D098** in full. **Supersedes in part D095** (trigger and cadence clauses) and **D099** (only the overdue-send retirement clause). Authoritative product rule: [WORKFLOWS.md](WORKFLOWS.md) §10a. Complements D027, D034. **Amended by D152 (2026-08-07); clause withdrawal completed 2026-08-08:** the former product-scope ceiling on Owner-controlled reminders was withdrawn and has been **removed from the decision text above** rather than annotated in place. Product authority for Owner-controlled Task reminders independent of a Task deadline is **D152**. What remains above is the operative A8 Follow-up Engine rule: an explicitly Owner-selected Task due date is the authoritative deterministic scheduling input for Recipient advance/overdue follow-through; AI may recommend a due date but only explicit Owner selection has effect; AI may never create, activate, alter, or suppress a Reminder Schedule.

### D103 — **Reminder occurrence computation (A8.1):**

**Status:** Approved

**Decision:** **Reminder occurrence computation (A8.1):** the Owner **organization timezone** is the sole scheduling authority. A due date is an organization-**local calendar date**, not an instant, and the Owner selects **no** due time. Every reminder occurrence is **09:00 organization-local** on a specific local calendar date, resolved individually to an absolute instant used for execution and audit. Occurrences **must** be computed with timezone-aware **local-calendar arithmetic**: increment the calendar date, then resolve 09:00 local. Computing occurrences by adding or subtracting fixed 24-hour millisecond intervals (for example `MS_PER_DAY`) is **prohibited**, because the local delivery time must remain 09:00 across daylight-saving transitions. Resolution must use deterministic IANA timezone data and must **never** depend on browser, device, or server machine-local timezone. No reminder-time picker exists: 09:00 is a documented constant, not Owner-configurable data

**Notes:** A8.1. **Preserves and clarifies D034** (`America/Vancouver` as the organization timezone). This decision locks **expected behaviour and proof obligations only** — no specific resolver algorithm is approved as implementation. Required gates: [REVIEW_CHECKLIST.md](REVIEW_CHECKLIST.md)

### D104 — **Reminder Schedule scope and generations (A8.1):**

**Status:** Approved

**Decision:** **Reminder Schedule scope and generations (A8.1):** a Reminder Schedule is **Task-scoped** — at most one per Task — not Assignment-scoped. It survives reassignment and never sends a backlog of missed occurrences. A **material due-date change** (the Owner selecting a _different_ local calendar date) closes the current **generation** truthfully and opens a new one: prior attempts, delivery counts, and audit are preserved and never deleted or rewritten; advance and overdue occurrences are recalculated from the new due date; the new generation begins with an overdue delivered count of **zero**; in-flight work is invalidated by a **generation check** immediately before send; and the Owner-visible surface must disclose that the reminder cycle restarted. Saving the **same** due date is **not** material: it must not create a new generation and must not reset any count. Removing the due date stops the schedule

**Notes:** A8.1. **Amends and supersedes in part D096** — Assignment-scoped becomes Task-scoped. Preserves D096's rule that stale or delayed scheduler work must never advance an invalidated schedule, now enforced by the generation check

### D105 — **Automatic advance reminder and no-retroactive rule (A8.1):**

**Status:** Approved

**Decision:** **Automatic advance reminder and no-retroactive rule (A8.1):** for a Task with a due date, exactly **one** system-generated advance reminder is scheduled for 09:00 organization-local on the calendar day **immediately before** the due date. If that occurrence instant is already in the past when the schedule is established, the advance reminder is recorded as **skipped** with the truthful reason **`advance_window_elapsed`**. The skip decision is made **once, at schedule establishment, and persisted**; a later scheduler run must never retroactively reclassify a legitimately scheduled occurrence. A schedule established **before** 09:00 on the day before the due date may still send that morning. **No** immediate or retroactive advance reminder is ever sent. A Task created on its due date receives **no** advance reminder. A Task created with a due date already in the past receives **no** backlog of missed reminders: only the next future 09:00 overdue occurrence is scheduled, and the omitted interval is recorded once as a truthful audit entry rather than as sends. **Delivery implemented in A8.4b.3**, which resolves what "never retroactively reclassify" means once a worker exists by separating two questions. **Schedule establishment** decides whether the generation has an advance occurrence at all; **occurrence processing** records whether that established occurrence was delivered, skipped as ineligible, or missed because its delivery window elapsed. The ratified window: an advance reminder is deliverable **at or after 09:00 organization-local time on its scheduled calendar day, until that local calendar day ends**, and is **never delivered on or after the due date**. If processing first reaches it after the window has closed, the occurrence is claimed and settled truthfully as **`advance_window_elapsed`** — a delivery outcome, not a re-derivation of the establishment decision, and what stops a schedule reporting `scheduled` for a morning that can never happen. It stays distinct from `skipped_not_eligible`: one means the reminder was owed and missed, the other that the Task stopped needing it. The lower bound is the persisted 09:00 occurrence instant the due scan reads; the upper bound is a **calendar-date comparison in the organization's zone**, not a lateness budget in hours, since the advance day is 23 or 25 hours long in the weeks the clocks shift. The message is the approved reminder email verbatim: D105 is a difference in timing, not in content

**Notes:** A8.1. Complements D102–D104. Truthful audit of skips is required (D100, D109)

### D106 — **Overdue recurrence and delivery ceiling (A8.1):**

**Status:** Approved

**Decision:** **Overdue recurrence and delivery ceiling (A8.1):** while a Task with a due date remains incomplete and eligible, one overdue reminder is scheduled for 09:00 organization-local on **every calendar day strictly after** the due date, with **at most one delivery per local calendar day**. Overdue recurrence stops permanently after **14 successfully delivered overdue reminders within the current schedule generation**. The ceiling counts **only successful overdue deliveries**; it must **not** count retryable failures, permanent failures, skipped occurrences, scheduler claims, or advance reminders. When the 14th successful overdue delivery in the generation completes: future Recipient overdue reminders **stop**; the schedule enters **`requiresOwnerAttention`**; the Owner is notified through the **Event Notification Engine**; and the schedule **never restarts automatically**. Because the ceiling is per generation, only an explicit Owner-authorized material due-date change (D104) resets it — never elapsed time, resume, or reassignment

**Notes:** A8.1. **Supersedes in part D099**, only where overdue Recipient sends are restored; escalating stages, Owner CC ladders, and engine separation remain prohibited. Owner notification is required and gated by D108

### D107 — **Reminder stop, suspension, and attribution (A8.1):**

**Status:** Approved

**Decision:** **Reminder stop, suspension, and attribution (A8.1):** completion stops future reminders; dismissal stops future reminders; **Waiting suspends** reminders and remains the **only** pause mechanism — no separate pause, snooze, delay, or alternate-cadence control is introduced. Resume computes the **next future** 09:00 organization-local occurrence with **no backlog** and no elapsed-time accounting. Removing the due date stops the schedule. Reassignment preserves the Task-scoped schedule and sends no backlog. **No active assignment prevents Recipient delivery**: the occurrence is recorded as skipped and the local calendar day is not consumed. A **permanent** delivery failure suspends further sends for that assignment and raises Owner attention. Automated reminder sends are attributed to a **`system`** actor; Owner scheduling changes are attributed to the **`owner`** actor — an automated send must never be attributed to the Owner as though it were sent manually. Reminder history is **preserved rather than deleted or silently rewritten**. `completed` and `dismissed` remain terminal; A8 introduces **no** reopening behaviour

**Notes:** A8.1. **Preserves D097 and D101** — Waiting remains the only suspension mechanism. Complements D052, D057, D100. Terminal-state rule unchanged (D064)

### D108 — **Reminder production-enablement gate (A8.1):**

**Status:** Approved

**Decision:** **Reminder production-enablement gate (A8.1):** the reminder scheduler and delivery implementation **may** be developed and merged behind a **disabled** production feature flag before the Event Notification Engine is finished. **Production reminder delivery must not be enabled until both the Event Notification Engine and the minimum Owner schedule-status UI are operational.** The Event Notification Engine must support Owner notification for at least: overdue ceiling reached; permanent reminder-delivery failure; no active assignment where Owner action is required; and schedule entering `requiresOwnerAttention`. A Task-page status alone is **not** sufficient, because the Owner must not have to inspect Tasks continually to discover that an automation has stopped. This is a **production-enablement dependency and an A8 closure gate**: no production enablement and no A8 closure claim before both dependencies are operational

**Notes:** A8.1. Complements D099 (Owner Gmail email channel) and D106. Enablement and disablement steps: [DEPLOYMENT.md](DEPLOYMENT.md)

### D109 — **Reminder persistence direction (A8.1, staged):**

**Status:** Approved

**Decision:** **Reminder persistence direction (A8.1, staged):** initial A8 requires **two** distinct durable concepts — (1) a **Task Reminder Schedule** carrying due date, timezone snapshot, generation, status, advance-occurrence disposition, next overdue occurrence, overdue delivered count, and `requiresOwnerAttention`; and (2) **reminder delivery attempts** recording every processed occurrence with its outcome (`sent` / `failed` / `skipped`), truthful skip and failure reasons, generation identity, and a **server-derived** idempotency identity enforced by a **database constraint** rather than application code. A separate table of _planned_ reminder occurrences is **deferred** until Owner-created additional reminder dates are authorized (D110); the initial design must leave a clean extension point for it. Reminder records are **superseded, never deleted or rewritten**. No capability token or capability URL may appear in reminder metadata, audit, logs, or telemetry. **Semantic direction (not yet implemented):** the authoritative due-date representation is an organization-local **calendar date**, while the existing instant-typed `dueAt` is retained temporarily for contract compatibility; exact table, column, and field names are **not** locked here. Existing historical due-date data must **not** automatically activate reminders — explicit Owner opt-in or re-save is required after implementation

**Notes:** A8.1. **Extends D100** to reminder schedules, occurrences, and attempts. **No schema, migration, environment configuration, or field name was approved as implemented by this decision** — that was deliberate, and **D128 (A8.3a) now supplies the layout it withheld**. Contract dispositions: [API_CONTRACT.md](API_CONTRACT.md); retention classes: [DATA_RETENTION.md](DATA_RETENTION.md)

### D110 — **Initial A8 slice excludes Owner-created additional reminders (A8.1 sequencing):**

**Status:** Superseded in part

**Decision:** **Initial A8 slice excludes Owner-created additional reminders (A8.1 sequencing):** this row is **implementation sequencing, not product law** about whether Owner-controlled reminders may exist — that authority is **D152**. The initial A8 slice includes **only** an optional due-date calendar control, the one automatic advance reminder, daily morning overdue follow-up, truthful audit history, safe stopping/suspension/retry/idempotency/scheduler behaviour, and the minimum Owner UI needed to set and view the due date and the system-generated schedule. It **excludes**: preset reminder choices (7-day, 3-day, 48-hour, or any other), Owner-created additional reminders, custom-reminder create/edit/delete routes, custom-reminder UI, a reminder recurrence editor, a reminder-time picker, arbitrary rules, cron expressions, a general calendar manager, a separate pause mechanism, Recipient reminder preferences, Android reminder UI, and AI-controlled scheduling. Owner-created additional **dated** reminders — a custom calendar date chosen with **no** preset options, delivered at the same fixed organization-local morning time — remain **deferred to a separately authorized future slice**. The initial design must preserve a clean extension point but must **not** build their routes, UI, rules, or schema before they are approved

**Notes:** A8.1. Complements D109. **Not authorized to start implicitly**; a future slice needs its own planning/review pass and a new, unused identifier under [ENGINEERING_WORKFLOW.md](ENGINEERING_WORKFLOW.md). **Amended by D152 (2026-08-07); clause withdrawal completed 2026-08-08:** any product-law reading of this row was withdrawn and the product-law framing has been **removed from the decision text above**. What remains is A8 slice sequencing: these surfaces stay outside the initial A8 slice and must not be built until a separately authorized implementation slice. Product authority for the capability itself is **D152**.

### D111 — **P1 milestone scope, platform, and authority (P1.0):**

**Status:** Approved

**Decision:** **P1 milestone scope, platform, and authority (P1.0):** P1 — Application Experience Foundation — is a **distinct milestone** sequenced after A7 and before the remaining A8 implementation slices. It is a **foundation** milestone, **not** cosmetic polish: the Owner web experience layer it establishes does not exist today, because A7.8 deliberately shipped thin Owner surfaces with no application shell. P1's platform is the **existing Owner web surface only** (`/`, `/login`, `/tasks`, `/tasks/{taskId}`) plus the Recipient capability surface (`/c/{token}`) where truthfulness, boundary coverage, and accessibility require it. Native Android application experience — navigation, Compose theming beyond consuming documented rules, startup, offline, and push — remains **A9 by name** and must not be pulled into P1. P1 authorizes only the nine foundation areas enumerated in [MILESTONES.md](MILESTONES.md): Owner application shell; truthful experience states; operational data taxonomy; minimal observability; capability-route telemetry prohibition; shared presentation rules; organization-timezone-aware display; boundary and accessibility coverage; browser-level verification. P1 introduces **no** new business behaviour, feature surface, workflow, permission, state, or audit semantics

**Notes:** P1.0. Resolves the scope gap that previously left P1 defined only as a sequencing line. Detail and acceptance criteria: [MILESTONES.md](MILESTONES.md); architecture: [ARCHITECTURE.md](ARCHITECTURE.md). Governed by D112–D120. Does **not** authorize A8 implementation (D102–D110 remain locked and unchanged)

### D112 — **Truthful experience-state doctrine (P1.0):**

**Status:** Approved

**Decision:** **Truthful experience-state doctrine (P1.0):** the Owner and Recipient interfaces must state what is true about server state at all times. P1 defines shared principles for seven states — **loading**, **empty**, **retryable error**, **ambiguous mutation outcome**, **offline or lost connectivity**, **stale data**, and **mutation in progress**. Binding rules: (1) loading and skeleton affordances are permitted for **reads only**; (2) **no optimistic mutation success** — the interface must never render, imply, or animate a business mutation as succeeded before the server confirms it; (3) an **ambiguous** outcome must be presented as genuinely uncertain and must never be smoothed into either success or failure, preserving the A7 handoff doctrine that a `pending` or ambiguous handoff may or may not have sent; (4) retry must route **through** the existing concurrency and idempotency machinery, never around it, and must distinguish two cases. An **ambiguous or transport retry** — the same logical mutation retried because the client never received a trustworthy result — reuses the **same `Idempotency-Key`** and preserves the **original `If-Match`**, so the server can recognize the durable attempt and replay it rather than re-evaluating the precondition; no "start over with a new key" after a durable attempt. A **confirmed `412 PRECONDITION_FAILED`** is different: the server has established that the supplied version is stale, so the client must **refresh authoritative state and re-present it** before the Owner makes or confirms a new attempt. It must never silently loop on a known-stale `If-Match`, and must never present a confirmed stale conflict as success or as merely transient; (5) **offline** must produce an explicit truthful state with no false success and no permanently stuck in-progress control; (6) **stale** data must be labelled as of a stated time rather than presented as current. Perceived responsiveness may improve; truthfulness may not be traded for it

**Notes:** P1.0. Preserves and generalizes the A7.7 / A7.8 truthful-outcome behaviour (see [ARCHITECTURE.md](ARCHITECTURE.md) A7.5 and A7.8 sections) rather than replacing it. Complements D090, D092. Applies to both Owner and capability surfaces

### D113 — **Operational data taxonomy (P1.0):**

**Status:** Superseded in part

**Decision:** **Operational data taxonomy (P1.0):** four durable classes are distinct and must not be conflated. (1) **Business records** — current operational state of communications, Tasks, Assignments, notes, statuses, Recipients, capabilities, and outcomes; authority: the application system of record; may drive product behaviour. (2) **Audit history** — the truth-preserving record of what actually happened, which Actor performed it under what authority, and whether it succeeded; append-only and superseded rather than rewritten; authority: D057, D074, D100, D109; must never be altered to suit analysis, and must never be derived from telemetry. (3) **Operational telemetry** — health, performance, and reliability measurement answering only _is the application working properly_ (route or operation timing, request failures, retry outcomes, connectivity changes, application and rendering errors, stale-data presentation); it is **not** a business record, **not** audit history, and **not** an AI-learning source; it must **never** drive product behaviour, alter business state, or be promoted into learning input. (4) **Structured learning signals** — purposefully retained representations of meaningful Owner decisions and their outcomes answering _what decision was made, what alternatives existed, and what happened afterward_; they must never rewrite audit history and must never be inferred from low-level click or usage tracking. Governing rules: **operational telemetry must not silently become training data or a learning signal**; **passive behaviour, inactivity, and the absence of a correction must never be interpreted as approval or as a decision**; human corrections are more valuable than passive usage tracking; AI-generated recommendations must remain distinguishable from human-approved decisions and must never become authoritative business facts; collection is **purpose-limited** — sensitive content must not be retained because it might be useful someday; retention rules apply **separately** to source content, audit records, telemetry, and learning signals

**Notes:** P1.0. **Recovers a documentation pass that was requested on 2026-07-28 and never landed**; the four terms did not previously appear in the repository. Definitions: [GLOSSARY.md](GLOSSARY.md); retention classes: [DATA_RETENTION.md](DATA_RETENTION.md); AI boundary: [AI_CONSTITUTION.md](AI_CONSTITUTION.md); privacy boundary: D114. **Superseded in part by D155**, which **withdraws** the clauses deferring structured learning signals to A14 and asserting that P1 captures no learning signal: recording learning evidence is authorized now, and the recorded evidence is dormant. Every prohibition in this row stands unchanged — telemetry is not learning, passive behaviour and the absence of a correction are never approval, and behaviour must never silently change. **No learning tables exist yet** (D110)

### D114 — **Telemetry privacy boundary and capability-route prohibition (P1.0):**

**Status:** Approved

**Decision:** **Telemetry privacy boundary and capability-route prohibition (P1.0):** a **Capability URL contains an authorization secret in its path** (`/c/{token}`). Therefore client telemetry, analytics, performance reporting, error reporting, and logging must **never** transmit, store, or forward a raw `/c/{token}` path, a capability token, or a capability token hash. **Chosen default: capability routes are fully excluded from client telemetry.** Route-template scrubbing is rejected as the default because it would place the secret inside the reporting path at least momentarily and would depend on a scrubbing implementation staying correct forever; full exclusion fails safe. Server-side privacy-safe diagnostics for capability routes remain permitted **only** with the route identified as a static template that never carries the token value. Additionally prohibited from every telemetry, log, metric, and error payload: capability tokens and URLs, OAuth tokens, email bodies and subjects, Task notes and summary text, communication excerpts, attachment content, plaintext Recipient email addresses, MIME, and raw provider error bodies. Non-reversible fingerprints, stable identifiers, categories, counters, and durations remain permitted

**Notes:** P1.0. Extends the existing A7.5 privacy-safe observability contract and D109's reminder-telemetry prohibition to **all** telemetry. Enforced as a test gate, not by review alone (D119). Related: D050, D051, D059, D063, D109; [SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md)

### D115 — **Minimal vendor-neutral observability direction (P1.0):**

**Status:** Approved

**Decision:** **Minimal vendor-neutral observability direction (P1.0):** P1 authorizes an operational-observability **seam** sufficient to later implement four capabilities and nothing broader: (1) **one correlation reference** shared across the user-visible error reference, server diagnostics, and the audit row where an audit row exists; (2) **privacy-safe structured server diagnostics** emitted as JSON to standard output; (3) **route or operation timing**; (4) **detection of failures that would otherwise be silent**. The seam must be **vendor-neutral** — one application-owned interface, so a future hosted or OpenTelemetry backend is an adapter, not a rewrite (Architecture Principle 2). P1 must **not** adopt a commercial telemetry vendor, session replay, behavioural analytics, or third-party tracking. It must build on what already exists rather than replacing it: the per-route `requestId` already minted in route context, the A7.5 privacy-safe handoff observability seam, and the existing database runtime failure classifier. **No schema change is required or authorized:** `AuditEvent` already carries `requestId` and `correlationId` columns with an index; the defect is that the public error envelope discards the route-context identifier and mints a fresh one. No new environment variable, telemetry endpoint, or vendor may be introduced by P1.0 documentation

**Notes:** P1.0. Applies Architecture Principles 2, 3, 4, and 7 (D079) to observability. Payload boundary: D114. Taxonomy: D113. A **health or readiness endpoint is not authorized by P1 and is not a P1 acceptance requirement** — existing session and task smoke checks plus these diagnostics are sufficient, a contract test currently asserts `/health` is absent from the bundled OpenAPI, and a new unauthenticated surface would need its own decision. Recorded as a separately authorized operational proposal

### D116 — **Shared presentation foundation and token-layer limits (P1.0):**

**Status:** Approved

**Decision:** **Shared presentation foundation and token-layer limits (P1.0):** P1 authorizes a **small** shared presentation foundation for exactly five concerns — Task title and summary derivation, status labels, date and timestamp formatting, semantic state presentation, and organization-local date display — scoped to removing existing duplication and supporting later A8 Owner UI. `packages/ui` is **activated as a semantic-token layer only** (colour, type scale, spacing, radius, motion), superseding its previous **Deferred** status in [ARCHITECTURE.md](ARCHITECTURE.md). Explicitly **not** authorized: a general or broad reusable component library; a component beyond what the five existing routes require; Kotlin or cross-platform token generation during P1; arbitrary visual redesign. Tokens must be introduced as a **no-op refactor first** — every token defined with a value identical to the current hardcoded value, references swapped and verified — before any token **value** changes, so visual change is traceable. **Cross-platform reality (documented, not deferred):** what A9 can realistically inherit is **product and presentation rules**, **semantic token values**, and **contract enums**; what A9 **cannot** inherit directly is React components, TypeScript formatter implementations, and browser-specific interaction code. Android parity is therefore achieved by re-implementing documented rules against shared token values, not by sharing code

**Notes:** P1.0. Amends the `packages/ui` row in [ARCHITECTURE.md](ARCHITECTURE.md) from Deferred to tokens-only-authorized; the package does **not** yet exist and P1.0 creates no code. Satisfies Implementation Rule #3 (no silent architecture change). Complements D007 and D046: generated contract enums remain the cross-platform type source

### D117 — **Organization-timezone-aware Owner web display (P1.0):**

**Status:** Approved

**Decision:** **Organization-timezone-aware Owner web display (P1.0):** the Owner web interface must render dates and timestamps using the **configured Owner organization timezone** (`America/Vancouver`, D034) and must **never silently depend on the browser, device, or server machine-local timezone**. Displayed dates must state the timezone where ambiguity is possible. This is **presentation infrastructure only**. P1 must **not** implement, pre-empt, or redefine the A8 scheduling resolver: **D103 remains the sole authority** for reminder calendar arithmetic, local-calendar occurrence computation, the 09:00 organization-local constant, and daylight-saving behaviour. A P1 display formatter must not be used as, or grow into, a scheduling resolver

**Notes:** P1.0. Prevents a foreseeable rewrite: the current interface formats timestamps inconsistently across Owner and Recipient surfaces, and a browser-timezone formatter would have to be replaced at A8.6. Derived `due_soon` / `overdue` display labels are rendered through this formatter ([ARCHITECTURE.md](ARCHITECTURE.md) § Domain state model) and remain non-scheduling

### D118 — **Owner attention and operational-status shell location (P1.0):**

**Status:** Approved

**Decision:** **Owner attention and operational-status shell location (P1.0):** the Owner application shell must provide **one generic Owner-level attention and operational-status destination** that future authorized features populate. It must be **generic**, not reminder-specific: P1 must not create reminder navigation, reminder copy, reminder status, or any A8 schedule behaviour. The destination exists so the future **D108** Owner schedule-status surface can be added **without a second shell redesign**, satisfying D108's requirement that the Owner must not have to inspect Tasks continually to discover that an automation stopped. P1 delivers the **location and its navigation affordance**; it does **not** deliver reminder status, and the shell must not claim or imply that any automation, schedule, or notification capability exists while A8 is unimplemented (D089)

**Notes:** P1.0. Direct dependency of D108's production-enablement and closure gate. A8.6 populates this destination; A8 remains unauthorized. If the destination has no content during P1, it must say so truthfully rather than display a fabricated status

### D119 — **P1 verification, closure, and production-evidence requirements (P1.0):**

**Status:** Approved

**Decision:** **P1 verification, closure, and production-evidence requirements (P1.0):** P1 closure requires objective evidence, captured in a defined order. **Baseline before change:** P1.1 must capture a performance and reliability baseline **before** any experience change ships; numeric performance thresholds must then be **ratified from that evidence** rather than asserted in advance, and must distinguish absolute usability thresholds from relative improvement goals. **Boundary coverage:** every current route requires a route loading state, segment error boundary coverage, a global error fallback, and a styled not-found state. **Accessibility gate (proportionate):** **zero serious or critical automated findings** on the current routes, plus **explicit keyboard and focus-flow validation** of both confirmation dialogs including Escape and focus restoration; "zero findings of any severity" is **not** the gate. **Browser verification:** a lightweight browser test layer covers the critical Owner and Recipient journeys, runs as a **separate** job rather than inside `pnpm verify`, and stays separate from unrelated product feature tests; **Playwright is recommended** on toolchain-fit grounds but no vendor is locked. **Structural test gates:** exactly one Owner authentication call per Owner page request; a documented and asserted maximum database round-trip count per route; and an automated assertion that no capability token or raw capability path can appear in any telemetry, log, or error payload (D114). **Negative closure criteria:** no new business behaviour; no schema, migration, OpenAPI, or generated-client change; no Android implementation change; no A8 runtime implementation; no audit-model or mutation-truthfulness change; A4–A7 production regression checks re-pass unchanged; `pnpm verify` green. Any production observation window must state the risk it proves and why its duration is proportionate

**Notes:** P1.0. Full criteria: [MILESTONES.md](MILESTONES.md); review gates: [REVIEW_CHECKLIST.md](REVIEW_CHECKLIST.md). **Dark mode is not a P1 closure requirement** — no existing decision or product authority requires it; contrast must pass in the shipped theme, and a dual-theme slice needs separate authorization

### D120 — **Product name resolved — the product is Rocket Communicator (closed):**

**Status:** Approved

**Decision:** **Product name resolved — the product is Rocket Communicator (closed):** the current product name is **Rocket Communicator**. The original working name survives only as **repository provenance** in already-shipped artifacts (repository and package namespace `@aicaa/*`, Android application id and `app_name`, OpenAPI `info.title`, existing web copy and their tests); provenance is not product identity. Renaming those artifacts is **implementation work** requiring its own authorized slice — it is not authorized by this closure, and no contract, metadata, or string change is implied here

**Notes:** **Closed 2026-08-08 by Owner decision** (product identity: **D153**). Raised in P1.0 and previously **Open**; the earlier "keep the existing official name during P1" default is withdrawn and removed from the decision text above. OPEN #22 in [OPEN_QUESTIONS.md](OPEN_QUESTIONS.md) is closed. Current product identity lives in [PROJECT_CONSTITUTION.md](PROJECT_CONSTITUTION.md). Renaming shipped artifacts (OpenAPI `info.title`, Android `app_name`, web copy, package namespace) remains unauthorized implementation work; no branding language beyond the product name is invented here

### D121 — **`/attention` is the Owner attention and operational-status destination (P1.4):**

**Status:** Approved

**Decision:** **`/attention` is the Owner attention and operational-status destination (P1.4):** the D118 destination is implemented at the path **`/attention`**, inside the `(owner)` route group and therefore authenticated exactly like every other Owner route. The name is deliberately **generic** rather than `/status`, `/reminders`, or `/queue`, so the future D108 Owner schedule-status surface can populate it without a second shell redesign and without renaming a URL an Owner may have bookmarked. In P1.4 it is **truthfully empty**: it performs no database query, holds no Task queue, renders no count, tracks no schedule, and states explicitly that it does not monitor anything and that nothing on it updates on its own. An empty page that hints at invisible machinery is worse than no page at all, because the Owner would rely on a safety net that does not exist. It contains **no** A8 operational data

**Notes:** P1.4. Implements D118. Must remain compatible with D089 while A8 is unimplemented

### D122 — **`America/Vancouver` is the Owner display-timezone constant (P1.4):**

**Status:** Approved

**Decision:** **`America/Vancouver` is the Owner display-timezone constant (P1.4):** the D117 organization display timezone is implemented as a **documented TypeScript constant**, `OWNER_DISPLAY_TIME_ZONE` in `apps/web/lib/presentation/datetime.ts`, and is the single authority for Owner date and time presentation. It is deliberately **not** a database field — no `Organization` model or timezone column exists, and P1.4 must not add one — and deliberately **not** an environment variable, because an env-var timezone can differ between the server that renders a date and the operator reading a log, and a typo would silently change what every timestamp means. This is correct **only while the application serves a single organization**; multi-organization support requires its own decision and a schema change. An unsupported zone must fail loudly at module load rather than degrade to machine-local time

**Notes:** P1.4. Implements D117; inherits the zone from D034. Presentation only — **not** the A8 scheduling resolver (D103). The P1.4 gap (`/c/{token}` rendering Recipient-local timestamps) was **closed in P1.5**; the capability surface now uses the same deterministic organization-timezone presentation

### D123 — **`POST /auth/sign-out` sits outside `/api/v1` (P1.4):**

**Status:** Approved

**Decision:** **`POST /auth/sign-out` sits outside `/api/v1` (P1.4):** Owner sign-out is a browser-navigation concern, not part of the versioned product contract, so it follows the existing `/auth/callback` precedent and lives at **`/auth/sign-out`**. Consequently **no OpenAPI path, schema, or generated TypeScript/Kotlin client changed.** It exports **POST only** and no `GET` handler: `next/link` prefetches, so a GET sign-out URL would end the Owner's session merely because they viewed a page linking to it. The shell submits a **native form** and never links to the route. It revokes the session **server-side** at Supabase rather than clearing visible UI state, and redirects **303** — not 307, which would replay the POST against `/login`

**Notes:** P1.4. Implements the sign-out affordance required by the D111 shell area

### D124 — **`packages/ui` is tokens-only, with no build step (P1.4):**

**Status:** Approved

**Decision:** **`packages/ui` is tokens-only, with no build step (P1.4):** the D116 package contains exactly one `tokens.css` plus `package.json` and `README.md`. It contains **no** React component, hook, button, badge, card, navigation primitive, route logic, auth logic, or Task logic, and **no `.ts`/`.tsx`/`.js` file at all. It has no dependency, no `build`/`lint`/`test` script, and therefore required **no root workspace script change** — one CSS file does not justify a compiled JavaScript output. All React components remain in `apps/web`. Token extraction was a **verified no-op**: every value was introduced equal to the literal it replaced at commit `34d048e7`, pinned individually by test, so any later visual change is traceable. Radius `0` and motion `none` **record** the current square, static interface rather than reserving space for a redesign

**Notes:** P1.4. Implements D116. Still **no** Kotlin token generation in P1 (D116)

### D125 — **The Task title is the Task-detail `<h1>` (P1.4):**

**Status:** Approved

**Decision:** **The Task title is the Task-detail `<h1>` (P1.4):** `/tasks/{taskId}` renders the Task's **derived title** as its single page heading, replacing the literal word "Task". A heading of "Task" reads identically for every Task in browser history, in a bookmark, and to a screen reader, and therefore identifies nothing. One shared helper, `apps/web/lib/presentation/task-title.ts`, derives it for the Task list and Task detail: the first summary point that actually **carries text** (skipping empty leading points), truncated for display at 120 characters, falling back to `Task {id.slice(0, 8)}` — **byte-identical to the pre-P1.4 fallback**. Titles that previously used an empty first point or exceeded 120 characters therefore change; the fallback itself does not. This is an intentional change to an accessible name, so affected assertions were updated rather than relaxed

**Notes:** P1.4. Implements the shared-presentation portion of D116. The `/c/{token}` copy of the helper remains until P1.5, since the capability surface is touched last

### D126 — **P1.4 adds no filters, counts, grouping, sorting, or attention queue:**

**Status:** Approved

**Decision:** **P1.4 adds no filters, counts, grouping, sorting, or attention queue:** Task presentation in P1.4 is **visual only** and uses **only existing Task DTO fields**. Status, urgency, assignment, delivery, and date labels are a presentation mapping over values the API already returns; **no new Task state, urgency rule, authorization rule, or workflow rule was introduced**, and the Task list order is exactly what the server returned. `due_soon` and `overdue` are presented as **due-date facts only** and must never be described as reminder automation, because they are derived at read time and nothing is wired to them while A8 is unimplemented (D089). Note-bound wording states what **was shown** ("Showing up to the 100 most recent notes.") rather than claiming more notes exist, because knowing that for certain would require truncation metadata on the response — an OpenAPI change outside P1.4 scope

**Notes:** P1.4. Constrains D116 presentation work. Filters, grouping, counts, and a populated attention queue remain unauthorized and each require their own decision

### D127 — **Local-calendar reminder time computation (A8.2):**

**Status:** Approved

**Decision:** **Local-calendar reminder time computation (A8.2):** reminder occurrences are computed from organization-**local calendar dates** — canonical `YYYY-MM-DD` values validated as real Gregorian dates — plus a documented wall-clock hour, and **never** by adding fixed 24-hour durations. `MS_PER_DAY`, the literal `86400000`, and `addMilliseconds` are prohibited in the reminder modules and the prohibition is enforced by a source guard, because a fixed day offset is correct on 363 days a year and silently moves 09:00 to 08:00 or 10:00 across a daylight-saving transition. Every occurrence is resolved to an instant through an **explicit IANA timezone argument**: no default, no fallback, and no read of the process or machine-local zone anywhere in the scheduling path. Resolution uses the runtime's IANA-backed `Intl.DateTimeFormat`, so **no timezone dependency is added**. Candidate instants are verified by reading their local wall-clock fields back rather than trusting an offset, which makes both transition cases deterministic by construction: a wall time **skipped** by a forward transition resolves to the first valid instant at or after it — located by a **bounded** halving search that throws a typed domain error rather than guessing when it cannot converge — and a wall time **repeated** by a backward transition resolves to the **earlier** of its two instants. The scheduling constant `REMINDER_SCHEDULING_TIME_ZONE` is deliberately a **separate symbol** from the presentation constant `OWNER_DISPLAY_TIME_ZONE` (D122) even though both currently hold `America/Vancouver`: one decides when a reminder fires and the other only what string an Owner reads, so collapsing them would let a display change silently reschedule production sends

**Notes:** A8.2. Implements D103 and supports D104–D106 as **pure domain logic only** — no schema, contract, scheduler, delivery, or UI. Restates the boundary D117/D122 draw from the scheduling side. Guard: `apps/web/__tests__/reminder-no-fixed-day-arithmetic.test.ts`. Evidence: `packages/domain/__tests__/reminder-occurrence.test.ts` and `reminder-schedule.test.ts`, passing under `TZ=UTC`, `TZ=Asia/Tokyo`, and `TZ=America/New_York`

### D128 — **Reminder persistence layout (A8.3a):**

**Status:** Approved

**Decision:** **Reminder persistence layout (A8.3a):** D109 deliberately withheld schema approval and left table, column, and field names unlocked; this decision locks the layout that implements it, and nothing more. Two tables exist: `task_reminder_schedules`, at most one per Task via a **unique** `task_id` (D104), carrying the canonical due date, the IANA **timezone snapshot** the occurrences were resolved in, generation, status, stop reason, advance disposition, next overdue occurrence, per-generation overdue delivered count, `requires_owner_attention`, and claim-lease columns; and the append-only `reminder_delivery_attempts`, one row per processed occurrence with its truthful outcome and skip or failure reason. Occurrence **idempotency is server-derived and enforced by a unique index** on `(schedule_id, generation, occurrence_kind, occurrence_local_date)` — there is deliberately **no caller-supplied idempotency key**, because identity _is_ the occurrence, so there is no key to reuse with conflicting inputs and no way to replay an identity into a second row. **Clarified by the A8.3a audit:** this prevents duplication, not fabrication. The occurrence fields are still arguments to repository primitives, so they must be derived and validated by trusted application code; a future HTTP API must never let a client choose the organization, generation, occurrence kind, occurrence date, or occurrence instant independently. Persistence resolves the owning organization from the referenced Task or schedule rather than from the caller's assertion, and refuses a caller that claims a different one (`reminder-scope-guard.ts`). A **second partial unique index** over successful rows enforces D106's at-most-one-delivery-per-local-calendar-day. It is scoped to the schedule and the local day and deliberately **not** to the generation — the implemented interpretation of D106, whose text does not scope the per-day rule — so a material due-date change cannot license a second send on a morning the Recipient already heard from us. Local calendar dates are stored as canonical `VARCHAR(10)` **text**, never Postgres `DATE`, because Prisma surfaces a `DATE` column as a `DateTime` and would reintroduce exactly the instant-versus-calendar-date confusion D103 exists to remove; a column CHECK enforces canonical shape and month/day range while real Gregorian validity is enforced at the persistence boundary by the A8.2 `parseLocalDate` on **every write and every read**, since Postgres requires CHECK expressions to be IMMUTABLE and the text-to-date cast is not. `tasks.due_local_date` is added **nullable and never backfilled** from `due_at`, so no historical Task became reminder-eligible (D109). The database is the backstop for product law that would otherwise be convention: the overdue count is bounded at the D106 ceiling, a stopped schedule may not retain a future occurrence, a skip must carry a reason, a failure code may not accompany a success, and the claim-lease columns move together. Repositories store facts and derive none — occurrences and the current instant arrive as arguments — and a source guard fails the build if a reminder persistence module reads a clock, resolves a timezone, performs day arithmetic, or restates the ceiling

**Notes:** A8.3a. Implements D109 and supports D104–D107; supplies the schema D109 and ARCHITECTURE explicitly left unapproved. Persistence only — **no** worker, scheduler, cron, delivery, Gmail, Event Notification, API, contract, feature flag, or UI. Migration: `20260731040000_a8_reminder_persistence` (additive, forward-only, deny-by-default RLS). Guard: `packages/db/__tests__/a8-reminder-persistence-boundary.test.ts`. Evidence: `packages/db/__tests__/a8-reminder-persistence.test.ts`, `a8-migration-from-baseline.test.ts`, `a8-reminder-boundary-hardening.test.ts`, and the A8.3a section of `schema.test.ts`. **Audited before A8.3b**; the organization-coherence, local-date, and error-fidelity findings are remediated, RLS is deny-by-default for RLS-subject roles while the application's owning role bypasses it (so organization isolation is application-enforced, as it is for every other table), and the worker-slice findings are tracked under A8.4a. Current migration application state belongs to [DEPLOYMENT.md](DEPLOYMENT.md)

### D129 — **Repeated ambiguous reminder outcomes stop delivery (A8.4b):**

**Status:** Approved

**Decision:** **Repeated ambiguous reminder outcomes stop delivery (A8.4b):** three **consecutive terminal ambiguous overdue** reminder outcomes within one reminder schedule generation stop reminder delivery for that schedule. An ambiguous outcome means the transport could not determine whether the provider accepted the message, and D106 requires it to be treated as delivered so a Recipient never hears about the same morning twice — which means every ambiguous outcome consumes a local calendar day and delivers nothing anybody can confirm. One is bad luck. Three in a row is a system quietly spending a Recipient's attention budget on messages that may not exist, and the Owner is the only party who can find out which. The mechanism uses the **existing `stopped` status** with a new stop reason **`repeated_ambiguous_outcomes`** and `requiresOwnerAttention = true`. It deliberately introduces **no new suspended state** — Waiting is the only suspension mechanism (D097, D107), and Waiting auto-resumes, which is exactly wrong here — and **never auto-resumes**: only a material Owner due-date change may open a new generation and with it a new series. The consecutive count is **derived from the append-only `reminder_delivery_attempts` history** at settlement time, and **no ambiguous counter is ever stored**. A stored count is a second source of truth that can disagree with the history it summarizes, can be incremented twice by a retry, and cannot be recomputed after a repair; the history is already authoritative, already immutable, and already loaded by the settlement transaction that evaluates D106's ceiling. Stopped schedules retain their full occurrence history and remain available to the Event Notification surface

**Notes:** A8.4b. Extends D106–D108. **Runtime enforcement implemented in A8.4b.2.** Evaluated at the occurrence-to-schedule settlement boundary, inside the transaction that already holds the Task lock and applies the schedule effect exactly once, so the threshold is never judged from state that has since moved. The counted unit is the **final occurrence outcome**, never a raw provider attempt: one occurrence retried three times is one outcome. A confirmed send or a permanent failure — including retry-budget exhaustion, which is recorded as a permanent failure and counted as the one it was recorded as — **breaks** the run. A **skip neither counts nor breaks it**, because no provider was contacted and it therefore says nothing about whether sends arrive. A retryable or still-claimed occurrence is invisible until it finishes. History is read as a **bounded window of three**, scoped to the schedule's current generation and ordered by scheduled occurrence identity rather than settlement time, so a late or swept settlement cannot reorder the run and a new generation resets it by definition rather than by a reset operation. `repeated_ambiguous_outcomes` added to `TaskReminderStopReason` by migration `20260802210000_a8_4b2_repeated_ambiguous_stop_reason` (additive enum value), with OpenAPI and both generated clients regenerated. Evidence: `packages/db/__tests__/a8-4b2-consecutive-ambiguity.test.ts`, `a8-4b2-ambiguous-stop-reason-migration.test.ts`, `apps/web/__tests__/a8-4b2-ambiguity-stop.test.ts`, and the D129 block in `a8-4a-occurrence-concurrency.pg.test.ts`

### D130 — **Reminder emails contain no capability link (A8.4b):**

**Status:** Approved

**Decision:** **Reminder emails contain no capability link (A8.4b):** a reminder email carries **no capability URL, no token, no encrypted URL, no reminder-specific capability, no redirect endpoint, no `/c/` path, and no Task URL**, and instructs the Recipient to use the **original assignment email** to open or act on the Task. The alternative was rejected on two grounds rather than one. A capability is a **bearer secret delivered exactly once**, and only an HMAC of it is stored (D109), so a reminder could carry a link only by **minting a new capability per reminder** — multiplying live credentials by up to fourteen per Task, each independently revocable and independently leakable — or by adding an **unauthenticated redirect surface**, which is a new attack surface introduced for convenience. Neither is justified by a nudge. **Capability state is nevertheless evaluated before any reminder transport call**, from the canonical capability row and in the **same snapshot** as the Task, assignment, due date, and schedule: when no actionable original capability exists — missing, expired, revoked, never activated by an accepted send, or already consumed — the occurrence is **skipped truthfully** with reason **`no_actionable_capability`**, **no provider call is made**, and the result is **not** classified as a transport failure. Sending anyway would spend one of D106's fourteen local calendar days instructing somebody to follow a link that cannot work. A reminder **never** mints a capability, rotates one, changes an expiry or revocation, or resends the assignment email. Because summary points are authorized content _derived from a real communication_ and can legitimately contain a URL, every rendered line is **URL-redacted** and both MIME bodies are **asserted link-free before the message is emitted**; a body that cannot be rendered safely produces a truthful non-retryable failure rather than a message that breaks this decision. Future **actionable** reminder links are deferred and require their own decision

**Notes:** A8.4b. Implemented in A8.4b.1. Extends D089, D106, D109, D114; changes **no** A7 capability, handoff, or assignment-email behaviour. Skip reason migration: `20260802173000_a8_4b1_capability_skip_reason` (additive enum value). Evidence: `apps/web/__tests__/a8-4b1-reminder-email.test.ts`, `a8-4b1-reminder-transport.test.ts`, `a8-4b1-reminder-delivery.test.ts`

### D131 — **Rocket is the sole system of record; the scheduler only wakes it and Gmail only carries the message (A8/A9):**

**Status:** Approved

**Decision:** **Rocket is the sole system of record; the scheduler only wakes it and Gmail only carries the message (A8/A9):** the application is the **sole source of truth** for Tasks, Task state, Reminder Schedules, reminder state, reminder policy, reminder history, delivery outcomes, and Owner-attention state. No external product is authoritative for, independently governs, or overrides any of it. The **External Scheduler is a wake-up mechanism only** (D079): it may invoke an authenticated endpoint on a cadence, and it decides **nothing** — not which reminders are due, which Tasks are eligible, whether a reminder is sent, whether a schedule is active, waiting, stopped, or otherwise inactive, nor delivery counts, ceilings, generation changes, retry policy, or Owner-attention state. Rocket re-evaluates current state on **every** invocation, so a missed, late, or duplicated invocation changes no outcome. **Gmail is a delivery transport only** (D093, D099): it owns no reminder scheduling, reminder state, reminder policy, retry policy, reminder history, stop condition, Task state, or capability state. Its authorization and MIME infrastructure are reused deliberately, and it must never be described as the reminder engine. **No third-party task engine is part of A8 or A9** — not Google Tasks, Microsoft To Do, Apple Reminders, Google Calendar as a task or reminder engine, nor any equivalent. Such products may be named **only** as explicitly excluded architectural alternatives, never as planned dependencies, fallback systems, competing authorities, or future requirements. Any future productivity integration would require its own separately approved milestone, must not replace Rocket as the source of truth. Copying is not the prohibition; **competing authority** is. A future projection, export, backup, reporting store, analytics replica, cache, or integration may hold Rocket data provided it remains subordinate to Rocket — reading from it, never governing it — and does not become a second task or reminder engine

**Notes:** Records boundaries the implementation already honours; **documentation-only** and changes no runtime behaviour. Consistent with Architecture Principles 1, 2, 6, and 7 and with D079 (app-owned engines, replaceable infrastructure adapters). Adds, removes, renames, reorders, and rescopes **no** milestone and authorizes no integration work

### D132 — **Rocket is online-first; graceful connectivity loss is a reliability requirement, not offline sync (A9 and later):**

**Status:** Approved

**Decision:** **Rocket is online-first; graceful connectivity loss is a reliability requirement, not offline sync (A9 and later):** Rocket is an **online-first** application. It is **not** building an offline-first task engine, a local-first synchronization system, an offline store of authoritative business records, or a general-purpose conflict-resolution layer, on any platform. What is required instead is that a **temporary** loss of connectivity degrades safely: the interface stays stable and truthful; in-progress drafts are preserved where appropriate; duplicate actions are prevented; a write that did not reach the server is **never** presented as successful; status is truthful when an outcome is unknown; retry is deliberate and safe **through** the existing idempotency and concurrency machinery rather than around it; and recovery of connectivity never produces duplicate Task mutations. No surface may claim that the application works offline, and a preserved local draft is never a completed server write. This extends D111 and D112 from the Owner web surface to **A9**, which remains the Android Owner experience over the online Owner APIs

**Notes:** A reliability requirement, **not** an offline feature and **not** approval of offline sync. Offline storage of business records, service-worker caching of authenticated business data, mutation queues, background synchronization, and conflict resolution remain **out of scope** (D111). Adds **no** A9 slice and changes no milestone scope or sequencing. Concerns Rocket Communicator only. It governs this product and no other: a separate application that is legitimately offline-first is unaffected, and D132 must never be cited against one

### D133 — **Owner Event Notification taxonomy, durable intent, and capture boundary (A8.5):**

**Status:** Approved

**Decision:** **Owner Event Notification taxonomy, durable intent, and capture boundary (A8.5):** the Event Notification Engine notifies the Owner about **exactly ten** canonical event types, each triggered by a committed state transition and each named in full: `task.completed_by_recipient`, `task.clarification_requested`, `task.returned_to_owner`, `handoff.delivery_failed`, `gmail.disconnected`, `capability.expired`, `reminder.schedule.stopped.ceiling_reached`, `reminder.schedule.stopped.permanent_failure`, `reminder.schedule.stopped.repeated_ambiguous`, and `reminder.no_active_assignment`. No broad category such as “task updated” exists, and an audit row is **not** a reason to send mail: Task creation, ordinary assignment and reassignment, handoff prepared, handoff sent, standalone Recipient notes, Waiting entered, Waiting resumed, Task dismissed, Recipient deactivation, and the whole suggestion lifecycle are **excluded**, because each is either Owner-initiated — telling the Owner what the Owner just did is noise — or operational detail belonging to the D118 attention surface rather than to email. Digests, notification preferences, and push remain out of A8.5 (D017). **Notification intent is a distinct durable record written in the same database transaction as the triggering mutation, never derived from the audit log.** `AuditEvent.action` is a free-form `VARCHAR(64)` with no enum, the table has no monotonic ordering column, and several paths write it outside the mutation transaction, so it can record what happened without being able to say what is owed; overloading it would also confuse audit truth with delivery workflow state. Identity is **server-derived** and enforced by the database — `(organizationId, eventType, subjectKind, subjectId, occurrenceKey)` with a unique constraint and **no caller-supplied idempotency key**, following D109's reasoning that a duplicate invocation should collide on an index it cannot forge. Two events are refined so repetition stays truthful: `handoff.delivery_failed` produces intent **only** when the failure is non-retryable or the existing handoff retry budget is exhausted, never for a transient failure Rocket still expects to recover; and `reminder.no_active_assignment` produces **at most one** intent per reminder schedule generation, enforced by the identity rather than by application care. **`capability.expired` is retained in A8.5 rather than deferred.** Expiry is presently observed only when somebody presents the token, so an untouched capability remains `active` past `expiresAt` indefinitely and the ratified event would never fire; A8.5d therefore adds a narrow database-backed sweep that finds active capabilities whose `expiresAt` has passed, conditionally transitions each to expired, appends the truthful audit event, and creates the intent **in one transaction**, idempotent under overlapping worker invocations and never dependent on a Recipient clicking a dead link. The intent and attempt tables are the **operational** source of truth for notification processing; terminal outcomes additionally append concise system-attributed audit events, and the two records are not merged

**Notes:** A8.5 documentation Decision Lock. Implements the D099 core event list and its D106/D108 extension; complements D109 (server-derived identity) and D131 (Rocket is the sole system of record). No engine code exists when this is recorded. Slice map: A8.5a persists intent and instruments one producer, A8.5d completes coverage and adds the capability-expiry sweep

### D134 — **Owner notification destination, and D130's scope (A8.5):**

**Status:** Approved

**Decision:** **Owner notification destination, and D130's scope (A8.5):** an Owner Event Notification is addressed to `CommunicationAccount.emailAddress` for the **event's own organization**, provider `gmail`, in the connected state, and satisfying the existing mailbox-domain validation — trusted persisted identity written only by the OAuth connect transaction after Google verified the mailbox. **No Owner email column, no organization notification-address column, no destination environment variable, and no Task-derived or Recipient-derived destination** is introduced. The Owner's sign-in email lives in Supabase Auth and is unavailable to a scheduler-invoked worker that holds no session, and a destination environment variable would be an unaudited channel to an arbitrary address — which is the failure D029 named and rejected. The destination is **not persisted on the intent row**: it is resolved from the account at delivery time, so a mailbox disconnected since the event cannot be mailed from a stale copy. **D130 is scoped to Recipient reminder emails and does not govern Owner mail.** Its whole subject is the capability bearer secret — delivered once, stored only as an HMAC (D109), and therefore impossible to put in a reminder without minting a second credential or adding an unauthenticated redirect. An Owner authenticates with a session against `NEXT_PUBLIC_APP_URL`, not with a bearer capability, so a link to an authenticated Owner surface such as a Task page or `/attention` is not a credential, requires ordinary Owner authentication, and is not forbidden. That permission is recorded now and exercised by no A8.5a work. An Owner event email must nevertheless **never** contain a capability token, capability URL, `/c/` path, token hash, encrypted capability URL, temporary Gmail excerpt, Recipient-controlled free-text note body, quoted clarification text, or assignment bearer credential; those prohibitions descend from D109 and D114 and are independent of D130. A Recipient note body is untrusted input that would otherwise arrive in the Owner's inbox under Rocket's own attribution, so an Owner notification **states the event and identifies the Task rather than quoting it**

**Notes:** A8.5 documentation Decision Lock. Clarifies D130's scope without amending D130; extends D109 and D114; honours the principle D029 recorded before it was superseded. Destination resolution is implemented in A8.5c, not A8.5a

### D135 — **Owner notification delivery policy and production gating (A8.5):**

**Status:** Approved

**Decision:** **Owner notification delivery policy and production gating (A8.5):** an Owner Event Notification is a **one-shot delivery of a single event, not a series**, and reminder series policy does not transfer to it. A retryable transport failure is retried to a maximum of **three total attempts**, after which the notification becomes terminal and requires Owner attention. An **ambiguous outcome is terminal on first occurrence and never retried**, because the provider may already have accepted the message and a duplicate Owner email is a worse untruth than a late one; it likewise requires Owner attention. **D129's three-consecutive-ambiguity stop and D106's fourteen-successful-delivery ceiling do not apply**, and neither do reminder generations as delivery policy, Waiting suspension, the at-most-one-delivery-per-local-calendar-day rule, nor the no-backlog rule. Every one of those governs a repeating series addressed to a Recipient; there is no series here to stop, suspend, or bound, and copying them would invent rules with no referent. Each event stands independently. **Two independent feature flags gate the engine, both exact-string `true`, both unset everywhere.** `ENABLE_OWNER_EVENT_CAPTURE` gates creating intent and **must be evaluated before any mutation transaction opens**: when this was locked, A8 migrations were unapplied in Production while the capture site sat inside transactions that run there on every Task mutation, so a conditional insert against a missing table would have broken production Task mutations — the pre-transaction rule remains binding now that the tables and capture code are in Production at `D3` / `F0` with the flag still absent. `ENABLE_OWNER_EVENT_DELIVERY` gates all worker database access and transport construction — with it unset nothing is claimed, no attempt row is written, no Gmail adapter is constructed, and no provider is contacted. Separating them exists so capture can be enabled and observed against real traffic before anything is ever sent. **A backlog cannot later flush:** an otherwise deliverable intent older than **24 hours** at processing time is terminalized as suppressed for staleness, with a truthful reason preserved for the Owner surface and **no provider call**, so enablement order cannot produce a burst of mail about last week. Completing A8.5 **authorizes no production delivery of anything** — D108 requires both this engine and the minimum Owner schedule-status UI, and A8.5 delivers one of the two

**Notes:** A8.5 documentation Decision Lock. Deliberately declines to inherit D129 and D106; preserves D108's production-enablement and closure gate; consistent with D131 (a missed or duplicated wake-up changes no outcome). `ENABLE_OWNER_EVENT_CAPTURE` lands in A8.5a; `ENABLE_OWNER_EVENT_DELIVERY` and the staleness horizon land in A8.5b

### D136 — **Rocket-generated message marker and Gmail self-ingestion exclusion (A8.5):**

**Status:** Approved

**Decision:** **Rocket-generated message marker and Gmail self-ingestion exclusion (A8.5):** because an Owner Event Notification is sent **from the connected Gmail mailbox to that same mailbox**, Gmail labels each one both `SENT` and `INBOX`, and A5 ingestion admits any message carrying `INBOX` that is not `DRAFT`, `SPAM`, or `TRASH` (D068). Left alone, every Owner notification would be ingested, given a temporary excerpt, and offered to A6 as a Task Suggestion — Rocket manufacturing work out of its own mail. The exclusion is a **narrow, deterministic marker Rocket places on its own generated messages**: a fixed custom header, `X-Rocket-Generated: owner-event-notification`, emitted by the controlled MIME builder, which continues to admit **no caller-defined headers**. Two broader exclusions were considered and rejected. Excluding every message labelled `SENT` would silently narrow D068 for **all** self-sent mail, including a message the Owner genuinely sends themselves and expects to be ingested. Excluding every message whose sender equals the connected account reaches the same outcome by another route, and additionally makes ingestion depend on comparing addresses rather than on a fact Rocket controls and can assert. The marker is the only mechanism authorized here, and it excludes only what Rocket itself generated

**Notes:** A8.5 documentation Decision Lock. Narrows D068 ingestion by one deterministic marker and nothing else; changes no A5 label rule, no A6 suggestion policy, and no A7 outbound path. Implemented in A8.5c; the exact header spelling may be adjusted to repository naming conventions provided the semantics stay this narrow. Not exercised by A8.5a or A8.5b

### D137 — **P2.0 — Owner Experience Foundation is documentation-only (P2.0):**

**Status:** Approved

**Decision:** **P2.0 — Owner Experience Foundation is documentation-only (P2.0):** P2.0 establishes the **Product Constitution** for the next phase of Rocket. It answers “What kind of product are we building?” and locks mission, Owner-experience principles, roadmap sequencing, Owner Acceptance Week, P2.2, and the A9.2 capture boundary. P2.0 authorizes **no** Android implementation code, **no** API or OpenAPI change, **no** production contact, **no** feature-flag change, and **no** A8 operational enablement. Architecture is **not** redesigned. A0–A8.6, P1, Gate 6, production safety, documentation, evidence, contracts, and architecture remain valid. Its product law now lives in [PROJECT_CONSTITUTION.md](PROJECT_CONSTITUTION.md) and its sequencing in [MILESTONES.md](MILESTONES.md).

**Notes:** Completes the P2.0 documentation lock with D138–D144. Sequencing only where D140 applies.

### D138 — **Core mission — Owner's trusted external memory (P2.0):**

**Status:** Approved

**Decision:** **Core mission — Owner's trusted external memory (P2.0):** Rocket exists to become the Owner's **trusted external memory**, allowing them to **capture, organize, assign, and follow through** on real work from their **Android phone** with confidence throughout an ordinary day. Rocket **replaces the Owner's follow-through habit**. It does **not** replace Gmail, Messages, or the Phone app. It **remembers what must happen next**. The prior communication-action mission wording in [PROJECT_CONSTITUTION.md](PROJECT_CONSTITUTION.md) is retained as how that mission is served and is not deleted.

**Notes:** Amends Project Constitution product mission; see Amendment history 2026-08-05.

### D139 — **Product Constitution principles and feature filter (P2.0):**

**Status:** Approved

**Decision:** **Product Constitution principles and feature filter (P2.0):** binding Owner-experience principles are: (1) **mobile is the primary product experience, and Android is the first native client** — web is a synchronized, optional companion for administration, review, debugging, and fallback (wording amended by **D153**; the Android-first sequencing is unchanged); (2) **external memory, not an inbox replacement**; (3) **truth over automation**; (4) **capture before complexity**; (5) **one-handed first**; (6) **simple by default**; (7) **every feature must justify its existence**. Future features should answer whether they make it easier for the Owner to capture, organize, assign, or follow through on real work during an ordinary day; if not, they likely belong later. These principles do not weaken D112 truthfulness, D008 approval-before-task, D038 voice-never-creates-Tasks, or AI law.

**Notes:** Clarifies and strengthens D002 / D111 Android-primary intent for the forward path without rewriting D111's historical P1 clarification.

### D140 — **Intentional roadmap re-sequencing after Gate 6 (P2.0):**

**Status:** Superseded in part

**Decision:** **Intentional roadmap re-sequencing after Gate 6 (P2.0):** A8 operational enablement is **not** the immediate next path, and the long-range shorthand **A7 → A8 → A9** with **no early separate A9.0** is superseded **for sequencing of next work only**. Milestone identifiers are not renumbered. Completed A8/P1/Gate work remains valid. A8 operational enablement remains **prepared but unauthorized and unbegun** and is **not** started by this decision. Architecture, contracts, and production procedures are unchanged except for documented supersession notes.

**Notes:** Sequencing supersession only. Does not authorize any A8 enablement step or flag change. **Clauses withdrawn:** the named order `P2.0 → A9.0 → A9.1 → A9.2 → A9.3 → Owner Acceptance Week → P2.2 → Stage 12 → A8.7d → A8.7e → A10+` no longer binds — A9.0–A9.3 are delivered, Owner Acceptance Week is deferred (D159), current direction is AI-first capture and interpretation (D154, D156, D157, D160), and the labels "Stage 12", "A8.7d", and "A8.7e" are **retired**. Current sequencing: [MILESTONES.md](MILESTONES.md) § Forward sequence.

### D141 — **A9 slice map and A9.2 Android Task Capture (P2.0):**

**Status:** Approved

**Decision:** **A9 slice map and A9.2 Android Task Capture (P2.0):** A9 is delivered as **A9.0** (Android Owner foundation), **A9.1** (Android Owner shell and ordinary-day Task surfaces), **A9.2 Android Task Capture**, and **A9.3** (Android organize, assign, and follow-through). **A9.2 includes** typed capture and Android speech-to-text **into fields**. **A9.2 excludes** the A12 voice pipeline, automatic transcription as a product pipeline, and AI capture. Informal naming “Android Task Creation” is retired in favour of **Android Task Capture**. D038 remains binding. Detailed acceptance criteria for A9.0 / A9.1 / A9.3 are established when those slices are authorized.

**Notes:** Renames and bounds A9.2; introduces named A9.0–A9.3 without renumbering A9. Its exclusions are milestone scope, not a bar on AI-first capture: D154 makes AI-first interpretation the product direction.

### D142 — **Owner Acceptance Week is a formal product gate (P2.0):**

**Status:** Approved

**Decision:** **Owner Acceptance Week is a formal product gate (P2.0):** after A9.3 and before P2.2, Owner Acceptance Week (OAW) is a **formal product gate** with measurable exit criteria: Rocket is the Owner's primary task system during the window; real work is captured daily on Android; at least one real Recipient handoff is completed; external notes are no longer required for ordinary follow-through; usability issues are documented; and the Owner **explicitly** approves (or withholds) resuming **A8 operational enablement**. Silence is not approval (D113). Failing OAW does not authorize skipping ahead to operational enablement.

**Notes:** Strengthens OAW from informal feedback to a gated product checkpoint. Execution timing is deferred by **D159**, and the retired operational-enablement sequencing label is **replaced in place by amendment** with "A8 operational enablement" (D140, D158), preserving the same operative rule. Exit criteria and sequencing live in [MILESTONES.md](MILESTONES.md) § Owner Acceptance Week; a future OAW must prove the current loop rather than the retired direct-create scenarios (D154).

### D143 — **P2.2 — Remove Friction (P2.0):**

**Status:** Approved

**Decision:** **P2.2 — Remove Friction (P2.0):** P2.2 is a roadmap milestone after Owner Acceptance Week. Its purpose is to improve the Android experience using OAW findings — reduce taps, improve wording, navigation, consistency, visual polish, performance, and ergonomics. It authorizes **no** major new features, **no** architecture redesign, **no** inbox replacement, **no** A12 voice pipeline, **no** AI capture, and **no** production delivery enablement by itself.

**Notes:** Inserts P2.2 into the forward roadmap. Its exclusions are milestone scope; AI-first capture is product direction under D154 and needs its own slice. The obsolete "before Stage 12" roadmap-placement wording was removed when D140 moved current sequencing to [MILESTONES.md](MILESTONES.md); D143’s operative milestone scope, purpose, and non-authorization rules remain in force.

### D144 — **Definition of success for broader operational enablement (P2.0):**

**Status:** Approved

**Decision:** **Definition of success for broader operational enablement (P2.0):** Rocket is considered ready for broader operational enablement when the Owner can confidently manage an ordinary working day using the **Android application** without depending on memory or external notes, while using the **web application** only for administration or fallback. This is a **product readiness** statement. It does **not** by itself authorize A8 operational enablement, production procedures, or feature-flag changes; those retain their own authorization gates, and OAW explicit approval (D142) remains required before resuming that paused path.

**Notes:** Amends Project Constitution success definition; see Amendment history 2026-08-05.

### D145 — **Single Owner authentication pipeline accepts SSR cookies and Bearer JWT (A9.0):**

**Status:** Approved

**Decision:** **Single Owner authentication pipeline accepts SSR cookies and Bearer JWT (A9.0):** Owner identity remains one pipeline — server-verified Supabase `auth.getUser()` plus the existing workspace-domain allowlist and `OWNER_ORGANIZATION_ID` binding. A thin credential-extraction step supplies either (a) the Supabase access JWT from `Authorization: Bearer <jwt>` or (b) the existing SSR cookie session when no Owner Bearer is present. Both paths share the same validation, allowlist, session mapping, and rejection behaviour. This closes the implementation gap with OpenAPI `bearerAuth` / [API_CONTRACT.md](API_CONTRACT.md) without adding a second auth system, without new session DTOs, and without treating Owner JWTs as `InternalCronBearer` / `CRON_SECRET`. `GET /api/v1/session` remains the canonical authenticated API probe after Supabase establishes identity.

**Notes:** A9.0. Aligns server behaviour with the existing contract; no OpenAPI path change.

### D146 — **Android Owner auth transport and lifecycle (A9.0):**

**Status:** Approved

**Decision:** **Android Owner auth transport and lifecycle (A9.0):** The Android Owner app authenticates with **Google Workspace via Supabase Auth** (Custom Tabs + app deep-link return `aicaa://auth-callback`), stores Supabase session tokens in **platform secure storage**, and calls Owner APIs with **`Authorization: Bearer <access_jwt>`**. Android owns presentation only; the server owns identity and authorization (D145). Session restore on launch reuses the stored Supabase session and confirms access with `GET /api/v1/session`. Token refresh is intentionally simple: restore on launch and refresh only when required at startup or when authentication fails naturally — **no** background refresh scheduling, lifecycle refresh services, or proactive token managers. Sign-out revokes at Supabase Auth and clears local credentials (browser `POST /auth/sign-out` remains web-only per D123). Connectivity handling in A9.0 is auth-scoped and online-first (D132): no offline business store. A9.0 delivers the sideloadable authenticated minimum shell only — not Task surfaces (A9.1), capture (A9.2), or organize/assign (A9.3).

**Notes:** A9.0 Android foundation lock. Sign-out scope clarified by **D147**.

### D147 — **Android Owner sign-out is session-local (A9.0):**

**Status:** Approved

**Decision:** **Android Owner sign-out is session-local (A9.0):** Android sign-out uses Supabase **`SignOutScope.LOCAL`**: it revokes **only the current Android Supabase session** and clears platform secure storage on that device. It does **not** terminate web browser sessions or other-device sessions. `SignOutScope.GLOBAL` is rejected for ordinary Android sign-out because it would invalidate the Owner's web admin/fallback session whenever they signed out of the phone — contrary to Android-as-product / web-as-fallback (D139) and to D146's local-credential teardown intent. After LOCAL sign-out, Bearer calls from that device fail authentication; an independent web cookie session remains valid until the Owner signs out on web (`POST /auth/sign-out`, D123). A future explicit “sign out everywhere” control is not authorized by A9.0.

**Notes:** Clarifies D146 sign-out; implementation correction from GLOBAL → LOCAL.

### D148 — **A9.1 authenticated Android networking foundation:**

**Status:** Approved

**Decision:** **A9.1 authenticated Android networking foundation:** A9.1 first delivers the **reusable Owner HTTP networking substrate** on Android — one hand-written OkHttp client (D047), shared `ApiConfig`, centralized request execution/response mapping, Bearer JWT from the existing A9.0 auth/`AccessTokenProvider`, standardized `OwnerApiResult` errors (including OpenAPI `ErrorCode` when present), connectivity awareness (D132), development-safe logging that never records credentials/tokens, and an `OwnerApiRepository` base for future Owner routes. Authentication is **not** redesigned (D145–D147). **Task list, Task detail, Task capture, assignment, offline sync, local business DB, and push remain out of scope** for this authorization. P2.0/D141 ordinary-day Task surfaces stay **not started** and require a later authorized slice before implementation.

**Notes:** A9.1 networking substrate; Task surfaces remain unauthorized.

### D149 — **A9.2 Android Task Capture:**

**Status:** Approved

**Decision:** **A9.2 Android Task Capture:** The first Owner-facing Task feature on Android is **create-only capture**. Guiding principle: never lose a thought because Rocket asked too many questions. Default path is **Capture → Save → server confirmation** with a single free-text field (no required assignment, due date, priority, or recipient). Typed text (and Android IME speech-to-text into that field) maps to one `confirmed_fact` summary point and `POST /api/v1/tasks` through the existing A9.1 `OwnerApiExecutor` / `TaskOwnerRepository` — no second HTTP or auth stack. Success is shown **only** after a server-confirmed create response (`201`). Empty drafts never reach the server. Connectivity failures preserve the draft and stay truthful (D132). Unauthorized after refresh returns the Owner through the existing A9.0 sign-in flow. A lightweight **View Task** secondary action is **omitted** until A9.3 (no Android Task detail infrastructure yet). **Out of scope for A9.2:** Task list, Task detail, assignment, reminders UI, priority UI, recipient picker, AI extraction, voice recording pipeline (A12), offline sync, local business storage, notifications, A8 operational enablement, and A9.3 organize/assign.

**Notes:** A9.2 implementation lock; superseded for post-capture navigation by **D150**.

### D150 — **A9.3 Android organize, assign, and follow-through:**

**Status:** Approved

**Decision:** **A9.3 Android organize, assign, and follow-through:** Android gains Task list (organizational workspace), Task detail (natural continuation after capture), lifecycle mutations (start / waiting / resume / complete / dismiss / note) with Task `If-Match`, and optional Recipient handoff through existing `POST /api/v1/tasks/{taskId}/handoff` only (D037, D090, D091). Capture remains frictionless: **Capture → Save → server confirmation**; success keeps **Capture another** primary, adds progressive **Open Task**, and optional **Assign** — never forces the Task list. Unassigned Tasks are Owner work (D094); no self-assign API. Handoff requires D037 confirmation (`handoff_confirmed_v1`), persists original `If-Match` + `Idempotency-Key` for safe retry, and never claims success before server confirmation (D112, D132). Gmail connection / send-reconsent states are truthful; re-consent completes in the Owner web browser with **manual** in-app retry (no auto-send). Thin Recipient create is allowed only to unblock ordinary handoff (D087); full Recipient CRM, reassignment, reminders UI/delivery, notifications, push, offline sync, local business DB, A8 operational enablement, and A10+ remain out of scope. Auth (A9.0) and networking (A9.1) are not redesigned.

**Notes:** A9.3 implementation lock; OAW is deferred (D159).

### D151 — **P2.2a — People is the planned first friction-removal slice after OAW (planning only):**

**Status:** Approved

**Decision:** **P2.2a — People is the planned first friction-removal slice after OAW (planning only):** Within **P2.2 — Remove Friction** (D143), the first planned product-shaped slice is **P2.2a (“People”)**. Approved direction: keep Task list order as `updatedAt` DESC then `id` DESC (recency never replaced by alternate sorts); add a **People** filter (**Everyone** / **Me** / individual Recipients) that is **server-side**, resets pagination on change, and keeps cursor pagination truthful (no client-side filtering across partial pages); make Recipient **display names** the primary human identifier (email secondary); remember the last People filter **locally on Android only** (no server preference store), and restore it by starting a **fresh first page** rather than reusing a stale cursor. Design principle: Rocket should reduce decisions, not create them — prefer fewer choices/screens/controls while preserving truthful information. Explicitly **not** in P2.2/P2.2a: alphabetical or other Task sorts, search, Recipient pages, kanban, dashboards, CRM, server-synced preferences (future backlog unless OAW proves necessity). Simple workload counts beside filter options are a **future enhancement**, not minimum P2.2a. **This Decision is documentation/planning only.** It does **not** authorize implementation, OpenAPI/contract/database/Android/web changes, feature flags, or production contact. It does **not** advance past Owner Acceptance Week (D142) or reorder D140. This row is the canonical statement of the P2.2a direction; the separate planning document has been deleted.

**Notes:** Planning lock only. OAW execution is deferred by D159. Amended to absorb the one current detail from the deleted P2.2a planning document (restoring a remembered filter starts a fresh first page); no clause withdrawn.

### D152 — **Owner-controlled Task reminders authorized (product governance):**

**Status:** Approved

**Decision:** **Owner-controlled Task reminders authorized (product governance):** the former D102 product-scope ceiling on Owner-controlled Task reminders independent of Task deadlines is **permanently withdrawn**, and that clause has been removed from D102's active text. Rocket remains primarily a **trusted external memory, task, assignment, and follow-through system**; reminders are one capability within that system and do not redefine the mission. **Product model:** a Task may have **zero or one deadline** and **zero or multiple Owner-controlled reminders**; deadline and reminder are separate — a deadline answers when work needs to be done; a reminder answers when Rocket should bring the Task back to the Owner's attention; both may coexist or either may exist alone. **Does not redesign A8:** the existing due-date-driven Follow-up Engine (advance/overdue Recipient reminders, Waiting, completion/dismissal stops, reassignment, delivery gating — D103–D109 and related) remains valid as one reminder/follow-through mechanism and is **not** deleted or redesigned by this Decision; those A8 rules are no longer the constitutional ceiling on all reminder functionality. **Not an implementation authorization:** this Decision does **not** authorize schemas, APIs, UI, workers, flags, cron jobs, delivery, or any build of an Owner-created reminder subsystem; existing `TaskReminderSchedule` remains the A8 due-date engine, and future Owner-controlled multi-reminders still need architecture/design in a separately authorized slice. **AI authority unchanged and reinforced:** Owner may manually create reminders; AI may organize proposed Tasks; AI must **not** invent reminder times or silently schedule reminders; future AI reminder suggestions require a separately approved product decision. Escalation ladders, Owner CC ladders, and general calendar management as the product's purpose remain prohibited

**Notes:** **Product-governance supersession only (2026-08-07).** **Supersedes in part D102** (its former product-scope ceiling on Owner-controlled Task reminders; that clause has been removed from D102's text). **Clarifies / supersedes in part D110:** Owner-created reminders are not product-law-forbidden; D110 remains the A8 initial-slice sequencing exclusion (not yet implemented; needs its own authorized slice and design work). Does **not** authorize implementation, Production contact, feature flags, cron jobs, or delivery. Amends [PROJECT_CONSTITUTION.md](PROJECT_CONSTITUTION.md) — see Amendment history. Authoritative current A8 engine rules remain [WORKFLOWS.md](WORKFLOWS.md) §10a

### D153 — **Product identity — Rocket Communicator (product law):**

**Status:** Approved

**Decision:** **Product identity — Rocket Communicator (product law):** the product is **Rocket Communicator**, a **mobile-first trusted external memory and follow-through system**. Layered identity: **native mobile** owns Owner attention, capture, review, notifications, and device integration; the **Rocket backend** owns canonical Task truth, shared intelligence, synchronization, Gmail, assignment, and follow-through; **AI interpretation** provides constrained structured interpretation; **web** is a synchronized, optional desktop/web companion; **Android** is the **first** native client; **iPhone** is a **planned subsequent** native client using the same backend intelligence and Task system. **Mobile is the primary product experience; Android is the first native client** — this replaces the earlier Android-primacy phrasing, which is retired as product wording without changing the Android-first sequencing that produced it. The original working name is **repository provenance only** (D120)

**Notes:** Owner decision 2026-08-08 (documentation only). Amends [PROJECT_CONSTITUTION.md](PROJECT_CONSTITUTION.md) product identity and philosophy. **Closes D120.** Not an implementation authorization: no rename of shipped artifacts, no iPhone roadmap, no milestone authorization, no architecture redesign. iPhone sequencing detail is deliberately not specified here

### D154 — **Owner authority and AI-first manual capture (product direction):**

**Status:** Approved

**Decision:** **Owner authority and AI-first manual capture (product direction):** **AI proposes; the Owner decides.** Manual typed or dictated capture is intended to be **AI-first**: Owner natural-language input is interpreted **before** a canonical Task exists. One input may yield **zero, one, or multiple** independent proposed Tasks. The **first-pass interpretation is context-free** — it must not inject prior Owner preferences, prior Owner edits, assignment history, or previously created Tasks. The Owner reviews the proposals; **only Owner acceptance produces a canonical Task**, and acceptance carries exactly one responsibility selection — _who is responsible for this Task_ (**D164**). The shipped **A9.2 direct Owner capture path was valid for that milestone and is INTERIM CURRENT IMPLEMENTATION, not permanent product architecture**

**Notes:** Owner decision 2026-08-08 (documentation only). **Not an implementation authorization**: no schema, API, prompt, UI, worker, flag, or Android change is authorized, and nothing in A9.2 is retracted or reworked by this row. Complements D008, D038 (approval before a Task exists) and D141/D149 (A9.2 as shipped). AI law: [AI_CONSTITUTION.md](AI_CONSTITUTION.md). **Amended by D164 (2026-08-11, documentation only):** the Keep-for-me / Assign terminology and interaction framing was **replaced in place by amendment** with the unified responsibility selection under D164, preserving the same operative rule. Every other D154 principle remains operative: AI-first capture, 0..N proposals, context-free first pass, Owner acceptance as the only creator of canonical Tasks, and AI proposes / the Owner decides. **Amended by D169 (2026-08-11):** controlled S3 implementation authority for shared interpretation + Owner manual capture is granted by **D169** within its stated boundaries; this row remains product-direction law and does not itself authorize surfaces D169 excludes (including Android proposal UI and Owner interpretation HTTP). **Amended by D170 (2026-08-11):** the narrow Owner manual-capture HTTP/API surface + generated public contracts are authorized by **D170** within its stated S3.2 boundaries; Android proposal UI and every other surface D170 does not lift remain unauthorized here. **Amended by D171 (2026-08-12):** controlled S3.3 Android capture-to-proposal integration is authorized by **D171** within its stated boundaries (including read-only capture-result proposal display); full proposal-lifecycle UI and every other surface D171 does not lift remain unauthorized here

### D155 — **Observation now, personalization later (learning evidence):**

**Status:** Approved

**Decision:** **Observation now, personalization later (learning evidence):** Rocket is **authorized to record learning evidence now**. Evidence is **dormant**: it must **not** alter prompts, personalize first-pass interpretation, auto-assign, silently modify behaviour, or feed online training. **Personalization is deferred** and requires its own approved decision. Evidence recording is **no longer deferred to A14**. **Proposal revision evidence:** TaskSuggestion remains the mutable operational proposal head; Rocket must also preserve **append-only proposal revisions**. Revision 0 is the immutable AI-authored proposal **as presented to the Owner**. Later Owner edits append revisions. The finally accepted content revision must be identifiable. Do **not** use AuditEvent as the revision/evidence store. **What counts as the initial AI proposal (revision 0):** evidence records what Rocket actually presented to the Owner, not every provider-internal field. MUST retain `summaryPoints`. Retain when actually part of the presented proposal: `proposedDueAt`, `proposedPriority`, and resolved `proposedRecipientId`. Do **not** require durable preservation merely because the provider produced them: `peopleHints`, `proposedRecipientHint`, standalone `deadlineExpression`. Provider raw JSON, prompt text, diagnostic fingerprints, token metadata, retries, and other provider intermediates are **not** learning evidence. Where grounded deadline meaning must be presented, use declared proposal/summary-point semantics — do not hide undeclared fields in SourceReference. **Responsibility-selection evidence:** the durable concept is that the **Owner affirmatively selected a responsible party** — the **Owner** or a **Recipient** (D164). It must **never** be inferred from the presence or absence of TaskAssignment or any other operational persistence artifact: **operational representation is not affirmative evidence**, so the canonical Task that proposal approval creates with no active external assignment (D080) is not evidence that the Owner chose themselves. **Selection is not delivery:** a selection is true when the Owner makes it, while delivery of access to a selected external Recipient stays authoritative in existing TaskAssignment / capability / HandoffAttempt infrastructure; a failed handoff must not falsify the selection, and a selection must not imply delivery. **Selection is not accepted content revision:** _what_ content the Owner accepted and _who_ is responsible are independent concerns — changing responsibility does not by itself create a content revision, editing content does not determine responsibility, and neither collapses into a generic acceptance outcome. No `kept | assigned` enum, Keep/Assign outcome table, custody model, or TaskAssignment replacement is required; the persistence representation stays deliberately **unsettled**. The D155 record is historical learning/evidence truth about the Owner's **initial** decision at acceptance only — not Task operational state, custody state, an assignment state machine, a replacement for TaskAssignment, or a record of every later reassignment/return (those remain authoritative in existing TaskAssignment/handoff/audit infrastructure).

**Notes:** Amended 2026-08-09 (Stage 3 governance reconciliation, documentation only). Owner decision 2026-08-08 origin preserved. **Preserves every D113 prohibition in full**. Withdraws only D113 clauses that deferred structured learning signals to A14. Complements D080, D161, D162. Retention/minimization: [DATA_RETENTION.md](DATA_RETENTION.md). **Storage/producer note (2026-08-10):** an additive `task_suggestion_revisions` persistence foundation in `@aicaa/db` is authorized and implemented (append-only revision-evidence carrier with `authorKind = ai or owner` only; create/read repository surface; no backfill). **Prospective A6 only:** newly created Gmail-extraction TaskSuggestions record revision 0 (`authorKind = ai`) atomically with create; historical suggestions remain revision-free; duplicate/reclaim writes no revision. This does **not** authorize Owner-edit revision capture, accepted-revision persistence, interpretation/manual-capture revision producers, public API/Android exposure, personalization, prompt mutation, auto-assignment, or online learning. Dormant evidence must not influence AI behaviour. **Amended 2026-08-11 (responsibility-model governance amendment, documentation only):** the Keep/Assign acceptance-evidence clause is withdrawn and replaced by responsibility-selection evidence (D164). No persistence representation is prescribed; responsibility persistence, accepted-revision persistence, and Owner-edit revision capture remain unauthorized.

### D156 — **Email commissioning target (current product target):**

**Status:** Approved

**Decision:** **Email commissioning target (current product target):** **current commissioning target** — a Gmail message reaches a Rocket **intake surface**, the Owner **sees** the message, the Owner **manually** selects **"Review with Rocket"**, and AI interpretation runs only then. The Owner can **Exclude sender**; an excluded sender must not be processed by Rocket AI in future. **No permanent inclusion list is required.** **Future mode:** non-excluded incoming messages may be interpreted automatically — a separately approved change, not current product behaviour

**Notes:** Owner decision 2026-08-08 (documentation only). Three categories must stay distinguishable and must not be blurred in [WORKFLOWS.md](WORKFLOWS.md): **current implementation infrastructure** (A5 polling + preserved A6 automatic path — production-operational and truthfully documented, D077/D084/D085; A6 classified as compatibility/legacy by **D163**), **current product commissioning target** (this row), and **future automatic mode**. Future automatic Gmail intelligence, when approved, should preferentially use the shared interpretation/proposal architecture rather than extend A6 (**D163**). Not an implementation authorization: no intake surface, exclusion store, route, UI, or scheduler change is authorized, and existing A6 behaviour is neither retracted, required to be deleted, nor redescribed as the target

### D157 — **One canonical domain — internal anti-duplication law:**

**Status:** Approved

**Decision:** **One canonical domain — internal anti-duplication law:** there is **one canonical Task domain**, **one shared proposal/candidate path**, and **one shared interpretation capability**. All native and web clients use the **same backend Task and intelligence system**. Existing infrastructure is **evolved rather than duplicated** unless an explicit approved architecture decision replaces it. A parallel Task model, a second proposal pipeline, or a second interpretation stack requires its own approved architecture decision

**Notes:** Owner decision 2026-08-08. **Current implementation names are not product law.** [ARCHITECTURE.md](ARCHITECTURE.md) may identify `TaskSuggestion` and `packages/ai` as the existing implementation infrastructure to evolve; that identification is current-implementation truth and must not be elevated into constitutional product naming (see D158 rank rules)

### D158 — **Authority model and clause-withdrawal rule (governance):**

**Status:** Approved

**Decision:** **Authority model and clause-withdrawal rule (governance):** authority ranks are **1** [PROJECT_CONSTITUTION.md](PROJECT_CONSTITUTION.md) (current product law), **2** [AI_CONSTITUTION.md](AI_CONSTITUTION.md) (AI-specific law, subordinate to rank 1), **3** this register (current binding discrete decisions), **4** domain contracts ([ARCHITECTURE.md](ARCHITECTURE.md), [API_CONTRACT.md](API_CONTRACT.md)/OpenAPI, [SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md), [WORKFLOWS.md](WORKFLOWS.md)), and **below authority** roadmap/milestones, review checklist, deployment, README, glossary, open questions, package READMEs, and history/evidence. A lower-rank document may **describe and enforce** higher-rank law but may **not originate contradictory product law**. **Milestone scope is not permanent product law** unless elevated; **current implementation truth is not automatically permanent product law**; **historical material is never current law**. **A withdrawn clause is removed from the active text**, not annotated in place

**Notes:** Owner decision 2026-08-08. Replaces the previous nine-level authority order in [PROJECT_CONSTITUTION.md](PROJECT_CONSTITUTION.md) and the previous register rule that a decision row body was never to be rewritten. Placement of documents this rank list does not name is recorded in the constitution's authority section

### D159 — **Owner Acceptance Week temporarily deferred:**

**Status:** Approved

**Decision:** **Owner Acceptance Week temporarily deferred:** Owner Acceptance Week is **temporarily deferred** and must **not** be executed. It is not the next gate until the Owner re-authorizes it. The former OAW procedure document's direct-create capture scenarios are **not** current target product law (target direction: **D154**) and must not be reinstated; a future OAW must prove the current loop — communication or capture → interpretation → Owner review → acceptance with one responsibility selection (Owner or Recipient) → canonical Task → follow-through (D164). Redesigning OAW is separate work and requires explicit Owner re-authorization before any execution

**Notes:** Owner decision 2026-08-08. **D142 remains valid** as the definition of Owner Acceptance Week as a formal product gate with measurable exit criteria and silence-is-not-approval; only its **execution timing** is deferred. The obsolete OAW procedure document has been **deleted** rather than reconciled: the surviving law is D142 (gate definition and measurable exit criteria), this row (deferral and re-authorization), and [MILESTONES.md](MILESTONES.md) § Owner Acceptance Week (sequencing and the exit-criteria list). No replacement procedure document exists or is authorized

### D160 — **Owner-initiated Messages review is the initial SMS model (product direction):**

**Status:** Approved

**Decision:** **Owner-initiated Messages review is the initial SMS model (product direction):** the initial SMS/Messages model is **manual and Owner-initiated**. A recent SMS conversation or message is **selected and reviewed by the Owner**, the Owner chooses **"Review with Rocket"**, the **shared interpretation** runs only then, producing **zero, one, or several** proposals, and only an **Owner decision** produces a canonical Task or assignment. A **phone-number exclusion list** is required: an excluded number must never be interpreted by Rocket AI. **Continuous automatic monitoring, and automatic backend analysis of incoming Messages content, is not the initial model.** Automatic interpretation of non-excluded conversations is a **future mode** requiring its own approved decision, exactly as for email (D156)

**Notes:** Owner decision (documentation only). **Supersedes in part D043**, whose automatic-backend-analysis clause is withdrawn; D043's Owner-enablement, source, approval, and draft-only send facts remain operative. Same shape as the email commissioning target (D156) and bound by the one-canonical-domain rule (D157): when authorized it must evolve the one shared proposal path and the one shared interpretation capability, not fork them. Workflow text: [WORKFLOWS.md](WORKFLOWS.md) §3. Sequencing only: [MILESTONES.md](MILESTONES.md) A10, which originates none of this law. **Not an implementation authorization**: no NotificationListener change, intake surface, exclusion store, route, schema, prompt, or Android change is authorized

### D161 — **Interpretation occurrence, idempotency, and proposal cardinality (Stage 3 architecture law):**

**Status:** Approved

**Decision:** **Interpretation occurrence, idempotency, and proposal cardinality (Stage 3 architecture law):** Rocket has **one persisted interpretation-occurrence concept** (grouping/provenance truth, not canonical Task truth; provisional implementation name may be InterpretationRun — not constitutional table naming). One occurrence may produce **zero, one, or multiple** TaskSuggestions. Multiple legitimate interpretation occurrences may reference the same source. There is **no** product invariant of “one interpretation forever per source.” **Owner-initiated idempotency** uses the established pattern: unique `(organizationId, idempotencyKey)` plus request-fingerprint conflict detection — same key + same fingerprint returns the existing result; same key + different fingerprint is a conflict; a deliberate new interpretation uses a new idempotency key. Source identity and trigger are provenance and may participate in fingerprint/key derivation, but are **not** themselves uniqueness constraints. Existing CommunicationEvent claim/lease/process-state infrastructure remains authoritative for automated A6 processing. **D081 cardinality superseded:** proposal cardinality is one interpretation occurrence → 0..N TaskSuggestions; do not use proposal cardinality as interpretation idempotency. TaskSuggestion remains Rocket’s **single shared proposal domain** — do not introduce CandidateTask or another proposal store (D157). **Zero-proposal result:** successful Owner-initiated interpretation producing zero proposals is truthful success, represented on the interpretation occurrence — do not create a fake TaskSuggestion, call it `skipped_irrelevant`, or treat it as failure. Existing automated A6 `AI_EMPTY_OUTPUT` behaviour after its relevance prefilter remains valid and is **not** redefined. **AI capability:** do **not** collapse A6 `SuggestionExtractionResult` semantics into `InterpretationResult`; they remain distinct AI jobs sharing transport/error/retry/JSON infrastructure where appropriate. **Representation is not authorization:** architecture/schema may eventually represent `trigger = owner_review`; representation does **not** authorize an Owner-review API, Gmail/SMS Review-with-Rocket UI, exclusions, automatic-processing changes, notifications, cron, or Production flags.

**Notes:** Approved 2026-08-09 (Stage 3 governance reconciliation, documentation only). **Supersedes in part D081** (zero-or-one suggestion cardinality). Preserves D081 idempotency intent via `(organizationId, idempotencyKey)` + fingerprint. Complements D154, D157, D080. Domain detail: [ARCHITECTURE.md](ARCHITECTURE.md), [WORKFLOWS.md](WORKFLOWS.md). **Storage-foundation note (2026-08-10):** an inert additive `interpretation_runs` persistence foundation in `@aicaa/db` is authorized and implemented (completed successful outcomes + org-scoped idempotency only; no producer writes rows). This does **not** authorize Owner-initiated interpretation APIs, Review-with-Rocket UI, A6 retrofit, raw-input retention, trigger enums, revisions, notifications, cron, Production flags, or `packages/ai` application wiring. **Amended by D169 (2026-08-11):** the `packages/ai` application-wiring prohibition above is **superseded only to the extent D169 grants** controlled S3 / S3.1 shared interpretation application-service authority; Owner-initiated interpretation HTTP, Review-with-Rocket UI, A6 retrofit, raw-input retention, notifications, cron, Production flags, and every other exclusion D169 does not lift remain unauthorized here. **Amended by D170 (2026-08-11):** the Owner-initiated interpretation HTTP / generated-public-contract prohibition above is **superseded only to the extent D170 grants** the narrow S3.2 Owner manual-capture route `POST /api/v1/manual-captures` and its generated contracts; generic arbitrary-source interpretation APIs, Review-with-Rocket UI, A6 retrofit, raw-input retention, notifications, cron, Production flags, and every other exclusion D170 does not lift remain unauthorized here.

### D162 — **Manual Owner-authored capture raw-input retention:**

**Status:** Approved

**Decision:** **Manual Owner-authored capture raw-input retention:** Owner-authored typed/keyboard-dictated Capture input is **not** imported temporary communication content. Do **not** generalize TemporaryCommunicationExcerpt to own manual capture input. D155 does **not** require retaining the raw input permanently. Raw manual input may be retained **only** to support Owner proposal review. **Retention rule:** maximum raw-input lifetime is **7 days from successful interpretation**; raw input may be purged earlier once all proposals from the interpretation are terminal and review no longer requires it; an abandoned/unreviewed run still loses raw input at the seven-day ceiling; structured proposal revisions, canonical Tasks, audit records, and D155 evidence follow their own retention classes; raw manual input must **never** become dormant learning evidence merely because it was retained for review. Durable provenance may remain through declared source/run metadata after raw input purge. Imported communication content (for example Gmail excerpts) remains under TemporaryCommunicationExcerpt / D082 — including the multi-proposal sibling entitlement rule.

**Notes:** Approved 2026-08-09 (Stage 3 governance reconciliation, documentation only). Complements D082, D155, D154, D161. Detail: [DATA_RETENTION.md](DATA_RETENTION.md). **Not an implementation authorization.**

### D163 — **A5/A6 architectural boundary — A6 is preserved compatibility, not a future dependency target:**

**Status:** Approved

**Decision:** **A5/A6 architectural boundary — A6 is preserved compatibility, not a future dependency target:** **A5** is the reusable Gmail/source infrastructure layer: Gmail synchronization → `CommunicationEvent` → `TemporaryCommunicationExcerpt`. A5 does **not** own AI interpretation or TaskSuggestion production (D077). **A6** is the older automatic Gmail interpretation/proposal path (heuristic gating, `SuggestionExtractionResult`, claim/lease batch processing, historical 0..1 suggestion linkage) and is classified as **preserved compatibility/legacy automatic Gmail processing**. **Binding rule:** A6 is **not** a dependency target for future Rocket product development. Shared/source infrastructure may be used by A6; A5/source infrastructure remains reusable; future product capabilities must use the shared interpretation / `InterpretationRun` / 0..N `TaskSuggestion` / revision-evidence / Owner-review / responsibility-selection architecture (D154, D156, D157, D161, D164); **new shared or product infrastructure must not depend on A6-specific processing semantics** (including heuristic gating, A6 extraction-empty semantics, claim/lease batch semantics, or 0..1 proposal assumptions as product law). This Decision does **not** require immediate A6 deletion and does **not** permanently forbid automatic Gmail intelligence as a product capability. Future automatic Gmail detection/review, when separately approved, should preferentially use the shared interpretation/proposal architecture rather than extend A6’s legacy semantics. Owner-initiated “Review with Rocket” remains the current email commissioning target (D156).

**Notes:** Owner decision 2026-08-10 (documentation only). Complements D077, D084, D085, D156, D157, D161. Clarifies dependency direction without retracting A6’s current implementation truth or D156’s future automatic mode. Domain detail: [ARCHITECTURE.md](ARCHITECTURE.md), [WORKFLOWS.md](WORKFLOWS.md) §1a. **Not an implementation authorization**: no schema, API, worker, cron, flag, Production, A6 retrofit, or A6 deletion is authorized.

### D164 — **Unified Owner responsibility selection and one canonical follow-through model (product law):**

**Status:** Approved

**Decision:** **Unified Owner responsibility selection and one canonical follow-through model (product law):** accepting a proposal asks the Owner **exactly one** question — **“Who is responsible for this Task?”** The answer is the **Owner (Me)** or an external **Recipient**. There is **no separate Owner-facing Keep action**. The Owner-facing flow is **proposal → Owner review → accept → choose the responsible person → canonical Task → follow-through**. **Unified UX does not require unified persistence:** existing architecture may correctly represent an Owner-responsible Task as the canonical Task with **no active external TaskAssignment**, and a Recipient-responsible Task through the existing Recipient / TaskAssignment / capability / handoff machinery. Choosing **Me** does **not** require a TaskAssignment to the Owner. This decision does **not** authorize a responsibility column, an assignee column on Task, a custody enum, an Owner TaskAssignment row, or a second assignment/custody state machine; the persistence representation is deliberately **unsettled**. **Operational representation is not affirmative evidence:** the absence of an active TaskAssignment must never be treated as evidence that the Owner chose Me (D155). **Responsibility selection is not delivery:** the selection is true when the Owner makes it, while successful delivery of access to an external Recipient remains authoritative in the existing assignment / capability / HandoffAttempt / delivery infrastructure — a failed handoff does not falsify the selection, and a selection does not imply delivery. **One canonical Task and follow-through model:** Owner-responsible and Recipient-responsible Tasks are the same canonical Task; responsibility determines **who is expected to do the work**, not whether the Task may participate in Rocket’s Task lifecycle, deadline, reminder, completion, and follow-through concepts. Owner attention/native-notification mechanics may differ from Recipient email/capability delivery, and external Recipient access still requires the existing Recipient/assignment/capability machinery. One Task follow-through event may serve **different audiences for different purposes** — a Recipient work reminder or delivery, and appropriate Owner oversight attention through native/app/attention surfaces; an Owner-responsible Task may route attention to the Owner without Recipient email machinery. **Delegating a Task must not remove it from appropriate Owner oversight/attention.** This authorizes **no second reminder engine**, designs no delivery mechanics, and does **not** redesign A8 reminders

**Notes:** Owner decision 2026-08-11 (documentation only). **Amends D154**’s Keep-for-me / Assign terminology and interaction framing **in place** without withdrawing D154’s operative responsibility-choice rule, and drives the D155 responsibility-selection evidence correction; terminology aligned in D159 and D163 without reopening their conclusions — **D163 remains binding** (A5 reusable, A6 preserved compatibility, no future dependence on A6-specific semantics). Complements D080, D086, D090, D092, D094, D102–D110, D152, D157, D161. **Not an implementation authorization**: no schema, API, prompt, UI, worker, cron, flag, Android, Gmail, SMS, dashboard, reminder-routing, reminder-processing, `no_active_assignment`, responsibility-persistence, or accepted-revision-persistence change is authorized. Rank 1/2 reconciliation: [PROJECT_CONSTITUTION.md](PROJECT_CONSTITUTION.md), [AI_CONSTITUTION.md](AI_CONSTITUTION.md). Rank-4 and below contract/document reconciliation is **pending** and separately authorized

### D165 — **Rank-3 charter narrowed; a later DECISIONS.md representation change authorized:**

**Status:** Approved

**Decision:** **Rank-3 charter narrowed; a later DECISIONS.md representation change authorized:** rank 3 remains an authority rank owning immutable Dxxx identity, status, the operative discrete decision, supersession/amendment truth, non-authorization boundaries, permanent prohibitions and exclusions forming part of a decision, amendment history needed to interpret rank-1/rank-2 change, retired-label interpretation where necessary, non-obvious rationale where forgetting it creates meaningful architectural or governance risk, and inert historical wording only where materially useful and clearly marked non-operative. It remains the durable amendment/supersession ledger higher-authority documents rely on unless a later governance decision changes that. **Reference, do not duplicate:** where another authoritative document owns current detail, this register points to it — workflows → WORKFLOWS.md, API/wire → API_CONTRACT.md/OpenAPI, architecture/schema → ARCHITECTURE.md and Prisma/migrations, retention → DATA_RETENTION.md, sequencing → MILESTONES.md, terminology → GLOSSARY.md; a reference is a pointer, not a second specification. Rank 3 normally excludes implementation diary, completion-history prose, non-operative migration/test/repository-path inventories, stale deployment/Production state, and reconciliation diary. **Representation:** a later controlled transformation is authorized to one DECISIONS.md file, one heading per decision, ascending Dxxx order regardless of status, every assigned Dxxx ID present exactly once, IDs never renumbered or reused, existing bare-Dxxx citations still authoritative, heading anchors as navigational convenience only, and no decision split across domain files. Minimum schema — always ID/title, Status, Decision; conditional where they exist: Supersession/Amendment, Boundaries, Current law, Rationale, and inert history under the sentinel **“Inert history — not current law”**. No mandatory empty or N/A field, and **no decision-class field**. **Status and history:** the existing status vocabulary and supersession semantics are preserved unchanged — a withdrawn operative clause is absent from active Decision text, **Superseded in part** requires a genuine withdrawn operative clause, an amendment withdrawing no operative clause remains **Approved**, and inert history is never current law. Missing wording and dates are never reconstructed from git merely for uniformity; a date already asserted may be relocated structurally without changing its meaning. An optional index may exist **inside DECISIONS.md only**: navigational, non-authoritative, carrying only ID, short title, status, and supersession counterpart IDs, and never summarizing decision law. **Operative text is preserved:** no improvement, modernization, shortening, paraphrase, or reinterpretation of operative Decision text is authorized; the default is byte-for-byte preservation, every removal or reference shift of duplicated specification or clearly non-operative material is classified individually, names the authoritative destination for still-current detail, and proves no discrete decision, prohibition, boundary, or necessary rationale was lost; any proposed rewording of operative law **stops and returns to Owner review**.

**Notes:** Owner decision 2026-08-11 (documentation only). **Verification precondition:** repository-local documentation-governance tooling — scripts, plus a devDependency if genuinely necessary — is authorized and must be proven green against an immutable normalized extraction of the pre-representation baseline **before batch one**, covering at least baseline D001–D164 completeness/uniqueness, live assigned-ID completeness/uniqueness thereafter, valid status vocabulary, ascending ID order, required fields, operative-text preservation, non-authorization/boundary preservation, withdrawn-clause non-resurrection, inert-history isolation, supersession reciprocity, **Superseded in part** completeness, repository-wide Dxxx citation resolution, range-citation integrity. It runs through its own command; wiring it into global `pnpm verify` or CI is **not authorized here** and needs separate review. **Process:** the rewrite runs in batches of about 20 IDs, smaller for dense/high-risk ranges — especially D095–D110 and D128–D136 — one reviewed commit per batch, whole-register harness green after each, every reference-shift removal reported with destination and no-loss proof, semantic ambiguity stopping the batch for Owner judgment, and no batch silently changing a status or meaning. **Authorizes no implementation**: no application code, product architecture, API/OpenAPI/schema/migration, prompt/UI/worker/cron, feature-flag, deployment/Production, or product-behaviour change, no reinterpretation of product law. Reconciles PROJECT_CONSTITUTION.md § Authority model, REVIEW_CHECKLIST.md, this header

### D166 — Deny-by-default Row Level Security is defence in depth, not the authorization or tenant-isolation mechanism

**Status:** Approved

**Decision:** Rocket domain tables use deny-by-default Row Level Security as defence in depth against non-bypass and direct-client database access. RLS is enabled without permissive policies, so any role that does not bypass RLS — direct PostgREST/Realtime access and any other direct database API role — is denied by default. RLS does **not** replace application-side authorization: Prisma is reached only through authorized server APIs (D006), and server-side authorization of every Owner and Recipient request remains mandatory. Organization/tenant-boundary enforcement likewise remains mandatory in application code, independently of RLS. RLS is **not** the tenant-isolation mechanism for trusted server-side Prisma access, because the application's database role bypasses RLS by design; the application must never depend on end-user RLS context for correctness. This record formalizes the security posture already deployed. It authorizes no runtime security change, no new or permissive RLS policy, and no weakening of RLS anywhere it is already enabled.

**Notes:** Owner decision 2026-08-11 (documentation only). Formalizes the deny-by-default RLS defence-in-depth clause historically carried in D032; the D048–D054 range replaced D032's org/role authorization framing and did not withdraw that clause, which left it without a current Approved home until this record. D006 remains authoritative for Prisma-through-authorized-server-API access and application-side authorization expectations. Direct-client and other non-bypass database access stays deny-by-default. Implementation detail — which tables carry RLS, migration mechanics, and role/bypass behaviour — belongs to [SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md) and [packages/db/README.md](../packages/db/README.md), and is deliberately not restated as law here. **Not an implementation authorization**: no schema, migration, RLS policy, Supabase configuration, authentication, Owner/Recipient authorization, or organization-scoping change is authorized

### D167 — Responsibility-model documentation reconciliation is complete; the remaining responsibility work is implementation

**Status:** Approved

**Decision:** The rank-4 and supporting-document reconciliation left pending by **D164** is complete. The current authority and supporting documents state the unified responsibility model accurately: accepting a proposal asks exactly one responsibility question, answered by the Owner (Me) or an external Recipient; there is no separate Keep action; the absence of a TaskAssignment is never affirmative evidence that the Owner chose Me; responsibility selection is distinct from delivery and handoff; one canonical Task and follow-through model serves both answers; and unified UX does not require unified persistence. Where those documents describe time-driven follow-through delivery as Recipient-oriented today, and record that an Owner-responsible Task receives no Owner-audience delivery, they are stating **implementation-gap disclosures that are currently accurate** — not documentation conflicts, and not stale wording to be removed or softened because this record closes the reconciliation status. What remains of **D164** is therefore implementation work rather than documentation work, and none of it is authorized here. Any future implementation must preserve **one canonical Task and follow-through architecture** and must evolve it: it may not introduce a second Task model, a second reminder engine, a second deadline or occurrence model, or parallel Owner-specific follow-through persistence created merely to mirror the Recipient path. **Documentation alignment is not implementation.** This record does not assert, and must never be cited as evidence, that acceptance-time Owner/Recipient responsibility selection, affirmative persistence or evidence of an Owner responsibility selection, or Owner-audience time-driven follow-through delivery has been built. The persistence representation remains deliberately unsettled (D155, D164), and nothing here settles it.

**Notes:** Owner decision 2026-08-11 (documentation only). Closes the reconciliation status **D164** recorded as pending without rewriting it: D164's pending sentence was true when written, is retained as historical state as of that decision, and is now read together with this record. Repository evidence: commit `c11afa5`, made after **D164**, brought the rank-4 domain contracts and the supporting brand and review documents into line with the unified responsibility model. The seam disclosures now carried in [WORKFLOWS.md](WORKFLOWS.md) §10a, [ARCHITECTURE.md](ARCHITECTURE.md) § Reminder and notification architecture, [GLOSSARY.md](GLOSSARY.md), and [MILESTONES.md](MILESTONES.md) are intentionally current, remain the authoritative statement of the gap, and are not amended here. Complements D154, D155, and D164, and amends none of them; D155's responsibility-selection evidence law is unchanged. Owner Acceptance Week remains deferred and still requires explicit Owner re-authorization before execution (D159), and the manual Owner-initiated initial product model is untouched (D160). **Not an implementation authorization**: no schema, API, prompt, UI, worker, cron, flag, Android, web, Gmail, SMS, reminder-routing, reminder-processing, `no_active_assignment`, TaskAssignment, handoff, responsibility-selection, or responsibility-persistence change is authorized

### D168 — Responsibility-selection persistence is dedicated append-only D155 evidence recorded atomically at proposal acceptance

**Status:** Approved

**Decision:** Rocket represents the Owner's affirmative responsibility choice made at proposal acceptance as a **dedicated append-only responsibility-selection evidence record** in the existing D155 structured learning/evidence family. The record sits conceptually beside TaskSuggestionRevision as an independent evidence axis: responsibility selection and accepted content revision remain independent. It is evidence of the Owner's **initial** responsibility decision at acceptance only — not canonical Task state, current custody state, a TaskAssignment, delivery state, handoff state, a replacement for TaskAssignment, a responsibility history/state machine, or a current-responsibility projection. Do **not** put responsibility, assignee, or custody fields on Task. Do **not** create an Owner TaskAssignment. Do **not** reinterpret TaskAssignment as universal responsibility truth. **Acceptance-time atomicity:** when responsibility selection is supplied, it is part of the existing proposal-approval mutation and must be persisted atomically with canonical Task creation, TaskSuggestion approval, `approvedTaskId` linkage, and existing approval audit/evidence writes. The durable evidence must **not** be created as a later best-effort mutation after acceptance. **Required evidence semantics:** the durable record must be capable of establishing organization scope; accepted TaskSuggestion identity; resulting canonical Task identity; selected responsible-party kind (**Owner** or **Recipient**); selected Recipient identity when kind = Recipient; and selection timestamp. Exactly one initial responsibility-selection evidence record may exist for a successfully accepted proposal when responsibility selection is supplied. Owner selection must be affirmative. Absence of this record, absence of TaskAssignment, absence of Recipient, or absence/failure of handoff must **never** mean that Owner/Me was selected. **Actor attribution:** the persistence representation must preserve truthful attribution that the selection was made through the authenticated Owner approval action. Whether this requires a dedicated actor identifier on the evidence row may be settled during the bounded implementation slice based on existing single-Owner identity and audit architecture. AuditEvent must **not** become the responsibility evidence store. **Recipient selection is not delivery:** selecting a Recipient persists the affirmative selection but must **not** itself create TaskAssignment, create TaskCapability, create HandoffAttempt, send Gmail, send email, activate Recipient access, or constitute successful delivery. The existing later handoff mutation remains responsible for those effects. A later failed, pending, cancelled, cleared, or absent handoff must not erase or falsify the original selection evidence. **D080 preserved:** existing approve behaviour rejecting legacy/direct `recipientId` with `RECIPIENT_HANDOFF_NOT_AVAILABLE` remains current. Responsibility selection must use a distinct contract concept rather than repurposing `recipientId`. AI-proposed `proposedRecipientId` remains proposal metadata and must never become affirmative Owner-selection evidence unless the Owner actually confirms that Recipient. **Initial decision only:** this evidence record represents the Owner's initial responsibility choice at proposal acceptance. It does **not** authorize a general responsibility-history stream. Later reassignment, clearing assignment, return to Owner, and Recipient handoff lifecycle remain represented through the existing TaskAssignment/handoff/audit architecture unless later governance changes that rule. This decision does not resolve the later return-to-Owner evidence question. **Retention:** the responsibility-selection record belongs to the D155 Structured learning signals / durable workflow intelligence retention class ([DATA_RETENTION.md](DATA_RETENTION.md)). It must not inherit TemporaryCommunicationExcerpt retention, Task content scrub semantics, or TaskAssignment delivery lifecycle. **Canonical architecture:** preserve one canonical Task model, one reminder schedule/occurrence architecture, one follow-through engine, and existing TaskAssignment/handoff infrastructure for external Recipients. This authorization must not create a second Task ownership system, duplicate current-assignee truth, parallel Owner follow-through persistence, or a second reminder engine. **Bounded implementation authorization:** this decision authorizes the subsequent bounded implementation slice necessary to establish this evidence carrier, including additive schema/migration work, repository create/read support, proposal-approval contract extension, validation, atomic approve-transaction persistence, and tests and guards necessary for the slice. **Not authorized:** Owner-audience reminder/follow-through delivery; reminder-engine redesign; reminder occurrence redesign; changes to `no_active_assignment` semantics; D151 Me filter; Android or web responsibility-selection UX; proposal-review UI; AI-first capture implementation; Gmail Review with Rocket implementation; SMS; accepted-content-revision identification; Owner-edit revision capture; responsibility reassignment/history persistence; return-to-Owner responsibility evidence; current-responsibility projection/view; public read API for responsibility evidence; personalization or learning use of the dormant evidence; Task responsibility/assignee/custody columns; Owner TaskAssignment rows; any handoff/delivery redesign

**Notes:** Owner decision 2026-08-11 (documentation/governance only). Settles the persistence representation left deliberately unsettled by D155 and D164 and recorded as unsettled by D167, without rewriting those records. Complements D080, D155, D164, and D167. Retention class confirmed against [DATA_RETENTION.md](DATA_RETENTION.md) Structured learning signals / durable workflow intelligence. Broader product work listed under **Not authorized** remains outside this decision; the bounded evidence-carrier slice is the sole implementation authorization here

### D169 — Controlled S3 authorization: shared interpretation application service + Owner manual capture

**Status:** Approved

**Decision:** **Controlled S3 authorization — shared interpretation application service + Owner manual capture:** the Owner explicitly authorizes controlled implementation of Stage 3 (S3) shared interpretation, opening the earlier historical gate that withheld `packages/ai` application wiring and interpretation producers. **Authorized end-to-end architecture (implemented in controlled slices):** Owner manual capture → shared backend interpretation → validated 0..N proposals → canonical existing TaskSuggestions → Owner review → existing accept + responsibility-selection flow → canonical Task. **Reuse required:** the existing shared `packages/ai` interpretation contract/providers/validation; the existing `InterpretationRun` persistence foundation and its organization-scoped idempotency model; the existing canonical `TaskSuggestion` repository and lifecycle; existing S1 responsibility-selection architecture; existing S2 `approvedTaskId` recovery; existing Owner authentication and organization-scoping patterns. Creating the missing thin shared application-service and atomic persistence seams that connect those components is authorized. **S3.1 first slice (explicitly authorized now):** shared interpretation application service wired to canonical persistence — **backend only**, with **no product/API reachability**. S3.1 may include a shared interpretation application service; provider composition/environment factory for the shared interpretation provider; an atomic database transaction that persists one `InterpretationRun` plus its 0..N canonical TaskSuggestions; reuse of existing interpretation idempotency semantics; and focused integration/unit tests. Provider/network AI work must occur **outside** database transactions. The resulting backend machinery must remain unreachable from Owner HTTP and Android product surfaces until a later separately reviewed slice adds that surface. **Source-neutral locked architecture:** the first authorized producer is manual capture using `sourceKind = owner_manual_capture`. The service must remain source-neutral so later Gmail and SMS adapters can use the same interpretation capability. This decision does **not** authorize Gmail or SMS implementation now. Do **not** extend or make new capabilities depend on the legacy A6 Gmail suggestion-extraction path; D163's compatibility/legacy classification of that path is preserved. **Proposal-field decision (initial shared interpretation):** canonical persisted proposal content remains the existing TaskSuggestion representation, especially its `summaryPoints`; `ProposedTask.peopleHints` remains interpretation-layer advisory information; `ProposedTask.deadlineExpression` remains interpretation-layer advisory information unless its meaning is already represented through canonical proposal content; do **not** create TaskSuggestion/database columns merely to persist `peopleHints` or `deadlineExpression`; do **not** infer Recipient assignment/responsibility from `peopleHints`; do **not** translate an unresolved natural-language `deadlineExpression` into `proposedDueAt`; omission of those advisory fields from S3.1 TaskSuggestion persistence is intentional, not accidental data-model drift; any future persistence or public exposure of those fields requires a separately controlled decision. This decision does **not** redesign the interpretation contract. **Raw-input decision:** S3.1 will **not** persist raw Owner manual-capture input, avoiding a new retention-bearing storage class before an Owner-facing proposal-review surface requires it. Any future raw-source retention for review must follow existing retention policy (D162) and receive separate implementation authorization. **Public-contract boundary:** `interpretationRunId` remains internal provenance and is **not** added to the public TaskSuggestion contract merely because S3 begins using it. **Existing Android direct-create path:** Android `manual text → POST /api/v1/tasks → canonical Task` is a legacy/direct-capture shortcut that will eventually be superseded by the S3 proposal-review flow; do **not** remove or modify it now, do **not** modify it in S3.1, and switching Android to interpretation/proposal review is a later controlled slice. **Not authorized:** Android proposal UI; an Owner interpretation HTTP route; generated public contracts for interpretation; Gmail Review with Rocket; SMS Share to Rocket; A6 retrofit; raw-input persistence; new retention architecture; a new TaskSuggestion model; a second proposal model; a second Task model; Owner TaskAssignment; responsibility/custody columns; new responsibility architecture; approve idempotency; reminders; attention system; exclusions; cron; Production flags; deployment; Production migrations; Production activation; Production configuration/data/auth/secrets changes. Production operations remain separately authorized

**Notes:** Owner decision 2026-08-11 (documentation/governance only). Supersedes the earlier historical authorization gate that paused/`packages/ai` application wiring and interpretation producers as unauthorized to resume ([MILESTONES.md](MILESTONES.md) § Forward sequence; D161 storage-foundation note) **only within the controlled S3 / S3.1 boundaries above** — those earlier statements remain correct history of the inert foundation and withheld implementation authority, not architectural contradictions. Complements D154, D157, D161, D162, D163, D164, and D168 without redesigning the interpretation contract or withdrawing D163. Domain status reconciliation: [ARCHITECTURE.md](ARCHITECTURE.md), [MILESTONES.md](MILESTONES.md), [GLOSSARY.md](GLOSSARY.md), [AI_CONSTITUTION.md](AI_CONSTITUTION.md). **Does not begin S3.1 implementation** by itself; the S3.1 slice is the sole implementation authorization granted here, and every item under **Not authorized** remains outside this decision. **Amended by D170 (2026-08-11):** the **Not authorized** prohibitions of an Owner interpretation HTTP route and generated public contracts for interpretation are **superseded only to the extent D170 grants** controlled S3.2 Owner manual-capture HTTP/API surface + generated public contracts (`POST /api/v1/manual-captures`); this row's historical S3.1-only product/API unreachability remains correct history of the S3.1 slice. Android proposal UI, generic arbitrary-source interpretation APIs, Gmail/SMS adapters, raw-input persistence, Production activation, and every other exclusion D170 does not lift remain unauthorized here. **Amended by D171 (2026-08-12):** controlled S3.3 Android capture-to-proposal integration is authorized by **D171** within its stated boundaries; full proposal-lifecycle UI, Gmail/SMS adapters, server raw-input persistence, Production activation, and every other exclusion D171 does not lift remain unauthorized here

### D170 — Controlled S3.2 authorization: Owner manual-capture HTTP/API surface + generated public contracts

**Status:** Approved

**Decision:** **Controlled S3.2 authorization — Owner manual-capture HTTP/API surface + generated public contracts:** the Owner explicitly authorizes the next controlled Stage 3 slice after implemented S3.1: a narrowly scoped Owner-authenticated manual-capture HTTP adapter and the public OpenAPI/generated contracts required to expose it. **D169 remains Approved historical and operative law** for controlled S3 / S3.1 shared interpretation application-service wiring; D169's prohibition of an Owner interpretation HTTP route and generated public interpretation contracts is **lifted only to the extent** this decision grants the manual-capture adapter described here — it does **not** broadly authorize generic interpretation APIs, Gmail, SMS, Android proposal UI, or Production activation. **Authorized product flow:** Owner-authenticated Android/client manual capture → `POST /api/v1/manual-captures` → existing shared S3.1 interpretation service → zero or more canonical existing TaskSuggestions → response suitable for later proposal review. **No canonical Task** is created by this route. Owner review remains required before proposal approval and responsibility selection. **Authorized public route:** authorize the manual-capture-specific Owner route `POST /api/v1/manual-captures` only. Do **not** authorize a generic arbitrary-source `/interpretations` endpoint. Reason: the shared application service remains source-neutral; the HTTP adapter is source-specific; public clients must not choose Gmail/SMS provenance; the server fixes the source to `owner_manual_capture`. Future Gmail and SMS adapters require separate authorization. **Authentication and organization scope:** the route is Owner authenticated; organization scope comes from trusted authenticated Owner context; `organizationId` is **not** accepted from the request body; the client cannot select another organization; capability/Recipient auth is **not** valid for this Owner route. **Request contract:** authorize a request containing only the manual-capture semantic input — `rawInput`, `capturedAt`, and optional `timezone`. Authorize required `Idempotency-Key` HTTP header using the existing reusable parameter contract. Do **not** expose `sourceKind` or `organizationId` in the request. **rawInput bound:** authorize an explicit maximum matching the shared provider's current supported input ceiling of **4000 characters**; the public route must reject input beyond that ceiling rather than allowing provider-side silent truncation to alter semantics. Do not change the provider ceiling in this governance task. **capturedAt:** required; supplied by the client/source adapter; explicit ISO-8601 offset required; must **not** default to server processing time; exact retries reuse the same capture timestamp. Do not add a recency requirement merely because retries may happen later. **Idempotency / retry semantics:** authorize the existing S3.1 replay model at the HTTP boundary. The client owns a stable capture identity across retries. A retry must reuse the same semantic tuple: idempotency key, raw input, `capturedAt`, and timezone. Same organization + key + same fingerprint returns the existing interpretation/proposal set and does **not** invoke AI again; same organization + key + different fingerprint is a conflict. No new recovery table, recovery token, occurrence public resource, or retry state machine. Lost-response recovery is achieved by repeating the same request with the same idempotency identity. **Success response:** authorize a thin public response containing `idempotentReplay: boolean`, `interpretedAt`, and `taskSuggestions: TaskSuggestion[]`. Reuse the existing canonical public `TaskSuggestion` DTO/schema. Do not create a second proposal DTO unless implementation evidence later proves necessary. **Status:** authorize HTTP **200** for first successful interpretation, exact replay, and successful zero-proposal interpretation. No 201 distinction is required because the internal interpretation occurrence is not a public resource. **Zero proposals:** authorize `{ "idempotentReplay": false, "interpretedAt": "...", "taskSuggestions": [] }` as truthful success. Do not manufacture a proposal, return 204, or expose a public InterpretationRun merely to represent the empty outcome. **Public provenance boundary:** explicitly preserve that `interpretationRunId` remains internal persistence provenance. The public S3.2 response must **not** expose `interpretationRunId`, InterpretationRun ID, request fingerprint, persisted idempotency key, `modelVersion`, `policyVersion`, rawInput echo merely as response state, or internal DB provenance. Returning canonical TaskSuggestion DTOs is authorized because S3.1 already strips persistence-only run linkage before the service result reaches adapters. **Error contract direction:** authorize reuse of the existing public ErrorResponse/ErrorCode architecture. Expected status classes may include 400 validation, 401 unauthorized, 409 idempotency/domain conflict, 415 content type, 428 missing idempotency precondition, 500 internal/permanent server failure, and 503 provider/configuration/transient dependency failure. Do **not** introduce a new public error enum merely for S3.2 unless implementation evidence proves existing codes cannot represent the truth. Do not expose raw provider errors, credentials, fingerprints, idempotency keys, or raw capture text in error messages. **OpenAPI/generated contract authorization:** this decision explicitly authorizes the S3.2 implementation to add a manual-capture OpenAPI path, request schema, response wrapper schema, registration in the existing OpenAPI root, generated TypeScript models/artifacts, generated Kotlin models/artifacts, and contract tests / drift updates required by established generation. Reuse unchanged where possible: existing IdempotencyKey parameter, existing TaskSuggestion schema, existing ErrorResponse/ErrorCode schemas, and existing SourceType with `manual`. Do not modify TaskSuggestion merely to expose interpretation provenance. **Route/application boundary:** authorize a thin route adapter that authenticates Owner, resolves org from Owner context, validates content type/header/body, supplies server-constant `owner_manual_capture`, calls the accepted S3.1 interpretation service, maps canonical suggestions using existing DTO mapping, and returns the contracted response. Authorize a dedicated interpretation/manual-capture Owner route-context/error mapper if that is the repository-native pattern. Do not duplicate interpretation business logic in the route. **Android boundary:** this decision does **not** authorize Android capture switching or proposal UI. Generated Kotlin contract changes caused by S3.2 are authorized as contract artifacts only. The existing Android direct-create capture path remains untouched until a later controlled slice. Carry forward as a later implementation concern: generated `TaskSummaryPoint` polymorphic deserialization may require Android-specific adapter/DTO work before proposal review is usable — do not solve that in D170 or S3.2 backend implementation unless a compile-only generated artifact adjustment is inherently required. **Raw-input retention:** S3.2 does **not** authorize raw manual-input persistence. Route/application handling remains transient. Do not add CommunicationEvent, TemporaryCommunicationExcerpt, a raw-input table/column, or retention state merely for manual capture. Do not log request bodies containing raw capture text. **Production posture:** adding the route/code does **not** authorize Production activation. Preserve the default-closed S3.1 provider gate. This decision does **not** authorize enabling `INTERPRETATION_AI_ENABLED`, modifying credentials/secrets, Production deploy, Production migration, Production flag changes, cron, alias changes, or Production data/auth/environment changes. **Not authorized:** Android proposal UI; Android capture switch; generic arbitrary-source interpretation API; Gmail Review with Rocket; SMS Share to Rocket; A6 retrofit/dependency; Task creation from interpretation; auto-approval; responsibility selection changes; TaskAssignment changes; raw-input retention; reminders; attention system; exclusions; Production activation; S3.3 or later implementation

**Notes:** Owner decision 2026-08-11 (documentation/governance only). D169's Owner interpretation HTTP route / generated public interpretation contracts prohibition is **lifted only to the extent** of the S3.2 manual-capture boundaries above — D169 remains **Approved**; its S3.1 authorization, historical product/API unreachability wording for that slice, and every exclusion this decision does not lift remain intact. Complements D154, D157, D161, D162, D169 without redesigning the interpretation contract. Domain status reconciliation: [ARCHITECTURE.md](ARCHITECTURE.md), [API_CONTRACT.md](API_CONTRACT.md), [MILESTONES.md](MILESTONES.md), [GLOSSARY.md](GLOSSARY.md), [AI_CONSTITUTION.md](AI_CONSTITUTION.md), [DATA_RETENTION.md](DATA_RETENTION.md). **Does not begin S3.2 implementation** by itself; the S3.2 slice is the sole implementation authorization granted here, and every item under **Not authorized** remains outside this decision. **Amended by D171 (2026-08-12):** the **Not authorized** prohibitions of Android capture switch, Android proposal UI (only to the narrow read-only capture-result extent), and S3.3 implementation are **superseded only to the extent D171 grants** controlled S3.3 Android capture-to-proposal integration; D170 remains **Approved** historical and operative law for S3.2. Full proposal-lifecycle UI (approve, responsibility selection, Recipient selection, edit, merge, proposal inbox, Task creation from proposal, approvedTaskId recovery UX), Gmail/SMS, server raw-input retention, Production activation, and every other exclusion D171 does not lift remain unauthorized here

### D171 — Controlled S3.3 authorization: Android capture-to-proposal integration

**Status:** Approved

**Decision:** **Controlled S3.3 authorization — Android capture-to-proposal integration:** the Owner explicitly authorizes the next controlled Stage 3 slice after implemented S3.2: narrow Android Owner manual-capture product work that switches the capture path from the legacy direct-Task shortcut onto the existing S3.2 route and displays the returned canonical proposals read-only. **D170 remains Approved historical and operative law** for the S3.2 Owner manual-capture HTTP/API surface; D170's prohibitions of Android capture switching, Android proposal UI, and S3.3 implementation are **lifted only to the extent** this decision grants the capture-to-proposal boundaries below — they do **not** broadly authorize full proposal-lifecycle UI, Gmail, SMS, backend redesign, or Production activation. **Authorized product flow:** Owner types/dictates capture → Android freezes durable retry identity → `POST /api/v1/manual-captures` → existing S3.2 API → existing shared S3.1 interpretation → 0..N canonical TaskSuggestions → Android displays the resulting proposals **read-only**. **No canonical Task** is created by capture. AI proposes; the Owner still decides later. **S3.3 product boundary / S3 completion:** S3.3 is the Android capture-to-proposal integration slice. S3 completion means the manual Owner capture path reaches canonical proposals end-to-end: Android capture → shared backend interpretation → canonical TaskSuggestions → Android read-only proposal result. The later Android core proposal lifecycle remains separately controlled and is **not** part of S3.3. Do not invent S4/S5 numbering in this decision unless existing canonical roadmap documentation already has a defined place for it; preserve the broader product roadmap rather than creating contradictory numbering solely because those labels are absent from current repo docs. **Proposal-lifecycle exclusion (explicit):** S3.3 may display proposals returned by manual capture, but it does **not** authorize approve; responsibility selection; Recipient selection; edit; merge; proposal inbox/list browsing; Task creation from proposal; navigation to a resulting approved Task; S2 `approvedTaskId` recovery UX; or full proposal lifecycle UI. Those remain later controlled Android proposal-loop work and must not be pulled into S3.3 merely because pending proposals temporarily have no Android resolution action. **Cardinality UX:** authorize a minimal read-only result experience. Zero proposals (`taskSuggestions: []` on HTTP 200) is truthful success — Android may show a distinct "nothing actionable found" style state that is **not** an error, invents no fake proposal, and keeps the original capture text available so the Owner can rephrase/capture again. One proposal: display the canonical proposal read-only. Multiple proposals: display all returned proposals in a simple bounded scrolling list; no pager or new navigation architecture is required. The public contract caps the response at 10 proposals. **Proposal presentation:** authorize Android to derive human-readable proposal text from canonical `summaryPoints` using existing Android summary-point rendering/title patterns where suitable. Do **not** invent a second proposal data model or AI interpretation model. Do **not** infer assignment/responsibility from `peopleHints` or any other advisory signal. **Durable retry requirement:** authorize a capture-specific durable retry record sufficient to preserve S3.1/S3.2 idempotency semantics across network interruption, lost response, app interruption, process death, and app restart. The retry identity is the frozen tuple: idempotency key, `rawInput`, `capturedAt`, and timezone. Android must reuse the same tuple on retry and must **not** regenerate one field independently while reusing the others. **Idempotency ownership:** Android generates the `Idempotency-Key` once when the Owner submits a new capture; `capturedAt` is captured once at that same submission boundary; timezone is captured once with the request; the entire tuple is frozen for retries; retries after ambiguous failure reuse it unchanged. A changed capture is a new semantic request and must receive a new idempotency identity. **Edit-after-failure rule:** if an unresolved/pending capture exists and the Owner changes the raw draft, the old retry tuple is discarded; the next Save creates a fresh capture identity. Do **not** resend edited text under an old idempotency key. No merge/reconciliation state machine is authorized. **Device-side pending-capture storage:** authorize one new device-side privacy behavior — Android may temporarily persist the pending raw manual-capture text solely to support exact retry/recovery. Storage must be local to the Owner Android device; use encrypted preferences/storage following the existing `PendingHandoffStore` pattern; contain only the minimum retry state necessary; must not become a general capture history; must not become an offline queue; must not sync to the backend independently; and must not be logged. Authorize a **24-hour maximum** pending-capture lifetime; after expiry the pending retry record is discarded. This is separate from server-side raw-input retention: S3.1/S3.2 continue to persist **no** raw manual-capture input. **Pending capture lifecycle:** persist the retry tuple **before** the HTTP request is issued; keep pending on ambiguous/retryable outcomes (connectivity loss, timeout/ambiguous transport failure, 503 dependency failure, and other outcomes where backend success cannot safely be ruled out); clear on terminal outcomes (successful 200 once the result is safely represented to the Owner, explicit Owner discard, validation failure that makes the request unusable, idempotency conflict requiring a fresh request, TTL expiry). Implementation may refine exact error categories according to existing `OwnerApiResult` semantics while preserving this principle. **Process-death recovery:** authorize Android to restore a still-valid pending capture on returning to the capture experience after process death/app restart, offering explicit **Retry** and **Discard**. No automatic background sending is authorized. Rocket remains online-first. **Runtime model strategy:** S3.3 may use narrow hand-written Android wire DTOs for manual-capture responses rather than directly deserializing generated polymorphic `TaskSummaryPoint` models, because existing Android architecture already uses hand-written Moshi DTOs for the same polymorphic TaskSummaryPoint wire contract; generated Kotlin models remain valuable for contract generation/drift/compile governance; S3.3 must not create a second semantic proposal model, only a runtime wire-decoding representation. Reuse existing `CaptureSummaryPointWire` where appropriate. Do not implement a new Android interpretation model. **Kotlin generator anomaly (non-blocking known tooling issue):** openapi-generator 7.14.0 currently generates an anomalous `Recipient` supertype after the S3.2 schema additions; authored/bundled OpenAPI remains semantically correct; S3.2 full canonical verification already passed, including Android api-contract compilation; Android does not consume generated `Recipient` at runtime; S3.3 does not require generated Recipient. Therefore the anomaly is not an S3.3 blocker. Do not weaken `additionalProperties: false` contracts or hand-edit generated files merely to hide it. Future contract work should remain alert to the positional generator defect because it may move to another model. Do **not** authorize a generator/toolchain upgrade in D171. **Legacy direct-create transition:** authorize the Android capture UI to stop calling `POST /api/v1/tasks` for manual Owner capture once S3.3 switches the flow. Do **not** remove or modify the backend direct-create Task endpoint. Do **not** require deletion of the old Android direct-create capture implementation in S3.3 — prefer leaving the legacy Android implementation temporarily unused for easy rollback; cleanup may be separately controlled later. Do not remove shared helpers such as `CaptureSummaryPointWire` or `deriveCapturedTaskTitle` where they remain used elsewhere. **Existing networking reuse:** authorize reuse of `OwnerApiExecutor`, `OwnerApiRepository`, Bearer/session handling, connectivity classification, caller-supplied `Idempotency-Key` headers, and existing encrypted pending-operation patterns. Do **not** create another auth stack, another HTTP client, background sync, or a general offline queue. **Logging/privacy:** preserve existing Android safe-logging behaviour. Raw capture text must not be logged, added to diagnostic messages, placed in analytics, or exposed through generic HTTP body logging. No HTTP body logging should be added. **Production posture:** D171 does **not** authorize Production activation. Do not deploy; enable `INTERPRETATION_AI_ENABLED`; modify credentials or secrets; change Production configuration; migrate Production; change cron/aliases; or modify Production auth or data. The Android implementation may exist and compile without Production activation. **Not authorized:** proposal approve; responsibility selection UI; Recipient picker; proposal edit; merge; standalone proposal inbox; Gmail; SMS; reminders; attention system; exclusions; background sync; general offline queue; server raw-input retention; backend API redesign; generic interpretation API; Production activation; later proposal-lifecycle implementation; generator/toolchain upgrade

**Notes:** Owner decision 2026-08-12 (documentation/governance only). D170's Android capture switch / Android proposal UI / S3.3 prohibitions are **lifted only to the extent** of the S3.3 capture-to-proposal boundaries above — D170 remains **Approved**; its S3.2 authorization and every exclusion this decision does not lift remain intact. Complements D154, D157, D161, D162, D169, D170 without redesigning the interpretation contract or inventing a second proposal model. Domain status reconciliation: [ARCHITECTURE.md](ARCHITECTURE.md), [API_CONTRACT.md](API_CONTRACT.md), [MILESTONES.md](MILESTONES.md), [GLOSSARY.md](GLOSSARY.md), [AI_CONSTITUTION.md](AI_CONSTITUTION.md), [DATA_RETENTION.md](DATA_RETENTION.md), [SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md). **Does not begin S3.3 implementation** by itself; the S3.3 slice is the sole implementation authorization granted here, and every item under **Not authorized** remains outside this decision

### D172 — S4 authorization: Rocket Communicator brand/UI alignment (presentation only)

**Status:** Superseded in part

**Decision:** **S4 authorization — Rocket Communicator brand/UI alignment (presentation only):** the Owner establishes **S4 — Rocket Communicator Brand/UI Alignment** as a canonical roadmap milestone ([MILESTONES.md](MILESTONES.md) § Forward sequence), sequenced **ahead of** the deferred Owner Acceptance Week and P2.2. Its purpose is to bring shipped Rocket Communicator presentation into alignment with [BRAND.md](../BRAND.md). **S4 is presentation work only.** It authorizes **no** proposal Accept/Edit/Dismiss implementation, no responsibility-selection implementation, no Task creation from a proposal, no Merge, no Recipient-picker product work, no new interpretation behaviour, and no other deferred product capability; each of those remains separately authorized exactly as before. **No S5 is created here**, and S4 is not a licence to invent further roadmap labels. **Brand authority relationship:** [BRAND.md](../BRAND.md) becomes a **scoped rank-4 domain authority** for Rocket Communicator product branding, visual language, UI presentation, and interaction presentation. It remains subordinate to ranks 1–3 and must **not** originate or override behavioural product law, architecture, API/contracts, security/privacy, authentication/authorization, persistence/data semantics, or roadmap sequencing; where it appears to, the higher-rank document controls and BRAND.md is wrong. BRAND.md defines the canonical brand/UI **target** and by itself authorizes no change to shipped implementation; implementation happens only through separately authorized roadmap/implementation slices. **Canonical S4 colour decisions.** Corporate/inherited: background / Rocket dark `#050506`; primary action / Rocket red `#E10613`. Communicator product tokens: surface `#0B0B0D`; raised surface `#121216`; soft surface `#18181D`; border `#2B2B33`; strong border `#454550`; primary text `#F5F5F7`; muted text `#A1A1AA`; subtle text `#7C7C87`; disabled text `#52525B`. Semantic colours: success `#22C55E`; warning/attention `#F59E0B`; critical/destructive `#EF4444`; strong neutral focus indicator `#D4D4D8`. The earlier subtle-text value `#73737D` and the earlier critical/destructive value `#B91C1C` are **not** the S4 values. **Contrast evidence — independently computed against `#050506` using WCAG 2.x sRGB relative luminance:** `#F5F5F7` 18.7:1, `#A1A1AA` 8.0:1, `#7C7C87` 4.9:1, `#22C55E` 8.9:1, `#F59E0B` 9.5:1, `#EF4444` 5.4:1, `#D4D4D8` 13.8:1 — each clears the **WCAG AA** 4.5:1 normal-text target against the background. Those ratios hold against the background only: contrast on raised and soft surfaces is lower and must be verified per surface during implementation, and subtle text `#7C7C87` measures 4.3:1 on `#18181D`, which does **not** meet the normal-text target on that surface. **Primary versus destructive semantics:** `#E10613` is the canonical Rocket primary-action colour, normally used as a **filled** primary-action treatment with appropriate contrasting text — white on filled `#E10613` measures 5.0:1, while `#E10613` used as text on `#050506` measures 4.1:1 and fails the normal-text target. It is **not** the generic colour for navigation, links, focus, borders, informational chrome, or every interactive element. `#EF4444` is the Communicator critical/destructive semantic colour. Ordinary primary actions and destructive actions must remain visually distinguishable. Do **not** mechanically repoint the legacy teal accent token to Rocket red. **No replacement decorative accent:** Ordinary non-primary interactive presentation uses the neutral system — text hierarchy, dark and raised surfaces, borders, strong borders, neutral focus treatment, and typography or weight where appropriate — with `#D4D4D8` where an explicit strong neutral focus indicator is required, so that Rocket red does not flood general UI chrome. **Shape:** S4 preserves existing per-platform shape behaviour and establishes no radius or shape system. Android controls must **not** be squared as part of S4, and no rounded-card or pill system is introduced; Android's existing Material 3 default shapes may remain, and existing Recipient-specific radii may remain. Future shape changes require an explicit product decision and slice. **Motion and typography:** no new motion system and no new animation requirement; no Android Inter dependency is introduced for S4 alone; **Inter** remains the corporate typography direction, and existing native/platform typography may remain during S4. **Token naming:** a wholesale token rename is **not** authorized. S4 may change existing token values deliberately, add semantic tokens needed to represent the new roles cleanly, and split legacy overloaded accent usage into primary versus neutral/semantic roles. S4 must not become a naming-cleanup project merely because names such as `paper` read poorly after the dark migration; a separate later cleanup may be authorized if it proves useful. **Token traceability preserved, not weakened:** the no-op-refactor-first requirement that makes visual change traceable (D116) was satisfied at P1.4 (D124), and S4 supersedes the shipped P1.4 token values wherever BRAND.md now requires different ones. Deliberate token **value** changes are therefore explicitly authorized. The individual pinning assertions in `apps/web/__tests__/p1-4-tokens.test.ts` must be **deliberately updated** to the newly authorized values in the same reviewed slice that changes them, and must never be deleted, loosened, skipped, or bypassed; `packages/ui` remains a semantic-token layer only (D116, D124). **Accessibility gate:** S4 presentation must meet the WCAG AA normal-text contrast target, provide visible focus, never communicate status by colour alone, and keep primary and destructive treatments distinguishable ([REVIEW_CHECKLIST.md](REVIEW_CHECKLIST.md)). **Not authorized:** any application code, CSS, Kotlin, contract, schema, or package token change in this governance slice; proposal-lifecycle implementation; responsibility-selection implementation; Recipient picker; Merge; interpretation-behaviour change; a new shape, radius, motion, or font dependency; a token-rename project; Owner Acceptance Week execution; P2.2 entry; Production activation

**Notes:** Owner decision 2026-08-12 (documentation/governance only). Establishes **S4** deliberately in the canonical roadmap instead of as an informal label, resolving the S4/S5 numbering caution recorded in D171 by giving the roadmap a defined place for it; no S5 is created. Complements D116, D119, D120, D124, D143, D153, D158, D159, and D171 and amends none of them: their operative text is unchanged, D116's token-layer limits and D124's tokens-only `packages/ui` boundary remain intact, and D119's P1 closure evidence is untouched. Owner Acceptance Week remains deferred and still requires explicit Owner re-authorization (D159), and P2.2 remains unstarted and unauthorized (D143). Reconciliation: [PROJECT_CONSTITUTION.md](PROJECT_CONSTITUTION.md) § Authority model, [MILESTONES.md](MILESTONES.md), [REVIEW_CHECKLIST.md](REVIEW_CHECKLIST.md), [../BRAND.md](../BRAND.md). **Does not begin S4 implementation** by itself; every S4 implementation slice needs its own authorization, and each item under **Not authorized** remains outside this decision. **Superseded in part by D173** (only the clause “S4 introduces no new chromatic accent to replace teal”). **Withdrawn clause:** that sentence; it is **removed from the active text above** rather than annotated in place. Current product rule is **D173**: S4 does not introduce a general decorative accent that competes with Rocket red or floods ordinary UI chrome, and Rocket Communicator may use the restrained supporting informational/interactive colour `#8FA3BF` only for the limited roles authorized by D173. **Still operative:** every remaining clause above — S4 authorization and sequencing, presentation-only boundary, brand authority relationship, canonical S4 colour decisions, contrast evidence, primary-versus-destructive semantics, the remainder of the no-replacement-decorative-accent paragraph, shape, motion and typography, token naming, token traceability and pinning, accessibility gate, and every **Not authorized** item. D173 also adds three supporting Communicator presentation colours — cool surface `#171A21`, cool border `#343946`, and info/interactive `#8FA3BF` — as optional supporting tools, establishes a dedicated **on-primary** role at `#FFFFFF`, and authorizes the first S4 implementation slice, **S4.1 — Owner Web Visual Foundation**, within its own stated boundaries; every other S4 implementation slice still needs its own authorization. **Inert history — not current law (withdrawn by D173; emphasis removed).** Formerly read: “S4 introduces no new chromatic accent to replace teal.”

### D173 — Controlled S4.1 authorization: Owner web visual foundation (additive, Owner-scoped)

**Status:** Approved

**Decision:** **Controlled S4.1 authorization — Owner web visual foundation:** the Owner explicitly authorizes the first controlled implementation slice of **S4** ([MILESTONES.md](MILESTONES.md) § Forward sequence): **S4.1 — Owner Web Visual Foundation**, which establishes the Rocket Communicator dark presentation on the **Owner web surface only**. D172 remains operative law for S4 and for the canonical S4 colour decisions except for the single clause this record withdraws. This record **supersedes in part D172** (only the clause “S4 introduces no new chromatic accent to replace teal”). No other D172 clause is withdrawn or changed. The supporting colours added below extend the D172 palette rather than replacing any value in it. **Replacement product rule:** S4 does not introduce a general decorative accent that competes with Rocket red or floods ordinary UI chrome. Rocket Communicator may use the restrained supporting informational/interactive colour `#8FA3BF` only for the limited roles authorized by this record. `#8FA3BF` is not a Rocket Logic corporate colour, not a new status semantic, not a primary-action colour, and does not represent success, warning, or destructive/error; it is optional and restrained; dark neutrals remain the overwhelming majority of the interface. S4.1 is **presentation work only** and creates no product capability. **Shared-token compatibility boundary — deliberate, and not to be "cleaned up" during implementation:** the Owner web surfaces and the still un-migrated Recipient `/c/{token}` surface share one token layer, and the Recipient stylesheet consumes the shared legacy tokens directly while `apps/web/app/globals.css` supplies the page background, body colour, paragraph colour, and `color-scheme` for every route including `/c/{token}`. S4.1 is therefore **additive and Owner-scoped**: it must **not** globally re-value a shared legacy token, and must not change global element styling, where doing so would alter or break the currently un-migrated Recipient capability surface. The externally visible Recipient `/c/{token}` experience must remain **visually and functionally unchanged** during S4.1. S4.1 may introduce the minimum additional token roles and scoping necessary for the Owner web dark presentation **without forcing Recipient migration**, and must **not** touch the Recipient implementation merely to make a global token flip convenient. Recipient visual migration is a later S4 slice and is **not** authorized here. This boundary is a recorded compatibility decision, not accidental debt; do **not** remove the Owner scoping, collapse the additive tokens into the shared legacy ones, or "finish" the migration opportunistically inside S4.1. **Existing Recipient token guards are not evidence of preservation:** the Recipient browser guard resolves each token at runtime and compares the Recipient surface against the resolved value, so it detects a token **remap** but cannot detect a global **re-value**; its continued green must **never** be cited as proof that Recipient presentation was preserved. **D172 colours preserved:** background `#050506`; surface `#0B0B0D`; raised surface `#121216`; soft surface `#18181D`; border `#2B2B33`; strong border `#454550`; primary text `#F5F5F7`; muted text `#A1A1AA`; subtle text `#7C7C87`; disabled text `#52525B`; Rocket primary `#E10613`; success `#22C55E`; warning `#F59E0B`; critical/destructive `#EF4444`; strong neutral focus `#D4D4D8`. None of these is removed, replaced, or re-valued. **Supporting Communicator presentation palette (additive):** three further product colours are authorized — **cool surface `#171A21`**, **cool border `#343946`**, and **info/interactive `#8FA3BF`**. They are Communicator-owned product colours, optional supporting presentation tools, **not** Rocket Logic corporate colours, **not** new status semantics, and **not** replacements for any D172 colour. Cool surface `#171A21` may be used for selected rows, quiet informational panels, subtle differentiated regions, and restrained selection or background emphasis; it must **not** become the default surface merely because it exists. Cool border `#343946` may be used for selected or active boundaries, informational separation, and subtle cool-toned structural emphasis; do **not** assume it satisfies accessibility-critical 3:1 boundary contrast, and verify actual adjacent-surface contrast before assigning it a role where the boundary itself must be perceivable for accessibility. Info/interactive `#8FA3BF` may be used for restrained informational text and icons, links where contrast permits, non-primary interactive emphasis, and informational or selected treatment; it must **not** be used for primary actions, success, warning, destructive/error, or decoration everywhere simply because an accent is available. **Supporting-palette contrast evidence, independently computed using WCAG 2.x sRGB relative luminance:** `#8FA3BF` measures 7.92:1 on `#050506`, 7.64:1 on `#0B0B0D`, 7.26:1 on `#121216`, 6.87:1 on `#18181D`, and 6.76:1 on `#171A21`, so it clears the AA 4.5:1 normal-text target on every authorized surface; on cool surface `#171A21` the D172 text tokens measure `#F5F5F7` 15.99:1, `#A1A1AA` 6.79:1, and `#7C7C87` 4.22:1, so **subtle text `#7C7C87` does not meet the normal-text target on `#171A21`** and must not be used for normal-size body text there, exactly as D172 already records for `#18181D`. This is the **final** supporting colour addition currently authorized: do **not** invent additional chromatic colours during S4.1. **Colour hierarchy:** Rocket red `#E10613` is the primary action; `#8FA3BF` is restrained information and non-primary interaction where appropriate; `#22C55E` is success; `#F59E0B` is warning/attention; `#EF4444` is destructive/error; dark neutrals are the overwhelming majority of the interface. **Colour functions as punctuation, not decoration** — do not turn every interactive element into a chromatic element. **Primary-action foreground — a dedicated `on-primary` role:** the shipped Owner primary control takes its foreground from the surface token, which cannot safely become the foreground of a `#E10613` primary button once that token carries a near-black dark-foundation value, so a dedicated **on-primary** semantic role is authorized. Independently computed using WCAG 2.x sRGB relative luminance, `#FFFFFF` on `#E10613` measures **4.96:1** and clears the AA 4.5:1 normal-text target, while `#F5F5F7` on `#E10613` measures 4.55:1. The S4.1 **on-primary** value is **`#FFFFFF`**. D172's primary-text token `#F5F5F7` must **not** be altered to solve button foreground contrast: **primary text and on-primary are separate semantic roles**. **Destructive treatment:** `#EF4444` remains the canonical critical/destructive semantic colour. White on a filled `#EF4444` background measures **3.76:1**, which does **not** satisfy the normal-text AA target, so this record must **not** be read as implying that destructive actions use a filled `#EF4444` button with white normal-size text. Accessible destructive presentation is authorized using the semantic colour in treatments such as destructive text on a sufficiently dark surface — `#EF4444` measures 5.41:1 on `#050506`, 5.23:1 on `#0B0B0D`, 4.97:1 on `#121216`, 4.70:1 on `#18181D`, and 4.63:1 on `#171A21` — destructive icon with text, destructive border or accent treatment, or another contrast-verified presentation; implementation must verify the actual foreground/background pair it ships. Do **not** change the canonical destructive colour merely to make one particular button construction work. **Border accessibility, recorded correctly:** the canonical border tokens are primarily **structural presentation** tokens; they are **not** automatically sufficient as the sole visual cue for an accessibility-critical control boundary or state. Measured against the authorized surfaces, `#2B2B33` reaches at most 1.45:1, `#454550` at most 2.15:1, and cool border `#343946` at most 1.77:1 — each against `#050506`, and lower against every raised surface — so none may be assumed to satisfy 3:1 non-text contrast, and cool surface `#171A21` differs from surface `#0B0B0D` by only 1.13:1, so a selected-row fill must never be the sole cue. Where WCAG non-text contrast requires a perceivable boundary or state, implementation must provide sufficient contrast through an appropriate border, focus treatment, fill difference, text or icon cue, or a combination; the strong neutral focus indicator `#D4D4D8` clears the target comfortably at 13.78:1 on `#050506` and 11.78:1 on `#171A21`, and a filled `#E10613` control boundary clears it at 4.11:1 on `#050506` and 3.51:1 on `#171A21`. Do **not** incorrectly require every decorative separator to achieve 3:1. **Colour-vision accessibility:** colour reinforces meaning and must **never** carry meaning alone. Status, priority, responsibility, warnings, errors, success, selection, and available actions must remain understandable without colour recognition, using appropriate combinations of text, iconography, labels, position, weight, border or fill treatment, and other non-colour cues. Do **not** create colour-only state distinctions. **Authorized S4.1 scope:** additive Owner-scoped visual tokens; Owner web dark surfaces; Rocket-red primary-action treatment; the dedicated on-primary treatment; neutral and supporting informational/interactive treatment; success, warning, and destructive presentation; focus treatment; Owner-scoped `color-scheme` treatment where technically appropriate; Owner stylesheet semantic-role migration; the directly required D116 token-pinning and test updates; and the directly required accessibility and browser-test updates. Nothing beyond what is necessary to establish the Owner web dark visual foundation is authorized. **Token layer and pinning:** D116 and D124 remain intact and `packages/ui` remains a semantic-token layer only — no component, no markup, no logic. New tokens are **additive**; the individual pinning assertions in `apps/web/__tests__/p1-4-tokens.test.ts` must be **deliberately updated** in the same reviewed slice that changes or adds a value, and must never be deleted, loosened, skipped, or bypassed, and the assertion that no token exists beyond the recorded set must be extended with the new tokens rather than weakened. A wholesale token rename remains unauthorized (D172). **Not authorized:** Recipient visual migration; global shared-token changes that alter Recipient presentation; Android migration; proposal-lifecycle implementation; responsibility selection; Recipient picker; Task creation from proposals; Merge; architecture changes; API/contracts; schema/database; auth/security; Gmail/SMS; reminder semantics; product-name cleanup; logo/favicon work; typography dependency changes; shape/radius redesign; motion/animation; Production activation

**Notes:** Owner decision 2026-08-12 (documentation/governance only). **Supersedes in part D172** (only the clause “S4 introduces no new chromatic accent to replace teal”). No other D172 clause is withdrawn or changed. D172's status is therefore **Superseded in part**. This record also adds three supporting Communicator presentation colours and a dedicated on-primary role, and authorizes the first S4 implementation slice. D172's canonical colour decisions, contrast evidence, primary-versus-destructive rule, the remainder of the no-replacement-decorative-accent paragraph, shape and motion rules, typography rule, token-rename prohibition, and token-pinning requirement all remain operative. `#8FA3BF` is authorized as a restrained supporting informational/interactive colour and is **not** a general decorative accent, so D172's neutral-first rule for ordinary non-primary interactive presentation continues to govern except where this record authorizes `#8FA3BF`. Complements D116, D119, and D124 and amends none of those three. Contrast values above were computed independently for this record from WCAG 2.x sRGB relative luminance and are consistent with the figures D172 records to one decimal place. Reconciliation: [MILESTONES.md](MILESTONES.md), [../BRAND.md](../BRAND.md), [REVIEW_CHECKLIST.md](REVIEW_CHECKLIST.md) § Presentation and brand. **Does not begin S4.1 implementation** by itself; the S4.1 slice is the sole implementation authorization granted here, later S4 slices including Recipient and Android visual migration remain separately unauthorized, and every item under **Not authorized** remains outside this decision

## Notes

- **Retired labels.** "Stage 12", "A8.7d", and "A8.7e" named what is now called **A8 operational enablement**. D140 withdrew that sequencing; where an earlier row excluded those labels, the exclusion stands and reads as "A8 operational enablement". No new meaning is invented for them.
- **Proposed** → promote to Approved before dependent implementation.
- **Open** → [OPEN_QUESTIONS.md](OPEN_QUESTIONS.md).
- **Deferred** → intentionally out of the early delivery path.
