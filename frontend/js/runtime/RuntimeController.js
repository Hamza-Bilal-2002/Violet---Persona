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
          .lookAtManager

    });

    // ======================
    // RESIZE
    // ======================

    this.setupResize();

  }

  setupResize() {

    window.addEventListener(

      'resize',

      () => {

        this.camera.aspect =

          window.innerWidth /
          window.innerHeight;

        this.camera
          .updateProjectionMatrix();

        this.renderer.setSize(

          window.innerWidth,
          window.innerHeight

        );

      }

    );

  }

}