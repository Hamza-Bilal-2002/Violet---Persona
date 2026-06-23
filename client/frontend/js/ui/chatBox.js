/**
 * ChatBox — the text-mode conversation surface.
 *
 * A dark-glass chat panel in the same visual language as the confirmation
 * card and voice indicator (blurred glass, amber accent, soft white text).
 * Used only in text mode: the avatar is muted, so the conversation lives
 * here as text while the avatar emotes/animates silently alongside.
 *
 * Features:
 *   - user / assistant message bubbles, *asterisk* actions rendered italic
 *   - an input that sends on Enter (Shift+Enter = newline)
 *   - a windowed <-> fullscreen toggle
 *   - a settings panel to edit the SCENE and ROLEPLAY RULES, saved to the
 *     backend (these drive the system prompt server-side)
 *
 * It owns no backend knowledge — the host wires callbacks:
 *   onSend(text)                  user sent a message
 *   onSaveSettings({scene,rules}) user saved scene/rules
 *   onClose()                     user closed the panel (host turns text mode off)
 *
 * The root carries class `persona-chatbox` so the overlay's click-through
 * hit-test treats it as interactive UI (see AvatarRuntime).
 *
 * API: { show, hide, isOpen, addMessage, setSettings, clear, destroy }.
 */

const STYLE_ID = 'persona-chatbox-style';
const ROOT_ID  = 'persona-chatbox';

// Escape HTML, then render *asterisk* spans as italic action text and
// newlines as <br>. Keeps user/model text safe while supporting the one
// bit of markup text-mode roleplay relies on.
function _renderText(text) {
  const escaped = (text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const withActions = escaped.replace(
    /\*([^*]+)\*/g,
    '<em class="rp-action">$1</em>'
  );
  return withActions.replace(/\n/g, '<br>');
}

export function mountChatBox({ onSend, onSaveSettings, onClose } = {}) {

  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${ROOT_ID} {
        position: fixed;
        left: 24px;
        bottom: 24px;
        width: 400px;
        height: 68vh;
        max-height: 760px;
        display: none;
        flex-direction: column;
        z-index: 999998;
        font-family: system-ui, -apple-system, Segoe UI, sans-serif;
        color: rgba(255,255,255,0.92);
        background: rgba(14,14,18,0.88);
        border: 1px solid rgba(255,200,60,0.22);
        border-radius: 18px;
        box-shadow: 0 0 0 1px rgba(255,200,60,0.05), 0 18px 50px rgba(0,0,0,0.6);
        backdrop-filter: blur(22px);
        -webkit-backdrop-filter: blur(22px);
        overflow: hidden;
        -webkit-app-region: no-drag;
      }
      #${ROOT_ID}.is-open { display: flex; }
      #${ROOT_ID}.is-fullscreen {
        left: 24px; right: 24px; top: 24px; bottom: 24px;
        width: auto; height: auto; max-height: none;
      }

      #${ROOT_ID} .cb-header {
        display: flex; align-items: center; gap: 10px;
        padding: 12px 14px;
        border-bottom: 1px solid rgba(255,255,255,0.07);
        flex-shrink: 0;
      }
      #${ROOT_ID} .cb-title {
        font-size: 12px; font-weight: 600; letter-spacing: 0.04em;
        text-transform: uppercase; color: rgba(255,200,60,0.82);
        flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      #${ROOT_ID} .cb-btn {
        width: 26px; height: 26px; flex-shrink: 0;
        display: flex; align-items: center; justify-content: center;
        border-radius: 7px; cursor: pointer;
        color: rgba(255,255,255,0.55);
        background: transparent; border: 1px solid transparent;
        font-size: 14px; line-height: 1; transition: all 0.12s ease;
        user-select: none;
      }
      #${ROOT_ID} .cb-btn:hover {
        color: rgba(255,255,255,0.95);
        background: rgba(255,255,255,0.08);
        border-color: rgba(255,255,255,0.12);
      }

      #${ROOT_ID} .cb-messages {
        flex: 1; overflow-y: auto; padding: 16px 14px;
        display: flex; flex-direction: column; gap: 10px;
      }
      #${ROOT_ID} .cb-messages::-webkit-scrollbar { width: 8px; }
      #${ROOT_ID} .cb-messages::-webkit-scrollbar-thumb {
        background: rgba(255,255,255,0.12); border-radius: 4px;
      }
      #${ROOT_ID} .cb-row { display: flex; }
      #${ROOT_ID} .cb-row.user { justify-content: flex-end; }
      #${ROOT_ID} .cb-row.assistant { justify-content: flex-start; }
      #${ROOT_ID} .cb-bubble {
        max-width: 82%;
        padding: 9px 13px;
        border-radius: 15px;
        font-size: 13.5px; line-height: 1.5;
        white-space: pre-wrap; word-wrap: break-word;
      }
      #${ROOT_ID} .cb-row.user .cb-bubble {
        background: rgba(255,200,60,0.15);
        border: 1px solid rgba(255,200,60,0.3);
        border-bottom-right-radius: 5px;
        color: rgba(255,248,232,0.96);
      }
      #${ROOT_ID} .cb-row.assistant .cb-bubble {
        background: rgba(255,255,255,0.06);
        border: 1px solid rgba(255,255,255,0.09);
        border-bottom-left-radius: 5px;
        color: rgba(255,255,255,0.9);
      }
      #${ROOT_ID} .rp-action {
        color: rgba(255,200,60,0.78);
        font-style: italic;
      }
      #${ROOT_ID} .cb-empty {
        margin: auto; text-align: center; max-width: 240px;
        color: rgba(255,255,255,0.28); font-size: 12.5px; line-height: 1.5;
      }

      #${ROOT_ID} .cb-input-row {
        display: flex; align-items: flex-end; gap: 9px;
        padding: 11px 12px;
        border-top: 1px solid rgba(255,255,255,0.07);
        flex-shrink: 0;
      }
      #${ROOT_ID} textarea.cb-input {
        flex: 1; resize: none;
        min-height: 22px; max-height: 120px;
        padding: 8px 12px;
        border-radius: 14px;
        border: 1px solid rgba(255,255,255,0.12);
        background: rgba(0,0,0,0.3);
        color: rgba(255,255,255,0.92);
        font-family: inherit; font-size: 13.5px; line-height: 1.4;
        outline: none;
      }
      #${ROOT_ID} textarea.cb-input::placeholder { color: rgba(255,255,255,0.3); }
      #${ROOT_ID} textarea.cb-input:focus { border-color: rgba(255,200,60,0.5); }
      #${ROOT_ID} .cb-send {
        flex-shrink: 0; height: 38px; padding: 0 16px;
        border-radius: 14px; border: none; cursor: pointer;
        background: rgba(255,200,60,0.85); color: #1a1206;
        font-family: inherit; font-size: 13px; font-weight: 600;
        transition: background 0.12s ease;
      }
      #${ROOT_ID} .cb-send:hover { background: rgba(255,210,90,0.95); }

      #${ROOT_ID} .cb-settings {
        position: absolute; inset: 0;
        display: none; flex-direction: column;
        background: rgba(12,12,16,0.82);
        backdrop-filter: blur(24px); -webkit-backdrop-filter: blur(24px);
      }
      #${ROOT_ID} .cb-settings.is-open { display: flex; }
      #${ROOT_ID} .cb-settings-body {
        flex: 1; overflow-y: auto; padding: 16px 16px 4px;
        display: flex; flex-direction: column; gap: 16px;
      }
      #${ROOT_ID} .cb-field label {
        display: block; margin-bottom: 6px;
        font-size: 10.5px; font-weight: 600; letter-spacing: 0.05em;
        text-transform: uppercase; color: rgba(255,200,60,0.7);
      }
      #${ROOT_ID} .cb-field textarea {
        width: 100%; box-sizing: border-box; resize: vertical;
        padding: 10px 12px; border-radius: 12px;
        border: 1px solid rgba(255,255,255,0.12);
        background: rgba(0,0,0,0.3); color: rgba(255,255,255,0.9);
        font-family: inherit; font-size: 13px; line-height: 1.5; outline: none;
      }
      #${ROOT_ID} .cb-field textarea:focus { border-color: rgba(255,200,60,0.5); }
      #${ROOT_ID} .cb-field .cb-hint {
        margin-top: 5px; font-size: 11px; color: rgba(255,255,255,0.32); line-height: 1.4;
      }
      #${ROOT_ID} .cb-settings-foot {
        display: flex; gap: 10px; justify-content: flex-end;
        padding: 12px 16px; border-top: 1px solid rgba(255,255,255,0.07);
      }
      #${ROOT_ID} .cb-ghost {
        height: 34px; padding: 0 16px; border-radius: 11px; cursor: pointer;
        background: transparent; border: 1px solid rgba(255,255,255,0.16);
        color: rgba(255,255,255,0.7); font-family: inherit; font-size: 13px;
      }
      #${ROOT_ID} .cb-ghost:hover { color: #fff; border-color: rgba(255,255,255,0.3); }
    `;
    document.head.appendChild(style);
  }

  const root = document.createElement('div');
  root.id = ROOT_ID;
  root.className = 'persona-chatbox';

  // ── Header ──────────────────────────────────────────────────────────
  const header = document.createElement('div');
  header.className = 'cb-header';
  const title = document.createElement('div');
  title.className = 'cb-title';
  title.textContent = 'Text Mode';
  const gearBtn = document.createElement('div');
  gearBtn.className = 'cb-btn'; gearBtn.title = 'Scene & rules'; gearBtn.textContent = '⚙';
  const fsBtn = document.createElement('div');
  fsBtn.className = 'cb-btn'; fsBtn.title = 'Fullscreen'; fsBtn.textContent = '⤢';
  const closeBtn = document.createElement('div');
  closeBtn.className = 'cb-btn'; closeBtn.title = 'Close'; closeBtn.textContent = '✕';
  header.append(title, gearBtn, fsBtn, closeBtn);

  // ── Messages ────────────────────────────────────────────────────────
  const messages = document.createElement('div');
  messages.className = 'cb-messages';
  const empty = document.createElement('div');
  empty.className = 'cb-empty';
  empty.textContent = 'The scene is set. Say something to begin.';
  messages.appendChild(empty);

  // ── Input ───────────────────────────────────────────────────────────
  const inputRow = document.createElement('div');
  inputRow.className = 'cb-input-row';
  const input = document.createElement('textarea');
  input.className = 'cb-input'; input.rows = 1;
  input.placeholder = 'Type your message…';
  const sendBtn = document.createElement('button');
  sendBtn.className = 'cb-send'; sendBtn.textContent = 'Send';
  inputRow.append(input, sendBtn);

  // ── Settings overlay ────────────────────────────────────────────────
  const settings = document.createElement('div');
  settings.className = 'cb-settings';
  const sBody = document.createElement('div');
  sBody.className = 'cb-settings-body';

  const sceneField = document.createElement('div');
  sceneField.className = 'cb-field';
  sceneField.innerHTML =
    '<label>Scene setting</label>';
  const sceneTa = document.createElement('textarea');
  sceneTa.rows = 4;
  const sceneHint = document.createElement('div');
  sceneHint.className = 'cb-hint';
  sceneHint.textContent = 'Where you are, the mood, the situation. This frames every reply.';
  sceneField.append(sceneTa, sceneHint);

  const rulesField = document.createElement('div');
  rulesField.className = 'cb-field';
  rulesField.innerHTML = '<label>Roleplay rules</label>';
  const rulesTa = document.createElement('textarea');
  rulesTa.rows = 8;
  const rulesHint = document.createElement('div');
  rulesHint.className = 'cb-hint';
  rulesHint.textContent = 'How she should write and behave in the scene. One guideline per line works well.';
  rulesField.append(rulesTa, rulesHint);

  sBody.append(sceneField, rulesField);

  const sFoot = document.createElement('div');
  sFoot.className = 'cb-settings-foot';
  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'cb-ghost'; cancelBtn.textContent = 'Cancel';
  const saveBtn = document.createElement('button');
  saveBtn.className = 'cb-send'; saveBtn.textContent = 'Save';
  sFoot.append(cancelBtn, saveBtn);
  settings.append(sBody, sFoot);

  root.append(header, messages, inputRow, settings);
  document.body.appendChild(root);

  // ── State + behavior ────────────────────────────────────────────────
  let currentScene = '';
  let currentRules = '';

  const scrollToBottom = () => { messages.scrollTop = messages.scrollHeight; };

  const addMessage = (role, text) => {
    if (empty.parentNode) empty.remove();
    const row = document.createElement('div');
    row.className = `cb-row ${role === 'user' ? 'user' : 'assistant'}`;
    const bubble = document.createElement('div');
    bubble.className = 'cb-bubble';
    bubble.innerHTML = _renderText(text);
    row.appendChild(bubble);
    messages.appendChild(row);
    scrollToBottom();
  };

  const doSend = () => {
    const text = input.value.trim();
    if (!text) return;
    addMessage('user', text);
    input.value = '';
    input.style.height = 'auto';
    if (typeof onSend === 'function') onSend(text);
  };

  // Auto-grow the textarea up to its max-height.
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      doSend();
    }
  });
  sendBtn.addEventListener('click', doSend);

  fsBtn.addEventListener('click', () => {
    root.classList.toggle('is-fullscreen');
  });

  closeBtn.addEventListener('click', () => {
    if (typeof onClose === 'function') onClose();
  });

  // Settings open/close.
  gearBtn.addEventListener('click', () => {
    sceneTa.value = currentScene;
    rulesTa.value = currentRules;
    settings.classList.add('is-open');
  });
  cancelBtn.addEventListener('click', () => settings.classList.remove('is-open'));
  saveBtn.addEventListener('click', () => {
    currentScene = sceneTa.value;
    currentRules = rulesTa.value;
    settings.classList.remove('is-open');
    if (typeof onSaveSettings === 'function') {
      onSaveSettings({ scene: currentScene, rules: currentRules });
    }
  });

  // ── Public API ──────────────────────────────────────────────────────
  return {
    show() {
      root.classList.add('is-open');
      setTimeout(() => input.focus(), 60);
    },
    hide() {
      root.classList.remove('is-open');
      settings.classList.remove('is-open');
    },
    isOpen() { return root.classList.contains('is-open'); },
    addMessage,
    setSettings({ scene, rules, name } = {}) {
      if (typeof scene === 'string') currentScene = scene;
      if (typeof rules === 'string') currentRules = rules;
      if (name) title.textContent = name;
    },
    clear() {
      messages.innerHTML = '';
      messages.appendChild(empty);
    },
    destroy() {
      if (root.parentNode) root.parentNode.removeChild(root);
    },
  };

}
