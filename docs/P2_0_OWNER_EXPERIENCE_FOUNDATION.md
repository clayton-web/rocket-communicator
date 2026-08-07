# P2.0 — Owner Experience Foundation

**Status:** Complete (documentation and constitutional lock only).  
**Authority:** [DECISIONS.md](DECISIONS.md) **D137–D144**. Governed by [PROJECT_CONSTITUTION.md](PROJECT_CONSTITUTION.md). Sequencing: [MILESTONES.md](MILESTONES.md).

This milestone answers one question:

> **What kind of product are we building?**

It does **not** implement Android code, change production, alter feature flags, continue Stage 12, or continue A8.7d / A8.7e. Architecture is unchanged. Completed milestones, Decisions, contracts, production evidence, and Gate 6 documentation remain valid. Only **roadmap sequencing** is intentionally reordered.

---

## Product Constitution

### Core mission

Rocket exists to become the Owner's **trusted external memory**, allowing them to **capture, organize, assign, and follow through** on real work from their **Android phone** with confidence throughout an ordinary day.

Rocket **replaces the Owner's follow-through habit**.

It does **not** replace Gmail.  
It does **not** replace Messages.  
It does **not** replace the Phone app.

It **remembers what must happen next**.

### Constitutional principles

| #   | Principle                                                  | Meaning                                                                                                                                                                           |
| --- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Android is the product**                                 | The Owner's primary instrument is the Android application. Web exists for administration, review, debugging, and fallback — not as the intended day-to-day Owner surface.         |
| 2   | **Rocket is an external memory, not an inbox replacement** | Rocket remembers what must happen next. It does not become the place the Owner reads mail, chats, or takes calls.                                                                 |
| 3   | **Truth over automation**                                  | Prefer a truthful, incomplete state over a polished guess. Interfaces state what is true (D112). Humans own decisions. Automation never silently invents work or outcomes.        |
| 4   | **Capture before complexity**                              | Getting real work into Rocket reliably beats elaborate organization, AI pipelines, or secondary surfaces that do not help capture.                                                |
| 5   | **One-handed first**                                       | Ordinary-day use on an Android phone must be workable with one hand. Interaction cost is a product constraint, not polish.                                                        |
| 6   | **Simple by default**                                      | Default paths stay short. Power and edge cases may exist later; they must not obstruct the ordinary day.                                                                          |
| 7   | **Every feature must justify its existence**               | A feature earns a place only if it makes capture, organize, assign, or follow-through easier during an ordinary day — or is required for safety, truthfulness, or administration. |

### Product philosophy (feature filter)

Future features should answer:

> Does this make it easier for the Owner to **capture, organize, assign, or follow through** on real work during an ordinary day?

If not, it likely belongs later.

**Reduce decisions:**

> Rocket should reduce decisions, not create them.  
> When two designs solve the same problem, prefer the one that removes choices, screens, and controls while preserving truthful information.

(Applied concretely to the planned P2.2a People slice — planning only; see [P2_2A_PEOPLE.md](P2_2A_PEOPLE.md) / **D151**. Does not authorize implementation or advance past Owner Acceptance Week.)

### Definition of success (broader operational enablement)

Rocket is considered ready for broader operational enablement when the Owner can confidently manage an ordinary working day using the **Android application** without depending on memory or external notes, while using the **web application** only for administration or fallback.

This is a **product readiness statement**. It does not authorize Stage 12, A8.7d, A8.7e, flag changes, or production procedures by itself. Those retain their own authorization gates.

### Relationship to existing governing law

- [PROJECT_CONSTITUTION.md](PROJECT_CONSTITUTION.md) remains the highest-level governing document. P2.0 **amends** its product mission and Android-primary philosophy; it does not replace engineering rules, Architecture Principles, or AI law.
- [AI_CONSTITUTION.md](AI_CONSTITUTION.md) remains authoritative for AI behaviour. P2.0 does not authorize AI capture, automatic transcription, or silent automation.
- A0–A8.6, P1, Gate 6, production safety, documentation, evidence, contracts, and architecture remain valid.
- D102's narrow due-date exception, D111–D120 (P1 web foundation), D131 (sole system of record), and D132 (online-first) remain operative.

---

## P2.0 success criteria

P2.0 is **documentation only**. Completion requires:

- [x] Product Constitution exists (this document)
- [x] Mission statement exists
- [x] Android-first philosophy is documented
- [x] Owner Acceptance Week is a formal product gate
- [x] P2.2 — Remove Friction exists on the roadmap
- [x] A9.2 is named **Android Task Capture** with capture scope clarified
- [x] Roadmap sequencing is internally consistent
- [x] Historical evidence remains accurate (no history rewrite)
- [x] No code, APIs, production contact, or feature-flag changes

---

## Intentional roadmap re-sequencing

**Supersession note.** Prior delivery narrative treated remaining A8 operational enablement (Stage 12 → A8.7d → A8.7e) as the immediate next operational path after Gate 6, and described the long-range order as **A7 → A8 → A9** with **no early separate A9.0**. That sequencing is **intentionally superseded for next-work order only** by D140. Milestone identifiers are not renumbered. Architecture is not redesigned. Gate 6 evidence and Stage 12 / A8.7d / A8.7e procedures remain accurate and **paused / unauthorized**.

### Forward sequence

```text
P2.0  Owner Experience Foundation (docs — this lock)
  ↓
A9.0  Android Owner foundation
  ↓
A9.1  Android Owner shell and ordinary-day Task surfaces
  ↓
A9.2  Android Task Capture
  ↓
A9.3  Android organize, assign, and follow-through
  ↓
Owner Acceptance Week  (formal product gate)
  ↓
P2.2  Remove Friction
  ↓
Stage 12  (capture-only observation — still separately authorized)
  ↓
A8.7d
  ↓
A8.7e
  ↓
A10+
```

### Explicitly paused

| Item                    | Status after P2.0                                               |
| ----------------------- | --------------------------------------------------------------- |
| Stage 12                | Prepared, **unauthorized**, **unbegun** — not continued by P2.0 |
| A8.7d                   | **Unauthorized**, **unbegun** — not continued by P2.0           |
| A8.7e                   | **Unauthorized**, **unbegun** — not continued by P2.0           |
| Production flag changes | **None** authorized by P2.0                                     |
| Architecture redesign   | **None** — sequencing change only                               |

---

## A9 — Android Owner interface (slice map)

A9 delivers the Owner's primary instrument. Detail for each implementation slice is established when that slice is authorized. P2.0 locks names, order, and the A9.2 capture boundary.

| Slice    | Name                                         | Intent                                                                                                                                                                                                                                                                                              |
| -------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A9.0** | Android Owner foundation                     | Sideloadable Owner app foundation: authentication against existing Owner session APIs, secure session handling, and the minimum shell needed to begin ordinary-day work. Decision and contract alignment as required by Engineering Rule #1 — still no production enablement of paused A8 delivery. |
| **A9.1** | Android Owner shell and Task surfaces        | Navigation and day-to-day Task / suggestion surfaces so the Owner can review, open, and act on real work on the phone.                                                                                                                                                                              |
| **A9.2** | **Android Task Capture**                     | Reliable capture of real work on Android.                                                                                                                                                                                                                                                           |
| **A9.3** | Android organize, assign, and follow-through | Organize, assign/handoff, and follow through on captured work from Android so an ordinary day can close without depending on web.                                                                                                                                                                   |

### A9.2 — Android Task Capture (locked naming and boundary)

**Includes:**

- Typed capture into Task fields
- Android speech-to-text **into fields** (OS / keyboard dictation into the capture UI)

**Does not include:**

- The A12 voice pipeline
- Automatic transcription as a product pipeline
- AI capture (AI-created Tasks or silent extraction from speech)

Manual / spoken field entry remains capture. Voice that creates Tasks directly remains prohibited (D038). A12 remains a later milestone.

**Historical naming note.** Earlier informal phrasing “Android Task Creation” is retired in favour of **Android Task Capture** (D141). No prior milestone identifier is renumbered.

---

## Owner Acceptance Week (formal product gate)

Owner Acceptance Week (**OAW**) is a **formal product gate**, not informal feedback. It sits after A9.3 and before P2.2.

**Canonical plan (scenarios, daily checklists, evidence, severity, go/no-go):** [OWNER_ACCEPTANCE_WEEK.md](OWNER_ACCEPTANCE_WEEK.md).

### Purpose

Prove that Rocket can serve as the Owner's trusted external memory for an ordinary working week on Android, with web used only for administration or fallback.

### Measurable exit criteria

OAW passes only when **all** of the following are true and recorded:

1. **Rocket is the primary task system** for the Owner during the acceptance window — not a secondary notebook beside another personal system for the same ordinary work.
2. **Real work is captured daily** on Android (not demo-only or synthetic-only usage).
3. **At least one real Recipient handoff is completed** end-to-end during the window (real delegated work, not solely a local dry-run).
4. **External notes are no longer required for ordinary follow-through** — the Owner does not need a parallel notebook, sticky system, or memory crutch for the ordinary day's must-happen-next items.
5. **Usability issues are documented** (including severity and whether they block confidence), whether or not they are fixed during the week.
6. **The Owner explicitly approves resuming operational enablement** on the paused path (Stage 12 → A8.7d → A8.7e), or explicitly withholds approval. Silence is not approval (D113).

Failing OAW does **not** authorize skipping to Stage 12. Findings feed **P2.2 — Remove Friction** before operational enablement resumes.

---

## P2.2 — Remove Friction

**Purpose:** Improve the Android experience using findings from Owner Acceptance Week.

**Not in scope:** Major new features, architecture redesign, inbox replacement, A12 voice pipeline, AI capture, or production delivery enablement.

**In scope (examples):**

- Reduce taps
- Improve wording
- Navigation improvements
- Consistency
- Visual polish
- Performance
- Ergonomics (including one-handed use)

**Planned first slice (documentation only):** **P2.2a — People** (**D151**). Canonical plan: [P2_2A_PEOPLE.md](P2_2A_PEOPLE.md). Direction: keep recency order; add a server-side **People** filter (Everyone / Me / individual Recipients); display names as primary identifiers; Android-local remember of the last filter. **Not started. Not authorized for implementation.** Owner Acceptance Week remains the next execution gate. P2.2a does not replace OAW-driven polish and does not pull sort/search/Recipient-page/CRM work into P2.2.

**Success:** Documented OAW friction items that block ordinary-day confidence are addressed or explicitly deferred with Owner acknowledgment, such that the Definition of success above remains credible before Stage 12 authorization is considered.

---

## Binding decisions

| ID       | Topic                                                       |
| -------- | ----------------------------------------------------------- |
| **D137** | P2.0 scope — documentation-only Owner Experience Foundation |
| **D138** | Core mission — trusted external memory                      |
| **D139** | Product Constitution principles                             |
| **D140** | Intentional roadmap re-sequencing after Gate 6              |
| **D141** | A9 slice map; A9.2 = Android Task Capture                   |
| **D142** | Owner Acceptance Week as formal product gate                |
| **D143** | P2.2 — Remove Friction                                      |
| **D144** | Definition of success for broader operational enablement    |
| **D151** | P2.2a — People (planning lock only; after OAW)              |

---

## What P2.0 does not change

- Architecture Principles and package boundaries
- OpenAPI / API contracts
- Production procedures, Gate 6 evidence, or Stage 12 runbook content (except sequencing supersession notes)
- Feature flags or scheduler state
- Completed milestone history (A0–A8.6, P1, incident slices, Gates 4–6)
- AI ladder or never-invent rules
