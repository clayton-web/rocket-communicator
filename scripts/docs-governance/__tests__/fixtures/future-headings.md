# Decision register (fixture)

The same records as `current-table.md`, converted to the heading-per-decision representation
D165 authorizes, using bold labelled fields. Every operative word is unchanged, so verifying
this file against a baseline frozen from the table form must produce no hard failure.

Statuses: **Approved** · **Proposed** · **Deferred** · **Open** · **Superseded** · **Superseded in part**

---

## Decisions

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

### D004 — Interval reminders are counted from the delivery clock start

**Status:** Superseded

**Decision:** Interval reminders are counted from the delivery clock start

**Supersession:** **Superseded by D005.** Historical wording retained verbatim above.

### D005 — Replacement scheduling rule

**Status:** Approved

**Decision:** an explicitly Owner-selected due date is the authoritative deterministic scheduling input.

**Supersession:** **Supersedes in part D003** (interval clauses). Operative rule: [WORKFLOWS.md](WORKFLOWS.md).

### D006 — Deferred capability

**Status:** Deferred

**Decision:** push delivery is deferred until a core workflow proves it necessary.
