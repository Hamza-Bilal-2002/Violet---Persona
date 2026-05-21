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
    // LOOK AT
    // ======================

    // run BEFORE vrm.update so the target's new position
    // is in place when VRMLookAt evaluates head/eye angles.

    if (lookAtManager) {

      lookAtManager.update(
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