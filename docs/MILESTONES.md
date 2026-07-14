# Milestones

**Current:** A4 complete (automated verification). Live Supabase migration deployment and manual Owner↔Recipient E2E remain operator runbook steps before production use. Next: A5 Gmail connection and polling.

Process: [ENGINEERING_WORKFLOW.md](ENGINEERING_WORKFLOW.md) · [REVIEW_CHECKLIST.md](REVIEW_CHECKLIST.md)

---

## Completed

### A0 — Documentation and Git baseline

**Status:** Complete. Product/architecture docs, constitutions, glossary, local `main`.

### A1 — Monorepo and application shells

**Status:** Complete. pnpm workspaces; Next.js and Android Compose shells; shared ESLint/TS configs; CI smoke. Foundation: `com.aicommunication.assistant`, `minSdk` 31, Node 22, pnpm 9.15.9, Next.js 16.2.10, React 19.0.0, AGP 8.8.2, Kotlin 2.1.10, Gradle 8.12.1.

### A2 — API contracts and domain model

**Status:** Complete. `packages/contracts` (OpenAPI + generated TS/Kotlin), `packages/domain`, Android `api-contract` compile module. No DB/auth/API handlers in A2.

### A3 — Owner authentication

**Status:** Complete. Web-only Supabase Google OAuth for the single Owner (D048): `/login`, `/auth/callback`, `GET /api/v1/session`, `OWNER_ORGANIZATION_ID` + `OWNER_WORKSPACE_DOMAIN`.

### A4 — Task core and Recipient capability web view

**Status:** Complete (automated). Product implementation finished; `pnpm test`, `pnpm build`, contract checks, and `pnpm verify` pass.

**Not yet done (operator):** live Supabase migration has not been applied; live Google Workspace / Supabase end-to-end verification remains pending. Do not treat this as production-verified.

**Out of scope for A4 (unchanged):** AI, Gmail forward, Android task UI; Owner suggestion review/approval HTTP (later suggestion workflow); raw IP / full UA retention (D057); Recipient voice (D058 → A12).

**Binding decisions:** D055–D064. OPEN #21 deferred to A7.

---

## Planned

### A5 — Gmail connection and polling

Connect one inbox; poll; create communication events. Polling-first (D015). No AI suggestions or forwarding yet.

### A6 — AI relevance and task suggestions

Filter/extract suggestions; Owner approve/edit/dismiss/merge; no auto-create tasks.

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
