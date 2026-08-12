# Decision-register verification harness

Repository-local documentation-governance tooling authorized by **D165**. The
`docs/DECISIONS.md` representation conversion is complete: the live register uses
heading records, no legacy decision-table rows remain, and the harness now protects
the converted register against the frozen D001–D165 baseline and current structural
rules. Operating procedure and the hard-failure/review contract live in
[docs/ENGINEERING_WORKFLOW.md § Decision-register verification](../../docs/ENGINEERING_WORKFLOW.md#decision-register-verification-d165).
This file documents the layout only.

```bash
pnpm docs:decisions:verify              # verify the live register against the frozen baseline
pnpm docs:decisions:verify --verbose    # include every human-review item
pnpm docs:decisions:test                # the harness's own tests
pnpm docs:decisions:baseline --force    # refreeze the baseline (reviewed governance act)
```

**D165 does not authorize** adding this to `pnpm verify`, CI, pre-commit hooks or deployment
gates. Those integrations need separate review. It runs through its own command only.

## Layout

| Path                               | Role                                                                |
| ---------------------------------- | ------------------------------------------------------------------- |
| `verify-decisions.mjs`             | CLI entry point; prints the report and sets the exit code           |
| `build-baseline.mjs`               | Freezes the baseline; refuses to overwrite one without `--force`    |
| `paths.mjs`                        | Register, baseline and citation-exclusion locations                 |
| `lib/markdown-table.mjs`           | Escape-aware GFM row splitting (the D155 `kept \| assigned` hazard) |
| `lib/parse-register.mjs`           | Both representations, reduced to one record shape                   |
| `lib/normalize.mjs`                | The three comparison tiers, segmentation, digests, word runs        |
| `lib/clauses.mjs`                  | Status, boundary, withdrawal and supersession vocabularies          |
| `lib/analyze.mjs`                  | Per-record derivation shared by the baseline and the live run       |
| `lib/baseline.mjs`                 | Baseline format, generation, loading, rehydration                   |
| `lib/checks/structure.mjs`         | Identity, completeness, required fields, status vocabulary          |
| `lib/checks/ordering.mjs`          | Legacy, mixed-transition and fully-converted ordering rules         |
| `lib/checks/operative.mjs`         | Operative-text, boundary and inert-history safeguards               |
| `lib/checks/supersession.mjs`      | Supersession completeness and reciprocity                           |
| `lib/checks/citations.mjs`         | Repository-wide citation resolution and the named-clause report     |
| `lib/verify.mjs`                   | Orchestration, used by both the CLI and the tests                   |
| `lib/report.mjs`                   | Findings model and report formatting                                |
| `baseline/decisions-baseline.json` | Frozen evidence artifact — see its own `artifact.note`              |
| `__tests__/`                       | Tests and synthetic fixtures for both representations               |

Dependencies: none. The harness uses Node's standard library and `node:test` only.
