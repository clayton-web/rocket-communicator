# Documentation index

Navigation only. Definitions: [GLOSSARY.md](GLOSSARY.md). Governing authority: [PROJECT_CONSTITUTION.md](PROJECT_CONSTITUTION.md).

## Read order

1. [PROJECT_CONSTITUTION.md](PROJECT_CONSTITUTION.md)
2. [GLOSSARY.md](GLOSSARY.md)
3. [PRODUCT_SCOPE.md](PRODUCT_SCOPE.md)
4. [DECISIONS.md](DECISIONS.md)
5. [ARCHITECTURE.md](ARCHITECTURE.md)
6. [STATE_MACHINE.md](STATE_MACHINE.md) · [SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md) · [API_CONTRACT.md](API_CONTRACT.md)
7. [WORKFLOWS.md](WORKFLOWS.md) · [DATA_RETENTION.md](DATA_RETENTION.md) · [AI_CONSTITUTION.md](AI_CONSTITUTION.md)
8. [MILESTONES.md](MILESTONES.md) · [DEPLOYMENT.md](DEPLOYMENT.md) · [ENGINEERING_WORKFLOW.md](ENGINEERING_WORKFLOW.md) · [REVIEW_CHECKLIST.md](REVIEW_CHECKLIST.md)
9. [OPEN_QUESTIONS.md](OPEN_QUESTIONS.md)

Root entry: [../README.md](../README.md)

Contributor process controls (Environment Guard, Docker requirement indicator, verification exit criterion, completion-report Environment Status, post-A8 DX backlog) live in [ENGINEERING_WORKFLOW.md](ENGINEERING_WORKFLOW.md) and [MILESTONES.md](MILESTONES.md) → Engineering / DX backlog — not in product decisions.

## Who owns what topic

| Topic                                                                                                               | Document                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Mission, engineering rules, complete Architecture Principles                                                        | PROJECT_CONSTITUTION                                                                                                                   |
| Term definitions                                                                                                    | GLOSSARY                                                                                                                               |
| Product scope / MVP / exclusions                                                                                    | PRODUCT_SCOPE                                                                                                                          |
| Binding decisions (incl. P1.0 D111–D120 and A8.1 D102–D110, superseding parts of A8.0 D095–D101)                    | DECISIONS                                                                                                                              |
| Packages, stack, boundaries, Architecture Principles summary                                                        | ARCHITECTURE                                                                                                                           |
| Task / suggestion transitions                                                                                       | STATE_MACHINE                                                                                                                          |
| Authentication, authorization, capability security                                                                  | SECURITY_AND_PRIVACY                                                                                                                   |
| HTTP paths, errors, concurrency                                                                                     | API_CONTRACT (+ OpenAPI)                                                                                                               |
| End-to-end flows                                                                                                    | WORKFLOWS                                                                                                                              |
| Retention                                                                                                           | DATA_RETENTION                                                                                                                         |
| AI ladder / never-invent                                                                                            | AI_CONSTITUTION                                                                                                                        |
| Delivery plan and implementation/production status                                                                  | MILESTONES                                                                                                                             |
| Follow-up Engine / Event Notification Engine (A8 law)                                                               | WORKFLOWS §10 (cite D102–D110)                                                                                                         |
| **A8 implementation status — what exists and what is not operational**                                              | MILESTONES → A8; ARCHITECTURE → Follow-up Engine                                                                                       |
| **A8.2 reminder scheduling domain logic** (local dates, timezone resolution, occurrence selection)                  | MILESTONES → A8.2 (cite D127); `packages/domain/src/reminders/`                                                                        |
| **A8.3a reminder persistence layout** (tables, indexes, `tasks.due_local_date`, idempotency, constraints)           | DECISIONS **D128**; ARCHITECTURE → Persistence (A8.3a); `packages/db/README.md`                                                        |
| **A8.3a migration status and production applicability**                                                             | DEPLOYMENT → migration history and Reminder engine operations                                                                          |
| **A8.3b Owner reminder API** (routes, request/response shape, idempotency, generations, errors)                     | API_CONTRACT → Owner reminder schedule (A8.3b); ARCHITECTURE → Follow-up Engine (Owner API layer)                                      |
| **Why a due-date re-save after a stop reactivates reminders**                                                       | API_CONTRACT → Owner reminder schedule (A8.3b); DECISIONS **D109**; MILESTONES → A8.3b                                                 |
| **How Waiting suspension, resume, completion, and dismissal move a schedule**                                       | MILESTONES → A8 lifecycle wiring; ARCHITECTURE → Follow-up Engine (Task-lifecycle coupling); STATE_MACHINE → Reminder coupling         |
| **Why an advance reminder a Waiting period spanned is never sent on resume**                                        | WORKFLOWS §10a; DECISIONS **D105**, **D107**; MILESTONES → A8 lifecycle wiring                                                         |
| **A8 audit follow-ups deferred to A8.4a** (delivery rollback, attempt lease, lease fencing, scan topology)          | MILESTONES → [A8 audit follow-ups (A8.4a)](MILESTONES.md#a8-audit-follow-ups-a84a)                                                     |
| **P1 scope, slices, and acceptance criteria**                                                                       | MILESTONES (cite D111–D120)                                                                                                            |
| **Owner web experience states and truthful-UX doctrine**                                                            | WORKFLOWS §16 (cite D112)                                                                                                              |
| **Operational data taxonomy** (business records, audit history, operational telemetry, structured learning signals) | GLOSSARY (cite D113); retention in DATA_RETENTION; AI boundary in AI_CONSTITUTION                                                      |
| **Telemetry privacy boundary and capability-route prohibition**                                                     | SECURITY_AND_PRIVACY (cite D114)                                                                                                       |
| **Observability seam direction and operations**                                                                     | ARCHITECTURE + DEPLOYMENT (cite D115); baseline [P1_1_BASELINE.md](P1_1_BASELINE.md)                                                   |
| **P1.1 baseline evidence**                                                                                          | [P1_1_BASELINE.md](P1_1_BASELINE.md)                                                                                                   |
| **P1.2 browser verification harness (environment, commands, coverage, gaps)**                                       | [P1_2_BROWSER_HARNESS.md](P1_2_BROWSER_HARNESS.md)                                                                                     |
| **P1.3 performance, auth-count, and database-work evidence**                                                        | [P1_3_EVIDENCE.md](P1_3_EVIDENCE.md)                                                                                                   |
| **P1.4 Owner shell, presentation, timezone, and attention-destination evidence (local + production closure)**       | [P1_4_EVIDENCE.md](P1_4_EVIDENCE.md)                                                                                                   |
| **P1.5 boundary, accessibility, connectivity, and P1 production-validation evidence**                               | [P1_5_EVIDENCE.md](P1_5_EVIDENCE.md)                                                                                                   |
| **P1 production deployment identity and rollback target**                                                           | [P1_5_EVIDENCE.md](P1_5_EVIDENCE.md) §2; DEPLOYMENT → Owner web experience foundation operations                                       |
| **Why the Recipient capability workflow is unvalidated in production (evidence limitation, not a defect)**          | [P1_5_EVIDENCE.md](P1_5_EVIDENCE.md) §6                                                                                                |
| **Capability URLs in platform access logs (future consideration, not a blocker)**                                   | [P1_5_EVIDENCE.md](P1_5_EVIDENCE.md) §7                                                                                                |
| **Handoff-confirmation browser journey, and why Gmail delivery is still not browser-tested**                        | [P1_5_EVIDENCE.md](P1_5_EVIDENCE.md) §11                                                                                               |
| **Full `pnpm verify` evidence and the required Java version**                                                       | [P1_5_EVIDENCE.md](P1_5_EVIDENCE.md) §12                                                                                               |
| **Owner display timezone (`America/Vancouver`) authority and formatter**                                            | `apps/web/lib/presentation/datetime.ts` (cite D117, D122); [P1_4_EVIDENCE.md](P1_4_EVIDENCE.md) §§6 and 13                             |
| **Owner shell structure, navigation destinations, and route group**                                                 | ARCHITECTURE (cite D111, D118); [P1_4_EVIDENCE.md](P1_4_EVIDENCE.md) §§1–2 and 13                                                      |
| **Semantic design tokens**                                                                                          | `packages/ui/tokens.css` + `packages/ui/README.md` (cite D116, D124)                                                                   |
| **Loading-state ownership across P1.3 / P1.4 / P1.5**                                                               | MILESTONES → P1 implementation sequence (cite D112, D119)                                                                              |
| **Product name status**                                                                                             | DECISIONS **D120** (Open) + OPEN_QUESTIONS #22                                                                                         |
| Deployment and operations                                                                                           | DEPLOYMENT                                                                                                                             |
| Process / review gate                                                                                               | ENGINEERING_WORKFLOW (Environment Guard, Docker indicator, `pnpm verify` exit criterion, Environment Status reports), REVIEW_CHECKLIST |
| Unresolved unknowns                                                                                                 | OPEN_QUESTIONS                                                                                                                         |
| Post-A8 engineering / DX backlog (not a product milestone)                                                          | MILESTONES → Engineering / DX backlog                                                                                                  |
