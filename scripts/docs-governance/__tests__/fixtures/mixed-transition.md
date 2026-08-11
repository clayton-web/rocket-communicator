# Decision register (fixture)

Mid-transition state: batch one converted D001–D003 to heading records while D004–D006 remain
wide-table rows. This is the shape the register actually has between batches, and the harness
must stay meaningful in it rather than requiring a single flag-day conversion.

Statuses: **Approved** · **Proposed** · **Deferred** · **Open** · **Superseded** · **Superseded in part**

---

## Active decisions

### D001 — Repository separation

**Status:** Approved

**Decision:** the fixture repository is separate. Rocket must **not** share a deployment target with any other product.

**Notes:** Origin note preserved. This does **not** authorize any deployment change.

### D002 — Escaped pipe carrier

**Status:** Approved

**Decision:** no `kept | assigned` enum, outcome table, or custody model is required; the persistence representation stays deliberately **unsettled**.

**Notes:** Complements D001. Retention detail lives in [DATA_RETENTION.md](DATA_RETENTION.md).

### D003 — Partially withdrawn record

**Status:** Superseded in part

**Decision:** the deterministic rules own the sends. AI may **recommend** but must **never** activate a schedule without explicit Owner authority.

**Supersession:** **Superseded in part by D005.** Superseded clauses: the preset interval model. Withdrawn clauses are **removed from the active text above**. **Still operative:** AI may recommend but never activate.

**Inert history — not current law (withdrawn by D005; emphasis removed):** Formerly read: “the preset intervals are 24h, 48h, and 72h counted from the delivery clock start.”

## Active decisions not yet converted

| ID   | Decision                                                                                                                    | Status   | Notes                                                                                         |
| ---- | --------------------------------------------------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------- |
| D005 | **Replacement scheduling rule:** an explicitly Owner-selected due date is the authoritative deterministic scheduling input. | Approved | **Supersedes in part D003** (interval clauses). Operative rule: [WORKFLOWS.md](WORKFLOWS.md). |
| D006 | **Deferred capability:** push delivery is deferred until a core workflow proves it necessary.                               | Deferred |                                                                                               |

---

## Superseded decisions

| ID   | Decision (historical wording)                                | Status     | Notes                                                               |
| ---- | ------------------------------------------------------------ | ---------- | ------------------------------------------------------------------- |
| D004 | Interval reminders are counted from the delivery clock start | Superseded | **Superseded by D005.** Historical wording retained verbatim above. |
