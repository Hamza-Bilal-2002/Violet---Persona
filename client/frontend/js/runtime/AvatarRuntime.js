import * as THREE
from 'three';

import { loadVRM }
from '../loaders/vrmLoader.js';

import { AnimationManager }
from '../managers/animationManager.js';

import { ExpressionManager }
from '../managers/expressionManager.js';

import { AvatarStateManager }
from '../managers/avatarStateManager.js';

import { DialogueManager }
from '../managers/dialogueManager.js';

import { LipSyncManager }
from '../managers/lipSyncManager.js';

import { LookAtManager }
from '../managers/lookAtManager.js';

import { AVATAR_ANIMATIONS }
from '../config/animations.js';


import { BackendClient }
from '../backend/BackendClient.js';

import { FallbackChat }
from '../backend/FallbackChat.js';

import { mountVoiceIndicator }
from '../ui/voiceIndicator.js';

import { mountModeNotifier }
from '../ui/modeNotifier.js';

import { mountChatBox }
from '../ui/chatBox.js';

import { VoiceFlow }
from '../voice/VoiceFlow.js';

import { WakeWordClient }
from '../voice/WakeWordClient.js';

import { TtsClient }
from '../tts/TtsClient.js';

import { AVATAR_CONFIG }
from '../config/avatarConfig.js';

// Backend wiring config. When the backend container is running
// (docker compose up), the WebSocket at this URL drives dialogue.
// If the connection fails, the offline test dialogue still runs
// so the avatar isn't dead on screen.

const BACKEND_WS_URL =
  'ws://localhost:8000/chat/ws';

// Phase 2.B Wave 1: the speech container exposes /transcribe on
// 8002. Hardcoded for now; configurable later when we ship a
// settings surface.

const SPEECH_TRANSCRIBE_URL =
  'http://localhost:8002/transcribe';

// Phase 2.B Wave 2: the wake container exposes a streaming WS at
// 8003. Renderer pumps 16 kHz Int16 PCM frames continuously when
// the user enables wake word from the tray.

const WAKE_WS_URL =
  'ws://localhost:8003/ws';

// Phase 4 Wave 4.2: the tts container exposes /synthesize on 8004.
// DialogueManager POSTs reply text and gets back a WAV blob,
// plays it through an HTMLAudioElement, and lipSyncManager hooks
// up the audio-driven analyser path.

const TTS_SYNTHESIZE_URL =
  'http://localhost:8004/synthesize';

const ENABLE_TEST_DIALOGUE =
  false;

export class AvatarRuntime {

  constructor({
    scene,
    camera
  }) {

    this.scene =
      scene;

    // camera is required for cursor->world raycasting in
    // LookAtManager. accepting it via constructor keeps the
    // dependency explicit.

    this.camera =
      camera;

    this.currentVRM =
      null;

    this.animationManager =
      null;

    this.expressionManager =
      null;

    this.avatarStateManager =
      null;

    this.dialogueManager =
      null;

    this.lipSyncManager =
      null;

    this.lookAtManager =
      null;

    this._blinkTimeout =
      null;

    this._blinkStopped =
      false;

    // ======================
    // CLICK-THROUGH HIT-TEST (Phase 2.A)
    // ======================
    //
    // The Electron shell defaults to setIgnoreMouseEvents(true, …),
    // so clicks anywhere on the work area pass through to apps
    // below. Each frame (post-render) we raycast the cursor against
    // the VRM mesh and toggle that state: when the cursor is over
    // the avatar, ignore=false (the avatar can receive events); when
    // it leaves, ignore=true (click-through resumes). We only send
    // IPC on state change to avoid flooding the main process.

    this._lastMouse =
      { x: 0, y: 0 };

    this._lastIgnoreState =
      null;

    this._hitRaycaster =
      new THREE.Raycaster();

    this._hitNdc =
      new THREE.Vector2();

    this._isElectron =
      typeof window !== 'undefined' &&
      window.personaShell &&
      window.personaShell.isElectron === true;

    this._onMouseMoveTrack =
      (event) => {

        this._lastMouse.x =
          event.clientX;

        this._lastMouse.y =
          event.clientY;

      };

    window.addEventListener(
      'mousemove',
      this._onMouseMoveTrack,
      { passive: true }
    );

    // ======================
    // OPACITY-ON-HOVER (Phase 4 Wave 4.1)
    // ======================
    //
    // The avatar fades to ~30% opacity when the cursor is over her
    // and full-strength when it's away, so she stops feeling like
    // a popup blocking work. Driven from onFrameAfterRender using
    // the same per-frame cursor + viewport context already
    // available for the click-through hit-test.
    //
    // Material list is cached after the VRM loads (see init()) so
    // the per-frame path doesn't traverse the scene tree each frame.

    this._opacityEnabled =
      false;

    this._currentOpacity =
      1;

    this._avatarMaterials =
      [];

    // Fade tuning. Inner radius = cursor within this many CSS px of
    // the avatar's viewport center is fully faded. Outer radius =
    // beyond this distance, fully opaque. Between the two, linear.

    this._opacityMinValue =
      0.3;

    this._opacityFadeStartPx =
      300;

    this._opacityFadeEndPx =
      120;

    // Pending confirmation state. Set by _enterConfirmationMode,
    // cleared by _exitConfirmationMode. Holds { args, resolve, reject }
    // for the in-flight send_whatsapp confirmation.

    this._confirmationPending =
      null;

    // DOM refs for the confirmation label (created in
    // _mountElectronTextInput alongside the text input).

    this._confirmLabel =
      null;

  }

  async init() {

    // ======================
    // LOAD VRM
    // ======================

    this.currentVRM =
      await loadVRM(
        this.scene,
        './models/persona.vrm'
      );

    this.currentVRM.scene.visible =
      false;

    // ======================
    // MANAGERS
    // ======================

    this.expressionManager =
      new ExpressionManager(
        this.currentVRM
      );

    this.lipSyncManager =
      new LipSyncManager(
        this.expressionManager
      );

    this.animationManager =
      new AnimationManager(
        this.currentVRM
      );

    // head + eye tracking on cursor when idle.
    // depends on animationManager being ready (it polls
    // currentNonIdle to gate the tracking). also needs the
    // scene to attach the world-space lookAt target so its
    // matrix updates reliably each frame.

    this.lookAtManager =
      new LookAtManager({

        vrm:
          this.currentVRM,

        camera:
          this.camera,

        scene:
          this.scene,

        animationManager:
          this.animationManager,

      });

    this.avatarStateManager =
      new AvatarStateManager({
        animationManager:
          this.animationManager,

        expressionManager:
          this.expressionManager
      });

    // Phase 4 Wave 4.2: Piper TTS client. DialogueManager prefers
    // this and falls back to browser SpeechSynthesisUtterance if
    // the tts container is unreachable, so we don't need a guard
    // here for "is the container up?".

    this.ttsClient =
      new TtsClient({
        url:
          TTS_SYNTHESIZE_URL,
      });

    // Global voice override (Settings -> Voice): apply the saved value
    // before the first reply, and keep it in sync with live changes. It
    // funnels through TtsClient, so it wins over every personality —
    // backend, deep mode, and the offline fallback alike.
    if (window.personaShell) {
      if (typeof window.personaShell.getSettings === 'function') {
        Promise.resolve(window.personaShell.getSettings())
          .then((s) => {
            if (s && s.voiceOverride) {
              this.ttsClient.setVoiceOverride(s.voiceOverride);
            }
          })
          .catch(() => {});
      }
      if (typeof window.personaShell.onSetVoice === 'function') {
        window.personaShell.onSetVoice((voice) => {
          if (this.ttsClient &&
              typeof this.ttsClient.setVoiceOverride === 'function') {
            this.ttsClient.setVoiceOverride(voice);
          }
        });
      }
    }

    this.dialogueManager =
      new DialogueManager({

        animationManager:
          this.animationManager,

        expressionManager:
          this.expressionManager,

        lipSyncManager:
          this.lipSyncManager,

        ttsClient:
          this.ttsClient,

        // Phase 3 Wave 3.2: tell the shell to fire any deferred
        // tool (lock_pc, sleep_pc) once the reply has fully played.
        // The shell's tool dispatcher held the side-effect back so
        // the avatar's confirmation doesn't get cut off.

        onQueueIdle:
          () => {

            if (
              typeof window !== 'undefined' &&
              window.personaShell &&
              typeof window.personaShell.flushDeferredTools === 'function'
            ) {

              window.personaShell.flushDeferredTools();

            }

          },

      });

    // ======================
    // LOAD ANIMATIONS
    // ======================

    await Promise.all(

      AVATAR_ANIMATIONS.map(

        async (anim) => {

          await this.animationManager
            .loadAnimation(
              anim.name,
              anim.path,
              {
                cooldown: anim.cooldown
              }
            );

        }

      )

    );

    // ======================
    // START IDLE
    // ======================

    this.animationManager.play(
      'idle',
      {
        loop: true,
        fade: 0
      }
    );

    this.animationManager.update(
      0.016
    );

    this.currentVRM.update(
      0.016
    );

    await new Promise(
      (resolve) => {

        requestAnimationFrame(
          resolve
        );

      }
    );

    // ======================
    // BOUNDING SPHERE FOR HIT-TEST
    // ======================

    // Computed once after the first vrm.update so the bones are
    // in the posed (idle) state, not just bind pose. The sphere
    // is conservative — it covers the avatar's full silhouette —
    // and is used as a cheap O(1) substitute for the per-frame
    // recursive mesh raycast in the click-through hit-test.

    const bbox =
      new THREE.Box3()
        .setFromObject(this.currentVRM.scene);

    this._avatarBoundingSphere =
      new THREE.Sphere();

    bbox.getBoundingSphere(
      this._avatarBoundingSphere
    );

    // The auto-fitted sphere is conservative — it encloses the full
    // silhouette including hair volume and outstretched hands. Scale
    // it down to roughly the torso+head so click-through resumes as
    // soon as the cursor leaves the body, not the extended bounding
    // box of the whole pose.

    this._avatarBoundingSphere.radius *=
      0.6;

    // Wireframe sphere helper — added to the scene invisible.
    // The debug GUI "Hit Zone" toggle makes it visible so the
    // user can see exactly how tight the hit-test zone is and
    // tune _hitSphereScale if needed.

    const helperGeo =
      new THREE.SphereGeometry(
        this._avatarBoundingSphere.radius,
        24,
        16
      );

    const helperMat =
      new THREE.MeshBasicMaterial({
        color:       0x00ff88,
        wireframe:   true,
        transparent: true,
        opacity:     0.45,
      });

    this._boundingSphereHelper =
      new THREE.Mesh(helperGeo, helperMat);

    this._boundingSphereHelper.position.copy(
      this._avatarBoundingSphere.center
    );

    this._boundingSphereHelper.visible =
      false;

    this.scene.add(
      this._boundingSphereHelper
    );

    // ======================
    // MATERIAL CACHE (Phase 4 Wave 4.1)
    // ======================
    //
    // Snapshot every material in the VRM scene so the per-frame
    // opacity update doesn't traverse the scene tree. Each material
    // gets transparent=true set once here; the per-frame path only
    // writes .opacity. transparent enables Three.js to alpha-blend
    // the material against the framebuffer; MToon and the standard
    // three materials all respect this.
    //
    // depthWrite=false is deliberately NOT set — keeping depth
    // writes prevents the avatar's torso from showing through her
    // arms when faded.

    this._avatarMaterials =
      [];

    this.currentVRM.scene.traverse(
      (obj) => {

        if (!obj.material) {
          return;
        }

        const mats =
          Array.isArray(obj.material)
            ? obj.material
            : [obj.material];

        for (const mat of mats) {

          mat.transparent =
            true;

          this._avatarMaterials.push(mat);

        }

      }
    );

    // ======================
    // SHOW MODEL
    // ======================

    this.currentVRM.scene.visible =
      true;

    // signal the Electron shell that we're loaded and the
    // window can be revealed. no-op in browser dev mode.

    if (
      typeof window !== 'undefined' &&
      window.personaShell &&
      typeof window.personaShell.ready === 'function'
    ) {

      window.personaShell.ready();

    }

    // ======================
    // AUTOBLINK
    // ======================

    this.autoBlink();

    // ======================
    // VOICE INDICATOR
    // ======================
    //
    // Mounted before BackendClient so the very first 'connecting'
    // status (fired synchronously inside connect()) has a surface
    // to render against.

    this.voiceIndicator =
      mountVoiceIndicator();

    // Mode notifier — surfaces full <-> basic (GPT fallback) transitions
    // and fallback errors. Mounted before BackendClient so the very first
    // mode change has a surface to render against.

    this.modeNotifier =
      mountModeNotifier();

    // Text-mode chatbox. Hidden until text mode turns on. Its callbacks
    // route to the backend client (constructed just below): user sends go
    // out as normal messages, settings saves persist scene/rules, and the
    // close button turns text mode off.

    this.chatBox =
      mountChatBox({

        onSend: (text) => {
          this.dialogueManager.resetIdle();
          this.backendClient.send(text);
        },

        onSaveSettings: ({ scene, rules }) => {
          this.backendClient.setTextModeConfig({ scene, rules });
        },

        onClose: () => {
          this.backendClient.setTextMode(false);
        },

      });

    // Tracks whether text mode is currently on (for show/hide + toasts).
    this._textEnabled = false;

    // ======================
    // PERSONALITY HANDLERS (shared)
    // ======================
    //
    // Both the backend path and the basic-mode fallback emit personality
    // frames; they go through the same two handlers so a switch updates
    // the TTS voice + tray identically no matter which path is active.

    const handlePersonality = (p) => {

      if (this.ttsClient && typeof this.ttsClient.setVoice === 'function') {
        this.ttsClient.setVoice(p.voice);
      }

      if (
        window.personaShell &&
        typeof window.personaShell.notifyPersonality === 'function'
      ) {
        window.personaShell.notifyPersonality(p.id);
      }

    };

    const handlePersonalities = (msg) => {

      if (
        window.personaShell &&
        typeof window.personaShell.notifyPersonalities === 'function'
      ) {
        window.personaShell.notifyPersonalities(msg);
      }

    };

    // ======================
    // FALLBACK CHAT (Tier-2, basic mode)
    // ======================
    //
    // Talks straight to GPT (via the Electron main process) when the
    // backend is unreachable. No tools, no RAG, no memory — bundled
    // limited personalities + a small basic profile only.

    this.fallbackChat =
      new FallbackChat({

        dialogueManager:
          this.dialogueManager,

        ttsClient:
          this.ttsClient,

        onNotify: (message, opts) => {
          this.modeNotifier.notify(message, opts);
        },

        onPersonality:
          handlePersonality,

        onPersonalities:
          handlePersonalities,

      });

    // ======================
    // BACKEND
    // ======================
    //
    // The chat-input UI was removed in Phase 2.B Wave 2 — voice is
    // the only input path now (VoiceFlow → backendClient.send).
    // The ENABLE_TEST_DIALOGUE flag below still provides an offline
    // dev fallback that enqueues directly into dialogueManager.
    //
    // Connection status is routed into voiceIndicator's
    // setConnectionState channel, which takes priority over voice
    // states (no point pretending we're listening while the socket
    // is down).

    this.backendClient =
      new BackendClient({

        url:
          BACKEND_WS_URL,

        dialogueManager:
          this.dialogueManager,

        onStatusChange: (status) => {

          this.voiceIndicator.setConnectionState(
            status
          );

        },

        // Confirmation handler for tools like send_whatsapp.
        // Shows the confirmation UI, speaks the prompt, and registers
        // a voice interceptor so the user can also say yes/no/send it.
        // Async so we can resolve the contact before showing the card.

        onConfirmationRequired: async ({ name, args, resolve, reject }) => {

          // Show the card immediately with a loading state (null contact),
          // then update it with real info once the IPC resolves.

          this._enterConfirmationMode(args, resolve, reject, null);

          // Voice path: next voice/text input goes to the interceptor
          // instead of the backend WebSocket.
          this.backendClient.interceptNextSend((voiceText) => {

            const lower = voiceText.toLowerCase().trim();

            const YES = ['yes', 'yeah', 'yep', 'send', 'send it', 'ok',
                         'okay', 'confirm', 'go', 'do it', 'sure'];

            const NO  = ['no', 'nope', 'cancel', "don't", 'stop',
                         'nevermind', 'never mind', 'abort'];

            if (YES.some((w) => lower.includes(w))) {

              resolve(this._buildConfirmedArgs(args));
              this._exitConfirmationMode();

            } else if (NO.some((w) => lower.includes(w))) {

              this._exitConfirmationMode();
              reject(new Error('cancelled'));

            } else {

              // Treat voice input as a message override to the selected
              // contact.
              resolve(this._buildConfirmedArgs(args, voiceText));
              this._exitConfirmationMode();

            }

          });

          // Avatar speaks the confirmation prompt.
          const preview = args.message && args.message.length > 50
            ? args.message.slice(0, 50) + '…'
            : (args.message || '');

          this.dialogueManager.enqueue({
            text:      `Send "${preview}" to ${args.to}? Press Enter to confirm, or say yes.`,
            emotion:   { name: 'angry', intensity: 0.35 },
            animation: 'talking',
            priority:  2,
          });

          // Resolve contact(s) in the background and update the card with
          // the real name(s) + profile picture(s) once available. When
          // more than one contact matches (e.g. several "Ahmed"), the card
          // becomes a picker so the user chooses the right one.
          //
          // Whatever happens — slow client, no shell, an exception — the
          // card must never stay stuck on "Resolving…": every path below
          // lands on a confirmable card (or cancels) so the user is never
          // trapped and the backend's tool-wait doesn't silently time out.

          const canResolve =
            window.personaShell &&
            typeof window.personaShell.resolveWhatsAppContact === 'function';

          if (!canResolve) {
            // No shell to resolve through — fall back to a plain card built
            // from the raw name so the user can still confirm or cancel.
            this._applyFallbackMatch(args);
            return;
          }

          try {
            const resolved = await Promise.race([
              window.personaShell.resolveWhatsAppContact(args.to),
              new Promise((_, rej) =>
                setTimeout(() => rej(new Error('resolve-timeout')), 6000)
              ),
            ]);

            const matches = (resolved && resolved.matches) || [];

            // User may have already confirmed/cancelled during the wait.
            if (!this._confirmationPending) return;

            if (!matches.length) {
              // Nobody on WhatsApp by that name/number — bail out and let
              // Violet report it rather than sending to the wrong person.
              this._exitConfirmationMode();
              reject(new Error(`Couldn't find "${args.to}" on WhatsApp.`));
              return;
            }

            // Stash matches + selection so keydown/voice can resolve to an
            // exact chatId instead of re-matching the name loosely.
            this._confirmationPending.matches       = matches;
            this._confirmationPending.selectedIndex = 0;

            this._renderConfirmCard();

          } catch (err) {
            // Timed out or the resolver threw (client not ready, offline,
            // etc.). Don't leave the spinner up — drop to a confirmable
            // fallback card. The send still verifies the contact backend-
            // side, so confirming here is safe.
            console.warn(
              'AvatarRuntime: WhatsApp contact resolve failed —',
              err && err.message ? err.message : err
            );
            this._applyFallbackMatch(args);
          }

        },

        // Active personality changed: switch the TTS voice so she sounds
        // like the new personality, and tell the Electron shell so the
        // tray's radio marker stays in sync. Shared with the fallback
        // path so a switch behaves identically in either mode.
        onPersonality:
          handlePersonality,

        // Full roster + active id (sent on connect). Forward to the
        // shell so the tray can build its Personality submenu.
        onPersonalities:
          handlePersonalities,

        // Adult-mode state/capability frames. Relay to the tray (toggle
        // enabled/greyed) and surface transitions + block reasons via the
        // notifier. The voice swap rides on the personality frame the
        // backend sends alongside, so it's handled by onPersonality.
        onAdultMode: (msg) => {

          if (
            window.personaShell &&
            typeof window.personaShell.notifyAdultMode === 'function'
          ) {
            window.personaShell.notifyAdultMode({
              enabled:   !!msg.enabled,
              available: !!msg.available,
            });
          }

          if (msg.message) {
            // Explicit reason (refused / blocked) — always show it.
            this.modeNotifier.notify(msg.message, { kind: 'warn' });
          } else if (msg.enabled && !this._adultEnabled) {
            this.modeNotifier.notify(
              'Deep mode on — local model only.',
              { kind: 'info' }
            );
          } else if (!msg.enabled && this._adultEnabled) {
            this.modeNotifier.notify('Deep mode off.', { kind: 'info' });
          }

          this._adultEnabled = !!msg.enabled;

        },

        // Text-mode state/capability + scene/rules. Relay to the tray,
        // seed the chatbox settings, show/hide the chatbox, and surface
        // block reasons via the notifier.
        onTextMode: (msg) => {

          if (
            window.personaShell &&
            typeof window.personaShell.notifyTextMode === 'function'
          ) {
            window.personaShell.notifyTextMode({
              enabled:   !!msg.enabled,
              available: !!msg.available,
            });
          }

          // Keep the chatbox settings + title in sync with the backend.
          this.chatBox.setSettings({
            scene: msg.scene,
            rules: msg.rules,
            name:  msg.name,
          });

          if (msg.message) {
            this.modeNotifier.notify(msg.message, { kind: 'warn' });
          }

          if (msg.enabled && !this._textEnabled) {
            this.chatBox.show();
            this.modeNotifier.notify(
              'Text mode on — local model only, muted.',
              { kind: 'info' }
            );
          } else if (!msg.enabled && this._textEnabled) {
            this.chatBox.hide();
            this.modeNotifier.notify('Text mode off.', { kind: 'info' });
          }

          this._textEnabled = !!msg.enabled;

        },

        // A reply to show in the text-mode chatbox (assistant turns only).
        onChatMessage: (role, text) => {
          this.chatBox.addMessage(role, text);
        },

        // Tier-2 fallback: routed to when the backend can't be reached.
        fallbackChat:
          this.fallbackChat,

        // full <-> basic mode transitions. Drive the mode notifier (and
        // its persistent basic-mode pill); the actual roster/voice swap
        // is handled inside fallbackChat.activate().
        onModeChange: (mode, reason) => {

          this.modeNotifier.setMode(mode);

          if (mode === 'basic') {
            this.modeNotifier.notify(
              'Backend offline — switched to basic GPT mode. Memory and tools are paused.',
              { kind: 'warn' }
            );
          } else {
            this.modeNotifier.notify(
              'Backend online — full mode restored.',
              { kind: 'ok' }
            );
          }

        },

      });

    // Tray → renderer: the user picked a personality from the tray menu.
    // Relay it to the backend over the WS as a switch request.
    if (
      window.personaShell &&
      typeof window.personaShell.onSetPersonality === 'function'
    ) {
      window.personaShell.onSetPersonality((id) => {
        this.backendClient.setPersonality(id);
      });
    }

    // Tray -> renderer: the user toggled Adult Mode. Relay to the backend
    // (gated + authoritative there); the resulting adult_mode frame comes
    // back through onAdultMode above.
    if (
      window.personaShell &&
      typeof window.personaShell.onSetAdultMode === 'function'
    ) {
      window.personaShell.onSetAdultMode((enabled) => {
        this.backendClient.setAdultMode(enabled);
      });
    }

    // Tray -> renderer: the user toggled Text Mode.
    if (
      window.personaShell &&
      typeof window.personaShell.onSetTextMode === 'function'
    ) {
      window.personaShell.onSetTextMode((enabled) => {
        this.backendClient.setTextMode(enabled);
      });
    }

    this.backendClient.connect();

    // ======================
    // VOICE FLOW (Phase 2.B Wave 1)
    // ======================
    //
    // Push-to-talk pipeline. In the Electron shell the global
    // Ctrl+Alt+V shortcut routes through here:
    //   PTT -> MicCapture -> SpeechTranscriber -> backendClient.send
    //
    // The reply flows back through BackendClient -> DialogueManager
    // (TTS + animation + lip-sync), so nothing downstream needs to
    // change to give Violet a voice input path.
    //
    // In plain-browser dev mode there is no Electron preload, so
    // VoiceFlow.start() no-ops and the chat input above stays the
    // sole input.

    this.voiceFlow =
      new VoiceFlow({

        backendClient:
          this.backendClient,

        dialogueManager:
          this.dialogueManager,

        transcriberUrl:
          SPEECH_TRANSCRIBE_URL,

        onStateChange: (state, info) => {

          // Any voice activity resets the idle timer so the happy
          // dance doesn't fire while the user is mid-conversation.
          if (state === 'listening' || state === 'transcribing') {
            this.dialogueManager.resetIdle();
          }

          this.voiceIndicator.setState(
            state,
            info
          );

        },

      });

    this.voiceFlow.start();

    // ======================
    // WAKE WORD (Phase 2.B Wave 2)
    // ======================
    //
    // Continuous mic listener streaming Int16 PCM to the wake
    // container. On detection, fires the same listen cycle as PTT
    // via voiceFlow.trigger().
    //
    // OFF by default — privacy posture. The user opts in via the
    // tray "Wake Word" checkbox; the toggle handler below (re)
    // start/stop the client. No personaShell on the browser dev
    // path, so wake stays inert in plain-browser mode.

    this.wakeWordClient =
      new WakeWordClient({

        url:
          WAKE_WS_URL,

        onWake: () => {

          this.dialogueManager.resetIdle();
          this.voiceFlow.trigger();

        },

      });

    if (
      window.personaShell &&
      typeof window.personaShell.onWakeWordToggle === 'function'
    ) {

      window.personaShell.onWakeWordToggle(
        (enabled) => {

          if (enabled) {

            this.wakeWordClient.start()
              .catch((err) => {

                console.error(
                  'AvatarRuntime: wake-word start failed',
                  err
                );

              });

          } else {

            this.wakeWordClient.stop();

          }

        }
      );

    }

    // ======================
    // OPACITY-ON-HOVER TOGGLE (Phase 4 Wave 4.1)
    // ======================
    //
    // Tray menu "Fade on Hover" checkbox flips this. When off, we
    // force opacity back to 1.0 immediately so the avatar doesn't
    // freeze at whatever faded value she was last at.

    if (
      window.personaShell &&
      typeof window.personaShell.onOpacityOnHoverToggle === 'function'
    ) {

      window.personaShell.onOpacityOnHoverToggle(
        (enabled) => {

          this._opacityEnabled =
            !!enabled;

          if (!this._opacityEnabled) {

            this._currentOpacity =
              1;

            for (const mat of this._avatarMaterials) {

              mat.opacity =
                1;

            }

          }

        }
      );

    }

    // OFFLINE FALLBACK
    // useful when developing without the backend
    // running. flip ENABLE_TEST_DIALOGUE at the
    // top of this file to re-enable.

    if (ENABLE_TEST_DIALOGUE) {

      import('../tests/testDialogue.js').then(({ runTestDialogue }) => {
        runTestDialogue(this.dialogueManager);
      });

    }

    // Dev-mode text input — browser only, never shown inside Electron.
    // Lets you type to Violet without a microphone (e.g. in an office).
    // Violet still speaks back via Piper TTS exactly as she would for voice.

    if (!this._isElectron) {

      this._mountDevTextInput();

    }

    // Electron text input — pretty pill input anchored below the avatar,
    // toggled via the tray "Text Input" checkbox. Hidden by default.

    if (this._isElectron) {

      this._mountElectronTextInput();

    }

    console.log(
      'VRM Runtime Ready'
    );

  }

  _mountElectronTextInput() {

    // Inject placeholder colour — can't set ::placeholder via inline style.

    const style = document.createElement('style');

    style.textContent =
      '.persona-text-input::placeholder { color: rgba(255,255,255,0.32); }';

    document.head.appendChild(style);

    const input = document.createElement('input');
    input.type        = 'text';
    input.placeholder = 'Message Violet…';

    // Class used by the click-through hit-test to keep the input
    // interactive even while the overlay is in pass-through mode.

    input.className = 'persona-text-input';

    Object.assign(input.style, {
      position:        'fixed',
      width:           '256px',
      padding:         '7px 14px',
      borderRadius:    '20px',
      border:          '1px solid rgba(255,255,255,0.12)',
      background:      'rgba(0,0,0,0.28)',
      backdropFilter:  'blur(6px)',
      color:           'rgba(255,255,255,0.88)',
      fontSize:        '12px',
      letterSpacing:   '0.01em',
      outline:         'none',
      boxSizing:       'border-box',
      display:         'none',
      zIndex:          '999999',
      webkitAppRegion: 'no-drag',
    });

    this._electronTextInput = input;

    // Confirmation card container — floats above the text input during
    // send_whatsapp confirmation. Plain position anchor; the visual
    // card is built by _buildConfirmCard and injected at runtime.

    const confirmLabel = document.createElement('div');
    confirmLabel.className = 'persona-confirm-label';

    Object.assign(confirmLabel.style, {
      position:      'fixed',
      display:       'none',
      zIndex:        '999999',
      pointerEvents: 'none',
    });

    this._confirmLabel = confirmLabel;
    document.body.appendChild(confirmLabel);

    input.addEventListener('keydown', (e) => {

      // Esc cancels any pending confirmation.
      if (e.key === 'Escape' && this._confirmationPending) {

        const { reject } = this._confirmationPending;
        this._exitConfirmationMode();
        reject(new Error('cancelled'));
        return;

      }

      // Arrow keys move the selection through the contact picker when
      // multiple contacts matched.
      if (
        this._confirmationPending &&
        (e.key === 'ArrowDown' || e.key === 'ArrowUp')
      ) {

        const matches = this._confirmationPending.matches || [];
        if (matches.length > 1) {

          e.preventDefault();

          const dir = e.key === 'ArrowDown' ? 1 : -1;
          const n   = matches.length;
          this._confirmationPending.selectedIndex =
            (this._confirmationPending.selectedIndex + dir + n) % n;

          this._renderConfirmCard();

        }

        return;

      }

      if (e.key !== 'Enter') return;

      // Confirmation mode: Enter (empty) = send to the selected contact,
      // Enter (text) = override the message and send to the selected contact.
      if (this._confirmationPending) {

        const { args, resolve } = this._confirmationPending;
        const overrideText = input.value.trim();

        const confirmedArgs = this._buildConfirmedArgs(
          args,
          overrideText || null
        );

        this._exitConfirmationMode();
        resolve(confirmedArgs);

        return;

      }

      // Normal mode.
      const text = input.value.trim();
      if (!text) return;

      this.dialogueManager.resetIdle();
      this.backendClient.send(text);

      input.value = '';

    });

    document.body.appendChild(input);

    // Position it under the avatar now, then keep it in sync every
    // frame via RAF so it follows avatar position changes (debug GUI
    // "Position" sliders) and window resizes without needing events.
    this._updateTextInputPosition();
    this._startTextInputPositionLoop();

    // Wire the tray toggle sent from ipc.js on persona:ready and on
    // each subsequent tray checkbox click.

    if (
      window.personaShell &&
      typeof window.personaShell.onTextInputToggle === 'function'
    ) {

      window.personaShell.onTextInputToggle(
        (enabled) => {

          input.style.display =
            enabled ? 'block' : 'none';

          // When shown, focus the input immediately so the user
          // can start typing without an extra click.

          if (enabled) {

            setTimeout(() => input.focus(), 50);

          }

        }
      );

    }

  }

  // ----------------------------------------------------------------
  // Text input positioning — anchors the pill input to the
  // horizontal center of the avatar viewport, just above the
  // bottom of the screen. Reads AVATAR_CONFIG.viewport live so it
  // reacts to debug-GUI Position slider changes without extra wiring.
  // ----------------------------------------------------------------

  _updateTextInputPosition() {

    if (!this._electronTextInput) return;

    const v       = AVATAR_CONFIG.viewport;
    const canvasW = window.innerWidth;

    const idealW =
      Math.min(
        v.widthMax,
        Math.max(v.widthMin, canvasW * v.widthFraction)
      );

    // Avatar left edge in CSS pixels from the left of the screen.
    const avatarLeft = canvasW - idealW - v.marginRight;

    // Center the 256px input under the avatar, then apply user offsets.
    const inputWidth = 256;
    const ti         = AVATAR_CONFIG.textInput;
    const inputLeft  = Math.max(4, avatarLeft + (idealW - inputWidth) / 2 + (ti.offsetX || 0));

    // Sit just inside the gap between the avatar bottom and the taskbar.
    const inputBottom = Math.max(4, v.marginBottom - 4 + (ti.offsetY || 0));

    this._electronTextInput.style.left   = `${inputLeft}px`;
    this._electronTextInput.style.bottom = `${inputBottom}px`;
    this._electronTextInput.style.right  = '';

    // Confirm card sits 38px above the text input. It's 280px wide vs the
    // 256px input, so shift left 12px to keep it centered over the pill.
    if (this._confirmLabel) {
      this._confirmLabel.style.left   = `${inputLeft - 12}px`;
      this._confirmLabel.style.bottom = `${inputBottom + 38}px`;
    }

  }

  _startTextInputPositionLoop() {

    const tick = () => {

      this._updateTextInputPosition();
      this._textInputRaf = requestAnimationFrame(tick);

    };

    this._textInputRaf = requestAnimationFrame(tick);

  }

  // ----------------------------------------------------------------
  // Confirmation mode — entered when a send_whatsapp tool call is
  // intercepted. Renders the glass confirmation card above the input.
  // ----------------------------------------------------------------

  _enterConfirmationMode(args, resolve, reject, resolvedContact) {

    const input = this._electronTextInput;
    if (!input) return;

    // matches/selectedIndex are filled in once resolveWhatsAppContact
    // returns. Until then the card shows a loading state.
    this._confirmationPending = {
      args,
      resolve,
      reject,
      matches: resolvedContact ? [resolvedContact] : null,
      selectedIndex: 0,
    };

    input.placeholder = 'Enter ↵ to send  ·  Esc to cancel  ·  or retype the message';
    input.style.border = '1px solid rgba(255,200,60,0.55)';
    input.value = '';

    if (this._confirmLabel) {
      this._renderConfirmCard();
      this._confirmLabel.style.display = 'block';
    }

    setTimeout(() => input.focus(), 50);

  }

  // Render (or re-render) the confirmation card from the current
  // _confirmationPending state. Called on entry, after the contact(s)
  // resolve, and whenever the picker selection changes.

  _renderConfirmCard() {

    if (!this._confirmLabel || !this._confirmationPending) return;

    const { args, matches, selectedIndex } = this._confirmationPending;

    this._confirmLabel.innerHTML = '';
    this._confirmLabel.appendChild(
      this._buildConfirmCard(matches, args, selectedIndex)
    );

  }

  // Drop the confirmation card to a plain, confirmable state built from
  // the raw `to` string when resolution can't give us real matches (no
  // shell, slow/unready client, timeout, or an error). The user can still
  // send or cancel; the backend re-resolves + verifies the contact, so a
  // fallback confirm never sends to an unverified number. Guards against
  // a stale call after the user already acted.

  _applyFallbackMatch(args) {

    if (!this._confirmationPending) return;

    this._confirmationPending.matches = [{
      name:          args.to,
      number:        '',
      profilePicUrl: null,
      chatId:        null, // no verified id — backend resolves on send
    }];
    this._confirmationPending.selectedIndex = 0;

    this._renderConfirmCard();

  }

  // Build the args handed back to the tool once the user confirms.
  // Carries the selected contact's exact chatId so the backend sends to
  // precisely who was shown — never a loose name re-match. An optional
  // override message replaces the model's original text.

  _buildConfirmedArgs(args, overrideMessage) {

    const pending = this._confirmationPending || {};
    const matches = pending.matches || [];
    const sel     = matches[pending.selectedIndex || 0] || null;

    const out = { ...args };
    if (overrideMessage) out.message = overrideMessage;
    if (sel) {
      out.to = sel.name;
      // Only carry a verified chatId. Fallback matches have none, so the
      // backend re-resolves + verifies the name on send.
      if (sel.chatId) out.chatId = sel.chatId;
    }
    return out;

  }

  _exitConfirmationMode() {

    const input = this._electronTextInput;
    if (!input) return;

    this._confirmationPending = null;

    input.placeholder = 'Message Violet…';
    input.style.border = '1px solid rgba(255,255,255,0.12)';
    input.value = '';

    if (this._confirmLabel) {
      this._confirmLabel.style.display = 'none';
      this._confirmLabel.innerHTML = '';
    }

  }

  // ----------------------------------------------------------------
  // Confirmation card — dark-glass card matching the input pill
  // aesthetic. Shows the message being sent, then one selectable row
  // per matching contact (profile pic / initials, name, number). When
  // several contacts match, ↑/↓ move the highlight and ↵ sends to it.
  // ----------------------------------------------------------------

  _buildConfirmCard(matches, args, selectedIndex) {

    const isLoading = !matches;
    const list      = matches || [];
    const multiple  = list.length > 1;

    const card = document.createElement('div');
    Object.assign(card.style, {
      display:              'flex',
      flexDirection:        'column',
      gap:                  '8px',
      width:                '280px',
      padding:              '11px 12px',
      boxSizing:            'border-box',
      background:           'rgba(0,0,0,0.38)',
      backdropFilter:       'blur(16px)',
      webkitBackdropFilter: 'blur(16px)',
      border:               '1px solid rgba(255,200,60,0.28)',
      borderRadius:         '14px',
      boxShadow:            '0 0 0 1px rgba(255,200,60,0.07), 0 8px 24px rgba(0,0,0,0.5)',
      fontFamily:           'system-ui, -apple-system, sans-serif',
      opacity:              '0',
      transform:            'translateY(5px)',
    });

    requestAnimationFrame(() => {
      card.style.transition = 'opacity 0.18s ease, transform 0.18s cubic-bezier(0.16,1,0.3,1)';
      card.style.opacity    = '1';
      card.style.transform  = 'translateY(0)';
    });

    // ── Header: message preview + WA marker ──────────────────────────
    const header = document.createElement('div');
    Object.assign(header.style, {
      display:      'flex',
      alignItems:   'center',
      gap:          '8px',
      paddingBottom: '2px',
    });

    const msgBlock = document.createElement('div');
    Object.assign(msgBlock.style, { flex: '1', minWidth: '0' });

    const eyebrow = document.createElement('div');
    eyebrow.textContent = isLoading
      ? 'Finding contact…'
      : (multiple ? `Send to which one?` : 'Send message');
    Object.assign(eyebrow.style, {
      fontSize:      '9px',
      fontWeight:    '600',
      letterSpacing: '0.06em',
      textTransform: 'uppercase',
      color:         'rgba(255,200,60,0.7)',
      marginBottom:  '2px',
    });

    const msgEl = document.createElement('div');
    const preview = (args.message || '').length > 40
      ? args.message.slice(0, 40) + '…'
      : (args.message || '');
    msgEl.textContent = `"${preview}"`;
    Object.assign(msgEl.style, {
      fontSize:     '11px',
      color:        'rgba(255,255,255,0.5)',
      whiteSpace:   'nowrap',
      overflow:     'hidden',
      textOverflow: 'ellipsis',
    });

    msgBlock.appendChild(eyebrow);
    msgBlock.appendChild(msgEl);
    header.appendChild(msgBlock);

    const waLabel = document.createElement('span');
    waLabel.textContent = 'WhatsApp';
    Object.assign(waLabel.style, {
      fontSize:      '9px',
      fontWeight:    '600',
      color:         '#25D366',
      letterSpacing: '0.02em',
      flexShrink:    '0',
    });
    header.appendChild(waLabel);

    card.appendChild(header);

    // ── Contact rows ─────────────────────────────────────────────────
    if (isLoading) {
      card.appendChild(this._buildContactRow(null, false, null));
      return card;
    }

    list.forEach((contact, i) => {
      const selected = i === selectedIndex;
      const row = this._buildContactRow(contact, selected, () => {
        if (!this._confirmationPending) return;
        this._confirmationPending.selectedIndex = i;
        const input        = this._electronTextInput;
        const overrideText = input ? input.value.trim() : '';
        const confirmedArgs = this._buildConfirmedArgs(
          this._confirmationPending.args,
          overrideText || null
        );
        const { resolve } = this._confirmationPending;
        this._exitConfirmationMode();
        resolve(confirmedArgs);
      });
      card.appendChild(row);
    });

    // ── Footer hint when there's a choice to make ────────────────────
    if (multiple) {
      const hint = document.createElement('div');
      hint.textContent = '↑ ↓ to choose  ·  ↵ to send';
      Object.assign(hint.style, {
        fontSize:      '9px',
        color:         'rgba(255,255,255,0.28)',
        textAlign:     'center',
        letterSpacing: '0.03em',
        paddingTop:    '1px',
      });
      card.appendChild(hint);
    }

    return card;

  }

  // One contact row inside the confirmation card. `contact` null =>
  // loading placeholder. `onClick` confirms the send to this contact.

  _buildContactRow(contact, selected, onClick) {

    const isLoading     = !contact;
    const name          = contact ? contact.name : '';
    const number        = contact ? (contact.number || '') : '';
    const profilePicUrl = contact ? contact.profilePicUrl : null;

    const row = document.createElement('div');
    Object.assign(row.style, {
      display:      'flex',
      alignItems:   'center',
      gap:          '10px',
      padding:      '6px 7px',
      borderRadius: '10px',
      background:   selected ? 'rgba(255,200,60,0.12)' : 'transparent',
      border:       selected
                      ? '1px solid rgba(255,200,60,0.35)'
                      : '1px solid transparent',
      cursor:       onClick ? 'pointer' : 'default',
      pointerEvents: onClick ? 'auto' : 'none',
      transition:   'background 0.12s ease, border-color 0.12s ease',
    });

    if (onClick) row.addEventListener('click', onClick);

    row.appendChild(this._buildAvatar(name, profilePicUrl, isLoading));

    const textBlock = document.createElement('div');
    Object.assign(textBlock.style, {
      display:       'flex',
      flexDirection: 'column',
      gap:           '1px',
      flex:          '1',
      overflow:      'hidden',
      minWidth:      '0',
    });

    const nameEl = document.createElement('div');
    nameEl.textContent = isLoading ? 'Resolving…' : name;
    Object.assign(nameEl.style, {
      fontSize:     '12px',
      fontWeight:   '500',
      color:        isLoading
                      ? 'rgba(255,255,255,0.3)'
                      : (selected ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.7)'),
      whiteSpace:   'nowrap',
      overflow:     'hidden',
      textOverflow: 'ellipsis',
    });
    textBlock.appendChild(nameEl);

    if (number) {
      const numEl = document.createElement('div');
      numEl.textContent = number;
      Object.assign(numEl.style, {
        fontSize:   '10px',
        color:      'rgba(255,255,255,0.38)',
        whiteSpace: 'nowrap',
        overflow:   'hidden',
        textOverflow: 'ellipsis',
      });
      textBlock.appendChild(numEl);
    }

    row.appendChild(textBlock);

    // Selected rows get a green check so the target is unmistakable.
    if (selected && !isLoading) {
      const check = document.createElement('div');
      check.textContent = '✓';
      Object.assign(check.style, {
        fontSize:   '13px',
        fontWeight: '700',
        color:      '#25D366',
        flexShrink: '0',
        textShadow: '0 0 6px rgba(37,211,102,0.5)',
      });
      row.appendChild(check);
    }

    return row;

  }

  _buildAvatar(name, profilePicUrl, isLoading) {

    const wrap = document.createElement('div');
    Object.assign(wrap.style, {
      width:          '32px',
      height:         '32px',
      borderRadius:   '50%',
      flexShrink:     '0',
      overflow:       'hidden',
      border:         isLoading
                        ? '1.5px solid rgba(255,255,255,0.1)'
                        : '1.5px solid rgba(255,200,60,0.4)',
      background:     isLoading
                        ? 'rgba(255,255,255,0.05)'
                        : 'rgba(255,200,60,0.1)',
      display:        'flex',
      alignItems:     'center',
      justifyContent: 'center',
      boxSizing:      'border-box',
    });

    if (isLoading) return wrap;

    if (profilePicUrl) {
      const img = document.createElement('img');
      img.src = profilePicUrl;
      Object.assign(img.style, {
        width:     '100%',
        height:    '100%',
        objectFit: 'cover',
        display:   'block',
      });
      img.onerror = () => {
        wrap.removeChild(img);
        wrap.appendChild(this._buildInitials(name));
      };
      wrap.appendChild(img);
    } else {
      wrap.appendChild(this._buildInitials(name));
    }

    return wrap;

  }

  _buildInitials(name) {

    const span  = document.createElement('span');
    const parts = (name || '?').trim().split(/\s+/);
    span.textContent = parts.length > 1
      ? (parts[0][0] + parts[1][0]).toUpperCase()
      : name.slice(0, 2).toUpperCase();

    Object.assign(span.style, {
      fontSize:   '11px',
      fontWeight: '600',
      color:      'rgba(255,200,60,0.88)',
      lineHeight: '1',
      userSelect: 'none',
    });

    return span;

  }

  _mountDevTextInput() {

    const wrapper = document.createElement('div');

    Object.assign(wrapper.style, {
      position:   'fixed',
      bottom:     '24px',
      left:       '50%',
      transform:  'translateX(-50%)',
      display:    'flex',
      gap:        '8px',
      zIndex:     '999999',
      fontFamily: 'sans-serif',
    });

    const input = document.createElement('input');
    input.type        = 'text';
    input.placeholder = 'Type a message…';

    Object.assign(input.style, {
      width:        '340px',
      padding:      '8px 12px',
      borderRadius: '8px',
      border:       '1px solid rgba(255,255,255,0.3)',
      background:   'rgba(0,0,0,0.55)',
      color:        '#fff',
      fontSize:     '14px',
      outline:      'none',
    });

    const btn = document.createElement('button');
    btn.textContent = 'Send';

    Object.assign(btn.style, {
      padding:      '8px 16px',
      borderRadius: '8px',
      border:       'none',
      background:   'rgba(120,80,200,0.85)',
      color:        '#fff',
      fontSize:     '14px',
      cursor:       'pointer',
    });

    const send = () => {

      const text = input.value.trim();

      if (!text) return;

      this.backendClient.send(text);

      input.value = '';

    };

    btn.addEventListener('click', send);

    input.addEventListener('keydown', (e) => {

      if (e.key === 'Enter') send();

    });

    wrapper.appendChild(input);
    wrapper.appendChild(btn);
    document.body.appendChild(wrapper);

  }

  autoBlink() {

    if (
      this._blinkStopped
    ) {

      return;

    }

    const delay =
      2000 +
      Math.random() * 4000;

    this._blinkTimeout =
      setTimeout(() => {

      // guard against late callbacks after stop

      if (
        this._blinkStopped
      ) {

        return;

      }

      if (
        this.expressionManager
      ) {

        this.expressionManager
          .blink();

      }

      this.autoBlink();

    }, delay);

  }

  stopAutoBlink() {

    this._blinkStopped =
      true;

    clearTimeout(
      this._blinkTimeout
    );

    this._blinkTimeout =
      null;

  }

  // ======================
  // POST-FRAME (Phase 2.A)
  // ======================
  //
  // Called by the update loop after `renderer.render()`. Re-evaluates
  // whether the cursor is over the avatar mesh and, if the state has
  // changed since last frame, asks the Electron shell to flip its
  // ignoreMouseEvents bit. Cheap in practice: one raycast against the
  // currently-loaded VRM scene tree per frame.

  onFrameAfterRender(frameCtx) {

    if (!this._isElectron) {

      // Browser dev mode: no Electron shell, nothing to toggle.

      return;

    }

    if (
      !this.currentVRM ||
      !this.camera
    ) {

      return;

    }

    // Click-through and opacity-fade are independent per-frame
    // updates — opacity has to run every frame for the smoothing
    // lerp, click-through only fires IPC on state change.

    this._updateClickThrough(frameCtx);

    this._updateOpacity(frameCtx);

  }

  _updateClickThrough(frameCtx) {

    const isOverAvatar =
      this._isCursorOverAvatar(frameCtx);

    // ignoreMouseEvents semantics: true == pass clicks through.
    // We want the opposite of `isOverAvatar`: when cursor is over
    // the avatar, do NOT ignore mouse events (so the avatar can
    // receive them in the future). Otherwise, ignore them so the
    // user can interact with apps below the overlay.

    const desiredIgnore =
      !isOverAvatar;

    if (
      this._lastIgnoreState === desiredIgnore
    ) {

      return;

    }

    this._lastIgnoreState =
      desiredIgnore;

    if (
      window.personaShell &&
      typeof window.personaShell.setIgnoreMouse === 'function'
    ) {

      window.personaShell.setIgnoreMouse(
        desiredIgnore
      );

    }

  }

  _updateOpacity(frameCtx) {

    if (!this._opacityEnabled) {

      return;

    }

    if (!this._avatarMaterials.length) {

      return;

    }

    const vp =
      frameCtx && frameCtx.viewport;

    if (
      !vp ||
      vp.width <= 0 ||
      vp.height <= 0
    ) {

      return;

    }

    // Avatar viewport center in CSS pixel coords. Same WebGL
    // bottom-left → CSS top-left flip used elsewhere.

    const avatarCx =
      vp.x + vp.width / 2;

    const avatarCy =
      window.innerHeight - (vp.y + vp.height / 2);

    const dx =
      this._lastMouse.x - avatarCx;

    const dy =
      this._lastMouse.y - avatarCy;

    const dist =
      Math.sqrt(dx * dx + dy * dy);

    // Distance → target opacity. Far = full opacity, near = faded.

    let targetOpacity;

    if (dist >= this._opacityFadeStartPx) {

      targetOpacity =
        1;

    } else if (dist <= this._opacityFadeEndPx) {

      targetOpacity =
        this._opacityMinValue;

    } else {

      const t =
        (this._opacityFadeStartPx - dist) /
        (this._opacityFadeStartPx - this._opacityFadeEndPx);

      targetOpacity =
        1 - t * (1 - this._opacityMinValue);

    }

    // Per-frame smoothing. 0.15 at 60fps gives ~250ms to settle —
    // visible fade rather than a snap, but quick enough not to lag
    // perceptibly behind cursor motion.

    this._currentOpacity +=
      (targetOpacity - this._currentOpacity) * 0.15;

    // Snap when essentially there, avoids floating-point drift and
    // micro-writes to material.opacity once we've settled.

    if (Math.abs(targetOpacity - this._currentOpacity) < 0.001) {

      this._currentOpacity =
        targetOpacity;

    }

    for (const mat of this._avatarMaterials) {

      mat.opacity =
        this._currentOpacity;

    }

  }

  _isCursorOverAvatar(frameCtx) {

    const cursorX =
      this._lastMouse.x;

    const cursorY =
      this._lastMouse.y;

    // ======================
    // 1) CURSOR OVER UI?
    // ======================
    //
    // The default click-through state passes mouse events through
    // everything that isn't the avatar mesh. Detect interactive
    // overlays under the cursor via elementFromPoint and treat them
    // the same as "over the avatar": capture mouse events so the user
    // can interact. Only the element actually under the cursor flips
    // the window interactive — we never blanket-capture the whole
    // window for an open panel (that was the old lil-gui bug, which
    // made the entire overlay unclickable through).

    const elAtPoint =
      document.elementFromPoint(
        cursorX,
        cursorY
      );

    if (elAtPoint) {

      const uiHit =
        elAtPoint.closest(
          '.persona-text-input, .persona-confirm-label, .persona-chatbox'
        );

      if (uiHit) {

        return true;

      }

    }

    // ======================
    // 2) CURSOR OVER AVATAR?
    // ======================

    const vp =
      frameCtx && frameCtx.viewport;

    if (!vp) {

      return false;

    }

    // The viewport is already in CSS-pixel units (see
    // RuntimeController.getAvatarViewport). We only need to flip
    // the WebGL bottom-left origin to CSS top-left.

    const vpCssLeft =
      vp.x;

    const vpCssWidth =
      vp.width;

    const vpCssHeight =
      vp.height;

    const vpCssTop =
      window.innerHeight - vp.y - vpCssHeight;

    // Early-out: cursor isn't even in the viewport rectangle.

    if (
      cursorX < vpCssLeft ||
      cursorX > vpCssLeft + vpCssWidth ||
      cursorY < vpCssTop ||
      cursorY > vpCssTop + vpCssHeight
    ) {

      return false;

    }

    // Bounding-sphere hit-test only. We tried adding a precise
    // mesh raycast on top (Phase 4 Wave 4.1 2/3) but the per-frame
    // cost while the cursor was over the avatar was visibly laggy.
    // User decided the existing sphere coverage was good enough and
    // not worth the perf tradeoff. If we revisit, the path forward
    // is either throttling the mesh raycast to every Nth frame or
    // pre-building a BVH for the VRM mesh.

    if (!this._avatarBoundingSphere) {

      return false;

    }

    const ndcX =
      ((cursorX - vpCssLeft) / vpCssWidth) * 2 - 1;

    const ndcY =
      -((cursorY - vpCssTop) / vpCssHeight) * 2 + 1;

    this._hitNdc.set(
      ndcX,
      ndcY
    );

    this._hitRaycaster.setFromCamera(
      this._hitNdc,
      this.camera
    );

    return this._hitRaycaster.ray.intersectsSphere(
      this._avatarBoundingSphere
    );

  }

  // ======================
  // DISPOSE
  // ======================

  dispose() {

    window.removeEventListener(
      'mousemove',
      this._onMouseMoveTrack
    );

  }

}