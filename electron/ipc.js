// Persona desktop shell — IPC handlers.
//
// Every renderer -> main message lives here. Keep this list small;
// the renderer should only need a few targeted shell actions.
// Anything more elaborate should go through a dedicated module.

const { ipcMain } = require('electron');

const { getMainWindow } = require('./window');

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

}

module.exports = {
  registerIpcHandlers,
};
