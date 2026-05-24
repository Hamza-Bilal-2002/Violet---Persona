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

    this.dialogueManager =
      new DialogueManager({

        animationManager:
          this.animationManager,

        expressionManager:
          this.expressionManager,

        lipSyncManager:
          this.lipSyncManager,

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

    // Phase 4 Wave 4.1: hybrid hit-test — bounding sphere as the
    // cheap rejection, precise mesh raycast for the final answer.
    //
    // The sphere is intentionally conservative (covers the avatar's
    // full silhouette plus a margin), so using it alone leaves a
    // "dead" zone of unclickable space around the avatar where
    // clicks should pass through to apps below. With the mesh
    // raycast as the precise pass, the click-capture region matches
    // the actual silhouette and gaps between body parts (e.g.,
    // between arms and torso) pass clicks through.
    //
    // Perf: ray-mesh intersection on the VRM scene tree walks all
    // visible triangles. The sphere reject cuts out the common
    // case (cursor nowhere near the avatar) at O(1), so the mesh
    // raycast only runs when the cursor is in the vicinity — a
    // brief fraction of typical use.

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

    // Cheap reject first.

    if (
      !this._hitRaycaster.ray.intersectsSphere(
        this._avatarBoundingSphere
      )
    ) {

      return false;

    }

    // Sphere hit — precise mesh raycast. Recursive flag walks every
    // mesh under the VRM scene root. We don't need the intersect
    // payloads, just whether anything was hit, so the cheapest exit
    // is to check length > 0.

    const hits =
      this._hitRaycaster.intersectObject(
        this.currentVRM.scene,
        true
      );

    return hits.length > 0;

  }

}