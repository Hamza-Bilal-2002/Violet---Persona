export class DialogueManager {

  constructor({

    animationManager,
    expressionManager,
    lipSyncManager,
    ttsClient,
    onQueueIdle,

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

    // Phase 4 Wave 4.2: ttsClient is the Piper container shim. If
    // provided, speak() uses it and the audio-analyser lip-sync
    // path; if synthesis fails or no client is provided, falls
    // back to browser SpeechSynthesisUtterance + boundary-pulse
    // lip-sync (the pre-Piper path).

    this.ttsClient =
      ttsClient || null;

    // ======================
    // CALLBACKS
    // ======================
    //
    // onQueueIdle: fired when finishMessage drains the queue
    // completely (no next message). Phase 3 Wave 3.2 uses this to
    // flush deferred tools (lock_pc / sleep_pc) once the avatar's
    // reply has fully played.

    this.onQueueIdle =
      onQueueIdle ||
      (() => {});

    // ======================
    // STATE
    // ======================

    this.queue = [];

    this.currentMessage =
      null;

    this.currentUtterance =
      null;

    // Phase 4 Wave 4.2: piper path keeps an HTMLAudioElement for
    // the in-flight utterance (separately from currentUtterance,
    // which only applies to the browser-TTS fallback).

    this.currentAudio =
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

    // ======================
    // EXPRESSION VARIATION
    // ======================
    //
    // Option 1 — sine drift: a slow oscillation applied to the
    // base emotion intensity while speaking. Prevents the face from
    // locking into a single static value for the whole sentence.
    //
    // Option 2 — lip coupling: a fraction of the lip-sync amplitude
    // is added on top, so the expression briefly peaks on loud or
    // emphatic speech moments.
    //
    // Both are additive on the base intensity the backend sent.
    // The combined result is clamped to [0, 1].

    this._emotionTime =
      0;

    this._baseEmotionName =
      null;

    this._baseEmotionIntensity =
      0;

    // Sine wave: 0.35 Hz ≈ one gentle cycle every ~2.9 s.
    // Depth of ±0.13 keeps the swing subtle — visible but
    // not distracting.

    this._sineFreq =
      0.35;

    this._sineDepth =
      0.13;

    // Lip coupling: when aa peaks at 1.0, emotion intensity
    // gets a +0.12 bump. Scales linearly with lip amplitude.

    this._lipCoupling =
      0.12;

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
  //
  // Phase 4 Wave 4.2: prefer Piper, fall back to browser TTS.
  // Both paths converge on finishMessage() so the queue drains
  // consistently regardless of which engine handled this turn.

  async speak(message) {

    console.log(
      'SPEAKING:',
      message
    );

    this.isSpeaking =
      true;

    // Reset variation clock so each new message starts the
    // sine wave from the same phase — avoids a jarring
    // mid-cycle jump when the emotion name or intensity changes.

    this._emotionTime =
      0;

    this._baseEmotionName =
      message.emotion?.name || null;

    this._baseEmotionIntensity =
      message.emotion?.intensity ?? 1;

    this.playAnimation(
      message.animation
    );

    this.playEmotion(
      message.emotion
    );

    if (this.ttsClient) {

      try {

        await this._speakViaPiper(message);

        return;

      } catch (err) {

        console.warn(
          'DialogueManager: Piper failed, falling back ' +
          'to browser TTS:',
          err && err.message ? err.message : err
        );

        // Continue into the browser-TTS branch below.

      }

    }

    this._speakViaBrowser(message);

  }

  async _speakViaPiper(message) {

    const blob =
      await this.ttsClient.synthesize(message.text);

    const url =
      URL.createObjectURL(blob);

    const audio =
      new Audio(url);

    audio.addEventListener(
      'ended',
      () => {

        URL.revokeObjectURL(url);

        console.log(
          'TTS FINISHED (piper)'
        );

        this.finishMessage();

      }
    );

    audio.addEventListener(
      'error',
      (err) => {

        URL.revokeObjectURL(url);

        console.error(
          'TTS audio error (piper):',
          err
        );

        this.finishMessage();

      }
    );

    this.currentAudio =
      audio;

    // Wire the audio-driven lip-sync path BEFORE play() so the
    // first samples aren't missed by the AnalyserNode.

    this.lipSyncManager
      ?.attachAudio(audio);

    try {

      await audio.play();

      console.log(
        'TTS STARTED (piper)'
      );

    } catch (err) {

      // play() rejects when the browser/Electron blocks autoplay
      // before user interaction. Surface to caller so speak()
      // can fall back to browser TTS — which has its own
      // unlock-via-click handler in RuntimeController.

      URL.revokeObjectURL(url);
      this.currentAudio = null;
      throw err;

    }

  }

  _speakViaBrowser(message) {

    const utterance =
      new SpeechSynthesisUtterance(message.text);

    utterance.rate =
      1.0;

    utterance.pitch =
      1.0;

    utterance.volume =
      1.0;

    utterance.onstart =
      () => {

        console.log(
          'TTS STARTED (browser)'
        );

        this.lipSyncManager
          ?.attachUtterance(utterance);

      };

    utterance.onend =
      () => {

        console.log(
          'TTS FINISHED (browser)'
        );

        this.finishMessage();

      };

    utterance.onerror =
      (err) => {

        if (err.error === 'interrupted') {

          console.log(
            'TTS INTERRUPTED'
          );

          return;

        }

        console.error(
          'TTS ERROR (browser):',
          err
        );

        this.finishMessage();

      };

    this.currentUtterance =
      utterance;

    speechSynthesis.speak(utterance);

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

    this.currentAudio =
      null;

    this._baseEmotionName =
      null;

    this._baseEmotionIntensity =
      0;

    this._emotionTime =
      0;

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

      try {

        this.onQueueIdle();

      } catch (err) {

        console.error(
          'DialogueManager: onQueueIdle threw',
          err
        );

      }

    }

    this.processQueue();

  }

  // ======================
  // STOP CURRENT
  // ======================

  stopCurrent() {

    this.lipSyncManager
      ?.detach();

    this._baseEmotionName =
      null;

    this._baseEmotionIntensity =
      0;

    this._emotionTime =
      0;

    // Stop Piper audio if it was the current path.

    if (this.currentAudio) {

      try {

        this.currentAudio.pause();
        this.currentAudio.src = '';

      } catch (err) {

        // ignore — already torn down
      }

      this.currentAudio =
        null;

    }

    // Stop browser TTS if it was the current path. Safe to call
    // even when nothing is queued — it's idempotent.

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

  // ======================
  // UPDATE (per-frame)
  // ======================
  //
  // Called every frame by the update loop while the avatar is alive.
  // Only does real work during speech — idles out immediately otherwise.
  //
  // Combines two effects:
  //   Option 1 — sine drift: slow oscillation on the base intensity
  //   Option 2 — lip coupling: peaks emotion slightly on loud speech

  update(delta) {

    if (
      !this.isSpeaking ||
      !this._baseEmotionName ||
      !this.expressionManager
    ) {

      return;

    }

    this._emotionTime +=
      delta;

    // Option 1: sine wave drifts the intensity gently up and down.

    const sine =
      Math.sin(
        this._emotionTime *
        this._sineFreq *
        Math.PI * 2
      );

    const sineContrib =
      sine * this._sineDepth;

    // Option 2: add a fraction of the current lip-sync amplitude.
    // getAmplitude() returns 0 when not attached, so this is safe
    // to call regardless of which TTS path is active.

    const lipAmp =
      this.lipSyncManager
        ? this.lipSyncManager.getAmplitude()
        : 0;

    const lipContrib =
      lipAmp * this._lipCoupling;

    const intensity =
      Math.max(
        0,
        Math.min(
          1,
          this._baseEmotionIntensity +
          sineContrib +
          lipContrib
        )
      );

    this.expressionManager.set(
      this._baseEmotionName,
      intensity
    );

  }

}