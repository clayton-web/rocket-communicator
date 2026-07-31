# P1.4 evidence — Owner shell, constrained presentation, organization-timezone display, attention destination

**Status:** P1.4 Owner shell, constrained presentation foundation, organization-timezone
display, and the Owner attention / operational-status destination — **complete and
production-validated.**

P1.4 is **complete**. Local evidence below remains the exact Auth HTTP-count proof; [§13
Production validation and closure](#13-production-validation-and-closure) records the
production deployment and Owner-shell evidence that closed the slice.

> **Historical document — superseded in part by P1.5.**
> This report is preserved as an accurate record of what P1.4 delivered and observed on
> 2026-07-30 against deployment `dpl_F5zjNcc4zwiwbr25CSdMGA3zDy8c` (commit `a38c8574`). Its
> statements are **historically accurate for P1.4 and are not rewritten.**
> Since then, **P1.5 shipped and P1 closed**: P1 overall is now **complete**, D119 is
> **met**, and several items this report lists as deferred or open were delivered by P1.5.
> D120 remains open. Where a statement below has been overtaken, an inline note points to
> [P1_5_EVIDENCE.md](P1_5_EVIDENCE.md). Read this document as _P1.4 as it stood_, not as
> current state.

Authorizing decisions: D111 (P1 scope), D112 (truthful experience states), D116 (presentation
foundation), D117 (organization-timezone display), D118 (attention destination), D119
(verification and one-auth-call rule).

---

## 1. Route structure

`/tasks` and `/tasks/{taskId}` moved into a new `(owner)` route group. A Next.js route group
contributes no URL segment, so **no public URL changed** and `proxy.ts`, which matches on
pathname, was not touched.

| Route             | Location                              | Inside Owner shell |
| ----------------- | ------------------------------------- | ------------------ |
| `/`               | `app/page.tsx`                        | No                 |
| `/login`          | `app/login/page.tsx`                  | No                 |
| `/auth/callback`  | `app/auth/callback/route.ts`          | No                 |
| `/auth/sign-out`  | `app/auth/sign-out/route.ts`          | No (new)           |
| `/c/{token}`      | `app/c/[token]/page.tsx`              | No                 |
| `/api/v1/**`      | `app/api/v1/**`                       | No                 |
| `/tasks`          | `app/(owner)/tasks/page.tsx`          | Yes                |
| `/tasks/{taskId}` | `app/(owner)/tasks/[taskId]/page.tsx` | Yes                |
| `/attention`      | `app/(owner)/attention/page.tsx`      | Yes (new)          |

`/` deliberately stays outside the shell and keeps its dual authenticated/unauthenticated
behaviour. It is **not** redirected to `/tasks`; `/tasks → 200` for an unauthenticated visitor
is an A7 closure baseline that a global redirect would break.

Proven by `apps/web/__tests__/p1-4-route-structure.test.ts`.

> **Reconciliation note (added at P1 closeout).** The sentence above is retained as written
> because it records P1.4's own reasoning, but two points prevent it being read as current
> behaviour:
>
> 1. **The baseline it protects is `/`, not `/tasks`.** What must keep serving unauthenticated
>    visitors — and must not be redirected to `/tasks` — is `/`. That remains true today.
> 2. **P1.5 deliberately changed `/tasks`.** At P1.4, unauthenticated `/tasks` returned 200
>    and painted identity-independent Owner chrome before its loading-boundary redirect
>    completed (recorded as a gap in [§12](#12-remaining-gaps)). P1.5 moved the Owner gate
>    above the shell, so an unauthenticated request now returns a true **307** to
>    `/login?next=%2Ftasks` and nothing else.
>
> No A4–A7 gate was weakened: `/tasks` always required authentication, and it now refuses
> earlier rather than later. Current behaviour: [P1_5_EVIDENCE.md](P1_5_EVIDENCE.md) §5.

### One consequence worth recording

Route groups do not change public URLs, but they **do** change Next.js build-output paths. The
NFT manifests moved from `.next/server/app/tasks/page.js.nft.json` to
`.next/server/app/(owner)/tasks/page.js.nft.json`, and
`apps/web/scripts/lib/db-package-trace.mjs` was updated accordingly.

`outputFileTracingIncludes` in `next.config.ts` keys on the **route path** (`/tasks`), not the
source path, so tracing itself was unaffected. Verified directly against the built manifests:
both `(owner)/tasks` and `(owner)/tasks/[taskId]` still trace
`libquery_engine-rhel-openssl-3.0.x.so.node`, `schema.prisma`, `packages/db/package.json`, and
the `packages/domain/dist` tree.

---

## 2. Owner shell

`app/(owner)/layout.tsx` provides, in document order: skip link, `<header>` with product
identity and Owner display name, named `<nav aria-label="Owner">`, and
`<main id="main-content">` with a consistent container.

The product name is a **link, not an `<h1>`**. Each page owns exactly one `<h1>`. Repeating the
product name as a heading on every route would give every page two competing top-level
headings and tell a screen-reader user the page is about the product rather than about their
Tasks.

Because the chrome is in a layout, it persists across `loading.tsx` and `error.tsx`, which
render inside it. Both boundaries lost their duplicated `.wrap` container and their own
navigation; the Task stylesheet's `.wrap` and `.nav` rules were deleted, since the shell now
owns the container and the single Owner navigation.

Navigation is exactly three destinations, and no more:

| Destination | Target                | Mechanism          |
| ----------- | --------------------- | ------------------ |
| Tasks       | `/tasks`              | `next/link`        |
| Attention   | `/attention`          | `next/link`        |
| Sign out    | `POST /auth/sign-out` | native form submit |

Recipients, Gmail settings, suggestions, reminders, administration, and health are
deliberately absent. Endpoints exist for some of them; Owner surfaces do not, and navigating
to an absent surface would be a false claim about the product (D089, D111).

Active state derives from `usePathname()` and is carried by `aria-current="page"` **plus**
font weight and a bottom border, so it is not colour-only. `/tasks/{taskId}` keeps Tasks
current.

`OwnerNav` is the only client component P1.4 introduces, and only because active state needs
the pathname. It imports nothing from `lib/auth`, `lib/db`, or `lib/observability`.

Proven by `apps/web/__tests__/p1-4-shell.test.tsx` (27 assertions, rendering the **actual**
layout module) and `apps/web/e2e/specs/owner-shell.spec.ts`.

---

## 3. Authentication — measured, not asserted

P1.4 moves Owner chrome into a layout, and a layout renders outside the page's request
diagnostic context. The P1.3 memo is keyed by that context, so the layout would have missed it
and spent a **second** verified `getUser()` — doubling the operation D119 budgets at exactly
one per Owner page request.

`lib/auth/require-owner.ts` now wraps the existing resolver in React's `cache()`, whose scope
is one server render pass — the layout and page of a single request, and nothing else. There is
no TTL, no key beyond the arguments, and no way for an entry to outlive its render, so **no
cross-request caching was introduced**. Outside a render (route handlers, the proxy, Vitest)
React's `cache` is a pass-through, so the request-context memo remains the deduplication
mechanism there.

### Measured at the real Supabase Auth HTTP layer

Counted by the local Supabase Auth double, which tallies real `GET /auth/v1/user`,
`POST /auth/v1/token`, and `POST /auth/v1/logout` requests while the **real Next.js runtime**
renders layout plus page. **No source call site is counted, and no counter exists in
application code.**

| Scenario                                 | Verified `getUser()` | Refresh (`token`) | Total Auth HTTP |
| ---------------------------------------- | -------------------- | ----------------- | --------------- |
| One `/tasks` request (layout + page)     | **1**                | 0                 | **1**           |
| One `/tasks/{taskId}` request            | **1**                | 0                 | **1**           |
| One `/attention` request                 | **1**                | 0                 | **1**           |
| Three sequential `/tasks` requests       | **3**                | 0                 | 3               |
| Three concurrent Owner page requests     | **3**                | 0                 | 3               |
| Recipient capability page (`/c/{token}`) | **0**                | 0                 | **0**           |
| `POST /auth/sign-out`                    | 0                    | 0                 | 1 (`logout`)    |

Sequential and concurrent counts scaling with request count is the evidence that identity does
**not** leak across a request boundary.

Measurements use one document request per row rather than a browser navigation: a navigation
can also trigger link prefetches, and each prefetch is a separate legitimate request that
renders the layout again, so a browser-level count could not isolate the single request D119
budgets.

Preserved unchanged: server-verified `getUser()`, Workspace-domain validation applied **after**
verification, fail-closed behaviour on a malformed session cookie (zero Auth calls), request
context isolation, proxy cookie maintenance, and zero Owner session work on capability paths.
Refresh remains counted separately from identity verification.

Server logs show exactly **one** `owner_authentication` timing event per Owner page request.
`lib/owner/shell-context.ts` deliberately emits none: a second event would make the shell look
like the duplicate authentication P1.3 removed, in the very diagnostic used to prove it gone.

Proven by `apps/web/e2e/specs/owner-shell-auth.spec.ts` (7 assertions),
`apps/web/__tests__/p1-4-shell-auth.test.ts` (10 assertions), and the unchanged
`apps/web/__tests__/owner-auth-call-count.test.ts` (14 assertions).

### Limitation

React's `cache` is inert outside a server render pass, so a Vitest process cannot reproduce a
genuine layout-plus-page pass. Attempting it via the bundled `react-server-dom-webpack`
renderer failed because that build vendors its own React copy and therefore cannot share
element identity or cache internals. The layout-plus-page count is therefore proven **only** in
the real runtime, by the browser spec. The unit suite proves the composition and every
isolation property. **This remains local evidence; no deployed-runtime proof exists.**

---

## 4. Sign-out

`POST /auth/sign-out`, outside `/api/v1`, following the `/auth/callback` precedent: session
establishment and teardown are browser navigation concerns, not part of the versioned product
contract. **No OpenAPI path, schema, or generated client changed.**

- **POST only.** No `GET` handler is exported, so Next.js answers a GET with 405 and no URL
  ends a session by being visited. This is concrete, not theoretical: `next/link` prefetches,
  so a GET sign-out link would sign the Owner out while they merely looked at a page linking
  to it. The shell submits a native form and never links to the route.
- **Server-side revocation.** `supabase.auth.signOut()` revokes at Supabase and clears the
  cookie. The Auth double recorded the `POST /auth/v1/logout`, so the session is genuinely
  invalidated rather than hidden.
- **303 redirect**, not 307: a 307 would replay the POST against `/login`, which exports no
  POST handler and would answer 405.
- **Protected routes refuse afterward.** A subsequent `/tasks` request redirects to `/login`.

Proven by `apps/web/__tests__/p1-4-sign-out.test.ts` and the sign-out assertions in
`owner-shell.spec.ts` and `owner-shell-auth.spec.ts`.

---

## 5. Attention destination (D118)

`/attention`, authenticated through the Owner route group. Reads nothing: **no database query,
no Task data, no counts.**

Exact copy:

> **Attention** (`<h1>`)
>
> There is nothing to show here.
>
> This destination is where Tasks needing your attention and operational status will appear.
> Neither is built yet, so this page is empty by design rather than because something failed.
>
> This page does not monitor anything, hold a queue, count anything, or track a schedule, and
> nothing on it updates on its own. The Tasks page remains the complete and current list of
> your Tasks.

Two things about this wording are deliberate. First, an empty page that hints at invisible
machinery is worse than no page at all — the Owner would trust a safety net that does not
exist. Second, every statement is **scoped to this page**: Gmail polling and suggestion
processing endpoints do exist, so a blanket "nothing is running" would be its own falsehood.

The browser spec asserts the absence of "monitoring", "queued", "scheduled", "reminder",
"checking", "watching", "syncing", "running", "healthy", and "up to date", the absence of any
list item inside `<main>`, and the absence of any count-shaped phrase.

**Contains no A8 operational data.** A8 is not started.

Proven by `apps/web/e2e/specs/owner-attention.spec.ts`.

---

## 6. Organization-timezone display (D117)

One authority: `apps/web/lib/presentation/datetime.ts`.

`OWNER_DISPLAY_TIME_ZONE = 'America/Vancouver'`, a documented constant. There is no
`Organization` model and no timezone column in the Prisma schema, and P1.4 must not add one.
It is deliberately **not** an environment variable: an env-var timezone can differ between the
server that renders a date and the developer reading a log, and a typo would silently change
what every timestamp means.

- Explicit IANA zone passed to `Intl.DateTimeFormat`; **no** browser-local or machine-local
  fallback, and **no** fixed-offset arithmetic anywhere.
- Daylight saving delegated entirely to `Intl`, which distinguishes PST from PDT from the
  instant itself.
- `timeZoneName: 'short'` on every date-**time**, so a rendered time always carries its zone.
  Date-only output omits it, having no time to disambiguate.
- An unsupported zone **throws at module load** rather than degrading to machine-local time.
  A `try`/`catch` around formatting would produce exactly the silent drift D117 exists to
  prevent.
- An unparseable instant renders `Unknown date`, never a fabricated one.
- **No scheduling or recurrence logic.** Reminder scheduling stays in the domain package.

Owner timestamps are formatted **on the server**: `task-detail.tsx` became a server component
in P1.4, so formatting no longer depends on the browser's timezone and cannot cause a
hydration mismatch. `toLocaleString()` is gone from the Owner surfaces.

### Results

| Condition                    | Result                                     |
| ---------------------------- | ------------------------------------------ |
| `TZ=UTC` (unit)              | 36/36 pass, identical output               |
| `TZ=Asia/Tokyo` (unit)       | 36/36 pass, identical output               |
| Asia/Tokyo **browser** (e2e) | Vancouver date rendered, Tokyo date absent |

The browser case is the decisive one for viewer independence. The fixture instant
`2026-01-16T04:30:00Z` is `Jan 15, 2026` in Vancouver and `Jan 16, 2026` in Tokyo; the page
renders **Jan 15** and the spec asserts Jan 16 appears nowhere.

DST boundaries are asserted at fixed instants either side of both Vancouver transitions
(2026-03-08 spring forward, 2026-11-01 fall back), including the ambiguous repeated hour where
only the zone abbreviation distinguishes the two instants.

### Recipient gap — recorded, not fixed

`app/c/[token]/recipient-capability-panel.tsx` still formats timestamps with
`toLocaleString(undefined, …)`, which renders in the **Recipient's** timezone. P1.4
deliberately did not change it: `/c/{token}` is externally visible and security-sensitive and
is touched last, in P1.5.

Proven by `apps/web/__tests__/p1-4-presentation.test.ts` and
`apps/web/e2e/specs/owner-presentation.spec.ts`.

---

## 7. Task presentation

Uses only existing Task DTO fields. **Visual only.** No filters, sections, grouping, sorting
change, counts, attention queue, new Task state, new urgency rule, authorization rule, or
workflow rule. **List order is exactly what the server returned.**

| Contract value             | Rendered         |
| -------------------------- | ---------------- |
| `open`                     | Open             |
| `in_progress`              | In progress      |
| `waiting`                  | Waiting          |
| `completed`                | Completed        |
| `dismissed`                | Dismissed        |
| assignment present         | Assigned         |
| assignment absent          | Unassigned       |
| `derivedUrgency: due_soon` | Due soon         |
| `derivedUrgency: overdue`  | Overdue          |
| `deliveryStatus: pending`  | Delivery pending |
| `deliveryStatus: sent`     | Sent             |
| `deliveryStatus: failed`   | Delivery failed  |
| `dueAt`                    | Due date         |
| `waitingUntil`             | Waiting until    |
| `outcome.completedAt`      | completion date  |

Mappings are exhaustive `Record`s keyed by the contract enum, so adding a state to the
contract fails the build rather than silently rendering an unlabelled value.

`due_soon` and `overdue` are described as due-date facts only. They are derived at read time,
never persisted, and **no reminder automation is wired to them**, so the labels must not imply
one (STATE_MACHINE.md, D089).

Delivery state appears in the **list** only when it has failed; a "Delivery pending" badge on
every assigned row would push genuine failures out of view. Full delivery state is on the
detail.

`completed` and `dismissed` both read as neutral tone: dismissing a Task is a legitimate
resolution, not a failure, and colouring it as one would editorialize about the Owner's
decision. Tone is never the only carrier of meaning — the label always states it, and badges
use a left border so state survives greyscale.

### Task detail heading

The `<h1>` is now the Task's **derived title**, not the literal word "Task". A heading of
"Task" tells the Owner nothing and reads identically for every Task in browser history, in a
bookmark, and to a screen reader.

One shared helper, `lib/presentation/task-title.ts`, derives it. It uses the first summary
point that actually carries text — a leading point with an empty value would otherwise produce
a blank heading — truncates display at 120 characters, and falls back to
`Task {id.slice(0, 8)}`, **byte-identical to the pre-P1.4 fallback**. Tasks whose previous
title came from an empty first point or a >120-character first point therefore change; the
fallback string itself does not.

The identical `summaryText` helper previously triplicated across `task-detail.tsx`,
`handoff-panel.tsx`, and `recipient-capability-panel.tsx` is now reduced: `task-detail.tsx`
uses the shared helper, and the `handoff-panel.tsx` copy was **dead code, never called**, so
it was deleted. The `recipient-capability-panel.tsx` copy remains, for the same P1.5 reason as
the Recipient timezone gap.

### Note bound wording

At exactly 100 notes — the `TASK_DETAIL_NOTE_LIMIT` the detail query takes — the detail renders:

> Showing up to the 100 most recent notes.

Below 100 it renders nothing. The wording states what was shown, not what was withheld, because
the Task may have exactly 100 notes; claiming more exist would be a guess, and knowing for
certain would need a truncation flag on the response, which is an OpenAPI change P1.4 cannot
make. **Note ordering and the newest-100 policy are unchanged.**

The limit is restated in `lib/presentation/task-notes.ts` rather than imported from
`@aicaa/db`, to keep the Prisma client out of the component import graph; a test asserts the
two constants are equal so they cannot drift.

### Long content

Long titles, notes, summary points, and attribution lines wrap via `overflow-wrap: anywhere`.
The browser specs assert **zero horizontal document overflow** with a 220-character unbroken
token in a title and a 240-character unbroken token in a note. Both cases genuinely overflowed
on first run — the summary-list and note-body rules were missing — and the tests caught it.

---

## 8. `packages/ui` — tokens only (D116)

A workspace package containing exactly three files: `package.json`, `tokens.css`, `README.md`.

**No build step**, no `build`/`lint`/`test` script, no dependency, and no entry point that is
not `.css`. One CSS file does not justify a compiled JavaScript output, and adding no script
means no root workspace script had to change. Its only consumer is `apps/web`, which asserts
its correctness.

Contains colour, typeface, type scale, type rhythm, spacing, border, radius, motion,
touch-target, and measure tokens. Contains **no** React component, hook, button, badge, card,
navigation primitive, route logic, auth logic, or Task logic — and no `.ts`/`.tsx`/`.js` file
at all, which is asserted structurally.

### No-op proof

Every token was introduced **equal to the literal it replaced** at commit `34d048e7`. 60
values are pinned individually in `apps/web/__tests__/p1-4-tokens.test.ts`, which additionally
proves:

- no token exists beyond the recorded set, so nothing arrived undocumented;
- every `var(--aicaa-*)` referenced anywhere in `apps/web` CSS resolves to a defined token —
  this matters because a mistyped custom property does not fail loudly, CSS simply drops the
  declaration and the page silently loses a colour or a font;
- no bare hex or `rgba()` colour remains in the two stylesheets that were tokenized.

Radius is `0` and motion is `none` because the shipped interface **is** square and static.
Recording the current value is what makes a future change traceable rather than incidental.
Since nothing animates, no `prefers-reduced-motion` block was added — it would guard nothing.

Confirmed in the compiled output: the sans-serif stack fell from 12 source occurrences to 3,
and the token definitions are present in the production CSS chunk.

### Recipient compatibility aliases

`app/c/[token]/recipient-capability-module.css` consumes the old short names (`--ink`,
`--muted`, `--paper`, `--line`, `--accent`). Rather than edit that stylesheet — `/c/{token}` is
touched last, in P1.5 — `globals.css` keeps the five names as documented aliases pointing at
the new tokens. The capability page therefore renders byte-identically and was not touched.
P1.5 should migrate it and delete the alias block. — **Done in P1.5** (commit `8588c5d`): the
capability stylesheet now consumes the canonical `--aicaa-*` tokens directly, and four of the
five aliases (`--ink`, `--muted`, `--line`, `--accent`) were deleted from `globals.css`. The
migration was proven presentation-neutral by computed-style comparison. **`--paper` remains
declared** with zero consumers repo-wide and awaits separate authorization — a non-blocking
advisory ([P1_5_EVIDENCE.md](P1_5_EVIDENCE.md) §9).

---

## 9. Components and boundaries

All React components stay in `apps/web`.

| Component          | Location                                          | Kind               |
| ------------------ | ------------------------------------------------- | ------------------ |
| Owner shell layout | `app/(owner)/layout.tsx`                          | Server             |
| Owner navigation   | `app/(owner)/_components/owner-nav.tsx`           | Client             |
| Owner identity     | `app/(owner)/_components/owner-identity.tsx`      | Server             |
| Page header        | `app/(owner)/_components/page-header.tsx`         | Server             |
| Status badge       | `app/(owner)/_components/status-badge.tsx`        | Server             |
| Empty state        | `app/(owner)/_components/empty-state.tsx`         | Server             |
| Task detail        | `app/(owner)/tasks/_components/task-detail.tsx`   | Server (converted) |
| Handoff panel      | `app/(owner)/tasks/_components/handoff-panel.tsx` | Client (unchanged) |

Pure helpers: `lib/presentation/task-title.ts`, `datetime.ts`, `task-status.ts`,
`task-notes.ts`.

`task-detail.tsx` was converted from a client to a **server** component. It held no state and
reacted to nothing; only `HandoffPanel` does, and that boundary is intact. A7 handoff behaviour
is unchanged and its tests pass untouched. The conversion also removed the timezone hydration
risk described in §6.

---

## 10. Performance and observability

| Guardrail                                      | Result                               |
| ---------------------------------------------- | ------------------------------------ |
| Verified Owner identity operations per request | 1 (measured)                         |
| Database queries added by the shell            | 0                                    |
| Task list query shape                          | unchanged                            |
| Task detail note bound                         | 100, unchanged                       |
| Capability authorization and mutation budgets  | unchanged                            |
| New client fetch introduced by the shell       | none                                 |
| Layout-induced sequential DB waterfall         | none — the shell performs no DB work |
| Duplicate `owner_authentication` timing event  | none                                 |
| Server-only DB or auth code in client bundles  | none                                 |
| Handoff state after removing `'use client'`    | unaffected                           |

No production APM, RUM, Web Vitals, or vendor telemetry was added. The only instrumentation
P1.4 added is **harness-only**: operation counters on the local Auth double, which is a
loopback test server.

---

## 11. Accessibility (P1.4 scope only)

Delivered because the shell requires it: `<header>`, named `<nav aria-label="Owner">`,
`<main id="main-content">`, exactly one `<h1>` per page, a skip link that is the first
focusable control and genuinely moves focus, `aria-current="page"` plus a non-colour-only
active treatment, native focus order, `:focus-visible` extended to shell controls, textual
status meaning, truthful loading and empty states, and the existing 2.75rem touch-target
minimum preserved (measured at ≥44px in the browser).

Viewport metadata was added — without it mobile browsers assume a desktop-width viewport and
scale the page down, making every touch target smaller than its declared size. `maximumScale`
and `userScalable` are left at their defaults so pinch-zoom keeps working.

**Deliberately deferred to P1.5:** axe, comprehensive contrast closure, dialog focus trapping,
Escape-key dialog redesign, a global accessibility audit, and error-boundary accessibility
work. No reduced-motion block was added, since no motion exists to guard.

> **Delivered in P1.5.** `@axe-core/playwright` was added as a test-only dev dependency and the
> D119 gate runs 28 local scans at 0 serious / 0 critical; Recipient dialog focus trapping,
> Escape handling, focus restoration, and status announcements landed in `85ad4d1`; production
> scanning returned 0 findings at every impact level ([P1_5_EVIDENCE.md](P1_5_EVIDENCE.md) §3).

---

## 12. Remaining gaps

- Recipient capability timestamps still use their existing presentation path
  (`toLocaleString`), so Recipient-local presentation remains outside P1.4. — **Closed by
  P1.5** (`ffe3858`): Recipient timestamps now use deterministic organization-timezone
  rendering.
- Recipient capability presentation retains the final title-summary duplication and the
  legacy CSS aliases in `globals.css` (capability stylesheet untouched; P1.5). — **Closed by
  P1.5**: duplication removed via the shared `summaryPointText` formatting (`9701f47`); four
  of the five legacy aliases removed in favour of canonical `--aicaa-*` tokens (`8588c5d`).
  The unused `--paper` alias remains declared with zero consumers and awaits separate
  authorization — a non-blocking advisory.
- Precise note truncation disclosure requires a future contract field; note-bound wording
  states only what was shown.
- Production had no unassigned actionable Task, so the Recipient selector overflow fix was
  not exercised with live Recipient options (CSS and local browser evidence only).
- Production had no due date, derived urgency, or failed delivery data, so those positive
  rendering paths remain locally proven rather than production-proven.
- Unauthenticated `/tasks` briefly renders identity-independent Owner chrome before its
  loading-boundary redirect completes (see [OPEN_QUESTIONS.md](OPEN_QUESTIONS.md) and the
  P1.5 input in [MILESTONES.md](MILESTONES.md)); not a P1.4 closure blocker. — **Closed by
  P1.5** (`dd44624`): the Owner gate moved above the shell, so the request now returns a true
  307 with the deep link preserved and no chrome painted. Production-confirmed.
- Sign-out soft-error hardening remains later work.
- Owner-authentication duration may under-report when layout resolution starts first,
  although the event **count** is correct.
- Comprehensive accessibility, global error/not-found, and connectivity work remain P1.5. —
  **Closed by P1.5**: application boundaries including the global error fallback and styled
  not-found (`6aaa054`), lost-connectivity feedback (`0ec068b`), dialog keyboard and focus
  behaviour (`85ad4d1`), and the automated D119 accessibility gate (`2ee23f1`).
- One transient sub-resource 404 during production validation did not reproduce and requires
  no action unless it recurs.
- One isolated A7.4 MIME timeout remains a pre-existing load flake under heavy local test
  load, not a P1.4 defect.

---

## 13. Production validation and closure

**Closure decision:** Close P1.4.

Validated against production after the automatic deployment of commit
`a38c85741fbfd3055cbf3a5a4b325205823feab6` (`feat(web): add P1.4 owner application shell`).
No manual deployment, retry, rollback, promotion, or tag was performed for this closeout.

### Deployment identity

| Field                                          | Value                                                                         |
| ---------------------------------------------- | ----------------------------------------------------------------------------- |
| Deployment ID                                  | `dpl_F5zjNcc4zwiwbr25CSdMGA3zDy8c`                                            |
| Project                                        | `rocket-communicator-web`                                                     |
| Environment                                    | `production`                                                                  |
| Source branch                                  | `main`                                                                        |
| Source commit                                  | `a38c85741fbfd3055cbf3a5a4b325205823feab6`                                    |
| Immutable deployment URL                       | `https://rocket-communicator-3lqazi9ua-claytons-projects-37065b04.vercel.app` |
| Stable production URL                          | `https://rocket-communicator-web.vercel.app`                                  |
| Created                                        | 2026-07-30 08:43:13 PDT                                                       |
| Building                                       | 2026-07-30 08:43:15 PDT                                                       |
| Ready                                          | 2026-07-30 08:44:07 PDT                                                       |
| Build duration                                 | 54 seconds                                                                    |
| Deployment state                               | `READY`                                                                       |
| Production alias                               | assigned and current                                                          |
| Retry / rollback / replacement / manual deploy | none                                                                          |

The immutable URL sits behind Vercel deployment protection; application validation used the
stable production alias.

### Authentication evidence — distinguish local and production proofs

**Local exact Auth HTTP proof** (unchanged; still authoritative for the HTTP count):
`apps/web/e2e/specs/owner-shell-auth.spec.ts` counts real `GET /auth/v1/user` requests at the
Supabase Auth double while Next.js renders layout plus page. That remains the exact Auth HTTP
count evidence.

**Production operation-event proof** (this validation): privacy-safe `operation_timing`
diagnostics. Production logs exposed **operation events**, not raw Auth HTTP counts. Do not
read the table below as an exact Auth HTTP count.

| Route             | Document requests | `owner_authentication` events per request |
| ----------------- | ----------------- | ----------------------------------------- |
| `/tasks`          | 5                 | exactly 1                                 |
| `/tasks/[taskId]` | 4                 | exactly 1                                 |

Additional production observations:

- `/api/v1/tasks`: zero `owner_authentication` events (API route uses its own operation
  instrumentation).
- `/c/[token]`: three invalid synthetic capability-page requests, each with **zero** Owner
  authentication events.
- **Zero** requests emitted duplicate `owner_authentication` events.
- The shell added no second authentication operation and no database query.
- No operational failures or timeouts appeared during the validation window.
- **`/attention` was not present in the captured production log window**, so its exact
  production event count remains a **sampling gap**, not a defect. `/attention` shares the
  same `(owner)` layout and `requireOwnerPage` path as the measured routes.

### Owner shell

Production confirmed: one `<header>`; one `<nav aria-label="Owner">`; one
`<main id="main-content">`; one page-owned `<h1>` per route; first-focusable skip link;
unchanged product identity; Owner display name shown; navigation exactly Tasks, Attention,
and Sign out; active route uses `aria-current="page"` plus a non-colour treatment; shell
persists through Task list/detail navigation; no duplicate shell or navigation; zero
horizontal overflow at desktop and Pixel 7 sizes; touch targets ≥ 44px; pinch zoom enabled.

### Sign-out

Production confirmed: native `POST /auth/sign-out`; HTTP 303 to `/login?signed_out=1`;
server-side session invalidated; subsequent `GET /api/v1/session` returned 401; subsequent
`/tasks` gated to login; `GET /auth/sign-out` returned 405; no open redirect; no
business-data mutation.

### Attention

Production copy (truthful empty destination):

> There is nothing to show here.
>
> This destination is where Tasks needing your attention and operational status will appear.
> Neither is built yet, so this page is empty by design rather than because something failed.
>
> This page does not monitor anything, hold a queue, count anything, or track a schedule, and
> nothing on it updates on its own. The Tasks page remains the complete and current list of
> your Tasks.

Confirmed: no queue, count, reminder, schedule, operational status, A8 data,
invisible-automation implication, or database read.

### Timezone

| Item                         | Value                          |
| ---------------------------- | ------------------------------ |
| Tested instant               | `2026-07-28T18:30:45Z`         |
| Expected Vancouver rendering | `Jul 28, 2026, 11:30 a.m. PDT` |
| Production rendering         | `Jul 28, 2026, 11:30 a.m. PDT` |

Confirmed: correct Vancouver calendar date and PDT offset; identical rendering under an
emulated `Asia/Tokyo` browser timezone; no raw ISO timestamp; no hydration mismatch.
Recipient capability timestamps remain outside P1.4 and continue using Recipient-local
presentation.

### Task presentation

Production contained seven Tasks (3 completed, 3 open, 1 dismissed; 6 assigned, 1
unassigned; 3 sent deliveries; no due dates; no derived urgency; no failed delivery).

Confirmed: rendered list matched API count and ordering; human-readable status labels;
truthful assignment labels; no raw status enum; no filter, grouping, sorting, or count
control; no due-soon/overdue or delivery-failure label because no DTO supported one; Task
detail `<h1>` used a derived title rather than literal `Task`; Summary / Completion / Notes /
Handoff hierarchy intact; inspected Task returned two notes and correctly omitted the
100-note notice; no raw delivery enum; no business-data mutation.

### Responsive / accessibility smoke and regression

Desktop and Pixel 7: zero horizontal overflow; skip link first-focusable and targeting
`#main-content`; active navigation distinguishable without colour alone; viewport meta leaves
pinch zoom available. Unauthenticated Owner API gates remained healthy; `/tasks` and
`/tasks/[taskId]` authenticate before protected data disclosure; `/attention` gates correctly;
capability pages remain outside Owner chrome and fail closed on invalid synthetic tokens with
zero Owner authentication; product name unchanged; no A4–A7 regression observed. Gmail,
polling, suggestions, approvals, dismissals, and handoff mutations were intentionally
untouched.

### Tag status

No tag was created for this closeout.

`v0.7.0-p1.4-complete` is **rejected** as convention-inconsistent: existing tags are
milestone-level (`v0.5.0-a5-complete`, `v0.6.0-a6-complete`, `v0.7.0-a7-complete`), and that
name reuses A7’s `0.7.0` while introducing slice-level tagging without precedent.

Tagging is deferred to a separately authorized decision between:

1. **Preferred:** tag only when all of P1 closes, with a convention-compatible milestone tag
   such as `v0.8.0-p1-complete`.
2. **Alternative, requiring explicit authorization:** create the first slice-level tag
   `v0.8.0-p1.4-complete`.

### Closure status after this evidence

Status **as recorded at P1.4 closure** (historical; see the row below it for current state):

| Item       | Status at P1.4 closure                                                         |
| ---------- | ------------------------------------------------------------------------------ |
| P1.4       | **Complete**                                                                   |
| P1 overall | **Open**                                                                       |
| D119       | **Open** (P1-wide closure still depends on P1.5 and final P1 closure evidence) |
| D120       | **Open**                                                                       |
| P1.5       | **Not started**                                                                |
| A8 / A9    | Untouched                                                                      |

**Current state at P1 closeout** (supersedes the table above):

| Item       | Status now                                                       |
| ---------- | ---------------------------------------------------------------- |
| P1.4       | **Complete** — unchanged                                         |
| P1 overall | **Complete** — implemented, deployed, production-validated       |
| D119       | **Met** ([P1_5_EVIDENCE.md](P1_5_EVIDENCE.md))                   |
| D120       | **Open** — unchanged                                             |
| P1.5       | **Complete**, with one documented production evidence limitation |
| A8 / A9    | Untouched — A8 remains the next milestone                        |
