/**
 * BackendClient
 *
 * Owns the WebSocket connection to the Persona backend.
 * Parses reply frames and dispatches them into the
 * DialogueManager's existing enqueue() API — the speak/animate
 * pipeline downstream is unchanged.
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

export class BackendClient {

  constructor({
    url,
    dialogueManager,
    onStatusChange,
  }) {

    this.url =
      url;

    this.dialogueManager =
      dialogueManager;

    this.onStatusChange =
      onStatusChange ||
      (() => {});

    this.ws =
      null;

    this.status =
      'disconnected';

    // outgoing queue used when the user sends a message
    // before the socket finishes opening

    this._pending = [];

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

    this._setStatus('connecting');

    const ws =
      new WebSocket(this.url);

    ws.addEventListener(
      'open',
      () => {

        console.log(
          'BackendClient: connected'
        );

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

        this._setStatus('disconnected');

      }
    );

    ws.addEventListener(
      'error',
      (err) => {

        console.error(
          'BackendClient: socket error',
          err
        );

        this._setStatus('error');

      }
    );

    this.ws = ws;

  }

  // ======================
  // SEND USER MESSAGE
  // ======================

  send(text) {

    const trimmed =
      (text || '').trim();

    if (!trimmed) {

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

  _setStatus(status) {

    this.status = status;

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

    if (this.ws) {

      this.ws.close();

      this.ws = null;

    }

    this._setStatus('disconnected');

  }

}
