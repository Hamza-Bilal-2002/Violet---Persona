export class ExpressionManager {

  constructor(vrm) {

    this.vrm = vrm;

    this.expressionManager =
      vrm.expressionManager;

    // ONLY ONE OF THESE
    // SHOULD EXIST AT A TIME

    this.emotionExpressions = [

      'happy',
      'angry',
      'sad',
      'relaxed',
      'surprised'

    ];

    // THESE CAN STACK

    this.visemeExpressions = [

      'aa',
      'ee',
      'ih',
      'oh',
      'ou'

    ];

  }

  /**
   * Set expression
   */

  set(name, value) {

    if (
      !this.expressionManager
    ) return;

    // ====================
    // EMOTION HANDLING
    // ====================

    if (
      this.emotionExpressions
        .includes(name)
    ) {

      // RESET ALL OTHER
      // EMOTIONS

      this.emotionExpressions
        .forEach((emotion) => {

        if (emotion !== name) {

          this.expressionManager
            .setValue(
              emotion,
              0
            );

        }

      });

    }

    // APPLY

    this.expressionManager
      .setValue(
        name,
        value
      );

  }

  /**
   * Blink animation
   */

  async blink() {

    this.set(
      'blink',
      1
    );

    await new Promise(
      (resolve) => {

      setTimeout(
        resolve,
        120
      );

    });

    this.set(
      'blink',
      0
    );

  }

  /**
   * Reset emotions
   */

  resetEmotions() {

    this.emotionExpressions
      .forEach((emotion) => {

      this.expressionManager
        .setValue(
          emotion,
          0
        );

    });

  }

  /**
   * Smooth emotion transition
   */

  async transitionToEmotion(
    targetEmotion,
    duration = 300
  ) {

    this.resetEmotions();

    const steps = 20;

    for (
      let i = 0;
      i <= steps;
      i++
    ) {

      const value =
        i / steps;

      this.expressionManager
        .setValue(
          targetEmotion,
          value
        );

      await new Promise(
        (resolve) => {

        setTimeout(
          resolve,
          duration / steps
        );

      });

    }

  }

}