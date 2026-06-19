/**
 * WakeWordClient
 *
 * Continuous wake-word listener. Opens the mic, runs the audio
 * through an AudioWorklet that produces 1280-sample Int16 PCM
 * frames at 16 kHz mono, streams those frames over a WebSocket to
 * the wake/ Docker service (openwakeword), and fires onWake when
 * the service reports a detection.
 *
 * Lifecycle:
 *   const wake = new WakeWordClient({
 *     url: 'ws://localhost:8003/ws',
 *     onWake: (event) => voiceFlow.trigger(),
 *   });
 *   await wake.start();   // opens mic + WS, starts streaming
 *   wake.stop();          // closes mic + WS, releases resources
 *
 * Coexistence with MicCapture:
 *   getUserMedia in Chromium/Electron supports multiple concurrent
 *   streams against the same device, so the PTT MicCapture stream
 *   and this continuous wake stream can run side by side. Each owns
 *   its own MediaStream and releases its own tracks.
 *
 * Privacy posture:
 *   Off by default. The user opts in via the tray "Wake Word"
 *   checkbox — we don't open the mic without explicit user intent.
 */

const WORKLET_URL =
  new URL(
    './wakeProcessor.js',
    import.meta.url
  ).href;

const RECONNECT_MS =
  2000;

export class WakeWordClient {

  constructor({
    url,
    onWake,
    onStatusChange,
  } = {}) {

    if (!url) {

      throw new Error(
        'WakeWordClient: url is required'
      );

    }

    this.url =
      url;

    this.onWake =
      onWake ||
      (() => {});

    this.onStatusChange =
      onStatusChange ||
      (() => {});

    this._ws =
      null;

    this._audioCtx =
      null;

    this._stream =
      null;

    this._source =
      null;

    this._workletNode =
      null;

    this._running =
      false;

    this._reconnectTimer =
      null;

  }

  // ======================
  // START
  // ======================

  async start() {

    if (this._running) {

      return;

    }

    this._running =
      true;

    try {

      // ----- AudioContext at 16 kHz -----
      //
      // The browser will resample input from the device's native
      // rate (usually 48 kHz) down to 16 kHz inside the audio
      // graph. The AudioWorklet then sees 16 kHz mono samples
      // directly.

      const AudioCtx =
        window.AudioContext ||
        window.webkitAudioContext;

      this._audioCtx =
        new AudioCtx({
          sampleRate: 16000,
        });

      // Diagnostics: Chromium honors the requested sampleRate in
      // most cases but some device configurations force a different
      // rate. If actual !== 16000 the worklet will see wrong-rate
      // audio and openwakeword scores will collapse to near zero.

      console.log(
        'WakeWordClient: AudioContext state=' + this._audioCtx.state +
        ' sampleRate=' + this._audioCtx.sampleRate +
        ' (requested 16000)'
      );

      // ----- Load the worklet processor -----

      console.log(
        'WakeWordClient: loading worklet from ' + WORKLET_URL
      );

      await this._audioCtx.audioWorklet
        .addModule(WORKLET_URL);

      console.log(
        'WakeWordClient: worklet loaded'
      );

      // ----- Open the mic -----
      //
      // AEC / noise suppression / AGC are all OFF for wake. Those
      // filters tend to suppress soft "hey jarvis" utterances and
      // we'd rather give the model raw audio to score.

      this._stream =
        await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation:
              false,
            noiseSuppression:
              false,
            autoGainControl:
              false,
            channelCount:
              1,
          },
        });

      // Diagnostics: which device + what settings the OS actually
      // produced. A muted: true track or an unexpected device label
      // (e.g. virtual driver) is the usual root cause of zero wake
      // detections despite the rest of the chain looking healthy.

      try {

        const tracks =
          this._stream.getAudioTracks();

        console.log(
          'WakeWordClient: audio tracks',
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
          'WakeWordClient: track diagnostics threw',
          err
        );

      }

      // ----- Wire the graph -----

      this._source =
        this._audioCtx
          .createMediaStreamSource(this._stream);

      this._workletNode =
        new AudioWorkletNode(
          this._audioCtx,
          'wake-processor'
        );

      this._source.connect(
        this._workletNode
      );

      // Intentionally NOT connecting workletNode to
      // audioCtx.destination — we don't want to play the mic
      // back through the speakers.

      // ----- Open the WebSocket -----

      this._connectWebSocket();

      // ----- Pipe frames out -----
      //
      // Periodically log a heartbeat with frames-sent + peak Int16
      // amplitude observed across the last batch. Peak ~0 means the
      // worklet is seeing silence (wrong device, muted, etc.); peak
      // in the thousands or higher means real audio is flowing.

      this._framesSent =
        0;

      this._batchFrameCount =
        0;

      this._batchPeakAmp =
        0;

      this._workletNode.port.onmessage =
        (event) => {

          if (
            this._ws &&
            this._ws.readyState === WebSocket.OPEN
          ) {

            const buf =
              event.data;

            // Peek peak amplitude before transferring. We read the
            // view first, send the buffer second — transferable
            // semantics make the local view unusable after send.

            try {

              const view =
                new Int16Array(buf);

              let peak =
                0;

              for (let i = 0; i < view.length; i++) {

                const a =
                  Math.abs(view[i]);

                if (a > peak) {
                  peak = a;
                }

              }

              if (peak > this._batchPeakAmp) {
                this._batchPeakAmp = peak;
              }

              this._batchFrameCount += 1;

              this._framesSent += 1;

              if (this._batchFrameCount >= 50) {

                console.log(
                  `WakeWordClient: streaming — ` +
                  `frames=${this._framesSent} ` +
                  `batchPeak=${this._batchPeakAmp} ` +
                  `(0=silence, 32767=clipping)`
                );

                this._batchFrameCount = 0;

                this._batchPeakAmp = 0;

              }

            } catch (err) {

              // never let diagnostics break the audio path
            }

            this._ws.send(buf);

          }

        };

      console.log(
        'WakeWordClient: started'
      );

    } catch (err) {

      console.error(
        'WakeWordClient: start failed',
        err
      );

      this.stop();

      throw err;

    }

  }

  // ======================
  // STOP
  // ======================

  stop() {

    this._running =
      false;

    this._teardownWebSocket();

    if (this._workletNode) {

      try {
        this._workletNode.disconnect();
      } catch (err) {
        // ignore
      }

      this._workletNode =
        null;

    }

    if (this._source) {

      try {
        this._source.disconnect();
      } catch (err) {
        // ignore
      }

      this._source =
        null;

    }

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

    if (this._audioCtx) {

      try {
        this._audioCtx.close();
      } catch (err) {
        // ignore
      }

      this._audioCtx =
        null;

    }

    console.log(
      'WakeWordClient: stopped'
    );

  }

  // ======================
  // WEBSOCKET
  // ======================

  _connectWebSocket() {

    if (!this._running) {

      return;

    }

    const ws =
      new WebSocket(this.url);

    ws.binaryType =
      'arraybuffer';

    ws.addEventListener(
      'open',
      () => {

        console.log(
          'WakeWordClient: ws open'
        );

        this.onStatusChange('connected');

      }
    );

    ws.addEventListener(
      'message',
      (event) => {

        let msg;

        try {

          msg =
            JSON.parse(event.data);

        } catch (err) {

          console.warn(
            'WakeWordClient: bad message',
            event.data
          );

          return;

        }

        if (msg.type === 'wake') {

          console.log(
            `WakeWordClient: wake "${msg.model}" ` +
            `score=${msg.score.toFixed(3)}`
          );

          try {
            this.onWake(msg);
          } catch (err) {
            console.error(
              'WakeWordClient: onWake threw',
              err
            );
          }

        }

      }
    );

    ws.addEventListener(
      'close',
      () => {

        console.warn(
          'WakeWordClient: ws closed'
        );

        this._ws =
          null;

        if (!this._running) {

          return;

        }

        // Wake container restart or transient network blip.
        // Single fixed-interval retry — exponential backoff is
        // overkill for a local-only Docker service.

        this._reconnectTimer =
          setTimeout(
            () => {

              this._reconnectTimer =
                null;

              this._connectWebSocket();

            },
            RECONNECT_MS
          );

      }
    );

    ws.addEventListener(
      'error',
      (err) => {

        console.error(
          'WakeWordClient: ws error',
          err
        );

      }
    );

    this._ws =
      ws;

  }

  _teardownWebSocket() {

    if (this._reconnectTimer) {

      clearTimeout(this._reconnectTimer);

      this._reconnectTimer =
        null;

    }

    if (this._ws) {

      try {
        this._ws.close();
      } catch (err) {
        // ignore
      }

      this._ws =
        null;

    }

  }

}
