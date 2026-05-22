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

      // ----- Load the worklet processor -----

      await this._audioCtx.audioWorklet
        .addModule(WORKLET_URL);

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

      this._workletNode.port.onmessage =
        (event) => {

          if (
            this._ws &&
            this._ws.readyState === WebSocket.OPEN
          ) {

            this._ws.send(event.data);

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
