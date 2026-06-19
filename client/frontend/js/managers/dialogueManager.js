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

    // Pending timer for a muted (text-mode) message's hold duration.
    this._mutedTimer =
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

    // True only once audio has actually started playing.
    // Guards playAnimation/playEmotion and the per-frame variation
    // update so neither fires during the Piper synthesis wait.

    this._ttsStarted =
      false;

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

    // ======================
    // IDLE ANIMATION
    // ======================
    //
    // When Violet hasn't been interacted with for _idleThreshold
    // seconds and isn't currently speaking, she plays the 'happy'
    // animation once as a passive ambient reaction. No speech — just
    // the cute dance. The timer resets after each trigger so she
    // repeats roughly every _idleThreshold seconds of inactivity.
    // resetIdle() is called externally (AvatarRuntime) on any user
    // interaction: wake word, text input, voice input start.

    this._idleElapsed =
      0;

    this._idleThreshold =
      180; // 3 minutes

  }

  // ======================
  // IDLE RESET
  // ======================

  resetIdle() {

    this._idleElapsed = 0;

  }

  // ======================
  // ENQUEUE
  // ======================

  enqueue(message) {

    console.debug(
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

      // Text mode: muted message. Drives emotion + body animation but
      // plays no audio and attaches no lip-sync (mouth stays still).
      muted:
        message.muted || false,

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

      console.debug(
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

    console.debug(
      'SPEAKING:',
      message
    );

    this.isSpeaking =
      true;

    // Reset variation clock so each new message starts the
    // sine wave from the same phase — avoids a jarring
    // mid-cycle jump when the emotion name or intensity changes.

    this._ttsStarted =
      false;

    this._emotionTime =
      0;

    this._baseEmotionName =
      message.emotion?.name || null;

    this._baseEmotionIntensity =
      message.emotion?.intensity ?? 1;

    // Text mode: muted. Emote + animate, no audio, no lip-sync.
    if (message.muted) {

      this._speakMuted(message);

      return;

    }

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

  // Muted playback (text mode). No audio and no lip-sync — the avatar
  // just emotes and body-animates while the text shows in the chatbox.
  // We hold for a duration that roughly tracks the message length, then
  // drain the queue exactly like the TTS paths do via finishMessage().
  _speakMuted(message) {

    this._ttsStarted = true;

    this.playAnimation(message.animation);
    this.playEmotion(message.emotion);

    const words =
      (message.text || '')
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .length;

    // ~320ms/word, clamped so very short or very long replies still feel
    // natural. Mouth stays still (no lip-sync attached).
    const ms =
      Math.min(7000, Math.max(1600, words * 320));

    this._mutedTimer =
      setTimeout(
        () => {
          this._mutedTimer = null;
          this.finishMessage();
        },
        ms
      );

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

        console.debug(
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

      // audio.play() resolves the moment playback begins —
      // start animation and emotion in sync with the first sample.

      this._ttsStarted = true;

      this.playAnimation(message.animation);

      this.playEmotion(message.emotion);

      console.debug(
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

        this._ttsStarted = true;

        this.playAnimation(message.animation);

        this.playEmotion(message.emotion);

        this.lipSyncManager
          ?.attachUtterance(utterance);

        console.debug(
          'TTS STARTED (browser)'
        );

      };

    utterance.onend =
      () => {

        console.debug(
          'TTS FINISHED (browser)'
        );

        this.finishMessage();

      };

    utterance.onerror =
      (err) => {

        if (err.error === 'interrupted') {

          console.debug(
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

      console.debug(
        'KEEPING CURRENT ANIMATION:',
        name
      );

      return;

    }

    console.debug(
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

    this._ttsStarted =
      false;

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

    this._ttsStarted =
      false;

    this._baseEmotionName =
      null;

    this._baseEmotionIntensity =
      0;

    this._emotionTime =
      0;

    // Cancel a pending muted (text-mode) hold timer.

    if (this._mutedTimer) {

      clearTimeout(this._mutedTimer);

      this._mutedTimer =
        null;

    }

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

    // Idle animation — accumulate time when not speaking.
    // When the threshold is reached, play the 'happy' animation once
    // (no speech) so Violet doesn't feel like a frozen statue.

    if (!this.isSpeaking) {

      this._idleElapsed += delta;

      if (this._idleElapsed >= this._idleThreshold) {

        this._idleElapsed = 0;
        this.playAnimation('happy');

      }

      return;

    }

    if (
      !this._ttsStarted ||
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