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

import { LoadingScreen }
from './LoadingScreen.js';

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
    // UI
    // ======================

    this.loadingScreen =
      new LoadingScreen();

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
          this.camera,

        loadingScreen:
          this.loadingScreen

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
  // Computed every frame from the current canvas drawing-buffer
  // size. WebGL's viewport/scissor origin is the BOTTOM-LEFT, so a
  // y-offset of `marginY` puts the avatar that many pixels above
  // the bottom of the canvas — which sits just above the Windows
  // taskbar (we sized the BrowserWindow to the work area, so the
  // canvas bottom edge is the taskbar's top edge).
  //
  // The ideal width/height are capped so the avatar gracefully
  // shrinks on smaller displays instead of running off-screen.
  // Dimensions are returned in framebuffer pixels (devicePixelRatio
  // already factored in) because that is what setViewport/setScissor
  // expect.
  // ----------------------------------------------------------------

  getAvatarViewport(canvasW, canvasH) {

    const dpr =
      window.devicePixelRatio || 1;

    const idealW =
      Math.min(
        400,
        (canvasW / dpr) / 4
      ) * dpr;

    const idealH =
      Math.min(
        640,
        (canvasH / dpr) * 0.75
      ) * dpr;

    const marginX =
      20 * dpr;

    const marginY =
      20 * dpr;

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