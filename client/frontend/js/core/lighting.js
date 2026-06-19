import * as THREE from 'three';

import {
  AVATAR_CONFIG
} from '../config/avatarConfig.js';

export function setupLighting(
  scene
) {

  const config =
    AVATAR_CONFIG.lighting;

  // ======================
  // AMBIENT
  // ======================

  const ambientLight =
    new THREE.AmbientLight(

      config.ambient.color,

      config.ambient.intensity

    );

  scene.add(
    ambientLight
  );

  // ======================
  // DIRECTIONAL
  // ======================

  const directionalLight =
    new THREE.DirectionalLight(

      config.directional.color,

      config.directional.intensity

    );

  directionalLight.position.set(

    config.directional.position.x,

    config.directional.position.y,

    config.directional.position.z

  );

  scene.add(
    directionalLight
  );

  return {

    ambientLight,
    directionalLight,
    rimLight: null,

  };

}
