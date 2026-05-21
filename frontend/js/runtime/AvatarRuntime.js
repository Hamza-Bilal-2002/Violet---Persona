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

import { AVATAR_ANIMATIONS }
from '../config/animations.js';

import { runTestDialogue }
from '../tests/testDialogue.js';

export class AvatarRuntime {

  constructor({
    scene,
    loadingScreen
  }) {

    this.scene =
      scene;

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

    // ======================
    // AUTOBLINK
    // ======================

    this.autoBlink();

    runTestDialogue(
  this.dialogueManager
);

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