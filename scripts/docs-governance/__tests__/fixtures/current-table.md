# Decision register (fixture)

Synthetic fixture standing in for the wide-table representation. It is deliberately not the
real register: the real corpus proves the harness works on production data, while this file
lets a single hazard be isolated and mutated. Identifiers here are fixture-local.

Statuses: **Approved** · **Proposed** · **Deferred** · **Open** · **Superseded** · **Superseded in part**

---

## Active decisions

| ID   | Decision                                                                                                                                                             | Status             | Notes                                                                                                                                                                                                                                                                                                                                                                                |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D001 | **Repository separation:** the fixture repository is separate. Rocket must **not** share a deployment target with any other product.                                 | Approved           | Origin note preserved. This does **not** authorize any deployment change.                                                                                                                                                                                                                                                                                                            |
| D002 | **Escaped pipe carrier:** no `kept \| assigned` enum, outcome table, or custody model is required; the persistence representation stays deliberately **unsettled**.  | Approved           | Complements D001. Retention detail lives in [DATA_RETENTION.md](DATA_RETENTION.md).                                                                                                                                                                                                                                                                                                  |
| D003 | **Partially withdrawn record:** the deterministic rules own the sends. AI may **recommend** but must **never** activate a schedule without explicit Owner authority. | Superseded in part | **Superseded in part by D005.** Superseded clauses: the preset interval model. Withdrawn clauses are **removed from the active text above**. **Still operative:** AI may recommend but never activate. **Inert history — not current law (withdrawn by D005; emphasis removed).** Formerly read: “the preset intervals are 24h, 48h, and 72h counted from the delivery clock start.” |
| D005 | **Replacement scheduling rule:** an explicitly Owner-selected due date is the authoritative deterministic scheduling input.                                          | Approved           | **Supersedes in part D003** (interval clauses). Operative rule: [WORKFLOWS.md](WORKFLOWS.md).                                                                                                                                                                                                                                                                                        |
| D006 | **Deferred capability:** push delivery is deferred until a core workflow proves it necessary.                                                                        | Deferred           |                                                                                                                                                                                                                                                                                                                                                                                      |

---

## Superseded decisions

Retained for history. Follow the newer Approved decision(s) cited in Notes.

| ID   | Decision (historical wording)                                | Status     | Notes                                                               |
| ---- | ------------------------------------------------------------ | ---------- | ------------------------------------------------------------------- |
| D004 | Interval reminders are counted from the delivery clock start | Superseded | **Superseded by D005.** Historical wording retained verbatim above. |
