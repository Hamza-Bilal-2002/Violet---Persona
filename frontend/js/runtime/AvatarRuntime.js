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

import { mountChatInput }
from '../ui/chatInput.js';

// Backend wiring config. When the backend container is running
// (docker compose up), the WebSocket at this URL drives dialogue.
// If the connection fails, the offline test dialogue still runs
// so the avatar isn't dead on screen.

const BACKEND_WS_URL =
  'ws://localhost:8000/chat/ws';

const ENABLE_TEST_DIALOGUE =
  false;

export class AvatarRuntime {

  constructor({
    scene,
    camera,
    loadingScreen
  }) {

    this.scene =
      scene;

    // camera is required for cursor->world raycasting in
    // LookAtManager. accepting it via constructor keeps the
    // dependency explicit.

    this.camera =
      camera;

    this.loadingScreen =
      loadingScreen;

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

  }

  async init() {

    // ======================
    // LOAD VRM
    // ======================

    this.loadingScreen.update(
      10,
      'Loading VRM Model...'
    );

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

    this.loadingScreen.update(
      25,
      'Initializing Systems...'
    );

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
          this.lipSyncManager

      });

    // ======================
    // LOAD ANIMATIONS
    // ======================

    this.loadingScreen.update(
      35,
      'Loading Animations...'
    );

    let loadedCount = 0;

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

          loadedCount++;

          const progress =

            35 +

            (
              loadedCount /
              AVATAR_ANIMATIONS.length
            ) * 50;

          this.loadingScreen.update(
            progress,
            `Loading Animations (${loadedCount}/${AVATAR_ANIMATIONS.length})`
          );

        }

      )

    );

    // ======================
    // START IDLE
    // ======================

    this.loadingScreen.update(
      90,
      'Starting Avatar...'
    );

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
    // SHOW MODEL
    // ======================

    this.currentVRM.scene.visible =
      true;

    this.loadingScreen.complete();

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
    // BACKEND + CHAT UI
    // ======================

    this.chatInput =
      mountChatInput({

        onSend: (text) => {

          this.backendClient.send(
            text
          );

        }

      });

    this.backendClient =
      new BackendClient({

        url:
          BACKEND_WS_URL,

        dialogueManager:
          this.dialogueManager,

        onStatusChange: (status) => {

          this.chatInput.setStatus(
            status
          );

        },

      });

    this.backendClient.connect();

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

}