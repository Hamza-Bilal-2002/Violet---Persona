/**
 * AudioWorkletProcessor that buffers Float32 microphone samples and
 * emits exactly-1280-sample Int16 PCM frames to the main thread.
 *
 * 1280 samples / 16000 Hz = 80 ms — the chunk size openwakeword
 * expects per inference call. The AudioContext that owns this node
 * must be created with `{ sampleRate: 16000 }` so the browser does
 * the input resample for us; this processor assumes its inputs are
 * already at 16 kHz mono.
 *
 * AudioWorkletGlobalScope is restricted: no module imports allowed,
 * only the AudioWorkletProcessor base class and registerProcessor.
 */

const FRAME_SAMPLES =
  1280;

class WakeProcessor extends AudioWorkletProcessor {

  constructor() {

    super();

    this._buf =
      [];

  }

  process(inputs) {

    const input =
      inputs[0];

    if (!input || !input[0]) {

      return true;

    }

    const channel =
      input[0];

    for (let i = 0; i < channel.length; i++) {

      this._buf.push(channel[i]);

    }

    while (this._buf.length >= FRAME_SAMPLES) {

      const frame =
        this._buf.splice(0, FRAME_SAMPLES);

      const int16 =
        new Int16Array(FRAME_SAMPLES);

      for (let i = 0; i < FRAME_SAMPLES; i++) {

        const s =
          Math.max(-1, Math.min(1, frame[i]));

        int16[i] =
          s < 0
            ? s * 0x8000
            : s * 0x7fff;

      }

      // Transfer the underlying buffer so we don't pay a copy cost
      // each frame. The processor's own _buf already has the next
      // chunk's samples, so we don't need to keep this one.

      this.port.postMessage(
        int16.buffer,
        [int16.buffer]
      );

    }

    return true;

  }

}

registerProcessor('wake-processor', WakeProcessor);
