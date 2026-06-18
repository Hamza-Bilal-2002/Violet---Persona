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
  //
  // Slightly warm white (0xfff8f0) rather than pure white — skin and
  // fabric read warmer under MToon toon shading. HemisphereLight was
  // tried but its ground-color darkening looks wrong on anime VRM
  // models that rely on flat toon shading.

  const ambientLight =
    new THREE.AmbientLight(

      config.ambient.color,

      config.ambient.intensity

    );

  scene.add(
    ambientLight
  );

  // ======================
  // DIRECTIONAL (key)
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

  // ======================
  // RIM (backlight)
  // ======================
  //
  // Cool blue-white directional from behind-left-above. Edge highlight
  // separates the avatar from the transparent background and gives her
  // depth without affecting the front-facing toon shading.

  const rimLight =
    new THREE.DirectionalLight(

      config.rim.color,

      config.rim.intensity

    );

  rimLight.position.set(

    config.rim.position.x,

    config.rim.position.y,

    config.rim.position.z

  );

  scene.add(
    rimLight
  );

  return {

    ambientLight,
    directionalLight,
    rimLight,

  };

}
