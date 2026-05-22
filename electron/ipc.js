// Persona desktop shell — IPC handlers.
//
// Every renderer -> main message lives here. Keep this list small;
// the renderer should only need a few targeted shell actions.
// Anything more elaborate should go through a dedicated module.

const { ipcMain } = require('electron');

const { getMainWindow } = require('./window');
const { isWakeWordEnabled } = require('./tray');
const tools = require('./tools');

function registerIpcHandlers() {

  // Renderer asks the shell to hide its window.

  ipcMain.on(
    'persona:hide',
    () => {

      const mainWindow = getMainWindow();
      if (mainWindow) {
        mainWindow.hide();
      }

    }
  );

  // Renderer asks the shell to show its window. Fired from
  // VoiceFlow.trigger() whenever a voice input arrives (wake word
  // or PTT) — if the user hid the overlay, talking should bring it
  // back so the user sees the listening / speaking indicators and
  // the avatar. show() is idempotent, so calling while visible is
  // a no-op.

  ipcMain.on(
    'persona:show',
    () => {

      const mainWindow = getMainWindow();
      if (!mainWindow) {
        return;
      }

      mainWindow.show();

      // Some Windows compositor states reset z-order on first
      // paint after a hide/show cycle. Re-assert top.

      mainWindow.setAlwaysOnTop(true, 'screen-saver');

    }
  );

  // Dynamic click-through toggle. The renderer raycasts the cursor
  // against the avatar each frame and flips this when the cursor
  // enters/leaves the mesh. `forward: true` stays on both states
  // so mousemove keeps flowing to the renderer for head tracking.

  ipcMain.on(
    'persona:set-ignore-mouse',
    (_event, ignore) => {

      const mainWindow = getMainWindow();
      if (!mainWindow) {
        return;
      }

      mainWindow.setIgnoreMouseEvents(
        !!ignore,
        { forward: true }
      );

    }
  );

  // Renderer signals it has finished loading (VRM + animations
  // + first frame rendered). Show the window now so the user
  // never sees loading frames.

  ipcMain.on(
    'persona:ready',
    () => {

      const mainWindow = getMainWindow();
      if (!mainWindow) {
        return;
      }

      // Push the initial wake-word state to the renderer now that
      // it has its onWakeWordToggle listener wired. If the tray
      // default is ON, the wake client starts as part of the
      // ready flow — no extra user click required.

      if (isWakeWordEnabled()) {

        console.log(
          '[shell] persona:ready — enabling wake word'
        );

        mainWindow.webContents.send(
          'persona:toggle-wake-word',
          true
        );

      }

      if (mainWindow.isVisible()) {
        return;
      }

      console.log(
        '[shell] persona:ready received — revealing window'
      );

      mainWindow.show();

      // Re-assert top z-order; some Windows compositor states
      // reset it on first paint.

      mainWindow.setAlwaysOnTop(true, 'screen-saver');

    }
  );

  // Phase 3 (Wave 3.1): renderer relays a tool_call from the backend
  // here. We dispatch to electron/tools/index.js and return either
  // {result} or {error}. ipcMain.handle is the right choice (not
  // .on) because the renderer awaits this via invoke().

  ipcMain.handle(
    'persona:execute-tool',
    async (_event, payload) => {

      const name =
        payload && payload.name;

      const args =
        (payload && payload.args) || {};

      console.log(
        `[shell] execute-tool: ${name}`,
        args
      );

      const outcome =
        await tools.execute(name, args);

      console.log(
        `[shell] execute-tool result for ${name}:`,
        outcome
      );

      return outcome;

    }
  );

}

module.exports = {
  registerIpcHandlers,
};
