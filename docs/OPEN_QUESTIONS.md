# Open questions

Unresolved decisions only. Do not invent answers. When resolved, record an **Approved** entry in [DECISIONS.md](DECISIONS.md) and update dependent docs.

Workspace domain allowlist for Owner sign-in is environment-local configuration (`OWNER_WORKSPACE_DOMAIN`); it is not tracked as an open architecture question.

| #   | Question                                                                       | Blocks  | Notes                                                                                            |
| --- | ------------------------------------------------------------------------------ | ------- | ------------------------------------------------------------------------------------------------ |
| 1   | Exact primary Android dialer application (device target: Galaxy S24+ per D040) | A10–A11 | OEM dialer behaviour varies                                                                      |
| 3   | Capability-link domain / production hostname                                   | A15     | A7 uses `NEXT_PUBLIC_APP_URL` (D094). Custom domain still open for private deployment (OPEN #13) |
| 12  | Tombstone / audit retention after content purge                                | A13     |                                                                                                  |
| 13  | Custom domain required before private deployment?                              | A15     | Related to #3                                                                                    |

## Closed in A8.1 documentation Decision Lock

| Topic                                         | Resolution                                                                                                                                                                                                                                                                                                                 |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Due-date-driven follow-up vs the constitution | **D102** — narrow constitutional exception authorized: an explicitly selected Task due date may drive deterministic follow-through on delegated communication work. General-purpose reminders, arbitrary recurrence, escalation ladders, Owner CC ladders, silent AI scheduling, and calendar management remain prohibited |
| Due date as scheduling input                  | **D102** — authoritative deterministic scheduling input when Owner-selected. **Supersedes D098**                                                                                                                                                                                                                           |
| Reminder delivery time                        | **D103** — fixed **09:00 organization-local**; no due time and no reminder-time picker; local-calendar arithmetic only, never fixed 24-hour millisecond offsets                                                                                                                                                            |
| Organization timezone authority               | **D103** — preserves D034 (`America/Vancouver`) as the organization timezone and sole scheduling authority                                                                                                                                                                                                                 |
| Schedule scope                                | **D104** — **Task-scoped**, surviving reassignment. **Amends / supersedes in part D096** (was Assignment-scoped)                                                                                                                                                                                                           |
| Advance reminder when the window has passed   | **D105** — recorded as **skipped** with `advance_window_elapsed`; no immediate or retroactive send; no backlog for historical due dates                                                                                                                                                                                    |
| Overdue reminder ceiling                      | **D106** — **14 successful overdue deliveries per schedule generation**, then stop, `requiresOwnerAttention`, and Owner notification; no automatic restart                                                                                                                                                                 |
| Due-date-change count reset                   | **D104** — only a **material** due-date change opens a new generation and resets the per-generation count; saving the same date does neither                                                                                                                                                                               |
| Pause mechanism                               | **D107** — Waiting remains the **only** pause mechanism. **Preserves D097 and D101**; no separate pause control                                                                                                                                                                                                            |
| Reminder attribution                          | **D107** — automated sends use a **`system`** actor; Owner scheduling changes use the **`owner`** actor                                                                                                                                                                                                                    |
| Reopening completed Tasks                     | **D107** — `completed` and `dismissed` remain terminal; **no** reopening behaviour is introduced                                                                                                                                                                                                                           |
| Production reminder enablement                | **D108** — blocked until **both** the Event Notification Engine and the minimum Owner schedule-status UI are operational; also an A8 closure gate                                                                                                                                                                          |
| Reminder persistence shape                    | **D109** — two durable concepts (schedule; delivery attempts) with database-enforced idempotency; planned-occurrence table **deferred**; no schema approved as implemented                                                                                                                                                 |
| Existing historical due-date data             | **D109** — must **not** auto-activate reminders; explicit Owner opt-in or re-save required after implementation                                                                                                                                                                                                            |
| Owner-created additional reminders            | **D110** — **deferred** to a separately authorized future slice; no presets, routes, UI, rules, or schema in the first A8 slice                                                                                                                                                                                            |

## Closed in A8.0 documentation Decision Lock

Retained for history. Where A8.1 supersedes an A8.0 resolution, follow the A8.1 row above.

| Topic                                    | Resolution                                                                                                                                                                                                            |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A8 due-date / overdue / escalation model | **Retired** — Follow-up Engine + Event Notification Engine (D095–D101). **Superseded in part by D102/D106:** due-date-anchored overdue reminders are restored; escalation ladders and Owner CC ladders remain retired |
| Snooze as Follow-up control              | **D101** supersedes D060; Waiting is suspension; prefer snooze endpoint **removal** at A8 contract alignment (not deprecated no-op); OpenAPI unchanged. **Preserved by D107**                                         |
| `dueAt` as scheduling input              | **D098** — informational only. **Superseded by D102**                                                                                                                                                                 |
| Phase 1 waiting restart                  | **D097** — fresh Phase 1 from resume using the same Owner-confirmed preset (no elapsed-time math). **Phase mechanics superseded by D103/D107**; resume now computes the next future 09:00 local occurrence            |
| A8 Owner Event Notification channel      | **D099** — email via Owner’s connected Gmail; FCM/push remains D017 / A9. **Still operative**; event list extended by D106/D108                                                                                       |
| `FollowUpProposal` wire rename           | **Retain** during A8; docs term Next-action Suggestion; temporary contract naming debt                                                                                                                                |

## Closed in A7 decisions

| #   | Former question                                                           | Resolution                                                                          |
| --- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 7   | Default Recipient email: secure env vs Owner-managed contacts             | **D087** — Owner-managed Recipient records only; minimal Recipient management in A7 |
| 9   | Partial Gmail attachment forward failure: preserve other attachments? UX? | **D088** — do not send knowingly incomplete forwards; retryable failure to Owner    |
| 21  | Does re-forward invalidate earlier capability links?                      | **D086** — yes; revoke prior active capability; issue new; preserve history         |

## Closed in A5 decisions

| #   | Former question                    | Resolution                               |
| --- | ---------------------------------- | ---------------------------------------- |
| 4   | Gmail polling interval ≤5 minutes? | **D065** — every five minutes            |
| 5   | Keep Gmail Pub/Sub deferred?       | **D066** — deferred for A5; polling only |

Closed former questions map to decisions in [DECISIONS.md](DECISIONS.md) (including D007, D037–D043, D040–D041, D048–D110). Do not reopen without a new Decision.
