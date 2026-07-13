# Product scope

## Product objective

Build a private, Android-first AI Communication Action Assistant that:

- captures ongoing communications from the primary user’s Android phone and one Gmail inbox
- identifies communications that may require action
- generates high-quality point-form task suggestions
- requires primary-user approval before creating tasks
- requires primary-user approval before assigning work to the administrator
- emails approved assignments to the administrator
- monitors assignments and sends reasonable follow-up reminders
- allows tasks to be completed with typed or spoken outcome notes
- learns durable workflow preferences without retaining a permanent communication archive

The product’s main purpose is to answer: what needs action, what matters, who owns it, when to follow up, whether it was completed, how it was completed, and whether completion created another action.

## User roles

### Primary user

- Uses the Android application as the main interface.
- Reviews AI-generated task suggestions.
- Approves, edits, dismisses, or merges suggestions before tasks exist.
- Approves administrator assignments before assignment emails (including Gmail forwards) are sent.
- Records voice notes and completion outcomes.
- Receives escalations when administrator tasks remain overdue (after the configured overdue threshold).

### Administrator

- Uses an email account in the **same** Google Workspace organization.
- Receives task assignments through email.
- Opens tasks through secure authenticated task links.
- Uses a minimal responsive web task view (not a full dashboard in version one).
- Can mark tasks complete, waiting, or reassign where authorized.
- Is selected from an authorized Workspace user record (not hard-coded in source).

Version one designs for **one** administrator while preserving schema expansion for additional administrators later.

## Android-first rationale

The Android application is part of the MVP and is the primary interface because:

- communication capture (notifications, call prompts, voice) happens on the device
- suggestion review and approval should be fast and interrupt-driven
- voice throughout the workflow is a first-class input mode
- the administrator path can remain email-plus-minimal-web without requiring a full product surface

A web interface may exist for authentication, APIs, and the minimal administrator task view, but it does not replace the Android app for the primary user.

## Communication sources

### Included in version one

| Source | Notes |
|--------|--------|
| One primary Google Workspace Gmail inbox | Gmail API; schema may allow future accounts |
| Google Messages notifications | Best-effort via NotificationListenerService |
| Missed-call notifications | Expected prompts; still device-dependent |
| Post-call prompts for known or selected contacts | Best-effort; not universal |
| Manually dictated tasks | Always available |
| Spoken task notes and completion outcomes | Always available |

### Excluded from version one

- WhatsApp, Facebook Messenger, Signal
- Call recording; live-call transcription
- Historical SMS import
- Replacing Google Messages or the default Phone application
- Automatic client-facing replies
- Multiple Gmail accounts
- Google Play Store distribution
- Rocket PM integration

## Task suggestion and approval model

AI-detected actions become **task suggestions**, not tasks.

The primary user may:

- approve
- edit
- dismiss
- merge with an existing task
- change assignee, due date, and follow-up timing
- provide correction feedback

**Version one must not auto-create tasks**, even for “trusted” categories. Future automation may propose rules; applying them requires explicit approval.

## Administrator assignment model

- AI may recommend the administrator as assignee.
- The primary user must approve the assignment.
- Assignment email is sent **only after** that approval.
- The administrator recipient comes from an authorized Workspace user record.
- Secure authenticated task links are required; unauthenticated one-click mutations are excluded.
- Sensitive details may remain behind the authenticated link when appropriate for non-forward assignment emails.

## Email forwarding requirements (Gmail-origin assignments)

When an approved task originates from Gmail and is assigned to the administrator:

1. The system forwards the **original email** through the primary user’s connected Gmail account.
2. An AI-generated point-form task summary is placed **above** the forwarded email.
3. The forward includes requested action, due date, priority, secure authenticated task link, original sender and subject, original body, and **all original attachments**.
4. There is **no** separate attachment-approval step.
5. The entire assignment and forwarding action still requires primary-user approval.
6. Duplicate forwarding must be prevented.
7. The system records who approved forwarding and when, plus the Gmail identifier of the forwarded message.

For **non-email** tasks, send a normal assignment email with the structured summary and secure task link (no Gmail forward).

**Retention consequence:** application copies may be deleted under app policy, but the forwarded message and attachments remain in the administrator’s Gmail mailbox under Workspace retention. See [DATA_RETENTION.md](DATA_RETENTION.md).

## Voice requirements

Voice input should support:

- creating a task
- adding a note
- recording a call outcome
- completing a task
- creating a follow-up task
- setting a due date
- correcting a summary
- teaching a workflow preference

Multi-intent utterances (for example, complete + capture amount + propose follow-up assignment) must produce a **structured proposal** that still waits for primary-user approval before sending an administrator assignment email.

Raw audio is deleted after successful transcription and validation. Failed-transcription retention is unresolved (see [OPEN_QUESTIONS.md](OPEN_QUESTIONS.md)).

## Summary-quality requirements

Summary quality is a primary product feature. Summaries are concise point-form and extract operational meaning—not mere shortening.

Where available, extract:

- contact; company or organization; property; transaction or file
- communication source
- what happened; request being made
- confirmed facts; financial amounts; dates and deadlines; commitments
- risks or sensitivities; missing information
- next action; suggested assignee; suggested priority; suggested due date; suggested follow-up timing

Clearly distinguish:

- confirmed facts
- inference
- missing information
- low-confidence interpretation

Structured schema output is required; unstructured prose is not the product contract.

## Reminder and escalation requirements

- Monitor assignments until completed, dismissed, or validly waiting.
- First overdue reminder → administrator only.
- After the first overdue reminder, later overdue reminders may copy the primary user.
- Escalation threshold is configurable.
- Completed tasks stop reminders; waiting pauses until waiting date; snooze recalculates timing.
- Prevent duplicate reminder emails; audit every attempt.
- AI may recommend timing; **deterministic rules** control actual sends.

## Learning goals

Version one records feedback and may **propose** workflow rules. It must not silently change business rules.

Learn from edits, reassignments, dismissals, merges, completion outcomes, follow-up timing changes, and explicit spoken instructions—without storing raw message bodies in durable learning records.

## Version-one inclusions

- Android app as primary UX (planned; not scaffolded in A0)
- Minimal administrator web task view
- One Gmail inbox + Google Messages + call prompts (best-effort) + manual/voice
- Approval-first suggestions and assignments
- Gmail forward-with-attachments for approved email assignments
- Reminder/escalation engine
- Retention workers per confirmed policy
- Learning signals and proposed rules (no auto-apply)

## Version-one exclusions

Listed under communication sources and product exclusions above, plus: full administrator dashboard, multi-admin runtime, Neon alongside Supabase, FCM unless later justified, permanent archives, Play Store packaging.

## Future expansion boundaries

Architecture should allow later:

- trusted auto-creation / auto-assignment after explicit rule approval
- multiple agents and roles
- additional messaging sources
- better assignment and priority recommendations
- Play Store distribution

Automatic decisions begin as recommendations until confidence and approval mechanisms exist.

## MVP completion definition

MVP is complete when the primary user can privately sideload an Android app that, together with the backend and minimal web task view:

1. Ingests Gmail and (where available) Google Messages into suggestions.
2. Requires approval to create tasks and to assign/forward to the administrator.
3. Forwards Gmail originals with all attachments after assignment approval (with audit).
4. Supports missed-call prompts and voice-driven complete + follow-up proposals (assignment still approved).
5. Runs deterministic reminders with the v1 escalation rule.
6. Enforces 7-day excerpt and 30-day completed-task visibility policies in the application.
7. Records learning signals without a permanent communication archive.

Play Store, multi-inbox, WhatsApp, and Rocket PM integration are out of MVP.
