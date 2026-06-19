// Persona desktop shell — client-side GPT fallback (Tier-2, basic mode).
//
// When the backend (and the local model behind it) is unreachable, the
// renderer's BackendClient flips to basic mode and routes user turns here
// via the 'persona:fallback-chat' IPC channel. We call OpenAI directly
// from the MAIN process so:
//   - the API key never lives in the renderer (it's read from userData),
//   - there's no browser CORS dance,
//   - the key is never committed (it's per-device, in violet-settings.json
//     or the OPENAI_API_KEY env var as a dev convenience).
//
// Basic mode is talk-only: no tools, no function-calling, no memory. This
// module just relays messages -> reply text. The renderer builds the
// system prompt (basic profile + limited personality); we don't shape it
// here, only carry it.

'use strict';

const { loadSettings } = require('./userSettings');

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

// Matches the backend's testing model so basic mode sounds consistent
// with full mode. Cheap + fast, appropriate for light fallback chat.
const DEFAULT_MODEL = 'gpt-4o-mini';

// Read the OpenAI key from per-device settings, falling back to the env
// var. Returns null when neither is set — the renderer surfaces a "add a
// key" notice in that case rather than silently failing.
function getApiKey() {
  const settings = loadSettings();
  if (settings && typeof settings.openaiApiKey === 'string') {
    const k = settings.openaiApiKey.trim();
    if (k) return k;
  }
  if (process.env.OPENAI_API_KEY) {
    return process.env.OPENAI_API_KEY.trim();
  }
  return null;
}

function hasApiKey() {
  return !!getApiKey();
}

// Run one basic-mode completion. Returns { text } on success or
// { error } on failure — never throws, so the renderer can map the error
// to a user-facing notifier without a try/catch around the IPC call.
async function runFallbackChat({ messages, model } = {}) {

  const apiKey = getApiKey();
  if (!apiKey) {
    return { error: 'no-api-key' };
  }

  if (!Array.isArray(messages) || messages.length === 0) {
    return { error: 'no-messages' };
  }

  try {

    const res = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: model || DEFAULT_MODEL,
        messages,
        // Basic mode replies are short and conversational; cap tokens so
        // a runaway response can't rack up cost or stall the avatar.
        max_tokens: 220,
        temperature: 0.85,
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      console.error(
        `[fallbackChat] OpenAI ${res.status}:`,
        detail.slice(0, 300)
      );
      return { error: `openai-${res.status}` };
    }

    const data = await res.json();
    const text =
      data &&
      data.choices &&
      data.choices[0] &&
      data.choices[0].message &&
      data.choices[0].message.content;

    return { text: (text || '').trim() };

  } catch (err) {

    console.error('[fallbackChat] request failed:', err && err.message);
    return { error: (err && err.message) || String(err) };

  }

}

module.exports = {
  runFallbackChat,
  hasApiKey,
};
