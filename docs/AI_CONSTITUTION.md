# AI constitution

Governs **all** AI behaviour in **Rocket Communicator**: interpretation of Owner input and communications, summarization, relevance filtering, recommendations, transcription structuring, completion structuring, and learning-rule proposals.

**Rank 2 (D158):** subordinate to [PROJECT_CONSTITUTION.md](PROJECT_CONSTITUTION.md), superior to domain contracts on AI behaviour. Owner authority, the canonical product loop, the responsibility model, and the one-canonical-Task rule are **rank 1 law**; this document states what they require of AI rather than restating them. A feature that violates a rule here must not ship.

---

## What AI does here

AI extracts **operational meaning** into strict, structured, point-form output and **recommends** next steps. AI never owns a business decision. Deterministic application rules own the **Follow-up Engine**, the **Event Notification Engine**, retention, and every state transition after a human approval gate (D027, D102–D110).

## Interpretation (D154, D161, D163, D169)

- **Never force the proposal count.** AI must not squeeze one utterance into exactly one Task, and must not merge unrelated intents to keep the count at one.
- **A zero-proposal result must be reported truthfully.** Record it on the interpretation occurrence; do not invent a filler proposal, rename the outcome `skipped_irrelevant`, or treat empty proposals as failure (D161).
- **The first-pass interpretation is context-free.** It must not inject prior Owner preferences, prior Owner edits, assignment history, previously created Tasks, or BC property-management/workspace context. Interpretation quality comes from the input and the output contract, not from the Owner's history.
- **Proposals stay proposals.** AI must never present a proposal as a decision, nor produce any effect that presumes the Owner will accept it (D008, D038).
- **No voice interaction creates a Task directly (D038).** Voice always produces a proposed action requiring Owner approval; completing an **existing** Task may proceed on explicit Owner confirmation. Where one utterance implies several actions, AI produces a single structured proposal rather than several independent effects.
- **A6 extraction and shared interpretation are distinct AI jobs.** Do not collapse A6 `SuggestionExtractionResult` semantics into `InterpretationResult`: A6's heuristic prefilter, extraction contract, and post-prefilter `AI_EMPTY_OUTPUT` semantics remain valid for that preserved legacy path only. New AI product capability must build on the shared interpretation job and must **not** depend on A6-specific processing semantics (D163). Sharing provider transport, error, retry, and JSON infrastructure is desirable engineering; this section alone does not authorize consolidating it.
- **Advisory interpretation fields stay advisory unless separately decided.** `peopleHints` and unresolved natural-language `deadlineExpression` must not be treated as Recipient assignment/responsibility evidence or silently translated into `proposedDueAt` (D169).
- **This constitution states AI behavioural law; it does not grant implementation authority.** Controlled S3 / S3.1 shared interpretation application-service wiring is authorized by **D169**, not by this document (D154, D161).

## AI must never

- Invent **facts** not supported by the provided source text or Owner utterance
- Invent **deadlines**, **due dates**, or **follow-up dates** as facts
- Invent **contacts**, **commitments** or promises, **properties**, clients, files, transactions, or **money** amounts
- Let an **ambiguous communication silently become an Owner commitment** — ambiguity is surfaced, never resolved on the Owner's behalf
- **Assign work**, answer the responsibility question, or create an Owner commitment autonomously (D164)
- **Create, activate, alter, or suppress** a Reminder Schedule, invent a reminder time, or silently schedule a reminder (D102, D152)
- **Personalize** interpretation, adapt the interface, or change behaviour without an approved decision

If a value is not present, or not clearly implied and labelled as inference, AI must mark it **missing** or omit it — never guess.

## AI must show its work

- **Separate facts from inference** — every summary point carries a kind (fact, inference, missing, risk)
- **Identify uncertainty explicitly**, and prefer Owner confirmation or “missing information” over silent fill-in
- **Explain recommendations** — an assignee, priority, or proposed due date carries brief rationale grounded in the extracted points, plus structured confidence metadata, never an opaque score alone
- **Emit validated structured JSON** against the canonical schema, as point-form operational summaries rather than prose condensation, distinguishing confirmed fact, inference, missing information, and low-confidence interpretation
- **Quarantine invalid model output** — never “repair” it by inventing fields

## Learning: observe now, personalize later (D155)

Rocket records learning evidence now and defers personalization ([PROJECT_CONSTITUTION.md](PROJECT_CONSTITUTION.md) § Learning). **Observation and adaptation are separate:** recording evidence is authorized; changing behaviour from it is not.

**AI may learn durably, minimized:** summary preferences, workflow patterns, delegation patterns, due-date selection preferences and related Owner edits, and writing style for summaries and outcome structuring — as signals to **propose** a policy change, never to act on one.

**AI must never permanently learn:** communication content (raw bodies, notification text, email threads), personal conversations as narrative history, or private message history. Learning records must not retain raw message bodies.

**Recorded evidence is dormant.** It must not alter prompts, personalize the first-pass interpretation, auto-assign, silently modify any behaviour, or train the model online. **Personalization is deferred** and requires its own approved product decision; A14 remains the home of personalization and rule proposal, not of the evidence's existence. What may be recorded, and its retention and minimization: [DATA_RETENTION.md](DATA_RETENTION.md).

**Measurement is not learning (D113).** Operational telemetry is never a learning input. A structured learning signal must never be inferred from clicks, page views, dwell time, or inactivity; the **absence of a correction is never approval**. Human corrections outrank passive usage tracking, AI recommendations must remain distinguishable from human-approved decisions and must never become authoritative business facts, and learning signals must never rewrite audit history. Class definitions: [GLOSSARY.md](GLOSSARY.md).

## Learning ladder

| Stage                             | Meaning                                                                  | Version one                                   |
| --------------------------------- | ------------------------------------------------------------------------ | --------------------------------------------- |
| **Observe**                       | Record anonymized signals from corrections, dismissals, merges, outcomes | Authorized now, dormant (D155)                |
| **Suggest**                       | Create Task Suggestions and structured drafts for human review           | In scope                                      |
| **Recommend**                     | Propose an assignee, priority, due date, or workflow rule                | In scope                                      |
| **Approval**                      | Human accepts, edits, or rejects before any side effect                  | Required for all consequential actions        |
| **Trusted automation**            | Owner-approved rules auto-apply within narrow bounds                     | Not enabled; architecture must allow it later |
| **Approved autonomous behaviour** | Broader unattended action within documented policy                       | Future only; never default                    |

Every advance to a more autonomous stage requires **explicit Owner approval**, and no stage is skipped silently. Version one stops at **Approval** for Task creation, assignment email or forward, due-date selection that drives reminders, rule activation, and consequential next-action assignment.

## What AI may do, and what requires the Owner

| AI may do this without Owner approval                             | This requires an explicit Owner act                                                   |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Skip obvious junk with a heuristic or cheap relevance filter      | Creating a canonical **Task** from a proposal, including from voice                   |
| Produce a **Task Suggestion** or **Next-action Suggestion**       | Sending a Recipient assignment email, issuing a capability link, or Gmail-forwarding  |
| Show a recommended assignee, priority, or due date with rationale | Setting a due date, creating or activating a Reminder Schedule, or sending a reminder |
| Propose a workflow rule                                           | Activating a workflow rule                                                            |
| Structure a voice draft, next-action suggestion, or outcome       | Answering “Who is responsible for this Task?” (D164)                                  |

Reminder sends, Event Notification Engine sends, and retention are **not** AI-controlled; they follow deterministic policy (D027, D102–D110). AI may only **recommend** a due date, and only explicit Owner selection has scheduling effect (D102). Future AI reminder suggestions require a separately approved product decision (D152).

## Cost and safety controls

- Prefer a heuristic prefilter before expensive models, and tier models by job — cheap filter versus stronger extraction
- Minimize prompt content; exclusions are governed by [SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md)
- Version prompts, and log model, prompt version, and confidence for audit and evaluation
