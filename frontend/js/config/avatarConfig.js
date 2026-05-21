export const AVATAR_CONFIG = {

  // ======================
  // MODEL
  // ======================

  model: {

    path:
      './models/persona.vrm',

  },

  // ======================
  // CAMERA
  // ======================

  camera: {

    fov: 35,

    near: 0.1,

    far: 100,

    position: {

      x: 0,
      y: 1.4,
      z: 2,

    },

  },

  // ======================
  // CONTROLS
  // ======================

  controls: {

    target: {

      x: 0,
      y: 1.2,
      z: 0,

    },

    enableDamping:
      true,

    dampingFactor:
      0.05,

  },

  // ======================
  // RENDERER
  // ======================

  renderer: {

    antialias:
      true,

    powerPreference:
      'high-performance',

    // Renderer clears with alpha 0 (see core/renderer.js), so this value
    // is never actually painted. Kept here for documentation: intent is
    // "transparent" — black is the conventional inert clear color.

    backgroundColor:
      0x000000,

    maxPixelRatio:
      2,

  },

  // ======================
  // LIGHTING
  // ======================

  lighting: {

    ambient: {

      color:
        0xffffff,

      intensity:
        1.2,

    },

    directional: {

      color:
        0xffffff,

      intensity:
        1.2,

      position: {

        x: 1,
        y: 2,
        z: 3,

      },

    },

  },

  // ======================
  // ANIMATION
  // ======================

  animation: {

    default:
      'idle',

    fadeDuration:
      0.3,

  },

  // ======================
  // DIALOGUE
  // ======================

  dialogue: {

    defaultEmotion:
      'relaxed',

    defaultAnimation:
      'talking',

    speechRate:
      1.0,

    speechPitch:
      1.0,

    speechVolume:
      1.0,

  },

  // ======================
  // LIP SYNC
  // ======================

  lipSync: {

    strength:
      1.0,

    smoothing:
      0.6,

  },

  // ======================
  // DEBUG
  // ======================

  debug: {

    enableGUI:
      true,

  },

};