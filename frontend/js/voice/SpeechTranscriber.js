/**
 * SpeechTranscriber
 *
 * Thin wrapper around the speech container's /transcribe endpoint.
 * Takes an audio Blob (typically WebM/Opus from MicCapture) and
 * returns the transcript string.
 *
 * Stateless on purpose — one instance can transcribe many blobs.
 *
 * Usage:
 *   const t = new SpeechTranscriber({
 *     url: 'http://localhost:8002/transcribe',
 *   });
 *   const text = await t.transcribe(blob, mimeType);
 */

export class SpeechTranscriber {

  constructor({
    url,
  } = {}) {

    if (!url) {

      throw new Error(
        'SpeechTranscriber: url is required'
      );

    }

    this.url =
      url;

  }

  async transcribe(blob, mimeType) {

    if (!blob) {

      throw new Error(
        'SpeechTranscriber: blob is required'
      );

    }

    // Build a sensible filename so the multipart part has a proper
    // extension; faster-whisper / ffmpeg use the extension as a
    // codec hint when probing the file.

    const extension =
      (mimeType || 'audio/webm')
        .includes('ogg')
          ? 'ogg'
          : 'webm';

    const formData =
      new FormData();

    formData.append(
      'audio',
      blob,
      `utterance.${extension}`
    );

    let response;

    try {

      response =
        await fetch(
          this.url,
          {
            method: 'POST',
            body: formData,
          }
        );

    } catch (err) {

      console.error(
        'SpeechTranscriber: fetch failed',
        err
      );

      throw new Error(
        `Could not reach speech service at ${this.url}: ${err.message}`
      );

    }

    if (!response.ok) {

      const body =
        await response
          .text()
          .catch(() => '');

      throw new Error(
        `SpeechTranscriber: transcribe returned ` +
        `${response.status} ${response.statusText} ${body}`
      );

    }

    let data;

    try {

      data =
        await response.json();

    } catch (err) {

      throw new Error(
        `SpeechTranscriber: response was not JSON (${err.message})`
      );

    }

    const text =
      (data && typeof data.text === 'string')
        ? data.text
        : '';

    const backendError =
      data && typeof data.error === 'string'
        ? data.error
        : null;

    if (!text) {

      if (backendError) {

        // Speech service replied 200 OK but model loading or
        // transcription itself failed. Don't let it look like empty
        // audio.

        console.error(
          'SpeechTranscriber: backend reported error:',
          backendError
        );

        throw new Error(
          `speech backend error: ${backendError}`
        );

      }

      console.warn(
        'SpeechTranscriber: empty transcript returned'
      );

    }

    return text;

  }

}
