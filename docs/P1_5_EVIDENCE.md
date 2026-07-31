# P1.5 evidence — boundary completion, accessibility verification, connectivity feedback, production validation

**Status:** P1.5 — **implemented, deployed, and production-validated with one documented
evidence limitation.** P1 overall is **complete**.

P1.5 closed the boundary, accessibility, connectivity, and presentation work D112 and D119
require, and carried P1 through push, automatic production deployment, and controlled
production validation. One part of the production validation could not be performed at all,
for a deliberate product-safety reason recorded in [§6](#6-production-evidence-limitation--recipient-capability-workflow).
That limitation is **not** a defect and **not** a failed validation.

Authorizing decisions: D111 (P1 scope), D112 (truthful experience states), D114 (capability
telemetry prohibition), D119 (boundary, accessibility, and verification rules).

---

## 1. What P1.5 implemented

Nine commits, each a single reviewed change, from `6aaa054` to `8588c5d`:

| Commit    | Change                                                                                             |
| --------- | -------------------------------------------------------------------------------------------------- |
| `6aaa054` | Application boundaries — global error fallback, segment error coverage, styled not-found state     |
| `dd44624` | Owner authentication gate moved above the shell, removing the unauthenticated gate flash           |
| `9701f47` | Recipient Task title/summary duplication removed via the shared `summaryPointText` formatting      |
| `ffe3858` | Recipient timestamps moved off `toLocaleString()` to deterministic organization-timezone rendering |
| `d0fea4a` | Generic loading boundary for the Recipient capability surface                                      |
| `0ec068b` | Truthful lost-connectivity feedback for Recipient capability actions                               |
| `85ad4d1` | Recipient confirmation-dialog keyboard, focus, and status-announcement behaviour                   |
| `2ee23f1` | D119 automated accessibility gate (`@axe-core/playwright`), test-side only                         |
| `8588c5d` | Legacy Recipient CSS variable aliases removed in favour of canonical `--aicaa-*` tokens            |

The gate-flash fix (`dd44624`) is the direct answer to the P1.4 production input recorded in
[MILESTONES.md](MILESTONES.md) and [P1_4_EVIDENCE.md](P1_4_EVIDENCE.md) §12: unauthenticated
`/tasks` no longer renders identity-independent Owner chrome before redirecting. See
[§5](#5-p14-observation-reconciled) for the wording reconciliation.

---

## 2. Deployment identity

Automatic Vercel production deployment on push to `main`. No manual deployment, promotion,
retry, rollback, or tag was performed.

| Field                        | Value                                                                         |
| ---------------------------- | ----------------------------------------------------------------------------- |
| Deployed commit              | `8588c5d260176b24c8ecf6fb16e026c5c6034359`                                    |
| Deployment ID                | `dpl_7vmnL71Lck7JLeftgsJkYVJ4uw82`                                            |
| Immutable deployment URL     | `https://rocket-communicator-fokub6tw4-claytons-projects-37065b04.vercel.app` |
| Stable production alias      | `https://rocket-communicator-web.vercel.app`                                  |
| Project / environment        | `rocket-communicator-web` / `production`                                      |
| Source branch                | `main`                                                                        |
| Created                      | 2026-07-30 13:51:44 PDT                                                       |
| Deployment state             | `READY`, alias assigned and current                                           |
| Production validation date   | 2026-07-30                                                                    |
| Rollback deployment retained | `dpl_3sp18eqYRQH6bjKdXC72Tue263V1` (commit `243895f`, the P1.4 closeout docs) |

**Rollback target correction.** The validation authorization named
`dpl_F5zjNcc4zwiwbr25CSdMGA3zDy8c` (the P1.4 deployment, commit `a38c8574`) as the rollback
target. By the time of the push, production had already advanced to the documentation-only
commit `243895f`, so that target was stale. The retained rollback deployment is therefore
`dpl_3sp18eqYRQH6bjKdXC72Tue263V1`. Application code in `243895f` is identical to the P1.4
validated build; only documentation differs. The P1.4 deployment remains available.

No rollback condition was triggered. No rollback was performed.

---

## 3. Production validation — successfully validated

Validated against the stable production alias on 2026-07-30.

### Signed-out and public routes

`/` and `/login` return 200 and carry no Owner chrome. An unknown path returns the P1.5
styled 404 rather than an unstyled framework page. Invalid capability links return the
generic unavailable view. Privacy headers are present and correct on capability responses:
`private, no-cache, no-store, max-age=0, must-revalidate`, `x-robots-tag: noindex, nofollow,
noarchive`, and `referrer-policy: no-referrer`.

### Redirects and the gate flash

Unauthenticated `/tasks` and `/attention` return a true **307** to `/login?next=…` with the
deep link preserved. No Owner chrome or protected content is serialized before the redirect,
so the P1.4 gate flash is gone. Attempts to spoof the internal `x-aicaa-owner-path` header,
including open-redirect payloads, were rejected.

### Sign-in, sign-out, and shell persistence

Sign-in through the genuine Google Workspace flow preserved the `next` destination and landed
on `/tasks`. `/tasks`, `/attention`, and one existing Task detail each returned 200 with
exactly one Owner shell, one `<h1>`, one `<header>`, one `<nav>`, and one skip link, and with
zero capability chrome. Client-side navigation kept the shell mounted; a delayed RSC payload
showed `Loading Tasks…` rendering **inside** the persistent shell rather than replacing it.
Across the navigation set, 87 tracked responses produced no 4xx or 5xx.

Sign-out returned to `/login?signed_out=1` with the shell and Owner identity gone, and both
protected routes then redirected to `/login?next=…` with no chrome flash.

The Task-detail check was performed read-only on an existing Task and issued **zero** non-GET
requests, so no business Task was altered.

### One authenticated Owner span per request

Measured from privacy-safe production `operation_timing` diagnostics:

| Request                              | `owner_authentication` spans |
| ------------------------------------ | ---------------------------- |
| Authenticated Owner document request | exactly 1                    |
| Capability route request             | 0                            |
| Signed-out redirect                  | no application diagnostic    |

Proxy cookie maintenance never appeared as a second verified Owner-authentication operation,
and no request emitted duplicate spans.

**Measurement caveat worth recording.** The live `vercel logs` stream silently dropped spans,
losing an entire request. The historical query API was complete but returned every row ten
times, and one platform row id mapped to two distinct messages, so deduplicating by row id
destroyed a real span. Only content-based deduplication produced correct counts. Either raw
output, taken at face value, would have suggested a duplicate-authentication regression that
does not exist.

**Scope of this proof.** It establishes exactly one instrumented `owner_authentication` span
per Owner document request. It does **not** independently establish the underlying Supabase
`getUser` network-call count, and platform log retention is demonstrably incomplete. The exact
Auth HTTP count remains proven by `apps/web/e2e/specs/owner-shell-auth.spec.ts`.

### Invalid capability behaviour and capability security (invalid-link scope)

Four probe shapes — nonexistent, malformed, traversal-style, and SQL-style — each returned an
identical generic "Link unavailable" page. No Task identifiers, no email addresses, no stack
traces, and no raw exception or response body were exposed. Three consecutive GETs were
byte-identical, so capability GET is non-mutating.

Two automated flags were investigated and proved benign: a `recipient` match came only from
the CSS-module class name `recipient-capability-module__…`, and the probe token appeared once
inside the Next.js RSC flight payload as the route segment the visitor themselves requested —
never in visible text.

Application diagnostics contained **zero** raw `/c/{token}` paths; capability routes were
identified only by the safe `/c/[token]` template, as D114 requires. See
[§7](#7-capability-urls-in-platform-access-logs) for the separate platform-log observation.

### Accessibility

Eight production scans — landing, login, invalid capability (desktop and mobile), Owner task
list, Owner task detail, attention, and Owner task list (mobile) — returned **zero**
violations at critical, serious, moderate, **and** minor. No traces, screenshots, or video
were produced, so no token-bearing artifact was retained.

The local D119 gate remains the primary acceptance evidence: 14 route/state scans × 2 browser
projects = **28 scans**, 0 serious, 0 critical, 4 moderate, 0 minor, with no rule disabled or
excluded. Production scanning is supplementary deployed-runtime evidence.

---

## 4. Production validation — what was not validated

The valid Recipient capability surface was not exercised in production. This covers the
loaded capability panel, its confirmation dialogs, Recipient mutations, and lost-connectivity
feedback against a live capability. Reason and classification: [§6](#6-production-evidence-limitation--recipient-capability-workflow).

All four areas are covered by the local suite and by the local D119 accessibility gate. They
are recorded as a **deployed-runtime evidence limitation**, not as unmet acceptance criteria.

---

## 5. P1.4 observation reconciled

[P1_4_EVIDENCE.md](P1_4_EVIDENCE.md) §1 states that `/tasks → 200` for an unauthenticated
visitor is an A7 closure baseline that a global redirect would break. That sentence is
**historically accurate for P1.4** and is left in place, with a pointer added to this section.

Two clarifications prevent it being read as a current statement:

1. **What the baseline actually protects is `/`, not `/tasks`.** `/` must keep serving
   unauthenticated visitors and must not be redirected to `/tasks`. That remains true.
2. **What P1.5 deliberately changed.** Unauthenticated `/tasks` previously returned 200 and
   painted identity-independent Owner chrome before its loading-boundary redirect completed.
   P1.5 moved the gate above the shell, so an unauthenticated request now produces a **307**
   to `/login?next=%2Ftasks` and nothing else.

The P1.4 text describes the behaviour P1.4 observed and closed against. The current behaviour
is the 307 recorded in [§3](#3-production-validation--successfully-validated). No A4–A7 gate
was weakened: `/tasks` still requires authentication, and it now refuses earlier rather than
later.

---

## 6. Production evidence limitation — Recipient capability workflow

**Production Recipient workflow validation could not be completed because the application
intentionally provides no safe production path for creating a synthetic Recipient
capability.**

This is **not** a defect, **not** a failed validation, and **not** an unmet acceptance
criterion. It is an intentional production evidence limitation caused by existing
production-safety rules working as designed.

The constraint chain:

1. Issuing a capability requires an active assignment — `lib/capability/issue.ts` rejects
   issuance with `Task must have an active assignment before issuing a capability`.
2. The only application path that creates an assignment is the A7 Gmail handoff workflow.
3. Handoff resolves its forward source **only** from the trusted, persisted Task source
   reference, requiring `sourceType === 'gmail'` plus a real Gmail `message_id`
   (`lib/handoff/forward-source.ts`), and it then **forwards that real email**.
4. A synthetic validation Task has no Gmail source, so handoff cannot proceed for it.

Production state at validation time confirmed there was no safe alternative: all seven
production Tasks were real business Tasks, none matched a synthetic-fixture pattern, and only
one carried a Gmail source reference. Gmail was connected with send scope available, so the
workflow was mechanically capable — the blocker is that every available source message is
real customer communication.

That left three options, each prohibited by the validation authorization: forward a real
business email, mutate an existing business Task, or write directly to the production
database. The local e2e suite reaches a capability only by attaching the assignment through a
database fixture (`attachActiveAssignment`), which is precisely the database shortcut the
authorization excluded.

Validation therefore stopped at this boundary. No production fixture Task, Recipient, or
capability was created; no email was sent; no reminder was scheduled; and nothing required
cleanup.

---

## 7. Capability URLs in platform access logs

Production observation: platform access logs naturally record request paths, and because the
capability identifier is embedded in the path, capability URLs appear in platform access logs.
During validation, Vercel's log wrapper recorded the probe's `requestPath` verbatim while the
application's own diagnostic correctly reported only the safe `/c/[token]` template.

Explicitly:

- **Not introduced by P1.5.** It follows from the `/c/{token}` URL scheme, which predates P1.
- **Not a regression.** Behaviour is identical under the P1.4 deployment.
- **Rollback would not change it.** The retained rollback deployment exhibits the same
  behaviour, so rolling back offers no mitigation.

The D114 application-side prohibition is intact and was verified in production: no raw
`/c/{token}` path appeared in any application diagnostic. This item is recorded as a future
architectural and security consideration only. **It is not a release blocker.**

---

## 8. Future consideration — no safe synthetic capability path

Recorded for future planning only. **This is not a backlog item, not an authorization, and not
a recommendation to implement anything now.**

Production currently lacks a safe mechanism for creating a synthetic validation Recipient
capability. The same product-safety rules that prevent unsafe testing against real customer
communications also prevent end-to-end production validation of the Recipient surface.

Both consequences are real and should be weighed together rather than separately:

- It complicated production validation, leaving the deployed Recipient workflow proven only
  by local evidence.
- It prevented unsafe testing against real customer communications, which is the behaviour the
  rules exist to produce.

Any future change here would need to preserve the second property while relaxing the first,
and would require its own decision and authorization.

---

## 9. Advisories carried forward

All non-blocking. None is a P1 closure blocker.

| Advisory                                                                                                                                                                                                   | Classification                                  |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| **Unused `--paper` alias** — declared in `globals.css` with zero consumers repo-wide. The other four aliases were removed in `8588c5d`; `--paper` awaits separate authorization.                           | Non-blocking debt                               |
| **Overpromising token-test title** — `p1-5-capability-tokens.spec.ts` titles a test "the unavailable link and loading boundary use the same tokens" but exercises only the unavailable link.               | Non-blocking debt — naming, not a coverage hole |
| **Two moderate `page-has-heading-one` advisories** on the loading boundaries, one per browser project. Correct behaviour for a skeleton and below the D119 gate, which is set at zero serious or critical. | Non-blocking advisory                           |
| **Java unavailable, so `pnpm verify` cannot run in full** — `contracts:generate` and the Android Gradle gates cannot execute on this machine.                                                              | Non-blocking, scoped to contract verification   |

The loading-boundary advisories are expected: a loading skeleton legitimately has no `<h1>`.
The Java limitation is environmental and pre-existing; it reproduces with all P1.5 changes
stashed, and no contract source, generated contract file, or Android file was modified by P1.

---

## 10. Closure status after this evidence

| Item                          | Status                                                                                                          |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------- |
| P1.5                          | **Complete**                                                                                                    |
| P1 overall                    | **Complete** — implemented, deployed, production-validated                                                      |
| Production Recipient workflow | **Evidence limitation** ([§6](#6-production-evidence-limitation--recipient-capability-workflow)) — not a defect |
| D119                          | **Met** — 28-scan local gate at 0 serious / 0 critical; production 0 at all impacts                             |
| D120                          | **Open** — unchanged; must be resolved before any product rename                                                |
| Release tag                   | **Not created** — deferred to a separately authorized decision                                                  |
| A8 / A9                       | **Untouched** — A8 remains the next milestone                                                                   |
