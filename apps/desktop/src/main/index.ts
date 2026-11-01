// The desktop app's main process (docs/plans/desktop.md): the window and its
// security settings (D71), the app:// scheme, HTTP from here (D72), the
// store in a utility process (D73), credentials through safeStorage (D74),
// one instance that lives on with its window closed, with its tray, its sync
// triggers and its theme (D75), and the reminders' notifications (D76).
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { OfflineError } from "@astrotime/core";
import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  Notification,
  powerMonitor,
  protocol,
  safeStorage,
  session,
  shell,
  Tray,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type MenuItemConstructorOptions,
} from "electron";

import icon from "../../resources/icon.png?inline";
import {
  APP_SCHEME,
  APP_URL,
  CHANNELS,
  NOTIFICATIONS_ARGUMENT,
  type HttpAnswer,
  type ShellState,
} from "../bridge.ts";
import { appFiles } from "./app-protocol.ts";
import { backgroundTriggers } from "./background.ts";
import {
  checkReminders,
  checkRequest,
  checkSecret,
  checkSecretKey,
  checkShellState,
  isAppUrl,
  isWebUrl,
} from "./checks.ts";
import { netClient } from "./http.ts";
import { mainReminders } from "./reminders.ts";
import { secretsFile } from "./secrets.ts";
import { storeProcess } from "./store.ts";

/** The app id (D70): it names the .desktop file, which xdg-desktop-portal needs to know the app. */
const APP_ID = "io.github.astroreen.astrotime";

const here = fileURLToPath(new URL(".", import.meta.url));
const files = {
  preload: join(here, "../preload/index.cjs"),
  store: join(here, "store.js"),
  renderer: join(here, "../renderer"),
};

// A standard, secure scheme: the page has an origin, a secure context and
// its own storage, as on https.
protocol.registerSchemesAsPrivileged([
  { scheme: APP_SCHEME, privileges: { standard: true, secure: true, codeCache: true } },
]);
app.enableSandbox();
app.setDesktopName(`${APP_ID}.desktop`);

let window: BrowserWindow | undefined;
/** The app is quitting (the tray, the menu, the session ending): closing the window no longer hides it. */
let quitting = false;
/** What the page's settings asked last (D75); until it says, closing the window keeps the app running. */
let state: ShellState | undefined;
let tray: Tray | undefined;
/** The app's icon, for the tray and the notifications. */
const appIcon = () => nativeImage.createFromDataURL(icon);
/** Notifications on the screen, kept so their clicks are heard (D76). */
const shown = new Set<Notification>();
/** The longest `setTimeout` Node keeps (about 24.8 days); a longer wait is armed again. */
const MAX_TIMEOUT_MS = 2_147_483_647;

/**
 * Whether this desktop shows no tray icons: GNOME's shell has none without an
 * extension. `ASTROTIME_TRAY=1` says there is one (an extension), `=0` none.
 */
function trayless(): boolean {
  const said = process.env["ASTROTIME_TRAY"];
  if (said !== undefined) return said === "0";
  return /gnome/i.test(process.env["XDG_CURRENT_DESKTOP"] ?? "");
}

/** Brings the window to the front, from the tray, a second launch or a notification. */
function showWindow() {
  if (!window) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

/**
 * Asks the page for a sync: the main process's triggers and the tray's
 * "Sync now" (D75), which is the user's own (`byUser`, foundation D128).
 */
const requestSync = (byUser = false) => window?.webContents.send(CHANNELS.sync, byUser);

/** Applies the page's settings: the frame's theme, the tray and the menu in the user's words. */
function applyShell(next: ShellState) {
  state = next;
  nativeTheme.themeSource = next.theme;
  const { words } = next;
  const quit: MenuItemConstructorOptions = { label: words.quit, click: () => app.quit() };
  const syncNow: MenuItemConstructorOptions = {
    label: words.syncNow,
    click: () => requestSync(true),
  };
  // Where the desktop shows no tray, Quit stays in the window's menu (Alt shows it).
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: "AstroTime",
        submenu: [
          syncNow,
          { type: "separator" },
          { label: words.closeWindow, accelerator: "CmdOrCtrl+W", click: () => window?.close() },
          { ...quit, accelerator: "CmdOrCtrl+Q" },
        ],
      },
    ]),
  );
  // A StatusNotifierItem where the desktop has a host for it (GNOME with an extension).
  tray ??= new Tray(appIcon());
  tray.setToolTip("AstroTime");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: words.open, click: showWindow },
      syncNow,
      { type: "separator" },
      quit,
    ]),
  );
}

/** Whether an IPC message comes from the app's own page in its window, nothing else. */
function fromApp(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
  const frame = event.senderFrame;
  return (
    window !== undefined &&
    event.sender === window.webContents &&
    frame !== null &&
    frame === window.webContents.mainFrame &&
    isAppUrl(frame.url)
  );
}

/**
 * Handles a message the page sent without awaiting an answer: one its checks
 * refuse has no caller to throw to, so it is logged instead of escaping the
 * listener.
 */
function refusing(handle: () => void) {
  try {
    handle();
  } catch (error) {
    console.error("Refused a message from the page:", error);
  }
}

const openInBrowser = (url: string) => {
  if (isWebUrl(url)) void shell.openExternal(url);
};

// Every page stays on app://; links open in the system browser, and nothing
// opens a window or a webview of its own.
app.on("web-contents-created", (_event, contents) => {
  contents.on("will-navigate", (event) => {
    if (isAppUrl(event.url)) return;
    event.preventDefault();
    openInBrowser(event.url);
  });
  // A redirect or a frame's navigation stays inside the app too.
  contents.on("will-redirect", (event) => {
    if (!isAppUrl(event.url)) event.preventDefault();
  });
  contents.on("will-frame-navigate", (event) => {
    if (!isAppUrl(event.url)) event.preventDefault();
  });
  contents.setWindowOpenHandler(({ url }) => {
    openInBrowser(url);
    return { action: "deny" };
  });
  contents.on("will-attach-webview", (event) => event.preventDefault());
});

async function start() {
  await app.whenReady();
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, grant) =>
    grant(false),
  );
  session.defaultSession.setPermissionCheckHandler(() => false);
  protocol.handle(APP_SCHEME, appFiles(files.renderer));

  const store = storeProcess(
    files.store,
    join(app.getPath("userData"), "astrotime.sqlite3"),
    // A page whose store went reads again on a new port.
    () => window?.webContents.reload(),
  );
  app.on("will-quit", (event) => {
    event.preventDefault();
    void store.close().then(() => app.exit());
  });

  // An in-memory session of its own: no cookie is kept between runs.
  const http = netClient(session.fromPartition("astrotime-http"));
  ipcMain.handle(CHANNELS.http, async (event, value: unknown): Promise<HttpAnswer> => {
    if (!fromApp(event)) throw new Error("Not the app's page.");
    try {
      const { status, url, headers, body } = await http(checkRequest(value));
      return { status, url, headers, body };
    } catch (error) {
      if (error instanceof OfflineError) return { offline: error.message };
      throw error;
    }
  });
  const secrets = secretsFile({
    path: join(app.getPath("userData"), "secrets.json"),
    encryption: safeStorage,
    linux: process.platform === "linux",
  });
  ipcMain.handle(CHANNELS.secretsGet, (event, key: unknown) => {
    if (!fromApp(event)) throw new Error("Not the app's page.");
    return secrets.get(checkSecretKey(key));
  });
  ipcMain.handle(CHANNELS.secretsSet, (event, key: unknown, value: unknown, saving: unknown) => {
    if (!fromApp(event)) throw new Error("Not the app's page.");
    return secrets.set(checkSecretKey(key), ...checkSecret(value, saving));
  });
  ipcMain.handle(CHANNELS.secretsDelete, (event, key: unknown) => {
    if (!fromApp(event)) throw new Error("Not the app's page.");
    return secrets.delete(checkSecretKey(key));
  });
  ipcMain.on(CHANNELS.store, (event) => {
    if (fromApp(event)) event.sender.postMessage(CHANNELS.store, null, [store.connect()]);
  });
  ipcMain.on(CHANNELS.openExternal, (event, url: unknown) => {
    if (fromApp(event) && typeof url === "string") openInBrowser(url);
  });

  // The reminders' notifications, the window closed or not (D76).
  const notificationIcon = appIcon();
  const reminders = mainReminders({
    clock: {
      now: () => Date.now(),
      after(ms, run) {
        const timer = setTimeout(run, Math.min(ms, MAX_TIMEOUT_MS));
        return () => clearTimeout(timer);
      },
    },
    show({ title, body }, click) {
      const notification = new Notification({ title, body, icon: notificationIcon });
      shown.add(notification);
      notification.on("click", () => {
        shown.delete(notification);
        click();
      });
      notification.on("close", () => shown.delete(notification));
      notification.show();
    },
    open(reminder) {
      showWindow();
      window?.webContents.send(CHANNELS.reminderOpened, reminder);
    },
  });
  ipcMain.on(CHANNELS.reminders, (event, value: unknown) => {
    if (fromApp(event)) refusing(() => reminders.schedule(checkReminders(value)));
  });
  ipcMain.on(CHANNELS.shell, (event, value: unknown) => {
    if (fromApp(event)) refusing(() => applyShell(checkShellState(value)));
  });
  // Syncs every 15 minutes and on resume, reminders checked on waking (D75, D76).
  backgroundTriggers({
    every: (ms, run) => setInterval(run, ms),
    power: powerMonitor,
    sync: () => requestSync(),
    wake: () => reminders.wake(),
  });

  window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 360,
    minHeight: 480,
    title: "AstroTime",
    show: false,
    autoHideMenuBar: true,
    // The canvas's colour (packages/ui/src/styles.css), so the window opens without a flash.
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#1b1d23" : "#eef0f4",
    webPreferences: {
      preload: files.preload,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      // The hidden window's page syncs on the main process's requests (D75):
      // its timers (the sync's debounce, the store's work) must not be
      // throttled to once a minute while it is hidden.
      backgroundThrottling: false,
      // The page learns whether the system shows notifications (D76).
      additionalArguments: Notification.isSupported() ? [NOTIFICATIONS_ARGUMENT] : [],
    },
  });
  window.once("ready-to-show", () => window?.show());
  // Closing the window hides it and the app keeps running, unless the
  // settings say to quit (D75); quitting closes it for good.
  window.on("close", (event) => {
    if (quitting || state?.keepRunning === false) return;
    event.preventDefault();
    // Where the desktop shows no tray (GNOME without an extension), a hidden
    // window could not be found again: it is minimized there instead.
    // Hidden only where a tray was made to bring it back.
    if (trayless() || !tray) window?.minimize();
    else window?.hide();
  });
  window.on("closed", () => (window = undefined));
  await window.loadURL(APP_URL);
}

app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => (quitting = true));

// One instance (D75): a second launch hands over to the first, which shows its window.
if (app.requestSingleInstanceLock()) {
  app.on("second-instance", showWindow);
  start().catch((error: unknown) => {
    console.error(error);
    app.exit(1);
  });
} else {
  app.quit();
}
