/**
 * Minimal chat input overlay. A text field + send button anchored
 * to the bottom of the viewport. Optional status dot reflects
 * BackendClient connection state.
 *
 * Usage:
 *   const input = mountChatInput({
 *     onSend: (text) => backendClient.send(text),
 *   });
 *   input.setStatus('connecting');  // 'disconnected' | 'connecting' | 'connected' | 'error'
 */

import { AGENT_NAME }
from '../config/agentConfig.js';

export function mountChatInput({ onSend }) {

  // ======================
  // STYLES
  // ======================

  const style =
    document.createElement('style');

  style.textContent = `
    #persona-chat {
      position: fixed;
      left: 50%;
      bottom: 24px;
      transform: translateX(-50%);
      display: flex;
      align-items: center;
      gap: 8px;
      background: rgba(20, 20, 24, 0.85);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 999px;
      padding: 8px 12px;
      backdrop-filter: blur(10px);
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
      z-index: 9999;
      font-family: system-ui, -apple-system, Segoe UI, sans-serif;
    }
    #persona-chat .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #888;
      flex-shrink: 0;
      transition: background 0.2s;
    }
    #persona-chat .status-dot.connected   { background: #4ade80; }
    #persona-chat .status-dot.connecting  { background: #facc15; }
    #persona-chat .status-dot.error       { background: #ef4444; }
    #persona-chat input {
      flex: 1;
      min-width: 280px;
      background: transparent;
      border: none;
      outline: none;
      color: white;
      font-size: 14px;
      padding: 6px 4px;
    }
    #persona-chat input::placeholder {
      color: rgba(255, 255, 255, 0.4);
    }
    #persona-chat button {
      background: #6366f1;
      color: white;
      border: none;
      border-radius: 999px;
      padding: 6px 14px;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.15s;
    }
    #persona-chat button:hover { background: #7c7fff; }
    #persona-chat button:disabled {
      background: #444;
      cursor: not-allowed;
    }
  `;

  document.head.appendChild(style);

  // ======================
  // ELEMENTS
  // ======================

  const root =
    document.createElement('div');

  root.id = 'persona-chat';

  // Phase 2.A: hide the chat input in the Electron shell. Voice is
  // the only input in Phase 2.B and the text bar would block apps
  // beneath the overlay. We hide rather than skip-mount so Phase 2.B
  // can call `setVisible(true)` for dev/debug if needed.

  const isElectronShell =
    typeof window !== 'undefined' &&
    window.personaShell &&
    window.personaShell.isElectron === true;

  if (isElectronShell) {

    root.style.display =
      'none';

  }

  const dot =
    document.createElement('div');

  dot.className = 'status-dot';

  const input =
    document.createElement('input');

  input.type = 'text';
  input.placeholder = `Talk to ${AGENT_NAME}...`;
  input.autocomplete = 'off';

  const button =
    document.createElement('button');

  button.textContent = 'Send';

  root.appendChild(dot);
  root.appendChild(input);
  root.appendChild(button);

  document.body.appendChild(root);

  // ======================
  // BEHAVIOR
  // ======================

  const submit =
    () => {

      const text = input.value;
      if (!text.trim()) return;

      input.value = '';

      try {
        onSend(text);
      } catch (err) {
        console.error('chatInput onSend threw', err);
      }

    };

  button.addEventListener('click', submit);

  input.addEventListener(
    'keydown',
    (e) => {

      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        submit();
      }

    }
  );

  // ======================
  // PUBLIC API
  // ======================

  return {

    setStatus(status) {

      dot.className =
        'status-dot ' + status;

    },

    focus() {

      input.focus();

    },

    setDisabled(disabled) {

      input.disabled = disabled;
      button.disabled = disabled;

    },

    setVisible(visible) {

      root.style.display =
        visible ? 'flex' : 'none';

    },

  };

}
