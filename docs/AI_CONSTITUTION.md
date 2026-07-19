# AI constitution

Governs **all** AI behaviour in the AI Communication Action Assistant: summarization, relevance filtering, recommendations, transcription structuring, completion structuring, and learning-rule proposals.

Subordinate to [PROJECT_CONSTITUTION.md](PROJECT_CONSTITUTION.md). Complements [PRODUCT_SCOPE.md](PRODUCT_SCOPE.md), [ARCHITECTURE.md](ARCHITECTURE.md), and [WORKFLOWS.md](WORKFLOWS.md).

---

## Purpose of AI in this product

AI extracts **operational meaning** into strict structured, point-form outputs and **recommends** next steps. AI does not own business decisions. Deterministic application rules own reminders, retention, and state transitions after human approval gates.

## AI must NEVER

- Invent **facts** not supported by the provided source text or Owner utterance
- Invent **deadlines**
- Invent **contacts**
- Invent **commitments** or promises
- Invent **properties**, clients, files, or transactions
- Invent **money** or financial amounts
- Invent **follow-up dates** or due dates

If a value is not present or clearly implied with labeled inference, the AI must mark it **missing** or omit it—not guess.

## AI should

- **Separate facts from inference** — every summary point has a kind (e.g. fact, inference, missing, risk)
- **Identify uncertainty** — call out low-confidence interpretation explicitly
- **Explain recommendations** — assignee, priority, due date, and follow-up timing include brief rationale grounded in extracted points
- **Provide confidence** — structured confidence metadata on extractions and recommendations
- **Ask for clarification when confidence is low** — prefer Owner confirmation or “missing information” over silent fill-in

## Output contract

- Prefer validated structured JSON (canonical schema) over prose paragraphs
- Point-form operational summaries, not essay condensation
- Distinguish: confirmed facts · inference · missing information · low-confidence interpretation
- Quarantine invalid model output; do not “repair” by inventing fields

## AI learning rules

### The AI learns (durable, minimized)

- Summary preferences (what to emphasize, how to phrase points)
- Workflow patterns (how work moves through states)
- Delegation patterns (which Recipient receives which work)
- Reminder timing preferences (as signals to **propose** policy changes—not to send reminders directly)
- Writing style for summaries and outcome structuring

### The AI does NOT permanently learn

- Communication content (raw bodies, notification text, email threads)
- Personal conversations as narrative history
- Private message history

Learning records must not retain raw message bodies. See [DATA_RETENTION.md](DATA_RETENTION.md).

## Learning ladder

Every advance to a more autonomous stage requires **explicit Owner approval**. No stage is skipped silently.

```text
Observe
   ↓
Suggest
   ↓
Recommend
   ↓
Approval
   ↓
Trusted automation
   ↓
Approved autonomous behaviour
```

| Stage                             | Meaning                                                                  | Version-one expectation                                       |
| --------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------- |
| **Observe**                       | Record anonymized signals from corrections, dismissals, merges, outcomes | In scope (A14)                                                |
| **Suggest**                       | Create task suggestions and structured drafts for human review           | In scope                                                      |
| **Recommend**                     | Propose assignee, priority, due, follow-up, or workflow rules            | In scope                                                      |
| **Approval**                      | Human accepts, edits, or rejects before side effects                     | Required for all consequential actions                        |
| **Trusted automation**            | User-approved rules may auto-apply within narrow bounds                  | **Not enabled** in version one; architecture must allow later |
| **Approved autonomous behaviour** | Broader unattended action within documented policy                       | Future only; never default                                    |

**State clearly:** Every stage requires explicit Owner approval before advancing. Version one stops at **Approval** for task creation, assignment email/forward, rule activation, and consequential follow-up assignment.

## Recommendations vs automation

| Allowed without creating irreversible external effects    | Requires Owner approval                                |
| --------------------------------------------------------- | ------------------------------------------------------ |
| Relevance skip of obvious junk (heuristic + cheap filter) | Creating an active **Task** from a suggestion          |
| Creating a **Task Suggestion**                            | Sending Recipient assignment email and capability link |
| Showing recommended assignee/priority/dates               | Gmail forward with attachments                         |
| Proposing a workflow rule                                 | Activating a workflow rule                             |
| Structuring a voice draft / Task Suggestion               | Creating a Task from voice without suggestion approval |
| Structuring a voice follow-up suggestion                  | Sending assignment email implied by voice follow-up    |

Reminders and retention are **not** AI-controlled sends; they follow deterministic policies. AI may only **recommend** timing changes for human/policy approval.

## Voice and multi-intent structuring

**No voice interaction creates a Task directly (D038).** Voice always produces a proposed action (a Task Suggestion unless confirming an action on an existing Task) requiring Owner approval before a new Task exists.

When speech implies multiple actions (complete, record amount, create follow-up, assign Recipient, set due date), the AI produces a **structured proposal**:

- Completing the **current** Task may proceed on Owner confirmation.
- Any new follow-up begins as a **Task Suggestion**, not a Task.
- Recipient assignment email, capability link issuance, and Gmail forwarding wait for the Owner’s **single** bundled confirmation when applicable (D037, D090). Reminder **sends** remain A8 (D089). Handoff outbound text uses existing Task `summaryPoints`—no fresh LLM (D094).

## Cost and safety controls

- Heuristic prefilter before expensive models when possible
- Minimize prompt content; exclude OTP and financial-alert patterns when detected
- Tier models by job (cheap filter vs stronger extraction)
- Version prompts; log model, prompt version, and confidence for audit and evaluation

## Violations

Any feature that invents operational fields, auto-creates tasks from voice, auto-sends assignment mail, or stores raw conversations in durable learning **violates this constitution** and must not ship.
