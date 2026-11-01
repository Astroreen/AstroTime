// The preload (docs/plans/desktop.md#D71): it runs sandboxed, isolated from
// the page, and exposes one object through contextBridge. The store's
// MessagePort cannot cross contextBridge: the main process sends it here, and
// it goes on to the page as a window message to the app's own origin (D73).
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

import { CHANNELS, NOTIFICATIONS_ARGUMENT, STORE_PORT, type Bridge } from "../bridge.ts";

/** Calls `listener` with what the main process sends on `channel`; returns the function that stops it. */
function listen<T extends unknown[]>(channel: string, listener: (...args: T) => void): () => void {
  const receive = (_event: IpcRendererEvent, ...args: unknown[]) => listener(...(args as T));
  ipcRenderer.on(channel, receive);
  return () => void ipcRenderer.off(channel, receive);
}

const bridge: Bridge = {
  http: (request) => ipcRenderer.invoke(CHANNELS.http, request),
  secrets: {
    get: (key) => ipcRenderer.invoke(CHANNELS.secretsGet, key),
    set: (key, value, saving) => ipcRenderer.invoke(CHANNELS.secretsSet, key, value, saving),
    delete: (key) => ipcRenderer.invoke(CHANNELS.secretsDelete, key),
  },
  openExternal: (url) => ipcRenderer.send(CHANNELS.openExternal, url),
  connectStore: () => ipcRenderer.send(CHANNELS.store),
  reminders: {
    supported: process.argv.includes(NOTIFICATIONS_ARGUMENT),
    schedule: (reminders) => ipcRenderer.send(CHANNELS.reminders, reminders),
    onOpen: (listener) => listen(CHANNELS.reminderOpened, listener),
  },
  shell: (state) => ipcRenderer.send(CHANNELS.shell, state),
  onSyncRequest: (listener) =>
    listen<[unknown]>(CHANNELS.sync, (byUser) => listener(byUser === true)),
};

contextBridge.exposeInMainWorld("astrotime", bridge);

ipcRenderer.on(CHANNELS.store, (event) => {
  window.postMessage(STORE_PORT, location.origin, event.ports);
});
