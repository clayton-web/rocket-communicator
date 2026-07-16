# Milestones

**Current:** A4 complete — automated verification and **production E2E (`A4_FULL_E2E_PASS`)**. **Next:** A5 Gmail connection and polling.

Process: [ENGINEERING_WORKFLOW.md](ENGINEERING_WORKFLOW.md) · [REVIEW_CHECKLIST.md](REVIEW_CHECKLIST.md) · Operations: [DEPLOYMENT.md](DEPLOYMENT.md)

---

## Completed

### A0 — Documentation and Git baseline

**Status:** Complete. Product/architecture docs, constitutions, glossary, local `main`.

### A1 — Monorepo and application shells

**Status:** Complete. pnpm workspaces; Next.js and Android Compose shells; shared ESLint/TS configs; CI smoke. Foundation: `com.aicommunication.assistant`, `minSdk` 31, Node 22, pnpm 9.15.9, Next.js 16.2.10, React 19.0.0, AGP 8.8.2, Kotlin 2.1.10, Gradle 8.12.1.

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

---

## Planned

### A5 — Gmail connection and polling

Connect one inbox; poll every **five minutes** (D065); create communication events only (D077). Polling-only in A5 (D066); Pub/Sub deferred. No AI suggestions or forwarding yet.

**A5.1–A5.2:** OpenAPI Gmail contracts, domain types/invariants, Prisma models, forward-only migration, repositories, and DB tests.

**A5.3:** Owner Gmail OAuth start (**POST**) / callback (state hash + encrypted PKCE), AES-256-GCM purpose-bound token encryption, connection status, and disconnect/revoke. **No polling, cron, ingestion, sync handlers, or UI.** Production migration remains unapplied; live Gmail credentials are not configured.

Later A5 chunks: History API ingestion, sync-run listing, internal cron poll, settings UI.

### A6 — AI relevance and task suggestions

Filter/extract suggestions; Owner approve/edit/dismiss/merge HTTP; no auto-create tasks.

### A7 — Gmail forwarding and assignment email

Single Owner confirmation for assign + forward + attachments + capability + reminders (D037). OPEN #21 (re-forward vs prior links) resolved here.

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

7-day excerpt and 30-day completed scrub; Gmail mailbox copies untouched (D031). OPEN #12 (tombstone duration).

### A14 — Learning signals and proposed rules

Owner-only learning (D054); propose rules; never auto-apply in v1.

### A15 — Hardening and private deployment

Private deploy, sideload release, runbooks, capability hardening. OPEN #3/#13 (domains).
