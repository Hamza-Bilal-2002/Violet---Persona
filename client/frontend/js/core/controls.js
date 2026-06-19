import {
  OrbitControls
} from 'three/examples/jsm/controls/OrbitControls.js';

import {
  AVATAR_CONFIG
} from '../config/avatarConfig.js';

export function createControls(
  camera,
  renderer
) {

  const config =
    AVATAR_CONFIG.controls;

  const controls =
    new OrbitControls(

      camera,
      renderer.domElement

    );

  controls.target.set(

    config.target.x,
    config.target.y,
    config.target.z

  );

  controls.enableDamping =
    config.enableDamping;

  controls.dampingFactor =
    config.dampingFactor;

  // Phase 2.A: the avatar stays at the default angle and size.
  // No user-driven rotate / zoom / pan. The OrbitControls
  // instance is kept around (rather than deleted) so the camera
  // damping target math still runs and we can flip these flags
  // back on for dev/debug if needed without touching wiring.

  controls.enableRotate =
    false;

  controls.enableZoom =
    false;

  controls.enablePan =
    false;

  controls.update();

  return controls;

}