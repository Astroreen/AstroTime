# Android plan

Status: **in progress** — [PR A1](#pr-a1--the-shell-http-and-the-store)
(the shell, HTTP and the store) and
[PR A2](#pr-a2--credentials-login-flow-v2-the-shells-manners) (credentials,
Login Flow v2, the shell's manners) and
[PR A5](#pr-a5--the-release-apk) (the release APK) are built; A3 and A4
are decided, not yet built.
It started once foundation's
[PR 5](foundation.md#pr-5--calendar-grid) had landed the shared UI. This
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
  notifications ([D9](foundation.md#D9)). _Decided there:_
  [foundation D100](foundation.md#D100)–[D102](foundation.md#D102). `@astrotime/sync`, which
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
  passed beside it); `reminders` joined with foundation's reminders
  ([D101](foundation.md#D101)): `ReminderScheduler` has `permission()`,
  `requestPermission()` and `whileOpenOnly` beside `schedule` and `onOpen`,
  and each reminder brings its notification's words. `syncAll(context, { fresh })`
  takes the store, the `SecretStore` and `connectCalDav(http)`; `fresh` asks
  for a sync that starts after the call, still never two at once.

  _Added in PR A1:_ `signingInTo(server)`, optional, returns the function
  that ends it: the sign-in (`SignIn`) tells the platform which server it is
  signing in to (the address typed, then the one Nextcloud names), so
  Android's plugin lets plain http reach it before it is a saved account
  ([D62](#D62)). The web leaves it out: its proxy keeps its own allowlist.

  _Added in PR A2:_ `onBack(close)`, optional, returns the function that
  stops it: the UI hands the platform a function that closes what is open
  and says whether anything was, and a shell with a back button calls it
  ([D68](#D68)). The web and the desktop leave it out.

  _Added in desktop PR D3 ([desktop D75](desktop.md#D75)):_ two more, both
  optional. `shell(state)`: a shell whose app lives on with its window
  closed takes the theme its frame follows, whether closing the window
  quits, and its tray's and menu's words, on start and at every change; the
  drawer's settings offer "Keep running" only where it exists.
  `onSyncRequest(listener)`: a shell's own sync triggers, which the UI runs
  as "Sync now" through its `SyncScheduler`. Each `ScheduledReminder`'s
  words gained `late`, the body of one shown late
  ([foundation D102](foundation.md#D102)).

  _Added in PR A3 ([D66](#D66)):_ `ReminderScheduler` gained four optional
  members, all Android's so far. `asksWhenNeeded`: the platform asks the
  permission itself, so the UI hands it the set while the permission is
  still `default` (the web's stays empty until granted). `native`: the
  permission is the system's, so the setting's words name the system's
  settings, not a browser's. `inexact()`: reminders may come late, which
  the setting says. `onPermissionChange(listener)`: the permission or
  `inexact` changed without the UI asking. The desktop sets `native` too.

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
  a new origin is an empty store. The app needs a System WebView of
  Chromium 123 or newer (the store's OPFS needs 109, the theme's
  `light-dark()` 123); on an older one it says to update the WebView
  instead of failing. `CapacitorHttp`'s patching of `fetch` stays off.

  _Built in PR A1_ with Capacitor 8.6.0 (`capacitor.config.json`, since the
  CLI's loader of a `.ts` config needs TypeScript's JavaScript API, which
  TypeScript 7 does not ship), Capacitor's own `android/` template, Gradle
  8.14.4 (Kotlin 2.4 calls 8.14.3 deprecated) and Kotlin 2.4.21 for the
  plugin. _Moved to PR A2:_ the message for an older WebView. It needs a
  store error of its own that the shared UI words in both languages, beside
  the shell's other manners; until then an older WebView shows the store's
  general failure.

  _Built in PR A2:_ before opening the store, the app reads the WebView's
  Chromium version from its user agent (`src/webview.ts`); below 123 it
  throws `OutdatedWebViewError` (`@astrotime/storage`) instead, which the
  shared UI words in English and Russian, naming both versions, with no
  Reload button (reloading does not update the WebView). The check runs in
  the app's bundle, which Vite builds for Chromium 111: a WebView too old to
  run the bundle at all would show a blank page, and no such WebView was
  tried (the message was seen on the emulator's WebView 133 with its user
  agent overridden over CDP). The floor is 123, not the store's 109, since
  the theme's colours use `light-dark()` (Chromium 123): below it the app
  would open with no colours (a review of A2). The System WebView updates
  through the Play Store; 123 shipped in March 2024.

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
  not type goes out unencrypted. The list comes with each request from the
  app's own code in the WebView, which loads nothing but the app's origin:
  the line holds as long as that code does, as the store's does. A refused
  certificate (untrusted, expired, another name) is the plugin's
  `certificate` error, not offline; a handshake the network broke stays
  offline.

  _Built in PR A1_ (`AstroTimeHttp`: `Exchange.kt`, `HttpPlugin.kt`;
  `apps/mobile/src/http.ts`), on OkHttp 5.4.0: 5.5 needs `compileSdk` 37,
  beyond Capacitor 8's 36. The TypeScript adapter sends with each request the
  origins plain http may reach, the http ones among the saved accounts'
  addresses and calendar homes and the servers being signed in to
  (`signingInTo`, [D60](#D60)); the plugin checks every hop against them.
  `Authorization` dropped on leaving the origin stays dropped for the rest of
  the redirects, as `fetch` does. The plugin rejects with a code the adapter
  reads: `offline` (also an answer that broke off) becomes `OfflineError`;
  `cleartext`, `redirects` (past 10) and `invalid` stay errors of their own.
  Reads and writes may take a minute, for a large calendar's `REPORT`.

  _Since PR A2:_ the `certificate` code becomes `CertificateError`
  (`@astrotime/caldav`), which discovery passes on at once, as it does
  offline (both hold for the origin), and the sign-in words in both
  languages; the sign-in had shown its general failure, and discovery had
  turned the refusal into "no calendars here".

  _Since desktop PR D1:_ the redirect rule has one implementation,
  `followRedirects` in `@astrotime/caldav`, over a client that makes one
  exchange and returns a redirect as it came; the desktop's `net.request`
  runs under it ([desktop D72](desktop.md#D72)), and the plugin can do the
  same, each hop returned with OkHttp's redirects off and the adapter
  following them. It closed the Deferred "one redirect loop for the native
  shells" for the desktop; Android's plugin still follows them itself
  (Deferred, "One redirect loop for Android too").

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

  _Checked in PR A1:_ the Android System WebView (Chromium 133, on an
  Android 16 emulator) answers `persist()` with `false`, and `persisted()`
  is `false`: the store is best-effort storage, as a site's is in a browser
  that has not granted it. Whether the WebView ever evicts it under storage
  pressure is still not verified; the native plugin stays
  [deferred](#deferred) until it is.

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

  _Built in PR A2_ with 8.0.1 (`src/secrets.ts`), as decided: each secret
  has a Keystore key of its own (alias `capacitor-storage_account:<id>`), and
  its ciphertext and IV sit in the shared preferences
  `WSSecureStorageSharedPreferences`. Ciphertext that no longer decrypts
  (malformed, or sealed under another key) reads as none, so its account
  asks to sign in again, as on the web ([foundation D89](foundation.md#D89));
  any other failure is said. Checked on the emulator: the account still syncs
  after the app is killed and started again, and none of the app's files
  (74 in that run: its WebView's store, preferences and caches included)
  holds the app password in plain text. The library lists `@capacitor/ios` and
  `@capacitor/keyboard` among its dependencies, so pnpm installs their
  JavaScript; `cap sync` adds only the app's own dependencies to the Gradle
  project, so neither reaches the APK.

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

  _Changed in PR A2:_ the app does not come back by itself. With the Custom
  Tab in front, the app's process holds no visible activity, so Android (14
  and later) caches and freezes it, its WebView with it: the poll stops
  within seconds, and nothing in the app runs to bring it forward, neither
  the app's own plugin nor `@capacitor/browser` 8.0.5's `close()` (which, no
  longer a no-op, finishes the tab from the plugin's controller activity).
  Seen on the emulator: no poll from the
  Custom Tab opening until the return, and `dumpsys activity processes`
  reported the app `isFrozen=true`. So the fallback is the way: Nextcloud's
  page says "You can close this window"; the user closes the tab (or goes
  back to the app), the WebView is visible again, and the sign-in polls at
  once (`visibilitychange`, which `browserFinished` would only repeat) and
  finishes. Approved through the Custom Tab, the poll answered 200 on the
  return and discovery followed. Keeping the app awake while the tab is open
  is [deferred](#deferred).

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

  _Built in PR A3_ (`apps/mobile/src/reminders.ts`, `androidReminders`), on
  `@capacitor/local-notifications` 8.3.1:
  - **The diff.** The map in the app's preferences (`astrotime.reminders`,
    the WebView's localStorage) holds, per stable id, the integer id and the
    time and words it was scheduled with, beside the counter ids come from.
    A reminder gone from the set is cancelled (a notification already shown
    stays on the screen: the plugin cancels only what is still to come); a
    new one, or one whose time or words changed, is scheduled under its id,
    which replaces its alarm; the rest is left. The first set of each run
    arms every reminder ahead again, since alarms do not survive the app
    being force-stopped, updated, or its exact alarms revoked (Android then
    restarts it). Sets are applied one at a time, the latest winning.
  - **The ids** come from a counter kept with the map, from 1, wrapping
    before Java's largest `int` past the ids in use; an id freed is not
    handed out again until the counter wraps. The map is written before
    Android is called, so an id is never handed out twice; a set Android
    refuses is scheduled again with the next, under the same ids. One that
    fired and then moved ahead (the item edited to later) gets a new id, so
    the notification already shown is not taken off the screen. Without a
    map that reads (the preferences cleared, or written wrong), the first
    set cancels every alarm the plugin still holds (`getPending`) before
    ids are handed out from 1 again, so no old alarm shares one. The
    plugin's cancel only stops alarms: a notification already shown stays
    on screen (`LocalNotificationManager.cancel` in
    `@capacitor/local-notifications` 8.3.1). A read that fails does not
    stop the set: it is tried with the next one, skipping the ids handed out
    since, as scheduling under an id already replaced its old alarm.
  - **Past reminders.** The set reaches an hour back
    ([foundation D100](foundation.md#D100)). One handed over before has
    fired from its alarm, and is never shown again. One that reaches
    Android already past (an item synced in after its time) shows at once
    if it is 5 minutes late at most, as on the web
    ([foundation D101](foundation.md#D101)), saying when it was due once
    more than a minute late (its `late` words, as the desktop's,
    [desktop D76](desktop.md#D76)), and is dropped if older: with
    the alarms held by Android, only a late sync makes one late, and an hour
    late would only say something stale. One edited into the past beyond
    that has its alarm for the old time cancelled. After a reboot the
    plugin's boot receiver arms what is still ahead and shows what came due
    while the phone was off, 15 seconds after boot, however old: that is
    the plugin's, not the adapter's.
  - **The permission** is asked by the adapter once, the first time a set
    holds a reminder ahead (so the user sees why), and remembered once the
    user answered (a prompt the app ended in, or one that failed, is asked
    again): after a
    refusal the "Reminders" switch asks again, as on the web; refused twice,
    Android stops asking and the setting says to allow notifications in the
    system's settings. Nothing is scheduled without it (the plugin would ask
    on every set), but what leaves the set is still cancelled, which needs
    no permission: its alarm would show once notifications are allowed
    again. Back in front the adapter reads both permissions again
    and the setting follows.
  - **Exact alarms.** `USE_EXACT_ALARM`, and `SCHEDULE_EXACT_ALARM` with
    `maxSdkVersion` 32 (the plugin declares it for every version; the
    app's manifest replaces it). When exact alarms are off (only possible
    up to 12L), notifications are scheduled inexact rather than the plugin
    opening the system's settings on every set, and the setting says
    reminders may come a few minutes late. Checked on the emulator
    (Android 16): `dumpsys alarm` shows the alarm `window=0`,
    `exactAllowReason=policy_permission`.
  - **The channel** `reminders`, created by `MainActivity` at every start
    with high importance (shown over the screen, with a sound) and named
    from Android's resources in the system's language (`values`,
    `values-ru`); the status bar icon is a bell (`ic_stat_reminder`). The
    plugin's own "Default" channel exists beside it, unused.
  - **A tap** comes back as the plugin's `localNotificationActionPerformed`
    with the reminder in `extra`; one that started the app is kept until the
    UI listens. The UI opens its day and its details
    ([foundation D101](foundation.md#D101)).
  - **Until PR A4** the set is computed only while the app runs: on start,
    after each sync and edit, at midnight. A reminder up to 7 days after the
    app was last open fires; one further ahead fires only if the app is
    opened in between. PR A4's background sync closes this ([D67](#D67)).

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

  _Checked in PR A1_, on an Android 16 emulator (WebView 133): a second
  WebView of the app, created without a window in the same process and
  serving a page on `https://localhost`, sees the same OPFS files (the store's
  `opfs-sahpool` directory), sees the first WebView's Web Lock on the store
  (`navigator.locks.query()` lists it, and a request with `ifAvailable` gets
  none), and exchanges messages with it over a `BroadcastChannel` both ways.
  What this decision builds on holds between two WebViews of one process;
  the WorkManager job runs in the app's process too. What PR A4 still proves
  is the headless WebView opening the store from a job with no activity.
  The two-WebView check ran with a probe not kept in the repository (its log
  is with PR A1's evidence); PR A4's own test re-proves it.

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

  _Built in PR A2:_
  - **Back:** the shell listens to `@capacitor/app`'s `backButton` from the
    start and calls the UI's `onBack` function ([D60](#D60)); when that
    closed nothing, or the UI has none (the store did not open),
    `App.minimizeApp()`. The UI closes the topmost of: a Base UI popup (a
    dialog, the drawer, a menu, a popover), as Escape does, since Base UI
    marks the key used; search; the tasks screen. The UI keeps no history of
    its own (views and days are not pages), so after that back leaves the
    app.
  - **Theme:** the application's theme is `DayNight` too. The bars follow
    the theme the page shows, the setting's (`data-theme`) or else the
    system's, through AstroTime's own plugin (`AstroTimeShell.setBars`: the
    icons, and the window's background in the page's canvas colour), not
    `SystemBars.setStyle`: SystemBars styles the bars by the system's theme
    and resets the window's background to the Android theme's on every
    configuration change, so `MainActivity` puts the app's style back after
    it. A system theme change reaches the running page (`uiMode` stays a
    configuration change the activity handles).
  - **Edge to edge:** `SystemBars` stays in its `css` mode (with
    `initialViewportFitValueHint: "cover"`). On a WebView before 140 (the
    emulator's 133) Capacitor keeps the WebView clear of the bars itself and
    injects zero insets, and the bars show the window's background; from 140
    the page draws under the bars and the UI pads its shell, drawer, search
    and tasks screen by `--inset-*` (`styles.css`: the injected
    `--safe-area-inset-*`, else `env()`), which `apps/web/e2e/insets.spec.ts`
    checks.
  - **Splash screen:** not built; it stays with the app's icon in
    [Deferred](#deferred) (the launch theme's placeholder shows until the
    WebView draws).

### Build and release

- **D69. Build, CI, release and the dev shell.**
  - **Dev shell:** nixpkgs' `androidenv`, composed in `devenv.nix` (the SDK
    licence accepted and its packages, which nixpkgs marks unfree,
    permitted by name in `devenv.yaml`), with platform 36, build tools
    35.0.0, platform-tools and the command-line tools, and JDK 21 (what
    Capacitor 8's Gradle build needs); Gradle is pointed at nixpkgs'
    `aapt2`, which the Maven one cannot replace on NixOS. No emulator,
    system images, NDK, CMake or old SDK tools, and `sdkmanager` runs on
    the shell's headless JDK 21 rather than the full JDK 17 that
    `androidenv` wraps it with: the SDK adds about 450 MB and the JDK
    565 MB, 1.0 GB in all (1.8 GB with `androidenv`'s JDK). Android Studio
    is not part of it; a device or an emulator outside the shell runs the
    debug APK. _Changed in PR A1:_ devenv's `android` module was the plan,
    but it always adds an emulator launcher with an SDK of its own
    (platform 35, command-line tools 8.0) and the old SDK tools 26.1.1, and
    writes `local.properties` and `.android/` into the repository's root;
    and the build tools are 35.0.0, not 36.0.0, because the Android Gradle
    Plugin (8.13) uses 35.0.0 unless a module says otherwise, and
    Capacitor's own library modules do not.
  - **CI:** a job on every PR builds the UI, `cap sync`s it and runs
    `./gradlew assembleDebug test` on `ubuntu-latest`, with JDK 21 from
    `actions/setup-java` (the runner's default JDK moves to 25 with Ubuntu
    26.04) and the SDK packages it needs installed by the job itself
    (`sdkmanager "platforms;android-36" "build-tools;35.0.0"`, a no-op
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
    (`gh release create --draft --verify-tag --generate-notes`, a prerelease
    for a prerelease tag, skipped when it exists); the Android and desktop
    jobs `need` it (desktop [D79](desktop.md#D79)), and a last job publishes
    the draft once the image and every file are there, so a failed job never
    leaves a public Release missing files. The upload jobs check out without
    persisting the token, which only the upload step is given. An unsigned APK does not
    install as it is; no debug-signed build goes on a Release, since a key
    anyone can hold could sign updates to it. The signed release stays
    Deferred.
    _Landed in PR A5:_ the APK carries the product's version: Gradle reads
    the root `package.json` (`versionName` as it is, `versionCode` =
    major × 1,000,000 + minor × 1,000 + patch, so each release's is higher;
    a prerelease shares its release's). CI's Android job builds
    `assembleRelease` beside the debug APK and runs the release's own check,
    `scripts/release-apk.sh`: the APK renamed, `apksigner verify` reporting
    it unsigned, and `aapt2 dump badging` showing the version. The release
    workflow's `android` job runs the same script and uploads the file with
    `gh release upload --clobber`.
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
- **Back from Login Flow by itself** — Android freezes the app while the
  Custom Tab is in front, so the user comes back ([D65](#D65)). Keeping it
  awake meanwhile needs a foreground service for up to Nextcloud's 20
  minutes, or Chrome bound to the app (a Custom Tabs `postMessage` channel);
  neither is worth a tap.
- **A sync interval setting** — the hour of [D67](#D67) is fixed until
  someone needs another.
- **Widgets, quick settings tile, share target** — none in the first
  release.
- **System calendars** — foundation's Deferred (`CalendarContract`).
- **The app's icon and splash screen** — Capacitor's placeholders until
  AstroTime has a design for them ([D61](#D61)).
- **One redirect loop for Android too** — the desktop follows redirects
  through `followRedirects` in `@astrotime/caldav` ([desktop D72](desktop.md#D72));
  Android's plugin still follows them itself, in Kotlin, by the same rule
  ([D62](#D62)). Making the plugin one hop at a time under the shared loop
  would leave one implementation.
- **Back without a synthetic Escape** — the back button closes a Base UI
  popup by dispatching Escape at the focused element ([D68](#D68)), so a
  control inside one that takes Escape for itself (a field that clears, a
  list that closes its own popup) and marks it used makes back close
  nothing, though the dialog stays open. A stack of what is open, closed by
  the UI itself, would not depend on what has focus; it comes if such a
  control is reported.
- **Unreadable credentials told by the plugin's message** —
  `@aparajita/capacitor-secure-storage` says ciphertext sealed under
  another key only as an `osError` whose message names
  `AEADBadTagException` ([D64](#D64)); `keystoreSecrets` matches that text,
  so a plugin that words it otherwise makes such credentials an error
  instead of a sign-in. A code of its own for it, upstream, would end the
  match.
- **A reminder Android did not fire** — an alarm whose time passed is taken
  as fired; after a force-stop (which clears the app's alarms), one due in
  the 5 minutes before the app opens again is not shown late. Telling a
  fired alarm from a cleared one needs the plugin's delivered list
  ([D66](#D66)).

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

_As built:_ `SecretStore` and `syncAll` had come with foundation's PR 5a-3,
and `ReminderScheduler` comes with foundation's PR 6 ([D60](#D60)); A1 adds
`signingInTo`. The message for an older WebView moved to A2 ([D61](#D61)).

Done when: the debug APK from CI installs on a phone or an emulator, signs
in to a Radicale or a Nextcloud by password, and shows its items from the
local store after a restart without a network; the plugin's Gradle tests
pass in CI; `navigator.storage.persist()`'s answer in the WebView is
recorded in the PR, and so is whether a second WebView of the app sees the
same OPFS files, the first one's Web Lock and its `BroadcastChannel`s
(D67 depends on all three). Screenshots in both themes are the evidence.

### PR A2 — Credentials, Login Flow v2, the shell's manners

The Keystore-backed `SecretStore`, Login Flow v2 in a Custom Tab, the back
button, the theme and edge to edge, the message for an older WebView
(moved here from A1). Decisions: D61 (that message), D64, D65, D68.

Done when: credentials survive a restart and are unreadable in the app's
data without the Keystore; a Nextcloud account is added through Login
Flow v2 on a phone; back closes the drawer, then leaves the app; the top
bar and the floating button clear the status and navigation bars in both
themes (screenshots); a WebView older than Chromium 123 says to update it.

_As built:_ the platform gained `onBack` ([D60](#D60)); the app's own
`AstroTimeShell` plugin styles the bars ([D68](#D68)); Login Flow v2 ends
when the user comes back, since Android freezes the app behind the Custom
Tab ([D65](#D65)). Also from A1's review: a refused certificate is worded
at sign-in ([D62](#D62)), and `signingInTo`'s bookkeeping (`SigningIn`) is
unit-tested. Checked on an Android 16 emulator with a disposable Nextcloud
31, the WebView driven over CDP by role.

### PR A3 — Reminders

Local notifications from the shared reminder set, exact alarms, the
notification permission, opening the item from a tap. It needs foundation's
PR 6, which computes the set ([D60](#D60)); A1 and A2 do not. Decisions:
D66.

Done when: a reminder fires on time with the app closed and after a
reboot; editing or deleting the item on the server moves or removes it
after the next sync; unit tests cover the set's diff and the ids (no two
reminders share an integer id).

_As built:_ `ReminderScheduler` gained optional members for a platform that
asks by itself and whose permission is the system's ([D60](#D60)); a
reminder past shows within 5 minutes when it first reaches Android, and the
boot receiver's catch-up is the plugin's ([D66](#D66)). Until A4 the set
reaches 7 days from the app's last run. Checked on an Android 16 emulator
against a local Radicale, the WebView driven over CDP.

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
