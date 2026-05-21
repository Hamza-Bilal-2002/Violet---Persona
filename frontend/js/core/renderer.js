import * as THREE from 'three';

import {
  AVATAR_CONFIG
} from '../config/avatarConfig.js';

import {
  optimizeRenderer
} from '../utils/performanceManager.js';

export function createRenderer() {

  const config =
    AVATAR_CONFIG.renderer;

  const renderer =
    new THREE.WebGLRenderer({

      antialias:
        config.antialias,

      powerPreference:
        config.powerPreference,

    });

  renderer.setSize(

    window.innerWidth,
    window.innerHeight

  );

  renderer.setPixelRatio(

    Math.min(

      window.devicePixelRatio,

      config.maxPixelRatio

    )

  );

  optimizeRenderer(
    renderer
  );

  renderer.domElement.style.opacity =
    '0';

  renderer.domElement.style.transition =
    'opacity 1s ease';

  document.body.appendChild(
    renderer.domElement
  );

  return renderer;

}