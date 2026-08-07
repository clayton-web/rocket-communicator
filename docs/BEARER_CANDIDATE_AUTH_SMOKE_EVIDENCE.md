# Bearer candidate authentication smoke-test evidence

**Status:** authenticated Bearer path **PASS**; missing-Authorization negative path **PASS**; cookie authentication **DEFERRED** (not failed); **this smoke did not authorize promotion**.

This records a **read-only** authentication smoke test against an immutable, unaliased Production-target Bearer release-candidate deployment. **At the time of this smoke**, it did **not** authorize promotion, alias changes, environment changes, cron changes, Stage 12, A8.7d, A8.7e, or any other production mutation.

> **Later production record (not part of this smoke):** under separate authorization, the Bearer candidate was promoted to public Production as deployment `dpl_Cs2TrnDsy1KSB3wipCCUt82Hpf8D` at commit `eb8cabe0619146087850802d4217dd8c3ce55119` (tree `2e244a832b5715592e3aa46919deda5b9ea185de`; provenance `rcGate=bearer-stage6`; public alias `rocket-communicator-web.vercel.app`; state **READY**; target `production`; posture **`F0`** — all A8 flags absent; no cron changes). See [DEPLOYMENT.md § Current production state](DEPLOYMENT.md#current-production-state). The smoke candidate below (`dpl_HpAZDkgUS6zj2fRES91YUqp3pUBb`) remains the historical probe target for this evidence file.

Related authority: **D145** (shared Owner pipeline accepts Bearer JWT); canonical probe `GET /api/v1/session` — [SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md), [API_CONTRACT.md](API_CONTRACT.md). Candidate creation context: Phase 3.1 / 3.1a / 3.2 operator sessions (unaliased deploy, default-alias restore, smoke-test preparation).

### What must never appear here

- `OWNER_JWT`, access tokens, refresh tokens, or any `Authorization` header value
- Vercel automation-bypass secret, `VERCEL_AUTOMATION_BYPASS_SECRET`, or bypass header values
- Vercel CLI / API tokens (`VT`)
- Cookie values or Set-Cookie contents
- Connection strings or other environment secrets

---

## 1. Candidate under test

| Field                           | Value                                                                         |
| ------------------------------- | ----------------------------------------------------------------------------- |
| Deployment ID                   | `dpl_HpAZDkgUS6zj2fRES91YUqp3pUBb`                                            |
| Immutable candidate URL         | `https://rocket-communicator-7lg9fngy4-claytons-projects-37065b04.vercel.app` |
| Endpoint                        | `GET /api/v1/session`                                                         |
| RC commit (authorized)          | `eb8cabe0619146087850802d4217dd8c3ce55119`                                    |
| RC baseline parent              | `d369c6d567c595ac0fb91b36744a2afb58717ecb` (Gate 5 / F0 code baseline)        |
| RC branch                       | `release/bearer-on-d369c6d`                                                   |
| Target                          | `production`                                                                  |
| Alias assignment for this smoke | **none** — candidate remained unaliased for the test                          |
| Promotion                       | **NOT AUTHORIZED** — not performed                                            |

---

## 2. Production posture during the smoke (operator-reported)

Operator handoff for this smoke:

- Production remained intentionally at **F0** (no promotion of the Bearer candidate).
- No aliases were changed by this smoke.
- No custom domain was assigned to the candidate.
- No environment variables or feature flags were changed.
- No cron jobs were created.
- No application data was modified.

**Repository note (resolved after this smoke, and not a smoke finding):** at the time of this smoke, uncommitted working-tree edits asserted Gate 6 complete at **`D3` / `F1`** with alias-holding deployment `dpl_7X5r5ypWbq6ipmWMpver6p99p5Xz`. That claim was **false**. The subsequent documentation reconciliation records the verified truth: Gate 6 was authorized and partially executed, `dpl_7X5r5ypWbq6ipmWMpver6p99p5Xz` reached READY as a production-target build but held only the two default `.vercel.app` aliases, the public custom domain never moved off Gate 5's `dpl_6cVssNpaZeKPBEVGDynd61AoS9nS` (`d369c6d`, F0) during that window, and the capture flag was later removed from the Vercel Production environment. See [DEPLOYMENT.md § Current production state](DEPLOYMENT.md#current-production-state) and [A8_7_EVIDENCE.md § Gate 6](A8_7_EVIDENCE.md#gate-6--first-controlled-production-enablement-a87c-capture--f0--f1). **A still-later authorized Bearer promotion** (separate from this smoke and from Gate 6) placed the public alias on `dpl_Cs2TrnDsy1KSB3wipCCUt82Hpf8D` / `eb8cabe` at **`F0`**. **Those reconciliations are documentation of already-authorized production facts.** This smoke itself made **no** production change: it did not promote the candidate, move any alias, or mutate Production, and the flag removal was a separate authorized action, not part of this smoke.

---

## 3. Smoke results

Both requests used a valid Vercel automation-protection bypass so the request reached Rocket rather than the Vercel Authentication boundary. Bypass secret values are **not** recorded.

### 3.1 Authenticated Bearer — **PASS**

| Check                        | Result                                                                                                                               |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Headers present (names only) | valid Vercel automation protection bypass; `Authorization: Bearer <private Owner JWT>`; `Accept: application/json`                   |
| HTTP status                  | **200**                                                                                                                              |
| `Content-Type`               | `application/json`                                                                                                                   |
| Redirect                     | **none**                                                                                                                             |
| Session shape                | `role` = `owner`; `organizationId` = `axford`; `ownerId` = `0ed250d0-a161-4e27-a498-868c2e886778`; `displayName` = `Clayton Beckler` |

**Interpretation:** the protection boundary was bypassed; the authenticated request reached Rocket; the shared Owner pipeline accepted the Bearer JWT and returned the expected Owner session. No mutation.

### 3.2 Missing-Authorization negative — **PASS**

| Check                        | Result                                                                                                                                                      |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Headers present (names only) | valid Vercel automation protection bypass; **no** `Authorization` header                                                                                    |
| HTTP status                  | **401**                                                                                                                                                     |
| `Content-Type`               | `application/json`                                                                                                                                          |
| Redirect                     | **none**                                                                                                                                                    |
| Error body                   | `error.code` = `UNAUTHORIZED`; `error.message` = `Authentication required.`; `requestId` = `a36c1551-8006-468b-8e02-010edccbdff5`; `correlationId` = `null` |

**Interpretation:** the unauthenticated request reached Rocket and was correctly rejected. No mutation.

### 3.3 Cookie authentication — **DEFERRED** (not failed)

Cookie Owner authentication on the immutable protected candidate URL remains **deferred**. Phase 3.2 preparation determined it is infeasible on the protected `.vercel.app` candidate without unauthorized configuration changes. **This is not a failed smoke.** Cookie auth on the live custom domain is unchanged and was out of scope for this candidate probe.

---

## 4. Conclusions (authoritative for this slice)

| Item                                                   | Disposition                                                                                                                           |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| Authenticated Bearer smoke (`GET /api/v1/session`)     | **PASS**                                                                                                                              |
| Missing-Authorization negative smoke                   | **PASS**                                                                                                                              |
| Cookie authentication on immutable protected candidate | **DEFERRED** — not failed                                                                                                             |
| Candidate promotion                                    | **Not authorized by this smoke** — a later separate authorization promoted a Bearer deployment to public Production (see header note) |
| Production / F0 posture from this smoke                | **Unchanged by this smoke** — no promote, no alias move, no env/flag/cron/data change during the smoke                                |
| Next production step                                   | **None authorized by this smoke record**                                                                                              |

---

## 5. Explicit non-claims

- Does **not** close Gate 6, Stage 12, A8.7d, or A8.7e.
- Does **not** authorize Android activation or Owner Acceptance Week.
- Does **not** replace [A9_0_DEVICE_VERIFICATION.md](A9_0_DEVICE_VERIFICATION.md) device evidence.
- Does **not** claim cookie auth was proven on the candidate.
- Does **not** (as a smoke record) authorize merging `release/bearer-on-d369c6d` or promoting `dpl_HpAZDkgUS6zj2fRES91YUqp3pUBb`. A later separate authorization promoted public Production to `dpl_Cs2TrnDsy1KSB3wipCCUt82Hpf8D` / `eb8cabe` — see [DEPLOYMENT.md § Current production state](DEPLOYMENT.md#current-production-state).
