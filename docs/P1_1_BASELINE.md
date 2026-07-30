# P1.1 baseline evidence

**Status:** captured during P1.1 implementation (pre–experience-change).  
**Environment:** local development machine (macOS, Node 22, Vitest) — structural and unit probes taken on commit base `19797f6` (P1.0 lock) plus the P1.1 implementation. **No production, staging, or browser measurement was taken.**  
**Method:** code inspection, automated structural tests, and unit-level timing probes. **Not** production APM. **Do not** treat local samples as production p75/p95 or Web Vitals.

Governing decisions: D113–D115, D119.

> This document records the **P1.1 baseline as it was measured**, before any experience change, and is deliberately not rewritten. The P1.3 measurements taken against it are in [P1_3_EVIDENCE.md](P1_3_EVIDENCE.md); where a gap below has since been addressed, it is annotated in place.

---

## 1. Correlation coverage

| Surface                                                       | Before P1.1                                                      | After P1.1                                                                            |
| ------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Owner task / recipient / Gmail / capability API route context | Minted `requestId`                                               | Minted once per request; stored in AsyncLocalStorage                                  |
| Public `ErrorResponse.requestId`                              | Fresh `randomUUID()` unrelated to route context                  | **Reuses** request-scoped `requestId`                                                 |
| `ErrorResponse.correlationId`                                 | Always `null`                                                    | Remains optional/null (distinct from `requestId`)                                     |
| Structured operational diagnostics                            | Absent (except handoff + gated DB probe)                         | Always-on JSON records include `requestId` + safe `routeTemplate`                     |
| `AuditEvent.requestId`                                        | Already supported; filled when services pass `command.requestId` | Unchanged schema; route context `requestId` continues to flow into mutations          |
| RSC `error.digest` (Owner `/tasks` segment boundary)          | Next.js framework digest                                         | **Still framework-owned** — not unified with application `requestId` (documented gap) |

**Representative join key:** application `requestId` (UUID).

**Not applicable / not collapsed:** Idempotency-Key, provider message IDs, audit event primary keys, Next.js digests.

---

## 2. Authentication calls per Owner page request

**Measured (structural):** **2** calls to `supabase.auth.getUser()` per authenticated Owner page navigation.

| Call site                                                        | Role                                |
| ---------------------------------------------------------------- | ----------------------------------- |
| `apps/web/proxy.ts`                                              | Session refresh for non-`/c/` paths |
| `apps/web/lib/auth/require-owner.ts` → `getAuthenticatedOwner()` | Page/API Owner gate                 |

**Automated proof:** `apps/web/__tests__/p1-1-baseline-structural.test.ts`.

**Optimization:** deferred to **P1.3** (request-scoped auth deduplication). P1.1 does not change this behaviour. **P1.3 outcome:** the proxy call became `getSession()` (cookie maintenance, discarded result), leaving `getAuthenticatedOwner()` as the single server-verified identity operation — see [P1_3_EVIDENCE.md](P1_3_EVIDENCE.md) §1.

---

## 3. Database-operation shape (relevant routes)

| Route / operation                     | Observed shape (code inspection)                                        | Notes                                                          |
| ------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------- |
| Owner Task list RSC                   | `getDb` + `listOwnerTasks` → `listTasks` includes **unbounded** `notes` | Payload grows with note history; bound in **P1.3**             |
| Owner Task detail RSC                 | `getOwnerTask` + `listOwnerRecipients` + `getGmailConnection`           | Parallel after task load                                       |
| Capability page `/c/[token]`          | `getDb` + `validateCapabilityToken` (hash lookup)                       | Non-mutating                                                   |
| Owner task HTTP (`runOwnerTaskRoute`) | Auth + `getDb` + handler-specific queries                               | Timing emitted as `owner_task_route`                           |
| Recipient capability HTTP             | Token validate + mutation/read                                          | Timing emitted as `recipient_capability_route`; path templated |

Exact round-trip counts were **not** instrumented at the Prisma query level in P1.1; P1.3 may assert a documented maximum. **P1.3 outcome:** documented maxima are now asserted for the Owner list, Task detail, capability authorization, and shared mutation paths — see [P1_3_EVIDENCE.md](P1_3_EVIDENCE.md) §2.

---

## 4. Diagnostic coverage

| Seam                                             | Always on?                                     | Privacy                                         |
| ------------------------------------------------ | ---------------------------------------------- | ----------------------------------------------- |
| Operational log (`emitOperationalLog`)           | Yes                                            | Scrubs capability secrets; safe route templates |
| Operational failure (`logOperationalFailure`)    | Yes                                            | Category codes only — no stacks, SQL, bodies    |
| DB runtime failure (`logDatabaseRuntimeFailure`) | Only when `ENABLE_DB_RUNTIME_DIAGNOSTICS=true` | Unchanged incident probe; path scrubbed         |
| Handoff phase logger (A7.5)                      | Yes (handoff path)                             | Structurally content-free                       |

---

## 5. Capability-secret protections

- Client telemetry **not** added to `/c/[token]` (D114).
- Server diagnostics use `/c/[token]` and `/api/v1/capabilities/[token]/…` templates.
- Automated tests: `capability-telemetry-prohibition.test.ts`, `observability.test.ts`.
- Proxy retains `no-store`, `no-referrer`, `noindex` for `/c/`.

---

## 6. Timing samples (local unit probe only)

| Operation                                  | Method                          | What it measures                                                     | Result                          |
| ------------------------------------------ | ------------------------------- | -------------------------------------------------------------------- | ------------------------------- |
| `withOperationTiming('unit_timing_probe')` | Vitest, ~5 ms sleep             | Instrumented async function body only                                | `durationMs >= 0`, outcome `ok` |
| `owner_authentication`                     | Owner Task RSC pages            | `requireOwnerPage` wall time (not browser paint)                     | Emitted on auth success         |
| `owner_task_*_load`                        | Owner Task RSC pages            | Repository/service load after auth                                   | Emitted on load success         |
| `owner_task_*_page`                        | Owner Task RSC pages            | Wrapper spanning auth + load (server component work, not Web Vitals) | Emitted on success / error      |
| `*_route` / `capability_page_load`         | API runners / capability loader | Handler / loader wall time                                           | Emitted always on completion    |

**No production percentile claims.** Ratify absolute/relative thresholds only after comparable production or soak evidence (D119).

### Expected operational records per representative request

| Request                                     | `operation_timing` | `operational_failure`               |
| ------------------------------------------- | ------------------ | ----------------------------------- |
| Successful Owner Task list/detail RSC       | **3**              | 0                                   |
| Unauthenticated Owner page → login redirect | **0**              | 0 (control-flow; not an error)      |
| Successful Owner/capability/Gmail API route | **1**              | 0                                   |
| Domain 4xx thrown inside route runner       | **1** (`error`)    | **0** (expected client outcome)     |
| Infra / unknown failure inside route runner | **1** (`error`)    | **1** (+ gated DB probe if enabled) |
| Capability page load (ok or unavailable)    | **1**              | 0                                   |

Volume is proportionate for a vendor-neutral stdout seam. If production ingestion cost becomes material, prefer an authorized level/filter policy later — **do not** sample without a decision.

---

## 7. Known measurement gaps

1. RSC `error.digest` is not the application `requestId`.
2. No Prisma-level query counter yet. — **P1.3:** addressed with a test-only Prisma extension; no production counter was added ([P1_3_EVIDENCE.md](P1_3_EVIDENCE.md) §2).
3. No production RUM / Web Vitals baseline (none authorized).
4. Auth still double-calls `getUser` (P1.3). — **P1.3:** reduced to one verified `getUser` per Owner request; the proxy now performs cookie maintenance only ([P1_3_EVIDENCE.md](P1_3_EVIDENCE.md) §1). Deployed-runtime confirmation remains P1.5.
5. Task-list notes remain unbounded (P1.3). — **P1.3:** the list queries no notes at all, and the detail bundle is bounded to the contract maximum ([P1_3_EVIDENCE.md](P1_3_EVIDENCE.md) §2).
6. Browser journey harness is **P1.2**.
7. Internal cron routes enter request context and failure logging but do **not** emit `operation_timing` (outside the P1.1 minimum span list).
8. Owner page timings are server-component wall clocks overlapping auth+load; they are **not** Web Vitals or full HTML render metrics.

---

## 8. How to reproduce locally

```bash
pnpm --filter @aicaa/web test -- observability.test.ts capability-telemetry-prohibition.test.ts p1-1-baseline-structural.test.ts route-correlation.test.ts
```

Inspect server logs during `pnpm --filter @aicaa/web dev` for `operation_timing` / `operational_failure` JSON lines after exercising Owner and capability routes.
