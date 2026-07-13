# Milestones

**Current:** A4 in progress. Owner capability runtime and Owner task HTTP are done. Next: Recipient capability APIs and `/c/[token]`.

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

### A4 Phase 0–2

**Status:** Complete. Phase 0: D055–D064 + OpenAPI alignment. Phase 1: domain machines. Phase 2: `packages/db` persistence foundation.

### A4 Phase 3–4C (Owner)

**Status:** Complete. Capability token runtime (issue/validate/revoke/expiry); Owner task application services; Owner task HTTP; Owner capability issuance HTTP.

---

## In progress

### A4 — Task core and Recipient capability web view

**Objective:** Capability issuance/validation; Owner task APIs; Recipient capability HTTP; minimal non-mutating GET + POST-after-confirm UI at `/c/[token]`.

**Completed so far:** Capability token runtime; Owner task HTTP; Owner capability issuance HTTP.

**Remaining:** Recipient capability APIs; `/c/[token]` Recipient page and confirmation UI; final A4 verification.

**Out of scope for A4:** AI, Gmail forward, Android task UI; Owner suggestion review/approval HTTP (later suggestion workflow); raw IP / full UA retention (D057); Recipient voice (D058 → A12).

**Binding decisions:** D055–D064. OPEN #21 deferred to A7.

**Checkpoint:** `feat: task core and recipient capability view`

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
