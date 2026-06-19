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

      // alpha:true enables a transparent framebuffer so the canvas
      // composites against whatever is behind it. In the browser that's
      // the body background; inside the Electron shell it's the OS
      // desktop. Backward-compatible — no harm in the browser.

      alpha:
        true,

      premultipliedAlpha:
        true,

    });

  // Clear with zero alpha so the canvas itself contributes no fill.
  // The clear color value is irrelevant when alpha is 0, but we set it
  // to black to match the documented intent in avatarConfig.js.

  renderer.setClearColor(
    0x000000,
    0
  );

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