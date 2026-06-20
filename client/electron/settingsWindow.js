// Persona desktop shell — Settings window (the preferences hub).
//
// One dark-glass window holding every tunable preference: behavior
// toggles (+ their startup defaults), avatar tuning, service connectivity,
// memory, the offline-mode cloud provider/keys, and system shortcuts.
//
// The tray stays lean; this is where settings live. All renderer ->
// main IPC for the window is registered here once at module load. Calls
// into tray.js are lazily required to avoid a require cycle (tray.js
// requires this module for createSettingsWindow).

'use strict';

const { BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');

const { loadSettings, saveSettings } = require('./userSettings');
const { createMemoryWindow } = require('./memoryWindow');
const { getMainWindow } = require('./window');
const whatsapp = require('./tools/whatsapp');
const spotify  = require('./spotify');

// Backend api base — matches the other shell modules' hardcoded localhost.
const API_BASE = 'http://localhost:8000';

let _win = null;

// Latest avatar-tuning snapshot pushed up by the renderer. The Settings
// window reads this to open its sliders at the right positions. We also
// mirror each change into it so reopening the window stays accurate.
let _tuneSnapshot = null;

function _tray() {
  // Lazy require breaks the tray <-> settingsWindow cycle.
  return require('./tray');
}

function _connectivity() {
  return {
    whatsapp: whatsapp.getStatus(),
    spotify:  spotify.isAuthenticated() ? 'connected' : 'disconnected',
  };
}

// ─── Load: gather every section's current state ───────────────────────────────

ipcMain.handle('settings:load', () => {
  const tray = _tray();
  const s = loadSettings() || {};
  const d = s.defaults || {};

  return {
    behavior: {
      wakeWord:         tray.isWakeWordEnabled(),
      textInput:        tray.isTextInputEnabled(),
      opacity:          tray.isOpacityOnHoverEnabled(),
      wakeWordDefault:  typeof d.wakeWord       === 'boolean' ? d.wakeWord       : true,
      textInputDefault: typeof d.textInput      === 'boolean' ? d.textInput      : false,
      opacityDefault:   typeof d.opacityOnHover === 'boolean' ? d.opacityOnHover : false,
    },
    connectivity: _connectivity(),
    offline: {
      provider:  s.fallbackProvider || 'openai',
      openaiKey: s.openaiApiKey     || '',
      geminiKey: s.geminiApiKey     || '',
    },
  };
});

// ─── Live toggles (immediate effect) ──────────────────────────────────────────

ipcMain.handle('settings:toggle', (_e, { key, value } = {}) => {
  const tray = _tray();
  if (key === 'wakeWord')  tray.applyWakeWord(value);
  if (key === 'textInput') tray.applyTextInput(value);
  if (key === 'opacity')   tray.applyOpacityOnHover(value);
  return { ok: true };
});

// ─── Startup defaults (persisted) ─────────────────────────────────────────────

ipcMain.handle('settings:set-default', (_e, { key, value } = {}) => {
  const s = loadSettings() || {};
  s.defaults = s.defaults || {};
  if (key === 'wakeWord')  s.defaults.wakeWord       = !!value;
  if (key === 'textInput') s.defaults.textInput      = !!value;
  if (key === 'opacity')   s.defaults.opacityOnHover = !!value;
  saveSettings(s);
  return { ok: true };
});

// ─── Connectivity (full manage) ───────────────────────────────────────────────

ipcMain.handle('settings:status', () => _connectivity());

ipcMain.handle('settings:wa-connect', async () => {
  try { await whatsapp.init(); return { ok: true }; }
  catch (err) { return { ok: false, error: (err && err.message) || String(err) }; }
});

ipcMain.handle('settings:wa-disconnect', async () => {
  try { await whatsapp.disconnect(); return { ok: true }; }
  catch (err) { return { ok: false, error: (err && err.message) || String(err) }; }
});

ipcMain.handle('settings:spotify-connect', async () => {
  try { await spotify.authenticate(); return { ok: true }; }
  catch (err) { return { ok: false, error: (err && err.message) || String(err) }; }
});

ipcMain.handle('settings:spotify-disconnect', () => {
  spotify.disconnect();
  return { ok: true };
});

// ─── Memory ───────────────────────────────────────────────────────────────────

ipcMain.on('settings:memory-view', () => createMemoryWindow());

ipcMain.handle('settings:memory-reset', async () => {
  const { response } = await dialog.showMessageBox({
    type: 'warning',
    buttons: ['Cancel', 'Reset Memory'],
    defaultId: 0,
    cancelId: 0,
    title: 'Reset Memory',
    message: 'Erase everything Violet remembers about you?',
    detail:
      'This permanently deletes all long-term memories (facts, preferences, '
      + 'people). The current conversation is unaffected. This cannot be undone.',
  });
  if (response !== 1) return { ok: false, cancelled: true };

  try {
    const res = await fetch(`${API_BASE}/memory/reset`, { method: 'POST' });
    const data = await res.json();
    return { ok: true, removed: data.removed ?? 0 };
  } catch (err) {
    return { ok: false, error: (err && err.message) || String(err) };
  }
});

// ─── Offline mode (cloud provider + keys) ─────────────────────────────────────

ipcMain.handle('settings:save-offline', (_e, patch = {}) => {
  const s = loadSettings() || {};
  saveSettings({
    ...s,
    fallbackProvider: patch.provider  || 'openai',
    openaiApiKey:     (patch.openaiKey || '').trim(),
    geminiApiKey:     (patch.geminiKey || '').trim(),
  });
  return { ok: true };
});

// ─── System ───────────────────────────────────────────────────────────────────

ipcMain.handle('settings:pin-taskbar', () => {
  shell.openExternal('ms-settings:taskbar').catch((err) =>
    console.warn('[settings] open taskbar settings failed:', err && err.message));
  return { ok: true };
});

// ─── Avatar tuning bridge ─────────────────────────────────────────────────────
//
// Renderer pushes its current tuning snapshot here on ready; the Settings
// window reads it to seed its controls, and each control change is forwarded
// back to the renderer's live three.js objects.

ipcMain.on('persona:tune-ready', (_e, snapshot) => {
  _tuneSnapshot = snapshot || null;
});

ipcMain.handle('settings:tune-get', () => _tuneSnapshot);

ipcMain.handle('settings:tune-set', (_e, change) => {
  // Keep the cached snapshot in step so reopening shows the latest values.
  _mirrorTuneChange(change);
  const w = getMainWindow();
  if (w) w.webContents.send('persona:tune', change);
  return { ok: true };
});

ipcMain.handle('settings:tune-save', () => {
  const w = getMainWindow();
  if (w) w.webContents.send('persona:tune-save');
  return { ok: true };
});

// Apply one { path, value } change onto the cached snapshot so it mirrors
// the renderer's live state without a round-trip.
function _mirrorTuneChange(change) {
  if (!_tuneSnapshot || !change || typeof change.path !== 'string') return;
  const { path, value } = change;

  if (path.startsWith('mesh:')) {
    const name = path.slice(5);
    const m = (_tuneSnapshot.meshes || []).find((x) => x.name === name);
    if (m) m.visible = !!value;
    return;
  }

  // Dotted path into the snapshot object (e.g. "lighting.key.intensity").
  const parts = path.split('.');
  let node = _tuneSnapshot;
  for (let i = 0; i < parts.length - 1; i++) {
    if (node == null) return;
    node = node[parts[i]];
  }
  if (node != null) node[parts[parts.length - 1]] = value;
}

ipcMain.on('settings:close', () => {
  if (_win && !_win.isDestroyed()) _win.close();
});

// ─── Window ─────────────────────────────────────────────────────────────────────

function createSettingsWindow() {
  if (_win && !_win.isDestroyed()) {
    _win.focus();
    return;
  }

  _win = new BrowserWindow({
    width: 660,
    height: 520,
    minWidth: 600,
    minHeight: 460,
    frame: false,
    resizable: true,
    skipTaskbar: false,
    backgroundColor: '#0c0c0e',
    title: 'Settings',
    webPreferences: {
      preload: path.join(__dirname, 'settingsPreload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  _win.loadFile(path.join(__dirname, 'settingsView.html'));
  _win.on('closed', () => { _win = null; });
}

module.exports = { createSettingsWindow };
