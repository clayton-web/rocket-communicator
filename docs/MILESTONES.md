# Milestones

**Current:** **A7** — **A7.1–A7.8 implemented and validated** (contracts through Owner confirmation UI + Gmail send re-consent UI). Production OAuth rollout and production E2E are **not** started, so the **parent A7 milestone remains OPEN**. A7.0 decisions remain locked (D086–D094). A6 Application Suggestion Engine remains **CLOSED** in Production (tag `v0.6.0-a6-complete`). A5 Gmail connection and polling remains **closed and healthy**. Roadmap: **A7 → A8 → A9** (no early separate A9.0).

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

## Planned

### A7 — Gmail forwarding and assignment email

**Status:** A7.0 decisions **locked** (D086–D094). Slices **A7.1–A7.8 are implemented and validated**. The **parent A7 milestone remains OPEN**: production migration/OAuth rollout and production E2E are **not** implemented yet. Reassignment, explicit re-forward, proposed-Recipient hint resolution, and reconciliation workers remain deferred.

Slice status:

- **A7.1 contracts — complete.** OpenAPI handoff/recipient/Gmail/capability shapes + committed generated TypeScript/Kotlin (content-idempotent, generator 7.14.0).
- **A7.2 domain — complete.** Pure handoff policy: delivery-path selection, eligibility, idempotency/fingerprint, incomplete-forward, capability access, lifecycle.
- **A7.3 persistence — complete.** Prisma schema + migrations; HandoffAttempt/Assignment/Capability transactions; one-active + provider-message uniqueness; retry token rotation and `attemptCount` send-generation guards; no raw token in the DB layer. Initial begin bumps Task version under If-Match CAS.
- **A7.4 Gmail transport — complete.** `gmail.send` scope handling + incremental re-consent detection; assignment-email and Gmail-forward builders (forwards include persisted Task `summaryPoints` + all required attachments); MIME/attachment/base64url safety; privacy-safe provider error normalization.
- **A7.5 internal orchestration — complete.** Internal application service coordinating persistence + transport off the DB transaction; exclusive retry ownership; send-generation stale-result rejection; server-controlled HTTPS-enforced capability base origin.
- **A7.6 Recipient management + task-create guard — complete.** Authenticated Owner Recipient endpoints + deterministic `POST /api/v1/tasks` rejection of any supplied top-level `recipientId`.
- **A7.7 authenticated Owner handoff HTTP + route-level delivery orchestration — complete.** `POST /api/v1/tasks/{taskId}/handoff` with idempotency-first classification (successful/pending/failed replay + new initial), server-selected delivery mode, Gmail-forward completeness, assignment-email delivery, send-scope/re-consent errors, private→public error mapping, durable audits on state transitions. **No** Owner UI, re-consent UI, reassignment, explicit re-forward, proposed-Recipient hints, reconciliation worker, reminders, or production rollout. Contract/generated clients/Prisma schema/migrations unchanged.
- **A7.8 Owner confirmation UI + Gmail send re-consent UI — complete.** New thin Owner pages `/tasks` and `/tasks/[taskId]` (did not exist before A7.8); hard Owner auth gate; Recipient select; modal confirmation with `handoff_confirmed_v1`; sessionStorage pending-operation recovery retaining original If-Match + Idempotency-Key; manual retry after OAuth re-consent (no auto-send); truthful pending/ambiguous UX; connection DTO emits `canSend` / `requiresSendReconsent`. **No** reassignment, re-forward, proposed hints, reconciliation, reminders, Recipient CRUD UI, production rollout, or OpenAPI/schema/migration changes.

**Intent:** Single Owner confirmation (D037) for Recipient handoff on an **existing** unassigned Task (D080): Assignment + Capability + Gmail forward (Gmail-origin) or assignment email (non-Gmail), via `POST /api/v1/tasks/{taskId}/handoff` (D090). Reminder **engine** remains A8 (D089).

**Acceptance criteria (full A7 — not yet met):**

- [x] OpenAPI defines `POST /api/v1/tasks/{taskId}/handoff` with `If-Match` and required idempotency key; generated clients committed (A7.1)
- [x] Minimal Owner Recipient management: list active, create/update, mark inactive (D087)—no CRM — **implemented in A7.6**
- [x] Handoff consumes existing Owner-owned / A6-approved **unassigned** Tasks; does **not** recreate the Task — **implemented in A7.7**
- [x] Server selects Gmail-forward vs assignment-email from Task source; both send via Owner’s connected Gmail (`gmail.readonly` + `gmail.send`, D093) — **implemented in A7.7** (route-level; production OAuth re-consent UI still open)
- [x] Gmail-origin forward includes Task `summaryPoints` above original and all attachments; knowingly incomplete forwards are not sent (D088) — **implemented in A7.7**
- [x] Delivery model `pending` / `sent` / `failed` (D092); actionable capability only after successful send; durable HandoffAttempt (or equivalent) preferred — **implemented in A7.7** (via A7.3–A7.5 + route)
- [ ] One active capability per Assignment; reassignment/re-forward revokes prior active capability; matched **superseded** capabilities may return `CAPABILITY_NO_LONGER_ACTIVE`; other unusable/unmatched cases remain generic `UNAUTHORIZED` (D086) — **error code contracted in A7.1**; reassignment/re-forward orchestration **deferred** (not part of A7.7)
- [x] Same failed-delivery retry reuses attempt/capability unless Recipient or security-sensitive details changed (D086, D092) — **implemented in A7.7** (same-key failed retry via A7.5 `retryHandoff`; snapshot address preserved)
- [x] `POST /api/v1/tasks` create-with-`recipientId` rejected/deprecated once handoff ships (D091) — **implemented in A7.6**
- [x] Thin Owner confirmation UI discloses D037 handoff + Gmail retention boundary; does **not** claim reminders are scheduled (D089, D094) — **implemented in A7.8**
- [x] Insufficient `gmail.send` → clear re-consent / insufficient-scope path (D093) — **API path A7.7**; **Owner re-consent UI A7.8**
- [x] No reminder schedules, reminder scheduler jobs, or reminder sends in A7 (D089) — **still true after A7.8**
- [ ] No fresh LLM during handoff; optional `proposedRecipientHint` → `proposedRecipientId` only via deterministic active-Recipient match (D094) — **no fresh LLM (A7.7/A7.8)**; proposed-hint fields are **not** in the current OpenAPI request and remain **deferred** (unchecked)
- [ ] Production E2E: Gmail-origin forward + non-Gmail assignment email + Recipient capability action; A4/A5/A6 baselines remain healthy

**Out of scope for A7:** Reminder/escalation engine (A8); Android Owner UI (A9); Gmail settings UI / History recovery; CRM; `gmail.modify` unless a new Decision.

**Binding decisions:** D037, D042, D080, D086–D094 (and D010, D011, D016, D031 as applicable).

### A8 — Reminder and escalation engine

Deterministic reminders; first overdue → Recipient; later may CC Owner; waiting pauses; completed stops. Consumes active **delivered** Assignments established by A7 (D089).

### A9 — Android authentication and task interface

Sideload Owner app; approve suggestions and manage tasks via API.

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
