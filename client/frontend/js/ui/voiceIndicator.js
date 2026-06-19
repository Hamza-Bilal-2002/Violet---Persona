/**
 * Voice indicator — a small DOM overlay that shows the current
 * VoiceFlow state. Positioned bottom-right, near where Violet
 * stands in the click-through overlay.
 *
 * Voice states (setState):
 *   listening    — pulsing red dot,    "Listening..."
 *   thinking     — yellow dot,         "Thinking..."
 *   speaking     — green dot,          "Speaking..."
 *   error        — gray dot + custom message, auto-hides after ~2 s
 *   idle         — hidden
 *
 * Connection states (setConnectionState):
 *   connecting   — pulsing amber dot,  "Connecting..."
 *   reconnecting — pulsing amber dot,  "Reconnecting..."
 *   connected    — transparent — falls back to voice state
 *
 * Connection state takes priority over voice state. If the backend
 * is down, listening is pointless, so we surface the reason instead.
 *
 * Usage:
 *   const indicator = mountVoiceIndicator();
 *   indicator.setState('listening');
 *   indicator.setConnectionState('reconnecting');
 *   indicator.setConnectionState('connected'); // back to voice state
 *   indicator.setState('idle');  // hides it
 *   indicator.destroy();
 */

const STYLE_ID =
  'persona-voice-indicator-style';

const ROOT_ID =
  'persona-voice-indicator';

const STATE_LABELS = {

  listening:
    'Listening...',

  thinking:
    'Thinking...',

  speaking:
    'Speaking...',

  error:
    'Couldn\'t hear you',

  connecting:
    'Connecting...',

  reconnecting:
    'Reconnecting...',

};

export function mountVoiceIndicator() {

  // ======================
  // STYLES
  // ======================

  // Inject once. If two runtimes ever co-existed, the second mount
  // would no-op on the style block.

  if (!document.getElementById(STYLE_ID)) {

    const style =
      document.createElement('style');

    style.id =
      STYLE_ID;

    style.textContent = `
      #${ROOT_ID} {
        position: fixed;
        right: 60px;
        bottom: 100px;
        display: none;
        align-items: center;
        gap: 10px;
        padding: 8px 14px;
        background: rgba(20, 20, 24, 0.85);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 999px;
        backdrop-filter: blur(10px);
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
        z-index: 9998;
        font-family: system-ui, -apple-system, Segoe UI, sans-serif;
        font-size: 13px;
        color: white;
        pointer-events: none;
      }
      #${ROOT_ID}.is-visible {
        display: flex;
      }
      #${ROOT_ID} .voice-dot {
        width: 10px;
        height: 10px;
        border-radius: 50%;
        background: #888;
        flex-shrink: 0;
      }
      #${ROOT_ID}.state-listening .voice-dot {
        background: #ef4444;
        animation: persona-voice-pulse 1s ease-in-out infinite;
      }
      #${ROOT_ID}.state-thinking .voice-dot {
        background: #facc15;
      }
      #${ROOT_ID}.state-speaking .voice-dot {
        background: #4ade80;
      }
      #${ROOT_ID}.state-error .voice-dot {
        background: #888;
      }
      #${ROOT_ID}.state-connecting .voice-dot,
      #${ROOT_ID}.state-reconnecting .voice-dot {
        background: #f59e0b;
        animation: persona-voice-pulse 1.4s ease-in-out infinite;
      }
      @keyframes persona-voice-pulse {
        0%, 100% { transform: scale(1); opacity: 1; }
        50%      { transform: scale(1.3); opacity: 0.55; }
      }
    `;

    document.head.appendChild(style);

  }

  // ======================
  // ELEMENTS
  // ======================

  const root =
    document.createElement('div');

  root.id =
    ROOT_ID;

  const dot =
    document.createElement('div');

  dot.className =
    'voice-dot';

  const label =
    document.createElement('span');

  label.className =
    'voice-label';

  root.appendChild(dot);

  root.appendChild(label);

  document.body.appendChild(root);

  // ======================
  // STATE
  // ======================
  //
  // Two independent input channels — VoiceFlow drives voice state,
  // BackendClient drives connection state. Connection issues take
  // priority over voice state because there's no point pretending
  // we're "listening" while the socket is down.

  let voiceState =
    null;

  let voiceInfo =
    null;

  let connectionState =
    null;

  const render =
    () => {

      // Clear any previous state-* class.

      root.classList.forEach(
        (cls) => {

          if (cls.startsWith('state-')) {

            root.classList.remove(cls);

          }

        }
      );

      // Connection issues override voice state. 'connected' (or
      // null) means no override — fall back to voice.

      const usingConnection =
        connectionState &&
        connectionState !== 'connected';

      const effectiveState =
        usingConnection
          ? connectionState
          : voiceState;

      const effectiveInfo =
        usingConnection
          ? null
          : voiceInfo;

      if (
        !effectiveState ||
        effectiveState === 'idle'
      ) {

        root.classList.remove('is-visible');

        label.textContent =
          '';

        return;

      }

      root.classList.add(`state-${effectiveState}`);

      root.classList.add('is-visible');

      const customMessage =
        effectiveInfo &&
        typeof effectiveInfo.message === 'string'
          ? effectiveInfo.message
          : null;

      label.textContent =
        customMessage ||
        STATE_LABELS[effectiveState] ||
        '';

    };

  const setState =
    (state, info) => {

      voiceState =
        state;

      voiceInfo =
        info;

      render();

    };

  const setConnectionState =
    (state) => {

      connectionState =
        state;

      render();

    };

  const destroy =
    () => {

      if (root.parentNode) {

        root.parentNode.removeChild(root);

      }

    };

  return {
    setState,
    setConnectionState,
    destroy,
  };

}
