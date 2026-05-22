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
let wakeWordEnabled = false;

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

module.exports = {
  createTray,
};
