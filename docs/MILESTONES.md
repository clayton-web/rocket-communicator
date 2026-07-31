# Milestones

**Current:** **A7 is CLOSED** — Gmail forwarding and assignment email are **Production-operational**. A7.1–A7.8 shipped and the full production E2E passed on production SHA `8da353692c39484467f8f4651acf101fa172f4e8` (both delivery paths, Recipient capability completion, Owner-visible notes). Completion tag: `v0.7.0-a7-complete`. A7.0 decisions remain locked (D086–D094). **A8.0 documentation Decision Lock** is recorded (D095–D101) and is now partly superseded. **A8.1 documentation Decision Lock** is recorded (**D102–D110**): A8 is revised to a **due-date-driven** reminder model under a narrow constitutional exception. **A8.2 is complete** (D127): pure local-calendar, timezone, and scheduling domain logic exists in `packages/domain/src/reminders/`. **A8.3a is complete** (D128): the reminder persistence foundation — schedule and delivery-attempt tables, `tasks.due_local_date`, database-enforced occurrence idempotency, and claim-lease columns — exists in `packages/db`. **A8.3b is complete**: Owner-authenticated reminder APIs (`GET`/`PUT`/`DELETE /api/v1/tasks/{taskId}/reminder`) and their generated contracts exist, with **no** scheduler, worker, cron, feature flag, email path, or UI. Every remaining A8 slice requires explicit authorization. **P1 is COMPLETE** — implementation complete, deployed, and production-validated. P1.0 documentation Decision Lock is recorded (**D111–D120**); P1.1 through P1.5 are implemented; production serves commit `8588c5d260176b24c8ecf6fb16e026c5c6034359` via deployment `dpl_7vmnL71Lck7JLeftgsJkYVJ4uw82`. Production validation carries **one documented evidence limitation**: the valid Recipient capability workflow could not be validated in production because the application intentionally provides no safe production path for creating a synthetic Recipient capability — an intentional production-safety property, **not** a defect and **not** a failed validation ([P1_5_EVIDENCE.md](P1_5_EVIDENCE.md) §6). No P1 completion tag has been created; tagging remains a separately authorized decision. **A8 is the current milestone: A8.1, A8.2, A8.3a, and A8.3b are complete; A8.4 and every later A8 slice are not started.** The Follow-up Engine and Event Notification Engine are **not operational**: the scheduling domain logic, the persistence schema, and the Owner reminder APIs exist in the repository, the A8.3a migration is **not applied in Production**, and no reminder worker, scheduler, cron job, delivery path, or UI exists. A6 Application Suggestion Engine remains **CLOSED** in Production (tag `v0.6.0-a6-complete`). A5 Gmail connection and polling remains **closed and healthy**. Milestone identifiers are unchanged: **A7 → A8 → A9** (no early separate A9.0). **P1** (Application Experience Foundation) is a distinct milestone sequenced before the remaining A8 implementation slices and is **not** folded into A8; see [Delivery sequence](#delivery-sequence). Handoff items deliberately deferred out of A7 are listed under [A7 deferred backlog](#a7-deferred-backlog-not-a-milestone).

Process: [ENGINEERING_WORKFLOW.md](ENGINEERING_WORKFLOW.md) · [REVIEW_CHECKLIST.md](REVIEW_CHECKLIST.md) · Operations: [DEPLOYMENT.md](DEPLOYMENT.md) · Post-A8 DX: [Engineering / DX backlog](#engineering--dx-backlog-not-a-milestone)

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

1. **P1** — Application Experience Foundation (distinct milestone; **not** part of A8 and not folded into it). **COMPLETE** — P1.0 decision lock complete (D111–D120); P1.1 through P1.5 implemented; deployed and production-validated with one documented evidence limitation. Scope: [P1](#p1--application-experience-foundation). Evidence: [P1_5_EVIDENCE.md](P1_5_EVIDENCE.md).
2. **A8.1** — documentation and decision lock (**complete**)
3. **A8.2** — timezone and pure scheduling logic (**complete**)
4. **A8.3a** — reminder persistence foundation (**complete**)
5. **A8.3b** — Owner reminder APIs and generated contracts (**complete**)
6. **A8.4** — scheduler and delivery behind a **disabled** production feature flag
7. **A8.5** — Event Notification Engine
8. **A8.6** — Owner UI, built on P1 foundations
9. **A8.7** — controlled production enablement and evidence

A8.3 is split into **A8.3a (persistence)** and **A8.3b (APIs)** because the two carry different risk. Persistence can be added, constrained, and tested without any Owner-visible or Recipient-visible behaviour existing; an API surface cannot. Splitting them let A8.3a land the schema and its integrity rules under a gate where nothing could send, and leaves the contract change to a slice of its own.

P1 precedes the A8 Owner UI so the due-date control and schedule panel are built once on a settled experience foundation. Documentation precedes A8 code (Engineering Rule #1).

**Honest dependency note.** A8.2, A8.3, A8.4, and A8.5 do not touch the Owner interface and are not technically blocked by P1's visible work. What P1 genuinely owes A8 is narrower and specific: the observability seam and correlation reference before a scheduler exists in production (D115), the generic Owner attention and operational-status destination required by D108 (D118), and the organization-timezone-aware display formatter (D117). P1 nevertheless runs first under Implementation Rule #1 (one milestone at a time) so the token layer and shell do not compete with new A8.6 UI code.

### P1 — Application Experience Foundation

**Status:** **P1 is COMPLETE** — implementation complete, deployed, and production-validated. **P1.0 documentation Decision Lock complete** — D111–D120. **P1.1 Minimal Observability and Unified Correlation — implemented; architecture, security, and regression review passed** ([P1_1_BASELINE.md](P1_1_BASELINE.md)). **P1.2 Browser Verification Harness — implemented, architectural review still not separately recorded; executable locally only** ([P1_2_BROWSER_HARNESS.md](P1_2_BROWSER_HARNESS.md)). **P1.3 Request and render reliability — implemented, architectural review still not separately recorded** ([P1_3_EVIDENCE.md](P1_3_EVIDENCE.md)). Both slices were exercised by the P1.4 and P1.5 evidence that followed them, but neither carries its own recorded review sign-off; this is a **documentation gap, not an implementation gap**. **P1.4 Owner shell, constrained presentation foundation, organization-timezone display, and the Owner attention / operational-status destination — complete and production-validated** ([P1_4_EVIDENCE.md](P1_4_EVIDENCE.md)). **P1.5 boundary completion, accessibility verification, connectivity feedback, and production validation — complete and production-validated with one documented evidence limitation** ([P1_5_EVIDENCE.md](P1_5_EVIDENCE.md)).

The global error fallback, styled not-found state, and lost-connectivity feedback that P1.4 lacked now exist (P1.5). P1.3 added **only** the two minimal route loading boundaries D112 requires; P1.4 moved them inside the shell so chrome persists across a pending navigation (see [Loading-state ownership](#loading-state-ownership-across-p13-p14-and-p15)); P1.5 added the Recipient capability loading boundary that was deliberately deferred to it.

**Documented evidence limitation.** The valid Recipient capability workflow — loaded panel, confirmation dialogs, Recipient mutations, and connectivity feedback against a live capability — was **not** validated in production, because issuing a capability requires an A7 Gmail handoff that forwards a real customer email, and no safe synthetic path exists. This is an intentional production-safety property, **not** a defect, **not** a failed validation, and **not** an unmet acceptance criterion; all four areas are covered by local evidence ([P1_5_EVIDENCE.md](P1_5_EVIDENCE.md) §6).

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

**Implementation sequence (locked):**

| Slice    | Content                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P1.0** | **Documentation and decision lock — complete.** D111–D120; no code                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **P1.1** | Minimal observability and unified correlation foundation (D115), with the **baseline captured before any experience change** (D119) — **implemented.** Baseline: [P1_1_BASELINE.md](P1_1_BASELINE.md)                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **P1.2** | Browser verification harness for critical existing Owner and Recipient journeys (D119), as a separate job — **implemented, pending review; local macOS Chromium evidence only, not wired into CI.** Harness: [P1_2_BROWSER_HARNESS.md](P1_2_BROWSER_HARNESS.md)                                                                                                                                                                                                                                                                                                                                                                                                       |
| **P1.3** | Request and render reliability plus truthful loading and error states (D112): request-scoped auth deduplication, route loading states, bounded list queries, client request timeouts — **implemented, pending review; local evidence only.** Evidence: [P1_3_EVIDENCE.md](P1_3_EVIDENCE.md)                                                                                                                                                                                                                                                                                                                                                                           |
| **P1.4** | Owner shell, constrained presentation foundation, organization-timezone display, and the Owner attention / operational-status destination (D116, D117, D118). Tokens landed as a **verified no-op refactor first** (D116) — **complete and production-validated.** Evidence: [P1_4_EVIDENCE.md](P1_4_EVIDENCE.md)                                                                                                                                                                                                                                                                                                                                                     |
| **P1.5** | Boundary completion, accessibility verification, connectivity feedback, and production validation against the P1.1 baseline (D112, D119) — **complete, deployed, and production-validated with one documented evidence limitation.** The **input from P1.4 production validation** (unauthenticated `/tasks` briefly rendering identity-independent Owner chrome before its loading-boundary redirect completed) was **resolved**: the Owner gate moved above the shell, so an unauthenticated request now returns a true 307 and nothing else, with the deep link preserved and D119 authentication counts unchanged. Evidence: [P1_5_EVIDENCE.md](P1_5_EVIDENCE.md) |

P1.1 precedes every visible change because no baseline exists today; measuring after changing forfeits the comparison (D119). P1.2 precedes P1.3–P1.5 so visual and render refactors have a regression net before, not after. The `/c/{token}` surface is touched **last** within P1.5: it is externally visible and security-sensitive.

#### Loading-state ownership across P1.3, P1.4, and P1.5

Both P1.3 and P1.5 legitimately reference loading and boundary states, which read as a contradiction. They are different obligations and the split is:

| Slice    | Owns                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **P1.3** | The **minimum** route-level loading boundaries D112 requires so a pending navigation is never presented as an answer — `/tasks` and `/tasks/{taskId}` only, visually minimal, no shell. Plus **client request timeouts**, so a request that never returns is reported as ambiguous rather than as success or as a confirmed rejection.                                                                                                           |
| **P1.4** | The Owner application shell, navigation, Owner identity context, layout continuity, and the broader experience treatment those loading states sit inside (D116, D117, D118). **Delivered:** both P1.3 loading boundaries now render **inside** the shell, so navigation and Owner identity persist across a pending navigation instead of disappearing and reappearing. Neither boundary declares a container or navigation of its own any more. |
| **P1.5** | Comprehensive boundary completion — segment error boundaries, global error fallback, styled not-found, lost-connectivity feedback — plus accessibility verification and production validation against the P1.1 baseline (D112, D119). **Delivered.**                                                                                                                                                                                             |

`/c/{token}` loading presentation was **deferred to P1.5 and delivered there** (commit `d0fea4a`): the capability surface was touched last, as planned. P1.3 deliberately added no loading file for it.

Local performance evidence recorded in P1.3 ([P1_3_EVIDENCE.md](P1_3_EVIDENCE.md)) is **not** production evidence. The D119 production-validation criterion sat with P1.5 and is now satisfied ([P1_5_EVIDENCE.md](P1_5_EVIDENCE.md)).

**Acceptance criteria (P1 closure):**

Two criteria are deliberately **not** checked: both were already qualified before P1.5 and neither was resolved by it. They are recorded as known, non-blocking limitations rather than silently marked complete.

- [x] **P1.0 lock recorded** — D111–D120 approved; P1 scope, exclusions, slices, and criteria documented; `REVIEW_CHECKLIST.md` carries answerable P1 gates
- [x] **Consistent Owner shell** across all authenticated Owner routes: navigation, Owner identity context, reachable sign-out, `<main>` landmark, mobile-first layout — production-confirmed in P1.4 and re-confirmed in P1.5
- [x] **A shell location exists for the future D108 Owner status surface** (D118), generic rather than reminder-specific, and truthful when empty
- [x] **Truthful loading, error, and lost-connectivity feedback** on every current route (D112) — completed by P1.5, including the deferred `/c/{token}` loading boundary
- [x] **No optimistic mutation success** anywhere; ambiguous handoff outcomes still presented as genuinely uncertain (D112)
- [x] **Retry semantics correct in both directions** (D112): an ambiguous or transport retry reuses the same `Idempotency-Key` and the original `If-Match` so a durable attempt replays; a confirmed `412 PRECONDITION_FAILED` refreshes authoritative state before a new attempt rather than looping on a known-stale `If-Match`
- [x] **One useful correlation reference** joins the user-visible error reference, server diagnostics, and the audit row where one exists — proven by forcing a real failure and following a single value end to end (D115)
- [x] **Privacy-safe telemetry with capability-secret protection** — an automated assertion proves no capability token or raw `/c/{token}` path can appear in any telemetry, log, or error payload (D114); production diagnostics confirmed zero raw `/c/{token}` paths. Platform **access** logs are a separate matter, outside the application seam — see [P1_5_EVIDENCE.md](P1_5_EVIDENCE.md) §7
- [x] **Route-boundary coverage** — every current route has a loading state, segment error boundary coverage, a global error fallback, and a styled not-found state (D119) — completed by P1.5
- [x] **Keyboard and focus behaviour validated for both confirmation dialogs**, including Escape and focus restoration (D119) — completed by P1.5
- [x] **Accessibility gate met** — zero **serious or critical** automated findings on the current routes; contrast passes in the shipped theme (D119). Local gate: 28 scans, 0 serious, 0 critical, 4 moderate, 0 minor, no rule disabled. Production: 8 scans, 0 findings at every impact level
- [x] **Browser-level critical-journey coverage** for Owner sign-in, Task list, Task detail, handoff confirmation, and the Recipient capability journey, running as a separate job (D119) — the final gap, handoff confirmation, is covered by `apps/web/e2e/specs/p1-5-handoff-confirmation-journey.spec.ts`, which drives the rendered confirmation dialog through identification, cancellation, Escape, confirmed submission, truthful failure, and duplicate-submission prevention. Only the outbound handoff mutation is stubbed at the network boundary. **Gmail delivery itself is deliberately still not browser-tested** and remains covered by integration and production evidence ([P1_5_EVIDENCE.md](P1_5_EVIDENCE.md) §11)
- [x] **Organization-timezone-aware display** in use for Owner dates and timestamps, with a test proving no dependence on browser, device, or machine-local timezone (D117) — extended by P1.5 to Recipient capability timestamps, which previously used `toLocaleString()`
- [x] **Baseline captured in P1.1 before experience changes**, and any numeric performance threshold **ratified from that evidence** rather than asserted in advance, distinguishing absolute usability thresholds from relative improvement goals (D119)
- [x] **Structural assertions pass** — exactly one Owner authentication call per Owner page request; documented and asserted maximum database round trips per route (D119). Production confirmed exactly one `owner_authentication` span per Owner document request and zero on capability routes, with the measurement scope stated precisely in [P1_5_EVIDENCE.md](P1_5_EVIDENCE.md) §3
- [x] **No A4–A7 behavioural regression** — production regression checks re-pass unchanged; unauthenticated gates unchanged. `/tasks` still requires authentication and now refuses **earlier** (307 before chrome) rather than later
- [x] **No A8 runtime implementation** — D102–D110 remain documentation-only; no reminder schema, scheduler, endpoint, flag, due-date control, or schedule-status behaviour
- [x] **No schema, migration, OpenAPI, generated-client, or Android implementation change**; audit model and mutation-truthfulness semantics unchanged; `pnpm verify` green — no schema, migration, OpenAPI, generated-client, or Android file was modified, and audit and mutation-truthfulness semantics are unchanged. The full, unmodified `pnpm verify` now **exits 0**: the previously blocking Java gap was resolved by installing OpenJDK 17 locally, and `contracts:check-drift` reported no drift ([P1_5_EVIDENCE.md](P1_5_EVIDENCE.md) §12)

**Binding decisions:** D111–D119 — **satisfied at P1 closure.** D119's accessibility gate, browser-verification gate, structural gates, and its `pnpm verify` negative closure criterion are each individually evidenced in [P1_5_EVIDENCE.md](P1_5_EVIDENCE.md) (§3, §11, §12); the browser-verification and `pnpm verify` limbs were the last two closed. **D120 remains Open** and must be resolved before any product rename; the documented P1 default is to keep the current official name, and P1 closure does not resolve it. D102–D110 remain locked and must not be redesigned or implemented by P1. D079 Architecture Principles and D089 (no claim of active reminder behaviour) continue to apply.

**P1 closure summary:** implementation complete; deployment complete; production validation complete with **one documented evidence limitation** (the Recipient capability workflow, [P1_5_EVIDENCE.md](P1_5_EVIDENCE.md) §6). All **18 of 18** acceptance criteria above are met: the two that stood unchecked at the first closeout attempt — browser-level handoff-confirmation coverage and a green full `pnpm verify` — were closed by the D119 closure remediation ([P1_5_EVIDENCE.md](P1_5_EVIDENCE.md) §11–§12). **P1 is complete.** A8 was the next milestone and was not started at P1 closure; A8.1, A8.2, and A8.3a have since been completed. No P1 completion tag has been created; tagging remains a separately authorized decision.

### A8 — Follow-up Engine and Event Notification Engine

**A8.0 documentation Decision Lock:** D095–D101 (docs-only). Partly **superseded** by A8.1.

**A8.1 documentation Decision Lock:** **D102–D110 (complete as docs-only).** Revises A8 to a **due-date-driven** reminder model, amends [PROJECT_CONSTITUTION.md](PROJECT_CONSTITUTION.md) under a narrow exception, and supersedes D098 plus parts of D095, D096, and D099. Each remaining A8 slice requires explicit authorization and its own planning/review pass.

**A8.2 timezone and pure scheduling logic: complete (D127).** `packages/domain/src/reminders/` now contains local-calendar date primitives, explicit-IANA-timezone occurrence resolution, and the pure advance, overdue, materiality, and 14-successful-delivery policy functions, with the clock injected into every decision. Verified under `TZ=UTC`, `TZ=Asia/Tokyo`, and `TZ=America/New_York`.

**A8.3a reminder persistence foundation: complete (D128).** `packages/db` now holds the two durable concepts D109 requires — `task_reminder_schedules` (one per Task) and the append-only `reminder_delivery_attempts` — plus `tasks.due_local_date` as the canonical organization-local due date. Occurrence idempotency is **server-derived and enforced by a unique index**, not by application code: identity is `(schedule, generation, occurrence kind, local calendar day)`, so there is no caller-supplied key to reuse and no way to replay an identity into a second row. A second partial unique index enforces D106's at-most-one-delivery-per-local-calendar-day over successful rows, across generations. Claim-lease columns and worker indexes exist so A8.4 adds no migration.

**A8.3a was audited before A8.3b and the audit's boundary findings are remediated.** Persistence now resolves the owning organization from the referenced Task or schedule instead of trusting the caller's `organizationId`, so a schedule, due-date write, or delivery attempt cannot be pointed at another organization's Task; every local date is parsed by the A8.2 `parseLocalDate` on the way in as well as on the way out, so an impossible date such as `2026-02-30` is refused at the write rather than discovered on a later read; and a reused attempt id is no longer reported as an occurrence collision, nor an existing success, failure, ambiguity, or claim quietly returned as though a skip had been recorded. Evidence: `packages/db/__tests__/a8-reminder-boundary-hardening.test.ts`. The audit's worker-slice findings are listed under [A8 audit follow-ups (A8.4a)](#a8-audit-follow-ups-a84a) and are deliberately **not** implemented in A8.3a.

**A8.3a stores facts and computes none.** Every occurrence is supplied by the A8.2 domain; a source guard (`packages/db/__tests__/a8-reminder-persistence-boundary.test.ts`) fails the build if a reminder repository derives a date, reads a clock or a machine timezone, or restates the ceiling. **Still absent after A8.3a:** no contract or generated client, no route, no internal worker, scheduler, or cron, no feature flag, no environment configuration, no email path, and no UI. Historical due dates were **not** backfilled into `due_local_date`, so no existing Task became reminder-eligible (D109).

**A8.3b Owner reminder APIs and contracts: complete.** Three Owner-authenticated operations now exist on `/api/v1/tasks/{taskId}/reminder`: `GET` reads reminder state, `PUT` establishes or materially changes the canonical due date, and `DELETE` removes it and stops the schedule. The contract carries one Owner-selectable field — the local due date — because 09:00 is a constant (D103) and presets are retired (D102); occurrences, generation, disposition, counts, status, and stop reason are all server-derived, and a request that supplies any of them is refused rather than silently ignored. Mutations run under the existing Task `If-Match` concurrency (D045, D104). Re-saving the same date against a live schedule is idempotent and emits no audit event; a material change opens exactly one generation and preserves every prior attempt; and re-saving a date onto a **stopped** schedule opens a new generation, because D109 requires an explicit Owner re-save to reactivate reminders. Audit events (`reminder.schedule.established`, `reminder.schedule.changed`, `reminder.due_date.removed`) are written in the same transaction as the state they describe. Evidence: `apps/web/__tests__/owner-reminder-routes.test.ts`.

**A8.3b exposes configuration, not delivery. Still absent after A8.3b:** no reminder worker, schedule scanning, claim lease use, attempt retry, Gmail send path, Event Notification, cron, external scheduler configuration, feature flag, Recipient-facing reminder link, or UI of any kind. The reminder response deliberately omits claim leases, worker identifiers, provider message identifiers, raw failure detail, and database row identifiers, so those remain free to change without a contract break. The A8.3a migration is **not applied in Production**, and reminders remain **non-operational in Production** unless and until that migration and the later A8 slices are deployed.

**Task lifecycle coupling is deferred with the Waiting integration, and A8.4 must not ship without it.** D107's stopping and suspending rules are a set: Waiting suspends, completion and dismissal stop, due-date removal stops. A8.3b implements only due-date removal. Entering and leaving Waiting is reachable by **two** actor kinds — the Owner through `POST /tasks/{taskId}/waiting` and `/resume`, and a Recipient through the `mark_task_waiting` capability scope — and both run through the shared `persistCapabilityAction` transaction, so suspending reminders there means changing a Recipient-facing A4/A7 code path rather than the Owner reminder surface. Implementing one member of the set alone would also be actively wrong: a completed Task would keep an `active` schedule. Nothing sends in A8.3b, so that has no delivery consequence yet, and `apps/web/__tests__/owner-reminder-routes.test.ts` pins the current behaviour so the gap cannot be forgotten. No second, parallel "pause reminders" control was invented.

**Follow-up Engine (D102–D110):** due-date-driven, **Task-scoped** Recipient reminders. An optional Owner-selected due date — an organization-local **calendar date** with no Owner-selected time — drives one advance reminder at **09:00 organization-local on the day before**, then one reminder at 09:00 organization-local on **each calendar day after** while the Task remains incomplete and eligible, bounded at **14 successful overdue deliveries per schedule generation**. Occurrences use **local-calendar arithmetic**, never fixed 24-hour millisecond offsets, so 09:00 local survives daylight-saving transitions. Waiting suspends and is the **only** pause mechanism. Sends are attributed to a **`system`** actor. Authoritative rules: [WORKFLOWS.md](WORKFLOWS.md) §10a.

**Event Notification Engine (D099):** event-driven Owner notifications (separate engine; no escalation CC ladder). A8 delivers Owner notifications by email via the Owner’s connected Gmail for the core event list; FCM/push remains deferred (D017; A9). It remains a **separate A8 deliverable** and must additionally cover overdue ceiling reached, permanent reminder-delivery failure, no active assignment requiring Owner action, and schedule entering `requiresOwnerAttention` (D106, D108). Authoritative rules: [WORKFLOWS.md](WORKFLOWS.md) §10b.

**Production-enablement gate and closure gate (D108):** scheduler and delivery may merge behind a **disabled** production feature flag, but **production reminder delivery must not be enabled — and A8 must not be claimed closed — until both the Event Notification Engine and the minimum Owner schedule-status UI are operational.** A Task-page status alone is insufficient: the Owner must not have to inspect Tasks continually to discover that an automation stopped.

**Deferred to a separately authorized future slice (D110):** Owner-created additional dated reminders, and their routes, UI, rules, and schema. Not authorized to start implicitly; a future slice needs its own planning/review pass and a new, unused identifier. Also excluded from A8 entirely: preset reminder choices, recurrence editor, reminder-time picker, arbitrary rules, cron expressions, general calendar management, a separate pause mechanism, Recipient reminder preferences, Android reminder UI, and AI-controlled scheduling.

#### A8 audit follow-ups (A8.4a)

Findings from the A8.3a critical architecture audit that were **deliberately not** fixed in A8.3a, its remediation, or A8.3b. None blocked A8.3b, because none is reachable without a worker; each must be resolved before anything can send email. They are listed here rather than described in prose so they cannot quietly disappear. The Task-lifecycle coupling A8.3b deferred — Waiting suspension and resume, and stopping on completion or dismissal — belongs to the same gate and is described under [A8.3b](#a8) above.

| ID  | Finding                                                                                                                                                                                                                                                               | Why it waits                                                                                                                                                                       |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | A recorded successful delivery is rolled back if the schedule leaves `active` between claim and completion, because `persistSuccessfulOverdueDelivery` ends in a `status='active'` update. The email is sent, nothing is recorded, and the ceiling is never credited. | **Highest priority of the group.** Needs the terminal outcome committed first and arming the next occurrence treated as a follow-on that may legitimately no-op. No schema change. |
| F2  | `reminder_delivery_attempts` has no `claim_expires_at`, so a worker that dies after claiming leaves a permanently `claimed` row that can be neither reclaimed nor safely completed.                                                                                   | Needs an additive migration and a fencing token; pointless before a worker exists to crash.                                                                                        |
| F6  | The schedule claim lease is advisory and unfenced — `releaseReminderScheduleClaim` matches on `claimed_by` alone, so a stale holder can release a successor's lease. Exclusion actually rests on the occurrence-identity index.                                       | Either fence it or classify it explicitly as a scan hint; the decision belongs with the worker that uses it.                                                                       |
| F7  | `persistSuccessfulOverdueDelivery` never asserts the attempt is an `overdue` occurrence, so an advance attempt would increment the overdue counter. The stop decision stays correct because the domain filters; only the counter drifts.                              | One assertion, best added with the worker's call sites.                                                                                                                            |
| F8  | `recordReminderDeliveryOutcome` is exported and can write `success` directly, bypassing the counter increment and the ceiling check.                                                                                                                                  | Narrowing the export is safest once the intended call sites exist.                                                                                                                 |
| F10 | The database permits three contradictory states: `suspended_waiting` retaining a next occurrence, `stopped` holding a live lease, and `advance_disposition='skipped_window_elapsed'` with no skipped attempt row. Application code prevents all three.                | Needs CHECK constraints in the same migration as F2, or explicit acceptance.                                                                                                       |
| F11 | There is no global due-scan: `listReminderSchedulesDueForProcessing` requires an `organizationId` and the index is organization-prefixed, so a cross-organization worker can neither call it nor scan efficiently.                                                    | The scan topology is a worker design decision.                                                                                                                                     |
| —   | No real multi-connection PostgreSQL concurrency proof. PGlite is a single in-process connection, so every concurrency guarantee is reasoned rather than contended.                                                                                                    | Tracked with the deterministic-verification item in the [Engineering / DX backlog](#engineering--dx-backlog-not-a-milestone).                                                      |
| —   | The uncertain-outcome suspension rule (repeated ambiguous deliveries) is required **before A8.4b**, not A8.3a. The schema supports it without redesign: `ambiguous` is already an outcome and a new stop reason is an additive `ALTER TYPE`.                          | Scheduled for A8.4b by prior decision.                                                                                                                                             |

Also carried, at lower cost: `attempt_count` is a dead column with no writer (F13); the enum values `schedule_superseded`, `task_not_eligible`, and `task_dismissed` are declared but unreferenced (F14); and `ALTER TABLE tasks ADD CONSTRAINT … CHECK` is added validated rather than `NOT VALID` + `VALIDATE CONSTRAINT`, which is free at current table sizes but is not the pattern to keep (F15).

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

---

## Engineering / DX backlog (not a milestone)

Non-blocking developer-experience and CI-determinism work. These items are **not** A8 product requirements, **not** A8 sub-slices, and must **not** be implemented inside an A8 authorization unless that authorization explicitly includes them. Prefer scheduling after A8 closes, or as separately authorized process work that does not compete with the current product milestone. Process authority: [ENGINEERING_WORKFLOW.md](ENGINEERING_WORKFLOW.md).

| Item                                                                     | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Make `pnpm verify` deterministic for web packaging tests**             | `pnpm verify` currently runs `pnpm test` (including serverless packaging tests that read `apps/web/.next`) **before** `pnpm build:web`. After adding a newly traced package or source file, those tests can consume a **stale** `.next` NFT/trace and fail misleadingly even when the product change is correct. Future work should decide whether `build:web` should run before the affected tests or whether those tests should build their own required fixture — and must **preserve** packaging-test coverage rather than bypassing it. Documented only; **not** implemented by the development-process hardening pass.                                                                      |
| **Run database tests against a real PostgreSQL engine, not only PGlite** | PGlite executes the real migration SQL, so constraints, partial unique indexes, and enums are genuinely enforced — but it is a **single in-process connection**. No test can therefore contend two sessions on the same row, and every concurrency guarantee in the A8.3a audit is reasoned rather than proven. The same environment would enable a `prisma migrate diff` drift gate, which needs a live database and so is absent today; A8.3a is the first slice whose index names diverge from Prisma's defaults, and nothing currently detects schema-versus-migration drift in naming (audit F12). Requires Docker or a hosted test database, which is why it is backlog rather than a gate. |
