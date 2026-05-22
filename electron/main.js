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

const { createWindow } = require('./window');
const { createTray } = require('./tray');
const { registerIpcHandlers } = require('./ipc');
const {
  registerGlobalShortcuts,
  unregisterAllGlobalShortcuts,
} = require('./globalShortcut');

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

// ----------------------------------------------------------------------
// Wiring.
// ----------------------------------------------------------------------

app.whenReady().then(() => {

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
