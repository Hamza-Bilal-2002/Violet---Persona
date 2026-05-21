import * as THREE from 'three';

import {
  AVATAR_CONFIG
} from '../config/avatarConfig.js';

export function createScene() {

  const scene =
    new THREE.Scene();

  scene.background =
    new THREE.Color(

      AVATAR_CONFIG
        .renderer
        .backgroundColor

    );

  return scene;

}