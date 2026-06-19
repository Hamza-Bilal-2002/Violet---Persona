// Persona desktop shell — entry point.
//
// Stays small on purpose. Concrete responsibilities live in
// sibling modules:
//   config.js  — agent identity, paths, IS_DEV flag
//   window.js  — BrowserWindow lifecycle, click-through default
//   tray.js    — tray icon + context menu
//   ipc.js     — ipcMain message handlers
//
// This file owns:
//   - pre-ready switches that must run before app.whenReady
//   - the whenReady wiring that brings the four modules online
//   - the OS lifecycle conventions (window-all-closed, activate)

const { app, BrowserWindow } = require('electron');
const path = require('path');

const { createWindow } = require('./window');
const { createTray } = require('./tray');
const { registerIpcHandlers } = require('./ipc');
const {
  registerGlobalShortcuts,
  unregisterAllGlobalShortcuts,
} = require('./globalShortcut');
const { startBackendContainers } = require('./dockerCompose');
const spotify = require('./spotify');

// ----------------------------------------------------------------------
// Pre-ready switches.
//
// Electron's native-occlusion calculation on Windows can flip
// transparent windows to a black fill when another window covers
// them. Disabling the feature BEFORE app-ready keeps the overlay
// clean.
// ----------------------------------------------------------------------

app.commandLine.appendSwitch(
  'disable-features',
  'CalculateNativeWinOcclusion'
);

// ── Spotify: single-instance lock + custom protocol ───────────────────────────
//
// requestSingleInstanceLock() ensures only one Electron process runs.
// When the OS routes violet://callback back to the app after Spotify login,
// Windows launches a second instance — that instance immediately hands the
// URL to the already-running one via the 'second-instance' event, then quits.

const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  // We are the second instance — forward the URL and exit immediately.
  app.quit();
}

app.on('second-instance', (_event, commandLine) => {
  const url = commandLine.find((arg) => arg.startsWith('violet://'));
  if (url) {
    spotify.handleCallback(url);
  }
});

// Register violet:// as the custom protocol for this executable.
// In dev mode (process.defaultApp truthy) Electron needs the script
// path passed as an extra arg so Windows registers the right command.

if (process.defaultApp) {
  app.setAsDefaultProtocolClient(
    'violet',
    process.execPath,
    [path.resolve(process.argv[1])]
  );
} else {
  app.setAsDefaultProtocolClient('violet');
}

// Also handle the case where the app was launched directly via the
// violet:// URL (first launch after Spotify redirects).

const initialUrl = process.argv.find((arg) => arg.startsWith('violet://'));
if (initialUrl) {
  app.whenReady().then(() => spotify.handleCallback(initialUrl));
}

// ----------------------------------------------------------------------
// Wiring.
// ----------------------------------------------------------------------

app.whenReady().then(() => {

  // Load any saved Spotify tokens from the previous session so the
  // user doesn't have to re-authenticate every time.

  spotify.loadTokens();

  // Bring up the backend stack first, fire-and-forget. The renderer's
  // BackendClient + WakeWordClient have their own reconnect logic, so
  // they'll find the services whenever they come online.

  startBackendContainers();

  createWindow();
  createTray();
  registerIpcHandlers();
  registerGlobalShortcuts();

});

// Drop OS-level shortcut bindings before the process exits so we
// don't leak the Ctrl+Alt+V hook into the user's session.

app.on(
  'will-quit',
  () => {

    unregisterAllGlobalShortcuts();

  }
);

// Background process: do NOT quit when the window closes. Only the
// tray "Quit" item terminates Persona.

app.on(
  'window-all-closed',
  () => {
    // Intentionally empty on Windows. Kept for macOS portability.
  }
);

// Standard macOS-style activate handler. Not exercised on Windows
// but keeps the shell portable.

app.on(
  'activate',
  () => {

    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }

  }
);
