# Milestones

**Current:** **A7 is CLOSED** — Gmail forwarding and assignment email are **Production-operational**. A7.1–A7.8 shipped and the full production E2E passed on production SHA `8da353692c39484467f8f4651acf101fa172f4e8` (both delivery paths, Recipient capability completion, Owner-visible notes). Completion tag: `v0.7.0-a7-complete`. A7.0 decisions remain locked (D086–D094). **A8.0 documentation Decision Lock** is recorded (D095–D101) and is now partly superseded. **A8.1 documentation Decision Lock** is recorded (**D102–D110**): A8 is revised to a **due-date-driven** reminder model under a narrow constitutional exception. A8 implementation is **not** started — no A8 code, schema, migration, contract, environment configuration, scheduler, or UI exists — and requires explicit authorization. **P1.0 documentation Decision Lock** is recorded (**D111–D120**): [P1](#p1--application-experience-foundation) is now scoped, and P1 implementation (P1.1–P1.5) is **authorized but not started** — no P1 code, shell, token package, telemetry, browser test harness, or observability seam exists. A6 Application Suggestion Engine remains **CLOSED** in Production (tag `v0.6.0-a6-complete`). A5 Gmail connection and polling remains **closed and healthy**. Milestone identifiers are unchanged: **A7 → A8 → A9** (no early separate A9.0). **P1** (Application Experience Foundation) is a distinct milestone sequenced before the remaining A8 implementation slices and is **not** folded into A8; see [Delivery sequence](#delivery-sequence). Handoff items deliberately deferred out of A7 are listed under [A7 deferred backlog](#a7-deferred-backlog-not-a-milestone).

Process: [ENGINEERING_WORKFLOW.md](ENGINEERING_WORKFLOW.md) · [REVIEW_CHECKLIST.md](REVIEW_CHECKLIST.md) · Operations: [DEPLOYMENT.md](DEPLOYMENT.md)

---

## Completed

### A0 — Documentation and Git baseline

**Status:** Complete. Product/architecture docs, constitutions, glossary, local `main`.

### A1 — Monorepo and application shells

**Status:** Complete. pnpm workspaces; Next.js and Android Compose shells; shared ESLint/TS configs; CI smoke. Foundation: `com.aicommunication.assistant`, `minSdk` 31, Node 22, pnpm 9.15.9, Next.js 16.2.10, React 19.0.0, AGP 8.8.2, Kotlin 2.1.10, Gradle 8.12.1.

### A2 — Contract and domain foundation

**Status:** Complete. OpenAPI is canonical (D007); TypeScript and Kotlin DTOs are generated and committed (D044, D047); domain types remain separate from generated DTOs (D046); optimistic concurrency contract established (D045).

### A3 — Owner authentication

**Status:** Complete. Web-only Supabase Google OAuth for the single Owner (D048): `/login`, `/auth/callback`, `GET /api/v1/session`, `OWNER_ORGANIZATION_ID` + `OWNER_WORKSPACE_DOMAIN`. Production-verified (`organizationId` = `axford`).

### A4 — Task core and Recipient capability web view

**Status:** Complete.

**Automated:** Product implementation finished; `pnpm test`, `pnpm build`, contract checks, and `pnpm verify` pass.

**Production:**

- Supabase migration `20260713190000_a4_persistence_foundation` **applied**
- Full production Owner↔Recipient E2E **passed**
- Classification: **`A4_FULL_E2E_PASS`**
- Production health baseline confirmed: `GET /api/v1/session` → 200 (`role` = `owner`, `organizationId` = `axford`); `GET /api/v1/tasks` → 200
- Verified in production: Owner task creation, mutation, version conflicts, notes, waiting/resume, completion, dismissal, capability issuance, Recipient actions, capability expiry/revocation, work requests, audit attribution, and persistence
- Retained E2E artifacts are **intentional operator-runbook data** (not repository secrets)
- `ENABLE_DB_RUNTIME_DIAGNOSTICS` disabled in Production; no temporary incident probe headers

**Out of scope for A4 (unchanged):** AI ingest, Gmail connection/forward, Android task UI; Owner suggestion **review/approval HTTP** (A6); raw IP / full UA retention (D057); Recipient voice (D058 → A12).

**Binding decisions:** D055–D064. OPEN #21 closed in A7 (**D086**).

### A5 — Gmail connection and polling

**Status:** Complete and **Production-operational**. A5 is **CLOSED** except for future bug fixes.

Connect one inbox; poll every **five minutes** (D065); create communication events only (D077). Application owns the Application Polling Engine; scheduling is external and vendor-neutral (D079).

**Production-verified capabilities:**

- Gmail OAuth connected (`gmail.readonly`, D070)
- Tokens encrypted at rest (purpose-bound AES-256-GCM)
- Initial History cursor seeded (no historical backfill, D067)
- Incremental History polling stable via External Scheduler (**cron-job.org**) every five minutes
- Sync locking, duplicate protection, and system audit attribution (D074) verified
- A4 functionality remains intact; Production remains healthy

**Deferred (do not block A7):** Gmail settings UI; History recovery / `resync_required` operator recovery UX.

**Binding decisions:** D065–D079.

---

### A6 — AI relevance and task suggestions

**Status:** Complete and **Production-operational**. A6 is **CLOSED**. Completion tag: `v0.6.0-a6-complete`.

**Production-verified capabilities:**

- A6.0–A6.3 on `main` (docs/decisions D080–D085, persistence, Owner suggestion HTTP, Application Suggestion Engine + `packages/ai`)
- Production migration applied; Production LLM path verified (D085)
- Owner dismiss/approve workflow verified; approve creates **unassigned Task only** (D080)
- D082 excerpt retention confirmed: dismissed **+7 days**, approved **+30 days**
- Separate External Scheduler job (**cron-job.org**) invokes `POST /api/v1/internal/suggestions/process` every five minutes
- Four consecutive automatic scheduler executions observed healthy (HTTP 200, no run overlap, claim fairness: fresh `unprocessed` before `failed_retryable`, no duplicate suggestions/Tasks, no stuck leases)
- Gmail poll remains healthy and isolated on its own scheduler job
- Privacy-safe AI diagnostics only (fingerprints; no bodies/prompts in audits)

**Binding decisions:** D080–D085.

---

### A7 — Gmail forwarding and assignment email

**Status:** Complete and **Production-operational**. A7 is **CLOSED**. Completion tag: `v0.7.0-a7-complete`. A7.0 decisions locked (D086–D094).

**Delivered intent:** Single Owner confirmation (D037) for Recipient handoff on an **existing** unassigned Task (D080): Assignment + Capability + Gmail forward (Gmail-origin) or assignment email (non-Gmail), via `POST /api/v1/tasks/{taskId}/handoff` (D090). Follow-up Engine and Event Notification Engine remain **A8** (D089, D095–D101).

**Production closure evidence (2026-07-28):**

- Production SHA `8da353692c39484467f8f4651acf101fa172f4e8` on `main`; Vercel production deployment `dpl_4bhuar8LWAhC1tJhYfhfcbsnCuSS` **Ready** and holding the production alias
- Migrations `20260718210000_a7_handoff_persistence` and `20260718223000_a7_handoff_concurrency_hardening` **applied and verified** in Production
- **Database recovery:** Production `DATABASE_URL` had combined the direct database host with the pooler port, which no server answers, so every Owner database route failed at connection time. Corrected to the Supabase **Shared Pooler (Supavisor) transaction** host; see [DEPLOYMENT.md](DEPLOYMENT.md). A `/tasks` segment error boundary now surfaces an explicit actionable error instead of a blank page when a dependency fails
- **Authenticated Owner Tasks validated:** Owner sign-in, `/tasks` list, and `/tasks/[taskId]` detail load reliably in Production (direct load and in-app navigation)
- **Gmail send re-consent completed:** the stored Owner grant carries `gmail.readonly` + `gmail.send` (D093); polling capability remained intact
- **Both delivery paths verified sent** with recorded provider message ids: `gmail_forward` on a Gmail-origin Task and `assignment_email` on a non-Gmail Task
- **Recipient capability completion:** non-mutating capability GET; standing note, clarification request, and completion with a completion note; one active capability per Assignment; repeat submission idempotent
- **Owner status update and notes visibility:** Task reached `completed` with delivery `sent`; Recipient standing notes and the completion outcome + completion note render on Owner Task detail with correct attribution labels and no capability token or URL exposure
- **Truthful audit chain** for the controlled Task, all outcomes `succeeded`: `create_task` (owner) → `handoff.prepared` → `handoff.sent` (owner) → `add_task_note` → `request_clarification` → `complete_task` (capability)
- **No regression:** A4/A5/A6 remain healthy; unauthenticated gates unchanged (`/` → 200, `/tasks` → 307 to `/login`, `/api/v1/tasks` → 401, `/api/v1/session` → 401)

Slice status:

- **A7.1 contracts — complete.** OpenAPI handoff/recipient/Gmail/capability shapes + committed generated TypeScript/Kotlin (content-idempotent, generator 7.14.0).
- **A7.2 domain — complete.** Pure handoff policy: delivery-path selection, eligibility, idempotency/fingerprint, incomplete-forward, capability access, lifecycle.
- **A7.3 persistence — complete.** Prisma schema + migrations; HandoffAttempt/Assignment/Capability transactions; one-active + provider-message uniqueness; retry token rotation and `attemptCount` send-generation guards; no raw token in the DB layer. Initial begin bumps Task version under If-Match CAS.
- **A7.4 Gmail transport — complete.** `gmail.send` scope handling + incremental re-consent detection; assignment-email and Gmail-forward builders (forwards include persisted Task `summaryPoints` + all required attachments); MIME/attachment/base64url safety; privacy-safe provider error normalization.
- **A7.5 internal orchestration — complete.** Internal application service coordinating persistence + transport off the DB transaction; exclusive retry ownership; send-generation stale-result rejection; server-controlled HTTPS-enforced capability base origin.
- **A7.6 Recipient management + task-create guard — complete.** Authenticated Owner Recipient endpoints + deterministic `POST /api/v1/tasks` rejection of any supplied top-level `recipientId`.
- **A7.7 authenticated Owner handoff HTTP + route-level delivery orchestration — complete.** `POST /api/v1/tasks/{taskId}/handoff` with idempotency-first classification (successful/pending/failed replay + new initial), server-selected delivery mode, Gmail-forward completeness, assignment-email delivery, send-scope/re-consent errors, private→public error mapping, durable audits on state transitions. **No** Owner UI, re-consent UI, reassignment, explicit re-forward, proposed-Recipient hints, reconciliation worker, Follow-up Engine, or production rollout in this slice. Contract/generated clients/Prisma schema/migrations unchanged.
- **A7.8 Owner confirmation UI + Gmail send re-consent UI — complete.** New thin Owner pages `/tasks` and `/tasks/[taskId]` (did not exist before A7.8); hard Owner auth gate; Recipient select; modal confirmation with `handoff_confirmed_v1`; sessionStorage pending-operation recovery retaining original If-Match + Idempotency-Key; manual retry after OAuth re-consent (no auto-send); truthful pending/ambiguous UX; connection DTO emits `canSend` / `requiresSendReconsent`. **No** reassignment, re-forward, proposed hints, reconciliation, Follow-up Engine, Recipient CRUD UI, production rollout, or OpenAPI/schema/migration changes.
- **A7 closure fixes — complete.** `/tasks` segment error boundary (explicit actionable error instead of a blank page); Owner Task detail renders Recipient notes plus the completion outcome and completion note with truthful attribution. No contract, schema, or migration change.

**Acceptance criteria (closure state):**

- [x] OpenAPI defines `POST /api/v1/tasks/{taskId}/handoff` with `If-Match` and required idempotency key; generated clients committed (A7.1)
- [x] Minimal Owner Recipient management: list active, create/update, mark inactive (D087)—no CRM — **implemented in A7.6**
- [x] Handoff consumes existing Owner-owned / A6-approved **unassigned** Tasks; does **not** recreate the Task — **implemented in A7.7**
- [x] Server selects Gmail-forward vs assignment-email from Task source; both send via Owner’s connected Gmail (`gmail.readonly` + `gmail.send`, D093) — **implemented in A7.7**; **both paths production-verified** at closure
- [x] Gmail-origin forward includes Task `summaryPoints` above original and all attachments; knowingly incomplete forwards are not sent (D088) — **implemented in A7.7**
- [x] Delivery model `pending` / `sent` / `failed` (D092); actionable capability only after successful send; durable HandoffAttempt (or equivalent) preferred — **implemented in A7.7** (via A7.3–A7.5 + route)
- [x] One active capability per Assignment; matched **superseded** capabilities may return `CAPABILITY_NO_LONGER_ACTIVE`; other unusable/unmatched cases remain generic `UNAUTHORIZED` (D086) — one-active enforcement and error codes shipped and production-verified. **Descoped at closure:** reassignment / explicit re-forward revocation orchestration → [A7 deferred backlog](#a7-deferred-backlog-not-a-milestone)
- [x] Same failed-delivery retry reuses attempt/capability unless Recipient or security-sensitive details changed (D086, D092) — **implemented in A7.7** (same-key failed retry via A7.5 `retryHandoff`; snapshot address preserved)
- [x] `POST /api/v1/tasks` create-with-`recipientId` rejected/deprecated once handoff ships (D091) — **implemented in A7.6**
- [x] Thin Owner confirmation UI discloses D037 handoff + Gmail retention boundary; does **not** claim a Follow-up Schedule is active (D089, D094) — **implemented in A7.8**
- [x] Insufficient `gmail.send` → clear re-consent / insufficient-scope path (D093) — **API path A7.7**; **Owner re-consent UI A7.8**
- [x] No Follow-up Schedules, Follow-up Engine jobs/sends, or Event Notification Engine processing in A7 (D089) — **still true after A7.8**
- [x] No fresh LLM during handoff (D094) — **verified in A7.7/A7.8 and in production**. **Descoped at closure:** optional `proposedRecipientHint` → `proposedRecipientId` deterministic resolution is **not** in the current OpenAPI request → [A7 deferred backlog](#a7-deferred-backlog-not-a-milestone)
- [x] Production E2E: Gmail-origin forward + non-Gmail assignment email + Recipient capability action; A4/A5/A6 baselines remain healthy — **passed 2026-07-28** (see production closure evidence above)

**Out of scope for A7:** Follow-up Engine and Event Notification Engine (A8; D095–D101); Android Owner UI (A9); Gmail settings UI / History recovery; CRM; `gmail.modify` unless a new Decision.

**Binding decisions:** D037, D042, D080, D086–D094 (and D010, D011, D016, D031 as applicable). A8.0 product law (D095–D101) must not be implemented inside A7.

#### A7 deferred backlog (not a milestone)

Handoff work deliberately **descoped from A7** at closure. None of it blocks A8, and none of it is authorized to start implicitly — each item needs its own planned, reviewed slice under [ENGINEERING_WORKFLOW.md](ENGINEERING_WORKFLOW.md).

| Deferred item                                                                             | Notes                                                                        |
| ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Reassignment and explicit re-forward orchestration (revoking the prior active capability) | D086 policy, domain, and persistence primitives exist; no orchestration/HTTP |
| `proposedRecipientHint` → `proposedRecipientId` deterministic resolution                  | D094(6); fields absent from the current handoff request schema               |
| Reconciliation worker for stale or uncertain `pending` handoff attempts                   | Discoverable as stale `pending`; no `unknown` status was introduced          |
| Owner UI for Recipient management (create/update/deactivate)                              | A7.6 HTTP endpoints exist; Recipients are currently managed via those APIs   |
| Orphan OAuth fallback path `/settings/gmail`                                              | Unreachable in practice; A7.8 always supplies a Task `returnPath`            |
| Gmail settings UI and Gmail History recovery / `resync_required` operator UX              | Deferred from A5; unchanged by A7                                            |

**Naming note:** do **not** label this backlog “A7.5”. `A7.5` already names the **completed** internal handoff orchestration slice listed above, and reusing the label would make the milestone history untruthful. A future authorized slice needs a new, unused identifier.

---

## Planned

### Delivery sequence

Sequencing only — **no milestone is renumbered**. A8, A9, and later milestone identifiers are unchanged.

1. **P1** — Application Experience Foundation (distinct milestone; **not** part of A8 and not folded into it). **P1.0 decision lock is complete** (D111–D120); P1.1–P1.5 are authorized and not started. Scope: [P1](#p1--application-experience-foundation).
2. **A8.1** — documentation and decision lock (**complete**)
3. **A8.2** — timezone and pure scheduling logic
4. **A8.3** — persistence and APIs
5. **A8.4** — scheduler and delivery behind a **disabled** production feature flag
6. **A8.5** — Event Notification Engine
7. **A8.6** — Owner UI, built on P1 foundations
8. **A8.7** — controlled production enablement and evidence

P1 precedes the A8 Owner UI so the due-date control and schedule panel are built once on a settled experience foundation. Documentation precedes A8 code (Engineering Rule #1).

**Honest dependency note.** A8.2, A8.3, A8.4, and A8.5 do not touch the Owner interface and are not technically blocked by P1's visible work. What P1 genuinely owes A8 is narrower and specific: the observability seam and correlation reference before a scheduler exists in production (D115), the generic Owner attention and operational-status destination required by D108 (D118), and the organization-timezone-aware display formatter (D117). P1 nevertheless runs first under Implementation Rule #1 (one milestone at a time) so the token layer and shell do not compete with new A8.6 UI code.

### P1 — Application Experience Foundation

**Status:** **P1.0 documentation Decision Lock complete (docs-only)** — D111–D120. **P1.1–P1.5 authorized, not started.** No P1 code exists: there is no application shell, no `packages/ui`, no telemetry or observability seam, no browser test harness, no loading state, no global error fallback, and no not-found state.

**Purpose.** Establish the minimum shared Owner web application experience and operational foundations needed for reliable Owner use, and so later A8 Owner-facing surfaces are built **once**, consistently. P1 is a **foundation** milestone, not cosmetic polish (D111): the experience layer it creates has never existed, because A7.8 deliberately shipped thin Owner surfaces with no shell.

**Platform.** The existing Owner web routes (`/`, `/login`, `/tasks`, `/tasks/{taskId}`) plus the Recipient capability surface (`/c/{token}`) where truthfulness, boundary coverage, and accessibility require it. **Android application experience remains A9 by name** and must not be pulled into P1 (D111).

**In scope — the nine authorized foundation areas (D111):**

1. **Owner web application shell** — consistent navigation, Owner identity context, sign-out access, a `<main>` landmark, mobile-first layout, and a generic Owner-level attention and operational-status destination (D118).
2. **Truthful experience states** — loading, empty, retryable error, ambiguous mutation outcome, offline or lost connectivity, stale data, and mutation in progress (D112). **No optimistic mutation success.**
3. **Operational data taxonomy** — business records, audit history, operational telemetry, and structured learning signals defined and separated (D113).
4. **Minimal observability foundation** — vendor-neutral seam for one correlation reference, privacy-safe structured server diagnostics, route or operation timing, and silent-failure detection (D115).
5. **Capability-route telemetry prohibition** — capability routes fully excluded from client telemetry; no capability token or raw `/c/{token}` path in any telemetry, log, or error payload (D114).
6. **Shared presentation rules** — Task title and summary derivation, status labels, timestamp formatting, semantic state presentation, and organization-local date display; `packages/ui` as a semantic-token layer only (D116).
7. **Organization-timezone-aware display** — presentation infrastructure only; D103 remains the scheduling authority (D117).
8. **Boundary and accessibility foundation** — route loading state, segment error boundaries, global error fallback, not-found state, keyboard-accessible dialogs, focus handling, semantic landmarks, and baseline contrast (D119).
9. **Browser-level verification** — a lightweight browser test layer for critical Owner and Recipient journeys, run as a separate job (D119).

**Explicitly out of scope for P1:**

Android application implementation; offline database or local business-record cache; service-worker caching of authenticated business data; offline mutation queues; background synchronization; conflict resolution; new Task, suggestion, Recipient-management, or Gmail-settings features; the A8 reminder scheduler or persistence; the A8 due-date control; A8 schedule-status functionality; OpenAPI reminder-debt cleanup; dormant reminder calculator cleanup; schema or migration changes; a general or broad component library; design-token generation for Kotlin; arbitrary visual redesign; commercial analytics or behavioural tracking; AI-controlled UX adaptation; audit-model changes; reconciliation workers; and unrelated A6 or A7 backlog features.

**Additionally not P1 requirements:** **dark mode** is not a closure requirement — no existing decision or product authority requires it, and a dual-theme slice needs separate authorization (D119). A **health or readiness endpoint** is not authorized and is not a closure requirement — existing session and task smoke checks plus P1.1 diagnostics are sufficient, a contract test asserts `/health` is absent from the bundled OpenAPI, and a new unauthenticated surface needs its own decision; it is recorded as a separately authorized operational proposal (D115).

**Implementation sequence (locked; implementation not started):**

| Slice    | Content                                                                                                                                                                                                        |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P1.0** | **Documentation and decision lock — complete.** D111–D120; no code                                                                                                                                             |
| **P1.1** | Minimal observability and unified correlation foundation (D115), with the **baseline captured before any experience change** (D119)                                                                            |
| **P1.2** | Browser verification harness for critical existing Owner and Recipient journeys (D119), as a separate job                                                                                                      |
| **P1.3** | Request and render reliability plus truthful loading and error states (D112): request-scoped auth deduplication, route loading states, bounded list queries, client request timeouts                           |
| **P1.4** | Owner shell, constrained presentation foundation, organization-timezone display, and the Owner attention / operational-status destination (D116, D117, D118). Tokens land as a **no-op refactor first** (D116) |
| **P1.5** | Boundary completion, accessibility verification, connectivity feedback, and production validation against the P1.1 baseline (D112, D119)                                                                       |

P1.1 precedes every visible change because no baseline exists today; measuring after changing forfeits the comparison (D119). P1.2 precedes P1.3–P1.5 so visual and render refactors have a regression net before, not after. The `/c/{token}` surface is touched **last** within P1.5: it is externally visible and security-sensitive.

**Acceptance criteria (P1 closure):**

- [ ] **P1.0 lock recorded** — D111–D120 approved; P1 scope, exclusions, slices, and criteria documented; `REVIEW_CHECKLIST.md` carries answerable P1 gates
- [ ] **Consistent Owner shell** across all authenticated Owner routes: navigation, Owner identity context, reachable sign-out, `<main>` landmark, mobile-first layout
- [ ] **A shell location exists for the future D108 Owner status surface** (D118), generic rather than reminder-specific, and truthful when empty
- [ ] **Truthful loading, error, and lost-connectivity feedback** on every current route (D112)
- [ ] **No optimistic mutation success** anywhere; ambiguous handoff outcomes still presented as genuinely uncertain (D112)
- [ ] **Retry semantics correct in both directions** (D112): an ambiguous or transport retry reuses the same `Idempotency-Key` and the original `If-Match` so a durable attempt replays; a confirmed `412 PRECONDITION_FAILED` refreshes authoritative state before a new attempt rather than looping on a known-stale `If-Match`
- [ ] **One useful correlation reference** joins the user-visible error reference, server diagnostics, and the audit row where one exists — proven by forcing a real failure and following a single value end to end (D115)
- [ ] **Privacy-safe telemetry with capability-secret protection** — an automated assertion proves no capability token or raw `/c/{token}` path can appear in any telemetry, log, or error payload (D114)
- [ ] **Route-boundary coverage** — every current route has a loading state, segment error boundary coverage, a global error fallback, and a styled not-found state (D119)
- [ ] **Keyboard and focus behaviour validated for both confirmation dialogs**, including Escape and focus restoration (D119)
- [ ] **Accessibility gate met** — zero **serious or critical** automated findings on the current routes; contrast passes in the shipped theme (D119)
- [ ] **Browser-level critical-journey coverage** for Owner sign-in, Task list, Task detail, handoff confirmation, and the Recipient capability journey, running as a separate job (D119)
- [ ] **Organization-timezone-aware display** in use for Owner dates and timestamps, with a test proving no dependence on browser, device, or machine-local timezone (D117)
- [ ] **Baseline captured in P1.1 before experience changes**, and any numeric performance threshold **ratified from that evidence** rather than asserted in advance, distinguishing absolute usability thresholds from relative improvement goals (D119)
- [ ] **Structural assertions pass** — exactly one Owner authentication call per Owner page request; documented and asserted maximum database round trips per route (D119)
- [ ] **No A4–A7 behavioural regression** — production regression checks re-pass unchanged; unauthenticated gates unchanged
- [ ] **No A8 runtime implementation** — D102–D110 remain documentation-only; no reminder schema, scheduler, endpoint, flag, due-date control, or schedule-status behaviour
- [ ] **No schema, migration, OpenAPI, generated-client, or Android implementation change**; audit model and mutation-truthfulness semantics unchanged; `pnpm verify` green

**Binding decisions:** D111–D119 (**D120 remains Open** and must be resolved before any product rename; the documented P1 default is to keep the current official name). D102–D110 remain locked and must not be redesigned or implemented by P1. D079 Architecture Principles and D089 (no claim of active reminder behaviour) continue to apply.

### A8 — Follow-up Engine and Event Notification Engine

**A8.0 documentation Decision Lock:** D095–D101 (docs-only). Partly **superseded** by A8.1.

**A8.1 documentation Decision Lock:** **D102–D110 (complete as docs-only).** Revises A8 to a **due-date-driven** reminder model, amends [PROJECT_CONSTITUTION.md](PROJECT_CONSTITUTION.md) under a narrow exception, and supersedes D098 plus parts of D095, D096, and D099. **No A8 code, schema, migration, contract, environment configuration, scheduler, or UI exists.** A8 implementation requires explicit authorization and its own planning/review pass. **Not started.**

**Follow-up Engine (D102–D110):** due-date-driven, **Task-scoped** Recipient reminders. An optional Owner-selected due date — an organization-local **calendar date** with no Owner-selected time — drives one advance reminder at **09:00 organization-local on the day before**, then one reminder at 09:00 organization-local on **each calendar day after** while the Task remains incomplete and eligible, bounded at **14 successful overdue deliveries per schedule generation**. Occurrences use **local-calendar arithmetic**, never fixed 24-hour millisecond offsets, so 09:00 local survives daylight-saving transitions. Waiting suspends and is the **only** pause mechanism. Sends are attributed to a **`system`** actor. Authoritative rules: [WORKFLOWS.md](WORKFLOWS.md) §10a.

**Event Notification Engine (D099):** event-driven Owner notifications (separate engine; no escalation CC ladder). A8 delivers Owner notifications by email via the Owner’s connected Gmail for the core event list; FCM/push remains deferred (D017; A9). It remains a **separate A8 deliverable** and must additionally cover overdue ceiling reached, permanent reminder-delivery failure, no active assignment requiring Owner action, and schedule entering `requiresOwnerAttention` (D106, D108). Authoritative rules: [WORKFLOWS.md](WORKFLOWS.md) §10b.

**Production-enablement gate and closure gate (D108):** scheduler and delivery may merge behind a **disabled** production feature flag, but **production reminder delivery must not be enabled — and A8 must not be claimed closed — until both the Event Notification Engine and the minimum Owner schedule-status UI are operational.** A Task-page status alone is insufficient: the Owner must not have to inspect Tasks continually to discover that an automation stopped.

**Deferred to a separately authorized future slice (D110):** Owner-created additional dated reminders, and their routes, UI, rules, and schema. Not authorized to start implicitly; a future slice needs its own planning/review pass and a new, unused identifier. Also excluded from A8 entirely: preset reminder choices, recurrence editor, reminder-time picker, arbitrary rules, cron expressions, general calendar management, a separate pause mechanism, Recipient reminder preferences, Android reminder UI, and AI-controlled scheduling.

### A9 — Android authentication and Owner interface

Sideload Owner app; approve suggestions, manage Tasks/delegation, and deliver Event Notifications (push remains D017-gated). Manual Task creation remains available but is not the primary goal.

### A10 — Google Messages notification capture

Best-effort Messages → events → suggestions. OPEN #1 (dialer) affects reliability.

### A11 — Missed-call and selected-contact prompts

Always prompt on missed call when detected; completed-call prompts only for known/tracked numbers.

### A12 — Voice capture and transcription

Record → transcribe → confirm; audio delete on success; voice never creates Tasks directly (D038).

### A13 — Retention workers

7-day excerpt and 30-day completed scrub; Gmail mailbox copies untouched (D031). OPEN #12 (tombstone duration). Honours A6 workflow safety ceilings (D082).

### A14 — Learning signals and proposed rules

Owner-only learning (D054); propose rules; never auto-apply in v1.

### A15 — Hardening and private deployment

Private deploy, sideload release, runbooks, capability hardening. OPEN #3/#13 (domains).
