/**
 * BackendClient
 *
 * Owns the WebSocket connection to the Persona backend.
 * Parses reply frames and dispatches them into the
 * DialogueManager's existing enqueue() API — the speak/animate
 * pipeline downstream is unchanged.
 *
 * Status lifecycle:
 *   'connecting'   first attempt after connect()
 *   'connected'    socket open, ready to send
 *   'reconnecting' socket closed unexpectedly, backoff timer armed
 *   'disconnected' deliberate disconnect() — won't auto-reconnect
 *
 * Reply frame shape (from backend/app/protocol.py):
 *   {
 *     "type": "reply",
 *     "text": "...",
 *     "emotion": { "name": "happy", "intensity": 0.5 },
 *     "animation": "talking"
 *   }
 *
 * Error frame:
 *   { "type": "error", "message": "..." }
 */

const RECONNECT_BASE_MS =
  1000;

const RECONNECT_MAX_MS =
  30000;

// After this many consecutive failed reconnect attempts, give up on the
// backend for now and fall back to client-side basic mode (GPT direct).
// With exponential backoff (1s, 2s, 4s…) attempt 3 lands ~3s after the
// backend goes unreachable — long enough to ride out a brief blip, short
// enough that a real outage drops to basic mode quickly. Background
// reconnect keeps running, so the moment the backend returns we restore
// full mode.
const FALLBACK_AFTER_ATTEMPTS =
  3;

// Tools that must pause for user confirmation before executing.
// BackendClient intercepts these and calls onConfirmationRequired
// instead of immediately firing shell.executeTool.

const CONFIRMATION_TOOLS =
  new Set(['send_whatsapp']);

export class BackendClient {

  constructor({
    url,
    dialogueManager,
    onStatusChange,
    onConfirmationRequired,
    onPersonality,
    onPersonalities,
    onAdultMode,
    fallbackChat,
    onModeChange,
  }) {

    this.url =
      url;

    this.dialogueManager =
      dialogueManager;

    this.onStatusChange =
      onStatusChange ||
      (() => {});

    // Tier-2 client fallback. When the backend can't be reached, user
    // input is routed to this FallbackChat (GPT direct, basic mode)
    // instead of the WebSocket. Optional — absent in plain-browser dev,
    // in which case we never leave 'full' mode (input just queues).
    this.fallbackChat =
      fallbackChat || null;

    // onModeChange(mode, reason): 'full' (backend driving) <-> 'basic'
    // (client GPT fallback). Drives the mode notifier + tray roster swap.
    this.onModeChange =
      onModeChange || (() => {});

    // Current operating mode. Starts optimistic ('full'); flips to
    // 'basic' after FALLBACK_AFTER_ATTEMPTS failed reconnects and back to
    // 'full' on the next successful open.
    this.mode =
      'full';

    // Personality frames from the backend. onPersonality fires when the
    // active personality changes (carries voice + default_emotion);
    // onPersonalities fires with the full roster + active id (for the
    // tray). Both optional.
    this.onPersonality =
      onPersonality || null;

    this.onPersonalities =
      onPersonalities || null;

    // Adult-mode frames from the backend: { enabled, available, message? }.
    // Drives the tray toggle (enabled/greyed) and a notifier. Optional.
    this.onAdultMode =
      onAdultMode || null;

    // Called when a confirmation-required tool is intercepted.
    // Signature: ({ name, args, resolve, reject }) => void
    // resolve(confirmedArgs) → tool executes with confirmedArgs
    // reject(err)           → tool result sent as cancelled

    this.onConfirmationRequired =
      onConfirmationRequired || null;

    // One-shot interceptor for the next send() call (voice path).
    // Set by callers (e.g. AvatarRuntime) when awaiting confirmation,
    // cleared immediately on first use.

    this._sendInterceptor =
      null;

    this.ws =
      null;

    this.status =
      'disconnected';

    // outgoing queue used when the user sends a message
    // before the socket finishes opening

    this._pending = [];

    // ======================
    // RECONNECT STATE
    // ======================
    //
    // Auto-reconnect on unexpected close (backend container
    // restart, network blip, OS sleep). Exponential backoff
    // doubles each attempt and caps at RECONNECT_MAX_MS so we
    // never thrash the backend or the indicator. The counter
    // resets to zero on a successful 'open' event.
    //
    // _intentionallyDisconnected suppresses reconnect after the
    // caller has explicitly torn the client down — without it,
    // disconnect() would race with the close-event handler and
    // immediately schedule a retry.

    this._reconnectAttempt =
      0;

    this._reconnectTimer =
      null;

    this._intentionallyDisconnected =
      false;

  }

  // ======================
  // CONNECT
  // ======================

  connect() {

    if (
      this.ws &&
      (
        this.ws.readyState === WebSocket.OPEN ||
        this.ws.readyState === WebSocket.CONNECTING
      )
    ) {

      return;

    }

    // Either we're connecting for the first time or the user
    // forced a retry. Either way, the prior reconnect timer (if
    // any) is now stale.

    this._clearReconnectTimer();

    this._intentionallyDisconnected =
      false;

    this._setStatus('connecting');

    const ws =
      new WebSocket(this.url);

    ws.addEventListener(
      'open',
      () => {

        console.log(
          'BackendClient: connected'
        );

        this._reconnectAttempt =
          0;

        // If we'd dropped to basic mode while the backend was down,
        // restore full mode now — BEFORE emitting 'connected' so the
        // status surfaces normally (basic mode suppresses connecting/
        // reconnecting status). The backend re-sends its personality
        // roster on connect, so the tray returns to the full set on its
        // own.
        this._exitBasicMode();

        this._setStatus('connected');

        // flush anything the user typed
        // while the socket was opening

        while (this._pending.length) {

          const text =
            this._pending.shift();

          this._sendText(text);

        }

      }
    );

    ws.addEventListener(
      'message',
      (event) => {

        this._handleMessage(
          event.data
        );

      }
    );

    ws.addEventListener(
      'close',
      () => {

        console.warn(
          'BackendClient: socket closed'
        );

        this.ws =
          null;

        if (this._intentionallyDisconnected) {

          this._setStatus('disconnected');

          return;

        }

        this._scheduleReconnect();

      }
    );

    // The WebSocket 'error' event always precedes 'close', so we
    // let 'close' own the status transition. Logging only here.

    ws.addEventListener(
      'error',
      (err) => {

        console.error(
          'BackendClient: socket error',
          err
        );

      }
    );

    this.ws = ws;

  }

  // ======================
  // RECONNECT
  // ======================

  _scheduleReconnect() {

    if (this._reconnectTimer) {

      return;

    }

    const delayMs =
      Math.min(
        RECONNECT_BASE_MS *
          Math.pow(2, this._reconnectAttempt),
        RECONNECT_MAX_MS
      );

    const attemptNumber =
      this._reconnectAttempt + 1;

    console.log(
      `BackendClient: reconnecting in ${delayMs}ms ` +
      `(attempt ${attemptNumber})`
    );

    // Enough failures to call it: drop to client-side basic mode so the
    // user can still talk to Violet while the background reconnect keeps
    // trying. No-op once already basic, or when no fallback is wired.
    if (attemptNumber >= FALLBACK_AFTER_ATTEMPTS) {
      this._enterBasicMode('Backend unreachable');
    }

    this._setStatus('reconnecting');

    this._reconnectTimer =
      setTimeout(
        () => {

          this._reconnectTimer =
            null;

          this._reconnectAttempt +=
            1;

          this.connect();

        },
        delayMs
      );

  }

  _clearReconnectTimer() {

    if (this._reconnectTimer) {

      clearTimeout(this._reconnectTimer);

      this._reconnectTimer =
        null;

    }

  }

  // ======================
  // MODE (full <-> basic)
  // ======================

  _enterBasicMode(reason) {

    // Need a fallback to fall back to; without one (browser dev) we just
    // keep retrying in 'full' mode.
    if (this.mode === 'basic' || !this.fallbackChat) {

      return;

    }

    this.mode =
      'basic';

    console.warn(
      `BackendClient: entering basic mode (${reason})`
    );

    // Prime the fallback (voice + tray roster) then announce the switch.
    try {

      this.fallbackChat.activate();

    } catch (err) {

      console.error(
        'BackendClient: fallbackChat.activate threw',
        err
      );

    }

    try {

      this.onModeChange('basic', reason);

    } catch (err) {

      console.error(
        'BackendClient: onModeChange(basic) threw',
        err
      );

    }

  }

  _exitBasicMode() {

    if (this.mode !== 'basic') {

      return;

    }

    this.mode =
      'full';

    console.log(
      'BackendClient: leaving basic mode — full mode restored'
    );

    // Clear the ephemeral basic-mode history so a future outage starts
    // clean rather than resuming a stale offline conversation.
    if (
      this.fallbackChat &&
      typeof this.fallbackChat.reset === 'function'
    ) {

      this.fallbackChat.reset();

    }

    try {

      this.onModeChange('full', 'Backend reconnected');

    } catch (err) {

      console.error(
        'BackendClient: onModeChange(full) threw',
        err
      );

    }

  }

  // ======================
  // SEND USER MESSAGE
  // ======================

  // Register a one-shot interceptor for the next send() call.
  // Used by AvatarRuntime to capture voice input while a confirmation
  // is pending — the voice transcript goes to the interceptor instead
  // of the backend WebSocket.

  interceptNextSend(fn) {

    this._sendInterceptor = fn;

  }

  // Ask the backend to switch the active personality. Sent as a control
  // frame so it bypasses the dialogue path; the backend rebuilds the
  // session prompt and replies with a `personality` frame + a spoken
  // confirmation. No-op if the socket isn't open.
  setPersonality(id) {

    // Basic mode: switch the bundled personality locally (no backend).
    if (this.mode === 'basic' && this.fallbackChat) {

      this.fallbackChat.setPersonality(id);

      return;

    }

    if (
      this.ws &&
      this.ws.readyState === WebSocket.OPEN
    ) {

      this.ws.send(
        JSON.stringify({
          type: 'set_personality',
          id,
        })
      );

    }

  }

  // Ask the backend to toggle adult mode. Backend-gated (local model only)
  // and backend-authoritative — we just send the request and react to the
  // `adult_mode` frame that comes back. Only meaningful in full mode: adult
  // mode requires the backend + local model, so there's nothing to do in
  // basic (GPT) mode.
  setAdultMode(enabled) {

    if (this.mode === 'basic') {

      if (this.onAdultMode) {
        this.onAdultMode({
          enabled: false,
          available: false,
          message: 'Deep mode needs the local model — unavailable while the backend is offline.',
        });
      }

      return;

    }

    if (
      this.ws &&
      this.ws.readyState === WebSocket.OPEN
    ) {

      this.ws.send(
        JSON.stringify({
          type: 'set_adult_mode',
          enabled: !!enabled,
        })
      );

    }

  }

  send(text) {

    const trimmed =
      (text || '').trim();

    if (!trimmed) {

      return;

    }

    // Basic mode: the backend is unreachable, so the message goes to the
    // client-side GPT fallback instead of the WebSocket. Checked before
    // the confirmation interceptor — confirmations only exist in full
    // mode (they're backend-tool driven).
    if (this.mode === 'basic' && this.fallbackChat) {

      this.fallbackChat.send(trimmed);

      return;

    }

    // Confirmation mode: route voice/text to the interceptor instead
    // of the backend. The interceptor is cleared immediately so only
    // the first input is consumed (subsequent inputs go to backend).

    if (this._sendInterceptor) {

      const interceptor =
        this._sendInterceptor;

      this._sendInterceptor =
        null;

      interceptor(trimmed);

      return;

    }

    if (
      this.ws &&
      this.ws.readyState === WebSocket.OPEN
    ) {

      this._sendText(trimmed);

    } else {

      // queue and try to connect

      this._pending.push(trimmed);

      this.connect();

    }

  }

  _sendText(text) {

    this.ws.send(
      JSON.stringify({
        text,
      })
    );

  }

  // ======================
  // INCOMING
  // ======================

  _handleMessage(raw) {

    let msg;

    try {

      msg =
        JSON.parse(raw);

    } catch (err) {

      console.error(
        'BackendClient: bad JSON frame',
        raw
      );

      return;

    }

    if (msg.type === 'error') {

      console.error(
        'BackendClient: backend error',
        msg.message
      );

      return;

    }

    if (msg.type === 'tool_call') {

      // Phase 3 Wave 3.1: backend forwarded a Gemini function_call
      // for the renderer to execute. Don't await here — let the
      // WS read loop keep flowing while the tool runs.

      this._handleToolCall(msg);

      return;

    }

    if (msg.type === 'personality') {

      // Active personality changed — carries voice + default emotion.
      if (this.onPersonality) {
        this.onPersonality(msg);
      }

      return;

    }

    if (msg.type === 'personalities') {

      // Full roster + active id (sent on connect and on switch).
      if (this.onPersonalities) {
        this.onPersonalities(msg);
      }

      return;

    }

    if (msg.type === 'adult_mode') {

      // Adult-mode state/capability (sent on connect, on toggle, and on a
      // local-model block). Carries { enabled, available, message? }.
      if (this.onAdultMode) {
        this.onAdultMode(msg);
      }

      return;

    }

    if (msg.type !== 'reply') {

      console.warn(
        'BackendClient: unknown frame type',
        msg
      );

      return;

    }

    // hand off to dialogue manager. its existing
    // enqueue() understands the emotion as either
    // a string or {name, intensity}.

    this.dialogueManager.enqueue({

      text:
        msg.text,

      emotion:
        msg.emotion,

      animation:
        msg.animation,

      priority:
        1,

    });

  }

  // ======================
  // TOOL CALL (Phase 3 Wave 3.1)
  // ======================
  //
  // Backend forwarded a Gemini function_call. Execute it via the
  // Electron shell and ship the result back as a tool_result frame.
  // Errors are explicitly surfaced — Gemini wants to know if a tool
  // failed so it can recover (apologize, retry, ask for clarification).

  async _handleToolCall(msg) {

    const id =
      msg.id;

    const name =
      msg.name;

    const args =
      msg.args || {};

    console.log(
      `BackendClient: tool_call ${name}`,
      args
    );

    let outcome;

    const shell =
      typeof window !== 'undefined'
        ? window.personaShell
        : null;

    if (
      !shell ||
      typeof shell.executeTool !== 'function'
    ) {

      this._sendToolResult(id, {
        error: 'tool execution requires the Electron shell',
      });

      return;

    }

    // Confirmation-required tools: pause execution and ask the user
    // before actually running the side-effect. onConfirmationRequired
    // is wired by AvatarRuntime; it drives the text-input confirmation
    // UI and registers a voice interceptor on this client.

    if (
      CONFIRMATION_TOOLS.has(name) &&
      typeof this.onConfirmationRequired === 'function'
    ) {

      try {

        const confirmedArgs =
          await new Promise((resolve, reject) => {
            this.onConfirmationRequired({ name, args, resolve, reject });
          });

        outcome =
          await shell.executeTool(name, confirmedArgs);

      } catch (err) {

        const isCancelled =
          err && err.message === 'cancelled';

        outcome = {
          result: {
            cancelled: true,
            message: isCancelled
              ? 'User cancelled'
              : (err && err.message) || String(err),
          },
        };

      }

    } else {

      // Normal (immediate) execution path.

      try {

        outcome =
          await shell.executeTool(name, args);

      } catch (err) {

        outcome = {
          error:
            err && err.message
              ? err.message
              : String(err),
        };

      }

    }

    this._sendToolResult(id, outcome);

  }

  _sendToolResult(id, outcome) {

    if (
      !this.ws ||
      this.ws.readyState !== WebSocket.OPEN
    ) {

      console.warn(
        'BackendClient: socket not open, dropping tool_result ' +
        `for ${id}`
      );

      return;

    }

    const frame = {
      type:
        'tool_result',
      id,
      ...outcome,
    };

    this.ws.send(
      JSON.stringify(frame)
    );

  }

  _setStatus(status) {

    this.status = status;

    // While basic mode is handling input, the background reconnect's
    // 'connecting'/'reconnecting' churn would wrongly show a "can't reach
    // backend" overlay over a working conversation. Suppress it — the
    // mode notifier's basic-mode pill already communicates the state.
    if (
      this.mode === 'basic' &&
      (status === 'connecting' || status === 'reconnecting')
    ) {

      return;

    }

    try {

      this.onStatusChange(status);

    } catch (err) {

      console.error(
        'BackendClient: onStatusChange threw',
        err
      );

    }

  }

  // ======================
  // DISCONNECT
  // ======================

  disconnect() {

    this._intentionallyDisconnected =
      true;

    this._clearReconnectTimer();

    if (this.ws) {

      // The close-event handler will see
      // _intentionallyDisconnected and skip the auto-reconnect.

      this.ws.close();

      this.ws =
        null;

    }

    this._setStatus('disconnected');

  }

}
