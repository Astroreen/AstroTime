# Android plan

Status: **planned** — decided, not yet built; it starts once foundation's
[PR 5](foundation.md#pr-5--calendar-grid) has landed the shared UI. This
plan owns the Android app, `apps/mobile` (foundation's [D12](foundation.md#D12),
[D22](foundation.md#D22), [D23](foundation.md#D23)), and the **platform
interfaces** every shell implements ([D60](#D60)); the desktop plan
([`desktop.md`](desktop.md)) links here for them.

## Goal

AstroTime on an Android phone: the same React UI as the web app, in a
Capacitor shell. It talks to CalDAV servers directly (no proxy, no CORS),
keeps credentials under a key in the Android Keystore, fires reminders as
notifications even when the app is closed, and syncs in the background. A
`v*` tag attaches the APK to the GitHub Release, unsigned at first
([D28](foundation.md#D28)); until the signed release (Deferred) it is not
installable by users as it is.

## Decisions

Numbered on from the design plan, after D54–D59, which are kept for the
decisions of foundation's PR 5 (being built alongside this plan); D60–D69
belong to this plan. Versions
were checked on 2026-11-01.

### What every shell provides

- **D60. The platform interfaces, named once.** The shared code (the
  packages and `@astrotime/ui`) needs these from a platform and does
  nothing platform-specific itself (foundation's [D22](foundation.md#D22),
  AGENTS.md rule 1). Each shell (`apps/web`, `apps/mobile`, `apps/desktop`)
  hands its adapters to the UI's root as one `Platform` object:

  | Interface           | Defined in           | What it does                                                                                                              |
  | ------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------- |
  | `HttpClient`        | `@astrotime/caldav`  | one HTTP exchange, any method; exists (`packages/caldav/src/http.ts`)                                                     |
  | `SqlDriver`         | `@astrotime/storage` | the local store's SQLite; exists (`packages/storage/src/driver.ts`); the `Platform` opens it                              |
  | `SecretStore`       | `@astrotime/core`    | `get`, `set`, `delete` a string by key (an account's credentials, as JSON); never in the store ([D36](foundation.md#D36)) |
  | `ReminderScheduler` | `@astrotime/core`    | `schedule(reminders)` replaces every reminder scheduled before; `onOpen` reports a tapped one                             |
  | `openExternal`      | `@astrotime/ui`      | opens a URL in the system browser (Login Flow v2's page)                                                                  |

  The shared code computes the reminders (from `VALARM`s, the next 7 days,
  at most 100, the soonest first, each with a stable string id), so every
  platform fires the same ones; a platform only shows them. How alarms
  become reminders (all-day and floating items, `RELATED=END`, absolute
  triggers, `REPEAT`, a series' exceptions, tasks with only a due) is
  decided where the set is first built: foundation's PR 6, reminders as
  notifications ([D9](foundation.md#D9)). `@astrotime/sync`, which
  reaches the store and the providers, also exports one sync entry,
  `syncAll()`: it syncs every account, joins a sync already running instead
  of starting a second, and reschedules the reminders afterwards. The UI's
  own triggers (start, focus, a timer) are the web's decision, taken in
  foundation's PR 5 with the accounts and sync wiring, and run in every shell because the UI is the same; a shell
  adds triggers of its own by calling `syncAll()` ([D67](#D67), desktop
  [D75](desktop.md#D75)). The UI pads its edges by the safe-area insets
  ([D68](#D68)). If PR 5 lands a different shape first, the code is the
  territory: this decision is updated to it.

  _Landed in foundation's PR 5a-3 ([D90](foundation.md#D90),
  [D91](foundation.md#D91)):_ `Platform` (`@astrotime/ui`) holds `store`
  (the opening `Store`, on the platform's `SqlDriver`), `http`, `secrets`,
  `openExternal` and `preferences` (the device's own choices, which PR 5a-1
  passed beside it); `reminders` joins with PR 6. `syncAll(context, { fresh })`
  takes the store, the `SecretStore` and `connectCalDav(http)`; `fresh` asks
  for a sync that starts after the call, still never two at once.

### The shell

- **D61. `apps/mobile`, Capacitor 8.** `@astrotime/mobile` is a Vite app
  whose entry builds the Android `Platform` and renders `@astrotime/ui`,
  as `apps/web` does with its own; Capacitor (8.6, the latest stable)
  copies its build into the committed `android/` Gradle project. The app id
  is `io.github.astroreen.astrotime` (the owner holds no domain; F-Droid
  and the desktop's `.desktop` id use the same form), the name
  "AstroTime". SDK levels are Capacitor 8's: `minSdk` 24, `compileSdk` and
  `targetSdk` 36, which Google Play requires of updates since August 2026.
  Capacitor 9 is in beta (minSdk 26, target 37); the app moves when it is
  stable. The app's origin, `https://localhost`, holds the local store
  ([D63](#D63)), so `server.hostname` and `androidScheme` are never changed:
  a new origin is an empty store. The store needs a System WebView of
  Chromium 109 or newer; on an older one the app says to update the WebView
  instead of failing. `CapacitorHttp`'s patching of `fetch` stays off.

### Platform adapters

- **D62. HTTP through a plugin of our own, on OkHttp.** Capacitor's
  `CapacitorHttp` hands the method to Android's `HttpURLConnection`, which
  throws on anything but the standard methods, so `PROPFIND`, `REPORT` and
  `MKCALENDAR` cannot pass; `@capacitor-community/http` (last released in 2021) has the same limit, the WebView's `fetch` meets CORS from
  `https://localhost`, and the web proxy ([D20](foundation.md#D20)) would
  make a phone depend on a server. So `apps/mobile` carries a small
  Capacitor plugin in Kotlin on OkHttp, which takes any method: it returns
  the status, the URL that answered (`response.request.url`), the headers
  (repeated ones joined with `, `, as `fetch` does) and the body as text,
  and rejects with an "offline" code when the server cannot be reached,
  which the TypeScript adapter turns into `OfflineError`. The plugin follows
  redirects itself, up to 10, with OkHttp's `followRedirects` and
  `followSslRedirects` off, as the desktop does ([desktop D72](desktop.md#D72)),
  and returns the last hop's URL, so one rule holds on every platform: a
  307 or 308 keeps the method and body, a 301 or 302 turns only a `POST`
  into a `GET`, and a 303 turns anything but `GET` and `HEAD` into a `GET`,
  as `fetch` does (so `PROPFIND` and `REPORT` keep theirs on 301 and 302);
  `Authorization` goes only to the request's origin (scheme, host and
  port) and is dropped when a redirect leaves it, and the cleartext check
  below applies to every hop; no cookie
  jar is set, so no cookies are kept. The app trusts user-installed CAs as
  well as the system's (`network_security_config`), so a self-hosted
  server with its own CA works once its certificate is installed on the
  phone. Plain `http` (a server on the home network, the local Radicale)
  cannot be allowed per address in `network_security_config`, which is
  static and by domain, so the base config permits cleartext and the plugin
  holds the line itself: it refuses an `http` request unless its origin is
  a saved account's or the one being signed in to, so nothing the user did
  not type goes out unencrypted.

- **D63. The store: sqlite-wasm on OPFS in the WebView.** _Changes
  foundation's [D25](foundation.md#D25)_, which named
  `@capacitor-community/sqlite`. The Android WebView is Chromium, and OPFS
  with synchronous access handles works in it since version 109, so the
  web's driver (`@astrotime/storage/web`, `opfs-sahpool` in a worker) runs
  unchanged and is already tested in a browser. `@capacitor-community/sqlite`
  (8.1.1) returns rows as objects, whose column order is not reliable for
  Drizzle's `sqlite-proxy` and loses columns of the same name, crosses the
  bridge as JSON on every query, and always bundles SQLCipher. The WebView's
  data lives in the app's data directory: updates keep it, uninstalling
  or clearing the app's data removes it. Not verified: whether the WebView
  may evict OPFS under storage pressure; the app asks for persistent
  storage (`navigator.storage.persist()`) and PR A1 checks what the
  WebView answers. If eviction is real, the native plugin comes in behind
  the same `SqlDriver`, and only pending changes are at stake (the rest is
  on the server).

- **D64. Credentials under a Keystore key: `@aparajita/capacitor-secure-storage`.**
  The `SecretStore` adapter uses `@aparajita/capacitor-secure-storage`
  (8.0.1, MIT, Capacitor 8): AES-GCM with a key generated in the Android
  Keystore, the ciphertext in the app's shared preferences, as foundation's
  [D19](foundation.md#D19) asks. The key needs no user authentication, so
  background sync ([D67](#D67)) can read the credentials. Android's backup
  is off (`allowBackup="false"`, and `dataExtractionRules` excluding every
  domain, which Android 12 and later read instead for cloud backup and
  device transfer): a Keystore key is never restored, so
  restored ciphertext could not be read, and the store is a copy of the
  server. Rejected: Capawesome's secure preferences (a proprietary licence,
  for sponsors), Ionic's secure storage (an enterprise product), and
  `capacitor-secure-storage-plugin` (0.x, less maintained).

- **D65. Login Flow v2 in a Custom Tab.** The `openExternal` adapter opens
  the login page with `@capacitor/browser` (8.0.5, Chrome Custom Tabs), so
  the user signs in where their browser's passwords and second factor are.
  Nextcloud's flow has no callback: the client polls, through the plugin of
  [D62](#D62), so CORS never applies and no deep link is needed. The shared
  sign-in screen (the same on every platform) polls every 2 seconds while
  it waits, at once when the user returns to the app (`browserFinished`,
  `visibilitychange`), and gives up after 20 minutes, when Nextcloud's
  token expires. `@capacitor/browser`'s `close()` does nothing on Android,
  so once the flow is approved the plugin of [D62](#D62) brings the app's
  activity forward (`FLAG_ACTIVITY_CLEAR_TOP`, which ends the Custom Tab in
  the app's task); if that fails on a device, the user returns with back,
  and the poll on return finishes the sign-in.

### Behaviour

- **D66. Reminders as local notifications, exact.** The
  `ReminderScheduler` adapter uses `@capacitor/local-notifications` (8.3.1):
  each `schedule` cancels what is no longer in the set and schedules the
  rest, with an integer id the adapter allocates per stable id and keeps
  (a map in the app's preferences), never a hash, so no two reminders
  share one. Android
  holds them, so they fire with the app closed, and the plugin restores them
  after a reboot (its boot receiver). The set is replaced after every sync,
  every local edit and every start, and by background sync; 100 at most
  stays far below Android's limit of about 500 alarms per app. Reminders
  fire on time: the app declares `USE_EXACT_ALARM` (Android 13 and later,
  granted at install, and allowed by Google Play for calendar apps) and
  `SCHEDULE_EXACT_ALARM` up to Android 12L; when the user revokes exact
  alarms, they fire inexactly and the settings say so. The notification
  permission (Android 13 and later) is asked the first time there is a
  reminder to schedule, not at start. A tap opens the app on the item.

- **D67. Background sync: WorkManager and a headless WebView, our own
  plugin.** A periodic WorkManager job (every hour, only with a network,
  WorkManager's minimum is 15 minutes) runs while the app is closed. The
  sync engine is TypeScript and the store is in the WebView's OPFS
  ([D63](#D63)), so the job runs the same code where the store is: it
  creates a WebView without an activity, serves the app's own files on the
  same origin (`https://localhost`, through `WebViewAssetLoader`) and loads
  a small background entry that calls `syncAll()` ([D60](#D60)) and
  reschedules reminders, with the HTTP, secrets and notification code of
  [D62](#D62), [D64](#D64) and [D66](#D66) reached through a
  `WebMessageListener` instead of Capacitor's bridge. The two WebViews
  share one origin, and `opfs-sahpool` holds its files exclusively, so one
  opens the store and the other follows it, as a browser's tabs do
  ([foundation D98](foundation.md#D98)): the worker holding the store's
  Web Lock leads, and the other WebView sends it its statements over a
  `BroadcastChannel` (`navigator.locks` and `BroadcastChannel` are shared by
  every WebView of the app, as by every tab of a browser). The job runs only
  when nobody leads the store (`navigator.locks.query()`): when the open app
  does, the job does nothing, since the open app syncs itself. The app
  starting while the job leads follows it at once, never waiting, and leads
  when the job closes the store, or when the job's process is killed, which
  releases the lock with its WebView. The job's `syncAll` takes the tabs'
  sync lock ([foundation D91](foundation.md#D91)), so the app's first sync
  waits for the job's to end instead of uploading the same change beside
  it. _Changed by foundation D98:_ the app first asked the job to yield and waited for the
  lock, up to the job's 10 minutes. A run cut short loses nothing: an object is marked
  synced only when the server took it, and a calendar's sync token is saved
  only after its download, so the next sync picks up where it stopped
  ([D37](foundation.md#D37)).
  Limits: WorkManager decides the exact time (Doze, battery saver), a run
  may last 10 minutes, and the user can stop it in Android's settings.
  Rejected: `@capacitor/background-runner`, which runs JavaScript in a
  separate engine with no access to the store and whose `fetch` is
  `HttpURLConnection` again (no `PROPFIND`), and whose current version
  needs Capacitor 9; `@capawesome/capacitor-background-task`, which only
  finishes work on going to the background; Transistorsoft's background
  fetch, whose headless mode after the app is killed is Java-only. In the
  foreground the app resuming (`@capacitor/app`'s `resume`) is a focus for
  the UI's own triggers. PR A4 starts by proving that a headless WebView
  opens the store; if it cannot, the app syncs only while open and
  background sync goes to Deferred.

- **D68. Back button, theme, edge to edge.** The back button
  (`@capacitor/app`) closes what is open (a dialog, the drawer, the tasks
  screen), then goes back in the UI's history, and at the first screen
  moves the app to the background (`App.minimizeApp()`), as Android does
  for launcher apps. The app's Android theme is `DayNight`, so the WebView's
  `prefers-color-scheme` follows the system (design [D44](design.md#D44));
  the drawer's override (design [D53](design.md#D53)) is CSS, and the status
  and navigation bar icons follow the shown theme through Capacitor's
  `SystemBars`. Target 36 draws edge to edge with no opt-out: `SystemBars`
  in its `css` mode injects `--safe-area-inset-*` (the WebView's own `env()`
  is wrong before Chromium 140), and the UI pads its top bar, drawer and
  floating button by them. No deep links: Login Flow v2 needs none
  ([D65](#D65)). The splash screen hides when the first screen has drawn.

### Build and release

- **D69. Build, CI, release and the dev shell.**
  - **Dev shell:** devenv's `android` module (it composes nixpkgs'
    `androidenv`, accepts the SDK licence, and points Gradle at nixpkgs'
    `aapt2`, which the Maven one cannot replace on NixOS), with platform
    36, build tools 36.0.0 and JDK 21 (what Capacitor 8's Gradle build
    needs) and without the emulator, system images and NDK, which keeps
    the download small. Android Studio is not part of it; a device or an
    emulator outside the shell runs the debug APK.
  - **CI:** a job on every PR builds the UI, `cap sync`s it and runs
    `./gradlew assembleDebug test` on `ubuntu-latest`, with JDK 21 from
    `actions/setup-java` (the runner's default JDK moves to 25 with Ubuntu
    26.04) and the SDK packages it needs installed by the job itself
    (`sdkmanager "platforms;android-36" "build-tools;36.0.0"`, a no-op
    where the image has them), so a new runner image cannot take them
    away. The debug APK, signed with the run's throwaway debug key and so
    installable for trying the app, is the run's artifact (each run's
    key differs, so one does not update over another);
    the job joins the `CI` status ([D27](foundation.md#D27)).
  - **Release:** on a `v*` tag that passes the existing checks (on `main`,
    `CI` passed, matches `package.json`, [D41](foundation.md#D41)), a job
    runs `./gradlew assembleRelease` with no signing config and attaches
    `astrotime-<version>-unsigned.apk` to the tag's GitHub Release, which
    the release workflow's first job creates for both platforms
    (`gh release create --verify-tag --generate-notes`, a prerelease for a
    prerelease tag, skipped when it exists); the Android and desktop jobs
    `need` it (desktop [D79](desktop.md#D79)). An unsigned APK does not
    install as it is; no debug-signed build goes on a Release, since a key
    anyone can hold could sign updates to it. The signed release stays
    Deferred.
  - **Tests:** the TypeScript side of each adapter is unit-tested in Node
    with the plugin replaced (errors to `OfflineError`, the notification
    set's diff, the ids); the Kotlin HTTP plugin is tested by Gradle with
    OkHttp's `MockWebServer` (`PROPFIND` and `REPORT` pass, the answering
    URL after a redirect, `Authorization` dropped when a redirect leaves
    the origin, by host, scheme or port, an `https` → `http` hop refused,
    no cookies).
    No emulator in CI yet: the UI is tested in the browser, and screenshots
    from a device or an emulator are each PR's evidence.

## Deferred

- **Signed Android release** — foundation's Deferred; a release key held
  in the repository's secrets, then F-Droid and Google Play ([D69](#D69)).
- **Emulator tests in CI** — `android-emulator-runner` on a KVM runner, a
  smoke test of the HTTP plugin and the store on a real WebView ([D69](#D69)).
- **Capacitor 9** — when it is stable: minSdk 26, target 37 ([D61](#D61)).
- **The native SQLite plugin** — only if OPFS in the WebView proves
  evictable or slow ([D63](#D63)).
- **Untrusted certificates** — a dialog to trust a server's own certificate
  for its account, as DAVx5 has, instead of installing its CA ([D62](#D62)).
- **A sync interval setting** — the hour of [D67](#D67) is fixed until
  someone needs another.
- **Widgets, quick settings tile, share target** — none in the first
  release.
- **System calendars** — foundation's Deferred (`CalendarContract`).
- **One redirect loop for the native shells** — a shared redirect loop in
  `@astrotime/caldav` over a one-hop `HttpClient`, so Android's plugin and
  the desktop's `net.request` follow one implementation of the redirect rule
  of [D62](#D62) and [desktop D72](desktop.md#D72) instead of one each
  (from the review of the platform plans).

## PR plan

Each PR names the decisions it implements and attaches its evidence
(AGENTS.md). The order lets each PR be tried on a phone.

### PR A1 — The shell, HTTP and the store

`apps/mobile` with Capacitor and the committed `android/` project; the
interfaces of D60 that PR 5 has not added yet (`SecretStore`,
`ReminderScheduler`, `syncAll`); the OkHttp plugin; the web store driver in the WebView; signing in with a
password (credentials held in memory until PR A2); the dev shell's SDK; the
CI job with the debug APK. Decisions: D60, D61, D62, D63, D69 (dev shell,
CI, tests).

Done when: the debug APK from CI installs on a phone or an emulator, signs
in to a Radicale or a Nextcloud by password, and shows its items from the
local store after a restart without a network; the plugin's Gradle tests
pass in CI; `navigator.storage.persist()`'s answer in the WebView is
recorded in the PR, and so is whether a second WebView of the app sees the
same OPFS files, the first one's Web Lock and its `BroadcastChannel`s
(D67 depends on all three). Screenshots in both themes are the evidence.

### PR A2 — Credentials, Login Flow v2, the shell's manners

The Keystore-backed `SecretStore`, Login Flow v2 in a Custom Tab, the back
button, the theme and edge to edge. Decisions: D64, D65, D68.

Done when: credentials survive a restart and are unreadable in the app's
data without the Keystore; a Nextcloud account is added through Login
Flow v2 on a phone; back closes the drawer, then leaves the app; the top
bar and the floating button clear the status and navigation bars in both
themes (screenshots).

### PR A3 — Reminders

Local notifications from the shared reminder set, exact alarms, the
notification permission, opening the item from a tap. It needs foundation's
PR 6, which computes the set ([D60](#D60)); A1 and A2 do not. Decisions:
D66.

Done when: a reminder fires on time with the app closed and after a
reboot; editing or deleting the item on the server moves or removes it
after the next sync; unit tests cover the set's diff and the ids (no two
reminders share an integer id).

### PR A4 — Background sync

The WorkManager job with the headless WebView; first the proof that it
opens the store. Then the job's own native entry points: the headless
WebView has no Capacitor bridge, so HTTP ([D62](#D62)), secrets
([D64](#D64)) and notifications ([D66](#D66)) each get a
`WebMessageListener` handler next to their plugin, sharing its Kotlin core,
and a background adapter set in TypeScript speaks to them. Decisions: D67.

Done when: with the app closed, a change made on the server arrives within
a WorkManager run (forced with `adb shell cmd jobscheduler run` or
WorkManager's test driver, never a wait), and its reminder is scheduled;
with the app open the job does nothing; the three handlers are unit-tested
like the plugins. If the proof fails, the PR records it and moves
background sync to Deferred instead; reminders then reach only as far as
the last time the app was opened, so the horizon of [D60](#D60) grows to
30 days (still at most 100 reminders) and the settings say that reminders
need the app opened now and then.

### PR A5 — The release APK

The release job: the GitHub Release on a `v*` tag with the unsigned APK.
Decisions: D69 (release), foundation's D28.

Done when: a prerelease tag (on a fork is enough) creates its Release with
`astrotime-<version>-unsigned.apk`, which `apksigner verify` reports
unsigned and which, signed by hand with a test key, a phone installs.
