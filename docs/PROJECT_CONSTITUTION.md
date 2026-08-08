# Project constitution

**Highest-level governing document** for the AI Communication Action Assistant.

All other documentation, architecture, milestones, and implementation must conform to this constitution. If another document conflicts with this one, update the subordinate document—or intentionally amend this constitution first.

Related: [AI_CONSTITUTION.md](AI_CONSTITUTION.md) · [ENGINEERING_WORKFLOW.md](ENGINEERING_WORKFLOW.md) · [DOCUMENTATION_INDEX.md](DOCUMENTATION_INDEX.md) · Architecture Principles detail: [ARCHITECTURE.md](ARCHITECTURE.md)

---

## Product mission

Rocket exists to become the Owner's **trusted external memory**, allowing them to **capture, organize, assign, and follow through** on real work from their **Android phone** with confidence throughout an ordinary day.

It **replaces the Owner's follow-through habit**. It does **not** replace Gmail, Messages, or the Phone app. It **remembers what must happen next**.

In service of that mission, the product turns ongoing personal business communications into temporary, actionable work—so the Owner always knows what needs action, what matters, who owns it, when to follow up, whether it was done, how it was done, and whether completion created the next action.

**Product Constitution (P2.0):** the full constitutional answer to “What kind of product are we building?” lives in [P2_0_OWNER_EXPERIENCE_FOUNDATION.md](P2_0_OWNER_EXPERIENCE_FOUNDATION.md) (**D137–D144**).

## Product philosophy

- The product is an **AI Communication Action Assistant** and the Owner's **trusted external memory**, not a conventional task manager, calendar manager, communication archive, inbox replacement, or CRM. Reminders are **one capability within that system**; the product is not redefined around reminders alone.
- **Deadline and reminder are separate (D152):** a Task may have **zero or one deadline** and **zero or multiple Owner-controlled reminders**. A deadline answers when work needs to be done; a reminder answers when Rocket should bring the Task back to the Owner's attention. Owner-controlled Task reminders may exist **independently of deadlines**. **Current implementation:** the A8 Follow-up Engine remains due-date-driven Recipient follow-through (D102–D110 operative engine rules). **Approved product direction:** Owner-created Task reminders at Owner-selected dates/times are permitted; they are **not yet implemented** and require a separately authorized implementation slice. This does **not** authorize escalation ladders, Owner CC ladders, silent AI-controlled scheduling, or general calendar management as the product's purpose. **Historical note:** D102 previously prohibited "general-purpose personal reminders" under a narrow due-date exception; that restrictive ceiling is **permanently superseded by D152** — see [Amendment history](#amendment-history).
- **The product exists to ensure communications are followed through until conclusion.** Communication triage may describe one capability; it does not replace this philosophy.
- **Humans own decisions**; AI proposes structured options. AI must not invent reminder times or silently schedule reminders (D152).
- Communication content is **temporary**; workflow intelligence is **durable**.
- Automation earns trust through an explicit ladder of approval—never through silent behaviour change.
- **Android is the product (P2.0 / D139).** The Android app is the Owner’s primary instrument; web exists for administration, review, debugging, and fallback. The Recipient path stays deliberately thin (email + capability link + minimal web task view). **Historical clarification (D111):** until A9 delivers that instrument, the Owner web surface is the operational Owner instrument, and **P1** made it reliable — a shared application shell, truthful experience states, and operational observability. P1 did not displace the Android plan and added no product feature. **P2.0** restores Android-first Owner experience as the constitutional forward path without redesigning architecture.
- Time-driven **Recipient** follow-through is owned by the **Follow-up Engine**, driven by the Owner-selected Task due date as one mechanism (D102–D110); event-driven Owner alerts are owned by the **Event Notification Engine** (D099)—separate engines, not an escalation ladder. Owner-controlled Task reminders (D152) are an additional, separately authorized capability and are not the A8 Follow-up Engine.
- **Feature filter (P2.0 / D139):** a future feature should make it easier for the Owner to capture, organize, assign, or follow through on real work during an ordinary day; if not, it likely belongs later.

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

1. The Owner can confidently manage an ordinary working day using the **Android application** without depending on memory or external notes, while using the **web application** only for administration or fallback (**D144**; detail: [P2_0_OWNER_EXPERIENCE_FOUNDATION.md](P2_0_OWNER_EXPERIENCE_FOUNDATION.md)).
2. The Owner trusts suggestions enough to review them quickly, not re-read every message.
3. Recipient handoffs happen only with explicit Owner approval, with clear audit of who authorized what.
4. Assigned work is followed through deterministically until conclusion, without follow-up spam or escalation ladders. Due-date-driven Recipient follow-up remains bounded and stops on completion or at an approved ceiling (D102, D106). Owner-controlled Task reminders are a separate, Owner-authorized attention mechanism (D152).
5. Completions capture meaningful outcomes (including voice) and can spawn the next approved action.
6. Temporary communication data leaves the application on schedule, while durable preferences improve the system.
7. Operating cost and maintenance remain low enough for private, single-operator use.

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
| **Android is the product**                   | The Owner's primary instrument is Android. Web is administration, review, debugging, and fallback (P2.0 / D139).                                                                                                           |
| **External memory, not inbox replacement**   | Rocket remembers what must happen next. It does not replace Gmail, Messages, or Phone (P2.0 / D138–D139).                                                                                                                  |
| **Truth over automation**                    | Prefer truthful state over polished guesswork; never silently invent work or outcomes (P2.0 / D139; extends D112).                                                                                                         |
| **Capture before complexity**                | Reliable capture of real work precedes elaborate organization and AI pipelines (P2.0 / D139).                                                                                                                              |
| **One-handed first**                         | Ordinary-day Android use must be workable with one hand (P2.0 / D139).                                                                                                                                                     |
| **Simple by default**                        | Default paths stay short; power features must not obstruct the ordinary day (P2.0 / D139).                                                                                                                                 |
| **Every feature must justify its existence** | Earn a place only by aiding capture, organize, assign, or follow-through — or by safety, truthfulness, or administration (P2.0 / D139).                                                                                    |

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
4. [P2_0_OWNER_EXPERIENCE_FOUNDATION.md](P2_0_OWNER_EXPERIENCE_FOUNDATION.md) for Owner-experience Product Constitution (P2.0 / D137–D144) — subordinate where this file or AI law is more specific
5. [PRODUCT_SCOPE.md](PRODUCT_SCOPE.md)
6. [DATA_RETENTION.md](DATA_RETENTION.md) / [SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md) for their domains
7. [ARCHITECTURE.md](ARCHITECTURE.md) / [WORKFLOWS.md](WORKFLOWS.md)
8. [MILESTONES.md](MILESTONES.md) (sequencing, not product law)
9. [OPEN_QUESTIONS.md](OPEN_QUESTIONS.md) (unresolved—must not be treated as decisions)

## Amendment

Amend this constitution only deliberately: record the change in [DECISIONS.md](DECISIONS.md), update dependent docs, and note the reason. Silent drift is forbidden.

## Amendment history

Amendments are recorded here so superseded governing wording remains inspectable. Do not delete rows.

| Date       | Section            | Previous wording                                                                                                                                                                                                                     | Amended wording                                                                                                                                                                                                                                    | Authority | Reason                                                                                                                                                                                                                                                                                                                 |
| ---------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-07-28 | Product philosophy | "not a conventional task manager, calendar manager, **due-date reminder application**, communication archive, or CRM" — read as prohibiting all due-date-driven follow-up                                                            | "not a conventional task manager, calendar manager, **general-purpose reminder application**, communication archive, or CRM" **plus** an explicit narrow due-date exception                                                                        | **D102**  | The revised A8 Follow-up Engine makes an explicitly Owner-selected Task due date the deterministic scheduling input for delegated-work follow-through. The blanket prohibition was narrowed rather than deleted; every non-delegated reminder use remains excluded                                                     |
| 2026-07-28 | Success definition | "without follow-up spam or **due-date escalation ladders**"                                                                                                                                                                          | "without follow-up spam or **escalation ladders**" plus an explicit bounded-follow-up statement                                                                                                                                                    | **D102**  | Escalation ladders remain prohibited; the previous phrasing could be misread as prohibiting bounded due-date follow-up now authorized under D102 and ceilinged by D106                                                                                                                                                 |
| 2026-07-28 | Engine ownership   | "Time-driven Recipient follow-through is owned by the **Follow-up Engine**; … **Event Notification Engine** (**D095**, D099)" — no stated scheduling driver                                                                          | Same engine separation, now stating the driver: "driven by the Owner-selected Task due date (**D102–D110**)"                                                                                                                                       | **D102**  | The Follow-up Engine's scheduling driver moved from the retired D095 handoff-interval model to the Owner-selected due date. Engine separation and the escalation-ladder prohibition are unchanged                                                                                                                      |
| 2026-07-28 | Product principles | No principle addressed **measurement**. "Learn preferences, not conversations" governed learning **content** only, and nothing stated that health and performance measurement is a separate class that may not become learning input | Added **"Measurement is not learning."** Also extended **"Human owns decisions"** to state that passive behaviour, inactivity, and the absence of a correction are never approval                                                                  | **D113**  | Recovers a documentation pass that separates business records, audit history, operational telemetry, and structured learning signals. Before P1 introduces any telemetry, the constitution must forbid measurement silently becoming training data or product behaviour. No existing principle was removed or narrowed |
| 2026-07-28 | Product philosophy | "The Android app is the Owner's primary instrument" — could be read as forbidding investment in the Owner **web** experience                                                                                                         | Same principle, **clarified**: Android remains the **intended** primary instrument delivered by **A9**; the web Owner surface is the currently-operational instrument that P1 makes reliable                                                       | **D111**  | Clarification only; the principle is unchanged and Android is not deprioritized. Recorded because P1 invests in the Owner web experience and the unclarified wording invited the wrong inference                                                                                                                       |
| 2026-07-28 | Product principles | No principle addressed **interface truthfulness**. Truthful-outcome behaviour existed only as A7.8 implementation practice, unstated as governing law                                                                                | Added **"Interfaces state what is true."** No optimistic mutation success; an ambiguous outcome stays ambiguous                                                                                                                                    | **D112**  | P1 improves perceived responsiveness across every Owner surface. Elevating the existing A7.8 truthful-outcome practice to a principle prevents loading and skeleton work from drifting into optimistic success. Extends "Human owns decisions" rather than altering it                                                 |
| 2026-08-05 | Product mission    | "Turn ongoing personal business communications into temporary, actionable work…" — described the communication-action loop without stating external-memory / Android ordinary-day framing                                            | Prefaced with **trusted external memory** mission; retained the communication-action loop as how that mission is served; linked [P2_0_OWNER_EXPERIENCE_FOUNDATION.md](P2_0_OWNER_EXPERIENCE_FOUNDATION.md)                                         | **D138**  | P2.0 Product Constitution answers “What kind of product are we building?” without discarding the prior mission wording                                                                                                                                                                                                 |
| 2026-08-05 | Product philosophy | Android described as **intended** primary instrument delivered by A9; web as currently-operational instrument that P1 makes reliable                                                                                                 | Same history preserved; elevated to **Android is the product** — web is administration, review, debugging, and fallback; feature filter added                                                                                                      | **D139**  | Sequencing pivot to Owner Android experience; not an architecture redesign and not a rewrite of D111's historical clarification                                                                                                                                                                                        |
| 2026-08-05 | Success definition | Six success bullets beginning with suggestion trust                                                                                                                                                                                  | Added ordinary-day Android confidence / web-as-fallback readiness (**D144**) as success item 1; renumbered prior bullets                                                                                                                           | **D144**  | Broader operational enablement is a product readiness statement; it does not by itself authorize Stage 12 or A8.7d/e                                                                                                                                                                                                   |
| 2026-08-05 | Product principles | No table rows for Android-as-product, external memory, capture-first, one-handed, simple-by-default, or feature justification                                                                                                        | Added seven P2.0 constitutional principles as product-principle rows                                                                                                                                                                               | **D139**  | Makes the Product Constitution inspectable in the governing file while the full narrative lives in P2.0                                                                                                                                                                                                                |
| 2026-08-05 | Authority order    | Eight-level order without a P2.0 Product Constitution entry                                                                                                                                                                          | Inserted P2.0 Owner Experience Foundation after Approved decisions; renumbered subordinates                                                                                                                                                        | **D137**  | P2.0 is product-constitutional for Owner experience and must not outrank this file or AI law                                                                                                                                                                                                                           |
| 2026-08-07 | Product philosophy | "not a … **general-purpose reminder application**" plus **narrow due-date exception (D102)** prohibiting general-purpose personal reminders and limiting reminders to due-date-driven Recipient follow-through                       | Removed the "general-purpose reminder application" product-law bar; stated **deadline and reminder are separate (D152)** — Owner-controlled Task reminders permitted independently of deadlines; A8 due-date engine remains current implementation | **D152**  | Product direction: Rocket is trusted external memory and follow-through; Owner may decide when an existing Task returns to attention. D102's restrictive ceiling is permanently superseded; A8 behaviour is not redesigned or claimed implemented beyond its due-date engine                                           |
