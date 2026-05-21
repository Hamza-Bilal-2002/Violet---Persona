import { AVATAR_CONFIG }
from '../config/avatarConfig.js';

// per-element MediaElementAudioSourceNode cache —
// an audio element can only be wrapped in a source node once
// per AudioContext lifetime, so we dedupe across re-attaches.

const sourceNodeCache =
  new WeakMap();

export class LipSyncManager {

  constructor(
    expressionManager,
    options = {}
  ) {

    // ======================
    // MANAGERS
    // ======================

    this.expressionManager =
      expressionManager;

    // ======================
    // CONFIG
    // ======================

    this.smoothing =
      options.smoothing ??
      AVATAR_CONFIG.lipSync.smoothing;

    this.strength =
      options.strength ??
      AVATAR_CONFIG.lipSync.strength;

    // ======================
    // STATE
    // ======================

    this.attached =
      false;

    this.mode =
      null;

    this.audioElement =
      null;

    this.audioContext =
      null;

    this.analyser =
      null;

    this.frequencyData =
      null;

    this._utterance =
      null;

    this._boundaryPulse =
      0;

    this._smoothed = {

      aa: 0,
      oh: 0,
      ee: 0

    };

  }

  // ======================
  // ATTACH AUDIO
  // ======================

  attachAudio(audioElement) {

    if (!audioElement) {

      return;

    }

    // LAZY CONTEXT

    if (!this.audioContext) {

      const Ctx =

        window.AudioContext ||
        window.webkitAudioContext;

      this.audioContext =
        new Ctx();

    }

    // DEDUPE SOURCE NODE
    // (re-wrapping the same element throws)

    let source =
      sourceNodeCache.get(
        audioElement
      );

    if (!source) {

      source =
        this.audioContext
          .createMediaElementSource(
            audioElement
          );

      sourceNodeCache.set(
        audioElement,
        source
      );

    }

    // ANALYSER

    this.analyser =
      this.audioContext
        .createAnalyser();

    this.analyser.fftSize =
      256;

    this.analyser.smoothingTimeConstant =
      0.6;

    // GRAPH: source -> analyser -> destination
    // (destination kept so audio still plays)

    try {

      source.connect(
        this.analyser
      );

      this.analyser.connect(
        this.audioContext.destination
      );

    } catch (err) {

      // if source was already wired into an
      // analyser from a previous attach, the
      // second connect is harmless — swallow.

      console.warn(
        'LIPSYNC connect warning:',
        err
      );

    }

    this.frequencyData =
      new Uint8Array(
        this.analyser.frequencyBinCount
      );

    this.audioElement =
      audioElement;

    this.mode =
      'audio';

    this.attached =
      true;

  }

  // ======================
  // ATTACH UTTERANCE
  // ======================

  attachUtterance(utterance) {

    if (!utterance) {

      return;

    }

    this._utterance =
      utterance;

    this._boundaryPulse =
      0;

    // on each word boundary, briefly spike
    // the pulse — better than random visemes,
    // honest about lack of formant data.

    utterance.onboundary =
      () => {

        this._boundaryPulse =
          1;

      };

    this.mode =
      'utterance';

    this.attached =
      true;

  }

  // ======================
  // UPDATE
  // ======================

  update(delta) {

    if (
      !this.attached
    ) {

      return;

    }

    let aaTarget = 0;
    let ohTarget = 0;
    let eeTarget = 0;

    // ======================
    // AUDIO MODE
    // ======================

    if (
      this.mode === 'audio' &&
      this.analyser
    ) {

      this.analyser
        .getByteFrequencyData(
          this.frequencyData
        );

      const bins =
        this.frequencyData.length;

      // BAND BOUNDS

      const lowEnd =
        Math.max(
          1,
          Math.floor(bins / 8)
        );

      const midEnd =
        Math.max(
          lowEnd + 1,
          Math.floor(bins / 3)
        );

      const highEnd =
        Math.max(
          midEnd + 1,
          Math.floor((bins * 2) / 3)
        );

      // MEAN HELPERS

      const mean =
        (start, end) => {

          let sum = 0;

          for (
            let i = start;
            i < end;
            i++
          ) {

            sum +=
              this.frequencyData[i];

          }

          return (
            sum /
            (end - start) /
            255
          );

        };

      const low =
        mean(0, lowEnd);

      const mid =
        mean(lowEnd, midEnd);

      const high =
        mean(midEnd, highEnd);

      aaTarget =
        low * this.strength;

      ohTarget =
        mid * this.strength;

      eeTarget =
        high * this.strength;

    }

    // ======================
    // UTTERANCE MODE
    // ======================

    else if (
      this.mode === 'utterance'
    ) {

      // decay pulse — 4/sec to zero

      this._boundaryPulse =
        Math.max(
          0,
          this._boundaryPulse -
          delta * 4
        );

      aaTarget =
        this._boundaryPulse *
        this.strength;

      ohTarget =
        this._boundaryPulse *
        0.4 *
        this.strength;

      eeTarget =
        0;

    }

    // ======================
    // SMOOTH + APPLY
    // ======================

    const s =
      this.smoothing;

    this._smoothed.aa =
      this._smoothed.aa * s +
      aaTarget * (1 - s);

    this._smoothed.oh =
      this._smoothed.oh * s +
      ohTarget * (1 - s);

    this._smoothed.ee =
      this._smoothed.ee * s +
      eeTarget * (1 - s);

    this.expressionManager.set(
      'aa',
      this._smoothed.aa
    );

    this.expressionManager.set(
      'oh',
      this._smoothed.oh
    );

    this.expressionManager.set(
      'ee',
      this._smoothed.ee
    );

    // explicitly zero unused visemes
    // to avoid stale state from the old
    // random-viseme implementation.

    this.expressionManager.set(
      'ih',
      0
    );

    this.expressionManager.set(
      'ou',
      0
    );

  }

  // ======================
  // DETACH
  // ======================

  detach() {

    this.attached =
      false;

    this.mode =
      null;

    // do NOT disconnect the analyser graph —
    // the Web Audio nodes throw if disconnected
    // twice, and the audio element ending is
    // sufficient. We just stop reading.

    this._boundaryPulse =
      0;

    this._smoothed = {

      aa: 0,
      oh: 0,
      ee: 0

    };

    // reset all 5 visemes to 0

    if (this.expressionManager) {

      [
        'aa',
        'ee',
        'ih',
        'oh',
        'ou'
      ].forEach(
        (v) => {

          this.expressionManager.set(
            v,
            0
          );

        }
      );

    }

  }

  // ======================
  // BACK-COMPAT
  // ======================

  stop() {

    // alias for detach() so legacy callers
    // (DialogueManager pre-edit) don't break.

    this.detach();

  }

  start() {

    // intentional no-op — the new API drives
    // lip-sync from attachAudio/attachUtterance.
    // kept so older callers don't throw.

  }

}
