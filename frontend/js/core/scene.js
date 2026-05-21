import * as THREE from 'three';

export function createScene() {

  const scene =
    new THREE.Scene();

  // Intentionally NOT setting scene.background. The renderer is
  // configured with alpha:true + clear-alpha 0, so anything we put on
  // the scene background (color, texture) would defeat the transparent
  // composite the Electron shell relies on. Leave it null so the canvas
  // is genuinely see-through.

  scene.background =
    null;

  return scene;

}