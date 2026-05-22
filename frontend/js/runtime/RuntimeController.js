import { createScene }
from '../core/scene.js';

import { createCamera }
from '../core/camera.js';

import { createRenderer }
from '../core/renderer.js';

import { createControls }
from '../core/controls.js';

import { setupLighting }
from '../core/lighting.js';

import { setupGUI }
from '../ui/debugGUI.js';

import { AvatarRuntime }
from './AvatarRuntime.js';

import { startUpdateLoop }
from './updateLoop.js';

export class RuntimeController {

  constructor() {

    // ======================
    // CORE SYSTEMS
    // ======================

    this.scene =
      createScene();

    this.camera =
      createCamera();

    this.renderer =
      createRenderer();

    this.controls =
      createControls(

        this.camera,
        this.renderer

      );

    setupLighting(
      this.scene
    );

    // ======================
    // VIEWPORT (Phase 2.A)
    // ======================

    // Bound as an instance property so it can be passed directly
    // to startUpdateLoop without a wrapping closure. Computed every
    // frame from the current canvas drawing-buffer size; see method
    // docstring below.

    this.getAvatarViewport =
      this.getAvatarViewport.bind(this);

  }

  async init() {

    // ======================
    // UNLOCK TTS
    // ======================

    document.body.addEventListener(

      'click',

      () => {

        speechSynthesis.resume();

      },

      { once: true }

    );

    // ======================
    // AVATAR RUNTIME
    // ======================

    this.avatarRuntime =
      new AvatarRuntime({

        scene:
          this.scene,

        camera:
          this.camera

      });

    await this.avatarRuntime.init();
      this.renderer.domElement.style.opacity =
  '1';
    // ======================
    // DEBUG GUI
    // ======================

    this.debugGui =
      setupGUI(

        this.avatarRuntime
          .expressionManager,

        this.avatarRuntime
          .animationManager

      );

    // Wire the Electron tray "Debug GUI" toggle to the lil-gui
    // visibility. No-op in browser dev mode where personaShell
    // is undefined.

    if (
      window.personaShell &&
      typeof window.personaShell.onToggleDebugGui === 'function'
    ) {

      window.personaShell.onToggleDebugGui(
        (visible) => {

          if (!this.debugGui) {
            return;
          }

          if (visible) {

            this.debugGui.show();

          } else {

            this.debugGui.hide();

          }

        }
      );

    }

    // ======================
    // UPDATE LOOP
    // ======================

    startUpdateLoop({

      renderer:
        this.renderer,

      scene:
        this.scene,

      camera:
        this.camera,

      controls:
        this.controls,

      animationManager:
        this.avatarRuntime
          .animationManager,

      vrm:
        this.avatarRuntime
          .currentVRM,

      lipSyncManager:
        this.avatarRuntime
          .lipSyncManager,

      lookAtManager:
        this.avatarRuntime
          .lookAtManager,

      // Phase 2.A: place the avatar in the bottom-right corner of
      // the canvas (which now covers the entire OS work area in
      // Electron). The function is evaluated every frame so the
      // viewport stays correct if the Windows taskbar autohides
      // and the work area changes size.

      getAvatarViewport:
        this.getAvatarViewport,

      // Phase 2.A: post-render hook for Electron click-through
      // hit-testing. AvatarRuntime owns the raycast against the
      // VRM mesh; we just dispatch each frame.

      onFrame:
        (frameCtx) => {

          if (
            this.avatarRuntime &&
            typeof this.avatarRuntime
              .onFrameAfterRender === 'function'
          ) {

            this.avatarRuntime
              .onFrameAfterRender(frameCtx);

          }

        }

    });

    // ======================
    // RESIZE
    // ======================

    this.setupResize();

  }

  // ----------------------------------------------------------------
  // Avatar viewport (bottom-right of the canvas)
  //
  // Returned in CSS-pixel units. WebGL's viewport/scissor origin is
  // the BOTTOM-LEFT, so a y-offset of `marginY` puts the avatar that
  // many pixels above the bottom of the canvas — which sits just
  // above the Windows taskbar (we sized the BrowserWindow to the
  // work area, so the canvas bottom edge is the taskbar's top edge).
  //
  // Three.js's setViewport/setScissor accept CSS-pixel values and
  // multiply by _pixelRatio internally — we must NOT pre-multiply
  // by DPR here. Doing so caused the avatar to render off-screen on
  // high-DPR displays in the first Phase 2.A iteration.
  //
  // Width/height are sized for portrait framing of the avatar's
  // upper body (~head + shoulders + waist), capped so smaller
  // displays still keep her on-screen.
  // ----------------------------------------------------------------

  getAvatarViewport(canvasW, canvasH) {

    const idealW =
      Math.min(
        420,
        Math.max(280, canvasW * 0.22)
      );

    const idealH =
      Math.min(
        680,
        Math.max(420, canvasH * 0.7)
      );

    const marginX =
      24;

    const marginY =
      16;

    return {
      x:
        canvasW - idealW - marginX,
      y:
        marginY,
      width:
        idealW,
      height:
        idealH,
    };

  }

  setupResize() {

    window.addEventListener(

      'resize',

      () => {

        // Phase 2.A: the update loop now owns camera.aspect —
        // it is matched to the avatar viewport's aspect, not the
        // window's. Updating it here would race with the loop and
        // cause the projection to wobble each frame. Only the
        // renderer's drawing-buffer size needs to track the window.

        this.renderer.setSize(

          window.innerWidth,
          window.innerHeight

        );

      }

    );

  }

}