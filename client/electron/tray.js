// Persona desktop shell — tray.
//
// System tray icon + context menu. Rebuilt whenever any state changes
// (WhatsApp status, Spotify auth, checkbox toggles).

const {
  app,
  Tray,
  Menu,
  shell,
  dialog,
} = require('electron');

const spotify = require('./spotify');
const { showQr, hideQr } = require('./qrWindow');
const { createMemoryWindow } = require('./memoryWindow');
const whatsapp = require('./tools/whatsapp');

// Backend api base. Hardcoded localhost to match the renderer's other
// service URLs; revisit when the backend becomes remotely hosted.
const API_BASE = 'http://localhost:8000';

// Wipe Violet's long-term memory after an explicit confirm. The memory
// lives server-side (server/api), so this is a simple authenticated-by-
// locality HTTP call — no renderer round-trip needed.
async function resetMemory() {
  const { response } = await dialog.showMessageBox({
    type: 'warning',
    buttons: ['Cancel', 'Reset Memory'],
    defaultId: 0,
    cancelId: 0,
    title: 'Reset Memory',
    message: 'Erase everything Violet remembers about you?',
    detail:
      'This permanently deletes all long-term memories (facts, '
      + 'preferences, people). The current conversation is unaffected. '
      + 'This cannot be undone.',
  });

  if (response !== 1) return; // Cancel

  try {
    const res = await fetch(`${API_BASE}/memory/reset`, { method: 'POST' });
    const data = await res.json();
    dialog.showMessageBox({
      type: 'info',
      title: 'Memory Reset',
      message: `Cleared ${data.removed ?? 0} memories.`,
    });
  } catch (err) {
    dialog.showMessageBox({
      type: 'error',
      title: 'Reset Failed',
      message: 'Could not reach the backend to reset memory.',
      detail: (err && err.message) || String(err),
    });
  }
}

const {
  AGENT_NAME,
  TRAY_ICON_PATH,
} = require('./config');

const {
  getMainWindow,
  toggleWindow,
} = require('./window');

let tray = null;

// ─── Checkbox / toggle state ──────────────────────────────────────────────────

let debugGuiVisible       = false;
let devToolsOpen          = false;
let wakeWordEnabled       = true;
let opacityOnHoverEnabled = false;
let textInputEnabled      = false;

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

// ─── Service status labels ────────────────────────────────────────────────────

function _waDot() {
  const s = whatsapp.getStatus();
  if (s === 'connected')  return '🟢';
  if (s === 'connecting') return '🟡';
  return '🔴';
}

function _spotifyDot() {
  return spotify.isAuthenticated() ? '🟢' : '🔴';
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

// Called from ipc.js when the renderer relays backend personality frames.

function setPersonalityRoster(msg) {
  personalityRoster = (msg && msg.personalities) || [];
  if (msg && msg.active) activePersonalityId = msg.active;
  rebuildTrayMenu();
}

function setActivePersonality(id) {
  activePersonalityId = id;
  rebuildTrayMenu();
}

// Called from ipc.js when the renderer relays backend adult-mode frames.
function setAdultModeState(state) {
  if (!state) return;
  if (typeof state.available === 'boolean') adultModeAvailable = state.available;
  if (typeof state.enabled === 'boolean')   adultModeEnabled   = state.enabled;
  rebuildTrayMenu();
}

// ─── Tray menu build ──────────────────────────────────────────────────────────

function rebuildTrayMenu() {
  if (!tray) return;

  const mainWindow = getMainWindow();
  const waStatus   = whatsapp.getStatus();

  const waSubmenu = waStatus === 'connected'
    ? [
        {
          label: 'Disconnect WhatsApp',
          click: () => {
            whatsapp.disconnect().catch((err) => {
              console.error('[tray] WhatsApp disconnect error:', err.message);
            });
          },
        },
      ]
    : waStatus === 'connecting'
    ? [
        { label: 'Connecting… (scan QR window)', enabled: false },
        {
          label: 'Cancel',
          click: () => {
            whatsapp.disconnect().catch(() => {});
            hideQr();
          },
        },
      ]
    : [
        {
          label: 'Connect WhatsApp',
          click: () => {
            whatsapp.init().catch((err) => {
              console.error('[tray] WhatsApp connect error:', err.message);
            });
            rebuildTrayMenu();
          },
        },
      ];

  const spotifySubmenu = spotify.isAuthenticated()
    ? [
        {
          label: 'Disconnect Spotify',
          click: () => {
            spotify.disconnect();
            rebuildTrayMenu();
          },
        },
      ]
    : [
        {
          label: 'Connect Spotify',
          click: () => {
            spotify.authenticate()
              .then(() => rebuildTrayMenu())
              .catch((err) => {
                console.error('[tray] Spotify auth failed:', err.message);
              });
          },
        },
      ];

  const contextMenu = Menu.buildFromTemplate([

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
      label: 'Settings...',
      click: () => {
        if (debugGuiVisible) return;
        debugGuiVisible = true;
        const w = getMainWindow();
        if (w) w.webContents.send('persona:toggle-debug-gui', true);
        rebuildTrayMenu();
      },
    },

    { type: 'separator' },

    {
      label:   'Wake Word',
      type:    'checkbox',
      checked: wakeWordEnabled,
      click:   (menuItem) => {
        wakeWordEnabled = menuItem.checked;
        if (mainWindow) {
          mainWindow.webContents.send('persona:toggle-wake-word', wakeWordEnabled);
        }
      },
    },

    {
      label:   'Text Input',
      type:    'checkbox',
      checked: textInputEnabled,
      click:   (menuItem) => {
        textInputEnabled = menuItem.checked;
        if (mainWindow) {
          mainWindow.webContents.send('persona:toggle-text-input', textInputEnabled);
        }
      },
    },

    {
      label:   'Fade on Hover',
      type:    'checkbox',
      checked: opacityOnHoverEnabled,
      click:   (menuItem) => {
        opacityOnHoverEnabled = menuItem.checked;
        if (mainWindow) {
          mainWindow.webContents.send('persona:toggle-opacity-on-hover', opacityOnHoverEnabled);
        }
      },
    },

    {
      label:   'Debug GUI',
      type:    'checkbox',
      checked: debugGuiVisible,
      click:   (menuItem) => {
        debugGuiVisible = menuItem.checked;
        if (mainWindow) {
          mainWindow.webContents.send('persona:toggle-debug-gui', debugGuiVisible);
        }
      },
    },

    {
      label:   'DevTools',
      type:    'checkbox',
      checked: devToolsOpen,
      click:   (menuItem) => {
        if (!mainWindow) return;
        if (menuItem.checked) {
          mainWindow.webContents.openDevTools({ mode: 'detach' });
        } else {
          mainWindow.webContents.closeDevTools();
        }
      },
    },

    { type: 'separator' },

    // ── WhatsApp ──────────────────────────────────────────────────────────
    {
      label:   `${_waDot()} WhatsApp`,
      submenu: waSubmenu,
    },

    // ── Spotify ───────────────────────────────────────────────────────────
    {
      label:   `${_spotifyDot()} Spotify`,
      submenu: spotifySubmenu,
    },

    // ── Memory ────────────────────────────────────────────────────────────
    {
      label: 'Memory',
      submenu: [
        {
          label: 'View Memory…',
          click: () => createMemoryWindow(),
        },
        { type: 'separator' },
        {
          label: 'Reset Memory…',
          click: () => {
            resetMemory().catch((err) => {
              console.error('[tray] reset memory error:', err && err.message);
            });
          },
        },
      ],
    },

    // ── Personality ───────────────────────────────────────────────────────
    {
      label:   'Personality',
      submenu: _personalitySubmenu(),
    },

    // ── Adult Mode (local-model only) ─────────────────────────────────────
    // Greyed unless a local model is connected; the backend hard-blocks it
    // on any cloud provider, so this toggle only ever runs locally.
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

    { type: 'separator' },

    {
      label: 'Pin to Taskbar...',
      click: () => {
        shell.openExternal('ms-settings:taskbar').catch((err) => {
          console.warn('[shell] failed to open taskbar settings:', err && err.message);
        });
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
    hideQr();
  }
});

whatsapp.onQr((qrString) => {
  showQr(qrString).catch((err) => {
    console.error('[tray] Failed to show QR window:', err.message);
  });
});

// ─── Tray creation ────────────────────────────────────────────────────────────

function createTray() {
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

// ─── Exports for ipc.js ───────────────────────────────────────────────────────

function isWakeWordEnabled()       { return wakeWordEnabled; }
function isOpacityOnHoverEnabled() { return opacityOnHoverEnabled; }
function isTextInputEnabled()      { return textInputEnabled; }

module.exports = {
  createTray,
  isWakeWordEnabled,
  isOpacityOnHoverEnabled,
  isTextInputEnabled,
  setActivePersonality,
  setPersonalityRoster,
  setAdultModeState,
};
