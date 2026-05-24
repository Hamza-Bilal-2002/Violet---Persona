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

import { runTestDialogue }
from '../tests/testDialogue.js';

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
      true;

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

      runTestDialogue(
        this.dialogueManager
      );

    }

    console.log(
      'VRM Runtime Ready'
    );

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

    const elAtPoint =
      document.elementFromPoint(
        cursorX,
        cursorY
      );

    if (elAtPoint) {

      const uiHit =
        elAtPoint.closest(
          '.lil-gui'
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

}