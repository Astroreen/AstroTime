# Desktop plan

Status: **planned** — decided, not yet built; it starts after the Android
app ([`android.md`](android.md)), as foundation's [D12](foundation.md#D12)
orders the platforms. This plan owns the Linux desktop app, `apps/desktop`
(foundation's [D22](foundation.md#D22), [D23](foundation.md#D23)). The
platform interfaces it implements are named once, in
[android.md D60](android.md#D60).

## Goal

AstroTime on a Linux desktop: the same React UI as the web app, in an
Electron shell. It talks to CalDAV servers from the main process (no proxy,
no CORS), keeps credentials in the system keyring, keeps syncing and firing
reminders while its window is closed, and installs as an AppImage or a deb
from the GitHub Release of a `v*` tag ([D28](foundation.md#D28)). Windows
stays a by-product, checked last ([D12](foundation.md#D12)).

## Decisions

Numbered on from the Android plan; D70–D79 belong to this plan. Versions
were checked on 2026-11-01.

### The shell

- **D70. `apps/desktop`, on the Electron major nixpkgs ships.**
  `@astrotime/desktop` has three parts, each bundled by Vite: the main
  process (`src/main/`), a preload script (`src/preload/`), and the
  renderer, which is the shared UI (`@astrotime/ui`) with the desktop's
  adapters ([D60](android.md#D60)), as `apps/mobile` wraps it. The app id is
  `io.github.astroreen.astrotime`, the same as Android's
  ([D61](android.md#D61)); it names the `.desktop` file and
  `app.setDesktopName`, since xdg-desktop-portal refuses app ids it does not
  know. Electron's latest is 45 (Node 24.22, Chromium 156), but nixpkgs
  ships 44 at most, and the dev shell runs Electron from nixpkgs
  ([D79](#D79)); so the app uses the newest major nixpkgs has (44 today,
  supported until Electron 47 is out) and moves with it, CI included, so a
  developer and CI run the same Electron. Everything this plan needs exists
  in 44 (the asynchronous `safeStorage`, `utilityProcess`, `net`).

- **D71. A sandboxed renderer with a narrow preload.** The renderer runs
  with `contextIsolation`, `sandbox` and `webSecurity` on and no Node
  integration (Electron's security checklist). Pages load from a
  privileged `app://astrotime/` scheme served by `protocol.handle` out of
  the app's asar, not from `file://`. The preload exposes one object through
  `contextBridge`, with exactly what the adapters need: `http(request)`
  ([D72](#D72)), `secrets` ([D74](#D74)),
  `reminders.schedule` ([D76](#D76)), `openExternal` for an `http(s)` URL
  ([D77](#D77)), and an event for sync requests ([D75](#D75)); each IPC
  handler checks its arguments and that the sender is the app's own page.
  The store's `MessagePort` ([D73](#D73)) cannot cross `contextBridge`: the
  main process sends it to the preload (`webContents.postMessage`), which
  passes it to the page with `window.postMessage` to the app's own origin.
  The page then holds a port that runs SQL, as the web app holds its
  worker: the utility process answers only the store protocol's messages,
  and nothing but the app's own page, under the CSP, runs there.
  The CSP is `default-src 'self'` with `connect-src 'self'`, `object-src
  'none'`, `base-uri 'none'`: the renderer reaches no network itself, every
  request goes through the main process. Navigation away from `app://` and
  new windows are refused (links open in the system browser), permission
  requests are denied, and the fuses are set at packaging: `RunAsNode`,
  `EnableNodeOptionsEnvironmentVariable`, `EnableNodeCliInspectArguments`
  and `GrantFileProtocolExtraPrivileges` off, `EnableCookieEncryption` and
  `OnlyLoadAppFromAsar` on (`EnableEmbeddedAsarIntegrityValidation` does
  nothing on Linux).

### Platform adapters

- **D72. HTTP from the main process, on `net.request`.** The renderer's
  `HttpClient` sends each request over IPC to the main process, which makes
  it with Electron's `net.request`: Chromium's network stack, so the
  system's proxy settings and certificate store apply, as in a browser.
  Not yet proven: that a self-hosted Nextcloud with its own CA works once
  the system trusts it (Chromium on Linux reads NSS's database); PR D1
  checks it.
  Any method and header passes (`PROPFIND`, `REPORT`, `MKCALENDAR`). The
  request uses `redirect: "manual"` and the adapter follows redirects
  itself, up to 10, so it knows the URL that answered (the `HttpResponse`
  contract) and drops `Authorization` when a redirect leaves the origin, as
  `fetch` does. It runs in an in-memory session of its own with
  `credentials: "omit"`: no cookies are kept or sent, and no login dialog
  appears. Rejected: `net.fetch`, whose `Response.url` is documented as
  wrong (empty); Node's `fetch`, which uses Node's CA store and ignores the
  system proxy; and the renderer's own `fetch` with CORS headers rewritten
  through `webRequest`, which switches off the same-origin policy for the
  page.

- **D73. The store in a utility process.** `node:sqlite` ([D25](foundation.md#D25))
  runs in an Electron `utilityProcess` that owns the database file
  (`astrotime.sqlite3` in `userData`). The main process hands the renderer
  a `MessagePort` to it at start, through the preload ([D71](#D71)), and the renderer's `SqlDriver` speaks the
  web worker's messages (`packages/storage/src/web/protocol.ts`) over that
  port, so the web's driver serves both with the port as its only
  difference. `DatabaseSync` is synchronous: in the main process a long
  write (a first sync of a large calendar) would freeze every window and
  every IPC call; in the utility process it blocks only itself. The
  renderer cannot open files (sandbox, [D71](#D71)). That `node:sqlite`
  loads in a utility process on Electron 44 is not yet proven; PR D1 proves
  it first, and the fallback is the main process behind the same port.

- **D74. Credentials through `safeStorage`, and said so when unprotected.**
  Passwords (app passwords included) are encrypted with the asynchronous
  `safeStorage` API (`encryptStringAsync`; the synchronous one is
  deprecated in Electron 45 and removed in 46), whose key lives in the
  desktop's keyring (GNOME's libsecret, KWallet, or the Secret portal), and
  kept in `userData/secrets.json`, one entry per account; never in the
  store ([D36](foundation.md#D36)). A value the API asks to re-encrypt
  (`shouldReEncrypt`) is written again. Where no keyring exists,
  `getSelectedStorageBackend()` is `basic_text`: the "encryption" uses a
  fixed key and protects nothing. Then the app says so before saving and
  asks: keep the password until the app quits, or save it unprotected in
  the profile. Nothing is written before the user picks. Each entry
  records how it was saved, so one saved unprotected is never taken for
  ciphertext when a keyring appears later. An entry that does not decrypt
  (a changed keyring, a profile copied to another machine) leaves its
  account asking to sign in again, never a crash or an empty account.

### Behaviour

- **D75. One instance, alive with its window closed.** A second launch
  focuses the running window (`requestSingleInstanceLock`). Closing the
  window hides it; the app keeps running so it syncs and fires reminders,
  with a tray icon (Open, Sync now, Quit) where the desktop shows one
  (StatusNotifierItem; GNOME needs an extension for it). Without a tray,
  launching the app again opens the window, and Quit stays in the app's
  menu. A setting in the drawer, on the desktop only, turns this off:
  closing the window then quits. Syncs run on the shared UI's triggers
  (the same as the web's) and, from the main process, every 15 minutes while
  the app runs and after the machine resumes (`powerMonitor`); the main
  process asks the renderer, which runs the shared sync entry
  ([D60](android.md#D60)), so a timer in a hidden window's throttled
  renderer is never relied on. The theme setting (design
  [D53](design.md#D53)) sets `nativeTheme.themeSource`, so the window's
  frame follows it; whether `prefers-color-scheme` follows the desktop's
  dark setting through the portal on GNOME and KDE is checked in PR D3.
  Electron runs natively on Wayland by default since 38.

- **D76. Reminders from the main process.** Electron has no scheduled
  notifications, so the main process keeps the set of reminders the shared
  code hands over (`ReminderScheduler.schedule`, [D60](android.md#D60)),
  arms a timer for the next one, and shows it as a desktop notification
  (libnotify, the freedesktop spec); a click opens the window on the item.
  Timers drift while the machine sleeps, so the set is checked again on
  resume and on unlock: a reminder missed while asleep fires late, up to an
  hour, saying when it was due; an older one is dropped. Reminders do not
  fire while the app is not running, as in a browser; closing the window
  does not stop them ([D75](#D75)).

- **D77. Login Flow v2 in the system browser.** The login page opens with
  `shell.openExternal`, where the user's password manager and second factor
  already are, and the app polls the flow through its `HttpClient`, as on
  Android ([D65](android.md#D65)). Nextcloud's flow has no callback, so no
  URL scheme is registered. Rejected: a login page in an Electron window,
  which would see the user's password.

### Build and release

- **D78. electron-builder: AppImage and deb, x64 and arm64.** The
  main process, preload and renderer are bundled by Vite into files with no
  runtime `node_modules` (`node:sqlite` is built in, nothing native to
  rebuild), so electron-builder (26.x) packages plain files and pnpm's
  layout never matters. Targets: AppImage (runs on any distribution, no
  install) and deb (Debian, Ubuntu), each for x64 and arm64; Windows NSIS
  joins from the same config if Windows is ever checked ([D12](foundation.md#D12)).
  Rejected: Electron Forge 8, whose Vite plugin is still experimental and
  which needs pnpm's hoisted layout. Auto-update is deferred.

- **D79. CI, release and the dev shell.** CI builds the desktop app on
  every PR (`electron-builder --linux --dir`, a quick unpacked build) and
  runs one smoke test with Playwright's Electron support under `xvfb-run`:
  the app starts, the window shows the UI, the store opens in the utility
  process and a password account syncs against the local Radicale
  ([D27](foundation.md#D27)). Playwright's Electron support is experimental;
  one smoke test is all that leans on it, and the adapters' logic
  (redirects, IPC argument checks, the reminder timer) is unit-tested in
  Node without Electron. A `v*` tag builds the AppImage and deb for x64 on
  `ubuntu-latest` and for arm64 on `ubuntu-24.04-arm` (free for public
  repositories, so no emulation) and uploads them with `gh release upload`
  to the tag's Release, which the release workflow's first job creates for
  both platforms, as [android D69](android.md#D69) gives it; the desktop
  job `needs` that job, so it never races the Android one.
  On NixOS the dev shell sets `ELECTRON_SKIP_BINARY_DOWNLOAD=1` and points
  `ELECTRON_OVERRIDE_DIST_PATH` at nixpkgs' Electron of the same major
  ([D70](#D70)), since Electron's downloaded binary does not run there.
  Packaging is CI's job: AppImage tooling is not run in the dev shell.

## Deferred

- **Auto-update** — electron-updater can update an AppImage (and a deb
  through `pkexec`); it needs signed update metadata and a decision on
  prompting ([D78](#D78)).
- **Start at login** — an XDG autostart entry, so reminders fire after a
  reboot without opening the app ([D75](#D75), [D76](#D76)).
- **Reminders while the app is not running** — a systemd user timer or a
  small resident helper ([D76](#D76)).
- **Other packages** — Flatpak (Flathub), rpm, AUR, Snap ([D78](#D78)).
- **Windows** — NSIS from the same config, checked last if at all
  ([D12](foundation.md#D12)).
- **Untrusted certificates** — a server whose certificate the system does
  not trust fails like an unreachable one; a dialog to trust it for that
  account comes later ([D72](#D72)).
- **Notification actions** — snooze and "mark as done" on a reminder
  ([D76](#D76)).
- **Moving to Electron 45 and later** — waits for nixpkgs ([D70](#D70)).

## PR plan

Each PR names the decisions it implements and attaches its evidence
(AGENTS.md).

### PR D1 — The shell, the store and HTTP

`apps/desktop`: the main process, preload and the `app://` scheme with the
security settings; the store in a utility process; HTTP through
`net.request`; the shared UI with the desktop's adapters; signing in with a
password (credentials held in memory until PR D2). The dev shell's Electron.
CI's desktop build and smoke test. Decisions: D70, D71, D72, D73, D79 (CI
half).

Done when: `node:sqlite` is shown to run in the utility process, and the
page receives its port through the preload as D71 describes; the app
starts in the dev shell, signs in to the local Radicale and shows its items
from the local store; a redirect test proves the final URL and the dropped
`Authorization` (another host, scheme or port); a server with a private CA
the system trusts is reached, or the gap goes to Deferred with "Untrusted
certificates"; the smoke test passes in CI. Screenshots of the window in
both themes are the evidence.

### PR D2 — Credentials and Login Flow v2

`safeStorage` with the unprotected-keyring prompt, Nextcloud's Login Flow v2
in the system browser. Decisions: D74, D77.

Done when: credentials survive a restart with a keyring; without one
(`--password-store=basic` forces it) the prompt appears and nothing is
written before the choice; an entry that does not decrypt asks to sign in
again; the login page opens in the system browser and
the poll stops once approved (up to Nextcloud's approval page in tests,
foundation's Deferred "Login Flow v2 end to end").

### PR D3 — Living in the background

Single instance, closing to the background with the tray and its setting,
the sync timer and resume, the theme, reminders from the main process.
Decisions: D75, D76.

Done when: a second launch focuses the first; with the window closed a
change made on the server arrives within one timer period and a reminder
fires (unit tests drive the timer with a fake clock, never a wait); a
reminder missed during a suspend fires on resume; the window frame follows
the theme setting.

### PR D4 — Packages and release

electron-builder's AppImage and deb for x64 and arm64, the fuses, and the
release job. Decisions: D78, D79 (release half), foundation's D28.

Done when: a `v*` tag (a prerelease tag on a fork is enough) attaches the
four files to its Release; the AppImage starts on a stock Ubuntu runner and
the deb installs there and starts; the fuses read back as set
(`npx @electron/fuses read`).
