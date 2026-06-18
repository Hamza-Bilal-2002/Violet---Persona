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
  // HEMISPHERE (ambient)
  // ======================
  //
  // Replaces flat AmbientLight. Sky color hits the tops of surfaces;
  // ground color hits undersides. Together they produce a natural
  // warm-ceiling / cool-floor gradient that reads as indoor ambient
  // light even with no background behind the avatar.

  const hemiLight =
    new THREE.HemisphereLight(

      config.hemisphere.skyColor,

      config.hemisphere.groundColor,

      config.hemisphere.intensity

    );

  scene.add(
    hemiLight
  );

  // ======================
  // DIRECTIONAL (key)
  // ======================
  //
  // Primary light, front-right-above. Intensity reduced from 1.2 to
  // 0.8 — the old value plus ambient 1.2 was overexposed and washed
  // out MToon's toon-shading character.

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
  // Cool blue-white directional from behind-left-above. On a
  // transparent Electron overlay this is the single highest-impact
  // lighting change: the edge highlight separates the avatar from
  // whatever desktop content is behind her and makes her feel
  // three-dimensional rather than pasted onto the screen.

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

    hemiLight,
    directionalLight,
    rimLight,

  };

}
