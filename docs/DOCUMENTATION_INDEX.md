# Documentation index

Navigation and ownership map for project documentation. Start here when unsure which file governs a topic.

**Highest-level governing document:** [PROJECT_CONSTITUTION.md](PROJECT_CONSTITUTION.md)

---

## Hierarchy (reading order for new contributors)

1. [PROJECT_CONSTITUTION.md](PROJECT_CONSTITUTION.md) — mission, principles, engineering rules
2. [AI_CONSTITUTION.md](AI_CONSTITUTION.md) — AI behaviour law
3. [GLOSSARY.md](GLOSSARY.md) — shared vocabulary
4. [PRODUCT_SCOPE.md](PRODUCT_SCOPE.md) — what version one is and is not
5. [DECISIONS.md](DECISIONS.md) — binding architectural choices
6. [ARCHITECTURE.md](ARCHITECTURE.md) / [WORKFLOWS.md](WORKFLOWS.md) — how it works
7. [DATA_RETENTION.md](DATA_RETENTION.md) / [SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md) — constraints
8. [MILESTONES.md](MILESTONES.md) / [ENGINEERING_WORKFLOW.md](ENGINEERING_WORKFLOW.md) / [REVIEW_CHECKLIST.md](REVIEW_CHECKLIST.md) — how we build
9. [OPEN_QUESTIONS.md](OPEN_QUESTIONS.md) — unresolved (not decisions)

Root: [../README.md](../README.md) — entry point and status.

---

## Catalogue

### [PROJECT_CONSTITUTION.md](PROJECT_CONSTITUTION.md)

|                  |                                                                                                                             |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **Purpose**      | Highest-level product mission, philosophy, vision, success, non-goals, principles, Engineering Rules #1–#2, authority order |
| **Audience**     | Everyone contributing to the project                                                                                        |
| **Maintainer**   | Project owner / lead architect                                                                                              |
| **Dependencies** | None (top of authority order)                                                                                               |
| **Update when**  | Mission, principles, non-goals, or documentation-vs-code rules change                                                       |

### [AI_CONSTITUTION.md](AI_CONSTITUTION.md)

|                  |                                                                                               |
| ---------------- | --------------------------------------------------------------------------------------------- |
| **Purpose**      | Hard rules for AI: never-invent, fact/inference split, learning ladder, what is/isn’t learned |
| **Audience**     | Anyone implementing or reviewing AI jobs, prompts, or learning features                       |
| **Maintainer**   | Lead architect / AI feature owner                                                             |
| **Dependencies** | PROJECT_CONSTITUTION, PRODUCT_SCOPE, DATA_RETENTION                                           |
| **Update when**  | AI behaviour, learning ladder stages, or prompt contracts change                              |

### [ENGINEERING_WORKFLOW.md](ENGINEERING_WORKFLOW.md)

|                  |                                                               |
| ---------------- | ------------------------------------------------------------- |
| **Purpose**      | Milestone lifecycle and implementation rules                  |
| **Audience**     | Implementers and reviewers                                    |
| **Maintainer**   | Lead engineer                                                 |
| **Dependencies** | PROJECT_CONSTITUTION, MILESTONES, REVIEW_CHECKLIST, DECISIONS |
| **Update when**  | Process gates or definition-of-done change                    |

### [REVIEW_CHECKLIST.md](REVIEW_CHECKLIST.md)

|                  |                                                                |
| ---------------- | -------------------------------------------------------------- |
| **Purpose**      | Mandatory review questions before milestone completion         |
| **Audience**     | Reviewers and implementers at done-gate                        |
| **Maintainer**   | Lead engineer                                                  |
| **Dependencies** | Constitutions, DECISIONS, SECURITY, RETENTION, AI_CONSTITUTION |
| **Update when**  | New risk classes appear or checklist gaps are found            |

### [GLOSSARY.md](GLOSSARY.md)

|                  |                                                |
| ---------------- | ---------------------------------------------- |
| **Purpose**      | One consistent definition per important term   |
| **Audience**     | All contributors                               |
| **Maintainer**   | Lead architect                                 |
| **Dependencies** | PRODUCT_SCOPE, ARCHITECTURE, WORKFLOWS         |
| **Update when**  | New domain terms appear or definitions sharpen |

### [PRODUCT_SCOPE.md](PRODUCT_SCOPE.md)

|                  |                                                                              |
| ---------------- | ---------------------------------------------------------------------------- |
| **Purpose**      | Objectives, roles, sources, approvals, inclusions/exclusions, MVP definition |
| **Audience**     | Product and engineering                                                      |
| **Maintainer**   | Project owner                                                                |
| **Dependencies** | PROJECT_CONSTITUTION, DECISIONS                                              |
| **Update when**  | Scope, MVP boundary, or user-visible requirements change                     |

### [ARCHITECTURE.md](ARCHITECTURE.md)

|                  |                                                         |
| ---------------- | ------------------------------------------------------- |
| **Purpose**      | Components, stack, contracts, limitations, diagram      |
| **Audience**     | Engineers                                               |
| **Maintainer**   | Lead architect                                          |
| **Dependencies** | DECISIONS, PRODUCT_SCOPE, AI_CONSTITUTION               |
| **Update when**  | Stack, boundaries, or component responsibilities change |

### [WORKFLOWS.md](WORKFLOWS.md)

|                  |                                                                                    |
| ---------------- | ---------------------------------------------------------------------------------- |
| **Purpose**      | Point-form end-to-end flows with approvals, storage, side effects, failures, audit |
| **Audience**     | Engineers and QA                                                                   |
| **Maintainer**   | Lead engineer                                                                      |
| **Dependencies** | PRODUCT_SCOPE, ARCHITECTURE, AI_CONSTITUTION, DATA_RETENTION                       |
| **Update when**  | Any user-visible or system workflow changes                                        |

### [DATA_RETENTION.md](DATA_RETENTION.md)

|                  |                                                                      |
| ---------------- | -------------------------------------------------------------------- |
| **Purpose**      | Data classes, 7-day / 30-day rules, audio, Gmail forwarding boundary |
| **Audience**     | Engineers, privacy reviewers                                         |
| **Maintainer**   | Lead architect                                                       |
| **Dependencies** | PROJECT_CONSTITUTION, PRODUCT_SCOPE, DECISIONS                       |
| **Update when**  | Timers, deletion behaviour, or Gmail boundary language change        |

### [SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md)

|                  |                                                                                    |
| ---------------- | ---------------------------------------------------------------------------------- |
| **Purpose**      | AuthN/Z, RLS boundary, tokens, secure links, exclusions, forwarding privacy limits |
| **Audience**     | Engineers, security reviewers                                                      |
| **Maintainer**   | Lead architect                                                                     |
| **Dependencies** | PRODUCT_SCOPE, ARCHITECTURE, DATA_RETENTION                                        |
| **Update when**  | Roles, auth, link model, or privacy controls change                                |

### [DECISIONS.md](DECISIONS.md)

|                  |                                                                      |
| ---------------- | -------------------------------------------------------------------- |
| **Purpose**      | Decision register with IDs and statuses                              |
| **Audience**     | All contributors                                                     |
| **Maintainer**   | Lead architect                                                       |
| **Dependencies** | Constitutions; records outcomes that bind other docs                 |
| **Update when**  | Any architectural or product choice is approved, deferred, or opened |

### [MILESTONES.md](MILESTONES.md)

|                  |                                                                    |
| ---------------- | ------------------------------------------------------------------ |
| **Purpose**      | Phased delivery sequence A0–A15 with acceptance criteria           |
| **Audience**     | Implementers                                                       |
| **Maintainer**   | Lead engineer                                                      |
| **Dependencies** | PRODUCT_SCOPE, ARCHITECTURE, ENGINEERING_WORKFLOW                  |
| **Update when**  | Phase boundaries, current milestone, or acceptance criteria change |

### [OPEN_QUESTIONS.md](OPEN_QUESTIONS.md)

|                  |                                                            |
| ---------------- | ---------------------------------------------------------- |
| **Purpose**      | Unresolved questions only—never treat as decisions         |
| **Audience**     | All contributors                                           |
| **Maintainer**   | Project owner                                              |
| **Dependencies** | None; feeds DECISIONS when resolved                        |
| **Update when**  | Questions are added, clarified, or resolved into DECISIONS |

### [DOCUMENTATION_INDEX.md](DOCUMENTATION_INDEX.md)

|                  |                                                    |
| ---------------- | -------------------------------------------------- |
| **Purpose**      | This navigation and ownership map                  |
| **Audience**     | All contributors                                   |
| **Maintainer**   | Lead architect                                     |
| **Dependencies** | Entire `docs/` tree                                |
| **Update when**  | Documents are added, renamed, or ownership changes |

### [../README.md](../README.md)

|                  |                                                      |
| ---------------- | ---------------------------------------------------- |
| **Purpose**      | Repository entry point, status, hierarchy summary    |
| **Audience**     | Anyone opening the repo                              |
| **Maintainer**   | Project owner                                        |
| **Dependencies** | DOCUMENTATION_INDEX, PROJECT_CONSTITUTION            |
| **Update when**  | Status, capability summary, or doc hierarchy changes |
