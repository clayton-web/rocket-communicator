# Workflows

Point-form workflows for version one. Terms: [GLOSSARY.md](GLOSSARY.md). AI constraints: [AI_CONSTITUTION.md](AI_CONSTITUTION.md).

Every consequential business action that creates Tasks, Assignments, forwards, or Follow-up assignments requires Primary User approval unless noted as Administrator-authorized task mutation on an already assigned task.

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

- **Trigger:** Primary User confirms administrator assignment for a **Gmail-origin** item (from a Task Suggestion and/or Task).
- **Steps:**
  1. Confirm assignee is an authorized Workspace administrator user record.
  2. Present **one** confirmation dialog that discloses the bundled business action (D037):
     - Create task (activate Task from suggestion if needed)
     - Forward original email
     - Forward attachments
     - Schedule reminders
  3. On single confirmation: create/activate Task and Assignment; compose forward via Gmail API with AI point-form summary **above** original; forward the **full email context/thread available to the application** with original sender, subject, body, and **all attachments** without intentional redaction (D042); include secure authenticated task link; schedule reminders per policy.
  4. Send forward once; store Gmail id of forwarded message; mark forward complete (idempotent).
- **Approval boundaries:** Assignment approval and Gmail forwarding are **one** business action—**one confirmation only**. No separate attachment approval. No hard-coded admin address.
- **Stored information:** Assignment, single approval actor/time, forwarded message id, summary snapshot used in header.
- **Side effects:** Copy appears in administrator Gmail (and likely primary Sent); reminders armed; app retention does not delete that mailbox copy.
- **Failure behaviour:** If send/forward fails, task may remain approved/assigned pending retry; do not claim success; partial forward failure must never be reported as complete success (D042); handle partial attachment failure per open question policy when decided.
- **Audit events:** `assignment.approved`, `gmail.forward.requested`, `gmail.forward.succeeded|failed`, `email.sent`, `reminder.scheduled`.

---

## 3. Google Messages notification to task suggestion

- **Trigger:** NotificationListenerService receives a Google Messages notification with usable content.
- **Steps:**
  1. Dedupe by hash; upload event via API when ingestion is implemented.
  2. Respect contact/source exclusions.
  3. After Primary enables Google Messages as an approved source (D043), notification content may be sent to the backend for AI analysis.
  4. AI analysis may produce a `TaskSuggestion`; task creation still requires Primary approval.
  5. The application may prepare an SMS response draft for Primary review and open it in Google Messages for user send (no direct SMS send in v1).
  6. Show suggestion on Android for review.
- **Approval boundaries:** Suggestion only until primary approves task creation.
- **Stored information:** Minimized notification excerpt, package, timestamp, suggestion.
- **Side effects:** None outbound.
- **Failure behaviour:** If body missing, create incomplete event and prompt manual/voice; if listener revoked, surface health warning.
- **Audit events:** `sms_notification.captured|incomplete`, `suggestion.created`.

---

## 4. Missed call to prompted voice note

- **Trigger:** Missed-call notification detected (best-effort).
- **Steps:**
  1. Always prompt primary user to record outcome or propose a task.
  2. Optional voice capture → transcription → structured **Task Suggestion** (or note proposal)—never a Task directly (D038).
  3. Primary approves the Task Suggestion (workflow 7) before a Task exists; administrator assignment uses workflow 2 / non-email assignment path as applicable.
- **Approval boundaries:** Prompt is automatic; voice produces proposals only; Task and assignment require Primary User approval.
- **Stored information:** Call metadata available from notification; voice transcript per retention rules; Task Suggestion.
- **Side effects:** Audio deleted after successful transcription/validation.
- **Failure behaviour:** If detection fails, user can still manual/voice propose; if transcription fails, see open question on audio retention.
- **Audit events:** `missed_call.prompted`, `voice.*`, `suggestion.created`.

---

## 5. Known Contact completed call to optional prompt

- **Trigger:** Completed-call notification for a Known Contact (on-device match, user-selected, and/or follow-up-tracked number).
- **Steps:**
  1. Evaluate Known Contact / contact track list.
  2. If matched, optional prompt for outcome note.
  3. Unknown completed calls: **do not** always prompt.
- **Approval boundaries:** Same as other task creation paths.
- **Stored information:** Contact track flags; optional outcome.
- **Side effects:** None unless user proceeds.
- **Failure behaviour:** Detection not guaranteed—treat as best-effort; manual fallback always available.
- **Audit events:** `completed_call.prompted|skipped`, outcome events.

---

## 6. Manual voice task proposal

- **Trigger:** Primary User starts voice task creation in the app.
- **Steps:** Record → upload → transcribe → structure → show proposed **Task Suggestion** → user may edit → remains a suggestion until workflow 7 approval.
- **Approval boundaries:** Voice never creates a Task directly (D038). Assignment email still requires the assignment confirmation (D037 for Gmail-origin admin assign).
- **Stored information:** Transcript, structured fields, Task Suggestion.
- **Side effects:** Audio deleted after success path.
- **Failure behaviour:** Retry transcription; allow typed edit of draft suggestion.
- **Audit events:** `voice.uploaded`, `voice.transcribed`, `suggestion.created`.

---

## 7. Task approval

- **Trigger:** Primary approves a `TaskSuggestion` (possibly after edits).
- **Steps:** Create `Task` from suggestion; copy structured points; schedule retention clocks as applicable; optional self-assignment without admin email.
- **Approval boundaries:** This step creates the task. If assigning to the administrator for a Gmail-origin item, use workflow 2’s **single** bundled confirmation (create task + forward + attachments + schedule reminders) rather than a second forward approval (D037). Non-email admin assignment still requires one assignment confirmation (no Gmail forward).
- **Stored information:** Task, link to source event, corrections as learning signals.
- **Side effects:** Suggestion marked approved; may merge path instead (workflow 12).
- **Failure behaviour:** Transactional create; on failure leave suggestion pending.
- **Audit events:** `suggestion.approved`, `task.created`.

---

## 8. Administrator task actions

- **Trigger:** Administrator opens authenticated task link and acts on an assigned task.
- **Allowed (D039):** complete; mark waiting; add notes; return task to primary; request clarification.
- **Forbidden (D039):** create standalone tasks; approve AI learning; change workflow rules; change reminder policies; create automations.
- **Steps (complete example):** Validate admin role and assignment; record outcome; set completed; stop reminders; set excerpt purge and visibility windows.
- **Steps (return / clarification):** Update task toward primary ownership or attach a clarification request; do not create a new Task. If the administrator needs new work done, submit a **work request** that becomes a **Task Suggestion** for Primary User approval.
- **Approval boundaries:** Admin may mutate assigned tasks only within the allowed set; cannot approve suggestions, connect Gmail, or send assignment emails as primary.
- **Stored information:** Outcome or note/clarification/return metadata; actor; timestamps.
- **Side effects:** Reminder stop or reschedule as appropriate; retention timers on complete.
- **Failure behaviour:** Auth failure → deny; conflict → surface newer state.
- **Audit events:** `task.completed`, `outcome.recorded`, `task.waiting`, `task.returned_to_primary`, `clarification.requested`, `reminder.cancelled`, `suggestion.created` (from admin work request).

---

## 9. Waiting and snooze

- **Trigger:** Primary User sets waiting or snooze; Administrator may set **waiting** only (D039).
- **Steps:** Waiting stores `waiting_until` and pauses reminders; snooze (Primary only) recalculates `next_follow_up_at` / reminder time without necessarily introducing a separate persisted status.
- **Approval boundaries:** Per role permissions (D039).
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
  1. Transcribe and structure into: complete original, outcome fields, proposed follow-up as a **Task Suggestion**, proposed assignee/due (D038).
  2. Show confirmation UI for the structured proposal.
  3. On confirm: apply completion to the **existing** Task immediately; create the follow-up only as a **Task Suggestion** (never a Task directly from voice).
  4. Hold assignment email / Gmail forward until Primary User confirms the administrator assignment via the single bundled confirmation when applicable (D037).
- **Approval boundaries:** Voice never creates a Task directly. Follow-up becomes a Task only after suggestion approval. Consequential administrator assignment uses one confirmation (workflow 2).
- **Stored information:** Outcome, amounts as structured facts, follow-up Task Suggestion, later approvals.
- **Side effects:** Audio deleted after success; possible later forward/assignment email after Primary approval.
- **Failure behaviour:** Partial apply only for confirmed segments; keep draft suggestion on AI failure.
- **Audit events:** `voice.structured`, `task.completed`, `suggestion.created` (follow-up), `assignment.approved` (later).

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
