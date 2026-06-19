/**
 * VoiceFlow
 *
 * Orchestrates the push-to-talk pipeline:
 *   PTT trigger -> MicCapture -> SpeechTranscriber -> BackendClient
 *
 * State machine (intentionally tiny):
 *   idle       — nothing happening, waiting for trigger
 *   listening  — mic open, recording, VAD watching for silence
 *   thinking   — silence detected, posting blob to /transcribe
 *   speaking   — transcript handed to backend, Violet replying
 *   error      — transient error, will return to idle shortly
 *
 * Re-triggering while listening aborts the current capture and
 * starts fresh. Re-triggering while speaking interrupts the current
 * reply (calls dialogueManager.stopCurrent) and starts a new listen.
 *
 * In browser dev mode (no Electron shell), there is no global PTT
 * binding. start() is a no-op there — chat input is the input path.
 */

import { MicCapture }
from './MicCapture.js';

import { SpeechTranscriber }
from './SpeechTranscriber.js';

const SPEAKING_POLL_MS =
  100;

const SPEAKING_TIMEOUT_MS =
  30000;

const ERROR_LINGER_MS =
  2000;

export class VoiceFlow {

  constructor({
    backendClient,
    dialogueManager,
    transcriberUrl,
    onStateChange,
  }) {

    if (!backendClient) {

      throw new Error(
        'VoiceFlow: backendClient is required'
      );

    }

    if (!dialogueManager) {

      throw new Error(
        'VoiceFlow: dialogueManager is required'
      );

    }

    if (!transcriberUrl) {

      throw new Error(
        'VoiceFlow: transcriberUrl is required'
      );

    }

    this.backendClient =
      backendClient;

    this.dialogueManager =
      dialogueManager;

    this.transcriber =
      new SpeechTranscriber({
        url:
          transcriberUrl,
      });

    this.onStateChange =
      onStateChange ||
      (() => {});

    this.state =
      'idle';

    this._currentMic =
      null;

    this._speakingPollInterval =
      null;

    this._speakingTimeoutTimer =
      null;

    this._errorTimer =
      null;

    this._unsubscribed =
      false;

  }

  // ======================
  // LIFECYCLE
  // ======================

  start() {

    // Wire the PTT trigger. The Electron preload exposes
    // window.personaShell.onPushToTalk; in plain-browser dev that
    // function doesn't exist and we silently no-op (the chat input
    // is the input path in dev).

    const shell =
      typeof window !== 'undefined'
        ? window.personaShell
        : null;

    if (
      !shell ||
      typeof shell.onPushToTalk !== 'function'
    ) {

      console.info(
        'VoiceFlow: no Electron shell, push-to-talk disabled ' +
        '(use the chat input)'
      );

      return;

    }

    shell.onPushToTalk(
      () => {

        // Route PTT through trigger() (not _onPushToTalk) so both
        // wake and PTT paths share the same show-overlay-then-listen
        // entry.

        this.trigger();

      }
    );

    console.log(
      'VoiceFlow: push-to-talk listener wired'
    );

  }

  stop() {

    this._unsubscribed =
      true;

    this._teardownSpeakingPoll();

    if (this._errorTimer) {

      clearTimeout(this._errorTimer);

      this._errorTimer =
        null;

    }

    if (this._currentMic) {

      this._currentMic.abort();

      this._currentMic =
        null;

    }

    this._setState('idle');

  }

  // ======================
  // EXTERNAL TRIGGER
  // ======================
  //
  // Public entry point shared by every input trigger (Ctrl+Alt+V
  // shortcut today, wake-word detection in Wave 2). All trigger
  // sources call this and the state machine takes it from there.
  //
  // If the overlay is hidden when input arrives, surface it first
  // so the user actually sees the listening / speaking feedback.
  // show() is idempotent on the shell side — calling while visible
  // is a no-op.

  trigger() {

    const shell =
      typeof window !== 'undefined'
        ? window.personaShell
        : null;

    if (
      shell &&
      typeof shell.show === 'function'
    ) {

      shell.show();

    }

    // Phase 3 Wave 3.2: a new conversation invalidates any deferred
    // tool that was queued during the previous reply. User changed
    // their mind ("lock my pc... actually never mind").

    if (
      shell &&
      typeof shell.cancelDeferredTools === 'function'
    ) {

      shell.cancelDeferredTools();

    }

    this._onPushToTalk();

  }

  // ======================
  // PUSH TO TALK
  // ======================

  _onPushToTalk() {

    if (this._unsubscribed) {

      return;

    }

    // Restart from anywhere: each press is a fresh attempt. If we
    // were listening, abort the in-flight capture. If we were
    // speaking, interrupt the dialogue. Then begin a new listen.

    if (this.state === 'listening') {

      console.log(
        'VoiceFlow: PTT re-pressed during listening — restarting'
      );

      if (this._currentMic) {

        this._currentMic.abort();

        this._currentMic =
          null;

      }

    } else if (
      this.state === 'speaking' ||
      this.dialogueManager.isSpeaking
    ) {

      console.log(
        'VoiceFlow: PTT pressed during reply — interrupting'
      );

      try {

        this.dialogueManager.stopCurrent();

      } catch (err) {

        console.warn(
          'VoiceFlow: stopCurrent threw',
          err
        );

      }

      this._teardownSpeakingPoll();

    } else if (this.state === 'thinking') {

      // already transcribing — let it finish. PTT during thinking
      // is rare; if the user really wants to restart, the next
      // listen will start after the current reply.

      console.log(
        'VoiceFlow: PTT pressed during thinking — ignoring'
      );

      return;

    }

    // Cancel any lingering error-state timer so we don't snap back
    // to idle mid-listen.

    if (this._errorTimer) {

      clearTimeout(this._errorTimer);

      this._errorTimer =
        null;

    }

    this._runListenCycle();

  }

  async _runListenCycle() {

    this._setState('listening');

    const mic =
      new MicCapture();

    this._currentMic =
      mic;

    let result;

    try {

      result =
        await mic.start();

    } catch (err) {

      // abort() is the normal cancel path — silent. Other errors
      // (permission denied, hardware) are reported.

      if (
        err &&
        err.message &&
        err.message.includes('aborted')
      ) {

        return;

      }

      console.error(
        'VoiceFlow: mic capture failed',
        err
      );

      this._setState(
        'error',
        { message: 'Mic unavailable' }
      );

      this._scheduleErrorClear();

      return;

    } finally {

      // Only clear the reference if we still own it. A fresh PTT
      // press may have already replaced it.

      if (this._currentMic === mic) {

        this._currentMic =
          null;

      }

    }

    this._setState('thinking');

    let transcript;

    try {

      transcript =
        await this.transcriber.transcribe(
          result.blob,
          result.mimeType
        );

    } catch (err) {

      console.error(
        'VoiceFlow: transcribe failed',
        err
      );

      this._setState(
        'error',
        { message: 'Could not transcribe' }
      );

      this._scheduleErrorClear();

      return;

    }

    const trimmed =
      (transcript || '').trim();

    if (!trimmed) {

      console.warn(
        'VoiceFlow: empty transcript'
      );

      this._setState(
        'error',
        { message: 'Could not hear you' }
      );

      this._scheduleErrorClear();

      return;

    }

    // Hand off to the existing dialogue pipeline. The BackendClient
    // sends to /chat/ws; the reply comes back as a 'reply' frame
    // and is enqueued into DialogueManager, which speaks + animates.

    console.log(
      `VoiceFlow: transcript -> backend: ${trimmed}`
    );

    this._setState('speaking');

    try {

      this.backendClient.send(
        trimmed
      );

    } catch (err) {

      console.error(
        'VoiceFlow: backendClient.send threw',
        err
      );

      this._setState(
        'error',
        { message: 'Backend unreachable' }
      );

      this._scheduleErrorClear();

      return;

    }

    // Watch dialogueManager.isSpeaking transition true -> false.
    // No clean event today; poll at ~100ms. The poll also has a
    // safety timeout so we don't hang forever if the backend never
    // replies.

    this._startSpeakingPoll();

  }

  // ======================
  // SPEAKING POLL
  // ======================

  _startSpeakingPoll() {

    this._teardownSpeakingPoll();

    let everSawSpeaking =
      false;

    this._speakingPollInterval =
      setInterval(
        () => {

          if (this.dialogueManager.isSpeaking) {

            everSawSpeaking =
              true;

            return;

          }

          // isSpeaking is false. If we previously saw true, the
          // reply just finished -> go idle. If we never saw true
          // yet, keep waiting (the backend may be slow).

          if (everSawSpeaking) {

            this._teardownSpeakingPoll();

            this._setState('idle');

          }

        },
        SPEAKING_POLL_MS
      );

    this._speakingTimeoutTimer =
      setTimeout(
        () => {

          console.warn(
            'VoiceFlow: speaking-poll timeout, returning to idle'
          );

          this._teardownSpeakingPoll();

          this._setState('idle');

        },
        SPEAKING_TIMEOUT_MS
      );

  }

  _teardownSpeakingPoll() {

    if (this._speakingPollInterval) {

      clearInterval(
        this._speakingPollInterval
      );

      this._speakingPollInterval =
        null;

    }

    if (this._speakingTimeoutTimer) {

      clearTimeout(
        this._speakingTimeoutTimer
      );

      this._speakingTimeoutTimer =
        null;

    }

  }

  // ======================
  // ERROR CLEAR
  // ======================

  _scheduleErrorClear() {

    if (this._errorTimer) {

      clearTimeout(this._errorTimer);

    }

    this._errorTimer =
      setTimeout(
        () => {

          this._errorTimer =
            null;

          if (this.state === 'error') {

            this._setState('idle');

          }

        },
        ERROR_LINGER_MS
      );

  }

  // ======================
  // STATE
  // ======================

  _setState(state, info) {

    this.state =
      state;

    try {

      this.onStateChange(
        state,
        info
      );

    } catch (err) {

      console.error(
        'VoiceFlow: onStateChange threw',
        err
      );

    }

  }

}
