// Persona desktop shell — global keyboard shortcuts.
//
// Phase 2.B Wave 1: a single push-to-talk binding. Pressing
// Ctrl+Alt+V anywhere on the desktop fires 'persona:push-to-talk'
// into the renderer; VoiceFlow picks it up and runs the listen ->
// transcribe -> reply pipeline.
//
// Global shortcuts are OS-level. If another app already owns the
// same combo, Electron's globalShortcut.register returns false and
// we log a warning — there is no fallback in this wave, the user
// can rebind later when configurable shortcuts land.

const { globalShortcut } = require('electron');

const { getMainWindow } = require('./window');

const PUSH_TO_TALK_ACCELERATOR =
  'CommandOrControl+Alt+V';

function registerGlobalShortcuts() {

  const registered = globalShortcut.register(
    PUSH_TO_TALK_ACCELERATOR,
    () => {

      const mainWindow = getMainWindow();

      if (!mainWindow) {

        console.warn(
          '[shell] push-to-talk fired but no main window'
        );

        return;

      }

      mainWindow.webContents.send(
        'persona:push-to-talk'
      );

    }
  );

  if (!registered) {

    console.warn(
      `[shell] globalShortcut registration failed for ` +
      `${PUSH_TO_TALK_ACCELERATOR} — another app is probably ` +
      `holding it. Voice push-to-talk will not work this session.`
    );

  } else {

    console.log(
      `[shell] global shortcut registered: ${PUSH_TO_TALK_ACCELERATOR}`
    );

  }

}

function unregisterAllGlobalShortcuts() {

  globalShortcut.unregisterAll();

}

module.exports = {
  registerGlobalShortcuts,
  unregisterAllGlobalShortcuts,
  PUSH_TO_TALK_ACCELERATOR,
};
