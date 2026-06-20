// Persona desktop shell — tray.
//
// System tray icon + context menu. Kept intentionally lean: quick avatar
// actions, the live private modes, and connection status live here; every
// tunable preference lives in the Settings window (settingsWindow.js).
// Rebuilt whenever any surfaced state changes.

const {
  app,
  Tray,
  Menu,
} = require('electron');

const spotify = require('./spotify');
const { showQr, hideQr } = require('./qrWindow');
const { createSettingsWindow } = require('./settingsWindow');
const whatsapp = require('./tools/whatsapp');
const { loadSettings } = require('./userSettings');

const {
  AGENT_NAME,
  TRAY_ICON_PATH,
} = require('./config');

const {
  getMainWindow,
  toggleWindow,
} = require('./window');

let tray = null;

// ─── Live toggle state ────────────────────────────────────────────────────────
//
// Wake word / text input / fade-on-hover are live session toggles, now
// driven from the Settings window. Their *startup* value is the persisted
// "on by default" preference, applied in createTray() once the app (and so
// userData) is ready. Until then these hold safe fallbacks.

let devToolsOpen          = false;
let wakeWordEnabled       = true;
let opacityOnHoverEnabled = false;
let textInputEnabled      = false;

function _applyStartupDefaults() {
  const s = loadSettings() || {};
  const d = s.defaults || {};
  if (typeof d.wakeWord       === 'boolean') wakeWordEnabled       = d.wakeWord;
  if (typeof d.textInput      === 'boolean') textInputEnabled      = d.textInput;
  if (typeof d.opacityOnHover === 'boolean') opacityOnHoverEnabled = d.opacityOnHover;
}

// Personalities — roster + active id come from the backend via the
// renderer (IPC). Until the renderer connects, the submenu shows a
// placeholder.
let personalityRoster   = [];
let activePersonalityId = null;

// Adult mode (local-model only). Backend-authoritative: `available`
// reflects whether a local model is reachable (toggle is greyed when not),
// `enabled` is the current on/off state echoed back from the backend.
let adultModeEnabled   = false;
let adultModeAvailable = false;

// Text mode (muted text roleplay) — same local-only gating as Deep Mode.
let textModeEnabled    = false;
let textModeAvailable  = false;

// Last QR string seen, so the WhatsApp tray submenu can re-show the popup
// if the user dismissed it while still connecting.
let _lastQr = null;

// ─── Service status labels ────────────────────────────────────────────────────

function _waDot() {
  const s = whatsapp.getStatus();
  if (s === 'connected')  return '🟢';
  if (s === 'connecting') return '🟡';
  return '🔴';
}

function _waLabel() {
  const s = whatsapp.getStatus();
  if (s === 'connected')  return 'Connected';
  if (s === 'connecting') return 'Connecting…';
  return 'Disconnected';
}

function _spotifyDot() {
  return spotify.isAuthenticated() ? '🟢' : '🔴';
}

// ─── Quick-action submenus (status + reconnect) ───────────────────────────────
//
// Full connect/disconnect management lives in Settings → Connectivity. The
// tray submenus are quick status + a reconnect/refresh shortcut.

async function _reconnectWhatsApp() {
  try { await whatsapp.disconnect(); } catch { /* ignore */ }
  whatsapp.init().catch((err) => {
    console.error('[tray] WhatsApp reconnect error:', err && err.message);
  });
}

function _waSubmenu() {
  const status = whatsapp.getStatus();
  const items = [
    { label: `Status: ${_waLabel()}`, enabled: false },
    { type: 'separator' },
  ];

  if (status === 'connecting') {
    if (_lastQr) {
      items.push({
        label: 'Show QR Code',
        click: () => {
          showQr(_lastQr).catch((err) =>
            console.error('[tray] show QR error:', err && err.message));
        },
      });
    }
    items.push({
      label: 'Cancel',
      click: () => {
        whatsapp.disconnect().catch(() => {});
        hideQr();
        rebuildTrayMenu();
      },
    });
  } else if (status === 'connected') {
    items.push({ label: 'Reconnect', click: () => _reconnectWhatsApp() });
  } else {
    items.push({
      label: 'Connect',
      click: () => {
        whatsapp.init().catch((err) =>
          console.error('[tray] WhatsApp connect error:', err && err.message));
        rebuildTrayMenu();
      },
    });
  }
  return items;
}

function _spotifySubmenu() {
  const auth = spotify.isAuthenticated();
  const items = [
    { label: `Status: ${auth ? 'Connected' : 'Disconnected'}`, enabled: false },
    { type: 'separator' },
  ];
  items.push({
    label: auth ? 'Refresh' : 'Connect',
    click: () => {
      spotify.authenticate()
        .then(() => rebuildTrayMenu())
        .catch((err) => console.error('[tray] Spotify auth failed:', err && err.message));
    },
  });
  return items;
}

function _personalitySubmenu() {
  if (!personalityRoster.length) {
    return [{ label: '(start backend to load)', enabled: false }];
  }
  return personalityRoster.map((p) => ({
    label:   p.name,
    type:    'radio',
    checked: p.id === activePersonalityId,
    click:   () => {
      // The active session lives on the renderer's WS connection, so the
      // switch is relayed there rather than issued from the main process.
      const w = getMainWindow();
      if (w) w.webContents.send('persona:set-personality', p.id);
    },
  }));
}

// ─── State setters relayed from ipc.js (backend frames) ───────────────────────

function setPersonalityRoster(msg) {
  personalityRoster = (msg && msg.personalities) || [];
  if (msg && msg.active) activePersonalityId = msg.active;
  rebuildTrayMenu();
}

function setActivePersonality(id) {
  activePersonalityId = id;
  rebuildTrayMenu();
}

function setAdultModeState(state) {
  if (!state) return;
  if (typeof state.available === 'boolean') adultModeAvailable = state.available;
  if (typeof state.enabled === 'boolean')   adultModeEnabled   = state.enabled;
  rebuildTrayMenu();
}

function setTextModeState(state) {
  if (!state) return;
  if (typeof state.available === 'boolean') textModeAvailable = state.available;
  if (typeof state.enabled === 'boolean')   textModeEnabled   = state.enabled;
  rebuildTrayMenu();
}

// ─── Live toggle appliers (called from the Settings window) ───────────────────
//
// Each updates local state and pushes the change to the renderer. They do
// NOT touch persisted defaults — the Settings window saves those separately.

function applyWakeWord(enabled) {
  wakeWordEnabled = !!enabled;
  const w = getMainWindow();
  if (w) w.webContents.send('persona:toggle-wake-word', wakeWordEnabled);
}

function applyTextInput(enabled) {
  textInputEnabled = !!enabled;
  const w = getMainWindow();
  if (w) w.webContents.send('persona:toggle-text-input', textInputEnabled);
}

function applyOpacityOnHover(enabled) {
  opacityOnHoverEnabled = !!enabled;
  const w = getMainWindow();
  if (w) w.webContents.send('persona:toggle-opacity-on-hover', opacityOnHoverEnabled);
}

// ─── Tray menu build ──────────────────────────────────────────────────────────

function rebuildTrayMenu() {
  if (!tray) return;

  const contextMenu = Menu.buildFromTemplate([

    // ── Avatar quick actions ──────────────────────────────────────────────
    {
      label: 'Show / Hide',
      click: toggleWindow,
    },
    {
      label: 'Reload Avatar',
      click: () => {
        const w = getMainWindow();
        if (w) w.webContents.reload();
      },
    },

    { type: 'separator' },

    {
      label: 'Settings…',
      click: () => createSettingsWindow(),
    },

    { type: 'separator' },

    // ── Personality + private modes ───────────────────────────────────────
    {
      label:   'Personality',
      submenu: _personalitySubmenu(),
    },
    {
      label:   adultModeAvailable
                 ? 'Deep Mode (local only)'
                 : 'Deep Mode (needs local model)',
      type:    'checkbox',
      checked: adultModeEnabled,
      enabled: adultModeAvailable,
      click:   (menuItem) => {
        const w = getMainWindow();
        if (w) w.webContents.send('persona:set-adult-mode', menuItem.checked);
      },
    },
    {
      label:   textModeAvailable
                 ? 'Text Mode (local only)'
                 : 'Text Mode (needs local model)',
      type:    'checkbox',
      checked: textModeEnabled,
      enabled: textModeAvailable,
      click:   (menuItem) => {
        const w = getMainWindow();
        if (w) w.webContents.send('persona:set-text-mode', menuItem.checked);
      },
    },

    { type: 'separator' },

    // ── Connection status (quick view; manage in Settings) ────────────────
    {
      label:   `${_waDot()} WhatsApp`,
      submenu: _waSubmenu(),
    },
    {
      label:   `${_spotifyDot()} Spotify`,
      submenu: _spotifySubmenu(),
    },

    { type: 'separator' },

    {
      label:   'DevTools',
      type:    'checkbox',
      checked: devToolsOpen,
      click:   (menuItem) => {
        const w = getMainWindow();
        if (!w) return;
        if (menuItem.checked) {
          w.webContents.openDevTools({ mode: 'detach' });
        } else {
          w.webContents.closeDevTools();
        }
      },
    },

    { type: 'separator' },

    {
      label: 'Quit',
      click: () => { app.quit(); },
    },

  ]);

  tray.setContextMenu(contextMenu);
}

// ─── Wire WhatsApp status → tray rebuild + QR window ─────────────────────────

whatsapp.onStatusChange((status) => {
  rebuildTrayMenu();
  if (status === 'connected') {
    _lastQr = null;
    hideQr();
  }
});

whatsapp.onQr((qrString) => {
  _lastQr = qrString;
  showQr(qrString).catch((err) => {
    console.error('[tray] Failed to show QR window:', err.message);
  });
});

// ─── Tray creation ────────────────────────────────────────────────────────────

function createTray() {
  // userData is available now (app is ready) — pull the persisted
  // "on by default" preferences before the first menu build so the
  // renderer's persona:ready read sees the right startup state.
  _applyStartupDefaults();

  tray = new Tray(TRAY_ICON_PATH);
  tray.setToolTip(AGENT_NAME);
  rebuildTrayMenu();
  tray.on('click', toggleWindow);

  const mainWindow = getMainWindow();
  if (mainWindow) {
    mainWindow.webContents.on('devtools-opened', () => {
      devToolsOpen = true;
      rebuildTrayMenu();
    });
    mainWindow.webContents.on('devtools-closed', () => {
      devToolsOpen = false;
      rebuildTrayMenu();
    });
  }
}

// ─── Exports ──────────────────────────────────────────────────────────────────

function isWakeWordEnabled()       { return wakeWordEnabled; }
function isOpacityOnHoverEnabled() { return opacityOnHoverEnabled; }
function isTextInputEnabled()      { return textInputEnabled; }

module.exports = {
  createTray,
  isWakeWordEnabled,
  isOpacityOnHoverEnabled,
  isTextInputEnabled,
  applyWakeWord,
  applyTextInput,
  applyOpacityOnHover,
  setActivePersonality,
  setPersonalityRoster,
  setAdultModeState,
  setTextModeState,
};
