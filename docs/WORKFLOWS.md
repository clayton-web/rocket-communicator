# Workflows

Point-form workflows for version one. Every consequential business action that creates tasks, assignments, forwards, or follow-up assignments requires primary-user approval unless noted as administrator-authorized task mutation on an already assigned task.

---

## 1. Gmail email to task suggestion

- **Trigger:** New message detected in the connected primary inbox (poll or later watch).
- **Steps:**
  1. Record minimized `CommunicationEvent` (ids, sender, subject, truncated body excerpt).
  2. Heuristic prefilter (newsletter, bulk, OTP-like, financial-alert patterns).
  3. Cheap AI relevance filter if needed.
  4. If relevant: structured extraction → `TaskSuggestion` with typed summary points.
  5. Notify primary user on Android (when available).
- **Approval boundaries:** No task created; no email sent.
- **Stored information:** Event excerpt, suggestion, AI metadata (model, prompt version, confidence).
- **Side effects:** Possibly skip AI for obvious junk; link to Gmail thread ids.
- **Failure behaviour:** On API/AI failure, retry with backoff; quarantine invalid JSON; leave event for manual/voice fallback.
- **Audit events:** `communication_event.created`, `suggestion.created`, `ai_job.*`, filter decisions.

---

## 2. Approved email assignment and forwarding

- **Trigger:** Primary user approves assigning a **Gmail-origin** task to the administrator.
- **Steps:**
  1. Confirm assignee is an authorized Workspace administrator user record.
  2. Create/activate assignment; require explicit forward+send confirmation if not bundled in the same approve-assign action.
  3. Compose forward via Gmail API: AI point-form summary and action metadata **above** original; include original sender, subject, body, **all attachments**.
  4. Include secure authenticated task link.
  5. Send once; store Gmail id of forwarded message; mark forward complete (idempotent).
- **Approval boundaries:** Primary must approve assignment **and** the forwarding action (may be one confirmation UX). No separate attachment approval. No hard-coded admin address.
- **Stored information:** Assignment, approval actor/time, forwarded message id, summary snapshot used in header.
- **Side effects:** Copy appears in administrator Gmail (and likely primary Sent); app retention does not delete that mailbox copy.
- **Failure behaviour:** If send/forward fails, task may remain approved/assigned pending retry; do not claim success; handle partial attachment failure per open question policy when decided.
- **Audit events:** `assignment.approved`, `gmail.forward.requested`, `gmail.forward.succeeded|failed`, `email.sent`.

---

## 3. Google Messages notification to task suggestion

- **Trigger:** NotificationListenerService receives a Google Messages notification with usable content.
- **Steps:**
  1. Dedupe by hash; upload event via API.
  2. Respect contact/source exclusions.
  3. Relevance + extraction → suggestion (subject to open question on automatic AI before approval).
  4. Show on Android for review.
- **Approval boundaries:** Suggestion only until primary approves task creation.
- **Stored information:** Minimized notification excerpt, package, timestamp, suggestion.
- **Side effects:** None outbound.
- **Failure behaviour:** If body missing, create incomplete event and prompt manual/voice; if listener revoked, surface health warning.
- **Audit events:** `sms_notification.captured|incomplete`, `suggestion.created`.

---

## 4. Missed call to prompted voice note

- **Trigger:** Missed-call notification detected (best-effort).
- **Steps:**
  1. Always prompt primary user to record outcome or create task.
  2. Optional voice capture → transcription → structured draft suggestion/task fields.
  3. User confirms before task creation / assignment email.
- **Approval boundaries:** Prompt is automatic; task/assignment creation is not.
- **Stored information:** Call metadata available from notification; voice transcript per retention rules.
- **Side effects:** Audio deleted after successful transcription/validation.
- **Failure behaviour:** If detection fails, user can still manual/voice create; if transcription fails, see open question on audio retention.
- **Audit events:** `missed_call.prompted`, `voice.*`, `suggestion.created` or `task.created` after confirm.

---

## 5. Known-contact completed call to optional prompt

- **Trigger:** Completed-call notification for a known, selected, or follow-up-tracked number.
- **Steps:**
  1. Evaluate contact track list.
  2. If matched, optional prompt for outcome note.
  3. Unknown completed calls: **do not** always prompt.
- **Approval boundaries:** Same as other task creation paths.
- **Stored information:** Contact track flags; optional outcome.
- **Side effects:** None unless user proceeds.
- **Failure behaviour:** Detection not guaranteed—treat as best-effort; manual fallback always available.
- **Audit events:** `completed_call.prompted|skipped`, outcome events.

---

## 6. Manual voice-created task

- **Trigger:** User starts voice task creation in the app.
- **Steps:** Record → upload → transcribe → structure → show draft → user confirms.
- **Approval boundaries:** Confirmation required before active task; assignment email still needs approval if admin assigned.
- **Stored information:** Transcript, structured fields, task after confirm.
- **Side effects:** Audio deleted after success path.
- **Failure behaviour:** Retry transcription; allow typed edit of draft.
- **Audit events:** `voice.uploaded`, `voice.transcribed`, `task.created`.

---

## 7. Task approval

- **Trigger:** Primary approves a `TaskSuggestion` (possibly after edits).
- **Steps:** Create `Task` from suggestion; copy structured points; schedule retention clocks as applicable; optional self-assignment without admin email.
- **Approval boundaries:** This step creates the task; admin email/forward is a separate (or clearly confirmed) approval.
- **Stored information:** Task, link to source event, corrections as learning signals.
- **Side effects:** Suggestion marked approved; may merge path instead (workflow 12).
- **Failure behaviour:** Transactional create; on failure leave suggestion pending.
- **Audit events:** `suggestion.approved`, `task.created`.

---

## 8. Administrator task completion

- **Trigger:** Administrator opens authenticated task link and completes (preset, typed note, or later voice on web if supported).
- **Steps:** Validate admin role and assignment; record outcome; set completed; stop reminders; set excerpt purge and visibility windows.
- **Approval boundaries:** Admin may complete assigned tasks; cannot approve suggestions or connect Gmail; cannot send new admin assignment emails as primary.
- **Stored information:** Outcome, completion timestamp, actor.
- **Side effects:** Reminder stop; retention timers.
- **Failure behaviour:** Auth failure → deny; conflict → surface newer state.
- **Audit events:** `task.completed`, `outcome.recorded`, `reminder.cancelled`.

---

## 9. Waiting and snooze

- **Trigger:** Primary or authorized admin sets waiting or snooze.
- **Steps:** Waiting stores `waiting_until` and pauses reminders; snooze recalculates `next_follow_up_at` / reminder time without requiring a distinct status if derived UI suffices.
- **Approval boundaries:** Allowed on active tasks per role permissions.
- **Stored information:** Waiting/snooze timestamps, reason note optional.
- **Side effects:** Reminder schedule update.
- **Failure behaviour:** Invalid dates rejected; audit attempted change.
- **Audit events:** `task.waiting`, `task.snoozed`, `reminder.rescheduled`.

---

## 10. Reminder and escalation

- **Trigger:** Scheduler finds due reminder candidates.
- **Steps:**
  1. Select non-terminal, non-waiting tasks with `next_reminder_at <= now`.
  2. Insert idempotent attempt row.
  3. First overdue stage → administrator only.
  4. Later overdue stages may CC primary (configurable threshold).
  5. Record delivery result; advance stage.
- **Approval boundaries:** No AI send authority; policy tables control timing.
- **Stored information:** `ReminderAttempt` with stage, recipients, provider ids, status.
- **Side effects:** Emails via Gmail API.
- **Failure behaviour:** Retry with backoff; do not double-send on cron overlap.
- **Audit events:** `reminder.attempted|succeeded|failed`, `reminder.escalated`.

---

## 11. Voice task completion with follow-up creation

- **Trigger:** User dictates a multi-intent completion (e.g., complete, record $1,500 approval, assign contractor follow-up to administrator for tomorrow).
- **Steps:**
  1. Transcribe and structure into: complete original, outcome fields, proposed follow-up task, proposed assignee/due.
  2. Show confirmation UI.
  3. Apply completion immediately if confirmed.
  4. Create follow-up as suggestion or pending task per UX; **hold assignment email** until primary approves admin assignment.
- **Approval boundaries:** Consequential follow-up assignment email requires primary approval.
- **Stored information:** Outcome, amounts as structured facts, follow-up proposal, approvals.
- **Side effects:** Audio deleted after success; possible later forward/assignment email.
- **Failure behaviour:** Partial apply only for confirmed segments; keep draft on AI failure.
- **Audit events:** `voice.structured`, `task.completed`, `follow_up.proposed`, `assignment.approved` (later).

---

## 12. Duplicate suggestion merge

- **Trigger:** Primary chooses merge into an existing task.
- **Steps:** Link source event to existing task; mark suggestion merged; optionally append summary points; learning signal for duplicate pattern.
- **Approval boundaries:** Primary only.
- **Stored information:** Merge link, retained single active task.
- **Side effects:** No extra assignment email by default.
- **Failure behaviour:** Abort if target task terminal/purged.
- **Audit events:** `suggestion.merged`, `learning_signal.recorded`.

---

## 13. Dismissal

- **Trigger:** Primary dismisses a suggestion (or rarely dismisses a task).
- **Steps:** Mark dismissed; schedule excerpt purge (+7 days); record reason/correction if provided; no assignment email.
- **Approval boundaries:** Primary.
- **Stored information:** Dismissal metadata; learning signal.
- **Side effects:** Stop further AI nagging for that event (idempotent).
- **Failure behaviour:** Safe retry; already-dismissed is no-op.
- **Audit events:** `suggestion.dismissed` / `task.dismissed`.

---

## 14. Retention cleanup

- **Trigger:** Retention scheduler.
- **Steps:**
  1. Delete/scrub communication excerpts past purge time (7 days after complete/dismiss).
  2. After 30 days completed visibility, scrub task content; keep minimal audit tombstones.
  3. Ensure raw audio already deleted post-success; enforce any failed-transcription policy when decided.
  4. Extract durable learning **before** content scrub where required.
  5. **Do not** delete Gmail mailbox forwards.
- **Approval boundaries:** Policy-driven; user-initiated delete is immediate content wipe.
- **Stored information:** Retention run logs; tombstones.
- **Side effects:** Irreversible content deletion in app DB/storage.
- **Failure behaviour:** Retry failed deletes; alert on backlog; never silently skip forever.
- **Audit events:** `retention.run`, `retention.purged`, `retention.failed`.

---

## 15. Workflow learning and rule proposal

- **Trigger:** Accumulated corrections/patterns or explicit spoken preference.
- **Steps:** Record anonymized `LearningSignal`; optionally create `WorkflowRule` in **proposed** state; present “create a rule?” to primary; apply only on approval.
- **Approval boundaries:** No silent rule activation in v1.
- **Stored information:** Signals without raw bodies; proposed/approved rules.
- **Side effects:** Future suggestions may bias from approved rules only.
- **Failure behaviour:** Drop malformed signals; do not auto-approve.
- **Audit events:** `learning_signal.recorded`, `workflow_rule.proposed|approved|rejected`.
