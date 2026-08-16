# Android Owner app (A9.0 + A9.1 + A9.2 + A9.3 + S3.3)

Private sideload Owner application (`com.aicommunication.assistant`, `minSdk` 31).

## A9.3 Owner workflow & assignment

Organize, assign, and follow through on captured work (**D150**) without slowing capture:

- Shell **Tasks** entry → Task list (organizational workspace)
- Task detail → lifecycle (Start / Waiting / Resume / Complete / Dismiss / Note) with Task `If-Match`
- Task detail Scheduling section: date-only deadline (view / set / remove) and D178 Automatic Reminder ON/OFF over the existing reminder API and reminder ETag (S6.2). Configures schedule state; does not claim outbound delivery.
- Assignment is reached from Task detail. Capture no longer opens or assigns a Task, because it creates none (S3.3)
- Assignment only via `POST /api/v1/tasks/{taskId}/handoff` (D037 / D090); unassigned = Owner work (D094)
- Recipient pick (+ thin create if empty), Gmail connection gating, D037 confirmation, idempotent retry store
- Gmail send re-consent: open Owner web Task page in the browser, then manual Retry in-app (no auto-send)

**Not included:** reminder delivery, notifications, push, reassignment, offline sync, local business DB, A8 operational enablement, A10+.

## D181 Google Messages Review with Rocket

Owner-initiated interpretation of an eligible one-to-one plain-text Google Messages notification:

- Shell **Messages** entry → device-local recent list (Notification Listener; no `READ_SMS`)
- Notification arrival stays on-device. No upload, interpretation, or TaskSuggestion until the Owner taps **Review with Rocket**
- Review POSTs `sourceOccurrenceId`, `selectedText`, and `observedAt` with `Idempotency-Key` to `POST /api/v1/messages/reviews`
- Resulting 0..N proposals use the existing S5 proposal review surface (Accept / Edit / Dismiss). Review creates no Task
- Groups, media-only MMS, attachments, and historical conversations remain unsupported
- Exclude Number is not implemented
- In-flight retry identity is in-memory only (same as Gmail Review). The local list is not a durable Messages archive

Debug builds only (`BuildConfig.DEBUG`) may show a **Notification shape (debug)** section on the Messages screen after a Google Messages notification is observed. It reports extra-key presence plus derived `StatusBarNotification.key` structure: segment count, whether the package segment matches the observed package, tag presence/class/length bucket, and exact-match booleans against already-extracted sender/title/body. It does not show, log, persist, or upload the raw key, tag, sender, phone number, title, or message body. Later Galaxy S24+ verification should inspect only these derived fields after one ordinary one-to-one plain-text SMS, before allowing Review. The occurrence identifier is not yet marked safe to transmit.

## S3.3 Owner manual capture — shared interpretation (D171)

Capture asks Rocket to interpret; it creates no Task. AI proposes, the Owner decides later.

- Shell **Capture** entry (one tap from the authenticated shell)
- Single free-text field → **Save** → `POST /api/v1/manual-captures` via existing A9.1 networking
- IME speech-to-text into the field (standard keyboard mic — not A12 voice pipeline)
- `ManualCaptureUseCase` freezes and persists the retry tuple (Idempotency-Key, `rawInput`, `capturedAt`, `timezone`) **before** the request; the UI mints none of those fields
- Result state renders **0..N read-only proposal cards** from canonical `summaryPoints`. Zero proposals is truthful success, not an error, and the original capture text stays available to rephrase
- Recovery state after ambiguous failure or process death shows the stored capture with explicit **Retry** (exact same tuple) and **Discard**. Nothing is ever resent automatically
- Editing a draft that has a pending tuple discards that tuple: the changed text is a new capture with a new identity (**D171**)
- Pending capture text is stored in encrypted preferences, fails closed when encryption cannot initialize, and expires after 24 hours. Proposal results live only in memory
- `400` / `409` clear the unusable tuple and return the Owner to editing; connectivity, `503`, unauthorized, and unmodelled responses preserve it for Retry

**Not included:** approve, dismiss, edit, merge, responsibility selection, Recipient picker, proposal inbox, and Task creation from a proposal. Those remain separately unauthorized.

## A9.2 Task Capture — legacy direct-create, unused

Create-only Owner capture (**D149**) in `capture/` — `CaptureTaskUseCase` and `TaskOwnerRepository.createCapturedTask` over `POST /api/v1/tasks` — is **no longer reachable from the Capture UI** since S3.3. It stays compiled and tested for rollback and later cleanup. The backend endpoint is unchanged and still serves the web surface.

**Reuse / evolve.** Inspect this networking and capture substrate before replacing it. Do not discard it casually. Shared business intelligence stays on the backend.

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
