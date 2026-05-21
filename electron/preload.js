// Persona desktop shell — preload bridge.
//
// Runs in an isolated context between the Electron main process and the
// Vite-served renderer. Exposes a small, explicit API on
// `window.personaShell` so the frontend can detect that it's running in
// Electron and request narrowly-scoped shell actions.
//
// IMPORTANT: keep this surface minimal. Anything exposed here becomes a
// permanent contract with the renderer.

const {
  contextBridge,
  ipcRenderer,
}
  = require('electron');

contextBridge.exposeInMainWorld(
  'personaShell',
  {

    // Marker the renderer can use to switch on Electron-only behavior
    // (e.g., enabling -webkit-app-region styles).

    isElectron: true,

    // Hide the window without quitting. Sends a fire-and-forget IPC
    // message; main process handles the actual BrowserWindow.hide().

    hide: () => {

      ipcRenderer.send('persona:hide');

    },

  }
);
