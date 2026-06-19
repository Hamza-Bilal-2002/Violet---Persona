import * as THREE from 'three';

import {
  AVATAR_CONFIG
} from '../config/avatarConfig.js';

export function createCamera() {

  const config =
    AVATAR_CONFIG.camera;

  const camera =
    new THREE.PerspectiveCamera(

      config.fov,

      window.innerWidth /
      window.innerHeight,

      config.near,

      config.far
    );

  camera.position.set(

    config.position.x,
    config.position.y,
    config.position.z

  );

  return camera;

}