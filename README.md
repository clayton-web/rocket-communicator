# AI Communication Action Assistant

Private, Android-first AI assistant that turns ongoing personal business communications into temporary, actionable work for one primary user and one administrator in the same Google Workspace organization.

## Purpose

Answer:

- What communication requires action?
- What is the important information?
- Who should handle it?
- When should it be followed up?
- Was it completed?
- How was it completed?
- Did the completion create another action?

The product is **not** a permanent communication archive.

## Current status

**Architecture and planning baseline only.**

- Documentation and local Git baseline are in progress under milestone **A0**.
- No application has been scaffolded (no web app, no Android app).
- No dependencies have been installed.
- No database schemas or migrations exist.
- No external services (Vercel, Supabase, Firebase, Google Cloud, OpenAI, Gmail) are connected.
- No GitHub remote is configured in this pass.

## Intended users (version one)

| Role | Primary interface |
|------|-------------------|
| **Primary user** | Android application |
| **Administrator** | Assignment emails, secure authenticated task links, minimal responsive web task view |

Both users belong to the same Google Workspace organization.

## Major version-one capabilities

- Capture from one primary Google Workspace Gmail inbox
- Capture Google Messages notification content where Android exposes it
- Missed-call prompts; best-effort completed-call prompts for known or selected contacts
- Manual and spoken task creation, notes, and completion outcomes
- High-quality point-form AI task suggestions (approval required before task creation)
- Primary-user approval before administrator assignment and assignment email
- For Gmail-origin tasks: forward original email and **all attachments** after assignment approval, with an AI summary above the forward
- Deterministic reminder and escalation engine
- Temporary data retention (7-day excerpts; 30-day completed-task visibility)
- Durable workflow learning signals without retaining raw message bodies

## Explicit exclusions (version one)

- WhatsApp, Facebook Messenger, Signal
- Call recording or live-call transcription
- Historical SMS import
- Replacing Google Messages or the default Phone app
- Automatic client-facing replies
- Multiple Gmail accounts
- Google Play Store distribution
- Rocket PM integration
- Automatic task creation or automatic assignment emails without approval
- Permanent communication archive

## Documentation index

| Document | Description |
|----------|-------------|
| [docs/PRODUCT_SCOPE.md](docs/PRODUCT_SCOPE.md) | Product objectives, users, inclusions, exclusions, MVP definition |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System architecture, components, contracts, limitations |
| [docs/WORKFLOWS.md](docs/WORKFLOWS.md) | End-to-end workflows with approvals, audits, and failures |
| [docs/DATA_RETENTION.md](docs/DATA_RETENTION.md) | Retention classes, 7-day / 30-day rules, Gmail forwarding boundary |
| [docs/SECURITY_AND_PRIVACY.md](docs/SECURITY_AND_PRIVACY.md) | AuthZ, RLS boundary, tokens, links, privacy limits |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Architecture decision register |
| [docs/MILESTONES.md](docs/MILESTONES.md) | Phased planning milestones (A0–A15) |
| [docs/OPEN_QUESTIONS.md](docs/OPEN_QUESTIONS.md) | Unresolved decisions that block later implementation |

## Development principles

1. **Approval-first** — AI recommends; humans authorize consequential actions.
2. **Privacy by design** — minimize stored communication content; separate temporary data from durable learning.
3. **Deterministic automation** — reminders, retention, and state transitions are auditable rules, not opaque model decisions.
4. **Android-first UX** — the phone app is the primary interface; web is minimal for the administrator.
5. **Low vendor sprawl** — prefer Supabase + Vercel + Gmail API + OpenAI; do not duplicate databases (no Neon in v1).
6. **Honest reliability** — treat Android notification and call capture as best-effort; always keep manual and voice fallbacks.
7. **Contracts over shared types** — canonical OpenAPI or JSON Schema; generate clients for TypeScript and Kotlin separately.

## Local repository status

- Local Git repository is the source of truth for this planning baseline.
- Default branch: `main`.
- Remote hosting (GitHub) is intentionally deferred.
- First baseline commit message (when created): `docs: establish project architecture baseline`.
