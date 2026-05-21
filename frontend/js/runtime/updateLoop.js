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