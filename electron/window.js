// Persona desktop shell — window.
//
// Owns the single BrowserWindow instance. The overlay covers the
// primary display's work area (everything except the taskbar).
// Frameless + transparent + always-on-top. Click-through is ON by
// default — the renderer hit-tests cursor-over-avatar each frame
// and toggles via 'persona:set-ignore-mouse' (handled in ipc.js).
//
// Stays hidden until the renderer signals 'persona:ready' (handled
// in ipc.js) so the loading frames are never visible.

const {
  BrowserWindow,
  screen,
} = require('electron');

const {
  IS_DEV,
  DEV_URL,
  PROD_INDEX,
  PRELOAD_PATH,
} = require('./config');

let mainWindow = null;

function getMainWindow() {
  return mainWindow;
}

function createWindow() {

  const workArea = screen.getPrimaryDisplay().workArea;

  mainWindow = new BrowserWindow({

    x: workArea.x,
    y: workArea.y,
    width: workArea.width,
    height: workArea.height,

    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,

    // Lock window geometry. The overlay owns the work area; no
    // resize / drag / Aero snap.

    resizable: false,
    movable: false,
    hasShadow: false,

    // Stay hidden until the renderer signals 'persona:ready'.

    show: false,

    // Avoid the transparent+show:false first-paint flash on
    // Windows. Top-level option, not webPreferences.

    paintWhenInitiallyHidden: false,

    backgroundColor: '#00000000',

    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
    },

  });

  // 'screen-saver' level sits above standard always-on-top windows.

  mainWindow.setAlwaysOnTop(true, 'screen-saver');

  // Click-through default. `forward: true` keeps mousemove flowing
  // to the renderer so cursor-driven head tracking covers the
  // entire desktop even while clicks pass through.

  mainWindow.setIgnoreMouseEvents(true, { forward: true });

  if (IS_DEV) {

    mainWindow.loadURL(DEV_URL);

  } else {

    mainWindow.loadFile(PROD_INDEX);

  }

  mainWindow.once(
    'ready-to-show',
    () => {

      console.log(
        '[shell] ready-to-show fired (window remains hidden — waiting for persona:ready IPC)'
      );

    }
  );

  // Block accidental navigation away from the app.

  mainWindow.webContents.on(
    'will-navigate',
    (event, url) => {

      if (IS_DEV && url.startsWith(DEV_URL)) {
        return;
      }

      event.preventDefault();

    }
  );

  mainWindow.on(
    'closed',
    () => {
      mainWindow = null;
    }
  );

  return mainWindow;

}

// Show/hide convenience used by tray click + menu.

function toggleWindow() {

  if (!mainWindow) {
    return;
  }

  if (mainWindow.isVisible()) {

    mainWindow.hide();

  } else {

    mainWindow.show();

    mainWindow.setAlwaysOnTop(true, 'screen-saver');

  }

}

module.exports = {
  createWindow,
  getMainWindow,
  toggleWindow,
};
