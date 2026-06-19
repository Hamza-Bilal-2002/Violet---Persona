// Persona desktop shell — IPC handlers.
//
// Every renderer -> main message lives here. Keep this list small;
// the renderer should only need a few targeted shell actions.
// Anything more elaborate should go through a dedicated module.

const { ipcMain } = require('electron');

const { getMainWindow } = require('./window');
const {
  isWakeWordEnabled,
  isOpacityOnHoverEnabled,
  isTextInputEnabled,
  setActivePersonality,
  setPersonalityRoster,
} = require('./tray');
const tools = require('./tools');
const { loadSettings, saveSettings } = require('./userSettings');

function registerIpcHandlers() {

  // Personalities: the renderer relays backend personality frames here
  // so the tray's Personality submenu reflects the roster + active one.

  ipcMain.on('persona:personality-active', (_event, id) => {
    setActivePersonality(id);
  });

  ipcMain.on('persona:personalities-roster', (_event, msg) => {
    setPersonalityRoster(msg);
  });

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

      // Phase 4 Wave 4.1: opacity-on-hover follows the same
      // initial-state pattern as wake word. Renderer's listener is
      // wired during AvatarRuntime construction so it's there by
      // the time persona:ready fires.

      mainWindow.webContents.send(
        'persona:toggle-opacity-on-hover',
        isOpacityOnHoverEnabled()
      );

      mainWindow.webContents.send(
        'persona:toggle-text-input',
        isTextInputEnabled()
      );

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

  // Settings: renderer reads saved settings on startup and writes
  // them when the user clicks "Save Settings" in the debug GUI.

  // WhatsApp contact resolution — called before the confirmation card
  // is shown so the renderer can display the real name + profile pic.

  ipcMain.handle(
    'persona:resolve-whatsapp-contact',
    async (_event, to) => {
      const { resolveContact } = require('./tools/whatsapp');
      return resolveContact(to);
    }
  );

  // Tier-2 client fallback (basic mode): the renderer relays a GPT chat
  // turn here when the backend is unreachable. The key lives in userData
  // (main process only) — see fallbackChat.js. Returns {text} or {error}.

  ipcMain.handle(
    'persona:fallback-chat',
    async (_event, payload) => {
      const { runFallbackChat } = require('./fallbackChat');
      return runFallbackChat(payload || {});
    }
  );

  // Whether a GPT key is configured — lets the renderer warn up front if
  // basic mode wouldn't work.

  ipcMain.handle(
    'persona:fallback-available',
    () => {
      const { hasApiKey } = require('./fallbackChat');
      return { available: hasApiKey() };
    }
  );

  ipcMain.handle('persona:get-settings', () => loadSettings());

  ipcMain.handle('persona:save-settings', (_event, data) => {
    saveSettings(data);
    return { ok: true };
  });

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

  // Renderer signals dialogue-queue idle: fire any deferred tool
  // (lock_pc, sleep_pc) that was queued during this reply.

  ipcMain.on(
    'persona:tools-flush-deferred',
    () => {

      tools.flushDeferred();

    }
  );

  // Renderer signals a new conversation started before the prior
  // deferred tool fired (user changed their mind). Drop it.

  ipcMain.on(
    'persona:tools-cancel-deferred',
    () => {

      tools.cancelDeferred();

    }
  );

}

module.exports = {
  registerIpcHandlers,
};
