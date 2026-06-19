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

import { mountVoiceIndicator }
from '../ui/voiceIndicator.js';

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

              this._exitConfirmationMode();
              resolve(args);

            } else if (NO.some((w) => lower.includes(w))) {

              this._exitConfirmationMode();
              reject(new Error('cancelled'));

            } else {

              // Treat voice input as message override.
              this._exitConfirmationMode();
              resolve({ ...args, message: voiceText });

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

          // Resolve contact in the background and update the card with
          // the real name + profile picture once available.
          if (
            window.personaShell &&
            typeof window.personaShell.resolveWhatsAppContact === 'function'
          ) {
            try {
              const resolved = await Promise.race([
                window.personaShell.resolveWhatsAppContact(args.to),
                new Promise((_, rej) =>
                  setTimeout(() => rej(new Error('timeout')), 5000)
                ),
              ]);
              // Only update if the user hasn't already confirmed/cancelled.
              if (this._confirmationPending && this._confirmLabel) {
                this._confirmLabel.innerHTML = '';
                this._confirmLabel.appendChild(
                  this._buildConfirmCard(resolved, args)
                );
              }
            } catch {
              // Keep the fallback card — non-fatal.
            }
          }

        },

      });

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

      if (e.key !== 'Enter') return;

      // Confirmation mode: Enter (empty) = confirm, Enter (text) = override message.
      if (this._confirmationPending) {

        const { args, resolve } = this._confirmationPending;
        const overrideText = input.value.trim();

        this._exitConfirmationMode();

        resolve(
          overrideText
            ? { ...args, message: overrideText }
            : args
        );

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

    // Confirm label sits 38px above the text input.
    if (this._confirmLabel) {
      this._confirmLabel.style.left   = `${inputLeft}px`;
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

    this._confirmationPending = { args, resolve, reject };

    input.placeholder = 'Enter ↵ to send  ·  Esc to cancel  ·  or retype the message';
    input.style.border = '1px solid rgba(255,200,60,0.55)';
    input.value = '';

    if (this._confirmLabel) {
      this._confirmLabel.innerHTML = '';
      this._confirmLabel.appendChild(
        this._buildConfirmCard(resolvedContact, args)
      );
      this._confirmLabel.style.display = 'block';
    }

    setTimeout(() => input.focus(), 50);

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
  // aesthetic. Profile pic (or initials), contact name, message
  // preview, and a WhatsApp indicator dot.
  // ----------------------------------------------------------------

  _buildConfirmCard(resolvedContact, args) {

    const name          = resolvedContact ? resolvedContact.name : args.to;
    const profilePicUrl = resolvedContact ? resolvedContact.profilePicUrl : null;
    const isLoading     = !resolvedContact;

    const card = document.createElement('div');
    Object.assign(card.style, {
      display:              'flex',
      alignItems:           'center',
      gap:                  '10px',
      width:                '256px',
      padding:              '9px 12px',
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

    // Slide-in on next frame
    requestAnimationFrame(() => {
      card.style.transition = 'opacity 0.18s ease, transform 0.18s cubic-bezier(0.16,1,0.3,1)';
      card.style.opacity    = '1';
      card.style.transform  = 'translateY(0)';
    });

    // Avatar
    card.appendChild(this._buildAvatar(name, profilePicUrl, isLoading));

    // Text block
    const textBlock = document.createElement('div');
    Object.assign(textBlock.style, {
      display:       'flex',
      flexDirection: 'column',
      gap:           '2px',
      flex:          '1',
      overflow:      'hidden',
      minWidth:      '0',
    });

    const nameEl = document.createElement('div');
    nameEl.textContent = isLoading ? 'Resolving…' : name;
    Object.assign(nameEl.style, {
      fontSize:      '12px',
      fontWeight:    '500',
      color:         isLoading ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.92)',
      whiteSpace:    'nowrap',
      overflow:      'hidden',
      textOverflow:  'ellipsis',
      letterSpacing: '0.01em',
    });

    const msgEl = document.createElement('div');
    const preview = (args.message || '').length > 36
      ? args.message.slice(0, 36) + '…'
      : (args.message || '');
    msgEl.textContent = `"${preview}"`;
    Object.assign(msgEl.style, {
      fontSize:     '11px',
      fontWeight:   '400',
      color:        'rgba(255,255,255,0.42)',
      whiteSpace:   'nowrap',
      overflow:     'hidden',
      textOverflow: 'ellipsis',
    });

    textBlock.appendChild(nameEl);
    textBlock.appendChild(msgEl);
    card.appendChild(textBlock);

    // WhatsApp indicator — green glow dot + "WA" micro-label
    const waWrap = document.createElement('div');
    Object.assign(waWrap.style, {
      display:       'flex',
      flexDirection: 'column',
      alignItems:    'center',
      gap:           '3px',
      flexShrink:    '0',
    });

    const dot = document.createElement('div');
    Object.assign(dot.style, {
      width:        '6px',
      height:       '6px',
      borderRadius: '50%',
      background:   '#25D366',
      boxShadow:    '0 0 5px rgba(37,211,102,0.6)',
    });

    const waLabel = document.createElement('span');
    waLabel.textContent = 'WA';
    Object.assign(waLabel.style, {
      fontSize:      '8px',
      fontWeight:    '600',
      color:         'rgba(255,255,255,0.2)',
      letterSpacing: '0.04em',
    });

    waWrap.appendChild(dot);
    waWrap.appendChild(waLabel);
    card.appendChild(waWrap);

    return card;

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
    // everything that isn't the avatar mesh — which would include
    // the debug GUI (lil-gui) and any future overlay UI. Detect
    // those via elementFromPoint and treat them the same as "over
    // the avatar": capture mouse events so the user can interact.
    //
    // Selectors here should match every interactive overlay we
    // want to be clickable on top of the transparent window.

    // If the debug GUI is open, always capture events regardless of
    // cursor position — in pass-through mode the window never gets
    // mousemove events so elementFromPoint would use stale coords.

    const guiEl =
      document.querySelector('.lil-gui');

    if (
      guiEl &&
      guiEl.style.display !== 'none'
    ) {

      return true;

    }

    const elAtPoint =
      document.elementFromPoint(
        cursorX,
        cursorY
      );

    if (elAtPoint) {

      const uiHit =
        elAtPoint.closest(
          '.lil-gui, .persona-text-input, .persona-confirm-label'
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