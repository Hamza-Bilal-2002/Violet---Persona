/**
 * FallbackChat — client-side basic-mode conversation.
 *
 * When BackendClient can't reach the backend, it flips to 'basic' mode
 * and routes user input here instead of the WebSocket. We talk to GPT
 * directly through the Electron main process
 * (window.personaShell.fallbackChat — key lives in userData, never the
 * renderer), in a deliberately stripped-down mode:
 *
 *   - NO tools / function-calling   (the shell that runs them is the one
 *                                     that's down, and we won't risk PC
 *                                     actions from a degraded state)
 *   - NO RAG / long-term memory      (the memory DB is on the offline
 *                                     backend — protected by construction)
 *   - LIMITED, bundled personalities (see config/basicPersonalities.js)
 *   - a small hand-authored basic profile for continuity
 *
 * GPT replies in PLAIN TEXT (no emotion/animation tags — that parsing
 * lives in the backend). We enqueue each reply into the same
 * DialogueManager the backend path uses, tagged with the active
 * personality's default emotion + a talking animation, so the avatar
 * still emotes and lip-syncs through the local tts service.
 *
 * The conversation history kept here is in-memory and ephemeral: it dies
 * with the session and is never persisted, so basic mode never
 * accumulates a shadow memory store.
 */

import { BASIC_PERSONALITIES, BASIC_DEFAULT_ID }
  from '../config/basicPersonalities.js';

import { BASIC_PROFILE }
  from '../config/basicProfile.js';

// How many prior turns (user+assistant messages) to carry as context.
// Short on purpose — basic mode is light conversation, and a long history
// inflates every cloud call for little benefit.
const MAX_HISTORY_MESSAGES = 12;

// Shared structural rules appended to every basic-mode system prompt.
// Mirrors the backend's response-style contract (no emojis, 1-2 short
// sentences) but drops all tool/tag machinery — basic mode is talk-only.
const BASIC_RULES = `
RESPONSE STYLE (absolute):
- NEVER use emojis. Plain text only.
- Be concise: 1 to 2 short sentences by default. Only elaborate if Hamza
  explicitly asks ("in detail", "explain", "tell me more").
- Do NOT use any tags, markup, or stage directions — just the words you
  would say out loud.
- Stay fully in character.
`.trim();

export class FallbackChat {

  constructor({
    dialogueManager,
    ttsClient,
    onNotify,
    onPersonality,
    onPersonalities,
  } = {}) {

    this.dialogueManager = dialogueManager;
    this.ttsClient       = ttsClient;

    // onNotify(message, { kind }) — surface a toast to the user.
    this.onNotify = onNotify || (() => {});

    // Same callbacks BackendClient uses, so personality switches in basic
    // mode update the TTS voice + tray exactly like backend switches.
    this.onPersonality   = onPersonality   || null;
    this.onPersonalities = onPersonalities || null;

    // Ephemeral conversation history: [{ role, content }, ...]. Never
    // persisted — basic mode keeps no durable record.
    this._history = [];

    // Active bundled personality (defaults to the same id as the backend).
    this._personality =
      BASIC_PERSONALITIES.find((p) => p.id === BASIC_DEFAULT_ID) ||
      BASIC_PERSONALITIES[0];

    // Guards against overlapping in-flight requests stomping each other.
    this._busy = false;

  }

  // Called by BackendClient when it enters basic mode. Sets the voice and
  // pushes the limited roster to the tray so the user sees what's
  // available while offline. Does NOT speak — entering basic mode is
  // announced by the mode notifier, not the avatar.
  activate() {

    if (this.ttsClient && typeof this.ttsClient.setVoice === 'function') {
      this.ttsClient.setVoice(this._personality.voice);
    }

    if (this.onPersonality)   this.onPersonality(this._personality);
    if (this.onPersonalities) this.onPersonalities(this._rosterFrame());

  }

  // Roster frame shaped like the backend's `personalities` frame so the
  // tray relay (notifyPersonalities) treats it identically.
  _rosterFrame() {
    return {
      type: 'personalities',
      personalities: BASIC_PERSONALITIES.map((p) => ({
        id: p.id,
        name: p.name,
      })),
      active: this._personality.id,
    };
  }

  // Switch the active bundled personality (tray pick / "switch to X" while
  // offline). Updates voice + tray and gives a short in-character ack so
  // the switch is audible, mirroring the backend's spoken confirmation.
  setPersonality(id) {

    const next = BASIC_PERSONALITIES.find((p) => p.id === id);
    if (!next || next.id === this._personality.id) return;

    this._personality = next;

    if (this.ttsClient && typeof this.ttsClient.setVoice === 'function') {
      this.ttsClient.setVoice(next.voice);
    }

    if (this.onPersonality)   this.onPersonality(next);
    if (this.onPersonalities) this.onPersonalities(this._rosterFrame());

    this.dialogueManager.enqueue({
      text:      `Switched to ${next.name}.`,
      emotion:   { name: next.default_emotion, intensity: 0.4 },
      animation: 'talking',
      priority:  2,
    });

  }

  _systemPrompt() {
    return (
      'You are Violet, a personal AI assistant created for Hamza.\n\n' +
      this._personality.prompt + '\n\n' +
      BASIC_PROFILE + '\n\n' +
      BASIC_RULES
    );
  }

  _buildMessages(userText) {
    return [
      { role: 'system', content: this._systemPrompt() },
      ...this._history,
      { role: 'user', content: userText },
    ];
  }

  // Handle one user turn in basic mode. Mirrors BackendClient.send's
  // contract (called with the raw transcript/typed text).
  async send(text) {

    const trimmed = (text || '').trim();
    if (!trimmed) return;

    const shell =
      typeof window !== 'undefined' ? window.personaShell : null;

    if (!shell || typeof shell.fallbackChat !== 'function') {
      this.onNotify('Basic mode needs the desktop app.', { kind: 'warn' });
      return;
    }

    if (this._busy) {
      // Drop overlapping sends rather than interleave cloud calls.
      return;
    }
    this._busy = true;

    // Let the indicator show "thinking" while the cloud call is in flight.
    this.dialogueManager.resetIdle();

    let result;
    try {
      result = await shell.fallbackChat({
        messages: this._buildMessages(trimmed),
      });
    } catch (err) {
      result = { error: (err && err.message) || String(err) };
    } finally {
      this._busy = false;
    }

    if (result && result.error) {
      this._handleError(result.error);
      return;
    }

    const replyText = (result && result.text) || '';
    if (!replyText) {
      this.onNotify('No reply from GPT fallback.', { kind: 'warn' });
      return;
    }

    // Commit the turn to ephemeral history (trimmed to a bounded window).
    this._history.push({ role: 'user', content: trimmed });
    this._history.push({ role: 'assistant', content: replyText });
    if (this._history.length > MAX_HISTORY_MESSAGES) {
      this._history = this._history.slice(-MAX_HISTORY_MESSAGES);
    }

    this.dialogueManager.enqueue({
      text:      replyText,
      emotion:   { name: this._personality.default_emotion, intensity: 0.4 },
      animation: 'talking',
      priority:  1,
    });

  }

  _handleError(error) {

    if (error === 'no-api-key') {
      this.onNotify(
        'Backend offline and no GPT key set — set OPENAI_API_KEY to enable basic mode.',
        { kind: 'error', sticky: true }
      );
      return;
    }

    if (error === 'no-messages') return;

    console.warn('FallbackChat: GPT error —', error);
    this.onNotify('Basic mode hit an error reaching GPT.', { kind: 'error' });

  }

  // Reset on returning to full mode so a future basic session starts clean.
  reset() {
    this._history = [];
  }

}
