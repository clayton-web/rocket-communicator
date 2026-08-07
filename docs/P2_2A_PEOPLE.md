# P2.2a — People (planning)

**Status:** Planning / documentation only. **Not started. Not authorized for implementation.**  
**Authority:** [DECISIONS.md](DECISIONS.md) **D151**. Parent milestone: **P2.2 — Remove Friction** (**D143**).  
**Next execution milestone:** [Owner Acceptance Week](OWNER_ACCEPTANCE_WEEK.md) (**D142**) remains next. This document does **not** advance the roadmap, reorder milestones, or authorize code, OpenAPI, database, Android, or web work.

---

## Purpose

Record the approved product direction for **P2.2a (“People”)** as the **first planned friction-removal slice** inside P2.2 after a successful Owner Acceptance Week and Owner Go for P2.2.

Rocket is the Owner’s **trusted external memory**.  
**Android** remains the primary product.  
**Web** remains administrative.

---

## Design principle

> **Rocket should reduce decisions, not create them.**  
> When two designs solve the same problem, prefer the one that removes choices, screens, and controls while preserving truthful information.

P2.2a applies this by adding **one People control** instead of sort menus, search, Recipient pages, or dashboards.

---

## Approved direction

### Task list order (unchanged)

The Task list **always** remains ordered by:

1. `updatedAt` DESC
2. `id` DESC

**Recency is never replaced** by alternate sort orders. P2.2a does **not** add Task sorting.

### People filter (instead of sorting)

Approved filter shape:

| Option                    | Meaning                                                        |
| ------------------------- | -------------------------------------------------------------- |
| **Everyone**              | All organization Tasks in the list (current unfiltered stream) |
| **Me**                    | Unassigned Tasks — Owner work                                  |
| **individual Recipients** | Tasks currently assigned to that Recipient                     |

Rules:

- The filter is **server-side**.
- Changing the filter **resets pagination** (no reuse of a prior page’s cursor under a different filter).
- Cursor pagination must remain **truthful**.
- **Client-side filtering across partial pages is not acceptable.**

### Display names

Display names become the **primary human identifier** for Recipients in Owner-facing Task surfaces.

Example presentation:

```text
Carlie
carlie@example.com
```

rather than email alone. Email remains available as secondary identity (and assignment snapshot fields remain truthful).

### Remember last People filter (Android local only)

Android should **locally** remember the last selected People filter.

- **No** server-side preference storage.
- Restoring a filter must start a **fresh first page** (do not treat a stale cursor as authoritative).

### Future enhancement (not required for P2.2a completion)

A later enhancement **may** show simple workload counts beside each filter option, for example:

```text
Everyone (27)
Me (4)
Carlie (11)
Sam (8)
```

These are **simple counts only**, not analytics. Counts are **not** part of the minimum P2.2a definition and are **not** authorized by this planning document.

---

## Planned implementation order (when separately authorized)

After OAW PASS (or recorded conditional Go), Owner Go for P2.2, and a **separate implementation authorization** for P2.2a:

1. **Additive contract support** for Recipient display name on assigned Tasks (no silent redesign of existing assignment snapshot fields).
2. **Android:** show display name as primary identifier (list + detail ownership presentation).
3. **Server-side People filter** on the Owner Task list (`Everyone` / `Me` / one Recipient), preserving `updatedAt` DESC, `id` DESC.
4. **Android:** People filter UX (one control).
5. **Android:** locally remember the last People filter; reset cursor on change and on restore.
6. **Web (optional, trailing):** administrative parity for display name and/or People filter only if cheap — not a P2.2a success gate.
7. **Later (optional):** simple workload counts beside filter options — separate authorization.

This order is **planning only**. It does not authorize any of the steps above.

---

## Explicitly not part of P2.2 / P2.2a

Do **not** pull these into P2.2 or P2.2a unless Owner Acceptance Week proves they are necessary and a separate decision reopens them:

- Alphabetical Task sorting
- Sort by Recipient
- Sort by created date
- Sort by due date
- Search
- Recipient pages
- Kanban
- Dashboards
- CRM functionality
- Server-synced preferences

These remain **future backlog** items.

---

## Relationship to Owner Acceptance Week and P2.2

```text
A9.3 (complete)
  ↓
Owner Acceptance Week   ← next execution gate (D142)
  ↓
P2.2 Remove Friction    ← after OAW PASS + Owner Go (D143)
  ↓
P2.2a People            ← planned first slice inside P2.2 (this doc / D151)
```

- OAW findings still feed P2.2 (wording, taps, navigation, ergonomics).
- P2.2a is the **approved first product-shaped slice** inside P2.2; it does not replace OAW-driven polish work.
- Entering P2.2 still requires OAW exit criteria and Owner Go ([OWNER_ACCEPTANCE_WEEK.md §13](OWNER_ACCEPTANCE_WEEK.md#13-go--no-go-criteria-for-p22)).
- This document does **not** authorize beginning P2.2 or P2.2a implementation.

---

## Success (planning definition)

When P2.2a is later authorized and completed, the Owner should be able to:

- Recognize Recipients by **display name** on Android Task surfaces
- Narrow the Task list with **Everyone / Me / one Recipient**
- Keep a **truthful, recency-ordered, cursor-paginated** list
- Return to their last People filter on Android without server preference sync

without gaining sort menus, search, Recipient CRM pages, or alternate list orders.

---

## What this document does not change

- Milestone ordering (D140)
- OpenAPI / API contracts
- Database schema or repositories
- Android or web application code
- Feature flags or production procedures
- Stage 12 / A8.7d / A8.7e authorization
- OAW as the next formal product gate

---

## Related documents

| Document                                                                   | Role                                       |
| -------------------------------------------------------------------------- | ------------------------------------------ |
| [DECISIONS.md](DECISIONS.md) **D151**                                      | Planning lock for P2.2a direction          |
| [MILESTONES.md](MILESTONES.md) → P2.2                                      | Roadmap status; P2.2a nested planning note |
| [P2_0_OWNER_EXPERIENCE_FOUNDATION.md](P2_0_OWNER_EXPERIENCE_FOUNDATION.md) | Product Constitution; P2.2 parent          |
| [OWNER_ACCEPTANCE_WEEK.md](OWNER_ACCEPTANCE_WEEK.md)                       | Next execution gate                        |
| [../BRAND.md](../BRAND.md)                                                 | Brand/UX guidance aligned to People filter |
| [D143](DECISIONS.md)                                                       | P2.2 — Remove Friction (no major features) |
