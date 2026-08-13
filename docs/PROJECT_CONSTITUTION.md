# Project constitution

**Rank 1 — the highest-authority statement of Rocket Communicator's current product law (D153, D158).**

Every other document and every implementation must conform. Where a subordinate document conflicts with this one, the subordinate document is wrong: correct it, or deliberately amend this constitution first.

**Repository provenance (D120).** The repository, the `@aicaa/*` package namespace, the Android application id and `app_name`, the OpenAPI `info.title`, and existing web copy still carry the original working name. That is **provenance**, not product identity; renaming those artifacts is separately authorized implementation work.

AI law: [AI_CONSTITUTION.md](AI_CONSTITUTION.md). Architecture detail: [ARCHITECTURE.md](ARCHITECTURE.md).

---

## What Rocket is

**Rocket Communicator is a mobile-first trusted external memory and follow-through system (D153).**

Rocket exists to become the Owner's trusted external memory, letting them **capture, organize, assign, and follow through** on real work from their phone throughout an ordinary day. It **replaces the Owner's follow-through habit** and **remembers what must happen next**; it does not replace Gmail, Messages, or the Phone app (D138). In service of that mission it turns ongoing personal business communications into temporary, actionable work, so the Owner always knows what needs action, what matters, who owns it, when to follow up, whether it was done, how it was done, and whether completion created the next action. Reminders are **one capability within that system**, not the product's definition (D152).

| Layer                 | What it owns                                                                                                     |
| --------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **Native mobile**     | Owner attention, capture, review, notifications, and device integration                                          |
| **Rocket backend**    | Canonical Task truth, shared intelligence, synchronization, Gmail, external Recipient assignment, follow-through |
| **AI interpretation** | Constrained structured interpretation                                                                            |
| **Web**               | A synchronized, optional companion and external Recipient access surface                                         |

Boundaries every implementation must respect:

- **Mobile is the primary product experience.** **Android is the first native client**; iPhone is a **planned subsequent** client on the same backend intelligence and the same canonical Task system, and is **not current implementation work** (D153, D139).
- **Web is a companion, not the product** — administration, review, debugging, fallback, and Recipient access.
- **One authenticated Owner.** External Recipients act through task-scoped capability links and hold no application account; their surface stays deliberately thin (assignment email, capability link, minimal web task view).
- **Communication content is temporary; workflow intelligence is durable.** Stored excerpts and related temporary content are deleted on policy timers ([DATA_RETENTION.md](DATA_RETENTION.md)).

## Owner authority and the product loop (D154, D161, D164)

**AI proposes. The Owner decides.** Only an affirmative Owner act creates canonical work. Passive behaviour, inactivity, and the absence of a correction are never approval (D113).

The canonical loop is: **communication or capture → interpretation → Owner review → proposals → acceptance → responsibility selection → canonical Task → follow-through → completion.**

- **Capture is AI-first.** Owner typed or dictated input is interpreted before any canonical Task exists.
- **One interpretation may produce 0..N proposed Tasks.** A single utterance is not assumed to be a single Task, and **zero proposals is truthful success** rather than failure (D161).
- **Interpretation is an occurrence** — grouping and provenance truth, not canonical Task truth. Multiple legitimate occurrences may reference the same source; there is no invariant of one interpretation forever per source (D161).
- **The first-pass interpretation is context-free** — it is never personalized from the Owner's history (D154). The enumerated boundary is AI law: [AI_CONSTITUTION.md](AI_CONSTITUTION.md).
- **Acceptance asks exactly one question — “Who is responsible for this Task?”** — answered by the **Owner (Me)** or an external **Recipient**. There is no separate Owner-facing Keep action, and the selection is **affirmative** (D155, D164).
- **Representation is not authorization.** Representing an Owner-review trigger in architecture or schema authorizes no Owner-review API, Review-with-Rocket UI, exclusion, automatic-processing change, notification, cron job, or Production flag (D161).
- **Current implementation is not product law.** The shipped direct Owner capture path was valid for its milestone and remains current implementation only (D158).

This section states product law and authorizes no implementation.

## Follow-through: one canonical Task (D164, D152)

**Responsibility answers who is expected to do the work. It never decides whether Rocket follows through.**

- **One canonical Task and one follow-through model.** An Owner-responsible Task and a Recipient-responsible Task are the same canonical Task. Responsibility must never determine whether a Task participates in Rocket's lifecycle, deadline, reminder, completion, and follow-through concepts, and Rocket must not fragment work into separate Owner and Recipient Task models.
- **A unified question does not require unified persistence.** An Owner-responsible Task may remain the canonical Task with **no active external assignment**; a Recipient-responsible Task uses the existing Recipient, assignment, capability, and handoff machinery. Choosing **Me** requires no assignment to the Owner. **The persistence representation is settled (D168):** the Owner's affirmative selection is a dedicated **append-only responsibility-selection evidence record** in the D155 structured-learning evidence family, recorded **atomically as part of proposal acceptance** when a selection is supplied. It is the Owner's **initial** acceptance-time decision — never canonical Task state, current custody, a current-responsibility projection, or a responsibility-history state machine — and it adds no Task responsibility, assignee, or custody column and no Owner assignment row. Owner selection must be **affirmative**: the absence of that record, of an assignment, of a Recipient, or of a handoff never means **Me** was chosen. Mechanics belong to [ARCHITECTURE.md](ARCHITECTURE.md).
- **Operational representation is not affirmative evidence.** The absence of an active assignment is never evidence that the Owner chose themselves (D155).
- **Selection is not delivery.** The selection is true the moment the Owner makes it; whether Rocket delivered access to an external Recipient remains existing assignment and handoff truth. A failed handoff does not falsify the selection, and recording a selection does not imply delivery.
- **Delegating a Task must never remove it from appropriate Owner oversight.** One Task follow-through event may serve a Recipient work reminder and Owner oversight attention for different purposes, and an Owner-responsible Task may route attention to the Owner without Recipient email machinery.
- **Deadline and reminder are separate (D152).** A Task has **zero or one deadline** and **zero or multiple Owner-controlled reminders**. A deadline answers when work must be done; a reminder answers when Rocket should bring the Task back to the Owner's attention; either may exist without the other. AI never invents reminder times and never silently schedules reminders.
- **Time-driven Recipient follow-through and event-driven Owner alerts are separate engines, not an escalation ladder** (D099, D102–D110). Escalation ladders, Owner CC ladders, and general calendar management as the product's purpose are excluded. Authoritative engine behaviour: [WORKFLOWS.md](WORKFLOWS.md) §10a.

This section states product law and authorizes no implementation: no second reminder engine, no reminder routing or delivery mechanics, no change to A8 reminder processing, and no responsibility persistence.

## Learning: observation now, personalization later (D155)

Rocket **records learning evidence now**, and that evidence is **dormant**.

Acceptance produces two independent facts. The accepted **content** revision answers _what_ the Owner accepted; the affirmative **responsibility selection** answers _who_ the Owner made responsible. Neither collapses into the other or into a generic acceptance outcome, and the selection is historical evidence of the **initial** choice rather than current assignment state (D164).

**Dormant** means recording the evidence changes nothing about how Rocket behaves today, and **personalization is deferred** until its own approved decision. The prohibitions this places on AI: [AI_CONSTITUTION.md](AI_CONSTITUTION.md). Retention and minimization, including manual raw capture input (D162): [DATA_RETENTION.md](DATA_RETENTION.md).

## Product principles

| Principle                                    | Meaning                                                                                                                                                                                                                                                                                                                                                              |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Reduce cognitive load; simple by default** | Prefer short point-form structure, clear next actions, and minimal chrome. Default paths stay short and power features must not obstruct the ordinary day. Rocket should reduce decisions, not create them: where two designs solve the same problem, prefer the one that removes choices, screens, and controls while preserving truthful information (D151, D139). |
| **Capture before complexity**                | Reliable capture of real work precedes elaborate organization and AI pipelines (D139).                                                                                                                                                                                                                                                                               |
| **One-handed first**                         | Ordinary-day mobile use must be workable with one hand (D139).                                                                                                                                                                                                                                                                                                       |
| **Truth over automation**                    | Prefer truthful state over polished guesswork, and never silently invent work or outcomes. The interface must never imply a business mutation succeeded before the server confirms it, and an ambiguous outcome stays ambiguous (D112, D139).                                                                                                                        |
| **Approval before automation**               | Recommendations never silently become business actions, and every approved rule or automation can be disabled, rolled back, or overridden.                                                                                                                                                                                                                           |
| **AI should become quieter as it learns**    | Better filtering and trusted rules should reduce noise, not add prompts.                                                                                                                                                                                                                                                                                             |
| **Learn preferences, not conversations**     | Durable learning stores workflow patterns and preferences — never raw message bodies or private chat history.                                                                                                                                                                                                                                                        |
| **Measurement is not learning**              | Operational telemetry answers only whether the application is working properly. It must never become training data, a learning signal, a business record, or audit history, and must never drive product behaviour (D113). Class definitions: [GLOSSARY.md](GLOSSARY.md).                                                                                            |
| **Privacy first**                            | Minimize prompts and storage, exclude OTP and financial alerts, and respect contact exclusions ([SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md)).                                                                                                                                                                                                                 |
| **Every feature must justify its existence** | A feature earns its place only by making it easier for the Owner to capture, organize, assign, or follow through on real work during an ordinary day — or by serving safety, truthfulness, or administration. Otherwise it belongs later (D139).                                                                                                                     |

## Non-goals

Permanent product non-goals only. **Milestone scope is not a constitutional non-goal** (D158): anything whose meaning is merely "not in version one" — platform, channel, integration, and distribution sequencing — belongs to [MILESTONES.md](MILESTONES.md).

- Permanent storage or search of full communication history
- Replacing Phone, Google Messages, or Gmail as the Owner's primary apps
- Automatic client-facing replies
- Becoming a CRM
- Silent auto-creation of Tasks or silent assignment emails
- Guaranteeing universal device call/notification capture on every OEM

## Success definition

**Broader operational enablement readiness (D144):** the Owner can confidently manage an ordinary working day using the **native mobile application** (Android today) without depending on memory or external notes, while using the **web application** only for administration or fallback (D153). This is a product-readiness bar; it authorizes no operational, production, or feature-flag change.

Beyond that bar, Rocket succeeds when the Owner trusts proposals enough to review them quickly rather than re-read every message; every Recipient handoff is explicitly Owner-approved with a clear audit of who authorized what; assigned work is followed through deterministically until conclusion, without follow-up spam or escalation ladders; completions capture meaningful outcomes, including voice, and can spawn the next approved action; temporary communication data leaves on schedule while durable preferences improve the system; and operating cost and maintenance stay low enough for private, single-operator use.

## One canonical domain (D157, D163)

- **One canonical Task domain**, **one shared proposal path** (no parallel candidate store), and **one shared interpretation capability**. Every native and web client uses the same backend Task and intelligence system.
- **Existing infrastructure is evolved, not duplicated.** A parallel Task model, a second proposal pipeline, or a second interpretation stack requires its own approved architecture decision.
- **A5 source infrastructure is reusable; A6 is preserved compatibility/legacy.** **A6 is not a dependency target for future product development**: new product capability must build on the shared interpretation and proposal architecture rather than extend A6's semantics (D163). Classification detail: [WORKFLOWS.md](WORKFLOWS.md) §1a.

Current implementation names are **not** product law; [ARCHITECTURE.md](ARCHITECTURE.md) identifies which existing modules carry these responsibilities today.

## Architecture Principles

Binding engineering principles for stack, hosting, and infrastructure choices (D079). Detail and examples: [ARCHITECTURE.md](ARCHITECTURE.md).

1. **Architecture before infrastructure** — business logic stays independent of hosting providers and infrastructure services whenever practical.
2. **Vendor-neutral design** — schedulers, storage providers, messaging systems, and cloud services should be replaceable with minimal application change.
3. **Cost-aware engineering** — where solutions are comparable in security, reliability, maintainability, and performance, prefer the lowest recurring operational cost.
4. **Free tiers are first-class citizens** — intentionally target free service tiers that satisfy product requirements. Adopt paid services only for a measurable architectural, operational, or business benefit.
5. **Security is never compromised** — authentication, authorization, auditing, data integrity, and privacy always take precedence over reducing cost.
6. **Keep infrastructure modular** — infrastructure triggers application behaviour rather than containing it; schedulers invoke authenticated endpoints and do not embed business rules.
7. **Simplicity over complexity** — prefer few vendors and simple, maintainable solutions. No microservices, queues, duplicate databases, or premature platforms without a documented need. Fewer components often improve reliability, but performance claims must be validated with evidence.

## Engineering rules

**Engineering Rule #1 — documentation first.** Implementation may never change documented product behaviour without documentation being updated first. If behaviour must change, update the governing and product documents and the decision register **before**, or as the first part of, the implementation work — never as an afterthought.

**Engineering Rule #2 — documentation wins over implementation.** If implementation and documentation disagree, the **implementation is wrong** until documentation is intentionally updated. Do not "fix" docs to match accidental code behaviour without an explicit product decision.

## Authority model (D158)

| Rank                | Document                                                                                                                                                                                                                                                                                                        | What it owns                                                                                                                                                                                                                                          |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1**               | [PROJECT_CONSTITUTION.md](PROJECT_CONSTITUTION.md) (this file)                                                                                                                                                                                                                                                  | Current product law: mission and identity, Owner authority and the product loop, responsibility and follow-through, product principles, non-goals, Architecture Principles, the engineering rules, and this authority model                           |
| **2**               | [AI_CONSTITUTION.md](AI_CONSTITUTION.md)                                                                                                                                                                                                                                                                        | AI-specific law: what AI may interpret and propose, what it may never invent or decide, and the learning ladder                                                                                                                                       |
| **3**               | [DECISIONS.md](DECISIONS.md)                                                                                                                                                                                                                                                                                    | Current binding discrete decisions and the durable amendment/supersession record: identity, status, the operative decision, boundaries, and why it changed. It **points to** the owning document for current detail rather than duplicating it (D165) |
| **4**               | Domain contracts: [ARCHITECTURE.md](ARCHITECTURE.md), [API_CONTRACT.md](API_CONTRACT.md) / OpenAPI, [SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md), [WORKFLOWS.md](WORKFLOWS.md), [DATA_RETENTION.md](DATA_RETENTION.md)                                                                                    | Their own domain under ranks 1–3: how it is built and which module carries which responsibility; the wire contract; authorization and privacy; step-by-step behaviour (§10a authoritative for reminders); deletion, retention, and the Gmail boundary |
| **4 (scoped)**      | [../BRAND.md](../BRAND.md) (D172)                                                                                                                                                                                                                                                                               | One scoped presentation domain under ranks 1–3: Rocket Communicator product branding, visual language, UI presentation, and interaction presentation                                                                                                  |
| **Below authority** | [MILESTONES.md](MILESTONES.md) / roadmap, [REVIEW_CHECKLIST.md](REVIEW_CHECKLIST.md), [ENGINEERING_WORKFLOW.md](ENGINEERING_WORKFLOW.md), [DEPLOYMENT.md](DEPLOYMENT.md), [../README.md](../README.md), [GLOSSARY.md](GLOSSARY.md), [OPEN_QUESTIONS.md](OPEN_QUESTIONS.md), planning documents, package READMEs | Describe, sequence, enforce, or navigate — never product law: what ships and when; review gates; contributor process; production state; orientation; terms; unresolved questions                                                                      |

The list is exhaustive: every active document sits at one of these ranks, and a document not named here is **below authority**.

Conflict resolution:

- A lower-rank document may **describe and enforce** higher-rank law. It may **not originate contradictory product law**; where it does, the lower-rank document is wrong.
- **[../BRAND.md](../BRAND.md) is authoritative only within its scope (D172):** branding, visual language, UI presentation, and interaction presentation. It must not originate or override behavioural product law, architecture, API/contracts, security/privacy, authentication/authorization, persistence/data semantics, or roadmap sequencing; where it appears to, ranks 1–3 and the relevant domain contract control and BRAND.md is wrong. It states the presentation **target** and authorizes no implementation change by itself.
- **Milestone scope is not permanent product law** unless deliberately elevated into ranks 1–3.
- **Current implementation truth is not automatically permanent product law.**
- **Historical material is never current law**, wherever it appears.
- Where documents still conflict, the newer **Approved** decision controls.
- A **withdrawn clause is removed** from the active text, not annotated in place.

## Amendment

Amend this constitution only deliberately: record the change as an **Approved** entry in [DECISIONS.md](DECISIONS.md), update dependent documents, and note the reason. Silent drift is forbidden.

No amendment history is kept here. DECISIONS is that record, and withdrawn wording is **removed** from the sections above rather than preserved beside an explanation of its supersession, so current law can be read without reconstructing a supersession chain.
