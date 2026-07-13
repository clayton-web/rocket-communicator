# Milestones

Planning milestones only. No application scaffolding occurs in A0.

**Current milestone: A1 complete** (repository foundation). Next: **A2** (API contracts and domain model) — not started.

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

- **Objective:** Canonical OpenAPI contract, Prisma draft model, domain state machine docs-as-code stubs.
- **Likely scope:** `packages/contracts` (OpenAPI source of truth), `packages/db`, `packages/domain`; generators for TS/Kotlin from OpenAPI; optional JSON Schema derived from OpenAPI.
- **Acceptance criteria:** Schemas validate sample payloads; state transitions unit-tested; no production migrations required yet if still local-only.
- **Major risks:** Premature tables that fight retention design.
- **Out of scope:** Live Supabase project requirement beyond local planning (connection still later).
- **Recommended Git checkpoint:** `feat: contracts and domain model`

## A3: Authentication and roles

- **Objective:** Workspace Google sign-in; primary and administrator membership.
- **Likely scope:** Supabase Auth integration, domain allowlist config, role guards.
- **Acceptance criteria:** Both roles can authenticate; unauthorized domains rejected; API rejects cross-org access.
- **Major risks:** Misconfigured OAuth clients.
- **Out of scope:** Gmail link, Android capture.
- **Recommended Git checkpoint:** `feat: workspace auth and roles`

## A4: Task core and minimal administrator web view

- **Objective:** Task CRUD, notes, complete, waiting, snooze; authenticated `/t/[id]` style view.
- **Likely scope:** Task APIs, minimal UI for primary and admin.
- **Acceptance criteria:** Admin can open assigned task and complete/wait/note/return/request clarification with audit; cannot create standalone tasks or change rules; admin work requests become Task Suggestions; no unauthenticated mutations.
- **Major risks:** Building a full dashboard by accident.
- **Out of scope:** AI, Gmail forward, Android.
- **Recommended Git checkpoint:** `feat: task core and minimal admin task view`

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

- **Objective:** After one Primary confirmation, assign admin; for Gmail-origin tasks forward original with all attachments and summary header (bundled with create task + schedule reminders per D037); non-email tasks get normal assignment email.
- **Likely scope:** Mailer, idempotent forward, audit of single bundled approval and Gmail ids, secure links.
- **Acceptance criteria:** No send without the single confirmation; dialog discloses create task, forward email, forward attachments, schedule reminders; attachments included; duplicate forward prevented; admin from user record not hard-coded.
- **Major risks:** Attachment size/policy failures; partial forwards.
- **Out of scope:** Separate attachment approval UX.
- **Recommended Git checkpoint:** `feat: assignment email and gmail forward`

## A8: Reminder and escalation engine

- **Objective:** Deterministic reminders with v1 escalation rule.
- **Likely scope:** Policies, scheduler, `ReminderAttempt` idempotency, waiting/snooze interactions.
- **Acceptance criteria:** First overdue admin-only; later may CC primary; duplicates impossible under double schedule; completed stops; waiting pauses.
- **Major risks:** Timezone/business-hours bugs.
- **Out of scope:** AI-controlled sends.
- **Recommended Git checkpoint:** `feat: reminder and escalation engine`

## A9: Android authentication and task interface

- **Objective:** Sideloadable app signs in and reviews tasks/suggestions via API.
- **Likely scope:** Compose UI, secure token storage, sync.
- **Acceptance criteria:** Primary can approve suggestions and manage tasks against staging/prod API.
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
- **Acceptance criteria:** Example multi-intent utterance completes current task and creates follow-up **Task Suggestion** only; admin email not sent without assignment confirmation; audio removed after success.
- **Major risks:** Failed transcription policy still open.
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

- **Objective:** Record corrections/patterns; propose rules; never auto-apply in v1.
- **Likely scope:** LearningSignal, WorkflowRule proposed/approved flow.
- **Acceptance criteria:** “Create a rule?” appears from patterns; approval required to activate.
- **Major risks:** Leaking raw text into durable stores.
- **Out of scope:** Automatic rule execution.
- **Recommended Git checkpoint:** `feat: learning signals and proposed rules`

## A15: Hardening and private deployment

- **Objective:** Production-ready private deploy; sideload release; runbooks; alerts.
- **Likely scope:** Observability, reauth UX, battery/notification guidance, backup docs.
- **Acceptance criteria:** Primary + admin can run daily workflow privately; no Play Store requirement.
- **Major risks:** Device-specific capture gaps.
- **Out of scope:** Play Store listing; Rocket PM; WhatsApp.
- **Recommended Git checkpoint:** `chore: v1 private deployment hardening`
