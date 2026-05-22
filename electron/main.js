// Persona desktop shell — Electron main process.
//
// Phase 1 responsibilities:
//   - Spawn a single frameless, transparent, always-on-top BrowserWindow
//     anchored to the top-right of the primary display.
//   - Wire a tray icon (left-click toggles, right-click menu shows Show/Hide/Quit).
//   - Keep the app alive when the window is closed — Persona is a background
//     process, not a regular foreground app. Only the tray "Quit" terminates.
//   - Bridge a minimal IPC channel ("persona:hide") for the renderer.
//
// CommonJS module — the renderer remains ESM (Vite).

const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  screen,
  ipcMain,
}
  = require('electron');

const path
  = require('path');

// ----------------------------------------------------------------------
// Pre-ready switches.
//
// Electron's native-occlusion calculation on Windows can flip transparent
// windows to a black fill when another window covers them. Disabling the
// feature before app-ready keeps the transparent overlay clean.
// ----------------------------------------------------------------------

app.commandLine.appendSwitch(
  'disable-features',
  'CalculateNativeWinOcclusion'
);

// Default to dev mode for Phase 1 — production packaging is out of scope.

const IS_DEV
  = process.env.NODE_ENV === 'development'
    || process.argv.includes('--dev')
    || !app.isPackaged;

const DEV_URL
  = 'http://localhost:5173';

const PROD_INDEX
  = path.join(
      __dirname,
      '..',
      'frontend',
      'dist',
      'index.html'
    );

const TRAY_ICON_PATH
  = path.join(
      __dirname,
      'assets',
      'tray-icon.png'
    );

const PRELOAD_PATH
  = path.join(
      __dirname,
      'preload.js'
    );

// ----------------------------------------------------------------------
// Module-scope handles kept alive for the app's lifetime.
// Tray, in particular, must be referenced or it gets GC'd and vanishes.
// ----------------------------------------------------------------------

let mainWindow
  = null;

let tray
  = null;

// ----------------------------------------------------------------------
// Window
// ----------------------------------------------------------------------

function computeTopRightOrigin(width, height) {

  const display
    = screen.getPrimaryDisplay();

  const workArea
    = display.workArea;

  const margin
    = 40;

  const x
    = workArea.x
      + workArea.width
      - width
      - margin;

  const y
    = workArea.y
      + margin;

  return { x, y };

}

function createWindow() {

  const width
    = 420;

  const height
    = 640;

  const { x, y }
    = computeTopRightOrigin(width, height);

  mainWindow
    = new BrowserWindow({

      width,
      height,
      x,
      y,

      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: true,
      hasShadow: false,

      // Stay hidden until the renderer signals 'persona:ready'.
      // This lets the avatar fully load (VRM + animations + first
      // frame) before the window appears, so the user never sees
      // the loading screen.

      show: false,

      // Disable Electron's default "paint when initially hidden"
      // behavior. With `transparent: true` + `show: false` on
      // Windows, the compositor can flash the hidden window
      // briefly on first paint. This is a top-level BrowserWindow
      // option (since ~Electron 22), NOT a webPreferences option.

      paintWhenInitiallyHidden: false,

      // Background-color is forced to fully transparent. Some Electron
      // builds default to opaque white during the first paint flash —
      // setting it explicitly avoids that.

      backgroundColor: '#00000000',

      webPreferences: {

        preload: PRELOAD_PATH,
        contextIsolation: true,
        nodeIntegration: false,

      },

    });

  // 'screen-saver' level sits above normal always-on-top windows, which is
  // the behavior we want for a Jarvis-style overlay.

  mainWindow.setAlwaysOnTop(
    true,
    'screen-saver'
  );

  if (IS_DEV) {

    mainWindow.loadURL(DEV_URL);

    // DevTools is now opt-in via the tray menu (see createTray).
    // We intentionally do NOT auto-open it here, because every
    // opened browser window is one more thing the user sees flash
    // on launch and one more thing to dismiss for a clean
    // "polished desktop overlay" feel.

  } else {

    mainWindow.loadFile(PROD_INDEX);

  }

  // Diagnostic: log if Electron ever fires 'ready-to-show'. We do
  // NOT call show() here — the only path to mainWindow.show() is
  // the 'persona:ready' IPC handler. If a window-flash regression
  // ever returns, this log helps confirm whether Electron's
  // internal show path was triggered.

  mainWindow.once(
    'ready-to-show',
    () => {

      console.log(
        '[persona-shell] ready-to-show fired (window remains hidden — waiting for persona:ready IPC)'
      );

    }
  );

  // Prevent the renderer from being able to navigate the shell away from
  // the avatar app (defense in depth — the renderer is our own code, but
  // a stray window.location assignment shouldn't be able to escape the
  // shell).

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

      mainWindow
        = null;

    }
  );

}

// ----------------------------------------------------------------------
// Tray
// ----------------------------------------------------------------------

function toggleWindow() {

  if (!mainWindow) {
    return;
  }

  if (mainWindow.isVisible()) {

    mainWindow.hide();

  } else {

    mainWindow.show();

    mainWindow.setAlwaysOnTop(
      true,
      'screen-saver'
    );

  }

}

// Checkbox state for the tray menu items. Kept at module scope so
// the rebuildTrayMenu function can read the latest values when
// regenerating the template (Electron menu items are immutable
// once built, so we rebuild on every state change).

let debugGuiVisible
  = false;

let devToolsOpen
  = false;

function rebuildTrayMenu() {

  if (!tray) {
    return;
  }

  const contextMenu
    = Menu.buildFromTemplate([

      {
        label: 'Show / Hide',
        click: toggleWindow,
      },

      { type: 'separator' },

      {
        label: 'Debug GUI',
        type: 'checkbox',
        checked: debugGuiVisible,
        click: (menuItem) => {

          debugGuiVisible
            = menuItem.checked;

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

          // Truth is updated via the devtools-opened /
          // devtools-closed listeners below — rebuildTrayMenu
          // will be re-invoked there if the user closes
          // DevTools via its window X button.

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

  tray
    = new Tray(TRAY_ICON_PATH);

  tray.setToolTip('Persona');

  rebuildTrayMenu();

  tray.on(
    'click',
    toggleWindow
  );

  // Keep the "DevTools" checkbox in sync with reality. If the
  // user closes DevTools via its own X button, the menu state
  // must reflect that.

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

// ----------------------------------------------------------------------
// IPC
// ----------------------------------------------------------------------

ipcMain.on(
  'persona:hide',
  () => {

    if (mainWindow) {
      mainWindow.hide();
    }

  }
);

// Renderer signals it has finished loading (VRM + animations + first
// frame rendered). Show the window now so the user never sees the
// loading screen.

ipcMain.on(
  'persona:ready',
  () => {

    if (!mainWindow) {
      return;
    }

    if (mainWindow.isVisible()) {
      return;
    }

    console.log(
      '[persona-shell] persona:ready received — revealing window'
    );

    mainWindow.show();

    // re-assert the highest always-on-top tier after show, since
    // some Windows compositor states reset it on first paint.

    mainWindow.setAlwaysOnTop(
      true,
      'screen-saver'
    );

  }
);

// ----------------------------------------------------------------------
// App lifecycle
// ----------------------------------------------------------------------

app.whenReady().then(() => {

  createWindow();

  createTray();

});

// Background process: do NOT quit when the window closes. Only the tray
// "Quit" item terminates Persona.

app.on(
  'window-all-closed',
  () => {

    // Intentionally empty on Windows. On macOS we'd also skip quitting,
    // matching the "stays alive in the dock" convention. Kept here for
    // portability.

  }
);

// Standard macOS-style activate handler. Not exercised on Windows but
// keeps the shell portable.

app.on(
  'activate',
  () => {

    if (BrowserWindow.getAllWindows().length === 0) {

      createWindow();

    }

  }
);
