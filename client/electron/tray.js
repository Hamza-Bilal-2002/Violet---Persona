// Persona desktop shell — tray.
//
// System tray icon + context menu. Rebuilt whenever any state changes
// (WhatsApp status, Spotify auth, checkbox toggles).

const {
  app,
  Tray,
  Menu,
  shell,
} = require('electron');

const spotify = require('./spotify');
const { showQr, hideQr } = require('./qrWindow');
const whatsapp = require('./tools/whatsapp');

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
};
