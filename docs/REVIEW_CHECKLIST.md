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
- [ ] No new vendor or datastore without a decision entry
- [ ] Neon still not introduced alongside Supabase in v1
- [ ] Android still does not write core business records directly to Supabase tables
- [ ] Prisma used only through authorized server APIs
- [ ] Canonical contract approach preserved (OpenAPI source of truth → generated TS/Kotlin clients; JSON Schema only if derived)
- [ ] Reminder/retention behaviour remains deterministic (not model-driven sends)

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
- [ ] Task creation and assignment email/forward still require primary approval in v1
- [ ] Durable learning does not store raw message bodies
- [ ] Invalid model output quarantined rather than guessed

## Security

- [ ] Server-side organization and role checks on mutating APIs
- [ ] No unauthenticated one-click mutations
- [ ] Secure task links require Workspace authentication
- [ ] Gmail tokens remain server-side and encrypted at rest
- [ ] Secrets not committed; `.env` patterns respected
- [ ] Administrator identity not hard-coded in source
- [ ] Audit events recorded for approvals, forwards, reminders, authz failures

## Privacy

- [ ] Prompt-data minimization applied
- [ ] OTP / financial-alert exclusions respected where detected
- [ ] Contact and source exclusions enforced
- [ ] Notification-access consent and revocation handled honestly
- [ ] Forwarding privacy boundary disclosed (Gmail copies outside app deletion)

## Retention

- [ ] Seven-day excerpt rule not conflated with thirty-day completed visibility
- [ ] Raw audio deleted after successful transcription and validation
- [ ] Failed-transcription policy not silently invented if still Open
- [ ] Retention worker does not attempt to delete Gmail mailbox forwards
- [ ] Learning extraction does not keep raw bodies
- [ ] Failed deletion retry/alert behaviour considered

## Cost

- [ ] Heuristic / cheap filter before expensive AI where appropriate
- [ ] No unnecessary new paid service
- [ ] FCM not added without documented justification
- [ ] Polling/AI frequency within acceptable cost/quota assumptions

## Testing

- [ ] Unit tests for domain rules touched (state, retention dates, reminder idempotency)
- [ ] Contract/schema validation for API or AI payloads touched
- [ ] Regression for approval gates (no email without approval)
- [ ] Forward idempotency tested if mailer touched
- [ ] Android/notification fixtures updated if parsers changed
- [ ] Failure paths (reauth, missing SMS body, OpenAI down) considered

## UX

- [ ] Android-first flows remain usable; admin path stays minimal
- [ ] Approval boundaries visible before consequential sends
- [ ] Manual and voice fallbacks available when capture fails
- [ ] Best-effort call/notification limitations not over-promised in UI copy
- [ ] Cognitive load: point-form, clear next action, no dashboard creep

## Technical debt

- [ ] New debt listed explicitly (comment + OPEN_QUESTIONS or milestone note)
- [ ] No “temporary” hardcoded admin emails or domains
- [ ] No skipped authorization “to unblock demo”
- [ ] Generated clients not hand-edited without regenerating from contract

## Documentation drift

- [ ] Implementation does not disagree with docs (Rule #2); if it did, docs were intentionally updated first
- [ ] DECISIONS statuses still accurate (Approved / Deferred / Open)
- [ ] OPEN_QUESTIONS not treated as resolved without recording answers
- [ ] Milestone checklist in MILESTONES still reflects reality after this work
