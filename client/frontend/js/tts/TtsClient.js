/**
 * TtsClient
 *
 * Thin wrapper around the tts/ container's /synthesize endpoint.
 * Takes a text string, returns a Blob containing the WAV bytes
 * Piper produced. The caller wraps that blob in an
 * HTMLAudioElement and hands it to LipSyncManager.attachAudio()
 * — that's the audio-driven lip-sync path that was built but
 * unused while we were on browser SpeechSynthesisUtterance.
 *
 * Stateless on purpose — one instance synthesizes any number of
 * utterances.
 *
 * Usage:
 *   const tts = new TtsClient({ url: 'http://localhost:8004/synthesize' });
 *   const blob = await tts.synthesize('Hello, Hamza.');
 *   const audio = new Audio(URL.createObjectURL(blob));
 *   await audio.play();
 */

export class TtsClient {

  constructor({
    url,
  } = {}) {

    if (!url) {

      throw new Error(
        'TtsClient: url is required'
      );

    }

    this.url =
      url;

    // The voice the current personality asked for (set by setVoice() on a
    // personality frame, or by the offline fallback). null -> tts default.
    this.personalityVoice =
      null;

    // A user-chosen GLOBAL override (Settings -> Voice). When set, it wins
    // over whatever any personality specifies — including deep mode and the
    // offline fallback — because every voice path funnels through this
    // client. null/'' means "follow the personality".
    this.override =
      null;

  }

  // The voice actually sent to the tts service: override beats personality.
  get effectiveVoice() {
    return this.override || this.personalityVoice || null;
  }

  // Switch the voice used for subsequent synthesize() calls. Called
  // when a personality frame arrives with that personality's voice.
  setVoice(voice) {

    this.personalityVoice =
      voice || null;

  }

  // Set (or clear with '' / null) the global voice override. Applied
  // immediately to all subsequent synthesize() calls.
  setVoiceOverride(voice) {

    this.override =
      voice || null;

  }

  async synthesize(text) {

    const trimmed =
      (text || '').trim();

    if (!trimmed) {

      throw new Error(
        'TtsClient: text is required'
      );

    }

    let response;

    try {

      response =
        await fetch(
          this.url,
          {
            method:
              'POST',
            headers: {
              'Content-Type':
                'application/json',
            },
            body:
              JSON.stringify(
                this.effectiveVoice
                  ? { text: trimmed, voice: this.effectiveVoice }
                  : { text: trimmed }
              ),
          }
        );

    } catch (err) {

      throw new Error(
        `TtsClient: could not reach ${this.url}: ${err.message}`
      );

    }

    if (!response.ok) {

      const detail =
        await response
          .text()
          .catch(() => '');

      throw new Error(
        `TtsClient: synthesize returned ` +
        `${response.status} ${response.statusText} ${detail}`
      );

    }

    return await response.blob();

  }

}
