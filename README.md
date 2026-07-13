# AI Communication Action Assistant

Private, Android-first AI assistant that turns ongoing personal business communications into temporary, actionable work for one primary user and one administrator in the same Google Workspace organization.

**Governing document:** [docs/PROJECT_CONSTITUTION.md](docs/PROJECT_CONSTITUTION.md) — highest authority for product behaviour and engineering rules.

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

**Repository foundation (Milestone A1) and API contracts/domain (Milestone A2) are active.**

- Documentation source of truth is in place under `docs/`.
- pnpm monorepo with empty Next.js and Android Compose shells builds and tests.
- `packages/contracts` (OpenAPI 3.1) and `packages/domain` (pure TypeScript rules) are implemented.
- Shared TypeScript ESLint/config packages, Prettier, EditorConfig, and ktlint are configured.
- GitHub Actions CI workflows include contract, domain, web, and Android checks.
- **No product runtime features** are implemented (no Gmail, OpenAI, Supabase, auth, notifications, voice, tasks API routes, or workers).
- **No** `.env.example` yet (no environment variables required).
- No GitHub remote is configured in this workspace pass.
- Distribution remains private sideload / internal testing (not Play Store).

### Foundation versions (A1)

| Component                          | Version                         |
| ---------------------------------- | ------------------------------- |
| Node.js (engines / `.nvmrc`)       | 22 (LTS range `>=22 <25`)       |
| pnpm                               | 9.15.9 (`packageManager`)       |
| Next.js                            | 16.2.10                         |
| React / React DOM                  | 19.0.0                          |
| TypeScript                         | 5.8.x                           |
| Android `minSdk`                   | 31 (Android 12)                 |
| Android `compileSdk` / `targetSdk` | 35                              |
| Android Gradle Plugin              | 8.8.2                           |
| Kotlin                             | 2.1.10                          |
| Gradle wrapper                     | 8.12.1                          |
| Compose BOM                        | 2025.02.00                      |
| Android application id             | `com.aicommunication.assistant` |
| Primary device target              | Samsung Galaxy S24+ (D040)      |

## Intended users (version one)

| Role              | Primary interface                                                                    |
| ----------------- | ------------------------------------------------------------------------------------ |
| **Primary User**  | Android application                                                                  |
| **Administrator** | Assignment emails, secure authenticated task links, minimal responsive web task view |

Both users belong to the same Google Workspace organization. Definitions: [docs/GLOSSARY.md](docs/GLOSSARY.md).

## Repository layout (A1)

```text
apps/android/     Kotlin + Jetpack Compose shell (minSdk 31)
apps/web/         Next.js App Router shell
packages/contracts/   OpenAPI 3.1 source, bundled artifact, generated TS/Kotlin DTOs
packages/domain/    Pure TypeScript state machines, policies, retention rules
packages/eslint-config/
packages/typescript-config/
docs/             Product and engineering source of truth
.github/workflows/ci.yml
```

Future packages (`db`, `ai`, `ui`) are intentionally **not** created until later milestones.

## Local verification

```bash
pnpm install
pnpm verify
```

Individual scripts: `format:check`, `lint`, `test:web`, `test:domain`, `test:contracts`, `build:web`, `build:domain`, `contracts:validate`, `contracts:generate`, `contracts:check-drift`, `android:ktlint`, `android:test`, `android:api-contract`, `android:assemble`.

Android instrumentation smoke tests under `androidTest/` are for **local** device/emulator runs only (not A1 CI).

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

## Documentation hierarchy

Authority flows downward. See [docs/DOCUMENTATION_INDEX.md](docs/DOCUMENTATION_INDEX.md).

```text
PROJECT_CONSTITUTION.md          ← highest-level governing document
    ├── AI_CONSTITUTION.md
    ├── PRODUCT_SCOPE.md
    ├── DECISIONS.md
    ├── ARCHITECTURE.md / WORKFLOWS.md
    ├── DATA_RETENTION.md / SECURITY_AND_PRIVACY.md
    ├── GLOSSARY.md
    ├── MILESTONES.md
    ├── ENGINEERING_WORKFLOW.md / REVIEW_CHECKLIST.md
    └── OPEN_QUESTIONS.md
```

## Development workflow

Every milestone follows: Architecture → Planning → Review → Implementation → Testing → Documentation verification → Commit → Next milestone.

Details: [docs/ENGINEERING_WORKFLOW.md](docs/ENGINEERING_WORKFLOW.md).  
Review gate: [docs/REVIEW_CHECKLIST.md](docs/REVIEW_CHECKLIST.md).

**Engineering Rule #1:** Implementation may never change documented product behaviour without documentation being updated first.  
**Engineering Rule #2:** Documentation wins over implementation.

## Documentation index

| Document                                                     | Description                                             |
| ------------------------------------------------------------ | ------------------------------------------------------- |
| [docs/DOCUMENTATION_INDEX.md](docs/DOCUMENTATION_INDEX.md)   | Full navigation, audience, maintainers, update triggers |
| [docs/PROJECT_CONSTITUTION.md](docs/PROJECT_CONSTITUTION.md) | Highest-level governing document                        |
| [docs/AI_CONSTITUTION.md](docs/AI_CONSTITUTION.md)           | AI behaviour law and learning ladder                    |
| [docs/ENGINEERING_WORKFLOW.md](docs/ENGINEERING_WORKFLOW.md) | How milestones are executed                             |
| [docs/REVIEW_CHECKLIST.md](docs/REVIEW_CHECKLIST.md)         | Implementation review checklist                         |
| [docs/GLOSSARY.md](docs/GLOSSARY.md)                         | Canonical term definitions                              |
| [docs/PRODUCT_SCOPE.md](docs/PRODUCT_SCOPE.md)               | Objectives, users, inclusions, exclusions, MVP          |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)                 | System architecture, components, contracts              |
| [docs/WORKFLOWS.md](docs/WORKFLOWS.md)                       | End-to-end workflows                                    |
| [docs/DATA_RETENTION.md](docs/DATA_RETENTION.md)             | Retention classes and Gmail boundary                    |
| [docs/SECURITY_AND_PRIVACY.md](docs/SECURITY_AND_PRIVACY.md) | AuthZ, privacy, secure links                            |
| [docs/DECISIONS.md](docs/DECISIONS.md)                       | Decision register                                       |
| [docs/MILESTONES.md](docs/MILESTONES.md)                     | Phased milestones (A0–A15)                              |
| [docs/API_CONTRACT.md](docs/API_CONTRACT.md)                 | OpenAPI ownership, endpoints, errors, concurrency       |
| [docs/STATE_MACHINE.md](docs/STATE_MACHINE.md)               | Persisted states, transitions, derived urgency          |
| [docs/OPEN_QUESTIONS.md](docs/OPEN_QUESTIONS.md)             | Unresolved decisions                                    |

## Development principles

Aligned with [docs/PROJECT_CONSTITUTION.md](docs/PROJECT_CONSTITUTION.md):

1. **Approval-first** — AI recommends; humans authorize consequential actions.
2. **Privacy by design** — minimize stored communication content; separate temporary data from durable learning.
3. **Deterministic automation** — reminders, retention, and state transitions are auditable rules, not opaque model decisions.
4. **Android-first UX** — the phone app is the primary interface; web is minimal for the administrator.
5. **Low vendor sprawl** — prefer Supabase + Vercel + Gmail API + OpenAI; do not duplicate databases (no Neon in v1).
6. **Honest reliability** — treat Android notification and call capture as best-effort; always keep manual and voice fallbacks.
7. **Contracts over shared types** — OpenAPI is the canonical contract; generate TypeScript and Kotlin clients from OpenAPI (JSON Schema may be derived, not authoritative).
8. **Documentation is the source of truth** — docs win over code until docs are intentionally changed.

## Local repository status

- Local Git repository on branch `main`.
- Remote hosting (GitHub) is intentionally deferred until you create it.
- Next milestone after A2: **A3** (authentication and roles)—not started.
