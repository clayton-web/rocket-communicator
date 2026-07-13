# Project constitution

**Highest-level governing document** for the AI Communication Action Assistant.

All other documentation, architecture, milestones, and implementation must conform to this constitution. If another document conflicts with this one, update the subordinate document—or intentionally amend this constitution first.

Related: [AI_CONSTITUTION.md](AI_CONSTITUTION.md) · [ENGINEERING_WORKFLOW.md](ENGINEERING_WORKFLOW.md) · [DOCUMENTATION_INDEX.md](DOCUMENTATION_INDEX.md)

---

## Product mission

Turn ongoing personal business communications into temporary, actionable work—so the primary user always knows what needs action, what matters, who owns it, when to follow up, whether it was done, how it was done, and whether completion created the next action.

## Product philosophy

- The product is an **action assistant**, not a communication archive or CRM.
- **Humans own decisions**; AI proposes structured options.
- Communication content is **temporary**; workflow intelligence is **durable**.
- Automation earns trust through an explicit ladder of approval—never through silent behaviour change.
- The Android app is the primary instrument; the administrator path stays deliberately thin (email + secure link + minimal web task view).

## Long-term vision

A private multi-agent operating system for communication-driven work that:

- notices what matters with less noise over time
- recommends assignments, priorities, and follow-ups with explained confidence
- advances only through user-approved trusted automation
- expands to additional roles and sources without becoming a permanent message store
- remains operable at low cost with a simple architecture

Version one proves the approval-first loop for one primary user and one same-organization administrator.

## Success definition

The product succeeds when:

1. The primary user trusts suggestions enough to review them quickly, not re-read every message.
2. Administrator handoffs happen only with explicit approval, with clear audit of who authorized what.
3. Overdue work is followed up deterministically without reminder spam.
4. Completions capture meaningful outcomes (including voice) and can spawn the next approved action.
5. Temporary communication data leaves the application on schedule, while durable preferences improve the system.
6. Operating cost and maintenance remain low enough for private, single-operator use.

## Non-goals

- Permanent storage or search of full communication history
- Replacing Phone, Google Messages, or Gmail as the user’s primary apps
- Automatic client-facing replies
- A full administrator dashboard or CRM in version one
- Silent auto-creation of tasks or silent assignment emails
- Google Play distribution in version one
- Integration with Rocket PM in version one
- Supporting WhatsApp, Facebook Messenger, or Signal in version one
- Guaranteeing universal Android call/notification capture on every OEM

## Product principles

| Principle                                 | Meaning                                                                                   |
| ----------------------------------------- | ----------------------------------------------------------------------------------------- |
| **Reduce cognitive load**                 | Prefer short point-form structure, clear next actions, and minimal UI chrome.             |
| **AI should become quieter as it learns** | Better filtering and trusted rules should reduce noise, not increase prompts.             |
| **Learn preferences, not conversations**  | Durable learning stores workflow patterns—not raw message bodies or private chat history. |
| **Human owns decisions**                  | Consequential state changes require an authorized human act.                              |
| **Approval before automation**            | Recommendations never silently become business actions.                                   |
| **Every automation must be reversible**   | Approved rules and automations can be disabled, rolled back, or overridden.               |
| **Explain AI recommendations**            | Show why (facts, inference, confidence, missing info)—not opaque scores alone.            |
| **Temporary communication**               | Application-stored excerpts and related temp content are deleted on policy timers.        |
| **Durable workflow intelligence**         | Preferences, approved rules, and anonymized signals may outlive message text.             |
| **Privacy first**                         | Minimize prompts and storage; exclude OTP/financial alerts; respect contact exclusions.   |
| **Low operational cost**                  | Prefer few vendors; avoid duplicate databases and premature platforms.                    |
| **Keep architecture simple**              | No microservices, queues, or sprawl without a documented need.                            |
| **Documentation is the source of truth**  | Behaviour is defined in docs; code implements docs.                                       |

## Engineering Rule #1

**Implementation may never change documented product behaviour without documentation being updated first.**

If a change in behaviour is required, update the relevant governing and product documents (and decision register) **before** or **as the first part of** the implementation work—never as an afterthought.

## Engineering Rule #2

**Documentation wins over implementation.**

If implementation and documentation disagree, **implementation is wrong** until documentation is intentionally updated. Do not “fix” docs to match accidental code behaviour without an explicit product decision.

## Authority order

When documents conflict, resolve in this order unless a newer **Approved** decision explicitly supersedes an older one:

1. [PROJECT_CONSTITUTION.md](PROJECT_CONSTITUTION.md) (this file)
2. [AI_CONSTITUTION.md](AI_CONSTITUTION.md) for AI-specific behaviour
3. [DECISIONS.md](DECISIONS.md) Approved entries
4. [PRODUCT_SCOPE.md](PRODUCT_SCOPE.md)
5. [DATA_RETENTION.md](DATA_RETENTION.md) / [SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md) for their domains
6. [ARCHITECTURE.md](ARCHITECTURE.md) / [WORKFLOWS.md](WORKFLOWS.md)
7. [MILESTONES.md](MILESTONES.md) (sequencing, not product law)
8. [OPEN_QUESTIONS.md](OPEN_QUESTIONS.md) (unresolved—must not be treated as decisions)

## Amendment

Amend this constitution only deliberately: record the change in [DECISIONS.md](DECISIONS.md), update dependent docs, and note the reason. Silent drift is forbidden.
