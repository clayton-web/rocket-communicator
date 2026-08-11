# Rocket Communicator — Brand Guide

**Status:** Documentation guidance only.  
**Authority:** Below authority. Subordinate to [docs/PROJECT_CONSTITUTION.md](docs/PROJECT_CONSTITUTION.md). Describes current brand, voice, and application surfaces; does **not** define product architecture and does **not** amend Decisions, OpenAPI, or milestones.  
**Source material:** Adapted from a sibling Rocket product brand note used as **reference only**. That source’s inspection workflows, tenant/report language, dark/red palette, and implementation prompts are **not** approved for this product.

---

## Governance (read first)

| Rule                                    | Meaning                                                                                                                                                                                                                                                                                                                                     |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Guidance, not redesign authority        | This file describes identity, voice, and visual _policy_. It does **not** authorize restyling Android, web, tokens, or components.                                                                                                                                                                                                          |
| Application changes need their own gate | UI, token, or copy changes require separate roadmap authorization (Decision and/or milestone slice).                                                                                                                                                                                                                                        |
| Owner Acceptance Week                   | **Deferred — must not be executed** (**D159**). D142 still defines the gate; sequencing and exit criteria: [docs/MILESTONES.md](docs/MILESTONES.md).                                                                                                                                                                                        |
| After OAW                               | **P2.2 — Remove Friction** (D143). Nothing after OAW is authorized without a separate decision.                                                                                                                                                                                                                                             |
| P2.2a — People (planning)               | Planned first slice inside P2.2 (**D151** / MILESTONES). **Planning only — does not authorize implementation.**                                                                                                                                                                                                                             |
| People filter (Task list)               | Approved future shape under P2.2a: keep recency (`updatedAt` DESC, `id` DESC); Android-first **People** filter **Everyone / Me / individual Recipients**; server-side so cursor pagination stays truthful; display names primary; Android local remember of last filter; no Task sorting, search, Recipient pages, or server prefs in P2.2. |
| Naming                                  | The product is **Rocket Communicator** / **Rocket** (**D153**; D120 closed). Shipped artifacts — package namespace, application id, OpenAPI `info.title`, web copy — still carry the original working name as **repository provenance**; renaming them is separately authorized implementation work and is not authorized by this file.     |

Label certainty honestly:

- **Approved** — established by shipped tokens, Decisions, or [docs/PROJECT_CONSTITUTION.md](docs/PROJECT_CONSTITUTION.md).
- **Provisional** — matches current UI practice but is not a locked brand system.
- **Future exploration** — may be considered later; not approved.
- **Requires product approval** — must not be treated as decided.

---

## Brand purpose

**The Owner’s trusted external memory.**

Rocket exists so the Owner can **capture, organize, assign, and follow through** on what must happen next — with confidence through an ordinary day — without relying on parallel notes or memory alone.

---

## Product positioning

| Principle          | Statement                                                                                                                                                                            |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Primary surface    | The Owner’s primary instrument is the native mobile client; Android is the one that ships today. Product architecture: [docs/PROJECT_CONSTITUTION.md](docs/PROJECT_CONSTITUTION.md). |
| Web role           | Administration, review, debugging, and fallback — not the intended day-to-day Owner surface.                                                                                         |
| What Rocket does   | Remembers what must happen next.                                                                                                                                                     |
| What Rocket is not | Not a replacement for Gmail, Messages, or Phone. Not a conventional task manager, calendar manager, inbox replacement, or permanent communication archive.                           |

Core feeling: **dependable instrument, not theatre.**  
Avoid inspection-field or “mission control for property work” metaphors. This product is about ordinary follow-through, not site inspections or printable reports.

---

## Brand personality

- **Calm** — steady, unhurried; never frantic.
- **Direct** — say the thing; short labels.
- **Dependable** — prefer a truthful incomplete state over a polished guess.
- **Focused** — one job per screen; simple by default.
- **Confident without theatrics** — no hype, glow, or “AI magic” framing.
- **Practical rather than futuristic** — field-ready language for real work, not sci-fi chrome.

---

## Writing and UX voice

### Do

- Plain language and short labels.
- Sentence case for buttons and labels unless a formal proper name requires otherwise.
- State what is true (loading, empty, error, ambiguous, offline) — see D112.
- Prefer ordinary words over jargon when both are accurate.
- Name the action: Save, Assign, Complete, Dismiss, Try again.

### Do not

- Exaggerated AI language (“smart,” “magical,” “auto-handles everything”).
- Guilt, pressure, or productivity-shaming (“You’re behind,” “Don’t forget again”).
- Claiming success before the server confirms it.
- Claiming offline capability the product does not have (online-first; D132).
- Claiming reminder or notification delivery is live when flags and gates say it is not.

### Preferred vs avoided copy (examples)

| Preferred                   | Avoided                                     |
| --------------------------- | ------------------------------------------- |
| Saved                       | Synced to the cloud and verified everywhere |
| Owner work (unassigned)     | Unowned / orphaned task                     |
| Assigned to Alex            | Delegated to resource                       |
| Delivery failed — try again | Oops! Something went wrong with AI handoff  |
| Waiting                     | Paused by the system                        |
| Could not confirm delivery  | Definitely not received                     |
| Capture                     | Quick-add productivity sprint               |
| Sign in                     | Launch your mission                         |

---

## Visual principles

| Principle            | Guidance                                                                                                              |
| -------------------- | --------------------------------------------------------------------------------------------------------------------- |
| One-handed first     | Ordinary-day use on a phone must work with one hand; interaction cost is a product constraint.                        |
| Strong hierarchy     | Title → status → secondary meta; one primary action.                                                                  |
| High contrast        | Readable ink on paper/stone surfaces; muted text for secondary only.                                                  |
| Generous tap targets | Meet or exceed the current minimum target token (see below).                                                          |
| Restrained motion    | Shipped Owner web motion is none; do not add animation casually. Respect reduced-motion if motion is ever authorized. |
| Simple by default    | No decorative cards, badge clusters, or promo chrome unless interaction requires a container.                         |
| Avoid clutter        | No stat strips, pill clusters, or competing headlines on the primary capture/list surfaces.                           |

**Approved current visual system:** light / stone surfaces with teal accent on Owner web (D116 tokens). Android currently uses a light Material theme with a similar light canvas in Owner screens — **provisional** parity, not a generated shared token pipeline.

**Not approved:** adopting a sibling product’s dark canvas + rocket-red primary system, rounded “card-first” inspection layouts, or report/print white+red hierarchy as Communicator defaults. Those may be noted only as **source inspiration (not approved)**.

---

## Accessibility

| Requirement    | Guidance                                                                                                                     |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Touch targets  | Prefer at least the shipped web minimum `--aicaa-target-min` (**2.75rem** ≈ 44px). Larger is better for one-handed use.      |
| Contrast       | Aim for WCAG AA for body text and essential controls on the light surfaces in use.                                           |
| Type size      | Prefer readable body sizes at or above the shipped `md` scale; do not shrink critical status text to fit badges.             |
| Color          | Status must not rely on color alone — always pair with a text label.                                                         |
| Keyboard / SR  | Web Owner and Recipient surfaces must remain operable with keyboard focus and sensible semantics where those surfaces exist. |
| Reduced motion | Today web motion is none. If motion is later authorized, honor `prefers-reduced-motion`.                                     |

---

## Logo and naming

| Item                         | Status                    | Guidance                                                                                                                                                             |
| ---------------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Full name (brand voice)      | Approved (D153)           | **Rocket Communicator**                                                                                                                                              |
| Short reference              | Approved (D153)           | **Rocket** when the product is already clear in context                                                                                                              |
| Formal repo / contract title | Current implementation    | **AI Communication Action Assistant** — provenance only, pending an authorized rename slice                                                                          |
| Logo / wordmark / icon set   | Requires product approval | No approved Communicator logo pack is defined in-repo. Do not import inspection logos, report marks, tenant branding, or flame-clearspace rules from other products. |
| Asset paths                  | Future exploration        | Any future assets would need an approved location and Decision; do not invent `/public/brand/…` as authorized.                                                       |

---

## Color and typography policy

### Approved — Owner web semantic tokens (D116)

Source of truth: [`packages/ui/tokens.css`](packages/ui/tokens.css). Values are pinned; changing them is a visual product change, not a drive-by edit.

**Surfaces and text**

| Token                      | Value     |
| -------------------------- | --------- |
| `--aicaa-color-ink`        | `#1c1917` |
| `--aicaa-color-muted`      | `#57534e` |
| `--aicaa-color-paper`      | `#f5f5f4` |
| `--aicaa-color-line`       | `#d6d3d1` |
| `--aicaa-color-accent`     | `#0f766e` |
| `--aicaa-color-surface`    | `#fff`    |
| `--aicaa-color-canvas-top` | `#fafaf9` |

**State (always with text labels)**

| Token                    | Value     |
| ------------------------ | --------- |
| `--aicaa-color-positive` | `#15803d` |
| `--aicaa-color-critical` | `#b91c1c` |
| `--aicaa-color-caution`  | `#b45309` |

**Type**

| Token                | Value                                                                              |
| -------------------- | ---------------------------------------------------------------------------------- |
| `--aicaa-font-sans`  | `'Segoe UI', system-ui, -apple-system, sans-serif`                                 |
| `--aicaa-font-serif` | `'Iowan Old Style', 'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif` |

Type scale, spacing, focus rings, and `--aicaa-target-min: 2.75rem` are defined in the same file.

**Shape and motion (approved current truth)**

- Radius tokens are **`0`** (square controls/surfaces).
- Motion duration/transition tokens are **`none` / `0s`**.

### Provisional — Android

- Theme parent: Material Light, no action bar (`Theme.Aicaa`).
- Owner list/capture screens currently use a light paper-like canvas and dark ink consistent with the web stone/ink direction.
- There is **no** authorized Kotlin token generation or shared design-system package. Parity is by re-implementing documented rules (D116), not by copying CSS.

### Future exploration / not approved

| Idea                                                           | Status                                                         |
| -------------------------------------------------------------- | -------------------------------------------------------------- |
| Dark mode Owner UI                                             | Future exploration; explicitly not a P1 requirement            |
| Rocket-red primary (`#E10613` family) from sibling brand notes | Source inspiration only — **not** approved Communicator tokens |
| Inter as a required webfont                                    | Not approved; would need licensing and product approval        |
| Pill-heavy / card-heavy inspection-style chrome                | Not aligned with simple-by-default Communicator UI             |
| Shared cross-platform token codegen                            | Requires product/architecture approval                         |

---

## Component guidance

Guidance for tone and behavior. **Not** a component library and **not** a redesign brief.

### Task capture

- **Presentation target (D154, D164):** AI-first interpretation → proposal review → accept and answer **one** question, “Who is responsible for this Task?” — **Me** or a **Recipient**. Never offer a separate **Keep** action beside **Assign**. Brand surfaces that story; it does not invent the workflow.
- **Interim current UI (D154):** direct Save → `POST /api/v1/tasks` remains shipped on Android/web until the AI-first path is authorized. Do not brand the interim path as the permanent Rocket experience.
- Fastest path from the shell to “what must happen next.”
- Success only after server confirmation.
- Unassigned create = Owner work. Do not force assign on capture.

### Task list

- Preserve server recency order (`updatedAt` descending, then `id` descending) unless a later Decision changes list semantics. Recency is not replaced by alternate sorts.
- Show status and ownership (Owner work vs assigned) in plain language.
- Prefer Recipient **display name** as the primary human identifier; show email as secondary (e.g. name on the first line, email on the second).
- Avoid inventing filters or sorts in the client that lie across paginated pages.
- **People** filter (Everyone / Me / individual Recipients), when built under planned **P2.2a** after OAW, must be server-side and Android-first; changing the filter resets pagination (**D151**).

### Reduce decisions

- Rocket should reduce decisions, not create them.
- When two designs solve the same problem, prefer the one that removes choices, screens, and controls while preserving truthful information.

### Status labels

- Use established presentation labels (Open, In progress, Waiting, Completed, Dismissed, etc.).
- Pair tone/color with text.
- Delivery failure may surface when the Owner must notice; do not spam “pending” on every assigned row.

### Recipient selection

- Recipients come from Owner-managed records.
- Selection is part of handoff confirmation, not silent auto-assign.
- Confirm before send; disclose truthful delivery/follow-up limits.
- Do not imply a Recipient has the work before the send is confirmed, or that a failed handoff undid the Owner's choice.

### Empty states

- Calm, short, actionable (“No Tasks yet” + how one appears).
- Do not invent fake sample work.

### Errors and connectivity

- Truthful, retryable where appropriate.
- Never imply a write succeeded when it did not.
- Ambiguous outcomes stay ambiguous until an authoritative read settles them.

### Confirmations

- One clear confirm for irreversible or externally visible actions (handoff, dismiss).
- Say what will happen in ordinary language; do not over-promise side effects that are not operational.

### Destructive or irreversible actions

- Use critical tone + explicit verb (Dismiss, Remove due date).
- Prefer confirm for external or hard-to-undo effects.
- Do not hide destructive actions behind icons alone.

---

## Roadmap reminder (brand work does not move gates)

Sequencing lives in [docs/MILESTONES.md](docs/MILESTONES.md), not here. Owner Acceptance Week is deferred (D159); A8 operational enablement remains separately authorized and is outside this guide.

---

## What this file must never become

- An authorization to restyle the app to match another Rocket product.
- A vehicle for tenant, personal, or organization-specific marketing copy.
- An embedded implementation prompt that edits tokens or UI without a Decision.
- A silent closure of any Open Decision, or a rename of shipped artifacts without its own authorized slice.

When in doubt: keep the interface calm, truthful, and simple — and leave visual invention for an authorized slice.
