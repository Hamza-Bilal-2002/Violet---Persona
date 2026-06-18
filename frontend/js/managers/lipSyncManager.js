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

    // Higher FFT size gives finer frequency resolution so the
    // spectral centroid calculation below can distinguish vowel
    // formants from sibilants more accurately.

    this.analyser.fftSize =
      1024;

    // Keep the analyser's own smoothing light — the per-frame lerp
    // in update() is the primary smoothing control. Running both
    // at 0.6 compounds into a sluggish, always-partially-open mouth.

    this.analyser.smoothingTimeConstant =
      0.35;

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

      // Speech band: skip DC + sub-bass rumble (bottom 1%),
      // top out at 60% of bins (well above speech ceiling
      // regardless of sample rate — avoids pure noise bins).

      const speechStart =
        Math.max(2, Math.floor(bins * 0.01));

      const speechEnd =
        Math.floor(bins * 0.6);

      // Compute speech-band amplitude AND spectral centroid in
      // one pass. The centroid (weighted average bin position,
      // normalised 0→1 within the speech band) tells us WHERE
      // in the spectrum the energy is concentrated:
      //   near 0 → low-frequency → open vowels (aa)
      //   near 0.5 → mid-frequency → rounded vowels (oh)
      //   near 1 → high-frequency → sibilants / consonants (ee)

      let energySum = 0;
      let weightedSum = 0;
      const bandWidth = speechEnd - speechStart;

      for (
        let i = speechStart;
        i < speechEnd;
        i++
      ) {

        const v =
          this.frequencyData[i] / 255;

        energySum += v;
        weightedSum += v * (i - speechStart);

      }

      const amplitude =
        energySum / bandWidth; // 0–1

      // Silence gate — below this the mouth stays closed.
      // Prevents the subtle "always mumbling" artifact when
      // the audio has low-level noise or breath content.

      const SILENCE_GATE = 0.04;

      const volume =
        amplitude < SILENCE_GATE
          ? 0
          : Math.min(
              1,
              (amplitude - SILENCE_GATE) /
              (1 - SILENCE_GATE)
            );

      const scale =
        volume * this.strength;

      if (scale < 0.001) {

        // Hard zero — skip centroid math entirely.
        aaTarget = 0;
        ohTarget = 0;
        eeTarget = 0;

      } else {

        // Spectral centroid: 0 = all energy at speechStart,
        // 1 = all energy at speechEnd. Defaults to 0.5 on silence.

        const centroid =
          energySum > 0.001
            ? weightedSum / (energySum * bandWidth)
            : 0.5;

        // Map centroid to per-viseme weights using soft ramps
        // that overlap so transitions between shapes are smooth:
        //   aa peaks at centroid 0   (low-freq / open vowels)
        //   oh peaks at centroid 0.5 (mid-freq / rounded vowels)
        //   ee peaks at centroid 1   (high-freq / consonants)

        const aaW =
          Math.max(0, 1 - centroid / 0.5);

        const eeW =
          Math.max(0, (centroid - 0.5) / 0.5);

        const ohW =
          Math.max(0, 1 - Math.abs(centroid - 0.5) * 3.5);

        // Normalise weights so they sum to 1, then scale by volume.
        // This keeps total mouth motion proportional to amplitude —
        // no over-driving when multiple bands are active.

        const wTotal =
          aaW + ohW + eeW;

        if (wTotal > 0.001) {

          aaTarget = (aaW / wTotal) * scale;
          ohTarget = (ohW / wTotal) * scale;
          eeTarget = (eeW / wTotal) * scale;

        } else {

          aaTarget = scale;
          ohTarget = 0;
          eeTarget = 0;

        }

      }

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
  // AMPLITUDE QUERY
  // ======================
  //
  // Returns the current smoothed mouth-open amount (0-1).
  // aa is the primary "mouth open" viseme so its smoothed
  // value is a reliable envelope of speech amplitude.
  // DialogueManager reads this each frame to couple emotion
  // intensity to speech loudness (Option 2 variation).

  getAmplitude() {

    return this._smoothed.aa;

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
