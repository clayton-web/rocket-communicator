# Milestones

**Authority:** Below authority — delivery sequence and status only. This file originates no product law; where it and [PROJECT_CONSTITUTION.md](PROJECT_CONSTITUTION.md), [AI_CONSTITUTION.md](AI_CONSTITUTION.md), or [DECISIONS.md](DECISIONS.md) differ, those win.

**This file is not the production-state authority.** Current deployed commit, schema state, flags, and schedulers live in [DEPLOYMENT.md § Current production state](DEPLOYMENT.md#current-production-state). Process: [ENGINEERING_WORKFLOW.md](ENGINEERING_WORKFLOW.md) · [REVIEW_CHECKLIST.md](REVIEW_CHECKLIST.md).

## Where the product is

**Built and operational:** Owner authentication, Task core, the Recipient capability web loop, Gmail ingestion and polling, the AI suggestion path, Gmail forwarding and assignment email, the Owner web experience foundation, and the Android Owner client through capture, organize, assign, and follow-through.

**Built and deliberately inert:** the reminder and Owner-notification engines. The scheduling domain, persistence, Owner reminder APIs, occurrence processing, real Gmail transport, and the Owner attention surfaces are all deployed, but every feature flag is absent and no scheduler invokes either worker, so nothing sends. Enabling any of it requires its own authorization.

**Not built:** Messages capture, call prompts, the voice pipeline, retention workers, learning signals, and private-deployment hardening.

**Next:** controlled S3 shared interpretation (authorized by **D169**; first slice S3.1 backend-only), then later product surfaces and Owner Acceptance Week (deferred under D159). See [Forward sequence](#forward-sequence).

## Completed

Each milestone below is closed. Detailed engineering narratives were deliberately removed; the binding outcomes live in [DECISIONS.md](DECISIONS.md) and the current design in [ARCHITECTURE.md](ARCHITECTURE.md).

| Milestone     | Delivered                                                                                                                                                                                                                         | Binding decisions    |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| **A0**        | Documentation and Git baseline                                                                                                                                                                                                    | —                    |
| **A1**        | Monorepo and application shells                                                                                                                                                                                                   | —                    |
| **A2**        | Contract and domain foundation                                                                                                                                                                                                    | D007                 |
| **A3**        | Owner authentication                                                                                                                                                                                                              | D048                 |
| **A4**        | Task core, Owner task HTTP, Recipient capability web view, audit trail                                                                                                                                                            | D051–D064            |
| **A5**        | Gmail connection, OAuth, polling, ingestion, Application Polling Engine                                                                                                                                                           | D065–D078            |
| **A6**        | Heuristic relevance, LLM extraction, Application Suggestion Engine, Owner suggestion HTTP                                                                                                                                         | D080–D085            |
| **A7**        | Gmail forwarding with attachments, assignment email, Recipient management, handoff HTTP, Owner confirmation UI                                                                                                                    | D086–D094            |
| **A8.1–A8.6** | Reminder scheduling domain, persistence, Owner reminder APIs, lifecycle wiring, occurrence processing and recovery, real Gmail transport, Event Notification Engine, Owner attention surfaces. **Deployed inert**                 | D102–D110, D127–D136 |
| **P1**        | Owner web experience foundation: observability and correlation, browser harness, request and render reliability, Owner shell, semantic tokens, organization-timezone display, attention destination, boundaries and accessibility | D111–D120            |
| **P2.0**      | Owner-experience product lock (documentation only). Its product law now lives in [PROJECT_CONSTITUTION.md](PROJECT_CONSTITUTION.md)                                                                                               | D137–D144            |
| **A9.0**      | Android Owner foundation: native Workspace auth via Supabase, secure session storage, Bearer JWT through the shared Owner pipeline, session restore, minimum shell, session-local sign-out                                        | D145–D147            |
| **A9.1**      | Authenticated Android networking foundation (`OwnerApiExecutor` / `OwnerApiRepository`)                                                                                                                                           | D148                 |
| **A9.2**      | Android Task Capture — typed and IME-dictated capture via `POST /api/v1/tasks`                                                                                                                                                    | D149                 |
| **A9.3**      | Android organize, assign, and follow-through: Task list and detail, lifecycle actions, optional handoff assignment                                                                                                                | D150                 |

**A9.0 formal closure remaining:** operator execution of [A9_0_DEVICE_VERIFICATION.md](A9_0_DEVICE_VERIFICATION.md) on a real device with recorded evidence.

**P1 evidence limitation.** The valid Recipient capability workflow was not validated in production, because issuing a capability requires a real Gmail handoff and no safe synthetic path exists. This is an intentional production-safety property, not a defect and not a failed validation; the area is covered by local evidence.

## Remaining A8 work

The engines exist and are deployed. What remains is **operational enablement**, and each step needs its own authorization.

| Step                                                               | State                                                                                                              |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| First controlled capture enablement (`ENABLE_OWNER_EVENT_CAPTURE`) | Previously authorized and partially executed; **never became live**. Not authorized to resume                      |
| Capture-only observation window                                    | Procedure prepared; **unauthorized, unbegun**                                                                      |
| Owner-notification delivery (`ENABLE_OWNER_EVENT_DELIVERY`)        | **Unauthorized, unbegun.** The first capability in the project's history that can send mail on Rocket's initiative |
| Reminder delivery (`ENABLE_REMINDER_DELIVERY`)                     | **Unauthorized, unbegun.** The first capability that can send mail to somebody who is not the Owner                |

**Production reminder enablement is additionally gated by D108:** both the Event Notification Engine and the minimum Owner schedule-status UI must be operational first.

**The Owner must not create or modify a reminder in Production** until a later rollout is authorized. No technical obstacle prevents doing so by accident.

**Not part of this enablement:** the D164 seam between Recipient-oriented reminder delivery and Owner-responsible follow-through ([WORKFLOWS.md](WORKFLOWS.md) §10a). Enabling the flags above ships the engine as built and closes nothing about it. No slice is planned or authorized, and whatever addresses it must evolve the existing reminder domain rather than add a second engine.

Enablement procedures, flag semantics, and rollback are owned by [DEPLOYMENT.md](DEPLOYMENT.md).

## A7 deferred backlog (not a milestone)

Handoff work deliberately descoped at A7 closure. None of it is authorized to start implicitly — each item needs its own planned, reviewed slice.

| Deferred item                                                                | Notes                                                                           |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Reassignment and explicit re-forward orchestration                           | D086 policy, domain, and persistence primitives exist; no orchestration or HTTP |
| `proposedRecipientHint` → `proposedRecipientId` deterministic resolution     | D094(6); fields absent from the current handoff request schema                  |
| Reconciliation worker for stale or uncertain `pending` handoff attempts      | Discoverable as stale `pending`; no `unknown` status was introduced             |
| Owner UI for Recipient management                                            | HTTP endpoints exist; Recipients are managed through those APIs                 |
| Orphan OAuth fallback path `/settings/gmail`                                 | Unreachable in practice; a Task `returnPath` is always supplied                 |
| Gmail settings UI and Gmail History recovery / `resync_required` operator UX | Deferred from A5                                                                |

**Naming note:** do not label this backlog "A7.5". That identifier already names a completed slice, and reusing it would make the record untruthful.

## Version-one scope

Product law is [PROJECT_CONSTITUTION.md](PROJECT_CONSTITUTION.md); this section is delivery scope only.

**Included communication sources:** one Google Workspace Gmail inbox; Google Messages notifications (best-effort); missed-call notifications (device-dependent); known-contact completed-call prompts (best-effort); manual and spoken capture (always available).

**Excluded from version one** — sequencing, not permanent product limits: WhatsApp, Messenger, Signal; call recording and live-call transcription; historical SMS import; multiple Gmail accounts; Play Store distribution; Neon; FCM unless later justified (D017); a full Recipient dashboard; a second Authenticated User; arbitrary recurrence as a calendar product.

**Excluded as architectural alternatives (D131):** Google Tasks, Microsoft To Do, Apple Reminders, Google Calendar as a task or reminder engine, and every other third-party task engine. None is a dependency, fallback, or competing authority.

**Broader operational enablement readiness (D144)** is a separate bar in [PROJECT_CONSTITUTION.md](PROJECT_CONSTITUTION.md) § Success definition and requires its own authorization gates.

## Forward sequence

Sequencing only — no milestone is renumbered.

1. **AI-first capture and interpretation** — the direction locked by D154, D156, D157, and D164: source → shared interpretation → zero or more proposals → Owner review → accept and choose the responsible person (Owner or Recipient) → canonical Task → follow-through. **D169** now authorizes controlled S3 implementation of that path: shared interpretation application service + Owner manual capture, reusing the existing `packages/ai` contract, `InterpretationRun` foundation, and canonical `TaskSuggestion` lifecycle. **S3.1** (first authorized slice) is backend-only shared interpretation wired to canonical persistence, with **no** Owner HTTP or Android product reachability. Earlier “paused / unauthorized to resume” language for `packages/ai` application wiring was a correct historical gate and is superseded only within D169’s boundaries. Implementation must evolve the one shared proposal path and the one shared interpretation capability ([ARCHITECTURE.md § Ownership and reuse map](ARCHITECTURE.md#ownership-and-reuse-map)), not create a second one. Gmail/SMS producers, Android proposal UI, Owner interpretation HTTP, and Production activation remain separately unauthorized.
2. **Owner Acceptance Week** — formal product gate (D142), **deferred and must not be executed** (D159).
3. **P2.2 — Remove Friction** — not started, not authorized.
4. **A8 operational enablement** — capture observation, then notification delivery, then reminder delivery; each separately authorized.
5. **A10+** — Messages capture, call prompts, voice pipeline, retention workers, learning signals, hardening.

Nothing later in this list is authorized by anything earlier in it.

## Owner Acceptance Week

**Status:** formal product gate (D142). **Deferred — must not be executed until the Owner re-authorizes it** (D159). No separate OAW procedure document is active; surviving law is **D142**, **D159**, and this section.

A future meaningful OAW must prove approximately: communication or capture → interpretation → Owner review → accept and choose who is responsible, the Owner or a Recipient → canonical Task → follow-through (D154, **D164**). Direct-create capture scenarios are **not** the target (D154). Redesigning the procedure is separate work and still requires explicit Owner re-authorization before any execution.

**Exit criteria (all required):**

1. Rocket is the Owner's primary task system during the window
2. Real work captured daily on the native client
3. Real Recipient handoff completed
4. External notes no longer required for ordinary follow-through
5. Usability issues documented
6. Owner explicitly approves or withholds resuming operational enablement; **silence is not approval**

P2.2 entry requires an OAW pass (or recorded conditional Go) plus explicit Owner Go.

## Planned

### P2.2 — Remove Friction

Planned after Owner Acceptance Week (D143). **Not started, not authorized.** Improve the native Owner experience using OAW findings: fewer taps, better wording, navigation, consistency, polish, performance. No major features.

**P2.2a — People** is the planned first slice (**D151**) — planning only, not authorized. Server-side Everyone / Me / individual Recipient filter over the existing Task list order, display names primary, client-local filter memory. Explicitly excluded: alternate Task sorts, search, Recipient pages, kanban, dashboards, CRM, server-synced preferences.

### A10 — Google Messages notification capture

Sequencing only: Messages source → shared interpretation → proposals → Owner decision (product law: **D160** / [WORKFLOWS.md](WORKFLOWS.md) §3). OPEN #1 (dialer) affects reliability. Not an implementation authorization.

### A11 — Missed-call and selected-contact prompts

Always prompt on a detected missed call; completed-call prompts only for known or tracked numbers.

### A12 — Voice capture and transcription

Record → transcribe → confirm; audio deleted on success; voice never creates Tasks directly (D038).

**Boundary:** Android OS speech-to-text into fields already shipped in A9.2. A12 is the later voice **pipeline**. AI-first interpretation of typed or dictated input (D154) needs its own authorized slice and is not an A12 dependency.

### A13 — Retention workers

7-day excerpt purge and 30-day completed scrub; Gmail mailbox copies untouched (D031). OPEN #12 (tombstone duration). Honours the workflow safety ceilings (D082).

### A14 — Learning signals and proposed rules

Owner-only learning (D054); propose rules; never auto-apply in v1. **A14 is not a precondition for recording learning evidence** — it is the milestone that acts on it.

### A15 — Hardening and private deployment

Private deploy, sideload release, runbooks, capability hardening. OPEN #3 (domains / hostname).

## Engineering / DX backlog (not a milestone)

Non-blocking developer-experience and CI-determinism work. Not product requirements; must not be implemented inside a product authorization unless that authorization explicitly includes them.

| Item                                                                 | Notes                                                                                                                                                                                                                                                                                |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Make `pnpm verify` deterministic for web packaging tests             | `pnpm verify` runs `pnpm test` — including packaging tests that read `apps/web/.next` — **before** `pnpm build:web`, so those tests can consume a stale trace and fail misleadingly. Future work must preserve packaging-test coverage rather than bypass it                         |
| Run database tests against a real PostgreSQL engine, not only PGlite | PGlite runs the real migration SQL but is a single in-process connection, so no test can contend two sessions on one row and every concurrency guarantee is reasoned rather than proven. The same environment would enable a `prisma migrate diff` drift gate, which is absent today |
| Document a production database credential-rotation procedure         | None exists; the 2026-08-04 rotation followed none. Also noted in [DEPLOYMENT.md](DEPLOYMENT.md) § Current production state                                                                                                                                                          |
