# P1.3 evidence

**Status:** captured during P1.3 implementation. P1.3 is **implemented, pending architectural review**.
**Environment:** local development machine (macOS, Node 22, Vitest, in-process PGlite). **No production, staging, or deployed measurement was taken.**
**Method:** network-level call counting, Prisma operation counting via a test-only client extension, structural assertions, and a controlled note-heavy local fixture. **Not** production APM.

Governing decisions: D112, D114, D115, D119. Companion baseline: [P1_1_BASELINE.md](P1_1_BASELINE.md).

**How to read this document.** Query shape and call counts are the load-bearing evidence — they are asserted by tests and cannot drift silently. The durations in §5 are local context only. Do not convert them into thresholds, production percentiles, or universal percentage claims (D119).

---

## 1. Authentication: proxy and route boundaries

### What P1.1 recorded

**2** `supabase.auth.getUser()` calls per authenticated Owner page request — one in `apps/web/proxy.ts` for session refresh, one in `getAuthenticatedOwner()` for the Owner gate.

### What the runtime actually does

The P1.3 spike counted **Supabase HTTP operations**, not source call sites, by running the real proxy and the real server client against a stubbed `fetch` and recording every request to the Auth API.

| Auth API operation                             | Meaning                                         |
| ---------------------------------------------- | ----------------------------------------------- |
| `GET /auth/v1/user`                            | Server-verified identity — the call D119 counts |
| `POST /auth/v1/token?grant_type=refresh_token` | Cookie maintenance — issues no identity claim   |

Findings:

1. `getUser()` **always** performs `GET /auth/v1/user`; it is never served from the cookie.
2. `getSession()` performs **no** network call while the access token is outside its refresh margin, and performs **only** the token refresh when it is inside that margin.
3. A rotated cookie reaches the route only through Next.js's `x-middleware-request-*` override headers, and `NextResponse.next({ request })` captures those headers **when it is constructed** (`handleMiddlewareField` in `next@16.2.10`). Mutating `request.cookies` after building the response therefore updates the in-memory object but not the snapshot the route reads. The audit measured this directly against the installed Next.js: with the response built up front the route received the pre-rotation cookie. `createProxyClient` now rebuilds the response inside `setAll`, matching the Supabase Next.js middleware guidance, and `owner-auth-call-count.test.ts` asserts the override header rather than the in-memory request so the difference cannot be missed again.
4. A cookie that cannot be decoded at all (truncated, or written by a different Supabase project) makes `@supabase/ssr` **throw** rather than report an auth error. Both call sites now fail closed: the proxy continues without refreshing, and `getAuthenticatedOwner()` returns `null`. Previously this surfaced as a 500 on every Owner request, which a signed-out visitor could not clear.
5. The proxy makes no authorization decision, so it does not require a verified identity — only valid cookies.

### Selected design

| Layer                              | Before P1.3                | After P1.3                                                          |
| ---------------------------------- | -------------------------- | ------------------------------------------------------------------- |
| `apps/web/proxy.ts`                | `auth.getUser()`           | `auth.getSession()`, result **discarded** — cookie maintenance only |
| `getAuthenticatedOwner()`          | `auth.getUser()`           | `auth.getUser()` — unchanged, the sole verified identity operation  |
| Repeat calls in one request        | One `getUser()` per call   | Request-scoped memo keyed on the P1.1 request-context object        |
| `/c/**`, `/api/v1/capabilities/**` | `/c/**` skipped; APIs paid | Both skip Owner session work entirely                               |

### Measured operation counts

Asserted by `apps/web/__tests__/owner-auth-call-count.test.ts`. The three columns are counted separately on purpose: a refresh is **not** an identity check, and the two must never be summed into "one authentication call".

| Session condition (proxy + route)                       | Verified identity `GET /auth/v1/user` | Session refresh `POST /auth/v1/token` | Total Auth HTTP | Route outcome        |
| ------------------------------------------------------- | ------------------------------------- | ------------------------------------- | --------------- | -------------------- |
| Token comfortably outside the refresh margin            | **1** (was 2)                         | 0                                     | **1**           | Owner resolved       |
| Owner API, token outside the margin                     | **1** (was 2)                         | 0                                     | **1**           | Owner resolved       |
| Token inside the 90 s refresh margin, proxy only        | 0                                     | **1**                                 | **1**           | cookie rotated       |
| Expired token, valid refresh token, proxy **and** route | **1**                                 | **1**                                 | **2**           | Owner resolved       |
| Expired token, **invalid** refresh token                | **0**                                 | ≥1 (rejected)                         | ≥1              | `null` → sign-in     |
| Missing session cookie                                  | 0                                     | 0                                     | **0**           | `null` → sign-in     |
| Malformed session cookie                                | 0                                     | 0                                     | **0**           | `null` → sign-in     |
| Allowed Workspace identity                              | **1**                                 | 0                                     | **1**           | Owner resolved       |
| Disallowed Workspace identity                           | **1**                                 | 0                                     | **1**           | `null` → refused     |
| Three `getAuthenticatedOwner()` calls, one request      | **1**                                 | 0                                     | **1**           | memoized per request |
| Two sequential requests                                 | **2**                                 | 0                                     | **2**           | never reused         |
| Two concurrent requests                                 | **2**, not shared                     | 0                                     | **2**           | isolated             |
| `/c/[token]` and `/api/v1/capabilities/**`              | **0**                                 | **0**                                 | **0**           | capability auth only |

**D119 status.** The "exactly one Owner authentication call per Owner page request" criterion is **met for the verified-identity operation**, without weakening authentication. It is _not_ a claim of one total Auth network operation: a request whose token has reached its refresh margin performs one refresh **in addition to** the verified `getUser()`, for a total of two Auth HTTP calls. That refresh is cookie maintenance, and removing it would break sign-in continuity. D119 remains formally open until P1.5 validates the counts against the deployed runtime (§7).

---

## 2. Database work

All counts below are asserted by `apps/web/__tests__/p1-3-database-work.test.ts`, which counts Prisma client operations through a **test-only** `$extends` interceptor. No production middleware, query logger, APM layer, or vendor telemetry was added (D115).

| Path                            | Before P1.3                                                 | After P1.3                                                     | Test-enforced maximum                         |
| ------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------- | --------------------------------------------- |
| Owner Task list                 | `Task.findMany` + note relation for **every** row           | `Task.findMany`, **no** note relation; DTO carries `notes: []` | 0 `TaskNote.*`; exactly `['Task.findMany']`   |
| Owner Task detail               | `notes` unbounded, `createdAt asc`                          | `createdAt desc, id desc`, `take: 100`, reversed for display   | Exactly `TASK_DETAIL_NOTE_LIMIT` (100) notes  |
| Capability authorization        | Full detail bundle (`getTaskById`) before every gate        | `getTaskForCapabilityAuthorization` — row + active assignment  | 0 `TaskNote.*`; `notes` empty                 |
| Capability, unusable token      | Could load the full note bundle                             | **0** Task loads                                               | 0 authorization loads, 0 full loads           |
| Capability, rejected after load | Full note bundle                                            | **1** lean load, **0** full loads                              | Asserted in `capability-lifecycle.test.ts`    |
| Capability, valid               | Full bundle during authorization, then again for detail     | **1** lean load + **1** full load, after authorization         | Asserted in `capability-lifecycle.test.ts`    |
| Shared mutation transactions    | **2** full-detail bundle loads (one written, one discarded) | **1** authoritative full-detail load at the boundary           | `fullDetailLoads` equals `['Task.findFirst']` |

**Detail note bound — this is a real behaviour change above 100 notes.** `TASK_DETAIL_NOTE_LIMIT = 100` matches the OpenAPI `Task.notes` `maxItems`, which caps the array but does not say _which_ 100 notes must appear.

- **100 notes or fewer: unchanged.** Same notes, same oldest-first order, byte-identical response.
- **101 or more: the newest 100 are returned**, still oldest-first within that window. The oldest notes are no longer present in the response.
- Before P1.3 the API returned every note, so a long-lived Task **could emit a response that violated its own documented maximum**. Bounding it is a contract fix, not only an optimization.
- The newest window is the safer product choice: completion outcomes, Recipient replies, and the latest clarifications are the notes an Owner acts on, and they sit at the newest end. Returning the oldest 100 would hide exactly the notes that matter and would freeze the visible history at intake. Notes are also not the record of record — `AuditEvent` carries the durable identifiers, actors, timestamps, and action types ([DATA_RETENTION.md](DATA_RETENTION.md)), so no legally or operationally required trace depends on a note staying in the detail response.
- **There is no truncation indicator yet.** A Task above the bound currently looks complete in the UI. Exposing truncation truthfully needs a new response field, which is an OpenAPI change and therefore outside P1.3. Recorded for a later approved slice; any UI treatment belongs there too.
- Ties are deterministic: selection is `createdAt desc, id desc`, so notes written in the same instant break by id and repeated reads return the same window in the same order. Before P1.3 equal timestamps had no tie-break at all, so this is strictly more predictable.

Covered by `p1-3-database-work.test.ts` at 0, 1, exactly 100, 101, and 220 notes, with identical timestamps, id tie-breaking, ordering after reversal, and a significant note (a completion outcome) at the newest end surviving while the oldest intake note is dropped.

**Capability authorization fields.** Traced from the policy functions rather than guessed: `id` and `assignment.id` (`assertCapabilityBelongsToTask`), `status` (`assertTaskAllowsCapabilityMutation`), `assignment.deliveryStatus` (A7 delivery gate), `organizationId` (organization binding and defense-in-depth), and `version`, `waitingUntil`, `dueAt`, `outcome` (concurrency and eligibility context). The gate order is identical to the full bundle it replaces, so error precedence and the indistinguishable "link unavailable" responses are unchanged. The projection is authorization-only and is never returned: `validateCapabilityToken` returns the full bundle loaded after authorization. It is typed as `Task` with an empty `notes` array, so nothing at the type level would stop a future caller from serializing it — the guard today is that it never leaves the function.

**Mutation reload design.** `applyTaskUpdateWithExpectedVersion` performs the compare-and-swap write with identical semantics to `updateTaskWithExpectedVersion` — which is now literally that call plus a reload — and is package-internal, deliberately not exported. The three shared transactions that already reloaded at their boundary — `persistReturnToOwner`, `persistCapabilityAction`, `persistWorkRequest` — discarded the first reload's result before P1.3, so removing it changes no returned value. Nothing is synthesized: the single remaining `getTaskById` runs inside the transaction after every write, so database defaults, timestamps, and transaction side effects remain trustworthy, and a rollback returns no partially composed object. The A7 handoff transaction was not rewritten.

**Preserved.** Optimistic concurrency, `If-Match`, version increments, idempotency, audit records, assignment/completion/waiting state, appended notes appearing exactly once, ordering, response DTO shape, and transaction boundaries — each covered by assertions that fail on divergence.

---

## 3. List-response consumers

Before removing notes from list results, every in-repository consumer of `listTasks` / `listOwnerTasks` was traced: the Owner list RSC, the `GET /api/v1/tasks` route, and their tests. None reads `notes` from a list item. `Task.notes` is optional in the contract, so `notes: []` remains contract-valid. OpenAPI sources and generated clients are unchanged.

---

## 4. Proxy path matching

`isRecipientCapabilityPath()` matches exact, case-sensitive prefixes ending in `/`: `/c/` and `/api/v1/capabilities/`. A wrong answer cannot grant access — the proxy performs no authorization, and Owner routes verify identity independently before serving anything. Capability page headers (`no-store`, `no-referrer`, `noindex`) still apply to `/c/**`; capability APIs set their own response headers and are left untouched.

| Path                                        | Capability exemption | Why                                                                                                                                                                                                     |
| ------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/c/token`, `/c/token/`, `/c/`              | yes                  | matches the `/c/` prefix                                                                                                                                                                                |
| `/api/v1/capabilities/token[/tasks/id]`     | yes                  | matches the `/api/v1/capabilities/` prefix                                                                                                                                                              |
| `/c`, `/api/v1/capabilities`                | no                   | no trailing separator; neither reaches a capability route                                                                                                                                               |
| `/cx/token`, `/c-token`                     | no                   | different segment                                                                                                                                                                                       |
| `/C/token`                                  | no                   | Next.js route matching is case-sensitive, so no capability route exists                                                                                                                                 |
| `/api/v1/capabilities-admin[/token]`        | no                   | neighbouring name, not a capability route                                                                                                                                                               |
| `/api/v1/capability/token`                  | no                   | singular path is not the capability surface                                                                                                                                                             |
| `/c%2Ftoken`                                | no                   | the encoded separator stays inside one segment                                                                                                                                                          |
| `//c//token`, `/api/v1//capabilities/token` | no                   | Next.js 308-redirects any `//` or `\` path in `base-server` before a route is matched, so capability content is never served on the unnormalized path; the redirect itself costs only a session refresh |
| `/./c/token`, `/tasks/../c/token`           | yes                  | the URL parser resolves dot segments to `/c/token` before matching                                                                                                                                      |
| `/tasks?next=/c/token`                      | no                   | matching reads `nextUrl.pathname`, never the query string                                                                                                                                               |

Every row is asserted in `apps/web/__tests__/proxy.test.ts`.

---

## 5. Controlled local timings

**Fixture:** 25 Tasks × 200 notes (5,000 notes), list limit 25 — deliberately note-heavy, above the contract bound.
**Method:** `packages/db/scripts/p1-3-performance-evidence.mjs`. Audit-only; no test depends on it. Both sides of each pair run in the same process, on the same data, in the same run, so they share one warm-up state. 11 samples per variant after 3 warm-ups; median reported with the observed range.

Two consecutive audit runs, reported separately so the run-to-run spread is visible rather than averaged away:

| Comparison                                         | Before (median, run 1 / run 2) | After (median, run 1 / run 2) | Result bytes (identical both runs) |
| -------------------------------------------------- | ------------------------------ | ----------------------------- | ---------------------------------- |
| Task list query, with vs without the note relation | 59.93 / 61.30 ms               | 1.47 / 1.47 ms                | 1,739,730 B → 10,980 B             |
| Task detail query, unbounded vs bounded to 100     | 3.39 / 3.37 ms                 | 2.33 / 2.28 ms                | 69,721 B → 35,441 B                |
| Capability load, full bundle vs lean projection    | 2.36 / 2.37 ms                 | 0.90 / 0.86 ms                | 28,624 B → 625 B                   |

Observed ranges (run 1): list 58.23–69.38 ms → 1.40–1.63 ms; detail 3.24–7.08 ms → 2.22–2.75 ms; capability 2.29–2.48 ms → 0.84–1.03 ms. Medians moved by under 3% between runs and the byte counts are identical, because the fixture is rebuilt deterministically in a fresh in-process database each time. The single 7.08 ms detail sample in run 1 is exactly why the range is published alongside the median.

The script has no connection string at all — `createTestDatabase()` starts an ephemeral in-process PGlite instance — so it cannot reach Supabase, RDS, or any remote host, and repeated runs cannot accumulate data.

The shipped Owner list result for this fixture is 9,262 B across 25 Tasks and 0 notes.

**These numbers are local, single-machine, in-process-Postgres development samples.** They are not production measurements, not percentiles, and not a promise about any deployed environment. The magnitude tracks note volume, so a Task set with few notes will show little difference. Read them as directional confirmation of the query-shape change, nothing more.

---

## 6. Observability and privacy

Unchanged by P1.3: request IDs, safe route templates, the `operation_timing` / `operational_failure` taxonomy, expected-domain-rejection classification, and the capability telemetry prohibition. `operational_failure` is still reserved for operational failures — no transport timeout, domain 4xx, or capability rejection was reclassified.

The proxy exclusion removes Supabase work from capability requests but adds no logging to them. No capability token, cookie, authorization header, or protected content enters any log. Verified by `capability-telemetry-prohibition.test.ts`, `observability.test.ts`, and `route-correlation.test.ts`.

The client timeout helper emits nothing. A timeout is surfaced to the caller as a typed outcome; it is not logged from the browser, so no URL, header, or body reaches a log through this path.

---

## 6a. D112 client reliability

**Timeout constant.** `CLIENT_REQUEST_TIMEOUT_MS = 35_000`, one documented value for every browser request. It is derived from the slowest route rather than chosen as a round number: `POST /api/v1/tasks/{taskId}/handoff` performs a live Gmail send that the server bounds at `GMAIL_SEND_TIMEOUT_MS = 30_000`. A shorter client budget would abandon sends that are still inside their own budget and will most likely succeed, manufacturing exactly the ambiguous outcome D112 exists to avoid. `owner-api-client.test.ts` asserts the client value stays above the Gmail budget so the two cannot drift.

**Semantics.** `fetchWithTimeout` performs exactly one request and never retries, so a timeout cannot become a duplicate submission. A response of any status — including 409 and 412 — is returned untouched so callers keep parsing the server's own error envelope. Only the helper's own timer raises `RequestTimeoutError`; an abort from a caller-supplied signal is re-thrown unchanged. Timers are cleared for success, failure, timeout, and external abort. The bound covers reaching a response, not draining its body.

**Ambiguity.** A mutation with no response is classified `outcomeCategory: 'ambiguous'`, `status: 0`, never `412`, never success. `allowSameKeyRetry` stays true and `allowNewOperation` false, so the retry replays the original `Idempotency-Key`, `If-Match`, body, and action — asserted byte-for-byte across a repeated manual retry — and the pending operation surfaces the existing "check status" affordance rather than auto-submitting anything. A confirmed 412 keeps its own path: refresh state, then a new attempt. Controls are re-enabled in a `finally`, so no ambiguous outcome leaves a button stuck.

---

## 7. Known gaps carried forward

1. Deployed-runtime confirmation of the auth operation count is **P1.5**. All evidence here is local. The proxy-to-route cookie handoff is proven against the installed `next@16.2.10` override-header mechanism, not against a deployed Vercel runtime; document, RSC, prefetch, and API requests all traverse the same mechanism locally, but none of that is deployed proof.
2. Detail responses above 100 notes carry no truncation indicator, so a truncated history looks complete. Adding one requires an OpenAPI field and belongs to a later approved slice.
3. `fetchWithTimeout` bounds reaching a response, not draining its body; a server that sends headers and then stalls the body is not caught. Every current caller reads small JSON envelopes from this app's own routes.
4. There is no deterministic browser assertion for the Owner loading boundaries; the evidence is the unit/structural test in `owner-loading-boundaries.test.tsx`. See [P1_2_BROWSER_HARNESS.md](P1_2_BROWSER_HARNESS.md) for why dev-mode observation is not deterministic.
5. RSC `error.digest` is still not the application `requestId` (P1.1 gap, unchanged).
6. No production RUM, Web Vitals, or soak evidence exists — none is authorized.
7. Owner page timings remain server-component wall clocks, not paint metrics.
8. Handoff confirmation still lacks browser coverage because Gmail is excluded from P1.2.
9. `/c/[token]` has no loading presentation; it remains deferred (§8 of `MILESTONES.md` sequencing — the capability surface is touched last, in P1.5).

---

## 8. How to reproduce locally

```bash
# Call-count and structural evidence (assertions)
pnpm --filter @aicaa/web test -- owner-auth-call-count p1-3-database-work capability-lifecycle proxy p1-1-baseline-structural client-timeout owner-loading-boundaries

# Local timing evidence (audit-only, asserts nothing)
pnpm build:db && node packages/db/scripts/p1-3-performance-evidence.mjs
```
