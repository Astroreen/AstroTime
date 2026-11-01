// The preload (docs/plans/desktop.md#D71): it runs sandboxed, isolated from
// the page, and exposes one object through contextBridge. The store's
// MessagePort cannot cross contextBridge: the main process sends it here, and
// it goes on to the page as a window message to the app's own origin (D73).
import { contextBridge, ipcRenderer } from "electron";

import { CHANNELS, STORE_PORT, type Bridge } from "../bridge.ts";

const bridge: Bridge = {
  http: (request) => ipcRenderer.invoke(CHANNELS.http, request),
  secrets: {
    get: (key) => ipcRenderer.invoke(CHANNELS.secretsGet, key),
    set: (key, value, saving) => ipcRenderer.invoke(CHANNELS.secretsSet, key, value, saving),
    delete: (key) => ipcRenderer.invoke(CHANNELS.secretsDelete, key),
  },
  openExternal: (url) => ipcRenderer.send(CHANNELS.openExternal, url),
  connectStore: () => ipcRenderer.send(CHANNELS.store),
};

contextBridge.exposeInMainWorld("astrotime", bridge);

ipcRenderer.on(CHANNELS.store, (event) => {
  window.postMessage(STORE_PORT, location.origin, event.ports);
});
