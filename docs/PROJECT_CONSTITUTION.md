# Project constitution

**Highest-level governing document** for **Rocket Communicator** (D153).

All other documentation, architecture, milestones, and implementation must conform to this constitution. If another document conflicts with this one, update the subordinate document—or intentionally amend this constitution first.

**Repository provenance (D120).** The repository, the `@aicaa/*` package namespace, the Android application id and `app_name`, the OpenAPI `info.title`, and existing web copy still carry the original working name. That is **provenance**, not product identity, and renaming those artifacts is separately authorized implementation work.

Related: [AI_CONSTITUTION.md](AI_CONSTITUTION.md) · [ENGINEERING_WORKFLOW.md](ENGINEERING_WORKFLOW.md) · Architecture Principles detail: [ARCHITECTURE.md](ARCHITECTURE.md)

---

## Product mission

Rocket exists to become the Owner's **trusted external memory**, allowing them to **capture, organize, assign, and follow through** on real work from their **phone** with confidence throughout an ordinary day.

It **replaces the Owner's follow-through habit**. It does **not** replace Gmail, Messages, or the Phone app. It **remembers what must happen next**.

In service of that mission, the product turns ongoing personal business communications into temporary, actionable work—so the Owner always knows what needs action, what matters, who owns it, when to follow up, whether it was done, how it was done, and whether completion created the next action.

## Current product identity (D153)

**Rocket Communicator is a mobile-first trusted external memory and follow-through system.**

| Layer                 | What it owns                                                                                                   |
| --------------------- | -------------------------------------------------------------------------------------------------------------- |
| **Native mobile**     | Owner attention, capture, review, notifications, and device integration                                        |
| **Rocket backend**    | Canonical Task truth, shared intelligence, synchronization, Gmail, assignment, and follow-through              |
| **AI interpretation** | Constrained structured interpretation                                                                          |
| **Web**               | A synchronized, **optional** desktop/web companion                                                             |
| **Android**           | The **first** native client                                                                                    |
| **iPhone**            | A **planned subsequent** native client, using the same backend intelligence and the same canonical Task system |

**Mobile is the primary product experience. Android is the first native client.**

## Product philosophy

- Rocket Communicator is the Owner's **trusted external memory** and follow-through system, not a conventional task manager, calendar manager, communication archive, inbox replacement, or CRM. Reminders are **one capability within that system**; the product is not redefined around reminders alone.
- **Deadline and reminder are separate (D152):** a Task has **zero or one deadline** and **zero or multiple Owner-controlled reminders**. A deadline answers when work needs to be done; a reminder answers when Rocket should bring the Task back to the Owner's attention. **An Owner reminder may exist without a deadline.** **AI does not invent reminders and does not silently schedule them.** Escalation ladders, Owner CC ladders, and general calendar management as the product's purpose remain excluded. **Current implementation:** the A8 Follow-up Engine is due-date-driven Recipient follow-through (D102); Owner-controlled reminders are **not yet implemented** and require a separately authorized implementation slice (D110 sequencing).
- **The product exists to ensure communications are followed through until conclusion.** Communication triage may describe one capability; it does not replace this philosophy.
- **Humans own decisions**; AI proposes structured options. AI must not invent reminder times or silently schedule reminders (D152).
- Communication content is **temporary**; workflow intelligence is **durable**.
- Automation earns trust through an explicit ladder of approval—never through silent behaviour change.
- **Mobile is the primary product experience; Android is the first native client (D153, extending D139).** The Owner's primary instrument is a native mobile client. Web is a synchronized, optional companion for administration, review, debugging, and fallback. The Recipient path stays deliberately thin (email + capability link + minimal web task view).
- Time-driven **Recipient** follow-through is owned by the **Follow-up Engine**, driven by the Owner-selected Task due date as one mechanism (D102–D110); event-driven Owner alerts are owned by the **Event Notification Engine** (D099)—separate engines, not an escalation ladder. Owner-controlled Task reminders (D152) are an additional, separately authorized capability and are not the A8 Follow-up Engine.
- **Feature filter (D139):** a future feature should make it easier for the Owner to capture, organize, assign, or follow through on real work during an ordinary day; if not, it likely belongs later.

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

1. The Owner can confidently manage an ordinary working day using the **native mobile application** (Android today) without depending on memory or external notes, while using the **web application** only for administration or fallback (**D144**, **D153**).
2. The Owner trusts suggestions enough to review them quickly, not re-read every message.
3. Recipient handoffs happen only with explicit Owner approval, with clear audit of who authorized what.
4. Assigned work is followed through deterministically until conclusion, without follow-up spam or escalation ladders. Due-date-driven Recipient follow-up remains bounded and stops on completion or at an approved ceiling (D102, D106). Owner-controlled Task reminders are a separate, Owner-authorized attention mechanism (D152).
5. Completions capture meaningful outcomes (including voice) and can spawn the next approved action.
6. Temporary communication data leaves the application on schedule, while durable preferences improve the system.
7. Operating cost and maintenance remain low enough for private, single-operator use.

## Non-goals

Permanent product non-goals only. **Milestone scope is not a constitutional non-goal** (D158): statements whose meaning is merely "not in version one" — platform, channel, integration, and distribution sequencing — belong to [MILESTONES.md](MILESTONES.md), not here.

- Permanent storage or search of full communication history
- Replacing Phone, Google Messages, or Gmail as the user’s primary apps
- Automatic client-facing replies
- Becoming a CRM
- Silent auto-creation of tasks or silent assignment emails
- Guaranteeing universal device call/notification capture on every OEM

## Product principles

| Principle                                    | Meaning                                                                                                                                                                                                                    |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Reduce cognitive load**                    | Prefer short point-form structure, clear next actions, and minimal UI chrome.                                                                                                                                              |
| **AI should become quieter as it learns**    | Better filtering and trusted rules should reduce noise, not increase prompts.                                                                                                                                              |
| **Learn preferences, not conversations**     | Durable learning stores workflow patterns—not raw message bodies or private chat history.                                                                                                                                  |
| **Human owns decisions**                     | Consequential state changes require an authorized human act. Passive behaviour, inactivity, and the absence of a correction are never approval (D113).                                                                     |
| **Measurement is not learning**              | Operational telemetry answers only whether the application is working properly. It must never become training data, a learning signal, a business record, or audit history, and must never drive product behaviour (D113). |
| **Interfaces state what is true**            | The interface must never imply that a business mutation succeeded before the server confirms it, and an ambiguous outcome stays ambiguous. No optimistic success (D112).                                                   |
| **Approval before automation**               | Recommendations never silently become business actions.                                                                                                                                                                    |
| **Every automation must be reversible**      | Approved rules and automations can be disabled, rolled back, or overridden.                                                                                                                                                |
| **Explain AI recommendations**               | Show why (facts, inference, confidence, missing info)—not opaque scores alone.                                                                                                                                             |
| **Temporary communication**                  | Application-stored excerpts and related temp content are deleted on policy timers.                                                                                                                                         |
| **Durable workflow intelligence**            | Preferences, approved rules, and anonymized signals may outlive message text.                                                                                                                                              |
| **Privacy first**                            | Minimize prompts and storage; exclude OTP/financial alerts; respect contact exclusions.                                                                                                                                    |
| **Low operational cost**                     | Prefer few vendors; avoid duplicate databases and premature platforms. See Architecture Principles (cost-aware; free tiers).                                                                                               |
| **Keep architecture simple**                 | No microservices, queues, or sprawl without a documented need. See Architecture Principles (simplicity; modular infrastructure).                                                                                           |
| **Documentation is the source of truth**     | Behaviour is defined in docs; code implements docs.                                                                                                                                                                        |
| **Mobile is the primary product experience** | The Owner's primary instrument is a native mobile client; Android is the first one and iPhone is planned next on the same backend. Web is a synchronized optional companion (D153, D139).                                  |
| **AI proposes; the Owner decides**           | AI produces proposals. Only an Owner act creates canonical work. Manual capture is AI-first, and the first-pass interpretation is context-free (D154).                                                                     |
| **One canonical domain**                     | One Task domain, one proposal path, one interpretation capability, shared by every client. Evolve existing infrastructure rather than duplicating it (D157).                                                               |
| **External memory, not inbox replacement**   | Rocket remembers what must happen next. It does not replace Gmail, Messages, or Phone (D138–D139).                                                                                                                         |
| **Truth over automation**                    | Prefer truthful state over polished guesswork; never silently invent work or outcomes (D139; extends D112).                                                                                                                |
| **Capture before complexity**                | Reliable capture of real work precedes elaborate organization and AI pipelines (D139).                                                                                                                                     |
| **One-handed first**                         | Ordinary-day mobile use must be workable with one hand (D139).                                                                                                                                                             |
| **Simple by default**                        | Default paths stay short; power features must not obstruct the ordinary day (D139).                                                                                                                                        |
| **Reduce decisions**                         | Rocket should reduce decisions, not create them. Where two designs solve the same problem, prefer the one that removes choices, screens, and controls while preserving truthful information (D151).                        |
| **Every feature must justify its existence** | Earn a place only by aiding capture, organize, assign, or follow-through — or by safety, truthfulness, or administration (D139).                                                                                           |

## Owner authority and AI-first capture (D154, D161, D164)

**AI proposes. The Owner decides.**

- **Manual typed or dictated capture is intended to be AI-first.** Owner natural-language input is interpreted before canonical work exists.
- **One natural-language input may yield zero, one, or multiple independent proposed Tasks.** A single utterance is not assumed to be a single Task. Zero proposals is truthful success for Owner-initiated interpretation (D161).
- **Interpretation is an occurrence.** Rocket persists one interpretation-occurrence concept as grouping/provenance truth (not canonical Task truth). One occurrence may produce 0..N proposals. Multiple legitimate occurrences may reference the same source. There is no invariant of one interpretation forever per source (D161).
- **The first-pass interpretation is context-free.** It must not inject prior Owner preferences, prior Owner edits, assignment history, or previously created Tasks. BC property-management/workspace context is a later assistance layer and is not authorized here.
- **Only an Owner act creates a canonical Task, and acceptance asks one question.** The Owner reviews the proposals and, on acceptance, answers **“Who is responsible for this Task?”** — the **Owner (Me)** or a **Recipient**. There is no separate Owner-facing Keep action. That selection is **affirmative**: it is never inferred from the presence or absence of an assignment or any other operational persistence artifact (D155, D164).
- **Current implementation is interim.** The shipped direct Owner capture path was valid for its milestone and is **current implementation**, not permanent product architecture (D158: current implementation truth is not automatically product law).
- **Representation is not authorization.** Representing an Owner-review trigger in architecture or schema does not authorize Owner-review APIs, Review-with-Rocket UI, exclusions, automatic-processing changes, notifications, cron, or Production flags (D161).

This section states product law and authorizes no implementation. AI behaviour detail: [AI_CONSTITUTION.md](AI_CONSTITUTION.md).

## Responsibility and one follow-through model (D164)

**Responsibility answers who is expected to do the work. It does not decide whether Rocket follows through.**

- **One canonical Task and one follow-through model.** An Owner-responsible Task and a Recipient-responsible Task are the same canonical Task. Responsibility must not determine whether a Task can participate in Rocket's Task lifecycle, deadline, reminder, completion, and follow-through concepts.
- **A unified question does not require unified persistence.** An Owner-responsible Task may remain the canonical Task with **no active external assignment**; a Recipient-responsible Task uses the existing Recipient, assignment, capability, and handoff machinery. Choosing **Me** does not require an assignment to the Owner, and the persistence representation is deliberately unsettled.
- **Operational representation is not affirmative evidence.** The absence of an active assignment is never evidence that the Owner chose themselves (D155).
- **Selection is not delivery.** The Owner's selection is true the moment the Owner makes it; whether Rocket delivered access to an external Recipient remains the existing assignment and handoff truth. A failed handoff does not falsify the selection, and recording a selection does not imply delivery.
- **Attention may differ by audience.** One Task follow-through event may serve a Recipient work reminder and appropriate Owner oversight attention for different purposes, and an Owner-responsible Task may route attention to the Owner without Recipient email machinery. **Delegating a Task must never remove it from appropriate Owner oversight.**

This section states product law and authorizes no implementation: no second reminder engine, no reminder routing or delivery mechanics, no change to A8 reminder processing, and no responsibility persistence.

## Learning: observation now, personalization later (D155)

Rocket **records learning evidence now**: the AI proposal as presented to the Owner (revision 0), the Owner's later edits as append-only revisions, the finally accepted **content** revision, and — as an **independent** concern — the Owner's **affirmative responsibility selection** (Owner or Recipient), including the selected Recipient. Accepted content revision answers _what_ the Owner accepted; responsibility selection answers _who_ the Owner made responsible. A selection is never inferred from the presence or absence of an assignment, never implies successful external delivery, and is historical evidence of the **initial** choice rather than current assignment state (D164). That evidence is **dormant**: it must not alter prompts, personalize the first-pass interpretation, auto-assign, silently modify behaviour, or feed online training. **Personalization is deferred** and requires its own approved decision. D113 holds unchanged: operational telemetry is not learning, passive behaviour is never approval, and behaviour must never silently change. Detail: [AI_CONSTITUTION.md](AI_CONSTITUTION.md); retention of manual raw input for review: **D162**.

## One canonical domain (D157)

- **One canonical Task domain.**
- **One shared proposal path** (`TaskSuggestion` is the single shared proposal domain — no parallel CandidateTask store).
- **One shared interpretation capability**, with distinct AI jobs for preserved A6 extraction (compatibility/legacy) and Owner/shared interpretation where their contracts differ (D161, **D163**). A6 is not a dependency target for future product development.
- **Every native and web client uses the same backend Task and intelligence system.**
- **Existing infrastructure is evolved rather than duplicated** unless an explicit approved architecture decision replaces it.

Current implementation names are **not** product law. [ARCHITECTURE.md](ARCHITECTURE.md) identifies which existing modules carry these responsibilities today.

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

## Authority model (D158)

| Rank                | Document                                                                                                                                                                                                                                                                                | Role                                               |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| **1**               | [PROJECT_CONSTITUTION.md](PROJECT_CONSTITUTION.md) (this file)                                                                                                                                                                                                                          | Current product law                                |
| **2**               | [AI_CONSTITUTION.md](AI_CONSTITUTION.md)                                                                                                                                                                                                                                                | AI-specific law, subordinate to rank 1             |
| **3**               | [DECISIONS.md](DECISIONS.md)                                                                                                                                                                                                                                                            | Current binding discrete decisions                 |
| **4**               | Domain contracts: [ARCHITECTURE.md](ARCHITECTURE.md), [API_CONTRACT.md](API_CONTRACT.md) / OpenAPI, [SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md), [WORKFLOWS.md](WORKFLOWS.md), [DATA_RETENTION.md](DATA_RETENTION.md)                                                            | Bind their own domain under ranks 1–3              |
| **Below authority** | [MILESTONES.md](MILESTONES.md) / roadmap, [REVIEW_CHECKLIST.md](REVIEW_CHECKLIST.md), [DEPLOYMENT.md](DEPLOYMENT.md), [../README.md](../README.md), [GLOSSARY.md](GLOSSARY.md), [OPEN_QUESTIONS.md](OPEN_QUESTIONS.md), [../BRAND.md](../BRAND.md), planning documents, package READMEs | Describe, sequence, or navigate; never product law |

The list is exhaustive: every active document sits at one of these ranks, and a document not named here is **below authority**.

Rules:

- A lower-rank document may **describe and enforce** higher-rank law. It may **not originate contradictory product law**.
- **Milestone scope is not permanent product law** unless deliberately elevated into rank 1–3.
- **Current implementation truth is not automatically permanent product law.**
- **Historical material is never current law**, wherever it appears.
- Where documents still conflict, the newer **Approved** decision controls.

## Amendment

Amend this constitution only deliberately: record the change in [DECISIONS.md](DECISIONS.md), update dependent docs, and note the reason. Silent drift is forbidden.

## Amendment history

Not kept here. Every amendment to this constitution is recorded as an **Approved** entry in [DECISIONS.md](DECISIONS.md), which is the durable record of what changed and why. Withdrawn wording is **removed** from the sections above rather than preserved beside an explanation of its supersession, so current law can be read without reconstructing a supersession chain.
