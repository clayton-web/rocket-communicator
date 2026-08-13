# Rocket Communicator Brand and Product UI Authority

## 1. Purpose and authority

This document is the product-level branding and UI authority for **Rocket Communicator**.

```text
Rocket Logic
├── Rocket Inspections
└── Rocket Communicator
```

- **Rocket Logic** is the upstream authority for corporate identity.
- **Rocket Communicator** owns its product-specific UI/design decisions within that framework.
- **Rocket Inspections** is a sibling product and visual-kinship reference only. It is not Communicator's brand authority.

Communicator inherits Rocket Logic's naming architecture, corporate identity, logo direction, accessibility and truthful-branding principles, typography direction, high-level action semantics, Rocket red `#E10613`, Rocket dark `#050506`, and Rocket navy `#10172F`.

This file does not duplicate the Rocket Logic master guide. Communicator-specific rules below do not automatically apply to other Rocket products.

**Authority scope (D172).** This is a **scoped rank-4 domain authority** for Communicator branding, visual language, UI presentation, and interaction presentation ([PROJECT_CONSTITUTION.md § Authority model](docs/PROJECT_CONSTITUTION.md#authority-model-d158)). It is subordinate to ranks 1–3 and originates no behavioural product law, architecture, API/contract, security/privacy, authorization, persistence, or roadmap sequencing. It defines the canonical product-brand/UI **target**; it does not by itself authorize changes to shipped implementation. Implementation changes occur through separately authorized roadmap/implementation slices.

## 2. Product identity

Rocket Communicator is an Owner-focused product for task capture, interpretation, proposal review, responsibility selection, and follow-through.

> **Rocket proposes. The Owner decides.**

```text
Owner capture → shared interpretation → 0..N proposals → Owner review
→ Owner decision → canonical Task only after acceptance
```

A proposal is not a Task. AI interpretation is assistive and must never be presented as the final Owner decision.

The product should feel like a **command centre for turning messy communication into clear action**.

## 3. Brand direction

Target qualities: **fast, focused, trustworthy, calm, high-contrast, professional**.

Use:

- dark operational presentation;
- Rocket-red primary actions;
- dark/neutral supporting surfaces;
- white and muted-grey text hierarchy;
- green positive/success states;
- amber warning/attention states;
- distinct destructive/error treatment;
- mobile-first usability.

Visual kinship with Rocket Inspections may come from dark presentation, red primary actions, green positive states, raised dark surfaces, muted secondary text, thin borders, strong contrast, large touch targets, and concise copy.

Do not copy Inspection-specific workflows, taxonomies, components, implementation patterns, or exact palette values. Avoid cute, playful, ornamental, or visually noisy UI.

## 4. Colour system

### Corporate inherited colours

| Role        | Value     | Use                                             |
| ----------- | --------- | ----------------------------------------------- |
| Rocket red  | `#E10613` | Corporate identity and ordinary primary actions |
| Rocket dark | `#050506` | Core dark foundation/background                 |
| Rocket navy | `#10172F` | Corporate supporting colour where appropriate   |

### Communicator product tokens

These values belong to Rocket Communicator; they are not universal Rocket standards.

| Token          | Value     |
| -------------- | --------- |
| Background     | `#050506` |
| Surface        | `#0B0B0D` |
| Raised surface | `#121216` |
| Soft surface   | `#18181D` |
| Border         | `#2B2B33` |
| Strong border  | `#454550` |
| Primary text   | `#F5F5F7` |
| Muted text     | `#A1A1AA` |
| Subtle text    | `#7C7C87` |
| Disabled text  | `#52525B` |

### Semantic colours

| Role                           | Value     |
| ------------------------------ | --------- |
| Success/positive               | `#22C55E` |
| Warning/attention              | `#F59E0B` |
| Critical/destructive           | `#EF4444` |
| Strong neutral focus indicator | `#D4D4D8` |

### Supporting presentation colours (D173)

Communicator-owned product colours added as optional supporting presentation tools. They are not Rocket Logic corporate colours, not status semantics, and not replacements for any value above.

| Role             | Value     | May be used for                                                                                         |
| ---------------- | --------- | ------------------------------------------------------------------------------------------------------- |
| Cool surface     | `#171A21` | Selected rows, quiet informational panels, subtle differentiated regions, restrained emphasis           |
| Cool border      | `#343946` | Selected or active boundaries, informational separation, subtle cool-toned structural emphasis          |
| Info/interactive | `#8FA3BF` | Restrained informational text and icons, links where contrast permits, non-primary interactive emphasis |

Cool surface must not become the default surface merely because it exists. Cool border must not be assumed to satisfy accessibility-critical 3:1 boundary contrast — it reaches at most 1.77:1, against `#050506`, and less against every raised surface — so verify the actual adjacent-surface contrast before relying on it. Info/interactive must not be used for primary actions, success, warning, or destructive/error, and is not a general decorative accent.

`#8FA3BF` measures 7.9:1 on `#050506` and at least 6.7:1 on every surface named in this document, so it clears the AA normal-text target throughout. No further chromatic colour is authorized.

**On-primary (D173).** The foreground of a filled `#E10613` primary action is `#FFFFFF` (4.96:1). This is a separate role from primary text `#F5F5F7`; do not substitute one for the other.

**Neutral/informational:** prefer the dark-neutral system unless another semantic colour is genuinely necessary. Do not mechanically reuse Rocket Inspections' similar primary red as Communicator's ordinary primary colour.

Never communicate status by colour alone.

### Contrast evidence

Measured against the `#050506` background (WCAG 2.x sRGB relative luminance): `#F5F5F7` 18.7:1, `#A1A1AA` 8.0:1, `#7C7C87` 4.9:1, `#22C55E` 8.9:1, `#F59E0B` 9.5:1, `#EF4444` 5.4:1, `#D4D4D8` 13.8:1. Each clears the WCAG AA 4.5:1 normal-text target against the background.

Contrast against raised and soft surfaces is lower and must be checked per surface — subtle text `#7C7C87` measures 4.3:1 on `#18181D` and does not meet the normal-text target there.

### Primary versus destructive

`#E10613` is the canonical primary-action colour, normally used as a **filled** primary-action treatment with appropriate contrasting text: white on filled `#E10613` measures 5.0:1, while `#E10613` as text on `#050506` measures 4.1:1 and fails the normal-text target. It is not the generic colour for navigation, links, focus, borders, informational chrome, or every interactive element.

`#EF4444` is the critical/destructive semantic colour. Ordinary primary actions and destructive actions must remain visually distinguishable.

### No replacement decorative accent

S4 does not introduce a general decorative accent that competes with Rocket red or floods ordinary UI chrome. Rocket Communicator may use the restrained supporting informational/interactive colour `#8FA3BF` only for the limited roles authorized by D173. Ordinary non-primary interactive presentation uses the neutral system — text hierarchy, dark and raised surfaces, borders, strong borders, neutral focus treatment, and typography or weight where appropriate — with `#D4D4D8` where an explicit strong neutral focus indicator is required, so Rocket red does not flood general UI chrome.

## 5. Typography

**Inter** is the canonical Rocket Logic sans-serif direction. This does not require an immediate Android font dependency; migration timing is controlled separately.

Prioritize readability, native performance, compact headings, short body copy, sentence case, clear hierarchy, and mobile scanning. Do not require monospace or oversized display typography.

## 6. Layout and visual hierarchy

- Put the current decision or next meaningful action in the strongest visual position.
- Keep the primary action unmistakable; let secondary actions recede appropriately.
- Do not give every control equal visual weight.
- Prefer spacing, typography, contrast, and thin borders over decorative containers.
- Keep operational information scannable without excessive badges or cards.
- Preserve strong contrast across dark surfaces.
- Avoid unnecessary chrome and repeated labels.

**Shape (D172).** Existing per-platform shape behaviour is preserved and no radius or shape system is established here: Android's existing Material 3 default shapes may remain, and existing Recipient-specific radii may remain. Do not square Android controls, and do not introduce a rounded-card or pill system, as part of brand alignment.

Radius, shape language, and motion may evolve only through deliberate later product decisions. Do not invent a motion system.

## 7. Components and interaction semantics

**Primary actions:** use Rocket red for the single most important ordinary action in a context, such as **Capture**, **Accept**, **Start**, or **Complete** when it is the clear next action. Avoid competing red actions in one decision area.

**Secondary actions:** use neutral surfaces, borders, or restrained text treatment for actions such as **Edit**, **Wait**, **Resume**, and **Add note** when secondary.

**Destructive actions:** **Dismiss** and other destructive/critical actions must not look interchangeable with ordinary primary actions.

**States:** loading, empty, error, warning, recovery, success, and disabled states must be explicit and readable. Provide explanatory text when the Owner needs to understand what is happening.

**Touch:** interactive targets should be approximately **44 px minimum** in both dimensions, with adequate separation.

## 8. Product-specific UI guidance

### Owner Android sign-in

Keep sign-in focused, credible, and minimal. Corporate identity should support, not overwhelm, authentication and recovery.

### Manual capture

Make capture immediate and prominent. Do not imply that a Task exists before interpretation and acceptance.

### Proposal review

A proposal is a reviewable suggestion, not committed work. The inherited proposal-review target is deliberately limited to:

- **Edit**
- **Dismiss**
- **Accept**

Do not introduce Merge UI through brand work. These review semantics are inherited product law (D164), not established here.

### Accept and responsibility

Accept includes affirmative responsibility selection:

- **Me / Owner**
- **saved Recipient**

There is no separate **Keep** action. Make the selected responsible party explicit. Do not confuse responsibility evidence with the later external handoff mutation.

### Task list and detail

Tasks represent committed follow-through. Prioritize status, responsibility, deadline/reminder context, and the next meaningful action without turning every attribute into a visual badge.

### Loading, error, and recovery

Use plain language and a clear next step where one exists. Recovery should feel controlled and trustworthy, not alarming by default.

### Recipient web experience

Use the same Communicator visual language in a simpler surface. Emphasize the assigned Task, relevant context/status, and permitted actions. Do not expose Owner-only controls or backend concepts.

## 9. Voice and microcopy

Voice is **short, calm, clear, actionable, non-technical, truthful**.

Prefer precise verbs: **Capture, Edit, Dismiss, Accept, Start, Wait, Resume, Complete, Add note**.

Avoid vague **Submit** when a more specific verb exists. Use sentence case and brief mobile-friendly instructions.

Do not expose API, database, provider, synchronization, or infrastructure terminology unless genuinely necessary.

Never imply Rocket has accepted, assigned, completed, or made an Owner decision when it has only produced a proposal or interpretation.

## 10. Accessibility

- Target **WCAG AA** contrast for normal text.
- Maintain approximately **44 px minimum** touch targets.
- Provide visible focus states on applicable web surfaces.
- Never communicate status by colour alone.
- Provide textual success, warning, error, and recovery states.
- Preserve usability with large text/accessibility font scaling.
- Avoid layouts that break when text expands.
- Optimize contrast and legibility for outdoor/mobile use.
- If motion is later introduced, respect reduced-motion preferences and keep motion non-essential.

## 11. Logo and identity assets

The production-ready transparent Rocket Logic master logo asset is deferred.

Do not invent or redraw a Communicator logo, treat a placeholder as canonical, or block UI work on the missing asset. Adopt approved Rocket Logic identity assets through the appropriate implementation process when available.

## 12. Architecture guardrails

Brand work is visual and linguistic unless a separately authorized product/architecture slice says otherwise. It must not alter or redefine:

- shared interpretation architecture;
- `TaskSuggestion` lifecycle;
- canonical Task architecture;
- responsibility evidence semantics;
- ETag / `If-Match` concurrency;
- API contracts or database schema;
- Gmail/SMS architecture;
- authentication/authorization;
- reminder semantics.

This document governs presentation of these concepts, not their underlying architecture.

## 13. Implementation principles

1. Inherit corporate identity from Rocket Logic; keep Communicator UI decisions product-local.
2. Use Rocket Inspections for family resemblance only, never as authority.
3. Prefer reusable product tokens and semantic roles over scattered literal values.
4. Use `#E10613` for ordinary primary brand/action treatment and preserve distinct destructive/error treatment.
5. Make hierarchy obvious before adding decoration.
6. Keep mobile interaction fast, readable, and forgiving.
7. Do not introduce broad radius, component, font-dependency, or motion migrations incidentally.
8. Keep language aligned with architectural truth, especially proposal vs. Task and proposal vs. Owner decision.
9. If branding guidance conflicts with architecture or security, preserve architecture/security and resolve presentation separately.

## 14. Success criteria

Rocket Communicator is on-brand when it:

- is recognizably part of the Rocket Logic family without copying Rocket Inspections;
- uses a dark, high-contrast operational presentation;
- uses Rocket red clearly for ordinary primary actions;
- keeps destructive/error states distinct from primary actions;
- preserves proposals as proposals until Owner acceptance;
- makes responsibility selection explicit within Accept;
- establishes clear primary, secondary, warning, success, and destructive hierarchy;
- uses concise, specific, truthful, non-technical copy;
- keeps Owner Android and Recipient web surfaces visually related without requiring identical layouts;
- remains usable with mobile, large-text, focus, and outdoor-readability constraints; and
- never silently changes product architecture through branding work.
