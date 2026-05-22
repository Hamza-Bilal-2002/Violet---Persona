/**
 * MicCapture
 *
 * Records a single utterance from the user's microphone. Records
 * until RMS-amplitude VAD detects a stretch of silence (default
 * 1.5 s) OR a hard max duration is hit (default 15 s).
 *
 * Designed for one-shot usage:
 *   const mic = new MicCapture();
 *   const { blob, mimeType, durationMs } = await mic.start();
 *
 * Lifecycle:
 *   - start()  opens the mic stream, starts MediaRecorder, runs the
 *              VAD loop, resolves with the captured Blob on silence
 *              or max duration, rejects on error or abort()
 *   - abort()  stops everything in flight; pending start() rejects
 *
 * VAD strategy is deliberately simple: per-frame RMS over the time-
 * domain audio buffer compared to a fixed threshold. We require at
 * least `minSpeechMs` of audio before we'll trust silence detection
 * so a slow speaker doesn't get cut off before saying a word.
 *
 * The mic stream tracks are always released on completion. Skipping
 * that leaves the OS mic indicator on indefinitely.
 */

const VAD_TICK_MS =
  50;

const DEFAULTS = {

  silenceThresholdRms:
    0.015,

  silenceDurationMs:
    1500,

  maxDurationMs:
    15000,

  minSpeechMs:
    500,

};

export class MicCapture {

  constructor(options = {}) {

    this.options = {
      ...DEFAULTS,
      ...options,
    };

    this._stream =
      null;

    this._recorder =
      null;

    this._chunks =
      [];

    this._audioCtx =
      null;

    this._analyser =
      null;

    this._vadInterval =
      null;

    this._maxDurationTimer =
      null;

    this._startedAt =
      0;

    this._belowSince =
      null;

    this._aborted =
      false;

    this._resolve =
      null;

    this._reject =
      null;

  }

  // ======================
  // START
  // ======================

  async start() {

    if (
      this._stream ||
      this._recorder
    ) {

      throw new Error(
        'MicCapture: start() already in progress'
      );

    }

    // Open the mic. echoCancellation + noiseSuppression are both
    // standard on getUserMedia; they help Whisper a lot in noisy
    // rooms. The Promise is the contract: callers await it.

    let stream;

    try {

      stream =
        await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation:
              true,
            noiseSuppression:
              true,
          },
        });

    } catch (err) {

      console.error(
        'MicCapture: getUserMedia failed',
        err
      );

      throw err;

    }

    this._stream =
      stream;

    // Diagnostics: which device + what the OS thinks of the track.
    // A muted: true track is the giveaway that Chromium gave us a
    // silenced stream (permission, OS privacy, or device disabled).

    try {

      const tracks =
        stream.getAudioTracks();

      console.log(
        'MicCapture: audio tracks',
        tracks.map((t) => ({
          label:
            t.label,
          enabled:
            t.enabled,
          muted:
            t.muted,
          readyState:
            t.readyState,
          settings:
            typeof t.getSettings === 'function'
              ? t.getSettings()
              : null,
        }))
      );

    } catch (err) {

      console.warn(
        'MicCapture: track diagnostics threw',
        err
      );

    }

    // Pick a MediaRecorder mimeType. Chrome and Electron prefer
    // webm/opus. We try the most-supported codec string first,
    // fall back to plain webm, then let the browser default.

    const mimeType =
      pickMimeType();

    try {

      this._recorder =
        new MediaRecorder(
          stream,
          mimeType
            ? { mimeType }
            : undefined
        );

    } catch (err) {

      this._cleanup();

      console.error(
        'MicCapture: MediaRecorder construction failed',
        err
      );

      throw err;

    }

    this._chunks = [];

    this._recorder.addEventListener(
      'dataavailable',
      (event) => {

        if (
          event.data &&
          event.data.size > 0
        ) {

          this._chunks.push(
            event.data
          );

        }

      }
    );

    // Promise that resolves on natural stop (silence or max). The
    // recorder's onstop fires after the final dataavailable, so
    // we resolve there.

    const donePromise =
      new Promise(
        (resolve, reject) => {

          this._resolve =
            resolve;

          this._reject =
            reject;

        }
      );

    this._recorder.addEventListener(
      'stop',
      () => {

        const finalMimeType =
          this._recorder &&
          this._recorder.mimeType
            ? this._recorder.mimeType
            : (mimeType || 'audio/webm');

        const blob =
          new Blob(
            this._chunks,
            { type: finalMimeType }
          );

        const durationMs =
          performance.now() -
          this._startedAt;

        this._cleanup();

        if (this._aborted) {

          // abort() already rejected for us — swallow this resolve.
          return;

        }

        if (this._resolve) {

          this._resolve({
            blob,
            mimeType:
              finalMimeType,
            durationMs,
          });

        }

      }
    );

    this._recorder.addEventListener(
      'error',
      (err) => {

        console.error(
          'MicCapture: recorder error',
          err
        );

        this._cleanup();

        if (this._reject) {

          this._reject(
            err.error || err
          );

        }

      }
    );

    // Set up the VAD pipeline. AudioContext + AnalyserNode on a
    // MediaStreamAudioSourceNode is the standard pattern. fftSize
    // controls the time-domain buffer length; 1024 samples is
    // enough resolution to compute RMS without being heavy.

    try {

      const AudioCtx =
        window.AudioContext ||
        window.webkitAudioContext;

      this._audioCtx =
        new AudioCtx();

      console.log(
        'MicCapture: AudioContext state after construction =',
        this._audioCtx.state,
        'sampleRate =',
        this._audioCtx.sampleRate
      );

      const source =
        this._audioCtx
          .createMediaStreamSource(stream);

      this._analyser =
        this._audioCtx.createAnalyser();

      this._analyser.fftSize =
        1024;

      source.connect(
        this._analyser
      );

    } catch (err) {

      this._cleanup();

      console.error(
        'MicCapture: failed to set up VAD audio graph',
        err
      );

      throw err;

    }

    this._startedAt =
      performance.now();

    this._belowSince =
      null;

    this._peakRms =
      0;

    this._tickCount =
      0;

    // Recorder + VAD loop both start now. We use a short timeslice
    // (250ms) so onstop has a full payload immediately rather than
    // having to wait for the final flush.

    this._recorder.start(
      250
    );

    this._vadInterval =
      setInterval(
        () => {

          this._tickVAD();

        },
        VAD_TICK_MS
      );

    this._maxDurationTimer =
      setTimeout(
        () => {

          console.log(
            'MicCapture: max duration hit, stopping'
          );

          this._stopRecorder();

        },
        this.options.maxDurationMs
      );

    return donePromise;

  }

  // ======================
  // VAD TICK
  // ======================

  _tickVAD() {

    if (
      !this._analyser ||
      !this._recorder ||
      this._recorder.state !== 'recording'
    ) {

      return;

    }

    const bufferLength =
      this._analyser.fftSize;

    const buffer =
      new Float32Array(bufferLength);

    this._analyser.getFloatTimeDomainData(
      buffer
    );

    // RMS over the time-domain buffer. Speech in a normal room sits
    // around 0.05-0.3; ambient room noise sits well below 0.015.

    let sumSquares =
      0;

    for (let i = 0; i < bufferLength; i++) {

      const v =
        buffer[i];

      sumSquares +=
        v * v;

    }

    const rms =
      Math.sqrt(
        sumSquares / bufferLength
      );

    if (rms > this._peakRms) {

      this._peakRms =
        rms;

    }

    this._tickCount += 1;

    const elapsed =
      performance.now() -
      this._startedAt;

    // Hold the silence-detection trigger until we've had at least
    // minSpeechMs of recording. Without this, a slow speaker who
    // pauses before starting would get cut off immediately.

    if (
      elapsed < this.options.minSpeechMs
    ) {

      this._belowSince =
        null;

      return;

    }

    if (
      rms < this.options.silenceThresholdRms
    ) {

      if (
        this._belowSince === null
      ) {

        this._belowSince =
          performance.now();

      } else if (
        performance.now() - this._belowSince >=
        this.options.silenceDurationMs
      ) {

        // Silence has held long enough — wrap it up.

        console.log(
          'MicCapture: silence detected, stopping ' +
          `(peakRms=${this._peakRms.toFixed(4)}, ` +
          `threshold=${this.options.silenceThresholdRms}, ` +
          `ticks=${this._tickCount}, ` +
          `audioCtxState=${this._audioCtx ? this._audioCtx.state : 'null'})`
        );

        this._stopRecorder();

      }

    } else {

      // Above threshold — reset the silence timer.

      this._belowSince =
        null;

    }

  }

  // ======================
  // ABORT
  // ======================

  abort() {

    if (this._aborted) {

      return;

    }

    this._aborted =
      true;

    if (this._reject) {

      this._reject(
        new Error('MicCapture: aborted')
      );

    }

    this._stopRecorder();

  }

  // ======================
  // INTERNAL
  // ======================

  _stopRecorder() {

    // Triggers the 'stop' event which finalizes the blob. Safe to
    // call multiple times — guarded by recorder.state.

    if (
      this._recorder &&
      this._recorder.state === 'recording'
    ) {

      try {

        this._recorder.stop();

      } catch (err) {

        // chromium occasionally throws if state changed under us
        console.warn(
          'MicCapture: recorder.stop() threw',
          err
        );

      }

    }

  }

  _cleanup() {

    if (this._vadInterval) {

      clearInterval(
        this._vadInterval
      );

      this._vadInterval =
        null;

    }

    if (this._maxDurationTimer) {

      clearTimeout(
        this._maxDurationTimer
      );

      this._maxDurationTimer =
        null;

    }

    if (this._audioCtx) {

      try {
        this._audioCtx.close();
      } catch (err) {
        // ignore
      }

      this._audioCtx =
        null;

    }

    this._analyser =
      null;

    // Release the mic stream so the OS mic indicator goes off.

    if (this._stream) {

      this._stream
        .getTracks()
        .forEach(
          (track) => {

            try {
              track.stop();
            } catch (err) {
              // ignore
            }

          }
        );

      this._stream =
        null;

    }

    this._recorder =
      null;

  }

}

// ======================
// HELPERS
// ======================

function pickMimeType() {

  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
  ];

  if (
    typeof MediaRecorder === 'undefined' ||
    typeof MediaRecorder.isTypeSupported !== 'function'
  ) {

    return null;

  }

  for (const candidate of candidates) {

    if (
      MediaRecorder.isTypeSupported(candidate)
    ) {

      return candidate;

    }

  }

  return null;

}
