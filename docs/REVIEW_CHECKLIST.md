# Review checklist

Use this checklist before completing any implementation milestone or merging behaviour-changing work. Answer every section. “N/A” is allowed only with a one-line reason.

Governing references: [PROJECT_CONSTITUTION.md](PROJECT_CONSTITUTION.md) · [AI_CONSTITUTION.md](AI_CONSTITUTION.md) · [ENGINEERING_WORKFLOW.md](ENGINEERING_WORKFLOW.md)

---

## Scope

- [ ] Change maps to exactly one current milestone in [MILESTONES.md](MILESTONES.md)
- [ ] Acceptance criteria for that milestone are listed and met
- [ ] Explicit out-of-scope items for the milestone were not implemented
- [ ] No unrelated refactoring or drive-by feature work
- [ ] New discoveries parked in [OPEN_QUESTIONS.md](OPEN_QUESTIONS.md) or a future milestone
- [ ] Version-one exclusions (WhatsApp, Play Store, Rocket PM, auto-create, etc.) untouched
- [ ] Plan or prompt classified Docker as 🟢 not required, 🟡 recommended, or 🔴 required ([ENGINEERING_WORKFLOW.md](ENGINEERING_WORKFLOW.md))

## Environment and verification

Governing process: [ENGINEERING_WORKFLOW.md](ENGINEERING_WORKFLOW.md) (Environment Guard, Docker indicator, verification exit criterion, Environment Status report block).

- [ ] **Environment Guard** ran before application-code changes (Node, pnpm, `JAVA_HOME` → Java 17, Gradle on JDK 17, slice-specific tools, and a green `pnpm verify` baseline unless authorization waived the baseline)
- [ ] Environment failures were classified as environment issues — application code was not modified to compensate
- [ ] Toolchains that were already healthy were not reinstalled or reconfigured
- [ ] **`pnpm verify` is green** as the default exit criterion, **or** the authorization explicitly permitted a narrower scope
- [ ] If verification was partial: the report says **partial**, lists every blocked step exactly, and does **not** claim full verification
- [ ] An environment failure is not treated as proof of application correctness
- [ ] Genuine repository defects from verification were reported, not silently bypassed
- [ ] Completion report includes the **Environment Status** block (Node, pnpm, `JAVA_HOME`, Java, Gradle, Docker required for this slice, `pnpm verify`)

## Architecture

- [ ] Matches [ARCHITECTURE.md](ARCHITECTURE.md) and Approved [DECISIONS.md](DECISIONS.md)
- [ ] Honours Architecture Principles (D079; complete source in [PROJECT_CONSTITUTION.md](PROJECT_CONSTITUTION.md)): logic independent of host/infra where practical; replaceable vendors; cost-aware without weakening security; free tiers preferred when sufficient; infrastructure triggers endpoints rather than embedding business logic; no unnecessary complexity/lock-in
- [ ] No new vendor or datastore without a decision entry
- [ ] Neon still not introduced alongside Supabase in v1
- [ ] Android still does not write core business records directly to Supabase tables
- [ ] Prisma used only through authorized server APIs
- [ ] Canonical contract approach preserved (OpenAPI source of truth → generated TS/Kotlin clients; JSON Schema only if derived)
- [ ] Follow-up Engine / Event Notification Engine / retention behaviour remains deterministic (not model-driven sends) (D027, D102–D110)
- [ ] Scheduled work (Gmail Application Polling Engine, reminder processing, retention) remains app-owned engines invoked by External Schedulers—not business logic inside the scheduler platform
- [ ] **Ownership boundaries hold (D131):** the application stays the **sole source of truth** for Tasks, Task state, reminder schedules, reminder state, reminder policy, reminder history, delivery outcomes, and Owner-attention state; the External Scheduler only **wakes** it and decides nothing (not due-ness, eligibility, whether to send, schedule status, counts, ceilings, generations, retry policy, or Owner attention); Gmail only **transports** and owns no scheduling, policy, retry rule, history, or capability state; and no third-party task engine (Google Tasks, Microsoft To Do, Apple Reminders, Google Calendar as an engine) is introduced or described as a planned dependency, and any projection, export, cache, or integration that holds Rocket data stays subordinate to it rather than becoming a competing authority
- [ ] **Online-first with graceful connectivity loss (D132):** no offline business-record store, service-worker cache of authenticated business data, mutation queue, background synchronization, or conflict-resolution layer is introduced; a write that did not reach the server is never presented as successful; a preserved local draft is never treated as a completed server write; retry runs **through** the existing idempotency and concurrency machinery; reconnecting cannot produce duplicate Task mutations; and no copy claims the application works offline
- [ ] Reminders derive only from an **explicitly Owner-selected** due date; no escalation stages and no Owner CC ladders (D099, D102)
- [ ] Snooze is not treated as A8 product law (D101); **Waiting is the only** suspension mechanism, and no separate pause control was added (D097, D107)

## Reminder engine (A8; apply when reminder work is in scope)

Gates for the due-date-driven Follow-up Engine (D102–D110). These record **expected behaviour and required proof**; no specific resolver implementation is pre-approved.

- [ ] Occurrences computed by **local-calendar arithmetic** (increment the calendar date, then resolve 09:00 local) — **not** by `MS_PER_DAY` or any fixed 24-hour millisecond recurrence (D103)
- [ ] **09:00 organization-local preserved across daylight-saving transitions**, proven by test across a real DST boundary (absolute gap between consecutive occurrences correctly 23 or 25 hours on the transition day)
- [ ] No dependency on browser, device, or server machine-local timezone; organization timezone is the only authority (D034, D103)
- [ ] Deterministic IANA timezone resolution, with defined behaviour for DST **gap** (non-existent local time) and **ambiguity** (repeated local time)
- [ ] **Adversarial timezone-resolver tests** pass identically under Node, Vitest, and the deployed runtime — including a zone where the reminder hour itself transitions
- [ ] Idempotency **enforced by a database constraint**, not application code; identity is server-derived and encodes the local calendar day (D109)
- [ ] **Generation validated immediately before send**; stale claims from a superseded generation cannot deliver (D104)
- [ ] **Pre-send recheck** of Task status, assignment state, and schedule state immediately before the provider call (D107)
- [ ] Automated sends attributed to a **`system`** actor; Owner scheduling changes to the **`owner`** actor; no automated send attributed to the Owner as if manual (D107)
- [ ] **No capability token or capability URL** in reminder metadata, audit, logs, or telemetry (D109)
- [ ] **No retroactive sends:** an advance occurrence already elapsed at establishment is recorded as skipped with `advance_window_elapsed`, and no scheduler run reclassifies a scheduled occurrence from the clock (D105)
- [ ] **An advance occurrence a Waiting period spanned** is recorded as skipped with the distinct reason `skipped_waiting_elapsed` on resume, never sent late and never conflated with `advance_window_elapsed`; its original local date and instant are preserved, and an already-delivered or already-skipped occurrence keeps its existing reason (D105, D107)
- [ ] **No backlog:** a past due date, a resume from Waiting, and a reassignment each schedule only the next future occurrence — for the advance occurrence as well as the overdue one (D105, D107)
- [ ] Reassignment preserves the **Task-scoped** schedule and sends no backlog (D104)
- [ ] Overdue ceiling stops at **14 successful overdue deliveries per generation**; failures, skips, claims, and advance reminders excluded from the count (D106)
- [ ] Material due-date change opens a new generation, preserves all prior history, resets only the per-generation count, and discloses the restart; a same-value save does neither (D104)
- [ ] Duplicate or overlapping scheduler invocations produce **at most one delivery per local calendar day**
- [ ] Completion, dismissal, and due-date removal stop future sends; reminder history is superseded, never deleted or rewritten (D107)
- [ ] Existing historical due-date data did **not** auto-activate reminders; Owner opt-in or re-save is required (D109)
- [ ] **No production enablement** before the Event Notification Engine **and** the minimum Owner schedule-status UI are operational (D108)
- [ ] Deferred scope absent: no preset reminder choices, Owner-created additional reminders, custom-reminder routes or UI, recurrence editor, reminder-time picker, Recipient reminder preferences, or AI-controlled scheduling (D110)
- [ ] No regression to A7 assignment delivery on either path

### Worker safety (A8.4a; apply to any occurrence-processing change)

- [ ] A provider-accepted delivery is recorded **durably** and cannot be rolled back by a schedule that suspended, stopped, or changed generation mid-call; the schedule effect is an expected no-op, never an abort
- [ ] The **occurrence row** is the only duplicate-prevention authority; the schedule lease is a scan hint and no correctness decision consults it
- [ ] `provider_call_started_at` is written **before** the transport call, never after — an expired claim without it is reclaimed, with it is finalized `ambiguous` and never retried
- [ ] Every occurrence state change is fenced on the claim sequence the caller observed; a stale claimant cannot finalize, release, or mark in-flight over a successor
- [ ] A retry reuses the **same** occurrence row; no second row is created for a retry, and an exhausted budget terminalizes rather than leaving an unclaimable retryable row
- [ ] Only a **terminal** occurrence outcome settles a schedule's advance disposition; a claim is not a processed occurrence
- [ ] The safe finalization transaction is the **only** public success path; no raw outcome writer is exported from `@aicaa/db` or `@aicaa/db/runtime`
- [ ] Pre-send re-validation happens **immediately before** the transport call, not only at claim time — a claim proves exclusivity, not eligibility
- [ ] A global scan is still an organization-scoped write: every mutation derives its organization from the row, never from a caller argument
- [ ] Structural fixes carry a **structural guard** that fails with no database; race suites are supporting evidence, not the regression mechanism ([ENGINEERING_WORKFLOW.md](ENGINEERING_WORKFLOW.md))
- [ ] Processing modules (`apps/web/lib/reminders/`) import **no** Gmail client or real provider transport; the transport is injected, and the delivery flag defaults disabled by exact-string match
- [ ] Internal endpoint responses and logs carry aggregates only — no Recipient identity, address, provider payload, failure detail, lease, or row identifier
- [ ] Additive migrations are tested **from the existing migration state with live rows present**, not only from empty; any new constraint over existing data carries a backfill

### Reminder delivery (A8.4b; apply to any change that can reach a provider)

- [ ] Provider authorization is resolved **once per invocation, before the first claim**; a failure claims nothing, writes nothing, calls no provider, and is **not** recorded as an occurrence-level reminder failure (D129/D130 slice law)
- [ ] Capability state is read from the **canonical row in the same snapshot** as the Task, assignment, due date, and schedule — not by a second query, and not reconstructed
- [ ] A non-actionable capability produces a truthful `no_actionable_capability` **skip** with zero provider calls, and is distinguishable from `no_active_assignment`
- [ ] No reminder mints, rotates, or re-sends a capability, and none modifies an expiry or revocation rule
- [ ] Both MIME bodies are **asserted link-free** before emission; content arriving from the database (summary points) is redacted rather than trusted (D130)
- [ ] Forbidden email content is absent from **text and HTML**: capability URL, token, `/c/`, Task URL, redirect, communication excerpts, reminder counts, escalation or "final reminder" wording, internal identifiers, threading headers, CC, BCC
- [ ] Provider outcomes stay four-valued — confirmed, retryable, permanent, terminal ambiguous — and an **ambiguous outcome is never reported as sent** or counted toward the overdue ceiling
- [ ] A send failure carrying **no HTTP status from the provider is ambiguous, never retryable** — a connection failure does not prove the message was not accepted, and an unattended retry of a message the provider may hold is a duplicate reminder to a real Recipient
- [ ] Only privacy-safe provider metadata is stored: no raw response, access token, MIME body, message content, or recipient address
- [ ] The real transport is **unreachable from tests**: it refuses construction under a test runner, and the flag gates construction in the composition root so no token is decrypted or exchanged when off
- [ ] Reminder transport changes touch **no** A7 handoff, assignment-email, forwarding, or capability-link behaviour, and add no threading, CC, or BCC
- [ ] The advance reminder is deliverable **only during its own organization-local calendar day** (D105); the boundary is a calendar-date comparison in the organization's zone, never a fixed number of hours, so the 23- and 25-hour days the clocks shift neither lose an hour nor spill into the due date
- [ ] A morning the worker reached too late is **claimed and settled**, not filtered out of the scan, so no schedule is left reporting `scheduled` for an occurrence that can never happen
- [ ] `advance_window_elapsed` stays distinct from `skipped_not_eligible`: the first means the reminder was owed and missed, the second means the Task stopped needing one, and their remedies differ
- [ ] Advance and overdue share **one** claim, guard, send, and settle path; a second pipeline is the failure mode, and the kind is read from the scanned candidate rather than written as a literal downstream
- [ ] The advance reminder reuses the approved email **verbatim** — no "due tomorrow", no escalation, no capability link (D130), no counts, no schedule identifiers — because D105 is a difference in timing, not in content
- [ ] Advance occurrences count toward **neither** D106's fourteen successful overdue deliveries nor D129's consecutive run; a generation holds one advance occurrence, so it can never form a sequence
- [ ] An ambiguous-outcome **counter is not stored**; D129's threshold is derived from history, and nothing auto-resumes a schedule stopped for repeated ambiguity
- [ ] D129's threshold is evaluated **inside the settlement transaction** that holds the Task lock and applies the schedule effect once — never in a provider adapter, never in the worker, and never from history read before the lock was taken
- [ ] The sequence counts **final occurrence outcomes, not provider attempts**: one occurrence retried three times is one outcome, and `attempt_count` is not an input
- [ ] A **skip neither counts toward nor breaks** the run (no provider was contacted), while a success or a permanent failure — retry-budget exhaustion included — breaks it
- [ ] History is scoped to the **current generation** and ordered by scheduled occurrence identity, not by `completed_at`, so a late or swept settlement cannot reorder the run
- [ ] The stop is conditional on the schedule still being `active`, so an **earlier authoritative stop reason is never overwritten**, and the third occurrence stays recorded as ambiguous rather than being rewritten
- [ ] A stop **disarms the next occurrence**, so no fourth reminder is reachable by the same invocation, a concurrent worker, or the next wake-up
- [ ] No new schedule status is introduced: Waiting remains the only suspension mechanism (D097, D107), and D129 stops rather than pauses

## Owner web experience foundation (P1; apply when P1 work is in scope)

Gates for D111–D126. Record **expected behaviour and required proof**; no specific implementation is pre-approved.

- [ ] Change stays inside the **nine authorized P1 areas** (D111); nothing from the P1 exclusion list in [MILESTONES.md](MILESTONES.md) was implemented
- [ ] **No optimistic mutation success** — nothing renders, animates, or implies a business mutation succeeded before the server confirmed it (D112)
- [ ] **Ambiguous outcomes stay ambiguous**; pending handoff copy still says the send may or may not have happened (D092, D112)
- [ ] **Ambiguous or transport retry** reuses the **same `Idempotency-Key`** and the **original `If-Match`** so the server can replay a durable attempt; no new-key "start over" after a durable attempt (D112, §2)
- [ ] **Confirmed `412 PRECONDITION_FAILED`** refreshes authoritative state and re-presents it before a new attempt; no silent loop on a known-stale `If-Match`, and a stale conflict is not shown as success or as merely transient (D112)
- [ ] Offline and lost-connectivity states are explicit and truthful; **no mutation queue, no service-worker caching of authenticated business data, no local business-record cache** (D111)
- [ ] Loading affordances used for **reads only**; empty states distinguish "none yet" from "none matched" from "failed to load" (D112)
- [ ] **One correlation reference** joins the user-visible error reference, server diagnostics, and the audit row where one exists — proven by forcing a real failure and tracing a single value (D115)
- [ ] **No capability token and no raw `/c/{token}` path** in any telemetry, log, metric, or error payload — proven by an automated assertion, not review alone (D114)
- [ ] Capability routes remain **excluded from client telemetry** (D114); server diagnostics identify them by static template only
- [ ] No prohibited telemetry payload: no OAuth tokens, email bodies or subjects, Task notes, summary text, communication excerpts, MIME, plaintext Recipient email, or raw provider errors (D114)
- [ ] **Operational telemetry is not treated as audit history, a business record, or a learning signal**; it drives no product behaviour (D113)
- [ ] Observability seam is **vendor-neutral** and application-owned; no commercial telemetry vendor, session replay, or behavioural analytics (D115)
- [ ] **No health or readiness endpoint** added, and none required for closure (D115)
- [ ] Owner dates and timestamps use the **organization** timezone, proven not to depend on browser, device, or machine-local timezone (D117)
- [ ] The display formatter is **not** used as a scheduling resolver; **D103** remains the authority for reminder arithmetic
- [ ] Shell provides one **generic** Owner attention / operational-status destination; **no reminder navigation, copy, or status**, and no claim that automation exists while A8 is unimplemented (D089, D118)
- [ ] `packages/ui` remains a **semantic-token layer only** — no general component library, no Kotlin token generation (D116)
- [ ] Tokens landed as a **no-op refactor first** (identical values, references swapped) before any value change (D116)
- [ ] Every current route has a **loading state, segment error boundary coverage, global error fallback, and not-found state** (D119)
- [ ] **Both** confirmation dialogs validated for keyboard, focus trap, Escape, and focus restoration (D119)
- [ ] Accessibility gate met: **zero serious or critical** automated findings; contrast passes in the shipped theme. Dark mode is **not** required (D119)
- [ ] Browser test layer covers the critical Owner and Recipient journeys and runs as a **separate job**, not inside `pnpm verify` (D119)
- [ ] Structural gates pass: **one** Owner authentication call per Owner page request; documented and asserted maximum database round trips per route (D119)
- [ ] **Baseline captured in P1.1 before any experience change**; numeric thresholds ratified from that evidence, not asserted (D119)
- [ ] **No A8 runtime implementation**; no schema, migration, OpenAPI, generated-client, or Android implementation change; audit and mutation-truthfulness semantics unchanged (D119)
- [ ] Product name unchanged — the current official name still appears in web metadata and shell copy; no implicit rename (**D120**, Open)

### Owner shell and presentation (P1.4; D121–D126)

- [x] Route group `(owner)` changes **no public URL**; `/`, `/login`, `/auth/**`, and `/c/{token}` remain outside Owner chrome; proxy pathname matching unchanged (D111)
- [x] `/` is **not** globally redirected to `/tasks`, and keeps its authenticated and unauthenticated behaviour
- [x] Build-output paths moved with the route group — **NFT manifest paths and any tooling that reads them were updated**, and Prisma engine tracing still resolves for both Task routes
- [x] Exactly **one verified `getUser()` per Owner page request** across layout **plus** page, measured at the real Auth HTTP layer — **not** by counting source call sites (D119)
- [x] Render-pass memoization introduces **no cross-request cache**: sequential and concurrent request counts scale with request count
- [x] Shell emits **no second `owner_authentication` timing event**, so the P1.3 duplicate-auth diagnostic stays meaningful
- [x] Shell adds **zero database queries** and **no client fetch**; no layout-induced sequential DB waterfall
- [x] Product name is **not** an `<h1>`; each page retains exactly **one page-owned `<h1>`**
- [x] Navigation is **only** Tasks, Attention, and Sign out — no Recipients, Gmail settings, suggestions, reminders, administration, or health entry, and no empty or future destination (D089)
- [x] Active navigation uses `aria-current="page"` **plus** a non-colour-only treatment; `/tasks/{taskId}` keeps Tasks current
- [x] Chrome persists across loading and error boundaries; neither declares its own container or navigation
- [x] Sign-out is **POST only** with no `GET` handler, revokes **server-side** at Supabase, redirects **303**, and is not reachable by `next/link` prefetch (D123)
- [x] Sign-out required **no OpenAPI or generated-client change** (D123)
- [x] `/attention` is truthfully empty: no query, no queue, no count, no schedule, no monitoring claim, and no A8 operational data (D118, D121)
- [x] Owner display timezone is a **documented constant**, not an environment variable or schema field; an invalid zone **fails loudly** rather than falling back to machine-local time (D122)
- [x] Every rendered date-**time** carries a zone indicator; Owner timestamps are formatted **server-side** so no hydration mismatch is possible
- [x] Timezone proven under `TZ=UTC`, `TZ=Asia/Tokyo`, **and** a non-Vancouver **browser** timezone, including both DST boundaries (D117)
- [x] Task presentation is **visual only** over existing DTO fields: no filter, section, grouping, sorting change, count, attention queue, new state, or new rule; **list order unchanged** (D126)
- [x] Status/urgency mappings are **exhaustive over the contract enum**, so a new contract value fails the build rather than rendering unlabelled
- [x] `due_soon`/`overdue` presented as **due-date facts**, never as reminder automation (D089, D103, D126)
- [x] Note-bound wording states what **was shown** and does not claim more notes exist; no truncation metadata added (D126)
- [x] Long titles, notes, summary points, emails, and identifiers wrap — proven by asserting **zero horizontal document overflow**, not by screenshot
- [x] `packages/ui` contains **no `.ts`/`.tsx`/`.js` file** and no React component; token values pinned equal to their pre-refactor literals (D124)
- [x] No `server-only` module, Prisma client, or observability import reached a client component or the client bundle
- [x] Task detail is server-rendered and A7 **handoff behaviour is unaffected** by removing `'use client'`
- [x] No P1.4 audit script or e2e tooling leaked into the production bundle
- [x] Production validation passed on commit `a38c857` / deployment `dpl_F5zjNcc4zwiwbr25CSdMGA3zDy8c` ([P1_4_EVIDENCE.md](P1_4_EVIDENCE.md) §13)

### P1 closure (P1.5; D112, D114, D119)

- [x] Application boundaries complete — global error fallback, segment error coverage, styled not-found, and the `/c/{token}` loading boundary
- [x] Unauthenticated Owner routes return a true **307** with the deep link preserved and **no** Owner chrome painted first (resolves OPEN #23)
- [x] Recipient presentation corrected — no title/summary duplication, deterministic organization-timezone timestamps, canonical `--aicaa-*` tokens
- [x] Recipient confirmation dialogs have keyboard, focus-containment, Escape, focus-restoration, and status-announcement behaviour (D119)
- [x] Automated accessibility gate met — **28 local scans, 0 serious, 0 critical**, no rule disabled; production scans 0 findings at every impact level (D119)
- [x] Production diagnostics show **exactly one** `owner_authentication` span per Owner document request and **zero** on capability routes; no raw `/c/{token}` path in any application diagnostic (D114, D119)
- [x] Production validation passed on commit `8588c5d` / deployment `dpl_7vmnL71Lck7JLeftgsJkYVJ4uw82` ([P1_5_EVIDENCE.md](P1_5_EVIDENCE.md))
- [x] **Evidence limitation recorded, not hidden** — the valid Recipient capability workflow is unvalidated in production because no safe synthetic-capability path exists; classified as an intentional production-safety limitation, **not** a defect ([P1_5_EVIDENCE.md](P1_5_EVIDENCE.md) §6)
- [x] **Handoff-confirmation critical journey covered at browser level** in the separate e2e job — identification, cancellation, Escape, confirmed submission, truthful failure, and duplicate-submission prevention; Gmail **delivery** deliberately still not browser-tested (D119) ([P1_5_EVIDENCE.md](P1_5_EVIDENCE.md) §11)
- [x] **Full `pnpm verify` green** — all twelve stages ran unmodified with local JDK 17, `contracts:check-drift` clean, confirming no contract or generated-client change (D119) ([P1_5_EVIDENCE.md](P1_5_EVIDENCE.md) §12)
- [x] **All 18 P1 acceptance criteria met** — the two that were unchecked at the first closeout attempt were closed on their merits, not reworded ([MILESTONES.md](MILESTONES.md))

## Documentation

- [ ] Docs updated **before** or as part of completion (Engineering Rule #1)
- [ ] [GLOSSARY.md](GLOSSARY.md) terms used consistently
- [ ] [WORKFLOWS.md](WORKFLOWS.md) updated if user-visible flow changed
- [ ] [DOCUMENTATION_INDEX.md](DOCUMENTATION_INDEX.md) still accurate if files added
- [ ] No contradiction with [PROJECT_CONSTITUTION.md](PROJECT_CONSTITUTION.md)
- [ ] README status/hierarchy still accurate

## AI behaviour

- [ ] No invented facts, deadlines, contacts, commitments, properties, money, follow-up dates, or due dates as facts ([AI_CONSTITUTION.md](AI_CONSTITUTION.md))
- [ ] Facts / inference / missing / low-confidence distinguished in outputs
- [ ] Recommendations include rationale and confidence where applicable
- [ ] No silent advance of the learning ladder
- [ ] Task creation, assignment email/forward, and any due date that drives reminders still require an explicit Owner act in v1 (D102)
- [ ] Durable learning does not store raw message bodies
- [ ] Invalid model output quarantined rather than guessed

## Security

- [ ] Server-side Owner session checks on Owner mutating APIs
- [ ] Capability token validation (scope, expiry, task binding) on Recipient mutating APIs
- [ ] GET on capability routes is non-mutating; POST requires explicit confirmation (D050)
- [ ] Capability possession treated as authorization, not verified identity (D051)
- [ ] Recipient audit events do not overstate identity (D052)
- [ ] No unauthenticated one-click mutations
- [ ] Capability links use expiring tokens; hashes stored server-side, not raw tokens
- [ ] Capability link rotation/invalidation applied on reassignment/re-forward (D086: revoke prior active capability; “no longer active” for revoked links)
- [ ] Gmail tokens remain server-side and encrypted at rest
- [ ] Secrets not committed; `.env` patterns respected
- [ ] Recipient identity not hard-coded in source; no env-default Recipient as production model (D087)
- [ ] Audit events recorded for approvals, forwards/handoffs, delivery attempts, reminder scheduling and attempts (D100, D109), Event Notifications, capability use, authz failures
- [ ] A7 handoff does not claim a Reminder Schedule is active; Follow-up Engine / Event Notification Engine remain A8 and unimplemented (D089, D102–D110)
- [ ] Knowingly incomplete Gmail-origin forwards are not sent (D088)

## Privacy

- [ ] Prompt-data minimization applied
- [ ] OTP / financial-alert exclusions respected where detected
- [ ] Contact and source exclusions enforced
- [ ] Notification-access consent and revocation handled honestly
- [ ] Forwarding privacy boundary disclosed (Gmail copies outside app deletion)
- [ ] A7 confirmation UI discloses retention boundary and does not over-promise reminder activation (D089, D094)

## Retention

- [ ] Seven-day excerpt rule not conflated with thirty-day completed visibility
- [ ] Raw audio deleted after successful transcription and validation
- [ ] Failed-transcription policy not silently invented if still Open
- [ ] Retention worker does not attempt to delete Gmail mailbox forwards
- [ ] Learning extraction does not keep raw bodies
- [ ] Failed deletion retry/alert behaviour considered

## Cost

- [ ] Heuristic / cheap filter before expensive AI where appropriate
- [ ] No unnecessary new paid service (free tiers first-class per D079; paid only for measurable benefit)
- [ ] FCM not added without documented justification
- [ ] Polling/AI frequency within acceptable cost/quota assumptions
- [ ] Security / AuthZ / audit not weakened to save cost (D079)

## Testing

- [ ] Unit tests for domain rules touched (state, retention dates, reminder occurrence computation and idempotency when A8 is in scope)
- [ ] Contract/schema validation for API or AI payloads touched
- [ ] Regression for approval gates (no email without D037 handoff approval)
- [ ] Forward idempotency tested if mailer touched (idempotency key + provider message id, D094)
- [ ] Partial/incomplete forward paths never report full success (D088)
- [ ] Android/notification fixtures updated if parsers changed
- [ ] Failure paths (reauth, missing SMS body, OpenAI down) considered
- [ ] Default full-`pnpm verify` gate satisfied unless a narrower scope was explicitly authorized (see Environment and verification)

## UX

- [ ] Android-first flows remain usable; Recipient capability path stays minimal
- [ ] Approval boundaries visible before consequential sends
- [ ] Manual and voice fallbacks available when capture fails
- [ ] Best-effort call/notification limitations not over-promised in UI copy
- [ ] Cognitive load: point-form, clear next action, no dashboard creep
- [ ] Interface states what is true: no optimistic success, ambiguous stays ambiguous, stale data labelled as of a stated time (D112)
- [ ] Copy does not claim a capability the milestone has not shipped — notably no implied reminder, schedule, or notification behaviour while A8 is unimplemented (D089)

## Technical debt

- [ ] New debt listed explicitly (comment + OPEN_QUESTIONS or milestone note)
- [ ] No “temporary” hardcoded Recipient emails or domains; no env-default Recipient as production model (D087)
- [ ] No skipped authorization “to unblock demo”
- [ ] Generated clients not hand-edited without regenerating from contract

## Documentation drift

- [ ] Implementation does not disagree with docs (Rule #2); if it did, docs were intentionally updated first
- [ ] DECISIONS statuses still accurate (Approved / Deferred / Open)
- [ ] OPEN_QUESTIONS not treated as resolved without recording answers
- [ ] Milestone checklist in MILESTONES still reflects reality after this work
