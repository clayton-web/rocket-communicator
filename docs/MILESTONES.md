# Milestones

Planning milestones only. No application scaffolding occurs in A0.

**Current milestone: A4 Phase 2 (persistence foundation) in progress on top of Phase 0–1.** Next after Phase 2 approval: capability token runtime / Owner-Recipient APIs (Phase 3+), not started.

Process for all later milestones: [ENGINEERING_WORKFLOW.md](ENGINEERING_WORKFLOW.md) · [REVIEW_CHECKLIST.md](REVIEW_CHECKLIST.md) · [PROJECT_CONSTITUTION.md](PROJECT_CONSTITUTION.md)

---

## A0: Documentation and Git baseline

- **Objective:** Establish product, architecture, workflow, retention, security, decision, milestone, and open-question docs; local Git on `main`; baseline commit; then complete governing documentation (constitutions, glossary, index, engineering workflow).
- **Likely scope:** `README.md`, `docs/*`, `.gitignore`, local `git init`, first commit; subsequent documentation-only refinements under A0 until A1 begins.
- **Acceptance criteria:** All required docs exist; terminology consistent; exclusions and retention rules correct; no code/deps/services; constitution and documentation index present; architecture baseline commit on `main` without remote.
- **Major risks:** Doc drift vs later implementation; unresolved open questions misread as decisions.
- **Out of scope:** App shells, dependencies, schemas, remotes, cloud resources.
- **Recommended Git checkpoint:** `docs: establish project architecture baseline` (created); further docs-only commits as requested

## A1: Repository tooling and application shells

- **Objective:** Empty monorepo tooling with non-functional app shells.
- **Likely scope:** pnpm workspaces (no Turbo/Nx/Husky), Next.js App Router stub, Android empty Compose `:app` (`minSdk` 31), shared `eslint-config` / `typescript-config`, Prettier, EditorConfig, ktlint, GitHub Actions smoke CI. **No** `.env.example` (no env vars yet). **No** `packages/contracts|domain|db|ai|ui`.
- **Acceptance criteria:** Web and Android projects build empty shells; format/lint/test/build checks pass; CI workflows present; docs reflect foundation; still no external service wiring or product features.
- **Major risks:** Over-scaffolding before contracts exist.
- **Out of scope:** Auth, Gmail, AI, notifications, Prisma, Supabase, voice, tasks, API routes, `.env.example`.
- **Recommended Git checkpoint:** `chore: monorepo and application shells`
- **Status:** Complete (implementation + documentation + local verification). Instrumentation Android tests are local-only (no emulator CI in A1).
- **Recorded foundation:** namespace `com.aicommunication.assistant`; `minSdk` 31; Node 22 / pnpm 9.15.9; Next.js 16.2.10; React 19.0.0; AGP 8.8.2; Kotlin 2.1.10; Gradle 8.12.1.

## A2: API contracts and domain model

- **Objective:** Canonical OpenAPI contract and pure domain rules (state machines, policies, retention calculations) without persistence or integrations.
- **Likely scope:** `packages/contracts` (OpenAPI source of truth, bundled artifact, generated TS/Kotlin DTOs), `packages/domain` (pure TypeScript domain logic), `apps/android/api-contract` (Kotlin DTO compile module); generators for TS/Kotlin from OpenAPI; `docs/API_CONTRACT.md`, `docs/STATE_MACHINE.md`.
- **Acceptance criteria:** OpenAPI lints and bundles; examples validate; generated outputs committed with CI drift check; domain transition and policy tests pass; no database, auth, or API route implementation.
- **Major risks:** OpenAPI/domain enum drift; over-scoping endpoints before integrations exist.
- **Out of scope:** `packages/db`, Prisma, migrations, Supabase, auth, Gmail, AI, workers, API handlers, feature UI.
- **Recommended Git checkpoint:** `feat: contracts and domain model`
- **Status:** Complete (OpenAPI contract, generated TS/Kotlin DTOs, pure domain package, tests, CI, documentation). No database, auth, or API handlers.

## A3: Owner authentication

- **Objective:** Workspace Google sign-in for the **single Owner** only (D048); no Recipient application accounts.
- **Likely scope:** Supabase Auth integration, domain allowlist config, Owner session guards.
- **Acceptance criteria:** Owner can authenticate; unauthorized domains rejected; session API returns Owner shape; no second application user role.
- **Major risks:** Misconfigured OAuth clients.
- **Out of scope:** Gmail link, Android capture, capability links.
- **Recommended Git checkpoint:** `feat: owner authentication`
- **Status:** Complete (web-only Supabase Google OAuth, `/login`, `/auth/callback`, `GET /api/v1/session`, `OWNER_ORGANIZATION_ID` + `OWNER_WORKSPACE_DOMAIN` config).

## A4: Task core and minimal Recipient capability web view

- **Objective:** Task CRUD, notes, complete, waiting, snooze (Owner); minimal Recipient capability web view at `/c/[token]` (or equivalent).
- **Likely scope:** Owner task APIs, capability token issuance/validation, minimal Recipient GET (non-mutating) + POST-after-confirm UI.
- **Acceptance criteria:** Recipient can open capability link, view assigned task, and complete/wait/note/return-to-Owner/request clarification with audit; cannot create standalone tasks or change rules; Recipient work requests become Task Suggestions; GET never mutates; no unauthenticated POST mutations; Owner snooze supported; no physical task deletion (dismiss only).
- **Major risks:** Building a full dashboard by accident; capability link security gaps.
- **Out of scope:** AI, Gmail forward, Android; raw IP / full user-agent retention; Recipient voice notes.
- **Recommended Git checkpoint:** `feat: task core and recipient capability view`
- **Status:** Phase 0 (D055–D064 + OpenAPI) and Phase 1 (domain machines) complete. Phase 2 introduces `packages/db` / Prisma persistence foundation (schema, migrations, repositories, transactions). Token issuance/validation, Owner/Recipient API routes, and `/c/[token]` UI are **not** started.
- **Binding A4 decisions:** D055 (7-day expiry + persisted `expiresAt`), D056 (multi-use until invalidation; no A4 `used` semantics), D057 (A4 audit fields; IP/UA deferred), D058 (typed Recipient notes), D059 (separate auth surfaces; `GET /c/[token]` non-mutating), D060 (Owner snooze contracted before runtime), D061 (work-request→suggestion contracted before runtime), D062 (Prisma after Phase 0 + domain alignment), D063 (one-time raw link to Owner; hash stored), D064 (dismiss, not delete). OPEN #21 remains deferred to A7.

## A5: Gmail connection and polling

- **Objective:** Connect one inbox; poll for new messages; create communication events.
- **Likely scope:** OAuth token storage, poller, dedupe, thread linking.
- **Acceptance criteria:** New mail becomes events within agreed poll delay; reauth path works; Pub/Sub not required.
- **Major risks:** Rate limits; token loss.
- **Out of scope:** AI suggestions, forwarding.
- **Recommended Git checkpoint:** `feat: gmail connection and polling`

## A6: AI relevance and task suggestions

- **Objective:** Filter and extract structured suggestions; approval creates tasks.
- **Likely scope:** OpenAI jobs, prompt versions, suggestion APIs/UI hooks.
- **Acceptance criteria:** Relevant mail → suggestion; junk skipped; approve/edit/dismiss/merge; no auto-create.
- **Major risks:** Cost; low-quality summaries.
- **Out of scope:** Auto-assignment.
- **Recommended Git checkpoint:** `feat: ai task suggestions with approval`

## A7: Gmail forwarding and assignment email

- **Objective:** After one Owner confirmation, assign Recipient; for Gmail-origin tasks forward original with all attachments and summary header (bundled with create task + capability link + schedule reminders per D037); non-email tasks get normal assignment email with capability link.
- **Likely scope:** Mailer, idempotent forward, audit of single bundled approval and Gmail ids, capability link issuance.
- **Acceptance criteria:** No send without the single confirmation; dialog discloses create task, forward email, forward attachments, schedule reminders, capability link; attachments included; duplicate forward prevented; Recipient from contact record not hard-coded.
- **Major risks:** Attachment size/policy failures; partial forwards; capability token lifecycle.
- **Out of scope:** Separate attachment approval UX.
- **Recommended Git checkpoint:** `feat: assignment email and gmail forward`

## A8: Reminder and escalation engine

- **Objective:** Deterministic reminders with v1 escalation rule.
- **Likely scope:** Policies, scheduler, `ReminderAttempt` idempotency, waiting/snooze interactions.
- **Acceptance criteria:** First overdue Recipient-only; later may CC Owner; duplicates impossible under double schedule; completed stops; waiting pauses.
- **Major risks:** Timezone/business-hours bugs.
- **Out of scope:** AI-controlled sends.
- **Recommended Git checkpoint:** `feat: reminder and escalation engine`

## A9: Android authentication and task interface

- **Objective:** Sideloadable app signs in as Owner and reviews tasks/suggestions via API.
- **Likely scope:** Compose UI, secure token storage, sync.
- **Acceptance criteria:** Owner can approve suggestions and manage tasks against staging/prod API.
- **Major risks:** Auth refresh on mobile.
- **Out of scope:** Notification listener.
- **Recommended Git checkpoint:** `feat: android auth and task UI`

## A10: Google Messages notification capture

- **Objective:** Best-effort Messages → communication events → suggestions path.
- **Likely scope:** NotificationListenerService, dedupe, exclusions, outbox.
- **Acceptance criteria:** When content present, event created; missing content falls back to manual/voice; permission health visible.
- **Major risks:** OEM redaction; background kills.
- **Out of scope:** WhatsApp and other messengers.
- **Recommended Git checkpoint:** `feat: google messages notification capture`

## A11: Missed-call and selected-contact prompts

- **Objective:** Always prompt on missed call when detected; optional prompt on completed calls for known/selected/tracked numbers only.
- **Likely scope:** Call notification parsing, contact track list.
- **Acceptance criteria:** Unknown completed calls do not always prompt; manual fallback remains.
- **Major risks:** Dialer variance; unreliable completed-call signals.
- **Out of scope:** Call recording.
- **Recommended Git checkpoint:** `feat: call follow-up prompts`

## A12: Voice capture and transcription

- **Objective:** Record → transcribe → structure → confirm; delete audio on success; voice never creates Tasks directly—follow-ups and new work are Task Suggestions (D038); multi-intent complete + follow-up proposal with assignment confirmation gate (D037).
- **Likely scope:** Android recorder, upload API, OpenAI transcription, confirmation UI.
- **Acceptance criteria:** Example multi-intent utterance completes current task and creates follow-up **Task Suggestion** only; Recipient email not sent without assignment confirmation; audio removed after success.
- **Major risks:** Failed transcription retry window; attachment size/policy failures.
- **Out of scope:** Live-call transcription.
- **Recommended Git checkpoint:** `feat: voice capture and transcription`

## A13: Retention workers

- **Objective:** Enforce 7-day excerpt and 30-day completed visibility scrub; immediate audio deletion on success path.
- **Likely scope:** Scheduler, scrubbers, retention run logs, learning extraction before purge.
- **Acceptance criteria:** Verified deletions; Gmail forwards untouched; failed deletes retried/alerted.
- **Major risks:** Over-deletion of audit narrative; under-deletion backlog.
- **Out of scope:** Deleting Workspace mailbox data.
- **Recommended Git checkpoint:** `feat: retention workers`

## A14: Learning signals and proposed rules

- **Objective:** Record corrections/patterns; propose rules; never auto-apply in v1; Owner-only (D054).
- **Likely scope:** LearningSignal, WorkflowRule proposed/approved flow.
- **Acceptance criteria:** “Create a rule?” appears from patterns; Owner approval required to activate.
- **Major risks:** Leaking raw text into durable stores.
- **Out of scope:** Automatic rule execution; Recipient participation in learning.
- **Recommended Git checkpoint:** `feat: learning signals and proposed rules`

## A15: Hardening and private deployment

- **Objective:** Production-ready private deploy; sideload release; runbooks; alerts.
- **Likely scope:** Observability, reauth UX, battery/notification guidance, backup docs, capability link hardening.
- **Acceptance criteria:** Owner + Recipient can run daily workflow privately; no Play Store requirement.
- **Major risks:** Device-specific capture gaps; capability misuse.
- **Out of scope:** Play Store listing; Rocket PM; WhatsApp.
- **Recommended Git checkpoint:** `chore: v1 private deployment hardening`
