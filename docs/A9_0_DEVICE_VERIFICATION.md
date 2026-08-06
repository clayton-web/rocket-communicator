# A9.0 — Real-device verification runbook

**Purpose:** Operator procedure for production-quality evidence that A9.0 Android Owner authentication works on a real device (Galaxy S24+ target; `minSdk` 31).  
**Authority:** D145–D147. Sideload only (D019). Online-first (D132).  
**Out of scope:** Task UI (A9.1), capture, assignment, Stage 12 / A8.7d / A8.7e.

Record evidence in a dated note or evidence appendix: build SHA, APK path, device model/API level, API base URL (host only — never paste anon keys or tokens), pass/fail per step, and screenshots where noted.

---

## Preconditions

| Item | Requirement |
| ---- | ----------- |
| Device | Physical Android 12+ device (API 31+), preferably Galaxy S24+ |
| Workstation | JDK 17, Android SDK, `adb`, repo checkout |
| Backend | Reachable Owner API host (local Next.js or deployed HTTPS) with working Supabase Google Workspace auth |
| Accounts | Owner Google Workspace account on the allowlisted domain; optional second browser session for web-independence check (D147) |
| Secrets | Never commit `local.properties`, anon keys, or access/refresh tokens into evidence |

---

## V0 — Configure build properties

1. Edit `apps/android/local.properties` (gitignored):

```properties
sdk.dir=/ABSOLUTE/PATH/TO/Android/sdk
aicaa.apiBaseUrl=https://YOUR_API_HOST_OR_LAN_URL
aicaa.supabaseUrl=https://YOUR_PROJECT.supabase.co
aicaa.supabaseAnonKey=YOUR_ANON_KEY
aicaa.ownerWorkspaceDomain=your-workspace-domain.com
```

2. URL notes:
   - **Physical device → workstation API:** use the machine's LAN HTTPS or HTTP URL (not `10.0.2.2`; that is emulator-only).
   - **Emulator → workstation API:** `http://10.0.2.2:3000` is acceptable for local debug only.
   - **Production evidence:** prefer the deployed HTTPS API base.
3. Confirm values are present; do not screenshot the anon key.

**Pass:** properties set; build can read them into `BuildConfig`.

---

## V1 — Configure Supabase redirect URI

1. Open the Supabase project → **Authentication** → **URL configuration** (Redirect URLs).
2. Add exactly:

```text
aicaa://auth-callback
```

3. Ensure Google provider remains enabled for Owner Workspace sign-in (same IdP as web).

**Pass:** redirect URI saved; no typo in scheme/host.

---

## V2 — Build and install the APK

From the repository root (or `apps/android`):

```bash
cd apps/android
./gradlew assembleDebug
adb devices   # confirm one authorized device
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

Record: git SHA, `versionName` / `versionCode` from the build (`0.9.0-a9.0` / `2` at A9.0 ship), device model, `adb shell getprop ro.build.version.sdk`.

**Pass:** install succeeds; launcher shows **AI Communication Action Assistant**.

---

## V3 — Cold start → signed-out gate

1. Force-stop if needed: `adb shell am force-stop com.aicommunication.assistant`
2. Launch the app from the launcher.
3. Expect the **Owner sign in** screen (not the authenticated shell).
4. If config is missing, expect the configuration error copy — fix V0 and rebuild.

**Pass:** signed-out gate only; no Owner shell chrome without authentication.  
**Evidence:** screenshot of sign-in screen.

---

## V4 — Google Workspace sign-in and redirect

1. Tap **Sign in with Google**.
2. Custom Tab / system browser opens Google account selection (workspace `hd` hint may appear).
3. Complete Workspace sign-in with an **allowlisted** account.
4. Confirm redirect returns to the app via `aicaa://auth-callback` (Custom Tab closes; app resumes).

**Pass:** control returns to the Android app without a stuck browser page.  
**Fail cases to record separately:** wrong domain (V4b), cancelled OAuth, missing redirect URI (V1).

### V4b — Unauthorized domain (negative)

1. Sign out if needed; sign in with a Google account **outside** `OWNER_WORKSPACE_DOMAIN` (or without verified `hd`).
2. Expect return to signed-out UI with unauthorized-domain (or equivalent failure) messaging — **not** the authenticated shell.

**Pass:** shell unreachable; credentials cleared or unusable for Owner APIs.

---

## V5 — Session probe and authenticated shell

After a successful allowlisted sign-in:

1. App must call `GET {apiBaseUrl}/api/v1/session` with `Authorization: Bearer <access_jwt>`.
2. Expect **Owner shell** UI: product name, “Owner shell” / authentication-active copy, **Signed in as …**, **Sign out**.
3. Optional network evidence (do **not** paste the JWT):
   - Proxy/log showing `GET /api/v1/session` → `200` with `ownerId`, `organizationId`, `role: "owner"`.
   - Or server logs showing Owner session resolution without cron-bearer confusion.

**Pass:** authenticated shell visible only after successful probe.  
**Evidence:** screenshot of authenticated shell (identity display OK; no tokens).

---

## V6 — Kill and relaunch → session restoration

1. From the authenticated shell, leave the app.
2. Force-stop: `adb shell am force-stop com.aicommunication.assistant`
3. Relaunch from the launcher (do **not** sign in again).
4. Expect brief loading, then authenticated shell again with the same Owner identity.

**Pass:** session restored from secure storage; no interactive Google prompt.  
**Evidence:** screenshot after relaunch.

---

## V7 — Sign-out (device-local)

### V7a — Android clears its session

1. Optional but recommended: keep a **web** Owner session signed in on a browser (same Workspace Owner).
2. On Android, tap **Sign out**.
3. Expect return to the **Owner sign in** screen.
4. Confirm authenticated shell is gone.

**Pass:** Android shows signed-out gate.

### V7b — Web session independence (D147)

1. If a web session was open in V7a, reload an Owner page (e.g. `/tasks`) in that browser.
2. Expect the web session to **remain authenticated** (Android used `SignOutScope.LOCAL`, not `GLOBAL`).

**Pass:** web still signed in.  
**Fail:** web also signed out → GLOBAL (or equivalent) regression; stop and fix before closing A9.0.

### V7c — Android APIs no longer authorized

1. With Android signed out, attempt to use a retained access token is not required from the UI.
2. Operator check with a previously captured token is **discouraged** (token handling risk). Prefer:
   - Relaunch app → remains on sign-in (V6 pattern after sign-out).
   - Or, from a debug proxy: after sign-out, the app must not attach Bearer credentials to new Owner calls.
3. If exercising manually with curl for evidence, use a token captured **before** sign-out only in a private scratchpad, then:

```bash
curl -sS -o /tmp/a9_session.json -w "%{http_code}" \
  -H "Authorization: Bearer PREVIOUS_ACCESS_TOKEN" \
  -H "Accept: application/json" \
  "$API_BASE_URL/api/v1/session"
```

Expect `401` after LOCAL revoke once the access JWT is rejected / refresh is dead. Wipe `/tmp/a9_session.json` and the token afterward.

**Pass:** post-sign-out Android cannot reach authenticated Owner APIs; web unaffected (V7b).

---

## V8 — Connectivity (auth-scoped)

1. Enable airplane mode (or block the API host).
2. Cold-start or Retry from a connectivity error on sign-in/restore.
3. Expect truthful connectivity messaging and Retry — not a fake authenticated shell.
4. Restore network; Retry or relaunch; confirm restore or sign-in can proceed.

**Pass:** no “works offline” claim; no Owner shell without a successful session probe when required.

---

## Evidence package checklist

Before marking A9.0 device verification complete, the operator record should include:

- [ ] Git SHA and APK identity (`versionName` / `versionCode`)
- [ ] Device model and API level
- [ ] API base host (no secrets)
- [ ] V1 redirect URI confirmed
- [ ] V3 signed-out gate screenshot
- [ ] V4 allowlisted sign-in + redirect success
- [ ] V4b unauthorized domain rejected (recommended)
- [ ] V5 authenticated shell screenshot + session `200` note
- [ ] V6 kill/relaunch restore screenshot
- [ ] V7a sign-out → sign-in gate
- [ ] V7b web session still valid (D147)
- [ ] V7c Android session unusable for Owner APIs
- [ ] V8 connectivity honesty (recommended)

---

## Related

- Android config summary: [`apps/android/README.md`](../apps/android/README.md)
- Auth pipeline diagram: [ARCHITECTURE.md](ARCHITECTURE.md) → Owner authentication pipeline (A9.0)
- Decisions: D145 (shared pipeline), D146 (Android transport), D147 (LOCAL sign-out)
