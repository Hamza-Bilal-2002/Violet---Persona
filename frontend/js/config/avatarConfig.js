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

    // Warm-white ambient. Slightly off pure-white so skin and fabric
    // read warmer under toon shading without the ground-color darkening
    // that HemisphereLight causes on anime VRM models.

    ambient: {

      color:
        0xfff8f0,  // very slightly warm white

      intensity:
        1.2,

    },

    // Primary key light, front-right-above. Kept at 1.0 so the toon
    // shading shadow boundary is clearly visible without blowout.

    directional: {

      color:
        0xffffff,

      intensity:
        1.0,

      position: {

        x: 1,
        y: 2,
        z: 3,

      },

    },

    // Rim / backlight — cool blue-white from behind-left-above.
    // On a transparent overlay this edge highlight separates the
    // avatar from whatever is behind her and gives her depth.

    rim: {

      color:
        0xaad4ff,  // cool blue-white

      intensity:
        0.35,

      position: {

        x: -2,
        y: 3,
        z: -2,

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

    // Reduced from 0.6 — the analyser's own smoothingTimeConstant
    // (0.35) now carries less of the lag budget, so the per-frame
    // lerp can be tighter without feeling jittery.

    smoothing:
      0.45,

  },

  // ======================
  // DEBUG
  // ======================

  debug: {

    enableGUI:
      true,

  },

  // ======================
  // VIEWPORT (bottom-right overlay)
  // ======================
  //
  // Where on the fullscreen canvas the avatar is rendered.
  // Width / height are clamped to [min, max] but scaled by the
  // canvas size in between, so the avatar shrinks gracefully on
  // smaller displays and stays sane on huge ones.
  //
  // Margins are pixels from the right and bottom edges of the
  // work area. Increase marginBottom to lift her higher above the
  // taskbar. Increase marginRight to push her further from the
  // right edge of the screen.
  //
  // widthFraction = avatar viewport width as a fraction of the
  // total canvas width, clamped to [widthMin, widthMax].
  // heightFraction = same for height vs canvas height.
  //
  // Tweak these and the change hot-reloads.

  viewport: {

    widthFraction:
      0.22,

    widthMin:
      280,

    widthMax:
      320,

    heightFraction:
      0.7,

    heightMin:
      420,

    heightMax:
      480,

    marginRight:
      24,

    marginBottom:
      10,

  },

};