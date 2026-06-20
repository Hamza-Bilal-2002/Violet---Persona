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

import { createTuning }
from './tuning.js';

import { AvatarRuntime }
from './AvatarRuntime.js';

import { startUpdateLoop }
from './updateLoop.js';

import { AVATAR_CONFIG }
from '../config/avatarConfig.js';

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

    this.lights =
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
    // AVATAR TUNING BRIDGE
    // ======================
    //
    // The old in-overlay lil-gui debug bar is gone (it forced the whole
    // transparent window out of click-through whenever it was open). The
    // tuning controls now live in the Electron Settings window; this
    // bridges its changes to the live three.js objects via main-process
    // IPC. No-op in browser dev mode where personaShell is undefined.

    this.tuning =
      createTuning({
        vrm:      this.avatarRuntime.currentVRM,
        lights:   this.lights,
        camera:   this.camera,
        controls: this.controls,
      });

    if (window.personaShell) {

      // Apply each control change coming back from the Settings window.
      if (typeof window.personaShell.onTune === 'function') {
        window.personaShell.onTune((change) => {
          this.tuning.apply(change);
        });
      }

      // Settings window asked to persist the current look.
      if (typeof window.personaShell.onTuneSave === 'function') {
        window.personaShell.onTuneSave(() => {
          this.tuning.save();
        });
      }

    }

    // ======================
    // LOAD SAVED SETTINGS
    // ======================
    //
    // Read violet-settings.json from userData and apply to live
    // objects. Must run after the debug GUI so the GUI sliders show
    // the right initial values on next open (they capture at
    // construction time; applying settings here doesn't retro-update
    // their display state, but the live objects are correct).

    await this._loadAndApplySettings();

    // Snapshot AFTER applying persisted settings so the Settings window's
    // sliders open at the saved values, not the construction-time defaults.
    if (
      window.personaShell &&
      typeof window.personaShell.tuneReady === 'function'
    ) {
      window.personaShell.tuneReady(this.tuning.snapshot());
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

      dialogueManager:
        this.avatarRuntime
          .dialogueManager,

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

    const v =
      AVATAR_CONFIG.viewport;

    const idealW =
      Math.min(
        v.widthMax,
        Math.max(v.widthMin, canvasW * v.widthFraction)
      );

    const idealH =
      Math.min(
        v.heightMax,
        Math.max(v.heightMin, canvasH * v.heightFraction)
      );

    return {
      x:
        canvasW - idealW - v.marginRight,
      y:
        v.marginBottom,
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

  // ----------------------------------------------------------------
  // Settings persistence
  // ----------------------------------------------------------------

  async _loadAndApplySettings() {

    if (
      typeof window === 'undefined' ||
      !window.personaShell ||
      typeof window.personaShell.getSettings !== 'function'
    ) {
      return;
    }

    try {

      const settings = await window.personaShell.getSettings();

      if (settings) {
        this._applySettings(settings);
      }

    } catch (err) {

      console.warn('[RuntimeController] failed to load settings:', err);

    }

  }

  _applySettings(s) {

    if (!s) return;

    // Viewport position — mutate AVATAR_CONFIG in place so
    // getAvatarViewport() and the text-input RAF loop both pick up
    // the new values on the very next frame.

    if (s.viewport) {

      Object.assign(AVATAR_CONFIG.viewport, s.viewport);

    }

    // Text input offsets.

    if (s.textInput) {

      Object.assign(AVATAR_CONFIG.textInput, s.textInput);

    }

    // Lighting

    if (s.lighting) {

      const { ambient, directional } = s.lighting;

      if (ambient) {

        if (ambient.color !== undefined) {
          this.lights.ambientLight.color.set(ambient.color);
        }

        if (ambient.intensity !== undefined) {
          this.lights.ambientLight.intensity = ambient.intensity;
        }

      }

      if (directional) {

        if (directional.color !== undefined) {
          this.lights.directionalLight.color.set(directional.color);
        }

        if (directional.intensity !== undefined) {
          this.lights.directionalLight.intensity = directional.intensity;
        }

        if (directional.position) {
          this.lights.directionalLight.position.set(
            directional.position.x ?? this.lights.directionalLight.position.x,
            directional.position.y ?? this.lights.directionalLight.position.y,
            directional.position.z ?? this.lights.directionalLight.position.z,
          );
        }

      }

    }

    // Camera

    if (s.camera) {

      if (s.camera.fov !== undefined) {
        this.camera.fov = s.camera.fov;
        this.camera.updateProjectionMatrix();
      }

      if (s.camera.position) {
        this.camera.position.set(
          s.camera.position.x ?? this.camera.position.x,
          s.camera.position.y ?? this.camera.position.y,
          s.camera.position.z ?? this.camera.position.z,
        );
      }

    }

    // Orbit controls target

    if (s.controls && s.controls.target && this.controls) {

      this.controls.target.set(
        s.controls.target.x ?? this.controls.target.x,
        s.controls.target.y ?? this.controls.target.y,
        s.controls.target.z ?? this.controls.target.z,
      );

    }

    console.log('[RuntimeController] settings applied');

  }

}