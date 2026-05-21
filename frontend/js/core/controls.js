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

  controls.update();

  return controls;

}