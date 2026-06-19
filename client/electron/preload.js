// Persona desktop shell — preload bridge.
//
// Runs in an isolated context between the Electron main process and the
// Vite-served renderer. Exposes a small, explicit API on
// `window.personaShell` so the frontend can detect that it's running in
// Electron and request narrowly-scoped shell actions.
//
// IMPORTANT: keep this surface minimal. Anything exposed here becomes a
// permanent contract with the renderer.

const {
  contextBridge,
  ipcRenderer,
}
  = require('electron');

contextBridge.exposeInMainWorld(
  'personaShell',
  {

    // Marker the renderer can use to switch on Electron-only behavior
    // (e.g., enabling -webkit-app-region styles).

    isElectron: true,

    // Hide the window without quitting. Sends a fire-and-forget IPC
    // message; main process handles the actual BrowserWindow.hide().

    hide: () => {

      ipcRenderer.send('persona:hide');

    },

    // Show the window (idempotent). Called by VoiceFlow.trigger so
    // a voice input — wake word or PTT — brings a hidden overlay
    // back into view automatically.

    show: () => {

      ipcRenderer.send('persona:show');

    },

    // Tell the main process the renderer is done loading and the
    // window can now be shown. Called once by AvatarRuntime after
    // the VRM + animations are ready. Prevents the user from ever
    // seeing the loading screen.

    ready: () => {

      ipcRenderer.send('persona:ready');

    },

    // Phase 2.A: dynamically toggle click-through (Electron's
    // `setIgnoreMouseEvents`). The renderer raycasts the cursor
    // against the avatar mesh each frame and calls this with `false`
    // when the cursor is over the avatar (so it can receive clicks)
    // and `true` when it is over the surrounding transparent area
    // (so the user can interact with apps below).
    //
    // `forward: true` is enforced on the main-process side so that
    // mousemove events keep flowing to the renderer regardless of
    // state — cursor-driven head tracking depends on it.

    setIgnoreMouse: (ignore) => {

      ipcRenderer.send(
        'persona:set-ignore-mouse',
        !!ignore
      );

    },

    // Subscribe the renderer to debug-GUI toggle messages sent
    // from the tray menu. The callback receives a boolean — true
    // when the user wants the lil-gui visible, false to hide.
    // The renderer is expected to register exactly one listener
    // (during RuntimeController setup); calling this multiple
    // times is unsupported and would stack subscriptions.

    onToggleDebugGui: (callback) => {

      ipcRenderer.on(
        'persona:toggle-debug-gui',
        (_event, visible) => {

          callback(visible);

        }
      );

    },

    // Phase 2.B Wave 1: subscribe the renderer to push-to-talk
    // trigger events. The shell registers a global Ctrl+Alt+V
    // shortcut (see electron/globalShortcut.js) and forwards each
    // press here. The callback takes no args — it's a pure trigger.
    // VoiceFlow registers exactly one listener at runtime startup.

    onPushToTalk: (callback) => {

      ipcRenderer.on(
        'persona:push-to-talk',
        () => {

          callback();

        }
      );

    },

    // Phase 2.B Wave 2: subscribe to wake-word on/off toggle from
    // the tray menu. callback receives a boolean — true to start
    // the continuous wake listener, false to stop it. The renderer
    // owns the actual mic + WS lifecycle.

    onWakeWordToggle: (callback) => {

      ipcRenderer.on(
        'persona:toggle-wake-word',
        (_event, enabled) => {

          callback(enabled);

        }
      );

    },

    // Phase 4 Wave 4.1: subscribe to the opacity-on-hover toggle.
    // callback receives a boolean — true to enable the cursor-
    // proximity fade, false to force the avatar fully opaque.

    onOpacityOnHoverToggle: (callback) => {

      ipcRenderer.on(
        'persona:toggle-opacity-on-hover',
        (_event, enabled) => {

          callback(enabled);

        }
      );

    },

    // Text input overlay toggle. callback receives a boolean —
    // true to show the input box, false to hide it.

    onTextInputToggle: (callback) => {

      ipcRenderer.on(
        'persona:toggle-text-input',
        (_event, enabled) => {

          callback(enabled);

        }
      );

    },

    // Persistent settings — read on startup, written by the debug GUI
    // "Save Settings" button. Both return Promises (IPC invoke).

    getSettings: () => ipcRenderer.invoke('persona:get-settings'),

    saveSettings: (data) => ipcRenderer.invoke('persona:save-settings', data),

    // Phase 3 Wave 3.1: execute a tool in the main process. Returns
    // a Promise resolving to {result} on success or {error} on
    // failure. BackendClient relays this from tool_call frames the
    // backend forwards out of Gemini's function-calling loop.

    // Resolve a WhatsApp contact by name or phone number.
    // Returns { chatId, name, profilePicUrl } for the confirmation card.
    // Called before _enterConfirmationMode so the real name + photo are
    // shown before the user confirms the send.

    resolveWhatsAppContact: (to) => ipcRenderer.invoke(
      'persona:resolve-whatsapp-contact',
      to
    ),

    executeTool: (name, args) => {

      return ipcRenderer.invoke(
        'persona:execute-tool',
        { name, args }
      );

    },

    // Phase 3 Wave 3.2: deferred-tool coordination. Tools like
    // lock_pc and sleep_pc execute their side-effect only after
    // the avatar finishes its reply — otherwise the screen locks
    // mid-sentence and the user never hears the confirmation.
    //
    // flushDeferredTools(): called when dialogueManager goes idle.
    // cancelDeferredTools(): called when a new conversation begins
    //   (user changed their mind before the action fired).

    flushDeferredTools: () => {

      ipcRenderer.send('persona:tools-flush-deferred');

    },

    cancelDeferredTools: () => {

      ipcRenderer.send('persona:tools-cancel-deferred');

    },

    // ── Personalities ────────────────────────────────────────────
    //
    // The renderer relays personality frames from the backend up to the
    // shell so the tray's Personality submenu reflects the active one,
    // and subscribes to tray clicks so a menu pick becomes a WS switch.

    // Renderer -> shell: the active personality changed.
    notifyPersonality: (id) =>
      ipcRenderer.send('persona:personality-active', id),

    // Renderer -> shell: the full personality roster (sent on connect).
    notifyPersonalities: (msg) =>
      ipcRenderer.send('persona:personalities-roster', msg),

    // Shell -> renderer: the user picked a personality from the tray.
    onSetPersonality: (callback) => {

      ipcRenderer.on(
        'persona:set-personality',
        (_event, id) => {
          callback(id);
        }
      );

    },

    // ── Adult mode (local-model only) ────────────────────────────────
    //
    // A gated toggle: the renderer relays backend adult-mode frames up to
    // the tray (so the checkbox reflects enabled/available), and the tray
    // toggle comes back down as a backend switch request.

    // Renderer -> shell: backend adult-mode state { enabled, available }.
    notifyAdultMode: (state) =>
      ipcRenderer.send('persona:adult-mode-state', state),

    // Shell -> renderer: the user toggled the tray Adult Mode checkbox.
    onSetAdultMode: (callback) => {

      ipcRenderer.on(
        'persona:set-adult-mode',
        (_event, enabled) => {
          callback(enabled);
        }
      );

    },

    // ── Tier-2 client fallback (basic mode) ──────────────────────────
    //
    // When the backend is unreachable, BackendClient routes user turns
    // to a direct GPT call run in the main process (key in userData).
    // fallbackChat resolves to { text } or { error }.

    fallbackChat: (payload) =>
      ipcRenderer.invoke('persona:fallback-chat', payload),

    // Returns { available: boolean } — whether a GPT key is configured,
    // so the renderer can warn before basic mode is ever needed.
    isFallbackAvailable: () =>
      ipcRenderer.invoke('persona:fallback-available'),

  }
);
