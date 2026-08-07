# Owner Acceptance Week (OAW)

**Status:** Planned formal product gate — **not started**.  
**Authority:** [DECISIONS.md](DECISIONS.md) **D142**; Product Constitution [P2_0_OWNER_EXPERIENCE_FOUNDATION.md](P2_0_OWNER_EXPERIENCE_FOUNDATION.md); sequencing [MILESTONES.md](MILESTONES.md).  
**Position in roadmap:** after A9.0–A9.3 (complete) → **OAW** → P2.2 Remove Friction → Stage 12 (still separately authorized).

**This document is planning and acceptance procedure only.** It does not authorize implementation, P2.2 work, Stage 12, A8.7d, A8.7e, feature flags, or production delivery enablement.

---

## 1. Executive summary

Owner Acceptance Week validates whether Rocket can support an **ordinary working day** on the **Android** Owner app — as a trusted external memory for capture, organize, assign, and follow-through — without depending on parallel notes or habitual fallback to web for day-to-day work.

A9.0 (auth), A9.1 (networking), A9.2 (capture), and A9.3 (list / detail / lifecycle / handoff) are **implementation-complete**. OAW is the first formal product gate that asks whether that stack is **good enough for real life**, not whether more features are needed.

| Question                            | Answer at plan time                                                             |
| ----------------------------------- | ------------------------------------------------------------------------------- |
| Ready to **begin** OAW?             | **Yes** — A9.0–A9.3 delivered the minimum ordinary-day surface.                 |
| Ready to **enter P2.2**?            | **Only after successful OAW** (exit criteria below + Owner explicit approval).  |
| Ready for Stage 12 / A8.7d / A8.7e? | **No** — those remain unauthorized until after P2.2 and their own gates (D140). |

**Objective of the week:** discover friction. Do not add functionality during OAW. Log defects; defer fixes to P2.2 unless a **Blocker** makes the week impossible to continue (then stop and repair only what unblocks validation).

---

## 2. Objectives

1. Prove Rocket can be the Owner’s **primary** system for ordinary must-happen-next work on Android for a continuous acceptance window (target: **5 working days**).
2. Validate the **complete Owner path** built in A9.0–A9.3: sign-in → capture → review → detail → lifecycle → optional Recipient handoff → session restore / sign-out.
3. Measure whether **capture remains the fastest path** and whether Rocket ever slows the Owner down.
4. Surface friction that would make the Owner abandon Android for web, memory, or external notes.
5. Produce a severity-ranked issue log that feeds **P2.2 — Remove Friction** (D143).
6. Obtain an **explicit** Owner go / no-go for entering P2.2 and for later resuming the paused Stage 12 path (silence ≠ approval; D113 / D142).

### Product evaluation questions (answer daily + at close)

Record yes/no + brief note for each:

| #   | Question                                                                                                   |
| --- | ---------------------------------------------------------------------------------------------------------- |
| Q1  | Does capture remain the fastest path?                                                                      |
| Q2  | Did Rocket ever slow the Owner down?                                                                       |
| Q3  | Did any screen ask unnecessary questions?                                                                  |
| Q4  | Was anything confusing?                                                                                    |
| Q5  | Did the Owner ever feel the need to switch to the web **unnecessarily** (admin/Gmail re-consent excepted)? |
| Q6  | Did Rocket consistently feel like an **external memory** rather than a task manager?                       |

---

## 3. Success criteria

OAW **succeeds** only when **all** of the following are true and recorded (D142):

1. **Primary system** — Rocket is the Owner’s primary task system during the window (not a secondary notebook beside another personal system for the same ordinary work).
2. **Daily real capture** — Real work is captured on Android **each working day** of the window (not demo-only or synthetic-only).
3. **Real handoff** — At least one **real Recipient handoff** completes end-to-end (real delegated work; not solely a local dry-run).
4. **No parallel notes required** — External notes are no longer required for ordinary follow-through of must-happen-next items.
5. **Issues documented** — Usability and reliability issues are logged with severity and confidence impact, whether or not fixed during the week.
6. **Explicit Owner decision** — Owner explicitly **approves or withholds** (a) entering P2.2 and (b) later resuming operational enablement on Stage 12 → A8.7d → A8.7e. Silence is not approval.

### Implementation surface under test (do not expand)

| Slice    | What OAW exercises                                                                                                         |
| -------- | -------------------------------------------------------------------------------------------------------------------------- |
| **A9.0** | Google Workspace sign-in, secure session, restore after restart, LOCAL sign-out, session probe                             |
| **A9.1** | Bearer API calls, truthful connectivity errors, safe failure (no false success)                                            |
| **A9.2** | Shell → Capture → Save → server `201`; draft preserve on failure; Capture another; IME speech optional                     |
| **A9.3** | Tasks list, detail, Start / Waiting / Resume / Complete / Dismiss / Note, Assign / handoff, Gmail gating & re-consent path |

**Out of OAW scope:** reminders UI/delivery, push/FCM, offline sync, reassignment, Stage 12, A8.7d, A8.7e, A10+, P2.2 implementation, product redesign.

---

## 4. Preconditions

| Item           | Requirement                                                                                     |
| -------------- | ----------------------------------------------------------------------------------------------- |
| Device         | Physical Android 12+ (`minSdk` 31), preferably Galaxy S24+; one-handed use expected             |
| Build          | Sideload debug or release APK from a known git SHA; record `versionName` / `versionCode`        |
| Backend        | Reachable Owner API (prefer deployed HTTPS for production-quality evidence)                     |
| Auth           | Owner Google Workspace account on allowlisted domain; Supabase redirect `aicaa://auth-callback` |
| Recipient      | At least one real Recipient identity available for a real handoff during the week               |
| Gmail          | Owner Gmail connected for handoff transport (web admin if needed); re-consent path available    |
| Evidence store | Private dated notes + screenshots; **never** paste access tokens, refresh tokens, or anon keys  |
| Mindset        | Prefer real work; synthetic tasks only to fill scenario gaps                                    |

---

## 5. Window structure (recommended 5 working days)

| Day       | Theme            | Focus                                                                                              |
| --------- | ---------------- | -------------------------------------------------------------------------------------------------- |
| **Day 1** | Habit start      | Sign-in / restore, capture throughout day, list + detail browse, one-handed check                  |
| **Day 2** | Capture pressure | Rapid capture, long-session usability, connectivity interrupt during capture                       |
| **Day 3** | Follow-through   | Waiting / Resume / Complete on real work; navigation friction notes                                |
| **Day 4** | Assignment       | Real Recipient handoff; Gmail re-consent **if encountered**; connectivity interrupt during handoff |
| **Day 5** | Confidence close | Sign-out / sign-in, session restore, product Q1–Q6, exit criteria, go / no-go                      |

Adjust calendar dates as needed; keep **five ordinary working days** of primary use. Weekends optional for light capture only — do not substitute for weekday pressure.

---

## 6. Validation scenarios

Each scenario: **Goal · Steps · Expected · Evidence · Pass / fail**.

### S1 — Capture multiple tasks throughout a normal day

|              |                                                                                                                                                                                                                       |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Goal**     | Confirm capture fits an ordinary day without ceremony.                                                                                                                                                                |
| **Steps**    | From shell, open **Capture**. Enter real work (type or IME mic). **Save**. On success, prefer **Capture another** or **Done** and return to day. Repeat across morning / midday / afternoon (≥3 captures on the day). |
| **Expected** | One tap from shell to capture field. Success only after server confirmation (“Saved”). Unassigned = Owner work. No forced list or assign.                                                                             |
| **Evidence** | Count of captures that day; 1–2 screenshots of success pane; note whether any capture was abandoned.                                                                                                                  |
| **Pass**     | ≥3 real captures saved on a single working day with no false-success claims.                                                                                                                                          |
| **Fail**     | Capture unavailable, false success, or Owner abandons capture for notes/web for ordinary items.                                                                                                                       |

### S2 — Repeated rapid capture

|              |                                                                                                                                       |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| **Goal**     | Confirm burst capture does not degrade into friction.                                                                                 |
| **Steps**    | From success pane, tap **Capture another** three times in succession with short distinct texts. Time the path mentally: idea → saved. |
| **Expected** | Draft clears for next capture; each save independently confirmed; no forced organize/assign between captures.                         |
| **Evidence** | Timestamp notes or stopwatch for three consecutive captures; screenshot of final success.                                             |
| **Pass**     | Three consecutive captures complete without leaving the capture flow except for confirmation.                                         |
| **Fail**     | Extra screens, lost draft unexpectedly between intentional clears, or Owner feels slowed vs notes app.                                |

### S3 — Reviewing existing work

|              |                                                                                                                   |
| ------------ | ----------------------------------------------------------------------------------------------------------------- |
| **Goal**     | Confirm Tasks list works as an organizational workspace.                                                          |
| **Steps**    | Shell → **Tasks**. Scan list; **Refresh**; **Load more** if shown. Identify recently captured items.              |
| **Expected** | List loads from server; empty state truthful if none; errors truthful with retry; unassigned shown as Owner work. |
| **Evidence** | Screenshot of list with real items; note of any missing expected Task.                                            |
| **Pass**     | Recently captured Tasks appear without web.                                                                       |
| **Fail**     | List blank when Tasks exist, silent failure, or Owner must use web to find ordinary work.                         |

### S4 — Opening task details

|              |                                                                                                                                           |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **Goal**     | Confirm detail is a natural continuation, not a maze.                                                                                     |
| **Steps**    | From list, open a Task. Optionally from capture success use **Open Task**. Read summary/notes; return via **Back**.                       |
| **Expected** | Detail shows server truth; stale `If-Match` surfaces as refresh guidance, not silent overwrite; navigation back to list/shell is obvious. |
| **Evidence** | Screenshot of detail; note taps from shell → detail.                                                                                      |
| **Pass**     | Detail opens in ≤3 purposeful taps from shell; content matches capture.                                                                   |
| **Fail**     | Wrong Task, confusing navigation, or Owner cannot find what was just captured.                                                            |

### S5 — Completing work

|              |                                                                                                           |
| ------------ | --------------------------------------------------------------------------------------------------------- |
| **Goal**     | Confirm completion is truthful and low-friction.                                                          |
| **Steps**    | Open an Owner Task ready to finish. Tap **Complete**. Confirm UI reflects server update.                  |
| **Expected** | Success only after server accepts mutation; list/detail consistent after refresh; no invented completion. |
| **Evidence** | Before/after screenshot or status note; server-visible state if checked on web (optional verify only).    |
| **Pass**     | Task reaches completed state on server; Android shows truth.                                              |
| **Fail**     | UI claims complete without server success, or Owner cannot complete from Android.                         |

### S6 — Putting work into Waiting

|              |                                                                                                         |
| ------------ | ------------------------------------------------------------------------------------------------------- |
| **Goal**     | Confirm Waiting supports “paused until something external moves.”                                       |
| **Steps**    | Open active/in-progress Task. Tap **Waiting**. Optionally add a **note** explaining why.                |
| **Expected** | State becomes Waiting after server confirmation; note persists if saved.                                |
| **Evidence** | Screenshot of Waiting state; note text if used.                                                         |
| **Pass**     | Waiting applied and still visible later the same day.                                                   |
| **Fail**     | Waiting unavailable, false success, or Owner uses external reminder instead because Waiting is unclear. |

### S7 — Resuming work

|              |                                                                                    |
| ------------ | ---------------------------------------------------------------------------------- |
| **Goal**     | Confirm resume restores Owner attention without confusion.                         |
| **Steps**    | Open a Waiting Task. Tap **Resume**. Continue or complete as appropriate.          |
| **Expected** | Resume succeeds only after server confirmation; actions available match lifecycle. |
| **Evidence** | Screenshot or status note before/after.                                            |
| **Pass**     | Task leaves Waiting and remains usable.                                            |
| **Fail**     | Stuck in Waiting, contradictory actions, or Owner loses track of the item.         |

### S8 — Assigning work to a real Recipient

|              |                                                                                                                                                                                                                     |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Goal**     | Complete one real end-to-end handoff from Android.                                                                                                                                                                  |
| **Steps**    | Capture or open real delegable work → **Assign** → pick (or thin-create) Recipient → read confirmation → **Confirm and send**. Verify Recipient receives assignment email / forward as applicable.                  |
| **Expected** | Explicit D037 confirmation; success only after server confirmation; idempotent retry if needed; unassigned remains Owner work until confirm.                                                                        |
| **Evidence** | Screenshots of confirm + success; Recipient-side proof (email received); Task id (non-secret).                                                                                                                      |
| **Pass**     | At least one real handoff completes during the window.                                                                                                                                                              |
| **Fail**     | No real handoff completed; false success; duplicate sends from unsafe retry; or Owner forced to web for the entire assign path (Gmail setup/re-consent alone does not fail this if retry then succeeds on Android). |

### S9 — Gmail re-consent (if encountered)

|              |                                                                                                                                                                      |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Goal**     | Confirm re-consent is truthful and recoverable without auto-send.                                                                                                    |
| **Steps**    | If handoff reports send consent required: follow **Open Gmail setup** / browser instructions; complete consent; return to app; **Retry handoff** manually.           |
| **Expected** | Clear instructions; no auto-send after browser return; retry uses safe idempotency; success only after server confirms.                                              |
| **Evidence** | Screenshot of re-consent UI; note of browser step; post-retry success/fail.                                                                                          |
| **Pass**     | If encountered: Owner completes handoff after manual retry **or** logs a Blocker/Major with exact failure. If **not** encountered: mark **N/A** (does not fail OAW). |
| **Fail**     | Auto-send without confirmation; opaque error; or Owner cannot recover after valid consent.                                                                           |

### S10 — Connectivity interruption during capture

|              |                                                                                                                     |
| ------------ | ------------------------------------------------------------------------------------------------------------------- |
| **Goal**     | Confirm online-first truthfulness preserves draft and never lies.                                                   |
| **Steps**    | Start capture with draft text. Disable network (airplane / Wi‑Fi off). Tap **Save**. Re-enable network. Retry save. |
| **Expected** | Truthful connectivity error; draft preserved; no “Saved” until server `201`.                                        |
| **Evidence** | Screenshot of error with draft still present; screenshot of later success.                                          |
| **Pass**     | Draft survives; success only after reconnect + server confirm.                                                      |
| **Fail**     | Draft lost, false success, or crash.                                                                                |

### S11 — Connectivity interruption during handoff

|              |                                                                                                                                                                                                 |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Goal**     | Confirm handoff failure modes stay safe (no double-send assumption).                                                                                                                            |
| **Steps**    | Reach confirm handoff. Disable network; confirm send. Observe error/ambiguous guidance. Re-enable; use **Retry** / **Check status** as offered — do not invent a second new assignment blindly. |
| **Expected** | Truthful failure or ambiguous outcome messaging; pending retry retains original `If-Match` + `Idempotency-Key` behaviour; no claim of success without server.                                   |
| **Evidence** | Screenshots of error/ambiguous + recovery; note whether duplicate email occurred.                                                                                                               |
| **Pass**     | No false success; recovery path understandable; no duplicate assignment email from panic retries.                                                                                               |
| **Fail**     | False success, silent failure, or unsafe double-send.                                                                                                                                           |

### S12 — Session restoration after app restart

|              |                                                                                                        |
| ------------ | ------------------------------------------------------------------------------------------------------ |
| **Goal**     | Confirm A9.0 restore keeps the Owner in flow.                                                          |
| **Steps**    | Sign in. Force-stop or swipe away app. Relaunch. Proceed to Capture or Tasks without signing in again. |
| **Expected** | Session restores; session probe succeeds when online; authenticated shell appears.                     |
| **Evidence** | Note cold start behaviour; screenshot of shell identity.                                               |
| **Pass**     | No re-auth required for valid session.                                                                 |
| **Fail**     | Unexpected sign-in loop, crash, or lost session without cause.                                         |

### S13 — Android sign-out / sign-in

|              |                                                                                                                               |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| **Goal**     | Confirm LOCAL sign-out (D147) and clean re-entry.                                                                             |
| **Steps**    | Optional: keep a web Owner session signed in. In Android, **Sign out**. Confirm sign-in screen. Sign in again. Confirm shell. |
| **Expected** | Android session cleared; web session **not** ended by Android sign-out; re-sign-in works.                                     |
| **Evidence** | Note web still signed in (if tested); Android before/after.                                                                   |
| **Pass**     | LOCAL sign-out + successful sign-in; web independence held if checked.                                                        |
| **Fail**     | Cannot sign out/in; Android sign-out kills web unexpectedly; tokens appear in UI/logs.                                        |

### S14 — One-handed operation

|              |                                                                                                                             |
| ------------ | --------------------------------------------------------------------------------------------------------------------------- |
| **Goal**     | Confirm ordinary paths are workable one-handed (constitutional principle).                                                  |
| **Steps**    | Perform capture, open Tasks, complete or Waiting, and return to shell using primarily one thumb. Note reaches and mis-taps. |
| **Expected** | Primary actions reachable; no essential control only at far opposite corner without scroll; keyboard mic usable if used.    |
| **Evidence** | Short notes per path (comfortable / stretch / fail); optional photo of grip.                                                |
| **Pass**     | Capture + at least one follow-through action feasible one-handed without assist.                                            |
| **Fail**     | Owner cannot complete ordinary capture/follow-through one-handed.                                                           |

### S15 — Long-session usability

|              |                                                                                                                                        |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| **Goal**     | Confirm the app remains trustworthy across a full workday.                                                                             |
| **Steps**    | Keep Rocket as primary system for ≥6 hours of calendar day with intermittent use (not a continuous soak test). Mix capture and review. |
| **Expected** | No progressive slowdown that blocks use; session remains valid; errors remain truthful.                                                |
| **Evidence** | Day log: hours used, crash count, re-auth count, frustration notes.                                                                    |
| **Pass**     | Day completable without abandoning Rocket for ordinary follow-through.                                                                 |
| **Fail**     | Repeated crashes, session death, or Owner switches away due to fatigue/friction.                                                       |

### S16 — General navigation friction

|              |                                                                                                                                                         |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Goal**     | Capture where the product feels like a task manager instead of external memory.                                                                         |
| **Steps**    | Throughout the week, note extra taps, unclear labels, dead ends, “where am I?”, and any urge to open web for non-admin reasons.                         |
| **Expected** | Shell emphasizes Capture first; organize/assign when ready; progressive disclosure from capture success.                                                |
| **Evidence** | Friction log entries (see §9); answers to Q1–Q6.                                                                                                        |
| **Pass**     | Friction logged; no unlogged confusion that later surprises the go/no-go.                                                                               |
| **Fail**     | (Scenario itself does not fail OAW.) Unlogged material friction that surfaces only at go/no-go **fails evidence quality** — reopen log before deciding. |

---

## 7. Daily usage scenarios (operating rhythm)

Use this as the default day, then overlay the scenario IDs scheduled for that day.

### Morning

1. Launch app — confirm session restore (S12 as needed).
2. Capture anything already in head (S1).
3. Open **Tasks** — scan must-happen-next (S3, S4).
4. Start or Resume anything due today (S5–S7 as applicable).

### Midday

5. Rapid capture as interruptions arrive (S2).
6. Put blocked work in **Waiting** with a note (S6).
7. Log product questions if friction appeared (Q1–Q6).

### Afternoon / close

8. Complete finished work (S5).
9. Assign anything that should leave the Owner’s head (S8; S9 if needed).
10. Brief end-of-day note: captured count, handoffs, blockers, mood (external memory vs task manager).

### Scheduled probes (minimum)

| Probe                      | When                                                          |
| -------------------------- | ------------------------------------------------------------- |
| S10 connectivity @ capture | Day 2 (or first convenient day)                               |
| S11 connectivity @ handoff | Day 4 (with real or disposable handoff attempt — prefer real) |
| S13 sign-out / sign-in     | Day 5 (or Day 1 if identity doubt)                            |
| S14 one-handed             | Day 1 and again Day 5                                         |
| S15 long-session           | Every day (aggregate)                                         |
| S8 real handoff            | Complete by end of Day 4                                      |

---

## 8. Daily validation checklist

Copy per day. Date: _____________ Build SHA: _____________ Device: _____________

### Capture & memory

- [ ] ≥1 real capture saved on Android today
- [ ] Capture felt like the fastest path (Q1) — Y / N / note: _____________
- [ ] Did not need external notes for ordinary follow-through today — Y / N
- [ ] Rapid capture attempted if work arrived in bursts — Y / N / N/A

### Organize & follow-through

- [ ] Reviewed Tasks list at least once
- [ ] Opened ≥1 Task detail
- [ ] Lifecycle action used if applicable (Start / Waiting / Resume / Complete / Dismiss / Note)
- [ ] Rocket slowed me down? (Q2) — Y / N / note: _____________

### Assignment (when in scope for the day)

- [ ] Assign path touched or N/A
- [ ] Real handoff progress: not started / in progress / completed
- [ ] Gmail re-consent encountered? Y / N / N/A — outcome: _____________

### Trust & session

- [ ] No false success observed
- [ ] Connectivity or auth errors (if any) were understandable
- [ ] App restart still signed in (if tested today)

### Product feel

- [ ] Unnecessary questions? (Q3) — Y / N / note
- [ ] Confusion? (Q4) — Y / N / note
- [ ] Unnecessary web use? (Q5) — Y / N / note
- [ ] Felt like external memory? (Q6) — Y / N / note

### Hygiene

- [ ] New issues filed in issue log (§9)
- [ ] Evidence captured for any Fail / Blocker / Major
- [ ] No secrets in screenshots or notes

---

## 9. Recommended issue log format

Use one row per issue (spreadsheet or markdown table). Stable IDs: `OAW-001`, `OAW-002`, …

| Field                  | Content                                                                          |
| ---------------------- | -------------------------------------------------------------------------------- |
| **ID**                 | `OAW-NNN`                                                                        |
| **Date / time**        | ISO local                                                                        |
| **Scenario**           | S1–S16 or “ad-hoc”                                                               |
| **Surface**            | Capture / List / Detail / Handoff / Auth / Shell / Other                         |
| **Title**              | One-line symptom                                                                 |
| **Steps to reproduce** | Minimal                                                                          |
| **Expected**           | Per product truth                                                                |
| **Actual**             | What happened                                                                    |
| **Severity**           | Blocker / Major / Minor / Note (see §10)                                         |
| **Confidence impact**  | Blocks ordinary day? Y / N / Partial                                             |
| **Workaround**         | None / description                                                               |
| **Evidence**           | Screenshot paths, Task id (non-secret), timestamps                               |
| **Owner quote**        | Optional verbatim frustration                                                    |
| **P2.2 candidate**     | Y / N / Defer                                                                    |
| **Status**             | Open / Accepted for P2.2 / Won’t fix (Owner ack) / Fixed under Blocker exception |

### Example row

```text
OAW-014 | 2026-08-12T14:22 | S8 | Handoff |
Confirm copy too long to read one-handed |
Open Assign → Confirm |
Owner can grasp consequence in one screen glance |
Dense legalistic paragraph; Owner hesitated |
Minor | Partial | Scroll and re-read |
img/oaw-014.png | "I almost assigned without reading" |
Y | Open
```

---

## 10. Defect severity matrix

| Severity    | Definition                                                                                             | OAW handling                                                   | P2.2 expectation                                                            |
| ----------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- | --------------------------------------------------------------------------- |
| **Blocker** | Prevents ordinary-day use or violates truth (false success, data loss, auth break, unsafe double-send) | Stop scenario; fix only if week cannot continue; else fail OAW | Must address or Owner-ack defer before claiming readiness beyond P2.2 entry |
| **Major**   | Material friction; Owner would switch to web/notes/memory for that job                                 | Continue week; log thoroughly                                  | Should address in P2.2 or explicit Owner defer                              |
| **Minor**   | Annoying but workaround exists; does not eject Owner from Android primary use                          | Continue; log                                                  | Candidate for P2.2 polish                                                   |
| **Note**    | Observation, preference, or future idea — not a defect                                                 | Log only                                                       | May inform P2.2; not required                                               |

### Mapping to product evaluation

| Symptom                                              | Typical severity                    |
| ---------------------------------------------------- | ----------------------------------- |
| False “Saved” / false handoff success                | Blocker                             |
| Draft lost on connectivity failure                   | Blocker                             |
| Cannot capture or open Tasks at all                  | Blocker                             |
| Capture slower than notes for ordinary items         | Major                               |
| Must use web for ordinary (non-admin) follow-through | Major                               |
| Confusing label; extra tap; one-handed stretch       | Minor or Major by confidence impact |
| “Wish it had reminders/push”                         | Note (out of A9 scope)              |

---

## 11. Evidence required

### 11.1 Evidence checklist (close the week only if complete)

**Build & environment**

- [ ] Git SHA of APK under test
- [ ] `versionName` / `versionCode`
- [ ] Device model + Android API level
- [ ] API base host (hostname only — no secrets)
- [ ] Window start/end dates

**Scenario coverage**

- [ ] S1–S8 executed (S8 real handoff completed)
- [ ] S9 executed or marked N/A
- [ ] S10–S13 executed
- [ ] S14–S16 exercised with notes
- [ ] Daily checklists for each working day

**Product evaluation**

- [ ] Q1–Q6 answered for the week (not only one day)
- [ ] Explicit statement: primary system Y/N
- [ ] Explicit statement: external notes still required Y/N

**Issues & decision**

- [ ] Issue log complete (or explicitly empty with Owner statement)
- [ ] Severity assigned on every issue
- [ ] Owner go / no-go for **P2.2 entry**
- [ ] Owner go / no-go for **later Stage 12 path** (informational for sequencing; does not authorize Stage 12)

**Hygiene**

- [ ] No tokens, anon keys, or passwords in evidence
- [ ] Screenshots redacted if they show secrets

### 11.2 Minimum artifact set

| Artifact                          | Purpose                |
| --------------------------------- | ---------------------- |
| Daily checklists (× working days) | Habit + coverage       |
| Issue log                         | P2.2 input             |
| Handoff proof packet              | S8 exit criterion      |
| Connectivity probe notes          | S10 / S11              |
| Auth probe notes                  | S12 / S13              |
| Week-end Owner decision record    | D142 explicit approval |

---

## 12. Exit criteria

OAW may be marked **PASS** only when all boxes are checked with evidence:

- [ ] **E1** Rocket was the primary task system for ordinary work during the window
- [ ] **E2** Real work captured on Android on each working day of the window
- [ ] **E3** ≥1 real Recipient handoff completed end-to-end
- [ ] **E4** External notes not required for ordinary follow-through
- [ ] **E5** Usability/reliability issues documented with severity
- [ ] **E6** Owner explicit decision recorded for P2.2 entry (approve / withhold)
- [ ] **E7** Owner explicit decision recorded for later Stage 12 path resume (approve / withhold) — **does not start Stage 12**
- [ ] **E8** No open **Blocker** remains unexplained (fixed, or Owner-ack accept-as-known with OAW = FAIL if it prevents confidence)
- [ ] **E9** Evidence checklist (§11.1) complete

**FAIL** if any of E1–E9 cannot be honestly checked. Failing OAW does **not** authorize skipping to Stage 12. Findings still feed P2.2 when the Owner chooses to continue.

---

## 13. Go / No-Go criteria for P2.2

### Go — enter P2.2 Remove Friction

All of:

1. OAW exit criteria **PASS** (or Owner explicitly accepts a **conditional Go** with named Major items that P2.2 must address first — recorded in writing).
2. Issue log available as P2.2 backlog input.
3. Owner explicit **Go for P2.2**.
4. Scope remains D143: friction reduction only — **no** major features, architecture redesign, inbox replacement, A12, AI capture, or delivery enablement.

### No-Go — do not enter P2.2 yet

Any of:

1. OAW **FAIL** on primary-system, daily capture, real handoff, or notes dependency.
2. Unresolved **Blocker** that destroys trust (false success, data loss, auth/session break).
3. Owner **withholds** approval.
4. Evidence incomplete (silence or missing artifacts ≠ Go).

### Important sequencing note

| Decision                 | Meaning                                                     |
| ------------------------ | ----------------------------------------------------------- |
| **Go P2.2**              | Authorized to begin friction-removal work from OAW findings |
| **Go P2.2** does **not** | Authorize Stage 12, A8.7d, A8.7e, or flag changes           |
| **OAW FAIL**             | Stay on validation / repair path; do not skip ahead         |

---

## 14. Recommendation: readiness for P2.2 after successful OAW

**At plan time (pre-OAW):** Rocket is **ready to begin Owner Acceptance Week**. It is **not** yet ready to enter P2.2.

**After successful OAW completion (PASS + Owner Go):** Rocket **is ready to enter P2.2 — Remove Friction**. That is the correct next milestone: convert the issue log into tap/wording/navigation/ergonomics fixes without expanding product scope.

**Planned first product-shaped slice inside P2.2 (planning only):** **P2.2a — People** (**D151**; [P2_2A_PEOPLE.md](P2_2A_PEOPLE.md)) — People filter (Everyone / Me / individual Recipients), display names as primary identifiers, Android-local filter memory, recency order preserved. That plan does **not** authorize implementation before OAW exit + Owner Go for P2.2, and does **not** remove OAW as the next execution gate. OAW findings still feed the rest of P2.2 polish.

**After successful OAW, Rocket is still not ready for Stage 12 / A8.7d / A8.7e.** Those require P2.2 completion (or Owner-ack deferral of friction items) **and** their own explicit authorizations (D140, D142, D144).

### Pre-OAW readiness snapshot (A9 surface)

| Area                            | Ready for OAW exercise?                      |
| ------------------------------- | -------------------------------------------- |
| Auth / session / LOCAL sign-out | Yes (A9.0)                                   |
| Networking / connectivity truth | Yes (A9.1)                                   |
| Capture + Capture another       | Yes (A9.2)                                   |
| List / detail / lifecycle       | Yes (A9.3)                                   |
| Real Recipient handoff          | Yes (A9.3) — requires live Recipient + Gmail |
| Reminders / push / offline      | No — out of scope; log as Note if missed     |

---

## 15. Owner decision record (template)

Complete at end of week:

```text
Owner Acceptance Week — Decision Record
Window: _____________ → _____________
Build SHA: _____________
Device: _____________

Exit criteria E1–E9: PASS / FAIL
Open Blockers: none / list IDs
Open Majors (count): _____________

Product evaluation (week):
Q1 Capture fastest path: Y/N —
Q2 Ever slowed Owner: Y/N —
Q3 Unnecessary questions: Y/N —
Q4 Confusing: Y/N —
Q5 Unnecessary web: Y/N —
Q6 External memory feel: Y/N —

P2.2 entry: GO / NO-GO
Stage 12 path (later, still unauthorized): APPROVE TO CONSIDER LATER / WITHHOLD
Owner name: _____________
Date: _____________
Signature / explicit statement: _____________
```

---

## 16. Out of scope (hard stop)

During OAW planning and execution, do **not**:

- Implement feature fixes (except emergency Blocker unblocking)
- Modify Android or server code for enhancements
- Begin P2.2 implementation before Go
- Begin Stage 12, A8.7d, or A8.7e
- Expand the roadmap
- Redesign the product
- Treat web admin / Gmail consent as “Android failed” unless ordinary follow-through required web

---

## Related documents

- [P2_0_OWNER_EXPERIENCE_FOUNDATION.md](P2_0_OWNER_EXPERIENCE_FOUNDATION.md) — Product Constitution; OAW gate definition
- [MILESTONES.md](MILESTONES.md) — Forward roadmap; OAW / P2.2 status
- [A9_0_DEVICE_VERIFICATION.md](A9_0_DEVICE_VERIFICATION.md) — Auth device runbook (complementary; not a substitute for OAW)
- [apps/android/README.md](../apps/android/README.md) — A9.0–A9.3 surface under test
- [DECISIONS.md](DECISIONS.md) — D142, D143, D144, D145–D150
