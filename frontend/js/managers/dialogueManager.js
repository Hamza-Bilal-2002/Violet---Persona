export class DialogueManager {

  constructor({

    animationManager,
    expressionManager,
    lipSyncManager,

  }) {

    // ======================
    // MANAGERS
    // ======================

    this.animationManager =
      animationManager;

    this.expressionManager =
      expressionManager;

    this.lipSyncManager =
      lipSyncManager;

    // ======================
    // STATE
    // ======================

    this.queue = [];

    this.currentMessage =
      null;

    this.currentUtterance =
      null;

    this.currentAnimation =
      null;

    this.isSpeaking =
      false;

    // ======================
    // DEFAULTS
    // ======================

    this.defaultAnimation =
      'idle';

    this.defaultEmotion =
      'relaxed';

  }

  // ======================
  // ENQUEUE
  // ======================

  enqueue(message) {

    console.log(
      'ENQUEUE:',
      message
    );

    // emotion can be a string (legacy) or
    // { name, intensity } (variable intensity).
    // normalize to { name, intensity } here so
    // the rest of the pipeline only sees one shape.

    const rawEmotion =
      message.emotion ??
      this.defaultEmotion;

    const normalizedEmotion =

      typeof rawEmotion === 'string'

        ? {
            name: rawEmotion,
            intensity: 1
          }

        : {
            name:
              rawEmotion?.name,

            intensity:
              rawEmotion?.intensity ?? 1
          };

    const finalMessage = {

      id:
        crypto.randomUUID(),

      text:
        message.text || '',

      emotion:
        normalizedEmotion,

      emotionIntensity:
        normalizedEmotion.intensity,

      animation:
        message.animation ||
        'talking',

      priority:
        message.priority || 1,

      interrupt:
        message.interrupt || false,

      createdAt:
        Date.now(),

    };

    // ======================
    // INTERRUPT
    // ======================

    if (
      finalMessage.interrupt
    ) {

      console.log(
        'INTERRUPTING CURRENT SPEECH'
      );

      this.stopCurrent();

      // CLEAR OLD QUEUE

      this.queue = [];

      // INSERT FIRST

      this.queue.unshift(
        finalMessage
      );

      // FORCE PROCESS

      setTimeout(
        () => {

          this.processQueue();

        },
        10
      );

      return;

    }

    // ======================
    // NORMAL QUEUE
    // ======================

    this.queue.push(
      finalMessage
    );

    // PRIORITY SORT

    this.queue.sort(

      (a, b) =>

        b.priority -
        a.priority

    );

    this.processQueue();

  }

  // ======================
  // PROCESS QUEUE
  // ======================

  processQueue() {

    // ALREADY SPEAKING

    if (
      this.isSpeaking
    ) {

      return;

    }

    // EMPTY QUEUE

    if (
      this.queue.length === 0
    ) {

      this.playIdle();

      return;

    }

    // NEXT MESSAGE

    const nextMessage =
      this.queue.shift();

    this.currentMessage =
      nextMessage;

    this.speak(
      nextMessage
    );

  }

  // ======================
  // SPEAK
  // ======================

  speak(message) {

    console.log(
      'SPEAKING:',
      message
    );

    this.isSpeaking =
      true;

    // ======================
    // ANIMATION
    // ======================

    this.playAnimation(
      message.animation
    );

    // ======================
    // EMOTION
    // ======================

    this.playEmotion(
      message.emotion
    );

    // ======================
    // TTS
    // ======================

    const utterance =

      new SpeechSynthesisUtterance(
        message.text
      );

    // SETTINGS

    utterance.rate =
      1.0;

    utterance.pitch =
      1.0;

    utterance.volume =
      1.0;

    // ======================
    // EVENTS
    // ======================

    utterance.onstart =
      () => {

        console.log(
          'TTS STARTED'
        );

        this.lipSyncManager
          ?.attachUtterance(
            utterance
          );

      };

    utterance.onend =
      () => {

        console.log(
          'TTS FINISHED'
        );

        this.finishMessage();

      };

    utterance.onerror =
      (err) => {

        // IGNORE MANUAL
        // INTERRUPTS

        if (
          err.error ===
          'interrupted'
        ) {

          console.log(
            'TTS INTERRUPTED'
          );

          return;

        }

        console.error(
          'TTS ERROR:',
          err
        );

        this.finishMessage();

      };

    // STORE

    this.currentUtterance =
      utterance;

    // SPEAK

    speechSynthesis.speak(
      utterance
    );

  }

  // ======================
  // PLAY ANIMATION
  // ======================

  playAnimation(name) {

    const isSameAnimation =

      this.currentAnimation ===
      name;

    if (
      isSameAnimation
    ) {

      console.log(
        'KEEPING CURRENT ANIMATION:',
        name
      );

      return;

    }

    console.log(
      'SWITCHING ANIMATION:',
      name
    );

    const shouldLoop =

      name === 'idle';

    this.animationManager.play(

      name,

      {
        loop: shouldLoop,
        fade: 0.6
      }

    );

    this.currentAnimation =
      name;

  }

  // ======================
  // PLAY EMOTION
  // ======================

  playEmotion(emotion) {

    if (
      !emotion ||
      !emotion.name ||
      !this.expressionManager
    ) {

      return;

    }

    this.expressionManager.set(
      emotion.name,
      emotion.intensity ?? 1
    );

  }

  // ======================
  // FINISH MESSAGE
  // ======================

  finishMessage() {

    this.lipSyncManager
      ?.detach();

    this.isSpeaking =
      false;

    this.currentMessage =
      null;

    this.currentUtterance =
      null;

    // RESET EMOTIONS

    this.expressionManager
      ?.resetEmotions();

    // CHECK NEXT

    const nextMessage =
      this.queue[0];

    // RETURN TO IDLE
    // ONLY IF QUEUE EMPTY

    if (
      !nextMessage
    ) {

      this.playIdle();

    }

    this.processQueue();

  }

  // ======================
  // STOP CURRENT
  // ======================

  stopCurrent() {

    this.lipSyncManager
      ?.detach();

    // STOP TTS

    speechSynthesis.cancel();

    // RESET STATE

    this.isSpeaking =
      false;

    this.currentMessage =
      null;

    this.currentUtterance =
      null;

    // RESET EMOTIONS

    this.expressionManager
      ?.resetEmotions();

    // RETURN IDLE

    this.playIdle();

  }

  // ======================
  // PLAY IDLE
  // ======================

  playIdle() {

    this.playAnimation(
      this.defaultAnimation
    );

  }

}