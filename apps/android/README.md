# Android Owner app (A9.0 + A9.1 + A9.2 + A9.3)

Private sideload Owner application (`com.aicommunication.assistant`, `minSdk` 31).

## A9.3 Owner workflow & assignment

Organize, assign, and follow through on captured work (**D150**) without slowing capture:

- Shell **Tasks** entry → Task list (organizational workspace)
- Task detail → lifecycle (Start / Waiting / Resume / Complete / Dismiss / Note) with Task `If-Match`
- Capture success keeps **Capture another** primary; progressive **Open Task** and optional **Assign**
- Assignment only via `POST /api/v1/tasks/{taskId}/handoff` (D037 / D090); unassigned = Owner work (D094)
- Recipient pick (+ thin create if empty), Gmail connection gating, D037 confirmation, idempotent retry store
- Gmail send re-consent: open Owner web Task page in the browser, then manual Retry in-app (no auto-send)

**Not included:** reminder configuration/delivery, notifications, push, reassignment, offline sync, local business DB, A8 operational enablement, A10+.

## A9.2 Task Capture — interim under D154

Create-only Owner capture (**D149**) in `capture/` + Compose UI is **interim infrastructure**, not permanent capture UX:

- Shell **Capture** entry (one tap from the authenticated shell)
- Single free-text field → **Save** → `POST /api/v1/tasks` via existing A9.1 networking
- Success confirmation only after server `201`
- IME speech-to-text into the field (standard keyboard mic — not A12 voice pipeline)
- Draft preserved on connectivity / request failure; unauthorized returns to A9.0 sign-in

**Reuse / evolve.** Inspect this networking and capture substrate before replacing it when implementing the authorized AI-first Owner UX (D154 / D157). Do not treat it as the permanent Rocket capture experience, and do not discard it casually. Shared business intelligence stays on the backend.

## A9.1 networking

Reusable authenticated Owner HTTP foundation in `network/` (**D148**):

- `OwnerApiExecutor` — centralized request execution, Bearer attachment, one refresh-on-401
- `OwnerApiRepository` / `SessionOwnerRepository` — substrate for Owner routes
- `ApiConfig` — shared API base URL (from the same `local.properties` as auth)
- `AccessTokenProvider` — Supabase access JWT from A9.0 auth (no auth redesign)
- Connectivity awareness (online-first; truthful failures)
- Safe HTTP logging in debug builds (never logs tokens or credentials)

## A9.0 auth

- Google Workspace sign-in via Supabase Auth (Custom Tabs + `aicaa://auth-callback`)
- Secure session storage (EncryptedSharedPreferences)
- Session restore + `GET /api/v1/session` probe (via the A9.1 networking stack)
- Minimum authenticated shell and **session-local** sign-out (`SignOutScope.LOCAL` — D147)

## Real-device verification (A9.0)

**[docs/A9_0_DEVICE_VERIFICATION.md](../../docs/A9_0_DEVICE_VERIFICATION.md)**

## Owner Acceptance Week

Formal product gate (**D142**), **deferred** until Owner re-authorization (**D159**). Sequencing and exit criteria: [docs/MILESTONES.md](../../docs/MILESTONES.md) § Owner Acceptance Week. Not the next executable gate.

## Local configuration

Copy values into `apps/android/local.properties` (gitignored):

```properties
sdk.dir=/path/to/Android/sdk
aicaa.apiBaseUrl=http://10.0.2.2:3000
aicaa.supabaseUrl=https://YOUR_PROJECT.supabase.co
aicaa.supabaseAnonKey=YOUR_ANON_KEY
aicaa.ownerWorkspaceDomain=example.com
```

- Emulator → host machine API: `http://10.0.2.2:3000`
- Physical device → use your machine's LAN URL (http) or a deployed HTTPS base URL

## Supabase Auth redirect

```text
aicaa://auth-callback
```

## Build / sideload

```bash
cd apps/android
./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

Root scripts: `pnpm android:assemble`, `pnpm android:test`, `pnpm android:ktlint`.

## Notes

- `android:allowBackup="false"` — session tokens must not enter cloud backups
- Token refresh is startup / natural-failure only (no background refresh service)
- Sign-out revokes **this device only** (D147)
- Cleartext HTTP is allowed for local development; production should use HTTPS API bases
- Never claim capture or handoff success before the server confirms it
- Handoff pending ops retain original `If-Match` + `Idempotency-Key` for safe retry
