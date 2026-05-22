import * as THREE from 'three';

const clock =
  new THREE.Clock();

export function startUpdateLoop({

  renderer,
  scene,
  camera,
  controls,
  animationManager,
  vrm,
  lipSyncManager,
  lookAtManager,

}) {

  function animate() {

    requestAnimationFrame(
      animate
    );

    const delta =
      clock.getDelta();

    // ======================
    // CONTROLS
    // ======================

    controls.update();

    // ======================
    // ANIMATIONS
    // ======================

    if (
      animationManager
    ) {

      animationManager.update(
        delta
      );

    }

    // ======================
    // VRM UPDATE
    // ======================

    if (vrm) {

      vrm.update(
        delta
      );

    }

    // ======================
    // LOOK AT
    // ======================

    // MUST run AFTER vrm.update. The animation mixer (in
    // animationManager.update via vrm.update's downstream
    // bone evaluation) writes the head bone every frame. If
    // we set our cursor-driven head rotation before that, the
    // mixer immediately overwrites us and the head appears
    // frozen relative to the cursor. Running last on the
    // head-affecting chain (before render) lets our write
    // stick for the frame.

    if (lookAtManager) {

      lookAtManager.update(
        delta
      );

    }

    // ======================
    // LIP SYNC
    // ======================

    // runs after vrm.update so expression
    // weights aren't overwritten this frame

    if (lipSyncManager) {

      lipSyncManager.update(
        delta
      );

    }

    // ======================
    // RENDER
    // ======================

    renderer.render(
      scene,
      camera
    );

  }

  animate();

}