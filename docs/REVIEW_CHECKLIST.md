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
- [ ] Reminder/retention behaviour remains deterministic (not model-driven sends)
- [ ] Scheduled work (Gmail Application Polling Engine, reminders, retention) remains app-owned engines invoked by External Schedulers—not business logic inside the scheduler platform

## Documentation

- [ ] Docs updated **before** or as part of completion (Engineering Rule #1)
- [ ] [GLOSSARY.md](GLOSSARY.md) terms used consistently
- [ ] [WORKFLOWS.md](WORKFLOWS.md) updated if user-visible flow changed
- [ ] [DOCUMENTATION_INDEX.md](DOCUMENTATION_INDEX.md) still accurate if files added
- [ ] No contradiction with [PROJECT_CONSTITUTION.md](PROJECT_CONSTITUTION.md)
- [ ] README status/hierarchy still accurate

## AI behaviour

- [ ] No invented facts, deadlines, contacts, commitments, properties, money, or follow-up dates ([AI_CONSTITUTION.md](AI_CONSTITUTION.md))
- [ ] Facts / inference / missing / low-confidence distinguished in outputs
- [ ] Recommendations include rationale and confidence where applicable
- [ ] No silent advance of the learning ladder
- [ ] Task creation and assignment email/forward still require Owner approval in v1
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
- [ ] Audit events recorded for approvals, forwards/handoffs, delivery attempts, reminders, capability use, authz failures
- [ ] A7 handoff does not claim reminders are scheduled; reminder engine remains A8 (D089)
- [ ] Knowingly incomplete Gmail-origin forwards are not sent (D088)

## Privacy

- [ ] Prompt-data minimization applied
- [ ] OTP / financial-alert exclusions respected where detected
- [ ] Contact and source exclusions enforced
- [ ] Notification-access consent and revocation handled honestly
- [ ] Forwarding privacy boundary disclosed (Gmail copies outside app deletion)
- [ ] A7 confirmation UI discloses retention boundary and does not over-promise reminder scheduling (D089, D094)

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

- [ ] Unit tests for domain rules touched (state, retention dates, reminder idempotency)
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
