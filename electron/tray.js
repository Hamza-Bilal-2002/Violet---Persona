// Persona desktop shell — tray.
//
// System tray icon + context menu. The menu has three toggles
// (Show/Hide, Debug GUI, DevTools) and one action (Pin to Taskbar)
// plus Quit. Menu items are immutable once built; the menu is
// rebuilt whenever a checkbox state changes so the displayed state
// always matches reality.

const {
  app,
  Tray,
  Menu,
  shell,
} = require('electron');

const spotify = require('./spotify');

const {
  AGENT_NAME,
  TRAY_ICON_PATH,
} = require('./config');

const {
  getMainWindow,
  toggleWindow,
} = require('./window');

let tray = null;

// Checkbox state — module-scope so rebuildTrayMenu can read the
// latest values when regenerating the template.

let debugGuiVisible = false;
let devToolsOpen = false;

// Wake word defaults to ON now that the wake/ container starts
// automatically with the rest of the stack. The user can flip it
// off from the tray menu for privacy moments. The renderer is
// notified of this initial state in ipc.js when 'persona:ready'
// fires (everything else needed for wake is up by then).

let wakeWordEnabled = true;

// Phase 4 Wave 4.1: fade the avatar's material opacity when the
// cursor approaches her, so she stops feeling like a popup
// blocking work. Default OFF per user preference — opt in via the
// tray menu when wanted. The renderer is notified of the initial
// state at 'persona:ready' alongside wake word.

let opacityOnHoverEnabled = false;

// Text input overlay — togglable from the tray so Violet can be
// typed at without a mic (e.g. office / silent environment).
// Default OFF.

let textInputEnabled = false;

function rebuildTrayMenu() {

  if (!tray) {
    return;
  }

  const mainWindow = getMainWindow();

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
        // Opens the debug GUI (the settings surface). If it's
        // already open this is a no-op so the user doesn't
        // get a toggle-off surprise.
        if (debugGuiVisible) return;
        debugGuiVisible = true;
        const w = getMainWindow();
        if (w) w.webContents.send('persona:toggle-debug-gui', true);
        rebuildTrayMenu();
      },
    },

    { type: 'separator' },

    {
      label: 'Wake Word',
      type: 'checkbox',
      checked: wakeWordEnabled,
      click: (menuItem) => {

        wakeWordEnabled = menuItem.checked;

        if (mainWindow) {

          mainWindow.webContents.send(
            'persona:toggle-wake-word',
            wakeWordEnabled
          );

        }

      },
    },

    {
      label: 'Text Input',
      type: 'checkbox',
      checked: textInputEnabled,
      click: (menuItem) => {

        textInputEnabled = menuItem.checked;

        if (mainWindow) {

          mainWindow.webContents.send(
            'persona:toggle-text-input',
            textInputEnabled
          );

        }

      },
    },

    {
      label: 'Fade on Hover',
      type: 'checkbox',
      checked: opacityOnHoverEnabled,
      click: (menuItem) => {

        opacityOnHoverEnabled = menuItem.checked;

        if (mainWindow) {

          mainWindow.webContents.send(
            'persona:toggle-opacity-on-hover',
            opacityOnHoverEnabled
          );

        }

      },
    },

    {
      label: 'Debug GUI',
      type: 'checkbox',
      checked: debugGuiVisible,
      click: (menuItem) => {

        debugGuiVisible = menuItem.checked;

        if (mainWindow) {

          mainWindow.webContents.send(
            'persona:toggle-debug-gui',
            debugGuiVisible
          );

        }

      },
    },

    {
      label: 'DevTools',
      type: 'checkbox',
      checked: devToolsOpen,
      click: (menuItem) => {

        if (!mainWindow) {
          return;
        }

        if (menuItem.checked) {

          mainWindow.webContents.openDevTools({
            mode: 'detach',
          });

        } else {

          mainWindow.webContents.closeDevTools();

        }

        // Truth is updated via the devtools-opened/closed
        // listeners; rebuildTrayMenu re-runs there.

      },
    },

    { type: 'separator' },

    {
      label: spotify.isAuthenticated()
        ? 'Spotify: Connected ✓'
        : 'Connect Spotify',
      click: () => {

        if (spotify.isAuthenticated()) {
          return; // already connected — no-op
        }

        spotify.authenticate()
          .then(() => {
            // Rebuild so the label flips to "Connected ✓"
            rebuildTrayMenu();
          })
          .catch((err) => {
            console.error('[tray] Spotify auth failed:', err.message);
          });

      },
    },

    { type: 'separator' },

    {

      // Windows controls tray-icon visibility, not the app.
      // Opening the right settings page is the closest thing to
      // a programmatic "pin." Same pattern Discord/OBS use.

      label: 'Pin to Taskbar...',
      click: () => {

        shell.openExternal('ms-settings:taskbar').catch(
          (err) => {

            console.warn(
              '[shell] failed to open taskbar settings:',
              err && err.message
            );

          }
        );

      },
    },

    { type: 'separator' },

    {
      label: 'Quit',
      click: () => {
        app.quit();
      },
    },

  ]);

  tray.setContextMenu(contextMenu);

}

function createTray() {

  tray = new Tray(TRAY_ICON_PATH);

  tray.setToolTip(AGENT_NAME);

  rebuildTrayMenu();

  tray.on('click', toggleWindow);

  // Keep the DevTools checkbox honest if the user closes via X.

  const mainWindow = getMainWindow();

  if (mainWindow) {

    mainWindow.webContents.on(
      'devtools-opened',
      () => {
        devToolsOpen = true;
        rebuildTrayMenu();
      }
    );

    mainWindow.webContents.on(
      'devtools-closed',
      () => {
        devToolsOpen = false;
        rebuildTrayMenu();
      }
    );

  }

}

// Exposed so ipc.js can fire the initial wake-word state to the
// renderer on 'persona:ready'. The renderer registers its toggle
// listener during runtime construction (before ready fires), so by
// the time we send this it'll be wired up.

function isWakeWordEnabled() {
  return wakeWordEnabled;
}

function isOpacityOnHoverEnabled() {
  return opacityOnHoverEnabled;
}

function isTextInputEnabled() {
  return textInputEnabled;
}

module.exports = {
  createTray,
  isWakeWordEnabled,
  isOpacityOnHoverEnabled,
  isTextInputEnabled,
};
