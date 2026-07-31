# P1.2 — Browser Verification Harness

Deterministic browser coverage for the **current** Owner and Recipient journeys, captured before
any P1.3–P1.5 experience change (D119). This harness is verification infrastructure: it does not
redesign the application, change business rules, or optimize the journeys it measures.

Related: [MILESTONES](MILESTONES.md) · [P1_1_BASELINE](P1_1_BASELINE.md) ·
[ARCHITECTURE](ARCHITECTURE.md) · [SECURITY_AND_PRIVACY](SECURITY_AND_PRIVACY.md)

---

## 1. Framework

**Playwright** (`@playwright/test`), the framework D119 recommends. Before P1.2 it appeared in the
lockfile only as an unsatisfied optional peer of Next.js — not as a declared `apps/web`
dependency, and with no config, scripts, or specs. P1.2 adds it explicitly as an `apps/web`
devDependency (`^1.62.0`). No competing browser framework was added, no commercial testing
service is used, and no client analytics or telemetry is introduced.

| Item             | Location                                                 |
| ---------------- | -------------------------------------------------------- |
| Configuration    | `apps/web/playwright.config.ts`                          |
| Specs            | `apps/web/e2e/specs/`                                    |
| Fixtures/support | `apps/web/e2e/support/`                                  |
| Harness scripts  | `apps/web/e2e/scripts/`                                  |
| Artifacts        | `apps/web/e2e/.artifacts/` (gitignored, never committed) |

Execution is **headless by default**; `e2e:headed` is available for debugging. The harness runs as a
**separate job** and is deliberately **not** part of `pnpm verify` (D119).

---

## 2. Supported environment

The harness supports exactly one target: a **controlled local application with a disposable local
Postgres database and a local Supabase Auth double**.

It does **not** support, and must never be pointed at:

- production or any deployed preview environment;
- the production Supabase database (`DATABASE_URL` in `packages/db/.env`);
- the Owner's real Google Workspace account or production OAuth tokens;
- production capability tokens or real Recipient data.

This is enforced, not merely documented, by one shared guard
(`apps/web/e2e/config/local-db-guard.mjs`) that every entry point calls before touching anything:
the Playwright global setup, the database fixture process, and the cluster lifecycle script.

`assertLocalDatabaseUrl` **parses** the URL rather than pattern-matching the string, and accepts only
the loopback literals `127.0.0.1`, `localhost`, and `::1`. It refuses:

- deceptive hosts that merely begin with a loopback literal (`127.0.0.1.example.com`);
- user-info bypasses, where the real host follows a second `@`
  (`postgresql://u@127.0.0.1:5432@evil.example.com/db` targets `evil.example.com`);
- connection-target overrides (`?host=`, `?hostaddr=`, `?socket=`, `?servername=`) that can
  re-point a loopback URL elsewhere;
- percent-encoded hosts, non-`postgres` schemes, unparseable URLs, and empty or missing values —
  all fail closed;
- known managed hosts (Supabase, pooler, RDS, Amazon, Neon, Azure) as a secondary defence.

`assertLocalClusterTarget` guards the destructive lifecycle commands separately, because `initdb`,
`pg_ctl stop`, and `dropdb` take their target from environment variables. The socket directory must
be an absolute path (`dropdb -h` would otherwise treat it as a TCP hostname), the database name must
start with `aicaa_e2e`, the port must not be the conventional 5432, and the data directory must
contain `aicaa-e2e`. Adversarial cases for both guards are asserted in
`apps/web/__tests__/p1-2-harness-structural.test.ts`.

### Prerequisites

| Requirement        | Notes                                                                           |
| ------------------ | ------------------------------------------------------------------------------- |
| Node 22 (`.nvmrc`) | Same as the rest of the repository                                              |
| pnpm 9.15.9        | Same as the rest of the repository                                              |
| Local PostgreSQL   | `initdb`, `pg_ctl`, `createdb`, `psql` on `PATH`. The harness installs nothing. |
| Chromium binary    | `pnpm --filter @aicaa/web e2e:browsers`                                         |
| macOS or Linux     | Windows is **not supported** (POSIX paths and `pg_ctl` invocation)              |

### Portability, stated plainly

The harness has been executed on **macOS (arm64) only**, and it **is not wired into CI**. No CI job
runs it: `.github/workflows/ci.yml` covers contracts, domain, web, and Android, and P1.2 adds no job
there. Claims of portability beyond the local developer machine would be unearned.

Running it in CI later needs two things the repository does not have yet: PostgreSQL binaries on
`PATH` (GitHub's `ubuntu-latest` ships PostgreSQL, but not on `PATH` by default) and a Chromium
install step (`e2e:browsers`). Docker was considered and **deliberately not added**: this repository
has no `Dockerfile` or Compose file, so containers are not an existing convention, and introducing
one for a local harness would be new architecture rather than verification infrastructure. If a CI
job is authorized later, a standard Actions `services: postgres` container is the smaller step, since
it needs no repository-level Docker convention.

Local Postgres is used rather than PGlite because the application server connects over a real
connection string; PGlite is in-process only and is deliberately excluded from the application's
production dependency graph. The repository already assumes a local Postgres for Prisma CLI work
(`packages/db` `validate` uses `127.0.0.1:5432`), so this follows existing convention rather than
inventing a parallel architecture. **No migration was created for test convenience** — the harness
applies the existing committed migrations with `prisma migrate deploy`.

### Commands

```bash
# once per machine
pnpm --filter @aicaa/web e2e:browsers      # download Chromium

# per session
pnpm --filter @aicaa/web e2e:db:start      # provision/start the disposable cluster (port 55432)
pnpm --filter @aicaa/web e2e               # build workspace deps, then run the suite

# useful variants
pnpm --filter @aicaa/web e2e:only          # skip dependency builds
pnpm --filter @aicaa/web e2e:headed        # headed/debug mode
pnpm --filter @aicaa/web e2e:db:reset      # drop and recreate the database from migrations
pnpm --filter @aicaa/web e2e:db:stop       # stop the cluster (do this when you are done)
pnpm --filter @aicaa/web e2e:verify-artifacts  # re-run the capability-secret sweep by hand
```

The default reporter is **`list` only**. Playwright's HTML reporter embeds a base64 zip that can
retain page URLs (including `/c/{token}`) and that also produces nondeterministic `/c/...`
substrings inside opaque base64; it is therefore **not** enabled by default. To generate one while
debugging: `pnpm --filter @aicaa/web e2e:report:generate`, then
`pnpm --filter @aicaa/web e2e:report`, then delete `e2e/.artifacts`. The post-run sweep still gates
the result (fingerprinting opaque payloads; never scrubbing them in place).

The capability-secret sweep is enforced by **two** gates, both unavoidable from the documented
entry points (`e2e`, `e2e:only`, `e2e:headed`):

1. Playwright `globalTeardown` — runs whether the suite passed or failed, so a failing run (when
   screenshots and error context are retained) cannot skip the sweep.
2. `e2e/scripts/run-harness.mjs` — sweeps again **after** Playwright exits, because late reporter
   output would otherwise escape a teardown-only gate.

`e2e:verify-artifacts` exists only for re-checking artifacts by hand. A raw
`pnpm exec playwright test` still hits gate (1) but not gate (2); the package scripts do not expose
that path.

The disposable cluster lives at `~/.aicaa-e2e-pg` on port **55432** with database **`aicaa_e2e`** —
a non-default port so it cannot be confused with a developer's primary database. The cluster is
**left running** between runs on purpose, so repeated runs do not pay the startup cost; stop it with
`e2e:db:stop` when finished.

The Next.js server and Auth double are started and stopped by Playwright itself
(`reuseExistingServer: false`), so a prior orphan on the same port fails clearly rather than silently
becoming the harness target. The app server is launched through `e2e/scripts/run-web-server.mjs`,
which owns both `next dev` and the redacting log capture: a shell pipe (`next | redact-stream`)
orphans `next` on SIGTERM and holds port 3210 for the next run.

The harness uses exactly three ports, all defaulted in `e2e/config/e2e-env.ts` and
`e2e/scripts/local-db.mjs` and all overridable by environment variable:

| Port      | Process              | Variable        | After a clean run                        |
| --------- | -------------------- | --------------- | ---------------------------------------- |
| **3210**  | Next.js dev server   | `E2E_APP_PORT`  | released — Playwright owns the lifecycle |
| **54329** | Supabase Auth double | `E2E_AUTH_PORT` | released — Playwright owns the lifecycle |
| **55432** | Disposable Postgres  | `E2E_PG_PORT`   | still listening until `e2e:db:stop`      |

Cleanup verification must check all three. After a clean suite both loopback servers (3210 and 54329) should be gone; the Postgres cluster on 55432 is the only intentional survivor, and
`e2e:db:stop` must leave 55432 free with no stale postmaster socket or PID file.

---

## 3. Test identity and authentication

Owner authentication is Supabase Google OAuth with a verified Workspace `hd` claim. Real Google
sign-in cannot be automated, and no service-role key or admin API exists in this repository.

The harness therefore runs a **local Supabase Auth double**
(`apps/web/e2e/support/auth-double/server.mjs`) and points `NEXT_PUBLIC_SUPABASE_URL` at it. The
harness then drives the application's **real login flow**: `/login` → `signInWithOAuth` →
`/auth/v1/authorize` → `/auth/callback` → `exchangeCodeForSession` → `auth.getUser()`.

Consequences that matter for review:

- **No production authentication code was changed or weakened.** There is no bypass flag, no
  `NODE_ENV` branch, and no test-only code path inside `apps/web/lib/auth` or `proxy.ts`.
- **The real authorization logic executes**, including `getAuthenticatedOwner()`, the Workspace
  domain allowlist against verified Google identity data, and the RSC Owner gate.
- **Session cookies are set by `@supabase/ssr` itself** during the real code exchange. The harness
  does not forge or hand-write a session cookie.
- The double is reachable **only** when `NEXT_PUBLIC_SUPABASE_URL` is a loopback address, which is
  never true in production, and it binds to `127.0.0.1` only.
- It issues unsigned, locally scoped tokens (`alg: none`) that authorize nothing anywhere else and
  cannot produce a production session.

The double also exposes one control endpoint, `POST /__e2e__/hosted-domain`, so the harness can drop
the verified `hd` claim and exercise the application's genuine `unauthorized_domain` rejection.

Test identity: Owner `owner@e2e.invalid` (Supabase id `00000000-0000-4000-8000-00000000e2e1`),
organization **`org_e2e_local`** — never the production organization id.

These properties are asserted in `apps/web/__tests__/p1-2-harness-structural.test.ts`, which runs in
the ordinary unit suite.

---

## 4. Fixture strategy and test-data lifecycle

Fixtures are created through the **real authenticated Owner HTTP API** (task creation, notes,
completion, recipient creation, capability issuance), so they exercise real validation, If-Match
concurrency, and audit behaviour rather than writing rows behind the application.

One exception is documented and narrow: attaching an **active assignment** goes through
`apps/web/e2e/scripts/db-fixture.mjs`, because the only application path that creates an assignment
is Gmail handoff (A7), which P1.2 excludes. The same script ages a capability so the real expiry
branch can run, and performs server-side assertions. It runs as a separate ESM process because the
workspace packages are ESM-only while the Playwright loader is CommonJS.

Isolation and repeatability:

- every fixture is named with a **per-run unique prefix** (`e2e-<base36 time>-<random>`);
- assertions match only the current run's identifiers, so runs never interfere;
- **no spec depends on execution order, on database contents, or on another project having run
  first.** Every test seeds what it asserts. A structural test enforces this by rejecting any
  `test.skip` that is not a static project-name exclusion, because a skip conditioned on database
  contents silently asserts nothing while looking like a pass;
- retries do not accumulate misleading records: mutations are covered by If-Match, and duplicate
  side effects are asserted against, not tolerated.

The only skips are **static project exclusions** for contracts that are transport-level or
run-level rather than viewport-dependent (concurrency, correlation, artifact sweep): asserting them
twice would inflate the count without adding evidence.

**Cleanup is by disposal, not deletion.** Audit history is never deleted to make tests tidy (D-level
audit rules). The entire database is disposable: `e2e:db:reset` drops and recreates it from
committed migrations. Records therefore persist within a session and vanish on reset.

---

## 5. Capability-token policy

Raw capability tokens are minted at runtime by the real issuance route and are **never** committed,
and never written into a retained artifact.

| Control                             | Mechanism                                                                                                          |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| No token in the repository          | Tokens are runtime-only; placeholder tokens are repeated characters                                                |
| No archive that cannot be inspected | `trace: 'off'` and `video: 'off'` **globally**; capability specs also set them per file                            |
| No token in screenshots             | `screenshot: 'off'` on every capability spec                                                                       |
| No token in a failure message       | Capability assertions compare **booleans**, never the raw token as an expected value                               |
| No token in test titles/filenames   | Titles describe journeys; a structural test rejects token-shaped literals                                          |
| No token in the captured app log    | `e2e/scripts/run-web-server.mjs` redacts at write time (standalone `redact-stream.mjs` remains for manual capture) |
| No token in a diagnostic attachment | `redactCapabilityPaths` covers both `/c/{token}` and `/api/v1/capabilities/{token}`                                |
| Unavoidable post-run proof          | The sweep runs from `globalTeardown` on pass **and** on failure, and fails the run                                 |

Three findings from this slice's own audit shaped the list above, and each is worth understanding
before changing it.

**Disabling capture is not sufficient by itself.** Playwright writes an `error-context.md` attachment
whenever a test has errors, _regardless_ of `trace`, `screenshot`, and `video` settings. A failing
assertion of the form `expect(text).not.toContain(rawToken)` therefore writes the token to disk as its
"expected substring". Capability specs consequently compare booleans, and a structural test rejects
passing `capability.token` to a matcher.

**Prefix-based scanning is not sufficient either.** A token leaked that way appears **bare**, with no
`/c/` prefix for a pattern scan to find. The sweep therefore also matches by **fingerprint**: the
fixture records a SHA-256 digest of each minted token (a digest, never the secret) and the sweep
hashes every token-shaped candidate in every artifact, including a percent-decoded variant, and
compares. A planted-token test proves the gate fires.

**A sweep chained after the run misses the case that matters.** Retained artifacts are produced by
_failing_ runs, and a `&&`-chained script never executes then. The sweep is a `globalTeardown`.

Traces are off globally because a trace is a zip: a secret inside one cannot be verified without
decompressing it, so the sweep treats **any** retained archive as an unverifiable offender. Failure
diagnostics remain adequate — screenshot, error context, console and network capture, list reporter. A
deliberate `--trace on` debugging run will trip the archive check by design; delete those artifacts
rather than sharing them.

One honest nuance: the capability page's own client payload contains the token, because the Recipient
panel is authorized by that token and needs it to call the API. That is inherent to the design, not a
leak — and it is exactly why no HTML snapshot, trace, or screenshot of that route is retained.

---

## 6. Journey coverage

Executed on **Chromium desktop (1280×800)** and a **mobile Chromium viewport (Pixel 7)** unless
noted. Transport-level and artifact-sweep contracts run once, on desktop.

| Journey                                                                   | Spec                                   | Both viewports |
| ------------------------------------------------------------------------- | -------------------------------------- | -------------- |
| Unauthenticated Owner list/detail redirect, no protected content          | `owner-auth-gate.spec.ts`              | yes            |
| Authenticated Owner reaches `/tasks` via the real sign-in flow            | `owner-auth-gate.spec.ts`              | yes            |
| Non-Workspace Google account refused (`unauthorized_domain`)              | `owner-auth-gate.spec.ts`              | yes            |
| Task list renders seeded Tasks, truthful status, detail + back navigation | `owner-task-list.spec.ts`              | yes            |
| Task detail: summary, empty notes, unassigned state                       | `owner-task-detail.spec.ts`            | yes            |
| Task detail: notes, attribution, completion outcome, current controls     | `owner-task-detail.spec.ts`            | yes            |
| Unknown Task id renders a truthful not-found state                        | `owner-task-detail.spec.ts`            | yes            |
| Owner mutation succeeds; refresh does not duplicate it                    | `owner-mutation.spec.ts`               | yes            |
| Owner mutation without If-Match refused (428)                             | `owner-mutation.spec.ts`               | yes            |
| Valid capability renders context; **GET does not mutate**; headers        | `recipient-capability-valid.spec.ts`   | yes            |
| Authorized Recipient action: confirm, succeed, Owner-visible result       | `recipient-capability-valid.spec.ts`   | yes            |
| Capability diagnostics are template-only, never the raw token             | `recipient-capability-valid.spec.ts`   | yes            |
| Cancelling confirmation leaves the Task unchanged                         | `recipient-capability-valid.spec.ts`   | yes            |
| Unknown / malformed / expired capability leaks no Task content            | `recipient-capability-invalid.spec.ts` | yes            |
| Capability API refuses unknown token without disclosing the Task          | `recipient-capability-invalid.spec.ts` | yes            |
| Stale If-Match → 412, no duplicate, then confirmed recovery               | `concurrency-retry.spec.ts`            | desktop        |
| requestId correlation; domain rejection emits no `operational_failure`    | `correlation.spec.ts`                  | desktop        |
| Basic accessibility: headings, accessible names, keyboard activation      | `accessibility-basics.spec.ts`         | yes            |
| Raw tokens absent from retained artifacts                                 | `zz-artifact-safety.spec.ts`           | desktop        |

| P1.3 addition: unanswered mutation reported as uncertain, not success or 412 | `p1-3-transport-failure.spec.ts` | desktop |

### P1.4 additions

| Journey                                                                              | Spec                             | Both viewports |
| ------------------------------------------------------------------------------------ | -------------------------------- | -------------- |
| One verified `GET /auth/v1/user` per Owner page request, measured at the Auth double | `owner-shell-auth.spec.ts`       | desktop        |
| Sequential and concurrent Owner requests stay isolated                               | `owner-shell-auth.spec.ts`       | desktop        |
| Capability page performs zero Owner auth work                                        | `owner-shell-auth.spec.ts`       | desktop        |
| Sign-out revokes server-side at Supabase (`POST /auth/v1/logout` observed)           | `owner-shell-auth.spec.ts`       | desktop        |
| Shell persists across Task list ↔ detail navigation; Tasks stays current             | `owner-shell.spec.ts`            | yes            |
| Exactly one `<h1>` and one `<main>` on every Owner route                             | `owner-shell.spec.ts`            | yes            |
| Skip link is first focusable and moves focus to main content                         | `owner-shell.spec.ts`            | yes            |
| Owner display name appears in chrome without leaking Task data                       | `owner-shell.spec.ts`            | yes            |
| Shell stays visible while a Task page is loading                                     | `owner-shell.spec.ts`            | yes            |
| Sign-out returns the Owner to a signed-out state; `/tasks` then redirects            | `owner-shell.spec.ts`            | yes            |
| Attention destination is truthfully empty and claims no automation                   | `owner-attention.spec.ts`        | yes            |
| Attention destination is authenticated like every other Owner route                  | `owner-attention.spec.ts`        | yes            |
| Vancouver date/time rendered in an **Asia/Tokyo browser**, zone indicator shown      | `owner-presentation.spec.ts`     | yes            |
| Status and urgency render as human labels, never raw contract enums                  | `owner-presentation.spec.ts`     | yes            |
| Long title and long note wrap with no horizontal document overflow                   | `owner-presentation.spec.ts`     | yes            |
| No Owner route overflows the viewport horizontally                                   | `owner-shell-responsive.spec.ts` | yes            |
| Navigation and identity wrap rather than clip; stay inside the viewport              | `owner-shell-responsive.spec.ts` | yes            |
| Shell controls meet the 2.75rem (≈44px) touch-target minimum                         | `owner-shell-responsive.spec.ts` | yes            |
| Viewport meta present; pinch-zoom not disabled                                       | `owner-shell-responsive.spec.ts` | yes            |

`owner-shell-auth.spec.ts` measures Auth operations with **document requests** rather than
browser navigations: a navigation also triggers `next/link` prefetches, and each prefetch
legitimately renders the layout again, so a navigation-level count could not isolate the single
request D119 budgets. It sets `trace`, `screenshot`, and `video` to `off` because it opens a
capability link (§ artifact safety).

No screenshot baselines were added. Evidence: [P1_4_EVIDENCE.md](P1_4_EVIDENCE.md).

Experience states distinguished by browser assertions: **unauthorized**, **not found**,
**conflict (412)**, **precondition required (428)**, **ambiguous transport outcome**, and
**success**. The **empty** Task-list state is asserted in
`apps/web/__tests__/owner-tasks-pages.test.tsx` rather than in the browser — see "Known gaps",
as is the **loading** state added in P1.3.

---

## 7. Diagnostics

| Signal                        | Mechanism                                                              |
| ----------------------------- | ---------------------------------------------------------------------- |
| Screenshot on failure         | `screenshot: 'only-on-failure'` (disabled for capability specs)        |
| Trace                         | `trace: 'off'` globally — a zip cannot be swept for secrets            |
| Error context on failure      | Written by Playwright regardless of capture settings; swept every run  |
| Browser console errors        | Captured per test and asserted empty on critical journeys              |
| Uncaught page errors          | Captured per test and asserted empty                                   |
| Failed / 5xx network requests | Captured per test, redacted, attached to the report on failure         |
| Application `requestId`       | Read from public error envelopes and matched to structured server logs |
| Result summary                | `list` reporter (HTML reporter opt-in only; see Commands)              |

No cookie, authorization header, OAuth token, email body, Task note, excerpt, or provider credential
is attached to any report. Diagnostic attachments are limited to counts and redacted messages.

---

## 8. Correlation evidence

The harness reads the local application's captured stdout, which carries the P1.1 structured
diagnostic seam. This is controlled local log capture, not a new telemetry system, and it never
asserts against platform-specific production logs.

Assertions distinguish the two classes explicitly:

- an **expected domain rejection** (404 `NOT_FOUND`, 412 `PRECONDITION_FAILED`) produces
  `operation_timing` events carrying the same `requestId` as the public error envelope, and **no**
  `operational_failure` event;
- structured events record **route templates only** — `"/tasks"`, `"/api/v1/tasks/[taskId]"`,
  `"/c/[token]"` — never a raw Task id where a template is required, and never a raw capability path;
- the log is truncated by global setup, so a match cannot come from a previous run.

**Level and failure classification are separate axes, and the wording matters.** Per
[P1_1_BASELINE](P1_1_BASELINE.md) §6, a domain 4xx thrown inside a route runner emits exactly one
`operation_timing` at **`level: "error"`** with `outcome: "error"`, and **zero** `operational_failure`
records. The error level describes the request outcome; the _absence_ of `operational_failure` is what
marks it as an expected client outcome rather than something operationally broken. Saying "it is not an
error" would be wrong, and saying "it is an operational failure" would also be wrong. The browser test
pins both fields, so neither the implementation nor this description can drift silently.

---

## 9. Known gaps

Recorded truthfully rather than claimed as coverage.

1. **WebKit and Firefox are not configured and did not run.** Only Chromium engines executed. The
   project list is structured so an engine can be added later without restructuring.

   WebKit was evaluated rather than assumed impractical. On this machine (`mac14-arm64`) the WebKit
   binary downloads, but Playwright reports it as a **frozen** build that no longer receives updates
   for this OS version, and a minimal `webkit.launch()` probe produced **no output after four
   minutes** and had to be killed. WebKit is therefore recorded as **not practical here** and **no
   WebKit coverage is claimed**. Adding it needs a newer OS or a container, plus explicit authority to
   widen the matrix beyond the Chromium scope this slice was granted.

2. **Gmail handoff journeys are not covered in the browser.** Handoff requires Gmail credentials and
   is excluded from P1.2. Consequently the **ambiguous-retry branch that replays an original
   `Idempotency-Key`** is not exercised at browser level; it remains covered by the existing A7
   integration tests. The confirmed-412 recovery branch _is_ exercised here.
3. **The transient loading state has no browser-level evidence, for a structural reason rather
   than by omission.** P1.3 added route loading boundaries for `/tasks` and `/tasks/{taskId}`, but
   this harness runs `next dev`, and **Next.js disables prefetching in development**. The client
   router therefore has no copy of the `[taskId]` loading boundary until it fetches that segment,
   so holding the segment request open — the only way to make the boundary observable for longer
   than a frame — leaves the router with nothing to render and it simply stays on `/tasks`. This
   was tried and confirmed, including after warming the segment with a sibling Task.

   The remaining ways to observe it are all timing-dependent (racing a fast local server, or CDP
   bandwidth throttling), which would trade a real assertion for a flaky one — precisely what D119
   warns against. The boundary is therefore asserted where it is deterministic:
   `apps/web/__tests__/owner-loading-boundaries.test.tsx` renders both boundaries and asserts the
   truthful `role="status"` text, the absence of any Task content, status, or capability material,
   and that no loading file was added to `/c/{token}`. All existing browser journeys still pass
   with the boundaries in place, which is what confirms they do not disturb final state. A
   production-build harness run would make browser-level observation deterministic; that belongs
   with P1.5 production validation.

4. **The empty Task-list state has no browser-level evidence, by design rather than by omission.**
   The Task list is scoped by `organizationId` only, and that value comes from the
   `OWNER_ORGANIZATION_ID` environment variable, so a single running server has exactly one
   organization. Both viewport projects share one server and one disposable database, so a browser
   test could only observe an empty list by depending on global database emptiness — which makes the
   result depend on spec order, on project order, and on whether fixtures ran first. An earlier
   version of this harness did exactly that, with a filename ordered to sort first and a runtime skip
   when Tasks already existed; that is shared-state contamination masquerading as coverage, and it was
   removed.

   A dedicated empty organization would need a second application server (a second `next dev` cannot
   share the same `.next` directory), which is disproportionate for one assertion. The empty state is
   therefore asserted where it is genuinely deterministic — `owner-tasks-pages.test.tsx` renders the
   page with `items: []` and asserts the `role="status"` "No Tasks yet." text, zero list items, and
   the absence of the failure text. When P1.4/P1.5 introduce loading and error boundaries, a dedicated
   empty-scope environment is the right way to add browser-level evidence.

5. **No automated accessibility rule engine.** P1.2 verifies basic properties only; adding an axe
   dependency was deliberately avoided as unauthorized scope. — **Delivered in P1.5:**
   `@axe-core/playwright` was added as a test-only dev dependency and the D119 gate now runs 28
   scans at 0 serious / 0 critical ([P1_5_EVIDENCE.md](P1_5_EVIDENCE.md) §3).
6. **Evidence is local only, on macOS, and outside CI.** Nothing in this harness produces preview or
   production evidence, and no CI job runs it. — **Production validation against the P1.1 baseline
   was completed in P1.5** (D119), separately from this harness
   ([P1_5_EVIDENCE.md](P1_5_EVIDENCE.md) §3).
7. **Capability response `Cache-Control` cannot be proven in local development.** See findings below.
   The invariant is proven where it is constructed, by `apps/web/__tests__/proxy.test.ts`.

---

## 10. Findings for later P1 slices

Observed while capturing evidence. **Not fixed here** — P1.2 must not implement P1.3–P1.5 work.

1. **Capability page `Cache-Control` cannot be verified from local development.** `proxy.ts` sets
   `private, no-store, no-cache, must-revalidate` on `/c/*`, and that construction is already proven by
   a unit test (`apps/web/__tests__/proxy.test.ts`). The **HTML document response** observed in the
   browser against the dev server is `no-cache, must-revalidate` — `private` and `no-store` absent —
   because the dev server normalises the document response. `Referrer-Policy: no-referrer` and
   `X-Robots-Tag: noindex, nofollow, noarchive` survive intact and **are** asserted strictly in the
   browser.

   No application change was made: the invariant is not violated in the code, and local development
   cannot establish production caching posture either way. The browser assertion is deliberately
   recorded as **local-dev behaviour only** (`/no-store|no-cache/`), the structural proof stays in the
   proxy unit test, and confirmation against a production build or preview is a **later gap**, not a
   claim made here.

2. **The raw capability token appears in the RSC flight payload — expected transport, not a policy
   violation.** D114 prohibits capability tokens in **client telemetry, analytics, error reporting, and
   logging**; it does not prohibit the page from receiving the secret it was addressed with. The token
   is already in the address bar, and the Recipient panel needs it to call the capability API, so the
   payload carries no secret the client does not already hold. It is _not_ normalised silently, though:
   it is precisely why no trace, screenshot, or HTML snapshot of `/c/{token}` is retained, and why an
   assertion must never compare against the token itself.

   The broader question — whether a URL-borne secret should be exchanged for a short-lived presentation
   token, given browser history, referrers, and screen sharing — is real but **out of scope here**;
   referrer and indexing exposure are already mitigated by the headers above. It belongs to a future
   decision, not to P1.2.

3. **The framework's own request logger prints raw capability URLs.** The application's structured
   diagnostics are clean (route templates only), but the dev-server request line contains the token.
   The harness redacts its own capture; **platform request logs in production deserve the same
   scrutiny**, since a hosting provider's access log would record `/c/{token}`.
4. **The Owner UI exposes no non-Gmail mutation control.** Task detail offers only the handoff panel,
   so notes and completion are reachable only via the API. The representative Owner mutation is
   therefore driven through the authenticated HTTP surface and verified in the UI. Relevant to P1.4.
5. **No loading state on any route.** Navigation shows the previous view until the server responds.
   **Addressed in P1.3** for `/tasks` and `/tasks/{taskId}`; `/c/{token}` was **delivered in P1.5**
   (commit `d0fea4a`).
6. **No `data-testid` anywhere**, and none was added. Roles, labels, and headings were sufficient —
   worth preserving in P1.5.
7. **Duplicate Owner authentication per page request** remains observable in timing diagnostics
   (`owner_authentication` on each Owner page load), consistent with the known P1.3 deduplication item.
   **Addressed in P1.3:** the proxy now performs cookie maintenance only, leaving one server-verified
   `getUser()` per Owner request ([P1_3_EVIDENCE.md](P1_3_EVIDENCE.md) §1).

---

## 11. How P1.3–P1.5 should reuse this harness

- **Run it before and after every change.** `pnpm --filter @aicaa/web e2e` is the regression net for
  visual, shell, and boundary refactors.
- **Extend, do not fork.** Add specs under `e2e/specs/`; reuse `support/fixtures.ts`,
  `support/owner-api.ts`, and `support/capability-fixture.ts`.
- **Keep the capability rules.** Any new spec touching `/c/{token}` must disable trace and screenshot
  capture, and must never pass a raw token to a matcher. Structural tests enforce both and will fail if
  a spec forgets.
- **Never add a skip that depends on database contents.** A structural test rejects it. If a state can
  only be observed by controlling global data, give it its own scope rather than a conditional skip.
- **P1.4 (shell/navigation):** assert the current journeys still pass, then extend
  `accessibility-basics.spec.ts` for landmarks and focus order.
- **P1.5 (accessibility, boundaries, connectivity, production validation):** add loading-state and
  error-boundary assertions once those states exist, and add an engine to the project list if
  cross-browser coverage is authorized.

---

## 12. Status

P1.2 is **implemented, pending review**, and executable locally only.

Counted truthfully rather than as a headline:

| Measure                                         | Count                                                   |
| ----------------------------------------------- | ------------------------------------------------------- |
| Browser cases discovered                        | 58 (29 per viewport project)                            |
| Browser cases executed                          | 50                                                      |
| Intentional static project exclusions           | 8 (transport, correlation, and sweep contracts, mobile) |
| Runtime skips depending on data                 | 0                                                       |
| Structural unit assertions guarding the harness | 22                                                      |

These are **not** 58 independent behavioural contracts: the 8 exclusions are the same server-side
contracts already executed on desktop, deliberately not cloned across viewports.

Counts include the one desktop-only case P1.3 added (`p1-3-transport-failure.spec.ts`); the
original P1.2 figures were 56 / 49 / 7.

Evidence is **local, macOS, Chromium-only, and outside CI**. No preview or production evidence is
claimed, and WebKit is **unexecuted** rather than passing or failing.

> **Status update (P1 closeout).** The two statements above about _this harness_ remain accurate.
> The two P1-wide claims have since been overtaken: **D119 is now satisfied** and **P1 is
> complete**. P1.5 added the automated accessibility gate and completed production validation
> ([P1_5_EVIDENCE.md](P1_5_EVIDENCE.md)). Handoff-confirmation journey coverage is still absent
> from this harness, which is recorded as a non-blocking known limitation in
> [MILESTONES.md](MILESTONES.md).
