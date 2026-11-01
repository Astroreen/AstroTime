// The desktop app's main process (docs/plans/desktop.md): the window and its
// security settings (D71), the app:// scheme, HTTP from here (D72), and the
// store in a utility process (D73).
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { OfflineError } from "@astrotime/core";
import {
  app,
  BrowserWindow,
  ipcMain,
  nativeTheme,
  protocol,
  session,
  shell,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
} from "electron";

import { APP_SCHEME, APP_URL, CHANNELS, type HttpAnswer } from "../bridge.ts";
import { appFiles } from "./app-protocol.ts";
import { checkRequest, isAppUrl, isWebUrl } from "./checks.ts";
import { netClient } from "./http.ts";
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
  ipcMain.on(CHANNELS.store, (event) => {
    if (fromApp(event)) event.sender.postMessage(CHANNELS.store, null, [store.connect()]);
  });
  ipcMain.on(CHANNELS.openExternal, (event, url: unknown) => {
    if (fromApp(event) && typeof url === "string") openInBrowser(url);
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
    },
  });
  window.once("ready-to-show", () => window?.show());
  window.on("closed", () => (window = undefined));
  await window.loadURL(APP_URL);
}

app.on("window-all-closed", () => app.quit());

start().catch((error: unknown) => {
  console.error(error);
  app.exit(1);
});
