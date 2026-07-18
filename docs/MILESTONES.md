# Milestones

**Current:** A6 Application Suggestion Engine is **CLOSED** in Production (tag `v0.6.0-a6-complete`). A5 Gmail connection and polling remains **closed and healthy**. Next milestone: **A7** (do not begin until explicitly started). Roadmap after A6: **A7 → A8 → A9** (no early separate A9.0).

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

**Binding decisions:** D055–D064. OPEN #21 deferred to A7.

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

Single Owner confirmation for assign + forward + attachments + capability + reminders (D037). OPEN #21 (re-forward vs prior links) resolved here. Consumes A6 unassigned Tasks / proposed recipient metadata for Recipient handoff.

### A8 — Reminder and escalation engine

Deterministic reminders; first overdue → Recipient; later may CC Owner; waiting pauses; completed stops.

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
