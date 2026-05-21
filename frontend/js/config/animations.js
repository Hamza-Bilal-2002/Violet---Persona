// Per-animation config.
//
// cooldown: ms blocked from replaying after the
// clip ends OR is superseded by another animation.
//   - 0   = never blocked (use for dialogue-driven
//           animations that may re-trigger rapidly)
//   - >0  = block for this many ms after end/supersede
//   - omit = falls back to AnimationManager.defaultCooldown (5000)

export const AVATAR_ANIMATIONS = [

  {

    name:
      'idle',

    path:
      './animations/idle.fbx',

    loop:
      true,

    cooldown:
      0,

  },

  {

    name:
      'happy',

    path:
      './animations/happy.fbx',

    loop:
      false,

    cooldown:
      5000,

  },

  {

    name:
      'reacting',

    path:
      './animations/reacting.fbx',

    loop:
      false,

    cooldown:
      5000,

  },

  {

    name:
      'talking',

    path:
      './animations/talking.fbx',

    loop:
      false,

    cooldown:
      0,

  },

  {

    name:
      'thinking',

    path:
      './animations/thinking.fbx',

    loop:
      false,

    cooldown:
      5000,

  },

  {

    name:
      'waving',

    path:
      './animations/waving.fbx',

    loop:
      false,

    cooldown:
      3000,

  },

];
