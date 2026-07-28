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
- [ ] **No retroactive sends:** an elapsed advance occurrence is recorded as skipped with `advance_window_elapsed`, decided once at establishment and never reclassified later (D105)
- [ ] **No backlog:** a past due date, a resume from Waiting, and a reassignment each schedule only the next future occurrence (D105, D107)
- [ ] Reassignment preserves the **Task-scoped** schedule and sends no backlog (D104)
- [ ] Overdue ceiling stops at **14 successful overdue deliveries per generation**; failures, skips, claims, and advance reminders excluded from the count (D106)
- [ ] Material due-date change opens a new generation, preserves all prior history, resets only the per-generation count, and discloses the restart; a same-value save does neither (D104)
- [ ] Duplicate or overlapping scheduler invocations produce **at most one delivery per local calendar day**
- [ ] Completion, dismissal, and due-date removal stop future sends; reminder history is superseded, never deleted or rewritten (D107)
- [ ] Existing historical due-date data did **not** auto-activate reminders; Owner opt-in or re-save is required (D109)
- [ ] **No production enablement** before the Event Notification Engine **and** the minimum Owner schedule-status UI are operational (D108)
- [ ] Deferred scope absent: no preset reminder choices, Owner-created additional reminders, custom-reminder routes or UI, recurrence editor, reminder-time picker, Recipient reminder preferences, or AI-controlled scheduling (D110)
- [ ] No regression to A7 assignment delivery on either path

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

## UX

- [ ] Android-first flows remain usable; Recipient capability path stays minimal
- [ ] Approval boundaries visible before consequential sends
- [ ] Manual and voice fallbacks available when capture fails
- [ ] Best-effort call/notification limitations not over-promised in UI copy
- [ ] Cognitive load: point-form, clear next action, no dashboard creep

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
