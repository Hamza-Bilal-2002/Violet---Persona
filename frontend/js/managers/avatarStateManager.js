export class AvatarStateManager {

  constructor({

    animationManager,
    expressionManager

  }) {

    // ====================
    // MANAGERS
    // ====================

    this.animationManager =
      animationManager;

    this.expressionManager =
      expressionManager;

    // ====================
    // STATE
    // ====================

    this.currentState =
      'idle';

  }

  // ====================
  // SET STATE
  // ====================

  setState(state, options = {}) {

    // ====================
    // SAME STATE
    // ====================

    if (
      this.currentState ===
      state
    ) {

      return;

    }

    // ====================
    // STORE STATE
    // ====================

    this.currentState =
      state;

    console.log(
      'STATE:',
      state
    );

    // emotion lifecycle is owned by DialogueManager; do not reset here

    // ====================
    // STATE MACHINE
    // ====================

    switch (state) {

      // ====================
      // IDLE
      // ====================

      case 'idle':

        this.animationManager.play(

          'idle',

          {
            loop: true
          }

        );

      break;

      // ====================
      // TALKING
      // ====================

      case 'talking':

        this.animationManager.play(

          'talking',

          {
            loop: true
          }

        );

      break;

      // ====================
      // THINKING
      // ====================

      case 'thinking':

        this.animationManager.play(

          'thinking',

          {
            loop: false
          }

        );

      break;

      // ====================
      // HAPPY
      // ====================

      case 'happy':

        this.expressionManager.set(
          'happy',
          options.emotionIntensity ?? 1
        );

        this.animationManager.play(

          'happy',

          {
            loop: false
          }

        );

      break;

      // ====================
      // WAVING
      // ====================

      case 'waving':

        this.animationManager.play(

          'waving',

          {
            loop: false
          }

        );

      break;

      // ====================
      // REACTING
      // ====================

      case 'reacting':

        this.expressionManager.set(
          'surprised',
          options.emotionIntensity ?? 1
        );

        this.animationManager.play(

          'reacting',

          {
            loop: false
          }

        );

      break;

      // ====================
      // RELAXED
      // ====================

      case 'relaxed':

        this.expressionManager.set(
          'relaxed',
          options.emotionIntensity ?? 1
        );

        this.animationManager.play(

          'idle',

          {
            loop: true
          }

        );

      break;

      // ====================
      // DEFAULT
      // ====================

      default:

        console.warn(
          `Unknown state: ${state}`
        );

        this.animationManager.play(

          'idle',

          {
            loop: true
          }

        );

      break;

    }

  }

  // ====================
  // RESET STATE
  // ====================

  reset() {

    this.setState(
      'idle'
    );

  }

}