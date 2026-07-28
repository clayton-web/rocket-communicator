# Project constitution

**Highest-level governing document** for the AI Communication Action Assistant.

All other documentation, architecture, milestones, and implementation must conform to this constitution. If another document conflicts with this one, update the subordinate document—or intentionally amend this constitution first.

Related: [AI_CONSTITUTION.md](AI_CONSTITUTION.md) · [ENGINEERING_WORKFLOW.md](ENGINEERING_WORKFLOW.md) · [DOCUMENTATION_INDEX.md](DOCUMENTATION_INDEX.md) · Architecture Principles detail: [ARCHITECTURE.md](ARCHITECTURE.md)

---

## Product mission

Turn ongoing personal business communications into temporary, actionable work—so the Owner always knows what needs action, what matters, who owns it, when to follow up, whether it was done, how it was done, and whether completion created the next action.

## Product philosophy

- The product is an **AI Communication Action Assistant**, not a conventional task manager, calendar manager, general-purpose reminder application, communication archive, or CRM.
- **Narrow due-date exception (D102, amended 2026-07-28):** an **explicitly selected Task due date may drive deterministic follow-through on delegated communication work.** This exception is limited to Recipient follow-through on work the Owner has deliberately delegated. It does **not** authorize general-purpose personal reminders, arbitrary recurrence, escalation ladders, Owner CC ladders, silent AI-controlled scheduling, or general calendar management. Prior wording prohibited every "due-date reminder application" characteristic; see [Amendment history](#amendment-history).
- **The product exists to ensure communications are followed through until conclusion.** Communication triage may describe one capability; it does not replace this philosophy.
- **Humans own decisions**; AI proposes structured options.
- Communication content is **temporary**; workflow intelligence is **durable**.
- Automation earns trust through an explicit ladder of approval—never through silent behaviour change.
- The Android app is the Owner’s primary instrument; the Recipient path stays deliberately thin (email + capability link + minimal web task view). **Clarification (D111):** Android remains the **intended** primary instrument and is delivered by **A9**. Until then the Owner web surface is the operational Owner instrument, and **P1** makes it reliable — a shared application shell, truthful experience states, and operational observability. P1 does not displace the Android plan and adds no product feature.
- Time-driven Recipient follow-through is owned by the **Follow-up Engine**, driven by the Owner-selected Task due date (D102–D110); event-driven Owner alerts are owned by the **Event Notification Engine** (D099)—separate engines, not an escalation ladder.

## Long-term vision

A private multi-agent operating system for communication-driven work that:

- notices what matters with less noise over time
- recommends assignments, priorities, and follow-ups with explained confidence
- advances only through user-approved trusted automation
- expands to additional Recipients and sources without becoming a permanent message store
- remains operable at low cost with a simple architecture

Version one proves the approval-first loop for one authenticated Owner and delegated Recipients via capability links.

## Success definition

The product succeeds when:

1. The Owner trusts suggestions enough to review them quickly, not re-read every message.
2. Recipient handoffs happen only with explicit Owner approval, with clear audit of who authorized what.
3. Assigned work is followed through deterministically until conclusion, without follow-up spam or escalation ladders. Due-date-driven follow-up remains bounded and stops on completion or at an approved ceiling (D102, D106).
4. Completions capture meaningful outcomes (including voice) and can spawn the next approved action.
5. Temporary communication data leaves the application on schedule, while durable preferences improve the system.
6. Operating cost and maintenance remain low enough for private, single-operator use.

## Non-goals

- Permanent storage or search of full communication history
- Replacing Phone, Google Messages, or Gmail as the user’s primary apps
- Automatic client-facing replies
- A full Recipient dashboard or CRM in version one
- Silent auto-creation of tasks or silent assignment emails
- Google Play distribution in version one
- Integration with Rocket PM in version one
- Supporting WhatsApp, Facebook Messenger, or Signal in version one
- Guaranteeing universal Android call/notification capture on every OEM

## Product principles

| Principle                                 | Meaning                                                                                                                                                                                                                    |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Reduce cognitive load**                 | Prefer short point-form structure, clear next actions, and minimal UI chrome.                                                                                                                                              |
| **AI should become quieter as it learns** | Better filtering and trusted rules should reduce noise, not increase prompts.                                                                                                                                              |
| **Learn preferences, not conversations**  | Durable learning stores workflow patterns—not raw message bodies or private chat history.                                                                                                                                  |
| **Human owns decisions**                  | Consequential state changes require an authorized human act. Passive behaviour, inactivity, and the absence of a correction are never approval (D113).                                                                     |
| **Measurement is not learning**           | Operational telemetry answers only whether the application is working properly. It must never become training data, a learning signal, a business record, or audit history, and must never drive product behaviour (D113). |
| **Interfaces state what is true**         | The interface must never imply that a business mutation succeeded before the server confirms it, and an ambiguous outcome stays ambiguous. No optimistic success (D112).                                                   |
| **Approval before automation**            | Recommendations never silently become business actions.                                                                                                                                                                    |
| **Every automation must be reversible**   | Approved rules and automations can be disabled, rolled back, or overridden.                                                                                                                                                |
| **Explain AI recommendations**            | Show why (facts, inference, confidence, missing info)—not opaque scores alone.                                                                                                                                             |
| **Temporary communication**               | Application-stored excerpts and related temp content are deleted on policy timers.                                                                                                                                         |
| **Durable workflow intelligence**         | Preferences, approved rules, and anonymized signals may outlive message text.                                                                                                                                              |
| **Privacy first**                         | Minimize prompts and storage; exclude OTP/financial alerts; respect contact exclusions.                                                                                                                                    |
| **Low operational cost**                  | Prefer few vendors; avoid duplicate databases and premature platforms. See Architecture Principles (cost-aware; free tiers).                                                                                               |
| **Keep architecture simple**              | No microservices, queues, or sprawl without a documented need. See Architecture Principles (simplicity; modular infrastructure).                                                                                           |
| **Documentation is the source of truth**  | Behaviour is defined in docs; code implements docs.                                                                                                                                                                        |

## Architecture Principles

Binding engineering principles for stack, hosting, and infrastructure choices (D079). Detail and examples: [ARCHITECTURE.md](ARCHITECTURE.md).

1. **Architecture before infrastructure** — Business logic remains independent of hosting providers and infrastructure services whenever practical.
2. **Vendor-neutral design** — Schedulers, storage providers, messaging systems, and cloud services should be replaceable with minimal application changes.
3. **Cost-aware engineering** — When solutions are comparable in security, reliability, maintainability, and performance, prefer the lowest recurring operational cost.
4. **Free tiers are first-class citizens** — Intentionally target free service tiers where they satisfy product requirements. Adopt paid services only for a measurable architectural, operational, or business benefit.
5. **Security is never compromised** — Authentication, authorization, auditing, data integrity, and privacy always take precedence over reducing cost.
6. **Keep infrastructure modular** — Infrastructure triggers application behaviour rather than containing application logic (for example, schedulers invoke authenticated endpoints; they do not embed business rules).
7. **Simplicity over complexity** — Prefer simple, understandable solutions that are easy to maintain and troubleshoot. Avoid unnecessary infrastructure and vendor lock-in. Fewer components and network hops often improve reliability and performance, but performance claims must be validated with evidence.

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

## Amendment history

Amendments are recorded here so superseded governing wording remains inspectable. Do not delete rows.

| Date       | Section            | Previous wording                                                                                                                                                                                                                     | Amended wording                                                                                                                                                                              | Authority | Reason                                                                                                                                                                                                                                                                                                                 |
| ---------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-07-28 | Product philosophy | "not a conventional task manager, calendar manager, **due-date reminder application**, communication archive, or CRM" — read as prohibiting all due-date-driven follow-up                                                            | "not a conventional task manager, calendar manager, **general-purpose reminder application**, communication archive, or CRM" **plus** an explicit narrow due-date exception                  | **D102**  | The revised A8 Follow-up Engine makes an explicitly Owner-selected Task due date the deterministic scheduling input for delegated-work follow-through. The blanket prohibition was narrowed rather than deleted; every non-delegated reminder use remains excluded                                                     |
| 2026-07-28 | Success definition | "without follow-up spam or **due-date escalation ladders**"                                                                                                                                                                          | "without follow-up spam or **escalation ladders**" plus an explicit bounded-follow-up statement                                                                                              | **D102**  | Escalation ladders remain prohibited; the previous phrasing could be misread as prohibiting bounded due-date follow-up now authorized under D102 and ceilinged by D106                                                                                                                                                 |
| 2026-07-28 | Engine ownership   | "Time-driven Recipient follow-through is owned by the **Follow-up Engine**; … **Event Notification Engine** (**D095**, D099)" — no stated scheduling driver                                                                          | Same engine separation, now stating the driver: "driven by the Owner-selected Task due date (**D102–D110**)"                                                                                 | **D102**  | The Follow-up Engine's scheduling driver moved from the retired D095 handoff-interval model to the Owner-selected due date. Engine separation and the escalation-ladder prohibition are unchanged                                                                                                                      |
| 2026-07-28 | Product principles | No principle addressed **measurement**. "Learn preferences, not conversations" governed learning **content** only, and nothing stated that health and performance measurement is a separate class that may not become learning input | Added **"Measurement is not learning."** Also extended **"Human owns decisions"** to state that passive behaviour, inactivity, and the absence of a correction are never approval            | **D113**  | Recovers a documentation pass that separates business records, audit history, operational telemetry, and structured learning signals. Before P1 introduces any telemetry, the constitution must forbid measurement silently becoming training data or product behaviour. No existing principle was removed or narrowed |
| 2026-07-28 | Product philosophy | "The Android app is the Owner's primary instrument" — could be read as forbidding investment in the Owner **web** experience                                                                                                         | Same principle, **clarified**: Android remains the **intended** primary instrument delivered by **A9**; the web Owner surface is the currently-operational instrument that P1 makes reliable | **D111**  | Clarification only; the principle is unchanged and Android is not deprioritized. Recorded because P1 invests in the Owner web experience and the unclarified wording invited the wrong inference                                                                                                                       |
| 2026-07-28 | Product principles | No principle addressed **interface truthfulness**. Truthful-outcome behaviour existed only as A7.8 implementation practice, unstated as governing law                                                                                | Added **"Interfaces state what is true."** No optimistic mutation success; an ambiguous outcome stays ambiguous                                                                              | **D112**  | P1 improves perceived responsiveness across every Owner surface. Elevating the existing A7.8 truthful-outcome practice to a principle prevents loading and skeleton work from drifting into optimistic success. Extends "Human owns decisions" rather than altering it                                                 |
