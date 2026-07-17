# Engineering workflow

How future development proceeds on this repository. Subordinate to [PROJECT_CONSTITUTION.md](PROJECT_CONSTITUTION.md) and [AI_CONSTITUTION.md](AI_CONSTITUTION.md). Milestone sequence: [MILESTONES.md](MILESTONES.md). Review gate: [REVIEW_CHECKLIST.md](REVIEW_CHECKLIST.md).

---

## Milestone lifecycle

Every milestone follows this sequence. Do not skip stages.

```text
Architecture
    ↓
Planning
    ↓
Review
    ↓
Implementation
    ↓
Testing
    ↓
Documentation verification
    ↓
Commit
    ↓
Next milestone
```

| Stage                          | Required work                                                                                                                                                                                                             |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Architecture**               | Confirm the milestone still matches [ARCHITECTURE.md](ARCHITECTURE.md), Architecture Principles (D079), and Approved [DECISIONS.md](DECISIONS.md). If behaviour must change, update docs **first** (Engineering Rule #1). |
| **Planning**                   | Define scope, acceptance criteria, out-of-scope, risks, and files likely touched. Resolve blocking items in [OPEN_QUESTIONS.md](OPEN_QUESTIONS.md) or explicitly defer with documented impact.                            |
| **Review**                     | Human review of the plan against [REVIEW_CHECKLIST.md](REVIEW_CHECKLIST.md) (scope through documentation drift).                                                                                                          |
| **Implementation**             | Build only what the milestone allows.                                                                                                                                                                                     |
| **Testing**                    | Prove acceptance criteria; include contract, domain, and regression tests appropriate to the change.                                                                                                                      |
| **Documentation verification** | Docs match behaviour; glossary terms used correctly; no silent new behaviour.                                                                                                                                             |
| **Commit**                     | One coherent checkpoint (message aligned with [MILESTONES.md](MILESTONES.md) recommendation unless a clearer message is needed).                                                                                          |
| **Next milestone**             | Only after the current milestone’s acceptance criteria and doc verification pass.                                                                                                                                         |

## Implementation rules

1. **One milestone at a time** — do not start the next milestone’s scope early.
2. **No unrelated refactoring** — drive-by cleanups belong in their own planned work.
3. **No silent architecture changes** — stack, boundaries, and data classes change only via documented decisions.
4. **No undocumented behaviour** — if users can observe it, docs must describe it.
5. **Documentation updated before completion** — milestone is incomplete until docs are verified.
6. **Stop when scope is exceeded** — park discoveries in OPEN_QUESTIONS or a future milestone; do not absorb them quietly.

## Documentation-first change protocol

When product behaviour must change:

1. Update [PROJECT_CONSTITUTION.md](PROJECT_CONSTITUTION.md) / [AI_CONSTITUTION.md](AI_CONSTITUTION.md) if principles are affected.
2. Update [DECISIONS.md](DECISIONS.md) (new or revised ID and status).
3. Update [PRODUCT_SCOPE.md](PRODUCT_SCOPE.md), [WORKFLOWS.md](WORKFLOWS.md), [DATA_RETENTION.md](DATA_RETENTION.md), [SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md), and/or [ARCHITECTURE.md](ARCHITECTURE.md) as applicable.
4. Update [GLOSSARY.md](GLOSSARY.md) if terms change.
5. Then implement.
6. Re-run [REVIEW_CHECKLIST.md](REVIEW_CHECKLIST.md).

**Documentation wins over implementation** ([PROJECT_CONSTITUTION.md](PROJECT_CONSTITUTION.md) Engineering Rule #2).

## Ownership

| Concern                     | Primary document owner (logical)                                        |
| --------------------------- | ----------------------------------------------------------------------- |
| Mission and principles      | PROJECT_CONSTITUTION                                                    |
| Architecture Principles     | PROJECT_CONSTITUTION (complete source); ARCHITECTURE (summary/examples) |
| AI behaviour                | AI_CONSTITUTION                                                         |
| What ships in v1            | PRODUCT_SCOPE                                                           |
| How it is built             | ARCHITECTURE                                                            |
| Step-by-step behaviour      | WORKFLOWS                                                               |
| Deletion and Gmail boundary | DATA_RETENTION                                                          |
| AuthZ and privacy           | SECURITY_AND_PRIVACY                                                    |
| Binding choices             | DECISIONS                                                               |
| Sequence of work            | MILESTONES                                                              |
| Unresolved                  | OPEN_QUESTIONS                                                          |
| Terms                       | GLOSSARY                                                                |

## Definition of done (milestone)

- Acceptance criteria in MILESTONES met
- REVIEW_CHECKLIST answered for the change
- No new OPEN_QUESTIONS left implicit in code comments only
- Docs cross-links still valid
- Commit created only when the user requests it (this workflow describes the intended process; commit policy remains human-gated)

## Explicitly out of band

- Committing or pushing without an explicit user request in the session that asks for it
- Connecting cloud resources “while we are here”
- Resolving OPEN_QUESTIONS by inventing answers in code
