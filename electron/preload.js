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

    // Tell the main process the renderer is done loading and the
    // window can now be shown. Called once by AvatarRuntime after
    // the VRM + animations are ready. Prevents the user from ever
    // seeing the loading screen.

    ready: () => {

      ipcRenderer.send('persona:ready');

    },

    // Subscribe the renderer to debug-GUI toggle messages sent
    // from the tray menu. The callback receives a boolean — true
    // when the user wants the lil-gui visible, false to hide.
    // The renderer is expected to register exactly one listener
    // (during RuntimeController setup); calling this multiple
    // times is unsupported and would stack subscriptions.

    onToggleDebugGui: (callback) => {

      ipcRenderer.on(
        'persona:toggle-debug-gui',
        (_event, visible) => {

          callback(visible);

        }
      );

    },

  }
);
